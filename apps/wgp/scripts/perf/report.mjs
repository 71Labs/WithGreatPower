/**
 * A markdown before/after table from measure.mjs results files (medians of their runs).
 *
 *   node apps/wgp/scripts/perf/report.mjs <before.json> <after.json> [<reference.json> --ref-label production]
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const li = args.indexOf("--ref-label");
const refLabel = li < 0 ? "reference" : args.splice(li, 2)[1];
const [beforeFile, afterFile, refFile] = args;
const load = (f) => (f ? JSON.parse(readFileSync(f, "utf8")) : null);
const before = load(beforeFile);
const after = load(afterFile);
const ref = load(refFile);
const row = (data, view, path, phase) => data?.summary.find((r) => r.view === view && r.path === path && r.phase === phase);

const ms = (v) => (v === null || v === undefined ? "–" : `${(v / 1000).toFixed(2)} s`);
const kb = (v) => (v === null || v === undefined ? "–" : `${Math.round(v / 1024).toLocaleString("en-US")} KB`);
const num = (v, d = 0) => (v === null || v === undefined ? "–" : v.toFixed(d));
/** The change, as a percentage of before. */
const delta = (b, a) => {
  if (b === null || a === null || b === undefined || a === undefined || b === 0) return "";
  const pct = ((a - b) / b) * 100;
  return ` (${pct > 0 ? "+" : ""}${pct.toFixed(0)}%)`;
};

const METRICS = {
  page: [
    ["FCP", "fcp", ms],
    ["LCP", "lcp", ms],
    ["CLS", "cls", (v) => num(v, 3)],
    ["TBT", "tbt", (v) => (v === null ? "–" : `${Math.round(v)} ms`)],
    ["JS transferred", "bytes.js", kb],
    ["Fonts transferred", "bytes.fonts", kb],
    ["Images transferred", "bytes.images", kb],
    ["All bytes (load + 5 s)", "totalBytes", kb],
  ],
  patrol: [
    ["FCP", "fcp", ms],
    ["TBT", "tbt", (v) => (v === null ? "–" : `${Math.round(v)} ms`)],
    ["First 3D frame drawn", "firstDraw", ms],
    ["Playable (countdown on screen)", "countdown", ms],
    ["Hero's body + clips in", "heroReady", ms],
    ["Bytes before playable", "bytesToCountdown", kb],
    ["JS before playable", "jsToCountdown", kb],
  ],
  repeat: [
    ["Requests still sent", "networkRequests", (v) => num(v)],
    ["Bytes", "totalBytes", kb],
    ["LCP", "lcp", ms],
    ["Playable (patrol)", "countdown", ms],
  ],
};

const lines = [];
for (const view of ["mobile", "desktop"]) {
  for (const path of ["/", "/play", "/play/patrol"]) {
    const b = row(before, view, path, "cold");
    const a = row(after, view, path, "cold");
    if (!b || !a) continue;
    const r = row(ref, view, path, "cold");
    lines.push(`\n### ${path} · ${view} · cold load\n`);
    lines.push(`| Metric | Before | After |${ref ? ` ${refLabel} (before) |` : ""}`);
    lines.push(`|---|---:|---:|${ref ? "---:|" : ""}`);
    for (const [label, key, fmt] of path === "/play/patrol" ? METRICS.patrol : METRICS.page) {
      lines.push(`| ${label} | ${fmt(b[key])} | ${fmt(a[key])}${delta(b[key], a[key])} |${ref ? ` ${fmt(r?.[key])} |` : ""}`);
    }
    const bw = row(before, view, path, "repeat");
    const aw = row(after, view, path, "repeat");
    if (bw && aw) {
      lines.push(`\n_Repeat visit (cache on):_\n`);
      lines.push(`| Metric | Before | After |`);
      lines.push(`|---|---:|---:|`);
      for (const [label, key, fmt] of METRICS.repeat) {
        if (key === "countdown" && path !== "/play/patrol") continue;
        lines.push(`| ${label} | ${fmt(bw[key])} | ${fmt(aw[key])}${delta(bw[key], aw[key])} |`);
      }
    }
  }
}
console.log(lines.join("\n"));
