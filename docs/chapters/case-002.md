# Case File 002, "The Sybil Vote": the contract

The second story chapter, built on Case File 001's framework (`docs/chapters/case-001.md`): the same chapter registry, runs, verifier, case files UI, HUD slots, results and Daily Rug lead. Its story is in `docs/story/bible.md`. Where this file and the bible differ on mechanics, this file wins.

The city's block vote on a new bridge toll is rigged: the Sybil has flooded it with copies of himself, ten thousand screenshots pirated from the Right-Clicker's leaked Downloads folder. Read three drop boxes for the real one's tells, pick him out of a line of eight identical voters, win a fight in which the copies vote to fork the roof, and get Uncle Gen's ballot counted.

## Names

| Name | Value | Where |
|---|---|---|
| Chapter id | `CASE_002_ID = "case-002"` (`ChapterId` is now `"case-001" \| "case-002"`) | `@wgp/game-core/chapters`, `@wgp/game-core/types` |
| Rules tag | `CASE_002_RULESET = "c002-1"` | `runs.ruleset`; `CHAPTERS["case-002"].ruleset` |
| Log ruleset field | `chapterLogRuleset("case-002") = 0x0C002104` (201335044: "C 002 1 04") | `sim3d/chapter.ts` |
| Patrol ruleset | `RULESET_VERSION = 4`, unchanged; every patrol golden and Case File 001's golden byte-identical | |
| Run mode | `runs.mode = "case-002"` | server, unchanged code |
| Badge | `trophy:badge:case-002`, queued as `badges: ["case-002"]` | `CHAPTERS["case-002"].badge` |
| Badge outbox key | `badge:case-002:<playerId>` (one per player, ever) | `chain_ops.dedupe_key` |
| Pages | `/play/cases/002` (intro comic), `/play/patrol?case=002` (the night) | |
| Content | `CHAPTERS["case-002"]` (villain lines, clues, the tells' two notes each), `SYBIL_VOTE_MOVES`, `clueNote()`, `TELL_OF_CLUE`, `TELL_BIT` | `rules/chapters.ts` |

## The night

Its own deterministic night in `packages/game-core`, reached only when `SimConfig.chapter === "case-002"`. Its state is `ChapterState.vote` (`VoteState`); Case File 001's is `vote: null`, and patrol nights have no chapter at all. Every new branch tests `s.chapter?.vote` (or a villain phase only this case uses), so neither replays any differently.

### The city
- **Built from the seed:** a patrol city with one stop, the Sybil's rooftop arena in Validator Heights (`chapterStops`, level `VOTE_LEVEL = 3`). The arena's stage (540 across, a cross between four towers) is the polling station.
- **The drop boxes:** three clues on reachable roofs, placed by Case File 001's `placeClues` with their own ids (`VOTE_CLUES`): `signature` (a roof), `footage` (a billboard's foot when one fits), `gif` (500–1,150 from the station). Found within `CLUE_REACH`, any order.
- **The booths:** eight, in two rows of four along x, `BOOTH_STEP = 100` apart, `BOOTH_ROW = 80` either side of the stage's middle.
- **The looks:** each voter is one of the eight mixes of three tells (bits: shadow 1, blink 2, left hand 4), dealt to the booths by the seed; the real one (body slot 0) is one of them. Each clue's note says his value of one tell (`TELL_OF_CLUE`: footage → shadow, gif → blink, signature → hand). All three single him out; two leave two suspects; one leaves four.
- **Uncle Gen:** on the stage `GEN_OUT = 215` from its middle (the seed's side), the ballot box `BOX_BESIDE = 70` beside him. He is the chapter's `captive` from the start.

### Phases (`chapter.phase`)

| Phase | Sim mode | What happens |
|---|---|---|
| `investigate` | `travel` | Read the drop boxes. The station doesn't open until all three are read; `stopTarget` points at the nearest unread one. |
| `lineup` (new) | `travel`, then `intro` and `fight` on the stage | **Arriving:** eight voters stand in the booths (`spawnVoteSybil`), all drawn as copies. **Marking:** only a blow (`by === "strike"`) marks; zips, slings, bombs, slams and Gwei mark no one, and in the lineup a press never zips at the nearest voter (it waits). **A copy:** pops, a paper cut (5 base), `vote.wrong += 1`, and each wrong mark forks one more copy into the fight (at most `FORKED_MAX = 3`). **Him:** the line breaks (every other voter pops) and the standoff begins with `BASE_COPIES = 3` + forks copies at his side. |
| `standoff` | `fight` | The fight in three stages (`vote.stage`), below. A knockout ends the night uncleared. |
| `rescue` | `fight` | After the win's beat: the last copy grabs Uncle Gen's ballot and runs (`RUNNER_SPEED = 235`, off the walls and round corners). A hit on it takes the ballot (`ballot: "taken"`); carried within `BALLOT_REACH = 110` of the box, it's counted. The webbed Sybil is no target, so every press goes for the runner. |
| `done` | `won` for `FREED_SECONDS = 2.5`, then `done` | Gen's vote counted (`captive.freed`, restore 1): `case-closed`, then `night-over` (`"route"`). |

### The Sybil (`sim3d/sybil-vote.ts`)
- **Stats:** level 3 (mercy 1/3, damage 1.16×), `VOTE_HITS = 10`, radius `VOTER_RADIUS = 34`, on foot; bodies stand `VOTER_LIFT = 52` over the floor. He keeps about 300 from the hero (440 just after a hit) and circles. A landed blow guards him for `VOTE_GUARD = 3.2` s; openings get through it.
- **His copies:** stand in an arc between him and you (`COPY_RING = 115`), each throwing a small goo ballot (Swarm, 7 base) every 3.6–4.8 s (/ rate). A hit pops a copy and never passes on to him. At most `MAX_ALIVE = 6`.
- **Moves,** one every 1.5–2.2 s (runoff 1.25–1.75), in turn:

| Move | Polls | Runoff | What it does |
|---|---|---|---|
| FAKE VOTE (`"Fake vote"`) | 1st, 3rd | 2nd | Wind-up 0.75 s (+ mercy), then a big slow goo ballot at you (15 base). Recovers 0.75 s after: **open**. |
| FORK VOTE (`"Fork vote"`) | 2nd | 1st, 3rd | He calls in voters up to `FORK_VOTERS = 3`; they stand still, ballots up. The roof splits through its middle, alternating axis (x, then z); the side you stand on is orphaned. The call runs 2.0 s (runoff 1.7, + mercy). **Passes** if `need = floor(n / 2) + 1` of the `n` callers still stand: on the orphaned side (unless `FORK_SAFE = 14` across), you're hit (24 base) and shoved across, and one more copy forks in. **Quorum fails** if you pop enough: he staggers 1.7 s (+ mercy), **open**. |
| DUPLICATE (`"Duplicate"`) | 4th | 4th | Wind-up 0.5 s, one copy steps out of him (a fake vote while six stand). |

- **Recount:** the blow that leaves him `RECOUNT_AT = 5` hits starts it. He and copies make a ring of `RECOUNT_BODIES = 6` round the stage's middle (`RECOUNT_RADIUS = 175`), every look dealt again (each copy differs from him in at least one tell), all drawn as copies. A copy hit pops with a paper cut; a hit on him lands whatever his guard and ends it (`recount { end: true }`). After `RECOUNT_SECONDS = 10` he steps out anyway. Then the **runoff**.
- **Openings** (`inOpening`): `recover` and `stagger`, phases the patrol Sybil never takes.

### Determinism and verification
- **Same style as the patrol sim:** `dmath` trig, `roll()`, + − × ÷, `Math.sqrt`/`Math.floor`; the determinism scan covers `vote.ts`, `sybil-vote.ts`, `bot-vote.ts`.
- **The hash:** villain phases `vote` and `count` are appended to the hash's phase list and `lineup` to the chapter phases; `VoteState` (and which body is real) is hashed after Case File 001's chapter fields, only when `vote` is set. Every patrol golden and `case-001-standard` are byte-identical.
- **The golden:** `test/golden/case-002-standard.{bin,json}` and `src/golden-case-002.ts`: the bot's clear, 2,613 ticks, 6 checkpoints (three clues, the mark, the win, Gen's vote), hash `e44afdb5`. Regenerate with `UPDATE_CASE_002_GOLDEN=1 pnpm --filter @wgp/game-core test case-002-golden` after an intended change, and bump `CASE_002_RULESET` with it.
- **Refusals:** replaying a 002 log as a patrol night (`ruleset 201335044 is not 4`), as Case File 001 (`… is not chapter case-001's 201330948`), and 001's or a patrol's as 002 (`ruleset 201330948 is not chapter case-002's 201335044`, `ruleset 4 is not …`) all fail; so does the server for each pairing (`src/server/db/case-002.test.ts`).
- **Stats:** `chapterStats` adds `wrongMarks` and `forks` on this case.

## Render contract (v1.6, additive)

```ts
// RenderFrame3D.chapter (contract.ts)
chapter?: {
  id: "case-001" | "case-002";
  phase: "investigate" | "standoff" | "rescue" | "done" | "lineup";
  clues: { id: "tabs" | "cursor" | "pixels" | "footage" | "gif" | "signature"; pos; found }[];
  captive: { pos; restore; freed } | null; // 002: Uncle Gen (restore 0, then 1 when counted)
  copies: [];                               // 002: empty (its copies are the Sybil's bodies)
  vote?: VoteFrame | null;                  // 002 only
} | null;

interface VoteFrame {
  stage: "polls" | "recount" | "runoff";
  real: VoteLook; known: VoteLook;          // his look, and which tells the found clues revealed
  voters: (VoteLook & { id; pos; alive; runner })[]; // every Sybil body by slot, popped ones kept
  booths: Vec3[]; wrong: number;
  fork: { axis: "x" | "z"; at; orphan: ±1; left; total; need; votes } | null;
  recount: { left } | null;
  box: Vec3;
  ballot: { state: "runner" | "carried" | "counted"; pos } | null;
}
// VoteLook = { shadow: boolean; blink: boolean; left: boolean }
```

- **Villains:** kind `"sybil"`, his bodies as ever. In the lineup and the recount every body has `copy: true` (he reads as one of them). His state word (`sybilVoteState`): `idle`, `windup`, `vote`, `open`, `stunned`, `guard`, `count`, `webbed`.
- **Blending:** `session/blend.ts` carries `vote`; voters and the ballot slide between ticks, the rest is the latest tick's.

## Sim events (002 nights only)

| Event | Fields |
|---|---|
| `voter-mark` | `id`, `real`, `wrong` (so far), `x, y, z` |
| `fork-call` | `axis`, `at`, `orphan`, `need`, `voters` |
| `fork` | `passed`, `hit` (the hero was reorged), `votes`, `need` |
| `recount` | `end`, `x, y, z` |
| `ballot` | `state: "taken" \| "counted"`, `x, y, z` |

Also `clue-found`, `copy-spawn`/`copy-pop` (by slot), `encounter`/`fight-live`/`fight-won` (`villain: "sybil"`), `villain-hit`, `clang`, `hero-hurt` (sources `"a fake vote"`, `"Sybil goo"`, `"a fork"`, `"a paper cut"`), `villain-attack` (`"Fake vote"`, `"Fork vote"`, `"Duplicate"`), `captive-freed`, `case-closed`.

## UI (apps/wgp)

- **Registry:** `lib/cases/registry.ts` (`CASE_ENTRIES`, `CASE_ORDER`) names each case for the files page, Tonight's tile, the ending and the Rug. 002's words are `lib/cases/content-002.ts`.
- **Case files** (`components/cases/case-files.tsx`): a folder per open case (002's ballot poster from the Sybil's portrait); 003 stays locked. **Tonight's tile** shows the first case not closed. **The dock's** New badge counts either case.
- **Intro** (`/play/cases/002`, `components/cases/case-002/intro.tsx`): four panels on the shared `CaseIntro` (now taking a `story`): the Rug's "Turnout: 10,000%", the line, Bearson, the case file with Uncle Gen.
- **HUD** (`app/play/patrol/vote-hud.tsx`, `lib/cases/vote-view.ts`), mounted only when `run.chapter === "case-002"`: the objective in the route bar's place; the Sybil's bar (hits, copies, "Fork vote!", "Open: hit him"); the suspect profile while you pick him out (a card on the left on a desktop, a stack of chips under the objective on a phone); the fork vote's alert (hazard stripes, countdown, "You're on the orphaned side: cross the line" or "Safe side", how many copies to pop); the recount's clock; each drop box's note; "Uncle Gen's ballot: catch it" / "Drop it in the box" pinned in the world; the station banner, webbed and counted captions; its How to play. Screen-reader lines for every phase and event.
- **Maps and waypoint:** pins the drop boxes, then the station (`chapterSite`), then the ballot; the waypoint shows the Sybil's face for the station and Gen's for the box.
- **Ending** (`components/cases/case-closed.tsx`, now taking `chapter`): "TOLL FAILS BY ONE VOTE" with Uncle Gen's portrait, the time, the badge's state, Share on X. **The Rug** leads with it until the next edition.

## Scene (apps/wgp/src/game3d/scene/chapter/vote)

- **`VoteScene`** (built on 002's first frame; hooked in `engine.ts` beside `ChapterScene`, which now only builds for `case-001`): drop boxes with a gold beam until read; the station (taped squares and small "vote" signs) while the line stands, flying apart as confetti when he's unmasked; each voter's tells: a blob shadow, a ballot card in that hand, an eye badge over his head that shuts now and then for a blinker and stays open for a starer (shown while picking him out); the fork vote's gold split line and the orphaned half in red hatching that thickens as the count runs out; the ballot box; Uncle Gen's gold ballot with the runner, then in the hero's hand. Bursts: `GOTCHA!`, `COPY!`, `FORK!`, `NO QUORUM!`, `RECOUNT!`, `COUNTED!` (added to `effects.ts`).
- **`GenFigure`:** Uncle Gen's own cast body (`cast-uncle-gen.glb`), hands behind his back, talking when you bring the ballot, waving when it's counted.
- **The Sybil and copies:** the existing cast body and its instanced grey copies (`characters.ts`, unchanged).
- **Budget:** about ten draws of its own. Measured over whole nights at high tier: median 61–97 calls per phase, peak 106 in the rescue on a desktop; 50–75 median on a phone.
- **Reduced motion and the Steady camera:** no pulsing, bobbing or marching hatch; blinks still show (a state change, and a tell).

## Server

Unchanged code: everything is keyed by `CHAPTER_IDS`. `POST /api/runs/start { chapter: "case-002" }` issues `{ ruleset: "c002-1", chapter: "case-002" }`; submit replays with `replayRun(…, { chapter: "case-002" })`; the first verified clear closes `save.cases["case-002"]`, pays `CASE_XP` and queues one `badges: ["case-002"]` mint; `GET /api/cases` lists both cases. Shared daily budget with Case File 001 (`runs:case`, 30).

## Balance (`test/vote-metrics.ts`; `VOTE_REPORT=1`)

24 seeds per row. The bot investigates; in the lineup and the recount each player marks the nearest voter who fits what it remembers (first-timer: no notes read; simple: one tell; average: two; good and bot: three); the fight is `fight-metrics.ts`'s players plus a fork-vote answer (never, half the time, always); everyone chases the runner. Seconds of game time.

| Hero | Player | Clear | KO | Wrong marks | Fight median (p90) | Night median | Fight damage | Forks / hits / quorum fails | Air |
|---|---|---|---|---|---|---|---|---|---|
| Night 1 (lv 1, 100 HP) | first-timer | 79% | 21% | 3.2 | 18.6 (22.5) | 51 | 73 | 2.9 / 0.5 / 2.3 | 0% |
| Night 1 | simple | 83% | 17% | 1.5 | 19.3 (22.0) | 53 | 72 | 2.8 / 0.5 / 2.2 | 0% |
| Night 1 | average | 88% | 13% | 0.5 | 22.9 (24.9) | 54 | 85 | 3.0 / 0.6 / 2.0 | 0% |
| Night 1 | good | 100% | 0% | 0 | 24.0 (30.7) | 59 | 17 | 3.3 / 0.2 / 1.9 | 0% |
| Night 1 | bot | 100% | 0% | 0 | 22.2 (27.1) | 57 | 6 | 3.0 / 0 / 2.4 | 0% |
| Night 3 (lv 2, 106 HP) | first-timer | 88% | 13% | 3.2 | 18.8 | 54 | 75 | | 0% |
| Night 3 | simple | 92% | 8% | 1.5 | 19.3 | 53 | 73 | | 0% |
| Night 3 | average | 96% | 4% | 0.5 | 22.9 | 54 | 85 | | 0% |
| Night 3 | good / bot | 100% | 0% | 0 | 22.7 / 20.9 | 57 / 58 | 7 / 9 | | 0% |

- **Gates** (`test/vote.test.ts`): bot and good players clear every night on their feet; a night-1 first-timer clears 70–95% (79% now), a night-3 one at least 80%; average at least 85%; reading the clues means fewer wrong marks; answering forks means fewer fork hits and less damage; fights are 15–45 s and grounded.
- **Human time:** people read the line slower than a bot; with the comic, a real night lands around 4–6 minutes, like 001.

## Shared files touched (small, additive)

- **game-core:** `sim3d/types.ts` (types), `contract.ts` (v1.6), `chapter.ts` (002's stops, city, setup, `placeClues` ids), `chapter-step.ts` (dispatch), `combat.ts` (002's hit rules behind `chapter.vote`, `inOpening` for `recover`/`stagger`, a beaten Sybil isn't a target), `villains.ts` (spawn/step/webbed dispatch), `strike.ts` (no zip in the lineup), `render.ts` (`vote`, copy flag, state word), `bot.ts` (hands 002 to `bot-vote.ts`), `hash.ts` (appended), `replay.ts` (checkpoint, stats), `right-clicker.ts` (walk helpers exported). `sim.ts` is unchanged.
- **apps/wgp:** `play-surface.tsx` (mount the HUD when `case-002`), `night.tsx` (pass `chapter` to the ending), `blend.ts` (`blendVote`), `engine.ts` (the scene), `effects.ts` (six burst words), `scene/chapter/chapter.ts` (001 only), `scene/chapter/contract.ts` (event types), `sim/loop.ts` (phase type), `components/game/shell.tsx` (New badge), `daily-rug.tsx` (lead id), plus the case files, intro, tile, ending, maps and waypoint.

## Deviations from the suggested premise

- **Blink as a badge:** the copies share one instanced body, so a blink is an eye badge over each voter that shuts now and then (and stays open on a starer), not an eyelid.
- **Wrong marks:** each one forks a copy into the fight and costs a paper cut, so guessing is possible but harder, and reading the drop boxes pays.
- **Level 3:** a level up on the Right-Clicker, so a first-timer's clear rate lands near the 80% asked for.
- **The rescue:** a chase and a delivery (not a hold-to-restore), to play differently from 001's.
