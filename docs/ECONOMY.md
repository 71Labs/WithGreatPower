# The Bits economy: what inflates, what was measured, what changed

This is the balance report for the Mempool Market. It says where Bits come from and go, shows the measured problem, and sets out the two changes that close most of the gap: a wallet taper on the faucet, which the server pays now, and two market settings the owner sets with one transaction. It is plain about what they do not fix.

Every number below comes from one script, and the same seeds always give the same numbers:

```bash
pnpm --filter wgp exec tsx scripts/economy-balance.ts --search --drain --npc
```

- **Code:** `apps/wgp/src/lib/market/rewards.ts` (the faucet and its taper), `apps/wgp/src/server/market/held.ts` (the balance the taper reads), `balance.ts` (the measurements and the settings), `bots.ts` (the bot heroes), `scripts/economy-balance.ts` (the tables).
- **Output:** `docs/economy/balance.json`.
- **Tests:** `balance.test.ts` checks the accounting to the Bit and that the proposal meets its band; `rewards.test.ts`, `held.test.ts` and `runs.test.ts` check what a verified night pays.
- **In the game:** the results screen says what a night paid and, when the taper cut it, from what and why. The Suit lab reads `craft_bits` live and shows, checks and (in the simulated market) burns it; every fee the market prints reads `fee_bps`.
- **See it:** `/lab/economy` opens on the proposal (the owner's settings and the taper). **Run the old settings** switches back to 2%, free crafting and no taper, and the chart under the counters draws Bits earned against Bits burned.

## What is live, and what waits for the owner

| Change | Where | Live |
|---|---|---|
| **Faucet taper:** a verified night pays the whole night up to 150 Bits held, then less in a straight line, down to the 5 for showing up at 400 and beyond | Server: `nightPay` in `rewards.ts`, called by `runs.ts` | With the deploy that carries it. It needs no owner call |
| **Gas fee** `fee_bps` 200 → 1000 (2% → 10%, the contract's cap) | Contract state: `set_market_params` | Once the owner sends the call below |
| **Crafting cost** `craft_bits` 0 → 250 Bits per recipe suit | Contract state: `set_market_params` | Once the owner sends the call below |

The app reads `fee_bps` and `craft_bits` live from `market_state`, so the same build works before and after the owner's call. The README, this report and `docs/evidence.json` describe mainnet **after** that call; "Claims that wait for the owner's call" at the end lists them.

## The loop

| | What | Where it's set |
|---|---|---|
| **Source of Bits** | A verified night earns `floor(score / 100) + 5`, +25 on a level-up, +1 per Bits token collected (up to 25), at most 1,000, and the taper pays it in full only to a hero holding up to 150 Bits | Server: `src/lib/market/rewards.ts`, called by `runs.ts` |
| **Source of items** | Loot from the verified night | The ranked sim (ruleset 4); not changed here |
| **Sink: gas fee** | `fee_bps` of every trade's and fill's Bits is burned (10%, the most the contract allows) | Contract state: `set_market_params` |
| **Sink: crafting** | `craft_suit` burns the recipe's items and `craft_bits` Bits (250). A hero can craft each of the four recipe suits **once** | Contract state: `set_market_params` |
| **Not a source or a sink** | Gwei Stacy. She sells only her stock and pays only from her till, so trading with her moves Bits around and creates none | Contract: `market.rs` |
| **Prices** | Per item, `(virtual_bits + till) / (virtual_items + stock)`. Buying raises it, selling lowers it | Contract state: the pools |

The Bits rule is server code outside the ranked sim. The taper reads only the verified result and the hero's balance, so it changes no score, replay, board, golden or `RULESET_VERSION`; the verifier never reads it.

### The balance the taper reads

`src/server/market/held.ts`, at submit time, after the replay is verified:

- **Mainnet:** the contract's `bits_of` for the player's account, plus the Bits in their reward mints that haven't landed yet, so nights submitted back to back can't outrun the operator.
- **A local checkout** (no NEAR configured): the simulated market's wallet.
- **Anything else** (the RPC is down, a shape it doesn't know, no answer in 2.5 seconds): the whole night is paid. A slow read never costs a player their Bits.

The night's mint records the untapered night and the balance it read, so a resubmit answers the same number and the same reason.

## The measured problem

**On mainnet** (read-only RPC and `/api/stats`, 15 Nov 2026, before the owner's call):

| | Mainnet | The model's assumption |
|---|---|---|
| Bits supply | 26,572 | |
| In Gwei's till | 6,357 (6,240 seeded) | |
| Held by players | 20,215, about 842 each | |
| Players with a verified night | 24 | 60 heroes |
| Reward mints sent | 219, about 9.1 per player | One night per hero per day |
| Bits minted less burned, per reward mint | 92.8 | 78 minted per night |
| Recipe suits crafted | 8, about 0.33 per player | 1.5 per hero (3 in 8 heroes craft all four) |
| `craft_bits` / `fee_bps` | 0 / 200 | 0 / 200 |

The supply identity is exact: supply = seeded till + minted − burned, so 20,332 more Bits have been minted than burned. The split between the two isn't readable from a view call. Gwei's till has gained 117 Bits since seeding, so little has been traded and the fee has burned little.

**In the model**, with the old settings (2% fee, free crafting, every night paid in full; mean of 8 seeds; 60 heroes who never quit):

| Horizon | Earned | Burned | Burned ÷ earned | Net new Bits per hero per day |
|---|---|---|---|---|
| 21 days | 97,324 | 2,801 | 2.9% | 74.5 |
| 60 days | 277,718 | 8,436 | 3.0% | 74.7 |
| 180 days | 836,139 | 19,575 | 2.3% | 76.8 |

About 97% of every Bit earned stayed in the supply. In the lab's default run (seed 2026, with Sandwich Man) the old settings read 99,022 earned (his 300-Bit seed included) and 2,847 burned.

## Method

- **The bots.** 60 heroes in the lab's mix: 3 in 8 craft, 2 dump their loot on Gwei, 2 flip, 1 hoards rares. Each patrols once a day. Every trade goes through `engine.ts`, the code tested against the contract's vectors. The taper reads each bot's own Bits, as the server reads a player's.
- **Runs.** 21, 60 and 180 days; 20, 60 and 200 heroes; two turnover cases (quit after 8 nights, close to mainnet's 9.1, and after 20); seeds 1 to 8, averaged.
- **Counted.** Bits minted by cause (and what the taper withheld), burned by cause, burned ÷ earned (whole run and last third), net new Bits per hero per day, Bits per hero, Gini, the till, the share of item-days Gwei ended sold out or unable to buy one, suits, the night of a crafter's first suit, and the price path by rarity.
- **Checked.** Every day of every run satisfies seeded till + minted − burned = supply, exactly.
- **Searched.** 126 market settings with the flat faucet: `craft_bits` 0 to 400, fee 2%, 5% and 10%, prices ×0.5, ×1 and ×2, curve depth ×1 and ×2.

### The band, and why it isn't "burn = earn"

A setting passes if, averaged over the seeds:

1. **25% to 100% of a 21-day season's Bits are burned.** Over 100% would shrink the supply and starve new heroes.
2. **A crafter's first suit comes by night 5.** With the old settings it's night 2.
3. **Over 60 days Gwei ends at most 10% of item-days sold out or unable to buy.**

Burning as much as is earned is not reachable with what the deployed contract has. Three reasons, all measured:

- **Crafting is a one-time sink.** Four suits per hero, ever. A hero who has them burns nothing more by crafting.
- **The fee is small against the faucet**, even at the 10% cap: 6,231 Bits a season against 58,893 earned with the taper.
- **A hero who never spends keeps what they earned.** The taper caps how fast such a hero gains, not what they hold: they climb to the taper's floor of 400 Bits and keep earning 5 a night from there. Net new Bits equal the change in what heroes and Gwei hold.

## The proposal

### Step 1: the faucet taper (server, live with the deploy)

`nightPay` in `rewards.ts`, with `NIGHT_TAPER = { fullBelow: 150, floorAt: 400 }`. A hero holding up to 150 Bits earns the whole night; above that the night shrinks in a straight line to the 5 for showing up at 400. The floor sits above a suit's 250-Bit price, so a crafter saving for a suit still gets there, and spending Bits brings the whole night back.

### Step 2: one owner transaction

| Parameter | Now | Proposed |
|---|---|---|
| craft_bits | "0" | "250" |
| fee_bps | 200 | 1000 |
| Pool virtual reserves | 480/40, 800/20, 1200/8 | Unchanged |
| Everything else | | Unchanged |

### Before and after

Mean of 8 seeds. "Taper only" is mainnet between the deploy and the owner's call; "Owner's settings" is the call without the taper; "Proposed" is both.

| Run | Setting | Earned | Burned | Fee | Craft | Burned ÷ earned | Net per hero per day | First suit | Sold out + broke (60 days) |
|---|---|---|---|---|---|---|---|---|---|
| 21 days, 60 heroes | Before | 97,324 | 2,801 | 2,801 | 0 | 2.9% | 74.5 | night 2 | 0.4% |
| | Taper only | 46,873 | 2,466 | 2,466 | 0 | 5.3% | 24.9 | night 2 | 2.2% |
| | Owner's settings | 97,806 | 31,763 | 8,763 | 23,000 | 32.5% | 54.2 | night 5 | 2.4% |
| | **Proposed** | 58,893 | 29,231 | 6,231 | 23,000 | **49.6%** | 15.9 | night 5 | 9.6% |
| 60 days, 60 heroes | Before | 277,718 | 8,436 | 8,436 | 0 | 3.0% | 74.7 | night 2 | |
| | **Proposed** | 105,445 | 38,090 | 15,090 | 23,000 | **36.1%** | 13.4 | night 5 | |
| 180 days, nobody quits | Before | 836,139 | 19,575 | 19,575 | 0 | 2.3% | 76.8 | night 2 | |
| | **Proposed** | 213,479 | 63,932 | 40,932 | 23,000 | **29.9%** | 11.1 | night 5 | |
| 180 days, quit after 8 nights | Before | 837,260 | 18,588 | 18,588 | 0 | 2.2% | 76.1 | night 2 | |
| | **Proposed** | 623,141 | 208,064 | 29,251 | 178,813 | **33.4%** | 37.5 | night 5 | |
| 180 days, quit after 20 nights | Before | 836,199 | 20,469 | 20,469 | 0 | 2.4% | 76.0 | night 1 | |
| | **Proposed** | 508,926 | 244,485 | 37,641 | 206,844 | **48.1%** | 22.9 | night 4.5 | |
| 21 days, 20 heroes | **Proposed** | 18,942 | 10,114 | 2,114 | 8,000 | 53.4% | 12.7 | night 5.5 | |
| 21 days, 200 heroes | **Proposed** | 200,027 | 95,622 | 20,654 | 74,969 | 47.8% | 18.8 | night 5 | |

It passes the band: 49.6% of a season's Bits burned, first suit by night 5, Gwei down 9.6% of item-days over 60 days. **In the lab's default run** (seed 2026, Sandwich Man trading) the counters read **59,230 earned and 29,202 burned** (49.3%), against 99,022 and 2,847 before: the gap between earned and burned falls from 96,175 Bits to 30,028.

Read the rows honestly:

- **About half, not parity.** Half of a season's Bits still stay in the supply.
- **The taper does most of the work on the faucet, the owner's call most of the work on the sink.** The taper alone cuts a season's minting by half but burns little (5.3%); the owner's settings alone burn a third of a much larger faucet (32.5%).
- **Earned rises when the owner's call lands** (46,873 → 58,893 a season), because crafters spend Bits and so stay under the taper. That is the intent: Bits that are spent get replaced, Bits that pile up don't.
- **Gwei is closer to her limit.** With fewer Bits around, she is unable to buy on 9.6% of item-days over 60 days instead of 0.4%, just inside the band. Over half a year with nobody quitting it is 41.9% instead of 29.7%.
- **The 180-day share falls** where nobody quits (29.9%): every crafter has all four suits within the first 21 days, so after that only the fee burns, against 5 Bits a night that each hero keeps earning.

**Why these.** The flat-faucet search ranks 16 of its 126 settings as passing. Among those that move no price, the most burning is 250 Bits a suit with a 10% fee (32.4% of a season, 4 seeds). 300 Bits a suit pushes the first suit to night 6 (Alternative B). The taper's marks were then chosen so the first suit stays at night 5 and Gwei inside 10%: a tighter taper leaves crafters short of a suit's price for longer.

**The cost of a 10% fee.** A round trip with Gwei costs about 20% instead of about 4%. On mainnet few players trade, so it takes few Bits from them; in the model it does most of its work on the dumpers and flippers.

### Two flat-faucet alternatives

Without the taper (the owner's call alone):

| | craft_bits | fee_bps | Season burn | Turnover (8 nights) burn | First suit | Band |
|---|---|---|---|---|---|---|
| **A, gentle** | 150 | 200 | 16.8% | 23.0% | night 4 | Fails the burn share |
| **B, steep** | 300 | 1000 | 36.8% | 24.6% | night 6 | Fails the first suit |

## What it does to today's players

- **Balances:** nothing. `set_market_params` leaves every balance, Gwei's stock and her till alone, and mints nothing because all eight pools exist.
- **Nights:** a player holding over 150 Bits earns less a night, and from 400 only the 5 for showing up, until they spend. Mainnet's players hold about 842 Bits each, so most of the regulars will see the results screen say "Tapered from …" until they craft or buy.
- **Prices:** nothing. The virtual reserves passed are the ones on chain.
- **Quotes:** the fee part goes from 2% to 10%. On mainnet's pools (15 Nov):

| Item | Price | Buy 1 now | After | Sell 1 now | After |
|---|---|---|---|---|---|
| Fee bomb, Crumbs, Chain link | 12.3 to 12.6 | 14 | 15 | 11 | 10 |
| Golden sesame seed | 34.65 | 37 | 40 | 32 | 29 |
| Sybil goo | 36.33 | 39 | 42 | 34 | 31 |
| Press pass | 52.26 | 56 | 60 | 49 | 45 |
| Goblin glider | 132.88 | 145 | 157 | 122 | 112 |
| Doc's spare arm | 170.73 | 187 | 202 | 156 | 144 |

- **Listings:** open ones stay. A seller receives the price less 10% instead of 2%.
- **Crafting:** Stealth, Glider, Octo rig and Sesame cost 250 Bits each on top of the recipe. Starter suits stay free. Suits already owned are untouched.
- **What players can afford:** about 842 Bits each, so three suits. All 24 crafting all four would burn 24,000 Bits against 20,215 held.

## The owner's command

**Send this only once the cost-aware Suit lab is live in production** (merged to `main` in PR #58; production is deployed by hand, so check the live build first: it is in the build when `/play/suits` shows a recipe's cost in a local run with `SIM_MARKET_CRAFT_BITS=250`). The production build before that crafts in the player's save first and neither shows nor checks `craft_bits`: with the cost on, a player holding under 250 Bits would see the suit in the game and a refused call on chain.

What the app does with the cost, read live from `market_state` (nothing is hard-coded, so no deploy is needed when the value changes):

- **Shows it.** Every recipe in the Suit lab prints "Costs 250 Bits" with the player's Bits beside it, and the Craft button carries the price.
- **Blocks what the contract would refuse.** Short of Bits, Craft is off and the reason is printed with what to do (sell spare loot, play a ranked night). The server checks again: the relayer refuses a `craft_suit` the wallet can't pay before spending gas, and the save-only craft answers the contract's own words, "Needs bits x130".
- **Never hands out a free suit.** The Bits can only be burned by the player's signed `craft_suit`. So with a cost set, a recipe suit can't be crafted "in the save only" any more: a player without quick play is told to turn it on, and a guest to sign in. Starter suits stay free everywhere. With `craft_bits` at 0 none of this shows and crafting works as it did.
- **Local play matches.** The simulated market burns the Bits in the same transaction that writes the save (`src/server/market/craft.ts`). `SIM_MARKET_CRAFT_BITS=250 SIM_MARKET_FEE_BPS=1000` runs a local server on the proposed settings (ignored in production).

**Who is affected on the day:** players who craft without quick play (wallet sign-ins who never pressed **Enable quick play**) and guests can no longer craft the four recipe suits until they turn it on or sign in. Suits they already own are untouched.

```bash
near contract call-function as-transaction game.wgpnear.near set_market_params json-args '{"params":{"open":true,"fee_bps":1000,"floor_bps":5000,"ceiling_bps":40000,"max_amount":20,"max_open_listings":3,"max_listings":300,"daily_trades":40,"daily_listings":10,"daily_fills":10,"daily_fill_bits":"3000","craft_bits":"250"},"pools":[{"item":"fee-bomb","virtual_bits":"480","virtual_items":"40","seed_bits":"480","seed_stock":"40"},{"item":"goblin-glider","virtual_bits":"1200","virtual_items":"8","seed_bits":"1200","seed_stock":"8"},{"item":"crumbs","virtual_bits":"480","virtual_items":"40","seed_bits":"480","seed_stock":"40"},{"item":"sesame-seed","virtual_bits":"800","virtual_items":"20","seed_bits":"800","seed_stock":"20"},{"item":"chain-link","virtual_bits":"480","virtual_items":"40","seed_bits":"480","seed_stock":"40"},{"item":"spare-arm","virtual_bits":"1200","virtual_items":"8","seed_bits":"1200","seed_stock":"8"},{"item":"sybil-goo","virtual_bits":"800","virtual_items":"20","seed_bits":"800","seed_stock":"20"},{"item":"press-pass","virtual_bits":"800","virtual_items":"20","seed_bits":"800","seed_stock":"20"}]}' prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
```

The JSON is what this prints, if you'd rather build it than paste it:

```bash
pnpm --filter wgp exec tsx ../../scripts/near/market-args.ts --proposed
```

- **Only two values change.** `fee_bps` and `craft_bits`; every other parameter is what `market_state` returns today.
- **The pools don't move.** Each existing pool's `virtual_bits` and `virtual_items` are the ones on chain, so prices stay where they are. `seed_bits` and `seed_stock` only apply to a pool that doesn't exist yet; all eight exist, so nothing is minted.
- **Cost:** 1 yoctoNEAR and the gas for one call that writes the market's settings. 100 Tgas is the ceiling prepaid, not what it uses. It adds no storage.
- **Reversible:** send it again with `"fee_bps":200` and `"craft_bits":"0"` (`market-args.ts` with no flags prints that). Settings go back at once. Bits burned in the meantime stay burned. The taper is server code and goes back only with a deploy.
- **Check it:** `market_state` (README command A) shows the new `params`, and `prices_milli` is unchanged.

## The Drain Gwei run

In `/lab/economy`, **Drain Gwei** runs 30 days of 60 heroes on the old settings with three hoarders buying rares for every dumper selling loot. Gwei sells out of rares and her tills for the rest run dry. For seeds 1 to 8 she ends 5.0% to 8.7% of item-days sold out and 29.2% to 34.6% unable to buy; with seed 2026 it is 18 and 70 of 240 in the lab, where Sandwich Man also trades. It's a stress mix, not a forecast, and the page says so.

## What was not fixed

- **Bits still inflate.** The proposal moves the burn from 3% to about half of the faucet in a season. It is not parity, and nothing the owner can set on the deployed contract gets there.
- **The model crafts four times as much as mainnet does.** Its heroes craft 1.5 suits each; mainnet's have crafted 0.33 each with crafting free. If that doesn't change, the real burn share will be well under the model's, and the taper will do more of the work by paying less.
- **Long-lived heroes run out of sink.** Four suits and they're done. A lasting sink needs more recipes, which `set_rules` can add on chain but which also need suits in the game, or a recurring cost the contract doesn't have.
- **Gwei runs closer to broke.** Fewer Bits in heroes' hands means fewer buyers for what dumpers sell her.
- **Items inflate too.** Loot arrives every night and only crafting removes it. In every 180-day run commons fall to about 8% of their starting price. Loot is part of the ranked sim, so it was left alone.
- **The taper reads one account.** A player could spread Bits over several accounts to stay under it; each account still needs its own verified nights, under the per-player cap of ranked nights a day.
- **A guest's imported save keeps its suits.** A guest can't craft a recipe suit while the cost is on (no Bits), but a first sign-in still imports the suits a local save claims, up to level 3, as it always has. Suits are cosmetic, and the import is capped (`src/game/import-caps.ts`), so this was left alone.
- **The bots are an assumption.** Their mix, one night a day, and a hoarder who never spends are choices, not observations. Mainnet has 24 players and a handful of trades, too few to fit behaviour to.
- **Vendor limits are read at each day's close.** A sell-out that refills the same day isn't counted.
- **Sandwich Man is measured separately.** The tables above run without him; the next section turns him on.

## With Sandwich Man

Sandwich Man is the NPC trader ([npc-trader.md](npc-trader.md)): one more account using the market calls players use, started with a one-off 300 Bits. `--npc` measures a season and 60 days with him trading among the 60 heroes (`balance.ts`, `npc: true`; mean of 8 seeds). His 300 Bits are minted once and are not counted in "earned".

| Run | Setting | Earned | Burned | Fee | Craft | Burned ÷ earned | Net per hero per day | First suit | Broke |
|---|---|---|---|---|---|---|---|---|---|
| 21 days, 60 heroes | Before | 97,324 | 2,801 | 2,801 | 0 | 2.9% | 74.5 | night 2 | 0.0% |
| | + Sandwich Man | 97,516 | 2,847 | 2,847 | 0 | 2.9% | 74.8 | night 2 | 0.0% |
| | **Proposed** | 58,893 | 29,231 | 6,231 | 23,000 | 49.6% | 15.9 | night 5 | 2.5% |
| | **+ Sandwich Man** | 59,346 | 29,370 | 6,370 | 23,000 | **49.3%** | 16.9 | night 5 | 2.2% |
| 60 days, 60 heroes | Before | 277,718 | 8,436 | 8,436 | 0 | 3.0% | 74.7 | night 2 | 0.4% |
| | + Sandwich Man | 278,121 | 8,691 | 8,691 | 0 | 3.1% | 74.7 | night 2 | 0.0% |
| | **Proposed** | 105,445 | 38,090 | 15,090 | 23,000 | 36.1% | 13.4 | night 5 | 9.6% |
| | **+ Sandwich Man** | 104,440 | 37,845 | 14,845 | 23,000 | 36.1% | 12.9 | night 5 | 10.5% |

**The difference is small for the burn.** One trader with 300 Bits among 60 heroes moves the season's burn share by under a point. Over 60 days with him, Gwei's unable-to-buy share on the proposal is 10.5%, just over the band's 10% (the band is judged without him, as every table above is). "Earned" differs by a few hundred Bits between paired rows only because his trades change what the bots do next.

## Claims that wait for the owner's call

These are written for mainnet after the owner sends the `set_market_params` above. Until then the chain check `market-state` in `docs/evidence.json` fails on `fee_bps` and `craft_bits`, which is how to tell:

- README: judge check 3's output (`"fee_bps":1000`), "a gas fee on each trade is burned (10% today)", "the contract's `fee_bps`, 10% today", "`craft_bits` on top (250 today)", `fee: ceil(bits · 1000 / 10000)`, "a 10% fee that's burned", "8 pools, 10% fee", the lab's "with mainnet's settings (10% gas fee, crafting burns 250 Bits, …)", and the Currency line's "on mainnet's settings" and "the trade fee (10%) and crafting, which burns 250 Bits a suit".
- This report's loop table (10%, 250), docs/GAME-LOOP.md, docs/ARCHITECTURE.md, docs/SUSTAINABILITY.md and docs/INVESTING.md where they give the fee as 10% or the crafting cost as 250.

The taper needs no owner call: it is live wherever the build that carries it is deployed.
