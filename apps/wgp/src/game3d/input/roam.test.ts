import { describe, expect, it } from "vitest";

import { SHOT_ACT, SHOT_JUMP, SHOT_SPRINT, SHOT_ZIP } from "@wgp/game-core/sim3d/roam";

import { ROAM_KEY_RAMP, ROAM_KEYS, roamActionFor, RoamLatch } from "./roam";

const VIEW = { fx: 0, fz: -1 };

describe("free roam's latch", () => {
  it("maps the keys: WASD, Shift sprint, Space jump, F web, Q zip, E act, X drop, C walk", () => {
    expect(roamActionFor("Space")).toBe("jump");
    expect(roamActionFor("ShiftLeft")).toBe("sprint");
    expect(roamActionFor("KeyF")).toBe("web");
    expect(roamActionFor("KeyQ")).toBe("zip");
    expect(roamActionFor("KeyE")).toBe("act");
    expect(roamActionFor("KeyX")).toBe("drop");
    expect(roamActionFor("KeyC")).toBe("walk");
    expect(roamActionFor("KeyZ")).toBeNull();
    expect(Object.values(ROAM_KEYS)).toContain("map");
  });

  it("ramps held keys from a walk to full tilt, and C keeps it a walk", () => {
    const l = new RoamLatch();
    l.setKeys(0, 1, 10);
    expect(l.take(VIEW, 10).mag).toBe(1);
    expect(l.take(VIEW, 10 + ROAM_KEY_RAMP + 0.01).mag).toBe(3);
    l.walk = true;
    expect(l.take(VIEW, 11).mag).toBe(1);
  });

  it("queues one-shots a tick each, and sends sprint every tick it's held while moving", () => {
    const l = new RoamLatch();
    l.setKeys(0, 1, 0);
    l.setSprint("key", true);
    l.push(SHOT_JUMP);
    l.push(SHOT_ZIP);
    l.push(SHOT_ACT);
    expect([l.take(VIEW, 1).shot, l.take(VIEW, 1).shot, l.take(VIEW, 1).shot, l.take(VIEW, 1).shot, l.take(VIEW, 1).shot]).toEqual([SHOT_JUMP, SHOT_ZIP, SHOT_ACT, SHOT_SPRINT, SHOT_SPRINT]);
    // Standing still, sprint sends nothing.
    l.setKeys(0, 0, 2);
    expect(l.take(VIEW, 2).shot).toBe(0);
    l.setSprint("key", false);
    l.setKeys(0, 1, 3);
    expect(l.take(VIEW, 3).shot).toBe(0);
  });

  it("roam-3: holds interact every tick it's down (a tap still a tick), over sprint, after queued presses", () => {
    const l = new RoamLatch();
    l.setKeys(0, 1, 0);
    l.setSprint("key", true);
    // A tap shorter than a tick: one tick of interact, then sprint again.
    l.setAct("key", true);
    l.setAct("key", false);
    expect([l.take(VIEW, 1).shot, l.take(VIEW, 1).shot]).toEqual([SHOT_ACT, SHOT_SPRINT]);
    // Held: interact every tick (the relay's hold), even with sprint held; a key repeat queues nothing more.
    l.setAct("key", true);
    l.setAct("key", true);
    expect([l.take(VIEW, 2).shot, l.take(VIEW, 2).shot, l.take(VIEW, 2).shot]).toEqual([SHOT_ACT, SHOT_ACT, SHOT_ACT]);
    // A jump in the middle takes its tick (and lets go of the hold in the sim); the touch button holds too.
    l.push(SHOT_JUMP);
    l.setAct("touch", true);
    l.setAct("key", false);
    expect([l.take(VIEW, 3).shot, l.take(VIEW, 3).shot, l.take(VIEW, 3).shot]).toEqual([SHOT_JUMP, SHOT_ACT, SHOT_ACT]);
    l.setAct("touch", false);
    expect(l.take(VIEW, 4).shot).toBe(SHOT_SPRINT);
    expect(l.acting).toBe(false);
    // Pausing or a lost focus lets go.
    l.setAct("key", true);
    l.clear();
    expect(l.take(VIEW, 5).shot).toBe(0);
  });

  it("holds the web while any source holds it, and lets go of everything on clear", () => {
    const l = new RoamLatch();
    l.base.setWeb("key", true);
    l.base.setWeb("mouse", true);
    l.base.setWeb("key", false);
    expect(l.take(VIEW, 0).web).toBe(true);
    l.clear();
    expect(l.take(VIEW, 0)).toEqual({ dir: 0, mag: 0, web: false, shot: 0 });
  });
});
