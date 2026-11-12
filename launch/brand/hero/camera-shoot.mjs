/**
 * The camera pass, over CDP (headless Chrome on this machine's GPU), against a running WGP
 * server, at 1920×1080 (mouse) and 390×844 (touch, an iPhone's safe areas):
 *
 *   node launch/brand/hero/camera-shoot.mjs hud    [--base http://localhost:3740]
 *   node launch/brand/hero/camera-shoot.mjs night  --label before [--viewport desktop|phone] [--save night-a]
 *   node launch/brand/hero/camera-shoot.mjs stand  --label before [--viewport desktop|phone]
 *
 * - hud: the HUD's boxes during the first leg (what scripts/camera/metrics.ts scores the hero against).
 * - night: a whole guest night on the autopilot, recorded with the screencast, with the
 *   camera pose and the frame sampled on every animation frame in the page. Writes the
 *   frames, a track (pose, hero, mode, loop status per frame) and frame strips for the
 *   countdown, the first leg's travel and swings, an arrival, an errand and the outro.
 * - stand: a night played by hand: stand still after GO, then hold the stick to the side,
 *   then let go (the standing shot, and how the camera eases behind a run).
 *
 * Writes game-shots/camera/<label>/…. Needs launch/lib/cdp.mjs and launch/out/saves; from a
 * worktree without them, WGP_LAUNCH=<a checkout's launch/>.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCH = process.env.WGP_LAUNCH ?? join(HERE, "..", "..");
const { launch, sleep } = await import(pathToFileURL(join(LAUNCH, "lib", "cdp.mjs")).href);

const args = process.argv.slice(2);
const mode = args[0] ?? "hud";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://localhost:3740");
const label = opt("label", "after");
const out = join(opt("out", join(HERE, "game-shots", "camera")), label);
const saves = opt("saves", join(LAUNCH, "out", "saves"));
const saveName = opt("save", "night-a");
const tier = opt("tier", "high");
mkdirSync(out, { recursive: true });

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, safe: null },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, safe: { top: 47, bottom: 34, left: 0, right: 0 } },
};
const HIDE = `nextjs-portal { display: none !important; } pre[aria-live=off] { display: none !important; }`;
const PLAY = "window.__wgpPlay";
const GL_FLAGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];

/**
 * Every animation frame, after the scene has drawn: the loop's status, the frame's mode and
 * stop, the hero, the anchor, the camera pose and the canvas size. In window.__cam.
 */
const PROBE = `(() => {
  window.__cam = [];
  window.__ev = [];
  const hook = () => {
    const p = window.__wgpPlay;
    if (p && p.loop && !p.loop.__hooked) {
      p.loop.__hooked = true;
      p.loop.bus.on((e) => window.__ev.push({ t: performance.now(), type: e.type, status: e.status, kind: e.kind }));
    }
    if (!p || !p.loop) return setTimeout(hook, 30);
  };
  hook();
  const tick = (t) => {
    const p = window.__wgpPlay;
    const pose = p && p.handle && p.handle() && p.handle().pose();
    const canvas = document.querySelector("[role=application] canvas");
    // The errand sheet, the first time it shows (what the two-shot must stay above).
    const sheet = !window.__sheet && document.getElementById("errand-title")?.closest("section");
    if (sheet) {
      const r = sheet.getBoundingClientRect();
      if (r.height > 40) window.__sheet = { x0: Math.round(r.left), y0: Math.round(r.top), x1: Math.round(r.right), y1: Math.round(r.bottom) };
    }
    if (pose && p.loop && canvas) {
      const f = p.loop.view;
      const h = f.hero;
      window.__cam.push({
        t,
        status: p.loop.status,
        mode: f.mode,
        stop: f.stop,
        pos: [pose.position.x, pose.position.y, pose.position.z],
        target: [pose.target.x, pose.target.y, pose.target.z],
        fov: pose.fov,
        hero: [h.pos.x, h.pos.y, h.pos.z],
        vel: [h.vel.x, h.vel.y, h.vel.z],
        anchor: h.anchor ? [h.anchor.x, h.anchor.y, h.anchor.z] : null,
        grounded: h.grounded,
        route0: f.route && f.route[0] ? [f.route[0].x, f.route[0].y, f.route[0].z] : null,
        w: canvas.clientWidth,
        h: canvas.clientHeight,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

async function open(viewport, url, { save = saveName, settings = null } = {}) {
  const port = 9300 + Math.floor(Math.random() * 300);
  const c = await launch({ port, profile: `/tmp/wgp-camera/cdp-${port}`, flags: GL_FLAGS });
  const v = VIEWPORTS[viewport];
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: v.width,
    height: v.height,
    deviceScaleFactor: v.deviceScaleFactor,
    mobile: v.mobile,
    ...(v.mobile ? { screenOrientation: { type: "portraitPrimary", angle: 0 } } : {}),
  });
  if (v.mobile) {
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await c.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA, platform: "Linux armv8l", userAgentMetadata: { platform: "Android", platformVersion: "14", architecture: "arm", model: "Pixel 7a", mobile: true } });
    try {
      await c.send("Emulation.setSafeAreaInsetsOverride", { insets: v.safe });
    } catch (e) {
      console.warn(`  no safe-area override: ${e.message}`);
    }
  }
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  const json = readFileSync(join(saves, `${save}.json`), "utf8");
  const set = settings ? `localStorage.setItem("wgp:3d-settings:v1", ${JSON.stringify(JSON.stringify(settings))});` : `localStorage.removeItem("wgp:3d-settings:v1");`;
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.clear(); localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); ${set} } catch {}` });
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(HIDE)}; document.head.appendChild(st); });` });
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  const until = async (js, ms = 120000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await c.evaluate(`!!(${js})`)) return true;
      } catch {}
      await sleep(60);
    }
    throw new Error(`timed out waiting for ${js}\n${c.logs.slice(-8).join("\n")}`);
  };
  const event = (type, n = 1, ms = 240000) => until(`(window.__ev || []).filter((e) => e.type === ${JSON.stringify(type)} || e.status === ${JSON.stringify(type)}).length >= ${n}`, ms);
  const shot = async (name) => {
    const { data } = await c.send("Page.captureScreenshot", { format: "png" });
    const file = join(out, `${viewport}-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`  ${file}`);
  };
  await c.send("Page.navigate", { url: `${base}${url}${url.includes("?") ? "&" : "?"}tier=${tier}` });
  await until(`${PLAY} && ${PLAY}.loop && document.querySelector("[role=application] canvas")`, 180000);
  return { ...c, v, until, event, shot };
}

/**
 * The screencast, every frame written to `dir` as it arrives (a whole night at 1080p doesn't
 * fit in memory), with its time on the page's clock (performance.now, ms).
 */
async function record(c, dir, maxWidth, maxHeight) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  // The screencast stamps frames in seconds since the epoch; the probe in performance.now().
  const origin = await c.evaluate("performance.timeOrigin");
  c.on("Page.screencastFrame", (p) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(p.data, "base64"));
    frames.push({ t: p.metadata.timestamp * 1000 - origin, file });
    c.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  await c.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth, maxHeight, everyNthFrame: 1 });
  return {
    frames,
    stop: () => c.send("Page.stopScreencast"),
  };
}

/* ------------------------------------------------------------------ hud */

async function hud() {
  for (const viewport of ["desktop", "phone"]) {
    const c = await open(viewport, "/play/patrol?debug=1");
    try {
      await c.event("go");
      await sleep(1200);
      const rects = await c.evaluate(`(() => {
        const W = innerWidth, H = innerHeight;
        const out = [];
        document.querySelectorAll("[data-night] *").forEach((el) => {
          if (el.closest("[role=application]") || el.tagName === "CANVAS" || el.tagName === "PRE") return;
          const s = getComputedStyle(el);
          if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || r.width * r.height > W * H * 0.4) return;
          const bg = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
          const border = parseFloat(s.borderTopWidth) >= 2;
          if (!bg && !border) return;
          out.push({ tag: el.tagName, cls: (el.className && el.className.baseVal === undefined ? el.className : "").slice(0, 60), x0: Math.round(r.left), y0: Math.round(r.top), x1: Math.round(r.right), y1: Math.round(r.bottom) });
        });
        // Keep the outermost boxes only.
        return out.filter((a) => !out.some((b) => b !== a && b.x0 <= a.x0 && b.y0 <= a.y0 && b.x1 >= a.x1 && b.y1 >= a.y1));
      })()`);
      console.log(`${viewport}:`);
      for (const r of rects) console.log(`  ${r.x0},${r.y0} → ${r.x1},${r.y1}  ${r.tag} ${r.cls}`);
      await c.shot("hud");
    } finally {
      await c.close();
    }
  }
}

/* ------------------------------------------------------------------ strips */

/**
 * A strip of `n` frames evenly over [t0, t1] (page ms), each cropped to `crop` (share of the
 * frame kept, centred) and labelled with its time from t0.
 */
function strip(frames, t0, t1, n, file, title) {
  const dir = join(out, "_strip");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const picks = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
    let best = null;
    for (const f of frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    if (best) picks.push({ ...best, at: (best.t - t0) / 1000 });
  }
  picks.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(3, "0")}_${f.at.toFixed(2)}.jpg`), readFileSync(f.file)));
  execFileSync("python3", [join(HERE, "camera-strip.py"), dir, join(out, file), title]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`  ${join(out, file)}`);
}

/* ------------------------------------------------------------------ night */

async function night() {
  const viewport = opt("viewport", "desktop");
  const v = VIEWPORTS[viewport];
  const c = await open(viewport, "/play/patrol?autopilot=1");
  const dir = join(out, `night-${viewport}`);
  try {
    const rec = await record(c, dir, Math.min(1280, v.width * v.deviceScaleFactor), Math.min(1280, v.height * v.deviceScaleFactor));
    await c.until(`${PLAY}.loop.status === "done"`, 300000);
    await sleep(3000);
    await rec.stop();
    const cam = await c.evaluate("window.__cam");
    const ev = await c.evaluate("window.__ev");
    console.log(`  errand sheet: ${JSON.stringify(await c.evaluate("window.__sheet ?? null"))}`);
    writeFileSync(join(dir, "track.json"), JSON.stringify({ viewport, ev, cam, frames: rec.frames.map((f) => f.t) }));
    // The beats, from the track: the countdown, the first swings, an arrival, an errand, the outro.
    const at = (pred) => cam.find(pred)?.t ?? null;
    const goT = ev.find((e) => e.type === "go")?.t ?? cam[0].t;
    const introT = ev.find((e) => e.type === "countdown")?.t ?? cam[0].t;
    const arrive = ev.filter((e) => e.type === "arrive");
    const errandT = ev.find((e) => e.type === "errand")?.t ?? null;
    const outroT = ev.find((e) => e.status === "outro")?.t ?? null;
    const frames = rec.frames;
    console.log(`${viewport}: ${frames.length} frames, ${cam.length} samples, ${arrive.length} arrivals`);
    strip(frames, introT, goT + 200, 8, `${viewport}-1-intro.png`, `${label} · ${viewport} · countdown → GO`);
    strip(frames, goT + 500, goT + 4500, 8, `${viewport}-2-travel.png`, `${label} · ${viewport} · first leg, swinging`);
    const swingT = at((s) => s.t > goT + 3000 && s.anchor);
    if (swingT) strip(frames, swingT, swingT + 1600, 8, `${viewport}-3-swing.png`, `${label} · ${viewport} · one swing, 1.6 s`);
    if (arrive[0]) strip(frames, arrive[0].t - 2500, arrive[0].t + 600, 8, `${viewport}-4-arrival.png`, `${label} · ${viewport} · arriving at stop 1`);
    if (errandT) strip(frames, errandT - 1500, errandT + 1500, 8, `${viewport}-5-errand.png`, `${label} · ${viewport} · arriving at an errand`);
    if (outroT) strip(frames, outroT - 800, outroT + 4000, 8, `${viewport}-6-outro.png`, `${label} · ${viewport} · night over → results`);
    const logs = c.logs.filter((l) => /exception|error/i.test(l) && !/React DevTools|HMR|Fast Refresh/.test(l));
    if (logs.length) console.log(logs.slice(0, 6).join("\n"));
  } finally {
    await c.close();
  }
}

/* ------------------------------------------------------------------ stand */

const KEYS = { KeyW: ["w", 87], KeyS: ["s", 83], KeyA: ["a", 65], KeyD: ["d", 68], Space: [" ", 32] };

async function stand() {
  const viewport = opt("viewport", "desktop");
  const v = VIEWPORTS[viewport];
  const c = await open(viewport, "/play/patrol?debug=1");
  const key = async (type, code) => {
    const [k, vk] = KEYS[code];
    await c.send("Input.dispatchKeyEvent", { type, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  // A thumb on the left half for the phone's floating stick.
  const thumb = async (type, x, y) => c.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [{ x, y, id: 1 }] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  const hold = async (dx, dy, ms) => {
    if (viewport === "phone") {
      const sx = Math.round(v.width * 0.22);
      const sy = Math.round(v.height * 0.72);
      await thumb("touchStart", sx, sy);
      for (let i = 1; i <= 6; i++) {
        await thumb("touchMove", sx + dx * i * 9, sy + dy * i * 9);
        await sleep(20);
      }
      await sleep(ms);
      await thumb("touchEnd", sx + dx * 54, sy + dy * 54);
    } else {
      const code = dx > 0 ? "KeyD" : dx < 0 ? "KeyA" : dy < 0 ? "KeyW" : "KeyS";
      await key("keyDown", code);
      await sleep(ms);
      await key("keyUp", code);
    }
  };
  const dir = join(out, `stand-${viewport}`);
  try {
    const rec = await record(c, dir, Math.min(1280, v.width * v.deviceScaleFactor), Math.min(1280, v.height * v.deviceScaleFactor));
    await c.event("go");
    const goT = await c.evaluate("window.__ev.find((e) => e.type === 'go').t");
    await sleep(3000);
    const sideT = await c.evaluate("performance.now()");
    await hold(1, 0, 1300);
    const freeT = await c.evaluate("performance.now()");
    await sleep(4500);
    await rec.stop();
    const cam = await c.evaluate("window.__cam");
    writeFileSync(join(dir, "track.json"), JSON.stringify({ viewport, goT, sideT, freeT, cam, frames: rec.frames.map((f) => f.t) }));
    strip(rec.frames, goT - 400, sideT, 6, `${viewport}-7-standing.png`, `${label} · ${viewport} · standing after GO`);
    strip(rec.frames, sideT, freeT + 4000, 10, `${viewport}-8-stick-side.png`, `${label} · ${viewport} · stick held right 1.3 s, then let go`);
  } finally {
    await c.close();
  }
}

if (mode === "hud") await hud();
else if (mode === "night") await night();
else if (mode === "stand") await stand();
else throw new Error(`unknown mode ${mode}`);
