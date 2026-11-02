/**
 * Proof shots of the in-game hero, from a running WGP server (headless Chrome over CDP).
 *
 *   node launch/brand/hero/shoot.mjs lab   --out <dir> [--states idle,run,…] [--c hero] [--tier high] [--angle 0.6] [--zoom 1] [--scrub 0.25] [--debug]
 *       /lab/cast, one still per state (the controls panel hidden), plus stats.json;
 *       [--frames 24 --every 100] takes a sequence per state instead.
 *   node launch/brand/hero/shoot.mjs seq   --out <dir> --url "/lab/cast?c=hero&s=swing&turn=0" [--count 24] [--every 80] [--wait 5000] [--live]
 *       A frame sequence from any page (--live: a night's, --wait ms after play goes live;
 *       --mode fight: after the first fight starts).
 *   node launch/brand/hero/shoot.mjs night --out <dir> [--tier high] [--w 1440] [--h 900] [--touch] [--every 4000]
 *       A full autopilot night (/play/patrol?autopilot=1&debug=1) to the results screen: renderer
 *       stats sampled every second, console errors, a frame every --every ms tagged with the
 *       sim's mode, bursts of frames on the first fight and errand, and summary.json.
 *
 * Common: [--base http://localhost:3530] [--w 1280] [--h 800] [--dpr 1] [--save launch/out/saves/night-a.json] [--uncapped]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sleep } from "../../lib/cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const base = opt("base", "http://localhost:3530");
const out = opt("out", join(HERE, "game-shots", "tmp"));
const touch = flag("touch");
const width = Number(opt("w", cmd === "night" ? 1440 : 1280));
const height = Number(opt("h", cmd === "night" ? 900 : 800));
const dpr = Number(opt("dpr", touch ? 3 : 1));
const save = opt("save", join(HERE, "..", "..", "out", "saves", "night-a.json"));

const HIDE_PANEL = `
  details { display: none !important; }
  nextjs-portal { display: none !important; }
`;

mkdirSync(out, { recursive: true });
const port = 9640 + Math.floor(Math.random() * 50);
// --uncapped: no vsync or frame-rate limit, so fps reads the renderer's headroom rather than the display's rate.
const uncapped = flag("uncapped") ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : [];
const { send, evaluate, close, logs } = await launch({ port, profile: `/private/tmp/claude-501/wgp-hero/cdp-${port}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", ...uncapped] });

const shot = async (file) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, file), Buffer.from(data, "base64"));
};
const errors = () => logs.filter((l) => (l.startsWith("exception") || l.startsWith("error")) && !/404|Failed to load resource/.test(l));

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: touch });
  if (touch) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const json = readFileSync(save, "utf8");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); } catch {}` });

  if (cmd === "lab") {
    const c = opt("c", "hero");
    const tier = opt("tier", "high");
    const states = opt("states", "idle,run,swing,air,climb,dash,slam,held,hurt,ko").split(",");
    const angle = Number(opt("angle", 0.6));
    await send("Page.navigate", { url: `${base}/lab/cast?c=${c}&s=${states[0]}&tier=${tier}&debug=1&turn=0${flag("debug") ? "&bones=1" : ""}` });
    await sleep(Number(opt("wait", 6000)));
    await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(HIDE_PANEL)}; document.head.append(s); })()`);
    await evaluate(`window.__wgpCast.angle(${angle})`);
    await evaluate(`window.__wgpCast.zoom?.(${Number(opt("zoom", 1))})`);
    if (opt("scrub", null) !== null) await evaluate(`window.__wgpCast.scrub(${Number(opt("scrub", 0))})`);
    const stats = {};
    for (const s of states) {
      // The climb's wall stands at +x: look at it from the roof side.
      await evaluate(`window.__wgpCast.angle(${s === "climb" ? -1.25 : angle})`);
      await evaluate(`window.__wgpCast.set(${JSON.stringify(c)}, ${JSON.stringify(s)})`);
      await sleep(Number(opt("settle", s === "swing" ? 1400 : 1700)));
      const frames = Number(opt("frames", 1));
      if (frames > 1) {
        // A sequence: the state's motion every --every ms.
        mkdirSync(join(out, `${c}-${s}`), { recursive: true });
        for (let i = 0; i < frames; i++) {
          await shot(join(`${c}-${s}`, `${String(i).padStart(3, "0")}.png`));
          await sleep(Number(opt("every", 100)));
        }
      } else await shot(`${c}-${s}.png`);
      stats[s] = await evaluate("window.__wgpCast.stats()");
    }
    writeFileSync(join(out, "stats.json"), JSON.stringify(stats, null, 2));
  } else if (cmd === "seq") {
    const url = opt("url", "/lab/cast?c=hero&s=swing&turn=0");
    await send("Page.navigate", { url: base + url });
    if (flag("live")) {
      // A night: from the moment play goes live (or reaches --mode), not from navigation.
      const mode = opt("mode", null);
      for (let i = 0; i < (mode ? 900 : 120); i++) {
        const p = await evaluate("window.__wgpPlay?.peek?.() ?? null");
        if (p?.status === "live" && (!mode || p.mode === mode)) break;
        await sleep(mode ? 100 : 250);
      }
    }
    await sleep(Number(opt("wait", 5000)));
    await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(HIDE_PANEL)}; document.head.append(s); })()`);
    const count = Number(opt("count", 24));
    const every = Number(opt("every", 80));
    for (let i = 0; i < count; i++) {
      await shot(`${String(i).padStart(3, "0")}.png`);
      await sleep(every);
    }
  } else if (cmd === "night") {
    const tier = opt("tier", "high");
    const every = Number(opt("every", 4000));
    const t0 = Date.now();
    await send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&debug=1&tier=${tier}` });
    const samples = [];
    const frames = [];
    const bursts = { fight: 0, errand: 0, travel: 0 };
    let lastShot = 0;
    let lastMode = "";
    let done = false;
    const limit = Number(opt("limit", 900)) * 1000;
    while (Date.now() - t0 < limit) {
      await sleep(1000);
      const st = await evaluate(`(() => { const p = window.__wgpPlay?.peek?.(); const s = window.__wgpScene; const results = !!document.querySelector('[aria-label="Ranking"]') || /Night (over|complete)|Results/i.test(document.body.innerText); return { p: p ? { status: p.status, mode: p.mode, index: p.index, over: p.over, error: p.error } : null, s: s ?? null, results }; })()`);
      if (st.s && st.p && st.p.status === "live") samples.push({ t: (Date.now() - t0) / 1000, mode: st.p.mode, fps: st.s.fps, calls: st.s.calls, tris: st.s.triangles, dpr: st.s.dpr, tier: st.s.tier, castMs: st.s.castMs, castMaxMs: st.s.castMaxMs });
      const mode = st.p?.mode ?? "";
      const now = Date.now();
      if (st.p?.status === "live" && (mode === "fight" || mode === "errand") && mode !== lastMode && bursts[mode] < 2) {
        // A short burst on entering a fight or an errand.
        bursts[mode]++;
        for (let i = 0; i < 6; i++) {
          const f = `${mode}-${bursts[mode]}-${i}.png`;
          await shot(f);
          frames.push({ f, mode });
          await sleep(250);
        }
      } else if (now - lastShot > every && st.p) {
        lastShot = now;
        const f = `n-${String(frames.length).padStart(3, "0")}-${mode || "boot"}.png`;
        await shot(f);
        frames.push({ f, mode });
      }
      lastMode = mode;
      if (st.results || st.p?.status === "done") {
        await sleep(2500);
        await shot("results.png");
        done = true;
        break;
      }
    }
    const pick = (k) => samples.map((x) => x[k]).sort((a, b) => a - b);
    const med = (xs) => (xs.length ? xs[Math.floor(xs.length / 2)] : 0);
    const max = (xs) => (xs.length ? xs[xs.length - 1] : 0);
    const summary = {
      tier,
      size: `${width}x${height}@${dpr}${touch ? " touch" : ""}`,
      reachedResults: done,
      seconds: Math.round((Date.now() - t0) / 1000),
      fps: { median: med(pick("fps")), min: pick("fps")[0] ?? 0 },
      calls: { median: med(pick("calls")), max: max(pick("calls")) },
      triangles: { median: med(pick("tris")), max: max(pick("tris")) },
      castMs: { median: med(pick("castMs")), worstFrame: max(pick("castMaxMs")) },
      errors: errors(),
      samples: samples.length,
    };
    writeFileSync(join(out, "summary.json"), JSON.stringify({ ...summary, frames, samples }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.error("usage: shoot.mjs lab|seq|night …");
    process.exitCode = 2;
  }
  const errs = errors();
  if (errs.length && cmd !== "night") console.error(errs.slice(0, 8).join("\n"));
} finally {
  await close();
}
