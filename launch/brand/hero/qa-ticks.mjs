/**
 * A close look at a few ticks of an autopilot night: plays it in headless Chrome against a
 * running WGP server and, for each sim tick in a range, holds the night (the sim and the scene)
 * and shoots the frame, with the hero's state (the sim's and the animator's) beside it.
 *
 *   node launch/brand/hero/qa-ticks.mjs --base http://127.0.0.1:3910 --level 1 --seed 0 \
 *        --from 225 --to 240 [--every 1] [--tier high] [--case 001] --out <dir>
 *
 * Saves are made like qa-anomalies.mjs's (the level's night, the seed's hero name).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sleep } from "../../lib/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3910");
const level = Number(opt("level", "1"));
const seed = Number(opt("seed", "0"));
const from = Number(opt("from", "0"));
const to = Number(opt("to", "60"));
const every = Number(opt("every", "1"));
const tier = opt("tier", "high");
const chapter = opt("case", "");
const out = opt("out", join(here, "game-shots/qa-sweep/ticks"));
const NAMES = ["Peter Parquet", "Miles Mempool", "Gwen Gasless", "Ben Blockly", "May Merkle", "Otto Oracle"];
const save = JSON.parse(readFileSync(opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json"), "utf8"));
save.night = level === 1 ? 1 : 2 * level - 1;
save.patrol = null;
save.nightDone = false;
save.hero.name = NAMES[seed % NAMES.length];
save.hero.level = level;
save.hero.maxHp = 100 + 6 * (level - 1);
mkdirSync(out, { recursive: true });

/** In the page: hold the night at each wanted tick (the scene too) until the driver lets it go. */
const WATCH = `(() => {
  const p = window.__wgpPlay;
  const h = p && p.handle && p.handle();
  const eng = h && h.inspect && h.inspect();
  if (!eng || !eng.characters) return false;
  if (window.__qt) return true;
  const q = (window.__qt = { held: false, wantFrom: ${from}, wantTo: ${to}, every: ${every}, last: -1, rec: null });
  const loop = p.loop;
  const adv = loop.advance.bind(loop);
  loop.advance = (s) => { if (q.held) return; return adv(s); };
  const upd = eng.update.bind(eng);
  let last = null;
  eng.update = (f, cam, size, dpr, dt, time, cue) => {
    if (q.held && last) return last;
    last = upd(f, cam, size, dpr, dt, time, cue);
    if (f && f.tick >= q.wantFrom && f.tick <= q.wantTo && f.tick !== q.last && (f.tick - q.wantFrom) % q.every === 0) {
      q.last = f.tick;
      const ha = eng.characters.hero && eng.characters.hero.anim;
      const r = (v) => v ? [Math.round(v.x), Math.round(v.y), Math.round(v.z)] : null;
      const e = ha && ha.orient && ha.orient.q;
      q.rec = { tick: f.tick, alpha: +f.alpha.toFixed(2), mode: f.mode, pos: r(f.hero.pos), vel: r(f.hero.vel), anchor: r(f.hero.anchor), grounded: f.hero.grounded, action: f.hero.action, actionTicks: f.hero.actionTicks,
        base: ha && ha.base, impactT: ha && +(ha.impactT || 0).toFixed(2), flipT: ha && +(ha.flipT).toFixed(2), turn: ha && +ha.turn.value.toFixed(2), orient: e ? [e.x, e.y, e.z, e.w].map((x) => +x.toFixed(2)) : null,
        clipW: ha && ha.mocap ? +ha.mocap.clipW.value.toFixed(2) : null, moveW: ha && ha.mocap ? +ha.mocap.moveW.value.toFixed(2) : null, groundW: ha ? +ha.groundW.value.toFixed(2) : null };
      const mc = ha && ha.mocap;
      if (mc) {
        const rig = eng.characters.hero.model.rig;
        const wy = (b) => Math.round(b.matrixWorld.elements[13] * 10) / 10;
        Object.assign(q.rec, { moving: mc.moving, legsMove: +mc.legsMove.toFixed(2), gait: Math.round(mc.gait), pivot: mc.stand.pivoting, stepping: mc.stand.stepping, shot: mc.shot ? mc.shot.name + "@" + mc.shot.t.toFixed(2) : null, ankles: rig.legs.map((l) => wy(l.end)), targets: ha.pose.foot.map((t) => Math.round(t.y * 10) / 10), groupY: Math.round(eng.characters.hero.model.group.position.y * 10) / 10 });
      }
      q.held = true;
    }
    return last;
  };
  return true;
})()`;

const { send, evaluate, close } = await launch({ port: 9500 + Math.floor(Math.random() * 200), profile: `/private/tmp/claude-501/wgp-qa/ticks-${Date.now()}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const log = [];
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(JSON.stringify(save))}); } catch {}` });
  await send("Page.navigate", { url: `${base}/play/patrol?autopilot=1&debug=1&tier=${tier}${chapter ? `&case=${chapter}` : ""}` });
  let ok = false;
  for (let i = 0; i < 360 && !ok; i++) {
    await sleep(250);
    ok = await evaluate(WATCH).catch(() => false);
  }
  if (!ok) throw new Error("no night");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(40);
    const rec = await evaluate(`(() => { const q = window.__qt; return q.held ? q.rec : null; })()`).catch(() => null);
    if (rec) {
      await sleep(60);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, `tick-${String(rec.tick).padStart(5, "0")}.png`), Buffer.from(data, "base64"));
      log.push(rec);
      console.log(JSON.stringify(rec));
      await evaluate(`window.__qt.held = false`);
      if (rec.tick >= to) break;
    }
  }
} finally {
  writeFileSync(join(out, "ticks.json"), JSON.stringify(log, null, 1));
  await close();
}
