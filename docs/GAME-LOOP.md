# The game loop

What a player does every few seconds, every minute or two and every session, and where the economy sits in each. This is the loop the game ships with, written up on Nov 12 from the live build: it documents the loop as built and does not predate the code. The order things were written in, from `git log`: a 2D real-time prototype of the night was committed first, on Nov 1 (commit `699457d`). The plan for the 3D game, [ARCHITECTURE.md](ARCHITECTURE.md), was committed on Nov 2 (commit `94c8d19`), three minutes before the first 3D simulation code (commit `143b12e`). So the 3D game was planned on paper before its code, and the first playable loop was not. Each claim here has a row in [EVIDENCE.md](EVIDENCE.md#the-game-loop-docsgame-loopmd).

The rule behind it: **the chain is never a step in the loop.** A player's hands are on the stick, not on a wallet. Everything that reaches NEAR happens as a consequence of play, in the background.

## Every few seconds: move and decide

| The player | The game answers |
|---|---|
| Shoots a web, holds it to swing, lets go to fly | Speed, a combo that grows with clean releases, gold Bits tokens and boost rings along the route |
| Lands, runs, climbs a wall or wall-runs | A new line to the next stop; the minimap and waypoint say where it is |
| In a fight: sidesteps a telegraphed attack, punches, zips in, fires one of 3 chosen powers | Hits landed, damage avoided, the villain's next move telegraphed |

Each decision is small and readable: swing now or keep running, take the Bits line or the fast line, dodge or punch. Nothing in this loop touches the chain.

**Where to see it:** `/play/patrol` (a ranked or guest night), `/play/city` (free roam). Rules: `packages/game-core/src/sim3d/`.

## Every minute or two: finish a night and bank it

A night is four stops, two villain fights and two errands for neighbours, and takes one to two minutes. That is measured: the three recorded nights in `packages/game-core/test/golden` that clear all four stops replay in 63, 67 and 81 seconds of game time (a test derives this), and on the live site verified play time divided by verified runs, all modes together, is about a minute and a half (`pnpm evidence --chain` checks it stays between 45 seconds and 3 minutes).

1. **Finish.** The night ends on a results card with the score, each stop's result and the loot.
2. **Verify.** Signed in, the browser uploads the night's input log (usually 1–5 KB). The server replays it through the same deterministic simulation and ranks the score it computes itself, never the browser's.
3. **Earn.** The verified night queues one reward: loot from the villains caught, plus Bits (`floor(score / 100) + 5`, +25 on a level-up, +1 per gold token up to 25, capped at 1,000 a night). The operator account mints it to the player's NEAR account as NEP-245 tokens. The player signs nothing and sees no prompt.
4. **Choose what's next.** Another ranked night, today's Daily Run (same city for everyone, 3 tries), a time trial, a duel against another player's ghost, a case file, or the City.

**Where to see it:** the results card says **Verified · Ranked** and **Score, from the server**. Rules: `apps/wgp/src/server/db/runs.ts`, `apps/wgp/src/lib/market/rewards.ts`.

## Every session: spend, trade, climb

A session is a few nights plus a visit to the market and the boards.

| The player | The economy |
|---|---|
| Opens the Mempool Market and reads Gwei Stacy's prices | Each item's price sits on its own curve in the contract. It rose if players bought it and fell if they sold it. Gwei says why in her own words. |
| Sells spare loot to Gwei, or lists it for other players | Selling pays from her till and lowers her price; a listing escrows the items in the contract at the seller's price (within 50–400% of hers) |
| Sees **Other traders** on the market: Sandwich Man, labelled NPC | He is a rule-based trader, not a player and not an AI agent, with his own NEAR account (`sandwich.wgpnear.near`, on mainnet since Nov 13, 2026). He may buy a cheap listing (the seller gets their asking price), buy a dip from Gwei or list under her price. Each move shows his reason and links to its transaction ([npc-trader.md](npc-trader.md)). |
| Buys the missing part for a suit | Buying raises her price; 2% of every trade's Bits is burned |
| Crafts a suit and equips it | The recipe's items are burned; the suit is a token the player owns |
| Checks Tonight, Season and All-time boards, the Daily board and trial medals | Every score on them is a replayed run; at the Season's close the final board is written to the contract once, and the top 10 get soulbound trophies (built and tested; Season 1 closes Nov 14, 23:59 UTC, and after that the record is `get_season("s1")`) |
| Invites friends, clears a case file, finishes City tasks | Soulbound badges (`trophy:badge:*`) for the first clear and for three friends who play; XP for City tasks |

Trades are calls from the player's own account, signed by a game-only session key and sent by our relayer as NEP-366 meta-transactions. The key can only call the game contract and can't attach a deposit, so it can't transfer a token out of the account; the relayer pays the gas. It can make these same trades, so the contract caps them (listing prices, items a call, trades and fills a day): the README's NEAR table says exactly what a stolen key could and couldn't do. From the player's side it's a Buy button.

**Where to see it:** `/play/market`, `/play/suits`, `/play/leaderboard`, `/play/compete`. Rules: `contracts/wgp/src/market.rs`, mirrored in `apps/wgp/src/lib/market/math.ts`.

### A guest's session: the practice market

A guest has no account, so nothing they do reaches NEAR. They still get the market. Signed out, `/play/market` opens a **practice market**: the guest's own copy, run in their browser on the same pricing and trading code, started from the live market's prices. It is labelled on every screen ("Practice market: not on NEAR. Sign in to trade for real."). They trade with practice Bits and a copy of their loot; Sandwich Man trades in it too, labelled as the NPC. A guest's night ends with a link into it.

Nothing in it is real, in either direction: a practice purchase can't be crafted with, imported or minted, and a practice sale costs the guest none of their saved loot. Practice trades earn no XP. Signing in brings across only what it always did (a hero up to level 3 and ten items).

### When Gwei goes broke: invest in her

When one of Gwei's tills can't pay for an item, her shop for that item is closed for buying, and the market says so on the item's card and in **Why this price?**.

| The player | The economy |
|---|---|
| Presses **Invest in Gwei** on a closed shop and reads what they risk | Their Bits go into that till. The same amount comes off the unfunded part of her curve, so the price doesn't move: she can simply buy again. |
| Keeps trading, or just waits | They earn half the gas fee on every trade of that item with her, split by stake, instead of it being burned |
| Presses **Withdraw or claim** | Fee earnings can be claimed at any time. The stake comes out once its lock has passed and the till holds the Bits. If sellers emptied the till, the stake waits until someone buys that stock. |

This runs today in the practice market and in the simulated market (a local checkout). **It is not live on mainnet:** the contract there (v2) has no invest call, so on mainnet a broke shop reopens only when someone buys from her, and the market says that investing arrives with contract v3. v3 is built and reviewed on the branch `review/contract-v3` ([CONTRACT-V3-REVIEW.md](CONTRACT-V3-REVIEW.md)). The whole story, with the maths and the risks, is [INVESTING.md](INVESTING.md).

## Why the economy is the gameplay

- **Loot has a use.** Suits need specific parts from specific villains, so what you fight decides what you can build, and what you lack decides what you buy. Suits are cosmetic: they change how the hero looks, not how they fight.
- **Prices are other players.** Nobody sets a price. A villain everyone farms floods Gwei with its parts and the price falls; a rare part climbs as it's bought. `/lab/economy` fast-forwards 21 days of this with bot players on the same pricing code.
- **The vendor has limits.** Gwei sells only what she holds and pays only from her till. Sold out, she can't sell; with an empty till for an item, she can't buy it until someone buys from her (or, where investing runs, until someone invests in that till: see above).
- **Sources and sinks.** Bits have entered the contract three ways, and only one of them repeats. Verified nights mint them, every night (`mint_rewards`). Opening the market minted Gwei's eight tills once, 6,240 Bits in all (`set_market_params`, transaction `FdQxVNyz…`). And the operator minted Sandwich Man's one-off 300-Bit seed (a `mint_rewards` with the digest of `npc-seed:sandwich.wgpnear.near:v1`, transaction `Hjvobzmd…`). Bits leave through the 2% fee. Items enter as loot, and as Gwei's opening stock in that same market-opening transaction, and leave through crafting. Today more Bits are earned than burned; a Bits cost for crafting is in the contract and off on mainnet.
- **No patch needed.** The pools, fee and caps are contract state. Prices move with every trade, with no deploy and no cron job.

## What the player never sees

| Hidden | How |
|---|---|
| Seed phrases | Google sign-in through Privy creates the player's NEAR key; wallet players sign one message (NEP-413) |
| Account creation | The factory `wgpnear.near` creates `<name>.wgpnear.near` with the player's key and a session key |
| Gas | `relayer.wgpnear.near` pays for player actions; `operator.wgpnear.near` pays for mints |
| Transaction prompts | A function-call session key signs game actions in the background |
| Waiting on the chain | Scores, saves and boards are server-side and instant; mints follow in the background |
