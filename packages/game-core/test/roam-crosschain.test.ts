/**
 * Cross-chain (roam-3, sim3d/roam/task-crosschain.ts), Uncle Gen's side task: Doc Octochain's four
 * relays on the city's highest points, each unplugged by holding interact 1.5 s within reach.
 *
 * - Where they are: the crane's apex, the bridge's two towers, the tallest building's antenna,
 *   solid as drawn; and each one reached by the scripted bot climbing from the street with the
 *   movement set as it is.
 * - The stages: Uncle Gen's briefing (0 → 1), the reminder, the speech (2 → done), the bread still first.
 * - The hold: RELAY_HOLD ticks, not one fewer; two sparks that shove him a step; a let-go resets it;
 *   a held interact still talks only once.
 * - The whole task in one outing through the real replay, deterministic, and its map marks.
 */
import { describe, expect, it } from "vitest";

import { applyOuting, FOLKS, lineText, roamStartFrom, cityRecord } from "../src/rules/city";
import { encodeInputCodes, decodeInputLog, encodeInputLog } from "../src/input/log";
import { replayRoam, roamLog, roamOuting, roamRunHash, startRoamRun, stepRoamRun, type RoamRunEvent } from "../src/roam-run";
import { newRenderFrame } from "../src/sim3d";
import { crosschainTour, newRoamBot, relayClimb, roamBotFrame, type RoamBotGoal } from "../src/sim3d/roam/bot";
import { ROAM_OLD_LOG_RULESETS, SHOT_ACT, SHOT_JUMP, TASK_XP } from "../src/sim3d/roam/constants";
import { fillRoamFrame } from "../src/sim3d/roam/render";
import { RELAY_HOLD, RELAY_REACH, RELAY_SPARKS } from "../src/sim3d/roam/task-crosschain";
import { actTarget } from "../src/sim3d/roam/tasks";
import { TASK_DONE, TASK_IDS, type RoamStart } from "../src/sim3d/roam/types";
import { clearAt, roamCity, roamGrid, roamWorld } from "../src/sim3d/roam/world";
import { heroSave, STANDARD } from "./helpers";
import { at, playRoam, quiet } from "./roam-helpers";

const world = roamWorld();
const city = roamCity();
const CX = TASK_IDS.indexOf("crosschain");
const folk = (key: string) => world.folks.find((f) => f.key === key)!;
const relay = (key: string) => world.relays.find((r) => r.key === key)!;
const IDLE = { dir: 0, mag: 0, web: false, shot: 0 } as const;
const ACT = { dir: 0, mag: 0, web: false, shot: SHOT_ACT } as const;
const JUMP = { dir: 0, mag: 0, web: false, shot: SHOT_JUMP } as const;

/** A start with Cross-chain at `stage` and the relays `items` already unplugged. */
const cross = (stage: number, items = 0): Partial<RoamStart> => {
  const st = TASK_IDS.map(() => 0);
  const it = TASK_IDS.map(() => 0);
  st[CX] = stage;
  it[CX] = items;
  return { stage: st, items: it };
};

/** On the tallest building's top, in front of the antenna's relay (a roomy roof: the hold tests). */
const atAntenna = (stage = 1, items = 0) => {
  const r = relay("antenna");
  return at(r.x + r.fx * 34, 795.7711192779243, r.z + r.fz * 34, -r.fx, -r.fz, cross(stage, items));
};

const relayEvents = (events: RoamRunEvent[]) => events.filter((e) => e.type === "roam-relay").map((e) => (e.type === "roam-relay" ? e.state : ""));

describe("Cross-chain: Doc Octochain's relays", () => {
  it("bolts four relays to the city's highest points, solid as drawn", () => {
    expect(world.relays.map((r) => r.key)).toEqual(["crane", "bridge", "antenna", "deck"]);
    const uncle = folk("uncle");
    // The crane by Uncle Gen: on its apex (furniture.ts: the pole over the jibs, top + 12 to + 52).
    const cranes = city.props.filter((p) => p.kind === "crane").sort((a, b) => Math.hypot(a.at.x - uncle.x, a.at.z - uncle.z) - Math.hypot(b.at.x - uncle.x, b.at.z - uncle.z));
    const c = relay("crane");
    expect([c.x, c.z]).toEqual([cranes[0].at.x, cranes[0].at.z]);
    expect(c.y - c.hy).toBeCloseTo(cranes[0].at.y + cranes[0].h + 52, 6);
    // Doc's bridge: one on each tower's cap (from the legs' top, 24 thick), one per bank.
    const br = city.bridge!;
    const capTop = Math.min(...br.towers.map((t) => t.y)) + 24;
    for (const k of ["bridge", "deck"]) expect(relay(k).y - relay(k).hy).toBeCloseTo(capTop, 6);
    expect(relay("bridge").x).toBeLessThan(city.river!.x0);
    expect(relay("deck").x).toBeGreaterThan(city.river!.x1);
    // The tallest building's antenna: near its top, on the building that stands highest.
    const top = Math.max(...city.buildings.map((b) => (b.top ? b.top.h : b.h)));
    const a = relay("antenna");
    expect(a.y - a.hy).toBeGreaterThan(top);
    // All of them high up, and solid in roam's grid (the hero meets them as drawn).
    const grid = roamGrid(city);
    for (const r of world.relays) {
      expect(r.y, r.key).toBeGreaterThan(700);
      expect(clearAt(grid, r.x, r.y, r.z, 3), r.key).toBe(false);
    }
  });

  it.each(["crane", "bridge", "antenna", "deck"] as const)("the bot climbs from the street to the %s relay and unplugs it", (key) => {
    const route = relayClimb(world, key);
    const first = route[0] as Extract<RoamBotGoal, { kind: "go" }>;
    const p = playRoam(at(first.x, 0, first.z, 1, 0, cross(1)), [...route, { kind: "act", hold: RELAY_HOLD + 5 }, { kind: "wait", ticks: 5 }], 60 * 60);
    expect(p.finished, key).toBe(true);
    const i = world.relays.findIndex((r) => r.key === key);
    const done = p.events.find(({ e }) => e.type === "roam-relay" && e.state === "unplugged");
    expect(done?.e.type === "roam-relay" && done.e.relay).toBe(i);
    expect(p.run.sim.roam!.progress.items[CX]).toBe(1 << i);
    // A climb from the street, up to where the relay is (hanging off a bridge tower's cap).
    expect(p.moves).toContain("climb");
    expect(p.run.sim.hero.y).toBeGreaterThan(600);
    if (key === "bridge" || key === "deck") expect(p.run.sim.roam!.body.move).toBe("hang");
    expect(p.unhurt).toBe(true);
  });
});

describe("Cross-chain: the stages", () => {
  const talk = (start: RoamStart) => {
    const run = startRoamRun(start);
    stepRoamRun(run, IDLE);
    const events = stepRoamRun(run, ACT);
    const said = events.find((e) => e.type === "roam-talk");
    return { run, events, line: said?.type === "roam-talk" ? said.line : -1 };
  };
  const beside = (base: Partial<RoamStart>) => {
    const u = folk("uncle");
    return at(u.x + 60, u.y, u.z, -1, 0, base);
  };

  it("Uncle Gen hands it out, counts what's left, and takes the relays back with a speech", () => {
    const one = talk(beside(cross(0)));
    expect(one.events.some((e) => e.type === "roam-task" && e.task === "crosschain" && e.stage === 1)).toBe(true);
    expect(lineText("uncle", one.line)).toMatch(/Doc Octochain bolted relays/);
    // Under way: the reminder, with what's left to unplug for {left}.
    const two = talk(beside(cross(1, 0b0101)));
    const frame = fillRoamFrame(two.run.sim, newRenderFrame());
    expect(frame.roam!.chat!.left).toBe(2);
    expect(lineText("uncle", two.line, frame.roam!.chat!.left)).toBe("Still 2 to go. Hold the plug till it gives. They spark; you don’t let go.");
    expect(two.run.sim.roam!.progress.stage[CX]).toBe(1);
    // All four down: the speech, and it's done.
    const three = talk(beside(cross(2, 0b1111)));
    expect(three.events.some((e) => e.type === "roam-task" && e.task === "crosschain" && e.done)).toBe(true);
    expect(lineText("uncle", three.line)).toMatch(/With great power comes great gas fees/);
    // After: the season's arc (the Right-Clicker's Downloads).
    expect(lineText("uncle", talk(beside(cross(TASK_DONE, 0b1111))).line)).toMatch(/Downloads/);
  });

  it("still takes Aunt Mainnet's bread first when the loaf's in hand", () => {
    const base = cross(0);
    base.stage![TASK_IDS.indexOf("bread")] = 1;
    const one = talk(beside(base));
    expect(one.events.some((e) => e.type === "roam-task" && e.task === "bread" && e.done)).toBe(true);
    expect(one.run.sim.roam!.progress.stage[CX]).toBe(0);
    const two = talk(beside({ stage: roamOuting(one.run).stage, items: roamOuting(one.run).items }));
    expect(two.run.sim.roam!.progress.stage[CX]).toBe(1);
  });

  it("speaks in the game's voice: curly quotes, the giver's catchphrase, never a straight quote", () => {
    for (const l of FOLKS.uncle.lines) expect(l).not.toMatch(/['"]/);
    expect(FOLKS.uncle.byStage).toMatchObject({ 0: 5, 1: 6, 2: 7, [TASK_DONE]: 8 });
  });
});

describe("Cross-chain: holding interact on a relay", () => {
  it("unplugs after RELAY_HOLD ticks held and not one sooner; it sparks twice and shoves him back a step", () => {
    const run = quiet(startRoamRun(atAntenna()));
    stepRoamRun(run, IDLE);
    expect(actTarget(run.sim)).toEqual({ kind: "unplug", relay: 2 });
    const r = relay("antenna");
    const dist = () => Math.hypot(run.sim.hero.x - r.x, run.sim.hero.z - r.z);
    const d0 = dist();
    const states: string[] = [];
    const sparkAt: number[] = [];
    for (let t = 1; t < RELAY_HOLD; t++) {
      const ev = stepRoamRun(run, ACT);
      for (const s of relayEvents(ev)) {
        states.push(s);
        if (s === "spark") sparkAt.push(t);
      }
      expect(run.sim.roam!.progress.items[CX], `tick ${t}`).toBe(0);
    }
    expect(sparkAt).toEqual([...RELAY_SPARKS]);
    // The frame's ring: nearly full, on this relay.
    const frame = fillRoamFrame(run.sim, newRenderFrame());
    expect(frame.roam!.relay).toEqual({ index: 2, progress: (RELAY_HOLD - 1) / RELAY_HOLD });
    expect(frame.roam!.act).toEqual({ kind: "unplug", index: 2 });
    // Shoved back, but still in reach (a step, no more).
    expect(dist() - d0).toBeGreaterThan(4);
    expect(dist() - d0).toBeLessThan(30);
    expect(dist()).toBeLessThan(RELAY_REACH);
    const last = stepRoamRun(run, ACT);
    expect(states).toEqual(["hold", "spark", "spark"]);
    expect(relayEvents(last)).toEqual(["unplugged"]);
    expect(last.some((e) => e.type === "roam-item" && e.task === "crosschain" && e.item === 2 && e.got === 1 && e.of === 4)).toBe(true);
    expect(run.sim.roam!.progress.items[CX]).toBe(1 << 2);
    // Done with: no prompt, no ring, and holding on does nothing more.
    expect(actTarget(run.sim)).toBeNull();
    for (let t = 0; t < 30; t++) expect(relayEvents(stepRoamRun(run, ACT))).toEqual([]);
    expect(fillRoamFrame(run.sim, newRenderFrame()).roam!.relay).toBeNull();
  });

  it("letting go resets the relay: a release or a jump in the middle, and the hold starts over", () => {
    const run = quiet(startRoamRun(atAntenna()));
    stepRoamRun(run, IDLE);
    for (let t = 0; t < 60; t++) stepRoamRun(run, ACT);
    expect(run.sim.roam!.hold.ticks).toBe(60);
    expect(relayEvents(stepRoamRun(run, IDLE))).toEqual(["reset"]);
    expect(run.sim.roam!.hold).toMatchObject({ relay: -1, ticks: 0 });
    // Another 89 ticks: still plugged in. A jump tick lets go too.
    for (let t = 0; t < RELAY_HOLD - 1; t++) stepRoamRun(run, ACT);
    expect(run.sim.roam!.progress.items[CX]).toBe(0);
    expect(relayEvents(stepRoamRun(run, JUMP))).toEqual(["reset"]);
    // Back on his feet: a whole hold, unbroken, unplugs it.
    for (let t = 0; t < 60; t++) stepRoamRun(run, IDLE);
    expect(run.sim.roam!.body.move).toBe("ground");
    let unplugged = -1;
    for (let t = 1; t <= RELAY_HOLD; t++) if (relayEvents(stepRoamRun(run, ACT)).includes("unplugged")) unplugged = t;
    expect(unplugged).toBe(RELAY_HOLD);
  });

  it("a held interact talks once: a talk takes only the hold's first tick", () => {
    const b = folk("barista");
    const run = startRoamRun(at(b.x + 60, b.y, b.z, -1, 0));
    stepRoamRun(run, IDLE);
    let talks = 0;
    for (let t = 0; t < 120; t++) talks += stepRoamRun(run, ACT).filter((e) => e.type === "roam-talk").length;
    expect(talks).toBe(1);
    stepRoamRun(run, IDLE);
    talks += stepRoamRun(run, ACT).filter((e) => e.type === "roam-talk").length;
    expect(talks).toBe(2);
  });

  it("does nothing before Uncle Gen asks, or to a relay already unplugged", () => {
    for (const start of [atAntenna(0), atAntenna(1, 1 << 2)]) {
      const run = quiet(startRoamRun(start));
      stepRoamRun(run, IDLE);
      expect(actTarget(run.sim)).toBeNull();
      const before = run.sim.roam!.progress.items[CX];
      for (let t = 0; t < RELAY_HOLD + 10; t++) expect(relayEvents(stepRoamRun(run, ACT))).toEqual([]);
      expect(run.sim.roam!.progress.items[CX]).toBe(before);
    }
  });
});

describe("Cross-chain: the whole task", () => {
  const uncle = folk("uncle");
  const start = () => at(uncle.x - 60, uncle.y, uncle.z, 1, 0);
  const play = () => {
    const run = startRoamRun(start());
    const goals = crosschainTour(world);
    const mem = newRoamBot(goals);
    const events: RoamRunEvent[] = [];
    while (mem.i < goals.length && run.sim.tick < 60 * 60 * 5) events.push(...stepRoamRun(run, roamBotFrame(run.sim, mem)));
    return { run, events, finished: mem.i >= goals.length };
  };
  const tour = play();

  it("the bot plays it start to finish in one outing (traffic and all), and the server's replay agrees", () => {
    expect(tour.finished).toBe(true);
    const steps = tour.events.flatMap((e) => (e.type === "roam-task" && e.task === "crosschain" ? [`task-${e.stage}`] : e.type === "roam-relay" && e.state === "unplugged" ? [`relay-${world.relays[e.relay].key}`] : []));
    expect(steps).toEqual(["task-1", "relay-crane", "relay-antenna", "relay-deck", "relay-bridge", "task-2", `task-${TASK_DONE}`]);
    const log = roamLog(tour.run);
    const res = replayRoam({ start: start(), log });
    expect(res.ok, res.reason).toBe(true);
    expect(res.outing.stage[CX]).toBe(TASK_DONE);
    expect(res.outing.items[CX]).toBe(0b1111);
    expect(res.hash).toBe(roamRunHash(tour.run));
    expect(res.checkpoints).toEqual(tour.run.checkpoints);
    // Filed into a save: 40 XP, once.
    const save = heroSave(STANDARD, "Roamer");
    const first = applyOuting(save, res.outing);
    expect(first.gains.tasks).toEqual(["crosschain"]);
    expect(first.gains.xp).toBe(TASK_XP);
    expect(applyOuting(first.save, res.outing).gains.xp).toBe(0);
    expect(roamStartFrom(cityRecord(first.save)).stage[CX]).toBe(TASK_DONE);
  });

  it("is deterministic: the same frames again; a let-go in the middle of a hold leaves that relay plugged in", () => {
    const again = play();
    expect(again.run.codes).toEqual(tour.run.codes);
    expect(roamRunHash(again.run)).toBe(roamRunHash(tour.run));
    // One frame of the crane's hold sent without interact: the hold starts over and runs out short.
    const decoded = decodeInputLog(roamLog(tour.run));
    const holdAt = tour.run.codes.findIndex((_, i) => decoded.frames[i].shot === SHOT_ACT && decoded.frames[i + 1]?.shot === SHOT_ACT);
    decoded.frames[holdAt + 45] = { ...decoded.frames[holdAt + 45], shot: 0 };
    const res = replayRoam({ start: start(), log: encodeInputLog(decoded) });
    expect(res.ok).toBe(true);
    expect(res.outing.items[CX] & 1).toBe(0);
    expect(res.outing.stage[CX]).toBe(1);
  });

  it("refuses the same frames under roam-2's log field (stale, a fresh outing from the record)", () => {
    for (const old of ROAM_OLD_LOG_RULESETS) {
      const res = replayRoam({ start: start(), log: encodeInputCodes(tour.run.codes, [], 0, old) });
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/older free roam's \(stale\)/);
    }
  });

  it("marks the relays for the map while it's under way, the nearest one still plugged in next", () => {
    const marks = (start: RoamStart) => {
      const run = quiet(startRoamRun(start));
      stepRoamRun(run, IDLE);
      return fillRoamFrame(run.sim, newRenderFrame()).roam!.marks!.map((m) => ({ ...m, pos: { ...m.pos } }));
    };
    expect(marks(atAntenna(0))).toEqual([]);
    const on = marks(atAntenna(1, 1 << 0));
    expect(on.map((m) => [m.task, m.kind, m.done, m.next])).toEqual([
      ["crosschain", "relay", true, false],
      ["crosschain", "relay", false, false],
      ["crosschain", "relay", false, true],
      ["crosschain", "relay", false, false],
    ]);
    expect(on[2].pos).toEqual({ x: relay("antenna").x, y: relay("antenna").y, z: relay("antenna").z });
    // Stage 2: all done, nothing next (the map points at Uncle Gen). Done: no marks.
    expect(marks(atAntenna(2, 0b1111)).map((m) => [m.done, m.next])).toEqual(Array(4).fill([true, false]));
    expect(marks(atAntenna(TASK_DONE, 0b1111))).toEqual([]);
  });
});
