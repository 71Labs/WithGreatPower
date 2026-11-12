/**
 * Free roam's Front-run (roam-3) played for real over CDP: real key presses (W A S D, Shift,
 * Space, Q, E, C) steered camera-relative the way a player would, against a running WGP server
 * (`ALLOW_DEV_AUTH=1 next dev`, PGlite, no .env.local):
 *
 *   node launch/brand/hero/city-frontrun.mjs --out <dir> [--base http://127.0.0.1:4010] [--tier high] [--cdp 9410]
 *
 * A guest save whose city record has the first four tasks done (a roam-2 record: no "frontrun"
 * in it) and the last outing ending beside Gwei Stacy's stall. The run, in order: Gwei at her
 * stall; talk (the race starts); a slow try at a walk (C held), Sandwich Man running past, up the
 * facade and over the roofs, and beating him to the buyer: lost, back at her stall with her line;
 * talk again; the race run well (sprinting, leaping up the facade, the step, the leap, the
 * barricade vault, the zip over the river, the leap), the order filled. Shots at each beat, the
 * scene's draw calls and frame rate, console errors.
 *
 * Writes <out>/*.jpg and <out>/frontrun.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:4010");
const out = opt("out", "launch/brand/hero/game-shots/city-frontrun");
const tier = opt("tier", "high");
const port = Number(opt("cdp", "9410"));
const width = Number(opt("width", "1280"));
const height = Number(opt("height", "800"));
const SAVE = opt("save", "launch/brand/hero/fixtures/hero-save.json");
mkdirSync(out, { recursive: true });

const cdp = await launch({ port, profile: `/tmp/wgp-city-frontrun-${port}` });
const { logs } = cdp;
const within = (promise, what) => Promise.race([promise, new Promise((_, j) => setTimeout(() => j(new Error(`timed out: ${what}`)), 8000))]);
const send = (method, params) => within(cdp.send(method, params), method);
const evaluate = (expr) => within(cdp.evaluate(expr), "evaluate");
const report = { tier, beats: [], perf: [], tries: [], errors: [] };
const t0 = Date.now();
const beat = (name, extra = {}) => {
  report.beats.push({ name, at: Date.now() - t0, ...extra });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`, JSON.stringify(extra));
};
const watchdog = setTimeout(() => {
  console.log("watchdog: the run took too long");
  try {
    writeFileSync(join(out, "frontrun.json"), JSON.stringify({ ...report, watchdog: true, errors: logs.filter((l) => /error|exception/i.test(l)) }, null, 1));
  } catch {}
  process.exit(2);
}, 8 * 60_000);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
// A roam-2 player's record: the first four tasks done, the outing ending beside Gwei's stall.
const save = JSON.parse(readFileSync(SAVE, "utf8"));
save.city = { tasks: { bread: 9, pickpocket: 9, pixels: 9, graffiti: 9 }, items: { pixels: 255, graffiti: 15 }, pages: 0, views: 0, xp: 160, at: { x: 3106, y: 0, z: 1292, fx: 1, fz: 0 }, outings: 6 };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(JSON.stringify(save))}); } catch {}` });
await send("Page.navigate", { url: `${base}/play/city?debug=1&tier=${tier}` });
for (let i = 0; i < 160; i++) {
  await sleep(250);
  if (await evaluate(`!!(window.__wgpCity && window.__wgpScene && window.__wgpCity.handle())`).catch(() => false)) break;
}
// The cast's files (Gwei's, Sandwich Man's) come in behind the hero's.
await sleep(5000);

/* ------------------------------------------------------------------ keys */

const KEYS = { KeyW: ["w", 87], KeyA: ["a", 65], KeyS: ["s", 83], KeyD: ["d", 68], KeyC: ["c", 67], KeyE: ["e", 69], KeyQ: ["q", 81], KeyX: ["x", 88], Space: [" ", 32], ShiftLeft: ["Shift", 16] };
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
  await sleep(50);
  await key(code, false);
}
const releaseAll = () => setHeld(new Set());

const PEEK = `(() => {
  const c = window.__wgpCity;
  const p = c.peek();
  const f = c.loop.view.roam;
  return { ...p, zip: f && f.zip, wall: f && f.wall, marks: f && f.marks ? f.marks.length : 0, frame: f && f.race ? { heroGate: f.race.heroGate, rivalGate: f.race.rivalGate, over: f.race.over, why: f.race.why, rival: f.race.rival, rivalMove: f.race.rivalMove } : null, chatText: c.loop.hud.getSnapshot()?.chat?.text ?? null };
})()`;
const peek = () => evaluate(PEEK);
const view = (pose) => {
  if (pose.steer) return { fx: pose.steer.fx, fz: pose.steer.fz };
  const dx = pose.target.x - pose.position.x;
  const dz = pose.target.z - pose.position.z;
  const d = Math.hypot(dx, dz) || 1;
  return { fx: dx / d, fz: dz / d };
};
/** WASD for a world direction, through the camera (forward is the view, right is (−fz, fx)). */
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

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(data, "base64"));
}
async function perf(label) {
  const s = await evaluate(`window.__wgpScene`);
  if (s) report.perf.push({ label, calls: s.calls, fps: Math.round(s.fps), tier: s.tier, triangles: s.triangles, castMs: +s.castMs.toFixed(2) });
}
const raceOn = (p) => p.race && p.race.state === 1;

/**
 * Steer to (x, z) (sprinting unless `walk`), a leap up the wall now and then while climbing,
 * until within `r` and at about `y` (feet), or the race ends. Shots by name at the first frame a
 * test passes.
 */
async function goTo(x, z, { y = null, r = 45, walk = false, brake = false, timeout = 30, shots = [] } = {}) {
  const end = Date.now() + timeout * 1000;
  let p = await peek();
  let lastJump = 0;
  while (Date.now() < end) {
    p = await peek();
    if (!raceOn(p)) break;
    const feet = p.y - 26;
    if (Math.hypot(x - p.x, z - p.z) < r && (y === null || Math.abs(feet - y) < 60) && p.move === "ground") break;
    const keys = steerKeys(p, x - p.x, z - p.z);
    // `brake`: the last stretch at a walk, so a stop short of a roof's edge stays on the roof.
    if (walk || (brake && Math.hypot(x - p.x, z - p.z) < 150)) keys.add("KeyC");
    else keys.add("ShiftLeft");
    if (!walk && p.move === "climb" && Date.now() - lastJump > 480) {
      lastJump = Date.now();
      keys.add("Space");
    }
    await setHeld(keys);
    for (const s of shots) {
      if (!s.done && s.when(p)) {
        s.done = true;
        await shot(s.name);
        beat(`shot ${s.name}`, { tick: p.tick, move: p.move, x: p.x, y: p.y, z: p.z, race: p.frame });
      }
    }
    await sleep(16);
  }
  return p;
}

/** Wait (keys up) until `test` holds or `seconds` pass; shots by name on the way. */
async function waitFor(test, seconds, shots = []) {
  const end = Date.now() + seconds * 1000;
  let p = await peek();
  while (Date.now() < end) {
    p = await peek();
    for (const s of shots) {
      if (!s.done && s.when(p)) {
        s.done = true;
        await shot(s.name);
        beat(`shot ${s.name}`, { tick: p.tick, move: p.move, race: p.frame, chat: p.chatText });
      }
    }
    if (test(p)) break;
    await sleep(40);
  }
  return p;
}

/* ------------------------------------------------------------------ the run */

let p = await peek();
beat("loaded", { x: p.x, y: p.y, z: p.z, stage: p.stage, act: p.act });
report.loaded = { stage: p.stage, items: p.items };
// Gwei at her stall: the camera turned to take her and her sign in.
await evaluate(`window.__wgpCity.handle().orbit(-0.9, 0.05, false)`);
await sleep(900);
await shot("01-gwei-stall");
await perf("stall");
await evaluate(`window.__wgpCity.handle().orbit(0.9, -0.05, false)`);
await sleep(600);

// Talk: the order, and the race is on.
await tap("KeyE");
await sleep(400);
p = await peek();
beat("talked", { stage: p.stage, race: p.race, chat: p.chatText });
await shot("02-order-up");

// Try 1: a walk. Sandwich Man runs past and fills it first.
const slowShots = [
  { name: "03-sandwich-man-climbs", when: (q) => q.frame && q.frame.rivalMove === "climb" && q.frame.rival.y > 120 },
  { name: "04-sandwich-man-passes", when: (q) => q.frame && q.frame.rivalGate >= 2 && q.frame.rivalMove === "run" },
];
p = await goTo(3400, 1292, { y: 368, walk: true, timeout: 30, shots: slowShots });
if (raceOn(p)) p = await goTo(3540, 1320, { y: 443, walk: true, timeout: 30, shots: slowShots });
await releaseAll();
p = await waitFor((q) => q.frame && q.frame.over === "lost", 30, slowShots);
await sleep(150);
await shot("05-lost-sandwiched");
await perf("lost");
beat("lost", { race: p.frame, tick: p.tick });
p = await waitFor((q) => !q.frame && q.stage[4] === 1, 10);
await sleep(500);
p = await peek();
await shot("06-back-at-the-stall");
report.tries.push({ try: 1, result: "lost", why: "rival", heroGates: p.items[4], chat: p.chatText, at: { x: p.x, y: p.y, z: p.z } });
beat("reset", { x: p.x, z: p.z, chat: p.chatText, stage: p.stage, items: p.items });

// Try 2: talk again, and race it well.
await tap("KeyE");
await sleep(250);
p = await peek();
beat("again", { race: p.race, chat: p.chatText });
const goodShots = [
  { name: "07-climb-gate-1", when: (q) => q.move === "climb" && q.y > 200 },
  { name: "08-setback-gate-2", when: (q) => q.frame && q.frame.heroGate >= 2 && q.move === "ground" },
  { name: "09-leap-gate-3", when: (q) => q.frame && q.frame.heroGate >= 3 && q.move === "air" },
  { name: "10-barricade-vault", when: (q) => q.move === "vault" && q.x > 4000 },
];
const t2 = Date.now();
p = await goTo(3400, 1292, { y: 368, timeout: 15, shots: goodShots });
p = await goTo(3540, 1320, { y: 443, timeout: 15, shots: goodShots });
p = await goTo(4262, 1320, { y: 245, brake: true, timeout: 15, shots: goodShots });
// The zip over the river: turn (at a walk) to the far roof's corner, the reticle on it, Q.
for (let i = 0; i < 60; i++) {
  p = await peek();
  const keys = steerKeys(p, 4836 - p.x, 1596 - p.z);
  keys.add("KeyC");
  await setHeld(keys);
  if (p.zip && p.zip.x > 4700 && i > 3) break;
  await sleep(16);
}
beat("zip aim", { x: p.x, z: p.z, zip: p.zip });
await tap("KeyQ");
await sleep(120);
await shot("11-zip-over-the-river");
p = await waitFor((q) => q.move === "ground" && q.x > 4800, 3);
p = await goTo(4890, 1645, { y: 620, timeout: 10 });
p = await goTo(4950, 1960, { y: 620, timeout: 10 });
const endShots = [{ name: "12-leap-to-the-buyer", when: (q) => q.move === "air" && q.x > 5300 }];
p = await goTo(5560, 2020, { y: 562, r: 60, timeout: 10, shots: endShots });
p = await goTo(5895, 2048, { y: 562, timeout: 10, shots: endShots });
await releaseAll();
p = await waitFor((q) => q.frame && q.frame.over, 3);
await sleep(200);
await shot("13-order-filled");
await perf("won");
p = await waitFor((q) => q.stage[4] === 9, 3);
const seconds = (Date.now() - t2) / 1000;
report.tries.push({ try: 2, result: p.stage[4] === 9 ? "won" : "not won", seconds, race: p.race, items: p.items[4], chat: p.chatText });
beat("try 2", { stage: p.stage, items: p.items, race: p.race, chat: p.chatText, seconds });
await sleep(1600);
await shot("14-done-the-buyer");
// Round to Moby, the buyer (behind the hero from the chase camera).
await evaluate(`window.__wgpCity.handle().orbit(1.15, 0.12, false)`);
await sleep(900);
await shot("15-moby-the-buyer");
await perf("buyer");

report.final = { stage: p.stage, items: p.items };
report.errors = logs.filter((l) => /error|exception/i.test(l) && !/favicon|DevTools/i.test(l));
report.logs = logs.slice(-40);
writeFileSync(join(out, "frontrun.json"), JSON.stringify(report, null, 1));
console.log("errors", report.errors.length, report.errors.slice(0, 5));
console.log("perf", JSON.stringify(report.perf));
clearTimeout(watchdog);
await cdp.close();
process.exit(0);
