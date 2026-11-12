# Architecture: With Great Power in 3D

The build plan for the 3D game, its leaderboard, NEAR contracts and Google sign-in. Milestone PRs implement it in order; when code and this document disagree, fix one of them in the same PR.

**Status (Nov 12, 2026):** everything below is built and live on NEAR mainnet (`game.wgpnear.near`), and players use it: the README lists the transactions and how to check them. Since the first milestones the game has grown new modes, each with its own ruleset tag so its logs never replay as another mode's: three case files ([chapters/](chapters/)), the Daily Run, time trials and duels ([compete.md](compete.md)), the free-roam City, and referrals ([referrals.md](referrals.md)). The player's loop is in [GAME-LOOP.md](GAME-LOOP.md). Google sign-in goes through Privy while NEAR Auth waits for its mainnet client (§5). §7 keeps the original plan and dates.

## Architecture
A pnpm workspace at the repo root. Only the deterministic core becomes a package.

```
packages/game-core/   @wgp/game-core: pure TS (rules + 3D sim + input log + replay), vitest
apps/wgp/             Next.js: 3D client (R3F), API routes, DB, NEAR wiring
contracts/wgp/        Rust, near-sdk 5.30 (Vessel conventions)
scripts/near/         mainnet and testnet setup, chain e2e, season recording
docs/                 ARCHITECTURE.md, spikes/, screenshots/
```

**How the pieces fit:**
1. The browser steps the same deterministic sim the server uses, recording a compact input log.
2. When the run is submitted, the server **replays** the log, computes the score, writes Neon and updates the boards.
3. An outbox queues token mints, sent with an operator key to the game contract.
4. Player actions (craft or equip a suit) are signed by a **session key**, which is only allowed to call the game contract with no money attached. Our relayer pays the gas.

**Who is authoritative:**
- **Server:** score and progression.
- **Chain:** owned tokens.
- **Client:** trusted for nothing.

## 1. Deterministic core (`packages/game-core`)
- **Move unchanged:**
  - `src/game/{types,data,engine}.ts` and `src/content/cast.ts` go into `rules/`.
  - `src/sim/bridge.ts` stays as the bridge.
  - **Gate:** `pnpm simulate 14` output is byte-identical before and after.
- **Add `seed?` to `start-patrol`** so the server issues seeds (today the seed is `seedOf(night, name)` in `engine.ts`, which players can predict).
- **Port into `sim3d/`:**
  - **Verbatim:** `sim.ts`, `combat.ts`, `rng.ts`, `constants.ts`, the event types (with z added).
  - **Ported:** `hero.ts` (rope in 3D), `abilities.ts`, `bot.ts` (now emits input frames).
  - **Rewritten:**
    - `world.ts` → `city.ts`: an AABB grid, 9×9 blocks, a spatial hash, sphere collision and a raycast shared with the camera.
    - `villains.ts` keeps each joke: Goblin flies a looping path, Sandwich runs the arena roofs, Doc sweeps the bridge plane, Sybil's copies orbit in xz.
- **Rope in 3D:** gravity → air steer → pump → reel → integrate → project onto the rope sphere and drop outward speed → collide with boxes (land on roofs, slide on walls) → the street or river is a miss. Two substeps above 1,200 u/s. Since ruleset 3 a slack line below its anchor takes itself up (not shorter than 170), so a web shot while jumping or rising toward its anchor can't drag you into the street.
- **Release grading uses no trig:** constant tangent bounds replace `atan2`. Since ruleset 3 the perfect window is 15–65° above horizontal (ruleset 2: 20–60°), where a swing naturally releases, and boosts ×1.15; any other release still rising at speed is good and boosts ×1.05.
- **Anchor choice ignores the camera.** Heading comes from the stick (one of 64 literal directions), else the bearing to the next stop (one-thumb play), else the villain, else velocity. Since ruleset 2 (`sim3d/swing.ts`) it picks among roof-edge and facade points ahead and up on the buildings flanking the travel line, scored by a short forecast of forward progress and clearance; it never webs behind or straight overhead. Ties break deterministically. Since ruleset 3 the heading only aims webs (and leans the pump): nothing moves the hero along it without the stick.
- **Controls (ruleset 3, `sim3d/hero.ts`), after the owner's playtest:**
  - **Ground:** only the stick runs, brakes and turns you (the body turns to face it at 19 rad/s). Centred, friction stops you and you stand, indefinitely. A roof's edge holds you unless the stick pushes out over it; then you walk off, with no hop. Only the web takes off: a jump into a swing toward the stick, or toward the next stop with the stick idle (a plain jump if nothing is in reach).
  - **The web button:** a press is buffered for 0.15 s, so a re-web straight after a release takes. A tap (let go within 0.18 s of the web taking) swings on to the swing's natural end. Held through that end (rising past the window's top, or the top of a weak arc), the web lets go by itself, ungraded, and the next shoots at the top of the arc, so holding chains swings. Letting go yourself is graded.
  - **Landing:** touching down on a roof ends the swing. Let go first and it's a clean landing: the impact takes half its speed off, a short skid (friction 1,700 above run speed, 2,600 below) and a stop, no bounce. Holding the web through the touchdown shoots a new web on the next tick.
  - **The street** costs 3 health (ruleset 2: 6) and the combo, and bounces you back up with 80% of your speed (ruleset 2: 55%).
  - **Air control** is stronger (900 u/s², up to 640 along the stick) and swings faster (pump 400, soft top speed 1,800).
- **Pickups and the combo (ruleset 3, `sim3d/pickups.ts`):** each leg's swing line runs along the street grid in a Z (down the street by the leg's start, along the cross street halfway, down the street by the stop), and gets a Bits token every 210 units at swing height (from the facades either side), clear of arenas, the river and buildings, with a boost ring in the middle of each long stretch: about 50 tokens and 6 rings a night, placed from the city alone. A token or ring is taken in reach (80 and 110 units, 1.5× that up and down); a ring boosts you to at least 1,000 u/s. The combo counts perfect releases (+1), tokens (+1) and rings (+2), refills a 6 s timer with each, drains 4× faster standing on a roof and ends on the street; its multiplier (×1, then +1 every 4, at most ×4) multiplies what pickups are worth (10 and 50 points).
- **Render frame v1.3** (additive): `pickups` (id, kind, position, taken), `combo` (count, multiplier, ticks left), `route` (the remaining stop centres, for the map) and the hero's `controlled` (the player is giving input this tick).
- **Grounded fights (ruleset 4, `sim3d/strike.ts`, `villains.ts`):** each arena is one flat stage (`zone.stage`: the roof between the four corner towers, or Doc's 240-wide deck between his towers) and the hero stays on it until the fight ends. In a fight the web button strikes a villain body in reach (a step in and a blow) and web-zips at one further out across the roof into a strike; beside him it never swings, and at a flyer overhead it fizzles. Direct hits clang off a guard, except in an opening (Gas Goblin's stall after a dive, Sandwich Man's stumble after a lunge); Doc only takes them with his arms in. Getting hurt is a shove that slides out, body contact a block: nobody is launched. Villains take 6 + level ÷ 2 hits, at most 9 (3 more for a boss). The first nights are forgiving (`mercy()`, 1 at villain level 1 down to 0 from level 4): hits do up to 10% less, the hero stays untouchable a second longer after one (Doc's chain swat 1.5 s longer), fee bombs hurt up to half as much and fall slower, Doc's arms stay in a second longer and he guards less, and the dive, lunge and slam wind up longer. Render side: hit-stop in the loop, a punch on every strike, words over the big wind-ups, and the two-shot camera takes each fighter at a steadied height. `test/fight-metrics.ts` measures it (`FIGHT_REPORT=1`).
- **Determinism rules:**
  - Banned in the core, enforced by a source scan in the tests (`test/determinism-scan.test.ts`; game-core has no ESLint): `Math.sin/cos/atan2/hypot/pow/random`, `**`, `Date` and `performance`.
  - `dmath.ts` provides polynomial sin, cos and atan2 using only + − × ÷ and `sqrt`.
  - Integers for HP, fluid, XP, score, loot and ticks.
  - Presentation (spin, squash) moves out of the sim.
  - An FNV state hash over raw float bits.
  - `RULESET_VERSION` is pinned in every run.
- **Input log:** adapted from blastoff's `packages/game-core/src/input.ts`.
  - Run-length-encoded frames of a stick byte plus a button byte, plus an event channel for errand choices.
  - About 2–15 KB per 6-minute night, capped at 64 KB.
  - A strict decoder.
- **`replay.ts`:** `replayRun({save, seed, log}) → {save, score, stats, checkpoints, hash}`. The server verifier and client resume after reload both use it.
- **`score.ts`:**
  - Fights: 1,000 × level × boss multiplier.
  - Errands: 250 each.
  - Perfect swings: 40 each, capped.
  - Combo (25 per point of the best, the first 40 count), HP left and a time bonus.
  - Pickups (ruleset 3): each token's 10 and ring's 50 × the combo multiplier when taken, at most 2,000. Stats carry `bits`, `rings` and `pickupsPlaced`.
  - Ties go to the faster run.
- **Gate:**
  - Golden logs give identical hashes in Node and in the browser (`/lab/determinism`; checked by hand in Chromium and WebKit, not yet in Firefox). Regenerate after an intended change with `UPDATE_GOLDEN=1 pnpm --filter @wgp/game-core test golden`.
  - A bot clears 30 nights with no NaN. It steers explicitly since ruleset 3 (at the next pickup when one is close and on the way, else the stop).
  - `test/feel.test.ts` pins the controls and runs scripted players (holding the web, tapping it, letting go when rising; the stick held toward the stop) over 24 routes each; `FEEL_REPORT=1 pnpm --filter @wgp/game-core test feel-report` prints the numbers (`test/feel-metrics.ts`).

## 2. 3D client (React Three Fiber, lazy-loaded on `/play/patrol` only)
- **Stack:** three 0.187, @react-three/fiber 9.8 and drei 10.7 (blastoff's versions, three one minor newer).
- **Buildings:**
  - Instanced unit boxes in 4×4 sectors for culling.
  - An unlit toon shader: flat face tints and procedural lit or dark windows mirroring `src/sim/render/city.ts`.
  - Flat banded fog. No shadows, dither or post-processing by default.
- **Outlines:** an inverted-hull instanced pass, 3 px near down to 1.5 px far, with the `LINE` widths from `src/game/style.ts`.
- **Props and sky:** instanced props (water towers, antennas, billboards from a canvas text atlas using `BILLBOARDS`), plus a vertex-colour sky with stars.
- **Characters** (`src/game3d/scene/characters/`; the sticker cards were replaced in November):
  - **The hero** is a real human body: an MPFB (MakeHuman, CC0) model in `public/models/hero.glb`, with 16k triangles, a 53-bone skeleton and fingers. The low tier gets `hero-lo.glb` (5k).
    - Both come from `launch/brand/hero/export.py --game`. GLTFLoader loads them once, on the first 3D frame; until then the procedural hero stands in.
    - The suit's web is drawn from the model's own web coordinates, with baked per-limb AO in the cel bands.
    - Elbows and knees bend on hinges, and the fingers close from open to a fist.
    - **Motion capture:** Quaternius' Universal Animation Library (CC0), retargeted by `launch/brand/hero/retarget.py` into `public/models/hero-anims.glb`.
      - On the roof he stands on the mocap idle over planted, hip-width feet with his weight on one leg.
      - He walks, jogs and sprints on phase-locked cycles blended by speed. The phase advances by distance, so the feet don't slide.
      - He lands, flinches, punches (when a villain in reach is hit) and falls into the ragdoll with clips.
      - The swing, climb, dash and slam stay physics poses. The web hand, the planted feet and the head's glances are re-solved on top of the clips.
  - **The rest of the cast** are real human bodies too: MPFB bodies on the hero's skeleton, made by `launch/brand/hero/build_cast.py` from the table in `cast.py` into `public/models/cast-<id>.glb` (about 7–8k triangles, with a 2.6–3.4k body for distance) and `cast-<id>-lo.glb` (the low tier's). Only the current night's bodies load: its villains, the allies of its errands, and Gwei's once a fight starts. The procedural body (tubes swept along the bones, a lathed head) stands in for each until its file arrives.
    - **Looks:** clothes are colour zones cut along planes (sleeves, waistlines, necklines, a V) plus extra meshes where the silhouette needs them (a skirt, coat tails, hoods, hair caps, a bun, pixel hair) and rigid props (glasses, a tie, pearls, a cigar, Doc's harness, the glider). The bear, burger and goblin heads are sculpted pieces on the head bone. Faces are the stickers' features as shader decals on the face's plane (eyes, brows, mouths, teeth, blush).
    - **Motion:** the same motion capture as the hero plus the cast's extra clips (`cast-anims.glb`), played as moves from each body's own rest pose and laid over each animator's physics (`anim/clip-layer.ts`). Allies idle, reach out (Interact) and talk when their errand opens, wave when the hero swings close and turn to face him; Gwei perches in a crouch. Villains hold a stance, attack with punches, a throw or a cast, flinch when struck and fall into their webbed or caught presentation. Sandwich Man runs and jumps on clips phase-locked to the ground he covers; Gas Goblin rides his banking glider; Doc and the Sybil tread the air. Planted feet, Doc's chains, the cocoons and the dangle stay physics on top.
  - Cel shading with three hard bands from one fixed light and the city's dot pattern in the shadow band. The ink outline is the same mesh skinned inside-out, with the city's width rule. The hero's web pattern is drawn in the shader (on Gwei's mask too).
  - Two draw calls per body; the Sybil's copies are one instanced pair that reads three poses from a packed bone texture.
  - **Animation is driven by the sim's motion, never canned alone.** The sim's v1.2 render fields (action, facing, rope length, villain velocity, bank and Doc's arms) feed a presentation-only physics kit on a fixed 120 Hz step: critically damped springs, Verlet chains and a light ragdoll, two-bone IK and FABRIK. Nothing in it is read back by the sim, so ranked replays are unaffected.
  - **Swing:** the hips sit on the sim position, the body aligns with the rope, the web fist is pinned to the line by IK, and limbs trail from the arc's acceleration. **Run:** the stride advances by distance travelled, with foot IK to the roof. Doc's chain arms are Verlet chains pulled to the sim's arm tips. Caught villains dangle in a web.
  - `/lab/cast` shows every character in every state, with a physics debug overlay.
- **Web:** a strand from the hero's fist to the exact anchor. It shoots out over about 100 ms, goes taut, and falls slack on release or a miss. Effects ("POW!", "THWIP!") are pooled quads built with `starburst` from `src/sim/render/draw.ts`.
- **Camera** (`scene/camera/chase.ts`, reworked in November after playtesting):
  - Yaw follows a travel heading, the horizontal velocity through two 0.6 s low-pass stages, so a swing's back-and-forth cancels out. It turns only past a 20° dead zone, at most 90°/s.
  - Mouse look (pointer lock on the first click; Esc frees it), drag or two-finger orbit take over the camera, and so does holding the stick off-forward. That breaks the loop between camera-relative steering and the camera. Auto-follow eases back 2 s after the last input.
  - Height follows through a dead band and a soft spring, so the pendulum doesn't pump the view. Look-ahead and the pull toward a new web anchor are smoothed.
  - Arenas: a two-shot side chosen from 12 by available room, with pitch capped at 23°.
  - Buildings and props between the camera and the hero, or the fight two-shot, fade to a dot-screen ghost (`city/occlusion.ts`). Collision pull-in eases instead of snapping.
  - Reduced motion: fixed field of view, no speed lines and no shake.
- **Controls:**
  - **Touch:** left 40% is a floating stick (the hero only runs on it; without it, webs still aim for the next stop, so one thumb holding the web travels); right 60% is hold to web; ability buttons sit in a right-thumb arc; two fingers orbit the camera.
  - **Keyboard:** WASD or the arrows, Space or the mouse to web, 1–4 powers, G for Gwei, M for the map, Esc or P to pause.
- **City life and comic finish:** instanced, GPU-driven traffic on street loops, street lamps and signals, crosswalks, parapets, cornices, fire escapes and varied roofs; halftone dots on shadow faces and distant fog bands; speed lines at high speed; ink outlines thicker near the camera.
- **Quality tiers:** low, medium (the phone default, DPR 1.5) and high, with adaptive DPR and an FPS probe. Ported from blastoff `session/quality.ts`, `gpu.ts` and `camera-fx.ts`, with a context-loss guard. Low drops cars, halftone, speed lines and small details first. The budget is under 100 draw calls (about 50 at most in play today) and about 80k triangles on high, characters included.
- **Reused as-is:**
  - HUD, sheets and results (`src/sim/ui/*`), `src/audio/*`, the screen-reader live region and the reduced-motion choice.
  - `src/sim/loop.ts` becomes `src/game3d/session/loop3d.ts`, plus a recorder that writes to IndexedDB.
- **Fallbacks:** without WebGL, the 2D sim (unranked); `/play/classic` stays.

## 3. Backend (Neon via Vercel Marketplace, Drizzle; `apps/wgp/src/server/`)
- **Schema:** `players`, `auth_sessions`, `session_keys`, `saves` (the `Save` as JSONB with a revision number), `runs`, `leaderboard_entries`, `seasons`, `items_mirror`, `chain_ops` (outbox), `budget_counters`.
  - `runs` holds the seed, ruleset, input log, verified score, stats, checkpoints, digest and status.
  - `leaderboard_entries` is keyed by board, period and player.
- **Routes** (Node runtime, body-size caps, rate limits; Postgres budgets for anything that costs money):

  | Route | What it does |
  |---|---|
  | `POST /api/runs/start` | Issues an HMAC seed and the save revision; at most 1 active run and 20 ranked runs a day |
  | `POST /api/runs/:id/submit` | Idempotent. Decodes and replays the log, then checks the ruleset, at least 20 s of game time, game time ≤ wall time + 60 s, and the client's final state hash. On accept, one batch updates the save, upserts the boards and queues mints, then refreshes the leaderboard cache. |
  | `GET /api/leaderboard?board&period&around=me` | Leaderboard query, cached about 15 s |
  | `GET /api/runs/:id/replay` | Log and seed, so anyone can re-verify a run |
  | `POST /api/actions` | Menu actions (create-hero, pick-power, set-loadout, vote, sleep…) reduced on the server |
  | `/api/me`, `/api/migrate`, `/api/cron/sweep` | Account, local-save migration, cleanup |
  | `GET /api/market`, `/api/market/listings`, `/api/market/me` · `POST /api/market/trade` · `GET /api/cron/market-snapshot` | The Mempool Market: cached prices and listings, the player's wallet, simulated trades before the contract's market is live, price snapshots |
  | `GET /api/cron/mint` | The mint worker: claims up to 20 queued mints in per-account nonce order, sends them with the operator key, records each outcome (applied, duplicate, out of order, full). 503 before claiming anything without NEAR settings |
  | `GET /api/chain/status` | The signed-in player's chain view: quick play (live session keys), the hero's registration, the contract's `get_player` |
  | `GET /api/seasons`, `GET /api/seasons/:id/results` | The seasons and their status; a closed season's results file with every leaf's Merkle proof |
  | `POST /api/auth/{wallet,privy,near-auth}` (+ `/api/auth/privy/claim`, `/api/auth/dev` locally) · `POST /api/relay/meta`, `/api/relay/fast-auth` | Sign-in (§5) and the relayer (§5, Relayer and wallets) |

- **No cron jobs** (they bill whether or not anyone plays). Background work runs after player requests with Next's `after()`, only when due (`src/server/background.ts`, windows kept in `budget_counters` across instances): reward mints and season records after every verified run and on chain-status reads (at most every 15 s), the sweep at most every 10 minutes, market snapshots on market reads at most every 30 minutes, and the season pass (mark a started season live; close an ended one once, freezing its standings and queuing `record_season`) on any of those triggers or a leaderboard read, at most once a minute and only when a start or a freeze is due. The `/api/cron/*` routes remain as manual triggers behind `CRON_SECRET`.
- **On-chain player actions:** a new or imported hero queues a `register_hero` outbox row that waits for the player's session key. With quick play on, the browser signs `register_hero`, `craft_suit` and `equip_suit` with the session key, the relayer lands them, and the relay route mirrors the result into the database (the hero row marked sent; the save crafted or re-suited by the same reducer). Without quick play, craft and equip only change the save, and the UI says "saved, not yet on chain".

- **Boards:** Tonight (nightly best), Season (sum of nightly bests, S1 Nov 5–14) and All-time. A new `/play/leaderboard` tab, in the sticker kit.
- **Progression:**
  - Guests keep local play, unranked.
  - On first sign-in, `/api/migrate` imports the local save, sanitized: level capped at 3; inventory as a one-time capped mint plus a "Day one" trophy.
  - After that the server is authoritative. `useGame()` keeps its API (optimistic reduce, then reconcile with the server).

## 4. NEAR contract (`contracts/wgp`, near-sdk 5.30, cargo-near 0.22, Rust 1.95)
- **Our own NEP-245 multi-token core** (there is no usable crate). It mirrors the `defuse_nep245` signatures and the event JSON so NEAR Intents can read it.
  - **Token ids:** `item:*`, `suit:*`, `trophy:*`, `hero:<account>`.
  - **Transfers require 1 yocto,** so a session key can never move assets.
  - Heroes and trophies are soulbound.
- **Functions:**
  - **Heroes:** `register_hero(name, suit)`, called by the session key.
  - **Rewards:** `mint_rewards(batch)`, operator-only, idempotent through a per-account nonce, with the run digest in the event log.
  - **Crafting:** `craft_suit` and `equip_suit`, called by the session key, checking recipes and level.
  - **Seasons:** `record_season(id, root, top10, digest)`, which is immutable and mints trophies; the published leaves let anyone verify.
  - **The Mempool Market** (`market.rs`; see "The Mempool Market" below): `market_buy`, `market_sell`, `list_item`, `buy_listing`, `cancel_listing`, all session-key callable with no deposit.
  - **Admin:** pause, `set_market_params` and `upgrade` (which runs `migrate`: v1 → v2 adds the market).
- **Storage:** sponsored by the contract and bounded per player (64 token kinds max, 3 open listings). That's about 1 KB (plus ~750 bytes for an active trader), or roughly 0.01 NEAR on mainnet; nothing is stored per run or per trade. The code itself is ~360 KB, ~3.6 NEAR of storage.
- **Tests:**
  - `cargo test` unit tests: nonces, recipes, 1-yocto rule, soulbound, operator auth, season immutability, event JSON.
  - near-workspaces sandbox tests of the built wasm in `contracts/wgp/sandbox` (S5 passed: `docs/spikes/near-workspaces.md`).
  - `scripts/near/e2e-chain.ts` on testnet or mainnet (`NEAR_NETWORK`), with tiny amounts and an in-memory database.

## 5. NEAR SDKs and Google sign-in
- **Packages:**
  - `@privy-io/react-auth` 3.51 (browser) + `@privy-io/node` 0.37 (server): Google sign-in today, with a Privy NEAR embedded wallet.
  - `@fast-auth-near/browser-sdk` + `javascript-provider` (NEAR Auth): Google sign-in once NEAR approves our mainnet client.
  - `@hot-labs/near-connect` for existing NEAR wallets (`src/lib/near/wallet.tsx`, ported from Vessel).
  - One `near-api-js` ≥7.4 on client and server for meta-transactions.
- **Server accounts** (keys in Vercel env only; mainnet names, testnet uses `wgp.testnet` and so on):
  - `wgpnear.near`, the factory, creates `<handle>.wgpnear.near` (made by `scripts/near/setup-mainnet.sh`).
  - The relayer, `relayer.wgpnear.near`, pays gas. `RELAYER_PRIVATE_KEYS` takes one or more keys (mainnet runs one today).
  - The operator, `operator.wgpnear.near`, mints and records seasons; the contract lists it in `get_config().operators`.
- **Which Google service:** `NEXT_PUBLIC_GOOGLE_SIGN_IN=privy|near-auth`, defaulting to `privy` when `NEXT_PUBLIC_PRIVY_APP_ID` is set (`src/lib/privy/config.ts`). NEAR wallet sign-in is always offered.

### Google through Privy (live now)
NEAR Auth's mainnet client is waiting on NEAR's approval, so Google sign-in goes through Privy until then. Privy gives each user a NEAR embedded wallet: an ed25519 key ("Tier 2" chain support) whose address is its implicit account id, and which signs raw hashes.
- **The browser** (`src/lib/privy/`, `src/components/account/privy-host.tsx`):
  - Privy's SDK is a lazy chunk, mounted only when the sign-in sheet opens, a Google redirect comes back, or a Privy player opens their account; `/` and `/play` don't load it.
  - "Continue with Google" is a full-page redirect to Google (`useLoginWithOAuth`). Back on our page, Privy finishes the login from its `privy_oauth_*` parameters, the browser makes the user's NEAR wallet if they have none (`useCreateWallet({ chainType: "near" })`), then posts Privy's access token and its session key to `POST /api/auth/privy`.
  - Sign out also logs out of Privy.
- **The server** (`src/server/auth/privy*.ts`):
  - Checks the access token with `@privy-io/node` and `PRIVY_APP_SECRET`: ES256 against the app's keys, issuer `privy.io`, audience our app id, not expired; we check the returned claims again.
  - Reads the user from Privy's API by the token's user id: the verified Google email and the NEAR wallet's key. Nothing the browser says about them is used.
- **Who the login is** (`privySignIn`):
  - A known player (`auth_kind = privy`, `auth_sub` = the Privy user id) is signed in.
  - A player with the same verified email (they signed up through NEAR Auth) is signed in too: no second hero.
  - **A new player, factory live:** the same `needs-handle` step as NEAR Auth, then one factory transaction creates `<handle>.wgpnear.near` with the Privy NEAR key (full access) and the browser's session key (game contract only). An account that already holds the user's key (a retry after a lost answer) is adopted.
  - **A new player, factory not live** (not configured, or `wgpnear.near` not on chain yet; one cached `view_account`): no handle step. The player is made on their key's implicit account id (64 hex) and plays ranked nights at once.
- **Unclaimed players** (`isUnclaimed`: Privy, on an implicit account id, which doesn't exist on NEAR):
  - Nothing is sent on chain for them. Reward mints are queued as usual but held (the mint worker skips them); no hero registration; quick play is off.
  - Once the factory is live, the account sheet offers **"Claim your name"** (`GET`/`POST /api/auth/privy/claim`). The server reads the user's NEAR wallet from Privy again (it must be the key of their implicit account), the factory creates `<handle>.wgpnear.near` with it and the browser's session key, and one transaction moves the player there: the player row, the held mints (now addressed to the new account; their nonces start at 1, which is what a fresh account expects), the chain mirror, price history and the simulated market's wallet. Save, runs and boards are keyed by the player, so they don't move.
- **Quick play on a new device:** the Privy NEAR key signs `AddKey(session key)` as a delegate (raw-hash signing, no popup) and the relayer submits it, like NEAR Auth's add-key flow.

### Switching to NEAR Auth later, without losing anyone
- **Linking by verified email:** every Google player stores their verified email (`players.email`, migration `0004_privy_email`). `POST /api/auth/near-auth` looks a login up by its Google sub, then by the token's email when Auth0 marks it verified, so a Privy player who signs in through NEAR Auth gets their own hero back. The reverse holds too. Only across the two services: within one, a login with a new subject is another Google account (a recycled mailbox, a re-registered domain), so it never takes over a player by email.
- **What stays with Privy:** the full-access key of a Privy player's account is their Privy NEAR key (exportable from Privy). A NEAR Auth sign-in into that player plays fine; adding the NEAR Auth key to the account (for NEAR Auth's own new-device popup) is a later, one-time Privy-signed `AddKey`.
- **To switch:** set `NEXT_PUBLIC_GOOGLE_SIGN_IN=near-auth` and NEAR Auth's mainnet client id; keep the Privy variables so existing Privy players can still sign out and in again during the move.

### Google through NEAR Auth (Plan A, waiting on mainnet approval)
- **Sign-up (Plan A):**
  1. A single Google login.
  2. The browser creates a session key.
  3. The server checks the login and derives the user's MPC-controlled key from `v1.signer-prod.testnet`.
  4. One transaction creates `<handle>.wgp.testnet` with the user's key plus the session key (game contract only, 0.05 NEAR gas allowance).
  5. No signing popups during play.
- **Fallbacks:**
  - **Plan B:** NEAR Auth creates the account, then one popup adds the session key.
  - **Plan C:** contract-level session keys, verified with `ed25519_verify`.

### Relayer and wallets
- **Relayer (`/api/relay/meta`)** accepts only:
  - a known player and live session key;
  - the game contract as receiver;
  - exactly one function call with zero deposit and an allowlisted method;
  - ≤ 30 Tgas and a short expiry.

  Plus per-account, per-IP and per-device rate limits, a daily gas budget and a balance circuit breaker.
- **near-connect users:**
  - Sign in by signing a message (NEP-413) against a server nonce.
  - "Enable quick play" adds a session key once.
  - Plan C covers wallets that refuse.

## The Mempool Market (the economy)
- **Bits** (`item:bits`) are the currency: every verified night mints `floor(score / 100) + 5` (+25 on a level-up, +1 per Bits token collected up to 25 since ruleset 3, at most 1,000) with its loot, through `mint_rewards` (`src/lib/market/rewards.ts`, `runs.ts`). The tokens come from the verified replay's stats; the results screen shows the server's number.
- **The vendor, Gwei Stacy,** is an NPC whose stock and till the contract holds. Each item has a virtual-reserve constant-product curve: `x = virtual_items + stock`, `y = virtual_bits + bits`, spot `y / x`. Buying `n` costs `ceil(y·n / (x − n))` (only from stock), selling pays `floor(y·n / (x + n))` (only from the till). Defaults: commons start at 12 Bits, uncommons 40, rares 150, half of each curve's Bits real.
- **Sinks:** a 2% gas fee on every trade and fill is burned, and crafting burns its recipe's items. Crafting can burn Bits too (`craft_bits`): it's 0 on mainnet until the Suit lab shows it. `/lab/economy` runs mainnet's settings by default and has a **Recommended settings** switch (250 Bits a suit, 5% fee); `docs/ECONOMY.md` is the balance report behind it.
- **Listings** escrow items in the contract; a buyer pays the seller the price less the fee.
- **Abuse guards** (a stolen session key): listing prices within 50%–400% of the vendor's spot price, daily caps per account (40 vendor trades, 10 listings, 10 fills, 3,000 Bits of fills), 3 open listings each, 300 overall, 20 items a call. Transfers still need 1 yocto.
- **Storage:** one small market entry per trader plus its open listings (a trader with 3 listings: ~750 bytes). The contract's own `mt_balance_of` includes the vendor's stock, till and escrow, matching the transfer events.
- **Server** (`src/server/market/`): cached views (`/api/market`, `/api/market/listings`, `/api/market/me`), a price-history table (`market_prices`, migration 0003) written by every trade and by `/api/cron/market-snapshot`, and the relayer's hooks that mirror an on-chain trade's items into the save.
- **Before the contract's market is live** (no NEAR config, no contract, an old contract or no pools), the server runs the same rules (`src/lib/market/engine.ts`) on a simulated book (`market_sim`), flagged `onChain: false`; `/api/market/trade` takes its trades. `src/lib/market/math.ts` mirrors the contract's math; both test against `contracts/wgp/market-vectors.json`.
- **UI:** `/play/market` (Gwei's stall, listings, buy/sell/list sheets), the markets column in The Daily Rug, "You earned N Bits" on night results, and `/lab/economy`, a fast-forward of bot players on the same engine.

## 6. Day-one spikes (Nov 2–3, results in `docs/spikes/`)
- **S1, NEAR Auth on testnet (shared dev client):**
  - Which contract it uses: `fast-auth.testnet` or `fast-auth-beta-001.testnet`; the docs disagree.
  - Whether it can make named or sub-accounts.
  - Whether there's a server-verifiable token.
  - Whether it can sign AddKey as a delegate action.
  - The answers pick Plan A, B or C.
- **S2:** a relayed session-key meta-transaction, plus proof that two actions or a deposit are rejected; zero-balance account creation.
- **S3:** golden replay hashes match across Node and the three browser engines.
- **S4:** a phone performance test with 600 instanced boxes, outlines and extruded cards.
- **S5:** near-workspaces with near-sdk 5.30.

## 7. Milestones (parallel agents with file ownership; one PR per milestone)

The original plan. M0–M3 landed by Nov 3, ahead of these dates, with Privy standing in for NEAR Auth; M4 is under way.

| Milestone | Dates | Work | Gate |
|---|---|---|---|
| **M0** | Nov 2–3 | Workspace and game-core move, spikes, freeze shared types | Simulate and sim-check output identical; spike memo |
| **M1** | Nov 4–6 | Core (city, rope, anchors, input log, replay, bot); Scene (`/lab/city` toon city, outlines, cards, camera); Backend (schema, migrations, auth sessions); Chain (NEP-245, heroes, rewards, craft, unit tests) | Bot clears 30 nights; golden hashes match; under 60 draw calls at 60 fps; migrations apply on a Neon branch; contract tests pass |
| **M2** | Nov 7–9 | Playable 3D night (Goblin and Sandwich Man first); touch and quality tiers; start, submit and leaderboard; testnet deploy; account and session key; relayer; crafting | Phone at 30 fps or better; a real run verifies and ranks; a craft lands on testnet |
| **M3** | Nov 10–11 | Doc and Sybil in 3D; server-authoritative saves and migration; outbox mints; NEAR Auth end to end; near-connect; seasons | `e2e-chain.ts` passes sign-up → run → verify → mint → craft → board; relayer abuse suite all rejected |
| **M4** | Nov 12–13 | Performance, accessibility, security review, load test (50 concurrent submits), docs, demo; freeze Nov 13 | Clean-clone build; accessibility checklist |
| **Submit** | Nov 14 | Submission, on your go | |

**Owners** (read anything; edit only your own folders):

| Owner | Folders |
|---|---|
| Lead / integrator (me) | root workspace, `next.config.ts`, shared types, docs, PRs |
| Core | `packages/game-core` |
| Scene | `src/game3d/scene`, `/lab` |
| Play | `src/game3d/{session,input}`, patrol page, `src/sim/ui` |
| Backend | `src/server/{db,auth}`, run, leaderboard and action APIs, `drizzle/`, `store.ts`, leaderboard page |
| Chain | `contracts/wgp`, `src/server/near`, `src/lib/near`, auth and relay APIs, `scripts/near`, sign-in UI |

**Cut order if behind:**
1. Post-process outlines.
2. Replays and ghosts.
3. Gamepad.
4. Extruded cards (use flat ones).
5. Session keys for wallet users.
6. On-chain trophies (keep the season root).
7. Sandbox tests.
8. Simpler Doc and Sybil.
9. A smaller city.

**Never cut:** replay verification, leaderboards, NEAR Auth with a session key, the relayer, NEP-245 mints, classic mode.

## Risks
- **Mobile 3D performance:** instancing, unlit shaders, DPR ≤ 1.5, adaptive tiers, lazy-loaded; fallback to 2D or classic.
- **Determinism drift:** dmath plus the lint ban, raw-bit hashes, the cross-engine gate, pinned ruleset, checkpoint hashes to locate a desync.
- **Good bots:** replay stops forged scores, not skilled bots. Sign-in required for the board, daily caps, wall-time ≥ game-time, and the built-in autopilot (`?autopilot=1`) never plays a ranked night in production. A review flag on top runs isn't built.
- **NEAR Auth:** its mainnet approval is still pending, so Google sign-in runs through Privy on mainnet (§5) and switches later without losing players. Its unknowns are covered by Plans A/B/C, and Plan C works with any signer.
- **Relayer abuse:** strict decoding, allowlist, budgets and separate keys.
- **Costs:** bounded storage per player; digests live in logs, not state.
- **Motion sickness:** reduced motion (fixed FOV, no roll or shake), a comfort menu, the slow-motion assist, one-thumb auto-heading, and classic mode.

## Verification
- **Every PR:**
  - `pnpm -r typecheck` and `pnpm -r lint`;
  - `pnpm --filter @wgp/game-core test` (unit tests, golden replays, bot over 30 nights);
  - `pnpm --filter wgp build` and `cargo test`.
- **Determinism:** `/lab/determinism` in Chromium, WebKit and Firefox must match Node. There's no Playwright harness in the repo yet: Chromium and WebKit were checked by hand against the live site on Nov 3.
- **Gameplay:** headless screenshots and autopilot runs at 390×844 and 1440×900 (the existing CDP scripts), plus a phone FPS probe through `?debug=1`.
- **End to end on testnet or mainnet** (`NEAR_NETWORK`): `scripts/near/e2e-chain.ts` runs sign-up → a bot-played run → submit → verified score on the board → reward mint visible with `mt_balance_of` → a craft through the session key and relayer. A session-key attempt at `mt_transfer` must fail.
- **Security:**
  - The relayer abuse suite: wrong receiver, a deposit, two actions, an unknown sender and rate limits are all rejected.
  - A load test of 50 concurrent run submits.
