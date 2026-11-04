/**
 * Starting and ending a 3D night, ranked or not. The server is the only source of a
 * ranked score: the client plays from the server's save and seed, submits its input log
 * and shows whatever the verifier says.
 *
 * - Ranked (signed in): refresh the account, POST /api/runs/start, make sure the save we
 *   hold is the revision the run was issued against, then startRun(save, seed). At the
 *   end, submit runLog and runHash; a verified run's save becomes the account's.
 * - Guest: the browser's save and a local seed (the one Tonight's route preview used),
 *   banked into the local save with finishRun at the end. Never ranked.
 * - Unranked (signed in, but capped or offline): the account's save and a local seed,
 *   played for fun; nothing is saved.
 * - Resume: a recording (recorder.ts) replays back into a live run after a reload.
 */
import { seedOf } from "@wgp/game-core/engine";
import { finishRun, resumeRun, runHash, runLog, runScore, startRun, type Run } from "@wgp/game-core/replay";
import type { Save } from "@wgp/game-core/types";

import { adoptServerSave, commitLocalSave, refreshAccount } from "@/game/store";
import { getLeaderboard, startRankedRun, submitRankedRun } from "@/lib/api/client";

import { clearRecording, type Recording, type RecordingMode } from "./recorder";

export type NightMode = RecordingMode;

export interface NightSession {
  mode: NightMode;
  run: Run;
  /** The server's run (ranked only). */
  runId: string | null;
  playerId: string | null;
  /** The hero before the night, to show a level-up on the results. */
  before: { level: number; maxHp: number };
  resumed: boolean;
}

export type RankedStart =
  | { kind: "ready"; session: NightSession }
  /** A ranked run is already in flight (another tab, or a reload without a recording). */
  | { kind: "run-active"; runId: string | null }
  | { kind: "daily-cap"; message: string }
  /** The server won't start one: no hero, tonight already played, a patrol already in the save. */
  | { kind: "blocked"; code: string; message: string }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

export type NightOutcome =
  /** `bits`: what the server minted for the night (src/lib/market/rewards.ts). `runId`: its public page, /r/<runId>. */
  | { kind: "verified"; runId: string; score: number; ranked: boolean; save: Save; rank: { rank: number; total: number } | null; bits: number }
  | { kind: "rejected"; reason: string; preview: Save; score: number }
  | { kind: "guest"; save: Save; score: number }
  | { kind: "unranked"; preview: Save; score: number }
  /** Submitting failed (offline, the server erred): the recording is kept, so it can be retried. */
  | { kind: "submit-failed"; message: string; preview: Save };

const heroBefore = (save: Save) => ({ level: save.hero?.level ?? 1, maxHp: save.hero?.maxHp ?? 0 });

/** A seed for a night nobody ranks: the one the local route preview uses, so the stops match Tonight's. */
export const localSeed = (save: Save) => seedOf(save.night, save.hero?.name ?? "");

function session(mode: NightMode, run: Run, extra: { runId?: string | null; playerId?: string | null; resumed?: boolean } = {}): NightSession {
  return { mode, run, runId: extra.runId ?? null, playerId: extra.playerId ?? null, before: heroBefore(run.start), resumed: !!extra.resumed };
}

/**
 * A local run on `save`: from its own patrol if that's fresh (Tonight's "Swing out" already
 * started it), else from a fresh patrol. Null if the save's patrol is past its first stop
 * (only a recording, or the 2D game, can pick that up).
 */
export function beginLocal(save: Save, mode: "guest" | "unranked", playerId: string | null = null): NightSession | null {
  if (!save.hero || save.nightDone) return null;
  const p = save.patrol;
  const fresh = !p || p.phase === "briefing" || (p.phase === "swing" && p.index === 0 && p.results.length === 0);
  if (!fresh) return null;
  let run = startRun(save, localSeed(save));
  // A patrol started from some other seed: post a new route rather than refuse the night.
  if (run.error && p) run = startRun({ ...save, patrol: null }, localSeed(save));
  return run.error ? null : session(mode, run, { playerId });
}

/** Replay a recording back into a live run, or null if it no longer fits. */
export function resumeRecording(rec: Recording): NightSession | null {
  const run = resumeRun({ save: rec.start, seed: rec.seed, log: rec.log });
  if (run.error) return null;
  return session(rec.mode, run, { runId: rec.runId, playerId: rec.playerId, resumed: true });
}

/** Start a ranked night: the server issues the seed against the save revision we play from. */
export async function beginRanked(opts: { abandon?: boolean } = {}): Promise<RankedStart> {
  const account = await refreshAccount();
  if (account.status !== "signed-in") return { kind: "signed-out" };
  const res = await startRankedRun({ abandon: opts.abandon });
  if (!res.ok) {
    if (res.status === 401) return { kind: "signed-out" };
    if (res.error === "run_active") return { kind: "run-active", runId: typeof res.body?.runId === "string" ? res.body.runId : null };
    if (res.error === "daily_cap") return { kind: "daily-cap", message: res.message ?? "That’s all the ranked nights for today." };
    if (res.status === 409) return { kind: "blocked", code: res.error, message: res.message ?? "The server can’t start a night on this save." };
    return { kind: "error", message: res.status === 0 ? "You look offline." : (res.message ?? "The server couldn’t start a ranked night.") };
  }
  const started = res.data;
  let me = account.me;
  if (me.rev !== started.saveRev) {
    const again = await refreshAccount();
    if (again.status !== "signed-in") return { kind: "signed-out" };
    me = again.me;
  }
  if (me.rev !== started.saveRev) return { kind: "error", message: "Your save changed while the night was starting. Try again." };
  const run = startRun(me.save, started.seed);
  if (run.error) return { kind: "error", message: `This night can’t start: ${run.error}.` };
  return { kind: "ready", session: session("ranked", run, { runId: started.runId, playerId: me.player.id }) };
}

/** The signed-in player's place on tonight's board, if they're on it. */
export async function tonightRank(): Promise<{ rank: number; total: number } | null> {
  const res = await getLeaderboard("tonight", { aroundMe: true });
  if (!res.ok || !res.data.me) return null;
  return { rank: res.data.me.rank, total: res.data.total };
}

/** End the night: submit it (ranked), bank it locally (guest), or just score it (unranked). */
export async function endNight(s: NightSession): Promise<NightOutcome> {
  const { run } = s;
  // The save with every stop's result, before finish-patrol: what the results show until banked.
  const preview = run.save;
  if (s.mode === "guest") {
    const done = finishRun(run);
    if (!done.ok) return { kind: "unranked", preview, score: 0 };
    commitLocalSave(done.save as Save);
    await clearRecording();
    return { kind: "guest", save: done.save as Save, score: done.score };
  }
  if (s.mode === "unranked" || !s.runId) {
    await clearRecording();
    return { kind: "unranked", preview, score: run.over && !run.error ? runScore(run).total : 0 };
  }
  const res = await submitRankedRun(s.runId, runLog(run), runHash(run));
  if (res.ok) {
    await clearRecording();
    adoptServerSave(res.data.save, res.data.rev);
    const rank = res.data.ranked ? await tonightRank() : null;
    return { kind: "verified", runId: res.data.runId, score: res.data.score, ranked: res.data.ranked, save: res.data.save, rank, bits: res.data.bits };
  }
  if (res.status === 0 || res.status >= 500 || res.status === 429) {
    return { kind: "submit-failed", message: res.status === 0 ? "You look offline." : (res.message ?? "The server couldn’t check your run."), preview };
  }
  await clearRecording();
  const reason = typeof res.body?.reason === "string" ? res.body.reason : res.error;
  return { kind: "rejected", reason, preview, score: run.over && !run.error ? runScore(run).total : 0 };
}
