/**
 * The render pass (high-quality rendering), over CDP, against a running WGP server (a
 * production build for the numbers):
 *
 *   node launch/brand/hero/hq-shoot.mjs discover --base http://localhost:3760
 *   node launch/brand/hero/hq-shoot.mjs moments  --label before --tier high --viewport desktop
 *   node launch/brand/hero/hq-shoot.mjs perf     --label before --tier high --viewport desktop [--cpu 1] [--gl metal|swiftshader]
 *   node launch/brand/hero/hq-shoot.mjs compare  --a before --b after
 *
 * - discover: plays a night with the autopilot and logs the sim every few ticks (mode, rope,
 *   grounded, where the hero is, over the bridge or not) and every event with its tick, to
 *   pick the moments.
 * - moments: the same autopilot night, frozen at fixed sim ticks (the sim and the bot are
 *   deterministic for a save, so the same tick is the same moment before and after): a
 *   rooftop stand, a swing, a fight and the bridge. The camera settles on the frozen frame,
 *   the HUD is hidden, and the canvas is captured.
 * - perf: a whole autopilot night: every animation frame's time from "go" to the outro (the
 *   percentiles), the GPU's time per frame (EXT_disjoint_timer_query_webgl2, wrapped around
 *   everything a frame issues), draw calls and triangles through the night (the scene's
 *   debug stats), and GPU memory: every buffer, texture and renderbuffer the page allocates
 *   (counted from the WebGL calls) plus the canvas's own drawing buffer.
 * - compare: side-by-side sheets of two labels' moments (needs python3 with Pillow).
 *
 * Viewports: desktop (1440×900 at DPR 2, a laptop or desktop browser) and portrait (390×844 at
 * DPR 3, a phone, touch and a phone's user agent). SwiftShader (a software GPU) stands in for a
 * weak phone GPU's fill rate. Writes game-shots/hq-render/<label>/…. Needs launch/lib/cdp.mjs
 * and launch/out/saves; from a worktree without them, WGP_LAUNCH=<a checkout's launch/>.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCH = process.env.WGP_LAUNCH ?? join(HERE, "..", "..");
const { launch, sleep } = await import(pathToFileURL(join(LAUNCH, "lib", "cdp.mjs")).href);

const args = process.argv.slice(2);
const mode = args[0] ?? "moments";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3760");
const label = opt("label", "after");
const ROOT = opt("out", join(HERE, "game-shots", "hq-render"));
const out = join(ROOT, label);
const saves = opt("saves", join(LAUNCH, "out", "saves"));
/** Moments come from night-b (Doc's bridge over the river); perf runs night-a, as the phone pass did. */
const saveName = opt("save", mode === "moments" || mode === "discover" ? "night-b" : "night-a");
mkdirSync(out, { recursive: true });

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
  portrait: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};
const PLAY = "window.__wgpPlay";
const GL = opt("gl", "metal");
const GL_FLAGS = GL === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];

/**
 * GPU memory, from the WebGL calls: bytes per buffer, per texture level and face, per
 * renderbuffer (times its samples), less what's deleted; and the canvas's drawing buffer
 * (colour and depth, ×4 with multisampling, plus the resolved and displayed copies).
 */
const GPU_MEMORY = `
(() => {
  // Remember each canvas's context as the app creates it: asking for one here first would
  // create it with default attributes (multisampled, with alpha) and change what's measured.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...a) { const ctx = getContext.apply(this, a); if (ctx && !this.__ctx) this.__ctx = ctx; return ctx; };
  window.__appGl = () => { const c = document.querySelector("[role=application] canvas"); return c && c.__ctx ? c.__ctx : null; };
  const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  if (!P) return;
  const G = WebGL2RenderingContext;
  const sizes = { [G.RGBA8]: 4, [G.RGB8]: 4, [G.SRGB8_ALPHA8]: 4, [G.RGBA16F]: 8, [G.RGBA32F]: 16, [G.RGB16F]: 8, [G.RGB32F]: 16, [G.R8]: 1, [G.RG8]: 2, [G.R16F]: 2, [G.R32F]: 4, [G.RG16F]: 4, [G.RG32F]: 8,
    [G.DEPTH_COMPONENT16]: 2, [G.DEPTH_COMPONENT24]: 4, [G.DEPTH_COMPONENT32F]: 4, [G.DEPTH24_STENCIL8]: 4, [G.DEPTH32F_STENCIL8]: 8, [G.RGB565]: 2, [G.RGBA4]: 2, [G.RGB5_A1]: 2,
    [G.R11F_G11F_B10F]: 4, [G.RGB10_A2]: 4, [G.STENCIL_INDEX8]: 1, [G.R8UI]: 1, [G.RGBA8UI]: 4, [G.R32UI]: 4, [G.RGBA32UI]: 16 };
  const channels = { [G.RGBA]: 4, [G.RGB]: 3, [G.RG]: 2, [G.RED]: 1, [G.LUMINANCE_ALPHA]: 2, [G.LUMINANCE]: 1, [G.ALPHA]: 1, [G.DEPTH_COMPONENT]: 1, [G.DEPTH_STENCIL]: 1, [G.RGBA_INTEGER]: 4, [G.RED_INTEGER]: 1 };
  const typeBytes = { [G.UNSIGNED_BYTE]: 1, [G.BYTE]: 1, [G.FLOAT]: 4, [G.HALF_FLOAT]: 2, [G.UNSIGNED_SHORT]: 2, [G.SHORT]: 2, [G.UNSIGNED_INT]: 4, [G.INT]: 4, [G.UNSIGNED_INT_24_8]: 4, [G.UNSIGNED_SHORT_5_6_5]: 2, [G.UNSIGNED_SHORT_4_4_4_4]: 2, [G.UNSIGNED_SHORT_5_5_5_1]: 2 };
  const bpp = (internal, format, type) => sizes[internal] ?? (channels[format ?? internal] ?? 4) * (typeBytes[type] ?? 1);
  const bufs = new Map();
  const texs = new Map();
  const rbs = new Map();
  const state = new WeakMap();
  const st = (gl) => { let s = state.get(gl); if (!s) { s = { buf: new Map(), tex: new Map(), unit: 0, rb: null }; state.set(gl, s); } return s; };
  const texTarget = (t) => (t >= G.TEXTURE_CUBE_MAP_POSITIVE_X && t <= G.TEXTURE_CUBE_MAP_NEGATIVE_Z ? G.TEXTURE_CUBE_MAP : t);
  const boundTex = (gl, target) => st(gl).tex.get(st(gl).unit + ":" + texTarget(target));
  const setLevel = (tex, key, bytes) => { if (!tex) return; let m = texs.get(tex); if (!m) { m = new Map(); texs.set(tex, m); } m.set(key, bytes); };
  const wrap = (name, fn) => { const orig = P[name]; if (!orig) return; P[name] = function (...a) { const r = orig.apply(this, a); try { fn.call(this, a, r); } catch {} return r; }; };
  wrap("bindBuffer", function ([target, b]) { st(this).buf.set(target, b); });
  wrap("bufferData", function ([target, data, usage, off, len]) { const b = st(this).buf.get(target); if (b) bufs.set(b, typeof data === "number" ? data : len ? len * (data.BYTES_PER_ELEMENT || 1) : data ? data.byteLength : 0); });
  wrap("deleteBuffer", function ([b]) { bufs.delete(b); });
  wrap("activeTexture", function ([u]) { st(this).unit = u; });
  wrap("bindTexture", function ([target, t]) { st(this).tex.set(st(this).unit + ":" + target, t); });
  wrap("texStorage2D", function ([target, levels, internal, w, h]) { let total = 0; for (let l = 0; l < levels; l++) total += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(internal); setLevel(boundTex(this, target), "storage", total * (target === G.TEXTURE_CUBE_MAP ? 6 : 1)); });
  wrap("texStorage3D", function ([target, levels, internal, w, h, d]) { let total = 0; for (let l = 0; l < levels; l++) total += Math.max(1, w >> l) * Math.max(1, h >> l) * (target === G.TEXTURE_3D ? Math.max(1, d >> l) : d) * bpp(internal); setLevel(boundTex(this, target), "storage", total); });
  wrap("texImage2D", function (a) {
    const [target, level, internal] = a;
    let w, h, format, type;
    if (a.length >= 8 && typeof a[3] === "number" && typeof a[4] === "number" && typeof a[6] === "number") { w = a[3]; h = a[4]; format = a[6]; type = a[7]; }
    else { format = a[3]; type = a[4]; const src = a[5]; w = src ? src.videoWidth || src.naturalWidth || src.displayWidth || src.width || 0 : 0; h = src ? src.videoHeight || src.naturalHeight || src.displayHeight || src.height || 0 : 0; }
    setLevel(boundTex(this, target), target + ":" + level, w * h * bpp(internal, format, type));
  });
  wrap("texImage3D", function ([target, level, internal, w, h, d, border, format, type]) { setLevel(boundTex(this, target), target + ":" + level, w * h * d * bpp(internal, format, type)); });
  wrap("compressedTexImage2D", function (a) { const [target, level] = a; const data = a[6]; setLevel(boundTex(this, target), target + ":" + level, typeof data === "number" ? data : data ? data.byteLength : 0); });
  wrap("generateMipmap", function ([target]) { const t = boundTex(this, target); const m = t && texs.get(t); if (!m || m.has("storage")) return; let l0 = 0; for (const [k, v] of m) if (k.endsWith(":0")) l0 += v; m.set("mips", l0 / 3); });
  wrap("deleteTexture", function ([t]) { texs.delete(t); });
  wrap("bindRenderbuffer", function ([target, rb]) { st(this).rb = rb; });
  wrap("renderbufferStorage", function ([target, internal, w, h]) { if (st(this).rb) rbs.set(st(this).rb, w * h * bpp(internal)); });
  wrap("renderbufferStorageMultisample", function ([target, samples, internal, w, h]) { if (st(this).rb) rbs.set(st(this).rb, w * h * bpp(internal) * Math.max(1, samples)); });
  wrap("deleteRenderbuffer", function ([rb]) { rbs.delete(rb); });
  const sum = (m) => { let s = 0; for (const v of m.values()) s += typeof v === "number" ? v : [...v.values()].reduce((a, b) => a + b, 0); return s; };
  window.__gpuMem = () => {
    const c = document.querySelector("[role=application] canvas");
    const gl = window.__appGl();
    const aa = gl ? gl.getContextAttributes().antialias : false;
    const px = c ? c.width * c.height : 0;
    // Colour and depth-stencil (×4 multisampled), plus the resolved and displayed colour buffers.
    const canvas = px * (aa ? 8 * 4 + 4 : 8) + px * 4;
    const mb = (b) => +(b / 1048576).toFixed(1);
    const buffers = sum(bufs), textures = sum(texs), renderbuffers = sum(rbs);
    return { buffersMB: mb(buffers), texturesMB: mb(textures), renderbuffersMB: mb(renderbuffers), canvasMB: mb(canvas), totalMB: mb(buffers + textures + renderbuffers + canvas), antialias: aa, canvasPx: c ? [c.width, c.height] : null };
  };
})();
`;

/**
 * Frame times and GPU times. A rAF loop registered before the app's runs first in every
 * frame: it stamps the frame and the loop's status, ends the last frame's timer query
 * (everything the app issued since) and begins the next.
 */
const FRAME_HOOK = `
window.__frames = [];
window.__gpu = [];
window.__scene = [];
setInterval(() => { const s = window.__wgpScene; if (s) window.__scene.push([Math.round(performance.now()), s.calls, s.triangles, +s.dpr.toFixed(2), s.fps | 0, s.programs, s.textures, s.geometries]); }, 500);
(() => {
  let gl = null, ext = null, active = null;
  const pending = [];
  const frame = (t) => {
    const p = window.__wgpPlay;
    window.__frames.push(t, p && p.loop ? ({ intro: 1, live: 2, paused: 3, outro: 4, done: 5 })[p.loop.status] || 0 : 0);
    if (!gl && window.__appGl) {
      gl = window.__appGl();
      ext = gl && gl.getExtension("EXT_disjoint_timer_query_webgl2");
    }
    if (gl && ext) {
      if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push([active, t]); active = null; }
      while (pending.length && gl.getQueryParameter(pending[0][0], gl.QUERY_RESULT_AVAILABLE)) {
        const [q, at] = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) window.__gpu.push(at, gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      if (pending.length < 8) { active = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, active); }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
`;

/** Freeze the night at a sim tick: the bot's input source pauses the loop once it reaches it. */
const FREEZE_HOOK = `
window.__freezeAt = Infinity;
window.__log = [];
window.__ev = [];
(function hook() {
  const p = window.__wgpPlay;
  if (p && p.loop && !p.loop.__frozen) {
    p.loop.__frozen = true;
    const loop = p.loop;
    const src = loop.source;
    loop.source = (run) => {
      const s = run.sim;
      if (s.tick >= window.__freezeAt) { window.__freezeAt = Infinity; loop.setPaused(true); }
      if (s.tick % 6 === 0) {
        const v = loop.view;
        window.__log.push([s.tick, v.mode, v.stop, !!v.hero.anchor, v.hero.grounded, Math.round(v.hero.pos.x), Math.round(v.hero.pos.y), Math.round(v.hero.pos.z), v.hero.action || "", Math.round(Math.hypot(v.hero.vel.x, v.hero.vel.y, v.hero.vel.z))]);
      }
      return src(run);
    };
    loop.bus.on((e) => window.__ev.push([run().sim.tick, e.type, e.status ?? e.value ?? ""]));
    function run() { return loop.run; }
  }
  setTimeout(hook, 20);
})();
`;

async function browser({ viewport, cpu = 1, inject = [] }) {
  const port = 9800 + Math.floor(Math.random() * 80);
  const c = await launch({ port, profile: `/private/tmp/claude-501/wgp-hq/cdp-${port}`, flags: GL_FLAGS });
  const v = VIEWPORTS[viewport];
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: v.mobile, ...(v.mobile ? { screenOrientation: { type: "portraitPrimary", angle: 0 } } : {}) });
  if (v.mobile) {
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await c.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA, platform: "Linux armv8l", userAgentMetadata: { platform: "Android", platformVersion: "14", architecture: "arm", model: "Pixel 7a", mobile: true } });
  }
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  if (cpu > 1) await c.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const json = readFileSync(join(saves, `${saveName}.json`), "utf8");
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); localStorage.removeItem("wgp:3d-settings:v1"); } catch {}` });
  for (const source of [GPU_MEMORY, FRAME_HOOK, FREEZE_HOOK, ...inject]) await c.send("Page.addScriptToEvaluateOnNewDocument", { source });
  const until = async (js, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await c.evaluate(`!!(${js})`)) return true;
      } catch {}
      await sleep(60);
    }
    throw new Error(`timed out waiting for ${js}\n${c.logs.slice(-8).join("\n")}`);
  };
  return { ...c, v, until };
}

const url = (tier) => `${base}/play/patrol?autopilot=1&debug=1${tier === "auto" ? "" : `&tier=${tier}`}`;
const ready = `${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`;

/* ------------------------------------------------------------------ discover */

async function discover() {
  const p = await browser({ viewport: opt("viewport", "desktop") });
  try {
    await p.send("Page.navigate", { url: url(opt("tier", "high")) });
    await p.until(ready, 120000);
    await p.until(`${PLAY}.loop.status === "done"`, 600000);
    const log = await p.evaluate("window.__log");
    const ev = await p.evaluate("window.__ev");
    const bridge = await p.evaluate(`(() => { const c = ${PLAY}.run.sim.city; return { bridge: c.bridge ? { deck: c.bridge.deck } : null, river: c.river, zones: c.zones.map((z) => ({ kind: z.kind, villain: z.villain, ally: z.ally, center: z.center })) }; })()`);
    writeFileSync(join(out, "discover.json"), JSON.stringify({ city: bridge, ev, log }, null, 0));
    console.log(JSON.stringify(bridge, null, 1));
    console.log(ev.filter((e) => !["thwip", "release", "pickup"].includes(e[1])).map((e) => e.join(" ")).join("\n"));
  } finally {
    await p.close();
  }
}

/* ------------------------------------------------------------------ moments */

/** Ticks of the night-b autopilot run (see discover.json): the moments to compare. */
const MOMENTS = JSON.parse(opt("moments", "null")) ?? [
  ["1-stand", -1],
  ["2-swing", 66],
  ["3-bridge", 372],
  ["4-fight-bridge", 744],
  ["5-fight-roof", 2470],
  // A hit on the bridge (blast + villain-hit at 836), caught before its burst and debris fade.
  ["6-impact", 838, 140],
];

async function moments() {
  const tier = opt("tier", "high");
  const viewport = opt("viewport", "desktop");
  const p = await browser({ viewport });
  // Only the canvas: the HUD, the toasts and the debug readout hidden.
  const clean = `const st = document.createElement("style"); st.textContent = "body * { visibility: hidden !important; } [role=application] canvas { visibility: visible !important; } nextjs-portal { display: none !important; }"; document.head.appendChild(st);`;
  try {
    await p.send("Page.navigate", { url: url(tier) });
    await p.until(ready, 120000);
    await p.evaluate(clean);
    for (const [name, tick, settle] of MOMENTS) {
      if (tick < 0) {
        // The rooftop stand: the countdown on the start roof.
        await p.until(`${PLAY}.loop.status === "intro"`, 60000);
        await sleep(400);
        await p.evaluate(`${PLAY}.loop.setPaused(true)`);
      } else {
        await p.evaluate(`window.__freezeAt = ${tick}`);
        await p.until(`${PLAY}.loop.status === "paused"`, 240000);
      }
      // The camera settles on the frozen frame.
      await sleep(settle ?? Number(opt("settle", "2200")));
      const at = await p.evaluate(`${PLAY}.peek()`);
      const { data } = await p.send("Page.captureScreenshot", { format: "png" });
      const file = join(out, `${viewport}-${tier}-${name}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log(`  ${file}  tick ${at.tick} ${at.mode} (${at.x}, ${at.y}, ${at.z}) rope ${at.rope}`);
      await p.evaluate(`${PLAY}.loop.setPaused(false)`);
    }
    const logs = p.logs.filter((l) => !/React DevTools|HMR|Fast Refresh|THREE\.Clock/.test(l));
    if (logs.length) console.log(logs.slice(0, 8).join("\n"));
  } finally {
    await p.close();
  }
}

/* ------------------------------------------------------------------ perf */

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  return { n: ms.length, mean: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), worst: +s[s.length - 1].toFixed(1) };
}

async function perf() {
  const tier = opt("tier", "high");
  const cpu = Number(opt("cpu", "1"));
  const viewport = opt("viewport", "desktop");
  const p = await browser({ viewport, cpu });
  try {
    await p.send("Page.navigate", { url: url(tier) });
    await p.until(ready, 180000);
    await p.until(`${PLAY}.loop.status === "live"`, 120000);
    const t0 = await p.evaluate("performance.now()");
    let peak = null;
    const sampler = setInterval(async () => {
      try {
        const m = await p.evaluate("window.__gpuMem && window.__gpuMem()");
        if (m && (!peak || m.totalMB > peak.totalMB)) peak = m;
      } catch {}
    }, 2000);
    // The whole night, or (for quick A/B checks) the first --seconds of it.
    if (opt("seconds")) await sleep(Number(opt("seconds")) * 1000);
    else await p.until(`${PLAY}.loop.status === "done"`, 900000);
    clearInterval(sampler);
    const t1 = await p.evaluate("performance.now()");
    const raw = await p.evaluate("window.__frames");
    const gpuRaw = await p.evaluate("window.__gpu");
    const scene = (await p.evaluate("window.__scene")).filter(([t]) => t >= t0 && t <= t1);
    const mem = await p.evaluate("window.__gpuMem()");
    const ms = [];
    for (let i = 2; i < raw.length; i += 2) {
      if (raw[i] < t0 || raw[i] > t1) continue;
      if (raw[i + 1] !== 2 && raw[i + 1] !== 4) continue;
      ms.push(raw[i] - raw[i - 2]);
    }
    const gpu = [];
    for (let i = 0; i < gpuRaw.length; i += 2) if (gpuRaw[i] >= t0 && gpuRaw[i] <= t1) gpu.push(gpuRaw[i + 1]);
    const col = (k) => scene.map((r) => r[k]);
    const range = (xs) => (xs.length ? { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2), max: Math.max(...xs) } : null);
    const f = stats(ms);
    const result = {
      label,
      tier,
      viewport,
      cpu,
      gl: GL,
      nightSeconds: +((t1 - t0) / 1000).toFixed(1),
      fps: +(1000 / f.mean).toFixed(1),
      frameMs: f,
      over33: +((ms.filter((x) => x > 34).length / ms.length) * 100).toFixed(1),
      gpuMs: gpu.length ? stats(gpu) : null,
      calls: range(col(1)),
      triangles: range(col(2)),
      dpr: range(col(3)),
      programs: range(col(5)),
      gpuMemory: { end: mem, peak: peak ?? mem },
    };
    const name = `perf-${viewport}-${tier}-cpu${cpu}${GL === "metal" ? "" : `-${GL}`}${opt("suffix") ? `-${opt("suffix")}` : ""}`;
    writeFileSync(join(out, `${name}.json`), JSON.stringify({ ...result, frameMsAll: ms.map((x) => +x.toFixed(2)) }));
    const text = Object.entries(result)
      .map(([k, v]) => `${k.padEnd(13)} ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("\n");
    writeFileSync(join(out, `${name}.txt`), `${text}\n`);
    console.log(text);
    const logs = p.logs.filter((l) => !/React DevTools|HMR|Fast Refresh|THREE\.Clock/.test(l));
    if (logs.length) console.log(logs.slice(0, 8).join("\n"));
  } finally {
    await p.close();
  }
}

/* ------------------------------------------------------------------ compare */

function compare() {
  const a = opt("a", "before");
  const b = opt("b", "after");
  const dir = join(ROOT, "compare");
  mkdirSync(dir, { recursive: true });
  const py = `
import sys, os
from PIL import Image, ImageDraw, ImageFont
a, b, out = sys.argv[1], sys.argv[2], sys.argv[3]
names = sorted(n for n in os.listdir(a) if n.endswith(".png") and os.path.exists(os.path.join(b, n)))
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 34)
except Exception:
    font = ImageFont.load_default()
for n in names:
    ia, ib = Image.open(os.path.join(a, n)).convert("RGB"), Image.open(os.path.join(b, n)).convert("RGB")
    h = max(ia.height, ib.height)
    sheet = Image.new("RGB", (ia.width + ib.width + 24, h + 64), (20, 22, 48))
    sheet.paste(ia, (0, 64)); sheet.paste(ib, (ia.width + 24, 64))
    d = ImageDraw.Draw(sheet)
    d.text((16, 14), "BEFORE  " + n[:-4], fill=(255, 255, 255), font=font)
    d.text((ia.width + 40, 14), "AFTER  " + n[:-4], fill=(255, 214, 74), font=font)
    if sheet.width > 3000:
        sheet = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
    sheet.save(os.path.join(out, n[:-4] + ".jpg"), quality=88)
    print(os.path.join(out, n[:-4] + ".jpg"))
`;
  if (!existsSync(join(ROOT, a)) || !existsSync(join(ROOT, b))) throw new Error("both labels need moments");
  console.log(execFileSync("python3", ["-c", py, join(ROOT, a), join(ROOT, b), dir]).toString());
}

if (mode === "discover") await discover();
else if (mode === "moments") await moments();
else if (mode === "perf") await perf();
else if (mode === "compare") compare();
else throw new Error(`unknown mode ${mode}`);
