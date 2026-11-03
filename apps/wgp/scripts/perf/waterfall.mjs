/**
 * A text waterfall of one measured run: every request with its kind, encoded bytes, and
 * start and end (ms after navigation), from a measure.mjs results file.
 *
 *   node apps/wgp/scripts/perf/waterfall.mjs <results.json> [--view mobile] [--path /play/patrol] [--run 0] [--repeat]
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const data = JSON.parse(readFileSync(args[0], "utf8"));
const view = opt("view", "mobile");
const path = opt("path", "/play/patrol");
const run = Number(opt("run", "0"));
const phase = args.includes("--repeat") ? "repeat" : "cold";
const r = data.results.filter((x) => x.cold.view === view && x.cold.path === path)[run]?.[phase];
if (!r) throw new Error("no such run");
const marks = ["fcp", "lcp", "firstDraw", "countdown", "heroReady"].filter((k) => r[k]).map((k) => `${k} ${r[k]}`);
console.log(`${view} ${path} ${phase} #${run}: ${marks.join(", ")}`);
for (const q of [...r.list].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)))
  console.log(
    `${String(q.start).padStart(6)} → ${String(q.end ?? "").padStart(6)}  ${q.kind.padEnd(7)} ${String(q.bytes).padStart(8)}  ${q.status}${q.cached ? " (cache)" : ""}  ${q.url.length > 90 ? q.url.slice(0, 90) + "…" : q.url}`,
  );
