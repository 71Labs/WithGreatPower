/**
 * Free roam as a frame strip, over CDP: plays /play/city (the autopilot's tour, or a list of
 * steps) and captures the canvas every `--every` ms while recording the body's move, so the
 * movement chain can be checked frame by frame. Writes <out>/<label>-NNN.png, <out>/strip.json
 * (each frame's move, position and speed) and, with `--sheet`, a contact sheet via ffmpeg.
 *
 *   node launch/brand/hero/city-strip.mjs --out dir [--query "autopilot=1&debug=1"] [--seconds 30] [--every 250]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3920");
const out = opt("out", "launch/brand/hero/game-shots/free-roam/strip");
const query = opt("query", "autopilot=1&debug=1&tier=high");
const seconds = Number(opt("seconds", "30"));
const every = Number(opt("every", "250"));
const label = opt("label", "f");
const width = Number(opt("width", "960"));
const height = Number(opt("height", "600"));
const SAVE = opt("save", "launch/brand/hero/fixtures/hero-save.json");
mkdirSync(out, { recursive: true });

const { send, evaluate, logs, close } = await launch({ port: 9733, profile: "/tmp/wgp-city-strip" });
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
const save = readFileSync(SAVE, "utf8");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); } catch {}` });
await send("Page.navigate", { url: `${base}/play/city?${query}` });
for (let i = 0; i < 80; i++) {
  await sleep(250);
  if (await evaluate(`!!(window.__wgpCity && window.__wgpScene)`).catch(() => false)) break;
}
const frames = [];
const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < seconds * 1000) {
  const p = await evaluate(`window.__wgpCity.peek()`).catch(() => null);
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
  const name = `${label}-${String(n).padStart(3, "0")}.jpg`;
  writeFileSync(join(out, name), Buffer.from(data, "base64"));
  frames.push({ name, at: Date.now() - t0, tick: p?.tick, move: p?.move, pos: p && [p.x, p.y, p.z], v: p && Math.round(Math.hypot(p.vx, p.vz)), rope: p?.rope, stage: p?.stage, pages: p?.pages });
  n++;
  await sleep(every);
}
const scene = await evaluate(`window.__wgpScene ?? null`).catch(() => null);
writeFileSync(join(out, "strip.json"), JSON.stringify({ frames, scene, errors: logs.filter((l) => /error|exception/i.test(l)) }, null, 1));
console.log(frames.map((f) => `${f.name} t${f.tick} ${f.move} v${f.v}`).join("\n"));
console.log("scene", JSON.stringify(scene));
console.log(logs.filter((l) => /error|exception/i.test(l)).join("\n") || "no console errors");
if (args.includes("--sheet")) {
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", join(out, `${label}-*.jpg`), "-vf", `scale=320:-1,tile=6x${Math.ceil(n / 6)}`, "-frames:v", "1", join(out, `${label}-sheet.jpg`)]);
  } catch (e) {
    console.log("no sheet:", String(e).slice(0, 200));
  }
}
await close();
