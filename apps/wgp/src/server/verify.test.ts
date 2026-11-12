/**
 * The plausibility rules a replayed run must pass before it counts (README, "How verification
 * works", step 4). The replay itself is injected, as verify.ts is built to allow: these tests
 * are about the rules around it, and real-replay.test.ts covers game-core's replay end to end.
 */
import { RULESET_VERSION, SIM_HZ } from "@wgp/game-core/sim3d/constants";
import type { ReplayResult } from "@wgp/game-core/sim3d/contract";
import type { Save } from "@wgp/game-core/types";
import { describe, expect, it } from "vitest";

import { TRIAL_MIN_SECONDS, VERIFY_RULES, verifyRun, verifyTrialRun, type RunToVerify, type Verifier } from "./verify";

const save = { version: 1, hero: null } as unknown as Save;
const ISSUED = new Date("2026-11-12T12:00:00Z");
const after = (seconds: number) => new Date(ISSUED.getTime() + seconds * 1000);
const run: RunToVerify = { ruleset: String(RULESET_VERSION), seed: 7, startSave: save, issuedAt: ISSUED };
const log = new Uint8Array([1, 2, 3]);

/** A verifier whose replay takes `gameSeconds` of game time and ends on hash "h". */
function replaying(gameSeconds: number): Verifier & { calls: number } {
  const v = {
    ruleset: String(RULESET_VERSION),
    tickHz: SIM_HZ,
    calls: 0,
    replay: (): ReplayResult => {
      v.calls++;
      return { ok: true, score: 1234, ticks: Math.round(gameSeconds * SIM_HZ), hash: "h", save } as unknown as ReplayResult;
    },
  };
  return v;
}

const reason = async (gameSeconds: number, wallSeconds: number, clientHash = "h") => {
  const verdict = await verifyRun(run, log, clientHash, { now: after(wallSeconds), verifier: replaying(gameSeconds) });
  return verdict.ok ? "ok" : verdict.reason;
};

describe("the verifier's plausibility rules", () => {
  it("runs on the pinned ruleset at the sim's 60 Hz", () => {
    expect(VERIFY_RULES).toEqual({ minGameSeconds: 20, wallSlackSeconds: 5, maxLogBytes: 64 * 1024 });
    expect(SIM_HZ).toBe(60);
  });

  it("refuses a night under 20 seconds of game time, and takes one of exactly 20", async () => {
    expect(await reason(VERIFY_RULES.minGameSeconds - 1 / SIM_HZ, 300)).toBe("too_short");
    expect(await reason(VERIFY_RULES.minGameSeconds, 300)).toBe("ok");
  });

  it("refuses game time more than 5 seconds ahead of the wall clock, and takes it once the clock catches up", async () => {
    // 200 s of game handed in 194 s after the run was issued: computed faster than real time.
    expect(await reason(200, 200 - VERIFY_RULES.wallSlackSeconds - 1)).toBe("faster_than_wall_clock");
    expect(await reason(200, 200 - VERIFY_RULES.wallSlackSeconds)).toBe("ok");
    expect(await reason(200, 200)).toBe("ok");
  });

  it("refuses a final state hash that isn't the browser's", async () => {
    expect(await reason(120, 300, "not-h")).toBe("hash_mismatch");
  });

  it("refuses another ruleset, an empty log and a log over 64 KB before replaying anything", async () => {
    const verifier = replaying(120);
    const at = { now: after(300), verifier };
    expect(await verifyRun({ ...run, ruleset: "3" }, log, "h", at)).toEqual({ ok: false, reason: "ruleset_mismatch" });
    expect(await verifyRun(run, new Uint8Array(0), "h", at)).toEqual({ ok: false, reason: "log_empty" });
    expect(await verifyRun(run, new Uint8Array(VERIFY_RULES.maxLogBytes + 1), "h", at)).toEqual({ ok: false, reason: "log_too_large" });
    expect(verifier.calls).toBe(0);
    expect((await verifyRun(run, new Uint8Array(VERIFY_RULES.maxLogBytes).fill(1), "h", at)).ok).toBe(true);
  });

  it("answers the replay's own score, ticks and hash, never anything the client sent", async () => {
    const verdict = await verifyRun(run, log, "h", { now: after(300), verifier: replaying(120) });
    expect(verdict.ok && { score: verdict.result.score, ticks: verdict.result.ticks, hash: verdict.result.hash }).toEqual({ score: 1234, ticks: 120 * SIM_HZ, hash: "h" });
  });

  it("gives a time trial a 3-second floor instead of the night's 20", async () => {
    const trial = { ...run, ruleset: "trial-1", course: "rooftop-sprint" as const };
    const verifier = { ...replaying(TRIAL_MIN_SECONDS), ruleset: "trial-1" };
    expect((await verifyTrialRun(trial, log, "h", { now: after(60), verifier })).ok).toBe(true);
    const short = { ...replaying(TRIAL_MIN_SECONDS - 1 / SIM_HZ), ruleset: "trial-1" };
    expect(await verifyTrialRun(trial, log, "h", { now: after(60), verifier: short })).toMatchObject({ ok: false, reason: "too_short" });
  });
});
