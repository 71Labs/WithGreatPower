/**
 * Case File 003, "Fee Strike": the city, the clues and Gas Goblin's route; the chase's rules
 * (catch-up, the escape meter, checkpoints, losses, fee bombs); the bakery fight and the cooled
 * meter; determinism and verification; the render contract (v1.6); patrol nights and Case File
 * 001 untouched; and the balance gates on fee-metrics.ts (FEE_REPORT=1 prints them all).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { hashState } from "../src/hash";
import { chapterCleared, chapterStats, replayRun, resumeRun, runHash, runLog, startChapterRun, startRun, stepRun, type Run } from "../src/replay";
import { applyCaseClear, CHAPTER_IDS, CHAPTERS, FEE_STRIKE_RULESET, isChapterId, villainCard } from "../src/rules/chapters";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { chapterLogRuleset, chapterStops } from "../src/sim3d/chapter";
import { HERO_RADIUS } from "../src/sim3d/constants";
import type { InputFrame, RenderFrame3D } from "../src/sim3d/contract";
import { dirIndex, len2, len3 } from "../src/sim3d/dmath";
import { CHASE_FAST, chaseGap, chaseHurt, chaseSpeed, ESCAPE_SECONDS, HOLD_SECONDS, MAX_LOSSES } from "../src/sim3d/fee-chase";
import { COOL_TICKS, FEE_LEVEL, LOOP_R, meterPlant } from "../src/sim3d/fee-strike";
import { LOAF_SHARE, SPIKE_REACH } from "../src/sim3d/fee-strike-step";
import { fightPress } from "../src/sim3d/strike";
import { fillRenderFrame, newRenderFrame } from "../src/sim3d/render";
import { IDLE_FRAME } from "../src/sim3d/sim";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { feeHero, feeRuns, summarizeFee, type FeeSummary } from "./fee-metrics";
import { heroSave, STANDARD } from "./helpers";

const SEED = 0xfee5003;
const hero = () => heroSave(STANDARD, "Fee Tester", 3);
const SEEDS = Array.from({ length: 30 }, (_, i) => Math.imul(i + 7, 0x9e3779b1) >>> 0);

function botUntil(run: Run, until: (s: SimState) => boolean, max = 54_000): SimEvent[] {
  const mem = newBotMemory();
  const all: SimEvent[] = [];
  while (!run.over && !run.error && run.sim.tick < max && !until(run.sim)) all.push(...stepRun(run, botFrame(run.sim, mem)));
  return all;
}

const feeRun = (seed = SEED) => {
  const run = startChapterRun(hero(), seed, "case-003");
  expect(run.error).toBeNull();
  return run;
};

/** Stand still for `ticks`. */
function idle(run: Run, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks && !run.over; i++) all.push(...stepRun(run, IDLE_FRAME));
  return all;
}

describe("Case File 003: the registry and the night's city", () => {
  it("is its own chapter with its own ruleset, badge and log field", () => {
    expect(CHAPTER_IDS).toContain("case-003");
    expect(isChapterId("case-003")).toBe(true);
    expect(CHAPTERS["case-003"]).toMatchObject({ id: "case-003", number: "003", title: "Fee Strike", ruleset: "c003-1", badge: "case-003" });
    expect(FEE_STRIKE_RULESET).toBe("c003-1");
    expect(chapterLogRuleset("case-003")).toBe(0x0c003104);
    expect(chapterLogRuleset("case-003")).not.toBe(chapterLogRuleset("case-001"));
    expect(chapterStops("case-003")).toEqual([{ kind: "fight", villain: "gas-goblin", district: "mempool-market", level: FEE_LEVEL, boss: false, quest: false }]);
    expect(villainCard("gas-goblin").name).toBe("Gas Goblin");
    expect(CHAPTERS["case-003"].clues.map((c) => c.id)).toEqual(["burn", "pretzel", "florist"]);
  });

  it("puts the bakery on the Market District's arena roof, the meter across the loop, and three clues round the start", () => {
    for (const seed of SEEDS) {
      const run = feeRun(seed);
      const s = run.sim;
      const f = s.fee!;
      const zone = s.city.zones[0];
      expect(zone.villain).toBe("gas-goblin");
      expect(zone.district).toBe("mempool-market");
      expect(zone.stage).toBeTruthy();
      expect(s.chapter).toBeNull();
      // The route: on the meter's roof first, over the bakery last, most points on roofs.
      const r = f.route;
      expect(r.length).toBeGreaterThanOrEqual(7);
      expect(r[0].roof).toBe(true);
      expect(f.meter).toMatchObject({ x: r[0].rx, y: r[0].ry, z: r[0].rz, carried: false, cool: 0, cooled: false });
      const st = zone.stage!;
      const last = r[r.length - 1];
      expect(last.x).toBeCloseTo((st.x0 + st.x1) / 2, 6);
      expect(last.z).toBeCloseTo((st.z0 + st.z1) / 2, 6);
      expect(last.y).toBeGreaterThan(st.y + 200);
      expect(r.filter((p) => p.roof).length / r.length).toBeGreaterThanOrEqual(0.5);
      const total = last.at;
      expect(total).toBeGreaterThan(5000);
      expect(total).toBeLessThan(12_000);
      for (let i = 1; i < r.length; i++) expect(r[i].at).toBeGreaterThan(r[i - 1].at);
      const dm = len2(r[0].x - s.city.start.x, r[0].z - s.city.start.z);
      expect(dm).toBeGreaterThan(LOOP_R - 800);
      expect(dm).toBeLessThan(LOOP_R + 800);
      // The clues: on roofs a hero can land on, spread out, not on the meter.
      expect(f.clues.map((c) => c.id)).toEqual(["burn", "pretzel", "florist"]);
      for (const c of f.clues) {
        expect(c.y).toBeGreaterThanOrEqual(170);
        expect(c.found).toBe(false);
        expect(len2(c.x - f.meter.x, c.z - f.meter.z)).toBeGreaterThan(200);
      }
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(len2(f.clues[i].x - f.clues[j].x, f.clues[i].z - f.clues[j].z)).toBeGreaterThan(240);
    }
  });

  it("is the same city, route and clues for the same seed, and a new one for another", () => {
    const a = feeRun(SEED).sim;
    const b = feeRun(SEED).sim;
    const c = feeRun(SEED + 1).sim;
    expect(JSON.stringify(b.fee)).toBe(JSON.stringify(a.fee));
    expect(hashState(b)).toBe(hashState(a));
    expect(JSON.stringify(c.fee!.route)).not.toBe(JSON.stringify(a.fee!.route));
  });

  it("never reaches patrol nights or Case File 001: no fee state, no fee frame", () => {
    const night = startRun(heroSave(STANDARD, "Patrol Tester", 1), 0x5eed0001);
    expect(night.sim.fee ?? null).toBeNull();
    const case1 = startChapterRun(hero(), SEED, "case-001");
    expect(case1.sim.fee ?? null).toBeNull();
    const frame = newRenderFrame();
    fillRenderFrame(night.sim, frame);
    expect(frame.fee).toBeNull();
    fillRenderFrame(case1.sim, frame);
    expect(frame.fee).toBeNull();
    expect(frame.chapter?.id).toBe("case-001");
  });
});

describe("Case File 003: the night, start to finish", () => {
  let run: Run;
  let events: SimEvent[];
  beforeAll(() => {
    run = feeRun();
    events = botUntil(run, () => false);
  });

  it("runs investigate → meter → chase → showdown → the fight → cool → done, and closes the case", () => {
    const types = events.map((e) => e.type);
    const clues = events.filter((e) => e.type === "fee-clue");
    expect(clues).toHaveLength(3);
    const grab = types.indexOf("meter-grab");
    expect(grab).toBeGreaterThan(types.lastIndexOf("fee-clue"));
    expect(types).not.toContain("clue-found");
    const end = types.indexOf("chase-end");
    expect(end).toBeGreaterThan(grab);
    const enc = types.indexOf("encounter");
    expect(enc).toBeGreaterThan(end);
    expect(events[enc]).toMatchObject({ villain: "gas-goblin" });
    const won = types.indexOf("fight-won");
    expect(won).toBeGreaterThan(types.indexOf("fight-live"));
    const cools = events.filter((e): e is Extract<SimEvent, { type: "meter-cool" }> => e.type === "meter-cool").map((e) => e.p);
    expect(cools.length).toBeGreaterThanOrEqual(COOL_TICKS / 15);
    for (let i = 1; i < cools.length; i++) expect(cools[i]).toBeGreaterThan(cools[i - 1]);
    expect(cools[cools.length - 1]).toBe(1);
    const cooled = types.indexOf("fees-cooled");
    expect(cooled).toBeGreaterThan(won);
    const closed = events.find((e) => e.type === "case-closed");
    expect(closed).toMatchObject({ id: "case-003", ticks: run.sim.tick });
    expect(types.indexOf("case-closed")).toBeGreaterThan(cooled);
    expect(events[events.length - 1]).toMatchObject({ type: "night-over", reason: "route" });
    expect(types).not.toContain("stop-done");
    expect(run.over).toBe(true);
    expect(chapterCleared(run)).toBe(true);
    const f = run.sim.fee!;
    expect(f.phase).toBe("done");
    expect(f.meter).toMatchObject({ carried: false, cooled: true, cool: COOL_TICKS });
    // Planted on the bakery roof.
    const p = meterPlant(run.sim.city);
    expect(f.meter.x).toBe(p.x);
    expect(f.meter.z).toBe(p.z);
    const stats = chapterStats(run);
    expect(stats).toMatchObject({ chapter: 1, cleared: 1, cluesFound: 3, clues: 3, fightsWon: 1, restore: COOL_TICKS, losses: 0 });
    expect(stats.chaseSeconds).toBeGreaterThan(5);
  });

  it("only lets the hero onto the bakery roof once Gas Goblin has landed, and the fight starts from where he is", () => {
    const r = feeRun();
    botUntil(r, (s) => s.fee!.phase === "showdown");
    const v = r.sim.villain!;
    const at = { x: v.x, y: v.y, z: v.z };
    expect(r.sim.mode).toBe("travel");
    botUntil(r, (s) => s.mode === "intro");
    const w = r.sim.villain!;
    expect(w).not.toBe(v);
    expect(w.kind).toBe("gas-goblin");
    expect(w.level).toBe(FEE_LEVEL);
    expect(w.hits).toBe(7);
    // No teleport: he's where the circling left him (a few ticks on).
    expect(len3(w.x - at.x, w.y - at.y, w.z - at.z)).toBeLessThan(2000);
  });
});

describe("Case File 003: the chase", () => {
  /** Into the chase: the bot investigates and walks up to the meter. */
  function chase(seed = SEED): Run {
    const run = feeRun(seed);
    botUntil(run, (s) => s.fee!.phase === "chase");
    expect(run.sim.fee!.phase).toBe("chase");
    expect(run.sim.fee!.meter.carried).toBe(true);
    expect(run.sim.mode).toBe("travel");
    return run;
  }

  it("catches up fairly: he bolts when you're on his tail, slows when you're behind and waits when you're far behind", () => {
    let last = Infinity;
    for (let g = 0; g <= 2000; g += 25) {
      const v = chaseSpeed(g);
      expect(v).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
    expect(chaseSpeed(100)).toBe(CHASE_FAST);
    expect(chaseSpeed(800)).toBeLessThan(400);
    expect(chaseSpeed(1600)).toBe(0);
  });

  it("is lost after standing still too long: the hero goes back to the last checkpoint's roof and he waits there", () => {
    const run = chase();
    const s = run.sim;
    const f = s.fee!;
    const ev = idle(run, Math.ceil((ESCAPE_SECONDS + 1.5 + 6) * 60));
    const lost = ev.find((e) => e.type === "chase-lost");
    expect(lost).toBeTruthy();
    expect(lost).toMatchObject({ losses: 1, checkpoint: f.checkpoint });
    expect(f.losses).toBeGreaterThanOrEqual(1);
    // He's waiting at the next point; the escape meter is empty.
    const at = f.route[(lost as Extract<SimEvent, { type: "chase-lost" }>).checkpoint];
    expect(at.roof).toBe(true);
    const back = ev.indexOf(lost!);
    expect(back).toBeGreaterThanOrEqual(0);
  });

  it("puts the hero on the checkpoint's roof, still, and holds him off a moment", () => {
    const run = chase();
    const s = run.sim;
    const f = s.fee!;
    for (let i = 0; i < 6000 && f.losses === 0; i++) stepRun(run, IDLE_FRAME);
    expect(f.losses).toBe(1);
    const cp = f.route[f.checkpoint];
    expect(s.hero.x).toBe(cp.rx);
    expect(s.hero.z).toBe(cp.rz);
    expect(s.hero.y).toBe(cp.ry + HERO_RADIUS);
    expect(s.hero.grounded).toBe(true);
    expect(f.escape).toBe(0);
    expect(f.holdT).toBeGreaterThan(HOLD_SECONDS - 0.1);
    expect(s.hazards).toHaveLength(0);
  });

  it("escapes with the meter after MAX_LOSSES losses: the night ends uncleared", () => {
    const run = chase();
    const ev = idle(run, 54_000);
    expect(ev.filter((e) => e.type === "chase-lost")).toHaveLength(MAX_LOSSES - 1);
    expect(ev.find((e) => e.type === "chase-escaped")).toMatchObject({ losses: MAX_LOSSES });
    expect(ev[ev.length - 1]).toMatchObject({ type: "night-over", reason: "route" });
    expect(run.over).toBe(true);
    expect(chapterCleared(run)).toBe(false);
    expect(chapterStats(run)).toMatchObject({ cleared: 0, losses: MAX_LOSSES });
    // A replay agrees.
    const res = replayRun({ save: hero(), seed: SEED, log: runLog(run) }, { chapter: "case-003" });
    expect(res.ok, res.reason).toBe(true);
    expect(res.stats.cleared).toBe(0);
    expect(res.hash).toBe(runHash(run));
  });

  it("passes checkpoints in order, each on a roof, short of the bakery", () => {
    const run = feeRun();
    const ev = botUntil(run, (s) => s.fee!.phase === "showdown");
    const cps = ev.filter((e): e is Extract<SimEvent, { type: "chase-checkpoint" }> => e.type === "chase-checkpoint");
    expect(cps.length).toBeGreaterThanOrEqual(3);
    const f = run.sim.fee!;
    for (let i = 0; i < cps.length; i++) {
      expect(f.route[cps[i].index].roof).toBe(true);
      expect(cps[i].index).toBeLessThan(f.route.length - 1);
      if (i > 0) expect(cps[i].index).toBeGreaterThan(cps[i - 1].index);
    }
  });

  it("lobs fee bombs back at you that hurt and burn fluid, but never knock you out mid-chase", () => {
    const run = chase();
    const s = run.sim;
    const ev = botUntil(run, (st) => st.fee!.phase !== "chase");
    expect(ev.filter((e) => e.type === "villain-attack" && e.label === "Fee bomb").length).toBeGreaterThanOrEqual(3);
    // At one health, a bomb leaves you at one.
    const r2 = chase();
    r2.sim.hp = 1;
    r2.sim.hero.invuln = 0;
    const hit = chaseHurt(r2.sim, 50, "a fee bomb", r2.sim.hero.x + 10, r2.sim.hero.y, r2.sim.hero.z, 10);
    expect(hit).toBe(true);
    expect(r2.sim.hp).toBe(1);
    expect(r2.sim.mode).toBe("travel");
    expect(s.hp).toBeGreaterThan(0);
  });

  it("is no fight: no strikes, no targets, no contact with him while he flees", () => {
    const run = chase();
    const s = run.sim;
    for (let i = 0; i < 300; i++) {
      stepRun(run, { dir: dirIndex(s.villain!.x - s.hero.x, s.villain!.z - s.hero.z), mag: 3, web: i % 20 < 10, shot: 0 });
      expect(fightPress(s).kind).toBe("web");
      expect(s.hero.strike).toBe(-1);
      expect(s.mode).toBe("travel");
    }
  });

  it("slows him with node sense", () => {
    const run = chase();
    const s = run.sim;
    const v = s.villain!;
    const before = { x: v.x, z: v.z };
    s.slowmo = 3;
    idle(run, 30);
    const slow = len2(v.x - before.x, v.z - before.z);
    const r2 = chase();
    const w = r2.sim.villain!;
    const b2 = { x: w.x, z: w.z };
    idle(r2, 30);
    const fast = len2(w.x - b2.x, w.z - b2.z);
    expect(slow).toBeLessThan(fast);
  });
});

describe("Case File 003: the bakery and the meter", () => {
  /** On the bakery roof, the fight won, cooling. */
  function cooling(seed = SEED): Run {
    const run = feeRun(seed);
    botUntil(run, (s) => s.fee!.phase === "cool");
    expect(run.sim.mode).toBe("fight");
    return run;
  }

  it("patches a badly hurt hero up on landing (Aunt Mainnet's last loaf), and leaves a healthy one alone", () => {
    const low = feeRun();
    botUntil(low, (s) => s.fee!.phase === "showdown");
    low.sim.hp = 5;
    const ev = botUntil(low, (s) => s.mode === "intro");
    const floor = Math.floor(low.sim.maxHp * LOAF_SHARE + 0.5);
    expect(ev.find((e) => e.type === "loaf")).toMatchObject({ hp: floor, gained: floor - 5 });
    expect(low.sim.hp).toBe(floor);
    const fine = feeRun();
    const ev2 = botUntil(fine, (s) => s.mode === "intro");
    expect(ev2.find((e) => e.type === "loaf")).toBeUndefined();
  });

  it("keeps Gas Goblin webbed through the cooling: no target, no second win", () => {
    const run = cooling();
    const s = run.sim;
    const v = s.villain!;
    expect(v.hits).toBe(0);
    for (let i = 0; i < 240; i++) {
      const ev = stepRun(run, { dir: dirIndex(v.x - s.hero.x, v.z - s.hero.z), mag: 3, web: i % 12 < 6, shot: i % 60 === 0 ? 1 : 0 });
      expect(ev.find((e) => e.type === "fight-won")).toBeUndefined();
      expect(fightPress(s).kind).toBe("web");
      if (s.mode !== "fight") break;
    }
  });

  it("cools only while the web's held beside the meter, and a fee spike, telegraphed, interrupts it", () => {
    const run = cooling();
    const s = run.sim;
    const f = s.fee!;
    const m = f.meter;
    // Stand beside it.
    const h = s.hero;
    h.x = m.x + 60;
    h.z = m.z;
    h.y = m.y + HERO_RADIUS;
    h.vx = h.vy = h.vz = 0;
    h.grounded = true;
    h.invuln = 0;
    // No web shield or cloak up to eat the spike.
    h.shieldT = 0;
    h.cloakT = 0;
    const before = m.cool;
    idle(run, 20);
    expect(m.cool).toBe(before);
    const hold: InputFrame = { dir: 0, mag: 0, web: true, shot: 0 };
    let windup = -1;
    let spike: Extract<SimEvent, { type: "fee-spike" }> | null = null;
    let cooledFirst = 0;
    for (let i = 0; i < 400 && !spike; i++) {
      for (const e of stepRun(run, hold)) {
        if (e.type === "villain-attack" && e.label === "Fee spike") windup = s.tick;
        if (e.type === "fee-spike") spike = e;
      }
      if (windup < 0) cooledFirst = m.cool;
    }
    expect(cooledFirst).toBeGreaterThan(before);
    expect(windup).toBeGreaterThan(0);
    expect(spike).toBeTruthy();
    expect(spike!.hit).toBe(true);
    // Shoved out and hurt: the cooling waits.
    const at = m.cool;
    stepRun(run, hold);
    expect(m.cool).toBe(at);
    expect(len2(h.x - m.x, h.z - m.z)).toBeLessThan(SPIKE_REACH + 200);
  });

  it("the fees cooled, the night ends a beat later with the case closed", () => {
    const run = cooling();
    const ev = botUntil(run, () => false);
    const types = ev.map((e) => e.type);
    expect(types).toContain("fees-cooled");
    expect(types).toContain("case-closed");
    expect(chapterCleared(run)).toBe(true);
  });
});

describe("Case File 003: determinism and verification", () => {
  it("a whole night replays to the same hash and checkpoints, and resumes mid-chase to the same state", () => {
    const run = feeRun();
    botUntil(run, () => false);
    const log = runLog(run);
    const a = replayRun({ save: hero(), seed: SEED, log }, { chapter: "case-003" });
    const b = replayRun({ save: hero(), seed: SEED, log }, { chapter: "case-003" });
    expect(a.ok, a.reason).toBe(true);
    expect(a.stats.cleared).toBe(1);
    expect(a.hash).toBe(runHash(run));
    expect(b.hash).toBe(a.hash);
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(a.checkpoints).toEqual(run.checkpoints);
    expect(a.score).toBe(0);
    // Resume halfway through the chase.
    const half = feeRun();
    botUntil(half, (s) => s.fee!.phase === "chase" && s.fee!.chaseT > 6);
    const resumed = resumeRun({ save: hero(), seed: SEED, log: runLog(half) }, { chapter: "case-003" });
    expect(resumed.error).toBeNull();
    expect(hashState(resumed.sim)).toBe(hashState(half.sim));
  });

  it("refuses a case-003 log as a patrol night or Case File 001, and theirs as case-003", () => {
    const run = feeRun();
    botUntil(run, () => false, 1500);
    const log = runLog(run);
    expect(replayRun({ save: hero(), seed: SEED, log }).reason).toMatch(/ruleset 201339140 is not 4/);
    expect(replayRun({ save: hero(), seed: SEED, log }, { chapter: "case-001" }).reason).toMatch(/ruleset 201339140 is not chapter case-001/);
    const case1 = startChapterRun(hero(), SEED, "case-001");
    botUntil(case1, () => false, 1500);
    expect(replayRun({ save: hero(), seed: SEED, log: runLog(case1) }, { chapter: "case-003" }).reason).toMatch(/ruleset 201330948 is not chapter case-003/);
  });

  it("the bot clears every seed, verified by replay", () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const run = feeRun(seed);
      botUntil(run, () => false);
      expect(chapterCleared(run), `seed ${seed}`).toBe(true);
      const res = replayRun({ save: hero(), seed, log: runLog(run) }, { chapter: "case-003" });
      expect(res.ok, res.reason).toBe(true);
      expect(res.hash).toBe(runHash(run));
      expect(res.stats.cleared).toBe(1);
    }
  });

  it("closes the case in the save (case XP once, its own record)", () => {
    const first = applyCaseClear(hero(), "case-003", 5000, "2026-11-05T10:00:00.000Z", true);
    expect(first.firstClear).toBe(true);
    expect(first.save.cases!["case-003"]).toEqual({ cleared: true, clearedAt: "2026-11-05T10:00:00.000Z", bestTicks: 5000, verified: true });
    expect(first.save.cases!["case-001"]).toBeUndefined();
    const again = applyCaseClear(first.save, "case-003", 4000, "2026-11-06T10:00:00.000Z", true);
    expect(again.firstClear).toBe(false);
    expect(again.save.cases!["case-003"]!.bestTicks).toBe(4000);
    expect(again.save.hero).toBe(first.save.hero);
  });
});

describe("Case File 003: the render frame (v1.6)", () => {
  it("carries the clues, the meter (carried through the chase), the route and the chase's numbers, and his state words", () => {
    const run = feeRun();
    const frame: RenderFrame3D = newRenderFrame();
    const mem = newBotMemory();
    const words = new Set<string>();
    let carried = 0;
    let chased = 0;
    while (!run.over && run.sim.tick < 54_000) {
      stepRun(run, botFrame(run.sim, mem));
      fillRenderFrame(run.sim, frame);
      const fe = frame.fee!;
      expect(fe.id).toBe("case-003");
      expect(fe.phase).toBe(run.sim.fee!.phase);
      expect(fe.clues).toHaveLength(3);
      expect(fe.route).toHaveLength(run.sim.fee!.route.length);
      expect(fe.meter.heat).toBeGreaterThanOrEqual(0);
      expect(fe.meter.heat).toBeLessThanOrEqual(1);
      if (fe.meter.carried) carried += 1;
      if (fe.phase === "chase") {
        chased += 1;
        expect(fe.chase).toBeTruthy();
        expect(fe.chase!.gap).toBeCloseTo(chaseGap(run.sim), 6);
        expect(fe.chase!.maxLosses).toBe(MAX_LOSSES);
        const v = frame.villains[0];
        expect(v.id).toBe("gas-goblin");
        expect(fe.meter.pos.y).toBeLessThan(v.pos.y);
      } else expect(fe.chase).toBeNull();
      for (const v of frame.villains) words.add(`${fe.phase}:${v.state}`);
    }
    expect(carried).toBe(chased);
    expect(chased).toBeGreaterThan(300);
    expect(words).toContain("meter:perch");
    expect(words).toContain("chase:flee");
    expect(words).toContain("chase:throw");
    expect(words).toContain("showdown:circle");
    expect(words).toContain("cool:webbed");
    expect(frame.fee!.meter).toMatchObject({ carried: false, cooled: true, heat: 0, spike: 0 });
    expect(frame.fee!.bakery.y).toBe(run.sim.city.zones[0].stage!.y);
  });
});

describe("Case File 003: balance (fee-metrics.ts)", () => {
  let bot: FeeSummary;
  let simple: FeeSummary;
  let average: FeeSummary;
  let good: FeeSummary;
  const seeds = Array.from({ length: 24 }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);
  beforeAll(() => {
    const save = feeHero(3);
    bot = summarizeFee(feeRuns("bot", seeds, save));
    simple = summarizeFee(feeRuns("simple", seeds, save));
    average = summarizeFee(feeRuns("average", seeds, save));
    good = summarizeFee(feeRuns("good", seeds, save));
  }, 300_000);

  it("a first-timer clears about 80% of the time; skilled players every time", () => {
    expect(simple.clear).toBeGreaterThanOrEqual(0.7);
    expect(simple.clear).toBeLessThanOrEqual(0.95);
    expect(average.clear).toBeGreaterThanOrEqual(0.9);
    expect(good.clear).toBe(1);
    expect(bot.clear).toBe(1);
  });

  it("the chase is tense but fair: first-timers fall behind and lose him some of the time, skilled ones keep up", () => {
    // Nobody is simply outrun.
    expect(simple.escaped).toBeLessThanOrEqual(0.05);
    expect(good.lostOnce).toBeLessThanOrEqual(0.1);
    expect(bot.lostOnce).toBe(0);
    // A first-timer drops back further and loses him more.
    expect(simple.gap).toBeGreaterThan(good.gap);
    expect(simple.behind).toBeGreaterThan(good.behind);
    expect(simple.lostOnce).toBeGreaterThanOrEqual(good.lostOnce);
    // A chase of a quarter to a half minute, longer for a first-timer.
    expect(bot.chase).toBeGreaterThan(10);
    expect(bot.chase).toBeLessThan(30);
    expect(simple.chase).toBeGreaterThan(bot.chase);
    expect(simple.chaseP90).toBeLessThan(75);
  });

  it("dodging pays: in the chase, the fight and at the meter", () => {
    expect(simple.fightDmg).toBeGreaterThan(good.fightDmg);
    expect(simple.spikeHit).toBeGreaterThan(good.spikeHit);
    expect(good.fight).toBeGreaterThan(8);
    expect(good.fight).toBeLessThan(45);
  });
});
