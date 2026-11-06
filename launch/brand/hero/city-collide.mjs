/**
 * The City's barriers and traffic played for real over CDP (free roam, roam-2): real key presses
 * (W A S D, C to walk, Shift to sprint) steered camera-relative, against a running WGP server
 * (`ALLOW_DEV_AUTH=1 next dev`, PGlite, no .env.local), as a guest:
 *
 *   node launch/brand/hero/city-collide.mjs --out <dir> --targets <targets.json> [--base http://127.0.0.1:3940] [--tier high] [--phase after|before] [--cdp 9943]
 *
 * - Barriers: from 160 out on its floor, walk (C held) into each kind the City draws in his way
 *   (a lamp post, a signal post, a roof door, an AC unit, a water tank, an antenna, a billboard,
 *   the bridge's rail), then run into it; frames at each.
 * - Traffic (after only): stand in a lane in front of a car (it stops short), walk into it
 *   (blocked); run across in front of a moving one (a hit: flung, down, up); then a minute's
 *   walk and sprint about the streets.
 * - Monitors, every animation frame, from the sim the page runs: frames the hero's body is inside
 *   a solid (furniture, a building, a car; a vault or mantle's own 10-unit clearance excepted),
 *   car hits and how each one ended. Draw calls and frame rate at each beat; console errors.
 *
 * `targets.json` is where each barrier kind is and where to stand: { kind: { from: {x, y, z},
 * to: {x, z}, box: {x0, y0, z0, x1, y1, z1} } }, a dump of game-core's roamCityFurniture() (the
 * same spots on main, so `--phase before` walks them too). Use your own --cdp port (other
 * drivers default to 9771). Writes <out>/*.jpg, <out>/*-sheet.jpg and <out>/collide.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "/Users/eromonseleodigie/near-hackathon/launch/lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3940");
const out = opt("out", "launch/brand/hero/game-shots/city-collide/after");
const tier = opt("tier", "high");
const phase = opt("phase", "after");
const targets = JSON.parse(readFileSync(opt("targets", join(out, "..", "targets.json")), "utf8"));
const SAVE = opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json");
mkdirSync(out, { recursive: true });

const cdp = await launch({ port: Number(opt("cdp", "9943")), profile: `/private/tmp/claude-501/wgp-city-collide-${phase}-${tier}` });
const { logs, close } = cdp;
const within = (promise, what) => Promise.race([promise, new Promise((_, j) => setTimeout(() => j(new Error(`timed out: ${what}`)), 8000))]);
const send = (method, params) => within(cdp.send(method, params), method);
const evaluate = (expr) => within(cdp.evaluate(expr), "evaluate");
const report = { phase, tier, barriers: {}, traffic: {}, perf: [], monitor: null, errors: [], reloads: [] };
const t0 = Date.now();
cdp.on("Page.frameNavigated", (p) => {
  if (!p.frame.parentId) {
    report.reloads.push({ at: Date.now() - t0, url: p.frame.url, last: logs.slice(-6) });
    console.log("navigated", Date.now() - t0, p.frame.url, JSON.stringify(logs.slice(-4)));
  }
});
const watchdog = setTimeout(async () => {
  console.log("watchdog: the run took too long");
  try {
    writeFileSync(join(out, "collide.json"), JSON.stringify({ ...report, watchdog: true, errors: logs.filter((l) => /error|exception/i.test(l)) }, null, 1));
  } catch {}
  process.exit(2);
}, 8 * 60_000);
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const save = readFileSync(SAVE, "utf8");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); } catch {}` });
await send("Page.navigate", { url: `${base}/play/city?debug=1&tier=${tier}` });
for (let i = 0; i < 160; i++) {
  await sleep(250);
  if (await evaluate(`!!(window.__wgpCity && window.__wgpScene && window.__wgpCity.handle())`).catch(() => false)) break;
}
await sleep(2500);

/* ------------------------------------------------------------------ keys */

const KEYS = { KeyW: ["w", 87], KeyA: ["a", 65], KeyS: ["s", 83], KeyD: ["d", 68], KeyC: ["c", 67], Space: [" ", 32], ShiftLeft: ["Shift", 16] };
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
const releaseAll = () => setHeld(new Set());

/* ------------------------------------------------------------------ the page's sim, and the monitor */

// Every animation frame: how deep the hero's body is in any solid, by kind (the sim's own grid,
// cars included), and every car hit and how it ended.
const INSTALL = `(() => {
  if (window.__collide) return false;
  const R = 26;
  const ids = [];
  const m = { frames: 0, inside: { prop: 0, car: 0, main: 0, top: 0, deck: 0, leg: 0 }, worst: { prop: 0, car: 0, main: 0, top: 0, deck: 0, leg: 0 }, hits: [], moves: [], samples: [], byMove: {}, last: [] };
  window.__collide = m;
  let bus = null;
  const tick = () => {
    try {
      const c = window.__wgpCity;
      if (c && c.loop.bus !== bus) {
        bus = c.loop.bus;
        bus.on((ev) => {
          if (ev.type === "roam-car-hit") m.hits.push({ t: Math.round(performance.now()), speed: Math.round(ev.speed), car: ev.car });
          if (ev.type === "roam-move" && (ev.move === "knocked" || ev.from === "knocked" || ev.move === "vault")) m.moves.push({ t: Math.round(performance.now()), move: ev.move, from: ev.from });
        });
      }
      const s = c.session().run.sim;
      const h = s.hero;
      const move = s.roam.body.move;
      const allow = move === "vault" || move === "mantle" ? 10 : 0;
      const n = s.grid.queryBoxes(h.x - R, h.z - R, h.x + R, h.z + R, ids);
      m.frames++;
      const seen = {};
      for (let k = 0; k < n; k++) {
        const b = s.grid.boxes[ids[k]];
        const qx = Math.max(b.x0, Math.min(b.x1, h.x));
        const qy = Math.max(b.y0, Math.min(b.y1, h.y));
        const qz = Math.max(b.z0, Math.min(b.z1, h.z));
        const d = R - Math.hypot(h.x - qx, h.y - qy, h.z - qz) - allow;
        if (d <= 0.5) continue;
        if (!seen[b.kind]) {
          m.inside[b.kind] = (m.inside[b.kind] ?? 0) + 1;
          const key = b.kind + "/" + move;
          m.byMove[key] = (m.byMove[key] ?? 0) + 1;
          if (m.last.length >= 30) m.last.shift();
          m.last.push({ kind: b.kind, d: +d.toFixed(1), move, x: Math.round(h.x), y: Math.round(h.y), z: Math.round(h.z) });
        }
        seen[b.kind] = true;
        m.worst[b.kind] = Math.max(m.worst[b.kind] ?? 0, +d.toFixed(2));
        if (m.samples.length < 20) m.samples.push({ kind: b.kind, d: +d.toFixed(1), move, x: Math.round(h.x), y: Math.round(h.y), z: Math.round(h.z) });
      }
    } catch (e) {}
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;
/** The City's debug handle (back after the page remounts the outing, or reloads). */
async function ready() {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(`!!(window.__wgpCity && window.__wgpCity.handle && window.__wgpCity.handle())`).catch(() => false)) {
      await evaluate(INSTALL);
      return;
    }
    await sleep(100);
  }
  throw new Error("the City never came back");
}
await ready();
const empty = { frames: 0, inside: {}, worst: {}, hits: [], moves: [], samples: [] };
const monitor = async () => {
  await ready();
  return (await evaluate(`window.__collide ? JSON.parse(JSON.stringify(window.__collide)) : null`)) ?? empty;
};

// A headless page can lose focus and pause the city (as a blurred tab does): carry on.
const PEEK = `(() => { const c = window.__wgpCity; if (c.loop.status === "paused") { c.pause(false); window.__unpaused = (window.__unpaused ?? 0) + 1; } const p = c.peek(); return { ...p }; })()`;
const peek = async () => {
  await ready();
  return evaluate(PEEK);
};
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

/** Put the hero on his feet at a spot (debug teleport: the sim's own state), facing (fx, fz), the camera cut behind him. */
async function tp(x, feet, z, fx, fz) {
  await ready();
  await evaluate(`(() => {
    const c = window.__wgpCity;
    const s = c.session().run.sim;
    const h = s.hero;
    h.x = ${x}; h.y = ${feet} + 26; h.z = ${z}; h.vx = 0; h.vy = 0; h.vz = 0; h.fx = ${fx}; h.fz = ${fz};
    h.rope = null;
    s.roam.body.move = "ground"; s.roam.body.moveT = 0;
    c.handle().cut();
    return true;
  })()`);
  await sleep(700);
}

/* ------------------------------------------------------------------ shots */

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(data, "base64"));
}
const strips = {};
async function frame(name) {
  const list = (strips[name] ??= []);
  if (list.length >= 30) return;
  const file = `${name}-${String(list.length).padStart(2, "0")}`;
  await shot(file);
  list.push(file);
}
function sheet(name, cols = 6) {
  const list = strips[name] ?? [];
  if (list.length < 2) return;
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", join(out, `${name}-??.jpg`), "-vf", `scale=320:-1,tile=${cols}x${Math.ceil(list.length / cols)}`, "-frames:v", "1", join(out, `${name}-sheet.jpg`)]);
  } catch (e) {
    console.log("no sheet", String(e).slice(0, 160));
  }
}
async function perf(label) {
  const s = await evaluate(`window.__wgpScene`);
  if (s) report.perf.push({ label, calls: s.calls, fps: Math.round(s.fps), tier: s.tier, triangles: s.triangles });
}

/** Hold the keys toward (x, z) (plus `extra`) for `ms`, a frame every `every` polls. */
/** How deep the hero's body is in a box (a vault or mantle's own 10-unit clearance off), 0 when it isn't. */
function depthIn(p, b) {
  const qx = Math.max(b.x0, Math.min(b.x1, p.x));
  const qy = Math.max(b.y0, Math.min(b.y1, p.y));
  const qz = Math.max(b.z0, Math.min(b.z1, p.z));
  const d = 26 - Math.hypot(p.x - qx, p.y - qy, p.z - qz) - (p.move === "vault" || p.move === "mantle" ? 10 : 0);
  return d > 0 ? d : 0;
}
/** Polls the hero's body was inside the barrier being tried, and the deepest (`watch`: its box). */
const pass = { box: null, polls: 0, inside: 0, worst: 0 };

async function push(x, z, ms, extra = [], strip = null, every = 3) {
  const end = Date.now() + ms;
  let n = 0;
  let p = await peek();
  while (Date.now() < end) {
    p = await peek();
    if (pass.box) {
      const d = depthIn(p, pass.box);
      pass.polls++;
      if (d > 0.5) pass.inside++;
      pass.worst = Math.max(pass.worst, d);
    }
    const keys = steerKeys(p, x - p.x, z - p.z);
    for (const k of extra) keys.add(k);
    await setHeld(keys);
    if (strip && n++ % every === 0) await frame(strip);
    await sleep(40);
  }
  await releaseAll();
  return p;
}

/* ------------------------------------------------------------------ barriers */

const before = phase === "before";
await shot("00-start");
await perf("start");
for (const [kind, t] of Object.entries(targets)) {
  const m0 = await monitor();
  pass.box = t.box;
  pass.polls = 0;
  pass.inside = 0;
  pass.worst = 0;
  const dx = t.to.x - t.from.x;
  const dz = t.to.z - t.from.z;
  const d = Math.hypot(dx, dz);
  await tp(t.from.x, t.from.y, t.from.z, dx / d, dz / d);
  await shot(`b-${kind}-0`);
  // Walk into it (C), then step back and run into it.
  let p = await push(t.to.x, t.to.z, 2600, ["KeyC"], `b-${kind}-walk`, 4);
  await shot(`b-${kind}-1-walked`);
  const walked = { x: p.x, z: p.z, move: p.move };
  await tp(t.from.x, t.from.y, t.from.z, dx / d, dz / d);
  p = await push(t.to.x, t.to.z, 1300, [], `b-${kind}-run`, 3);
  await shot(`b-${kind}-2-ran`);
  const m1 = await monitor();
  const diff = Object.fromEntries(Object.keys(m1.inside).map((k) => [k, (m1.inside[k] ?? 0) - (m0.inside[k] ?? 0)]));
  // How far into the box the hero stood at the end of the walk (negative: short of it).
  const b = t.box;
  const gap = Math.max(b.x0 - walked.x, 0, walked.x - b.x1) + Math.max(b.z0 - walked.z, 0, walked.z - b.z1) - 26;
  // Inside the drawn barrier (polled from the page, a solid or not): the pass-through count.
  report.barriers[kind] = { passPolls: pass.inside, polls: pass.polls, passWorst: +pass.worst.toFixed(1), insideFrames: diff, walkedGap: +gap.toFixed(1), walkedMove: walked.move, ranMove: p.move };
  pass.box = null;
  console.log(kind, JSON.stringify(report.barriers[kind]));
  sheet(`b-${kind}-walk`);
  sheet(`b-${kind}-run`);
}
await perf("barriers");

/* ------------------------------------------------------------------ traffic */

/** A car cruising down a straight stretch with no crossing for `room` ahead (the sim's). */
const CRUISING = (room) => `(() => {
  const s = window.__wgpCity.session().run.sim;
  const t = s.roam.traffic;
  const h = s.hero;
  if (!t) return { missing: Object.keys(s.roam), tick: s.tick };
  let best = null;
  for (let i = 0; i < t.cars.length; i++) {
    const c = t.cars[i];
    const loop = t.loops[c.loop];
    if (loop.line < 0 || c.v < 200 || c.hold > 0) continue;
    const L = loop.hi - loop.lo;
    if (c.s > L - ${room} - 100) continue;
    const along = loop.lo + c.s;
    let clear = true;
    for (let k = 1; k < 9; k++) { const cc = k * 780 - 90; if (cc + 140 > along && cc - 140 < along + ${room}) clear = false; }
    if (!clear) continue;
    const d = Math.hypot(c.x - h.x, c.z - h.z);
    if (!best || d < best.d) best = { i, d, x: c.x, z: c.z, hx: c.hx, hz: c.hz, v: c.v };
  }
  return best;
})()`;

if (!before) {
  // 1. Standing in a lane ahead of a car: it stops short; walking into it, he's stopped at its bumper.
  await ready();
  let car = await evaluate(CRUISING(420));
  if (car) {
    const ahead = 48 + 300 + 26;
    await tp(car.x + car.hx * ahead, 0, car.z + car.hz * ahead, -car.hx, -car.hz);
    const m0 = await monitor();
    for (let i = 0; i < 18; i++) {
      await frame("t1-stand");
      await sleep(180);
    }
    const stopped = await evaluate(`(() => { const c = window.__wgpCity.session().run.sim.roam.traffic.cars[${car.i}]; const h = window.__wgpCity.session().run.sim.hero; return { v: Math.round(c.v), gap: Math.round((h.x - c.x) * c.hx + (h.z - c.z) * c.hz - 48 - 26) }; })()`);
    const cx = car.x;
    const cz = car.z;
    const p = await push(cx - car.hx * 200, cz - car.hz * 200, 1500, ["KeyC"], "t1-stand", 3);
    const m1 = await monitor();
    report.traffic.stand = { car: car.i, stopped, hits: m1.hits.length - m0.hits.length, carFrames: m1.inside.car - m0.inside.car, endMove: p.move };
    console.log("stand", JSON.stringify(report.traffic.stand));
    sheet("t1-stand");
  }

  // 2. Darting out in front of a moving car: a hit; flung, down, up.
  for (let attempt = 0; attempt < 3 && !(report.traffic.dart?.hits > 0); attempt++) {
    await tp(3420, 300, 3420, 1, 0);
    await sleep(1500);
    await ready();
    car = await evaluate(CRUISING(420));
    if (!car) continue;
    // On the street's middle side of its lane (its left: the lanes keep right), a little ahead
    // of it, facing across: he runs over in front of it.
    const side = 19.5 + 26 + 40;
    const lead = 48 + 110;
    const ax = car.x + car.hx * lead + car.hz * side;
    const az = car.z + car.hz * lead - car.hx * side;
    await tp(ax, 0, az, -car.hz, car.hx);
    const m0 = await monitor();
    const tx = ax - car.hz * 600;
    const tz = az + car.hx * 600;
    const end = Date.now() + 3600;
    let ran = 0;
    while (Date.now() < end) {
      const p = await peek();
      const hitNow = (await evaluate(`window.__collide.hits.length`)) > m0.hits.length;
      if (!hitNow && p.move === "ground" && ran < 25) {
        await setHeld(new Set([...steerKeys(p, tx - p.x, tz - p.z)]));
        ran++;
      } else await releaseAll();
      await frame(`t2-hit${attempt}`);
      await sleep(30);
    }
    await releaseAll();
    const m1 = await monitor();
    report.traffic.dart = { car: car.i, hits: m1.hits.length - m0.hits.length, hit: m1.hits.slice(m0.hits.length), moves: m1.moves.slice(m0.moves.length).map((x) => `${x.from}>${x.move}`), carFrames: m1.inside.car - m0.inside.car, end: (await peek()).move };
    console.log("dart", JSON.stringify(report.traffic.dart));
    sheet(`t2-hit${attempt}`);
  }

  // 3. A minute about the streets: walking and sprinting up and down them, across the lanes.
  const m0 = await monitor();
  const route = [
    { x: 3810, z: 3420 },
    { x: 3810, z: 2730 },
    { x: 3030, z: 2730 },
    { x: 3030, z: 3510 },
    { x: 3810, z: 3510 },
    { x: 3810, z: 4290 },
    { x: 2250, z: 4290 },
  ];
  await tp(3810, 0, 3900, 0, -1);
  for (const [i, w] of route.entries()) {
    await push(w.x, w.z, 4200, i % 2 ? ["ShiftLeft"] : [], "t3-streets", 12);
  }
  const m1 = await monitor();
  report.traffic.streets = { hits: m1.hits.length - m0.hits.length, carFrames: m1.inside.car - m0.inside.car, propFrames: m1.inside.prop - m0.inside.prop, frames: m1.frames - m0.frames };
  console.log("streets", JSON.stringify(report.traffic.streets));
  sheet("t3-streets");
  await perf("streets");
} else {
  // Main: the street, with its decorative traffic: frames of it driving through him.
  await tp(3810 + 29, 0, 3000, 0, 1);
  for (let i = 0; i < 24; i++) {
    await frame("t-street");
    await sleep(120);
  }
  sheet("t-street");
}

report.monitor = await monitor();
report.unpaused = await evaluate(`window.__unpaused ?? 0`);
report.errors = logs.filter((l) => /error|exception/i.test(l) && !/favicon|DevTools|WebSocket/i.test(l));
writeFileSync(join(out, "collide.json"), JSON.stringify(report, null, 1));
console.log("monitor", JSON.stringify({ frames: report.monitor.frames, inside: report.monitor.inside, worst: report.monitor.worst, hits: report.monitor.hits.length }));
console.log("perf", JSON.stringify(report.perf));
console.log("errors", report.errors.length, report.errors.slice(0, 5));
clearTimeout(watchdog);
await close();
process.exit(0);
