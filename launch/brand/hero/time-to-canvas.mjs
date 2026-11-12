/**
 * Time to the city for a first-time visitor on a phone (375 × 812, touch), against a local
 * production build (`next build && next start -H 127.0.0.1 -p 4620`; no database needed, a
 * guest never touches it):
 *
 *   node launch/brand/hero/time-to-canvas.mjs [--base http://127.0.0.1:4620] [--port 9921]
 *        [--runs 3] [--out <file.json>]
 *
 * Two paths, each from an empty browser profile (no save, no session):
 *   - "landing": opens /, taps "Play now", and times from the tap.
 *   - "play":    opens /play directly, and times from the navigation.
 * For each it records when a loading pill ("Suiting up…", "Loading the city…") was last on screen, which path
 * the visitor ended on, and when the 3D stage's <canvas> (three.js stamps its own with
 * `data-engine`; the backdrops and minimaps don't count) was first laid out. A path that
 * never reaches a canvas (a form in the way) reports `canvasMs: null` and where it stopped.
 *
 * Each path runs unthrottled and again on a slow phone: 4× CPU, 150 ms round trips,
 * 1.6 Mbit/s down, and /api/me held for a second on top (the cold-start answer a deployed
 * server gives), since "who's signed in" is what the old first visit waited on.
 * Medians are printed; `--out` also writes every run.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCH = process.env.WGP_LAUNCH ?? join(HERE, "..", "..");
const { launch, sleep } = await import(pathToFileURL(join(LAUNCH, "lib", "cdp.mjs")).href);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const BASE = opt("base", "http://127.0.0.1:4620");
const PORT = Number(opt("port", "9921"));
const RUNS = Number(opt("runs", "3"));
const OUT = opt("out", "");
const LIMIT_MS = 30_000;

/** Runs in every document: stamps the pill's last sighting and the first canvas, on the page's own clock. */
const PROBE = `(() => {
  const epoch = () => performance.timeOrigin + performance.now();
  const key = "wgp:ttc";
  const read = () => { try { return JSON.parse(sessionStorage.getItem(key) || "{}"); } catch { return {}; } };
  const write = (patch) => { try { sessionStorage.setItem(key, JSON.stringify({ ...read(), ...patch })); } catch {} };
  const look = () => {
    const pill = [...document.querySelectorAll("[role=status]")].some((el) => /Suiting up|Loading the city/.test(el.textContent || ""));
    if (pill) write({ pillLast: epoch(), pillFirst: read().pillFirst ?? epoch() });
    const canvas = [...document.querySelectorAll('canvas[data-engine^="three"]')].find((c) => c.getBoundingClientRect().width > 200);
    if (canvas && !read().canvas) write({ canvas: epoch(), canvasPath: location.pathname });
    requestAnimationFrame(look);
  };
  if (document.documentElement) look(); else document.addEventListener("DOMContentLoaded", look);
})()`;

async function once(path, slow) {
  const chrome = await launch({ port: PORT, profile: `/private/tmp/claude-501/wgp-ttc-${PORT}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const { send, evaluate } = chrome;
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
    if (slow) {
      await send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
      await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/me", requestStage: "Request" }] });
      chrome.on("Fetch.requestPaused", (p) => {
        setTimeout(() => send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {}), 1000);
      });
    }
    let t0;
    if (path === "landing") {
      await send("Page.navigate", { url: `${BASE}/` });
      for (let i = 0; i < 200; i++) {
        if (await evaluate(`document.readyState === "complete" && [...document.querySelectorAll("a")].some((a) => /Play now/.test(a.textContent))`).catch(() => false)) break;
        await sleep(100);
      }
      await sleep(1500);
      // The tap, on the hero's own "Play now".
      const at = await evaluate(`(() => { const a = [...document.querySelectorAll("a")].find((a) => /Play now/.test(a.textContent) && a.getBoundingClientRect().width > 0); a.scrollIntoView({ block: "center" }); const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, href: a.getAttribute("href") }; })()`);
      t0 = await evaluate(`performance.timeOrigin + performance.now()`);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      t0 = Date.now();
      await send("Page.navigate", { url: `${BASE}/play` });
    }
    let seen = {};
    let where = "";
    let stable = 0;
    for (let t = 0; t < LIMIT_MS; t += 100) {
      await sleep(100);
      const now = await evaluate(`({ path: location.pathname, t: JSON.parse(sessionStorage.getItem("wgp:ttc") || "{}"), form: !!document.querySelector("form, [role=radiogroup], input") })`).catch(() => null);
      if (!now) continue;
      seen = now.t;
      if (seen.canvas) {
        where = seen.canvasPath;
        break;
      }
      // Stopped on a screen that asks for something first: no canvas is coming.
      stable = now.path === where && now.form ? stable + 1 : 0;
      where = now.path;
      if (stable >= 30) break;
    }
    return {
      endedOn: where,
      canvasMs: seen.canvas ? Math.round(seen.canvas - t0) : null,
      loadingPillMs: seen.pillLast ? Math.max(0, Math.round(seen.pillLast - Math.max(t0, seen.pillFirst))) : 0,
      loadingPillUntilMs: seen.pillLast ? Math.round(seen.pillLast - t0) : 0,
    };
  } finally {
    await chrome.close();
  }
}

const median = (xs) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const results = [];
for (const path of ["landing", "play"]) {
  for (const slow of [false, true]) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await once(path, slow));
    const row = {
      path: path === "landing" ? "/ → tap “Play now”" : "/play (first visit)",
      network: slow ? "slow phone" : "unthrottled",
      endedOn: runs[runs.length - 1].endedOn,
      canvasMs: median(runs.map((r) => r.canvasMs)),
      loadingPillUntilMs: median(runs.map((r) => r.loadingPillUntilMs)),
      runs,
    };
    results.push(row);
    console.log(`${row.path.padEnd(22)} ${row.network.padEnd(12)} ended on ${row.endedOn.padEnd(14)} canvas ${row.canvasMs === null ? "never" : `${row.canvasMs} ms`}; loading pill last seen at ${row.loadingPillUntilMs} ms`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
