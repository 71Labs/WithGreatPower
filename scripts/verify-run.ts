/**
 * Re-verifies ranked runs yourself: fetches a run's seed, start save and input log from the
 * public replay API, replays it with @wgp/game-core (the same deterministic sim the server
 * used), and checks the score and final state hash against what the server recorded.
 *
 *   cd apps/wgp && pnpm exec tsx ../../scripts/verify-run.ts                  # the All-time top 5
 *   cd apps/wgp && pnpm exec tsx ../../scripts/verify-run.ts <runId>          # one run
 *   … --base http://localhost:3000   … --top 10   … --board tonight
 *
 * Exits non-zero if any run doesn't reproduce. A run recorded under a different ruleset
 * needs that version of game-core (check out the commit that shipped it).
 */
import { replayRun } from "@wgp/game-core/replay";
import { RULESET_VERSION } from "@wgp/game-core/sim3d/constants";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return value;
};
const base = opt("base", "https://www.wgponnear.fun").replace(/\/$/, "");
const top = Number(opt("top", "5"));
const board = opt("board", "alltime");
const runIds = args.filter((a) => !a.startsWith("--"));

interface PublicReplay {
  runId: string;
  handle: string;
  ruleset: string;
  seed: number;
  startSave: unknown;
  log: string;
  score: number;
  ticks: number;
  hash: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function topRuns(): Promise<string[]> {
  const view = await getJson<{ rows: { runId: string | null }[] }>(`/api/leaderboard?board=${encodeURIComponent(board)}`);
  return view.rows.map((r) => r.runId).filter((id): id is string => !!id).slice(0, top);
}

async function verify(runId: string): Promise<boolean> {
  const run = await getJson<PublicReplay>(`/api/runs/${encodeURIComponent(runId)}/replay`);
  const label = `${run.runId.slice(0, 8)} ${run.handle}`;
  if (run.ruleset !== String(RULESET_VERSION)) {
    console.log(`SKIP  ${label}: recorded under ruleset ${run.ruleset}, this checkout is ${RULESET_VERSION}`);
    return true;
  }
  const result = replayRun({ save: run.startSave, seed: run.seed, log: new Uint8Array(Buffer.from(run.log, "base64")) });
  const ok = result.ok && result.score === run.score && result.ticks === run.ticks && (run.hash === null || result.hash === run.hash);
  const detail = `score ${result.score} vs ${run.score}, ticks ${result.ticks} vs ${run.ticks}, hash ${result.hash.slice(0, 12)} vs ${(run.hash ?? "-").slice(0, 12)}`;
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}: ${result.ok ? detail : `replay rejected (${result.reason})`}`);
  return ok;
}

async function main() {
  const ids = runIds.length > 0 ? runIds : await topRuns();
  if (ids.length === 0) {
    console.log(`No ranked runs on the ${board} board at ${base} yet.`);
    return;
  }
  let failed = 0;
  for (const id of ids) if (!(await verify(id))) failed += 1;
  console.log(`${ids.length - failed}/${ids.length} runs reproduced from ${base}.`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
