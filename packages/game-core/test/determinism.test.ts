import { describe, expect, it } from "vitest";

import { hashState } from "../src/hash";
import { decodeInputLog, encodeInputCodes, encodeInputLog } from "../src/input/log";
import { replayRun, runLog, startRun } from "../src/replay";
import { reduce } from "../src/rules/engine";
import { RULESET_VERSION } from "../src/score";
import { createSim, stepSim } from "../src/sim3d/sim";
import { sessionStart3d } from "../src/bridge3d";
import { heroSave, playBot, STANDARD } from "./helpers";

const SEED = 0xdecaf;
const save = () => heroSave(STANDARD, "Twin", 4);

describe("determinism", () => {
  it("the same log gives the same hash, checkpoints and score, twice and after other runs", () => {
    const { run } = playBot(save(), SEED);
    const log = runLog(run);
    const a = replayRun({ save: save(), seed: SEED, log });
    // Other work in between must not leak into the next replay (shared scratch, caches).
    playBot(heroSave(STANDARD, "Someone Else", 7), 12345);
    const b = replayRun({ save: save(), seed: SEED, log });
    expect(a.ok, a.reason).toBe(true);
    expect(b).toEqual(a);
    expect(a.checkpoints).toHaveLength(4);
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("two bots on the same seed play the same night, frame for frame", () => {
    const one = playBot(save(), SEED).run;
    const two = playBot(save(), SEED).run;
    expect(two.codes).toEqual(one.codes);
    expect(two.events).toEqual(one.events);
    expect(hashState(two.sim)).toBe(hashState(one.sim));
  });

  it("a different seed is a different night, and a changed frame a different hash", () => {
    const { run } = playBot(save(), SEED);
    const log = runLog(run);
    const base = replayRun({ save: save(), seed: SEED, log });
    const other = playBot(save(), SEED + 1).run;
    expect(hashState(other.sim)).not.toBe(base.hash);
    // Flip the web on a third of a second of early frames: the replay diverges (or is refused)
    // but never matches. (One flipped frame can be a no-op since ruleset 3: a web let go for a
    // tick just after it latched on is a tap, and the press back takes the line in hand again.)
    const decoded = decodeInputLog(log);
    for (let i = 120; i < 140; i++) decoded.frames[i] = { ...decoded.frames[i], web: !decoded.frames[i].web };
    const tampered = replayRun({ save: save(), seed: SEED, log: encodeInputLog(decoded) });
    expect(tampered.hash === base.hash && tampered.score === base.score).toBe(false);
  });

  it("refuses logs that don't fit the run", () => {
    const { run } = playBot(save(), SEED);
    const log = runLog(run);
    const decoded = decodeInputLog(log);
    const reason = (bytes: Uint8Array, s = save(), seed = SEED) => replayRun({ save: s, seed, log: bytes }).reason ?? "ok";

    expect(reason(log.slice(0, log.length - 1))).toMatch(/bad log/);
    expect(reason(encodeInputLog({ ...decoded, ruleset: RULESET_VERSION + 1 }))).toMatch(/ruleset/);
    expect(reason(encodeInputLog({ ...decoded, fromTick: 5 }))).toMatch(/tick 0/);
    // Another seed is another night: the same inputs don't fit it.
    const elsewhere = replayRun({ save: save(), seed: SEED + 1, log });
    expect(elsewhere.ok && elsewhere.hash === replayRun({ save: save(), seed: SEED, log }).hash).toBe(false);
    // Cut short: it didn't finish.
    expect(reason(encodeInputLog({ frames: decoded.frames.slice(0, 120), events: [] }))).toMatch(/didn't finish/);
    // Frames after the night ended.
    const extra = encodeInputLog({ frames: [...decoded.frames, decoded.frames[0]], events: decoded.events });
    expect(reason(extra)).toMatch(/after the night ended/);
    // An errand nobody answered, and an answer at the wrong moment.
    expect(reason(encodeInputLog({ frames: decoded.frames, events: [] }))).toMatch(/never answered/);
    const shifted = decoded.events.map((e, i) => (i === 0 ? { ...e, tick: e.tick - 1 } : e));
    expect(reason(encodeInputLog({ frames: decoded.frames, events: shifted }))).toMatch(/doesn't fit/);
    // An option that doesn't exist.
    const wrong = decoded.events.map((e, i) => (i === 0 ? { ...e, value: 9 } : e));
    expect(reason(encodeInputLog({ frames: decoded.frames, events: wrong }))).toMatch(/doesn't fit/);
    // A patrol already started some other way.
    const started = reduce(save(), { type: "start-patrol" });
    expect(reason(log, started)).toMatch(/seed/);
  });

  it("an empty log stands still: nothing happens without input", () => {
    const res = replayRun({ save: save(), seed: SEED, log: encodeInputCodes([], []) });
    expect(res.ok).toBe(false);
    expect(res.ticks).toBe(0);
  });

  it("a knockout ends the night through the same path, and replays", () => {
    const played = playBot(heroSave(STANDARD, "Glass Jaw", 9), 0xbad, { idleInFights: true });
    const { run } = played;
    expect(run.over).toBe(true);
    expect(played.fights).toHaveLength(1);
    expect(played.fights[0].won).toBe(false);
    expect(run.save.patrol!.knockedOut).toBe(true);
    const res = replayRun({ save: run.start, seed: 0xbad, log: runLog(run) });
    expect(res.ok, res.reason).toBe(true);
    expect(res.stats.knockedOut).toBe(1);
    expect(res.stats.hpLeft).toBe(0);
    expect((res.save as ReturnType<typeof save>).stats.knockouts).toBe(1);
  });

  it("the sim never reads anything but its config and its frames", () => {
    const boot = sessionStart3d(reduce(save(), { type: "start-patrol", seed: SEED }));
    if (boot.kind !== "play") throw new Error(boot.kind);
    const a = createSim(boot.config);
    const b = createSim(boot.config);
    const frames = playBot(save(), SEED, { maxTicks: 3000 }).run.codes;
    for (const code of frames) {
      const f = { dir: (code & 0xff) >> 2, mag: code & 3, web: ((code >> 8) & 1) === 1, shot: ((code >> 9) & 7) as 0 };
      stepSim(a, f);
      stepSim(b, f);
      a.events.length = 0;
      b.events.length = 0;
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(startRun(save(), SEED).error).toBeNull();
  });
});
