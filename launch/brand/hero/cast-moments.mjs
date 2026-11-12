/**
 * In-game moments of the cast from a full autopilot night, over CDP: every fight (its villain
 * squaring up, attacking, struck, caught), every errand (the ally turning, reaching out,
 * talking) and Gwei's assist, as bursts of frames named by what's on screen.
 *
 *   node launch/brand/hero/cast-moments.mjs --save launch/out/saves/night-b.json --out <dir> [--base http://localhost:3540] [--tier high]
 *
 * Writes <out>/<kind>-<who>-<n>.png and moments.json (what was shot when).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sleep } from "../../lib/cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3540");
const out = opt("out", join(HERE, "game-shots", "cast", "moments"));
const tier = opt("tier", "high");
const save = opt("save", join(HERE, "..", "..", "out", "saves", "night-a.json"));
mkdirSync(out, { recursive: true });

const port = 9750 + Math.floor(Math.random() * 40);
const { send, evaluate, close, logs } = await launch({ port, profile: `/tmp/wgp-cast/cdp-${port}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const shot = async (file) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, file), Buffer.from(data, "base64"));
};
const PEEK = `(() => {
  const p = window.__wgpPlay;
  if (!p) return null;
  const s = p.run.sim;
  const city = p.run.city ?? s.city;
  const z = city?.zones?.[s.index];
  const done = !!document.querySelector('[aria-label="Ranking"]') || /Night (over|complete)|Results/i.test(document.body.innerText);
  return { status: p.loop.status, mode: s.mode, index: s.index, villain: z?.villain ?? null, ally: z?.ally ?? null, gwei: !!s.gwei, done };
})()`;

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const json = readFileSync(save, "utf8");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); } catch {}` });
  await send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&tier=${tier}` });
  const moments = [];
  const seen = new Set();
  const t0 = Date.now();
  let lastMode = "";
  while (Date.now() - t0 < 900_000) {
    await sleep(200);
    const p = await evaluate(PEEK);
    if (!p) continue;
    if (p.done || p.status === "done") break;
    const burst = async (kind, who, n, every) => {
      for (let i = 0; i < n; i++) {
        const f = `${kind}-${who}-${String(i).padStart(2, "0")}.png`;
        await shot(f);
        moments.push({ t: (Date.now() - t0) / 1000, f, mode: p.mode });
        await sleep(every);
      }
    };
    if (p.gwei && !seen.has("gwei")) {
      seen.add("gwei");
      await burst("gwei", "assist", 8, 160);
      continue;
    }
    if (p.mode === "fight" && p.villain && !seen.has(`fight-${p.index}`)) {
      seen.add(`fight-${p.index}`);
      await sleep(1200);
      await burst("fight", p.villain, 14, 380);
    } else if (p.mode === "won" && p.villain && !seen.has(`won-${p.index}`)) {
      seen.add(`won-${p.index}`);
      await burst("caught", p.villain, 6, 300);
    } else if (p.mode === "errand" && p.ally && !seen.has(`errand-${p.index}`)) {
      seen.add(`errand-${p.index}`);
      await burst("errand", p.ally, 10, 350);
    }
    lastMode = p.mode;
  }
  void lastMode;
  writeFileSync(join(out, "moments.json"), JSON.stringify(moments, null, 2));
  const errs = logs.filter((l) => (l.startsWith("exception") || l.startsWith("error")) && !/404|Failed to load resource/.test(l));
  console.log(JSON.stringify({ shots: moments.length, kinds: [...seen], errors: errs.slice(0, 8) }));
} finally {
  await close();
}
