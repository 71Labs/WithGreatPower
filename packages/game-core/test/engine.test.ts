import { describe, expect, it } from "vitest";

import { ERRANDS } from "../src/rules/data";
import { moveBlocked, newSave, reduce, seedOf } from "../src/rules/engine";
import type { MoveId, Save } from "../src/rules/types";

/** Plays whole nights through the reducer with a fixed, simple strategy. */
function playNights(nights: number): Save {
  let s = reduce(newSave(), { type: "create-hero", name: "Test Hero", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
  for (let n = 0; n < nights; n++) {
    s = reduce(s, { type: "start-patrol" });
    for (let guard = 0; s.patrol && s.patrol.phase !== "summary" && guard < 500; guard++) {
      const p = s.patrol;
      if (p.phase === "swing") s = reduce(s, { type: "swing", grade: (n + p.index) % 3 === 0 ? "perfect" : "good" });
      else if (p.fight && !p.fight.result) {
        const move = (["web-sling", "node-sense", "web-shield"] as MoveId[]).find((m) => !moveBlocked(s, m)) ?? "punch";
        s = reduce(s, { type: "move", move });
      } else if (p.stops[p.index].kind === "errand" && p.results.length <= p.index) {
        const stop = p.stops[p.index] as { errand: string };
        s = reduce(s, { type: "errand", choice: ERRANDS.find((e) => e.id === stop.errand)!.choices[0].id });
      } else s = reduce(s, { type: "leave-stop" });
    }
    s = reduce(s, { type: "finish-patrol" });
    s = reduce(s, { type: "sleep" });
  }
  return s;
}

describe("the rules reducer", () => {
  it("is deterministic: the same inputs give the same save", () => {
    expect(JSON.stringify(playNights(6))).toBe(JSON.stringify(playNights(6)));
  });

  it("matches the recorded outcome of six nights", () => {
    const s = playNights(6);
    expect({
      night: s.night,
      level: s.hero?.level,
      xp: s.hero?.xp,
      reputation: s.reputation,
      stats: s.stats,
      inventory: s.inventory,
      headlines: s.editions.map((e) => e.headline),
    }).toMatchSnapshot();
  });

  it("seeds patrols from the night and the hero name", () => {
    expect(seedOf(3, "Test Hero")).toBe(seedOf(3, "Test Hero"));
    expect(seedOf(3, "Test Hero")).not.toBe(seedOf(4, "Test Hero"));
  });

  it("ignores actions that don't apply", () => {
    const s = newSave();
    expect(reduce(s, { type: "start-patrol" })).toBe(s);
    expect(reduce(s, { type: "sleep" })).toBe(s);
  });
});
