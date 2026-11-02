/**
 * Proof shots of the cast (build_cast.py's bodies) from a running WGP server, over CDP:
 *
 *   node launch/brand/hero/cast-shoot.mjs --out <dir> [--base http://localhost:3540] [--c aunt-mainnet,sybil] [--tier high]
 *
 * Per character, in /lab/cast: a turntable (8 angles, the whole body), two head close-ups,
 * and every state its animator knows, each a still plus a short burst. Writes
 * <out>/<character>/{turn-N,head-N,<state>[-N]}.png and stats.json. cast-sheet.py lays the
 * before and after runs side by side.
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
const out = opt("out", join(HERE, "game-shots", "cast", "after"));
const tier = opt("tier", "high");
const ALLIES = ["aunt-mainnet", "uncle-gen", "mary-jpeg", "bearson", "gwei"];
const VILLAINS = ["gas-goblin", "sandwich-man", "doc-octochain", "sybil"];
const cast = opt("c", [...VILLAINS, ...ALLIES].join(",")).split(",");
const STATES = { ally: ["idle", "wave", "talk"], villain: ["idle", "windup", "attack", "hit", "stunned", "guard", "open", "webbed"] };
const HIDE = `details { display: none !important; } nextjs-portal { display: none !important; }`;
const save = join(HERE, "..", "..", "out", "saves", "night-a.json");

const port = 9700 + Math.floor(Math.random() * 50);
const { send, evaluate, close, logs } = await launch({ port, profile: `/private/tmp/claude-501/wgp-cast/cdp-${port}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const shot = async (file) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(data, "base64"));
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  try {
    const json = readFileSync(save, "utf8");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); } catch {}` });
  } catch {}
  const stats = {};
  for (const c of cast) {
    const dir = join(out, c);
    mkdirSync(dir, { recursive: true });
    await send("Page.navigate", { url: `${base}/lab/cast?c=${c}&s=idle&tier=${tier}&debug=1&turn=0` });
    await sleep(Number(opt("wait", 9000)));
    await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(HIDE)}; document.head.append(s); })()`);
    const lab = (js) => evaluate(`window.__wgpCast.${js}`);
    await lab(`set(${JSON.stringify(c)}, "idle")`);
    // The turntable, whole body.
    await lab("zoom(0.75)");
    for (let i = 0; i < 8; i++) {
      await lab(`angle(${(i * Math.PI) / 4})`);
      await sleep(450);
      await shot(join(dir, `turn-${i}.png`));
    }
    // The head, close, from the front and three-quarters (whichever way the body faces; a
    // villain holding still for it).
    if (!ALLIES.includes(c)) await lab(`set(${JSON.stringify(c)}, "open")`);
    await lab("angle(0)");
    await sleep(900);
    const yaw = (await lab("facing()")) ?? 0;
    await lab("zoom(0.24)");
    for (const [i, a] of [0, 0.7].entries()) {
      await lab(`angle(${yaw + a})`);
      await sleep(700);
      await shot(join(dir, `head-${i}.png`));
    }
    // Every state, a still and a burst.
    const states = ALLIES.includes(c) ? STATES.ally : STATES.villain;
    const far = c === "doc-octochain" || c === "sybil" ? 0.55 : 0.9;
    await lab(`zoom(${far})`);
    for (const s of states) {
      await lab(`set(${JSON.stringify(c)}, ${JSON.stringify(s)})`);
      await sleep(900);
      // From the front three-quarters of wherever the body faces now.
      const y = (await lab("facing()")) ?? 0;
      await lab(`angle(${y + 0.6})`);
      await sleep(700);
      await shot(join(dir, `${s}.png`));
      for (let i = 0; i < 4; i++) {
        await sleep(280);
        await shot(join(dir, `${s}-${i}.png`));
      }
    }
    stats[c] = await lab("stats()");
    console.log(c, JSON.stringify(stats[c]));
  }
  writeFileSync(join(out, "stats.json"), JSON.stringify(stats, null, 2));
  const errs = logs.filter((l) => (l.startsWith("exception") || l.startsWith("error")) && !/404|Failed to load resource/.test(l));
  if (errs.length) console.error(errs.slice(0, 10).join("\n"));
} finally {
  await close();
}
