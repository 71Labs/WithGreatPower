/**
 * The hero's animator: the body follows the sim's real motion, never a canned clip.
 *
 * - Swing: the body hangs along the rope with its centre of mass on the line; the web
 *   hand is IK-pinned to the line above the head (the web starts at that fist); the free
 *   limbs ride springs in the body's accelerating frame, so the arc's centripetal load
 *   stretches them out and the swing phase tucks the knees through the bottom and kicks
 *   them out on the rise.
 * - Air: the pose follows vertical velocity (a reach on the rise, an arched dive, a
 *   brace for landing), limbs on springs. A perfect release somersaults at a spin rate
 *   fitted to the release speed.
 * - Ground: the body faces where it's going (a fast yaw spring onto the velocity, never a
 *   run backwards or sideways); a sharp start or a reversal is a pivot on the outer foot
 *   with the torso leading; standing, it turns on the spot in steps, the pelvis held by the
 *   planted feet so they never cross under him. A run cycle whose phase advances by distance
 *   travelled, so planted feet never slide; feet IK onto the roof; landing compression
 *   scaled by the impact; breathing.
 * - Climb: hands and feet planted on the wall in alternation, the web hand on the line.
 * - Dash, slam (a dive, then the impact crouch), held (struggling), hurt (a kick into the
 *   spine and head springs) and KO (a Verlet ragdoll).
 * - Hands with fingers (the MPFB hero) close into a fist on the web, in a slam or a
 *   struggle, and open when reaching, running or diving.
 *
 * Works on any humanoid rig: the procedural cast's (Gwei) or the hero's MPFB skeleton, whose
 * longer legs scale the feet's body-frame targets (they were tuned on the procedural body).
 * Given motion-capture clips (setClips), the MPFB hero stands, walks, runs, lands, flinches,
 * punches and falls with them (anim/mocap.ts); the physics poses stay for the swing, the
 * climb, the dash and the slam, and the procedural layer stays on top of the clips.
 *
 * Everything stateful steps on the kit's fixed 120 Hz sub-step and is drawn interpolated,
 * so nothing shakes with the sim's 60 Hz ticks or the display's rate.
 */
import { Quaternion, Vector3, type Bone, type Group } from "three";

import { HERO_RADIUS } from "@wgp/game-core/sim3d/constants";
import type { HeroAction, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { Footing } from "../../camera/raycast";

import { Spring, Spring3 } from "../physics/spring";
import { FixedStepper } from "../physics/stepper";
import { type Rig } from "../rig";
import { angleTo, bodyPoint, clamp, frameQuat, lerp, Orient, Plant, smoothstep, Turn, UP, withYaw, yawOf, yawQuat } from "./common";
import type { HeroClips } from "../hero-asset";
import { worldPos } from "../rig";
import { Mocap } from "./mocap";
import { applyPose, newPose, newSolved, type Pose, type Solved } from "./pose";
import { Ragdoll } from "./ragdoll";
import type { AnimContext } from "./types";

type Base = "ground" | "swing" | "air" | "climb" | "dash" | "slam" | "ko";

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _q2 = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();

/** Hip joint to ankle on the procedural hero, which the feet's targets were tuned on. */
const TUNED_LEG = 39.5;
/** On his feet the body turns to its heading on a critically damped spring of this frequency
 *  (rad/s): most of the way round in about 0.12 s. */
const YAW_W = 28;
/** Turning on the spot the pelvis comes round more gently, with the steps. */
const STAND_YAW_W = 14;
/** Turns sharper than this (rad) are a pivot: from a standstill, or on the run (a reversal). */
const START_PIVOT = 1;
const REVERSE_PIVOT = 2.1;
/** A pivot's length: this, plus PIVOT_PER_PI for a half turn (seconds). */
const PIVOT_TIME = 0.1;
const PIVOT_PER_PI = 0.08;
/** How low the hips sink through a pivot (units). */
const PIVOT_DIP = 3.5;
/** The torso leads a turn by this share of what's left of it, up to TWIST_MAX (rad). */
const TWIST = 0.55;
const TWIST_MAX = 0.5;
/** A drawn move this much further than his speed covers in a frame is a jump (units). */
const TELEPORT = 48;
/** A roof more than this far below the one he stands on is a drop: no foot reaches down to it. */
const DROP = 12;
/**
 * Swinging into a roof at speed, he's on it for this long (s) before the body takes a stance:
 * a swing that skims the roof (down for a tick, then off on the next web) stays a hop.
 */
const SKIM = 0.1;
const SKIM_SPEED = 350;

export class HeroAnimator {
  readonly pose: Pose = newPose();
  readonly solved: Solved = newSolved();
  /** The fist on the web line (world), valid after update. */
  readonly grip = new Vector3();
  /** IK targets this frame, for the debug overlay. */
  readonly targets: Vector3[] = [];
  base: Base = "ground";
  action: HeroAction = "idle";

  private readonly clock = new FixedStepper();
  private readonly vel = new Spring3(30, 1);
  private readonly acc = new Spring3(14, 1);
  private readonly turn = new Turn(10, 0.07);
  private readonly orient = new Orient(14);
  private readonly lift = new Spring(16, 0.9);
  private readonly squash = new Spring(15, 0.42);
  private readonly lean = new Spring(9, 0.8);
  /** Leaning into a start and back against a stop (the clips don't). */
  private readonly push = new Spring(10, 0.9);
  private readonly spineP = new Spring(11, 0.42);
  private readonly spineR = new Spring(11, 0.5);
  private readonly headP = new Spring(12, 0.38);
  private readonly headY = new Spring(10, 0.8);
  private readonly hands = [new Spring3(15, 0.62), new Spring3(15, 0.62)];
  private readonly feet = [new Spring3(13, 0.6), new Spring3(13, 0.6)];
  private readonly limbs = [...this.hands, ...this.feet];
  /** The body's rotation the limb springs were last carried round to, and the turn since. */
  private readonly limbQ = new Quaternion();
  private readonly limbTurn = new Quaternion();
  private readonly groundW = new Spring(16, 1);
  private readonly gripW = new Spring(34, 1);
  /** Motion capture (the MPFB hero), once its clips have loaded. */
  private mocap: Mocap | null = null;
  private ragdolled = false;
  /** How far the body still has to turn (rad), for the head to lead with. */
  private lead = 0;
  /** Fingers per hand: 0 open … 1 a fist. */
  private readonly fists = [new Spring(22, 1), new Spring(22, 1)];
  /** The feet's body-frame targets, stretched to this rig's legs. */
  private readonly legK: number;
  /** The left shoulder relative to the hips (body frame), and an arm's reach. */
  private readonly shoulder: Vector3;
  private readonly reach: number;
  private readonly plants = [new Plant(), new Plant()];
  private readonly wall = [new Plant(), new Plant(), new Plant()];
  private readonly ragdoll: Ragdoll;
  private phase = 0;
  private climb = 0;
  private flipT = -1;
  private flipDur = 0.6;
  private impactT = 0;
  private hurtT = 0;
  private lastFlash = 0;
  private wasGrounded = true;
  private wasBase: Base = "ground";
  private lastVy = 0;
  private readonly lastPos = new Vector3();
  private started = false;
  private readonly P = new Vector3();
  private readonly H = new Vector3();
  private readonly Q = new Quaternion();
  private readonly anchor = new Vector3();
  private readonly wallN = new Vector3(0, 0, -1);
  private wallD = 30;
  private readonly fwd = new Vector3(0, 0, 1);
  private readonly look = new Vector3();
  private hasLook = false;
  private time = 0;
  /** On his feet: the heading he holds while standing, and the sim's facing last frame. */
  private holdYaw = 0;
  private lastFac = Number.NaN;
  /** What's left of the turn for the torso to lead (rad). */
  private twist = 0;

  private readonly aim = new Vector3();
  private readonly sa = new Vector3();
  private readonly sb = new Vector3();
  /** The balls of the feet (an MPFB rig), and their height above the soles at rest. */
  private readonly balls: ({ bone: Bone; rest: number } | null)[];
  /** The roof he stands on (standOn), and the frame's context, for the feet. */
  private readonly footing: Footing = { top: 0, x0: -Infinity, z0: -Infinity, x1: Infinity, z1: Infinity };
  private ctx: AnimContext | null = null;
  /** The roof under a moving foot for the clips' terrain lift: never a drop off his footing. */
  private readonly stepGround = (x: number, z: number, y: number): number => {
    const top = this.ctx!.ground(x, z, y);
    return top < this.footing.top - DROP ? this.footing.top : top;
  };

  constructor(
    private readonly rig: Rig,
    private readonly group: Group,
    ctx: AnimContext,
  ) {
    this.ragdoll = new Ragdoll(ctx.ground);
    for (let i = 0; i < 8; i++) this.targets.push(new Vector3());
    this.legK = (rig.legs[0].l1 + rig.legs[0].l2) / TUNED_LEG;
    this.balls = (["ball_l", "ball_r"] as const).map((n) => {
      const i = rig.index.get(n);
      const rest = rig.joints.get(n);
      return i !== undefined && rest ? { bone: rig.bones[i], rest: rest.y } : null;
    });
    this.shoulder = rig.joints.get("armL")!.clone().sub(rig.joints.get("hips")!);
    this.reach = rig.arms[0].l1 + rig.arms[0].l2;
  }

  /** A hand target off shoulder `s` (±1), in arm lengths (x out, y up, z forward). */
  private fromShoulder(s: number, x: number, y: number, z: number, out: Vector3): Vector3 {
    const r = this.reach;
    const sh = this.shoulder;
    return out.set(s * (sh.x + x * r), sh.y + y * r, sh.z + z * r);
  }

  /** Drive the body with motion-capture clips (the MPFB rig, `k` metres to units). */
  setClips(clips: HeroClips, k: number): void {
    this.mocap = new Mocap(this.rig, clips, k);
  }

  /** A blow landed on a villain in reach: a jab or a cross, when on his feet. */
  punch(): void {
    if (this.base === "ground") this.mocap?.punch();
  }

  /** A perfect release: somersault at a rate fitted to the release speed. */
  flip(reducedMotion: boolean): void {
    if (reducedMotion || this.base === "ko") return;
    const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    const rate = clamp(speed / 95, 8, 15);
    this.flipDur = (Math.PI * 2) / rate;
    this.flipT = 0;
  }

  /** Something to look at (the villain in a fight), or null. */
  lookAt(p: Vec3 | null): void {
    this.hasLook = p !== null;
    if (p) this.look.set(p.x, p.y, p.z);
  }

  /**
   * The frame's v1.2 body fields (action, facing), once they're seen being filled: a frame
   * built from defaults that nobody updates (an older loop, a lab script) would otherwise pin
   * the body to "idle" facing +x. Until then everything is derived from the motion.
   */
  private live = false;
  private act: HeroAction | undefined;
  private fac: Vec3 | undefined;

  private deriveBase(f: RenderFrame3D, speed: number, ctx: AnimContext): Base {
    const h = f.hero;
    const a = this.act;
    if (f.mode === "ko" || a === "ko") return "ko";
    if (a === "dash") return "dash";
    if (a === "slam") return "slam";
    if (a === "climb") return "climb";
    // Standing on a roof with the web still held (the sim takes up the slack): on its feet,
    // the web hand keeping the line.
    if (h.grounded && h.anchor) return "ground";
    if (h.anchor) {
      if (a === "swing") return "swing";
      // Without the sim's word: slow, against a wall, the web above — climbing.
      if (speed < 350 && h.anchor.y > h.pos.y + 20) {
        const dx = h.anchor.x - h.pos.x;
        const dz = h.anchor.z - h.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const hit = ctx.ray(h.pos, _a.set(dx / d, 0, dz / d), 48);
        if (hit !== null) return "climb";
      }
      return "swing";
    }
    if (h.grounded || (a !== undefined && (a === "idle" || a === "run"))) return "ground";
    if (h.vel.y < -1300) return "slam";
    return "air";
  }

  update(f: RenderFrame3D, dt: number, ctx: AnimContext): void {
    const h = f.hero;
    const P = this.P.set(h.pos.x, h.pos.y, h.pos.z);
    this.ctx = ctx;
    // A jump no motion this frame could make (placed beside an errand ally, set down for a
    // fight, a resume): start over where he is, planted feet and all, instead of leaving a
    // planted foot behind for the leg to stretch back to.
    const jump = P.distanceTo(this.lastPos);
    if (!this.started || jump > 260 || jump > TELEPORT + Math.hypot(h.vel.x, h.vel.y, h.vel.z) * Math.max(dt, 1 / 60) * 2) this.reset(f, ctx);
    this.time += dt;
    if (!this.live && ((h.actionTicks ?? 0) > 0 || (h.action !== undefined && h.action !== "idle"))) this.live = true;
    this.act = this.live ? h.action : undefined;
    this.fac = this.live ? h.facing : undefined;
    const speed = Math.hypot(h.vel.x, h.vel.y, h.vel.z);
    let base = this.deriveBase(f, speed, ctx);
    // A swing that runs into a roof at speed: a hop until it has stayed down a beat, so a
    // touch-and-go doesn't plant the trailing feet and drop the body into a stance for a tick.
    if (base === "ground" && (this.wasBase === "swing" || this.skim > 0) && this.skim < SKIM && Math.hypot(h.vel.x, h.vel.z) > SKIM_SPEED) {
      this.skim += dt;
      base = "air";
    } else this.skim = 0;
    // Down by the sim's word with nothing under him a sphere could rest on (wedged against a
    // wall for a tick): the air pose, never feet reaching down to the street far below.
    if (base === "ground" && ctx.footing && P.y - this.standOn(P, true, ctx) > HERO_RADIUS + 14) base = "air";
    this.action = this.act ?? (base === "ground" ? (Math.hypot(h.vel.x, h.vel.z) > 40 ? "run" : "idle") : base === "ko" ? "ko" : (base as HeroAction));
    const grounded = base === "ground";
    if (h.anchor) this.anchor.set(h.anchor.x, h.anchor.y, h.anchor.z);

    // Events read off the motion: a landing, a hit, the end of a slam.
    if (grounded && !this.wasGrounded) {
      const impact = Math.max(-this.lastVy, 0) + Math.hypot(h.vel.x, h.vel.z) * 0.15;
      const ground = this.standOn(P, true, ctx);
      if (this.mocap) this.mocap.land(impact, _a.set(P.x, ground + this.rig.spec.ankle, P.z), this.turn.value);
      else this.squash.impulse(-clamp(impact * 0.2, 40, 330));
      for (let i = 0; i < 2; i++) this.plants[i].plantAt(_a.set(P.x + (i === 0 ? 5 : -5), ground + this.rig.spec.ankle, P.z));
      if (this.wasBase === "slam") this.impactT = 0.55;
    }
    const flash = h.hurtFlash;
    if ((this.act === "hurt" && this.action !== this.lastAction) || flash > this.lastFlash + 0.3) {
      this.hurt();
      if (grounded) this.mocap?.hurt();
    }
    this.lastAction = this.action;
    this.lastFlash = flash;
    if (base === "ko" && this.wasBase !== "ko") {
      // Knocked down on a roof: the fall first (mocap), then the ragdoll; in the air, at once.
      if (this.mocap && this.wasGrounded) this.mocap.knockout();
      else this.startRagdoll();
    }
    if (base === "ko" && !this.ragdolled && this.mocap?.fallen) this.startRagdoll(true);
    if (base !== "ko") {
      this.ragdolled = false;
      if (this.mocap && this.mocap.dying >= 0) this.mocap.recover();
    }
    if (base === "climb") {
      const dx = this.anchor.x - P.x;
      const dz = this.anchor.z - P.z;
      const d = Math.hypot(dx, dz) || 1;
      // Buildings are axis-aligned: snap the wall's normal to the nearest axis.
      if (Math.abs(dx) > Math.abs(dz)) this.wallN.set(-Math.sign(dx), 0, 0);
      else this.wallN.set(0, 0, -Math.sign(dz));
      const hit = ctx.ray(h.pos, _a.copy(this.wallN).negate(), 80);
      this.wallD = hit ?? clamp(d, 20, 60);
    }

    // The yaw the body wants. On his feet: where he's going, else the heading he holds (which
    // the sim may turn on the spot); in the air the sim's facing, else the motion.
    let yaw = this.turn.value;
    const hs = Math.hypot(h.vel.x, h.vel.z);
    const fac = this.fac;
    const facing = fac && Math.abs(fac.x) + Math.abs(fac.z) > 0.1 ? yawOf(fac.x, fac.z) : Number.NaN;
    if (grounded) yaw = this.groundYaw(h, hs, facing);
    else if (!Number.isNaN(facing)) yaw = facing;
    else if (hs > 70) yaw = yawOf(h.vel.x, h.vel.z);
    if (base === "climb") yaw = yawOf(-this.wallN.x, -this.wallN.z);
    if (!grounded) this.holdYaw = this.turn.value;
    this.lastFac = facing;

    const ground = this.standOn(P, grounded, ctx);
    const rig = this.rig;
    this.lead = clamp(angleTo(this.turn.value, yaw), -1.1, 1.1);
    const runW = grounded && !this.mocap ? smoothstep(25, 140, hs) : 0;
    const L = 64 + hs * 0.1;

    // Gait and wall-climb phases advance by distance, measured from the drawn position.
    const moved = Math.hypot(P.x - this.lastPos.x, P.z - this.lastPos.z);
    if (grounded) {
      const settling = !this.plants[0].inStance || !this.plants[1].inStance || this.footOff(P, ground) > 7;
      this.phase += Math.max(moved / L, settling && runW < 0.2 ? dt * 2.2 : 0);
    }
    if (base === "climb") this.climb += Math.abs(P.y - this.lastPos.y) / 26;
    this.lastPos.copy(P);
    this.lastVy = h.vel.y;
    this.wasGrounded = grounded;
    this.wasBase = base;
    this.base = base;
    if (this.impactT > 0) this.impactT = Math.max(0, this.impactT - dt);
    if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dt);

    const held = this.act === "held";
    // Falling to a knockout (before the ragdoll) is posed like standing, under the clip.
    const pb: Base = base === "ko" && !this.ragdolled ? "ground" : base;
    const mc = this.mocap;
    if (mc) {
      const wasMoving = mc.isMoving;
      const air = base === "air" && this.flipT < 0 && h.vel.y > -250;
      const onFeet = grounded && this.impactT <= 0 && !held && mc.dying < 0;
      const project = (p: Vector3) => ((p.y = this.footOn(p, ground, ground + 20, ctx) + rig.spec.ankle), p);
      if (onFeet && !mc.stand.pivoting) this.maybePivot(mc, h.vel, ground, project);
      if (!onFeet) mc.stand.cancelPivot();
      mc.step(dt, { ground: grounded && this.impactT <= 0 && !held, air, pivot: mc.stand.pivoting, speed: grounded ? Math.hypot(this.vel.x, this.vel.z) : 0, moved: grounded ? moved : 0 });
      // A stride's end: the feet stay where it left them, then square up.
      if (wasMoving && !mc.isMoving && !mc.stand.pivoting) mc.plantWhereTheyAre(ground, rig.spec.ankle, this.turn.value, true);
      if (grounded) mc.stand.update(dt, _c.set(P.x, ground + rig.spec.ankle, P.z), this.turn.value, project, yaw, !mc.isMoving || mc.stand.pivoting);
      if (!grounded) mc.stand.airborne();
    }
    this.clock.advance(dt, (step) => this.substep(step, f, pb, yaw, ground, runW, held));
    // The torso leads what's left of the turn (the pelvis is held by the feet or the spring).
    this.twist = grounded && mc ? clamp(angleTo(this.turn.value, mc.stand.pivoting ? mc.stand.pivotEnd : yaw) * TWIST, -TWIST_MAX, TWIST_MAX) : 0;
    if (this.flipT >= 0) {
      // Caught by the next web, a wall or the roof mid-somersault: finish the turn quickly.
      this.flipT += dt * (base === "air" || base === "dash" ? 1 : 3.5);
      if (this.flipT >= this.flipDur) this.flipT = -1;
    }
    this.compose(f, pb, ground, runW, L, ctx);
    applyPose(rig, this.group, this.pose, this.solved);
    if (mc && !this.ragdolled) mc.layer(this.pose, this.gripW.lerp(this.clock.alpha), this.headY.lerp(this.clock.alpha) + (this.lead - this.twist) * 0.7, 0, grounded ? this.stepGround : ctx.ground, ground, this.twist);
    // On his feet, never a toe through the roof: the stride's clips carry the hips at the
    // cycle's average floor, so at the bottom of a stride a pointed foot can dip below it.
    if (mc && grounded && !this.ragdolled) this.keepSolesUp();
    // The fist: the rig's grip point in the right hand.
    this.grip.copy(rig.grip).applyMatrix4(rig.arms[1].end.matrixWorld);
  }

  /**
   * Where the body heads on its feet: the way it's moving, once it's moving at all; standing,
   * the heading it holds, which the sim can turn on the spot by turning its facing (unless the
   * player isn't steering: then he just waits).
   */
  private groundYaw(h: RenderFrame3D["hero"], hs: number, facing: number): number {
    if (hs > 20) this.holdYaw = yawOf(h.vel.x, h.vel.z);
    else if (!Number.isNaN(facing) && !Number.isNaN(this.lastFac) && Math.abs(angleTo(this.lastFac, facing)) > 1e-3 && h.controlled !== false) this.holdYaw = facing;
    return this.holdYaw;
  }

  /**
   * A turn too sharp to run round (setting off the other way, a reversal): pivot on the outer
   * foot, the torso leading, then run. Turning left pivots on the right foot and the other
   * way about, so the foot he turns on is never the one crossing under him; straight back,
   * he turns on whichever foot is down.
   */
  private maybePivot(mc: Mocap, v: Vec3, ground: number, project: (p: Vector3) => Vector3): void {
    if (Math.hypot(v.x, v.z) < 20) return;
    const d = angleTo(this.turn.value, yawOf(v.x, v.z));
    if (Math.abs(d) < (mc.moveW.value < 0.5 ? START_PIVOT : REVERSE_PIVOT)) return;
    const rig = this.rig;
    let outer = d > 0 ? 1 : 0;
    // Off the cycle: the feet start from where the clip has them.
    if (mc.legsMove > 0.05) mc.plantWhereTheyAre(ground, rig.spec.ankle, this.turn.value);
    if (Math.abs(d) > 2.8) {
      // Straight back: turn on the foot nearer under the hips (either way round will do).
      const fx = Math.sin(this.turn.value);
      const fz = Math.cos(this.turn.value);
      const along = (i: number) => Math.abs((mc.stand.foot[i].x - this.P.x) * fx + (mc.stand.foot[i].z - this.P.z) * fz);
      outer = along(0) <= along(1) ? 0 : 1;
    }
    const turn = (outer === 1) === d > 0 ? d : d - Math.sign(d) * Math.PI * 2;
    mc.stand.startPivot(outer, this.turn.value, turn, PIVOT_TIME + (PIVOT_PER_PI * Math.abs(turn)) / Math.PI, _c.set(this.P.x, ground + rig.spec.ankle, this.P.z), project);
  }

  /** Hand the body to the ragdoll from the pose it's in (its joints read off the bones). */
  private startRagdoll(fromBones = false): void {
    this.ragdolled = true;
    const r = this.rig;
    const s = this.solved;
    if (fromBones) {
      for (let i = 0; i < 2; i++) {
        worldPos(r.arms[i].lower, s.elbow[i]);
        worldPos(r.arms[i].end, s.wrist[i]);
        worldPos(r.legs[i].lower, s.knee[i]);
        worldPos(r.legs[i].end, s.ankle[i]);
      }
    }
    this.ragdoll.start(r, s, _a.set(this.vel.x, this.vel.y, this.vel.z), this.clock.h, fromBones ? 0.6 : 2.5 + Math.random());
  }

  private lastAction: HeroAction = "idle";
  /** How long a swing's touch on a roof has lasted (SKIM). */
  private skim = 0;

  private hurt(): void {
    this.hurtT = 0.35;
    this.spineP.impulse(-7);
    this.spineR.impulse((Math.random() - 0.5) * 8);
    this.headP.impulse(-12);
    for (const s of this.hands) s.impulse((Math.random() - 0.5) * 500, 260, (Math.random() - 0.5) * 500);
  }

  /** Lift the body by however far its lowest sole (heel or ball) is below the roof under that foot. */
  private keepSolesUp(): void {
    const rig = this.rig;
    let deficit = 0;
    for (let i = 0; i < 2; i++) {
      const ankle = worldPos(rig.legs[i].end, _a);
      const roof = this.stepGround(ankle.x, ankle.z, ankle.y + 20);
      deficit = Math.max(deficit, roof - (ankle.y - rig.spec.ankle));
      const ball = this.balls[i];
      if (ball) deficit = Math.max(deficit, roof - (worldPos(ball.bone, _b).y - ball.rest));
    }
    if (deficit <= 0.05 || deficit > 20) return;
    this.group.position.y += deficit;
    this.group.updateMatrixWorld(true);
  }

  /**
   * The roof he stands on, as the sim stands him: under his centre, or (his sphere resting on a
   * roof's edge with its centre out over a drop) that roof, never the street below. Kept in
   * `footing` (height and footprint) for the feet.
   */
  private standOn(P: Vector3, grounded: boolean, ctx: AnimContext): number {
    const f = this.footing;
    if (grounded && ctx.footing) return ctx.footing(P.x, P.z, P.y + 0.5, HERO_RADIUS + 1.5, HERO_RADIUS + 4, f).top;
    f.top = ctx.ground(P.x, P.z, P.y + 4);
    f.x0 = f.z0 = -Infinity;
    f.x1 = f.z1 = Infinity;
    return f.top;
  }

  /**
   * The roof under a foot at p (at or below `below`), unless that's a drop off the roof he
   * stands on (past its edge, the street): then the foot comes back onto that roof's edge and
   * stands at its height. A step up onto a lip or a setback is kept.
   */
  private footOn(p: Vector3, ground: number, below: number, ctx: AnimContext): number {
    const top = ctx.ground(p.x, p.z, below);
    if (top >= ground - DROP) return top;
    const f = this.footing;
    if (f.x1 - f.x0 > 8) p.x = clamp(p.x, f.x0 + 3, f.x1 - 3);
    if (f.z1 - f.z0 > 8) p.z = clamp(p.z, f.z0 + 3, f.z1 - 3);
    return ground;
  }

  private footOff(P: Vector3, ground: number): number {
    let worst = 0;
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? 5.2 : -5.2;
      bodyPoint(_d.set(P.x, ground + this.rig.spec.ankle, P.z), yawQuat(this.turn.value, _q2), sx, 0, 0, _c);
      worst = Math.max(worst, _c.distanceTo(this.plants[i].at));
    }
    return worst;
  }

  private reset(f: RenderFrame3D, ctx: AnimContext): void {
    const h = f.hero;
    this.started = true;
    this.lastPos.set(h.pos.x, h.pos.y, h.pos.z);
    this.vel.snap(h.vel.x, h.vel.y, h.vel.z);
    this.acc.snap(0, 0, 0);
    const yaw = Math.hypot(h.vel.x, h.vel.z) > 40 ? yawOf(h.vel.x, h.vel.z) : this.fac ? yawOf(this.fac.x, this.fac.z) : this.turn.value;
    this.turn.snap(yaw);
    this.holdYaw = yaw;
    this.lastFac = Number.NaN;
    this.orient.snap(yawQuat(yaw, _q));
    this.limbQ.copy(_q);
    this.mocap?.stand.reset();
    const ground = this.standOn(this.P, h.grounded, ctx);
    this.lift.snap(h.grounded ? ground + this.rig.hipHeight - 1.2 - h.pos.y : 0);
    this.squash.snap(0);
    this.groundW.snap(h.grounded ? 1 : 0);
    for (let i = 0; i < 2; i++) {
      this.plants[i].plantAt(_a.set(h.pos.x + (i === 0 ? 5 : -5), ground + this.rig.spec.ankle, h.pos.z));
      this.hands[i].snap(0, -2, 0);
      this.feet[i].snap(0, -36, 0);
    }
    this.wasGrounded = h.grounded;
    this.clock.reset();
  }

  /** The body's target rotation for this base state. */
  private bodyTarget(base: Base, out: Quaternion): Quaternion {
    const v = _a.set(this.vel.x, this.vel.y, this.vel.z);
    const speed = v.length();
    yawQuat(this.turn.value, out);
    this.fwd.set(Math.sin(this.turn.value), 0, Math.cos(this.turn.value));
    switch (base) {
      case "swing": {
        const up = _b.copy(this.anchor).sub(this.P).normalize();
        // Facing along the arc: the velocity with its rope component removed.
        const t = _c.copy(v).addScaledVector(up, -v.dot(up));
        const fw = t.lengthSq() > 120 * 120 ? t : this.fwd;
        frameQuat(up, fw, out);
        // One-arm hang: the web shoulder rides up toward the line.
        return out.multiply(_q2.setFromAxisAngle(Z, -0.22));
      }
      case "air": {
        const vy = v.y;
        const hsp = Math.hypot(v.x, v.z);
        const up = _b.copy(UP);
        if (speed > 1) {
          const rise = smoothstep(150, 900, vy) * 0.45 * smoothstep(300, 900, speed);
          const dive = smoothstep(-250, -900, vy) * smoothstep(250, 700, hsp) * 0.8;
          up.lerp(_c.copy(v).divideScalar(speed), rise).normalize();
          up.lerp(_c.copy(v).divideScalar(speed), dive).normalize();
        }
        return frameQuat(up, this.fwd, out);
      }
      case "dash": {
        const dir = speed > 1 ? _c.copy(v).divideScalar(speed) : this.fwd;
        return frameQuat(_b.copy(dir).addScaledVector(UP, 0.45).normalize(), _d.set(0, -1, 0), out);
      }
      case "slam":
        // Head first: pitched forward over (the chest turns to face back), never rolled, so
        // left stays left and the legs come down uncrossed for the impact.
        return frameQuat(_b.copy(this.fwd).multiplyScalar(0.35).addScaledVector(UP, -1).normalize(), _c.copy(this.fwd).negate(), out);
      case "ground": {
        if (this.impactT > 0) return out.multiply(_q2.setFromAxisAngle(X, 0.12));
        // The clips lean with the speed on their own, but not into a start or against a stop.
        const cw = this.mocap?.clipW.value ?? 0;
        return out.multiply(_q2.setFromAxisAngle(X, this.lean.value * (1 - 0.85 * cw) + this.push.value * cw));
      }
      default:
        return out;
    }
  }

  private substep(step: number, f: RenderFrame3D, base: Base, yaw: number, ground: number, runW: number, held: boolean): void {
    const h = f.hero;
    this.vel.step(h.vel.x, h.vel.y, h.vel.z, step);
    this.acc.step(this.vel.vx, this.vel.vy, this.vel.vz, step);
    const grounded = base === "ground";
    const mc = grounded ? this.mocap : null;
    if (mc?.stand.pivoting) this.turn.follow(mc.stand.pivotYaw, step);
    else if (mc) {
      this.turn.spring(yaw, step, mc.standing > 0.5 ? STAND_YAW_W : YAW_W);
      // Planted feet hold the pelvis (about where the hips are: over the weighted leg); the
      // torso leads the rest of the turn.
      if (mc.standing > 0.5) {
        const lean = mc.stand.weight.value * 1.2 * mc.standing;
        const hips = _c.set(h.pos.x + Math.cos(this.turn.value) * lean, 0, h.pos.z - Math.sin(this.turn.value) * lean).add(mc.stand.shift);
        this.turn.hold(mc.stand.clampYaw(this.turn.value, hips));
      }
    } else this.turn.step(yaw, step);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.lean.step(grounded ? clamp(hs / 390, 0, 1.3) * 0.2 + clamp(this.accFwd() * 0.00005, -0.12, 0.15) : 0, step);
    this.push.step(grounded ? clamp(this.accFwd() * 0.00005, -0.1, 0.1) : 0, step);
    // A slam's impact snaps him up off the dive onto his feet for the crouch.
    const k = base === "swing" ? 11 : base === "air" ? 6.5 : base === "dash" || base === "slam" ? 16 : base === "climb" ? 12 : this.impactT > 0 ? 45 : 15;
    this.orient.step(this.bodyTarget(base, _q), step, k);
    const hipH = this.rig.hipHeight;
    this.lift.step(grounded || base === "climb" ? (grounded ? ground + hipH - 1.2 - h.pos.y : 0) : 0, step);
    this.squash.step(0, step);
    this.groundW.step(grounded ? 1 : 0, step);
    this.gripW.step(base === "swing" || base === "climb" || (base === "ground" && h.anchor) ? 1 : 0, step);
    // Spine and head settle back to straight; hits kick them.
    const breathe = grounded ? Math.sin(this.time * 1.7) * 0.025 : 0;
    this.spineP.step((grounded ? -this.squash.value * 0.02 : 0) + breathe + (held ? Math.sin(this.time * 31) * 0.08 : 0), step);
    this.spineR.step(held ? Math.sin(this.time * 23) * 0.12 : 0, step);
    this.headP.step(0, step);
    this.headY.step(this.lookYaw(), step);
    for (let i = 0; i < 2; i++) this.fists[i].step(this.fistTarget(i, base, h.anchor !== null, runW, held), step);

    // Limb springs ride the body: targets in the body frame, offsets kept relative to the
    // hips, pulled by gravity and pushed by the body's own acceleration (the arc's load).
    // They turn with the body (they lag its motion, not its turning): left behind by a quick
    // turn (the swing's about-face at each end of the arc, a somersault) they'd swing
    // through each other and cross.
    const Q = this.flipQuat(this.orient.q, _q);
    const turned = this.limbTurn.copy(this.limbQ).invert().premultiply(Q);
    this.limbQ.copy(Q);
    for (const sp of this.limbs) {
      _c.set(sp.x, sp.y, sp.z).applyQuaternion(turned);
      _d.set(sp.vx, sp.vy, sp.vz).applyQuaternion(turned);
      sp.x = _c.x;
      sp.y = _c.y;
      sp.z = _c.z;
      sp.vx = _d.x;
      sp.vy = _d.y;
      sp.vz = _d.z;
    }
    const g = _b.set(-this.acc.vx, -1750 - this.acc.vy, -this.acc.vz).multiplyScalar(0.5);
    const gl = g.length();
    if (gl > 3200) g.multiplyScalar(3200 / gl);
    for (let i = 0; i < 2; i++) {
      this.limbTarget(i, true, base, runW, held, _c);
      _c.applyQuaternion(Q);
      this.hands[i].step(_c.x, _c.y, _c.z, step, g.x, g.y, g.z);
      this.limbTarget(i, false, base, runW, held, _c);
      _c.applyQuaternion(Q);
      this.feet[i].step(_c.x, _c.y, _c.z, step, g.x * 0.8, g.y * 0.8, g.z * 0.8);
    }
    if (base === "ko" && this.ragdolled) this.ragdoll.step(step, this.P);
  }

  /** How closed a hand is: a fist on the web, in a slam or a struggle; open reaching or running. */
  private fistTarget(i: number, base: Base, anchored: boolean, runW: number, held: boolean): number {
    if (held || base === "slam") return 1;
    if (this.tuck() > 0.05) return 0.85;
    if (this.impactT > 0) return i === 1 ? 1 : 0.15;
    if (i === 1 && anchored && (base === "swing" || base === "climb" || base === "ground")) return 1;
    switch (base) {
      case "ground":
        return lerp(0.3, 0.06, runW);
      case "dash":
        return i === 1 ? 1 : 0.25;
      case "climb":
        return 0.12;
      case "ko":
        return 0.4;
      default:
        return 0.04;
    }
  }

  private accFwd(): number {
    return this.acc.vx * Math.sin(this.turn.value) + this.acc.vz * Math.cos(this.turn.value);
  }

  private lookYaw(): number {
    if (!this.hasLook) return 0;
    const yaw = yawOf(this.look.x - this.P.x, this.look.z - this.P.z);
    return clamp(angleTo(this.turn.value, yaw), -1.1, 1.1) * 0.8;
  }

  /** The somersault on top of the body rotation, about the body's left axis. */
  private flipQuat(q: Quaternion, out: Quaternion): Quaternion {
    out.copy(q);
    if (this.flipT < 0) return out;
    const u = clamp(this.flipT / this.flipDur, 0, 1);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    const axis = _d.copy(X).applyQuaternion(q);
    return out.premultiply(_q2.setFromAxisAngle(axis, e * Math.PI * 2));
  }

  private tuck(): number {
    if (this.flipT < 0) return 0;
    return Math.sin(Math.PI * clamp(this.flipT / this.flipDur, 0, 1));
  }

  /** A hand (or foot) target in the body frame, relative to the hips. */
  private limbTarget(i: number, hand: boolean, base: Base, runW: number, held: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    const vy = this.vel.y;
    const t = this.time;
    const tuck = this.tuck();
    if (hand) {
      // Tucked for a somersault: hands to the shins.
      if (tuck > 0.05) return out.set(s * 7, lerp(4, -6, tuck), lerp(6, 17, tuck));
      if (held) return out.set(s * 10.5, 1, 2.5);
      switch (base) {
        case "ground": {
          if (this.impactT > 0 && i === 0) return out.set(16, 14, -14);
          // Running arms: elbows bent and close in, the hand pumping from behind the hip
          // up to the chest.
          const sw = Math.sin(this.phase * Math.PI * 2) * s;
          const idle = out.set(s * 12, -3 + Math.sin(t * 1.7 + i) * 0.5, 2.5);
          return idle.lerp(this.fromShoulder(s, -0.12, -0.64 + 0.3 * Math.max(sw, 0), 0.1 + 0.42 * sw, _d), runW);
        }
        case "swing": {
          const [rise, bottom] = this.swingPhase();
          if (i === 1) return out.set(-4, 40, 2);
          out.set(15, -4, -6);
          out.lerp(_d.set(15, 6, 14), bottom);
          return out.lerp(_d.set(11, 28, 16), rise);
        }
        case "climb":
          return out.set(s * 9, 26, 6);
        case "dash":
          return i === 1 ? out.set(-5, 42, 3) : out.set(12, -3, -4);
        case "slam":
          return out.set(s * 7, 41, 5);
        default: {
          // Falling: arms out and down for balance. Rising: the web hand reaches up ahead.
          const rise = smoothstep(80, 600, vy);
          const fall = 1 - rise;
          this.fromShoulder(s, 0.58, -0.5, 0.18, out).multiplyScalar(fall);
          if (i === 1) out.add(_d.set(-6, 35, 13).multiplyScalar(rise));
          else out.add(_d.set(13, 1, -9).multiplyScalar(rise));
          return out;
        }
      }
    }
    return this.footTarget(i, s, base, vy, tuck, out).multiply(_d.set(1, this.legK, this.legK));
  }

  private footTarget(i: number, s: number, base: Base, vy: number, tuck: number, out: Vector3): Vector3 {
    if (tuck > 0.05) return out.set(s * 5, lerp(-30, -17, tuck), lerp(4, 9, tuck));
    switch (base) {
      case "swing": {
        const [rise, bottom] = this.swingPhase();
        out.set(s * 4.5, -34, -8);
        out.lerp(_d.set(s * 4.5, -17, 12), bottom);
        return out.lerp(_d.set(s * 4.5, -35, 11), rise);
      }
      case "dash":
        return out.set(s * 5, -38, -3);
      case "slam":
        return out.set(s * 5, -36, -5);
      case "climb":
        return out.set(s * 5, -28, 5);
      default: {
        const rise = smoothstep(80, 600, vy);
        const dive = smoothstep(-250, -900, vy) * smoothstep(250, 700, Math.hypot(this.vel.x, this.vel.z));
        // Dropping, the feet come in under him to land on.
        out.set(s * 5.5, -28, lerp(9, 2, smoothstep(-150, -600, vy)));
        out.lerp(i === 0 ? _d.set(5, -35, -6) : _d.set(-5, -25, 8), rise);
        return out.lerp(_d.set(s * 8, -33, -10), dive);
      }
    }
  }

  /** [rising past the bottom, near the bottom] for the swing pose, from the rope angle. */
  private swingPhase(): [number, number] {
    const up = this.sa.copy(this.anchor).sub(this.P);
    const len = up.length() || 1;
    up.divideScalar(len);
    const fromVertical = Math.acos(clamp(up.y, -1, 1));
    const v = this.sb.set(this.vel.x, this.vel.y, this.vel.z);
    const rising = v.y > 60 ? smoothstep(0.25, 0.8, fromVertical) : 0;
    const speed = v.length();
    const bottom = (1 - smoothstep(0.15, 0.7, fromVertical)) * smoothstep(250, 700, speed);
    return [rising, bottom];
  }

  private compose(f: RenderFrame3D, base: Base, ground: number, runW: number, L: number, ctx: AnimContext): void {
    const h = f.hero;
    const pose = this.pose;
    const a = this.clock.alpha;
    const rig = this.rig;
    const spec = rig.spec;
    for (let i = 0; i < 2; i++) pose.grip[i] = this.fists[i].lerp(a);
    if (base === "ko" && this.ragdolled) {
      this.ragdoll.toPose(rig, pose, a);
      this.H.copy(pose.root).add(_a.set(0, rig.hipHeight, 0).applyQuaternion(pose.rot));
      this.collectTargets();
      return;
    }
    // On his feet the yaw is the turn's own (the feet and the stance are placed by it); the
    // orientation's easing is for the lean and for settling out of a tilted landing.
    const O = this.orient.lerp(a, this.Q);
    if (base === "ground") withYaw(O, this.turn.lerp(a), O);
    const Q = this.flipQuat(O, _q);
    this.Q.copy(Q);
    // The hips (centre of mass): the sim's point, lifted onto the legs when standing.
    const H = this.H.set(h.pos.x, h.pos.y + this.lift.lerp(a) + this.squash.lerp(a), h.pos.z);
    const bob = runW * 2.2 * (0.5 + 0.5 * Math.cos(this.phase * Math.PI * 4));
    H.y -= bob;
    if (this.impactT > 0) H.y -= 15 * smoothstep(0, 0.12, 0.55 - this.impactT) * smoothstep(0, 0.25, this.impactT);
    // Under the clips: the hips at standing height over the planted feet (knees all but
    // straight, the weight on one leg), or where the moving clips carry them.
    const mc = base === "ground" ? this.mocap : null;
    const cw = mc ? mc.clipW.value : 0;
    // Standing still (the hips over one leg, the weight shifting): not mid-pivot.
    const standing = mc ? mc.standing * (1 - mc.pivotW.value) : 0;
    const weight = mc ? mc.stand.weight.value : 0;
    if (mc && cw > 0.001) {
      const standY = ground + rig.hipHeight - 0.5 - 0.4 * Math.abs(weight);
      const moveY = ground + rig.hipHeight - mc.floor;
      H.y = lerp(H.y, lerp(standY, moveY, mc.legsMove), cw);
      // A pivot sinks the hips and carries them round the planted foot.
      if (mc.stand.pivoting) H.y -= PIVOT_DIP * Math.sin(Math.PI * mc.stand.pivotU) * cw;
      H.addScaledVector(mc.stand.shift, cw);
      const yawD = this.turn.lerp(a);
      H.addScaledVector(_b.set(Math.cos(yawD), 0, -Math.sin(yawD)), weight * 1.2 * standing);
    }
    pose.rot.copy(Q);
    pose.root.copy(H).sub(_a.set(0, rig.hipHeight, 0).applyQuaternion(Q));
    pose.hips.set(0, 0, 0);
    const sw = Math.sin(this.phase * Math.PI * 2);
    pose.hipsRot.set(0, -sw * 0.14 * runW, weight * 0.07 * standing);
    pose.spine.set(this.spineP.lerp(a) + runW * 0.06, sw * 0.12 * runW, this.spineR.lerp(a));
    pose.chest.set(base === "ground" ? -this.squash.lerp(a) * 0.012 : 0, sw * 0.16 * runW, 0);
    pose.neck.set(-pose.spine.x * 0.5, this.headY.lerp(a) * 0.4, 0);
    pose.head.set(this.headP.lerp(a) - runW * 0.08 + (base === "slam" ? -0.5 : 0) + (base === "dash" ? -0.6 : 0), this.headY.lerp(a) * 0.6, base === "swing" ? 0.18 : 0);
    pose.clav[0].set(0, 0, 0);
    pose.clav[1].set(0, 0, base === "swing" ? -0.25 : 0);

    // Hands: spring-driven, the web hand pinned to the rope.
    for (let i = 0; i < 2; i++) this.hands[i].lerp(a, pose.hand[i]).add(H);
    pose.handAim[0] = null;
    pose.handAim[1] = null;
    const gw = this.gripW.lerp(a);
    if (gw > 0.001 && h.anchor) {
      const dir = _b.copy(this.anchor).sub(H);
      const len = dir.length();
      dir.divideScalar(len || 1);
      // The fist sits on the H → anchor line; the wrist just below it.
      // Hanging: the arm all but straight from the shoulder; climbing: the fist near the face.
      const reach = base === "climb" ? 30 + 5 * Math.sin(this.climb * Math.PI * 2) : this.shoulder.y + this.reach * 0.85;
      const fist = _c.copy(H).addScaledVector(dir, Math.min(reach, len - 2));
      fist.addScaledVector(dir, -rig.gripReach);
      pose.hand[1].lerp(fist, gw);
      if (gw > 0.5) pose.handAim[1] = this.aim.copy(dir);
    }
    // Feet: springs in the air, planted on the roof when standing.
    for (let i = 0; i < 2; i++) this.feet[i].lerp(a, pose.foot[i]).add(H);
    const gwt = this.groundW.lerp(a);
    const yawQ = yawQuat(this.turn.lerp(a), _q2);
    const fwd = _a.set(0, 0, 1).applyQuaternion(yawQ);
    const project = (p: Vector3) => {
      const top = base === "ground" ? this.footOn(p, ground, H.y, ctx) : ctx.ground(p.x, p.z, H.y);
      p.y = Math.max(top, H.y - rig.hipHeight - 26) + spec.ankle;
      return p;
    };
    if (gwt > 0.001) {
      const body = _c.set(h.pos.x, ground + spec.ankle, h.pos.z);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const off = _b.set(s * 5.2, 0, 0).applyQuaternion(yawQ);
        const stance = 0.5 - runW * 0.08;
        // The MPFB hero stands on his planted feet (anim/stand.ts); the clips do the walking.
        const target = mc ? _d.copy(mc.stand.foot[i]) : this.plants[i].update(this.phase + i * 0.5, stance, body, fwd, L * Math.max(0.15, runW), off, 4 + 5 * runW, UP, project);
        if (this.impactT > 0) {
          // The superhero landing: left foot forward, right knee down.
          bodyPoint(body, yawQ, i === 0 ? 5 : -5, 0, i === 0 ? 9 : -11, target);
          project(target);
        }
        pose.foot[i].lerp(target, gwt);
      }
      if (this.impactT > 0) {
        // Right fist on the roof.
        const fist = bodyPoint(body, yawQ, -9, 0, 12, _d);
        fist.y = ground + 2;
        pose.hand[1].copy(fist);
      }
    }
    // Never through the roof: coming down onto it, the feet stop on it and the knees take the
    // landing (in the air the hips ride the sim's body, lower than standing).
    if (base !== "climb") {
      for (let i = 0; i < 2; i++) {
        const f = pose.foot[i];
        f.y = Math.max(f.y, ctx.ground(f.x, f.z, H.y) + spec.ankle);
      }
    }
    // Climbing: left hand and both feet planted on the wall, alternating.
    if (base === "climb") {
      const wallX = h.pos.x - this.wallN.x * (this.wallD - 3);
      const wallZ = h.pos.z - this.wallN.z * (this.wallD - 3);
      const onWall = (p: Vector3) => {
        if (this.wallN.x !== 0) p.x = wallX + this.wallN.x * 3;
        else p.z = wallZ + this.wallN.z * 3;
        return p;
      };
      const left = _b.set(1, 0, 0).applyQuaternion(yawQ);
      // The left hand, then the left and right feet (each on its own side), the right foot
      // moving with the left hand.
      const limbs: [number, number, number][] = [
        [5, 21, 0],
        [5.5, -30, 0.5],
        [-5.5, -30, 0],
      ];
      for (let k = 0; k < 3; k++) {
        const [x, y, ph] = limbs[k];
        const off = _c.copy(left).multiplyScalar(x).addScaledVector(UP, y);
        const target = this.wall[k].update(this.climb + ph, 0.55, H, UP, 26, off, 3, _d.copy(this.wallN), onWall);
        if (k === 0) pose.hand[0].copy(target);
        else pose.foot[k - 1].copy(target);
      }
    }

    // Poles: elbows back and down (tucked in for a run, out to the side on the web arm),
    // knees forward.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      pose.elbow[i].set(s * lerp(0.45, 0.12, runW), -0.5, -1).applyQuaternion(Q);
      if (i === 1 && gw > 0.5) pose.elbow[i].set(-1, -0.2, 0.2).applyQuaternion(Q);
      pose.knee[i].set(s * 0.15, 0, 1).applyQuaternion(Q);
      pose.handRot[i].set(0, 0, 0);
      if (gwt > 0.5 && mc && this.impactT <= 0) pose.footRot[i].setFromAxisAngle(UP, mc.stand.yaw[i]).multiply(_q2.setFromAxisAngle(X, mc.stand.lift[i] * 0.35));
      else if (gwt > 0.5) pose.footRot[i].copy(yawQ);
      else pose.footRot[i].copy(Q).multiply(_q2.setFromAxisAngle(X, 0.55));
      if (gwt > 0.5 && !mc && this.plants[i].lift > 0) pose.footRot[i].multiply(_q2.setFromAxisAngle(X, this.plants[i].lift * 0.5));
    }
    this.collectTargets();
  }

  private collectTargets(): void {
    const p = this.pose;
    this.targets[0].copy(p.hand[0]);
    this.targets[1].copy(p.hand[1]);
    this.targets[2].copy(p.foot[0]);
    this.targets[3].copy(p.foot[1]);
    this.targets[4].copy(this.H);
    this.targets[5].copy(this.grip);
  }

  /** Ragdoll particles while knocked out (debug), else null. */
  ragdollPoints(): Float32Array | null {
    return this.base === "ko" ? this.ragdoll.points() : null;
  }

  /** The body's current rotation and centre of mass, for the shadow and the camera. */
  get centre(): Vector3 {
    return this.H;
  }
}
