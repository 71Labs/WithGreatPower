/**
 * Stills of every body in /lab/cast (the hero and the cast), frame-exact, for comparing two
 * sets of model files pixel for pixel:
 *
 *   node apps/wgp/scripts/perf/cast-shots.mjs --base http://localhost:3690 --out <dir> [--tier high] [--c hero,sybil]
 *
 * The page's clock is frozen (performance.now and requestAnimationFrame are stepped by hand,
 * 1/60 s a frame), so every run draws the same frames: one frame to start the lab, a wait
 * until every file has loaded, then the idle state, held at a fixed point, from three views,
 * each after the same number of frames. Writes <out>/<character>-{body,body-side,head}.png.
 * Compare two runs with compare-shots.mjs; two runs of the same files should match exactly.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3690");
const out = opt("out", "cast-shots");
const tier = opt("tier", "high");
const cast = opt("c", "hero,gas-goblin,sandwich-man,doc-octochain,sybil,aunt-mainnet,uncle-gen,mary-jpeg,bearson,gwei").split(",");
mkdirSync(out, { recursive: true });

/** A hand-stepped clock (nothing animates until __step(n) runs n frames of 1/60 s) and a seeded Math.random. */
const CLOCK = `(() => {
  let t = 1000;
  let queue = [];
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const epoch = Date.now();
  Date.now = () => epoch + t;
  performance.now = () => t;
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (n) => {
    for (let i = 0; i < n; i++) {
      t += 1000 / 60;
      const run = queue;
      queue = [];
      for (const cb of run) cb(t);
    }
  };
})();`;

const port = 9400 + Math.floor(Math.random() * 90);
const profile = `/private/tmp/claude-501/wgp-shots-${port}`;
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const proc = spawn(CHROME, ["--headless=new", "--hide-scrollbars", "--mute-audio", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--force-color-profile=srgb", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let target;
for (let i = 0; i < 100 && !target; i++) {
  await sleep(150);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const inflight = new Set();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Network.requestWillBeSent") inflight.add(m.params.requestId);
  else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") inflight.delete(m.params.requestId);
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const shot = async (file) => writeFileSync(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
/** Until nothing has been in flight for a second. */
async function idle() {
  let quiet = 0;
  for (let i = 0; i < 300 && quiet < 5; i++) {
    await sleep(200);
    quiet = inflight.size ? 0 : quiet + 1;
  }
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
  const HIDE = "details, nextjs-portal { display: none !important; }";
  for (const c of cast) {
    await send("Page.navigate", { url: `${base}/lab/cast?c=${c}&s=idle&tier=${tier}&debug=1&turn=0` });
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      if (await evaluate("!!window.__wgpCast")) break;
    }
    await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(HIDE)}; document.head.append(s); })()`);
    // One frame starts everything that waits for a frame, then every file comes in.
    await evaluate("window.__step(1)");
    await idle();
    await sleep(500);
    const lab = (js) => evaluate(`window.__wgpCast.${js}`);
    await lab(`set(${JSON.stringify(c)}, "idle")`);
    await lab("scrub(0.35)");
    await sleep(300);
    for (const [name, zoom, angle] of [
      ["body", 0.75, 0.5],
      ["body-side", 0.75, 2.2],
      ["head", 0.24, 0.3],
    ]) {
      await lab(`zoom(${zoom})`);
      await lab(`angle(${angle})`);
      await sleep(300);
      await evaluate("window.__step(90)");
      await sleep(400);
      await shot(join(out, `${c}-${name}.png`));
    }
    console.log(c);
  }
} finally {
  ws.close();
  proc.kill("SIGKILL");
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
