# With Great Power (WGP)

A 3D web-swinging superhero parody game on NEAR. You swing through a comic-book city at night, catch four parody villains, run errands for your neighbors, and climb leaderboards where **every ranked night is replayed and verified by the server**. Items, in-game currency (Bits) and the player market live on NEAR, behind a session key and a gas relayer, so players never sign a gas transaction while playing.

- **Play:** https://www.wgponnear.fun
- **Built at:** NEAR HACKATHON, Nov 1–14, 2026. Track: Games With Real Economies (`games`).
- **License:** MIT

## Screenshots

| | |
|---|---|
| ![The hero swinging between rooftops at night](docs/screenshots/swing.jpg)<br>**Swing** across a comic-book city, then land and fight. | ![Doc Octochain boss fight on the bridge](docs/screenshots/boss-fight.jpg)<br>**Boss fights**: Doc Octochain holds the bridge. |
| ![The hero, a MakeHuman body with motion capture](docs/screenshots/cast.jpg)<br>**Real bodies**: MakeHuman characters with motion capture. | ![Sign-in sheet with Google and NEAR wallet options](docs/screenshots/sign-in.jpg)<br>**Sign in** with Google or a NEAR wallet. |
| ![Night results showing Verified and Ranked with the server's score](docs/screenshots/verified-run.jpg)<br>**Verified · Ranked**: the server replays the night before it counts. | ![All-time leaderboard on the live site](docs/screenshots/leaderboard.jpg)<br>**Leaderboards**: Tonight, Season and All time. |
| ![Mempool Market with the NPC vendor's prices](docs/screenshots/market.jpg)<br>**Mempool Market**: an NPC vendor whose prices move with every trade. | ![Economy lab after 21 simulated days, with price charts](docs/screenshots/economy.jpg)<br>**Economy lab**: 21 days of bot trading on the real pricing code. |

## The problem

Web3 games make players fight wallets before villains: seed phrases, popups for every action, gas prompts mid-game. Their leaderboards trust whatever score the browser sends. WGP keeps the chain out of the game loop and makes the scores verifiable:
- A player signs in once. After that, game actions are signed by a game-only key and paid for by our relayer.
- The server replays each ranked night's recorded inputs through the same deterministic simulation the browser ran, and ranks only what reproduces.
- Anyone can re-run that check (step 4 below).

## Try it: do X, see Y

All steps work on the live site, with no install.

1. **Play a night as a guest.**
   - **Do:** open https://www.wgponnear.fun/play, then Patrol.
   - **Controls:**
     - WASD or the arrow keys run relative to the camera. Let go and the hero stops and stands; he only moves where you steer.
     - Space or the mouse shoots a web toward where you're steering (or the next stop). Hold it to keep swinging and chain webs, and let go to fly. Release on the rise for a perfect boost, and let go before touching a roof to land.
     - 1–4 fire powers, G calls Gwei, Esc pauses. Click into the game for mouse look.
     - On touch: drag on the left side to steer, hold the right side to web.
   - **See:** a 3D night of stops (villain fights and ally errands) ending on a results screen. Gold Bits tokens and boost rings line each route and build your combo. Guest nights are unranked.
2. **Sign in with Google or a NEAR wallet.**
   - **Do:** open the account chip (top of any game screen), then either:
     - "Continue with Google": Privy logs you in and makes a NEAR key for you, with no seed phrase or extension;
     - "Use a NEAR wallet": pick a wallet and sign one message (NEP-413; no gas, no transaction).
   - **See:** the chip shows your account. Your save now lives on the server.
3. **Play a ranked night.**
   - **Do:** finish a night while signed in.
   - **See:**
     - the results show **Verified · Ranked**, the server's score and your rank on Tonight's board;
     - https://www.wgponnear.fun/play/leaderboard lists you on the Tonight, Season and All-time boards.
4. **Verify any ranked run yourself.**
   ```bash
   pnpm install
   cd apps/wgp && pnpm exec tsx ../../scripts/verify-run.ts           # the All-time top 5
   cd apps/wgp && pnpm exec tsx ../../scripts/verify-run.ts <runId>   # one run (runId from /api/leaderboard)
   ```
   **See:** `OK <run> <player>: score … vs …, ticks … vs …, hash … vs …` and `N/N runs reproduced`. The script downloads the run's seed, start save and input log from `GET /api/runs/<id>/replay` and replays it locally with `@wgp/game-core`.
   - **Older runs:** a run recorded under an older ruleset is skipped with a note. To replay it, check out that ruleset's tag: runs from before ruleset 3 need `git checkout ruleset-v2`.
5. **Trade in the Mempool Market.**
   - **Do:** open https://www.wgponnear.fun/play/market.
   - **See:**
     - the NPC vendor's prices for each item, with 24 h change and sparklines;
     - buying raises a price and selling lowers it (a constant-product bonding curve);
     - player listings.
   - **Is it on chain?** `GET /api/market` says `onChain: true` when the contract's market is live, and `false` while it runs the same engine in simulation (see Status).
6. **Watch the economy move.**
   - **Do:** open https://www.wgponnear.fun/lab/economy and press play (up to Instant speed).
   - **See:** days of bot players buying, selling, listing and crafting on the same pricing code, with each item's price and stock charted.
7. **Check it on NEAR.**
   - **Do:** after the contract is live (see Status), open https://nearblocks.io/address/game.wgpnear.near.
   - **See:** the contract's NEP-245 transfer, mint and burn events. Your account's items and Bits come from `mt_balance_of`.

## What NEAR does here

| Piece | How |
|---|---|
| **Player accounts** | A wallet player is their own NEAR account. A Google player gets a NEAR key from Privy's embedded wallet. Once the factory account is live they get `<name>.wgpnear.near` holding that key; before then they play on the key's implicit account and claim the name later, keeping their save, rank and rewards. |
| **Items, suits, trophies and Bits** | NEP-245 multi-tokens in one contract, `game.wgpnear.near` (`contracts/wgp`). Heroes and trophies are soulbound. Transfers need 1 yoctoNEAR, so game keys can never move assets. |
| **Rewards** | Each verified night queues a reward mint (items, plus Bits worth score/100 + 5). The operator account sends `mint_rewards` with per-account nonces, so a retry never mints twice. Mints are sent in the background of player requests; there are no cron jobs. |
| **The Mempool Market** | In-contract NPC vendor with a bonding curve per item, player listings held in escrow, and a 2% "gas fee" parody that's burned. Guards cap what a stolen game key could do. |
| **No popups in play** | After sign-in, players get a game-only function-call key. Our relayer submits their signed actions as NEP-366 meta-transactions and pays the gas (`/api/relay/meta`: one action, zero deposit, allowlisted methods, budgets). |
| **Sign-in** | NEAR wallets through near-connect with a NEP-413 signed message. Google through Privy: the server verifies Privy's access token and reads the player's verified email and NEAR key from Privy's API. Players are linked by verified email, so switching Google to NEAR Auth later keeps every hero. |
| **Seasons** | `record_season` stores a season's results root and top 10 on chain (`scripts/near/record-season.ts`). |

### Status (mainnet)

| | |
|---|---|
| Live | The game, ranked runs verified by replay, leaderboards, Google sign-in (Privy) and NEAR wallet sign-in, the market and economy lab (simulated until the contract is live), the full soundtrack |
| Being deployed | `game.wgpnear.near` and its relayer and operator accounts (`scripts/near/setup-mainnet.sh`). Until then, rewards are queued, not minted, the market runs in simulation (`onChain: false`), and Google players stay on their implicit accounts |
| Waiting on approval | NEAR Auth as a second Google sign-in path (mainnet client) |

## How verification works

1. **One simulation.** `packages/game-core` is a deterministic simulation: a 60 Hz fixed step, trig-free math, integer HP and score. It's shared by the browser and the server.
2. **Recording.** The browser records only inputs: a stick direction, a magnitude, web held, and one-shot powers, run-length encoded and usually 2–15 KB a night.
3. **Starting a run.** `POST /api/runs/start` issues a server-signed seed.
4. **Verifying.** `POST /api/runs/<id>/submit` replays the log from that seed and the server's copy of the save. It checks the ruleset, that game time fits within wall-clock time, and the final state hash, then ranks the server's score, not the client's.
5. **Anyone can re-check.** Every verified run's replay is public at `GET /api/runs/<id>/replay`.

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

```bash
pnpm install
cp apps/wgp/.env.example apps/wgp/.env.local     # then set ALLOW_DEV_AUTH=1 in it
pnpm dev                                         # http://localhost:3000/play
```

- **Database:** local dev uses PGlite (Postgres in a folder), so no database or keys are needed.
- **Signing in locally:** in the sign-in sheet, "Play as a test player" gives a test account.
- **Production:** uses Neon Postgres and the NEAR settings in `apps/wgp/.env.example`.

| Command | What it does |
|---|---|
| `pnpm test` | Unit and integration tests: game-core (simulation, goldens, replay, a bot across 30 nights) and the app (server, verifier, market, relayer abuse cases, outbox) |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint across the workspace |
| `cd contracts/wgp && cargo test` | Contract unit tests. Sandbox tests are in `contracts/wgp/sandbox`. |
| `cd apps/wgp && pnpm simulate 14` | A bot plays 14 nights through the rules engine |
| `scripts/near/setup-mainnet.sh` | Owner only: creates the mainnet accounts, deploys the contract, opens the market. Spends real NEAR. |

## Layout

```
packages/game-core/   deterministic simulation, input log, replay verifier, scoring (TypeScript)
apps/wgp/             Next.js 16 app: 3D client (React Three Fiber), API routes, Drizzle (Neon / PGlite), NEAR wiring
contracts/wgp/        NEAR contract (near-sdk 5.30): NEP-245 core, rewards, crafting, Mempool Market, seasons
scripts/              mainnet setup, run verification, chain end-to-end tests
launch/brand/hero/    Blender pipeline that builds the characters (MakeHuman bodies) and retargets motion capture
docs/                 architecture and design notes
```

## Built during the hackathon

- **All code here was written during NEAR HACKATHON.** The first commit is 2026-11-01.
- **Two design patterns were re-implemented** from the author's own earlier projects:
  - the fixed-step game loop and input-log approach, from the author's game *blastoff*;
  - the landing-page design system, from the author's project *Vessel* (Oct 30, after the hackathon's announcement).

## Credits and disclosure

- **AI-assisted:** much of the code, art pipeline and copy was written with AI assistance (Claude Code), directed and reviewed by the team.
- **Libraries:** Next.js, React, three.js, React Three Fiber and drei, Drizzle ORM, Neon serverless and PGlite, near-api-js, @hot-labs/near-connect, Privy (`@privy-io/react-auth`, `@privy-io/node`), @fast-auth-near (NEAR Auth) SDKs, zod, Tailwind CSS, Hugeicons, Vitest, near-sdk-rs, cargo-near and near-workspaces.
- **3D characters:** bodies made with [MakeHuman](http://www.makehumancommunity.org/) via MPFB (CC0 assets; the GPL tool isn't shipped). Motion capture from [Quaternius' Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) (CC0). See `apps/wgp/public/models/LICENSES.md`.
- **Audio:** generated with ElevenLabs on the owner's paid plan (`apps/wgp/public/audio/CREDITS.md`).
- **Fonts:** Neue Montreal (Pangram Pangram) is licensed and served in production but isn't in this repository; without it the site falls back to Inter. Inter, Manrope and Geist Mono are from Google Fonts (OFL).
- **NEAR wordmark:** from NEAR's brand files.
- **Parody:** all characters are original designs. With Great Power isn't affiliated with, endorsed by or sponsored by any comic book publisher or film studio.
