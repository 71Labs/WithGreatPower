/**
 * The render frame's v1.2 animation fields, filled the way the session loop fills them:
 * two frame objects in turn, one per tick. They must stay consistent with the sim, count
 * ticks correctly across the swap, and never touch the state hash.
 */
import { describe, expect, it } from "vitest";

import { hashState } from "../src/hash";
import { stepRun } from "../src/replay";
import type { HeroAction, RenderFrame3D } from "../src/sim3d";
import type { Stop } from "../src/rules/types";
import { armTip, fillRenderFrame, heroAction, newBotMemory, newRenderFrame } from "../src/sim3d";
import { reduce } from "../src/rules/engine";
import { policyFrame, heroSave, STANDARD, playBot } from "./helpers";
import { chooseErrand, needsErrand, startRun } from "../src/replay";

const ACTIONS: readonly HeroAction[] = ["idle", "run", "swing", "air", "climb", "dash", "slam", "held", "hurt", "ko"];

/** Every villain once, so every body kind (and Doc's arms) is exercised. */
const STOPS: Stop[] = [
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 2, boss: false, quest: false },
  { kind: "fight", villain: "sybil", district: "validator-heights", level: 2, boss: false, quest: false },
  { kind: "fight", villain: "gas-goblin", district: "sector-7", level: 2, boss: false, quest: false },
  { kind: "fight", villain: "sandwich-man", district: "mempool-market", level: 2, boss: true, quest: false },
];

const unit = (v: { x: number; y: number; z: number }) => Math.abs(Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) - 1) < 1e-9 && v.y === 0;

describe("the render frame's v1.2 fields", () => {
  it("hold across a whole night, filled into two frames in turn, without touching the hash", () => {
    const started = reduce(heroSave(["web-sling", "web-bomb", "zk-cloak", "front-run"], "Render Hero", 4), { type: "start-patrol", seed: 99 });
    const save = { ...started, patrol: { ...started.patrol!, stops: STOPS } };
    const run = startRun(save, 99, { trustPatrol: true });
    expect(run.error).toBeNull();
    const mem = newBotMemory();
    const frames: [RenderFrame3D, RenderFrame3D] = [newRenderFrame(), newRenderFrame()];
    let flip = 0;
    let last: { action: HeroAction; ticks: number; tick: number } | null = null;
    const states = new Map<number, { state: string; ticks: number }>();
    const seen = new Set<HeroAction>();
    let docArms = 0;
    let villainFrames = 0;
    while (!run.over && !run.error && run.sim.tick < 40_000) {
      if (needsErrand(run)) {
        chooseErrand(run, 0);
        continue;
      }
      stepRun(run, policyFrame(run, mem, false));
      const s = run.sim;
      const before = hashState(s);
      const f = fillRenderFrame(s, frames[flip]);
      flip ^= 1;
      expect(hashState(s)).toBe(before);

      const h = f.hero;
      expect(unit(h.facing!)).toBe(true);
      expect(ACTIONS).toContain(h.action);
      expect(h.action).toBe(heroAction(s));
      seen.add(h.action!);
      if (s.hero.rope) expect(["swing", "climb", "hurt", "held", "dash", "slam", "ko"]).toContain(h.action);
      expect(h.ropeLen).toBe(s.hero.rope ? s.hero.rope.len : 0);
      expect(h.cloak).toBe(s.hero.cloakT > 0);
      // actionTicks counts sim ticks since the action began, across the frame swap.
      if (last && last.tick === s.tick - 1) {
        if (last.action === h.action) expect(h.actionTicks).toBe(last.ticks + 1);
        else expect(h.actionTicks).toBe(0);
      }
      last = { action: h.action!, ticks: h.actionTicks!, tick: s.tick };

      for (let i = 0; i < f.villains.length; i++) {
        const v = f.villains[i];
        villainFrames += 1;
        expect(unit(v.facing!)).toBe(true);
        expect([v.vel!.x, v.vel!.y, v.vel!.z].every(Number.isFinite)).toBe(true);
        expect(v.stateTicks).toBeGreaterThanOrEqual(0);
        const key = v.copy ? i + 100 : -1;
        const prev = states.get(key);
        if (!v.copy && prev && s.mode !== "won") {
          if (prev.state === v.state) expect(v.stateTicks).toBe(prev.ticks + 1);
          else expect(v.stateTicks).toBe(0);
        }
        states.set(key, { state: v.state, ticks: v.stateTicks! });
        if (v.id === "doc-octochain") {
          const sv = s.villain!;
          expect(v.arms).toHaveLength(sv.arms.length);
          v.arms!.forEach((seg, k) => {
            const tip = armTip(sv, k);
            expect(seg.to).toEqual(tip);
            // The shoulder sits on the body.
            expect(Math.hypot(seg.from.x - v.pos.x, seg.from.y - v.pos.y, seg.from.z - v.pos.z)).toBeLessThanOrEqual(sv.radius);
          });
          docArms += 1;
        } else expect(v.arms).toBeUndefined();
      }
      if (s.villain === null) states.clear();
    }
    expect(run.error).toBeNull();
    expect(run.over).toBe(true);
    expect(docArms).toBeGreaterThan(100);
    expect(villainFrames).toBeGreaterThan(1000);
    for (const a of ["swing", "air", "run"] as const) expect(seen.has(a), a).toBe(true);
  });

  it("villain velocity matches the motion the scene draws (and, flying free, the sim's own velocity)", () => {
    const started = reduce(heroSave(STANDARD, "Velocity Hero", 2), { type: "start-patrol", seed: 5 });
    const save = { ...started, patrol: { ...started.patrol!, stops: STOPS.slice(2) } };
    const run = startRun(save, 5, { trustPatrol: true });
    const mem = newBotMemory();
    // Into the Goblin fight, a second after it goes live.
    let live = 0;
    while (!run.over && run.sim.tick < 20_000 && live < 60) {
      if (needsErrand(run)) chooseErrand(run, 0);
      else stepRun(run, policyFrame(run, mem, false));
      if (run.sim.mode === "fight") live += 1;
    }
    const s = run.sim;
    expect(s.villain?.kind).toBe("gas-goblin");
    const f = newRenderFrame();
    fillRenderFrame(s, f);
    const p0 = { ...f.villains[0].pos };
    stepRun(run, policyFrame(run, mem, false));
    fillRenderFrame(s, f);
    const p1 = f.villains[0].pos;
    const vel = f.villains[0].vel!;
    expect(vel.x).toBeCloseTo((p1.x - p0.x) * 60, 6);
    expect(vel.y).toBeCloseTo((p1.y - p0.y) * 60, 6);
    expect(vel.z).toBeCloseTo((p1.z - p0.z) * 60, 6);
    const v = s.villain!;
    expect(Math.hypot(vel.x - v.vx, vel.y - v.vy, vel.z - v.vz)).toBeLessThan(1e-6);
    expect(f.villains[0].bank).toBe(v.bank);
  });
});
