/**
 * The anomaly sweep: autopilot nights played for real in headless Chrome against a running WGP
 * server (`next dev`, PGlite, no .env.local), with qa-probe.js measuring every drawn frame:
 *
 *   node launch/brand/hero/qa-anomalies.mjs --base http://127.0.0.1:3910 --label before
 *        [--out launch/brand/hero/game-shots/qa-sweep] [--levels 1,4,9] [--seeds "1:0,1;4:0,5;9:0,2"]
 *        [--tiers high,low] [--case 2] [--parallel 3] [--only patrol|case] [--probe qa-probe.js]
 *
 * Nights: patrol nights at villain levels 1, 4 and 9 (save nights 1, 7 and 17, the hero at the
 * matching level), each on `--seeds` heroes (the seed is the night and the hero's name; the
 * default picks routes that meet every villain and every ally, Gwei Stacy on three), on each tier; and `--case` Case File 001 nights per tier. Per night it writes the probe's counts,
 * worst examples and distributions, the console's errors and the scene's draw calls, and a shot
 * of the first and the worst frame of each issue (the probe holds the sim a beat for it).
 *
 * Writes <out>/<label>/<night>/*.png, <out>/<label>/report.json, and prints the ranked table.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sleep } from "../../lib/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3910");
const label = opt("label", "run");
const out = join(opt("out", join(here, "game-shots/qa-sweep")), label);
const levels = opt("levels", "1,4,9").split(",").map(Number);
/** Heroes per level: `--seeds 2` (the first two names) or `--seeds "1:0,1;4:0,5;9:0,2"` (which names, per level). */
const seedArg = opt("seeds", "1:0,1;4:0,5;9:0,2");
const seedsFor = (level) => {
  if (/^\d+$/.test(seedArg)) return Array.from({ length: Number(seedArg) }, (_, k) => k);
  const part = seedArg.split(";").find((x) => x.startsWith(`${level}:`));
  return part ? part.slice(part.indexOf(":") + 1).split(",").map(Number) : [0];
};
const tiers = opt("tiers", "high,low").split(",");
const cases = Number(opt("case", "2"));
const parallel = Number(opt("parallel", "3"));
const only = opt("only", "");
const maxMinutes = Number(opt("minutes", "4"));
/** The probe (`--probe` another copy: run an older checkout with today's measurements). */
const PROBE = readFileSync(opt("probe", join(here, "qa-probe.js")), "utf8");
const HERO = JSON.parse(readFileSync(opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json"), "utf8"));
const NAMES = ["Peter Parquet", "Miles Mempool", "Gwen Gasless", "Ben Blockly", "May Merkle", "Otto Oracle"];

/** A save for a villain level: the night it falls on and a hero levelled to match. */
function saveFor(level, seed) {
  const night = level === 1 ? 1 : 2 * level - 1;
  const s = structuredClone(HERO);
  s.night = night;
  s.patrol = null;
  s.nightDone = false;
  s.hero.name = NAMES[seed % NAMES.length];
  s.hero.level = level;
  s.hero.maxHp = 100 + 6 * (level - 1);
  return s;
}

const nights = [];
if (only !== "case") for (const tier of tiers) for (const level of levels) for (const k of seedsFor(level)) nights.push({ name: `patrol-l${level}-s${k}-${tier}`, tier, save: saveFor(level, k), chapter: null });
if (only !== "patrol") for (const tier of tiers) for (let k = 0; k < cases; k++) nights.push({ name: `case001-s${k}-${tier}`, tier, save: saveFor(2, k), chapter: "001" });

async function playNight(n, slot) {
  const dir = join(out, n.name);
  mkdirSync(dir, { recursive: true });
  const port = 9300 + slot * 7 + Math.floor(Math.random() * 6);
  const { send, evaluate, close, logs } = await launch({ port, profile: `/private/tmp/claude-501/wgp-qa/${label}-${n.name}-${Date.now()}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--window-size=1280,800"] });
  const res = { name: n.name, tier: n.tier, chapter: n.chapter, night: n.save.night, hero: n.save.hero.name, shots: [], errors: [], beats: [], perf: [], qa: null };
  const t0 = Date.now();
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(JSON.stringify(n.save))}); } catch {}` });
    const url = `${base}/play/patrol?autopilot=1&debug=1&tier=${n.tier}${n.chapter ? `&case=${n.chapter}` : ""}`;
    await send("Page.navigate", { url });
    let ok = false;
    for (let i = 0; i < 360 && !ok; i++) {
      await sleep(250);
      ok = await evaluate(PROBE).catch(() => false);
    }
    if (!ok) throw new Error("the night never started (no scene to inspect)");
    // The night's beats, and a shot of each errand (the ally the hero meets) as it opens and a beat on.
    await evaluate(`(() => { const p = window.__wgpPlay; const b = (window.__qaBeats = []); p.loop.bus.on((e) => { if (["arrive","encounter","fight-won","errand","night-over","ko","case-closed","clue-found","captive-freed","status","gwei"].includes(e.type)) b.push({ t: Math.round(performance.now()), type: e.type, status: e.status }); if (e.type === "errand" || e.type === "gwei") { const z = p.run.sim.city.zones[p.run.sim.index]; const who = e.type === "gwei" ? "gwei-assist" : "errand-" + (z && z.ally); const q = window.__qa; setTimeout(() => q && q.shots.push({ id: who, kind: "beat" }), 700); setTimeout(() => q && q.shots.push({ id: who, kind: "beat2" }), 1800); } }); return true; })()`);
    const deadline = Date.now() + maxMinutes * 60 * 1000;
    let shotN = 0;
    let lastPerf = 0;
    while (Date.now() < deadline) {
      await sleep(120);
      const wants = await evaluate(`(() => { const q = window.__qa; return q ? q.shots.splice(0) : []; })()`).catch(() => []);
      for (const w of wants) {
        if (shotN >= 40) break;
        const file = join(dir, `${String(++shotN).padStart(2, "0")}-${w.id}-${w.kind}.png`);
        const { data } = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(file, Buffer.from(data, "base64"));
        res.shots.push({ file, ...w });
      }
      if (Date.now() - lastPerf > 2000) {
        lastPerf = Date.now();
        const s = await evaluate(`(() => { const s = window.__wgpScene; return s ? { calls: s.calls, fps: Math.round(s.fps), tris: s.triangles, castMs: +s.castMs.toFixed(2) } : null; })()`).catch(() => null);
        if (s) res.perf.push(s);
      }
      const over = await evaluate(`(() => (window.__qaBeats || []).some((b) => b.type === "night-over" || (b.type === "status" && b.status === "done")))()`).catch(() => false);
      if (over) break;
    }
    await sleep(500);
    res.beats = await evaluate(`window.__qaBeats || []`).catch(() => []);
    res.qa = await evaluate(`(() => { const q = window.__qa; if (!q) return null; return { frames: q.frames, wrapped: q.wrapped || 0, counts: q.counts, worst: q.worst, errors: q.errors, severity: q.severity, samples: Object.fromEntries(Object.entries(q.samples).map(([k, v]) => { const s = [...v].sort((a, b) => a - b); const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return [k, { n: s.length, min: s[0], p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] }]; })) }; })()`);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(dir, "zz-end.png"), Buffer.from(data, "base64"));
  } catch (e) {
    res.fail = String(e.message || e);
  } finally {
    res.errors = logs.filter((l) => /^(error|exception)/.test(l) && !/Download the React DevTools|favicon/.test(l)).slice(0, 30);
    res.seconds = Math.round((Date.now() - t0) / 1000);
    await close();
  }
  return res;
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(parallel, nights.length) }, async (_, slot) => {
    while (next < nights.length) {
      const n = nights[next++];
      const r = await playNight(n, slot);
      results.push(r);
      const c = r.qa ? Object.values(r.qa.counts).reduce((a, b) => a + b, 0) : 0;
      console.log(`${r.name}: ${r.fail ? `FAILED (${r.fail})` : `${r.qa?.frames ?? 0} frames, ${c} flagged frames, ${r.errors.length} console errors`} in ${r.seconds}s`);
    }
  }),
);

/* ------------------------------------------------------------------ the ranked table */
const rank = { high: 0, med: 1, low: 2, info: 3 };
const rows = new Map();
for (const r of results) {
  if (!r.qa) continue;
  for (const [id, n] of Object.entries(r.qa.counts)) {
    const row = rows.get(id) ?? { id, severity: r.qa.severity[id] ?? "low", frames: 0, nights: 0, of: 0, worst: null, examples: [] };
    row.frames += n;
    row.nights += 1;
    const w = r.qa.worst[id]?.[0];
    if (w && (!row.worst || w.v > row.worst.v)) row.worst = { ...w, night: r.name };
    const shot = r.shots.find((s) => s.id === id);
    if (shot && row.examples.length < 3) row.examples.push(shot.file.replace(`${out}/`, ""));
    rows.set(id, row);
  }
}
const totalFrames = results.reduce((a, r) => a + (r.qa?.frames ?? 0), 0);
const table = [...rows.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || b.frames - a.frames);
const report = { label, base, at: new Date().toISOString(), nights: results.length, totalFrames, table, results };
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(`\n${label}: ${results.length} nights, ${totalFrames} frames`);
console.log("severity  issue                      frames   nights  worst");
for (const r of table) console.log(`${r.severity.padEnd(9)} ${r.id.padEnd(26)} ${String(r.frames).padStart(7)}  ${String(r.nights).padStart(3)}/${results.length}   ${r.worst ? `${r.worst.v} (${r.worst.night}, tick ${r.worst.tick}, ${r.worst.base ?? r.worst.id ?? ""} ${r.worst.state ?? r.worst.action ?? ""})` : ""}`);
const errs = results.flatMap((r) => r.errors.map((e) => `${r.name}: ${e}`));
if (errs.length) console.log(`\nconsole errors (${errs.length}):\n${errs.slice(0, 20).join("\n")}`);
