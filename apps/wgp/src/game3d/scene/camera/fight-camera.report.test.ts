/**
 * The fight camera, measured on real fights: how much it moves up and down, whether it ever
 * sits inside a building, how often both fighters are in frame, and the angle it sees them
 * from. The fights come from game-core's fight report (positions tick by tick):
 *
 *   FIGHT_REPORT=1 FIGHT_TRACKS=/tmp/tracks.json pnpm --filter @wgp/game-core exec vitest run test/fight-report.test.ts
 *   CAMERA_REPORT=/tmp/tracks.json pnpm --filter wgp exec vitest run src/game3d/scene/camera/fight-camera.report.test.ts
 */
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { generateCity } from "@wgp/game-core/sim3d";
import type { Zone } from "@wgp/game-core/sim3d/contract";
import type { Stop } from "@wgp/game-core/types";

import { CHASE_TUNING, ChaseCamera, createChaseInput } from "./chase";
import { citySolids, createCityRaycast, type CitySolids } from "./raycast";

interface Track {
  villain: string;
  policy: string;
  seed: number;
  stops: Stop[];
  zone: number;
  frames: number[][];
}

const DT = 1 / 60;

function inside(s: CitySolids, x: number, y: number, z: number): boolean {
  for (let i = 0; i < s.count; i++) if (x > s.minX[i] && x < s.maxX[i] && y > s.minY[i] && y < s.maxY[i] && z > s.minZ[i] && z < s.maxZ[i]) return true;
  return false;
}

/** Where a point lands in the view, in shares of the half frame (|x|, |y| ≤ 1 is on screen). */
function project(pos: { x: number; y: number; z: number }, look: { x: number; y: number; z: number }, fov: number, aspect: number, p: { x: number; y: number; z: number }) {
  let fx = look.x - pos.x;
  let fy = look.y - pos.y;
  let fz = look.z - pos.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,1,0); up' = right × forward
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const dx = p.x - pos.x;
  const dy = p.y - pos.y;
  const dz = p.z - pos.z;
  const depth = dx * fx + dy * fy + dz * fz;
  const tanV = Math.tan((fov * Math.PI) / 360);
  return { x: (dx * rx + dz * rz) / (depth * tanV * aspect), y: (dx * ux + dy * uy + dz * uz) / (depth * tanV), depth };
}

const pct = (xs: number[], p: number) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
};

function measure(tracks: Track[]) {
  const aspect = 16 / 9;
  let frames = 0;
  let camTravel = 0;
  let lookTravel = 0;
  let inWall = 0;
  let framed = 0;
  let framedSafe = 0;
  let heroOut = 0;
  let rivalOut = 0;
  let boxedOut = 0;
  const camVy: number[] = [];
  const angles: number[] = [];
  const pitches: number[] = [];
  const bob: number[] = [];
  const cities = new Map<string, ReturnType<typeof generateCity>>();
  for (const tr of tracks) {
    const key = `${tr.seed}:${JSON.stringify(tr.stops)}`;
    const city = cities.get(key) ?? generateCity(tr.seed, tr.stops);
    cities.set(key, city);
    const solids = citySolids(city, { props: false });
    const zone: Zone = city.zones[tr.zone];
    // CAMERA_TUNE='{"arenaYBand":50}' tries other numbers.
    const cam = new ChaseCamera(createCityRaycast(city), { ...CHASE_TUNING, ...JSON.parse(process.env.CAMERA_TUNE ?? "{}") });
    const input = createChaseInput();
    input.aspect = aspect;
    input.arena = zone.bounds;
    let prevY = NaN;
    let prevLook = NaN;
    const ys: number[] = [];
    for (const f of tr.frames) {
      input.hero = { x: f[0], y: f[1], z: f[2] };
      input.vel = { x: f[3], y: f[4], z: f[5] };
      input.rival = { x: f[6], y: f[7], z: f[8] };
      input.rivalVel = { x: f[9], y: f[10], z: f[11] };
      const pose = cam.update(input, DT);
      frames += 1;
      const y = pose.position.y;
      ys.push(y);
      if (Number.isFinite(prevY)) {
        camTravel += Math.abs(y - prevY);
        lookTravel += Math.abs(pose.target.y - prevLook);
        camVy.push(Math.abs(y - prevY) / DT);
      }
      prevY = y;
      prevLook = pose.target.y;
      if (inside(solids, pose.position.x, pose.position.y, pose.position.z)) inWall += 1;
      const a = project(pose.position, pose.target, pose.fov, aspect, input.hero);
      const b = project(pose.position, pose.target, pose.fov, aspect, input.rival);
      const on = (q: { x: number; y: number; depth: number }, k: number) => q.depth > 0 && Math.abs(q.x) <= k && Math.abs(q.y) <= k;
      if (on(a, 1) && on(b, 1)) framed += 1;
      if (!on(a, 1)) heroOut += 1;
      if (!on(b, 1)) rivalOut += 1;
      if ((!on(a, 1) || !on(b, 1)) && pose.arm < pose.want - 40) boxedOut += 1;
      if (on(a, 0.85) && on(b, 0.85)) framedSafe += 1;
      // The view's angle off the fighters' line (0 = straight down it, 90 = side on), and its pitch.
      const lx = f[6] - f[0];
      const lz = f[8] - f[2];
      const vx = pose.target.x - pose.position.x;
      const vz = pose.target.z - pose.position.z;
      const ll = Math.hypot(lx, lz);
      const vl = Math.hypot(vx, vz);
      if (ll > 60 && vl > 1) angles.push((Math.acos(Math.min(1, Math.abs((lx * vx + lz * vz) / (ll * vl)))) * 180) / Math.PI);
      pitches.push((Math.atan2(pose.position.y - pose.target.y, vl) * 180) / Math.PI);
    }
    // Bob: the camera height less its own 1-second moving average.
    for (let i = 30; i < ys.length - 30; i++) {
      let m = 0;
      for (let k = -30; k <= 30; k++) m += ys[i + k];
      bob.push(Math.abs(ys[i] - m / 61));
    }
  }
  const secs = frames * DT;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    fights: tracks.length,
    seconds: Math.round(secs),
    camYTravelPerSec: r1(camTravel / secs),
    lookYTravelPerSec: r1(lookTravel / secs),
    camVyP95: r1(pct(camVy, 0.95)),
    camBobMean: r1(bob.reduce((x, y) => x + y, 0) / Math.max(1, bob.length)),
    camBobP95: r1(pct(bob, 0.95)),
    inWallPct: r1((inWall / frames) * 100),
    bothFramedPct: r1((framed / frames) * 100),
    bothSafePct: r1((framedSafe / frames) * 100),
    heroOutPct: r1((heroOut / frames) * 100),
    rivalOutPct: r1((rivalOut / frames) * 100),
    /** Out of frame while a wall holds the arm short of the two-shot. */
    boxedOutPct: r1((boxedOut / frames) * 100),
    angleOffLineMedian: r1(pct(angles, 0.5)),
    angleOffLineP10: r1(pct(angles, 0.1)),
    pitchMedian: r1(pct(pitches, 0.5)),
  };
}

describe.runIf(!!process.env.CAMERA_REPORT)("fight camera report", () => {
  it("prints", () => {
    const tracks: Track[] = JSON.parse(readFileSync(process.env.CAMERA_REPORT!, "utf8"));
    const rows: [string, ReturnType<typeof measure>][] = [["all", measure(tracks)]];
    for (const p of [...new Set(tracks.map((t) => t.policy))]) rows.push([p, measure(tracks.filter((t) => t.policy === p))]);
    for (const v of [...new Set(tracks.map((t) => t.villain))].sort()) rows.push([v, measure(tracks.filter((t) => t.villain === v))]);
    const keys = Object.keys(rows[0][1]) as (keyof ReturnType<typeof measure>)[];
    const w = 14;
    console.log(["".padEnd(w), ...keys.map((k) => k.padStart(Math.max(8, k.length)))].join(" "));
    for (const [name, m] of rows) console.log([name.padEnd(w), ...keys.map((k) => String(m[k]).padStart(Math.max(8, k.length)))].join(" "));
  }, 300_000);
});
