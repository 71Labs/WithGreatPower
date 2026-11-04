/**
 * Short camera beats over the chase, at the moments the player isn't steering: the night's
 * countdown, an errand's chat and the end of the night. The chase keeps running underneath;
 * a beat is its own shot blended over the chase's pose (around the look point, so a move
 * sweeps in an arc rather than cutting through the city), and gives the chase back eased.
 *
 * - The countdown: an establishing shot, high and wide over the hero's roof toward the first
 *   stop, that cranes down into the standing shot by the last count (1.9 s), so GO finds the
 *   camera already behind the hero.
 * - An errand: a two-shot of the hero and the ally from a 3/4 angle over the hero's shoulder,
 *   both framed in the band the errand sheet leaves clear (above it, below the top HUD), with
 *   a slow push in. In on the teleport's cut (or eased in when there was none), eased back out
 *   to the chase when the errand is done.
 * - The end of the night: from wherever the chase is, a slow crane up and back over the spot
 *   where the night ended, which settles low in the frame so the skyline fills the rest,
 *   drifting on under the results. (The hero isn't drawn once the night is over: he'd hang
 *   wherever the last tick left him, mid-swing as often as not.)
 *
 * Never in the way: no beat while the sim runs, any input (a key, a press, a look, the stick)
 * skips the countdown's shot and hands an errand's or the outro's camera back, and under
 * reduced motion (the Steady camera) there are no moves: the countdown and the outro hold the
 * chase, an errand's two-shot is a cut with no push. Every pose is kept out of the city.
 *
 * Pure: no three.js or React, nothing allocates per frame. Unit tested in director.test.ts.
 */
import type { RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { ChasePose } from "./chase";
import { bearing, halfWidth, portraitShare, sphereCast, type Cast } from "./framing";
import { Smoothed, angleDelta, type MutableVec3 } from "./springs";

export const DIRECTOR_TUNING = {
  /** The countdown: the crane's length (s; the rest of the count holds on the chase). */
  introMove: 1.9,
  /**
   * The establishing shot: the camera's distance from the hero (×`introPortrait` on a phone)
   * and height (pitch above him, radians), its yaw off the way to the stop, and where the hero
   * stands in the frame (NDC up and down: low, so the city toward the stop fills the rest).
   */
  introDist: 1100,
  introPortrait: 1.3,
  introPitch: 0.5,
  introSide: 0.55,
  introHeroY: -0.45,
  introHeroYPortrait: -0.2,
  /** A skipped beat eases out over this (s). */
  skipTime: 0.4,
  /** An errand: eased in when there was no cut (s), out when it's done (s). */
  errandIn: 0.5,
  errandOut: 1.8,
  /** The two-shot: yaw off the hero → ally line (radians: 0 is behind the hero), pitch, the push in (start share, s), the arm's range. */
  errandAngle: 1.05,
  errandPitch: 0.24,
  errandPush: 1.1,
  errandPushTime: 2.6,
  errandMin: 240,
  errandMax: 1000,
  /** A body's half size for the fit (units). */
  errandBody: 55,
  /**
   * Where the pair goes on screen (NDC): their middle up and down, and the half height and
   * half width they fill. Above the sheet and below the top HUD: wide, then a phone upright.
   */
  errandMid: 0.3,
  errandHalfY: 0.32,
  errandHalfX: 0.4,
  errandMidPortrait: 0.07,
  errandHalfYPortrait: 0.11,
  errandHalfXPortrait: 0.55,
  /**
   * The end of the night: the crane's length (s), the arm it backs out to (×`introPortrait` on
   * a phone) and its pitch, the turns off the chase's yaw and the pitches it may take to find
   * room, and the drift around the hero (rad/s).
   */
  outroMove: 2.6,
  outroDist: 720,
  outroPitch: 0.42,
  outroYaws: [0, 0.5, -0.5, 1, -1, 1.6, -1.6] as readonly number[],
  outroPitches: [0.42, 0.65, 0.9] as readonly number[],
  outroOrbit: 0.07,
  /** Where the spot the night ended settles in the frame (NDC up and down). */
  outroSpotY: -0.3,
  /** Poses keep this far from what the ray from the hero meets (units), and never come nearer than `minArm`. */
  pad: 24,
  minArm: 120,
};

export type DirectorTuning = typeof DIRECTOR_TUNING;

/** The loop's status, as the scene sees it. */
export type LoopPhase = "loading" | "intro" | "live" | "paused" | "outro" | "done";

/** What the page tells the scene about the night each frame. */
export interface SceneCue {
  status: LoopPhase;
  /** Seconds of the countdown left, and its whole length. */
  introLeft: number;
  introTotal: number;
}

export interface DirectorInput {
  /** The loop's cue, or null (no night: the lab, a bench). */
  cue: SceneCue | null;
  mode: RenderFrame3D["mode"];
  hero: Vec3;
  /** The next stop (the first one during the countdown; on an errand, the stop after it). */
  goal: Vec3 | null;
  /** On an errand: where the ally stands. */
  ally: Vec3 | null;
  aspect: number;
  reducedMotion: boolean;
  /** The player pressed, looked or steered this frame. */
  input: boolean;
}

type Beat = "none" | "intro" | "errand" | "outro";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** 0 → 1 with zero velocity and acceleration at both ends. */
export const smootherstep = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** A shot as the arm sees it: the look point, then the camera off it by yaw (atan2(x, z) of the view), pitch (radians, + above) and distance. */
interface Shot {
  target: MutableVec3;
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
}

const newShot = (): Shot => ({ target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, dist: 0, fov: 55 });

/** A pose's shot: its look point and the camera's yaw, pitch and distance off it. */
function shotOf(p: ChasePose, out: Shot): Shot {
  const dx = p.position.x - p.target.x;
  const dy = p.position.y - p.target.y;
  const dz = p.position.z - p.target.z;
  const flat = Math.hypot(dx, dz);
  out.target.x = p.target.x;
  out.target.y = p.target.y;
  out.target.z = p.target.z;
  // The view looks from the camera to the target: the opposite way to the offset.
  out.yaw = flat > 1e-6 ? Math.atan2(-dx, -dz) : 0;
  out.pitch = Math.atan2(dy, Math.max(1e-6, flat));
  out.dist = Math.max(1, Math.hypot(dx, dy, dz));
  out.fov = p.fov;
  return out;
}

export class CameraDirector {
  readonly pose: ChasePose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 55, arm: 0, want: 0, yaw: 0, steer: null };
  /** The beat on now, and how far it's in (0 the chase, 1 the beat's own shot). */
  beat: Beat = "none";
  weight = 0;
  private time = 0;
  /** Easing out: from `fadeFrom` over `fadeTime`, `fadeAt` seconds in. */
  private fading = false;
  private fadeFrom = 0;
  private fadeAt = 0;
  private fadeTime = 0;
  /** Easing in: over `riseTime` (0 snaps). */
  private riseTime = 0;
  private cutPending = false;
  /** The countdown already played (or was skipped) this night. */
  private introDone = false;
  /** A beat the player took the camera back from: it stays off until something else is wanted. */
  private yielded: Beat = "none";
  /** How much of the way from the hero to a beat's camera is clear of the city (eased). */
  private readonly clear = new Smoothed(1);
  /** A beat's first frame: its clearance starts where it is, not eased in from the last beat's. */
  private clearFresh = true;
  /** The errand two-shot's side, and the establishing shot's (±1), picked once per beat. */
  private side = 1;
  /** The outro's starting shot (the chase's) and where it cranes to (picked for room once). */
  private readonly outroFrom = newShot();
  private readonly outroTo = newShot();
  private outroYaw = 0;
  private outroPitch = 0;
  private outroDist = 0;
  private drift = 0;
  private driftStopped = false;
  private readonly chase = newShot();
  private readonly shot = newShot();
  private readonly mix = newShot();
  private readonly dir: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly ring: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly focus: MutableVec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private cast: Cast | null = null,
    readonly tuning: DirectorTuning = DIRECTOR_TUNING,
  ) {}

  setCast(cast: Cast | null): void {
    this.cast = cast;
  }

  /** The chase was cut (a teleport): an errand that starts now starts on its shot. */
  cut(): void {
    this.cutPending = true;
  }

  /** A new night: the countdown's shot may play again. */
  reset(): void {
    this.beat = "none";
    this.weight = 0;
    this.fading = false;
    this.introDone = false;
    this.cutPending = false;
  }

  /** The pose to draw: the chase's, or a beat blended over it. */
  update(chase: ChasePose, i: DirectorInput, dt: number): ChasePose {
    const t = this.tuning;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const cut = this.cutPending;
    this.cutPending = false;
    let want = this.want(i);
    if (want !== this.yielded) this.yielded = "none";
    else want = "none";

    // Start a new beat, or let the one on now go.
    if (want !== this.beat && want !== "none" && !(this.beat !== "none" && !this.fading && this.weight > 0)) this.start(want, i, chase, cut);
    else if (want !== this.beat && !this.fading && this.beat !== "none") this.fadeOut(this.beat === "errand" ? t.errandOut : t.skipTime);
    // Input: the countdown's shot is skipped, an errand's or the outro's camera handed back.
    if (i.input && this.beat !== "none" && !this.fading) {
      if (this.beat === "outro") this.driftStopped = true;
      else {
        this.fadeOut(t.skipTime);
        this.yielded = this.beat;
      }
      if (this.beat === "intro") this.introDone = true;
    }
    if (this.beat === "intro" && i.cue && i.cue.status !== "intro" && !this.fading) this.fadeOut(t.skipTime);

    this.time += step;
    if (this.beat === "none") return chase;

    // The weight: rising, held, or falling.
    if (this.fading) {
      const k = (this.time - this.fadeAt) / Math.max(1e-3, this.fadeTime);
      this.weight = this.fadeFrom * (1 - smootherstep(k));
      if (k >= 1) {
        this.beat = "none";
        this.weight = 0;
        this.fading = false;
        return chase;
      }
    } else if (this.beat === "intro") {
      // The crane: from the establishing shot down to the chase as the count runs.
      const elapsed = i.cue ? i.cue.introTotal - i.cue.introLeft : this.time;
      this.weight = 1 - smootherstep(elapsed / t.introMove);
      if (elapsed >= t.introMove) {
        this.beat = "none";
        this.weight = 0;
        this.introDone = true;
        return chase;
      }
    } else this.weight = this.riseTime > 0 ? smootherstep(this.time / this.riseTime) : 1;

    // The beat's own shot this frame, then the blend over the chase's.
    shotOf(chase, this.chase);
    const s = this.shot;
    if (this.beat === "intro") this.introShot(i, s);
    else if (this.beat === "errand") this.errandShot(i, s);
    else this.outroShot(i, s, step);
    s.fov = this.chase.fov;
    blend(this.chase, s, this.weight, this.mix);
    return this.place(this.mix, i.hero, chase, step);
  }

  /** The beat this frame wants. */
  private want(i: DirectorInput): Beat {
    const cue = i.cue;
    if (!cue) return "none";
    if (cue.status === "outro" || cue.status === "done") return i.reducedMotion ? "none" : "outro";
    if (cue.status === "intro") return i.reducedMotion || this.introDone || !i.goal ? "none" : "intro";
    if (i.mode === "errand" && i.ally) return "errand";
    return "none";
  }

  private start(beat: Beat, i: DirectorInput, chase: ChasePose, cut: boolean): void {
    const t = this.tuning;
    this.beat = beat;
    this.clearFresh = true;
    this.time = 0;
    this.fading = false;
    if (beat === "intro") {
      this.riseTime = 0;
      this.weight = 1;
      this.side = this.pickIntroSide(i, chase);
    } else if (beat === "errand") {
      // On the teleport's cut, start on the shot; otherwise ease in. Steady: always a cut.
      this.riseTime = cut || i.reducedMotion ? 0 : t.errandIn;
      this.side = this.pickSide(i, chase);
      this.weight = this.riseTime > 0 ? 0 : 1;
    } else {
      // The outro starts from the chase's own shot: no blend needed, it moves on from there.
      this.riseTime = 0;
      this.weight = 1;
      shotOf(chase, this.outroFrom);
      this.drift = 0;
      this.driftStopped = false;
      this.pickOutro(i);
    }
  }

  private fadeOut(time: number): void {
    this.fading = true;
    this.fadeFrom = this.weight;
    this.fadeAt = this.time;
    this.fadeTime = time;
  }

  /**
   * The establishing shot: high and wide behind the hero, off to one side of the way to the
   * first stop; looking down at him, then lifted so he stands low in the frame and the city
   * toward the stop fills the rest.
   */
  private introShot(i: DirectorInput, s: Shot): void {
    const t = this.tuning;
    const h = i.hero;
    const toward = (i.goal ? bearing(h, i.goal) : null) ?? this.chase.yaw;
    const dist = t.introDist * (1 + (t.introPortrait - 1) * portraitShare(i.aspect));
    const heroY = t.introHeroY + (t.introHeroYPortrait - t.introHeroY) * portraitShare(i.aspect);
    aimAt(s, h.x, h.y + 20, h.z, toward + this.side * t.introSide, t.introPitch, dist, heroY, this.chase.fov);
  }

  /** The two-shot: from a 3/4 angle over the hero's shoulder, the pair in the band the sheet leaves clear. */
  private errandShot(i: DirectorInput, s: Shot): void {
    const t = this.tuning;
    const h = i.hero;
    const a = i.ally ?? h;
    const line = bearing(h, a) ?? this.chase.yaw;
    const yaw = line + this.side * t.errandAngle;
    const portrait = portraitShare(i.aspect);
    const mid = t.errandMid + (t.errandMidPortrait - t.errandMid) * portrait;
    const halfY = t.errandHalfY + (t.errandHalfYPortrait - t.errandHalfY) * portrait;
    const halfX = t.errandHalfX + (t.errandHalfXPortrait - t.errandHalfX) * portrait;
    const fov = this.chase.fov;
    const tanV = Math.tan((fov * Math.PI) / 360);
    const tanH = Math.tan(halfWidth(fov, i.aspect));
    // The pair seen from the camera's side: how wide (across the view) and how tall.
    const cx = (h.x + a.x) / 2;
    const cy = (h.y + a.y) / 2 + 10;
    const cz = (h.z + a.z) / 2;
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const across = Math.abs((a.x - h.x) * rx + (a.z - h.z) * rz) / 2 + t.errandBody;
    const tall = Math.abs(a.y - h.y) / 2 + t.errandBody;
    let dist = Math.max(across / (tanH * halfX), tall / (tanV * halfY));
    // A slow push in (none under reduced motion).
    if (!i.reducedMotion) dist *= 1 + (t.errandPush - 1) * (1 - smootherstep(this.time / t.errandPushTime));
    dist = clamp(dist, t.errandMin, t.errandMax);
    // The camera `dist` from the pair's middle, aimed so the pair sits `mid` up the frame.
    aimAt(s, cx, cy, cz, yaw, t.errandPitch, dist, mid, fov);
  }

  /** The end of the night: from the chase's shot, a slow crane up and back over where the night ended, drifting round it. */
  private outroShot(i: DirectorInput, s: Shot, dt: number): void {
    const t = this.tuning;
    const k = smootherstep(this.time / t.outroMove);
    if (!this.driftStopped) this.drift += t.outroOrbit * dt * k;
    const h = i.hero;
    aimAt(this.outroTo, h.x, h.y + 30, h.z, this.outroYaw + this.drift, this.outroPitch, this.outroDist, t.outroSpotY, this.chase.fov);
    blend(this.outroFrom, this.outroTo, k, s);
  }

  /** Where the outro cranes to: the turn and pitch off the chase's view with the most room behind, near the chase's own. */
  private pickOutro(i: DirectorInput): void {
    const t = this.tuning;
    const f = this.outroFrom;
    const want = t.outroDist * (1 + (t.introPortrait - 1) * portraitShare(i.aspect));
    let bestScore = -Infinity;
    this.outroYaw = f.yaw;
    this.outroPitch = t.outroPitch;
    this.outroDist = want;
    for (const turn of t.outroYaws) {
      for (const pitch of t.outroPitches) {
        const yaw = f.yaw + turn;
        const room = this.room(i.hero, yaw, pitch, want);
        const score = Math.min(room, want) / want - (Math.abs(turn) / Math.PI) * 0.25 - (pitch - t.outroPitch) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          this.outroYaw = yaw;
          this.outroPitch = pitch;
          this.outroDist = Math.max(t.minArm, Math.min(want, room - t.pad));
        }
      }
    }
  }

  /** The establishing shot's side of the way to the stop: the one with room behind the hero, else the chase's. */
  private pickIntroSide(i: DirectorInput, chase: ChasePose): number {
    const t = this.tuning;
    const h = i.hero;
    const toward = (i.goal ? bearing(h, i.goal) : null) ?? shotOf(chase, this.chase).yaw;
    const now = shotOf(chase, this.chase).yaw;
    const dist = t.introDist * (1 + (t.introPortrait - 1) * portraitShare(i.aspect));
    let best = 1;
    let bestScore = -Infinity;
    for (const side of [1, -1]) {
      const yaw = toward + side * t.introSide;
      const score = Math.min(1, this.room(h, yaw, t.introPitch, dist) / dist) - (Math.abs(angleDelta(now, yaw)) / Math.PI) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = side;
      }
    }
    return best;
  }

  /** How far a camera can back off from the hero along a view yaw and a pitch above him before it meets the city. */
  private room(hero: Vec3, yaw: number, pitch: number, max: number): number {
    if (!this.cast) return max;
    const cp = Math.cos(pitch);
    const d = this.dir;
    d.x = -Math.sin(yaw) * cp;
    d.y = Math.sin(pitch);
    d.z = -Math.cos(yaw) * cp;
    const f = this.focus;
    f.x = hero.x;
    f.y = hero.y + 20;
    f.z = hero.z;
    const hit = sphereCast(this.cast, f, d, max, 16, this.ring);
    return hit === null ? max : hit;
  }

  /**
   * Which side of the hero → ally line the two-shot takes: the one with room, else the one
   * nearer the way on to the next stop (where the chase turns once the errand's done), so the
   * hand-back turns the least.
   */
  private pickSide(i: DirectorInput, chase: ChasePose): number {
    const t = this.tuning;
    const h = i.hero;
    const a = i.ally ?? h;
    const line = bearing(h, a) ?? 0;
    const now = (i.goal ? bearing(h, i.goal) : null) ?? shotOf(chase, this.chase).yaw;
    let best = 1;
    let bestScore = -Infinity;
    for (const side of [1, -1]) {
      const yaw = line + side * t.errandAngle;
      const cp = Math.cos(t.errandPitch);
      const d = this.dir;
      d.x = -Math.sin(yaw) * cp;
      d.y = Math.sin(t.errandPitch);
      d.z = -Math.cos(yaw) * cp;
      const f = this.focus;
      f.x = (h.x + a.x) / 2;
      f.y = (h.y + a.y) / 2 + 10;
      f.z = (h.z + a.z) / 2;
      const hit = this.cast ? sphereCast(this.cast, f, d, t.errandMax, 16, this.ring) : null;
      const room = hit === null ? t.errandMax : hit;
      const score = Math.min(room, 600) / 600 - Math.abs(angleDelta(now, yaw)) / Math.PI * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = side;
      }
    }
    return best;
  }

  /**
   * Write `s` into the pose, kept out of the city: from the hero (never inside a solid) toward
   * the camera, a sphere cast; past what it meets the camera comes in along that line.
   */
  private place(s: Shot, hero: Vec3, chase: ChasePose, dt: number): ChasePose {
    const t = this.tuning;
    const p = this.pose;
    const cp = Math.cos(s.pitch);
    p.position.x = s.target.x - Math.sin(s.yaw) * cp * s.dist;
    p.position.y = s.target.y + Math.sin(s.pitch) * s.dist;
    p.position.z = s.target.z - Math.cos(s.yaw) * cp * s.dist;
    p.target.x = s.target.x;
    p.target.y = s.target.y;
    p.target.z = s.target.z;
    const d = this.dir;
    d.x = p.position.x - hero.x;
    d.y = p.position.y - hero.y;
    d.z = p.position.z - hero.z;
    const len = Math.hypot(d.x, d.y, d.z);
    if (this.cast && len > 1) {
      d.x /= len;
      d.y /= len;
      d.z /= len;
      // The share of the line that's clear, eased (in fast, out slowly) so a roof edge crossing it never pops the camera.
      const hit = sphereCast(this.cast, hero, d, len, 8, this.ring);
      const room = hit === null ? 1 : clamp(Math.max(Math.min(t.minArm, len), hit - t.pad) / len, 0, 1);
      if (this.clearFresh) this.clear.snap(room);
      else this.clear.step(room, room < this.clear.value ? 0.06 : 0.45, dt);
      this.clearFresh = false;
      // In along the line to the hero; the look point moves with it, so the view never swings.
      const pull = len * (1 - clamp(this.clear.value, 0, 1));
      p.position.x -= d.x * pull;
      p.position.y -= d.y * pull;
      p.position.z -= d.z * pull;
      p.target.x -= d.x * pull;
      p.target.y -= d.y * pull;
      p.target.z -= d.z * pull;
    }
    p.position.y = Math.max(18, p.position.y);
    p.fov = s.fov;
    p.arm = Math.hypot(p.position.x - hero.x, p.position.y - hero.y, p.position.z - hero.z);
    p.want = chase.want;
    p.yaw = s.yaw;
    // While a beat holds the camera the stick goes by the view (the sim isn't running anyway).
    p.steer = null;
    return p;
  }
}

/**
 * A shot that puts the camera `dist` from (x, y, z) along a view yaw, `pitch` above it, and
 * aims so that point sits `ndcY` up the frame (negative: below the middle) at vertical FOV
 * `fov`: the view looks at the point, then turns up (or down) by the angle that takes.
 */
function aimAt(s: Shot, x: number, y: number, z: number, yaw: number, pitch: number, dist: number, ndcY: number, fov: number): Shot {
  const lift = Math.atan(ndcY * Math.tan((fov * Math.PI) / 360));
  const cp = Math.cos(pitch);
  const camX = x - Math.sin(yaw) * cp * dist;
  const camY = y + Math.sin(pitch) * dist;
  const camZ = z - Math.cos(yaw) * cp * dist;
  // The view's pitch below the horizon: down to the point, less the lift.
  const down = pitch + lift;
  s.yaw = yaw;
  s.pitch = down;
  s.dist = dist;
  s.target.x = camX + Math.sin(yaw) * Math.cos(down) * dist;
  s.target.y = camY - Math.sin(down) * dist;
  s.target.z = camZ + Math.cos(yaw) * Math.cos(down) * dist;
  return s;
}

/** Blend two shots `w` of the way from `a` to `b`: the look point straight, the camera around it. */
function blend(a: Shot, b: Shot, w: number, out: Shot): Shot {
  out.target.x = a.target.x + (b.target.x - a.target.x) * w;
  out.target.y = a.target.y + (b.target.y - a.target.y) * w;
  out.target.z = a.target.z + (b.target.z - a.target.z) * w;
  out.yaw = a.yaw + angleDelta(a.yaw, b.yaw) * w;
  out.pitch = a.pitch + (b.pitch - a.pitch) * w;
  out.dist = Math.exp(Math.log(Math.max(1, a.dist)) + (Math.log(Math.max(1, b.dist)) - Math.log(Math.max(1, a.dist))) * w);
  out.fov = a.fov + (b.fov - a.fov) * w;
  return out;
}
