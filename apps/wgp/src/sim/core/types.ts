/**
 * The swing sim's state model. Plain data, mutated in place by stepSim at a fixed rate.
 * World y points up and the street is y = 0; the renderer flips it.
 */
import type { CastId } from "@/content/cast";
import type { DistrictId, PowerId, Stop, VillainId } from "@/game/types";

export interface Vec {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ the world */

/** A roof or a deck you can land on from above (one-way). */
export interface Platform {
  x0: number;
  x1: number;
  y: number;
}

export type AnchorKind = "corner" | "tower" | "antenna" | "crane" | "cable" | "billboard";

export interface Anchor {
  x: number;
  y: number;
  kind: AnchorKind;
}

export type Prop =
  | { kind: "water-tower"; x: number; y: number }
  | { kind: "antenna"; x: number; y: number; h: number }
  | { kind: "ac"; x: number; y: number; w: number }
  | { kind: "billboard"; x: number; y: number; w: number; h: number; text: string }
  | { kind: "vent"; x: number; y: number };

export type BuildingStyle = "flat" | "setback" | "stepped" | "brownstone" | "tower" | "arena-tower";

export interface Building {
  id: number;
  x0: number;
  w: number;
  h: number;
  /** A narrower upper block, if any. */
  top: { x0: number; w: number; h: number } | null;
  style: BuildingStyle;
  /** Index into the palette the renderer picks from. */
  tone: number;
  accent: boolean;
  district: DistrictId;
  props: Prop[];
  /** Flagpoles jutting out of a tall facade (arena towers), each an anchor. */
  ledges: Vec[];
  /** Seeds the renderer's windows, so they're the same every time. */
  seed: number;
}

/** A crane standing in a gap between buildings. */
export interface Crane {
  x: number;
  h: number;
  jib: number;
  dir: 1 | -1;
}

/** A sagging cable between two points: wires, arena lines and bridge cables. */
export interface Cable {
  a: Vec;
  b: Vec;
  sag: number;
  kind: "wire" | "arena" | "bridge";
}

export interface Bridge {
  x0: number;
  x1: number;
  deckY: number;
  towers: number[];
  towerTop: number;
}

export type ZoneKind = "fight" | "errand";

export interface Zone {
  index: number;
  kind: ZoneKind;
  stop: Stop;
  /** Center of the zone. */
  x: number;
  /** Fight zones: the arena's inner bounds. */
  x0: number;
  x1: number;
  bridge: boolean;
  /** Errand zones: where the ally stands. */
  ally: (Vec & { id: CastId; onTower: boolean }) | null;
}

export interface World {
  seed: number;
  buildings: Building[];
  cranes: Crane[];
  cables: Cable[];
  bridges: Bridge[];
  platforms: Platform[];
  /** Sorted by x. */
  anchors: Anchor[];
  /** River stretches under bridges; touching water is a miss, like the street. */
  water: { x0: number; x1: number }[];
  zones: Zone[];
  startX: number;
  endX: number;
}

/* ------------------------------------------------------------------ the hero */

export interface Rope {
  x: number;
  y: number;
  len: number;
}

export interface Hero {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  rope: Rope | null;
  facing: 1 | -1;
  /** Sprite rotation in radians (screen space, clockwise). */
  angle: number;
  /** A flip after a perfect release, 1 → 0. */
  spin: number;
  /** Landing squash, 1 → 0. */
  squash: number;
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
  /** Standing still at a spawn until the first web or steer, so nobody runs off a roof unawares. */
  idle: boolean;
}

/* ------------------------------------------------------------------ villains */

export interface Arm {
  /** Resting angle around the body, radians. */
  base: number;
  angle: number;
  len: number;
}

export interface SybilBody {
  x: number;
  y: number;
  real: boolean;
  alive: boolean;
  /** Orbit slot. */
  slot: number;
  /** Time until this one shoots. */
  shootT: number;
}

export type VillainPhase = "enter" | "idle" | "telegraph" | "dash" | "sweep" | "slam-wind" | "slam" | "retract" | "recover";

export interface Villain {
  kind: VillainId;
  cast: CastId;
  level: number;
  boss: boolean;
  quest: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hits: number;
  hitsMax: number;
  invuln: number;
  stun: number;
  /** Hit flash, 1 → 0. */
  flash: number;
  /** Local clock, slowed by node sense. */
  t: number;
  phase: VillainPhase;
  phaseT: number;
  facing: 1 | -1;
  attackT: number;
  attack2T: number;
  /** Attack rate multiplier from level and boss. */
  rate: number;
  /** Sandwich Man and the hero share the rooftops. */
  grounded: boolean;
  dashTo: number;
  dashHit: boolean;
  arms: Arm[];
  /** Sybil: every body, copies and the real one. */
  bodies: SybilBody[];
  cx: number;
  cy: number;
  /** Doc: how many sweep cycles since a slam. */
  cycle: number;
  /** The webbed wrap after a win, 0 → 1. */
  webbed: number;
  home: Vec;
  /** After taking a hit: climb or run out of reach for a moment. */
  fleeT: number;
  /** Sandwich Man: time until he can hop over another web. */
  dodgeT: number;
}

export type HazardKind = "bomb" | "goo" | "trap" | "blast";

export interface Hazard {
  kind: HazardKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
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
  vx: number;
  vy: number;
  t: number;
  /** powerScale of the power that threw it. */
  scale: number;
  dead: boolean;
}

export interface GweiAssist {
  t: number;
  dur: number;
  from: Vec;
  to: Vec;
  anchor: Vec;
  struck: boolean;
  x: number;
  y: number;
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

export type SimEvent =
  | { type: "thwip"; x: number; y: number; ax: number; ay: number }
  | { type: "fizzle"; x: number; y: number }
  | { type: "release"; grade: "perfect" | "good" | null; x: number; y: number; combo: number }
  | { type: "miss"; x: number; y: number; damage: number; water: boolean }
  | { type: "land"; x: number; y: number; speed: number }
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
  | { type: "encounter"; index: number; villain: VillainId }
  | { type: "fight-live"; index: number }
  | { type: "villain-hit"; x: number; y: number; hits: number; hitsMax: number; by: HitSource; double: boolean; copy: boolean }
  | { type: "clang"; x: number; y: number; reason: "arms" | "guard" }
  | { type: "hero-hurt"; x: number; y: number; damage: number; source: string; hp: number }
  | { type: "shield-pop"; x: number; y: number }
  | { type: "dodge"; x: number; y: number }
  | { type: "ability"; id: PowerId; slot: number; x: number; y: number; twice: boolean }
  | { type: "denied"; slot: number; reason: "cooldown" | "fluid" | "target" | "mode" }
  | { type: "gwei"; x: number; y: number }
  | { type: "blast"; x: number; y: number; r: number; kind: "bomb" | "web" | "slam" }
  | { type: "trap"; x: number; y: number }
  | { type: "goo"; x: number; y: number }
  | { type: "villain-attack"; label: string; x: number; y: number }
  | { type: "fight-won"; index: number; villain: VillainId; hp: number; fluid: number; uses: Partial<Record<PowerId, number>>; gweiUsed: number }
  | { type: "ko"; index: number; villain: VillainId; hp: number; fluid: number; uses: Partial<Record<PowerId, number>>; gweiUsed: number }
  | { type: "stop-done"; index: number }
  | { type: "errand"; index: number }
  | { type: "night-over"; reason: "ko" | "route" };

export type HitSource = "slam" | "dash" | "sling" | "web-bomb" | "validator-slam" | "gwei";

export interface SimInput {
  hold: boolean;
  /** −1 left, 0, 1 right. */
  steer: number;
}

export type SimCommand = { type: "ability"; slot: number } | { type: "gwei" };

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
}

export interface SimState {
  config: SimConfig;
  world: World;
  tick: number;
  time: number;
  rng: number;
  mode: SimMode;
  modeT: number;
  index: number;
  hero: Hero;
  hp: number;
  maxHp: number;
  fluid: number;
  combo: number;
  /** Swings since the last arrival. */
  tally: SwingTally;
  /** Every swing tonight in this session, for the HUD. */
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
  /** Queued since the loop last drained them. */
  events: SimEvent[];
  commands: SimCommand[];
}
