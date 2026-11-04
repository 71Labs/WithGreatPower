/**
 * Camera metrics on real nights. The bot plays guest nights through the real sim, as
 * /play/patrol?autopilot=1 does; the loop's phases are replayed at 60 frames a second (the
 * 3-2-1 countdown, live play, the errand sheet's 1.4 s, the outro and the results), and the
 * camera is fed exactly as scene/engine.ts feeds it. Every frame is scored:
 *
 * - framing: where the hero lands on screen (NDC), off-centre or off screen, and whether the
 *   body runs under the HUD (the HUD boxes measured on the page at each size);
 * - occlusion: the camera inside a solid, skimming one, or a solid between it and the hero;
 * - motion: yaw and pitch rates, the view's angular acceleration and jerk, arm pops, flips;
 * - FOV: its range and rate;
 * - looking ahead: the next stop on screen (the waypoint pin, and in the world unhidden),
 *   the web anchor on screen, and the angle between the view and the travel direction;
 * - standing still, arrivals, errands, the countdown and the outro.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/camera/metrics.ts [--label after] [--out file.json] [--nights 4,19,7,12] [--steady]
 *     [--only phone] [--tune "travel.guardSoftPortrait=0.3;director.introDist=900"] [--brief]
 *
 * `--tune` tries values without editing the code (travel.* framing.ts, director.* director.ts,
 * chase.* chase.ts); `--brief` prints only the swing, travel and look-ahead lines.
 */
import { writeFileSync } from "node:fs";

import { HP_PER_LEVEL } from "@wgp/game-core/data";
import { newSave, reduce, seedOf } from "@wgp/game-core/engine";
import { chooseErrand, needsErrand, startRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, fillRenderFrame, newBotMemory, newRenderFrame, quantizeStick } from "@wgp/game-core/sim3d";
import type { City, InputFrame, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";
import type { PowerId, Save } from "@wgp/game-core/types";

import { createCameraRig, type RigStatus } from "./rig";
import { CHASE_TUNING } from "../../src/game3d/scene/camera/chase";
import { DIRECTOR_TUNING } from "../../src/game3d/scene/camera/director";
import { TRAVEL_TUNING } from "../../src/game3d/scene/camera/framing";
import type { ChasePose } from "../../src/game3d/scene/camera/chase";
import { citySolids, raycastSolids, type CitySolids } from "../../src/game3d/scene/camera/raycast";
import { inBox, project, waypointLayout, type Rect } from "../../src/game3d/nav/waypoint";
import { copyFrame, teleported } from "../../src/game3d/session/blend";
import type { Stick } from "../../src/game3d/input/stick";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : (args[i + 1] ?? def);
};
const label = opt("label", "current");
const outFile = opt("out", "");
const nights = opt("nights", "4,19,7,12,27,33").split(",").map(Number);
const steady = args.includes("--steady");
const only = opt("only", "");
const brief = args.includes("--brief");
const TUNABLE: Record<string, Record<string, unknown>> = { travel: TRAVEL_TUNING, director: DIRECTOR_TUNING, chase: CHASE_TUNING };
for (const pair of opt("tune", "").split(";").filter(Boolean)) {
  const [key, value] = pair.split("=");
  const [group, name] = key.split(".");
  const target = TUNABLE[group];
  if (!target || !(name in target)) throw new Error(`--tune: no ${key}`);
  target[name] = JSON.parse(value);
}

const FPS = 60;
const DT = 1 / FPS;
const INTRO = 2.4;
const OUTRO = 1.4;
const RESULTS = 3;
const ERRAND_WAIT = 1.4;

/* ------------------------------------------------------------------ viewports and the HUD */

interface Viewport {
  name: string;
  w: number;
  h: number;
  touch: boolean;
  /** The HUD's boxes in live play, CSS px (measured on the page: launch/brand/hero/camera-shoot.mjs hud). */
  hud: Rect[];
  /** Those of them shown only while there's swinging or fighting to do (the powers): not over an errand or after the night. */
  powers: Rect[];
  /** What the errand sheet covers. */
  sheet: Rect;
}

/**
 * The HUD at 1920×1080 (mouse) and 390×844 (touch, an iPhone's safe areas), measured from
 * the page during the first leg (camera-shoot.mjs hud), padded a few px: with a mouse the
 * meters and combo, the route bar, pause, the minimap and the row of powers; on touch the top
 * stack (meters, pause, route bar), the minimap under it and the power arc's five buttons
 * (the arc curves: the corner of its bounding box, where the hero often is, is empty). The
 * first-leg hint is left out: it goes with the first web.
 */
const ARC: Rect[] = [
  { x0: 304, y0: 724, x1: 380, y1: 800 },
  { x0: 190, y0: 730, x1: 254, y1: 794 },
  { x0: 206, y0: 670, x1: 270, y1: 734 },
  { x0: 250, y0: 626, x1: 314, y1: 690 },
  { x0: 310, y0: 610, x1: 374, y1: 674 },
];
const VIEWPORTS: Viewport[] = [
  {
    name: "desktop",
    w: 1920,
    h: 1080,
    touch: false,
    hud: [
      { x0: 0, y0: 0, x1: 250, y1: 160 },
      { x0: 670, y0: 0, x1: 1250, y1: 86 },
      { x0: 1850, y0: 0, x1: 1920, y1: 70 },
      { x0: 0, y0: 856, x1: 224, y1: 1080 },
      { x0: 1580, y0: 960, x1: 1920, y1: 1080 },
    ],
    powers: [{ x0: 1580, y0: 960, x1: 1920, y1: 1080 }],
    sheet: { x0: 690, y0: 720, x1: 1230, y1: 1064 },
  },
  {
    name: "phone",
    w: 390,
    h: 844,
    touch: true,
    hud: [
      { x0: 0, y0: 0, x1: 390, y1: 215 },
      { x0: 250, y0: 215, x1: 390, y1: 345 },
      ...ARC,
    ],
    powers: ARC,
    sheet: { x0: 12, y0: 476, x1: 378, y1: 818 },
  },
];

/* ------------------------------------------------------------------ saves */

const LOADOUT: PowerId[] = ["web-sling", "web-bomb", "validator-slam", "web-shield"];

/** A level 4 guest hero on night `night` (as launch/make-saves.ts makes them). */
function heroSave(night: number): Save {
  let s = reduce(newSave(), { type: "create-hero", name: "Peter Parquet", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
  const h = s.hero!;
  const powers = { ...h.powers };
  for (const p of LOADOUT) powers[p] = powers[p] ?? { mastery: 12 };
  s = { ...s, night, hero: { ...h, powers, loadout: LOADOUT, pendingPicks: 0, level: 4, maxHp: h.maxHp + 3 * HP_PER_LEVEL } };
  return s;
}

/* ------------------------------------------------------------------ sampling */

type Phase = "intro" | "swing" | "air" | "run" | "stand" | "arrive" | "errand" | "fight" | "outro";
const PHASES: Phase[] = ["intro", "swing", "air", "run", "stand", "arrive", "errand", "fight", "outro"];

/** One frame's scores. NaN when it doesn't apply. */
interface Sample {
  phase: Phase;
  /** Also counts toward the arrival beat (the last 2.5 s before reaching a stop). */
  arriving: boolean;
  cut: boolean;
  hx: number;
  hy: number;
  onScreen: boolean;
  offCentre: boolean;
  hudClip: boolean;
  inside: boolean;
  /** Inside a building, setback or the bridge (not a rooftop prop). */
  insideBuilding: boolean;
  skim: boolean;
  blocked: boolean;
  yaw: number;
  pitch: number;
  fov: number;
  arm: number;
  stopPin: boolean;
  stopSeen: boolean;
  stopDist: number;
  stopBearing: number;
  anchorSeen: number;
  travelAngle: number;
  allySeen: number;
  pairClear: number;
  /** Errands: the two bodies apart on screen (neither hides the other). */
  pairApart: number;
  /** A fight live (mode "fight"): both fighters on screen (NaN otherwise), and the camera's height. */
  bothOn: number;
  camY: number;
}

/** Distance from p to an axis-aligned box (0 inside). */
function boxDistance(s: CitySolids, i: number, p: Vec3): number {
  const dx = Math.max(s.minX[i] - p.x, 0, p.x - s.maxX[i]);
  const dy = Math.max(s.minY[i] - p.y, 0, p.y - s.maxY[i]);
  const dz = Math.max(s.minZ[i] - p.z, 0, p.z - s.maxZ[i]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function nearestSolid(s: CitySolids, p: Vec3): number {
  let best = Infinity;
  for (let i = 0; i < s.count; i++) {
    // Cheap reject first.
    if (p.x < s.minX[i] - best || p.x > s.maxX[i] + best || p.z < s.minZ[i] - best || p.z > s.maxZ[i] + best) continue;
    best = Math.min(best, boxDistance(s, i, p));
  }
  return best;
}

/** Whether a solid stands between `from` and `to` (the far end pulled back `pull`, as the occlusion fade does). */
function lineBlocked(s: CitySolids, from: Vec3, to: Vec3, pull: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < pull + 5) return false;
  const dir = { x: dx / d, y: dy / d, z: dz / d };
  return raycastSolids(s, from, dir, d - pull) !== null;
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const within = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;

function wrap(a: number) {
  let d = a % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

function score(pose: ChasePose, f: RenderFrame3D, city: City, solids: CitySolids, buildings: CitySolids, vp: Viewport, phase: Phase): Omit<Sample, "phase" | "arriving" | "cut"> {
  const { w, h } = vp;
  const layout = waypointLayout(w, h, vp.touch);
  const hero = f.hero.pos;
  const pr = project(hero, pose, w, h);
  const top = project({ x: hero.x, y: hero.y + 44, z: hero.z }, pose, w, h);
  const bottom = project({ x: hero.x, y: hero.y - 44, z: hero.z }, pose, w, h);
  const half = Math.max(10, Math.abs(bottom.y - top.y) / 2);
  const body: Rect = { x0: pr.x - half * 0.6, y0: pr.y - half, x1: pr.x + half * 0.6, y1: pr.y + half };
  const onScreen = !pr.behind && pr.x > 0 && pr.x < w && pr.y > 0 && pr.y < h;
  const hx = pr.behind ? NaN : (pr.x / w) * 2 - 1;
  const hy = pr.behind ? NaN : 1 - (pr.y / h) * 2;
  // The comfortable box: the middle 60% across, the lower-middle of the frame up and down.
  const offCentre = !onScreen || Math.abs(hx) > 0.3 || hy > 0.2 || hy < -0.6;
  // The HUD as it is in this phase: the powers only while playing; nothing once the night's over (the results).
  const hud = phase === "outro" ? [] : phase === "errand" ? vp.hud.filter((r) => !vp.powers.includes(r)) : vp.hud;
  const hudClip = !onScreen || hud.some((r) => overlaps(r, body));
  const cam = pose.position;
  const near = nearestSolid(solids, cam);
  const inside = near <= 0;
  const insideBuilding = nearestSolid(buildings, cam) <= 0;
  const skim = near < 12;
  const blocked = !inside && lineBlocked(solids, cam, hero, 46);

  const fx = pose.target.x - cam.x;
  const fy = pose.target.y - cam.y;
  const fz = pose.target.z - cam.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const yaw = Math.atan2(fx, fz);
  const pitch = Math.asin(fy / fl);

  // The next stop: the waypoint's pin, and the stop itself on screen and unhidden.
  let stopPin = false;
  let stopSeen = false;
  let stopDist = NaN;
  let stopBearing = NaN;
  const zone = city.zones[f.stop];
  if (zone && f.mode === "travel") {
    const at = zone.kind === "errand" ? (zone.allyAt ?? zone.center) : zone.center;
    stopPin = inBox(project({ x: at.x, y: at.y + 150, z: at.z }, pose, w, h), w, h, layout.pin, layout.avoidPin);
    const mark = { x: at.x, y: at.y + 60, z: at.z };
    stopSeen = inBox(project(mark, pose, w, h), w, h, layout.arrow, vp.hud) && !lineBlocked(solids, cam, mark, 80);
    stopDist = Math.hypot(at.x - hero.x, at.z - hero.z);
    stopBearing = Math.abs(wrap(Math.atan2(at.x - hero.x, at.z - hero.z) - yaw));
  }
  // The web anchor, anywhere on screen (a little margin).
  let anchorSeen = NaN;
  if (f.hero.anchor) {
    const a = project(f.hero.anchor, pose, w, h);
    anchorSeen = !a.behind && a.x > w * 0.03 && a.x < w * 0.97 && a.y > h * 0.03 && a.y < h * 0.97 ? 1 : 0;
  }
  const v = f.hero.vel;
  const sp = Math.hypot(v.x, v.z);
  const travelAngle = sp > 300 ? Math.abs(wrap(Math.atan2(v.x, v.z) - yaw)) : NaN;

  // Errands: the ally on screen, and both bodies clear of the sheet and the HUD.
  let allySeen = NaN;
  let pairClear = NaN;
  let pairApart = NaN;
  // A fight live: both fighters inside the frame (as the fight camera report counts them).
  let bothOn = NaN;
  if (f.mode === "fight") {
    const rival = f.villains.find((v) => !v.copy) ?? f.villains[0];
    const on = (q: { x: number; y: number; behind: boolean }) => !q.behind && q.x >= 0 && q.x <= w && q.y >= 0 && q.y <= h;
    bothOn = rival && on(pr) && on(project(rival.pos, pose, w, h)) ? 1 : 0;
  }
  if (phase === "errand" && zone?.allyAt) {
    const a = project({ x: zone.allyAt.x, y: zone.allyAt.y + 44, z: zone.allyAt.z }, pose, w, h);
    const aOn = !a.behind && a.x > 0 && a.x < w && a.y > 0 && a.y < h;
    allySeen = aOn ? 1 : 0;
    const clear = (x: number, y: number) => !within(vp.sheet, x, y) && !hud.some((r) => within(r, x, y));
    pairClear = aOn && onScreen && clear(a.x, a.y) && clear(pr.x, pr.y) ? 1 : 0;
    // Apart: the ally's middle outside the hero's body box (from this camera, one would hide the other).
    pairApart = aOn && onScreen && !within(body, a.x, a.y) ? 1 : 0;
  }
  return { hx, hy, onScreen, offCentre, hudClip, inside, insideBuilding, skim, blocked, yaw, pitch, fov: pose.fov, arm: Math.hypot(cam.x - hero.x, cam.y - hero.y, cam.z - hero.z), stopPin, stopSeen, stopDist, stopBearing, anchorSeen, travelAngle, allySeen, pairClear, pairApart, bothOn, camY: cam.y };
}

/* ------------------------------------------------------------------ one night */

/**
 * After GO and after each errand the player stands still this long; then, once, holds the
 * stick right for SIDE seconds. The run goes 90° right of the way the hero faces at GO, in the
 * world (not from the camera), so every camera plays the same night.
 */
const STAND = 3;
const STAND_AFTER_ERRAND = 2;
const SIDE = 0.9;
const IDLE: InputFrame = { dir: 0, mag: 0, web: false, shot: 0 };

function playNight(night: number, vp: Viewport): Sample[] {
  const save = heroSave(night);
  const run = startRun(save, seedOf(save.night, save.hero!.name));
  if (run.error) throw new Error(`night ${night}: ${run.error}`);
  const city = run.sim.city;
  const solids = citySolids(city);
  const buildings = citySolids(city, { props: false });
  const rig = createCameraRig(city, steady);
  const mem = newBotMemory();
  let curr = fillRenderFrame(run.sim, newRenderFrame());
  let prev = copyFrame(curr, newRenderFrame());
  const samples: Sample[] = [];
  const arrivals: number[] = [];
  // A new night starts on a cut (the last night's camera is somewhere else).
  let cut = true;
  let pose: ChasePose | null = null;
  let steer: Stick = { x: 0, y: 0 };

  const frame = (status: RigStatus, introLeft = 0) => {
    pose = rig.update(curr, status, vp.w, vp.h, DT, steer, introLeft);
    const f = curr;
    const mode = f.mode;
    const speed = Math.hypot(f.hero.vel.x, f.hero.vel.z);
    const phase: Phase =
      status === "intro"
        ? "intro"
        : status === "outro" || status === "done"
          ? "outro"
          : mode === "errand"
            ? "errand"
            : mode === "intro" || mode === "fight" || mode === "won" || mode === "ko"
              ? "fight"
              : f.hero.anchor
                ? "swing"
                : !f.hero.grounded
                  ? "air"
                  : speed > 30
                    ? "run"
                    : "stand";
    samples.push({ phase, arriving: false, cut, ...score(pose, f, city, solids, buildings, vp, phase) });
    cut = false;
  };
  /** One live tick from `input` (the player's or the bot's), then a frame. */
  const tick = (input: InputFrame) => {
    const swap = prev;
    prev = curr;
    curr = swap;
    const events = stepRun(run, input);
    fillRenderFrame(run.sim, curr);
    if (teleported(prev, curr)) {
      rig.cut();
      cut = true;
    }
    for (const ev of events) {
      rig.event(ev);
      if (ev.type === "arrive") arrivals.push(samples.length);
    }
    frame("live");
  };

  for (let t = 0; t < INTRO; t += DT) frame("intro", INTRO - t);
  rig.event({ type: "go" });
  // Stand still after GO, then run right for a moment, then the bot.
  let still = STAND;
  let side = SIDE;
  const fx = curr.hero.facing?.x ?? 1;
  const fz = curr.hero.facing?.z ?? 0;
  const right = quantizeStick(-fz, fx);
  let guard = 0;
  while (!run.over && !run.error && guard++ < 60 * 900) {
    if (needsErrand(run)) {
      for (let t = 0; t < ERRAND_WAIT; t += DT) frame("live");
      chooseErrand(run, 0);
      fillRenderFrame(run.sim, curr);
      copyFrame(curr, prev);
      still = STAND_AFTER_ERRAND;
      continue;
    }
    if (still > 0) {
      still -= DT;
      steer = { x: 0, y: 0 };
      tick(IDLE);
    } else if (side > 0) {
      side -= DT;
      steer = { x: 1, y: 0 };
      tick({ dir: right.dir, mag: right.mag, web: false, shot: 0 });
    } else {
      steer = { x: 0, y: 0 };
      tick(botFrame(run.sim, mem));
    }
  }
  for (let t = 0; t < OUTRO; t += DT) frame("outro");
  for (let t = 0; t < RESULTS; t += DT) frame("done");
  for (const at of arrivals) for (let i = Math.max(0, at - Math.round(2.5 * FPS)); i < at; i++) samples[i].arriving = true;
  return samples;
}

/* ------------------------------------------------------------------ summaries */

const pct = (xs: boolean[]) => (xs.length ? (100 * xs.filter(Boolean).length) / xs.length : NaN);
const mean = (xs: number[]) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};
function quantile(xs: number[], q: number) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
}
const deg = (r: number) => (r * 180) / Math.PI;

/** Rates, accelerations and jerks of yaw and pitch (per frame, skipping cuts), and arm pops. */
function motion(samples: Sample[]) {
  const yawRate: number[] = [];
  const pitchRate: number[] = [];
  const acc: number[] = [];
  const jerk: number[] = [];
  const fovRate: number[] = [];
  const armRate: number[] = [];
  let flips = 0;
  let pops = 0;
  let lastY: number | null = null;
  let lastP: number | null = null;
  let lastRate: [number, number] | null = null;
  let lastAcc: [number, number] | null = null;
  let lastFov: number | null = null;
  let lastArm: number | null = null;
  const per: Record<string, { yaw: number[]; pitch: number[]; acc: number[]; jerk: number[]; flips: number; pops: number; arm: number[] }> = {};
  for (const p of PHASES) per[p] = { yaw: [], pitch: [], acc: [], jerk: [], flips: 0, pops: 0, arm: [] };
  for (const s of samples) {
    if (s.cut || lastY === null || lastP === null) {
      lastY = s.yaw;
      lastP = s.pitch;
      lastRate = null;
      lastAcc = null;
      lastFov = s.fov;
      lastArm = s.arm;
      continue;
    }
    const yr = wrap(s.yaw - lastY) / DT;
    const pr = (s.pitch - lastP) / DT;
    const g = per[s.phase];
    yawRate.push(Math.abs(yr));
    pitchRate.push(Math.abs(pr));
    g.yaw.push(Math.abs(yr));
    g.pitch.push(Math.abs(pr));
    if (Math.hypot(yr, pr) > Math.PI) {
      flips++;
      g.flips++;
    }
    if (lastRate) {
      const a: [number, number] = [(yr - lastRate[0]) / DT, (pr - lastRate[1]) / DT];
      const am = Math.hypot(a[0], a[1]);
      acc.push(am);
      g.acc.push(am);
      if (lastAcc) {
        const j = Math.hypot(a[0] - lastAcc[0], a[1] - lastAcc[1]) / DT;
        jerk.push(j);
        g.jerk.push(j);
      }
      lastAcc = a;
    }
    lastRate = [yr, pr];
    if (lastFov !== null) fovRate.push(Math.abs(s.fov - lastFov) / DT);
    if (lastArm !== null) {
      const ar = Math.abs(s.arm - lastArm) / DT;
      armRate.push(ar);
      g.arm.push(ar);
      if (Math.abs(s.arm - lastArm) > 12) {
        pops++;
        g.pops++;
      }
    }
    lastY = s.yaw;
    lastP = s.pitch;
    lastFov = s.fov;
    lastArm = s.arm;
  }
  return { yawRate, pitchRate, acc, jerk, fovRate, armRate, flips, pops, per };
}

function summarize(samples: Sample[]) {
  const m = motion(samples);
  const by = (p: Phase) => samples.filter((s) => s.phase === p);
  const travel = samples.filter((s) => s.phase === "swing" || s.phase === "air" || s.phase === "run" || s.phase === "stand");
  const phase = (xs: Sample[], p?: Phase) => ({
    frames: xs.length,
    offCentrePct: pct(xs.map((s) => s.offCentre)),
    offScreenPct: pct(xs.map((s) => !s.onScreen)),
    hudClipPct: pct(xs.map((s) => s.hudClip)),
    heroX: { mean: mean(xs.map((s) => Math.abs(s.hx))), p95: quantile(xs.map((s) => Math.abs(s.hx)), 0.95) },
    heroY: { mean: mean(xs.map((s) => s.hy)), p5: quantile(xs.map((s) => s.hy), 0.05), p95: quantile(xs.map((s) => s.hy), 0.95) },
    stopPinPct: pct(xs.map((s) => s.stopPin)),
    insidePct: pct(xs.map((s) => s.inside)),
    insideBuildingPct: pct(xs.map((s) => s.insideBuilding)),
    skimPct: pct(xs.map((s) => s.skim)),
    blockedPct: pct(xs.map((s) => s.blocked)),
    pitchDownDeg: { mean: -deg(mean(xs.map((s) => s.pitch))), p5: -deg(quantile(xs.map((s) => s.pitch), 0.95)), p95: -deg(quantile(xs.map((s) => s.pitch), 0.05)) },
    arm: { mean: mean(xs.map((s) => s.arm)), min: quantile(xs.map((s) => s.arm), 0), max: quantile(xs.map((s) => s.arm), 1) },
    fov: { min: quantile(xs.map((s) => s.fov), 0), max: quantile(xs.map((s) => s.fov), 1) },
    ...(p
      ? {
          yawRateDeg: { p95: deg(quantile(m.per[p].yaw, 0.95)), max: deg(quantile(m.per[p].yaw, 1)) },
          pitchRateDeg: { p95: deg(quantile(m.per[p].pitch, 0.95)), max: deg(quantile(m.per[p].pitch, 1)) },
          accDeg: { p95: deg(quantile(m.per[p].acc, 0.95)), max: deg(quantile(m.per[p].acc, 1)) },
          jerkDeg: { p95: deg(quantile(m.per[p].jerk, 0.95)), max: deg(quantile(m.per[p].jerk, 1)) },
          armRate: { p95: quantile(m.per[p].arm, 0.95), max: quantile(m.per[p].arm, 1) },
          flips: m.per[p].flips,
          pops: m.per[p].pops,
        }
      : {}),
  });
  const phases: Record<string, ReturnType<typeof phase>> = {};
  for (const p of PHASES) phases[p] = phase(by(p), p);
  phases.travel = phase(travel);
  const arriving = samples.filter((s) => s.arriving);
  const stand = by("stand");
  const errand = by("errand");
  // Fights live: both fighters in frame, the camera inside a building, and its bob (its height
  // less its own 1-second moving average, over each run of live fight frames).
  const live = samples.filter((s) => Number.isFinite(s.bothOn));
  const bob: number[] = [];
  for (let i = 0; i < samples.length; ) {
    if (!Number.isFinite(samples[i].bothOn)) {
      i++;
      continue;
    }
    let j = i;
    while (j < samples.length && Number.isFinite(samples[j].bothOn) && (j === i || !samples[j].cut)) j++;
    for (let k = i + 30; k < j - 30; k++) {
      let m = 0;
      for (let q = -30; q <= 30; q++) m += samples[k + q].camY;
      bob.push(Math.abs(samples[k].camY - m / 61));
    }
    i = j;
  }
  const allTravel = travel;
  const band = (lo: number, hi: number) => pct(allTravel.filter((s) => s.stopDist >= lo && s.stopDist < hi).map((s) => s.stopSeen));
  return {
    frames: samples.length,
    cuts: samples.filter((s) => s.cut).length,
    phases,
    motion: {
      yawRateDeg: { p50: deg(quantile(m.yawRate, 0.5)), p95: deg(quantile(m.yawRate, 0.95)), max: deg(quantile(m.yawRate, 1)) },
      pitchRateDeg: { p50: deg(quantile(m.pitchRate, 0.5)), p95: deg(quantile(m.pitchRate, 0.95)), max: deg(quantile(m.pitchRate, 1)) },
      accDeg: { p95: deg(quantile(m.acc, 0.95)), max: deg(quantile(m.acc, 1)) },
      jerkDeg: { p95: deg(quantile(m.jerk, 0.95)), max: deg(quantile(m.jerk, 1)) },
      fovRate: { p95: quantile(m.fovRate, 0.95), max: quantile(m.fovRate, 1) },
      armRate: { p95: quantile(m.armRate, 0.95), max: quantile(m.armRate, 1) },
      flips: m.flips,
      pops: m.pops,
    },
    ahead: {
      stopPinPct: pct(allTravel.map((s) => s.stopPin)),
      stopSeenPct: pct(allTravel.map((s) => s.stopSeen)),
      stopSeenByDist: { under1500: band(0, 1500), "1500to3000": band(1500, 3000), over3000: band(3000, Infinity) },
      anchorSeenPct: 100 * mean(allTravel.map((s) => s.anchorSeen)),
      travelAngleDeg: { mean: deg(mean(allTravel.map((s) => s.travelAngle))), p95: deg(quantile(allTravel.map((s) => s.travelAngle), 0.95)) },
      stopBearingDeg: { mean: deg(mean(allTravel.map((s) => s.stopBearing))), p95: deg(quantile(allTravel.map((s) => s.stopBearing), 0.95)) },
      arrivingStopSeenPct: pct(arriving.map((s) => s.stopSeen)),
    },
    stand: {
      frames: stand.length,
      stopSeenPct: pct(stand.map((s) => s.stopSeen)),
      stopBearingDeg: { mean: deg(mean(stand.map((s) => s.stopBearing))), p95: deg(quantile(stand.map((s) => s.stopBearing), 0.95)) },
    },
    fightLive: {
      frames: live.length,
      bothFramedPct: 100 * mean(live.map((s) => s.bothOn)),
      insideBuildingPct: pct(live.map((s) => s.insideBuilding)),
      bobP95: quantile(bob, 0.95),
    },
    errand: {
      frames: errand.length,
      allySeenPct: 100 * mean(errand.map((s) => s.allySeen)),
      pairClearPct: 100 * mean(errand.map((s) => s.pairClear)),
      pairApartPct: 100 * mean(errand.map((s) => s.pairApart)),
      pairShownPct: 100 * mean(errand.map((s) => s.pairClear * s.pairApart)),
    },
  };
}

/* ------------------------------------------------------------------ main */

const report: Record<string, unknown> = { label, steady, nights };
const viewports = VIEWPORTS.filter((vp) => !only || vp.name === only);
for (const vp of viewports) {
  const all: Sample[] = [];
  for (const n of nights) all.push(...playNight(n, vp));
  report[vp.name] = summarize(all);
}
if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 1));

/* A compact table on stdout. */
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "–");
for (const vp of viewports) {
  const r = report[vp.name] as ReturnType<typeof summarize>;
  console.log(`\n${label} · ${vp.name} ${vp.w}×${vp.h}${steady ? " · steady" : ""} · ${r.frames} frames, ${r.cuts} cuts`);
  console.log("phase    frames  offC%  offS%  hud%  in%(bld)   skim%  blk%  |x|   y    pitch↓  arm   fov       yaw°/s p95/max  jerk p95  pops flips");
  for (const p of [...PHASES, "travel"]) {
    const s = r.phases[p];
    if (!s.frames || (brief && p !== "swing" && p !== "air" && p !== "travel")) continue;
    const yr = "yawRateDeg" in s ? `${f1(s.yawRateDeg!.p95)}/${f1(s.yawRateDeg!.max)}` : "";
    const jk = "jerkDeg" in s ? f1(s.jerkDeg!.p95) : "";
    console.log(
      `${p.padEnd(8)} ${String(s.frames).padStart(6)} ${f1(s.offCentrePct).padStart(6)} ${f1(s.offScreenPct).padStart(6)} ${f1(s.hudClipPct).padStart(5)} ${f1(s.insidePct).padStart(4)}(${f1(s.insideBuildingPct).padStart(4)}) ${f1(s.skimPct).padStart(6)} ${f1(s.blockedPct).padStart(5)}  ${s.heroX.mean.toFixed(2)} ${s.heroY.mean.toFixed(2).padStart(5)} ${f1(s.pitchDownDeg.mean).padStart(6)} ${f1(s.arm.mean).padStart(5)} ${f1(s.fov.min)}–${f1(s.fov.max)}  ${yr.padStart(14)} ${jk.padStart(9)} ${"pops" in s ? String(s.pops).padStart(4) : ""} ${"flips" in s ? String(s.flips).padStart(5) : ""}`,
    );
  }
  const m = r.motion;
  if (!brief) console.log(`motion: yaw°/s p50 ${f1(m.yawRateDeg.p50)} p95 ${f1(m.yawRateDeg.p95)} max ${f1(m.yawRateDeg.max)} · pitch°/s p95 ${f1(m.pitchRateDeg.p95)} max ${f1(m.pitchRateDeg.max)} · acc°/s² p95 ${f1(m.accDeg.p95)} · jerk°/s³ p95 ${f1(m.jerkDeg.p95)} max ${f1(m.jerkDeg.max)} · fov°/s max ${f1(m.fovRate.max)} · arm u/s p95 ${f1(m.armRate.p95)} max ${f1(m.armRate.max)} · pops ${m.pops} · flips ${m.flips}`);
  const a = r.ahead;
  if (brief) console.log(`pin by phase: swing ${f1(r.phases.swing.stopPinPct)}% · air ${f1(r.phases.air.stopPinPct)}% · run ${f1(r.phases.run.stopPinPct)}% · stand ${f1(r.phases.stand.stopPinPct)}%`);
  console.log(`ahead: pin ${f1(a.stopPinPct)}% · stop seen ${f1(a.stopSeenPct)}% (<1500 ${f1(a.stopSeenByDist.under1500)}%, 1500–3000 ${f1(a.stopSeenByDist["1500to3000"])}%, >3000 ${f1(a.stopSeenByDist.over3000)}%) · arriving ${f1(a.arrivingStopSeenPct)}% · anchor ${f1(a.anchorSeenPct)}% · view vs travel ${f1(a.travelAngleDeg.mean)}° (p95 ${f1(a.travelAngleDeg.p95)}°) · view vs stop ${f1(a.stopBearingDeg.mean)}° (p95 ${f1(a.stopBearingDeg.p95)}°)`);
  console.log(`stand: ${r.stand.frames} frames · stop seen ${f1(r.stand.stopSeenPct)}% · view vs stop ${f1(r.stand.stopBearingDeg.mean)}° · errand: ally ${f1(r.errand.allySeenPct)}% · pair clear of sheet+HUD ${f1(r.errand.pairClearPct)}% · apart ${f1(r.errand.pairApartPct)}% · both ${f1(r.errand.pairShownPct)}%`);
}
