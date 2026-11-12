/**
 * Load-performance check over the Chrome DevTools Protocol: a cold load of a page in headless
 * Chrome (on the GPU, so the 3D night really draws) with throttled network and CPU, and the
 * numbers that matter for it.
 *
 *   node apps/wgp/scripts/perf/measure.mjs --base http://localhost:3690 [--runs 3] [--out dir]
 *        [--pages /,/play,/play/patrol] [--views mobile,desktop] [--net slow4g|fast4g|none] [--cpu 4]
 *        [--save path/to/save.json] [--warm]
 *
 * - Every page: FCP, LCP, CLS, TBT (long tasks over 50 ms, from navigation to 5 s after load),
 *   and the bytes moved (JS, CSS, fonts, images, media, models, audio, other; encoded sizes).
 * - /play/patrol (a guest save from --save goes into localStorage first): when the canvas made
 *   its first WebGL draw, when the countdown showed (the night is playable), and when the
 *   hero's body file and clips had arrived.
 * - --warm: a second navigation with the cache on, after the cold one (a repeat visit): the
 *   same numbers plus how many requests still went to the network.
 *
 * Writes <out>/<label>.json (every run) and prints the medians. Chrome is the one at $CHROME
 * (default: the macOS Google Chrome app).
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const base = opt("base", "http://localhost:3690");
const runs = Number(opt("runs", "3"));
const out = opt("out", null);
const label = opt("label", "run");
const pages = opt("pages", "/,/play,/play/patrol").split(",");
const views = opt("views", "mobile,desktop").split(",");
const netName = opt("net", "slow4g");
const cpu = Number(opt("cpu", "4"));
const savePath = opt("save", null);
const warm = flag("warm");

/** DevTools' presets: "Slow 4G" (was "Fast 3G") and "Fast 4G". Throughput in bytes per second. */
const NETWORKS = {
  slow4g: { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1e6 * 0.9) / 8, uploadThroughput: (750 * 1e3 * 0.9) / 8 },
  fast4g: { offline: false, latency: 165, downloadThroughput: (9 * 1e6 * 0.9) / 8, uploadThroughput: (1.5 * 1e6 * 0.9) / 8 },
  none: null,
};
const VIEWS = {
  mobile: {
    metrics: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    touch: true,
  },
  desktop: { metrics: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, ua: null, touch: false },
};

async function launch(port) {
  const profile = `/tmp/wgp-perf-${port}`;
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--hide-scrollbars",
      "--mute-audio",
      "--use-angle=metal",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(150);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(`${m.error.message} ${m.error.data ?? ""}`));
      else res(m.result);
    } else if (m.method) handlers.get(m.method)?.forEach((fn) => fn(m.params));
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const on = (method, fn) => {
    if (!handlers.has(method)) handlers.set(method, new Set());
    handlers.get(method).add(fn);
    return () => handlers.get(method).delete(fn);
  };
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => {
    try {
      ws.close();
    } catch {}
    proc.kill("SIGKILL");
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  };
  return { send, on, evaluate, close };
}

/** Injected before any page script: paint, LCP, CLS and long-task observers, and the 3D night's marks. */
const PROBE = `(() => {
  const P = (window.__perf = { lcp: 0, cls: 0, long: [], fcp: 0, gl: 0, draw: 0, frame: 0, countdown: 0, go: 0 });
  const po = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  po("paint", (e) => { if (e.name === "first-contentful-paint") P.fcp = e.startTime; });
  po("largest-contentful-paint", (e) => { P.lcp = e.startTime; P.lcpEl = e.element ? (e.element.tagName + (e.url ? " " + e.url.split("/").pop().split("?")[0] : "")) : ""; });
  po("layout-shift", (e) => { if (!e.hadRecentInput) P.cls += e.value; });
  po("longtask", (e) => P.long.push([e.startTime, e.duration]));
  // The first WebGL 2 context, its first draw call, and the next animation frame (the frame on screen).
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const c = getContext.call(this, kind, ...rest);
    if (c && kind === "webgl2" && this.isConnected && this.offsetWidth > 100 && !P.gl) P.gl = performance.now();
    return c;
  };
  for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
    const fn = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...a) {
      if (!P.draw && P.gl && this.canvas.isConnected && this.canvas.offsetWidth > 100) {
        P.draw = performance.now();
        requestAnimationFrame((t) => (P.frame = performance.now()));
      }
      return fn.apply(this, a);
    };
  }
  // The countdown sticker over the hero (play-surface.tsx) is the night being playable.
  new MutationObserver(() => {
    if (!P.countdown && document.querySelector("[data-night] span.animate-rise")) P.countdown = performance.now();
  }).observe(document, { subtree: true, childList: true });
})();`;

const kindOf = (url, type, mime = "") => {
  const u = url.split("?")[0];
  if (/\.glb$/.test(u)) return "models";
  if (/\/audio\//.test(u) || mime.startsWith("audio/")) return "audio";
  if (type === "Script" || /\.js$/.test(u)) return "js";
  if (type === "Stylesheet" || /\.css$/.test(u)) return "css";
  if (type === "Font" || /\.woff2?$/.test(u)) return "fonts";
  if (type === "Image" || mime.startsWith("image/")) return "images";
  if (type === "Media" || mime.startsWith("video/")) return "media";
  if (type === "Document") return "html";
  return "other";
};

async function measure(c, view, path, { cold }) {
  const reqs = new Map();
  const offs = [
    c.on("Network.requestWillBeSent", (p) => {
      if (!reqs.has(p.requestId)) reqs.set(p.requestId, { url: p.request.url, type: p.type, start: p.timestamp, bytes: 0, cached: false, status: 0 });
    }),
    c.on("Network.responseReceived", (p) => {
      const r = reqs.get(p.requestId);
      if (!r) return;
      r.type = p.type;
      r.mime = p.response.mimeType;
      r.status = p.response.status;
      r.cached = p.response.fromDiskCache || p.response.fromMemoryCache || p.response.fromServiceWorker;
      r.cc = p.response.headers["cache-control"] ?? p.response.headers["Cache-Control"];
    }),
    c.on("Network.requestServedFromCache", (p) => {
      const r = reqs.get(p.requestId);
      if (r) r.cached = true;
    }),
    c.on("Network.loadingFinished", (p) => {
      const r = reqs.get(p.requestId);
      if (r) {
        r.bytes = p.encodedDataLength;
        r.end = p.timestamp;
      }
    }),
  ];
  let navStart = 0;
  const offNav = c.on("Network.requestWillBeSent", (p) => {
    if (!navStart && p.type === "Document") navStart = p.timestamp;
  });
  const loaded = new Promise((r) => {
    const off = c.on("Page.loadEventFired", (p) => {
      off();
      r(p.timestamp);
    });
  });
  await c.send("Page.navigate", { url: base + path });
  const loadAt = await Promise.race([loaded, sleep(120000).then(() => 0)]);
  const patrol = path === "/play/patrol";
  // Settle: 5 s after load for the pages; for the night, until the hero's files are in and the countdown showed (max 120 s).
  const until = Date.now() + (patrol ? 120000 : 5000);
  while (Date.now() < until) {
    await sleep(250);
    if (!patrol) continue;
    const p = await c.evaluate("window.__perf").catch(() => null);
    const heroDone = [...reqs.values()].filter((r) => /\/models\/hero(-lo)?\.glb|hero-anims\.glb/.test(r.url) && r.end).length >= 2;
    if (p?.countdown && heroDone) {
      await sleep(3000);
      break;
    }
  }
  const p = await c.evaluate("window.__perf");
  offs.forEach((f) => f());
  offNav();
  const rel = (t) => (t ? Math.round((t - navStart) * 1000) : null);
  const bytes = {};
  let network = 0;
  let total = 0;
  const all = [...reqs.values()].filter((r) => !r.url.startsWith("data:"));
  for (const r of all) {
    const k = kindOf(r.url, r.type, r.mime);
    bytes[k] = (bytes[k] ?? 0) + r.bytes;
    total += r.bytes;
    if (!r.cached) network++;
  }
  const fcp = p.fcp;
  const tbt = p.long.filter(([s]) => s >= fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
  const hero = all.filter((r) => /\/models\/hero(-lo)?\.glb/.test(r.url));
  const heroAnims = all.filter((r) => /hero-anims\.glb/.test(r.url));
  const res = {
    view,
    path,
    cold,
    fcp: Math.round(p.fcp),
    lcp: Math.round(p.lcp),
    lcpEl: p.lcpEl,
    cls: Number(p.cls.toFixed(4)),
    tbt: Math.round(tbt),
    longTasks: p.long.length,
    load: rel(loadAt),
    requests: all.length,
    networkRequests: network,
    totalBytes: total,
    bytes,
    list: all.map((r) => ({ url: r.url.replace(base, ""), kind: kindOf(r.url, r.type, r.mime), status: r.status, cached: r.cached, cc: r.cc, bytes: r.bytes, start: rel(r.start), end: rel(r.end) })),
  };
  if (patrol) {
    Object.assign(res, {
      gl: Math.round(p.gl),
      firstDraw: Math.round(p.draw),
      firstFrame: Math.round(p.frame),
      countdown: Math.round(p.countdown),
      heroFile: hero.length ? Math.max(...hero.map((r) => rel(r.end) ?? 0)) : null,
      bytesToCountdown: all.filter((r) => r.end && rel(r.end) <= p.countdown).reduce((a, r) => a + r.bytes, 0),
      jsToCountdown: all.filter((r) => r.end && rel(r.end) <= p.countdown && kindOf(r.url, r.type, r.mime) === "js").reduce((a, r) => a + r.bytes, 0),
      heroReady: hero.length && heroAnims.length ? Math.max(...[...hero, ...heroAnims].map((r) => rel(r.end) ?? 0)) : null,
    });
  }
  return res;
}

async function one(view, path, i) {
  const port = 9800 + Math.floor(Math.random() * 150);
  const c = await launch(port);
  try {
    const v = VIEWS[view];
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Network.enable");
    await c.send("Emulation.setDeviceMetricsOverride", v.metrics);
    if (v.ua) await c.send("Emulation.setUserAgentOverride", { userAgent: v.ua, platform: "Android" });
    if (v.touch) await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    if (cpu > 1) await c.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const net = NETWORKS[netName];
    if (net) await c.send("Network.emulateNetworkConditions", net);
    await c.send("Network.setCacheDisabled", { cacheDisabled: !warm });
    if (savePath) {
      const json = readFileSync(savePath, "utf8");
      await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); } catch {}` });
    }
    await c.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    const cold = await measure(c, view, path, { cold: true });
    let repeat = null;
    if (warm) {
      await c.send("Page.navigate", { url: "about:blank" });
      await sleep(500);
      repeat = await measure(c, view, path, { cold: false });
    }
    return { run: i, cold, repeat };
  } finally {
    await c.close();
  }
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const results = [];
for (const view of views)
  for (const path of pages)
    for (let i = 0; i < runs; i++) {
      const r = await one(view, path, i);
      results.push(r);
      const c = r.cold;
      const extra = c.countdown !== undefined ? ` draw ${c.firstDraw} countdown ${c.countdown} hero ${c.heroReady}` : "";
      console.error(`${view} ${path} #${i}: fcp ${c.fcp} lcp ${c.lcp} cls ${c.cls} tbt ${c.tbt} js ${c.bytes.js ?? 0} total ${c.totalBytes}${extra}${r.repeat ? ` | repeat: net reqs ${r.repeat.networkRequests}/${r.repeat.requests} bytes ${r.repeat.totalBytes} countdown ${r.repeat.countdown ?? "-"} lcp ${r.repeat.lcp}` : ""}`);
    }

const KEYS = ["fcp", "lcp", "cls", "tbt", "load", "totalBytes", "requests", "networkRequests", "gl", "firstDraw", "firstFrame", "countdown", "heroFile", "heroReady", "bytesToCountdown", "jsToCountdown"];
const summary = [];
for (const view of views)
  for (const path of pages) {
    const rs = results.filter((r) => r.cold.view === view && r.cold.path === path);
    for (const phase of warm ? ["cold", "repeat"] : ["cold"]) {
      const row = { view, path, phase };
      for (const k of KEYS) row[k] = median(rs.map((r) => r[phase]?.[k]));
      for (const k of ["js", "css", "fonts", "images", "media", "models", "audio", "html", "other"]) row[`bytes.${k}`] = median(rs.map((r) => r[phase]?.bytes[k] ?? 0));
      summary.push(row);
    }
  }
console.log(JSON.stringify(summary, null, 2));
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${label}.json`), JSON.stringify({ base, net: netName, cpu, runs, summary, results }, null, 2));
}
