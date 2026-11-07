/**
 * Cross-chain (roam-3) played for real over CDP: real key presses steered camera-relative (and
 * real touches on a phone for the act button), against a running WGP server
 * (`ALLOW_DEV_AUTH=1 next dev`, PGlite, no .env.local):
 *
 *   node launch/brand/hero/city-crosschain.mjs --out <dir> [--base http://127.0.0.1:4020] [--port 9420] [--tier high]
 *
 * As a guest whose city record has the four old tasks done (as the player who asked for more):
 * 1. Uncle Gen's briefing: E beside him on his roof, the new task.
 * 2. The crane: from the street, up the skyscraper beside it (both tiers), along its jib to the
 *    apex, then E held until the relay comes unplugged (its sparks and the ring mid-hold).
 * 3. The bridge's west tower: a scramble up a leg from the street to hang from the cap; E held,
 *    let go halfway (the relay resets), then held through to unplugged.
 * 4. The tallest building's antenna: both tiers from the street, then the hold.
 * 5. On a phone (915×412, touch): the act button held with a finger on Doc's deck tower.
 * 6. Back to Uncle Gen: his speech, the task done and its XP.
 * Each phase starts from a guest save written for it (the record's spot and stage). Screenshots
 * at each beat, the scene's draw calls and frame rate, and any console error.
 *
 * Writes <out>/*.jpg and <out>/crosschain.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "/Users/eromonseleodigie/near-hackathon/launch/lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:4020");
const out = opt("out", "launch/brand/hero/game-shots/city-crosschain");
const tier = opt("tier", "high");
const port = Number(opt("port", "9420"));
const SAVE = JSON.parse(readFileSync(opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json"), "utf8"));
mkdirSync(out, { recursive: true });

const cdp = await launch({ port, profile: `/private/tmp/claude-501/wgp-city-crosschain-${port}` });
const { logs, close } = cdp;
const within = (promise, what) => Promise.race([promise, new Promise((_, j) => setTimeout(() => j(new Error(`timed out: ${what}`)), 10000))]);
const send = (method, params) => within(cdp.send(method, params), method);
const evaluate = (expr) => within(cdp.evaluate(expr), "evaluate");
const report = { tier, beats: [], perf: [], errors: [], checks: {} };
const t0 = Date.now();
const beat = (name, extra = {}) => {
  report.beats.push({ name, at: Date.now() - t0, ...extra });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`, JSON.stringify(extra));
};
const watchdog = setTimeout(() => {
  console.log("watchdog: the run took too long");
  try {
    writeFileSync(join(out, "crosschain.json"), JSON.stringify({ ...report, watchdog: true, errors: logs.filter((l) => /error|exception/i.test(l)) }, null, 1));
  } catch {}
  process.exit(2);
}, 12 * 60_000);
await send("Page.enable");
await send("Runtime.enable");

/* ------------------------------------------------------------------ saves and pages */

const OLD = { bread: 9, pickpocket: 9, pixels: 9, graffiti: 9 };
const city = (crosschain, items, at) => ({ tasks: { ...OLD, ...(crosschain ? { crosschain } : {}) }, items: { pixels: 255, graffiti: 15, ...(items ? { crosschain: items } : {}) }, pages: 0, views: 0, xp: 160, at, outings: 4 });

async function viewport(phone) {
  if (phone) {
    await send("Emulation.setDeviceMetricsOverride", { width: 915, height: 412, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  } else {
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  }
}

/** Into the City with this city record in the guest save. */
async function enter(rec, { phone = false } = {}) {
  // A plain page on the origin first (so the last outing's pagehide filing lands before the new save does).
  await send("Page.navigate", { url: `${base}/robots.txt` });
  await sleep(900);
  await viewport(phone);
  await evaluate(`localStorage.setItem("wgp:save:v1", ${JSON.stringify(JSON.stringify({ ...SAVE, city: rec }))}); true`);
  await send("Page.navigate", { url: `${base}/play/city?debug=1&tier=${tier}` });
  for (let i = 0; i < 160; i++) {
    await sleep(250);
    if (await evaluate(`!!(window.__wgpCity && window.__wgpScene && window.__wgpCity.handle())`).catch(() => false)) break;
  }
  // Past the first-visit hint (it goes after six seconds of play).
  await sleep(6400);
}

/** Swing the camera round (radians), held while a shot is taken, then let it go back. */
async function look(yaw, pitch = 0) {
  await evaluate(`window.__wgpCity.handle().orbit(${yaw}, ${pitch}, true); true`);
  await sleep(700);
}
const unlook = () => evaluate(`window.__wgpCity.handle().orbit(0, 0, false); true`);

/* ------------------------------------------------------------------ keys */

const KEYS = { KeyW: ["w", 87], KeyA: ["a", 65], KeyS: ["s", 83], KeyD: ["d", 68], KeyC: ["c", 67], KeyE: ["e", 69], KeyX: ["x", 88], Space: [" ", 32], ShiftLeft: ["Shift", 16], KeyM: ["m", 77], Escape: ["Escape", 27] };
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
async function tap(code) {
  await key(code, true);
  await sleep(70);
  await key(code, false);
}

const PEEK = `(() => { const c = window.__wgpCity; const p = c.peek(); const f = c.loop.view.roam; return { ...p, actKind: f && f.act && f.act.kind, actIndex: f && f.act ? f.act.index : -1, chatLine: f && f.chat ? f.chat.line : null }; })()`;
const peek = () => evaluate(PEEK);
const view = (pose) => {
  if (pose.steer) return { fx: pose.steer.fx, fz: pose.steer.fz };
  const dx = pose.target.x - pose.position.x;
  const dz = pose.target.z - pose.position.z;
  const d = Math.hypot(dx, dz) || 1;
  return { fx: dx / d, fz: dz / d };
};
/** WASD for a world direction through the camera (forward is the view, right is (−fz, fx)). */
function steerKeys(p, dx, dz) {
  const keys = new Set();
  const d = Math.hypot(dx, dz);
  if (d < 1 || !p.pose) return keys;
  const v = view(p.pose);
  const fwd = (dx / d) * v.fx + (dz / d) * v.fz;
  const right = (dx / d) * -v.fz + (dz / d) * v.fx;
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
  if (s) report.perf.push({ label, calls: s.calls, fps: Math.round(s.fps), tier: s.tier, triangles: s.triangles });
}

/**
 * Steer toward (x, z) with `extra` keys held until `done(p)` (or the timeout), re-picking the
 * keys every poll. `snap` takes a screenshot once, the first poll `snap.when(p)` holds.
 */
async function drive(x, z, extra, done, { timeout = 30, snap = null, hop = true } = {}) {
  const end = Date.now() + timeout * 1000;
  let p = await peek();
  let snapped = false;
  let stuck = 0;
  let last = { x: p.x, z: p.z };
  while (Date.now() < end && !done(p)) {
    const keys = steerKeys(p, x - p.x, z - p.z);
    for (const k of extra) keys.add(k);
    // Stuck against something on foot: hop it, as a player would.
    stuck = p.move === "ground" && Math.hypot(p.x - last.x, p.z - last.z) < 1.5 ? stuck + 1 : 0;
    last = { x: p.x, z: p.z };
    if (hop && stuck > 10) {
      keys.add("Space");
      stuck = 0;
    }
    await setHeld(keys);
    if (snap && !snapped && snap.when(p)) {
      snapped = true;
      await shot(snap.name);
    }
    await sleep(40);
    p = await peek();
  }
  await releaseAll();
  return p;
}
const feet = (p) => p.y - 26;
const near = (x, z, r) => (p) => Math.hypot(p.x - x, p.z - z) < r;

/** E held until the relay comes unplugged (or `ms`), shots at `shots` hold ticks; returns the last peek. */
async function holdE(relay, { ms = 4000, shots = {}, letGoAt = 0 } = {}) {
  await key("KeyE", true);
  const end = Date.now() + ms;
  const taken = new Set();
  let p = await peek();
  const bit = 1 << relay;
  while (Date.now() < end && !(p.items[4] & bit)) {
    for (const [ticks, name] of Object.entries(shots)) {
      if (!taken.has(name) && p.hold.ticks >= Number(ticks)) {
        taken.add(name);
        await shot(name);
      }
    }
    if (letGoAt && p.hold.ticks >= letGoAt) break;
    await sleep(25);
    p = await peek();
  }
  await key("KeyE", false);
  await sleep(120);
  return peek();
}

/* ------------------------------------------------------------------ the run */

await enter(city(0, 0, null));
const world = await evaluate(`(() => { const w = window.__wgpCity.world; return { folks: w.folks.filter((f) => f.cast).map((f) => ({ key: f.key, x: f.x, y: f.y, z: f.z })), relays: w.relays }; })()`);
const uncle = world.folks.find((f) => f.key === "uncle");
const R = Object.fromEntries(world.relays.map((r, i) => [r.key, { ...r, i }]));
beat("world", { uncle, relays: world.relays.map((r) => [r.key, Math.round(r.x), Math.round(r.y), Math.round(r.z)]) });

// 1. Uncle Gen's briefing.
await enter(city(0, 0, { x: uncle.x - 60, y: uncle.y, z: uncle.z, fx: 1, fz: 0 }));
let p = await peek();
await look(1.1, 0.05);
await shot("01-uncle-prompt");
report.checks.uncleAct = p.actKind;
await tap("KeyE");
await sleep(700);
p = await peek();
await shot("02-uncle-briefing");
await unlook();
report.checks.taken = p.stage[4];
beat("briefing", { stage: p.stage, chatLine: p.chatLine });
await perf("uncle");
await tap("KeyM");
await sleep(900);
await shot("03-map-task");
await tap("KeyM");
await sleep(400);

// 2. The crane: up the skyscraper beside it from the street, along the jib to the apex.
const c = R.crane;
await enter(city(1, 0, { x: c.x - 90, y: 0, z: 700, fx: 0, fz: 1 }));
p = await drive(c.x - 90, 1000, ["ShiftLeft"], (q) => q.move === "ground" && feet(q) > 630, { timeout: 40, snap: { name: "04-crane-climb", when: (q) => q.move === "climb" && feet(q) > 300 } });
beat("crane: main roof", { y: Math.round(feet(p)), move: p.move });
p = await drive(c.x - 90, 1000, [], (q) => q.move === "ground" && feet(q) > 708, { timeout: 20 });
beat("crane: tier", { y: Math.round(feet(p)), move: p.move });
// Round the tier's cluster of antennas (east of them), then along to the jib.
// Up here (the tier, its edge, the jib): a walk, never a hop. Round the tier's clutter (a
// cluster of antennas and a mast in its middle, a vent by the jib) on its west and north sides.
for (const [x, z, r] of [
  [4878, 880, 12],
  [4878, 1016, 12],
  [c.x - 45, 1016, 10],
]) {
  p = await drive(x, z, ["KeyC"], near(x, z, r), { timeout: 20, hop: false });
  beat("crane: across the tier", { x: Math.round(p.x), y: Math.round(feet(p)), z: Math.round(p.z) });
}
p = await drive(c.x, 1016, ["KeyC"], near(c.x, 1016, 8), { timeout: 15, hop: false });
beat("crane: on the jib", { x: Math.round(p.x), y: Math.round(feet(p)), z: Math.round(p.z) });
p = await drive(c.x, c.z - 45, ["KeyC"], (q) => near(c.x, c.z - 45, 10)(q) || q.actKind === "unplug", { timeout: 20, hop: false, snap: { name: "05-crane-jib", when: (q) => q.z > 1080 } });
await sleep(300);
p = await peek();
await look(1.25, 0.12);
await shot("06-crane-prompt");
beat("crane: at the apex", { x: p.x, y: Math.round(feet(p)), z: p.z, act: p.actKind });
report.checks.craneReached = p.actKind === "unplug" && p.actIndex === c.i;
await perf("crane");
p = await holdE(c.i, { shots: { 33: "07-crane-spark", 72: "07b-crane-ring" } });
await sleep(250);
await shot("08-crane-unplugged");
await unlook();
report.checks.crane = (p.items[4] & (1 << c.i)) !== 0;
beat("crane: unplugged", { items: p.items[4] });

// 3. The bridge's west tower: up a leg to hang from the cap; a let-go halfway, then the hold.
const b = R.bridge;
await enter(city(1, 1 << c.i, { x: b.x, y: 0, z: b.z - 170, fx: 0, fz: 1 }));
p = await drive(b.x, b.z + 400, ["ShiftLeft"], (q) => q.move === "hang", { timeout: 30, snap: { name: "09-bridge-climb", when: (q) => q.move === "climb" && feet(q) > 380 } });
await sleep(400);
p = await peek();
await shot("10-bridge-hang");
beat("bridge: hanging from the cap", { y: Math.round(feet(p)), move: p.move, act: p.actKind });
report.checks.bridgeReached = p.actKind === "unplug" && p.actIndex === b.i;
p = await holdE(b.i, { shots: { 34: "11-bridge-half" }, letGoAt: 48 });
await sleep(350);
await shot("12-bridge-reset");
report.checks.reset = { ticks: p.hold.ticks, relay: p.hold.relay, items: p.items[4] };
beat("bridge: let go halfway", report.checks.reset);
await sleep(600);
p = await holdE(b.i);
await sleep(250);
await shot("13-bridge-unplugged");
report.checks.bridge = (p.items[4] & (1 << b.i)) !== 0;
beat("bridge: unplugged", { items: p.items[4] });
await perf("bridge");

// 4. The tallest building's antenna.
const a = R.antenna;
await enter(city(1, (1 << c.i) | (1 << b.i), { x: 6190, y: 0, z: a.z, fx: 1, fz: 0 }));
p = await drive(6400, a.z, ["ShiftLeft"], (q) => q.move === "ground" && feet(q) > 715, { timeout: 40, snap: { name: "14-antenna-climb", when: (q) => q.move === "climb" && feet(q) > 400 } });
p = await drive(6400, a.z, [], (q) => q.move === "ground" && feet(q) > 790, { timeout: 20 });
p = await drive(a.x + a.fx * 36, a.z + a.fz * 36, ["KeyC"], (q) => near(a.x + a.fx * 36, a.z + a.fz * 36, 10)(q), { timeout: 20 });
await sleep(300);
p = await peek();
await look(-0.9, 0.05);
await shot("15-antenna-prompt");
report.checks.antennaReached = p.actKind === "unplug" && p.actIndex === a.i;
p = await holdE(a.i, { shots: { 50: "16-antenna-hold" } });
await sleep(250);
await shot("17-antenna-unplugged");
await unlook();
report.checks.antenna = (p.items[4] & (1 << a.i)) !== 0;
beat("antenna: unplugged", { items: p.items[4] });
await perf("antenna");

// 5. On a phone: Doc's deck tower, hung from by a scramble up its leg, the act button held by a finger.
const d = R.deck;
await enter(city(1, (1 << c.i) | (1 << b.i) | (1 << a.i), { x: d.x, y: 0, z: d.z + 170, fx: 0, fz: -1 }), { phone: true });
p = await drive(d.x, d.z - 400, ["ShiftLeft"], (q) => q.move === "hang", { timeout: 30 });
await sleep(500);
p = await peek();
await shot("18-phone-deck-hang");
const btn = await evaluate(`(() => { const b = document.querySelector('button[aria-label^="Hold to unplug"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.getAttribute("aria-label") }; })()`);
report.checks.touchButton = btn;
if (btn) {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: btn.x, y: btn.y, id: 1 }] });
  const end = Date.now() + 4000;
  let shotHalf = false;
  while (Date.now() < end) {
    p = await peek();
    if (!shotHalf && p.hold.ticks >= 45) {
      shotHalf = true;
      await shot("19-phone-hold-ring");
    }
    if (p.items[4] & (1 << d.i)) break;
    await sleep(25);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  p = await peek();
  await shot("20-phone-unplugged");
}
report.checks.deck = (p.items[4] & (1 << d.i)) !== 0;
report.checks.stageAfterFour = p.stage[4];
beat("deck (touch): unplugged", { items: p.items[4], stage: p.stage[4] });
await perf("phone");

// 6. Back to Uncle Gen: the speech, done, and its XP.
await enter(city(2, 15, { x: uncle.x - 60, y: uncle.y, z: uncle.z, fx: 1, fz: 0 }));
await look(1.1, 0.05);
await tap("KeyE");
await sleep(1600);
p = await peek();
await shot("21-uncle-speech");
report.checks.done = p.stage[4];
beat("speech", { stage: p.stage[4], chatLine: p.chatLine });
await sleep(1500);
const saved = await evaluate(`(() => { const s = JSON.parse(localStorage.getItem("wgp:save:v1")); return { city: s.city, xp: s.hero && s.hero.xp }; })()`);
report.checks.saved = { crosschain: saved.city && saved.city.tasks.crosschain, xp: saved.xp, cityXp: saved.city && saved.city.xp };
await shot("22-done-toast");

report.errors = logs.filter((l) => /error|exception|uncaught/i.test(l) && !/favicon|DevTools|\[HMR\]/i.test(l));
writeFileSync(join(out, "crosschain.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.checks, null, 1));
console.log("errors", report.errors.length, report.errors.slice(0, 5));
console.log("perf", JSON.stringify(report.perf));
clearTimeout(watchdog);
await close();
process.exit(0);
