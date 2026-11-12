# The Bits economy: what inflates, what was measured, what to change

This is the balance report for the Mempool Market. It says where Bits come from and go, shows the measured problem, recommends one setting the owner can apply without a code upgrade, and is plain about what that setting does not fix.

Every number below comes from one script, and the same seeds always give the same numbers:

```bash
pnpm --filter wgp exec tsx scripts/economy-balance.ts --search --drain --npc
```

- **Code:** `apps/wgp/src/lib/market/balance.ts` (the measurements and the settings), `bots.ts` (the bot heroes), `scripts/economy-balance.ts` (the tables).
- **Output:** `docs/economy/balance.json`.
- **Tests:** `balance.test.ts` checks the accounting to the Bit and that the recommendation meets its band.
- **In the game:** the Suit lab reads `craft_bits` live and shows, checks and (in the simulated market) burns it; every fee the market prints reads `fee_bps`. See "The owner's command".
- **See it:** `/lab/economy` runs mainnet's settings by default. **Recommended settings** switches to the setting below, and the chart under the counters draws Bits earned against Bits burned.

**Nothing here has been applied.** Mainnet still has `craft_bits: "0"` and `fee_bps: 200`.

## The loop

| | What | Where it's set |
|---|---|---|
| **Source of Bits** | A verified night mints `floor(score / 100) + 5`, +25 on a level-up, +1 per Bits token collected (up to 25), at most 1,000 | Server: `src/lib/market/rewards.ts`, called by `runs.ts` |
| **Source of items** | Loot from the verified night | The ranked sim (ruleset 4); not changed here |
| **Sink: gas fee** | `fee_bps` of every trade's and fill's Bits is burned (2% today, 10% at most) | Contract state: `set_market_params` |
| **Sink: crafting** | `craft_suit` burns the recipe's items and `craft_bits` Bits (0 today). A hero can craft each of the four recipe suits **once** | Contract state: `set_market_params` |
| **Not a source or a sink** | Gwei Stacy. She sells only her stock and pays only from her till, so trading with her moves Bits around and creates none | Contract: `market.rs` |
| **Prices** | Per item, `(virtual_bits + till) / (virtual_items + stock)`. Buying raises it, selling lowers it | Contract state: the pools |

The Bits rule is server code outside the ranked sim. Changing it changes no score, replay, golden or `RULESET_VERSION`; the verifier never reads it.

## The measured problem

**On mainnet** (read-only RPC and `/api/stats`, 12 Nov 2026):

| | Mainnet | The model's assumption |
|---|---|---|
| Bits supply | 21,379 | |
| In Gwei's till | 7,067 (6,240 seeded) | |
| Held by players | 14,312, about 622 each | |
| Players with a verified night | 23 | 60 heroes |
| Reward mints sent | 170, about 7.4 per player | One night per hero per day |
| Bits minted less burned, per reward mint | 89.1 | 78 minted per night |
| Recipe suits crafted | 8, about 0.35 per player | 1.5 per hero (3 in 8 heroes craft all four) |
| `craft_bits` / `fee_bps` | 0 / 200 | 0 / 200 |

The supply identity is exact: supply = seeded till + minted − burned, so 15,139 more Bits have been minted than burned. The split between the two isn't readable from a view call. Gwei's till has gained only 827 Bits since seeding, so little has been traded and the fee has burned little.

**In the model**, with mainnet's settings (mean of 8 seeds; 60 heroes who never quit):

| Horizon | Earned | Burned | Burned ÷ earned | Net new Bits per hero per day |
|---|---|---|---|---|
| 21 days | 97,324 | 2,801 | 2.9% | 74.5 |
| 60 days | 277,718 | 8,436 | 3.0% | 74.7 |
| 180 days | 836,139 | 19,575 | 2.3% | 76.8 |

About 97% of every Bit earned stays in the supply.

**The lab overstated the sink.** The old default (seed 2026) showed 98,255 earned and 10,021 burned, with a 25-Bit crafting burn that mainnet doesn't have and bots that crafted 295 suits. The contract refuses a second copy of a suit ("You already own this suit"), so 60 heroes with 23 crafters can craft at most 92. With mainnet's real settings and the one-suit rule, the same seed gives 97,680 earned and 2,788 burned. The lab now runs those settings; it also runs Sandwich Man (below), so its counters for seed 2026 read 99,022 earned (his 300-Bit seed included) and 2,847 burned.

## Method

- **The bots.** 60 heroes in the lab's mix: 3 in 8 craft, 2 dump their loot on Gwei, 2 flip, 1 hoards rares. Each patrols once a day. Every trade goes through `engine.ts`, the code tested against the contract's vectors.
- **New, and off unless asked for:** the one-suit rule, heroes who quit after N nights and are replaced, a different mix, different curves, and a different Bits rule.
- **Runs.** 21, 60 and 180 days; 20, 60 and 200 heroes; two turnover cases (quit after 8 nights, close to mainnet's 7.4, and after 20); seeds 1 to 8, averaged.
- **Counted.** Bits minted by cause, burned by cause, burned ÷ earned (whole run and last third), net new Bits per hero per day, Bits per hero, Gini, the till, the share of item-days Gwei ended sold out or unable to buy one, suits, the night of a crafter's first suit, and the price path by rarity.
- **Checked.** Every day of every run satisfies seeded till + minted − burned = supply, exactly.
- **Searched.** 126 settings: `craft_bits` 0 to 400, fee 2%, 5% and 10%, prices ×0.5, ×1 and ×2, curve depth ×1 and ×2.

### The band, and why it isn't "burn = earn"

A setting passes if, averaged over the seeds:

1. **25% to 100% of a 21-day season's Bits are burned.** Crafting heroes earn 37.5% of the Bits; 25% is two-thirds of that and about nine times today's share. Over 100% would shrink the supply and starve new heroes.
2. **A crafter's first suit comes by night 5.** Today it's night 2.
3. **Over 60 days Gwei ends at most 10% of item-days sold out or unable to buy.**

Burning as much as is earned is not reachable with what the contract has, for any setting the owner can pass. Two reasons, both measured:

- **Crafting is a one-time sink.** Four suits per hero, ever. A hero who has them burns nothing more by crafting.
- **The fee is small against the faucet.** At today's 2% it burns about 2 Bits per hero per day in the model, and at the 10% cap about 7 (Alternative B), against about 78 earned.

There is also an accounting reason. Net new Bits equal the change in what heroes and Gwei hold. Any hero who earns and never spends makes the supply grow by exactly what they keep. Most mainnet players are that hero today.

## The recommendation

### Step 1: one owner transaction

| Parameter | Now | Recommended |
|---|---|---|
| `craft_bits` | `"0"` | `"250"` |
| `fee_bps` | `200` | `500` |
| Pool virtual reserves | 480/40, 800/20, 1200/8 | Unchanged |
| Everything else | | Unchanged |

Before and after (mean of 8 seeds):

| Run | Setting | Earned | Burned | Fee | Craft | Burned ÷ earned | Net per hero per day | First suit | Sold out + broke |
|---|---|---|---|---|---|---|---|---|---|
| 21 days, 60 heroes | Mainnet today | 97,324 | 2,801 | 2,801 | 0 | 2.9% | 74.5 | night 2 | 0.0% |
| | **Recommended** | 97,618 | 28,063 | 5,063 | 23,000 | **28.8%** | 57.3 | night 5 | 0.1% |
| 60 days, 60 heroes | Mainnet today | 277,718 | 8,436 | 8,436 | 0 | 3.0% | 74.7 | night 2 | 0.4% |
| | **Recommended** | 278,581 | 36,703 | 13,703 | 23,000 | 13.2% | 73.8 | night 5 | 2.5% |
| 180 days, nobody quits | Mainnet today | 836,139 | 19,575 | 19,575 | 0 | 2.3% | 76.8 | night 2 | 29.7% |
| | **Recommended** | 838,174 | 57,745 | 34,745 | 23,000 | 6.9% | 75.6 | night 5 | 30.6% |
| 180 days, quit after 8 nights | Mainnet today | 837,260 | 18,588 | 18,588 | 0 | 2.2% | 76.1 | night 2 | 13.1% |
| | **Recommended** | 838,051 | 206,051 | 20,551 | 185,500 | **24.6%** | 58.2 | night 5 | 8.7% |
| 180 days, quit after 20 nights | Mainnet today | 836,199 | 20,469 | 20,469 | 0 | 2.4% | 76.0 | night 1 | 23.6% |
| | **Recommended** | 837,494 | 240,294 | 32,919 | 207,375 | **28.7%** | 55.9 | night 5 | 23.8% |
| 21 days, 20 heroes | **Recommended** | 32,752 | 9,657 | 1,657 | 8,000 | 29.5% | 58.2 | night 5 | 0.0% |
| 21 days, 200 heroes | **Recommended** | 325,578 | 90,999 | 15,999 | 75,000 | 28.0% | 59.2 | night 5 | 0.0% |

It passes the band: 28.8% of a season's Bits burned, first suit by night 5, Gwei down 2.5% of item-days over 60 days. The result holds from 20 to 200 heroes.

Read the 180-day rows honestly. Where heroes come and go, the burn holds at a quarter of the faucet for as long as new heroes arrive. Where the same 60 heroes play for half a year, every crafter has all four suits within the first 21 days, so the crafting sink is spent and the share falls back to 7%.

**Why this one.** 16 of the 126 settings pass the band, and the search ranks them by burn share. This one is 13th. The rows above it use the 10% fee cap, halved prices or both, for up to four points more over a season. I chose the best passing setting that moves no price and keeps the fee at 5%:

- Halving the curves would halve what every player's items sell for on the day it lands.
- A 10% fee costs 20% on a round trip, which is harsh for the few players who trade.
- 250 Bits is about three nights of earning. 300 pushes the first suit to night 6.
- Raising prices or deepening the curves didn't raise the burn and hurt Gwei. At the same craft cost and fee, doubling prices left her sold out or unable to buy on 49% of item-days over 60 days, and doubling the depth on 21.5%.

### Step 2: a faucet taper (server change, needs a deploy)

`taperedNightBits` in `rewards.ts`: a hero holding up to 250 Bits earns the whole night; above that the night's Bits shrink in a straight line to the 5 for showing up at 500 and beyond. It stops paying wallets that only pile up.

| Run | Setting | Earned | Burned ÷ earned | Net per hero per day | Bits per hero |
|---|---|---|---|---|---|
| 21 days | Recommended | 97,618 | 28.8% | 57.3 | 1,204 |
| | + taper | 63,750 | **42.3%** | 23.0 | 675 |
| 180 days, nobody quits | Recommended | 838,174 | 6.9% | 75.6 | 13,093 |
| | + taper | 224,487 | 22.4% | **12.0** | 2,989 |
| 180 days, quit after 20 nights | Recommended | 837,494 | 28.7% | 55.9 | 519 |
| | + taper | 561,551 | 41.6% | 28.9 | 340 |

Over half a year with no turnover it cuts net new Bits per hero per day from 75.6 to 12.0, and Gwei is unable to buy on 37% of item-days instead of 31%.

**It is written and tested but not wired in.** `runs.ts` still calls `nightBits`. Wiring it needs the player's Bits balance at submit time, which is a change to the ranked submit path I did not make two days before the deadline.

### Two alternatives

| | `craft_bits` | `fee_bps` | Season burn | Turnover (8 nights) burn | First suit | Band |
|---|---|---|---|---|---|---|
| **A, gentle** | 150 | 200 | 16.8% | 23.0% | night 4 | Fails the burn share |
| **B, steep** | 300 | 1000 | 36.8% | 24.6% | night 6 | Fails the first suit |

A changes no quote and is the smallest step. B burns the most a season, and trades it for a slower first suit and the fee cap.

## What it does to today's players

- **Balances:** nothing. `set_market_params` leaves every balance, Gwei's stock and her till alone, and mints nothing because all eight pools exist.
- **Prices:** nothing. The virtual reserves passed are the ones on chain.
- **Quotes:** the fee part goes from 2% to 5%. On today's pools:

| Item | Price | Buy 1 now | After | Sell 1 now | After |
|---|---|---|---|---|---|
| Fee bomb, Crumbs, Chain link | 12.3 to 12.6 | 14 | 14 | 11 | 11 |
| Sybil goo | 40.02 | 43 | 45 | 38 | 37 |
| Golden sesame seed | 42.10 | 45 | 47 | 40 | 38 |
| Press pass | 52.26 | 56 | 57 | 49 | 47 |
| Goblin glider | 170.67 | 187 | 193 | 156 | 152 |
| Doc's spare arm | 195.93 | 216 | 222 | 178 | 172 |

- **Listings:** open ones stay. A seller receives the price less 5% instead of 2%.
- **Crafting:** Stealth, Glider, Octo rig and Sesame cost 250 Bits each on top of the recipe. Starter suits stay free. Suits already owned are untouched.
- **What players can afford:** they hold about 622 Bits each, so two suits. All 23 crafting all four would burn 23,000 Bits against 14,312 held.

## The owner's command

**Send this only once the cost-aware Suit lab is live in production** (branch `feat/economy-in-loop`; it is in the build when `/play/suits` shows a recipe's cost in a local run with `SIM_MARKET_CRAFT_BITS=250`). The production build before that crafts in the player's save first and neither shows nor checks `craft_bits`: with the cost on, a player holding under 250 Bits would see the suit in the game and a refused call on chain.

What the app does with the cost, read live from `market_state` (nothing is hard-coded, so no deploy is needed when the value changes):

- **Shows it.** Every recipe in the Suit lab prints "Costs 250 Bits" with the player's Bits beside it, and the Craft button carries the price.
- **Blocks what the contract would refuse.** Short of Bits, Craft is off and the reason is printed with what to do (sell spare loot, play a ranked night). The server checks again: the relayer refuses a `craft_suit` the wallet can't pay before spending gas, and the save-only craft answers the contract's own words, "Needs bits x130".
- **Never hands out a free suit.** The Bits can only be burned by the player's signed `craft_suit`. So with a cost set, a recipe suit can't be crafted "in the save only" any more: a player without quick play is told to turn it on, and a guest to sign in. Starter suits stay free everywhere. With `craft_bits` at 0 none of this shows and crafting works exactly as it does today.
- **Local play matches.** The simulated market burns the Bits in the same transaction that writes the save (`src/server/market/craft.ts`). `SIM_MARKET_CRAFT_BITS=250 SIM_MARKET_FEE_BPS=500` runs a local server on the recommended settings (ignored in production).

**Who is affected on the day:** players who craft without quick play (wallet sign-ins who never pressed **Enable quick play**) and guests can no longer craft the four recipe suits until they turn it on or sign in. Suits they already own are untouched.

```bash
near contract call-function as-transaction game.wgpnear.near set_market_params json-args '{"params":{"open":true,"fee_bps":500,"floor_bps":5000,"ceiling_bps":40000,"max_amount":20,"max_open_listings":3,"max_listings":300,"daily_trades":40,"daily_listings":10,"daily_fills":10,"daily_fill_bits":"3000","craft_bits":"250"},"pools":[{"item":"fee-bomb","virtual_bits":"480","virtual_items":"40","seed_bits":"480","seed_stock":"40"},{"item":"goblin-glider","virtual_bits":"1200","virtual_items":"8","seed_bits":"1200","seed_stock":"8"},{"item":"crumbs","virtual_bits":"480","virtual_items":"40","seed_bits":"480","seed_stock":"40"},{"item":"sesame-seed","virtual_bits":"800","virtual_items":"20","seed_bits":"800","seed_stock":"20"},{"item":"chain-link","virtual_bits":"480","virtual_items":"40","seed_bits":"480","seed_stock":"40"},{"item":"spare-arm","virtual_bits":"1200","virtual_items":"8","seed_bits":"1200","seed_stock":"8"},{"item":"sybil-goo","virtual_bits":"800","virtual_items":"20","seed_bits":"800","seed_stock":"20"},{"item":"press-pass","virtual_bits":"800","virtual_items":"20","seed_bits":"800","seed_stock":"20"}]}' prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
```

The JSON is what this prints, if you'd rather build it than paste it:

```bash
pnpm --filter wgp exec tsx ../../scripts/near/market-args.ts --craft-bits 250 --fee-bps 500
```

- **The seeds are ignored.** `seed_bits` and `seed_stock` only apply to a pool that doesn't exist yet. All eight exist, so nothing is minted.
- **Fee only, today:** the same command with `"craft_bits":"0"` is safe to send now. It changes quotes as in the table above and burns little by itself.
- **Cost:** 1 yoctoNEAR and the gas for one call that writes the market's settings. 100 Tgas is the ceiling prepaid, not what it uses. It adds no storage.
- **Reversible:** send it again with `"fee_bps":200` and `"craft_bits":"0"` (`market-args.ts` with no flags prints that). Settings go back at once. Bits burned in the meantime stay burned.
- **Check it:** `market_state` (README command A) shows the new `params`, and `prices_milli` is unchanged.

## The Drain Gwei run

In `/lab/economy`, **Drain Gwei** runs 30 days of 60 heroes on mainnet's settings with three hoarders buying rares for every dumper selling loot. Gwei sells out of rares and her tills for the rest run dry. For seeds 1 to 8 she ends 5.0% to 8.7% of item-days sold out and 29.2% to 34.6% unable to buy; with seed 2026 it is 18 and 71 of 240 (18 and 70 in the lab, where Sandwich Man also trades). It's a stress mix, not a forecast, and the page says so.

## What was not fixed

- **Bits still inflate.** The recommendation moves the burn from 3% to about 29% of the faucet in a season. With the taper it is about 42%. Neither is parity.
- **The model crafts four times as much as mainnet does.** Its heroes craft 1.5 suits each; mainnet's have crafted 0.35 each with crafting free. If that doesn't change, the real burn share will be well under the model's.
- **Long-lived heroes run out of sink.** Four suits and they're done. A lasting sink needs more recipes, which `set_rules` can add on chain but which also need suits in the game, or a recurring cost the contract doesn't have.
- **Items inflate too.** Loot arrives every night and only crafting removes it. In every 180-day run commons fall to about 8% of their starting price and Gwei is unable to buy on about 30% of item-days. Loot is part of the ranked sim, so it was left alone.
- **The taper isn't live.** It stays a proposal: `runs.ts` still calls `nightBits`.
- **A guest's imported save keeps its suits.** A guest can't craft a recipe suit while the cost is on (no Bits), but a first sign-in still imports the suits a local save claims, up to level 3, as it always has. Suits are cosmetic, and the import is capped (`src/game/import-caps.ts`), so this was left alone.
- **The bots are an assumption.** Their mix, one night a day, and a hoarder who never spends are choices, not observations. Mainnet has 23 players and a handful of trades, too few to fit behaviour to.
- **Vendor limits are read at each day's close.** A sell-out that refills the same day isn't counted.
- **Sandwich Man is measured separately.** Every table above runs without him, because he is off on mainnet until his account is funded. The next section turns him on.

## With Sandwich Man

Sandwich Man is the NPC trader ([npc-trader.md](npc-trader.md)): one more account using the market calls players use, started with a one-off 300 Bits. `--npc` measures a season and 60 days with him trading among the 60 heroes (`balance.ts`, `npc: true`; mean of 8 seeds). His 300 Bits are minted once and are not counted in "earned".

| Run | Setting | Earned | Burned | Fee | Craft | Burned ÷ earned | Net per hero per day | First suit | Sold out + broke |
|---|---|---|---|---|---|---|---|---|---|
| 21 days, 60 heroes | Mainnet today | 97,324 | 2,801 | 2,801 | 0 | 2.9% | 74.5 | night 2 | 0.0% |
| | + Sandwich Man | 97,516 | 2,847 | 2,847 | 0 | 2.9% | 74.8 | night 2 | 0.0% |
| | **Recommended** | 97,618 | 28,063 | 5,063 | 23,000 | 28.8% | 57.3 | night 5 | 0.1% |
| | **+ Sandwich Man** | 97,524 | 28,049 | 5,049 | 23,000 | **28.7%** | 59.3 | night 5 | 0.1% |
| 60 days, 60 heroes | Mainnet today | 277,718 | 8,436 | 8,436 | 0 | 3.0% | 74.7 | night 2 | 0.4% |
| | + Sandwich Man | 278,121 | 8,691 | 8,691 | 0 | 3.1% | 74.7 | night 2 | 0.0% |
| | **Recommended** | 278,581 | 36,703 | 13,703 | 23,000 | 13.2% | 73.8 | night 5 | 2.5% |
| | **+ Sandwich Man** | 278,467 | 36,815 | 13,815 | 23,000 | 13.2% | 73.6 | night 5 | 2.3% |

**The difference is small.** One trader with 300 Bits among 60 heroes who earn about 97,000 a season moves the burn share by a tenth of a point at most, and the recommendation still passes the band with him (28.7%, night 5, 2.3%). He doesn't craft, so he adds nothing to the crafting sink; his trades add a little fee burn on mainnet's settings (46 Bits a season) and none to speak of at 5%. Over 60 days Gwei is a little less often unable to buy with him around (0.0% against 0.4% on mainnet's settings), because he buys what dumpers sell her and lists it. "Earned" differs by a few hundred Bits between the paired rows only because his trades change what the bots do next, and so which nights they roll.
