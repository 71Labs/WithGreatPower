import { describe, expect, it } from "vitest";

import { STOPS_PER_PATROL } from "../src/rules/data";
import { newSave, reduce, seedOf } from "../src/rules/engine";

const hero = () => reduce(newSave(), { type: "create-hero", name: "Seed Hero", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });

describe("start-patrol with a server seed", () => {
  it("without a seed, keeps using seedOf(night, name)", () => {
    const a = reduce(hero(), { type: "start-patrol" });
    const b = reduce(hero(), { type: "start-patrol", seed: seedOf(1, "Seed Hero") });
    expect(b.patrol).toEqual(a.patrol);
  });

  it("with a seed, the patrol is a function of that seed alone", () => {
    const a = reduce(hero(), { type: "start-patrol", seed: 111 });
    const b = reduce(hero(), { type: "start-patrol", seed: 111 });
    const c = reduce(hero(), { type: "start-patrol", seed: 222 });
    expect(b.patrol).toEqual(a.patrol);
    expect(c.patrol!.seed).not.toBe(a.patrol!.seed);
    // Players can't predict it from their name and the night.
    expect(a.patrol!.seed).not.toBe(reduce(hero(), { type: "start-patrol" }).patrol!.seed);
  });

  it("ignores the seed once a patrol exists", () => {
    const a = reduce(hero(), { type: "start-patrol", seed: 5 });
    expect(reduce(a, { type: "start-patrol", seed: 6 }).patrol).toEqual(a.patrol);
  });

  it("plans every night as two fights and two errands, the boss last", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const stops = reduce(hero(), { type: "start-patrol", seed }).patrol!.stops;
      expect(stops).toHaveLength(STOPS_PER_PATROL);
      expect(stops.filter((s) => s.kind === "fight")).toHaveLength(2);
      expect(stops.filter((s) => s.kind === "errand")).toHaveLength(2);
      const last = stops.at(-1)!;
      expect(last.kind === "fight" && last.boss, `seed ${seed}`).toBe(true);
      expect(stops.filter((s) => s.kind === "fight" && s.boss)).toHaveLength(1);
    }
  });
});
