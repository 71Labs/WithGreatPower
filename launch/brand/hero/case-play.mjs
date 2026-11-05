/**
 * Case file 001 played end to end with the real art, over CDP, against a running WGP server
 * (`ALLOW_DEV_AUTH=1 next dev`, PGlite, no .env.local):
 *
 *   node launch/brand/hero/case-play.mjs --out <dir> [--base http://127.0.0.1:3861]
 *        [--who guest,dev] [--devices desktop,phone] [--tier high] [--perf low]
 *
 * Per player and device: /play/cases, the intro (/play/cases/001), then
 * /play/patrol?case=001&autopilot=1 with the bot playing. Shots at every beat (each clue found,
 * the standoff's aim cone, the flash, SAVED, the copies, the rescue at restore ~0, ~0.5 and
 * freed, "Case closed"; the copies from the front and, the camera swung round to the nearest
 * one's back side, from behind), the beats' times from the page's load, the scene's draw calls per
 * phase, and the console's errors. Writes <out>/<who>-<device>/*.png and <out>/play.json.
 * `--perf low` plays one more night per device at the low tier (the CPU ×4) for the numbers.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3861");
const out = opt("out", "launch/brand/hero/game-shots/case-001/final");
const tier = opt("tier", "high");
/** A save with a hero (and no night under way): the guest plays from it, the dev player imports it. */
const SAVE = opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json");
const DEVICES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};

/** In the page: watch the night, record its beats and stats, and ask for shots at each. */
/** Stand still through the SCREENSHOTs until one lands (`--saved 0` lets the bot dodge them). */
const HOLD = opt("saved", "1") === "1" ? "true" : "false";

const WATCH = `(() => {
  const w = window;
  if (w.__caseWatch) return true;
  const p = w.__wgpPlay;
  if (!p || !p.loop) return false;
  const t0 = performance.now();
  const st = { beats: [], shots: [], stats: {}, last: {}, restoreShots: new Set() };
  w.__caseWatch = st;
  const now = () => Math.round(performance.now() - t0);
  const beat = (name, extra) => st.beats.push({ name, at: now(), ...(extra || {}) });
  const want = (name) => st.shots.push(name);
  p.loop.bus.on((ev) => {
    switch (ev.type) {
      case "clue-found": beat("clue-found", { id: ev.id, found: ev.found }); want("clue-" + ev.found + "-" + ev.id); break;
      case "encounter": beat("encounter"); want("standoff-encounter"); break;
      case "fight-live": beat("fight-live"); break;
      case "screenshot":
        beat("screenshot", { hit: ev.hit });
        want(ev.hit ? "saved" : "flash-miss");
        // Stood in (see below) until one lands (the bot's web shield pops the first ones): then the bot plays on.
        if (ev.hit) st.gotSaved = true;
        if (ev.hit && st.held) { p.loop.source = st.held; st.held = null; }
        break;
      case "copy-spawn": beat("copy-spawn", { id: ev.id }); st.copyAt = performance.now(); st.copyName = st.last.phase === "rescue" ? "rescue-copies" : "copies"; break;
      case "copy-pop": beat("copy-pop", { id: ev.id }); break;
      case "drag": beat("drag"); break;
      case "fight-won": beat("fight-won"); break;
      case "captive-freed": beat("captive-freed"); want("mary-freed"); break;
      case "case-closed": beat("case-closed", { ticks: ev.ticks }); break;
      case "night-over": beat("night-over"); break;
      case "status": beat("status-" + ev.status); break;
    }
  });
  const tick = () => {
    const f = p.loop.view;
    const ch = f && f.chapter;
    const s = w.__wgpScene;
    if (ch) {
      const key = ch.phase + (f.mode === "fight" ? "" : "");
      if (st.last.phase !== ch.phase) { beat("phase-" + ch.phase); st.last.phase = ch.phase; }
      if (s) {
        const a = (st.stats[key] = st.stats[key] || { n: 0, calls: [], tris: [], fps: [], castMs: [] });
        a.n++;
        if (a.n % 6 === 0) { a.calls.push(s.calls); a.tris.push(s.triangles); a.fps.push(s.fps); a.castMs.push(s.castMs); }
      }
      const rc = (f.villains || []).find((v) => v.id === "right-clicker" && !v.copy);
      if (rc && rc.state !== st.last.rc) {
        st.last.rc = rc.state;
        if (rc.state === "aim" && !st.last.aimShot && rc.stateTicks !== undefined) { st.last.aimShot = true; st.pendingAim = true; }
        // The bot always sidesteps: until a SCREENSHOT lands, the hero stands still in the cone,
        // so the night shows a SAVED too (input like any player's; the log replays the same).
        if (rc.state === "aim" && !st.gotSaved && !st.held && ${HOLD}) { st.held = p.loop.source; p.loop.source = () => ({ dir: 0, mag: 0, web: false, shot: 0 }); }
      }
      st.rc = rc ? rc.state : "";
      if (st.pendingAim && rc && rc.state === "aim" && (rc.stateTicks || 0) > 30) { st.pendingAim = false; want("standoff-aim"); }
      // The copies once they've popped up (0.28 s), if they're still standing.
      if (st.copyAt && performance.now() - st.copyAt > 260) {
        st.copyAt = 0;
        if ((ch.copies || []).some((c) => c.alive)) want(st.copyName);
      }
      // Each clue as the hero closes on it (its prop in view ahead of him), before it's found.
      const hp = f.hero.pos;
      for (const c of ch.clues || []) {
        if (c.found || st.last["near-" + c.id]) continue;
        if (Math.hypot(hp.x - c.pos.x, hp.z - c.pos.z) < 520) { st.last["near-" + c.id] = true; want("approach-" + c.id); }
      }
      const cap = ch.captive;
      if (cap && ch.phase === "rescue") {
        if (!st.restoreShots.has("0")) { st.restoreShots.add("0"); want("rescue-restore-0"); }
        if (cap.restore >= 0.45 && !st.restoreShots.has("5")) { st.restoreShots.add("5"); want("rescue-restore-05"); }
      }
      if (ch.phase === "investigate" && !st.last.investShot) { st.last.investShot = true; st.investWait = performance.now(); }
      if (st.investWait && performance.now() - st.investWait > 2500) { st.investWait = 0; want("investigate"); }
    }
    requestAnimationFrame(tick);
  };
  tick();
  return true;
})()`;

/** Wait in the page for the SCREENSHOT's flash, so the shot lands while it's white. */
const AT_FLASH = `new Promise((res) => {
  const p = window.__wgpPlay;
  const t0 = performance.now();
  const f = () => {
    const v = (p.loop.view.villains || []).find((x) => x.id === "right-clicker" && !x.copy);
    if (v && v.state === "flash") return res(true);
    if (performance.now() - t0 > 3000) return res(false);
    requestAnimationFrame(f);
  };
  f();
})`;

/**
 * In the page: swing the chase camera round (orbit input, held) to the nearest standing copy's
 * back side, so the standee's back is in shot. Resolves with the copy and the bearing error
 * left, or null when no copy stands.
 */
const BEHIND_COPY = `new Promise((res) => {
  const p = window.__wgpPlay;
  const h = p && p.handle();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const aim = () => {
    const f = p.loop.view;
    const hp = f.hero.pos;
    const cs = ((f.chapter && f.chapter.copies) || []).filter((c) => c.alive);
    if (!cs.length) return null;
    const d = (c) => Math.hypot(c.pos.x - hp.x, c.pos.z - hp.z);
    const c = cs.sort((a, b) => d(a) - d(b))[0];
    // A point out from the copy along its back, as a bearing from the hero (the camera's pivot).
    const bx = c.pos.x - Math.sin(c.yaw) * 400 - hp.x;
    const bz = c.pos.z - Math.cos(c.yaw) * 400 - hp.z;
    return { id: c.id, want: Math.atan2(bx, bz), dist: Math.round(d(c)) };
  };
  if (!h || !aim()) return res(null);
  let n = 0;
  const step = () => {
    const a = aim();
    const q = h.pose();
    if (!a || !q) return res(null);
    const e = wrap(a.want - Math.atan2(q.position.x - q.target.x, q.position.z - q.target.z));
    if ((Math.abs(e) < 0.1 && n > 3) || n++ > 60) return res({ id: a.id, dist: a.dist, err: +e.toFixed(2), steps: n });
    h.orbit(e * 0.4, 0, true);
    requestAnimationFrame(step);
  };
  step();
})`;

const port = 9720 + Math.floor(Math.random() * 30);
const report = { base, tier, runs: [] };

async function playOnce(who, dev, opts = {}) {
  const tierHere = opts.tier ?? tier;
  const name = opts.name ?? `${who}-${dev}`;
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const { send, evaluate, close, logs } = await launch({ port: port + Math.floor(Math.random() * 1000), profile: `/private/tmp/claude-501/wgp-case/play-${name}-${Date.now()}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const run = { who, dev, tier: tierHere, cpu: opts.cpu ?? 1, shots: [], beats: [], errors: [], stats: {}, result: null };
  const shot = async (n) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const file = join(dir, `${n}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    run.shots.push(file);
  };
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", DEVICES[dev]);
    await send("Emulation.setTouchEmulationEnabled", { enabled: DEVICES[dev].mobile });
    if (opts.cpu) await send("Emulation.setCPUThrottlingRate", { rate: opts.cpu });
    // A hero to play: the guest's in the browser's save; the dev player's imported onto the server.
    const save = readFileSync(SAVE, "utf8");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); } catch {}` });
    const t0 = Date.now();
    await send("Page.navigate", { url: `${base}/play/cases` });
    await sleep(6000);
    if (who === "dev") {
      const handle = `case-${dev}-${Date.now() % 100000}`;
      run.signIn = await evaluate(`fetch("/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: "${handle}" }) }).then((r) => r.status)`);
      run.migrate = await evaluate(`fetch("/api/migrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ save: ${save} }) }).then((r) => r.status)`);
      await send("Page.reload");
      await sleep(6000);
    }
    if (!opts.skipPages) {
      await shot("01-case-files");
      await send("Page.navigate", { url: `${base}/play/cases/001` });
      await sleep(5000);
      await shot("02-intro");
    }
    await send("Page.navigate", { url: `${base}/play/patrol?case=001&autopilot=1&debug=1&tier=${tierHere}` });
    const tNight = Date.now();
    // The watcher, once the loop is up.
    let ok = false;
    for (let i = 0; i < 240 && !ok; i++) {
      await sleep(250);
      ok = await evaluate(WATCH).catch(() => false);
    }
    if (!ok) throw new Error("the night never started");
    run.bootMs = Date.now() - tNight;
    const done = new Set();
    let ended = false;
    let results = null;
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline) {
      const aiming = await evaluate(`(() => { const s = window.__caseWatch; return !!s && s.rc === "aim"; })()`).catch(() => false);
      if (aiming && !done.has("flash")) {
        if (await evaluate(AT_FLASH).catch(() => false)) {
          done.add("flash");
          await shot("flash");
        }
      }
      const wants = await evaluate(`(() => { const s = window.__caseWatch; if (!s) return []; const w = s.shots.splice(0); return w; })()`).catch(() => []);
      for (const w of wants) {
        if (done.has(w)) continue;
        done.add(w);
        await shot(w);
        // The copies again from behind: the standee's back (cardboard, never a pale body).
        if (w === "copies" || w === "rescue-copies") {
          const behind = await evaluate(BEHIND_COPY).catch(() => null);
          if (behind) {
            await sleep(250);
            await shot(`${w}-back`);
            run.behind = [...(run.behind ?? []), { shot: w, ...behind }];
          }
          await evaluate(`window.__wgpPlay.handle()?.orbit(0, 0, false)`).catch(() => {});
        }
      }
      const st = await evaluate(`(() => { const s = window.__caseWatch; return s ? s.beats.map((b) => b.name) : []; })()`).catch(() => null);
      if (st && st.includes("night-over") && !ended) ended = true;
      if (ended) {
        // The results: "Case closed", and when signed in the badge queued.
        const text = await evaluate(`document.body.innerText`).catch(() => "");
        if (/case closed/i.test(text) && (who !== "dev" || /queued|minted|badge/i.test(text)) && !/filing|checking/i.test(text.slice(0, 600))) {
          await sleep(1500);
          results = await evaluate(`document.body.innerText`).catch(() => "");
          await shot("99-case-closed");
          break;
        }
        if (Date.now() - (run.endAt ?? (run.endAt = Date.now())) > 45000) {
          results = await evaluate(`document.body.innerText`).catch(() => "");
          await shot("99-results-timeout");
          break;
        }
      }
      await sleep(120);
    }
    const watch = await evaluate(`(() => { const s = window.__caseWatch; return s ? { beats: s.beats, stats: s.stats } : null; })()`).catch(() => null);
    run.beats = watch?.beats ?? run.beats;
    const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
    const max = (xs) => (xs.length ? Math.max(...xs) : null);
    for (const [k, a] of Object.entries(watch?.stats ?? {})) run.stats[k] = { callsMedian: med(a.calls), callsMax: max(a.calls), trisMedian: med(a.tris), fpsMedian: med(a.fps), castMsMedian: med(a.castMs) };
    run.results = (results ?? "").replace(/\s+/g, " ").slice(0, 900);
    run.totalMs = Date.now() - t0;
    run.errors = logs.filter((l) => (l.startsWith("exception") || l.startsWith("error")) && !/Failed to load resource|favicon|React DevTools/.test(l)).slice(0, 20);
  } catch (e) {
    run.failure = String(e);
    await shot("zz-failure").catch(() => {});
  } finally {
    await close();
  }
  console.log(JSON.stringify({ name, bootMs: run.bootMs, totalMs: run.totalMs, beats: run.beats.length, shots: run.shots.length, errors: run.errors.length, failure: run.failure }));
  report.runs.push(run);
}

for (const who of opt("who", "guest,dev").split(",")) {
  for (const dev of opt("devices", "desktop,phone").split(",")) await playOnce(who, dev);
}
if (opt("perf", "") === "low") {
  for (const dev of opt("devices", "desktop,phone").split(",")) await playOnce("guest", dev, { tier: "low", cpu: 4, name: `perf-low-${dev}`, skipPages: true });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, opt("json", "play.json")), JSON.stringify(report, null, 2));
