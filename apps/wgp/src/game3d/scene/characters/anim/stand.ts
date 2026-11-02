/**
 * Standing still like a person, for the hero's lower body while the mocap idle moves the
 * rest of him:
 *
 * - Feet planted about hip-width apart, toes a little out. When the body turns, or stops
 *   mid-stride, small steps square them up under it: one foot at a time, the worse one
 *   first, never a stomp.
 * - Weight on one leg, drifting to the other every few seconds (contrapposto): the hips
 *   shift over the standing leg and tip up on its side, the free knee softens, and the
 *   shoulders tilt the other way.
 * - Glances: every few seconds the head turns a little somewhere else and back.
 */
import { Vector3 } from "three";

import { angleTo, clamp } from "./common";
import { Spring } from "../physics/spring";

const STEP_TIME = 0.32;
const STEP_LIFT = 2.4;

export class Stand {
  /** Planted ankle targets (world) and the feet's yaws. */
  readonly foot: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  readonly yaw: [number, number] = [0, 0];
  /** 0–1 while a foot is up (for its toe-down and the knee). */
  readonly lift: [number, number] = [0, 0];
  /** +1: weight on the left leg … −1: on the right. */
  readonly weight = new Spring(1.7, 1, 1);
  readonly glanceYaw = new Spring(5, 1);
  readonly glancePitch = new Spring(5, 1);
  private side = 1;
  private nextShift = 5;
  private nextGlance = 2.5;
  private glance = [0, 0];
  private step = -1;
  private stepT = 0;
  private rest = 0;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private fromYaw = 0;
  private toYaw = 0;
  private readonly home = new Vector3();
  private started = false;

  constructor(
    /** Feet this far either side of the centre line, toes out by `toeOut` radians. */
    private readonly halfWidth: number,
    private readonly toeOut = 0.12,
  ) {}

  /** Where foot i belongs under a body at `body` (on the ground) facing `yaw`. */
  homeOf(i: number, body: Vector3, yaw: number, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    const x = s * this.halfWidth;
    const z = s * 0.7; // the left a touch ahead: never a parade-ground square
    return out.set(body.x + Math.cos(yaw) * x + Math.sin(yaw) * z, body.y, body.z - Math.sin(yaw) * x + Math.cos(yaw) * z);
  }

  /** Put a foot down here now (a landing, the end of a stride). */
  plant(i: number, at: Vector3, yaw: number): void {
    this.foot[i].copy(at);
    this.yaw[i] = yaw;
    this.lift[i] = 0;
    if (this.step === i) this.step = -1;
    this.started = true;
  }

  /**
   * Advance by dt with the body at `body` (x, z; y is the ground plus the ankle) facing
   * `yaw`. `project` puts a point on the roof under it (keeping the ankle height).
   */
  update(dt: number, body: Vector3, yaw: number, project: (p: Vector3) => Vector3): void {
    if (!this.started) {
      for (let i = 0; i < 2; i++) this.plant(i, project(this.homeOf(i, body, yaw, this.home)), yaw + (i === 0 ? this.toeOut : -this.toeOut));
    }
    // Weight from leg to leg, now and then.
    this.nextShift -= dt;
    if (this.nextShift <= 0) {
      this.side = -this.side;
      this.nextShift = 5 + Math.random() * 4;
    }
    this.weight.step(this.side, dt);
    // A glance somewhere, then back.
    this.nextGlance -= dt;
    if (this.nextGlance <= 0) {
      const away = this.glance[0] === 0 && this.glance[1] === 0 && Math.random() < 0.75;
      this.glance = away ? [(Math.random() * 2 - 1) * 0.45, -0.04 + Math.random() * 0.12] : [0, 0];
      this.nextGlance = away ? 1.4 + Math.random() * 1.6 : 2.5 + Math.random() * 3;
    }
    this.glanceYaw.step(this.glance[0], dt);
    this.glancePitch.step(this.glance[1], dt);

    // A step under way.
    if (this.step >= 0) {
      const i = this.step;
      this.stepT += dt / STEP_TIME;
      const u = clamp(this.stepT, 0, 1);
      const e = u * u * (3 - 2 * u);
      this.foot[i].copy(this.from).lerp(this.to, e);
      this.foot[i].y += Math.sin(Math.PI * u) * STEP_LIFT;
      this.yaw[i] = this.fromYaw + angleTo(this.fromYaw, this.toYaw) * e;
      this.lift[i] = Math.sin(Math.PI * u);
      if (u >= 1) {
        this.plant(i, this.to, this.toYaw);
        this.rest = 0.08;
      }
      return;
    }
    this.rest -= dt;
    if (this.rest > 0) return;
    // Square up the foot that's furthest out of place.
    let worst = -1;
    let err = 3.2;
    for (let i = 0; i < 2; i++) {
      this.homeOf(i, body, yaw, this.home);
      const want = yaw + (i === 0 ? this.toeOut : -this.toeOut);
      const e = Math.hypot(this.foot[i].x - this.home.x, this.foot[i].z - this.home.z) + 9 * Math.abs(angleTo(this.yaw[i], want));
      if (e > err) {
        err = e;
        worst = i;
      }
    }
    if (worst < 0) return;
    this.step = worst;
    this.stepT = 0;
    this.from.copy(this.foot[worst]);
    project(this.homeOf(worst, body, yaw, this.to));
    this.fromYaw = this.yaw[worst];
    this.toYaw = yaw + (worst === 0 ? this.toeOut : -this.toeOut);
  }

  /** Whether a foot is mid-step. */
  get stepping(): boolean {
    return this.step >= 0;
  }
}
