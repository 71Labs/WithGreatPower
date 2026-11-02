/**
 * Run verification: replay the input log with the deterministic sim and check the
 * result is plausible before anything is written. The replay itself is game-core's
 * `replayRun` (packages/game-core/src/replay.ts); it is injected through `Verifier`
 * so tests can use a fake and the server can swap rulesets in one place.
 */
import { reduce } from "@wgp/game-core/engine";
import { replayRun } from "@wgp/game-core/replay";
import { RULESET_VERSION, SIM_HZ } from "@wgp/game-core/sim3d/constants";
import type { ReplayInput, ReplayResult } from "@wgp/game-core/sim3d/contract";
import type { Save } from "@wgp/game-core/types";

export interface Verifier {
  /** Pinned in every run at issue; a submit against another ruleset is rejected. */
  ruleset: string;
  /** Sim ticks per second, to turn ticks into game time. */
  tickHz: number;
  replay(input: ReplayInput): ReplayResult | Promise<ReplayResult>;
}

export const VERIFY_RULES = {
  /** A night shorter than this (game time) isn't a real run. */
  minGameSeconds: 20,
  /** Game time may run ahead of the wall clock by at most this (clock skew, a paused tab resuming). */
  wallSlackSeconds: 60,
  /** The encoded input log, decoded from base64. */
  maxLogBytes: 64 * 1024,
} as const;

/** game-core's deterministic replay, pinned to its ruleset. */
const defaultVerifier: Verifier = { ruleset: String(RULESET_VERSION), tickHz: SIM_HZ, replay: replayRun };

let current: Verifier = defaultVerifier;

export function getVerifier(): Verifier {
  return current;
}

/** Swaps the verifier (tests), or restores the default with undefined. */
export function setVerifier(verifier: Verifier | undefined): void {
  current = verifier ?? defaultVerifier;
}

/** The save the replay starts from: the server's copy at run start with tonight's patrol started from the server-issued seed. */
export function startPatrol(save: Save, seed: number): Save {
  return reduce(save, { type: "start-patrol", seed });
}

export interface RunToVerify {
  ruleset: string;
  seed: number;
  /** The save at issue time (runs.start_save). */
  startSave: Save;
  issuedAt: Date;
}

export type Verdict =
  | { ok: true; result: ReplayResult & { save: Save } }
  | { ok: false; reason: string; result?: ReplayResult };

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Replays a submitted log and applies the plausibility rules. Never throws. */
export async function verifyRun(
  run: RunToVerify,
  log: Uint8Array,
  clientHash: string,
  opts: { now?: Date; verifier?: Verifier } = {},
): Promise<Verdict> {
  const verifier = opts.verifier ?? current;
  const now = opts.now ?? new Date();

  if (run.ruleset !== verifier.ruleset) return { ok: false, reason: "ruleset_mismatch" };
  if (log.byteLength === 0) return { ok: false, reason: "log_empty" };
  if (log.byteLength > VERIFY_RULES.maxLogBytes) return { ok: false, reason: "log_too_large" };

  let result: ReplayResult;
  try {
    result = await verifier.replay({ save: startPatrol(run.startSave, run.seed), seed: run.seed, log });
  } catch (error) {
    return { ok: false, reason: `replay_error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200) };
  }

  if (!result.ok) return { ok: false, reason: (result.reason || "replay_failed").slice(0, 200), result };
  if (!isInt(result.score) || !isInt(result.ticks) || typeof result.hash !== "string" || !isSave(result.save)) {
    return { ok: false, reason: "bad_replay_result", result };
  }

  const gameSeconds = result.ticks / verifier.tickHz;
  const wallSeconds = (now.getTime() - run.issuedAt.getTime()) / 1000;
  if (gameSeconds < VERIFY_RULES.minGameSeconds) return { ok: false, reason: "too_short", result };
  if (gameSeconds > wallSeconds + VERIFY_RULES.wallSlackSeconds) return { ok: false, reason: "faster_than_wall_clock", result };
  if (result.hash !== clientHash) return { ok: false, reason: "hash_mismatch", result };

  return { ok: true, result: { ...result, save: result.save } };
}

function isSave(value: unknown): value is Save {
  return typeof value === "object" && value !== null && (value as { version?: unknown }).version === 1;
}
