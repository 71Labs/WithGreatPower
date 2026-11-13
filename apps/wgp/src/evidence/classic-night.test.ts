/**
 * Classic mode (/play/classic) "plays the same night turn by turn": the turn-based game and
 * the 3D night start tonight's patrol from the same seed, so they post the same four stops,
 * and a night belongs to one of them at a time. (That it is unranked is a server test: no
 * patrol step is accepted from a client.)
 */
import { describe, expect, it } from "vitest";

import { STOPS_PER_PATROL } from "@wgp/game-core/data";
import { newSave, reduce, seedOf } from "@wgp/game-core/engine";

import { beginLocal, localSeed } from "@/game3d/session/night";
import { QUICK_HERO } from "@/lib/first-minute/quick-hero";

const hero = () => reduce(newSave(), { type: "create-hero", ...QUICK_HERO });

describe("classic mode plays the same night as the 3D game", () => {
  it("starts tonight's patrol with the same four stops the 3D night has", () => {
    const save = hero();
    // Classic: the patrol screen dispatches start-patrol with no seed, so the engine uses seedOf(night, name).
    const classic = reduce(save, { type: "start-patrol" });
    // 3D, as a guest: the session starts its run from localSeed, which is that same seed.
    const night = beginLocal(save, "guest");
    expect(night).not.toBeNull();
    expect(localSeed(save)).toBe(seedOf(save.night, save.hero!.name));
    expect(classic.patrol!.seed).toBe(night!.run.save.patrol!.seed);
    expect(classic.patrol!.stops).toEqual(night!.run.save.patrol!.stops);
    expect(classic.patrol!.stops).toHaveLength(STOPS_PER_PATROL);
    expect(classic.patrol!.stops.map((s) => s.kind).sort()).toEqual(["errand", "errand", "fight", "fight"]);
  });

  it("is turn by turn: a swing is one action that lands the hero at the stop", () => {
    let save = reduce(hero(), { type: "start-patrol" });
    expect(save.patrol!.phase).toBe("swing");
    save = reduce(save, { type: "swing", grade: "good" });
    expect(save.patrol!.phase).toBe("stop");
    expect(save.patrol!.index).toBe(0);
  });

  it("shares the night: once classic has played a stop, the 3D game does not start the night over", () => {
    let save = reduce(hero(), { type: "start-patrol" });
    // Untouched, either game may take the night.
    expect(beginLocal(save, "guest")).not.toBeNull();
    save = reduce(save, { type: "swing", grade: "good" });
    expect(beginLocal(save, "guest")).toBeNull();
    // And a night that is done is done for both.
    expect(beginLocal({ ...hero(), nightDone: true }, "guest")).toBeNull();
    expect(reduce({ ...hero(), nightDone: true }, { type: "start-patrol" }).patrol).toBeNull();
  });
});
