# Case File 001, "Missing: Mary Jpeg": the final contract

This is the contract the three builds share: gameplay and server (A, this branch), 3D art and scene (B), and UI (C). It's built from the chapter spec (`launch/out/chapters/case-001-spec.md`). Where this file and the spec differ, this file wins. Every difference is listed in [Deviations from the spec](#deviations-from-the-spec).

## Names

| Name | Value | Where |
|---|---|---|
| Chapter id | `CHAPTER_ID = "case-001"` (`ChapterId`) | `@wgp/game-core/chapters` (`src/rules/chapters.ts`), `@wgp/game-core/types` |
| Chapter rules | `CHAPTER_RULESET = "c001-1"` | `runs.ruleset` of every chapter run; the chapter verifier's `ruleset` |
| Log ruleset field | `chapterLogRuleset("case-001") = 0x0C001104` (hex "C 001 1 04": case 001, chapter rules rev 1, patrol ruleset 4) | the input log's ruleset varint (`sim3d/chapter.ts`) |
| Patrol ruleset | `RULESET_VERSION = 4`, unchanged | `sim3d/constants.ts` |
| Run mode | `runs.mode = "case-001"` (patrol runs keep `"patrol"`) | `apps/wgp/src/server/db/runs.ts` |
| Badge | `trophy:badge:case-001`, queued as `badges: ["case-001"]` through `mint_rewards` | `apps/wgp/src/server/db/cases.ts` |
| Badge outbox key | `badge:case-001:<playerId>` (one per player, ever) | `chain_ops.dedupe_key` |
| Page | `/play/patrol?case=001` (also `?case=case-001`) | `apps/wgp/src/app/play/patrol/night.tsx` |
| Content | `CHAPTERS["case-001"]`: number, title, villain (name, tagline, taunt, defeat), captive (name, "gm"), clue notes | `@wgp/game-core/chapters` |

No database migration is needed: `runs.mode` already exists (`text`, default `"patrol"`) and `save.cases` lives in the save's JSON.

## The night

A chapter is its own deterministic night in `packages/game-core`. It only runs when `SimConfig.chapter` is set (`startChapterRun`), so patrol nights never reach a chapter branch (`state.chapter` is `null`).

### The city
- **Built from the run's seed:** a patrol city with one stop, Doc's bridge over the river in the Bridge District (`chapterCity`).
- **The deck:** 480 wide (`CHAPTER_DECK_HALF = 240` either side of its line; a patrol deck is 240 wide), so the standoff has room to sidestep a SCREENSHOT. It is 1,360 long, the stage being `BRIDGE_HALF` either side of the middle.
- **The zone:** the bridge zone's `villain` is `"right-clicker"`.
- **The clues:** three on reachable roofs (170–480 high, at least 120 × 120 across), in the order `tabs`, `cursor`, `pixels`.
  - **Pixels:** 500–1,150 from the bridge's middle, so its trail leads there.
  - **Cursor:** at the foot of a billboard on its roof when one fits (`pos` equals that billboard prop's `at`). The tests require that on at least 30 of 40 seeds.
  - **Tabs:** another roof.
  - **Spacing:** the clues stand at least 850 apart and lie within a detour of the way from the start to the bridge. If no layout fits, the placement relaxes in two steps.
- **Mary Jpeg:** on the deck, `MARY_ALONG = 430` from its middle along the bridge (which end comes from the seed), at deck level. She is there from the start of the night.

### Phases (`chapter.phase`)

| Phase | Sim mode | What happens |
|---|---|---|
| `investigate` | `travel` | **Finding a clue:** the hero's centre comes within `CLUE_REACH = 140` of a point 26 above the clue across, and 1.5× that (210) up and down. No button needed, any order. **Before all three:** the bridge doesn't open, and `stopTarget` (the web's heading and the bot's goal) is the nearest unfound clue. **Pickups:** Bits tokens and rings line the way to the bridge as on a patrol night. |
| `standoff` | `travel`, then `intro` and `fight` on the deck, then `won` | **Arriving:** after the third clue, the hero heads for the deck, and arriving over it starts the encounter. **The fight:** against the Right-Clicker, by ruleset 4's grounded rules (below). |
| `rescue` | `fight` | **When:** after the win's beat (`WON_SECONDS`). **Restoring:** hold the web beside Mary (within `RESTORE_REACH = 170` across, 160 up or down). Restoring fills `RESTORE_TICKS = 180` (3 s) and pauses while hurt (`hurtT > 0`), frozen, or mid-blow. Beside her, a held web restores instead of striking or swinging; a fresh press with a copy in strike reach still strikes it. **The copies:** two come to interrupt, the first at once and the second at 40% restored or 4 s in. Each walks up, winds up 0.6 s and slaps (a paper cut, small damage, a short shove), then waits 2.2 s. One blow pops a copy. |
| `done` | `won` for `FREED_SECONDS = 2.5`, then `done` | **Mary:** she's free ("gm"). **Closing:** after the beat, `case-closed` then `night-over` (`"route"`). |

A knockout (`ko`) in the standoff or the rescue ends the night uncleared.

### The Right-Clicker (`sim3d/right-clicker.ts`)
**On foot:**
- **Stats:** level 2, so mercy is 2/3 (as for the early nights' villains: less damage, longer to get clear) and damage is 1.08×. 8 hits (`CHAPTER_HITS`), radius 44.
- **Movement:** he walks the deck at 200 × his rate (1.08), keeping about 300 from the hero (460 just after a hit) and circling.
- **Guard:** after a blow lands he guards 4 s. A blow in an opening goes through the guard.
- **Openings:** his reload after a flash, and the stagger of a broken drag. A blow in an opening leaves at most 0.3 s of it.
- **Knockback:** blows knock him along the deck; nobody is launched.

**Moves:** one every 1.0–1.6 s (before his rate), in turn: SCREENSHOT, CTRL+C, SCREENSHOT, DRAG. CTRL+C becomes a SCREENSHOT while copies stand, and DRAG becomes one when the hero is out of its range.

| Move | Wind-up (`villain-attack` label) | Effect |
|---|---|---|
| SCREENSHOT | `"Screenshot"`. Aim for `AIM_SECONDS = 0.9` (+0.2 at his mercy). The cone tracks the hero at 1 rad/s, then locks for the last 0.35 s. | **The flash:** the hero within the cone (`SHOT_HALF = 0.3` rad either side, out to `SHOT_RANGE = 950`, within 260 up or down) is SAVED: frozen 1.0 s (`SAVED_FREEZE`; the hero's action reads `held`), hurt (12 base) and his combo broken. Sidestep out to dodge. **Reload:** after the flash he reloads for 1.2 s (+0.13), open. The aim is committed: a blow flinches him but doesn't stop it. |
| CTRL+C | `"Ctrl+C"`, 0.6 s. | Two paper copies stand between him and the hero (45% of the way, at most 240 out, 75 either side) and keep that place as he moves. A blow on a copy pops it and never reaches him; a zip or strike picks the nearest body, so they really are in the way. |
| DRAG | `"Drag"`, 0.8 s (+0.2). | **The lasso:** a hero within 720 is pulled 200 toward him over 0.45 s, held there, then dropped with a small hit (7 base) if within 150 of him. **Breaking it:** any blow or zip started during the wind-up or the pull breaks it, and he staggers 1.0 s (+0.2), open. A cloaked hero isn't caught. |

### Determinism and verification
- **Same style as the patrol sim:** `dmath` trig, the sim's `roll()`, + − × ÷, `Math.sqrt` and `Math.floor`, integer HP and restore ticks. The determinism scan covers the new files.
- **The hash:** new villain phases (`aim`, `flash`, `copy`, `drag`, `stagger`) are appended to the hash's phase list. The chapter's fields are hashed after everything else, and only on chapter nights, so every patrol golden is byte-identical (`test/golden/*` and `src/golden.ts` are untouched).
- **The golden:** Case File 001 has its own, `test/golden/case-001-standard.{bin,json}` and `src/golden-case.ts`. Regenerate it with `UPDATE_CASE_GOLDEN=1 pnpm --filter @wgp/game-core test case-golden` after an intended chapter change, and bump `CHAPTER_RULESET` with it.
- **Runs:** `startChapterRun(save, seed, chapter)` plays the hero from the save at full health and fluid, with their loadout and one Gwei call. It needs no patrol and sends no engine actions; the save is untouched.
  - **Logging:** `runLog` writes `chapterLogRuleset`.
  - **Replaying:** `replayRun(input, { chapter })` (and `resumeRun`) replays a chapter. It refuses a patrol log (`ruleset 4 is not chapter case-001's 201330948`), and a patrol replay refuses a chapter log (`ruleset 201330948 is not 4`).
  - **Results:** `score` is 0. `stats.cleared` is 1 when Mary was freed and the case closed. Checkpoints are each clue, the win and her release.
- **Reading a run:** `chapterCleared(run)` and `chapterStats(run)`.

## Render contract (v1.5, additive; nothing here is read back by the sim or hashed)

```ts
// RenderFrame3D (sim3d/contract.ts)
chapter?: {
  id: "case-001";
  phase: "investigate" | "standoff" | "rescue" | "done";
  clues: { id: "tabs" | "cursor" | "pixels"; pos: Vec3; found: boolean }[]; // roof level; always 3, in this order
  captive: { pos: Vec3; restore: number /* 0..1 */; freed: boolean } | null; // deck level; set for the whole chapter
  copies: { id: number; pos: Vec3; yaw: number; alive: boolean }[];       // by id; popped ones stay (alive: false)
} | null;                                                                  // null on patrol nights

// RenderFrame3D["villains"][number]
id: "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil" | "right-clicker";
state: string; // the Right-Clicker's: "idle" | "aim" | "flash" | "recover" | "copy" | "drag" | "stunned" | "webbed"
aim?: { dir: Vec3; half: number } | null; // the Right-Clicker only: during "aim" and "flash", else null; dir is unit xz (y = 0) from his pos

// Zone (city): villain gains "right-clicker"
```

- **A copy's `pos`:** the cutout's centre, `COPY_HALF_H = 44` above the deck (its feet are at `pos.y - 44`). Its collision radius is `COPY_RADIUS = 30`. `yaw` turns the cutout's front (+z) to face `(sin yaw, 0, cos yaw)`, toward the hero.
- **The Right-Clicker's state:** "aim" and "flash" show over a flinch. "stunned" covers a flinch and the broken-drag stagger. "webbed" runs from the win to the end (the rescue and the freed beat included). `stateTicks`, `vel` and `facing` work as for every villain, and `hits`/`hitsMax` count down from 8.
- **The rescue's frame:** `frame.mode` is `"fight"` (the hero can be hurt by copies). The freed beat is `"won"`.
- **The blend:** `game3d/session/blend.ts` carries `chapter` and `aim`. The copies slide between ticks; the rest is the latest tick's.

## Sim events (`SimEvent`, chapter nights only)

| Event | Fields |
|---|---|
| `clue-found` | `id`, `x, y, z` (the clue), `found` (so far, 1–3), `of` (3) |
| `screenshot` | `hit` (SAVED or not), `x, y, z` (the Right-Clicker) |
| `copy-spawn` | `id`, `x, y, z` |
| `copy-pop` | `id`, `x, y, z` (hit, or swept away by the win or Mary's release) |
| `drag` | `from: Vec3` (the hero), `to: Vec3` (where the lasso pulls him) |
| `captive-restore` | `p`, 0–1, every 15 ticks of restoring and at 1 |
| `captive-freed` | `x, y, z` (Mary) |
| `case-closed` | `id: "case-001"`, `ticks` (the clear time) |

Also on chapter nights:
- **The usual fight events:** `encounter` and `fight-won` (`villain: "right-clicker"`), `villain-hit`, `clang`, `hero-hurt` (sources `"a screenshot"`, `"drag and drop"`, `"a paper cut"`) and `villain-attack` (labels `"Screenshot"`, `"Ctrl+C"`, `"Drag"`, `"Paper cut"`).
- **`combo-end`:** can carry `reason: "saved"`.
- **`stop-done`:** never sent on a chapter night.

## For C: HUD, session and ending

- **Starting:** `/play/patrol?case=001` boots the chapter through the same three ways as a night (`game3d/session/night.ts`):
  - **Signed in:** `beginRanked({ chapter })` starts the server's chapter run (verified, never ranked).
  - **Guest:** `beginLocalChapter(save, chapter, "guest")` on a local seed (`chapterLocalSeed`).
  - **Unranked:** `beginLocalChapter(save, chapter, "unranked", playerId)` when the server can't start one.
  - **Not tied to tonight:** a chapter opens on any night, done or not.
- **The session:** `NightSession.chapter` is the chapter id, or null on a patrol night.
- **The recording:** `loadRecording(chapter)` and `clearRecording(chapter)` keep the case's own record, so a reload resumes a case in progress.
- **HUD snapshot:** `HudSnapshot.chapter` (`src/sim/loop.ts` `ChapterHud`, filled by `chapterHud(s)`):
  ```ts
  { id: "case-001"; phase; cluesFound: number; clues: 3;
    villain: { name: "The Right-Clicker"; hits; hitsMax; state /* the render state word */; open /* a blow lands now */; guard } | null;
    saved: boolean /* frozen by a SCREENSHOT now */; restore: number /* 0..1, two decimals */; beside: boolean /* beside Mary */; freed: boolean }
  ```
  - **The patrol `villain` field:** set for the Right-Clicker through the standoff, so on a phone the minimap gives its place to the villain bar. Its `kind` is `"right-clicker"` (`HudSnapshot.villain.kind` widens to `VillainId | "right-clicker"`), and `name` is "The Right-Clicker". `opening` means his reload or stagger, and `guard` his guard. It is null in the rescue, when he's beaten.
  - **No sticker face yet:** the patrol villain bar skips its face for him, and `WonCaption` isn't shown for him.
  - **`chapter.villain`:** adds his state word. Show "Saving…" while `state === "aim"`, and "Open: hit him" while `open`.
  - **Clue pins:** come from `frame.chapter.clues`.
- **The ending:** `endNight` answers `NightOutcome` `{ kind: "case", chapter, cleared, ticks, filed: "verified" | "local" | "unranked", firstClear, record: CaseRecord, badge: { status, tokenId, tx } | null, runId, save }`.
  - **Failures:** a failed submit is `submit-failed`, a refused log `rejected`.
  - **A guest's clear:** it closes the case in the browser's save, unverified, so the ending shows "Sign in to file the case".
  - **Placeholders to replace:** `NightResults` hands chapters to `app/play/patrol/case-results.tsx`, a plain placeholder for C's "Case closed" ending. The patrol's `EncounterBanner` and `WonCaption` are skipped on chapter nights (C's own banner goes there).
- **Copy:** `CHAPTERS["case-001"]` holds the clue notes, the villain's lines and Mary's "gm". `villainCard(id)` gives any villain's name and lines, the Right-Clicker's included.
- **The case files page:** `GET /api/cases` (below). The browser helper `getCases()` comes from the UI build; this branch adds none, to keep the merge clean.

## For B: scene

The 3D art (B's build) is in `src/game3d/scene/chapter/` and the cast's files; `/lab/case` drives it on fixture frames.

- **The Right-Clicker:** a cast body like the rest (`public/models/cast-right-clicker{,-lo}.glb`, from `launch/brand/hero/build_cast.py` and `cast.py`), his clips in `right-clicker-anims.glb` (`rc_anims.py`, fetched only on a chapter night). A villain in `characters/characters.ts` like the others; `characters/anim/right-clicker.ts` poses his states, squared to `aim.dir` while he aims, and lies beaten from `webbed`.
- **`ChapterScene` (`chapter/chapter.ts`):** built on a chapter frame's first arrival, so a patrol night pays nothing. Hooked in `engine.ts`; the chapter's events reach it through `session/effects.ts` (`SceneHandle.chapter`).
  - **Clues (`clues.ts`):** the torn MISSING poster on a pole (tabs), a pointer scorched into a billboard (cursor: the city's own billboard when the clue stands at its foot, else one of its own), a trail of Mary's pixels toward the bridge. Each glows until found, then dims; "+CLUE!" when one is.
  - **SCREENSHOT (`flash.ts`):** the cone on the deck for the whole `aim` (the HUD's warning shows as long), white on `flash`, "CLICK!"; a white flash on screen, or under reduced motion or the Steady camera a viewfinder outline that pulses once. A hit (`screenshot { hit: true }`) frames the hero in a selection rectangle and holds his pose for `SAVED_FREEZE`; the word "Saved!" is the HUD's.
  - **Copies (`copies.ts`):** cardboard cut-outs of the hero at each live copy (`pos` is the centre, so they stand on the floor under it), popping into card confetti when `alive` goes false.
  - **Mary (`captive.ts`):** her cast body at `captive.pos`, frozen, compressed by 1 − `restore` (snapped vertices, a blocky face and shading, colour in 8×8 blocks), in a screenshot frame whose file tag sits under her feet: the space over her head is the HUD's restore bar (120 above her feet). Freed: a pixel burst, one "gm" burst (the HUD also captions it) and her wave.
- **What it reads:** `frame.chapter`, the Right-Clicker's `state`, `stateTicks` and `aim`, and the events above. `hero-hurt` from `"a screenshot"` bursts no "OOF!" (the frame and the HUD tell it).
- **Cast:** a chapter's cast is `["mary-jpeg", "gwei"]` (`play-surface.tsx`). Doc's body isn't built; the Right-Clicker's comes from the bridge zone's `villain`.
- **Audio:** the Right-Clicker has no sting or voice lines yet (`audio/night-score.ts` skips them).

## Server

- **`POST /api/runs/start { chapter: "case-001", abandon? }`:** issues `{ runId, seed, ruleset: "c001-1", saveRev, night, expiresAt, assist: false, chapter: "case-001" }`.
  - **Any night:** done or not, a patrol under way or not.
  - **Its own budget:** 30 a UTC day (`runs:case`).
  - **One run in flight:** the rule is shared with ranked nights (409 `run_active`; `abandon` drops the other).
  - **Unknown chapters:** refused with 400.
  - **`GET /api/me`:** `activeRun.chapter` says when the run in flight is a case's.
- **`POST /api/runs/:id/submit`:** replays a chapter run as the chapter (`verifyChapterRun`: same plausibility rules, from the save at issue, no patrol). A verified chapter run answers `ranked: false, bits: 0, score: 0` and `chapter: CaseOutcome` (`{ id, cleared, firstClear, record, badge }`).
  - **Unranked:** no board, no Bits mint, and no public run page (`/r/<runId>` is for patrol nights).
  - **The first verified clear:** sets `save.cases["case-001"] = { cleared: true, clearedAt, bestTicks, verified: true }`, pays `CASE_XP = 100` (levelling up as a night does), and queues one `mint_reward` with `{ runId, playerId, accountId, items: [], badges: ["case-001"], level?, digest }`. That mint carries the player's next reward nonce, minting `trophy:badge:case-001`.
  - **Later clears:** they only lower `bestTicks`.
  - **The save:** the case is written onto the save as it is at submit (row locked), so a chapter never fails on a stale revision.
  - **Uncleared attempts:** verified, and nothing changes.
- **`GET /api/cases`:** answers `{ signedIn, cases: [{ id, number, title, status: "new" | "cleared", clearedAt, bestTicks, badge: { status: "none" | "queued" | "minted", tokenId, tx }, active: { runId, expiresAt } | null }] }`. Signed out, every case is new.
- **`GET /api/runs/:id/replay`:** has `chapter` (replay with `{ chapter }` from `startSave` itself).
- **The save's case record:** `save.cases?: Partial<Record<ChapterId, CaseRecord>>`, where `CaseRecord = { cleared, clearedAt, bestTicks, verified }`. A guest's local clear has `verified: false`. Importing a guest save into an account doesn't bring cases along (`sanitizeLocalSave` rebuilds the save), so the case is filed by playing it signed in.

## Balance (test/chapter-metrics.ts; `CHAPTER_REPORT=1`)

24 seeds per row; the bot investigates, the scripted fight players (`fight-metrics.ts`) take the standoff and the rescue. Seconds of game time.

| Hero | Player | Clear | Fight median (p90) | Night median | Fight damage | SAVED per fight | Hero in the air |
|---|---|---|---|---|---|---|---|
| Night 1 (level 1, 100 HP) | bot | 100% | 12.7 (17.8) | 45 | 0 | 0 | 0% |
| Night 1 | simple | 96% | 18.2 (20.8) | 48 | 47 | 3.9 | 0% |
| Night 1 | average | 100% | 20.7 (24.4) | 52 | 46 | 3.0 | 0% |
| Night 1 | good | 100% | 18.3 (23.1) | 50 | 0.5 | 0.04 | 0% |
| Night 3 (level 2, 106 HP) | simple | 100% | 18.2 (20.8) | 51 | 47 | 3.9 | 0% |
| Night 3 | average | 100% | 20.7 (24.4) | 52 | 46 | 3.0 | 0% |
| Night 3 | good | 100% | 22.0 (26.8) | 54 | 1.6 | 0.08 | 0% |

**Shape of a night:**
- **Investigation:** the bot finds all three clues in a median 14.5 s.
- **Rescue:** about 4.3 s with the copies.
- **The gates** (`chapter.test.ts`):
  - **Clear rates:** the bot clears every seed, simple players at least 80%, average 90%, good 95%.
  - **Fight feel:** average fights are 15–45 s, and every policy keeps the hero in the air under 15% of the fight.
  - **Dodging pays:** never dodging costs the most damage and the most SAVEDs.
- **Human time:** people swing the city slower than the bot, so with the intro comic a real night should land around the spec's 4–6 minutes.

## Deviations from the spec

- **Wider deck:** the bridge deck is 480 wide on the chapter's city (240 on patrols), so a SCREENSHOT can be sidestepped. Patrol cities are unchanged.
- **Extra state and field:**
  - The villain states add `"webbed"` (from the win on, as for every villain).
  - `aim` is only present on the Right-Clicker.
  - `combo-end` gains `reason: "saved"`.
- **Events and lists carry more:**
  - Events carry positions for effects, `clue-found` adds `found`/`of`, and `case-closed` adds `id`/`ticks`.
  - `captive` is non-null for the whole chapter; `copies` keeps popped ones.
- **Sim modes:** the rescue runs in sim mode `"fight"`; the freed beat is `"won"`, then `"done"`.
- **The fight's numbers:** the Right-Clicker is level 2 (a level 1–2 villain, mercy 2/3) with a 4 s guard. His aim and CTRL+C are committed (a blow doesn't cancel them), so not dodging costs damage.
- **The patrol HUD's `villain`:** it carries him through the standoff, with `kind: "right-clicker"` (a widened type). `HudSnapshot.chapter` adds his state word.
- **The save and the endpoint:**
  - `CaseRecord` adds `verified`.
  - `GET /api/cases` adds `number`, `title`, `clearedAt`, `badge.tokenId` and `active` (a run in flight: "In progress"). `status` stays `new | cleared`.
- **Runs:** chapter runs get their own daily budget (30) and no public run page.
