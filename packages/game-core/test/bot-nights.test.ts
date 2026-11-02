import { describe, expect, it } from "vitest";

import { finishRun, replayRun, runLog } from "../src/replay";
import { VILLAINS } from "../src/rules/data";
import { reduce } from "../src/rules/engine";
import type { PowerId, Save, Stop, VillainId } from "../src/rules/types";
import { MAX_LOG_BYTES } from "../src/input/log";
import { heroSave, HEAVY, playBot, SLAMMER, STANDARD } from "./helpers";

const PREFER: PowerId[] = ["web-bomb", "validator-slam", "front-run", "zk-cloak", "gas-refund", "fork", "yank", "finality", "wall-crawl", "node-sense", "web-shield"];

/** Between nights: take a pending power, and a balanced loadout (attack, defence, heal). */
function levelUp(save: Save): Save {
  let s = save;
  const h = s.hero!;
  if (h.pendingPicks > 0) {
    const p = PREFER.find((id) => !h.powers[id]);
    if (p) s = reduce(s, { type: "pick-power", power: p });
  }
  const has = (id: PowerId) => !!s.hero!.powers[id];
  const pick = (ids: PowerId[]) => ids.find(has);
  const loadout = [...new Set(["web-sling", pick(["web-bomb", "validator-slam", "front-run"]), pick(["zk-cloak", "web-shield"]), pick(["wall-crawl", "gas-refund"])].filter(Boolean) as PowerId[])];
  for (const id of PREFER) if (loadout.length < 4 && has(id) && !loadout.includes(id)) loadout.push(id);
  return reduce(reduce(s, { type: "set-loadout", loadout }), { type: "sleep" });
}

describe("the bot through 30 nights, verified by replay", () => {
  it("clears every night with no NaN, every encounter finished, sensible durations, and replays to the same hash", () => {
    let save = reduce(heroSave(["web-sling", "web-shield", "wall-crawl"], "Thirty Nights"), { type: "set-loadout", loadout: ["web-sling", "web-shield", "wall-crawl"] });
    let fights = 0;
    let won = 0;
    const beaten = new Set<string>();
    for (let night = 1; night <= 30; night++) {
      const seed = Math.imul(night, 0x9e3779b1) >>> 0;
      const played = playBot(save, seed, { errand: (run) => run.sim.tick % 2 });
      const { run } = played;
      expect(played.nanAt, `night ${night}: NaN at tick ${played.nanAt}`).toBeNull();
      expect(run.error, `night ${night}`).toBeNull();
      expect(run.over, `night ${night}: the night ended`).toBe(true);
      expect(run.save.patrol!.phase, `night ${night}`).toBe("summary");
      // Every stop got an outcome (a knockout ends the night early).
      const p = run.save.patrol!;
      expect(p.results.length === p.stops.length || p.knockedOut, `night ${night}: stops finished`).toBe(true);
      const seconds = run.sim.tick / 60;
      expect(seconds, `night ${night}: duration`).toBeGreaterThan(30);
      expect(seconds, `night ${night}: duration`).toBeLessThan(480);
      for (const seg of played.segments) expect(seg, `night ${night}: a stop took ${seg.toFixed(0)} s to reach`).toBeLessThan(120);
      for (const f of played.fights) {
        fights += 1;
        if (f.won) {
          won += 1;
          beaten.add(f.villain);
        }
        expect(f.seconds, `night ${night}: ${f.villain} took ${f.seconds.toFixed(0)} s`).toBeLessThan(150);
      }

      // The server's verdict on the recorded log matches the live run exactly.
      const log = runLog(run);
      expect(log.length).toBeLessThan(MAX_LOG_BYTES);
      const verified = replayRun({ save: run.start, seed, log });
      const live = finishRun(run);
      expect(verified.ok, verified.reason).toBe(true);
      expect(verified.hash).toBe(live.hash);
      expect(verified.checkpoints).toEqual(live.checkpoints);
      expect(verified.score).toBe(live.score);
      expect(verified.ticks).toBe(live.ticks);
      expect(JSON.stringify(verified.save)).toBe(JSON.stringify(live.save));
      expect((verified.save as Save).nightDone).toBe(true);
      save = levelUp(verified.save as Save);
    }
    expect(won / fights).toBeGreaterThanOrEqual(0.9);
    expect([...beaten].sort()).toEqual(Object.keys(VILLAINS).sort());
  });
});

describe("every villain is beatable", () => {
  const villains = Object.keys(VILLAINS) as VillainId[];
  for (const v of villains) {
    it(`${VILLAINS[v].name}, at level 1 and as a level 5 boss, with every loadout`, () => {
      for (const [name, loadout] of [
        ["standard", STANDARD],
        ["heavy", HEAVY],
        ["slam-only", SLAMMER],
      ] as const) {
        const stops: Stop[] = [
          { kind: "fight", villain: v, district: VILLAINS[v].district, level: 1, boss: false, quest: false },
          { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
          { kind: "errand", ally: "gwei", errand: "team-up", district: "validator-heights" },
          { kind: "fight", villain: v, district: VILLAINS[v].district, level: 5, boss: true, quest: true },
        ];
        const started = reduce(heroSave(loadout, `Boss ${v}`), { type: "start-patrol", seed: 7 });
        const save = { ...started, patrol: { ...started.patrol!, stops } };
        const played = playBot(save, 7, { trustPatrol: true });
        expect(played.nanAt).toBeNull();
        expect(played.run.over, `${v} ${name}: the night ended`).toBe(true);
        expect(played.fights.map((f) => f.won), `${v} ${name}`).toEqual([true, true]);
        // With no attack power you can only slam, and the bot is a clumsy slammer.
        const limit = loadout === SLAMMER ? 240 : 150;
        for (const f of played.fights) expect(f.seconds, `${v} ${name}`).toBeLessThan(limit);
        const verified = replayRun({ save, seed: 7, log: runLog(played.run) }, { trustPatrol: true });
        expect(verified.ok, verified.reason).toBe(true);
        expect(verified.hash).toBe(finishRun(played.run).hash);
      }
    });
  }
});
