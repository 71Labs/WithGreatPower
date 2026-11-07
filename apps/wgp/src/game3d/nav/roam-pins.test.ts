import { describe, expect, it } from "vitest";

import { TASK_DONE } from "@wgp/game-core/city";
import { roamWorld } from "@wgp/game-core/sim3d/roam";

import { marksFixture, roamFrameFixture } from "./roam-fixture";
import { markName, roamPins, taskTarget, trackedTask, whereLine } from "./roam-pins";

const w = roamWorld();
const giver = (id: string) => w.folks.find((f) => f.gives === id)!;
const taker = (id: string) => w.folks.find((f) => f.takes === id)!;
const spawn = { x: w.spawn.x, y: w.spawn.y, z: w.spawn.z };

describe("free roam's task targets", () => {
  it("points at the giver until a task's picked up, and at nothing once it's done", () => {
    const r = roamFrameFixture(w);
    expect(taskTarget("bread", r, spawn, w)).toMatchObject({ kind: "folk", who: "Aunt Mainnet", at: { x: giver("bread").x, z: giver("bread").z } });
    const done = roamFrameFixture(w, { stage: { bread: TASK_DONE } });
    expect(taskTarget("bread", done, spawn, w)).toBeNull();
  });

  it("points at the hand-in once there's something to hand in", () => {
    const r = roamFrameFixture(w, { stage: { bread: 1, pixels: 2 } });
    expect(taskTarget("bread", r, spawn, w)).toMatchObject({ kind: "folk", who: "Uncle Gen", at: { x: taker("bread").x } });
    expect(taskTarget("pixels", r, spawn, w)?.who).toBe("Mary Jpeg");
  });

  it("points at the nearest pixel or tag still to find (it used to point at nothing)", () => {
    const r = roamFrameFixture(w, { stage: { pixels: 1, graffiti: 1 }, got: { pixels: 3, graffiti: 1 } });
    const t = taskTarget("pixels", r, spawn, w)!;
    expect(t.kind).toBe("pixel");
    const open = r.pixels.filter((p) => !p.found).map((p) => Math.hypot(p.pos.x - spawn.x, p.pos.z - spawn.z));
    expect(Math.hypot(t.at.x - spawn.x, t.at.z - spawn.z)).toBeCloseTo(Math.min(...open));
    expect(taskTarget("graffiti", r, spawn, w)).toMatchObject({ kind: "tag", who: "the nearest tag" });
  });

  it("follows the pickpocket bot while it runs", () => {
    const bot = { x: 1234, y: 300, z: 2345 };
    const r = roamFrameFixture(w, { stage: { pickpocket: 1 }, bot });
    expect(taskTarget("pickpocket", r, spawn, w)).toMatchObject({ kind: "bot", at: bot });
    expect(taskTarget("pickpocket", roamFrameFixture(w, { stage: { pickpocket: 1 } }), spawn, w)).toBeNull();
  });

  it("points at the task's next mark when it has one (v1.9 marks), else its nearest open one", () => {
    const gates = marksFixture("gate", "pickpocket", spawn, { passed: 2 });
    const r = roamFrameFixture(w, { stage: { pickpocket: 1 }, marks: gates, bot: { x: 0, y: 0, z: 0 } });
    expect(taskTarget("pickpocket", r, spawn, w)).toMatchObject({ kind: "gate", who: "gate 3", at: gates[2].pos });
    const unflagged = gates.map((g) => ({ ...g, next: false }));
    const t = taskTarget("pickpocket", roamFrameFixture(w, { stage: { pickpocket: 1 }, marks: unflagged }), { x: gates[4].pos.x + 10, y: 0, z: gates[4].pos.z }, w);
    expect(t?.who).toBe("gate 5");
    const relays = marksFixture("relay", "graffiti", spawn, { unplugged: 1 });
    expect(taskTarget("graffiti", roamFrameFixture(w, { stage: { graffiti: 1 }, marks: relays }), spawn, w)).toMatchObject({ kind: "relay", who: "the next relay" });
  });

  it("ignores another task's marks, and falls back once every mark is done", () => {
    const gates = marksFixture("gate", "pickpocket", spawn, { passed: 6 });
    const r = roamFrameFixture(w, { stage: { pickpocket: 2, bread: 1 }, marks: gates });
    expect(taskTarget("pickpocket", r, spawn, w)?.kind).toBe("folk");
    expect(taskTarget("bread", r, spawn, w)?.who).toBe("Uncle Gen");
  });

  it("names gates by their place in the race", () => {
    const gates = marksFixture("gate", "bread", spawn);
    expect(markName(gates, gates[0])).toBe("gate 1");
    expect(markName(gates, gates[5])).toBe("gate 6");
  });
});

describe("the tracked task", () => {
  const tasks = (s: Record<string, number>) => ["bread", "pickpocket", "pixels", "graffiti"].map((id) => ({ id, stage: s[id] ?? 0, got: 0 }));

  it("is the one you picked while it isn't done, a new one included", () => {
    expect(trackedTask(tasks({ bread: 1, pixels: 1 }), "pixels")).toBe("pixels");
    expect(trackedTask(tasks({}), "graffiti")).toBe("graffiti");
  });

  it("falls back to the first under way, then to none", () => {
    expect(trackedTask(tasks({ bread: TASK_DONE, pixels: 1 }), "bread")).toBe("pixels");
    expect(trackedTask(tasks({ bread: 1 }), null)).toBe("bread");
    expect(trackedTask(tasks({ bread: TASK_DONE }), null)).toBeNull();
  });
});

describe("the map's distance line", () => {
  it("says who, how far and which way", () => {
    const at = { x: spawn.x + 40 * 74, y: 0, z: spawn.z };
    expect(whereLine({ task: "pickpocket", at, who: "Dev", kind: "folk" }, spawn, false)).toBe("Stop, thief.exe: Dev is 74 m east of you.");
    expect(whereLine({ task: "pickpocket", at: spawn, who: "Dev", kind: "folk" }, spawn, false)).toBe("Stop, thief.exe: Dev is right here.");
  });

  it("orients you with nothing tracked", () => {
    expect(whereLine(null, spawn, false)).toMatch(/gold marker/);
    expect(whereLine(null, spawn, true)).toMatch(/Every task’s done/);
  });
});

describe("the map's pins", () => {
  it("shows masts, found pages and pages in synced districts, and every giver", () => {
    const r = roamFrameFixture(w, { pages: [0], views: [0] });
    const pins = roamPins(r, w, null);
    expect(pins.filter((p) => p.kind === "view")).toHaveLength(w.views.length);
    expect(pins.filter((p) => p.kind === "giver")).toHaveLength(w.folks.filter((f) => f.gives).length);
    const shown = pins.filter((p) => p.kind === "page").map((p) => Number(p.key.slice(1)));
    const expected = w.pages.map((p, i) => (i === 0 || p.district === w.views[0].district ? i : -1)).filter((i) => i >= 0);
    expect(shown.sort((a, b) => a - b)).toEqual(expected);
    expect(pins.find((p) => p.key === "p0")?.done).toBe(true);
  });

  it("pins pixels and tags only while their task is on, found ones gone", () => {
    expect(roamPins(roamFrameFixture(w), w, null).some((p) => p.kind === "pixel" || p.kind === "tag")).toBe(false);
    const pins = roamPins(roamFrameFixture(w, { stage: { pixels: 1, graffiti: 1 }, got: { pixels: 2 } }), w, "pixels");
    expect(pins.filter((p) => p.kind === "pixel")).toHaveLength(w.pixels.length - 2);
    expect(pins.filter((p) => p.kind === "tag")).toHaveLength(w.tags.length);
    expect(pins.filter((p) => p.kind === "pixel").every((p) => p.tracked)).toBe(true);
    expect(pins.filter((p) => p.kind === "tag").every((p) => !p.tracked)).toBe(true);
  });

  it("pins every mark with its order, done state and the next one, and labels them in words", () => {
    const gates = marksFixture("gate", "bread", spawn, { passed: 2 });
    const relays = marksFixture("relay", "graffiti", spawn, { unplugged: 1 });
    const pins = roamPins(roamFrameFixture(w, { stage: { bread: 1, graffiti: 1 }, marks: [...gates, ...relays] }), w, "bread");
    const g = pins.filter((p) => p.kind === "gate");
    expect(g.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g.map((p) => p.done)).toEqual([true, true, false, false, false, false]);
    expect(g.find((p) => p.next)?.order).toBe(3);
    expect(g[0].label).toBe("Gate 1, passed");
    expect(g.every((p) => p.tracked)).toBe(true);
    const r = pins.filter((p) => p.kind === "relay");
    expect(r).toHaveLength(4);
    expect(r.filter((p) => p.done)).toHaveLength(1);
    expect(r.find((p) => p.done)?.label).toBe("A relay, unplugged");
    expect(r.every((p) => !p.tracked)).toBe(true);
  });

  it("draws the tracked task's pins on top", () => {
    const pins = roamPins(roamFrameFixture(w, { stage: { pixels: 1 } }), w, "pixels");
    const firstTracked = pins.findIndex((p) => p.task && p.tracked);
    expect(pins.slice(firstTracked).every((p) => p.task && p.tracked)).toBe(true);
    expect(pins.at(-1)?.kind).toBe("giver");
  });

  it("marks a finished task's giver done", () => {
    const pins = roamPins(roamFrameFixture(w, { stage: { bread: TASK_DONE } }), w, null);
    const aunt = pins.find((p) => p.kind === "giver" && p.task === "bread")!;
    expect(aunt.done).toBe(true);
    expect(aunt.label).toBe("Aunt Mainnet: Still warm, done");
  });
});
