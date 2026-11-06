/**
 * Free roam's wall moves played for real over CDP and measured, frame by frame: a climb from the
 * street (the run-up, the reach-pull-step cycle, a rest on the wall, a sideways shuffle, a climb
 * down), a hang from a ledge and the mantle over it, and a wall run. Real key presses (the stick
 * through the page's own latch for the climb down, which only an analogue stick can do).
 *
 *   node launch/brand/hero/city-climb.mjs --out <dir> [--base http://127.0.0.1:3930] [--tier high]
 *
 * Per sampled frame, from the drawn bones (after every IK pass):
 * - the wall: its plane from a ray off the sim's body along the wall's normal;
 * - each hand (the middle knuckle) and foot (the ball) off that plane, and whether the poser has
 *   it planted; a planted limb's slide since the last frame it was planted (world units);
 * - the chest's and the hips' distance off the wall, and the hero facing it;
 * - the suit as drawn: the fill's uniforms (suit colour, flash, fade, fog) and, on shot frames,
 *   the screen's colour at the chest (a pale frame is one whose chest reads near white).
 *
 * Writes <out>/*.jpg, <out>/<beat>-sheet.jpg and <out>/climb.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "/Users/eromonseleodigie/near-hackathon/launch/lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3930");
const out = opt("out", "launch/brand/hero/game-shots/city-climb/after");
const tier = opt("tier", "high");
const SAVE = opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json");
const port = Number(opt("port", "9771"));
const profile = opt("profile", `/private/tmp/claude-501/wgp-city-climb-${port}`);
mkdirSync(out, { recursive: true });

const cdp = await launch({ port, profile, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { logs, close } = cdp;
const within = (promise, what) => Promise.race([promise, new Promise((_, j) => setTimeout(() => j(new Error(`timed out: ${what}`)), 8000))]);
const send = (method, params) => within(cdp.send(method, params), method);
const evaluate = (expr) => within(cdp.evaluate(expr), "evaluate");
const report = { tier, beats: {}, perf: [], errors: [] };
const watchdog = setTimeout(async () => {
  console.log("watchdog: the run took too long");
  try {
    writeFileSync(join(out, "climb.json"), JSON.stringify({ ...report, watchdog: true, errors: logs.filter((l) => /error|exception/i.test(l)) }, null, 1));
  } catch {}
  process.exit(2);
}, 6 * 60_000);
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const save = readFileSync(SAVE, "utf8");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); } catch {}` });
await send("Page.navigate", { url: `${base}/play/city?debug=1&tier=${tier}` });
for (let i = 0; i < 160; i++) {
  await sleep(250);
  if (await evaluate(`!!(window.__wgpCity && window.__wgpScene && window.__wgpCity.handle() && window.__wgpCity.handle().inspect().characters.hero)`).catch(() => false)) break;
}
// The hero's MPFB body and clips (the procedural stand-in until they load).
for (let i = 0; i < 80; i++) {
  if (await evaluate(`window.__wgpCity.handle().inspect().characters.hero.model.constructor.name === "HeroModel" || !!window.__wgpCity.handle().inspect().characters.hero.model.asset`).catch(() => false)) break;
  await sleep(250);
}
await sleep(1500);

/* ------------------------------------------------------------------ keys */

const KEYS = {
  KeyW: ["w", 87],
  KeyA: ["a", 65],
  KeyS: ["s", 83],
  KeyD: ["d", 68],
  KeyF: ["f", 70],
  KeyX: ["x", 88],
  Space: [" ", 32],
  ShiftLeft: ["Shift", 16],
};
const held = new Set();
async function key(code, down) {
  const [k, vk] = KEYS[code];
  await send("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  if (down) held.add(code);
  else held.delete(code);
}
async function setHeld(codes) {
  for (const c of [...held]) if (!codes.has(c)) await key(c, false);
  for (const c of codes) if (!held.has(c)) await key(c, true);
}
async function tap(code) {
  await key(code, true);
  await sleep(60);
  await key(code, false);
}
const releaseAll = () => setHeld(new Set());

/* ------------------------------------------------------------------ the probe */

const PEEK = `(() => {
  const c = window.__wgpCity;
  const p = c.peek();
  const e = c.handle().inspect();
  const ch = e.characters;
  const f = c.loop.view;
  const r = f.roam;
  const hero = ch.hero;
  const m = hero.model;
  const rig = m.rig;
  const V = rig.bones[0].position.constructor;
  const at = (name) => { try { return new V().setFromMatrixPosition(rig.get(name).matrixWorld); } catch { return null; } };
  const out = { ...p, wall: r && r.wall ? { ...r.wall } : null, drawn: { x: f.hero.pos.x, y: f.hero.pos.y, z: f.hero.pos.z } };
  const u = m.fill.uniforms;
  out.mat = { suit: u.uSuit.value.toArray().map((v) => +v.toFixed(3)), flash: u.uFlash.value, fade: u.uFade.value, fog: +u.uFogMix.value.toFixed(3), kind: m.constructor.name };
  const w = r && r.wall;
  if (w) {
    const P = f.hero.pos;
    const n = new V(w.nx, 0, w.nz);
    const ray = ch.ctx.ray(P, new V(-w.nx, 0, -w.nz), 120);
    const face = ray == null ? 26 : ray;
    const off = (q) => (q ? +((q.x - P.x) * n.x + (q.z - P.z) * n.z + face).toFixed(2) : null);
    const poser = hero.anim.roamPoser;
    const planted = poser && poser.planted ? poser.planted() : poser && poser.plants ? poser.plants.map((pl) => pl.inStance) : [false, false, false, false];
    const limbs = ["middle_01_l", "middle_01_r", "ball_l", "ball_r"].map((b, i) => {
      const q = at(b) || at(["handL", "handR", "footL", "footR"][i]);
      return { off: off(q), x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2), planted: !!planted[i] };
    });
    const chest = at("chest");
    const hips = at("hips");
    const head = at("head");
    const fac = f.hero.facing;
    out.wallM = { face: +face.toFixed(2), ray: ray == null ? null : +ray.toFixed(2), limbs, chest: off(chest), hips: off(hips), headY: head ? +(head.y - P.y).toFixed(1) : null, facing: fac ? +(-(fac.x * w.nx + fac.z * w.nz)).toFixed(3) : null, top: w.top, move: r.move };
  }
  const cam = c.handle().pose();
  if (cam) {
    const chest = at("chest");
    out.cam = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    if (chest) {
      out.chest = { x: chest.x, y: chest.y, z: chest.z };
      // Seen: nothing solid between the camera and the chest; and on a wall, the camera on its outside.
      const d = new V(cam.position.x - chest.x, cam.position.y - chest.y, cam.position.z - chest.z);
      const len = d.length();
      const hit = ch.ctx.ray(chest, d.clone().normalize(), len);
      out.seen = hit == null || hit >= len - 2;
      if (w) out.camOut = +((cam.position.x - f.hero.pos.x) * w.nx + (cam.position.z - f.hero.pos.z) * w.nz).toFixed(1);
    }
  }
  return out;
})()`;


const peek = () =>
  evaluate(PEEK).catch(async (e) => {
    // The page went away under the run: say what the console said, and stop.
    console.log("peek failed:", String(e).split("\n").slice(-6).join(" | "));
    console.log(logs.filter((l) => /error|exception|warn/i.test(l)).slice(0, 3).join("\n"));
    writeFileSync(join(out, "climb.json"), JSON.stringify({ ...report, crashed: String(e).slice(-400), errors: logs.filter((l) => /error|exception/i.test(l)) }, null, 1));
    await close();
    process.exit(3);
  });

/**
 * The per-frame probe, in the page: every animation frame while a beat is named, on a wall,
 * each limb's gap to the face (the middle knuckle, the ball of the foot), whether the poser has
 * it planted, how far a planted one moved since the frame before (its slide), the chest's and
 * the hips' gap, and the frame time. Read back per beat at the end.
 */
const PROBE = `(() => {
  if (window.__climbProbe) return true;
  const P = (window.__climbProbe = { beat: null, stats: {}, last: [null, null, null, null], t: performance.now() });
  const tick = () => {
    const now = performance.now();
    const dt = now - P.t;
    P.t = now;
    try {
      const c = window.__wgpCity;
      const f = c && c.loop.view;
      const r = f && f.roam;
      // Watch: the first frame whose hero isn't finite (what the sim and the input said).
      if (f && !P.nan && !Number.isFinite(f.hero.pos.x + f.hero.pos.y + f.hero.pos.z)) {
        const s = c.session().run.sim;
        P.nan = { tick: s.tick, move: r && r.move, input: s.input, hero: { x: s.hero.x, y: s.hero.y, z: s.hero.z, vx: s.hero.vx, vy: s.hero.vy, vz: s.hero.vz }, view: { ...f.hero.pos } };
      }
      const s = P.beat && (P.stats[P.beat] ??= { frames: 0, dts: [], off: [[], [], [], []], slide: [[], [], [], []], plantedN: [0, 0, 0, 0], chest: [], hips: [] });
      if (s) {
        s.frames++;
        s.dts.push(dt);
      }
      const w = r && r.wall;
      if (s && w && (r.move === "climb" || r.move === "hang" || r.move === "wallrun")) {
        const ch = c.handle().inspect().characters;
        const hero = ch.hero;
        const rig = hero.model.rig;
        const V = rig.bones[0].position.constructor;
        const at = (name) => new V().setFromMatrixPosition(rig.get(name).matrixWorld);
        const Pos = f.hero.pos;
        const ray = ch.ctx.ray(Pos, new V(-w.nx, 0, -w.nz), 120);
        const face = ray == null ? 26 : ray;
        const off = (q) => (q.x - Pos.x) * w.nx + (q.z - Pos.z) * w.nz + face;
        const poser = hero.anim.roamPoser;
        // Roam-1's poser (before) has no planted(): its gait's own stance flags, and a hang's hands.
        const planted = poser && poser.planted ? poser.planted() : r.move === "hang" ? [true, true, false, false] : poser && poser.plants ? poser.plants.map((pl) => pl.inStance) : [false, false, false, false];
        ["middle_01_l", "middle_01_r", "ball_l", "ball_r"].forEach((b, i) => {
          const q = at(b);
          if (planted[i]) {
            s.off[i].push(off(q));
            s.plantedN[i]++;
            const last = P.last[i];
            if (last) s.slide[i].push(Math.hypot(q.x - last.x, q.y - last.y, q.z - last.z));
            P.last[i] = q;
          } else P.last[i] = null;
        });
        if (r.move === "climb") {
          s.chest.push(off(at("chest")));
          s.hips.push(off(at("hips")));
        }
      } else P.last = [null, null, null, null];
    } catch (e) {
      P.error = String(e);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;
const setBeat = (name) => evaluate(`(window.__climbProbe.beat = ${JSON.stringify(name)}, window.__climbProbe.last = [null, null, null, null], true)`);

/** The probe's numbers for a beat: per limb, the planted gap's spread and the slide. */
function probeSummary(s) {
  const q = (arr, f) => {
    const a = arr.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
    return a.length ? +a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(2) : null;
  };
  const abs = (arr) => arr.map(Math.abs);
  const all = (k) => [].concat(...s[k]);
  return {
    frames: s.frames,
    fps: s.dts.length ? +(1000 / (s.dts.reduce((a, b) => a + b, 0) / s.dts.length)).toFixed(1) : null,
    p95FrameMs: q(s.dts, 0.95),
    plantedFrames: s.plantedN,
    plantedGap: { median: q(all("off"), 0.5), p95abs: q(abs(all("off")), 0.95), maxAbs: q(abs(all("off")), 1) },
    perLimbMaxGap: s.off.map((a) => q(abs(a), 1)),
    slide: { median: q(all("slide"), 0.5), p95: q(all("slide"), 0.95), max: q(all("slide"), 1), n: all("slide").length },
    perLimbMaxSlide: s.slide.map((a) => q(a, 1)),
    chest: { median: q(s.chest, 0.5), min: q(s.chest, 0), max: q(s.chest, 1) },
    hips: { median: q(s.hips, 0.5), min: q(s.hips, 0), max: q(s.hips, 1) },
  };
}

/** The chest's colour on screen: a small PNG crop around where the chest projects. */
async function chestColour(p) {
  if (!p.cam || !p.chest || !p.pose) return null;
  // Project with the chase pose (position, target, fov) at 1280×800.
  const pose = p.pose;
  const fx = pose.target.x - pose.position.x;
  const fy = pose.target.y - pose.position.y;
  const fz = pose.target.z - pose.position.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const F = [fx / fl, fy / fl, fz / fl];
  let R = [F[2], 0, -F[0]];
  const rl = Math.hypot(...R) || 1;
  R = R.map((v) => -v / rl);
  const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  const d = [p.chest.x - pose.position.x, p.chest.y - pose.position.y, p.chest.z - pose.position.z];
  const z = d[0] * F[0] + d[1] * F[1] + d[2] * F[2];
  if (z < 1) return null;
  const x = d[0] * R[0] + d[1] * R[1] + d[2] * R[2];
  const y = d[0] * U[0] + d[1] * U[1] + d[2] * U[2];
  const t = Math.tan(((pose.fov ?? 60) * Math.PI) / 360);
  const sx = 640 + (x / (z * t * 1.6)) * 640;
  const sy = 400 - (y / (z * t)) * 400;
  if (sx < 6 || sy < 6 || sx > 1274 || sy > 794) return null;
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: Math.round(sx) - 3, y: Math.round(sy) - 3, width: 7, height: 7, scale: 1 } });
  const png = join(out, ".px.png");
  writeFileSync(png, Buffer.from(data, "base64"));
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  rmSync(png, { force: true });
  let r = 0;
  let g = 0;
  let b = 0;
  const n = raw.length / 3;
  for (let i = 0; i < raw.length; i += 3) {
    r += raw[i];
    g += raw[i + 1];
    b += raw[i + 2];
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

const view = (pose) => {
  if (pose.steer) return { fx: pose.steer.fx, fz: pose.steer.fz };
  const dx = pose.target.x - pose.position.x;
  const dz = pose.target.z - pose.position.z;
  const d = Math.hypot(dx, dz) || 1;
  return { fx: dx / d, fz: dz / d };
};
function steerKeys(p, dx, dz) {
  const keys = new Set();
  const d = Math.hypot(dx, dz);
  if (d < 1 || !p.pose) return keys;
  const v = view(p.pose);
  const ux = dx / d;
  const uz = dz / d;
  const fwd = ux * v.fx + uz * v.fz;
  const right = ux * -v.fz + uz * v.fx;
  if (fwd > 0.38) keys.add("KeyW");
  if (fwd < -0.38) keys.add("KeyS");
  if (right > 0.38) keys.add("KeyD");
  if (right < -0.38) keys.add("KeyA");
  return keys;
}

/* ------------------------------------------------------------------ shots, strips, stats */

const strips = {};
async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(data, "base64"));
}
async function frame(stripName, p) {
  const list = (strips[stripName] ??= []);
  if (list.length >= 24) return;
  const name = `${stripName}-${String(list.length).padStart(2, "0")}`;
  await shot(name);
  list.push({ name, tick: p.tick, move: p.move, y: p.y });
}
function sheet(stripName) {
  const list = strips[stripName] ?? [];
  if (list.length < 2) return;
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", join(out, `${stripName}-??.jpg`), "-vf", `scale=400:250,tile=6x${Math.ceil(list.length / 6)}`, "-frames:v", "1", join(out, `${stripName}-sheet.jpg`)]);
  } catch (e) {
    console.log("no sheet", String(e).slice(0, 160));
  }
}
async function perf(label) {
  const s = await evaluate(`window.__wgpScene`);
  if (s) report.perf.push({ label, calls: s.calls, fps: Math.round(s.fps), tier: s.tier, triangles: s.triangles });
}

/** Per-beat statistics over the sampled frames. */
const stats = {};
const lastPlant = [null, null, null, null];
function record(beatName, p, colour = null) {
  const s = (stats[beatName] ??= { frames: 0, moves: {}, limbOff: [], plantedOff: [], slide: [], chest: [], hips: [], facing: [], pale: 0, colours: [], suit: null, flash: 0, fade: 0, fog: [], hidden: 0, camIn: 0 });
  s.frames++;
  if (p.pose) {
    (s.arm ??= []).push(p.pose.arm);
    (s.want ??= []).push(p.pose.want);
    (s.camDist ??= []).push(Math.hypot(p.pose.position.x - p.x, p.pose.position.y - p.y, p.pose.position.z - p.z));
  }
  if (p.seen === false) s.hidden++;
  if (p.camOut !== undefined && p.camOut < 0) s.camIn++;
  s.moves[p.move] = (s.moves[p.move] ?? 0) + 1;
  s.suit = p.mat.suit;
  if (p.mat.flash > 0) s.flash++;
  if (p.mat.fade > 0) s.fade++;
  s.fog.push(p.mat.fog);
  if (colour && p.seen !== false) {
    s.colours.push(colour);
    // Pale: every channel bright and close together (white or lavender), unlike the suit.
    const [r, g, b] = colour;
    if (Math.min(r, g, b) > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 70) s.pale++;
  }
  const w = p.wallM;
  if (!w) {
    lastPlant.fill(null);
    return;
  }
  s.chest.push(w.chest);
  s.hips.push(w.hips);
  if (w.facing !== null) s.facing.push(w.facing);
  w.limbs.forEach((l, i) => {
    s.limbOff.push(l.off);
    if (l.planted) {
      s.plantedOff.push(l.off);
      const prev = lastPlant[i];
      if (prev) s.slide.push(+Math.hypot(l.x - prev.x, l.y - prev.y, l.z - prev.z).toFixed(2));
      lastPlant[i] = l;
    } else lastPlant[i] = null;
  });
}
function summarise(s) {
  const q = (arr, f) => {
    const a = arr.filter((v) => v !== null && Number.isFinite(v)).sort((x, y) => x - y);
    if (!a.length) return null;
    return +a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(2);
  };
  const absQ = (arr, f) => q(arr.map((v) => (v === null ? null : Math.abs(v))), f);
  return {
    frames: s.frames,
    moves: s.moves,
    limbOff: { median: q(s.limbOff, 0.5), p90abs: absQ(s.limbOff, 0.9), min: q(s.limbOff, 0), max: q(s.limbOff, 1) },
    plantedOff: { n: s.plantedOff.length, median: q(s.plantedOff, 0.5), p90abs: absQ(s.plantedOff, 0.9), maxAbs: absQ(s.plantedOff, 1) },
    slide: { n: s.slide.length, median: q(s.slide, 0.5), p90: q(s.slide, 0.9), max: q(s.slide, 1) },
    chest: { median: q(s.chest, 0.5), min: q(s.chest, 0), max: q(s.chest, 1) },
    hips: { median: q(s.hips, 0.5), min: q(s.hips, 0), max: q(s.hips, 1) },
    facing: q(s.facing, 0.5),
    suit: s.suit,
    flashFrames: s.flash,
    fadeFrames: s.fade,
    fog: q(s.fog, 1),
    pale: s.pale,
    camera: { arm: q(s.arm ?? [], 0.5), want: q(s.want ?? [], 0.5), dist: q(s.camDist ?? [], 0.5), distMax: q(s.camDist ?? [], 1) },
    hidden: s.hidden,
    camInside: s.camIn,
    colours: s.colours.slice(0, 12),
  };
}

/** Sample frames for `ms`, holding `keys` (or steering toward a point), into `beatName`. */
async function run(beatName, ms, { keys = [], toward = null, every = 2, colourEvery = 6, done = null, stick = null, slow = 1 } = {}) {
  const end = Date.now() + ms / slow;
  let n = 0;
  let p = await peek();
  await setBeat(beatName);
  if (slow !== 1) {
    // Slow motion for a contact sheet of a short move: the loop advances `slow` of real time.
    await evaluate(`(() => { const L = window.__wgpCity.loop; L.__adv ??= L.advance.bind(L); L.advance = (s) => L.__adv(s * ${slow}); return true; })()`);
    (report.slow ??= {})[beatName] = slow;
  }
  if (stick) await evaluate(`window.__wgpCity.latch.base.setStick({ x: ${stick.x}, y: ${stick.y} })`);
  while (Date.now() < end) {
    p = await peek();
    if (done && done(p)) break;
    const set = new Set(keys);
    if (toward) for (const k of steerKeys(p, toward.x - p.x, toward.z - p.z)) set.add(k);
    if (!stick) await setHeld(set);
    const colour = n % colourEvery === 0 ? await chestColour(p).catch(() => null) : null;
    record(beatName, p, colour);
    if (n % every === 0) await frame(beatName, p);
    n++;
    await sleep(30);
  }
  if (stick) await evaluate(`window.__wgpCity.latch.base.setStick({ x: 0, y: 0 })`);
  await releaseAll();
  await setBeat(null);
  if (slow !== 1) await evaluate(`(() => { const L = window.__wgpCity.loop; if (L.__adv) L.advance = L.__adv; return true; })()`);
  return p;
}

const streetLine = (v) => Math.max(0, Math.min(9, Math.floor((v + 90 + 390) / 780))) * 780 - 90;
function streetRoute(fx, fz, tx, tz) {
  const sx = streetLine(fx);
  const sz = streetLine(fz);
  if (Math.abs(fz - sz) < Math.abs(fx - sx))
    return [
      { x: fx, z: sz },
      { x: streetLine(tx), z: sz },
      { x: streetLine(tx), z: tz },
      { x: tx, z: tz },
    ];
  return [
    { x: sx, z: fz },
    { x: sx, z: streetLine(tz) },
    { x: tx, z: streetLine(tz) },
    { x: tx, z: tz },
  ];
}
async function goTo(x, z, { street = false, r = 40, timeout = 60, low = false } = {}) {
  let p = await peek();
  const route = street ? streetRoute(p.x, p.z, x, z) : [{ x, z }];
  const end = Date.now() + timeout * 1000;
  let stuck = 0;
  let lastX = p.x;
  let lastZ = p.z;
  let detour = null;
  while (Date.now() < end) {
    p = await peek();
    while (route.length > 1 && Math.hypot(route[0].x - p.x, route[0].z - p.z) < 50) route.shift();
    const left = Math.hypot(x - p.x, z - p.z);
    if (left < r && route.length <= 1 && (!low || p.y - 26 < 30) && (p.move === "ground" || p.move === "roll")) break;
    if (low && (p.move === "climb" || p.move === "hang") && p.wall) {
      detour = { x: p.x + p.wall.nx * 260, z: p.z + p.wall.nz * 260, until: Date.now() + 900 };
      await setHeld(new Set(["KeyX"]));
      await sleep(60);
      continue;
    }
    if (detour && Date.now() > detour.until) detour = null;
    const aim = detour ?? route[0];
    const keys = steerKeys(p, aim.x - p.x, aim.z - p.z);
    if (left > 260) keys.add("ShiftLeft");
    const moved = Math.hypot(p.x - lastX, p.z - lastZ);
    lastX = p.x;
    lastZ = p.z;
    stuck = moved < 2 && p.move === "ground" ? stuck + 1 : 0;
    if (stuck > 8) {
      keys.add("Space");
      stuck = 0;
    }
    await setHeld(keys);
    await sleep(40);
  }
  await releaseAll();
  return peek();
}

/** Mouse look: turn the camera until it looks along (dx, dz). */
async function lookToward(dir) {
  const want = Math.atan2(dir.x, dir.z);
  for (let i = 0; i < 12; i++) {
    const q = await peek();
    if (!q.pose) break;
    const v = view(q.pose);
    let d = want - Math.atan2(v.fx, v.fz);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.12) break;
    await evaluate(`window.__wgpCity.handle().orbit(${d * 0.8}, 0, false)`);
    await sleep(350);
  }
}

/**
 * Real-time captures of the short moves (a mantle is 0.42 s): the page's own screencast, every
 * frame the compositor hands over, into `<out>/<name>-sheet.jpg` (24 frames picked evenly).
 */
const casts = {};
let castName = null;
cdp.on("Page.screencastFrame", (f) => {
  const name = castName;
  if (name) {
    const list = (casts[name] ??= []);
    if (list.length < 600) {
      const file = join(out, `.cast-${name}-${String(list.length).padStart(3, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      list.push({ file, move: null });
    }
  }
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
async function castStart(name) {
  castName = name;
  await send("Page.startScreencast", { format: "jpeg", quality: 72, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
}
async function castStop() {
  await send("Page.stopScreencast");
  castName = null;
}
function castSheet(name, n = 24) {
  const all = casts[name] ?? [];
  // (The screencast's first frame can be a stub of a few hundred bytes.)
  const list = all.filter((f) => statSync(f.file).size > 4000);
  if (list.length < 2) return;
  const dir = join(out, "cast");
  mkdirSync(dir, { recursive: true });
  const pick = Math.min(n, list.length);
  for (let i = 0; i < pick; i++) {
    const src = list[Math.round((i * (list.length - 1)) / Math.max(1, pick - 1))].file;
    const dst = join(dir, `${name}-${String(i).padStart(2, "0")}.jpg`);
    // One size and pixel format for every frame (the screencast's vary, which resets a tile).
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", "scale=640:400,format=yuvj420p", "-q:v", "3", dst]);
  }
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", join(dir, `${name}-??.jpg`), "-vf", `scale=400:250,tile=6x${Math.ceil(pick / 6)}`, "-frames:v", "1", join(out, `${name}-sheet.jpg`)]);
  } catch (e) {
    console.log("no sheet", String(e).slice(0, 160));
  }
  for (const f of all) rmSync(f.file, { force: true });
  report.casts = { ...(report.casts ?? {}), [name]: list.length };
}

/* ------------------------------------------------------------------ the run */

await evaluate(PROBE);
await shot("00-start");
await perf("start");

// 1. To the tall building's east face (two tiers, 556 up), the camera turned to look at it (as a
// player would, mouse look), then W: the run-up, the climb, a rest on the wall, a shuffle each
// way, a climb down, and on up to the mantle.
const face = { x: 2988, z: 4059 };
const wallIn = { x: -1, z: 0 };
let p = await goTo(face.x + 120, face.z, { street: true, r: 30, low: true, timeout: 70 });
await lookToward(wallIn);
console.log("at the street", p.x, p.z, p.move);
await castStart("climb");
p = await run("1-runup", 1800, { keys: ["KeyW"], every: 2, done: (q) => q.move === "climb" && q.y - 26 > 110 });
p = await run("2-climb", 1500, { keys: ["KeyW"], every: 1, done: (q) => q.move === "climb" && q.y - 26 > 90 });
await castStop();
await perf("climb");
p = await run("3-rest", 1400, { every: 2 });
// From the side (mouse look round 75°): resting, then climbing on (the keys toward the wall as
// the turned camera sees it), before the camera eases back behind him.
await evaluate(`window.__wgpCity.handle().orbit(1.3, -0.05, false)`);
await castStart("sideview");
p = await run("3b-sideview", 700, { every: 1 });
p = await run("3b-sideview", 600, { toward: { x: p.x + wallIn.x * 400, z: p.z + wallIn.z * 400 }, every: 1 });
await castStop();
await castStart("side");
p = await run("4-side", 1100, { keys: ["KeyD"], every: 1 });
p = await run("4-side", 1100, { keys: ["KeyA"], every: 1 });
await castStop();
// Down: the stick straight back (S). Roam-2 climbs down; roam-1 let go.
await castStart("down");
p = await run("5-down", 1100, { keys: ["KeyS"], every: 1 });
await castStop();
if (p.move !== "climb") {
  // Let go (roam-1): back to the wall and up it again.
  p = await goTo(face.x + 120, face.z, { street: true, r: 30, low: true, timeout: 70 });
  await lookToward(wallIn);
}
p = await run("6-climb-top", 7000, { keys: ["KeyW"], every: 3, done: (q) => q.move !== "climb" || q.y - 26 > 215 });
// The top of the lower tier (300): the last of the climb and the mantle onto it, then stop.
await castStart("mantle");
p = await run("7-mantle", 2500, { keys: ["KeyW"], every: 1, slow: 0.25, done: (q) => q.move === "ground" && q.y - 26 > 280 });
await castStop();
p = await run("x", 600, { every: 9 });
report.beats.climb = { feet: Math.round(p.y - 26), move: p.move };
console.log("on the roof", p.y - 26, p.move);

// 2. A hang: back to the edge he came over, over it on the drop button (X) to hang by the hands,
// a moment hanging, a shimmy along the ledge, and up over it again (W).
{
  // (The mantle sets him down 44 in from the edge: within reach of it for a drop.) The stick
  // back toward the edge, and the drop button, until he hangs over it.
  await castStart("hang");
  for (let i = 0; i < 8; i++) {
    await key("KeyS", true);
    await sleep(40);
    await tap("KeyX");
    await key("KeyS", false);
    await sleep(120);
    p = await peek();
    if (p.move !== "ground") break;
  }
  console.log("drop", p.move, p.x, p.y - 26);
  p = await run("9-hang", 1800, { every: 1 });
  p = await run("9-hang", 1000, { keys: ["KeyD"], every: 1 });
  p = await run("10-mantle", 1600, { keys: ["KeyW"], every: 1, slow: 0.25, done: (q) => q.move === "ground" && q.wall === null && q.vy === 0 && Math.hypot(q.vx, q.vz) < 5 });
  await castStop();
  report.beats.hang = { feet: Math.round(p.y - 26), move: p.move, moves: stats["9-hang"]?.moves };
}

// 3. A wall run: down to the street, then a sprint on the diagonal into the spawn building's west
// face (x 3130, z 3200–3640), running along it north (B's route).
p = await goTo(3000, 3760, { street: true, r: 40, low: true, timeout: 70 });
// Facing north up the street, a sprint up it, then on the diagonal (W+D) into the wall on the right.
await lookToward({ x: 0, z: -1 });
await run("x", 1500, { keys: ["KeyW", "ShiftLeft"], done: (q) => Math.hypot(q.vx, q.vz) > 520 });
await castStart("wallrun");
p = await run("11-wallrun", 2600, { keys: ["KeyW", "KeyD", "ShiftLeft"], every: 1, slow: 0.35, done: (q) => q.move !== "ground" && q.move !== "wallrun" && (stats["11-wallrun"]?.moves?.wallrun ?? 0) > 3 });
p = await run("11-wallrun", 600, { every: 1, slow: 0.35 });
await castStop();
await perf("end");

for (const k of Object.keys(casts)) castSheet(k);
for (const k of Object.keys(strips)) sheet(k);
report.strips = strips;
report.stats = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, summarise(v)]));
const probe = await evaluate(`({ stats: window.__climbProbe.stats, error: window.__climbProbe.error ?? null, nan: window.__climbProbe.nan ?? null })`);
report.nan = probe.nan;
if (probe.nan) console.log("NOT FINITE", JSON.stringify(probe.nan));
report.probe = Object.fromEntries(Object.entries(probe.stats).map(([k, v]) => [k, probeSummary(v)]));
report.probeError = probe.error;
report.errors = logs.filter((l) => /error|exception/i.test(l));
writeFileSync(join(out, "climb.json"), JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report.stats)) console.log(k, JSON.stringify({ moves: v.moves, camera: v.camera, pale: v.pale, hidden: v.hidden, camInside: v.camInside, flash: v.flashFrames, suit: v.suit, colours: v.colours.slice(0, 4) }));
for (const [k, v] of Object.entries(report.probe)) console.log("probe", k, JSON.stringify(v));
if (report.probeError) console.log("probe error", report.probeError);
console.log("perf", JSON.stringify(report.perf));
console.log(report.errors.join("\n") || "no console errors");
clearTimeout(watchdog);
await close();
