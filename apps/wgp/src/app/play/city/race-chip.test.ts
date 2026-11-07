/** Front-run's race chip (hud.tsx raceChipText): the score, who's ahead, how it ended, how to go again. */
import { describe, expect, it } from "vitest";

import type { RoamHud } from "@/game3d/session/roam-loop";

import { raceChipText } from "./hud";

const hud = (race: RoamHud["race"], stage = 1): RoamHud => ({
  status: "live",
  move: "ground",
  sprint: false,
  act: null,
  chat: null,
  tasks: ["bread", "pickpocket", "pixels", "graffiti", "frontrun"].map((id) => ({ id, stage: id === "frontrun" ? stage : 0, got: 0 })),
  pages: 0,
  pagesOf: 12,
  views: 0,
  viewsOf: 5,
  zip: false,
  ticks: 0,
  race,
});

describe("the race chip", () => {
  it("scores the race as the spec words it, and says who's ahead in words (not colour alone)", () => {
    expect(raceChipText(hud({ heroGate: 3, rivalGate: 4, of: 6, over: null, why: null }))).toEqual({ tone: "race", title: "Gate 3 of 6 · Sandwich Man: gate 4", detail: "He’s ahead" });
    expect(raceChipText(hud({ heroGate: 5, rivalGate: 2, of: 6, over: null, why: null }))?.detail).toBe("You’re ahead");
    expect(raceChipText(hud({ heroGate: 2, rivalGate: 2, of: 6, over: null, why: null }))?.detail).toBe("Neck and neck");
  });

  it("says how it ended, and how to go again between tries", () => {
    expect(raceChipText(hud({ heroGate: 6, rivalGate: 5, of: 6, over: "won", why: null }))?.title).toBe("Order filled");
    expect(raceChipText(hud({ heroGate: 4, rivalGate: 6, of: 6, over: "lost", why: "rival" }))?.title).toBe("Sandwich Man filled it first");
    expect(raceChipText(hud({ heroGate: 4, rivalGate: 3, of: 6, over: "lost", why: "river" }))?.title).toBe("The parcel’s in the river");
    expect(raceChipText(hud(null, 1))?.detail).toBe("Talk to Gwei Stacy to race again");
    expect(raceChipText(hud(null, 0))).toBeNull();
    expect(raceChipText(hud(null, 9))).toBeNull();
  });
});
