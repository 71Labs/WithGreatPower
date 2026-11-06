/**
 * Free roam's street traffic and solid furniture (roam-2): the cars are the sim's (the scene
 * draws what's here), they keep to their lanes and their lights and never meet each other; a
 * driver stops for the hero standing in the road and can't for one who darts out, and then he's
 * knocked flying, down and up again, never hurt and never trapped; a car is solid moving or
 * stopped (he slides along it, vaults it, rides it); and everything the City draws in his way
 * is solid as drawn (lamps, signals, roof doors, units, vents, tanks and their legs, masts,
 * billboards, cranes, the bridge's rails): walked and run into, he's never inside one.
 */
import { describe, expect, it } from "vitest";

import { replayRoam, roamLog, startRoamRun, stepRoamRun, type RoamRun, type RoamRunEvent } from "../src/roam-run";
import { groundBelow } from "../src/sim3d/city";
import { HERO_RADIUS } from "../src/sim3d/constants";
import type { InputFrame } from "../src/sim3d/contract";
import { dirIndex } from "../src/sim3d/dmath";
import { CAR_LEN, CAR_TALL, CAR_WIDE, KNOCK_DOWN, KNOCK_GETUP, ROAM_LOG_RULESET } from "../src/sim3d/roam/constants";
import { furnitureSolids, propSolids, type SolidBox } from "../src/sim3d/roam/furniture";
import { roamHashState } from "../src/sim3d/roam/hash";
import { freshStart } from "../src/sim3d/roam/step";
import { placeCar } from "../src/sim3d/roam/traffic";
import type { RoamCar } from "../src/sim3d/roam/types";
import { roamCity, roamCityFurniture, roamWorld } from "../src/sim3d/roam/world";
import { at } from "./roam-helpers";

const R = HERO_RADIUS;
const IDLE: InputFrame = { dir: 0, mag: 0, web: false, shot: 0 };
const toward = (run: RoamRun, x: number, z: number, mag: 1 | 2 | 3 = 3, shot: InputFrame["shot"] = 0): InputFrame => ({ dir: dirIndex(x - run.sim.hero.x, z - run.sim.hero.z), mag, web: false, shot });

/** How far the hero's body is inside a box (0 when it isn't). */
function depth(run: RoamRun, b: SolidBox): number {
  const h = run.sim.hero;
  const qx = Math.max(b.x0, Math.min(b.x1, h.x));
  const qy = Math.max(b.y0, Math.min(b.y1, h.y));
  const qz = Math.max(b.z0, Math.min(b.z1, h.z));
  const d = Math.hypot(h.x - qx, h.y - qy, h.z - qz);
  return Math.max(0, R - d);
}

/**
 * The deepest the hero is inside any car this tick. Over (or up onto) one in a vault his body
 * arcs within 10 of its top, as a vault's clearance has it (hands on the roof): that's not inside.
 */
function inCar(run: RoamRun): number {
  const t = run.sim.roam!.traffic;
  let worst = 0;
  for (const c of t.cars) worst = Math.max(worst, depth(run, run.sim.grid.boxes[c.box]));
  return Math.max(0, worst - (run.sim.roam!.body.move === "vault" ? 10 : 0));
}

/** Whether two cars' drawn rectangles (turned by their headings) overlap (separating axes). */
function carsMeet(a: RoamCar, b: RoamCar): boolean {
  const corners = (c: RoamCar) => {
    const fx = c.hx * (CAR_LEN / 2 - 0.5);
    const fz = c.hz * (CAR_LEN / 2 - 0.5);
    const sx = -c.hz * (CAR_WIDE / 2 - 0.5);
    const sz = c.hx * (CAR_WIDE / 2 - 0.5);
    return [
      [c.x + fx + sx, c.z + fz + sz],
      [c.x + fx - sx, c.z + fz - sz],
      [c.x - fx - sx, c.z - fz - sz],
      [c.x - fx + sx, c.z - fz + sz],
    ];
  };
  const A = corners(a);
  const B = corners(b);
  for (const [ax, az] of [
    [a.hx, a.hz],
    [-a.hz, a.hx],
    [b.hx, b.hz],
    [-b.hz, b.hx],
  ]) {
    const pa = A.map(([x, z]) => x * ax + z * az);
    const pb = B.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

/** A car moving at a good clip down a long straight stretch with no crossing for `room` ahead of it. */
function cruising(run: RoamRun, room: number): { car: RoamCar; index: number } {
  const t = run.sim.roam!.traffic;
  for (let i = 0; i < t.cars.length; i++) {
    const c = t.cars[i];
    const loop = t.loops[c.loop];
    if (loop.line < 0 || c.v < 200 || c.hold > 0) continue;
    const L = loop.hi - loop.lo;
    if (c.s > L - room - 100) continue;
    // Along x or z on the +r lane, heading +: no crossing within `room` ahead of its front.
    const along = loop.lo + c.s;
    let clear = true;
    for (let k = 1; k < 9; k++) {
      const cc = k * 780 - 90;
      if (cc + 140 > along && cc - 140 < along + room) clear = false;
    }
    if (clear) return { car: c, index: i };
  }
  throw new Error("no car cruising");
}

/** A run warmed up with the hero parked on the spawn roof, the traffic flowing. */
function flowing(ticks = 360): RoamRun {
  const run = startRoamRun(freshStart());
  for (let i = 0; i < ticks; i++) stepRoamRun(run, IDLE);
  return run;
}

/** Put the hero on his feet at (x, z) on the street. */
function stand(run: RoamRun, x: number, z: number, fx: number, fz: number) {
  const h = run.sim.hero;
  h.x = x;
  h.y = R;
  h.z = z;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  h.fx = fx;
  h.fz = fz;
}

describe("free roam's traffic", () => {
  it("drives every street but the edge ones and the river's, both ways, and the bridge deck", () => {
    const run = startRoamRun(freshStart());
    const t = run.sim.roam!.traffic;
    expect(t.loops.length).toBeGreaterThan(18);
    expect(t.loops.some((l) => l.line < 0 && l.y > 100)).toBe(true);
    expect(t.cars.length).toBeGreaterThan(150);
    // Every car on its lane, at street or deck level, sized as drawn.
    for (const c of t.cars) {
      const b = run.sim.grid.boxes[c.box];
      expect(b.y1 - b.y0).toBe(CAR_TALL);
      expect(Math.max(b.x1 - b.x0, b.z1 - b.z0)).toBeCloseTo(CAR_LEN, 3);
      expect(Math.min(b.x1 - b.x0, b.z1 - b.z0)).toBeCloseTo(CAR_WIDE, 3);
    }
  });

  it("is deterministic: the same frames give the same cars, tick for tick, and replay to the same hash", () => {
    const frames: InputFrame[] = [];
    for (let i = 0; i < 900; i++) frames.push(i % 200 < 120 ? { dir: (i >> 4) % 64, mag: 3, web: false, shot: i % 50 === 0 ? 1 : 4 } : IDLE);
    const a = startRoamRun(freshStart());
    const b = startRoamRun(freshStart());
    for (const f of frames) {
      stepRoamRun(a, f);
      stepRoamRun(b, f);
    }
    const ca = a.sim.roam!.traffic.cars;
    const cb = b.sim.roam!.traffic.cars;
    expect(cb.map((c) => [c.s, c.v, c.hold])).toEqual(ca.map((c) => [c.s, c.v, c.hold]));
    expect(roamHashState(b.sim)).toBe(roamHashState(a.sim));
    const log = roamLog(a);
    expect(replayRoam({ start: freshStart(), log }).hash).toBe(roamHashState(a.sim));
    // A car's place is its loop's at its distance round it (the scene's frame is that).
    const t = a.sim.roam!.traffic;
    const p = { x: 0, z: 0, hx: 0, hz: 0, ex: 0, ez: 0 };
    for (const c of t.cars.slice(0, 40)) {
      placeCar(t.loops[c.loop], c.s, p);
      expect(p.x).toBeCloseTo(c.x, 6);
      expect(p.z).toBeCloseTo(c.z, 6);
    }
    expect(ROAM_LOG_RULESET).toBe(0x0f001204);
  });

  it("never puts two cars in one place: lanes, gaps and lights over three minutes", () => {
    const run = startRoamRun(freshStart());
    const t = run.sim.roam!.traffic;
    let overlaps = 0;
    let stoppedAtLights = 0;
    for (let i = 0; i < 60 * 180; i++) {
      stepRoamRun(run, IDLE);
      if (i % 20) continue;
      for (let a = 0; a < t.cars.length; a++) {
        const A = t.cars[a];
        if (A.v < 1) stoppedAtLights++;
        for (let b = a + 1; b < t.cars.length; b++) {
          const B = t.cars[b];
          if (t.loops[A.loop].y !== t.loops[B.loop].y) continue;
          if (Math.abs(A.x - B.x) < A.ex + B.ex && Math.abs(A.z - B.z) < A.ez + B.ez && carsMeet(A, B)) overlaps++;
        }
      }
    }
    expect(overlaps).toBe(0);
    // The lights hold some of them some of the time, and the rest drive on.
    expect(stoppedAtLights).toBeGreaterThan(0);
    expect(t.cars.some((c) => c.v > 200)).toBe(true);
  });

  it("stops for the hero standing in the road: no hit, and the stopped car is solid", () => {
    const run = flowing();
    const { car } = cruising(run, 400);
    // 260 ahead of its front, in its lane, still.
    const x = car.x + car.hx * (CAR_LEN / 2 + 260 + R);
    const z = car.z + car.hz * (CAR_LEN / 2 + 260 + R);
    stand(run, x, z, -car.hx, -car.hz);
    const events: RoamRunEvent[] = [];
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      events.push(...stepRoamRun(run, IDLE));
      worst = Math.max(worst, inCar(run));
    }
    expect(events.some((e) => e.type === "roam-car-hit")).toBe(false);
    expect(car.v).toBeLessThan(1);
    const gap = (run.sim.hero.x - car.x) * car.hx + (run.sim.hero.z - car.z) * car.hz - CAR_LEN / 2 - R;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(80);
    expect(worst).toBe(0);
    // Walking into it: he's stopped at its bumper, never inside it.
    for (let i = 0; i < 60; i++) {
      stepRoamRun(run, toward(run, car.x, car.z, 1));
      worst = Math.max(worst, inCar(run));
    }
    expect(worst).toBeLessThan(0.5);
    expect(run.sim.roam!.body.move).not.toBe("knocked");
  });

  it("can't stop for one who darts out: he's knocked flying along its way, down, and up again, unhurt; the car stands", () => {
    const run = flowing();
    const { car, index } = cruising(run, 400);
    const v0 = car.v;
    // Beside its lane 120 ahead of its front, running across into it.
    const side = CAR_WIDE / 2 + R + 30;
    const ax = car.x + car.hx * (CAR_LEN / 2 + 120) - car.hz * side;
    const az = car.z + car.hz * (CAR_LEN / 2 + 120) + car.hx * side;
    stand(run, ax, az, car.hz, -car.hx);
    const tx = ax + car.hz * 600;
    const tz = az - car.hx * 600;
    const events: { tick: number; e: RoamRunEvent }[] = [];
    let worst = 0;
    let top = 0;
    let stood = 0;
    const startY = run.sim.hero.y;
    const moves: string[] = [];
    for (let i = 0; i < 300; i++) {
      const f = run.sim.roam!.body.move === "ground" && !events.some(({ e }) => e.type === "roam-car-hit") ? toward(run, tx, tz, 3) : IDLE;
      for (const e of stepRoamRun(run, f)) events.push({ tick: run.sim.tick, e });
      worst = Math.max(worst, inCar(run));
      top = Math.max(top, run.sim.hero.y - startY);
      if (car.v < 1) stood++;
      const m = run.sim.roam!.body.move;
      if (moves[moves.length - 1] !== m) moves.push(m);
    }
    const hitAt = events.find(({ e }) => e.type === "roam-car-hit");
    expect(hitAt, moves.join(">")).toBeTruthy();
    const hit = hitAt!.e as Extract<RoamRunEvent, { type: "roam-car-hit" }>;
    expect(hit.car).toBe(index);
    expect(hit.speed).toBeGreaterThan(v0 * 0.8);
    expect(moves.join(">")).toMatch(/ground>knocked>ground/);
    // Flung up, and along the car's way (well past where he was hit).
    expect(top).toBeGreaterThan(30);
    const along = (run.sim.hero.x - hit.x) * car.hx + (run.sim.hero.z - hit.z) * car.hz;
    expect(along).toBeGreaterThan(120);
    // Down and up within a couple of seconds, never inside the car, never hurt.
    const upAt = events.find(({ tick, e }) => tick > hitAt!.tick && e.type === "roam-move" && e.move === "ground")!;
    expect((upAt.tick - hitAt!.tick) / 60).toBeLessThan(KNOCK_DOWN + KNOCK_GETUP + 1.5);
    expect(worst).toBeLessThan(0.5);
    expect(run.sim.hp).toBe(run.sim.maxHp);
    // The car braked and stood a while.
    expect(events.some(({ e }) => e.type === "land")).toBe(true);
    expect(stood).toBeGreaterThan(30);
  });

  it("vaults a stopped car at a run, and rides one he's standing on", () => {
    const run = flowing();
    const { car } = cruising(run, 400);
    // Hold it (as after a hit), and run at it from the side.
    car.hold = 600;
    for (let i = 0; i < 40; i++) stepRoamRun(run, IDLE);
    expect(car.v).toBe(0);
    const side = CAR_WIDE / 2 + R + 160;
    stand(run, car.x - car.hz * side, car.z + car.hx * side, car.hz, -car.hx);
    const moves: string[] = [];
    let worst = 0;
    for (let i = 0; i < 80; i++) {
      stepRoamRun(run, toward(run, car.x - car.hz * -400, car.z + car.hx * -400, 3));
      worst = Math.max(worst, inCar(run));
      const m = run.sim.roam!.body.move;
      if (moves[moves.length - 1] !== m) moves.push(m);
    }
    expect(moves.join(">")).toMatch(/ground>vault>/);
    expect(worst).toBeLessThan(0.5);
    // On its roof as it pulls away: carried with it.
    stand(run, car.x, car.z, car.hx, car.hz);
    run.sim.hero.y = CAR_TALL + R;
    car.hold = 0;
    const x0 = car.x;
    const z0 = car.z;
    for (let i = 0; i < 60; i++) stepRoamRun(run, IDLE);
    const moved = Math.hypot(car.x - x0, car.z - z0);
    expect(moved).toBeGreaterThan(20);
    expect(Math.hypot(run.sim.hero.x - car.x, run.sim.hero.z - car.z)).toBeLessThan(CAR_LEN / 2);
    expect(run.sim.hero.y - R).toBeCloseTo(CAR_TALL, 0);
  });

  it("flung off the bridge or into the river, he splashes and climbs out on a bank", () => {
    const run = flowing();
    const river = run.sim.city.river!;
    const t = run.sim.roam!.traffic;
    // A car heading at the river's bank (a street that crosses it), its half turn short of it.
    const c = t.cars.find((q) => t.loops[q.loop].line >= 0 && q.v > 150 && (river.z1 - river.z0 > river.x1 - river.x0 ? t.loops[q.loop].axis === 0 : t.loops[q.loop].axis === 1))!;
    expect(c).toBeTruthy();
    // Knocked at the bank toward the water: the knock carries him in.
    const h = run.sim.hero;
    const alongZ = river.z1 - river.z0 > river.x1 - river.x0;
    stand(run, alongZ ? river.x0 - 30 : (river.x0 + river.x1) / 2 + 300, alongZ ? (river.z0 + river.z1) / 2 + 300 : river.z0 - 30, 1, 0);
    run.sim.roam!.body.move = "knocked";
    run.sim.roam!.body.moveT = 0;
    t.knock.down = -1;
    h.vx = alongZ ? 420 : 0;
    h.vz = alongZ ? 0 : 420;
    h.vy = 300;
    const moves: string[] = [];
    for (let i = 0; i < 300; i++) {
      stepRoamRun(run, IDLE);
      const m = run.sim.roam!.body.move;
      if (moves[moves.length - 1] !== m) moves.push(m);
    }
    expect(moves.join(">")).toMatch(/knocked>splash>ground/);
  });
});

describe("free roam's furniture is solid as drawn", () => {
  const city = roamCity();
  const f = roamCityFurniture();
  const world = roamWorld();

  it("has something of every kind the City draws in his way", () => {
    const looks = new Set(f.parts.map((p) => p.look));
    for (const l of ["lamp-post", "signal-post", "signal-head", "door", "rail"]) expect(looks.has(l as never), l).toBe(true);
    const kinds = new Set(f.props.map((d) => d.prop.kind));
    for (const k of ["ac", "vent", "water-tower", "antenna", "billboard", "crane"]) expect(kinds.has(k as never), k).toBe(true);
    // Every AC unit the sim has is one the City draws (no invisible walls), and every one it draws is solid.
    expect(furnitureSolids(f).length).toBeGreaterThan(f.parts.length);
  });

  it("puts nothing on a page, a pixel, a person, a perch, a bank or the spawn", () => {
    const solids = furnitureSolids(f);
    const spots = [...world.pages, ...world.pixels, ...world.folks, ...world.banks.map((b) => ({ x: b.x0, y: 0, z: b.z0 })), world.spawn];
    for (const p of spots) {
      for (const b of solids) {
        const inside = p.x > b.x0 - 12 && p.x < b.x1 + 12 && p.z > b.z0 - 12 && p.z < b.z1 + 12 && p.y >= b.y0 - 1 && p.y < b.y1;
        expect(inside, `${JSON.stringify(p)} in ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  /** Walk, then run, at a box from 140 out on each side, and measure how deep he ever got into it. */
  function charge(b: SolidBox, feet: number): { worst: number; ticks: number } {
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    let worst = 0;
    let ticks = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      for (const mag of [1, 3] as const) {
        const ex = dx > 0 ? b.x1 : dx < 0 ? b.x0 : cx;
        const ez = dz > 0 ? b.z1 : dz < 0 ? b.z0 : cz;
        const run = startRoamRun(at(ex + dx * (R + 120), feet, ez + dz * (R + 120), -dx, -dz));
        // Empty streets: this is about the furniture.
        for (const c of run.sim.roam!.traffic.cars) run.sim.grid.moveSolid(c.box, -1e6, -1e6, -1e6, -1e6 + 1, -1e6 + 1, -1e6 + 1);
        run.sim.roam!.traffic.cars.length = 0;
        // Only from somewhere he stands on the same floor as it (not off its roof's edge).
        if (Math.hypot(run.sim.hero.x - (ex + dx * (R + 120)), run.sim.hero.z - (ez + dz * (R + 120))) > 1) continue;
        if (groundBelow(run.sim.grid, run.sim.hero.x, run.sim.hero.z, feet + 2) < feet - 2) continue;
        for (let i = 0; i < 90; i++) {
          stepRoamRun(run, toward(run, cx, cz, mag));
          // Over it in a vault (or up it in a mantle) the body arcs within 10 of its top, as the
          // move's clearance has it (hands on the top, legs swung over); anything else is 0.
          const m = run.sim.roam!.body.move;
          const d = depth(run, b) - (m === "vault" || m === "mantle" ? 10 : 0);
          if (d > 0.5) ticks++;
          worst = Math.max(worst, d);
        }
      }
    }
    return { worst, ticks };
  }

  it("blocks him at every kind: walked and run into, he's never inside a lamp, a signal, a door, a unit, a vent, a tank, a mast, a billboard, a crane or a rail", () => {
    const pick = <T>(list: T[], ok: (t: T) => boolean) => list.find(ok);
    const parts = (look: string) => f.parts.filter((p) => p.look === look);
    const cases: { name: string; box: SolidBox; feet: number }[] = [];
    for (const look of ["lamp-post", "signal-post", "door", "rail"]) {
      const p = pick(parts(look), (q) => q.y0 < 1 || look === "door" || look === "rail");
      if (p) cases.push({ name: look, box: p, feet: p.y0 });
    }
    for (const kind of ["ac", "vent", "water-tower", "antenna", "billboard", "crane"] as const) {
      const d = pick(f.props, (q) => q.prop.kind === kind && (q.prop.buildingId === null || city.buildings.some((b) => b.id === q.prop.buildingId && (b.x1 - b.x0) > 240)));
      if (!d) continue;
      const boxes = propSolids(d);
      // The lowest box: where he'd walk into it.
      const box = boxes.reduce((a, b) => (b.y0 < a.y0 ? b : a));
      cases.push({ name: kind, box, feet: d.y });
    }
    expect(cases.length).toBeGreaterThanOrEqual(9);
    for (const c of cases) {
      const r = charge(c.box, c.feet);
      expect(r.ticks, `${c.name}: ticks inside`).toBe(0);
      expect(r.worst, `${c.name}: deepest`).toBeLessThan(0.5);
    }
  });
});
