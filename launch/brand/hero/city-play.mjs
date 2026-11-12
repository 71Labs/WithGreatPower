/**
 * Free roam played for real over CDP: real key presses (W A S D, Shift, Space, F, Q, E, X, C)
 * steered camera-relative the way a player would, against a running WGP server
 * (`ALLOW_DEV_AUTH=1 next dev`, PGlite, no .env.local):
 *
 *   node launch/brand/hero/city-play.mjs --out <dir> [--base http://127.0.0.1:3920] [--who guest|dev] [--tier high]
 *
 * The run, in order: a walk (C held) and a run across the spawn roof, a sprint off its edge (a
 * leap and a roll), a building climbed from the street and mantled (both tiers), a wall run (a
 * diagonal sprint-jump at a long wall), a swing with F held then let go, a chat with a civilian,
 * Dev's side task (talk, chase the pickpocket bot over the roofs, hand the wallet back) and a
 * Daily Rug page; the map and the pause sheet. Strips of frames at
 * each beat, the scene's draw calls and frame rate, and two monitors on every poll:
 *
 * - legs: the hero's solved ankles in his body's frame; a frame where the left ankle is right of
 *   the right one is a crossing (reported by the animator's base state).
 * - web: a rope without F held (beyond a tick or two of let-go) is a swing that wasn't asked for.
 *
 * Writes <out>/*.jpg, <out>/<beat>-sheet.jpg and <out>/play.json.
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
const out = opt("out", "launch/brand/hero/game-shots/free-roam/play");
const who = opt("who", "guest");
const tier = opt("tier", "high");
const SAVE = opt("save", "launch/brand/hero/fixtures/hero-save.json");
mkdirSync(out, { recursive: true });

const cdp = await launch({ port: 9751 + (who === "dev" ? 1 : 0), profile: `/tmp/wgp-city-play-${who}` });
const { logs, close } = cdp;
/** Every CDP call gives up after 8 s (a stalled page never hangs the run). */
const within = (promise, what) => Promise.race([promise, new Promise((_, j) => setTimeout(() => j(new Error(`timed out: ${what}`)), 8000))]);
const send = (method, params) => within(cdp.send(method, params), method);
const evaluate = (expr) => within(cdp.evaluate(expr), "evaluate");
/** The whole run gives up after 9 minutes, writing what it has. */
const watchdog = setTimeout(async () => {
  console.log("watchdog: the run took too long");
  try {
    writeFileSync(join(out, "play.json"), JSON.stringify({ ...report, watchdog: true, errors: logs.filter((l) => /error|exception/i.test(l)) }, null, 1));
  } catch {}
  process.exit(2);
}, 9 * 60_000);
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const save = readFileSync(SAVE, "utf8");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); } catch {}` });

const report = { who, tier, beats: [], legs: { frames: 0, crossed: 0, byBase: {} }, web: { frames: 0, unasked: 0 }, perf: [], errors: [], server: null };
const t0 = Date.now();
const beat = (name, extra = {}) => {
  report.beats.push({ name, at: Date.now() - t0, ...extra });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`, JSON.stringify(extra));
};

if (who === "dev") {
  await send("Page.navigate", { url: `${base}/play` });
  await sleep(3000);
  const handle = `roam${Date.now() % 100000}`;
  report.signIn = await evaluate(`fetch("/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: "${handle}" }) }).then((r) => r.status)`);
  report.migrate = await evaluate(`fetch("/api/migrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ save: JSON.parse(localStorage.getItem("wgp:save:v1")) }) }).then((r) => r.status)`);
}
await send("Page.navigate", { url: `${base}/play/city?debug=1&tier=${tier}` });
for (let i = 0; i < 120; i++) {
  await sleep(250);
  if (await evaluate(`!!(window.__wgpCity && window.__wgpScene && window.__wgpCity.handle())`).catch(() => false)) break;
}
await sleep(1500);

/* ------------------------------------------------------------------ keys */

const KEYS = {
  KeyW: ["w", 87],
  KeyA: ["a", 65],
  KeyS: ["s", 83],
  KeyD: ["d", 68],
  KeyC: ["c", 67],
  KeyE: ["e", 69],
  KeyF: ["f", 70],
  KeyQ: ["q", 81],
  KeyX: ["x", 88],
  Space: [" ", 32],
  ShiftLeft: ["Shift", 16],
  KeyM: ["m", 77],
  Escape: ["Escape", 27],
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

/* ------------------------------------------------------------------ the page */

const PEEK = `(() => {
  const c = window.__wgpCity;
  const p = c.peek();
  const h = c.handle();
  const legs = h && h.heroLegs ? h.heroLegs() : null;
  const f = c.loop.view.roam;
  return { ...p, legs, zip: f && f.zip, wall: f && f.wall, actKind: f && f.act && f.act.kind, chatLine: f && f.chat ? f.chat.line : null };
})()`;
async function peek() {
  const p = await evaluate(PEEK);
  // Monitors: the legs, and the web only while F is held.
  if (p.legs) {
    const L = p.legs;
    const side = (a) => (a.x - L.hips.x) * L.left.x + (a.y - L.hips.y) * L.left.y + (a.z - L.hips.z) * L.left.z;
    report.legs.frames++;
    const gap = side(L.ankles[0]) - side(L.ankles[1]);
    report.legs.minGap = Math.min(report.legs.minGap ?? 99, +gap.toFixed(2));
    // Crossed: the left ankle a clear 2 units right of the right one (a natural run keeps them within a hair of the line).
    if (gap < -2) {
      report.legs.crossed++;
      const k = `${L.base}/${p.move}`;
      report.legs.byBase[k] = (report.legs.byBase[k] ?? 0) + 1;
      (report.legs.samples ??= []).length < 12 && report.legs.samples.push({ tick: p.tick, move: p.move, gap: +gap.toFixed(1), v: Math.round(Math.hypot(p.vx, p.vz)) });
    }
  }
  report.web.frames++;
  if (p.rope && !held.has("KeyF")) {
    report.web.lingering = (report.web.lingering ?? 0) + 1;
    if (report.web.lingering > 3) report.web.unasked++;
  } else report.web.lingering = 0;
  return p;
}
const view = (pose) => {
  if (pose.steer) return { fx: pose.steer.fx, fz: pose.steer.fz };
  const dx = pose.target.x - pose.position.x;
  const dz = pose.target.z - pose.position.z;
  const d = Math.hypot(dx, dz) || 1;
  return { fx: dx / d, fz: dz / d };
};
/** WASD for a world direction, through the camera (as the stick: forward is the view, right is (−fz, fx)). */
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

/* ------------------------------------------------------------------ shots and strips */

let shotN = 0;
async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(data, "base64"));
}
const strips = {};
async function frame(stripName, p) {
  const list = (strips[stripName] ??= []);
  if (list.length >= 36) return;
  const name = `${stripName}-${String(list.length).padStart(2, "0")}`;
  await shot(name);
  list.push({ name, tick: p.tick, move: p.move, v: Math.round(Math.hypot(p.vx, p.vz)), y: p.y });
}
function sheet(stripName) {
  const list = strips[stripName] ?? [];
  if (!list.length) return;
  if (list.length === 1) return;
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-pattern_type", "glob", "-i", join(out, `${stripName}-??.jpg`), "-vf", `scale=320:-1,tile=6x${Math.ceil(list.length / 6)}`, "-frames:v", "1", join(out, `${stripName}-sheet.jpg`)]);
  } catch (e) {
    console.log("no sheet", String(e).slice(0, 160));
  }
}
async function perf(label) {
  const s = await evaluate(`window.__wgpScene`);
  if (s) report.perf.push({ label, calls: s.calls, fps: Math.round(s.fps), tier: s.tier, triangles: s.triangles, castMs: +s.castMs.toFixed(2) });
}

/* ------------------------------------------------------------------ movement helpers */

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

/**
 * Run to (x, z) along `route` (or straight), sprinting when far: steer by the camera every poll,
 * hop when stuck, let go of a wall when the goal is lower. `strip` captures frames on the way.
 */
async function goTo(x, z, { street = false, r = 40, sprint = true, timeout = 60, strip = null, low = false, every = 3 } = {}) {
  let p = await peek();
  const route = street ? streetRoute(p.x, p.z, x, z) : [{ x, z }];
  const end = Date.now() + timeout * 1000;
  let stuck = 0;
  let lastX = p.x;
  let lastZ = p.z;
  let n = 0;
  /** Off a wall the route ran into: a step out from it, then on. */
  let detour = null;
  while (Date.now() < end) {
    p = await peek();
    while (route.length > 1 && Math.hypot(route[0].x - p.x, route[0].z - p.z) < 50) route.shift();
    const left = Math.hypot(x - p.x, z - p.z);
    const feet = p.y - 26;
    if (left < r && route.length <= 1 && (!low || feet < 30) && (p.move === "ground" || p.move === "roll")) break;
    if (low && (p.move === "climb" || p.move === "hang") && p.wall) {
      // Wanting the street: let go, and step out from the wall before heading on.
      detour = { x: p.x + p.wall.nx * 260, z: p.z + p.wall.nz * 260, until: Date.now() + 900 };
      await setHeld(new Set(["KeyX"]));
      await sleep(60);
      continue;
    }
    if (detour && Date.now() > detour.until) detour = null;
    const aim = detour ?? route[0];
    const keys = steerKeys(p, aim.x - p.x, aim.z - p.z);
    if (sprint && left > 260) keys.add("ShiftLeft");
    const moved = Math.hypot(p.x - lastX, p.z - lastZ);
    lastX = p.x;
    lastZ = p.z;
    stuck = moved < 2 && p.move === "ground" ? stuck + 1 : 0;
    if (stuck > 8) {
      keys.add("Space");
      stuck = 0;
    }
    await setHeld(keys);
    if (strip && n++ % every === 0) await frame(strip, p);
    await sleep(40);
  }
  await releaseAll();
  return peek();
}

/** Hold `keys` for `ms`; given `toward`, the steering keys are re-picked toward it every poll. */
async function hold(keys, ms, strip = null, every = 2, toward = null) {
  const end = Date.now() + ms;
  let n = 0;
  const stats = { top: 0, moves: new Set() };
  while (Date.now() < end) {
    const p = await peek();
    stats.top = Math.max(stats.top, Math.hypot(p.vx, p.vz));
    stats.moves.add(p.move);
    const set = new Set(keys);
    if (toward) for (const k of steerKeys(p, toward.x - p.x, toward.z - p.z)) set.add(k);
    await setHeld(set);
    if (strip && n++ % every === 0) await frame(strip, p);
    await sleep(40);
  }
  await releaseAll();
  return { top: Math.round(stats.top), moves: [...stats.moves] };
}

/* ------------------------------------------------------------------ the run */

const world = await evaluate(`(() => { const w = window.__wgpCity.world; return { spawn: w.spawn, folks: w.folks.map((f) => ({ key: f.key, x: f.x, y: f.y, z: f.z, id: f.id })), pages: w.pages }; })()`);
const dev = world.folks.find((f) => f.key === "dev");
const page = world.pages.find((p) => p.y === 0);
await shot("00-start");
await perf("start");
beat("start", { x: (await peek()).x });

/** Talk to someone: up to them, nudge until the prompt says so, E. */
async function talkTo(f, label) {
  let p = await goTo(f.x + 50, f.z, { street: f.y === 0, r: 70, low: f.y === 0, timeout: 60 });
  for (let i = 0; i < 25 && p.actKind !== "talk"; i++) {
    await setHeld(steerKeys(p, f.x - p.x, f.z - p.z));
    await sleep(70);
    await releaseAll();
    p = await peek();
  }
  await shot(`${label}-prompt`);
  await tap("KeyE");
  await sleep(450);
  p = await peek();
  await shot(label);
  return p;
}

// 1. Walk (C held) across the spawn roof, then a run.
const s = world.spawn;
let p = await peek();
const across = { x: s.x, z: s.z + 3000 };
const walk = await hold(["KeyC"], 1400, "1-walk", 2, across);
beat("walk", walk);
p = await peek();
const run = await hold([], 700, "1-walk", 2, across);
beat("run", run);

// 2. Sprint: off the roof's edge in a leap, a roll on the street, on down it.
p = await peek();
const sprint = await hold(["ShiftLeft"], 2600, "2-sprint", 1, across);
beat("sprint", sprint);
await perf("sprint");

// 3–4. Climb a building from the street and mantle onto it (the tallest near the middle:
// its east face, two tiers, 556 up).
const face = { x: 2988, z: 4059 };
p = await goTo(face.x, face.z, { street: true, r: 30, low: true, timeout: 60 });
beat("at the wall", { x: p.x, z: p.z });
{
  const end = Date.now() + 14_000;
  const moves = new Set();
  let k = 0;
  while (Date.now() < end) {
    p = await peek();
    moves.add(p.move);
    if (p.move === "ground" && p.y - 26 >= 553) break;
    await setHeld(steerKeys(p, -1, 0));
    if (k++ % 2 === 0) await frame("3-climb-mantle", p);
    await sleep(40);
  }
  await releaseAll();
  p = await peek();
  beat("climbed and mantled", { moves: [...moves], feet: Math.round(p.y - 26) });
  await shot("3-on-the-roof");
}
await perf("climb");

/** Hold the stick toward `to` (and `keys`) until `done(p)` or `ms` runs out; the moves seen. */
async function until(to, keys, ms, done, strip = null, every = 1) {
  const end = Date.now() + ms;
  const moves = new Set();
  let k = 0;
  let p = await peek();
  while (Date.now() < end) {
    p = await peek();
    moves.add(p.move);
    if (done(p)) break;
    const set = steerKeys(p, to.x - p.x, to.z - p.z);
    for (const c of keys) set.add(c);
    await setHeld(set);
    if (strip && k++ % every === 0) await frame(strip, p);
    await sleep(35);
  }
  await releaseAll();
  return { p, moves: [...moves] };
}

// 5. Off the tall roof's east edge (a long fall, a roll), then a wall run: a sprint on the
// diagonal into the spawn building's west face (x 3130, z 3200–3640) runs along it, north.
{
  const off = await until({ x: 3600, z: 4059 }, [], 6000, (q) => q.move === "ground" && q.y - 26 < 30, "5-drop", 2);
  beat("off the roof", { moves: off.moves });
  const start = await until({ x: 3000, z: 3700 }, [], 6000, (q) => Math.hypot(q.x - 3000, q.z - 3700) < 40 && q.move === "ground");
  beat("at the wall-run street", { x: start.p.x, z: start.p.z });
  // Up the street a moment (the camera comes round behind), then the diagonal at the wall.
  await until({ x: 3000, z: 3560 }, [], 1500, (q) => q.z < 3600);
  const run = await until({ x: 3600, z: 2900 }, ["ShiftLeft"], 2600, (q) => q.move === "wallrun" && q.z < 3300, "5-wallrun", 1);
  const after = await until({ x: 3030, z: 2900 }, [], 900, () => false, "5-wallrun", 1);
  beat("wall run", { moves: [...run.moves, ...after.moves] });
}
await perf("wall run");

// 6. A swing, only while F is held: up the street at x 3030, held, then let go.
p = await until({ x: 3030, z: 3300 }, [], 4000, (q) => Math.abs(q.x - 3030) < 35 && q.move === "ground");
{
  const north = { x: 3030, z: 0 };
  const before = await hold([], 600, "6-swing", 1, north);
  const held = await hold(["KeyF"], 2600, "6-swing", 1, north);
  const after = await hold([], 1400, "6-swing", 2, north);
  p = await peek();
  beat("swing on demand", { before: before.moves, held: held.moves, after: after.moves, rope: p.rope });
}
await perf("swing");

// 7. A word with a civilian: whoever's nearest in the street.
p = await peek();
// (The one nearest Dev, whose task is next.)
const civ = world.folks.filter((f) => f.y === 0 && !["dev"].includes(f.key) && !f.key.match(/^(aunt|uncle|mary|bearson)$/)).sort((a, b) => Math.hypot(a.x - dev.x, a.z - dev.z) - Math.hypot(b.x - dev.x, b.z - dev.z))[0];
p = await talkTo(civ, "7-civilian");
beat("talked to a civilian", { key: civ.key, chat: p.chat });

// 8. A side task: Dev's wallet. Talk, chase the bot over the roofs (zips, climbs), bring it back.
p = await talkTo(dev, "8-dev");
beat("talked to Dev", { stage: p.stage });
{
  const end = Date.now() + 100_000;
  let lastZip = 0;
  let k = 0;
  while (Date.now() < end) {
    p = await peek();
    if (p.bot.state === 3 || p.stage[1] >= 2) break;
    const keys = steerKeys(p, p.bot.x - p.x, p.bot.z - p.z);
    keys.add("ShiftLeft");
    const d = Math.hypot(p.bot.x - p.x, p.bot.z - p.z);
    const up = p.bot.y - (p.y - 26);
    if ((up > 80 || d > 380) && d < 760 && p.zip && Date.now() - lastZip > 900 && p.move !== "climb" && p.move !== "hang") {
      keys.add("KeyQ");
      lastZip = Date.now();
    }
    if (p.move === "ground" && Math.hypot(p.vx, p.vz) < 20) keys.add("Space");
    await setHeld(keys);
    if (k++ % 3 === 0) await frame("8-chase", p);
    await sleep(40);
  }
  await releaseAll();
  p = await peek();
  await shot("8-bot-caught");
  beat("bot caught", { stage: p.stage });
}
p = await talkTo(dev, "8-task-done");
beat("task done", { stage: p.stage });

// 9. A Daily Rug page in the street.
p = await goTo(page.x, page.z, { street: true, r: 12, low: true, timeout: 60, strip: "9-page", every: 8 });
await sleep(400);
p = await peek();
await shot("9-page");
beat("page", { pages: p.pages });

// The map, and the pause sheet (the outing files as it opens).
await tap("KeyM");
await sleep(900);
await shot("10-map");
await tap("KeyM");
await sleep(300);
await tap("Escape");
await sleep(1800);
await shot("11-pause");
await perf("end");
if (who === "dev") report.server = await evaluate(`fetch("/api/city").then((r) => r.json())`);
else report.local = await evaluate(`(() => { const s = JSON.parse(localStorage.getItem("wgp:save:v1")); return { city: s.city, hero: { level: s.hero.level, xp: s.hero.xp } }; })()`);

for (const k of Object.keys(strips)) sheet(k);
report.strips = strips;
report.errors = logs.filter((l) => /error|exception/i.test(l));
writeFileSync(join(out, "play.json"), JSON.stringify(report, null, 1));
console.log("legs", JSON.stringify(report.legs), "web", JSON.stringify(report.web));
console.log("perf", JSON.stringify(report.perf));
console.log("server/local", JSON.stringify(report.server ?? report.local));
console.log(report.errors.join("\n") || "no console errors");
clearTimeout(watchdog);
await close();
