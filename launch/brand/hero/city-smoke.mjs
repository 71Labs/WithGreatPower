/**
 * Free roam's smoke check over CDP: open /play/city as a guest with a hero save, wait for the
 * city, take a shot, print the console's errors and the scene's numbers.
 *
 *   node launch/brand/hero/city-smoke.mjs [--base http://127.0.0.1:3920] [--out dir] [--query "autopilot=1"] [--cdp 9731]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3920");
const out = opt("out", "launch/brand/hero/game-shots/free-roam/smoke");
const query = opt("query", "debug=1");
const wait = Number(opt("wait", "8000"));
const SAVE = opt("save", "launch/brand/hero/fixtures/hero-save.json");
mkdirSync(out, { recursive: true });

const cdpPort = Number(opt("cdp", "9731"));
const { send, evaluate, logs, close } = await launch({ port: cdpPort, profile: `/tmp/wgp-city-smoke-${cdpPort}` });
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const save = readFileSync(SAVE, "utf8");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); } catch {}` });
await send("Page.navigate", { url: `${base}/play/city?${query}` });
await sleep(wait);
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
};
await shot("city");
const peek = await evaluate(`(() => { const c = window.__wgpCity; return c ? c.peek() : null; })()`).catch((e) => String(e));
const scene = await evaluate(`window.__wgpScene ?? null`).catch(() => null);
console.log(JSON.stringify({ peek, scene }, null, 1));
console.log(logs.filter((l) => /error|exception/i.test(l)).join("\n") || "no console errors");
await close();
