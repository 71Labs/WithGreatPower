/**
 * The hero's web as it's fired, held and let go:
 *
 * - shot: when the sim attaches, the strand's tip travels from the fist to the anchor over
 *   ~100 ms (ease-out), then the line is taut: exactly fist → anchor, no gap at either end;
 * - release: the strand stays stuck to the building and falls slack (a Verlet rope pinned
 *   at the anchor), thinning away;
 * - miss: a shot that finds nothing flies out toward where it was aimed and drops slack.
 *
 * Under reduced motion the strand appears and disappears with no travel or fall.
 */
import { Vector3 } from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { MAX_POINTS } from "../web";
import { FixedStepper } from "./physics/stepper";
import { Verlet } from "./physics/verlet";

const SHOT = 0.1;
const MISS_SHOT = 0.13;
const FADE = 0.45;
const N = 12;

type State = "none" | "shoot" | "taut" | "slack" | "miss";

const _a = new Vector3();

export class WebShot {
  readonly points = new Float32Array(MAX_POINTS * 3);
  count = 0;
  widthScale = 1;
  /** Where the web is stuck (taut), for the sparkle; null otherwise. */
  stuck: Vector3 | null = null;
  state: State = "none";
  private t = 0;
  private fade = 0;
  private readonly anchor = new Vector3();
  private readonly aim = new Vector3();
  private readonly strand = new Verlet(N, { gravity: 1100, damping: 0.05, iterations: 6 });
  private readonly clock = new FixedStepper();

  /** A web that found nothing: fly toward `aim` from the fist, then fall. */
  miss(hand: Vector3, aim: Vector3, reducedMotion: boolean): void {
    if (reducedMotion || this.state === "shoot" || this.state === "taut") return;
    this.state = "miss";
    this.t = 0;
    this.aim.copy(aim);
    this.anchor.copy(hand);
  }

  update(hand: Vector3, anchor: Vec3 | null, heroVel: Vector3, dt: number, reducedMotion: boolean): void {
    this.stuck = null;
    if (anchor) {
      const moved = Math.abs(anchor.x - this.anchor.x) + Math.abs(anchor.y - this.anchor.y) + Math.abs(anchor.z - this.anchor.z) > 0.5;
      if ((this.state !== "shoot" && this.state !== "taut") || moved) {
        this.state = reducedMotion ? "taut" : "shoot";
        this.t = 0;
        this.anchor.set(anchor.x, anchor.y, anchor.z);
      }
      if (this.state === "shoot") {
        this.t += dt;
        const u = Math.min(1, this.t / SHOT);
        const e = 1 - (1 - u) * (1 - u);
        this.line(hand, _a.copy(hand).lerp(this.anchor, e));
        if (u >= 1) this.state = "taut";
        return;
      }
      this.line(hand, this.anchor);
      this.stuck = this.anchor;
      return;
    }
    if (this.state === "shoot" || this.state === "taut") {
      if (reducedMotion) {
        this.state = "none";
      } else {
        // Let go: the strand stays on the wall and falls from it.
        this.slack(this.anchor, hand, heroVel, true);
      }
    }
    if (this.state === "miss") {
      this.t += dt;
      const u = Math.min(1, this.t / MISS_SHOT);
      const tip = _a.copy(hand).lerp(this.aim, 1 - (1 - u) * (1 - u));
      this.line(hand, tip);
      if (u >= 1) this.slack(tip, hand, heroVel, false);
      return;
    }
    if (this.state === "slack") {
      this.clock.advance(dt, (h) => this.strand.step(h));
      this.fade -= dt;
      this.widthScale = Math.max(0, this.fade / FADE);
      const p = this.points;
      for (let i = 0; i < N; i++) {
        this.strand.sample(i, this.clock.alpha, _a);
        p[i * 3] = _a.x;
        p[i * 3 + 1] = _a.y;
        p[i * 3 + 2] = _a.z;
      }
      this.count = N;
      if (this.fade <= 0) this.state = "none";
      return;
    }
    this.count = 0;
  }

  /** Start a falling strand from `from` (pinned if stuck) to `to`. */
  private slack(from: Vector3, to: Vector3, vel: Vector3, pinned: boolean): void {
    const s = this.strand;
    const len = from.distanceTo(to);
    for (let i = 0; i < N; i++) {
      _a.copy(from).lerp(to, i / (N - 1));
      s.place(i, _a.x, _a.y, _a.z);
      const k = i / (N - 1);
      s.setVelocity(i, vel.x * 0.4 * k, vel.y * 0.4 * k, vel.z * 0.4 * k, this.clock.h);
    }
    if (s.constraints === 0) for (let i = 0; i < N - 1; i++) s.link(i, i + 1, len / (N - 1));
    else for (let i = 0; i < N - 1; i++) s.setRest(i, len / (N - 1));
    s.pin(0, pinned);
    this.state = "slack";
    this.fade = FADE;
    this.clock.reset();
  }

  private line(a: Vector3, b: Vector3): void {
    const p = this.points;
    p[0] = a.x;
    p[1] = a.y;
    p[2] = a.z;
    p[3] = b.x;
    p[4] = b.y;
    p[5] = b.z;
    this.count = 2;
    this.widthScale = 1;
  }
}
