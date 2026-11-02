/**
 * The 3D swing sim's state model. Plain data, mutated in place by stepSim at 60 Hz.
 * Y is up and the street is y = 0. Presentation (sprite spin, squash, hit flashes) is not
 * here: the scene animates from events and positions.
 */
import type { CastId } from "../rules/cast";
import type { PowerId, Stop, VillainId } from "../rules/types";
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
  /** Standing still at a spawn until the first web or stick, so nobody runs off a roof unawares. */
  idle: boolean;
}

/* ------------------------------------------------------------------ villains */

export interface Arm {
  /** Resting angle in the bridge plane, radians (0 along the bridge axis, π/2 straight up). */
  base: number;
  angle: number;
  len: number;
}

export interface SybilBody {
  x: number;
  y: number;
  z: number;
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

export type HitSource = "slam" | "dash" | "sling" | "web-bomb" | "validator-slam" | "gwei";

/** The 2D event union with z added. The scene animates from these; the bridge turns some into engine actions. */
export type SimEvent =
  | { type: "thwip"; x: number; y: number; z: number; ax: number; ay: number; az: number }
  | { type: "fizzle"; x: number; y: number; z: number }
  | { type: "release"; grade: "perfect" | "good" | null; x: number; y: number; z: number; combo: number }
  | { type: "miss"; x: number; y: number; z: number; damage: number; water: boolean }
  | { type: "land"; x: number; y: number; z: number; speed: number }
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
  | { type: "fight-won"; index: number; villain: VillainId; hp: number; fluid: number; uses: Partial<Record<PowerId, number>>; gweiUsed: number }
  | { type: "ko"; index: number; villain: VillainId; hp: number; fluid: number; uses: Partial<Record<PowerId, number>>; gweiUsed: number }
  | { type: "stop-done"; index: number }
  | { type: "errand"; index: number }
  | { type: "night-over"; reason: "ko" | "route" };

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
  combo: number;
  /** The best combo tonight in this session, for the score. */
  maxCombo: number;
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
}
