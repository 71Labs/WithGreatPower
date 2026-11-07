/**
 * The City's touch free-look, measured on an emulated phone (915×412 landscape or 412×915
 * portrait, mobile, touch) against a running WGP server (`next dev` or `next start`, PGlite, no
 * .env.local): real touches over CDP (Input.dispatchTouchEvent) at a finger's pace (a move every
 * 16 ms, nothing evaluated in between), the camera's yaw sampled in the page every animation
 * frame from the scene's chase pose, and the sim's input read back as it goes.
 *
 *   node launch/brand/hero/city-look.mjs [--viewport landscape|portrait] [--label after] [--base http://127.0.0.1:4030] [--look 2] [--steady 1]
 *
 * The run: Jump tapped on the roof (still a jump), one finger dragged 240 px left then right on
 * the open screen (a turn, no web), the stick held with a look drag at once, a finger that rests
 * 250 ms and then drags (a swing and a look), and the pause button. Writes
 * <out>/freelook-<label>-<viewport>.json: yaw per drag (degrees, per 100 px), the per-frame
 * steps (mean, spread, largest), whether the web or the stick was ever held, the page's scroll
 * and zoom, and the console's errors.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "/Users/eromonseleodigie/near-hackathon/launch/lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? d : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:4030");
const vp = opt("viewport", "landscape");
const label = opt("label", "after");
const out = opt("out", "launch/brand/hero/game-shots/city-map-look");
const look = opt("look", null);
const steady = opt("steady", null);
const V = vp === "landscape" ? { width: 915, height: 412 } : { width: 412, height: 915 };
const c = await launch({ port: 9430, profile: "/private/tmp/claude-501/wgp-ux-cdp-9430", flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
await c.send("Page.enable");
await c.send("Runtime.enable");
await c.send("Emulation.setDeviceMetricsOverride", { width: V.width, height: V.height, deviceScaleFactor: 2, mobile: true, screenOrientation: V.width > V.height ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await c.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l" });
await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const save = readFileSync("/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json", "utf8");
const settings = look || steady ? JSON.stringify({ ...(look ? { look: Number(look) } : {}), ...(steady ? { steady: true } : {}) }) : null;
await c.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); ${settings ? `localStorage.setItem("wgp:3d-settings:v1", ${JSON.stringify(settings)});` : `localStorage.removeItem("wgp:3d-settings:v1");`} } catch {}`,
});
await c.send("Page.navigate", { url: `${base}/play/city?debug=1&tier=low` });
const until = async (js, ms = 120000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await c.evaluate(`!!(${js})`)) return;
    } catch {}
    await sleep(150);
  }
  throw new Error("timeout " + js + "\n" + c.logs.slice(-10).join("\n"));
};
await until(`window.__wgpCity && window.__wgpCity.peek().status === "live" && window.__wgpCity.handle() && window.__wgpCity.handle().pose()`);
await sleep(3000);
// The yaw every animation frame, and the sim's input every frame, in the page.
await c.evaluate(`(() => {
  window.__log = [];
  const step = () => {
    const p = window.__wgpCity.handle().pose();
    const k = window.__wgpCity.peek();
    if (p) window.__log.push({ t: performance.now(), yaw: Math.atan2(p.target.x - p.position.x, p.target.z - p.position.z), web: k.input.web, mag: k.input.mag, move: k.move });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return true;
})()`);

const fingers = new Map();
const touch = async (type, id, x, y) => {
  const p = { x, y, id, radiusX: 8, radiusY: 8, force: 1 };
  if (type === "touchEnd" || type === "touchCancel") {
    fingers.delete(id);
    await c.send("Input.dispatchTouchEvent", { type, touchPoints: [p] });
    return;
  }
  fingers.set(id, p);
  await c.send("Input.dispatchTouchEvent", { type, touchPoints: [...fingers.values()] });
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (r) => +((r * 180) / Math.PI).toFixed(2);
const now = () => c.evaluate("performance.now()");
const logSince = (t) => c.evaluate(`window.__log.filter((e) => e.t >= ${t})`);

/** Drag finger `id` from (x, y) by (dx, dy) over `ms`, a move every 16 ms (at a finger's pace). */
async function swipe(id, x, y, dx, dy, ms = 400) {
  await touch("touchStart", id, x, y);
  const steps = Math.max(2, Math.round(ms / 16));
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const want = t0 + i * 16;
    const wait = want - Date.now();
    if (wait > 0) await sleep(wait);
    await touch("touchMove", id, Math.round(x + (dx * i) / steps), Math.round(y + (dy * i) / steps));
  }
  await sleep(50);
  await touch("touchEnd", id, x + dx, y + dy);
}

const results = [];
async function measure(name, run, dx) {
  await sleep(2500);
  const t0 = await now();
  await run();
  await sleep(250);
  const log = await logSince(t0);
  const dur = log.filter((e) => e.t <= log.at(-1).t);
  const deltas = [];
  for (let i = 1; i < dur.length; i++) deltas.push(deg(wrap(dur[i].yaw - dur[i - 1].yaw)));
  const moving = deltas.filter((d) => Math.abs(d) > 0.05);
  const total = deg(wrap(dur.at(-1).yaw - dur[0].yaw));
  const mean = moving.reduce((a, b) => a + b, 0) / Math.max(1, moving.length);
  const sd = Math.sqrt(moving.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, moving.length));
  const r = {
    name,
    dxPx: dx,
    yawDeg: total,
    degPer100px: deg((wrap(dur.at(-1).yaw - dur[0].yaw) / Math.abs(dx)) * 100),
    frames: dur.length,
    turningFrames: moving.length,
    perFrameMeanDeg: +mean.toFixed(2),
    perFrameSdDeg: +sd.toFixed(2),
    maxStepDeg: moving.length ? Math.max(...moving.map(Math.abs)) : 0,
    webEver: dur.some((e) => e.web),
    stickEver: dur.some((e) => e.mag > 0),
    moves: [...new Set(dur.map((e) => e.move))],
  };
  results.push(r);
  console.log(JSON.stringify(r));
  return r;
}
const W = V.width;
const H = V.height;
// 0. The buttons still work: tap Jump on the roof (a jump), before any look.
const jumpBtn = await c.evaluate(`(() => { const b = document.querySelector('button[aria-label="Jump"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
let jumped = null;
if (jumpBtn) {
  await sleep(1500);
  await touch("touchStart", 11, Math.round(jumpBtn.x), Math.round(jumpBtn.y));
  await sleep(40);
  const moves = new Set();
  for (let i = 0; i < 10; i++) {
    moves.add(await c.evaluate("window.__wgpCity.peek().move"));
    await sleep(30);
  }
  await touch("touchEnd", 11, Math.round(jumpBtn.x), Math.round(jumpBtn.y));
  jumped = [...moves];
  console.log("jump button: moves seen", JSON.stringify(jumped));
}
// 1. One finger on the open screen (not the stick, not a button), dragged left then right.
await measure("one finger on the open screen, 240 px left", () => swipe(1, Math.round(W * 0.72), Math.round(H * 0.45), -240, 0), -240);
await measure("one finger on the open screen, 240 px right", () => swipe(1, Math.round(W * 0.48), Math.round(H * 0.45), 240, 0), 240);
// 2. The stick held (left thumb pushed up), and a look drag at the same time.
await measure(
  "stick held + one finger dragging 200 px right",
  async () => {
    const sx = Math.round(W * 0.15);
    const sy = Math.round(H * 0.72);
    await touch("touchStart", 7, sx, sy);
    for (let i = 1; i <= 6; i++) {
      await sleep(16);
      await touch("touchMove", 7, sx, sy - i * 9);
    }
    await sleep(120);
    await swipe(8, Math.round(W * 0.6), Math.round(H * 0.4), 200, 0);
    await sleep(80);
    await touch("touchEnd", 7, sx, sy - 54);
  },
  200,
);
// 3. A slow look: the finger rests a moment, then drags (this one holds the web too: a still thumb is a swing).
await measure(
  "finger rests 250 ms, then drags 200 px left",
  async () => {
    const x = Math.round(W * 0.7);
    const y = Math.round(H * 0.4);
    await touch("touchStart", 9, x, y);
    await sleep(250);
    for (let i = 1; i <= 20; i++) {
      await sleep(16);
      await touch("touchMove", 9, x - i * 10, y);
    }
    await sleep(50);
    await touch("touchEnd", 9, x - 200, y);
  },
  -200,
);
const sc = await c.evaluate(`({ scrollX, scrollY, zoom: window.visualViewport ? window.visualViewport.scale : null })`);
console.log("page scroll/zoom", JSON.stringify(sc));
// 4. The pause button still opens the sheet.
const pauseBtn = await c.evaluate(`(() => { const b = document.querySelector('button[aria-label="Pause"]'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
await sleep(800);
await touch("touchStart", 12, Math.round(pauseBtn.x), Math.round(pauseBtn.y));
await sleep(60);
await touch("touchEnd", 12, Math.round(pauseBtn.x), Math.round(pauseBtn.y));
await sleep(600);
const paused = await c.evaluate(`!!document.querySelector('#roam-pause-title')`);
console.log("pause button opens the sheet:", paused);
const errors = c.logs.filter((l) => /error|exception/i.test(l));
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `freelook-${label}-${vp}${look ? `-look${look}` : ""}${steady ? "-steady" : ""}.json`), JSON.stringify({ viewport: { ...V, mobile: true, hasTouch: true }, lookSpeed: look ? Number(look) : 1, steadyCamera: !!steady, results, pageScrollZoom: sc, jumpButtonMoves: jumped, pauseButtonOpensSheet: paused, consoleErrors: errors }, null, 1));
}
console.log(errors.slice(0, 10).join("\n") || "no console errors");
await c.close();
