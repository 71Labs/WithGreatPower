/**
 * Where a page's main thread goes while it loads: a JS sampling profile of a cold load
 * (throttled like measure.mjs), summed by function and by script, plus the long tasks.
 *
 *   node apps/wgp/scripts/perf/profile.mjs --base http://localhost:3690 --path /play [--view mobile] [--cpu 4]
 *        [--net slow4g|none] [--seconds 12] [--save save.json] [--out profile.cpuprofile]
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3690");
const path = opt("path", "/play");
const view = opt("view", "mobile");
const cpu = Number(opt("cpu", "4"));
const net = opt("net", "slow4g");
const seconds = Number(opt("seconds", "12"));
const save = opt("save", null);
const out = opt("out", null);

const port = 9500 + Math.floor(Math.random() * 100);
const profile = `/private/tmp/claude-501/wgp-prof-${port}`;
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const proc = spawn(CHROME, ["--headless=new", "--mute-audio", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
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
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id;
  pending.set(i, (m) => res(m.result));
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send("Page.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
if (view === "mobile") {
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36" });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
} else await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
if (cpu > 1) await send("Emulation.setCPUThrottlingRate", { rate: cpu });
if (net === "slow4g") await send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
if (save) await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(readFileSync(save, "utf8"))}); } catch {}` });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true }); } catch {}` });
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 200 });
await send("Profiler.start");
await send("Page.navigate", { url: base + path });
await sleep(seconds * 1000);
const { profile: prof } = await send("Profiler.stop");
const long = (await send("Runtime.evaluate", { expression: "window.__long", returnByValue: true })).result.value;
if (out) writeFileSync(out, JSON.stringify(prof));

// Self time per node, from the sample deltas.
const self = new Map();
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  self.set(n.id, (self.get(n.id) ?? 0) + (prof.timeDeltas[i] ?? 0) / 1000);
}
const fn = new Map();
const file = new Map();
for (const [nid, ms] of self) {
  const n = byId.get(nid);
  const cf = n.callFrame;
  const url = cf.url.replace(base, "").split("/").pop() || cf.url || "(native)";
  if (["(idle)", "(program)", "(garbage collector)"].includes(cf.functionName)) {
    fn.set(cf.functionName, (fn.get(cf.functionName) ?? 0) + ms);
    continue;
  }
  const k = `${cf.functionName || "(anonymous)"} ${url}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
  fn.set(k, (fn.get(k) ?? 0) + ms);
  file.set(url, (file.get(url) ?? 0) + ms);
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(7)} ms  ${k}`).join("\n");
console.log(`long tasks (start, ms): ${JSON.stringify(long)}`);
console.log(`\nby script:\n${top(file, 15)}`);
console.log(`\nby function:\n${top(fn, 30)}`);
ws.close();
proc.kill("SIGKILL");
await sleep(200);
rmSync(profile, { recursive: true, force: true });
