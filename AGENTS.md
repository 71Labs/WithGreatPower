# AGENTS.md

Notes for coding agents working in or checking this repository. The README is the full description; this file is the short version: how to run things, what each command should print, and the rules for changing code here.

## What this is

With Great Power (WGP) is a 3D web-swinging game played in the browser, with its economy on NEAR mainnet. Ranked scores are replayed by the server before they count. Items are NEP-245 tokens in one contract, `game.wgpnear.near`, and its vendor market lives inside that contract. Live at https://www.wgponnear.fun. What is live on mainnet, practice only, simulation only or only built is listed in the README's opening table and under "Limits and what's next".

## Where the technical work is, and how to check each part

Each row names the code, a command or test that exercises it, and its row in [docs/EVIDENCE.md](docs/EVIDENCE.md), which links the exact test or read-only mainnet check. Commands A–G are in the README's "For judges: 5-minute check".

| Part | What it does | Code | Check it | Evidence |
|---|---|---|---|---|
| Replay-verified scores | The browser records only inputs; the server replays them through the same deterministic simulation and ranks a run only if its state hash reproduces | `packages/game-core/src/replay.ts`, `apps/wgp/src/server/verify.ts` | `pnpm verify` (replays the live All-time top 5); https://www.wgponnear.fun/lab/determinism replays four nights in your browser | `intro-replayed`, `judge-6`, `judge-8` |
| Deterministic simulation | Its math uses only + − × ÷, `Math.sqrt` and `Math.floor`, which IEEE-754 fixes bit for bit, so Node, Chromium, WebKit and Firefox agree; a scan test bans `Math.sin`, `cos`, `atan2`, `hypot` and `pow` in the core, and golden replays are pinned by hash | `packages/game-core/src/sim3d/dmath.ts`, `packages/game-core/test/determinism-scan.test.ts`, `packages/game-core/test/golden/hashes.json` | `pnpm --filter @wgp/game-core test` (284 tests, golden replays included) | `verify-goldens`, `arch-determinism-scan` |
| NEP-245 multi-token contract | Heroes, items, suits, badges and Bits are token ids in one contract, with the standard's transfers, views and events | `contracts/wgp/src/mt.rs`, `contracts/wgp/src/events.rs` | Command B (a player's tokens on mainnet); `cargo test` in `contracts/wgp` (68 tests) | `track-nep245`, `judge-4` |
| A market inside the contract | A constant-product pool per item, escrowed player listings, a 5% fee that is burned (and 250 Bits burned per crafted suit), 12 pools since Nov 15, and a vendor that stops buying an item when its till is empty | `contracts/wgp/src/market.rs` (`market_buy`, `list_item`) | Command A (`market_state` on mainnet) | `judge-3`, `economy-burn-fee`, `near-market-guards`, `track-merchant-closed-reason` |
| Gasless play | A function-call session key signs NEP-366 delegate actions; the relayer accepts one call to an allowlisted method, with zero deposit, at most 30 Tgas and within budgets | `apps/wgp/src/server/near/relay.ts`, `apps/wgp/src/server/near/session-keys.ts` | `apps/wgp/src/server/near/relay.test.ts`, `relay-budget.test.ts`; a relayed mainnet trade | `intro-no-popups`, `judge-relayed-trade`, `near-relay` |
| Reward outbox | A verified run queues its mint in the same database transaction; the operator sends `mint_rewards` in batches with a per-account nonce, so a retry never mints twice | `apps/wgp/src/server/near/mint-worker.ts`, `contracts/wgp/src/lib.rs` (`mint_rewards`) | `apps/wgp/src/server/near/mint-worker.test.ts` | `near-rewards`, `proven-mint` |
| An NPC with its own wallet and an LLM brain | Sandwich Man trades from `sandwich.wgpnear.near` with the same market calls players use. His fixed rules list every legal move; an LLM picks one or passes, and the server keeps the pick only if it is listed: NEAR AI Cloud when `NEARAI_API_KEY` is set (each answer's signature checked against the request, the response and the model's attested signer, recorded as `verified`, never blocking), else Kimi K3 (Moonshot). The rules decide on a timeout, an error or after 10 LLM calls a day. He takes a turn only after a request: a trade or listing, a market read (5-minute window) or any visit to a busy route once 15 minutes have passed since his last turn | `apps/wgp/src/lib/market/npc-rules.ts`, `apps/wgp/src/lib/market/npc-brain.ts`, `apps/wgp/src/server/npc/brain.ts`, `apps/wgp/src/server/npc/nearai.ts`, `apps/wgp/src/server/background.ts` (`npcVisitSoon`) | `curl -s https://www.wgponnear.fun/api/market/npc \| jq '{mode, accountId, bits, brain, log}'`; `apps/wgp/src/server/npc/nearai.test.ts` | `track-agent-npc`, `npc-brain-live`, `npc-brain-nearai`, `npc-visit-trigger` |
| A faucet with a taper | A verified night pays its Bits in full up to 150 held and less above, down to the 5 for showing up at 400; it reads only the verified result and the hero's balance, so no score or replay changes | `apps/wgp/src/lib/market/rewards.ts` (`nightPay`), `apps/wgp/src/server/market/held.ts` | `/lab/economy` (opens on the live settings, with a switch to the old ones) | `econdoc-owner-settings` |
| Gwei's wanted list | Each UTC day the items Gwei is short on (sold out, low stock or priced up) become a frozen list; verified nights that bring them get extra drops of those items, capped per night and per day | `apps/wgp/src/lib/market/wanted.ts`, `apps/wgp/src/server/market/wanted.ts` | `curl -s https://www.wgponnear.fun/api/market/wanted` | `economy-wanted-list` |
| Gwei's new stock | Four items earned from the Daily Run and cases, two suits that burn them, and their pools; awarded only while the pool exists on chain | `apps/wgp/src/lib/market/new-stock.ts`, `apps/wgp/src/server/market/new-stock.ts` | Open `/play/market` | `status-new-stock` |
| The merchant's reasoning | "Why this price?" explains each price from the vendor's stock and till | `apps/wgp/src/lib/market/reasoning.ts` | Open `/play/market` and tap **Why this price?** | `track-reasoning-tooltip` |
| NEAR Intents gas tank | `/gas` asks the 1Click API for a quote that turns USDC, ETH, SOL or BTC from 5 chains into NEAR for the relayer; the server fixes the recipient | `apps/wgp/src/server/intents/one-click.ts`, `apps/wgp/src/app/api/intents/` | A dry quote (moves nothing; any valid EVM address works as the refund address): `curl -s -X POST https://www.wgponnear.fun/api/intents/quote -H 'content-type: application/json' -d '{"assetId":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","amount":"2","refundTo":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","recipient":"someone-else.near"}' \| jq '{dry, recipient, amountOutFormatted}'` prints `"recipient": "relayer.wgpnear.near"` | `track-intents`, `tryit-gas` |
| Seasons on chain | At a season's close the standings are frozen with a Merkle root, and `record_season` stores it and mints soulbound trophies to the top 10 | `apps/wgp/src/server/near/season.ts`, `season-record.ts`, `contracts/wgp/src/lib.rs` (`record_season`) | `apps/wgp/src/server/near/season-record.test.ts`; Season 1's record on mainnet: `get_season("s1")`, written Nov 15, 2026 at 01:26 UTC | `near-seasons`, `status-season-after`, `proven-record-season` |
| Safe upgrades | `upgrade` uses low-level promise calls, and a script refuses a wasm that imports host functions mainnet lacks | `contracts/wgp/src/lib.rs` (`upgrade`), `scripts/near/check-wasm-imports.mjs` | `apps/wgp/src/evidence/wasm-imports.test.ts` | `near-upgrades` |
| The evidence ledger | Every quoted README sentence maps to a test or a read-only check | `scripts/evidence.mjs`, `docs/evidence.json` | `pnpm evidence --chain` | `evidence-output` |

## Mainnet facts, each re-checked by `pnpm evidence --chain`

| Account | Role |
|---|---|
| `game.wgpnear.near` | The contract: NEP-245 tokens, the market, seasons. Code hash `68F7NhEjUtKweyLU7WNvT183apacLQegfB1DXUoQ2hjJ` (sha256 `4c25745400717004ab5c18521bf6454a21c6f093d6deff353f8784dcd15df84d`) |
| `wgpnear.near` | The contract's owner, and the factory that creates `<name>.wgpnear.near` player accounts |
| `operator.wgpnear.near` | Sends `mint_rewards` for verified runs and `record_season` |
| `relayer.wgpnear.near` | Pays gas for players' NEP-366 meta-transactions; the NEAR Intents gas tank refills it |
| `sandwich.wgpnear.near` | Sandwich Man, the NPC trader, signing with his own key |

Transactions the evidence ledger looks up again on every `--chain` run (check ids are in `docs/evidence.json`):

| What | Transaction | Check |
|---|---|---|
| The deploy and new | [`8nyXGMNuFm…`](https://nearblocks.io/txns/8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR) | `tx-deploy` |
| The owner's set_market_params, which minted Gwei's stock and till to the contract's own account | [`FdQxVNyziV…`](https://nearblocks.io/txns/FdQxVNyziV7ioNWPAfL9yAWJ8u2wDN3kRKpEX4JSVcCR) | `tx-open-market` |
| The factory creating a player's account (9a_z53.wgpnear.near, not the author's) with two keys | [`DFF1SsPjKP…`](https://nearblocks.io/txns/DFF1SsPjKPto6Kxa3TfpdX2pSMNC9GftnbJuz9PRWcV8) | `tx-factory-account` |
| A player's register_hero, relayed | [`7dnP8eU7W8…`](https://nearblocks.io/txns/7dnP8eU7W8b9LdQeZztnttzai5uUc7gHAea4hEeoXnnq) | `tx-register-hero` |
| A reward mint from the operator | [`CsnUWQDWSX…`](https://nearblocks.io/txns/CsnUWQDWSXGwNaapB9iFGH3idEqzQWGbWmrH7pbJegZh) | `tx-mint-rewards` |
| A player's craft_suit of Stealth, burning the recipe's Sybil goo and minting the suit | [`3ttQYUBrA8…`](https://nearblocks.io/txns/3ttQYUBrA8CbKu1s7VuvNA8QAxMMfHsTJGHrKi4AZqjc) | `tx-craft-suit` |
| A player's equip_suit, relayed | [`C2WwQsHyHN…`](https://nearblocks.io/txns/C2WwQsHyHNBZLrkN1JaVDGZuuf9aYaBJGqvyMSLvRvRp) | `tx-equip-suit` |
| A market_buy from Gwei, with the fee burned | [`ASmRJdKZy3…`](https://nearblocks.io/txns/ASmRJdKZy3fMPAPNNogcABL4Wdr7CiPPasAxRjXr5xRq) | `tx-market-buy` |
| A market_sell to Gwei | [`GDATLg4Qr2…`](https://nearblocks.io/txns/GDATLg4Qr2cqQZ9S5uaRwZJTup4Y54P7uPyzJzFGaqXE) | `tx-market-sell` |
| A player's list_item: the items move to the contract, in escrow | [`GhK2jtPKtN…`](https://nearblocks.io/txns/GhK2jtPKtNpHgjcn93eYRiFjF72mcMcFzbfHqYbnM9tx) | `tx-list-item` |
| Another player's buy_listing: Bits go from the buyer to the seller | [`Heu9ZTQvWm…`](https://nearblocks.io/txns/Heu9ZTQvWmriDngtPQ37defMDZMJSecgBNpdAuLnMdu9) | `tx-buy-listing` |
| A relayed market_buy by the player azalleaxyz.wgpnear.near (not the author's account), signed by their session key and sent by the relayer, with no deposit, the fee burned | [`GJXrKe2oNj…`](https://nearblocks.io/txns/GJXrKe2oNjbTvxG2HyMt4DeTBXNPxGVRBbXsUrzv2TPJ) | `tx-relayed-buy` |
| The owner's account, wgpnear.near, created sandwich.wgpnear.near with a transfer and one key (Nov 13, 2026) | [`Hx32N4dymG…`](https://nearblocks.io/txns/Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm) | `tx-npc-create` |
| The one-off seed: the operator's mint_rewards of 300 Bits to Sandwich Man, nonce 1, with the digest sha256("npc-seed:sandwich.wgpnear.near:v1") | [`Hjvobzmddf…`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7) | `tx-npc-seed` |
| Sandwich Man's first trade: a market_buy of 2 Sybil goo from Gwei for 72 Bits, signed by his own key (not relayed), with no deposit and the fee burned | [`AcmNAmHr1F…`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf) | `tx-npc-first-trade` |
| The Nov 13, 2026 top-up of the contract's storage balance: a transfer from the relayer's account to game.wgpnear.near | [`FH2tpfkzDk…`](https://nearblocks.io/txns/FH2tpfkzDkY8MtEX6fWCmMc7E7RRndGA8nibM1ZYEjuB) | `tx-contract-topup` |
| A player's cancel_listing, relayed: 2 Sybil goo back from escrow | [`J8rLL9GWab…`](https://nearblocks.io/txns/J8rLL9GWab9AeB1DTNy8fC7GCa9NbpyXXpKWKeXAKF8t) | `tx-cancel-listing` |
| The Nov 14, 2026 transfer from game.wgpnear.near to the relayer that ended the relayer outage | [`GU8GVkK3a2…`](https://nearblocks.io/txns/GU8GVkK3a2mDkypzEz1cAVnHihVQLKQBUJKQ9oeyYs2d) | `tx-relayer-refill` |
| game.wgpnear.near registers the relayer on wrap.near (Nov 14, 2026) | [`DWFUoozvVD…`](https://nearblocks.io/txns/DWFUoozvVD7ZLDwxCvrQusKd13mXFVSR9g5qCrx4gvAr) | `tx-wrap-register` |
| Season 1's record_season, with trophy:s1:1 to trophy:s1:10 (Nov 15, 2026, 01:26 UTC) | [`AxLWpz5m6m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX) | `tx-record-season` |
| The owner's set_rules (Nov 15, 2026, after the deadline) | [`GzMYer3o5C…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY) | `tx-set-rules` |
| The owner's set_market_params: 5% fee, 250-Bit crafting, four new pools (Nov 15, 2026, after the deadline) | [`BskDQS99TN…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK) | `tx-new-market-params` |
| A Sandwich Man market_buy of Nov 15, 2026, signed by his own key | [`6cjd1ffrZU…`](https://nearblocks.io/txns/6cjd1ffrZUXqoafzBydwQAZmjdBAKfna9B3PNMFtZuAN) | `tx-npc-llm-trade` |

The player transactions above come from five different accounts, none of them the author's (check `player-senders`).

## The evidence ledger at a glance

`docs/evidence.json` holds 256 claims quoted from the README and docs; `docs/EVIDENCE.md` is generated from it. Each claim has a status that says how far its proof reaches (defined in the README's "How verification works"):

| Status | Claims |
|---|---|
| `proven by test` | 129 |
| `proven on chain` | 60 |
| `live check` | 20 |
| `pinned by test` | 8 |
| `simulation only` | 24 |
| `built, off on mainnet` | 0 |
| `checked in git` | 7 |
| `owner action needed` | 8 |

What is not live, so a review doesn't have to dig for it (details in the README's opening table and "Limits and what's next"):

- Investing in a broke vendor runs only in the signed-out practice market and `/lab/economy`; on chain it is contract v3, built on the branch `review/contract-v3` and not deployed.
- `/lab/economy` is a simulation of bot players, not mainnet.
- The NEAR Intents gas tank's quotes are live; its first real refill had not landed when this was written.
- NEAR Auth is built and waits on NEAR adding the site to its mainnet client.
- Season 1's on-chain record landed on Nov 15, 2026 at 01:26 UTC (`AxLWpz5m…`, check `tx-record-season`); check `season-s1` asserts the recorded state in full.
- Some of what the README describes changed after the 2026-11-14 23:59 UTC deadline (the tag `hackathon-submission` marks it); the README's "Changed after the deadline (Nov 15, 2026)" lists each change.
- Traffic is a small, incentivised playtest (daily airdrops, sent outside the game); "By the numbers" in the README has the counts and their caveats, and [docs/TRACTION.md](docs/TRACTION.md) breaks them down by day (`pnpm traction`).
- Costs and runway are measured from mainnet history in [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md) under "Measured costs" (`pnpm costs`); there is no revenue yet.
- Trust: the owner key is in the production environment, and `game.wgpnear.near` has a full-access key held by the owner; both are disclosed under Limits, with the plan to remove them after judging.

## NEAR HACKATHON rules, and where each is met

| Rule (HACKATHON.md) | Where |
|---|---|
| Built in the window (Q-001) | The first commit is 2026-11-01; README "Built during the hackathon" |
| New repo or separated diff (Q-003) | The whole repository is the submission |
| Libraries, templates and AI code listed (Q-005) | README "Credits and disclosure", including AI-written code |
| Own contract on NEAR fits the track (Q-011) | `contracts/wgp`, deployed as `game.wgpnear.near` |
| Hosted demo (Q-012) | https://www.wgponnear.fun, kept up through judging |
| License (Q-014) | `LICENSE` (MIT) |
| One submission per person, or both READMEs name each other (Q-015) | README "Built during the hackathon" |
| Track hints: agent NPCs, social login, NEAR Intents, NEP-245 | README "How it meets the track", one row each |

## Layout

| Path | What |
|---|---|
| `apps/wgp` | The Next.js app: the game (React Three Fiber), the API routes, the server (replay verifier, reward outbox, relayer, NEAR Intents gas tank) |
| `packages/game-core` | The deterministic simulation and the replay verifier the server uses |
| `contracts/wgp` | The NEAR contract (near-sdk, NEP-245 core, the market); identical to the deployed source |
| `docs/` | Architecture, economy, sustainability, and the evidence ledger (`evidence.json` → `EVIDENCE.md`) |
| `scripts/` | `evidence.mjs`, `verify-run.ts`, `stats.mjs`, deploy and mainnet setup |

## Requirements

Node 22 or later (24 is used here) and pnpm 10.19 (`corepack enable`). Rust with `cargo` only for the contract tests; without it, those rows are skipped with a reason.

## Commands and what they print

Times are from a fresh anonymous clone on Nov 14, 2026 (Apple silicon laptop).

| Command | Expect | Time |
|---|---|---|
| `pnpm install --frozen-lockfile` | Exit 0 | about 25 s |
| `pnpm test` | game-core `284 passed`, app `1811 passed` (a few skipped). Tests use in-memory PGlite and make no network request | about 3–4 min |
| `pnpm verify` | `5/5 runs reproduced from https://www.wgponnear.fun.` (replays the All-time top 5 from the live site) | about 5 s |
| `pnpm evidence` | One PASS, FAIL or SKIP line per claim, then `256 claims: … 0 FAIL …`. Rows whose proof is on chain or on the live site SKIP without `--chain` | about 2–3 min |
| `pnpm evidence --chain` | `256 claims: 256 PASS, 0 FAIL, 0 SKIP.` Reads mainnet and the live site; read-only | about 4–6 min |
| `pnpm evidence --chain --only <id>,<id>` | Re-runs single claims (ids are in `docs/EVIDENCE.md`) | seconds |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Exit 0; the build needs no database URL | under 1 min each |
| `pnpm stats` | Counts from NearBlocks and `/api/stats`; NearBlocks rate-limits, so it can take a couple of minutes | 1–3 min |
| `pnpm traction` | Day-by-day mainnet usage: daily active and new player accounts, calls by method, retention, concentration, reward mints, and the `/api/stats` snapshot. Read-only; tonight's run is in `docs/TRACTION.md` | a few min (NearBlocks) |
| `pnpm costs` | Measured costs from mainnet history: NEAR per relayed action and per reward mint, cost per player, relayer and operator runway, what a Gas tank refill buys. Read-only; tonight's run is in `docs/SUSTAINABILITY.md` ("Measured costs") | a few min (NearBlocks) |
| `pnpm txs` | Writes `docs/TRANSACTIONS.md`: every transaction of the five game accounts from NearBlocks, grouped by method, relayed calls attributed to the player, failures listed, author and team accounts labelled; read-only | a few minutes (NearBlocks rate limits) |

Nothing above signs a transaction, needs a wallet or needs secrets.

## Network flakiness

`pnpm evidence --chain` and `pnpm stats` call the public NEAR RPC, NearBlocks and the live site. A request that is rate limited, answers 5xx or times out is retried with a growing wait; if it still fails, the claims behind it print SKIP with the reason, never FAIL. To re-check them, run `pnpm evidence --chain --only <ids>` again.

## Rules for changing code here

- Season 1 runs on ruleset 4: don't change `RULESET_VERSION` or the golden replays in `packages/game-core/test/golden/` while a season is open.
- `contracts/wgp` must stay identical to the deployed contract; contract changes go on a branch (v3 is on `review/contract-v3`).
- Every README sentence that `docs/evidence.json` quotes is checked word for word. After editing the README or a cited file, run `pnpm evidence --write` and `pnpm evidence --check`.
- Tests make no network requests; a guard fails any test that tries.
- No scheduled jobs: background work runs after a request (`apps/wgp/src/server/background.ts`), and `vercel.json` has no crons.
- Never commit secrets; keys live in environment variables (`apps/wgp/.env.example` lists them).
