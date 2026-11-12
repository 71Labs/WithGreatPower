# Contract v3

The next version of the game contract (`contracts/wgp`), built and tested on the branch `feat/contract-v3`. **It is not deployed.** `game.wgpnear.near` still runs v2 (code hash `68F7NhEjUtKweyLU7WNvT183apacLQegfB1DXUoQ2hjJ`). Upgrading is the owner's call; the steps are [below](#upgrading-owner).

Read this first if you are deciding whether to upgrade:

- **The contract account needs more NEAR before the upgrade can work.** v3's wasm is 109,594 bytes larger than v2's, which locks about **1.10 NEAR** more for storage. On Nov 12 `game.wgpnear.near` held 4.49 NEAR with 3.74 locked, so 0.75 NEAR free. Without a top-up the upgrade fails (safely: v2 carries on). Send it 2 NEAR first.
- **Nothing a player can do changes at the moment of the upgrade.** Every v2 method, view and event keeps its name, arguments and behaviour. Investing arrives switched off and the crafting cost stays what it is on chain today (0). The owner turns each on with one call.
- **There is a tested way back**, as long as no Bits are invested: a rollback build of the v2 code ([Rolling back](#rolling-back)).

## What's new

| | v2 | v3 |
|---|---|---|
| NEP-245 metadata | none (`MethodNotFound`) | `mt_metadata_contract`, per-token and base metadata for every token kind, with titles, descriptions and image URLs |
| NEP-245 enumeration | `mt_tokens_for_owner` only | plus `mt_tokens`, `mt_tokens_count`, `mt_tokens_base_metadata_all` |
| Merchants | the vendor's till is whatever it was seeded with and earned | players **invest** Bits in a pool's till and earn a share of its fees; a till that can't pay for one item is **broke** and says so in a view and an event |
| Currency sinks | 2% fee burned; crafting cost exists but is 0 | the crafting cost is a real default (50 Bits, a placeholder) on a fresh deploy; on an upgrade the owner sets it |
| Owner actions | silent | every one logs an `admin` event |
| Introspection | `get_config` | plus `get_version`, `get_storage`, NEP-330 `contract_source_metadata` naming the standards |
| State | v2 layout | v3 layout with a tag; `migrate` brings v1 and v2 states to v3 and leaves v3 alone |

### What a v2 client would notice

Nothing breaks; these are the observable differences.

- `market_state` pools carry four more fields (`invested`, `rewards`, `fee_acc`, `fee_carry`) and `params` seven more (the investing rules). The app's zod schemas ignore unknown fields.
- `mt_tokens_for_owner(<the contract>)` now lists the vendor's stock and Bits; in v2 it listed only tokens sent to the contract directly.
- A trade can log one more event, `market_shop`, when it opens or closes a stall.
- Once a pool has investors, the `mt_burn` on that pool's vendor trades is the fee less the investors' share (half by default) instead of the whole fee. The `market_trade` event's `fee` is unchanged.
- Owner calls log an `admin` event.
- `set_market_params` accepts the investing rules too. Arguments in the v2 shape still work and leave the investing rules as they are.

## API

U128 amounts travel as decimal strings; `u32`/`u64` as JSON numbers. Nothing here takes a deposit except the owner methods (1 yoctoNEAR).

### NEP-245 metadata (`src/meta.rs`)

| Method | Arguments | Returns |
|---|---|---|
| `mt_metadata_contract` | none | `{spec: "mt-1.0.0", name}` |
| `mt_metadata_token_all` | `token_ids: string[]` | `({base, token} \| null)[]` |
| `mt_metadata_token_by_token_id` | `token_ids: string[]` | `(MTTokenMetadata \| null)[]` |
| `mt_metadata_base_by_token_id` | `token_ids: string[]` | `(MTBaseTokenMetadata \| null)[]` |
| `mt_metadata_base_by_metadata_id` | `base_metadata_ids: string[]` | `(MTBaseTokenMetadata \| null)[]` |
| `mt_metadata_base_by_metadata_base_id` | same | same (the name some implementations use) |
| `mt_tokens_base_metadata_all` | `from_index?: string, limit?: number` | `MTBaseTokenMetadata[]` |
| `get_token_metadata_row` | `key: string` | the owner's row for a token id or base id, or null |
| `set_token_metadata` (owner, 1 yocto) | `name?: string, base_uri?: string, entries: [key, row \| null][]` | sets the collection name, the media base URI and up to 50 rows; a null row removes it |

Null means the id names no token the game has minted or could mint. Metadata is **derived from the token id**, not stored per token:

| Token | Base id (symbol) | Default title | Default media (under `base_uri`) |
|---|---|---|---|
| `hero:<account>` | `hero` (WGPHERO) | the hero's name | `hero.png` |
| `suit:<id>` | `suit` (WGPSUIT) | "<Id> suit" | `suit/<id>.png` |
| `item:bits` | `bits` (BITS) | "Bits" | `bits.png` |
| `item:<id>` | `item` (WGPLOOT) | "<Id>" | `item/<id>.png` |
| `trophy:badge:<id>` | `badge` (WGPBADGE) | "<Id> badge" | `badge/<id>.png` |
| `trophy:<season>:<rank>` | `trophy` (WGPTROPHY) | "Season <s>: rank <n>" | `trophy/1.png`, `2.png`, `3.png`, else `top10.png` |

`base_uri` starts as `https://www.wgponnear.fun/tokens`. Heroes and trophies also carry `issued_at` and an `extra` JSON string (`{"kind":"hero","soulbound":true,"level":4,"suit":"stealth"}`). All bases have `decimals: "0"`.

The owner's table (`set_token_metadata`) is the only metadata in storage. A row is keyed by a token id (`item:fee-bomb`) or a base id (`badge`) and may set `title`, `description`, `media` (an absolute URL or a path under `base_uri`) and `media_hash` (base64 sha256). A token's own row wins over its kind's row, which wins over the default. `contracts/wgp/token-metadata-args.json` is the full set of arguments for the game as it is (26 rows: the game's names and blurbs, a hash for each image, and a shared image for any badge that has none yet); `scripts/near/token-metadata.mjs` prints it.

### NEP-245 enumeration (`src/mt.rs`)

| Method | Arguments | Returns |
|---|---|---|
| `mt_tokens` | `from_index?: string, limit?: number` (at most 100) | `{token_id, owner_id \| null}[]`: every token id with supply. `owner_id` is set for heroes and season trophies. |
| `mt_tokens_count` | none | how many ids `mt_tokens` pages through |
| `mt_tokens_for_owner` | `account_id, from_index?, limit?` | as in v2; for the contract itself it now includes the vendor's holdings |
| `index_tokens` (operator or owner) | `token_ids: string[]` (1 to 100) | how many index entries changed |

`mt_tokens` reads an index the contract keeps as tokens are minted and burned. Tokens minted **before** v3 are not in it until their next mint (items, Bits, and a hero on its player's next reward) or until `index_tokens` is called with their ids; `scripts/near/index-args.mjs` prints those calls from a list of player accounts. `index_tokens` only adds ids that exist and drops ids that no longer do, so it can't list a token that isn't real.

### Investing (`src/invest.rs`)

| Method | Arguments | What it does |
|---|---|---|
| `market_invest` | `item: string, bits: string` | Moves the caller's Bits into that item's till. Returns a receipt. |
| `market_withdraw` | `item: string, bits: string` | Moves that many Bits of the caller's stake back, with any fee earnings. Needs the lock to have passed and the till to hold them. Works while trading is closed. |
| `market_claim` | `item: string` | Pays the caller the fee earnings of that stake; the stake stays. |
| `market_refund` (owner, 1 yocto) | `item: string, account_ids: string[]` (1 to 20) | Sends those investors' whole stakes home with their earnings, lock or no lock. |
| `market_shops` (view) | none | Per pool: `{item, price_milli, closed: string[], buying, selling, till, needs, invested, invest_room, rewards}` |
| `market_investor` (view) | `account_id` | `{stakes: [{item, bits, earned, unlocks_at_ms, withdrawable}], invests_left, invest_bits_left}` |

The receipt: `{item, bits, earned, stake, unlocks_at_ms, pool}`: Bits moved by this call, earnings paid by it, the caller's stake afterwards, and the pool afterwards.

`closed` lists why a stall can't trade right now: `paused`, `market-closed`, `broke` (the till can't pay for one item, so the vendor buys nothing until someone invests in it or buys from it), `sold-out` (nothing to sell). Empty means it buys and sells.

Rules (in `market_state().params`, set with `set_market_params`):

| Rule | Default | Meaning |
|---|---|---|
| `invest_open` | true on a fresh deploy, **false after an upgrade** | off: no new investments; withdrawals and claims still work |
| `invest_fee_bps` | 5000 | investors' share of a vendor trade's fee, in basis points of the fee; the rest is burned |
| `min_invest`, `max_invest` | 10, 500 | Bits per `market_invest` call |
| `daily_invests` | 6 | `market_invest` calls per account per UTC day |
| `daily_invest_bits` | 1000 | Bits an account may invest per UTC day |
| `invest_lock_ms` | 3,600,000 (1 hour) | a stake can be withdrawn this long after its last top-up |
| `craft_bits` | 50 on a fresh deploy; unchanged by an upgrade | Bits burned per crafted suit with a recipe |

What the contract says when it refuses (the app's `refusal.ts` should learn the new ones):

| Message | When |
|---|---|
| `The vendor isn't taking investors right now` | `invest_open` is false |
| `Invest 10 to 500 Bits at a time` | outside `min_invest`..`max_invest` |
| `Daily market limit reached; it resets at midnight UTC` | past `daily_invests` or `daily_invest_bits` (same words as the other daily caps) |
| `The vendor can take only N more Bits for <item>` | the pool has less room than that |
| `Needs N Bits` | the caller holds fewer (same words as a buy) |
| `You have no stake in <item>` / `You have N Bits staked in <item>` | withdrawing or claiming what isn't there |
| `Your stake unlocks in about N minutes` | inside the lock |
| `The till can pay back only N Bits right now; it refills as players buy <item>` | the till holds fewer Bits than asked |
| `Nothing earned yet` | a claim with nothing to pay |

### Owner and introspection

| Method | Notes |
|---|---|
| `set_market_params(params, pools)` | `params` takes the 12 v2 rules (required, as before) and any of the investing rules; one left out keeps its value. Retuning a pool keeps investors' Bits in the till: the new `virtual_bits` must stay above what is invested there. |
| `get_version` | `{state: 3, contract: "0.3.0", standards: ["nep245","nep297","nep330"]}` |
| `get_storage` | `{bytes, locked, balance, available, tokens}` in yoctoNEAR: what storage costs and what the contract can still pay for. It sponsors every player's storage, so `available` is the number to watch. |
| `upgrade`, `migrate` | as in v2. `migrate` handles v1, v2 and v3 states. |

### Events

NEP-297, `standard: "wgp"`, version `1.0.0`. All v2 events are unchanged.

| Event | Data | When |
|---|---|---|
| `market_invest` | `{account_id, item, bits, earned, stake, invested}` | an investment |
| `market_withdraw` | same | a withdrawal or a refund |
| `market_claim` | same, `bits: "0"` | a claim |
| `market_shop` | `{item, closed: string[], cause, till, needs}` | a pool opened or closed for buying or selling; `cause` is `buy`, `sell`, `invest` or `withdraw` |
| `admin` | `{action, by, account_id?}` | `pause`, `unpause`, `add_operator`, `remove_operator`, `set_owner`, `set_rules`, `set_market_params`, `set_token_metadata`, `market_refund`, `upgrade` |

The NEP-245 events mirror the Bits: `mt_transfer` with memo `invest` (player to vendor), `withdraw` (vendor to player) and `earnings` (vendor to player). Balances always agree with the events: the contract's own `item:bits` balance is every till plus every pool's unclaimed earnings.

## The investment design

The track asks for merchants with their own wallet and inventory, where "a merchant that goes broke closes its shop until someone invests in it". Each pool is one such merchant: its inventory is `stock`, its wallet is `bits` (the till), and both are NEP-245 balances of the contract account that every trade moves and logs.

### How it works

Each pool prices on a constant-product curve over `x = virtual_items + stock` and `y = virtual_bits + bits`. Only `bits` is real. When a sale to the vendor would pay more than the till holds, the sale is refused; when the till can't pay for even one item the shop is **broke**. In v2 it then stayed broke until someone bought from it.

`virtual_bits` is the part of the curve nobody has funded. `market_invest` funds it: the investor's Bits go into the till, and **the same amount comes off `virtual_bits`**. So `y` is unchanged, and with it the spot price and every quote. Withdrawing does the reverse.

- A pool takes at most `virtual_bits - 1` Bits. A fully funded curve can pay for any sale (the total it can ever pay out approaches `y`), so there is nothing left to fund. With the live curves that is 479 Bits for a common item, 799 for an uncommon, 1,199 for a rare.
- A stake is a claim on **its own principal**, 1 Bit for 1 Bit, not a share of the till.
- Investors earn `invest_fee_bps` of the 2% fee on that pool's vendor trades, split by stake, instead of that part being burned. Earnings are kept apart from the till (`Pool.rewards`) and can always be claimed. Fractions of a Bit carry to the next trade. Listings still burn their whole fee, and a pool with no investors burns the whole fee as in v2.
- The stake is a ledger entry, not a token. It can't be transferred.

### The safety argument

Each claim names the unit test that checks it (`src/v3_tests.rs`), and the sandbox test repeats the main ones against the real runtime.

1. **Investing and withdrawing move no price.** `y`, the spot price, every buy quote and every listing bound are identical before and after. (`investing_funds_the_till_and_moves_no_price`; the randomized run asserts `reserves` are unchanged on every one of ~900 invests and withdrawals.)
2. **A round trip returns exactly what went in**, and leaves the pool byte-for-byte as it was. (`an_invest_withdraw_round_trip_returns_exactly_what_went_in`)
3. **A sandwich gains nothing from the trade it surrounds.** Invest, let the victim sell, withdraw: the victim is paid to the Bit what they would have been, the vendor ends with the same till and stock, and the attacker's only gain is the investors' share of that one trade's fee, which would otherwise have been burned. With the default one-hour lock they can't withdraw in time for even that. (`a_sandwich_around_a_trade_gains_nothing_from_it`, `a_sandwich_cant_even_take_the_fee_share_while_the_lock_holds`)
4. **Nobody else's stake is touched.** Another investor arriving, leaving, and trading against the pool never lowers a stake or its earnings. (`another_investor_coming_and_going_takes_nothing_from_a_stake`)
5. **The vendor can't be drained through it.** Withdrawals pay principal only; fee earnings come from fees. The constant product `x·y` never falls on a trade, as in v2. (`the_books_balance_through_random_trading_and_investing`: 3,000 random buys, sells, invests, withdrawals and claims by four accounts, checking after each that Bits supply equals players' Bits plus tills plus unclaimed earnings, that stakes sum to `invested`, that owed earnings are covered, and that `virtual_bits + invested` equals what the owner set.)
6. **Session-key safe.** No method takes a deposit. An investment is bounded per call (`max_invest`), per day by count and by Bits, and per pool by its room. Withdrawals aren't capped, so a stake can always come home. (`investing_is_bounded_per_call_and_per_day`, `invest_calls_take_no_deposit_so_a_session_key_can_make_them`)
7. **A stolen session key can't drain a player.** All it can do with the player's Bits is stake them, at most `daily_invest_bits` a day; the stake stays the player's and can't be sent anywhere. Even with an accomplice dumping items on the till the stolen key just funded, the player's claim doesn't move by a Bit, and it is paid back with earnings as others buy that stock. (`a_stolen_session_key_cant_drain_a_player_by_investing`)

### What an investor does risk

Said plainly, because the app must say it too:

- **Waiting.** Withdrawing takes real Bits out, so the till must hold them. If players sold the vendor a pile of an item and nobody buys it back, the Bits are in that stock and the stake waits. It is never written off, but nothing forces anyone to buy. (`a_stake_waits_for_the_till_and_is_never_lost`)
- **First come, first served.** When a till holds less than all its investors are owed, whoever withdraws first is paid first.
- **A just-in-time investor dilutes fee earnings.** Someone who invests just before a large trade takes a pro-rata share of that trade's fee share from earlier investors. The lock (they must stay an hour, exposed to the wait above) and the daily caps bound it; it never touches principal.
- **A stolen key can park Bits.** Up to `daily_invest_bits` a day can be moved into stakes the player then has to withdraw (after the lock, and subject to the till). That is a nuisance, not a loss; for comparison, the same key can already spend 3,000 Bits a day on listings priced at up to four times the vendor's price.
- **Small pools.** A pool's room is under 1,200 Bits, so one account can fill it in a day or two. Raising a curve's `virtual_bits` makes room.
- **The owner can retune or refund.** `set_market_params` can change the fee share and the lock; `market_refund` returns stakes to their owners. Neither can take a stake.

### The sink trade-off

Investors' earnings are fees that would have been burned, so each invested pool burns half as much per vendor trade (at the default share). The crafting cost is what offsets it. Set `invest_fee_bps` lower to burn more.

## Sinks: the crafting cost

`craft_suit` already burned `craft_bits` Bits per crafted suit with a recipe; it was 0. In v3:

- `MarketParams::default()` sets it to `DEFAULT_CRAFT_BITS = 50` (`src/market.rs`), so a fresh deploy charges for crafting from the start. **50 is a placeholder.**
- An upgrade keeps the live value (0). Crafting on mainnet costs nothing more until the owner sets it.

Where the real number goes, once `docs/ECONOMY.md` (branch `feat/economy-balance`) recommends one:

1. On chain: `node scripts/near/market-rules.mjs game.wgpnear.near --craft-bits <N>` prints the `set_market_params` arguments (it changes that one rule).
2. In the contract's default: `DEFAULT_CRAFT_BITS` in `contracts/wgp/src/market.rs`.
3. In the app: `DEFAULT_PARAMS.craftBits` in `apps/wgp/src/lib/market/config.ts` (still 0; it drives the simulated market, `market-args.ts` and `sandbox-up.ts`). Not changed on this branch: the app must first show the cost on the craft button and explain a "Needs bits xN" refusal.

Do the app change before the on-chain one, or players will see crafts fail without knowing why.

## Storage and gas

Storage is 1 NEAR per 100,000 bytes (0.00001 NEAR per byte), paid by the contract account.

| | Bytes | NEAR locked |
|---|---|---|
| v2 wasm (live) | 361,935 | |
| v3 wasm | 471,529 | |
| **The upgrade** (code, plus about 300 bytes of root state), measured in the sandbox | **+109,901** | **1.099** |
| The metadata table (26 rows, `token-metadata-args.json`) | 5,468 | 0.055 |
| The token index, per token (a hero with a 64-character account id; shorter ids cost less) | up to 195 | 0.002 |
| An investor with four stakes | 194 | 0.002 |
| A trader with three listings (unchanged from v2) | 748 | 0.007 |

Gas, measured in the sandbox against the built wasm (`cargo test -- --nocapture` in `contracts/wgp/sandbox`). The relayer allows a relayed call 30 Tgas.

| Call | Tgas burnt |
|---|---|
| `upgrade` v2 → v3 (deploy + migrate), attach 300 | 64.9 (about 0.0065 NEAR) |
| `market_invest` | 2.8 |
| `market_withdraw` | 3.0 |
| `market_claim` | 2.7 |
| `market_buy` / `market_sell` in a pool with an investor | 3.0 |
| `market_buy`, `market_sell`, `list_item`, `cancel_listing`, `buy_listing` (v2 calls on v3) | 2.9 to 4.1 |
| `register_hero` / `craft_suit` | 3.0 / 3.2 |
| `mint_rewards`, 20 rewards × 3 items | 10.3 (v2: about 9) |
| `record_season`, 10 players | 9.1 |
| `index_tokens`, 12 ids | 5.9 |
| `set_token_metadata`, 2 rows | 2.5 |
| `market_refund`, 1 investor | 2.8 |

Views page: `mt_tokens` and `mt_tokens_for_owner` return at most 100 per call, `market_listings` at most 50, and `mt_tokens` skips to `from_index` without reading what it skips.

## Token images

The metadata points at these 30 files, all 512×512 PNG, under `apps/wgp/public/tokens/` (served at `https://www.wgponnear.fun/tokens/…` once this branch's `apps/wgp/public` is deployed). They are in the repo; `node scripts/near/token-metadata.mjs --list` prints the list and `--render` redraws them (the hero is the cast portrait; each suit is the hero's mask in that suit's own colours).

| Path | Files |
|---|---|
| `hero.png`, `bits.png`, `badge.png` | the hero portrait; the Bits coin; the image for any badge without its own |
| `item/` | `fee-bomb`, `goblin-glider`, `crumbs`, `sesame-seed`, `chain-link`, `spare-arm`, `sybil-goo`, `press-pass` |
| `suit/` | `classic`, `midnight`, `mint`, `snow`, `stealth`, `glider`, `octo`, `sesame` |
| `badge/` | `day-one`, `case-001`, `case-002`, `case-003`, `daily-podium`, `daily-winner`, `recruiter` |
| `trophy/` | `1`, `2`, `3`, `top10` |

A new item, suit or badge needs its image at the matching path (and, for a hash, a row in the table). Until a new badge has one, the `badge` row shows `badge.png`. **Don't change a published image without updating its `media_hash` row**, or the hash on chain no longer matches the file.

## Upgrading (owner)

Nothing below has been run against mainnet or testnet. Every command is the owner's to run, with the owner's key. Read [Risks](#risks-of-upgrading-now) first.

**0. Fund the contract account.** It needs about 1.10 NEAR more than it has free; send 2 NEAR for headroom:

```sh
near tokens wgpnear.near send-near game.wgpnear.near '2 NEAR' network-config mainnet sign-with-legacy-keychain send
```

**1. Build, and keep the old code at hand.**

```sh
cd contracts/wgp
cargo test --locked                                   # 113 passed
cargo near build non-reproducible-wasm --locked       # target/near/wgp.wasm, 471,529 bytes
node ../../scripts/near/check-wasm-imports.mjs target/near/wgp.wasm
node ../../scripts/near/fetch-deployed-wasm.mjs game.wgpnear.near target/near/wgp-v2.wasm \
  68F7NhEjUtKweyLU7WNvT183apacLQegfB1DXUoQ2hjJ      # the live code, hash checked
bash rollback/build.sh                                # target/near/wgp-v2-rollback.wasm
```

**2. Rehearse.** The sandbox test does the whole upgrade from the live wasm, then the rollback and the upgrade again:

```sh
cd contracts/wgp/sandbox && cargo test -- --nocapture --test-threads=1
```

Better still, do steps 3 to 6 on testnet first (`MODE=upgrade KEYCHAIN=legacy scripts/near/deploy-testnet.sh`).

**3. Deploy the token images** (this branch's `apps/wgp/public/tokens`) so the URLs answer before the metadata points at them. Check `https://www.wgponnear.fun/tokens/bits.png`.

**4. Upgrade.** The contract deploys the wasm to itself and runs `migrate` in the same receipt; if either fails, both are undone.

```sh
near contract call-function as-transaction game.wgpnear.near upgrade \
  file-args contracts/wgp/target/near/wgp.wasm \
  prepaid-gas '300.0 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
```

Cost: about 0.0065 NEAR of gas from the owner, and 1.10 NEAR of the contract's own balance locked for storage.

**5. Verify.**

```sh
NONE='{}'
V() { near contract call-function as-read-only game.wgpnear.near "$1" json-args "${2:-$NONE}" network-config mainnet now; }
V get_version                 # {"state":3,"contract":"0.3.0",...}
V get_storage                 # available should be about 1.6 NEAR after a 2 NEAR top-up
V market_state                # the 8 pools and 12 v2 rules as before; invest_open false; craft_bits "0"
V market_shops                # every stall, closed: [] unless a till is dry
V mt_metadata_contract        # {"spec":"mt-1.0.0","name":"With Great Power"}
V mt_metadata_token_all '{"token_ids":["item:bits","item:fee-bomb","suit:classic"]}'
V get_player '{"account_id":"<a player>"}'    # same hero, level, nonce and tokens as before
```

Then play: a night, a buy, a sell, a listing in the live app. The app needs no change for any of it.

**6. Name the tokens and index the old ones.**

```sh
near contract call-function as-transaction game.wgpnear.near set_token_metadata \
  json-args "$(cat contracts/wgp/token-metadata-args.json)" \
  prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send

# accounts.txt: one player account id per line (players.near_account_id)
node scripts/near/index-args.mjs game.wgpnear.near accounts.txt > index-args.jsonl
while read -r ARGS; do
  near contract call-function as-transaction game.wgpnear.near index_tokens json-args "$ARGS" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
    sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
done < index-args.jsonl
V mt_tokens '{"limit":100}'
```

Storage: 0.055 NEAR for the table, up to 0.002 NEAR per indexed token.

**7. Open investing**, when you are ready to stand behind it (and ideally once the app shows it):

```sh
near contract call-function as-transaction game.wgpnear.near set_market_params \
  json-args "$(node scripts/near/market-rules.mjs game.wgpnear.near --invest-open true)" \
  prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
```

**8. Set the crafting cost**, once the app shows it: the same command with `--craft-bits <N>`.

`scripts/near/market-args.ts` still works for retuning curves; it sends the v2 rules and leaves the investing rules alone.

### Rolling back

Three levels, mildest first.

1. **Switch the new behaviour off.** `--invest-open false` stops new investments (stakes still come out). `--craft-bits 0` makes crafting free. `--invest-fee-bps 0` burns the whole fee again. With those, v3 behaves as v2 does for players. `set_paused` stops everything, as before.
2. **Upgrade forward** to a fixed build with the same `upgrade` call. `migrate` leaves a v3 state as it is.
3. **Go back to the v2 code.** The live v2 wasm can't be used: its `migrate` refuses a v3 state, so that `upgrade` fails whole and v3 stays (the sandbox test checks this). `contracts/wgp/rollback/build.sh` builds the v2 code at the deployed commit plus `v2-rollback.patch` (179 lines, `migrate.rs` only), which reads a v3 state and writes it back in the v2 layout:

   ```sh
   bash contracts/wgp/rollback/build.sh
   near contract call-function as-transaction game.wgpnear.near upgrade \
     file-args contracts/wgp/target/near/wgp-v2-rollback.wasm \
     prepaid-gas '300.0 Tgas' attached-deposit '1 yoctoNEAR' \
     sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
   ```

   - **It refuses while any Bits are invested**, so no stake is forgotten: `N Bits are invested in <item>: send the stakes home (market_refund) before rolling back`. Close investing, then `market_refund` each pool's investors (the `market_invest` events name them); a refund needs the till to hold the Bits. If investing was never opened, there is nothing to refund.
   - Players, balances, pools, listings, seasons and the 12 v2 rules carry over. The investing rules are dropped.
   - The token index and the metadata table stay in storage, with their roots set aside under the `V3TAIL` key. Upgrading to v3 again picks them up. Tokens minted while rolled back aren't indexed until their next mint under v3.
   - The rollback wasm is 368,893 bytes, 6,958 more than the original v2; the storage v3 locked for code is released.

   The sandbox test runs v2 → v3 → rollback → v3 and compares every v2 view at each step.

## Risks of upgrading now

Two days before the deadline, honestly:

- **It is a state migration on a live contract with real players' assets.** The migration rewrites one storage entry (the root) and touches no player, listing or season entry; it is tested from the exact live wasm in a sandbox, and a failed migration undoes the deploy. But the sandbox state is one I made, not mainnet's. The strongest rehearsal left undone is running the upgrade against a copy of mainnet's actual state (near-workspaces can import it) or on testnet.
- **No independent review.** About 1,600 new lines of contract code, written and tested by one author in one day. The investing maths is small and its invariants are tested, but nobody else has tried to break it. Keeping `invest_open` false after the upgrade means the new money-moving code can't run until you choose.
- **The app doesn't use any of it yet.** Metadata and enumeration help a screener or a wallet immediately. Investing has no UI, the relayer doesn't allow its methods, and the refusal texts don't know its messages. Opened on chain without the app, only someone calling the contract directly can invest, with nothing explaining the risk of waiting.
- **Turning on the crafting cost before the app shows it** would make crafts fail with no explanation. It stays 0 until you set it.
- **The rollback has a condition.** It works only while no Bits are invested (or after refunding them, which needs solvent tills). Once investing is open and used, the realistic way back is switching it off and fixing forward.
- **Costs are small but real**: 2 NEAR to the contract account, of which 1.10 is locked.
- **Season 1 ends on the 14th** and `record_season` is the call that must not fail. It is unchanged, tested on v3 (unit and sandbox, 9.1 Tgas), and its only new work is adding ten trophy ids to the index.

A reasonable middle path: upgrade, verify, set the metadata and index the tokens (the two screener findings that are pure reads), and leave investing and the crafting cost off until the app catches up. That gets the metadata and enumeration points with the least new behaviour live.

## What the app needs (follow-ups, not done here)

The market UI is untouched on this branch.

1. **Relayer policy** (`apps/wgp/src/lib/near/policy.ts`): add `market_invest`, `market_withdraw`, `market_claim` to `MARKET_METHODS`.
2. **Read the new state** (`src/server/market/chain.ts`): `market_shops` for open/closed and `invest_room`; `market_investor` for a player's stakes; add the investing fields to the zod schemas when they are used.
3. **An "invest in this stall" panel** on the market screen: the till, what it needs, room left, the player's stake, earnings, when it unlocks, what can be withdrawn now. It must say that a stake waits when the till is empty. A broke stall should say "closed for buying until someone invests" with the button right there.
4. **Refusal texts** (`src/lib/market/refusal.ts`): the messages in the table above.
5. **The simulated market** (`src/lib/market/engine.ts`): mirror invest, withdraw, claim and the fee split if the simulation should offer investing. The curve maths is unchanged, so `math.ts` and `market-vectors.json` need nothing.
6. **Crafting cost**: show `craft_bits` on the craft button, handle "Needs bits xN", then set `DEFAULT_PARAMS.craftBits` and the on-chain value together.
7. **Activity feed**: `market_shop` and `market_invest` events are good story beats ("Gwei's crumbs stall went broke; a player bailed it out").
8. **Docs**: the README's contract test count (68) becomes 113; the trust section could mention `get_storage`.

## Tests

| What | Where | Result |
|---|---|---|
| Unit tests (113: 68 from v2, 45 new) | `cd contracts/wgp && cargo test --locked` | pass |
| Clippy on the contract | `cargo clippy --locked --target wasm32-unknown-unknown -- -D warnings` | clean |
| Mainnet import guard | `node scripts/near/check-wasm-imports.mjs contracts/wgp/target/near/wgp.wasm` | 26 host functions, none newer than mainnet |
| Sandbox: v2's own tests on the v3 wasm | `contracts/wgp/sandbox/tests/sandbox.rs` | pass |
| Sandbox: upgrade from the live v2 wasm, v3 methods, second upgrade, rollback and back | `contracts/wgp/sandbox/tests/upgrade_v3.rs` | pass |
| Sandbox: an upgrade the account can't pay storage for | same file | fails whole, v2 intact; passes after a top-up |

The sandbox tests need cargo-near 0.22 and the three wasms from step 1 of the upgrade.
