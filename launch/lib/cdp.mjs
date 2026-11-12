/**
 * A tiny Chrome DevTools Protocol client: launches its own headless Chrome (own port,
 * own profile dir), connects to the first page and exposes send()/on().
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9611, profile = `/tmp/wgp-video-cdp-${port}`, flags = [], headless = "--headless=new" } = {}) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      headless,
      "--hide-scrollbars",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      ...flags,
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
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
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
  const logs = [];
  on("Runtime.consoleAPICalled", (p) => logs.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description).join(" ")}`));
  on("Runtime.exceptionThrown", (p) => logs.push(`exception: ${p.exceptionDetails.text} ${p.exceptionDetails.exception?.description ?? ""}`));
  /** Evaluate an expression in the page and return its value. */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${expression}\n${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
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
  return { send, on, evaluate, close, logs, proc };
}
