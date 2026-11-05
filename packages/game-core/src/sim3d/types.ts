/**
 * The 3D swing sim's state model. Plain data, mutated in place by stepSim at 60 Hz.
 * Y is up and the street is y = 0. Presentation (sprite spin, squash, hit flashes) is not
 * here: the scene animates from events and positions.
 */
import type { CastId } from "../rules/cast";
import type { ClueId } from "../rules/chapters";
import type { ChapterId, PowerId, Stop, VillainId } from "../rules/types";
import type { CityIndex } from "./city";
import type { City, InputFrame, Vec3, ZoneKind } from "./contract";

/* ------------------------------------------------------------------ the hero */

export interface Rope {
  x: number;
  y: number;
  z: number;
  len: number;
}

export interface Hero {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  rope: Rope | null;
  /** Facing, a unit xz vector. */
  fx: number;
  fz: number;
  missCd: number;
  invuln: number;
  fizzleCd: number;
  shieldT: number;
  cloakT: number;
  dashT: number;
  dashHit: boolean;
  /** Validator slam: diving, with this many hits in the shockwave. */
  slam: number;
  finalityT: number;
  forked: boolean;
  /** Caught in a bread trap. */
  heldT: number;
  hurtT: number;
  holdPrev: boolean;
  /** v3: no input this tick (stick centred, web up): the hero stands and waits (render: controlled = !idle). */
  idle: boolean;
  /** v2: climbing a wall on a web: the wall's outward normal (xz), its top, and seconds since last touching it. */
  climbing: boolean;
  wallNx: number;
  wallNz: number;
  wallTop: number;
  wallT: number;
  /** v2: which side of the heading the last web went (−1, 0, 1), so swings alternate. */
  side: number;
  /** v2: the crouch after a hard landing: no run push until it's over. */
  landT: number;
  /** v3: a buffered web press, seconds left (WEB_BUFFER). */
  webBuf: number;
  /** v3: seconds since the current web latched on. */
  ropeT: number;
  /** v3: the current web was tapped: it holds to the swing's natural end with the button up. */
  latched: boolean;
  /** v3: the last web let go by itself with the button held (or a mantle): the next waits for the top of the arc. */
  rewebWait: boolean;
  /** v4: seconds into the current strike (the web button in reach of a villain), or −1. */
  strike: number;
  /** v4: seconds into the current web-zip (pulled at a villain further out, into a strike), or −1. */
  zip: number;
  /** v4: until the next strike, and the next zip, may start. */
  strikeCd: number;
  zipCd: number;
  /** v4: the body the strike or zip is aimed at (Sybil's index, or −1 for the villain), and whether its blow has connected. */
  strikeBody: number;
  strikeDone: boolean;
  /** v4: the strike came out of a zip. */
  zipped: boolean;
}

/* ------------------------------------------------------------------ pickups (v3) */

export type PickupKind = "bits" | "ring";

/** A Bits token or a boost ring, placed from the city (pickups.ts). */
export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  /** The leg it lies on: the stop index it leads to. */
  leg: number;
  taken: boolean;
}

/* ------------------------------------------------------------------ villains */

export interface Arm {
  /** Resting angle in the bridge plane, radians (0 along the bridge axis, π/2 straight up). */
  base: number;
  angle: number;
  len: number;
  /** v2: angular velocity (rad/s) and extension speed (u/s), both rate- and acceleration-limited. */
  w: number;
  lv: number;
}

/** One of Sybil's bodies, or (Case File 001) one of the Right-Clicker's paper copies. */
export interface SybilBody {
  x: number;
  y: number;
  z: number;
  real: boolean;
  alive: boolean;
  /** Orbit slot; a paper copy's id (render `chapter.copies[].id`). */
  slot: number;
  /** Time until this one shoots. */
  shootT: number;
  /** v2: velocity: each body steers to its orbit slot. */
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Case File 001 adds the Right-Clicker's aim, flash, copy, drag and stagger
 * (sim3d/right-clicker.ts); the patrol villains never use them.
 */
export type VillainPhase =
  | "enter"
  | "idle"
  | "telegraph"
  | "dash"
  | "sweep"
  | "slam-wind"
  | "slam"
  | "retract"
  | "recover"
  | "aim"
  | "flash"
  | "copy"
  | "drag"
  | "stagger"
  /* Case File 002's Sybil (sim3d/sybil-vote.ts): calling a fork vote, and hiding in the recount's ring. */
  | "vote"
  | "count";

/** The patrol's villains, and the chapters' (the Right-Clicker only appears in Case File 001). */
export type SimVillainId = VillainId | "right-clicker";

export interface Villain {
  kind: SimVillainId;
  cast: CastId | "right-clicker";
  level: number;
  boss: boolean;
  quest: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  hits: number;
  hitsMax: number;
  invuln: number;
  stun: number;
  /** Local clock, slowed by node sense. */
  t: number;
  phase: VillainPhase;
  phaseT: number;
  attackT: number;
  attack2T: number;
  /** Attack rate multiplier from level and boss. */
  rate: number;
  /** Sandwich Man and the hero share the rooftops. */
  grounded: boolean;
  /** Sandwich Man's run target in xz. */
  dashToX: number;
  dashToZ: number;
  dashHit: boolean;
  arms: Arm[];
  /** Sybil: every body, copies and the real one. */
  bodies: SybilBody[];
  cx: number;
  cy: number;
  cz: number;
  /** Doc: how many sweep cycles since a slam. */
  cycle: number;
  home: Vec3;
  /** Doc: the bridge axis, a unit xz vector; his arms sweep in the vertical plane along it. */
  ax: number;
  az: number;
  /** After taking a hit: climb or run out of reach for a moment. */
  fleeT: number;
  /** Sandwich Man: time until he can hop over another web. */
  dodgeT: number;
  /** v2: the Sybil swarm centre's velocity. */
  cvx: number;
  cvy: number;
  cvz: number;
  /** v2: Gas Goblin's dive heading (unit), fixed at push-off. */
  diveX: number;
  diveY: number;
  diveZ: number;
  /** v2: roll into turns, radians (the glider's bank; 0 for the others). */
  bank: number;
}

export type HazardKind = "bomb" | "goo" | "trap" | "blast";

export interface Hazard {
  kind: HazardKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  t: number;
  damage: number;
  /** Fluid burned on a hit (fee bombs). */
  burn: number;
  big: boolean;
  /** Bread traps: open → armed → clap → closed. */
  state: "open" | "armed" | "clap" | "closed";
  dead: boolean;
}

export interface Shot {
  kind: "sling" | "bomb";
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  /** powerScale of the power that threw it. */
  scale: number;
  dead: boolean;
}

export interface GweiAssist {
  t: number;
  dur: number;
  anchor: Vec3;
  /** The horizontal direction she swings along. */
  dx: number;
  dz: number;
  struck: boolean;
  x: number;
  y: number;
  z: number;
}

/* ------------------------------------------------------------------ abilities */

export interface PowerSlot {
  id: PowerId;
  /** powerScale(mastery). */
  scale: number;
  cd: number;
  cdMax: number;
  cost: number;
}

/* ------------------------------------------------------------------ the sim */

export type SimMode = "travel" | "intro" | "fight" | "won" | "errand" | "ko" | "done";

export interface SwingTally {
  perfect: number;
  good: number;
  miss: number;
}

/** v4 adds "strike": a blow from the web button in reach (or at the end of a web-zip). */
export type HitSource = "slam" | "dash" | "sling" | "web-bomb" | "validator-slam" | "gwei" | "strike";

/** The 2D event union with z added. The scene animates from these; the bridge turns some into engine actions. */
export type SimEvent =
  | { type: "thwip"; x: number; y: number; z: number; ax: number; ay: number; az: number }
  | { type: "fizzle"; x: number; y: number; z: number }
  /** v4: a strike begins (a blow at a villain in reach, or the end of a zip); `zip` when the web pulled you in first. */
  | { type: "strike"; x: number; y: number; z: number; zip: boolean }
  /** v4: a web-zip begins, pulling the hero at the villain body at (tx, ty, tz). */
  | { type: "zip"; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  /** v3: `auto` when the web let go by itself at the end of a held (or tapped) swing. */
  | { type: "release"; grade: "perfect" | "good" | null; x: number; y: number; z: number; combo: number; auto?: boolean }
  | { type: "miss"; x: number; y: number; z: number; damage: number; water: boolean }
  | { type: "land"; x: number; y: number; z: number; speed: number }
  /** v3: a Bits token or a ring collected: the points it was worth (× the multiplier), and the combo after it. */
  | { type: "pickup"; kind: PickupKind; id: number; x: number; y: number; z: number; points: number; combo: number; multiplier: number }
  /** v3: the combo ran out or was broken (the street), with the count it reached. */
  | { type: "combo-end"; count: number; reason: "time" | "street" | "saved" }
  | {
      type: "arrive";
      index: number;
      kind: ZoneKind;
      hp: number;
      fluid: number;
      combo: number;
      perfect: number;
      good: number;
      miss: number;
      uses: Partial<Record<PowerId, number>>;
    }
  | { type: "encounter"; index: number; villain: SimVillainId }
  | { type: "fight-live"; index: number }
  | { type: "villain-hit"; x: number; y: number; z: number; hits: number; hitsMax: number; by: HitSource; double: boolean; copy: boolean }
  | { type: "clang"; x: number; y: number; z: number; reason: "arms" | "guard" }
  | { type: "hero-hurt"; x: number; y: number; z: number; damage: number; source: string; hp: number }
  | { type: "shield-pop"; x: number; y: number; z: number }
  | { type: "dodge"; x: number; y: number; z: number }
  | { type: "ability"; id: PowerId; slot: number; x: number; y: number; z: number; twice: boolean }
  | { type: "denied"; slot: number; reason: "cooldown" | "fluid" | "target" | "mode" }
  | { type: "gwei"; x: number; y: number; z: number }
  | { type: "blast"; x: number; y: number; z: number; r: number; kind: "bomb" | "web" | "slam" }
  | { type: "trap"; x: number; y: number; z: number }
  | { type: "goo"; x: number; y: number; z: number }
  | { type: "villain-attack"; label: string; x: number; y: number; z: number }
  | { type: "fight-won"; index: number; villain: SimVillainId; hp: number; fluid: number; uses: Partial<Record<PowerId, number>>; gweiUsed: number }
  | { type: "ko"; index: number; villain: SimVillainId; hp: number; fluid: number; uses: Partial<Record<PowerId, number>>; gweiUsed: number }
  | { type: "stop-done"; index: number }
  | { type: "errand"; index: number }
  | { type: "night-over"; reason: "ko" | "route" }
  /* Case File 001 (sim3d/chapter.ts, right-clicker.ts): chapter nights only. */
  /** A clue found (walked or swung into its reach); `found` of `of` found so far. */
  | { type: "clue-found"; id: ClueId; x: number; y: number; z: number; found: number; of: number }
  /** The SCREENSHOT's flash from the Right-Clicker at (x, y, z): `hit` when it SAVED the hero (frozen, hurt, combo broken). */
  | { type: "screenshot"; hit: boolean; x: number; y: number; z: number }
  /** A paper copy appears (CTRL+C in the standoff, or one of the two that interrupt the rescue). */
  | { type: "copy-spawn"; id: number; x: number; y: number; z: number }
  /** A paper copy pops: hit, or swept away when the fight or the rescue ends. */
  | { type: "copy-pop"; id: number; x: number; y: number; z: number }
  /** The DRAG lasso catches the hero at `from` and pulls him toward `to`. */
  | { type: "drag"; from: Vec3; to: Vec3 }
  /** Mary's restore so far, 0–1: every quarter second of restoring, and at 1. */
  | { type: "captive-restore"; p: number }
  | { type: "captive-freed"; x: number; y: number; z: number }
  /** The chapter is cleared after `ticks`: the night ends with it (night-over, "route"). */
  | { type: "case-closed"; id: ChapterId; ticks: number }
  /* Case File 002 (sim3d/vote.ts, sybil-vote.ts): its nights only. */
  /** A voter was hit in the lineup (or the recount's ring): the real Sybil (`real`), or a copy (it pops; `wrong` so far). */
  | { type: "voter-mark"; id: number; real: boolean; wrong: number; x: number; y: number; z: number }
  /** The copies call a fork vote: the rooftop splits along `axis` at `at`; the `orphan` side (+1/−1 of it) is orphaned if `need` of `voters` still stand at the close. */
  | { type: "fork-call"; axis: "x" | "z"; at: number; orphan: number; need: number; voters: number }
  /** The fork vote closes: `passed` (the orphaned side reorgs; `hit` when the hero stood on it) or quorum failed (the Sybil staggers, open). */
  | { type: "fork"; passed: boolean; hit: boolean; votes: number; need: number }
  /** At half his hits the Sybil hides in a ring of copies again (the recount); `end` when it's over (found, or he steps out). */
  | { type: "recount"; end: boolean; x: number; y: number; z: number }
  /** Uncle Gen's ballot: grabbed back from the runner, then counted in the ballot box. */
  | { type: "ballot"; state: "taken" | "counted"; x: number; y: number; z: number };

export interface SimConfig {
  seed: number;
  stops: Stop[];
  /** The stop being swung to or played. */
  index: number;
  /** "travel": swing to stop `index`. "zone": already there (resumed mid-stop). */
  entry: "travel" | "zone";
  hp: number;
  maxHp: number;
  fluid: number;
  combo: number;
  gweiCalls: number;
  heroLevel: number;
  loadout: { id: PowerId; scale: number }[];
  /**
   * A story chapter instead of a patrol (sim3d/chapter.ts); `stops` is then its one stage
   * (chapterStops). Absent on patrol nights, whose state never carries chapter fields.
   */
  chapter?: ChapterId;
}

/* ------------------------------------------------------------------ chapters */

/** Case File 002 adds "lineup" (find the real Sybil among the voters) between the clues and the fight. */
export type ChapterPhase = "investigate" | "standoff" | "rescue" | "done" | "lineup";

/** Case File 002's fight, in turn: the polls (fork votes), the recount (he hides in a ring again), the runoff. */
export type VoteStage = "polls" | "recount" | "runoff";

/**
 * Case File 002's own state (sim3d/vote.ts): the voters' tells, the fork vote, the recount and
 * Uncle Gen's ballot. Hashed after the chapter's fields, and only on its nights.
 */
export interface VoteState {
  /** The real Sybil's tells as bits (rules/chapters.ts TELL_BIT), set by the seed. */
  real: number;
  /** Each body's tells by its slot (the villain's bodies' `slot`); the real one's are `real`. */
  tells: number[];
  /** The station's eight booths (where the lineup stands), in order. */
  booths: { x: number; z: number }[];
  /** Copies hit by mistake in the lineup (each forks an extra copy into the fight). */
  wrong: number;
  /** The fight's stage. */
  stage: VoteStage;
  /** Fork votes called so far (they alternate the split's axis). */
  forks: number;
  /** The fork vote under way: seconds left (0: none), its axis (0: the split runs along z at x = at; 1: along x at z = at), the orphaned side (±1), the votes it needs and the copies that may vote (slots below `forkFrom`). */
  forkT: number;
  forkAxis: number;
  forkAt: number;
  forkSide: number;
  forkNeed: number;
  forkFrom: number;
  /** The fork vote's whole call, seconds (for the scene's countdown). */
  forkLen: number;
  /** The recount: seconds in, and each body's place in its ring by slot (−1: none). */
  recountT: number;
  ring: number[];
  /** Uncle Gen's ballot: 0 the runner has it, 1 the hero carries it, 2 counted (−1 before the rescue). */
  ballot: number;
  /** The runner's slot (−1 before the rescue). */
  runner: number;
  /** The ballot box beside Uncle Gen. */
  boxX: number;
  boxZ: number;
}

export interface ChapterClue {
  id: ClueId;
  x: number;
  y: number;
  z: number;
  found: boolean;
}

/** Case File 001's own state (sim3d/chapter.ts). Hashed after everything else, and only on chapter nights. */
export interface ChapterState {
  id: ChapterId;
  phase: ChapterPhase;
  clues: ChapterClue[];
  /** Mary Jpeg, frozen on the deck: where she stands, restore ticks so far (of RESTORE_TICKS), and whether she's free. */
  captive: { x: number; y: number; z: number; restore: number; freed: boolean };
  /** Seconds of the SCREENSHOT's freeze left ("SAVED!"). */
  savedT: number;
  /** The aim, a unit xz direction from the Right-Clicker, while he aims and flashes. */
  aimX: number;
  aimZ: number;
  /** The DRAG lasso's pull: seconds left (0: none), and the point it pulls the hero toward. */
  dragT: number;
  dragX: number;
  dragZ: number;
  /** The rescue: seconds in, and paper copies sent so far (two at most). */
  rescueT: number;
  rescueCopies: number;
  /** Paper copies spawned tonight (ids 0, 1, …, the bodies' `slot`). */
  copies: number;
  /** Per copy (by id): the rescue slap's wind-up seconds left (0: none), and the cooldown before the next. */
  copyWind: number[];
  copyCd: number[];
  /** Case File 002's own state, or null (Case File 001). */
  vote: VoteState | null;
}

export interface SimState {
  config: SimConfig;
  city: City;
  /** The city's spatial hash: boxes, roof edges and anchors by cell. */
  grid: CityIndex;
  tick: number;
  time: number;
  rng: number;
  mode: SimMode;
  modeT: number;
  /** The stop being swung to or played. */
  index: number;
  hero: Hero;
  hp: number;
  maxHp: number;
  /** An integer, like the engine's. */
  fluid: number;
  /** Fluid regeneration below one unit, in 1/FLUID_REGEN_DEN steps. */
  fluidAcc: number;
  /**
   * The combo: v3 counts perfect releases, Bits and rings chained without touching the street
   * or running out of time (v2 counted perfect releases between misses).
   */
  combo: number;
  /** The best combo tonight in this session, for the score. */
  maxCombo: number;
  /** v3: ticks before the combo runs out. */
  comboT: number;
  /** v3: Bits tokens and boost rings along the route, and what they've earned tonight. */
  pickups: Pickup[];
  bits: number;
  rings: number;
  /** v3: pickup points, each worth its base × the combo multiplier when taken (an integer). */
  pickupPoints: number;
  /** Swings since the last arrival. */
  tally: SwingTally;
  /** Every swing tonight in this session, for the HUD and the score. */
  total: SwingTally;
  /** Powers used since the last report to the engine. */
  uses: Partial<Record<PowerId, number>>;
  powers: PowerSlot[];
  villain: Villain | null;
  hazards: Hazard[];
  shots: Shot[];
  gwei: GweiAssist | null;
  gweiLeft: number;
  gweiUsed: number;
  /** Node sense: seconds of slow motion left. */
  slowmo: number;
  /** The last input applied, for the bot and the HUD. */
  input: InputFrame;
  /** Queued since the loop last drained them. */
  events: SimEvent[];
  /** A story chapter's state (Case File 001), or null on a patrol night. */
  chapter: ChapterState | null;
}
