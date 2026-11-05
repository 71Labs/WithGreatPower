/**
 * Synthetic motion for the cast lab: a small stage city (a roof with a raised step, a tall
 * wall beside it) and a `RenderFrame3D` written every frame for one character in one state,
 * from closed-form motion: a pendulum swing (scrubbable), a run around the roof, a jump arc
 * with a landing, a climb up the wall, a dash, a slam, Doc's arm sweeps, Sybil's orbit, a
 * stride from standing to a walk, a run and back to a stop, and a plain drop onto the roof.
 * Never the game's physics; never used outside /lab.
 */
import type { City, HeroAction, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { SceneVillain } from "@/game3d/scene/chapter/contract";
import type { CharacterKey } from "@/game3d/scene/characters/model";

export const ROOF = 300;
const STEP_H = 18;
const WALL_X = 430;

export type LabCharacter = Exclude<CharacterKey, "sybil-copy">;

/**
 * The hero's actions, plus lab-only moves: `stride` (stand, walk, run, stop), `land` (a drop
 * onto the roof), `reverse` (run, pull the stick back, run back, stop, start off behind him),
 * `strafe` (the stick to the side while the sim's facing stays put) and `turn` (the facing
 * swung round on the spot).
 */
export const HERO_STATES: string[] = ["idle", "stride", "reverse", "strafe", "turn", "run", "swing", "air", "land", "climb", "dash", "slam", "held", "hurt", "ko"];
/** The sim's villain states, plus `hit` (idle, taking a blow every 1.4 s). */
export const VILLAIN_STATES = ["idle", "windup", "attack", "hit", "stunned", "guard", "open", "webbed"] as const;
/** Waiting, `wave` (the hero swings close) and `talk` (the errand is open). */
export const ALLY_STATES = ["idle", "wave", "talk"] as const;

export const ALLIES: LabCharacter[] = ["aunt-mainnet", "uncle-gen", "mary-jpeg", "bearson", "gwei"];
export const VILLAINS: LabCharacter[] = ["gas-goblin", "sandwich-man", "doc-octochain", "sybil", "right-clicker"];
/**
 * Case file 001's Right-Clicker: his phases, plus `walk` (idle, walking a circle), `hit`, and
 * `webbed` (beaten). `flash` loops the whole shot (aim, click, reload); `copy` and `drag` repeat.
 */
export const RIGHT_CLICKER_STATES = ["idle", "walk", "aim", "flash", "recover", "copy", "drag", "stunned", "hit", "webbed"] as const;

export function statesFor(c: LabCharacter): readonly string[] {
  if (c === "hero") return HERO_STATES;
  if (c === "right-clicker") return RIGHT_CLICKER_STATES;
  if (VILLAINS.includes(c)) return VILLAIN_STATES;
  return ALLY_STATES;
}

/** The stage: one roof (with a setback step), a tall wall to climb, a few blocks around. */
export function labCity(ally: LabCharacter | null): City {
  const b = (id: number, x0: number, z0: number, x1: number, z1: number, h: number, tone: number, top: City["buildings"][number]["top"] = null) => ({
    id,
    x0,
    z0,
    x1,
    z1,
    h,
    top,
    district: "queens-block" as const,
    tone,
    accent: id % 3 === 2,
    seed: 11 + id * 7,
  });
  const allyAt = { x: -150, y: ROOF, z: -120 };
  return {
    seed: 7,
    bounds: { x0: -1600, z0: -1600, x1: 1600, z1: 1600 },
    buildings: [
      b(0, -420, -420, 400, 420, ROOF, 0, { x0: 120, z0: -420, x1: 400, z1: 420, h: ROOF + STEP_H }),
      b(1, WALL_X, -320, 760, 320, 680, 1),
      b(2, -1100, -900, -620, -380, 520, 2),
      b(3, -900, 620, -360, 1100, 420, 3),
      b(4, 560, 620, 1100, 1150, 760, 4),
      b(5, -1300, 200, -760, 560, 360, 5),
    ],
    props: [],
    anchors: [],
    zones: ally
      ? [
          {
            index: 0,
            kind: "errand",
            district: "queens-block",
            center: { x: 0, y: ROOF, z: 0 },
            bounds: { x0: -420, z0: -420, x1: 400, z1: 420, h: 1000 },
            villain: null,
            ally: ally as Exclude<City["zones"][number]["ally"], null>,
            allyAt,
          },
        ]
      : [],
    river: null,
    bridge: null,
    start: { x: 0, y: ROOF, z: 0 },
    cables: [],
  };
}

const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** The sim's roof running (ruleset 2's numbers): the push from a standstill, easing off near the top speed, and the brake that also kills sideways slip. */
const RUN_TOP = 390;
const RUN_ACCEL = 1900;
const RUN_ACCEL_TOP = 0.4;
const RUN_BRAKE = 2200;
/** How fast the sim turns the facing toward the velocity (rad/s). */
const SIM_TURN = 12;

/** One step of a stick program: where the stick points (null: let go) until `until` says it's done. */
interface StickStep {
  stick: [number, number] | null;
  until(t: number, p: Vec3): boolean;
}

/**
 * A copy of game-core's `run` on a roof: speed along the stick on an easing curve, braking
 * when over it or going the other way, sideways slip braked away; the sim's facing turns
 * toward the velocity at its rate.
 */
class RoofRunner {
  readonly pos = v();
  readonly vel = v();
  yaw = 0;
  private step = 0;
  private t = 0;

  reset(x: number, z: number, yaw: number): void {
    Object.assign(this.pos, v(x, ROOF + 26, z));
    Object.assign(this.vel, v());
    this.yaw = yaw;
    this.step = 0;
    this.t = 0;
  }

  /** Advance the program by dt (it loops); returns the stick in use. */
  advance(program: StickStep[], dt: number): [number, number] | null {
    let s = program[this.step];
    this.t += dt;
    if (s.until(this.t, this.pos)) {
      this.step = (this.step + 1) % program.length;
      this.t = 0;
      s = program[this.step];
    }
    const stick = s.stick;
    const h = this.vel;
    const [hx, hz] = stick ?? (Math.hypot(h.x, h.z) > 1 ? [h.x / Math.hypot(h.x, h.z), h.z / Math.hypot(h.x, h.z)] : [Math.sin(this.yaw), Math.cos(this.yaw)]);
    const target = stick ? RUN_TOP : 0;
    const along = h.x * hx + h.z * hz;
    const side = -h.x * hz + h.z * hx;
    let a = along;
    if (a < target) {
      if (a < 0) a = Math.min(target, a + RUN_BRAKE * dt);
      else a = Math.min(target, a + RUN_ACCEL * (1 - (1 - RUN_ACCEL_TOP) * Math.min(1, a / Math.max(1, target))) * dt);
    } else if (a > target) a = Math.max(target, a - RUN_BRAKE * dt);
    const sd = side > 0 ? Math.max(0, side - RUN_BRAKE * dt) : Math.min(0, side + RUN_BRAKE * dt);
    h.x = hx * a - hz * sd;
    h.z = hz * a + hx * sd;
    this.pos.x += h.x * dt;
    this.pos.z += h.z * dt;
    const hs = Math.hypot(h.x, h.z);
    if (hs > 30) {
      let d = Math.atan2(h.x, h.z) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += Math.max(-SIM_TURN * dt, Math.min(SIM_TURN * dt, d));
    }
    return stick;
  }
}

const after = (s: number) => (t: number) => t >= s;
/** Run up the roof, pull the stick back into a reversal, run back past the start, stop, then start off the way he isn't facing. */
const REVERSE: StickStep[] = [
  { stick: null, until: after(1.2) },
  { stick: [0, 1], until: (_, p) => p.z > 170 },
  { stick: [0, -1], until: (_, p) => p.z < -200 },
  { stick: null, until: after(1.4) },
];
/** The stick to one side and the other, with stops, while the sim's facing stays on +z. */
const STRAFE: StickStep[] = [
  { stick: null, until: after(1) },
  { stick: [1, 0], until: (_, p) => p.x > 60 },
  { stick: null, until: after(1.1) },
  { stick: [-1, 0], until: (_, p) => p.x < -250 },
  { stick: null, until: after(1.1) },
];

export class CastScript {
  readonly frame: RenderFrame3D;
  character: LabCharacter = "hero";
  state = "idle";
  /** Swing scrub, 0–1 through one full cycle; null plays it. */
  scrub: number | null = null;
  /** Fires when the script wants a flip (a perfect release in the air loop). */
  onFlip: (() => void) | null = null;
  private t = 0;
  private lastCycle = -1;
  private readonly runner = new RoofRunner();
  /** Distance round the stride's circle. */
  private dist = 0;

  constructor() {
    this.frame = {
      tick: 0,
      alpha: 1,
      hero: { pos: v(0, ROOF + 26, 0), vel: v(), anchor: null, grounded: true, hp: 100, maxHp: 100, fluid: 100, hurtFlash: 0, shield: false, facing: v(0, 0, 1), action: "idle", actionTicks: 0, ropeLen: 0, cloak: false },
      villains: [],
      hazards: [],
      stop: 0,
      mode: "travel",
      timeScale: 1,
    };
  }

  set(character: LabCharacter, state: string): void {
    this.character = character;
    this.state = state;
    this.t = 0;
    this.lastCycle = -1;
    if (state === "reverse") this.runner.reset(-60, -200, 0);
    if (state === "strafe") this.runner.reset(-95, -40, 0);
  }

  /** Where the camera should look (the featured body's middle). */
  focus(out: Vec3): Vec3 {
    const f = this.frame;
    if (this.character === "hero") {
      const p = f.hero.pos;
      if (this.state === "swing" && f.hero.anchor) return Object.assign(out, { x: 0, y: ROOF + 170, z: 0 });
      return Object.assign(out, { x: p.x, y: p.y + (f.hero.grounded ? 18 : 0), z: p.z });
    }
    if (VILLAINS.includes(this.character)) {
      const real = f.villains.find((x) => !x.copy);
      return real ? Object.assign(out, real.pos) : Object.assign(out, v(0, ROOF + 60, 0));
    }
    return Object.assign(out, { x: -150, y: ROOF + 44, z: -120 });
  }

  step(dt: number): void {
    this.t += dt;
    const f = this.frame;
    f.tick++;
    f.hazards.length = 0;
    if (this.character === "hero") {
      f.mode = this.state === "ko" ? "ko" : "travel";
      f.villains.length = 0;
      this.hero(dt);
    } else if (VILLAINS.includes(this.character)) {
      f.mode = this.state === "webbed" ? "won" : "fight";
      // The hero stands out of frame, so the villain is the only body on stage.
      this.park(560);
      this.villain();
    } else {
      f.mode = this.state === "talk" ? "errand" : "travel";
      f.villains.length = 0;
      this.park(this.state === "wave" ? 330 : 560);
    }
  }

  /** The hero stands out of frame, `d` from the ally's spot. */
  private park(d: number): void {
    const h = this.frame.hero;
    Object.assign(h.pos, v(-150 - d * 0.45, ROOF + 26, -120 + d * 0.89));
    Object.assign(h.vel, v());
    h.grounded = true;
    h.anchor = null;
    h.action = "idle";
  }

  private hero(dt: number): void {
    const h = this.frame.hero;
    const t = this.t;
    h.anchor = null;
    h.hurtFlash = Math.max(0, h.hurtFlash - dt);
    h.grounded = false;
    h.cloak = false;
    const set = (p: Vec3, vel: Vec3, grounded: boolean, action: HeroAction) => {
      Object.assign(h.pos, p);
      Object.assign(h.vel, vel);
      h.grounded = grounded;
      if (h.action !== action) h.actionTicks = 0;
      else h.actionTicks = (h.actionTicks ?? 0) + 1;
      h.action = action;
      const hs = Math.hypot(vel.x, vel.z);
      if (hs > 30) h.facing = v(vel.x / hs, 0, vel.z / hs);
    };
    switch (this.state) {
      case "idle":
        set(v(0, ROOF + 26, 0), v(), true, "idle");
        break;
      case "stride": {
        // Stand, start into a walk, speed up to a run, pull up to a stop, stand: round a
        // circle on the low roof, so the camera can stay on him.
        const u = t % 8.4;
        const sp = u < 1 ? 0 : u < 1.6 ? (75 * (u - 1)) / 0.6 : u < 3.4 ? 75 : u < 4.4 ? 75 + 315 * (u - 3.4) : u < 6 ? 390 : u < 6.5 ? 390 * (1 - (u - 6) / 0.5) : 0;
        this.dist += sp * dt;
        const R = 170;
        const a = this.dist / R;
        set(v(-120 + Math.cos(a) * R, ROOF + 26, Math.sin(a) * R), v(-Math.sin(a) * sp, 0, Math.cos(a) * sp), true, sp > 1 ? "run" : "idle");
        break;
      }
      case "reverse":
      case "strafe": {
        const r = this.runner;
        r.advance(this.state === "reverse" ? REVERSE : STRAFE, dt);
        const moving = Math.hypot(r.vel.x, r.vel.z) > 1;
        set(r.pos, r.vel, true, moving ? "run" : "idle");
        // The sim's facing: turning toward the velocity at its rate, or (strafing) held on +z.
        h.facing = this.state === "strafe" ? v(0, 0, 1) : v(Math.sin(r.yaw), 0, Math.cos(r.yaw));
        break;
      }
      case "turn": {
        // On the spot: the facing swung 90° left, then 180° right, then back, at the sim's rate.
        const u = t % 5.4;
        const want = u < 1.2 ? 0 : u < 2.6 ? Math.PI / 2 : u < 4 ? -Math.PI / 2 : 0;
        const from = u < 1.2 ? 0 : u < 2.6 ? 0 : u < 4 ? Math.PI / 2 : -Math.PI / 2;
        const start = u < 1.2 ? 0 : u < 2.6 ? 1.2 : u < 4 ? 2.6 : 4;
        const d = want - from;
        const yaw = from + Math.sign(d) * Math.min(Math.abs(d), SIM_TURN * (u - start));
        set(v(0, ROOF + 26, 0), v(), true, "idle");
        h.facing = v(Math.sin(yaw), 0, Math.cos(yaw));
        break;
      }
      case "land": {
        // Dropped from 230 up onto the roof, then standing.
        const u = t % 2.6;
        const fall = Math.sqrt((2 * 230) / 1750);
        if (u < fall) set(v(-60, ROOF + 26 + 230 - 0.5 * 1750 * u * u, 40), v(0, -1750 * u, 0), false, "air");
        else set(v(-60, ROOF + 26, 40), v(), true, "idle");
        break;
      }
      case "run": {
        // A lap of the roof, over the step.
        const R = 190;
        const w = 390 / R;
        const a = t * w;
        const x = Math.cos(a) * R;
        const z = Math.sin(a) * R;
        const top = x > 120 ? ROOF + STEP_H : ROOF;
        set(v(x, top + 26, z), v(-Math.sin(a) * 390, 0, Math.cos(a) * 390), true, "run");
        break;
      }
      case "swing": {
        const L = 300;
        const anchor = v(0, ROOF + 330, 0);
        const amp = 1.05;
        const w = Math.sqrt(1750 / L);
        const period = (Math.PI * 2) / w;
        const phase = this.scrub !== null ? this.scrub * Math.PI * 2 : (t / period) * Math.PI * 2;
        const th = amp * Math.sin(phase);
        const thd = amp * Math.cos(phase) * w;
        const p = v(anchor.x + Math.sin(th) * L, anchor.y - Math.cos(th) * L, anchor.z);
        const vel = v(Math.cos(th) * L * thd, Math.sin(th) * L * thd, 0);
        set(p, vel, false, "swing");
        h.anchor = anchor;
        h.ropeLen = L;
        // Face along the arc's travel, held through the turn at each end.
        h.facing = v(thd >= 0 ? 1 : -1, 0, 0);
        break;
      }
      case "air": {
        // Hop arcs across the roof: launch, a perfect-release flip at the top, land.
        const cycle = 1.7;
        const k = Math.floor(t / cycle);
        const u = t - k * cycle;
        const dir = k % 2 === 0 ? 1 : -1;
        const flight = 1.25;
        if (u < flight) {
          const vy0 = 900;
          const y = ROOF + 26 + vy0 * u - 0.5 * 1750 * u * u;
          const x = dir * (-220 + 440 * (u / flight));
          set(v(x, Math.max(ROOF + 26, y), 40), v(dir * 352, vy0 - 1750 * u, 0), false, "air");
          if (k !== this.lastCycle && u > 0.12) {
            this.lastCycle = k;
            if (k % 2 === 0) this.onFlip?.();
          }
        } else {
          set(v(dir * 220, ROOF + 26, 40), v(), true, "idle");
        }
        break;
      }
      case "climb": {
        // Up the wall beside the roof on a web, then back down to start again.
        const cycle = 2.2;
        const u = (t % cycle) / cycle;
        const y = ROOF + 60 + u * 280;
        set(v(WALL_X - 26, y, 0), v(0, 360 * (280 / (cycle * 280)) * 1.4, 0), false, "climb");
        // The web stuck on the wall's top edge, straight up the face from the hero.
        h.anchor = v(WALL_X, 680 + 10, 0);
        h.ropeLen = 680 - y;
        h.facing = v(1, 0, 0);
        break;
      }
      case "dash": {
        const cycle = 1.4;
        const u = (t % cycle) / cycle;
        const dir = Math.floor(t / cycle) % 2 === 0 ? 1 : -1;
        if (u < 0.32) set(v(dir * (-260 + 520 * (u / 0.32)), ROOF + 70, 0), v(dir * 1300, 0, 0), false, "dash");
        else set(v(dir * 260, ROOF + 70 - (u - 0.32) * 60, 0), v(dir * 80, -200, 0), false, "air");
        break;
      }
      case "slam": {
        const cycle = 1.8;
        const u = t % cycle;
        if (u < 0.3) set(v(0, ROOF + 26 + 440 - u * 1466, 0), v(60, -1500, 0), false, "slam");
        else set(v(0, ROOF + 26, 0), v(), true, "idle");
        break;
      }
      case "held":
        set(v(0, ROOF + 26, 0), v(), true, "held");
        break;
      case "hurt": {
        const cycle = 1.4;
        const u = t % cycle;
        set(v(0, ROOF + 26, 0), v(), true, u < 0.35 ? "hurt" : "idle");
        if (u < dt * 1.5) h.hurtFlash = 1;
        break;
      }
      case "ko": {
        const cycle = 3.4;
        const u = t % cycle;
        if (u < 2.6) {
          this.frame.mode = "ko";
          set(v(0, ROOF + 26, 0), v(u < 0.05 ? 120 : 0, u < 0.05 ? 200 : 0, 0), true, "ko");
        } else {
          this.frame.mode = "travel";
          set(v(0, ROOF + 26, 0), v(), true, "idle");
        }
        break;
      }
    }
  }

  /** The Right-Clicker on the roof, by lab state (his phases loop the way a fight runs them). */
  private rightClicker(): void {
    const f = this.frame;
    const t = this.t;
    const list = f.villains as SceneVillain[];
    list.length = 0;
    let state: string = this.state;
    let st = t;
    let pos = v(0, ROOF + 26, 0);
    let vel = v();
    if (state === "walk") {
      const R = 120;
      const a = t * (55 / R);
      pos = v(Math.cos(a) * R, ROOF + 26, Math.sin(a) * R - 40);
      vel = v(-Math.sin(a) * 55, 0, Math.cos(a) * 55);
      state = "idle";
    } else if (state === "flash") {
      const u = t % 2.3;
      [state, st] = u < 0.9 ? ["aim", u] : u < 1.05 ? ["flash", u - 0.9] : ["recover", u - 1.05];
    } else if (state === "copy" || state === "drag") {
      const len = state === "copy" ? 1.2 : 1.0;
      const u = t % (len + 0.9);
      [state, st] = u < len ? [state, u] : ["idle", u - len];
    } else if (state === "hit") state = "idle";
    const hits = this.state === "hit" ? 8 - (Math.floor(t / 1.4) % 8) : 5;
    const aim = state === "aim" || state === "flash" ? { dir: v(0.6, 0, 0.8), half: 0.32 } : null;
    list.push({ id: "right-clicker", copy: false, pos, vel, hits, hitsMax: 8, state, stateTicks: Math.floor(st * 60), aim, facing: state === "idle" && this.state === "walk" ? undefined : v(0.6, 0, 0.8) });
  }

  private villain(): void {
    const f = this.frame;
    if (this.character === "right-clicker") {
      this.rightClicker();
      return;
    }
    const id = this.character as "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil";
    const t = this.t;
    const state = this.state === "hit" ? "idle" : this.state;
    f.villains.length = 0;
    // `hit`: a blow lands every 1.4 s (the hits count drops, then resets).
    const hits = this.state === "hit" ? 5 - (Math.floor(t / 1.4) % 5) : 3;
    const push = (pos: Vec3, vel: Vec3, copy = false) => f.villains.push({ id, copy, pos, vel, hits, hitsMax: 5, state, stateTicks: Math.floor(t * 60) });
    if (id === "gas-goblin") {
      // A lazy figure-eight over the roof.
      const a = t * 0.55;
      const pos = v(Math.sin(a) * 200, ROOF + 200 + Math.sin(a * 2 + 1.2) * 40, Math.sin(a * 2) * 140);
      const vel = v(Math.cos(a) * 200 * 0.55, Math.cos(a * 2 + 1.2) * 40 * 1.1, Math.cos(a * 2) * 140 * 1.1);
      if (state === "webbed") push(v(0, ROOF + 200, 0), v());
      else push(state === "idle" || state === "attack" ? pos : v(0, ROOF + 200, 0), state === "idle" || state === "attack" ? vel : v());
    } else if (id === "sandwich-man") {
      if (state === "idle") {
        const R = 170;
        const a = t * (250 / R);
        push(v(Math.cos(a) * R, ROOF + 44, Math.sin(a) * R - 60), v(-Math.sin(a) * 250, 0, Math.cos(a) * 250));
      } else if (state === "attack") {
        const u = t % 1.4;
        push(u < 0.5 ? v(-200 + u * 800, ROOF + 60 + Math.sin(u * Math.PI * 2) * 30, 0) : v(200, ROOF + 44, 0), u < 0.5 ? v(1150, 0, 0) : v());
      } else if (state === "guard") {
        // A hop over a web.
        const u = t % 1.2;
        const y = ROOF + 44 + Math.max(0, 840 * u - 0.5 * 1700 * u * u);
        push(v(0, y, 0), v(0, y > ROOF + 45 ? 840 - 1700 * u : 0, 0));
      } else push(v(0, ROOF + 44, 0), v());
    } else if (id === "doc-octochain") {
      const pos = v(0, ROOF + 190 + Math.sin(t * 1.3) * 12, 0);
      push(pos, v());
      // His arm tips, as the sim sweeps them in the vertical plane along x.
      const bases = [-2.55, -1.95, -1.19, -0.59];
      const arms = bases.map((base, i) => {
        let angle = base;
        let len = 48;
        if (state === "attack") {
          angle = base + Math.sin(t * 1.35 + i * 1.4) * 0.95;
          len = 285;
        } else if (state === "windup") {
          angle = Math.PI / 2 + (i - 1.5) * 0.42;
          len = 250;
        } else if (state === "stunned") len = 70;
        // From his shoulders along the bridge axis (x), as game-core's armShoulder places them.
        const sh = [[-0.55, 0.12], [-0.3, -0.32], [0.3, -0.32], [0.55, 0.12]][i];
        const from = v(pos.x + sh[0] * 50, pos.y + sh[1] * 50, pos.z);
        return { from, to: v(from.x + Math.cos(angle) * len, from.y + Math.sin(angle) * len, from.z) };
      });
      f.villains[0].arms = arms;
      for (const a of arms) f.hazards.push({ kind: "arm", pos: a.from, to: a.to, r: 20, armed: state === "attack" });
    } else {
      const c = v(Math.sin(t * 0.4) * 60, ROOF + 170 + Math.sin(t * 0.8) * 30, 0);
      push(c, v());
      if (state !== "webbed") {
        for (let k = 0; k < 4; k++) {
          const a = t * 1.2 + ((k + 1) * Math.PI * 2) / 5;
          push(v(c.x + Math.cos(a) * 160, c.y + Math.sin(a) * 40, c.z + Math.sin(a) * 160), v(), true);
        }
      }
    }
  }
}
