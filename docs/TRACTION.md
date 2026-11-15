# Traction, day by day

What players did on NEAR mainnet, by UTC day, from the first player call to tonight. The totals in the README's [By the numbers](../README.md#by-the-numbers) hide the shape: who came back, on which days, doing what. This page shows it, including the parts that don't flatter the game.

**Read it as a small, incentivised playtest.** Season 1 (Nov 5–14) offered players daily airdrops, sent by hand through Uprail, outside the game. Seventeen accounts other than the author's sent a player call; that is not evidence of organic demand.

## Re-run it

```sh
pnpm install --frozen-lockfile
pnpm traction          # Markdown tables, as below
pnpm traction --json   # the same report as one JSON object
```

`scripts/traction.mjs` reads every receipt `game.wgpnear.near` has received from the public NearBlocks API (the same pages `pnpm stats` reads) and a snapshot of `GET https://www.wgponnear.fun/api/stats`. It is read-only, needs no keys and takes from 20 seconds to a few minutes, depending on NearBlocks' rate limits. Its bucketing, retention and concentration maths are pure functions, tested on fixtures in [`apps/wgp/src/evidence/traction.test.ts`](../apps/wgp/src/evidence/traction.test.ts).

**Who counts.** A *player call* is one of the player methods (`register_hero`, `craft_suit`, `equip_suit`, `market_buy`, `market_sell`, `list_item`, `buy_listing`, `cancel_listing`) sent by an account that is not the team's. Left out: the contract itself, `wgpnear.near` (setup), `operator.wgpnear.near`, `relayer.wgpnear.near`, Sandwich Man (`sandwich.wgpnear.near`, the NPC trader) and the author's own accounts, `sele.wgpnear.near` and `sele71.near`. (`pnpm stats` counts `sele.wgpnear.near` as a player and names it; this report drops it, so every number here is other people's.) An account is *active* on a day when it sent at least one player call that UTC day, and *new* on the day of its first.

**Reward mints** are a second, separate signal: each entry of an operator `mint_rewards` batch is loot, Bits or badges for play the server verified, sent to that player's account. A mint needs no call from the player and no relayer, so mints kept landing when relayed calls could not. More accounts were rewarded (23) than sent a player call (17): an account can be rewarded for verified nights without ever sending a call itself (the author's `sele71.near` is one, and is left out).

## Tonight's numbers (Nov 14, 2026, 21:34 UTC)

The output of `pnpm traction` as it ran tonight, pasted unedited. The counts only grow; re-run it for the current ones.

Traction report for `game.wgpnear.near`, generated 2026-11-14T21:34:45Z (UTC). Player calls only: the team's accounts, the author's (sele.wgpnear.near, sele71.near) and Sandwich Man (sandwich.wgpnear.near) are left out.

### Per UTC day

| Day | Active accounts | New accounts | Calls | `register` | `craft` | `equip` | `m_buy` | `m_sell` | `list` | `buy_list` | `cancel` | Reward mints (accounts) | Context |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| 2026-11-06 | 4 | 4 | 23 | 5 | 13 | 2 | 1 | 0 | 2 | 0 | 0 | 33 (4) | airdrops |
| 2026-11-07 | 5 | 4 | 7 | 4 | 0 | 2 | 0 | 0 | 1 | 0 | 0 | 39 (10) | airdrops |
| 2026-11-08 | 7 | 5 | 11 | 5 | 1 | 1 | 0 | 1 | 0 | 3 | 0 | 32 (10) | airdrops |
| 2026-11-09 | 4 | 2 | 4 | 2 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 23 (6) | airdrops |
| 2026-11-10 | 3 | 1 | 5 | 1 | 1 | 2 | 0 | 0 | 0 | 1 | 0 | 21 (6) | airdrops |
| 2026-11-11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 (3) | airdrops |
| 2026-11-12 | 4 | 1 | 17 | 1 | 0 | 0 | 8 | 4 | 3 | 0 | 1 | 14 (4) | airdrops |
| 2026-11-13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 (4) | airdrops, outage |
| 2026-11-14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 24 (7) | airdrops, outage |
| **All days** | **17** distinct | | **67** | **18** | **16** | **7** | **9** | **5** | **7** | **4** | **1** | **196** (**23**) | |

Columns: `register` = `register_hero`, `craft` = `craft_suit`, `equip` = `equip_suit`, `m_buy` = `market_buy`, `m_sell` = `market_sell`, `list` = `list_item`, `buy_list` = `buy_listing`, `cancel` = `cancel_listing`. 0 of the 67 calls failed on chain and are still counted (the account still sent them). "Reward mints (accounts)" are the `mint_rewards` entries the operator sent that day to players' accounts (not the author's or the NPC's), and how many accounts they went to: verified play, which needs no relayed call. 1 mint before the first player call is not in the table.

### Retention and concentration

| | |
|---|---|
| Player accounts (author's and NPC excluded) | 17 |
| Active on 2 or more distinct UTC days | 4 |
| Active on 3 or more distinct UTC days | 3 |
| Median active days per account | 1 |
| Accounts by active days | 1 day: 13 · 2 days: 1 · 3 days: 2 · 6 days: 1 |
| Accounts the game rewarded (verified play), and on 2+ / 3+ distinct days | 23, 9 / 5 (median 1 day) |
| Share of player calls from the busiest account | 33% (22 of 67) |
| Share of player calls from the busiest 3 accounts | 75% (50 of 67) |
| Left out: the author's calls / Sandwich Man's / the team's | 2 / 1 / 0 |

### Context windows (UTC)

- **airdrops**, 2026-11-05 00:00 → 2026-11-15 00:00: Season 1 (Nov 5–14): players were offered daily airdrops, sent by hand through Uprail, outside the game.
- **outage**, 2026-11-13 07:00 → 2026-11-14 20:21: relayer outage: the relayer sat under its 1 NEAR cut-off, so relayed player actions were refused.

### The game's own database (`/api/stats`, not on chain)

| | |
|---|---|
| As of | 2026-11-14T21:34:14.635Z |
| Signed up / started a match / have a verified match | 29 / 26 / 24 |
| Verified runs | 272 |
| Verified runs by mode | patrol 160 · daily 71 · trial 15 · duel 0 · case-001 10 · case-002 7 · case-003 9 |
| City outings (players who went out) | 313 (18) |
| Referrals: invited / count | 9 / 5 |

## Two windows that shape these numbers

- **Season 1's airdrops (Nov 5–14).** Every day in the table falls inside it. Players were offered daily airdrops, sent by hand through Uprail, outside the game; the game itself never pays and its copy promises no money. Some of the coming back may be people coming back for an airdrop; this report can't tell which.
- **The relayer outage (Nov 13, 07:00 → Nov 14, 20:21 UTC).** The relayer, which pays players' gas, sat under its 1 NEAR cut-off, so the server refused relayed player actions (registering, crafting, equipping, trading) for about 37 hours. Verified play was still rewarded: those mints come from the operator, not the relayer. The outage explains the empty player-call columns on Nov 13 and 14. It does not explain the quiet before it: there were no player calls on Nov 11, and none between midnight and 07:00 on Nov 13. The market has had no player call since Nov 12.

## What the numbers show, and what they don't

They show:

- **On-chain activity anyone can recount.** Every player call and mint above is a receipt on NEAR mainnet; `pnpm traction` recounts them from a public API.
- **Who came back.** 13 of the 17 accounts were active on one day only, and 12 made a single call. Four came back on a later day, three of them on a third; those four made 53 of the 67 player calls.
- **How concentrated it is.** The busiest account alone made a third of all player calls (22 of 67), and the busiest three made three quarters (50 of 67). Three accounts made all 26 of the players' market calls.

They don't show:

- **People.** An account is not a person. One person can hold several accounts, and nothing here proves otherwise.
- **Demand without incentives.** All of it happened while airdrops were on offer.
- **Play that never touches the chain.** Guest nights, the practice market and signed-in nights that earned no mint are only in the game's database (the `/api/stats` snapshot), which can be re-read but not checked independently.
- **A clean read of Nov 13 and 14.** The outage blocked the actions this report counts as player calls; the mints on those days are the only on-chain sign of play then.
- **The time of play exactly.** A mint lands shortly after its night is verified, so a night played just before midnight can be counted on the next day.

## What Season 2 would need to show

Plans, not promises, and no rewards are offered for any of it.

- **Retention without airdrops.** The share of new accounts that are active again on a later day, with no off-game rewards on offer. That is the number Season 1 can't give.
- **Breadth.** More accounts active on three or more days, and the busiest three accounts' share of calls falling well under three quarters.
- **A market players use.** Player market calls on most days, from more than the three accounts that made all of Season 1's.
- **No outage.** A relayer that stays above its cut-off for the whole season, so an empty day means nobody played rather than nobody could.
- **The same report.** `pnpm traction`, unchanged, run over Season 2, so the two seasons compare like for like.
