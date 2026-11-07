/**
 * Free roam's fifth side task (roam-3), "Front-run" (sim3d/roam/task-frontrun.ts): Gwei Stacy's
 * rooftop race against Sandwich Man. The course is sound (gates in open air, the moves it asks
 * for, his route clear), the stages and the retry, the bot winning through the real replay and a
 * slow route losing, the river dropping the parcel, records from before the task, and
 * determinism.
 */
import { describe, expect, it } from "vitest";

import { applyOuting, cityRecord, emptyCity, FOLKS, lineText, roamStartFrom, taskStep, TASKS } from "../src/rules/city";
import { replayRoam, roamLog, roamOuting, startRoamRun, stepRoamRun, type RoamRun, type RoamRunEvent } from "../src/roam-run";
import { groundBelow, lineClear, overRiver } from "../src/sim3d/city";
import { DT, HERO_RADIUS } from "../src/sim3d/constants";
import { fillRenderFrame, newRenderFrame } from "../src/sim3d";
import { frontrunRace, newRoamBot, roamBotFrame, type RoamBotGoal } from "../src/sim3d/roam/bot";
import { SHOT_ACT, SHOT_SPRINT } from "../src/sim3d/roam/constants";
import { roamHashState } from "../src/sim3d/roam/hash";
import { fillRoamFrame } from "../src/sim3d/roam/render";
import { createRoamSim, freshStart } from "../src/sim3d/roam/step";
import { BUYER_DONE_LINE, gatesPassed, GWEI_LINE, RACE_HOLD, raceCourse, RIVAL_HIP, rivalAt, type RivalPlace } from "../src/sim3d/roam/task-frontrun";
import { TASK_DONE, TASK_IDS, type RoamStart } from "../src/sim3d/roam/types";
import { clearAt, roamCity, roamGrid, roamWorld } from "../src/sim3d/roam/world";
import { heroSave, STANDARD } from "./helpers";

const R = HERO_RADIUS;
const w = roamWorld();
const c = raceCourse();
const city = roamCity();
const grid = roamGrid(city);
const FR = TASK_IDS.indexOf("frontrun");
const gwei = w.folks.find((f) => f.key === "gwei")!;
const buyer = w.folks.find((f) => f.key === "buyer")!;
const IDLE = { dir: 0, mag: 0, web: false, shot: 0 } as const;
const ACT = { ...IDLE, shot: SHOT_ACT } as const;

/** Beside Gwei's stall, where a retry puts him. */
const atStall = (base: Partial<RoamStart> = {}): RoamStart => ({ ...freshStart(), ...base, at: { ...c.spot } });

interface Played {
  run: RoamRun;
  /** The race's story: start, g0…g5, won / lost:why, reset:why, task-N. */
  story: string[];
  events: { tick: number; e: RoamRunEvent }[];
}

function play(start: RoamStart, goals: RoamBotGoal[], maxTicks = 60 * 40, until?: (run: RoamRun) => boolean): Played {
  const run = startRoamRun(start);
  const mem = newRoamBot(goals);
  const story: string[] = [];
  const events: Played["events"] = [];
  for (let t = 0; t < maxTicks && mem.i < goals.length; t++) {
    for (const e of stepRoamRun(run, roamBotFrame(run.sim, mem))) {
      events.push({ tick: run.sim.tick, e });
      if (e.type === "roam-gate") story.push(`g${e.gate}`);
      else if (e.type === "roam-race") story.push(e.why ? `${e.state}:${e.why}` : e.state);
      else if (e.type === "roam-task" && e.task === "frontrun") story.push(`task-${e.stage}`);
    }
    if (until?.(run)) break;
  }
  return { run, story, events };
}

/** Step a run with one frame `n` times; every event. */
function steps(run: RoamRun, frame: typeof IDLE | typeof ACT, n = 1): RoamRunEvent[] {
  const out: RoamRunEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...stepRoamRun(run, frame));
  return out;
}

describe("Front-run's course", () => {
  it("has Gwei at her stall with her real cast body, the buyer up on the far roof, and their lines", () => {
    expect(gwei.cast).toBe("gwei");
    expect(gwei.gives).toBe("frontrun");
    expect(gwei.y).toBe(0);
    expect(buyer.takes).toBe("frontrun");
    expect(buyer.cast).toBeNull();
    expect(buyer.y).toBeGreaterThan(400);
    // Placed after everything a save indexes: the other folks keep their ids.
    expect(w.folks.slice(-2).map((f) => f.key)).toEqual(["gwei", "buyer"]);
    for (const f of [gwei, buyer]) {
      expect(FOLKS[f.key].lines.length).toBeGreaterThan(4);
      for (const line of FOLKS[f.key].lines) {
        expect(line).not.toMatch(/['"]/);
        expect(line[0]).toBe(line[0].toUpperCase());
      }
    }
    // She counts in gwei, and her last line hints at the Downloads.
    expect(FOLKS.gwei.lines.filter((l) => /gwei/.test(l)).length).toBeGreaterThanOrEqual(4);
    expect(lineText("gwei", GWEI_LINE.done)).toMatch(/Downloads/);
    expect(lineText("buyer", BUYER_DONE_LINE)).toMatch(/gwei/);
    expect(TASKS.frontrun.items).toBe(c.gates.length);
    expect(taskStep("frontrun", 1, 3)).toBe("Beat Sandwich Man to the buyer (gate 3 of 6)");
  });

  it("lays six gates in open air, each asking for a real move", () => {
    expect(c.gates.map((g) => g.move)).toEqual(["climb", "step", "leap", "vault", "zip", "leap"]);
    for (const [i, g] of c.gates.entries()) expect(clearAt(grid, g.x, g.y, g.z, 18), `gate ${i}`).toBe(true);
    // The climb's gate hangs on a facade over the street; the rest are over roofs (or a street).
    expect(groundBelow(grid, c.gates[0].x, c.gates[0].z, c.gates[0].y)).toBe(0);
    expect(groundBelow(grid, c.gates[0].x + 40, c.gates[0].z, 9999)).toBeGreaterThan(300);
    expect(groundBelow(grid, c.gates[2].x, c.gates[2].z, c.gates[2].y)).toBe(0);
    for (const i of [1, 3, 4, 5]) expect(groundBelow(grid, c.gates[i].x, c.gates[i].z, c.gates[i].y), `gate ${i}`).toBeGreaterThan(200);
  });

  it("stands Gwei, the retry spot and the buyer where a body fits", () => {
    for (const p of [c.spot, c.buyer, c.stall]) {
      expect(clearAt(grid, p.x, p.y + R + 1, p.z, R - 2)).toBe(true);
      expect(Math.abs(groundBelow(grid, p.x, p.z, p.y + 2) - p.y)).toBeLessThan(3);
    }
    expect(Math.hypot(c.spot.x - gwei.x, c.spot.z - gwei.z)).toBeLessThan(120);
  });

  it("spans the barricade's roof edge to edge, so the way on is over it", () => {
    const bread = c.solids.find((s) => s.look === "bread")!;
    const roof = bread.y0;
    const mid = (bread.x0 + bread.x1) / 2;
    // Roof right up to both ends, street just past them.
    for (const z of [bread.z0 + 2, bread.z1 - 2]) expect(groundBelow(grid, mid - 40, z, roof + 2)).toBeCloseTo(roof, 0);
    for (const z of [bread.z0 - 3, bread.z1 + 3]) expect(groundBelow(grid, mid, z, roof + 2)).toBeLessThan(1);
    // Vaultable: taller than a step, no taller than a vault.
    expect(bread.y1 - bread.y0).toBeGreaterThan(40);
    expect(bread.y1 - bread.y0).toBeLessThanOrEqual(120);
    // And it's solid in roam's grid.
    expect(clearAt(grid, mid, roof + 30, 1100, 10)).toBe(false);
  });

  it("puts the river between the barricade roof and the zip's roof: too far to jump", () => {
    const g = c.gates[4];
    const from = c.runner.find((p) => p.how === "zip")!;
    expect(overRiver(city, (4368 + 4812) / 2, 1450)).toBe(true);
    // From the barricade roof's corner the zip's roof is over 440 away and 340 up.
    expect(Math.hypot(from.x - 4340, from.z - 1340)).toBeGreaterThan(400);
    expect(g.y - 44 - 245).toBeGreaterThan(340);
  });

  it("runs Sandwich Man along a clear route: his hops clear what they cross, he passes every gate, and arrives last thing", () => {
    const route = c.route;
    expect(route[0].how).toBe("start");
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      if (b.how === "climb") continue;
      // Sampled along the segment (a hop's arc), his body's middle stays clear.
      const p: RivalPlace = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fz: 0, seg: 0, gates: 0, move: "run" };
      for (let k = 1; k < 12; k++) {
        rivalAt(c, c.times[i - 1] + ((c.times[i] - c.times[i - 1]) * k) / 12, p);
        expect(clearAt(grid, p.x, p.y + RIVAL_HIP, p.z, 12), `segment ${i} at ${k}/12`).toBe(true);
      }
      if (b.how === "run") expect(lineClear(grid, a.x, a.y + 40, a.z, b.x, b.y + 40, b.z), `run ${i}`).toBe(true);
    }
    expect(route.filter((n) => n.gate >= 0).map((n) => n.gate)).toEqual([0, 1, 2, 3, 4, 5]);
    const end: RivalPlace = rivalAt(c, c.total, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fz: 0, seg: 0, gates: 0, move: "run" });
    expect(end.gates).toBe(6);
    expect(end.move).toBe("won");
    expect(Math.hypot(end.x - c.buyer.x, end.z - c.buyer.z)).toBeLessThan(80);
    // Before the go he waits at his start, reading the mempool.
    expect(rivalAt(c, 0.5, end).move).toBe("wait");
    expect(end.gates).toBe(0);
  });
});

describe("Front-run's race", () => {
  it("starts on talking to Gwei (stage 0 → 1), hurries him on mid-race, and counts gates only in order", () => {
    const run = startRoamRun(atStall());
    steps(run, IDLE);
    const ev = steps(run, ACT);
    const talk = ev.find((e) => e.type === "roam-talk");
    expect(talk && talk.type === "roam-talk" && talk.line).toBe(GWEI_LINE.start);
    expect(ev.some((e) => e.type === "roam-task" && e.task === "frontrun" && e.stage === 1)).toBe(true);
    expect(ev.some((e) => e.type === "roam-race" && e.state === "start")).toBe(true);
    expect(run.sim.roam!.race.state).toBe(1);
    steps(run, IDLE);
    const again = steps(run, ACT).find((e) => e.type === "roam-talk");
    expect(again && again.type === "roam-talk" && again.line).toBe(GWEI_LINE.hurry);
    // Out of order: gate 3's spot counts nothing until gates 1 and 2 are through.
    const h = run.sim.hero;
    const put = (i: number) => {
      const g = c.gates[i];
      h.x = g.x;
      h.y = g.y;
      h.z = g.z;
      h.vx = h.vy = h.vz = 0;
      run.sim.roam!.body.move = "air";
      return steps(run, IDLE).filter((e) => e.type === "roam-gate");
    };
    expect(put(2)).toEqual([]);
    expect(put(0).map((e) => e.type === "roam-gate" && e.gate)).toEqual([0]);
    expect(put(2)).toEqual([]);
    expect(put(1).map((e) => e.type === "roam-gate" && e.gate)).toEqual([1]);
    expect(gatesPassed(run.sim)).toBe(2);
    expect(run.sim.roam!.progress.items[FR]).toBe(0b11);
  });

  it("the bot wins it through the real replay: talk, six gates in order, the buyer first", () => {
    const p = play(atStall(), frontrunRace(w, "good"));
    expect(p.story).toEqual(["task-1", "start", "g0", "g1", "g2", "g3", "g4", "g5", `task-${TASK_DONE}`, "won"]);
    const s = p.run.sim;
    expect(s.roam!.progress.stage[FR]).toBe(TASK_DONE);
    // Comfortably first: well before Sandwich Man gets there.
    const won = p.events.find(({ e }) => e.type === "roam-race" && e.state === "won")!;
    expect(won.tick * DT).toBeLessThan(c.total * 0.8);
    // The moves the gates ask for, really made.
    const moves = new Set(p.events.flatMap(({ e }) => (e.type === "roam-move" ? [e.move] : [])));
    for (const m of ["climb", "mantle", "vault", "zip"] as const) expect(moves.has(m), m).toBe(true);
    expect(p.events.some(({ e }) => e.type === "roam-jump" && e.kind === "leap")).toBe(true);
    // The buyer relays Gwei's compliment.
    expect(s.roam!.chat).toMatchObject({ folk: buyer.id, line: BUYER_DONE_LINE });
    // The log replays to the same outing, the task done.
    const res = replayRoam({ start: atStall(), log: roamLog(p.run) });
    expect(res.ok, res.reason).toBe(true);
    expect(res.hash).toBe(roamHashState(s));
    expect(res.outing.stage[FR]).toBe(TASK_DONE);
    expect(res.outing.items[FR]).toBe(0b111111);
  });

  it("a slow route (at a jog, never sprinting) loses: Sandwich Man fills it first, and the hero is back at Gwei's stall to go again", () => {
    const p = play(atStall(), [...frontrunRace(w, "jog"), { kind: "wait", ticks: 600 }], 60 * 40, (run) => run.sim.roam!.race.state === 0 && run.sim.tick > 10);
    expect(p.story.slice(0, 2)).toEqual(["task-1", "start"]);
    expect(p.story).toContain("lost:rival");
    expect(p.story[p.story.length - 1]).toBe("reset:rival");
    expect(p.story).not.toContain("g5");
    const lost = p.events.find(({ e }) => e.type === "roam-race" && e.state === "lost")!;
    expect(lost.tick * DT).toBeCloseTo(c.total, 1);
    // Reset: at the stall, the gates cleared, the stage still 1, Gwei's line for it.
    const s = p.run.sim;
    expect(s.roam!.progress.stage[FR]).toBe(1);
    expect(s.roam!.progress.items[FR]).toBe(0);
    expect(s.roam!.race.state).toBe(0);
    expect(s.roam!.body.move).toBe("ground");
    expect(Math.hypot(s.hero.x - c.spot.x, s.hero.z - c.spot.z)).toBeLessThan(1);
    expect(s.hero.y - R).toBeCloseTo(c.spot.y, 3);
    expect(s.roam!.chat).toMatchObject({ folk: gwei.id, line: GWEI_LINE.sandwiched });
    // Talk to her again: the race goes again at once, Sandwich Man back at his start.
    const ev = steps(p.run, ACT);
    const talk = ev.find((e) => e.type === "roam-talk");
    expect(talk && talk.type === "roam-talk" && talk.line).toBe(GWEI_LINE.again);
    expect(ev.some((e) => e.type === "roam-race" && e.state === "start")).toBe(true);
    expect(ev.some((e) => e.type === "roam-task")).toBe(false);
    expect(p.run.sim.roam!.race).toMatchObject({ state: 1, t: 1 });
    // And a good run from there wins.
    const mem = newRoamBot(frontrunRace(w, "good").slice(1));
    for (let t = 0; t < 60 * 20 && p.run.sim.roam!.progress.stage[FR] !== TASK_DONE; t++) stepRoamRun(p.run, roamBotFrame(p.run.sim, mem));
    expect(p.run.sim.roam!.progress.stage[FR]).toBe(TASK_DONE);
    // The whole outing, two races and all, replays.
    const res = replayRoam({ start: atStall(), log: roamLog(p.run) });
    expect(res.ok).toBe(true);
    expect(res.hash).toBe(roamHashState(p.run.sim));
  });

  it("drops the parcel in the river: lost, and back at the stall with the river line", () => {
    const goals = frontrunRace(w, "good");
    const zip = goals.findIndex((g) => g.kind === "face");
    // Over the barricade, then on east at a jog, off the roof (too slow to leap) and into the river.
    const p = play(atStall(), [...goals.slice(0, zip), { kind: "hold", x: 6000, z: 1320, ticks: 60, mag: 2 }, { kind: "wait", ticks: RACE_HOLD + 90 }], 60 * 30);
    expect(p.events.some(({ e }) => e.type === "roam-splash")).toBe(true);
    expect(p.story).toContain("lost:river");
    expect(p.story[p.story.length - 1]).toBe("reset:river");
    const s = p.run.sim;
    expect(s.roam!.chat).toMatchObject({ folk: gwei.id, line: GWEI_LINE.river });
    expect(Math.hypot(s.hero.x - c.spot.x, s.hero.z - c.spot.z)).toBeLessThan(1);
    expect(s.roam!.progress.items[FR]).toBe(0);
  });

  it("draws the race: the gates as map marks (the next one flagged), Sandwich Man, the score, then nothing once it's over", () => {
    const run = startRoamRun(atStall());
    steps(run, IDLE);
    steps(run, ACT);
    const frame = () => fillRoamFrame(run.sim, fillRenderFrame(run.sim, newRenderFrame())).roam!;
    let f = frame();
    expect(f.marks.map((m) => [m.task, m.kind, m.done, m.next])).toEqual(c.gates.map((_, i) => ["frontrun", "gate", false, i === 0]));
    expect(f.race).toMatchObject({ heroGate: 0, rivalGate: 0, of: 6, over: null, rivalMove: "wait" });
    steps(run, IDLE, Math.ceil((c.times[2] + 0.1) / DT));
    f = frame();
    expect(f.race!.rivalGate).toBe(1);
    expect(f.race!.rivalMove).not.toBe("wait");
    // Run out the clock: over ("lost"), then the race and its marks are gone.
    steps(run, IDLE, Math.ceil((c.total - run.sim.roam!.race.t * DT) / DT) + 2);
    f = frame();
    expect(f.race).toMatchObject({ over: "lost", why: "rival" });
    expect(f.marks).toEqual([]);
    steps(run, IDLE, RACE_HOLD + 2);
    f = frame();
    expect(f.race).toBeNull();
    expect(f.marks).toEqual([]);
  });
});

describe("Front-run and the save", () => {
  it("can't carry a race between outings: a stage-1 record starts at 0, the gates cleared; a finished one keeps them", () => {
    const fr = (stage: number, items: number) => {
      const s = createRoamSim({ ...freshStart(), stage: [0, 0, 0, 0, stage], items: [0, 0, 0, 0, items] });
      return [s.roam!.progress.stage[FR], s.roam!.progress.items[FR], s.roam!.race.state];
    };
    expect(fr(1, 0b111)).toEqual([0, 0, 0]);
    expect(fr(TASK_DONE, 0b111111)).toEqual([TASK_DONE, 0b111111, 0]);
  });

  it("keeps a record from before the task working: it starts at stage 0 with nothing found", () => {
    // A roam-2 record: four tasks.
    const old = { ...emptyCity(), tasks: { bread: TASK_DONE, pickpocket: TASK_DONE, pixels: 2, graffiti: 1 }, items: { pixels: 0b1011, graffiti: 0b1 }, pages: 0b11, views: 0b1, xp: 115, outings: 9 };
    const save = { ...heroSave(STANDARD, "Old timer"), city: old };
    const rec = cityRecord(save);
    expect(rec.tasks.frontrun).toBeUndefined();
    const start = roamStartFrom(rec);
    expect(start.stage).toEqual([TASK_DONE, TASK_DONE, 2, 1, 0]);
    expect(start.items).toEqual([0, 0, 0b1011, 0b1, 0]);
    // An outing from it plays, and files back with the old progress intact.
    const run = startRoamRun(start);
    steps(run, IDLE, 5);
    const filed = applyOuting(save, roamOuting(run));
    expect(filed.record.tasks).toEqual(old.tasks);
    expect(filed.gains.xp).toBe(0);
    // A four-entry start (an older client's) still builds a five-task outing.
    const s = createRoamSim({ ...freshStart(), stage: [TASK_DONE, 0, 0, 0], items: [0, 0, 0, 0] });
    expect(s.roam!.progress.stage).toEqual([TASK_DONE, 0, 0, 0, 0]);
    expect(s.roam!.progress.items).toEqual([0, 0, 0, 0, 0]);
  });

  it("pays the task's XP once on the win, and nothing for the gates on a loss", () => {
    const save = heroSave(STANDARD, "Racer");
    const won = play(atStall(), frontrunRace(w, "good"));
    const first = applyOuting(save, roamOuting(won.run));
    expect(first.gains.tasks).toEqual(["frontrun"]);
    expect(first.record.tasks.frontrun).toBe(TASK_DONE);
    expect(applyOuting(first.save, roamOuting(won.run)).gains.xp).toBe(0);
    const lost = play(atStall(), [...frontrunRace(w, "jog"), { kind: "wait", ticks: 600 }], 60 * 40, (run) => run.sim.roam!.race.state === 0 && run.sim.tick > 10);
    const l = applyOuting(save, roamOuting(lost.run));
    expect(l.gains.tasks).toEqual([]);
    expect(l.record.tasks.frontrun).toBe(1);
  });
});

describe("Front-run is deterministic", () => {
  it("plays and replays the same race frame for frame", () => {
    const a = play(atStall(), frontrunRace(w, "good"));
    const b = play(atStall(), frontrunRace(w, "good"));
    expect(b.run.codes).toEqual(a.run.codes);
    expect(roamHashState(b.run.sim)).toBe(roamHashState(a.run.sim));
    const log = roamLog(a.run);
    expect(replayRoam({ start: atStall(), log }).hash).toBe(replayRoam({ start: atStall(), log }).hash);
  });

  it("puts Sandwich Man in the same place for the same clock, and hashes the race", () => {
    const p1 = rivalAt(c, 5.4321, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fz: 0, seg: 0, gates: 0, move: "run" });
    const p2 = rivalAt(c, 5.4321, { x: 9, y: 9, z: 9, vx: 9, vy: 9, vz: 9, fx: 9, fz: 9, seg: 9, gates: 9, move: "won" });
    expect(p2).toEqual(p1);
    const run = startRoamRun(atStall());
    steps(run, IDLE);
    steps(run, ACT);
    const h = roamHashState(run.sim);
    run.sim.roam!.race.t += 1;
    expect(roamHashState(run.sim)).not.toBe(h);
    // Sprinting changes the run (the input is the outing).
    const other = startRoamRun(atStall());
    steps(other, IDLE);
    steps(other, ACT);
    stepRoamRun(other, { ...IDLE, shot: SHOT_SPRINT });
    stepRoamRun(run, IDLE);
    expect(roamHashState(other.sim)).not.toBe(roamHashState(run.sim));
  });
});
