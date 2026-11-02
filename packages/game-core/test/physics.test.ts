/**
 * Ruleset 2's physics: the rope conserves energy (only the pump adds any), jumps are true
 * parabolas, steering keeps to its limits, and webs go where the heading says, onto solid
 * geometry.
 */
import { describe, expect, it } from "vitest";

import { chooseErrand, needsErrand, startRun, stepRun } from "../src/replay";
import { reduce } from "../src/rules/engine";
import type { Stop } from "../src/rules/types";
import { CityIndex, generateCity } from "../src/sim3d/city";
import {
  ANCHOR_CONE,
  ARM_ACCEL,
  ARM_EXTEND_ACCEL,
  ARM_EXTEND_SPEED,
  ARM_SLAM_ACCEL,
  ARM_SLAM_SPEED,
  DT,
  GRAVITY,
  HERO_RADIUS,
  SANDWICH_GRAVITY,
  SYBIL_BODY_ACCEL,
  SYBIL_BODY_SPEED,
} from "../src/sim3d/constants";
import { DIR64 } from "../src/sim3d/dmath";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { heroHeading } from "../src/sim3d/hero";
import { createSim } from "../src/sim3d/sim";
import { bodyEnergy, flightStep, pickAnchor, type Body, type FlightInput } from "../src/sim3d/swing";
import type { Rope, SimState } from "../src/sim3d/types";
import { ballisticStep, drive, jumpVelocity, leapVelocity, steer } from "../src/sim3d/villains";
import { heroSave, STANDARD } from "./helpers";

const QUIET: FlightInput = { hx: 1, hz: 0, bias: false, sx: 0, sz: 0, pump: false };

/** A small deterministic generator for property tests. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("the rope", () => {
  it("conserves energy on an unpumped, drag-free swing, in a plane and as a spherical pendulum, and never stretches", () => {
    for (const side of [0, 180]) {
      const rope: Rope = { x: 0, y: 1000, z: 0, len: 300 };
      // Level with the anchor, at rest (a plane swing), or with a sideways push (a conical one).
      const b: Body = { x: -300, y: 1000, z: 0, vx: 0, vy: 0, vz: side };
      const e0 = bodyEnergy(b);
      const scale = GRAVITY * rope.len;
      let lowest = Infinity;
      for (let i = 0; i < 60 * 12; i++) {
        flightStep(b, rope, DT, QUIET, 0);
        expect(Math.hypot(b.x - rope.x, b.y - rope.y, b.z - rope.z)).toBeLessThanOrEqual(rope.len + 1e-9);
        expect(Math.abs(bodyEnergy(b) - e0) / scale).toBeLessThan(1e-3);
        lowest = Math.min(lowest, b.y);
      }
      // It really swings: through the bottom (or near it, conically), many times.
      expect(lowest).toBeLessThan(rope.y - rope.len * (side ? 0.6 : 0.99));
    }
  });

  it("only loses energy to drag, and only gains it from the pump", () => {
    const rope: Rope = { x: 0, y: 1000, z: 0, len: 280 };
    const b: Body = { x: -200, y: 1000 - 196, z: 0, vx: 0, vy: 0, vz: 0 };
    let e = bodyEnergy(b);
    for (let i = 0; i < 60 * 8; i++) {
      flightStep(b, rope, DT, QUIET);
      const next = bodyEnergy(b);
      expect(next).toBeLessThanOrEqual(e + 1e-6);
      e = next;
    }
    const pumped: Body = { x: -200, y: 1000 - 196, z: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < 60 * 8; i++) flightStep(pumped, rope, DT, { ...QUIET, pump: true });
    expect(bodyEnergy(pumped)).toBeGreaterThan(e);
  });

  it("lets a falling body fall freely while slack, then jerks taut without gaining energy", () => {
    const rope: Rope = { x: 0, y: 1000, z: 0, len: 300 };
    const b: Body = { x: 100, y: 1000, z: 0, vx: 0, vy: 0, vz: 0 };
    // Slack: exactly a free fall (drag off).
    for (let i = 1; i <= 10; i++) {
      flightStep(b, rope, DT, QUIET, 0);
      expect(b.y).toBeCloseTo(1000 - 0.5 * GRAVITY * (i * DT) * (i * DT), 9);
    }
    let e = bodyEnergy(b);
    for (let i = 0; i < 60; i++) {
      flightStep(b, rope, DT, QUIET, 0);
      expect(bodyEnergy(b)).toBeLessThanOrEqual(e + 1e-6);
      e = bodyEnergy(b);
    }
  });
});

describe("ballistic jumps", () => {
  it("follow the analytic parabola exactly and land on the target", () => {
    const rnd = lcg(7);
    for (let k = 0; k < 50; k++) {
      const x0 = rnd() * 400;
      const y0 = 200 + rnd() * 100;
      const z0 = rnd() * 400;
      const x1 = x0 + (rnd() - 0.5) * 600;
      const y1 = 150 + rnd() * 200;
      const z1 = z0 + (rnd() - 0.5) * 600;
      const apex = Math.max(y0, y1) + 40 + rnd() * 120;
      const j = jumpVelocity(x0, y0, z0, x1, y1, z1, apex, SANDWICH_GRAVITY);
      const m = { x: x0, y: y0, z: z0, vx: j.vx, vy: j.vy, vz: j.vz };
      const n = Math.floor(j.t / DT);
      let peak = -Infinity;
      for (let i = 1; i <= n; i++) {
        ballisticStep(m, SANDWICH_GRAVITY, DT);
        const t = i * DT;
        expect(m.x).toBeCloseTo(x0 + j.vx * t, 6);
        expect(m.y).toBeCloseTo(y0 + j.vy * t - 0.5 * SANDWICH_GRAVITY * t * t, 6);
        expect(m.z).toBeCloseTo(z0 + j.vz * t, 6);
        peak = Math.max(peak, m.y);
      }
      // The last partial step lands it on the target, and the peak is the planned apex.
      ballisticStep(m, SANDWICH_GRAVITY, j.t - n * DT);
      expect(m.x).toBeCloseTo(x1, 6);
      expect(m.y).toBeCloseTo(y1, 6);
      expect(m.z).toBeCloseTo(z1, 6);
      expect(peak).toBeLessThanOrEqual(apex + 1e-6);
      expect(peak).toBeGreaterThan(apex - (j.vy * DT + 1));
      // An aimed leap meets its point at its time.
      const l = leapVelocity(x0, y0, z0, x1, y1, z1, 0.4, SANDWICH_GRAVITY);
      const p = { x: x0, y: y0, z: z0, vx: l.vx, vy: l.vy, vz: l.vz };
      ballisticStep(p, SANDWICH_GRAVITY, 0.4);
      expect(p.y).toBeCloseTo(y1, 6);
    }
  });

  it("are what Sandwich Man flies in a real fight: constant ground speed, gravity alone on the way up and down", () => {
    const stops: Stop[] = [
      { kind: "fight", villain: "sandwich-man", district: "mempool-market", level: 3, boss: true, quest: false },
      { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
    ];
    const started = reduce(heroSave(STANDARD, "Parabola", 3), { type: "start-patrol", seed: 31 });
    const run = startRun({ ...started, patrol: { ...started.patrol!, stops } }, 31, { trustPatrol: true });
    const mem = newBotMemory();
    let airborne = 0;
    let exact = 0;
    let prev: { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean } | null = null;
    while (!run.over && !run.error && run.sim.tick < 20_000) {
      if (needsErrand(run)) {
        chooseErrand(run, 0);
        continue;
      }
      const events = stepRun(run, botFrame(run.sim, mem));
      const v = run.sim.villain;
      if (!v || run.sim.mode !== "fight") {
        prev = null;
        continue;
      }
      const touched = events.some((e) => e.type === "villain-hit" || e.type === "clang" || e.type === "ability" || e.type === "gwei");
      if (prev && !prev.grounded && !v.grounded && v.stun <= 0 && run.sim.slowmo <= 0 && !touched) {
        airborne += 1;
        const g = SANDWICH_GRAVITY;
        const ok =
          Math.abs(v.vy - (prev.vy - g * DT)) < 1e-9 &&
          Math.abs(v.y - (prev.y + prev.vy * DT - 0.5 * g * DT * DT)) < 1e-9 &&
          Math.abs(v.vx - prev.vx) < 1e-9 &&
          Math.abs(v.vz - prev.vz) < 1e-9;
        if (ok) exact += 1;
      }
      prev = { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, grounded: v.grounded };
    }
    expect(airborne).toBeGreaterThan(60);
    // Every airborne tick is pure gravity, except the few where he slides off a wall or the arena edge.
    expect(exact / airborne).toBeGreaterThan(0.9);
  });
});

describe("steering", () => {
  it("never changes velocity faster than its acceleration, nor goes faster than its speed limit", () => {
    const rnd = lcg(99);
    for (let k = 0; k < 2000; k++) {
      const max = 300 + rnd() * 900;
      const accel = 200 + rnd() * 2000;
      const dir = () => (rnd() - 0.5) * 2;
      const m = { x: 0, y: 0, z: 0, vx: dir() * max * 0.57, vy: dir() * max * 0.57, vz: dir() * max * 0.57 };
      let w = { x: dir(), y: dir(), z: dir() };
      const wl = Math.hypot(w.x, w.y, w.z) || 1;
      w = { x: (w.x / wl) * max * rnd(), y: (w.y / wl) * max * rnd(), z: (w.z / wl) * max * rnd() };
      const before = { ...m };
      steer(m, w.x, w.y, w.z, accel, DT);
      const dv = Math.hypot(m.vx - before.vx, m.vy - before.vy, m.vz - before.vz);
      expect(dv).toBeLessThanOrEqual(accel * DT * (1 + 1e-9));
      expect(Math.hypot(m.vx, m.vy, m.vz)).toBeLessThanOrEqual(max * (1 + 1e-9));
    }
    // A joint drive (Doc's arms) keeps to its rate and acceleration too, and settles on its target.
    let pos = 0;
    let vel = 0;
    for (let i = 0; i < 600; i++) {
      const [p, v] = drive(pos, vel, 2, 3, 12, DT);
      expect(Math.abs(v - vel)).toBeLessThanOrEqual(12 * DT + 1e-12);
      expect(Math.abs(v)).toBeLessThanOrEqual(3 + 1e-12);
      pos = p;
      vel = v;
    }
    expect(pos).toBeCloseTo(2, 2);
  });

  it("holds in real fights: Sybil's bodies and Doc's arms stay inside their limits", () => {
    for (const villain of ["sybil", "doc-octochain"] as const) {
      const stops: Stop[] = [
        { kind: "fight", villain, district: villain === "sybil" ? "validator-heights" : "bridge-district", level: 4, boss: true, quest: false },
        { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
      ];
      const started = reduce(heroSave(STANDARD, "Limits", 4), { type: "start-patrol", seed: 13 });
      const run = startRun({ ...started, patrol: { ...started.patrol!, stops } }, 13, { trustPatrol: true });
      const mem = newBotMemory();
      let checked = 0;
      let prev: { bodies: { vx: number; vy: number; vz: number; alive: boolean }[]; arms: { w: number; lv: number }[] } | null = null;
      while (!run.over && !run.error && run.sim.tick < 20_000) {
        if (needsErrand(run)) {
          chooseErrand(run, 0);
          continue;
        }
        const events = stepRun(run, botFrame(run.sim, mem));
        const v = run.sim.villain;
        if (!v || run.sim.mode !== "fight") {
          prev = null;
          continue;
        }
        const knocked = events.some((e) => e.type === "villain-hit" || e.type === "clang" || e.type === "ability" || e.type === "gwei");
        if (prev && !knocked) {
          v.bodies.forEach((b, i) => {
            const p = prev!.bodies[i];
            if (!b.alive || !p.alive) return;
            expect(Math.hypot(b.vx - p.vx, b.vy - p.vy, b.vz - p.vz)).toBeLessThanOrEqual(SYBIL_BODY_ACCEL * DT * (1 + 1e-9));
            expect(Math.hypot(b.vx, b.vy, b.vz)).toBeLessThanOrEqual(SYBIL_BODY_SPEED * (1 + 1e-9));
            checked += 1;
          });
          v.arms.forEach((a, i) => {
            const p = prev!.arms[i];
            expect(Math.abs(a.w - p.w)).toBeLessThanOrEqual(Math.max(ARM_ACCEL, ARM_SLAM_ACCEL) * DT + 1e-9);
            expect(Math.abs(a.w)).toBeLessThanOrEqual(Math.max(ARM_SLAM_SPEED, 3.2) + 1e-9);
            expect(Math.abs(a.lv - p.lv)).toBeLessThanOrEqual(ARM_EXTEND_ACCEL * DT + 1e-9);
            expect(Math.abs(a.lv)).toBeLessThanOrEqual(ARM_EXTEND_SPEED + 1e-9);
            checked += 1;
          });
        }
        prev = { bodies: v.bodies.map((b) => ({ vx: b.vx, vy: b.vy, vz: b.vz, alive: b.alive })), arms: v.arms.map((a) => ({ w: a.w, lv: a.lv })) };
      }
      expect(run.error).toBeNull();
      expect(checked, villain).toBeGreaterThan(500);
    }
  });
});

describe("web anchors", () => {
  /** Whether (x, y, z) lies on a box's surface: on a side face, between its bottom and top. */
  const onSurface = (grid: CityIndex, x: number, y: number, z: number) =>
    grid.boxes.some((b) => {
      const e = 1e-6;
      const inX = x >= b.x0 - e && x <= b.x1 + e;
      const inZ = z >= b.z0 - e && z <= b.z1 + e;
      const onX = Math.abs(x - b.x0) < e || Math.abs(x - b.x1) < e;
      const onZ = Math.abs(z - b.z0) < e || Math.abs(z - b.z1) < e;
      return inX && inZ && (onX || onZ) && y >= b.y0 - e && y <= b.y1 + e;
    });

  it("lie ahead, within 45° of the heading, never behind, and on solid geometry or a prop", () => {
    const boot = reduce(heroSave(STANDARD, "Anchors", 3), { type: "start-patrol", seed: 4242 });
    const p = boot.patrol!;
    const s: SimState = createSim({
      seed: p.seed,
      stops: p.stops,
      index: 0,
      entry: "travel",
      hp: 100,
      maxHp: 100,
      fluid: 100,
      combo: 0,
      gweiCalls: 0,
      heroLevel: 1,
      loadout: [],
    });
    const props = new Set(s.city.anchors.map((a) => `${a.at.x},${a.at.y},${a.at.z}`));
    const rnd = lcg(5);
    let picks = 0;
    for (let k = 0; k < 400; k++) {
      const h = s.hero;
      h.x = 300 + rnd() * 6200;
      h.z = 300 + rnd() * 6200;
      h.y = 120 + rnd() * 500;
      h.vx = (rnd() - 0.5) * 800;
      h.vy = (rnd() - 0.5) * 600;
      h.vz = (rnd() - 0.5) * 800;
      h.grounded = false;
      h.rope = null;
      const d = DIR64[Math.floor(rnd() * 64)];
      const a = pickAnchor(s, d[0], d[1]);
      if (!a) continue;
      picks += 1;
      const dx = a.x - h.x;
      const dz = a.z - h.z;
      const along = dx * d[0] + dz * d[1];
      const lat = -dx * d[1] + dz * d[0];
      expect(along).toBeGreaterThan(0);
      expect(Math.abs(lat)).toBeLessThanOrEqual(along * ANCHOR_CONE + 1e-6);
      expect(a.y - h.y).toBeGreaterThan(0);
      if (a.kind === "edge" || a.kind === "wall") expect(onSurface(s.grid, a.x, a.y, a.z), `${a.kind} at ${a.x},${a.y},${a.z}`).toBe(true);
      else expect(props.has(`${a.x},${a.y},${a.z}`)).toBe(true);
    }
    expect(picks).toBeGreaterThan(150);
  });

  it("the hero's webs in a bot night all go ahead of the heading", () => {
    const save = heroSave(STANDARD, "Heading", 2);
    const run = startRun(save, 0xa11);
    const mem = newBotMemory();
    let attaches = 0;
    let within = 0;
    while (!run.over && !run.error && run.sim.tick < 30_000) {
      if (needsErrand(run)) {
        chooseErrand(run, 0);
        continue;
      }
      const s = run.sim;
      const f = botFrame(s, mem);
      const had = !!s.hero.rope;
      const head = heroHeading(s, f);
      const x = s.hero.x;
      const z = s.hero.z;
      const events = stepRun(run, f);
      for (const e of events) {
        if (e.type !== "thwip" || had) continue;
        attaches += 1;
        const along = (e.ax - x) * head.x + (e.az - z) * head.z;
        const lat = -(e.ax - x) * head.z + (e.az - z) * head.x;
        if (along > 0 && Math.abs(lat) <= along * ANCHOR_CONE + 1e-6) within += 1;
      }
    }
    expect(run.over).toBe(true);
    expect(attaches).toBeGreaterThan(30);
    expect(within).toBe(attaches);
    expect(HERO_RADIUS).toBeGreaterThan(0);
  });
});
