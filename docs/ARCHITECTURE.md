# Architecture: With Great Power in 3D

The build plan for the 3D game, its leaderboard, NEAR contracts and Google sign-in. Milestone PRs implement it in order; when code and this document disagree, fix one of them in the same PR.

## Architecture
A pnpm workspace at the repo root. Only the deterministic core becomes a package.

```
packages/game-core/   @wgp/game-core: pure TS (rules + 3D sim + input log + replay), vitest
apps/wgp/             Next.js: 3D client (R3F), API routes, DB, NEAR wiring
contracts/wgp/        Rust, near-sdk 5.30 (Vessel conventions)
scripts/near/         testnet deploy, chain e2e, season recording
docs/                 ARCHITECTURE.md, INTERFACE.md, spikes/
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
- **Rope in 3D:** gravity → air steer → pump → reel → integrate → project onto the rope sphere and drop outward speed → collide with boxes (land on roofs, slide on walls) → the street or river is a miss. Two substeps above 1,200 u/s.
- **Release grading uses no trig:** constant tangent bounds replace `atan2`. Since ruleset 2 the perfect window is 20–60° above horizontal, where a swing naturally releases.
- **Anchor choice ignores the camera.** Heading comes from the stick (one of 64 literal directions), else the bearing to the next stop (one-thumb play), else the villain, else velocity. Since ruleset 2 (`sim3d/swing.ts`) it picks among roof-edge and facade points ahead and up on the buildings flanking the travel line, scored by a short forecast of forward progress and clearance; it never webs behind or straight overhead. Ties break deterministically.
- **Determinism rules:**
  - Banned in the core, enforced by ESLint: `Math.sin/cos/atan2/hypot/pow/random`, `**`, `Date` and `performance`.
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
  - Combo, HP left and a time bonus.
  - Ties go to the faster run.
- **Gate:**
  - Golden logs give identical hashes in Node and in Chromium, WebKit and Firefox (dev page `/lab/determinism`).
  - A bot clears 30 nights with no NaN.

## 2. 3D client (React Three Fiber, lazy-loaded on `/play/patrol` only)
- **Stack:** three 0.186, @react-three/fiber 9.8 and drei 10.7 (blastoff's proven versions).
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
  - **The rest of the cast** is one procedurally built `SkinnedMesh` each: tubes swept along the bones with blended weights, a lathed head, and rigid extras (glider, goggles, cigar, sandwich stack).
  - Cel shading with three hard bands from one fixed light and the city's dot pattern in the shadow band. The ink outline is the same mesh skinned inside-out, with the city's width rule. The hero's web pattern is drawn in the shader.
  - Two draw calls per body; the Sybil's copies share one skeleton.
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
  - **Touch:** left 40% is an optional floating stick (the default steers you to the next stop); right 60% is hold to web; ability buttons sit in a right-thumb arc; two fingers orbit the camera.
  - **Keyboard:** WASD, Space or mouse to web, 1–4, G, Esc.
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
  | `POST /api/runs/:id/submit` | Idempotent. Decodes and replays the log, then checks the ruleset, that game time ≤ wall time + 60 s, and the checkpoints. On accept, one batch updates the save, upserts the boards and queues mints, then refreshes the leaderboard cache. |
  | `GET /api/leaderboard?board&period&around=me` | Leaderboard query, cached about 15 s |
  | `GET /api/runs/:id/replay` | Log and seed, so anyone can re-verify a run |
  | `POST /api/actions` | Menu actions (create-hero, pick-power, set-loadout, vote, sleep…) reduced on the server |
  | `/api/me`, `/api/migrate`, `/api/cron/sweep` | Account, local-save migration, cleanup |

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
  - **Admin:** pause and `upgrade`.
- **Storage:** sponsored by the contract and bounded per player (64 token kinds max). That's about 1 KB, or roughly 0.01 NEAR on mainnet; nothing is stored per run.
- **Tests:**
  - `cargo test` unit tests: nonces, recipes, 1-yocto rule, soulbound, operator auth, season immutability, event JSON.
  - A near-workspaces sandbox if the S5 spike passes.
  - `scripts/near/e2e-chain.ts` on testnet.

## 5. NEAR SDKs and Google sign-in
- **Packages:**
  - `@fast-auth-near/browser-sdk` + `javascript-provider` (NEAR Auth).
  - `@hot-labs/near-connect` for existing NEAR wallets (port Vessel's `lib/wallet.tsx` from the archive).
  - One `near-api-js` ≥7.4 on client and server for meta-transactions.
- **Server accounts** (keys in Vercel env only):
  - `wgp.testnet` creates accounts.
  - `relayer.wgp.testnet` pays gas, using 4–8 keys.
  - `operator.wgp.testnet` mints.
- **Sign-up (Plan A):**
  1. A single Google login.
  2. The browser creates a session key.
  3. The server checks the login and derives the user's MPC-controlled key from `v1.signer-prod.testnet`.
  4. One transaction creates `<handle>.wgp.testnet` with the user's key plus the session key (game contract only, 0.05 NEAR gas allowance).
  5. No signing popups during play.
- **Fallbacks:**
  - **Plan B:** NEAR Auth creates the account, then one popup adds the session key.
  - **Plan C:** contract-level session keys, verified with `ed25519_verify`.
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
- **Good bots:** replay stops forged scores, not skilled bots. Sign-in required for the board, daily caps, wall-time ≥ game-time, and a review flag on top runs.
- **NEAR Auth:** mainnet approval may be late, so judging happens on testnet. Its unknowns are covered by Plans A/B/C, and Plan C works with any signer.
- **Relayer abuse:** strict decoding, allowlist, budgets and separate keys.
- **Costs:** bounded storage per player; digests live in logs, not state.
- **Motion sickness:** reduced motion (fixed FOV, no roll or shake), a comfort menu, the slow-motion assist, one-thumb auto-heading, and classic mode.

## Verification
- **Every PR:**
  - `pnpm -r typecheck` and `pnpm -r lint`;
  - `pnpm --filter @wgp/game-core test` (unit tests, golden replays, bot over 30 nights);
  - `pnpm --filter wgp build` and `cargo test`.
- **Determinism:** Playwright runs `/lab/determinism` on Chromium, WebKit and Firefox, and the hashes must match Node.
- **Gameplay:** headless screenshots and autopilot runs at 390×844 and 1440×900 (the existing CDP scripts), plus a phone FPS probe through `?debug=1`.
- **End to end on testnet:** `scripts/near/e2e-chain.ts` runs sign-up → a bot-played run → submit → verified score on the board → reward mint visible with `mt_balance_of` → a craft through the session key and relayer. A session-key attempt at `mt_transfer` must fail.
- **Security:**
  - The relayer abuse suite: wrong receiver, a deposit, two actions, an unknown sender and rate limits are all rejected.
  - A load test of 50 concurrent run submits.
