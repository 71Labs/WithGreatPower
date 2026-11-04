/**
 * The city's people (scene/crowd): the perf pass and the screenshots, over CDP against a
 * running WGP server (a production build for the numbers):
 *
 *   node launch/brand/hero/npc-shoot.mjs perf   --label before --view desktop|phone --tier high|low [--cpu 4] [--base http://localhost:3750]
 *   node launch/brand/hero/npc-shoot.mjs shots  --label after  --view desktop|phone [--save night-a] [--tier high]
 *   node launch/brand/hero/npc-shoot.mjs lineup --label after  [--view desktop]
 *   node launch/brand/hero/npc-shoot.mjs table                 (perf/*.json → perf.md and perf.png)
 *
 * - perf: a whole night played by the autopilot: every animation frame's time from "go" to
 *   the outro, the renderer's draw calls and triangles four times a second (`?debug=1`'s
 *   numbers: the mean, the 95th percentile and the worst), main-thread time per frame, and
 *   the crowd's own counts and CPU time when the build has it (`window.__wgpCrowd`).
 * - shots: the same night, stills on its events: the start roof at GO, the first legs over
 *   the rooftops and down the street, a fight's crowd, the win, an errand's onlookers.
 * - lineup: /lab/crowd, every civilian body beside the cast.
 *
 * Desktop is 1440×900 at 1×, with a mouse; the phone is 390×844 at 3× with touch, a
 * phone's user agent and notch. The GPU is this machine's (ANGLE on Metal). Writes
 * game-shots/npcs/<label>/… (and perf/<label>-….json). Needs launch/lib/cdp.mjs and
 * launch/out/saves; from a worktree without them, WGP_LAUNCH=<a checkout's launch/>.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCH = process.env.WGP_LAUNCH ?? join(HERE, "..", "..");
const { launch, sleep } = await import(pathToFileURL(join(LAUNCH, "lib", "cdp.mjs")).href);

const args = process.argv.slice(2);
const mode = args[0] ?? "perf";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3750");
const label = opt("label", "after");
const ROOT = opt("out", join(HERE, "game-shots", "npcs"));
const saves = opt("saves", join(LAUNCH, "out", "saves"));
const saveName = opt("save", "night-a");
const PLAY = "window.__wgpPlay";

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const VIEWS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, safe: { top: 47, bottom: 34, left: 0, right: 0 } },
  landscape: { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, safe: { top: 0, bottom: 21, left: 47, right: 47 } },
};
const HIDE = "nextjs-portal { display: none !important; } pre[aria-live=off] { display: none !important; }";
/** This machine's GPU (ANGLE on Metal), or SwiftShader: a software GPU slow enough to stand in for a phone's fill rate. */
const GL = opt("gl", "metal");
const GL_FLAGS = GL === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
/** Extra query for the night (`crowd=0` plays it without the crowd, for a before on the same build). */
const EXTRA = opt("q", "") ? `&${opt("q", "")}` : "";

async function browser({ view, cpu = 1, inject = [], save = true }) {
  const port = 9300 + Math.floor(Math.random() * 120);
  const c = await launch({ port, profile: `/private/tmp/claude-501/wgp-npcs/cdp-${port}`, flags: GL_FLAGS });
  const v = VIEWS[view];
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: v.width,
    height: v.height,
    deviceScaleFactor: v.deviceScaleFactor,
    mobile: v.mobile,
    ...(v.mobile ? { screenOrientation: v.width > v.height ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } } : {}),
  });
  if (v.mobile) {
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await c.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA, platform: "Linux armv8l", userAgentMetadata: { platform: "Android", platformVersion: "14", architecture: "arm", model: "Pixel 7a", mobile: true } });
    try {
      await c.send("Emulation.setSafeAreaInsetsOverride", { insets: v.safe });
    } catch {}
  }
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  if (cpu > 1) await c.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  if (save) {
    const json = readFileSync(join(saves, `${saveName}.json`), "utf8");
    await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); localStorage.removeItem("wgp:3d-settings:v1"); } catch {}` });
  }
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(HIDE)}; document.head.appendChild(st); });` });
  await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__ev = []; (function hook() { const p = window.__wgpPlay; if (p && p.loop && !p.loop.__hooked) { p.loop.__hooked = true; p.loop.bus.on((e) => window.__ev.push({ t: performance.now(), type: e.type })); } setTimeout(hook, 30); })();`,
  });
  for (const source of inject) await c.send("Page.addScriptToEvaluateOnNewDocument", { source });
  const until = async (js, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await c.evaluate(`!!(${js})`)) return true;
      } catch {}
      await sleep(80);
    }
    throw new Error(`timed out waiting for ${js}\n${c.logs.slice(-8).join("\n")}`);
  };
  const event = (type, n = 1, ms = 240000) => until(`(window.__ev || []).filter((e) => e.type === ${JSON.stringify(type)}).length >= ${n}`, ms);
  return { ...c, v, until, event };
}

async function shot(c, dir, name) {
  const { data } = await c.send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`  ${file}`);
  return file;
}

/* ------------------------------------------------------------------ perf */

/** Every animation frame's time and the loop's status; the renderer's numbers four times a second. */
const PERF_HOOK = `
window.__frames = [];
window.__scene = [];
setInterval(() => {
  const s = window.__wgpScene; const k = window.__wgpCrowd;
  if (s) window.__scene.push([Math.round(performance.now()), s.calls, s.triangles, +s.castMs.toFixed(3), s.fps | 0, +s.dpr.toFixed(2), k ? k.near : -1, k ? k.far : -1, k ? +k.ms.toFixed(3) : -1, k ? k.calls : -1]);
}, 250);
(function frame(t) { const p = window.__wgpPlay; window.__frames.push(t, p && p.loop ? ({ intro: 1, live: 2, paused: 3, outro: 4, done: 5 })[p.loop.status] || 0 : 0); requestAnimationFrame(frame); })(0);
`;

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length);
  return {
    frames: ms.length,
    meanMs: +mean.toFixed(2),
    fps: +(1000 / mean).toFixed(1),
    medianMs: +q(0.5).toFixed(2),
    p95Ms: +q(0.95).toFixed(2),
    p99Ms: +q(0.99).toFixed(2),
    over33: +((ms.filter((x) => x > 34).length / Math.max(1, ms.length)) * 100).toFixed(1),
  };
}

function spread(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), p95: s[Math.min(s.length - 1, Math.floor(0.95 * s.length))], max: s[s.length - 1] };
}

const metrics = (r) => Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));

async function perf() {
  const tier = opt("tier", "high");
  const view = opt("view", "desktop");
  const cpu = Number(opt("cpu", tier === "low" ? "4" : "1"));
  const c = await browser({ view, cpu, inject: [PERF_HOOK] });
  try {
    await c.send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&debug=1&tier=${tier}${EXTRA}` });
    await c.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 180000);
    await c.event("go");
    await c.send("Performance.enable", { timeDomain: "timeTicks" });
    const m0 = metrics(await c.send("Performance.getMetrics"));
    const t0 = await c.evaluate("performance.now()");
    if (opt("seconds")) await sleep(Number(opt("seconds")) * 1000);
    else await c.until(`${PLAY}.loop.status === "done"`, 900000);
    const t1 = await c.evaluate("performance.now()");
    const m1 = metrics(await c.send("Performance.getMetrics"));
    const raw = await c.evaluate("window.__frames");
    const ms = [];
    for (let i = 2; i < raw.length; i += 2) {
      const t = raw[i];
      if (t < t0 || t > t1) continue;
      if (raw[i + 1] !== 2 && raw[i + 1] !== 4) continue;
      ms.push(t - raw[i - 2]);
    }
    const scene = (await c.evaluate("window.__scene")).filter(([t]) => t >= t0 && t <= t1);
    const seconds = (t1 - t0) / 1000;
    const per = (k) => +(((m1[k] - m0[k]) * 1000) / Math.max(1, ms.length)).toFixed(2);
    const crowd = scene.filter((r) => r[6] >= 0);
    const result = {
      label,
      view,
      tier,
      cpu,
      gl: GL,
      query: EXTRA,
      nightSeconds: +seconds.toFixed(1),
      ...stats(ms),
      scriptMsPerFrame: per("ScriptDuration"),
      taskMsPerFrame: per("TaskDuration"),
      calls: spread(scene.map((r) => r[1])),
      triangles: spread(scene.map((r) => r[2])),
      castMs: spread(scene.map((r) => r[3])),
      dpr: spread(scene.map((r) => r[5])),
      crowd: crowd.length ? { near: spread(crowd.map((r) => r[6])), far: spread(crowd.map((r) => r[7])), ms: spread(crowd.map((r) => r[8])), calls: spread(crowd.map((r) => r[9])) } : null,
    };
    const dir = join(ROOT, "perf");
    mkdirSync(dir, { recursive: true });
    const name = `${label}-${view}-${tier}-cpu${cpu}${GL === "metal" ? "" : `-${GL}`}`;
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...result, samples: scene, frameMs: ms.map((x) => +x.toFixed(2)) }));
    console.log(JSON.stringify(result, null, 1));
    const logs = c.logs.filter((l) => !/React DevTools|HMR|Fast Refresh|THREE\.Clock/.test(l));
    if (logs.length) console.log(logs.slice(0, 5).join("\n"));
  } finally {
    await c.close();
  }
}

/** The perf runs side by side, before and after, as a markdown table and a rendered PNG. */
async function table() {
  const dir = join(ROOT, "perf");
  const runs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const key = (r) => `${r.view} · ${r.tier} · CPU ×${r.cpu}${r.gl && r.gl !== "metal" ? ` · ${r.gl}` : ""}`;
  const groups = new Map();
  for (const r of runs) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, {});
    groups.get(k)[r.label] = r;
  }
  const rows = [];
  const cell = (r, f) => (r ? f(r) : "–");
  for (const [k, g] of [...groups.entries()].sort()) {
    const b = g.before;
    const a = g.after;
    rows.push([
      k,
      cell(b, (r) => `${r.fps} fps · ${r.medianMs} / ${r.p95Ms} ms`),
      cell(a, (r) => `${r.fps} fps · ${r.medianMs} / ${r.p95Ms} ms`),
      cell(b, (r) => `${r.calls?.mean ?? "–"} / ${r.calls?.max ?? "–"}`),
      cell(a, (r) => `${r.calls?.mean ?? "–"} / ${r.calls?.max ?? "–"}`),
      cell(b, (r) => `${r.scriptMsPerFrame} ms`),
      cell(a, (r) => `${r.scriptMsPerFrame} ms`),
      cell(a, (r) => (r.crowd ? `${r.crowd.near.max} near, ${r.crowd.far.max} far · ${r.crowd.ms.mean}/${r.crowd.ms.max} ms · ${r.crowd.calls.max} calls` : "–")),
    ]);
  }
  const head = ["Run", "Before: fps · median / p95 frame", "After: fps · median / p95 frame", "Before: draw calls mean / max", "After: draw calls mean / max", "Before: script per frame", "After: script per frame", "Crowd (after): most drawn · CPU mean/max · its calls"];
  const md = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
  writeFileSync(join(ROOT, "perf.md"), `# The city's people: perf, a full autopilot night\n\n${md}\n`);
  console.log(md);
  const html = `<!doctype html><meta charset=utf-8><style>
  body { margin: 0; padding: 28px; background: #10131f; color: #f4efe6; font: 15px/1.4 -apple-system, "Helvetica Neue", sans-serif; }
  h1 { font-size: 20px; margin: 0 0 6px; } p { margin: 0 0 16px; color: #a9adc4; }
  table { border-collapse: collapse; } th, td { border: 2px solid #2c3150; padding: 8px 10px; text-align: left; font-variant-numeric: tabular-nums; }
  th { background: #1b2036; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #c9cde4; }
  td:first-child { font-weight: 600; white-space: nowrap; }
  </style><h1>The city's people: perf over a full autopilot night</h1><p>Production build, headless Chrome on this Mac's GPU (ANGLE Metal). Frame times are every animation frame from GO to the outro; draw calls are sampled four times a second.</p><table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table>`;
  writeFileSync(join(ROOT, "perf.html"), html);
  const c = await launch({ port: 9450 + Math.floor(Math.random() * 40), profile: "/private/tmp/claude-501/wgp-npcs/table", flags: [] });
  try {
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1700, height: 600, deviceScaleFactor: 2, mobile: false });
    await c.send("Page.navigate", { url: pathToFileURL(join(ROOT, "perf.html")).href });
    await sleep(800);
    const h = await c.evaluate("document.body.scrollHeight");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1700, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(300);
    await shot(c, ROOT, "perf");
  } finally {
    await c.close();
  }
}

/* ------------------------------------------------------------------ shots */

async function shots() {
  const view = opt("view", "desktop");
  const tier = opt("tier", view === "desktop" ? "high" : "medium");
  const dir = join(ROOT, label, view);
  const c = await browser({ view });
  try {
    await c.send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&debug=1&tier=${tier}` });
    await c.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 180000);
    // Wait for the crowd's files before the night starts (they load behind everything else).
    await c.until("window.__wgpCrowd !== undefined", 120000).catch(() => console.warn("  no crowd stats"));
    await c.event("countdown");
    await sleep(1800);
    await shot(c, dir, "1-start-roof");
    await c.event("go");
    await sleep(Number(opt("t1", "2600")));
    await shot(c, dir, "2-rooftops");
    await sleep(Number(opt("t2", "2000")));
    await shot(c, dir, "3-rooftops-b");
    await sleep(Number(opt("t3", "2000")));
    await shot(c, dir, "4-street");
    await c.event("encounter", 1, 300000);
    await sleep(900);
    await shot(c, dir, "5-fight-crowd");
    await c.event("fight-live", 1, 300000);
    await sleep(1200);
    await shot(c, dir, "6-fight-crowd-b");
    // The camera turned round the fight by hand: the spectators on the roofs round the arena.
    for (let k = 1; k <= 3; k++) {
      await c.evaluate(`(() => { const h = ${PLAY}.handle(); if (h) h.orbit(${opt("yaw", "1.57")}, 0, true); })()`);
      await sleep(450);
      await shot(c, dir, `6-fight-crowd-wide-${k}`);
    }
    await c.evaluate(`(() => { const h = ${PLAY}.handle(); if (h) h.orbit(0, 0, false); })()`);
    await c.event("fight-won", 1, 300000);
    await sleep(700);
    await shot(c, dir, "7-won-cheer");
    await sleep(1300);
    await shot(c, dir, "7-won-cheer-b");
    await c.event("errand", 1, 300000);
    await sleep(250);
    await shot(c, dir, "8-errand-crowd");
    await sleep(1700);
    await shot(c, dir, "9-errand-crowd-b");
    const logs = c.logs.filter((l) => !/React DevTools|HMR|Fast Refresh|THREE\.Clock/.test(l));
    if (logs.length) console.log(logs.slice(0, 8).join("\n"));
  } finally {
    await c.close();
  }
}

async function lineup() {
  const view = opt("view", "desktop");
  const dir = join(ROOT, label);
  const c = await browser({ view, save: false, inject: [`document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "section[aria-labelledby=crowd-lab-title] { display: none !important; }"; document.head.appendChild(st); });`] });
  try {
    await c.send("Page.navigate", { url: `${base}/lab/crowd?debug=1${opt("q") ? `&${opt("q")}` : ""}` });
    await c.until(`window.__wgpCrowdLab && window.__wgpCrowdLab.ready()`, 120000);
    await sleep(1500);
    for (const [name, q] of [
      ["lineup", "front"],
      ["lineup-34", "three-quarter"],
      ["lineup-close", "close"],
      ["lineup-poses", "poses"],
    ]) {
      await c.evaluate(`window.__wgpCrowdLab.view(${JSON.stringify(q)})`);
      await sleep(1200);
      await shot(c, dir, `${view}-${name}`);
    }
    const logs = c.logs.filter((l) => !/React DevTools|HMR|Fast Refresh|THREE\.Clock/.test(l));
    if (logs.length) console.log(logs.slice(0, 8).join("\n"));
  } finally {
    await c.close();
  }
}

if (mode === "perf") await perf();
else if (mode === "shots") await shots();
else if (mode === "lineup") await lineup();
else if (mode === "table") await table();
else throw new Error(`unknown mode ${mode}`);
