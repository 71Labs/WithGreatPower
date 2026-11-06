/**
 * The frozen v1 contract between the 3D sim (game-core), the 3D scene (apps/wgp/src/game3d)
 * and the server verifier. Add fields freely; never rename or remove them without updating
 * every consumer in the same PR. v1.3 (ruleset 3) added the pickups, the combo, the route and
 * the hero's `controlled`; v1.4 (ruleset 4) a fight zone's `stage`; v1.5 (Case File 001, chapter
 * ruleset c001-1, patrol nights untouched) the frame's `chapter`, the Right-Clicker and a
 * villain's `aim`; v1.6 (Case File 002, ruleset c002-1) `chapter.vote`, the "lineup" phase and
 * Case File 002's clues (docs/chapters/case-002.md); v1.7 (free roam, ruleset tag roam-1, patrol
 * nights untouched) the frame's `roam`.
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
  /** Who fights here. Case File 001's bridge (v1.5) is the Right-Clicker's. */
  villain: "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil" | "right-clicker" | null;
  ally: "aunt-mainnet" | "uncle-gen" | "mary-jpeg" | "bearson" | "gwei" | null;
  /** Errands: where the ally stands (on the roof, or on the water tower for Gwei). Added in v1.1. */
  allyAt?: Vec3 | null;
  /**
   * Fights: the flat floor the fight happens on (the arena's roof, or Doc's deck between his
   * towers) and its height. The hero stays on it during the fight; `bounds` stays the wider box
   * the camera works in. Added in v1.4 (ruleset 4).
   */
  stage?: { x0: number; z0: number; x1: number; z1: number; y: number } | null;
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
    /** v1.5: "right-clicker" on Case File 001's bridge. */
    id: "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil" | "right-clicker";
    copy: boolean;
    pos: Vec3;
    hits: number;
    hitsMax: number;
    /**
     * A short state word for animation ("idle", "windup", "attack", "stunned", "guard", "open";
     * "webbed" once caught). The Right-Clicker's (v1.5): "idle", "aim", "flash", "recover",
     * "copy", "drag", "stunned", and "webbed" from the win on.
     */
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
    /**
     * The Right-Clicker's SCREENSHOT cone while he aims and flashes (state "aim" or "flash"),
     * else null: a unit xz direction (y = 0) from his position, and the cone's half-angle in
     * radians. The hero inside it at the flash is SAVED. Absent for the patrol villains. v1.5.
     */
    aim?: { dir: Vec3; half: number } | null;
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
  /**
   * A story chapter's night (Case File 001), else null. v1.5. Clues and copies keep their
   * order (copies by id, popped ones included, so the scene can play the pop); positions are
   * the sim's.
   * - phase: investigate (find the clues), standoff (the Right-Clicker on the deck), rescue
   *   (restore Mary), done (she's free; the night ends a beat later).
   * - clues: on roofs, feet level; found within CLUE_REACH (140) of the hero's centre across
   *   and 1.5 times that up and down.
   * - captive: Mary on the deck (feet level); restore 0–1, filled by holding the web beside her.
   * - copies: the paper cutouts; `yaw` turns the cutout's front (+z) to face (sin yaw, 0, cos yaw).
   */
  chapter?: {
    id: "case-001" | "case-002";
    /** v1.6: Case File 002 adds "lineup" (find the real Sybil among the voters) after the clues. */
    phase: "investigate" | "standoff" | "rescue" | "done" | "lineup";
    clues: { id: "tabs" | "cursor" | "pixels" | "footage" | "gif" | "signature"; pos: Vec3; found: boolean }[];
    /** Case File 002: Uncle Gen, waiting by the ballot box (`freed` once his vote is counted; `restore` 0, then 1). */
    captive: { pos: Vec3; restore: number; freed: boolean } | null;
    /** Case File 001's paper copies (empty on Case File 002, whose copies are the Sybil's bodies in `villains`). */
    copies: { id: number; pos: Vec3; yaw: number; alive: boolean }[];
    /** Case File 002 (v1.6), else absent. */
    vote?: VoteFrame | null;
  } | null;
  /**
   * A time trial (ruleset "trial-1"), else null or absent. v1.6, additive. The gates are the
   * frame's `pickups` (rings, in course order; `taken` once passed) and its `route` the gates
   * still ahead.
   * - next: the gate to pass next (0-based), `gates` once through the finish.
   * - ticks: the clock (sim ticks, 60 a second); it stops at the finish (`endTick`).
   * - splits: the tick each gate was passed at.
   */
  trial?: {
    course: "rooftop-sprint" | "bridge-run" | "canyon-swing" | "tower-climb" | "gauntlet";
    next: number;
    gates: number;
    ticks: number;
    splits: number[];
    finished: boolean;
    over: boolean;
  } | null;
  /** Free roam (the City mode, ruleset tag roam-1), else null or absent. v1.7; see RoamFrame. */
  roam?: RoamFrame | null;
}

/** A Case File 002 look: whether a voter casts a shadow, blinks, and holds his ballot in his left hand. */
export interface VoteLook {
  shadow: boolean;
  blink: boolean;
  left: boolean;
}

/**
 * Case File 002's frame (render contract v1.6; docs/chapters/case-002.md). Nothing here is
 * read back by the sim or hashed.
 */
export interface VoteFrame {
  /** The fight's stage: the polls, the recount (he hides in a ring again), the runoff. */
  stage: "polls" | "recount" | "runoff";
  /** The real Sybil's look tonight, and which of its tells the found clues have revealed. */
  real: VoteLook;
  known: VoteLook;
  /**
   * Every Sybil body by its slot (`villains` carries the same bodies, alive ones only): the
   * eight voters (0–7), then the fight's copies and the runner. `pos` is the body's centre,
   * VOTER_LIFT (52) over the floor; popped ones stay (alive: false) so the scene can pop them.
   */
  voters: (VoteLook & { id: number; pos: Vec3; alive: boolean; runner: boolean })[];
  /** The polling station's eight booths, floor level, in slot order of the lineup. */
  booths: Vec3[];
  /** Copies marked by mistake in the lineup. */
  wrong: number;
  /**
   * The fork vote under way, else null: the split runs along z at x = `at` (axis "x") or along
   * x at z = `at` (axis "z"); `orphan` (±1) is the side orphaned if it passes; seconds `left`
   * of `total`; `votes` of the copies that called it still stand, `need` to pass.
   */
  fork: { axis: "x" | "z"; at: number; orphan: number; left: number; total: number; need: number; votes: number } | null;
  /** The recount: seconds left before he steps out, else null. */
  recount: { left: number } | null;
  /** The ballot box beside Uncle Gen (floor level). */
  box: Vec3;
  /** Uncle Gen's ballot from the rescue on: held by the runner, carried by the hero, or counted (in the box). */
  ballot: { state: "runner" | "carried" | "counted"; pos: Vec3 } | null;
}

/* ------------------------------------------------------------------ free roam (v1.7) */

/**
 * What free roam's body is doing (sim3d/roam/types.ts RoamMove): on its feet, in the air, on
 * a wall, hanging from a ledge, pulling up over it, vaulting, running along a facade, rolling
 * out of a hard landing, zipping on the web, swinging, or in the river.
 */
export type RoamMoveName = "ground" | "air" | "climb" | "hang" | "mantle" | "vault" | "wallrun" | "roll" | "zip" | "swing" | "splash";

/**
 * Free roam's frame (filled by sim3d/roam/render.ts; never read back by the sim or hashed).
 * Positions are feet level unless said otherwise. Lists keep their fixed order (ids are
 * indices), found ones included, so the scene can play the moment one is found.
 */
export interface RoamFrame {
  move: RoamMoveName;
  /** Seconds in `move`. */
  moveT: number;
  sprint: boolean;
  /** The wall a climb, a hang, a mantle or a wall run is on: its outward normal (unit xz) and the top of its face. */
  wall: { nx: number; nz: number; top: number } | null;
  /** A scripted move's path (vault, mantle, zip): the body centre's from and to, and how far along (0–1). */
  path: { from: Vec3; to: Vec3; u: number } | null;
  /** Where a web-zip would go now (the reticle), or null. */
  zip: Vec3 | null;
  /** The pickpocket bot once it's out: feet position, velocity, what it's doing. */
  bot: { pos: Vec3; vel: Vec3; state: "running" | "waiting" | "caught" } | null;
  /** Everyone to talk to, by id: feet, the way they face (radians, 0 = +z), a civilian body (0–7) or a cast id, and whether they're mid-line. */
  folks: { id: number; key: string; pos: Vec3; yaw: number; body: number; cast: string | null; talking: boolean }[];
  /** The line on screen: who said it, which (rules/city.ts FOLKS[key].lines), and what's still to find for `{left}`. */
  chat: { folk: number; line: number; left: number } | null;
  /** What the interact button would do now: talk to folk `index`, photograph tag `index`, sync view `index`. */
  act: { kind: "talk" | "photo" | "sync"; index: number } | null;
  pages: { pos: Vec3; found: boolean }[];
  /** Viewpoints: `pos` is the perch on top of the mast; `roof` the roof it stands on. */
  views: { pos: Vec3; roof: number; synced: boolean }[];
  /** Mary Jpeg's pixels (shown while her task is on). */
  pixels: { pos: Vec3; found: boolean }[];
  /** Gas Goblin's tags: the centre on the wall and the wall's outward normal. */
  tags: { pos: Vec3; normal: Vec3; shot: boolean }[];
  /** Per task (rules/city.ts TASK_IDS order): its stage (9 finished) and items found. */
  tasks: { id: string; stage: number; got: number }[];
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
