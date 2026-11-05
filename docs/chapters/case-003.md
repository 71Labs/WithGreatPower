# Case File 003, "Fee Strike": the contract

This is the contract for case 003's sim, server, UI and scene. It follows case 001's pattern (`docs/chapters/case-001.md`): its own sim branch, its own ruleset tag, replay-verified and unranked, with a soulbound badge on the first verified clear. The season's canon is `docs/story/bible.md` (section "003 Fee Strike"); where this case's mechanics differ from the bible's suggested brief, [Deviations from the bible's brief](#deviations-from-the-bibles-brief) says how and why.

## The story

**Season arc, "The Downloads":** when the Right-Clicker's Downloads folder burst on Doc's bridge (case 001), Gas Goblin bought `recipes_DO_NOT_SHARE (1).pdf`, Aunt Mainnet's recipe book. He read page 41, *The Never-Goes-Down Loaf*, decided "never goes down" meant fees, and keyed the page into the Mempool Market's fee meter as its admin key. Every fee in the Market jumped 400% and stuck. Aunt Mainnet's bakery can't pay for its own oven's transactions, the bread stopped, and the city got hangry.

**The night, beat by beat:**

1. **Intro comic** (`/play/cases/003`): the Rug's "FEES UP 400%. LOAF DOWN?", Aunt Mainnet's dark OPEN sign and a queue in the dawn cold, Bearson ("Find out who's pricing this city out. I already know. Prove it." / "And bring me a loaf."), the case file stamped 003.
2. **Investigate the Mempool Market:** three clues on roofs around the start, in any order.
   - **Fee-bomb burns:** "Green soot, still warm, in a trail across the roofs. Glider exhaust. Smells like four hundred percent." Its scorch trail points at the meter.
   - **The pretzel cart** (a stuck shopkeeper): "Pending since breakfast. Fee: 400,000,000,000 gwei, for one pretzel. Gwei Stacy circled it twice."
   - **The florist** (a stuck shopkeeper): "My roses wilted waiting for a confirmation. A fella with a glider keeps reading the fee meter and cackling."
3. **The fee meter:** after the third clue, Gas Goblin swoops in and perches on it. The case note: "Jammed at MAX. Its admin key is page 41 of recipes_DO_NOT_SHARE (1).pdf, Aunt Mainnet's Never-Goes-Down Loaf. Straight out of the Right-Clicker's Downloads."
4. **The rooftop chase** (the signature): he rips the meter off its roof and flees on his glider, most of the way round the Market and out to the bakery, lobbing fee bombs back at you. Keep up by running, climbing and swinging. Fall too far behind and he's lost: back to the last checkpoint. Five losses and he's gone with the meter.
5. **The finale:** he plants the meter on Aunt Mainnet's roof. Land there and beat him by ruleset 4's grounded rules. If you arrive under 45% health, she tosses you yesterday's loaf (up to 45%).
6. **Cool the fees:** hold web at the meter while it vents fee spikes (step out of the ring, or take the hit).
7. **The ending:** "Fees cooled. The ovens are back on." Aunt Mainnet: "Fresh blocks, still warm." She hands out slices, the Goblin included: "Everybody eats, dear." The Daily Rug's Extra: **FEES FALL. LOAF RISES.** The thread to 004: a receipt in his saddlebag, "Sold by Doc's Bridge Co. Shipped cross-chain. 8 arms, 0 refunds."
8. **Badge:** "Never goes down" (`trophy:badge:case-003`), on the first verified clear.

## Names

| Name | Value | Where |
|---|---|---|
| Chapter id | `"case-003"` (`ChapterId`, `FEE_STRIKE_ID`) | `@wgp/game-core/types`, `rules/case-003.ts` |
| Case rules | `FEE_STRIKE_RULESET = "c003-1"` | `runs.ruleset` of every case-003 run; its verifier's `ruleset` |
| Log ruleset field | `chapterLogRuleset("case-003") = 0x0C003104` (201339140; hex "C 003 1 04": case 003, rules rev 1, patrol ruleset 4) | `sim3d/chapter.ts`, `FEE_LOG_RULESET_BASE` in `sim3d/fee-strike.ts` |
| Patrol ruleset | `RULESET_VERSION = 4`, unchanged | `sim3d/constants.ts` |
| Run mode | `runs.mode = "case-003"` | `apps/wgp/src/server/db/runs.ts` (generic over `CHAPTER_IDS`) |
| Badge | `trophy:badge:case-003`, queued as `badges: ["case-003"]` | `apps/wgp/src/server/db/cases.ts` (generic) |
| Badge outbox key | `badge:case-003:<playerId>` (one per player, ever) | `chain_ops.dedupe_key` |
| Page | `/play/patrol?case=003` (also `?case=case-003`); intro `/play/cases/003` | `night.tsx` `useChapterParam` |
| Content | `CHAPTERS["case-003"] = FEE_STRIKE_INFO`, `FEE_STRIKE_LINES` | `packages/game-core/src/rules/case-003.ts` |
| Golden | `test/golden/case-003-standard.{bin,json}`, `src/golden-case-003.ts` | `UPDATE_CASE3_GOLDEN=1 pnpm --filter @wgp/game-core test case-003-golden` |

No database migration: `runs.mode` and `save.cases` already hold any chapter id.

## The night

A case-003 night is its own deterministic night. It only runs when `SimConfig.chapter === "case-003"`, which builds `state.fee` (`FeeState`). Every case-003 branch checks `state.fee`; patrol nights and case 001 never carry it (`state.chapter` stays case 001's alone), so their hashes and replays are unchanged.

### The city (`sim3d/fee-strike.ts`)

- **Built from the run's seed:** a patrol city with one stop, Gas Goblin's arena in the Mempool Market (`feeStops`: level 2, not a boss). Its stage, the flat roof between four corner towers, is Aunt Mainnet's bakery.
- **His route (`buildRoute`):** from the meter on a roof across a loop round the start (radius `LOOP_R = 1450`, weaving ±210), 3.5–4.0 rad round it (a seeded way round), then out to the bakery, a point every 0.5 rad and every 950 units on the way out. Each point snaps to a roof within 460 (a checkpoint, `roof: true`) and flies 230 over it, never lower than 130 over anything along its legs. The last point is 300 over the bakery's middle. Routes are 5,000–12,000 units long (tests check 30 seeds).
- **The clues (`placeFeeClues`):** three roof spots 450–1,150 from the start, 650 apart, 550 from the meter, in three relaxing passes. The burn is the one most toward the meter.
- **The meter:** stands on route[0]'s roof; carried under him through the chase (58 under his centre); then planted 185 from the bakery's middle on the side toward the start.

### Phases (`fee.phase`)

| Phase | Sim mode | What happens |
|---|---|---|
| `investigate` | `travel` | **Finding a clue:** within `CLUE_REACH = 140` across of a point 26 above it, 1.5× that up and down (as case 001). `fee-clue` each. **The route's target:** the nearest unfound clue. |
| `meter` | `travel` | **He swoops in:** spawned 520 over the meter, perching 150 over it, bobbing. **The grab:** the hero within `GRAB_REACH = 520` across (and above the street): `meter-grab`, the chase. |
| `chase` | `travel` | `sim3d/fee-chase.ts`, below. He's `state.villain` (no fight rule reaches him: they all need mode `fight`). Ends when he reaches the bakery point: `chase-end`, the meter planted. |
| `showdown` | `travel`, then `intro`, `fight`, `won` | **Circling:** he loops over the roof (his fight cruise) until the hero lands on the stage (`checkArrival`, only now). **The loaf:** under 45% health (`LOAF_SHARE`), the hero is patched up to it (`loaf`). **The fight:** `spawnVillain`'s own Gas Goblin for the stop, moved to where he is (no teleport), by ruleset 4's `stepGoblin`, unchanged: 7 hits, mercy 2/3, dives with a stall (the opening), fee bombs. |
| `cool` | `fight` | **When:** after the win's beat (`WON_SECONDS`). He stays webbed (`stepVillain` steps him webbed; beaten villains are no target). **Cooling:** hold web beside the meter (within `METER_REACH = 160` across, 140 up or down) for `COOL_TICKS = 210` (3.5 s), paused while hurt or held; beside it a held web cools instead of swinging. **Fee spikes:** the first 1.2 s in, then every 2.6 s (+0.27 at his mercy), each wound up 0.8 s (+0.13): `villain-attack` "Fee spike", then `fee-spike`, a 190 ring (`SPIKE_REACH`, 140 up or down) that hurts 60% of a fee bomb, burns 8 fluid and shoves 320. |
| `done` | `won` for `COOLED_SECONDS = 2.5`, then `done` | `fees-cooled`, then `case-closed { id: "case-003" }` and `night-over` (`"route"`). |

A knockout in the fight or the cooling ends the night uncleared. Five losses in the chase end it uncleared too (`chase-escaped`, `night-over "route"`).

### The chase's rules (`sim3d/fee-chase.ts`)

- **Catch-up (`chaseSpeed`):** his speed follows the gap (across): 600 within 280 (he bolts), 400 at 650, 200 at 1,000, 60 at 1,350, and 0 from 1,500 (he waits, jeering). He steers at 900 u/s², banking into turns, rounding corners over the last 260 of a leg.
- **The escape meter:** fills while the gap is over `ESCAPE_GAP = 1250`, over 5 s (+1.5 × mercy: 6 s at level 2); drains under `SAFE_GAP = 1000` over 3 s. Full: lost.
- **Checkpoints:** every route point on a roof the hero's progress (his projection on the legs between his last checkpoint and Gas Goblin, within 900 of the line) has passed: `chase-checkpoint`. The bakery point is never one.
- **Lost:** the hero stands still on the last checkpoint's roof facing the next point; Gas Goblin waits at that next point for `HOLD_SECONDS = 2.5` (or until the hero is within 650); bombs cleared, the escape meter empty: `chase-lost`. `MAX_LOSSES = 5`: the fifth is `chase-escaped`.
- **Fee bombs:** the first 1.8 s after the grab, then every 1.9–2.7 s (/ his rate), while the gap is 200–1,250. Lobbed to land where the hero's heading (90% of his velocity's lead, ±60 scatter) in 0.9–1.5 s by the gap (+0.15 at his mercy), falling as a fight's do. A bomb bursts within 75 of the hero (its fuse) or on any surface: an 80 blast that hurts 9 (less at mercy), burns 10 fluid and knocks the hero half his speed plus 200. **Never a knockout:** the chase keeps the hero at 1 health.
- **Node sense** slows him and his bombs like any villain.

### Determinism and verification

- **Same style as the patrol sim:** `dmath` trig, the sim's `roll()`, + − × ÷, `Math.sqrt` and `Math.floor`. The determinism scan covers the new files.
- **The hash:** `FeeState` is hashed after everything else, and only when `state.fee` is set (`hash.ts hashFee`): every patrol golden and case 001's are byte-identical.
- **One shared-code guard:** `combat.ts villainTargets` returns no targets for a beaten villain (hits 0). On every other night hits only reach 0 as the fight is won (mode `won`), where no caller asks; the goldens and bot nights confirm nothing changed.
- **Runs:** `startChapterRun(save, seed, "case-003")`; `runLog` writes `0x0C003104`; `replayRun(input, { chapter: "case-003" })`. A patrol log, a case-001 log and a case-003 log each replay only as themselves (`ruleset 201339140 is not 4`, `… is not chapter case-001's 201330948`, `ruleset 201330948 is not chapter case-003's 201339140`).
- **Results:** `score` 0. `chapterCleared`: the phase `done`, the meter cooled, the night over on it, health left. `chapterStats` adds `losses`, `checkpoint` and `chaseSeconds`; `restore` is the cooling ticks. Checkpoint hashes: each clue, the grab, the bakery, the win and the cooled meter (7 on a clean night).

## Render contract (v1.6, additive; nothing here is read back by the sim or hashed)

```ts
// RenderFrame3D (sim3d/contract.ts)
fee?: {
  id: "case-003";
  phase: "investigate" | "meter" | "chase" | "showdown" | "cool" | "done";
  clues: { id: "burn" | "pretzel" | "florist"; pos: Vec3; found: boolean }[]; // roof level; always 3, in this order
  meter: { pos: Vec3; carried: boolean; heat: number /* 1 MAX → 0 */; cooled: boolean; spike: number /* a fee spike's wind-up 0–1, 0: none */ };
  route: { pos: Vec3; roof: Vec3 | null }[];      // fixed for the night; route[0] over the meter, the last over the bakery
  chase: { next: number; checkpoint: number; escape: number; gap: number; losses: number; maxLosses: number } | null; // only in the chase
  bakery: Vec3;                                    // the stage's middle, floor level
} | null;                                          // null (or absent) on every other night
```

- **Gas Goblin** is `villains[0]` from the meter phase on, in mode `travel` too. His state words there: `"perch"`, `"flee"`, `"throw"` (0.35 s after a bomb), `"taunt"` (waiting after a loss, or the gap over 1,150), `"circle"` (over the bakery). From the fight on, as any night's; `"webbed"` from the win to the end. `bank` is his glider's roll through the chase too.
- **Fee bombs** are `hazards` of kind `"bomb"`, as in a fight.

## Sim events (`SimEvent`, case-003 nights only)

| Event | Fields |
|---|---|
| `fee-clue` | `id` (`FeeClueId`), `x, y, z`, `found` (1–3), `of` (3) |
| `meter-grab` | `x, y, z` (the meter) |
| `chase-checkpoint` | `index` (route point), `of` (route points short of the bakery), `x, y, z` (its roof) |
| `chase-lost` | `losses`, `checkpoint`, `x, y, z` (where the hero is put back) |
| `chase-escaped` | `losses` |
| `chase-end` | `x, y, z` (the meter, planted) |
| `loaf` | `hp`, `gained` |
| `fee-spike` | `hit`, `x, y, z` (the meter) |
| `meter-cool` | `p`, 0–1, every 15 ticks of cooling and at 1 |
| `fees-cooled` | `x, y, z` |
| `case-closed` | `id: "case-003"`, `ticks` |

Also: `villain-attack` ("Fee bomb" in the chase, "Fee spike" while cooling), `blast` (each bomb and spike), `hero-hurt` (sources "a fee bomb", "a fee spike"), and the fight's usual events with `villain: "gas-goblin"`. `clue-found` never fires on a case-003 night (`fee-clue` does), so case 001's UI never sees its ids.

## HUD, session and ending (`apps/wgp`)

- **Starting:** `/play/patrol?case=003` goes the same three ways as case 001 (signed in: `beginRanked({ chapter: "case-003" })`; guest: `beginLocalChapter`; unranked).
- **HUD snapshot:** `HudSnapshot.fee` (`src/sim/loop.ts FeeHud`, filled by `game3d/session/hud.ts feeHud`): `{ id, phase, cluesFound, clues, found[], chase: { gap, escape, warn, checkpoint, checkpoints, losses, maxLosses, holding } | null, heat, beside, cooled, spike }`. The patrol `villain` is set for Gas Goblin through the showdown only.
- **In the night (`app/play/patrol/fee-hud.tsx`):** the objective chip in the route bar's place ("Chase Gas Goblin" through the chase: his face, "On his tail / Keep up / Falling behind / He's getting away!", the hazard-striped escape meter, checkpoints and losses), the patrol villain bar in the fight, callouts (clue notes, the meter's Downloads note, "After him!", "Lost him!", "Checkpoint", "Bakery!", the loaf, the "Fee spike!" and "He's getting away!" warnings), the cooling bar over the meter, the encounter card and endings, How to play, and a screen-reader line for every phase and event (`lib/cases/fee-view.ts`). The waypoint and minimap point at the clue, the meter, him, the bakery (`game3d/nav/fee-pins.ts`).
- **The ending:** `FeeCaseClosed` (`components/cases/fee-strike/case-closed.tsx`, the same props as case 001's `CaseClosed`): "Case closed." with the Rug's FEES FALL. LOAF RISES., the time, the badge's state, Share on X. Not closed: "The case is still open."
- **The case files:** case 003's folder on `/play/cases`, its intro comic at `/play/cases/003`, the Rug's lead after a clear.

## Server

Generic over `CHAPTER_IDS` (no code change for the case): `POST /api/runs/start { chapter: "case-003" }` issues `{ ruleset: "c003-1", chapter: "case-003" }`; `POST /api/runs/:id/submit` replays it as case-003 (`verifyChapterRun`); the first verified clear sets `save.cases["case-003"]`, pays `CASE_XP` and queues `badges: ["case-003"]` once; `GET /api/cases` lists it. `src/server/db/cases-003.test.ts` covers all of it with the real verifier, plus the cross-case refusals.

## Balance (`test/fee-metrics.ts`; `FEE_REPORT=1`)

24 seeds per row. Travel is the sim's bot with a person's habits laid on (a first-timer re-aims late and off-line, lets go late and sometimes too soon, presses slow, stops to look around every 5 s and takes a wrong turn every 12 s; an average player half as often; a good one is the bot and dodges bombs). Fights are `fight-metrics.ts`'s players of the same name; cooling, the simple player never steps out of a spike. Seconds of game time; gaps in units (about 49 a metre).

| Hero | Player | Clear | KO | Escaped | Lost him at least once | Chase median (p90) | Gap median (p90) | Behind / far | Bomb hits | Health at the fight | Fight median | Fight damage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Night 1 | bot | 100% | 0% | 0% | 0% | 17.7 (20.6) | 528 (877) | 4% / 1% | 12% | 91 | 18.5 | 0 |
| Night 1 | simple | 79% | 21% | 0% | 29% | 24.7 (33.8) | 750 (1,300) | 24% / 12% | 8% | 68 | 22.6 | 47 |
| Night 1 | average | 100% | 0% | 0% | 0% | 21.5 (25.0) | 686 (1,079) | 16% / 5% | 5% | 84 | 20.8 | 18 |
| Night 1 | good | 100% | 0% | 0% | 4% | 18.3 (21.4) | 613 (894) | 5% / 1% | 5% | 96 | 20.6 | 0 |
| Night 3 | bot | 100% | 0% | 0% | 0% | 17.7 (20.6) | 528 (877) | 4% / 1% | 12% | 97 | 14.6 | 1.2 |
| Night 3 | simple | 88% | 13% | 0% | 29% | 24.7 (33.8) | 750 (1,300) | 24% / 12% | 8% | 73 | 23.0 | 48 |
| Night 3 | average | 100% | 0% | 0% | 0% | 21.5 (25.0) | 686 (1,079) | 16% / 5% | 5% | 90 | 20.8 | 18 |
| Night 3 | good | 100% | 0% | 0% | 4% | 18.3 (21.4) | 613 (894) | 5% / 1% | 5% | 102 | 18.0 | 1.2 |

("Behind" is the share of the chase past `SAFE_GAP`, "far" past `ESCAPE_GAP`.)

- **A first-timer clears about 80%** (79% on night 1's hero, 88% on night 3's; 81% and 92% on 48 other seeds). The losses are knockouts on the bakery roof after a scrappy chase and investigation; nobody is simply outrun (no escapes), but a first-timer loses him at least once in about three chases out of ten.
- **Skilled players clear every time.** The gates (`fee-strike.test.ts`): simple 70–95%, average ≥ 90%, good and the bot 100%; simple escapes ≤ 5%; good loses him in ≤ 10% of chases; the first-timer sits further back and longer behind than the good player; the bot's chase lasts 10–30 s; dodging pays in the fight and at the meter.
- **Human time:** people swing slower than the bot, so with the comic a real night should run about 4–7 minutes.

## Deviations from the bible's brief

The bible's 003 brief is "a complete suggestion: adapt the mechanics to the sim, keep the beats, the file, the ending page and the thread". Kept: the file, the Rug's ending, the badge sticker, the case lines, the thread to 004, the slice. Adapted, because this build's brief asked for them explicitly:

- **The clues** are the fee-bomb burns and two stuck shopkeepers (the pretzel cart, the florist), with the bible's receipt and exhaust trail folded into their notes. Clues don't set chase variables.
- **The meter:** page 41 is keyed into the Market's fee meter as its admin key; he carries the meter through the chase and plants it on the bakery roof.
- **The chase** is a rubber-banded pursuit with an escape meter, checkpoints and fee bombs, ending at the bakery (not a fee board, priority-fee dash or out-of-gas timer). No Sandwich Man cameo.
- **The rescue** is cooling the meter by holding web at it through fee spikes, not steadying her ladder and delivering the loaf tray.
- **Her loaf:** an arrival heal (to 45%), so a long, scrappy investigation doesn't decide the fight.
