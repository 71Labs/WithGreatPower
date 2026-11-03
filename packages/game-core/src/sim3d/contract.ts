/**
 * The frozen v1 contract between the 3D sim (game-core), the 3D scene (apps/wgp/src/game3d)
 * and the server verifier. Add fields freely; never rename or remove them without updating
 * every consumer in the same PR. v1.3 (ruleset 3) added the pickups, the combo, the route and
 * the hero's `controlled`.
 *
 * Units: one unit ≈ one CSS pixel at 1× (the hero is ~88 tall), Y up, the street at y = 0.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/* ------------------------------------------------------------------ city */

export type DistrictId = "sector-7" | "mempool-market" | "bridge-district" | "queens-block" | "validator-heights";

/** An axis-aligned building: a box from the street up to `h`, optionally with a smaller box on top. */
export interface Building {
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Roof height of the main box. */
  h: number;
  /**
   * A setback tier on the roof, if any. Its `h` is the tier's own roof height, measured from
   * the street like the building's (so the tier spans y = building.h → top.h).
   */
  top: { x0: number; z0: number; x1: number; z1: number; h: number } | null;
  district: DistrictId;
  /** Index into CITY.near/mid/far-like fills, chosen by the generator; the scene maps it to a color. */
  tone: number;
  /** Warm accent building (brick, plum, teal) instead of the night blues. */
  accent: boolean;
  /** Per-building seed for windows and props. */
  seed: number;
}

export type PropKind = "water-tower" | "antenna" | "billboard" | "ac" | "crane" | "vent";

export interface Prop {
  kind: PropKind;
  /** Base position (on a roof, or the street for cranes). */
  at: Vec3;
  /** Yaw in quarter turns (0–3), so props line up with the grid without trig. */
  facing: 0 | 1 | 2 | 3;
  /** Billboards only. */
  text?: string;
  /** Size along the prop's own axes. */
  w: number;
  h: number;
  d: number;
  buildingId: number | null;
}

/** A place the web can stick to that isn't a roof edge (water-tower rims, antenna tips, crane jibs, bridge cables). */
export interface PropAnchor {
  at: Vec3;
  kind: "tower" | "antenna" | "crane" | "cable" | "billboard" | "ledge";
}

export type ZoneKind = "fight" | "errand";

/** A patrol stop placed in the city. Fight zones are arenas; errand zones are a rooftop with the ally. */
export interface Zone {
  index: number;
  kind: ZoneKind;
  district: DistrictId;
  /** Arena or rooftop centre. */
  center: Vec3;
  /** Arena bounds (axis-aligned), which keep villains and the camera inside. */
  bounds: { x0: number; z0: number; x1: number; z1: number; h: number };
  villain: "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil" | null;
  ally: "aunt-mainnet" | "uncle-gen" | "mary-jpeg" | "bearson" | "gwei" | null;
  /** Errands: where the ally stands (on the roof, or on the water tower for Gwei). Added in v1.1. */
  allyAt?: Vec3 | null;
}

export interface Bridge {
  /** Deck as a box; cables are listed as anchors. */
  deck: { x0: number; z0: number; x1: number; z1: number; y: number };
  /** The tower legs' top centres; each leg is a square column from the street up to its y. */
  towers: Vec3[];
  /** The axis the deck runs along (Doc's arms sweep in the vertical plane along it). Added in v1.1. */
  axis?: "x" | "z";
  /** Half the side of each square tower leg. Added in v1.1. */
  towerHalf?: number;
}

/** A sagging line between two points: street wires, arena lines and bridge cables. Added in v1.1. */
export interface Cable {
  a: Vec3;
  b: Vec3;
  /** How far the middle hangs below the straight line: a point at t is lerp(a, b, t) − sag·4t(1 − t) in y. */
  sag: number;
  kind: "wire" | "arena" | "bridge";
}

export interface City {
  seed: number;
  /** Extent of the playable area. */
  bounds: { x0: number; z0: number; x1: number; z1: number };
  buildings: Building[];
  props: Prop[];
  anchors: PropAnchor[];
  zones: Zone[];
  /** A river channel (a miss, like the street) running along one grid line, if this night has the bridge. */
  river: { x0: number; z0: number; x1: number; z1: number } | null;
  bridge: Bridge | null;
  /** Where the hero starts: a point on a central roof (feet on the roof; the sim adds the hero's radius). */
  start: Vec3;
  /** Every cable, for drawing; their web anchors are already in `anchors`. Added in v1.1. */
  cables?: Cable[];
}

/* ------------------------------------------------------------------ input */

/**
 * One frame of input, the only thing recorded and replayed. The stick is a world-space
 * direction quantized to 64 headings (index into DIR64) and 4 magnitudes, so camera math
 * never reaches the sim.
 */
export interface InputFrame {
  /** 0–63, an index into DIR64. Must be 0 when mag is 0. */
  dir: number;
  /** 0 (none) to 3 (full). */
  mag: number;
  /** Web button held. */
  web: boolean;
  /** One-shot this tick: 0 none, 1–4 ability slot, 5 call Gwei. */
  shot: 0 | 1 | 2 | 3 | 4 | 5;
}

/** Discrete choices that pause the sim (errands), logged with the tick they apply at. */
export interface InputEvent {
  tick: number;
  kind: "errand-choice";
  /** Index of the chosen option in the errand's choices. */
  value: number;
}

/* ------------------------------------------------------------------ render frame */

/**
 * The hero's body state, for animation only (never read back by the sim). Added in v1.2.
 * - idle / run: on a roof or the street, standing or running.
 * - swing: on a rope. air: falling or flying free. climb: on a wall.
 * - dash, slam: the matching powers. held: stuck in a bread trap.
 * - hurt: the moment after a hit. ko: out of health.
 */
export type HeroAction = "idle" | "run" | "swing" | "air" | "climb" | "dash" | "slam" | "held" | "hurt" | "ko";

/** What the scene reads every frame. Mutated in place by the loop; never stored in React state. */
export interface RenderFrame3D {
  tick: number;
  /** Interpolation factor between the last two sim ticks, 0–1. */
  alpha: number;
  hero: {
    pos: Vec3;
    vel: Vec3;
    /** Where the web is stuck, or null. */
    anchor: Vec3 | null;
    grounded: boolean;
    hp: number;
    maxHp: number;
    fluid: number;
    /** Brief invulnerability after a hit, for flashing. */
    hurtFlash: number;
    shield: boolean;
    /** Facing, a unit xz vector (y = 0). Added in v1.2. */
    facing?: Vec3;
    /** What the body is doing, for the character animator. Added in v1.2. */
    action?: HeroAction;
    /** Sim ticks since `action` began. Added in v1.2. */
    actionTicks?: number;
    /** Rope length while swinging, else 0. Added in v1.2. */
    ropeLen?: number;
    /** Cloaked (Node sense): drawn faded. Added in v1.2. */
    cloak?: boolean;
    /**
     * The player is giving input this tick (the stick tilted or the web held); false when idle,
     * when the hero just stands and waits (nothing moves him without input since ruleset 3).
     * Added in v1.3.
     */
    controlled?: boolean;
  };
  villains: {
    id: "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil";
    copy: boolean;
    pos: Vec3;
    hits: number;
    hitsMax: number;
    /** A short state word for animation ("idle", "windup", "attack", "stunned", "guard", "open"). */
    state: string;
    /** Velocity, units per second. Added in v1.2. */
    vel?: Vec3;
    /** Facing, a unit xz vector (y = 0). Added in v1.2. */
    facing?: Vec3;
    /** Ticks since `state` began. Added in v1.2. */
    stateTicks?: number;
    /** Doc's chain arms as shoulder → tip segments, in world space. Added in v1.2. */
    arms?: { from: Vec3; to: Vec3 }[];
    /**
     * Roll into a turn, radians (Gas Goblin's glider banks; 0 for the others): the body's up
     * tilts toward the facing turned 90° from +x toward +z, i.e. (−facing.z, 0, facing.x), by
     * this angle. Added in v1.2 (ruleset 2).
     */
    bank?: number;
  }[];
  /** Hazards and projectiles: fee bombs, bread traps, goo, chain arms (as segments). */
  hazards: { kind: string; pos: Vec3; to?: Vec3; r: number; armed: boolean }[];
  /** Index of the zone being travelled to or played. */
  stop: number;
  mode: "intro" | "travel" | "fight" | "won" | "errand" | "ko" | "done";
  timeScale: number;
  /**
   * The night's Bits tokens and boost rings, in a fixed order (ids are indices), taken ones
   * included so the scene can play the pickup. Positions never move. A token is taken within
   * 80 units of the hero's centre (120 up and down), a ring within 110 (165). Added in v1.3
   * (ruleset 3).
   */
  pickups?: { id: number; kind: "bits" | "ring"; pos: Vec3; taken: boolean }[];
  /** The combo: its count, the multiplier on pickups (1–4) and ticks before it runs out. Added in v1.3. */
  combo?: { count: number; multiplier: number; ticksLeft: number };
  /** The remaining stop centres in order (the current stop first), for the map. Added in v1.3. */
  route?: Vec3[];
}

/* ------------------------------------------------------------------ replay (server verifier) */

export interface ReplayInput {
  /** The save at run start (server copy), with the patrol already started from `seed`. */
  save: unknown;
  seed: number;
  /** The encoded input log (bytes). */
  log: Uint8Array;
}

export interface ReplayResult {
  ok: boolean;
  /** Why a replay was rejected (decode error, ruleset mismatch, didn't finish, …). */
  reason?: string;
  /** The save after finish-patrol, as the server will store it. */
  save: unknown;
  score: number;
  ticks: number;
  stats: Record<string, number>;
  /** State hash at each stop boundary, to localise a desync. */
  checkpoints: string[];
  /** Final state hash. */
  hash: string;
}
