/**
 * The phone pass, over CDP mobile emulation (touch, a phone's viewport, user agent and
 * safe areas), against a running WGP server (a production build for the numbers):
 *
 *   node launch/brand/hero/phone-shoot.mjs shots  --label before [--base http://localhost:3650] [--only portrait,landscape,small]
 *   node launch/brand/hero/phone-shoot.mjs perf   --label before [--tier low|medium|high|auto] [--cpu 4] [--gl metal|swiftshader] [--viewport portrait]
 *   node launch/brand/hero/phone-shoot.mjs touch  --label after [--viewport landscape]
 *   node launch/brand/hero/phone-shoot.mjs trace  --label after [--cpu 4] [--seconds 4]
 *   node launch/brand/hero/phone-shoot.mjs layers --label after
 *   node launch/brand/hero/phone-shoot.mjs tier   --label after
 *
 * - shots: at 390×844 portrait, 844×390 landscape and 360×780 small, with a notch's safe
 *   areas: the countdown, the first leg with the hint, a fight and an errand (the autopilot
 *   plays), then real touches (stick + web with two thumbs), the pause sheet and How to play.
 * - perf: a whole night played by the autopilot at CPU ×N: every animation frame's time
 *   from "go" to the outro, main-thread time per frame, React commits per second, the DPR
 *   the frame budget settled on, long frames against the night's events. SwiftShader (a
 *   software GPU) stands in for a phone GPU's fill rate and compositing.
 * - touch: input checks through Input.dispatchTouchEvent (the dead zone, two thumbs, a
 *   power tapped mid-swing, a re-grip, a double tap and pull from the top, the pause sheet
 *   scrolling under a thumb), read back from the input latch and the sim.
 * - trace: where the renderer's main thread spends a few seconds of the first leg.
 * - layers: the composited layers that draw during the first leg.
 * - tier: the tier the auto pick lands on for a few emulated phones (their GPU names).
 *
 * Writes game-shots/phone/<label>/…. Needs launch/lib/cdp.mjs and launch/out/saves; from a
 * worktree without them, WGP_LAUNCH=<a checkout's launch/>.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** launch/ in this checkout; WGP_LAUNCH points at another (a worktree without launch/lib or launch/out). */
const LAUNCH = process.env.WGP_LAUNCH ?? join(HERE, "..", "..");
const { launch, sleep } = await import(pathToFileURL(join(LAUNCH, "lib", "cdp.mjs")).href);

const args = process.argv.slice(2);
const mode = args[0] ?? "shots";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3650");
const label = opt("label", "after");
const out = join(opt("out", join(HERE, "game-shots", "phone")), label);
const saves = opt("saves", join(LAUNCH, "out", "saves"));
const saveName = opt("save", "night-a");
mkdirSync(out, { recursive: true });

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
/** A phone's notch and home indicator, CSS px, per orientation (iPhone 14-ish). */
const VIEWPORTS = {
  portrait: { width: 390, height: 844, deviceScaleFactor: 3, safe: { top: 47, bottom: 34, left: 0, right: 0 } },
  /** A quarter of the pixels, for experiments. */
  tiny: { width: 195, height: 422, deviceScaleFactor: 3, safe: { top: 0, bottom: 0, left: 0, right: 0 } },
  landscape: { width: 844, height: 390, deviceScaleFactor: 3, safe: { top: 0, bottom: 21, left: 47, right: 47 } },
  small: { width: 360, height: 780, deviceScaleFactor: 2, safe: { top: 24, bottom: 0, left: 0, right: 0 } },
};
const HIDE = `nextjs-portal { display: none !important; } pre[aria-live=off] { display: none !important; } ${opt("css", "")}`;
const PLAY = "window.__wgpPlay";
/** The GPU: this machine's (ANGLE on Metal), or SwiftShader, a software GPU slow enough to stand in for a phone's fill rate. */
const GL = opt("gl", "metal");
const GL_FLAGS = GL === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];

async function phone({ viewport, cpu = 1, ua = ANDROID_UA, inject = [] }) {
  const port = 9720 + Math.floor(Math.random() * 60);
  const c = await launch({ port, profile: `/private/tmp/claude-501/wgp-phone/cdp-${port}`, flags: GL_FLAGS });
  const v = { ...VIEWPORTS[viewport] };
  if (opt("dsf")) v.deviceScaleFactor = Number(opt("dsf"));
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: true, screenOrientation: v.width > v.height ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
  await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await c.send("Emulation.setUserAgentOverride", { userAgent: ua, platform: "Linux armv8l", userAgentMetadata: { platform: "Android", platformVersion: "14", architecture: "arm", model: "Pixel 7a", mobile: true } });
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  try {
    await c.send("Emulation.setSafeAreaInsetsOverride", { insets: v.safe });
  } catch (e) {
    console.warn(`  no safe-area override: ${e.message}`);
  }
  if (cpu > 1) await c.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const json = readFileSync(join(saves, `${saveName}.json`), "utf8");
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); localStorage.removeItem("wgp:3d-settings:v1"); } catch {}` });
  await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(HIDE)}; document.head.appendChild(st); });`,
  });
  // Every sim event with a time, once the loop exists.
  await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__ev = []; (function hook() { const p = window.__wgpPlay; if (p && p.loop && !p.loop.__hooked) { p.loop.__hooked = true; p.loop.bus.on((e) => window.__ev.push({ t: performance.now(), type: e.type, status: e.status })); } setTimeout(hook, 30); })();`,
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
  const event = (type, n = 1) => until(`(window.__ev || []).filter((e) => e.type === ${JSON.stringify(type)}).length >= ${n}`, 180000);
  const shot = async (name) => {
    const { data } = await c.send("Page.captureScreenshot", { format: "png" });
    const file = join(out, `${viewport}-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`  ${file}`);
  };
  /**
   * Touches, in CDP's model: touchStart and touchMove list every point down (CDP diffs
   * against the last event); touchEnd lists only the points lifting.
   */
  const fingers = new Map();
  const touch = async (type, id, x, y) => {
    const point = { x, y, id, radiusX: 8, radiusY: 8, force: 1 };
    if (type === "touchEnd" || type === "touchCancel") {
      fingers.delete(id);
      await c.send("Input.dispatchTouchEvent", { type, touchPoints: [point] });
      return;
    }
    fingers.set(id, point);
    await c.send("Input.dispatchTouchEvent", { type, touchPoints: [...fingers.values()] });
  };
  const tapAt = async (x, y, id = 9) => {
    await touch("touchStart", id, x, y);
    await sleep(70);
    await touch("touchEnd", id, x, y);
  };
  return { ...c, v, until, event, shot, touch, tapAt, fingers };
}

/* ------------------------------------------------------------------ shots */

async function shots() {
  for (const viewport of opt("only", "portrait,landscape,small").split(",")) {
    console.log(`${viewport}: autopilot`);
    let p = await phone({ viewport });
    try {
      await p.send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&tier=medium` });
      await p.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 90000);
      await p.event("countdown");
      await sleep(900);
      await p.shot("1-countdown");
      await p.event("go");
      await sleep(1400);
      await p.shot("2-travel-hint");
      await p.event("fight-live");
      await sleep(1600);
      await p.shot("3-fight");
      await p.event("errand");
      await sleep(900);
      await p.shot("4-errand");
      const logs = p.logs.filter((l) => !/React DevTools|HMR|Fast Refresh|THREE\.Clock/.test(l));
      if (logs.length) console.log(logs.slice(0, 5).join("\n"));
    } finally {
      await p.close();
    }

    console.log(`${viewport}: touch`);
    p = await phone({ viewport });
    try {
      const { width: w, height: h } = p.v;
      await p.send("Page.navigate", { url: `${base}/play/patrol?debug=1&tier=medium` });
      await p.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 90000);
      await p.event("go");
      await sleep(500);
      // Left thumb: the stick; right thumb: the web.
      const sx = Math.round(w * 0.18);
      const sy = Math.round(h * 0.72);
      await p.touch("touchStart", 1, sx, sy);
      await sleep(80);
      for (let i = 1; i <= 6; i++) {
        await p.touch("touchMove", 1, sx + i * 6, sy - i * 8);
        await sleep(30);
      }
      await p.touch("touchStart", 2, Math.round(w * 0.72), Math.round(h * 0.5));
      await sleep(500);
      const peek = await p.evaluate(`${PLAY}.peek()`);
      await p.shot("5-two-thumbs");
      console.log(`  two thumbs: rope ${peek.rope}, input ${JSON.stringify(peek.input)}`);
      await p.touch("touchEnd", 2, Math.round(w * 0.72), Math.round(h * 0.5));
      await p.touch("touchEnd", 1, sx + 36, sy - 48);
      await sleep(300);
      const pause = await p.evaluate(`(() => { const b = document.querySelector("button[aria-label=Pause]"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (pause) await p.tapAt(pause.x, pause.y);
      await sleep(700);
      await p.shot("6-pause");
      const help = await p.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "How to play"); if (!b) return null; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (help) {
        await sleep(200);
        await p.tapAt(help.x, help.y);
        await sleep(500);
        await p.shot("7-how-to-play");
      }
    } finally {
      await p.close();
    }
  }
}

/* ------------------------------------------------------------------ perf */

/**
 * Counts React commits with a stand-in devtools hook (React calls it in production too),
 * and records every animation frame's time with the loop's status.
 */
const PERF_HOOK = `
window.__commits = [];
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true, renderers: new Map(), isDisabled: false, checkDCE() {},
  inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
  onCommitFiberRoot() { window.__commits.push(performance.now()); }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
};
window.__frames = [];
window.__dprs = [];
setInterval(() => { const s = window.__wgpScene; if (s) window.__dprs.push([Math.round(performance.now()), +s.dpr.toFixed(2), s.fps | 0]); }, 1000);
(function frame(t) { const p = window.__wgpPlay; window.__frames.push(t, p && p.loop ? ({ intro: 1, live: 2, paused: 3, outro: 4, done: 5 })[p.loop.status] || 0 : 0); requestAnimationFrame(frame); })(0);
`;

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  return {
    frames: ms.length,
    meanMs: +mean.toFixed(2),
    fps: +(1000 / mean).toFixed(1),
    medianMs: +q(0.5).toFixed(2),
    p90Ms: +q(0.9).toFixed(2),
    p95Ms: +q(0.95).toFixed(2),
    p99Ms: +q(0.99).toFixed(2),
    worstMs: +s[s.length - 1].toFixed(1),
    over33: +((ms.filter((x) => x > 34).length / ms.length) * 100).toFixed(1),
    over50: +((ms.filter((x) => x > 50).length / ms.length) * 100).toFixed(1),
  };
}

const metrics = (r) => Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));

async function perf() {
  const tier = opt("tier", "low");
  const cpu = Number(opt("cpu", "4"));
  const viewport = opt("viewport", "portrait");
  const p = await phone({ viewport, cpu, inject: [PERF_HOOK] });
  try {
    await p.send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&debug=1${tier === "auto" ? "" : `&tier=${tier}`}` });
    await p.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 180000);
    await p.event("go");
    if (opt("skip")) await sleep(Number(opt("skip")) * 1000);
    await p.send("Performance.enable", { timeDomain: "timeTicks" });
    const m0 = metrics(await p.send("Performance.getMetrics"));
    const t0 = await p.evaluate("performance.now()");
    if (opt("seconds")) await sleep(Number(opt("seconds")) * 1000);
    else await p.until(`${PLAY}.loop.status === "done"`, 600000);
    const t1 = await p.evaluate("performance.now()");
    const m1 = metrics(await p.send("Performance.getMetrics"));
    const raw = await p.evaluate("window.__frames");
    const commits = await p.evaluate("window.__commits");
    const scene = await p.evaluate("window.__wgpScene ? { tier: window.__wgpScene.tier, dpr: window.__wgpScene.dpr, calls: window.__wgpScene.calls, triangles: window.__wgpScene.triangles } : null");
    const canvas = await p.evaluate(`(() => { const c = document.querySelector("[role=application] canvas"); return c ? { width: c.width, height: c.height, css: [c.clientWidth, c.clientHeight] } : null; })()`);
    const ms = [];
    const long = [];
    for (let i = 2; i < raw.length; i += 2) {
      const t = raw[i];
      if (t < t0 || t > t1) continue;
      if (raw[i + 1] !== 2 && raw[i + 1] !== 4) continue;
      ms.push(t - raw[i - 2]);
      if (t - raw[i - 2] > 80) long.push([+((t - t0) / 1000).toFixed(2), Math.round(t - raw[i - 2])]);
    }
    const events = (await p.evaluate("window.__ev")).filter((e) => e.t >= t0 && e.t <= t1 && !["thwip", "release", "pickup", "countdown"].includes(e.type)).map((e) => [+((e.t - t0) / 1000).toFixed(2), e.type]);
    const dprs = (await p.evaluate("window.__dprs")).filter(([t]) => t >= t0 && t <= t1).map(([t, d, f]) => [+((t - t0) / 1000).toFixed(0), d, f]);
    const seconds = (t1 - t0) / 1000;
    const live = commits.filter((t) => t >= t0 && t <= t1).length;
    // Main-thread time per animation frame (wall-clock time ticks, so the throttled CPU counts in full).
    const per = (k) => +(((m1[k] - m0[k]) * 1000) / Math.max(1, ms.length)).toFixed(2);
    const mainThread = { taskMs: per("TaskDuration"), scriptMs: per("ScriptDuration"), styleMs: per("RecalcStyleDuration"), layoutMs: per("LayoutDuration"), busy: `${(((m1.TaskDuration - m0.TaskDuration) / seconds) * 100).toFixed(0)}%` };
    const result = { label, tier, cpu, gl: GL, viewport, nightSeconds: +seconds.toFixed(1), ...stats(ms), commitsPerSecond: +(live / seconds).toFixed(1), mainThreadPerFrame: mainThread, scene, canvas };
    const name = `perf-${viewport}-${tier}-cpu${cpu}${GL === "metal" ? "" : `-${GL}`}${opt("suffix") ? `-${opt("suffix")}` : ""}`;
    writeFileSync(join(out, `${name}.json`), JSON.stringify({ ...result, long, events, dprs, frameMs: ms.map((x) => +x.toFixed(2)) }));
    const text = Object.entries(result)
      .map(([k, v]) => `${k.padEnd(18)} ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("\n");
    writeFileSync(join(out, `${name}.txt`), `${text}\n`);
    console.log(text);
    if (args.includes("--verbose")) console.log(JSON.stringify({ long, events, dprs }));
    const logs = p.logs.filter((l) => !/React DevTools|HMR|Fast Refresh|THREE\.Clock/.test(l));
    if (logs.length) console.log(logs.slice(0, 5).join("\n"));
  } finally {
    await p.close();
  }
}

/* ------------------------------------------------------------------ trace */

/**
 * A few seconds of the first leg under the tracer: where the renderer's main thread and the
 * raster threads spend their time (paints, raster, style, layout, script, GPU tasks).
 */
async function trace() {
  const cpu = Number(opt("cpu", "4"));
  const viewport = opt("viewport", "portrait");
  const p = await phone({ viewport, cpu });
  try {
    await p.send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&tier=${opt("tier", "low")}` });
    await p.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 180000);
    await p.event("go");
    await sleep(Number(opt("skip", "2")) * 1000);
    const events = [];
    p.on("Tracing.dataCollected", (d) => events.push(...d.value));
    const done = new Promise((r) => p.on("Tracing.tracingComplete", r));
    await p.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "blink", "gpu"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReportEvents" });
    const secs = Number(opt("seconds", "4"));
    await sleep(secs * 1000);
    await p.send("Tracing.end");
    await done;
    const threads = new Map();
    for (const e of events) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
    const sums = new Map();
    for (const e of events) {
      if (e.ph !== "X" || !e.dur) continue;
      const th = threads.get(`${e.pid}:${e.tid}`) ?? "?";
      if (!/CrRendererMain|Compositor|RasterWorker|CrGpuMain|VizCompositor/.test(th)) continue;
      const k = `${th.replace(/\d+$/, "")} ${e.name}`;
      const s = sums.get(k) ?? { ms: 0, n: 0 };
      s.ms += e.dur / 1000;
      s.n += 1;
      sums.set(k, s);
    }
    const rows = [...sums.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, Number(opt("top", "28")));
    const text = rows.map(([k, s]) => `${(s.ms / secs).toFixed(1).padStart(7)} ms/s  ${String(Math.round(s.n / secs)).padStart(5)}/s  ${k}`).join("\n");
    writeFileSync(join(out, `trace-${viewport}.txt`), `${text}\n`);
    console.log(text);
  } finally {
    await p.close();
  }
}

/* ------------------------------------------------------------------ layers */

/** The composited layers during the first leg: each one that draws, its size and why it exists. */
async function layers() {
  const viewport = opt("viewport", "portrait");
  const p = await phone({ viewport });
  try {
    await p.send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&tier=low` });
    await p.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 180000);
    await p.event("go");
    await sleep(2500);
    let latest = null;
    p.on("LayerTree.layerTreeDidChange", (e) => {
      if (e.layers) latest = e.layers;
    });
    await p.send("LayerTree.enable");
    await sleep(600);
    const rows = [];
    let area = 0;
    for (const l of latest ?? []) {
      if (!l.drawsContent) continue;
      const why = await p.send("LayerTree.compositingReasons", { layerId: l.layerId }).catch(() => ({ compositingReasons: [] }));
      area += l.width * l.height;
      rows.push(`${String(l.width).padStart(5)}×${String(l.height).padEnd(5)} ${(l.width * l.height / (p.v.width * p.v.height) * 100).toFixed(0).padStart(4)}%  nodeId ${l.backendNodeId ?? "-"}  ${(why.compositingReasons ?? []).join(", ")}`);
    }
    const text = `${rows.join("\n")}\n${rows.length} drawing layers, ${(area / (p.v.width * p.v.height)).toFixed(2)} screens of area`;
    writeFileSync(join(out, `layers-${viewport}.txt`), `${text}\n`);
    console.log(text);
  } finally {
    await p.close();
  }
}

/* ------------------------------------------------------------------ tier */

/** A phone's GPU name, through WEBGL_debug_renderer_info. */
const fakeGpu = (renderer, cores, memory) => `
(() => {
  const patch = (C) => { if (!C) return; const get = C.prototype.getParameter; C.prototype.getParameter = function (p) { return p === 0x9246 ? ${JSON.stringify(renderer)} : get.call(this, p); }; };
  patch(window.WebGL2RenderingContext); patch(window.WebGLRenderingContext);
  Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => ${cores} });
  ${memory === null ? "" : `Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => ${memory} });`}
})();`;

async function tier() {
  const devices = [
    { name: "budget Android (Adreno 610, 4 GB)", gpu: "Adreno (TM) 610", cores: 8, memory: 4 },
    { name: "mid Android (Mali-G68, 6 GB)", gpu: "Mali-G68 MC4", cores: 8, memory: 6 },
    { name: "mid Android (Adreno 642L, 8 GB)", gpu: "Adreno (TM) 642L", cores: 8, memory: 8 },
    { name: "flagship Android (Adreno 750, 12 GB)", gpu: "Adreno (TM) 750", cores: 8, memory: 8 },
    { name: "iPhone (Apple GPU, no deviceMemory)", gpu: "Apple GPU", cores: 6, memory: null, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },
    { name: "this Mac's GPU as a phone", gpu: null, cores: 8, memory: 8 },
  ];
  const rows = [];
  for (const d of devices) {
    const p = await phone({ viewport: "portrait", ua: d.ua ?? ANDROID_UA, inject: d.gpu ? [fakeGpu(d.gpu, d.cores, d.memory)] : [] });
    try {
      await p.send("Page.navigate", { url: `${base}/play/patrol?debug=1` });
      await p.until("window.__wgpScene", 90000);
      const t = await p.evaluate("window.__wgpScene.tier");
      const dpr = await p.evaluate("window.__wgpScene.dpr");
      rows.push(`${d.name.padEnd(40)} → ${t} (dpr ${dpr.toFixed(2)})`);
      console.log(rows.at(-1));
    } finally {
      await p.close();
    }
  }
  writeFileSync(join(out, "tier-pick.txt"), `${rows.join("\n")}\n`);
}

/* ------------------------------------------------------------------ touch */

async function touchChecks() {
  const viewport = opt("viewport", "portrait");
  const p = await phone({ viewport });
  const log = [];
  const say = (s) => {
    log.push(s);
    console.log(s);
  };
  try {
    const { width: w, height: h } = p.v;
    await p.send("Page.navigate", { url: `${base}/play/patrol?debug=1&tier=low` });
    await p.until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 90000);
    await p.event("go");
    await sleep(400);
    const latch = (js) => p.evaluate(`(() => { const l = ${PLAY}.latch; return ${js}; })()`);
    const peek = () => p.evaluate(`${PLAY}.peek()`);
    const sx = Math.round(w * 0.2);
    const sy = Math.round(h * 0.7);

    // Dead zone: a 4px wobble is no stick.
    await p.touch("touchStart", 1, sx, sy);
    await p.touch("touchMove", 1, sx + 3, sy - 3);
    await sleep(120);
    say(`dead zone: a 4px wobble → stick ${JSON.stringify(await latch("l.stick ?? null"))}`);
    // Full push.
    for (let i = 1; i <= 8; i++) {
      await p.touch("touchMove", 1, sx, sy - i * 12);
      await sleep(16);
    }
    await sleep(120);
    say(`full push up 96px → stick ${JSON.stringify(await latch("l.stick ?? null"))}`);
    const ring = await p.evaluate(`(() => { const r = document.querySelector("[data-stick]") || document.querySelector("[role=application] > div.pointer-events-none"); if (!r) return null; const s = getComputedStyle(r); return { opacity: s.opacity, transform: s.transform }; })()`);
    say(`stick visual: ${JSON.stringify(ring)}`);

    // Second thumb on the right: the web, while the stick is held.
    await p.touch("touchStart", 2, Math.round(w * 0.75), Math.round(h * 0.45));
    await sleep(300);
    let s = await peek();
    say(`two thumbs → rope ${s.rope}, sim input ${JSON.stringify(s.input)}`);

    // A third finger taps a power while both are down.
    const power = await p.evaluate(`(() => { const b = document.querySelector('button[aria-label*=", key "]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
    if (power) {
      await latch("(l.__shots = 0, l.__push = l.__push || l.pushShot.bind(l), l.pushShot = (s) => { l.__shots += 1; l.__push(s); }, true)");
      await p.tapAt(power.x, power.y, 3);
      await sleep(200);
      s = await peek();
      say(`power ${power.w}×${power.h}px tapped mid-swing → ${await latch("l.__shots")} shot(s) fired, web still ${await latch("l.web")}, stick still ${JSON.stringify(await latch("l.stick ?? null"))}`);
    } else say("no power button found");

    // Lift the web thumb: the stick stays.
    await p.touch("touchEnd", 2, Math.round(w * 0.75), Math.round(h * 0.45));
    await sleep(200);
    say(`web thumb up → web ${await latch("l.web")}, stick ${JSON.stringify(await latch("l.stick ?? null"))}`);
    await p.touch("touchEnd", 1, sx, sy - 96);
    await sleep(200);
    say(`stick thumb up → stick ${JSON.stringify(await latch("l.stick ?? null"))}`);

    // A second finger tapping beside the web thumb (a re-grip) keeps the web.
    await p.touch("touchStart", 4, Math.round(w * 0.6), Math.round(h * 0.5));
    await sleep(100);
    await p.tapAt(Math.round(w * 0.5), Math.round(h * 0.62), 5);
    await sleep(100);
    say(`web thumb + a second finger's tap on the same side → web still ${await latch("l.web")}`);
    await p.touch("touchEnd", 4, Math.round(w * 0.6), Math.round(h * 0.5));
    await sleep(100);

    // A double tap and a pull down from the top: no zoom, no scroll, no refresh.
    await p.tapAt(Math.round(w * 0.5), 40);
    await sleep(60);
    await p.tapAt(Math.round(w * 0.5), 40);
    await p.touch("touchStart", 6, Math.round(w * 0.5), 30);
    for (let i = 1; i <= 10; i++) {
      await p.touch("touchMove", 6, Math.round(w * 0.5), 30 + i * 25);
      await sleep(16);
    }
    await p.touch("touchEnd", 6, Math.round(w * 0.5), 280);
    await sleep(300);

    // The pause sheet still scrolls under a thumb.
    const pause = await p.evaluate(`(() => { const b = document.querySelector("button[aria-label=Pause]"); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await p.tapAt(pause.x, pause.y);
    await sleep(600);
    const sheet = `document.querySelector("[aria-labelledby=pause-title]")`;
    const before = await p.evaluate(`${sheet}.scrollTop`);
    const r = await p.evaluate(`(() => { const r = ${sheet}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.75 }; })()`);
    await p.touch("touchStart", 7, r.x, r.y);
    for (let i = 1; i <= 8; i++) {
      await p.touch("touchMove", 7, r.x, r.y - i * 20);
      await sleep(16);
    }
    await p.touch("touchEnd", 7, r.x, r.y - 160);
    await sleep(400);
    const after = await p.evaluate(`${sheet}.scrollTop`);
    say(`pause sheet drag up 160px → scrollTop ${before} → ${Math.round(after)}`);

    // Page state: no scroll, no zoom.
    const page = await p.evaluate(`({ scrollY: window.scrollY, scale: window.visualViewport ? window.visualViewport.scale : 1, touchAction: getComputedStyle(document.querySelector("[role=application]")).touchAction, rootTouchAction: getComputedStyle(document.querySelector("[data-night]") || document.body).touchAction, overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY })`);
    say(`page: ${JSON.stringify(page)}`);
    writeFileSync(join(out, `touch-${viewport}.txt`), `${log.join("\n")}\n`);
  } finally {
    await p.close();
  }
}

if (mode === "shots") await shots();
else if (mode === "perf") await perf();
else if (mode === "tier") await tier();
else if (mode === "touch") await touchChecks();
else if (mode === "trace") await trace();
else if (mode === "layers") await layers();
else throw new Error(`unknown mode ${mode}`);
