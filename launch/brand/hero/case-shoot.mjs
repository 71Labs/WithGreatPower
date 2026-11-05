/**
 * Case file 001's 3D proof shots and measurements, from a running WGP server over CDP:
 *
 *   node launch/brand/hero/case-shoot.mjs shots  --out <dir> [--base http://localhost:3847]
 *   node launch/brand/hero/case-shoot.mjs lineup --out <dir>
 *   node launch/brand/hero/case-shoot.mjs perf   --out <dir> [--seconds 12]
 *   node launch/brand/hero/case-shoot.mjs probe  --out <dir> --q "scene=standoff&phase=aim"
 *
 * - shots: /lab/case (fixture chapter frames): each clue prop, the paper copies, the aim cone,
 *   the SCREENSHOT flash and its reduced-motion pulse, captive Mary at restore 0, 0.5 and 1,
 *   and Mary freed, on a desktop (1280 × 800) and a phone (390 × 844 at 3×), high tier.
 * - lineup: /lab/cast, the Right-Clicker beside the cast (same angle and zoom each), for
 *   case-sheet composition; plus his states.
 * - perf: the standoff's full loop and the rescue at high and low, desktop and phone (the
 *   phone's low tier with the CPU throttled ×4): frame rate, draw calls, triangles and the
 *   cast's CPU time, from the scene's own counters. Writes perf.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const mode = args[0] ?? "shots";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3847");
const out = opt("out", "launch/brand/hero/game-shots/case-001/art");
const HIDE = `details { display: none !important; } nextjs-portal { display: none !important; }`;

const DEVICES = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};

const port = 9760 + Math.floor(Math.random() * 30);
const { send, evaluate, close, logs } = await launch({ port, profile: `/private/tmp/claude-501/wgp-case/cdp-${port}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const shot = async (file) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log("shot", file);
};
const device = async (name) => {
  const d = DEVICES[name];
  await send("Emulation.setDeviceMetricsOverride", d);
  await send("Emulation.setTouchEmulationEnabled", { enabled: d.mobile });
};
const open = async (path, wait = Number(opt("wait", 9000))) => {
  await send("Page.navigate", { url: `${base}${path}` });
  await sleep(wait);
  await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(HIDE)}; document.head.append(s); })()`);
};
const set = (o) => evaluate(`window.__wgpCase.set(${JSON.stringify(o)})`);
const stats = () => evaluate("window.__wgpCase.stats()");

/** Wait for the standoff loop's flash (the frame's villain state) and shoot right after it fires. */
async function atFlash(file, after = 0) {
  // Watched in the page, frame by frame, so the shot follows the flash as closely as CDP allows.
  const seen = await evaluate(`new Promise((res) => {
    const t0 = performance.now();
    const f = () => {
      const v = window.__wgpCase.frame().villains[0];
      if (v && v.state === "flash") return res(true);
      if (performance.now() - t0 > 20000) return res(false);
      requestAnimationFrame(f);
    };
    f();
  })`);
  if (!seen) console.error("no flash seen for", file);
  if (after) await sleep(after);
  await shot(file);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");

  if (mode === "probe") {
    await device(opt("device", "desktop"));
    await open(`/lab/case?debug=1&${opt("q", "")}`);
    mkdirSync(out, { recursive: true });
    await shot(join(out, opt("name", "probe.png")));
    console.log(JSON.stringify(await stats()));
  }

  if (mode === "shots") {
    for (const dev of opt("devices", "desktop,phone").split(",")) {
      const dir = join(out, dev);
      mkdirSync(dir, { recursive: true });
      await device(dev);
      await open(`/lab/case?debug=1&tier=high&scene=investigate&clue=tabs`);
      for (const clue of ["tabs", "cursor", "pixels"]) {
        await set({ scene: "investigate", clue });
        await sleep(2600);
        await shot(join(dir, `clue-${clue}.png`));
      }
      // A clue just found: its glow dimmed, "+CLUE!".
      await set({ scene: "investigate", clue: "walk", restart: true });
      await sleep(3800);
      await shot(join(dir, `clue-found.png`));
      // The Right-Clicker aiming: the cone on the deck.
      await set({ scene: "standoff", phase: "aim", reduced: false });
      await sleep(3200);
      await shot(join(dir, `standoff-aim.png`));
      // Paper copies.
      await set({ scene: "standoff", phase: "copy" });
      await sleep(2500);
      await shot(join(dir, `copies.png`));
      // The loop: the flash, "SAVED!", then the reduced-motion pulse.
      await set({ scene: "standoff", phase: "cycle", reduced: false, restart: true });
      await sleep(600);
      await atFlash(join(dir, `flash.png`), 0);
      await sleep(260);
      await shot(join(dir, `saved.png`));
      await set({ scene: "standoff", phase: "cycle", reduced: true, restart: true });
      await sleep(600);
      await atFlash(join(dir, `flash-reduced.png`), 200);
      await set({ reduced: false });
      // Captive Mary.
      for (const r of [0, 0.5, 1]) {
        await set({ scene: "rescue", restore: r });
        await sleep(2200);
        await shot(join(dir, `mary-restore-${String(r).replace(".", "")}.png`));
      }
      await set({ scene: "done", restore: 1 });
      await sleep(500);
      await shot(join(dir, `mary-freed.png`));
      await sleep(1600);
      await shot(join(dir, `mary-freed-wave.png`));
    }
  }

  if (mode === "lineup") {
    const dir = join(out, "lineup");
    mkdirSync(dir, { recursive: true });
    await device("desktop");
    const who = opt("c", "right-clicker,hero,gas-goblin,sandwich-man,sybil,mary-jpeg,bearson").split(",");
    for (const c of who) {
      await send("Page.navigate", { url: `${base}/lab/cast?c=${c}&s=idle&tier=high&debug=1&turn=0` });
      await sleep(9000);
      await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(HIDE)}; document.head.append(s); })()`);
      const lab = (js) => evaluate(`window.__wgpCast.${js}`);
      await lab(`set(${JSON.stringify(c)}, "idle")`);
      await lab("zoom(0.62)");
      await sleep(600);
      const yaw = (await lab("facing()")) ?? 0;
      for (const [i, a] of [0, 0.6, Math.PI / 2].entries()) {
        await lab(`angle(${yaw + a})`);
        await sleep(600);
        await shot(join(dir, `${c}-${i}.png`));
      }
      if (c === "right-clicker") {
        await lab("zoom(0.24)");
        for (const [i, a] of [0, 0.45].entries()) {
          await lab(`angle(${yaw + a})`);
          await sleep(700);
          await shot(join(dir, `${c}-head-${i}.png`));
        }
        await lab("zoom(0.75)");
        for (const s of ["walk", "aim", "flash", "recover", "copy", "drag", "stunned", "webbed"]) {
          await lab(`set("right-clicker", ${JSON.stringify(s)})`);
          await sleep(s === "flash" ? 1500 : s === "webbed" ? 2200 : 900);
          await lab(`angle(${yaw + 0.9})`);
          await sleep(500);
          await shot(join(dir, `${c}-state-${s}.png`));
        }
      }
    }
  }

  if (mode === "perf") {
    const secs = Number(opt("seconds", 12));
    const runs = [
      { dev: "desktop", tier: "high", cpu: 1 },
      { dev: "desktop", tier: "low", cpu: 1 },
      { dev: "phone", tier: "high", cpu: 1 },
      { dev: "phone", tier: "low", cpu: 4 },
    ];
    const res = [];
    for (const r of runs) {
      await device(r.dev);
      await send("Emulation.setCPUThrottlingRate", { rate: r.cpu });
      for (const scene of ["investigate", "standoff", "rescue"]) {
        await open(`/lab/case?debug=1&tier=${r.tier}&scene=${scene}&clue=walk&panel=0`, 10000);
        const samples = [];
        const t0 = Date.now();
        while (Date.now() - t0 < secs * 1000) {
          await sleep(500);
          const s = await stats();
          if (s) samples.push(s);
        }
        const keep = samples.slice(2);
        const med = (k) => {
          const xs = keep.map((s) => s[k]).sort((a, b) => a - b);
          return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
        };
        const max = (k) => Math.max(0, ...keep.map((s) => s[k]));
        const row = { ...r, scene, fps: med("fps"), callsMedian: med("calls"), callsMax: max("calls"), triangles: med("triangles"), castMs: med("castMs"), castMaxMs: max("castMaxMs"), dpr: med("dpr"), n: keep.length };
        res.push(row);
        console.log(JSON.stringify(row));
      }
      await send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "perf.json"), JSON.stringify(res, null, 2));
  }

  const errs = logs.filter((l) => (l.startsWith("exception") || l.startsWith("error")) && !/404|Failed to load resource/.test(l));
  if (errs.length) console.error(errs.slice(0, 12).join("\n"));
} finally {
  await close();
}
