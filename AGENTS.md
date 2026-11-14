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
| A market inside the contract | A constant-product pool per item, escrowed player listings, a 2% fee that is burned, and a vendor that stops buying an item when its till is empty | `contracts/wgp/src/market.rs` (`market_buy`, `list_item`) | Command A (`market_state` on mainnet) | `judge-3`, `economy-burn-fee`, `near-market-guards`, `track-merchant-closed-reason` |
| Gasless play | A function-call session key signs NEP-366 delegate actions; the relayer accepts one call to an allowlisted method, with zero deposit, at most 30 Tgas and within budgets | `apps/wgp/src/server/near/relay.ts`, `apps/wgp/src/server/near/session-keys.ts` | `apps/wgp/src/server/near/relay.test.ts`, `relay-budget.test.ts`; a relayed mainnet trade | `intro-no-popups`, `judge-relayed-trade`, `near-relay` |
| Reward outbox | A verified run queues its mint in the same database transaction; the operator sends `mint_rewards` in batches with a per-account nonce, so a retry never mints twice | `apps/wgp/src/server/near/mint-worker.ts`, `contracts/wgp/src/lib.rs` (`mint_rewards`) | `apps/wgp/src/server/near/mint-worker.test.ts` | `near-rewards`, `proven-mint` |
| An NPC with its own wallet | Sandwich Man trades from `sandwich.wgpnear.near` with the same market calls players use, by fixed rules in one file (rule-based, not an AI model) | `apps/wgp/src/lib/market/npc-rules.ts` | `curl -s https://www.wgponnear.fun/api/market/npc \| jq '{mode, accountId, bits, log}'` | `track-agent-npc` |
| The merchant's reasoning | "Why this price?" explains each price from the vendor's stock and till | `apps/wgp/src/lib/market/reasoning.ts` | Open `/play/market` and tap **Why this price?** | `track-reasoning-tooltip` |
| NEAR Intents gas tank | `/gas` asks the 1Click API for a quote that turns USDC, ETH, SOL or BTC from 5 chains into NEAR for the relayer; the server fixes the recipient | `apps/wgp/src/server/intents/one-click.ts`, `apps/wgp/src/app/api/intents/` | A dry quote (moves nothing; any valid EVM address works as the refund address): `curl -s -X POST https://www.wgponnear.fun/api/intents/quote -H 'content-type: application/json' -d '{"assetId":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","amount":"2","refundTo":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","recipient":"someone-else.near"}' \| jq '{dry, recipient, amountOutFormatted}'` prints `"recipient": "relayer.wgpnear.near"` | `track-intents`, `tryit-gas` |
| Seasons on chain | At a season's close the standings are frozen with a Merkle root, and `record_season` stores it and mints soulbound trophies to the top 10 | `apps/wgp/src/server/near/season.ts`, `season-record.ts`, `contracts/wgp/src/lib.rs` (`record_season`) | `apps/wgp/src/server/near/season-record.test.ts`; the first mainnet run is at Season 1's close (Nov 15, 00:50 UTC) | `near-seasons`, `status-season` |
| Safe upgrades | `upgrade` uses low-level promise calls, and a script refuses a wasm that imports host functions mainnet lacks | `contracts/wgp/src/lib.rs` (`upgrade`), `scripts/near/check-wasm-imports.mjs` | `apps/wgp/src/evidence/wasm-imports.test.ts` | `near-upgrades` |
| The evidence ledger | Every quoted README sentence maps to a test or a read-only check | `scripts/evidence.mjs`, `docs/evidence.json` | `pnpm evidence --chain` | `evidence-output` |

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
| `pnpm test` | game-core `284 passed`, app `1691 passed` (a few skipped). Tests use in-memory PGlite and make no network request | about 3–4 min |
| `pnpm verify` | `5/5 runs reproduced from https://www.wgponnear.fun.` (replays the All-time top 5 from the live site) | about 5 s |
| `pnpm evidence` | One PASS, FAIL or SKIP line per claim, then `214 claims: … 0 FAIL …`. Rows whose proof is on chain or on the live site SKIP without `--chain` | about 2–3 min |
| `pnpm evidence --chain` | `214 claims: 214 PASS, 0 FAIL, 0 SKIP.` Reads mainnet and the live site; read-only | about 4–6 min |
| `pnpm evidence --chain --only <id>,<id>` | Re-runs single claims (ids are in `docs/EVIDENCE.md`) | seconds |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Exit 0; the build needs no database URL | under 1 min each |
| `pnpm stats` | Counts from NearBlocks and `/api/stats`; NearBlocks rate-limits, so it can take a couple of minutes | 1–3 min |

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
