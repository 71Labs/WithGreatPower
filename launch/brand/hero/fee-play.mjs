/**
 * Case file 003, "Fee Strike", played end to end over CDP against a running WGP server
 * (`ALLOW_DEV_AUTH=1 next dev`, PGlite, no .env.local):
 *
 *   node launch/brand/hero/fee-play.mjs --out <dir> [--base http://127.0.0.1:3950]
 *        [--who guest,dev] [--devices desktop,phone] [--tier high] [--lose desktop] [--perf low]
 *
 * Per player and device: /play/cases, the intro (/play/cases/003), then
 * /play/patrol?case=003&autopilot=1 with the bot playing. Shots at every beat (the
 * investigation, each clue as the hero closes on it and once found, the meter with Gas Goblin
 * perched on it, the grab, the chase a few times over, a checkpoint, the bakery, the fight, the
 * cooling with a fee spike's wind-up, the fees cooled, "Case closed"), the beats' times, the
 * scene's draw calls per phase, the chase's feel (the gap to him: median, p90 and max; the
 * escape meter's peak; losses) and the console's errors. `--lose <device>` has the player stop
 * dead a few seconds into the chase on that device's guest run, until he's lost (real input:
 * the log replays the same), to show "Lost him!" and the checkpoint. Writes
 * <out>/<who>-<device>/*.png and <out>/play.json. `--perf low` plays one more night per device at
 * the low tier with the CPU ×4.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3950");
const out = opt("out", "launch/brand/hero/game-shots/case-003/play");
const tier = opt("tier", "high");
const loseOn = opt("lose", "desktop");
const scratch = opt("scratch", "/tmp/-Users-eromonseleodigie-near-hackathon/b2fd1703-a9a8-45a5-a57b-1b5946998e1c/scratchpad");
const SAVE = opt("save", "launch/brand/hero/fixtures/hero-save.json");
const DEVICES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
};

/** In the page: watch the night, record its beats, stats and the chase's feel, and ask for shots at each beat. */
const watch = (lose) => `(() => {
  const w = window;
  if (w.__feeWatch) return true;
  const p = w.__wgpPlay;
  if (!p || !p.loop) return false;
  const t0 = performance.now();
  const st = { beats: [], shots: [], stats: {}, last: {}, gaps: [], escapeMax: 0, losses: 0, chaseShots: 0, lose: ${lose ? "true" : "false"} };
  w.__feeWatch = st;
  const now = () => Math.round(performance.now() - t0);
  const beat = (name, extra) => st.beats.push({ name, at: now(), ...(extra || {}) });
  const want = (name) => st.shots.push(name);
  p.loop.bus.on((ev) => {
    switch (ev.type) {
      case "fee-clue": beat("fee-clue", { id: ev.id, found: ev.found }); st.clueAt = performance.now(); st.clueName = "clue-" + ev.found + "-" + ev.id + "-found"; break;
      case "meter-grab": beat("meter-grab"); want("grab"); st.grabAt = performance.now(); break;
      case "chase-checkpoint": beat("chase-checkpoint", { index: ev.index }); if (!st.last.cpShot) { st.last.cpShot = true; want("checkpoint"); } break;
      case "chase-lost":
        beat("chase-lost", { losses: ev.losses }); st.losses = ev.losses; want("lost");
        if (st.held) { p.loop.source = st.held; st.held = null; }
        break;
      case "chase-escaped": beat("chase-escaped"); break;
      case "chase-end": beat("chase-end"); want("chase-end"); break;
      case "loaf": beat("loaf", { gained: ev.gained }); break;
      case "encounter": beat("encounter"); want("bakery-encounter"); break;
      case "fight-live": beat("fight-live"); st.fightAt = performance.now(); break;
      case "fight-won": beat("fight-won"); want("webbed"); break;
      case "fee-spike": beat("fee-spike", { hit: ev.hit }); break;
      case "fees-cooled": beat("fees-cooled"); want("fees-cooled"); break;
      case "case-closed": beat("case-closed", { ticks: ev.ticks }); break;
      case "ko": beat("ko"); break;
      case "night-over": beat("night-over"); break;
      case "status": beat("status-" + ev.status); break;
    }
  });
  const tick = () => {
    const f = p.loop.view;
    const fe = f && f.fee;
    const s = w.__wgpScene;
    if (fe) {
      if (st.last.phase !== fe.phase) { beat("phase-" + fe.phase); st.last.phase = fe.phase; }
      const key = fe.phase + (f.mode === "fight" || f.mode === "intro" ? "-fight" : "");
      if (s) {
        const a = (st.stats[key] = st.stats[key] || { n: 0, calls: [], tris: [], fps: [] });
        a.n++;
        if (a.n % 6 === 0) { a.calls.push(s.calls); a.tris.push(s.triangles); a.fps.push(s.fps); }
      }
      const hp = f.hero.pos;
      if (fe.phase === "investigate" && !st.last.investShot) { st.last.investShot = true; st.investWait = performance.now(); }
      if (st.investWait && performance.now() - st.investWait > 2500) { st.investWait = 0; want("investigate"); }
      for (const c of fe.clues || []) {
        if (c.found || st.last["near-" + c.id]) continue;
        if (Math.hypot(hp.x - c.pos.x, hp.z - c.pos.z) < 520) { st.last["near-" + c.id] = true; want("approach-" + c.id); }
      }
      if (st.clueAt && performance.now() - st.clueAt > 350) { st.clueAt = 0; want(st.clueName); }
      if (fe.phase === "meter" && !st.last.perch && Math.hypot(hp.x - fe.meter.pos.x, hp.z - fe.meter.pos.z) < 1100) { st.last.perch = true; want("meter-perch"); }
      if (fe.chase) {
        st.gaps.push(fe.chase.gap);
        if (fe.chase.escape > st.escapeMax) st.escapeMax = fe.chase.escape;
        if (fe.chase.escape > 0.45 && !st.last.awayShot) { st.last.awayShot = true; want("getting-away"); }
        const since = st.grabAt ? performance.now() - st.grabAt : 0;
        if (since > 4500 + st.chaseShots * 6000 && st.chaseShots < 3) { st.chaseShots++; want("chase-" + st.chaseShots); }
        // Stop dead a few seconds in until he's lost (once), to show the loss and the checkpoint.
        if (st.lose && !st.lostOnce && since > 6000) { st.lostOnce = true; st.held = p.loop.source; p.loop.source = () => ({ dir: 0, mag: 0, web: false, shot: 0 }); beat("player-stops"); }
      }
      if (st.fightAt && !st.last.fightShot && performance.now() - st.fightAt > 6000) { st.last.fightShot = true; want("fight"); }
      if (fe.phase === "cool") {
        if (!st.last.coolShot) { st.last.coolShot = true; st.coolWait = performance.now(); }
        if (st.coolWait && performance.now() - st.coolWait > 700) { st.coolWait = 0; want("cool-start"); }
        if (fe.meter.spike > 0.45 && !st.last.spikeShot) { st.last.spikeShot = true; want("cool-spike"); }
        if (fe.meter.heat < 0.5 && !st.last.halfShot) { st.last.halfShot = true; want("cool-half"); }
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
  return true;
})()`;

const report = { base, tier, runs: [] };

async function playOnce(who, dev, opts = {}) {
  const tierHere = opts.tier ?? tier;
  const name = opts.name ?? `${who}-${dev}`;
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const profile = join(scratch, `chrome-fee-${name}-${Date.now()}`);
  const { send, evaluate, close, logs } = await launch({ port: 9760 + Math.floor(Math.random() * 1000), profile, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const run = { who, dev, tier: tierHere, cpu: opts.cpu ?? 1, shots: [], beats: [], errors: [], stats: {}, chase: null, result: null };
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
    const save = readFileSync(SAVE, "utf8");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); } catch {}` });
    const t0 = Date.now();
    await send("Page.navigate", { url: `${base}/play/cases` });
    await sleep(7000);
    if (who === "dev") {
      const handle = `fee-${dev}-${Date.now() % 100000}`;
      run.signIn = await evaluate(`fetch("/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: "${handle}" }) }).then((r) => r.status)`);
      run.migrate = await evaluate(`fetch("/api/migrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ save: ${save} }) }).then((r) => r.status)`);
      await send("Page.reload");
      await sleep(7000);
    }
    if (!opts.skipPages) {
      await shot("01-case-files");
      await send("Page.navigate", { url: `${base}/play/cases/003` });
      await sleep(5000);
      await shot("02-intro");
    }
    await send("Page.navigate", { url: `${base}/play/patrol?case=003&autopilot=1&debug=1&tier=${tierHere}` });
    const tNight = Date.now();
    const lose = !opts.skipLose && who === "guest" && loseOn.split(",").includes(dev);
    let ok = false;
    for (let i = 0; i < 240 && !ok; i++) {
      await sleep(250);
      ok = await evaluate(watch(lose)).catch(() => false);
    }
    if (!ok) throw new Error("the night never started");
    run.bootMs = Date.now() - tNight;
    const done = new Set();
    let ended = false;
    let results = null;
    const deadline = Date.now() + 7 * 60 * 1000;
    while (Date.now() < deadline) {
      const wants = await evaluate(`(() => { const s = window.__feeWatch; return s ? s.shots.splice(0) : []; })()`).catch(() => []);
      for (const w of wants) {
        if (done.has(w)) continue;
        done.add(w);
        await shot(w);
      }
      const names = await evaluate(`(() => { const s = window.__feeWatch; return s ? s.beats.map((b) => b.name) : []; })()`).catch(() => null);
      if (names && names.includes("night-over") && !ended) ended = true;
      if (ended) {
        const text = await evaluate(`document.body.innerText`).catch(() => "");
        if (/case closed|still open/i.test(text) && (who !== "dev" || /queued|minted|badge/i.test(text)) && !/filing|checking/i.test(text.slice(0, 600))) {
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
    const w = await evaluate(`(() => { const s = window.__feeWatch; return s ? { beats: s.beats, stats: s.stats, gaps: s.gaps, escapeMax: s.escapeMax, losses: s.losses } : null; })()`).catch(() => null);
    run.beats = w?.beats ?? run.beats;
    const pct = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);
    for (const [k, a] of Object.entries(w?.stats ?? {})) run.stats[k] = { callsMedian: pct(a.calls, 0.5), callsMax: a.calls.length ? Math.max(...a.calls) : null, trisMedian: pct(a.tris, 0.5), fpsMedian: pct(a.fps, 0.5) };
    const gaps = w?.gaps ?? [];
    const at = (n) => run.beats.find((b) => b.name === n)?.at ?? null;
    run.chase = {
      seconds: at("chase-end") !== null && at("meter-grab") !== null ? Math.round((at("chase-end") - at("meter-grab")) / 100) / 10 : null,
      gapMedian: pct(gaps, 0.5),
      gapP90: pct(gaps, 0.9),
      gapMax: gaps.length ? Math.max(...gaps) : null,
      escapeMax: w?.escapeMax ?? null,
      losses: w?.losses ?? 0,
      checkpoints: run.beats.filter((b) => b.name === "chase-checkpoint").length,
    };
    run.results = (results ?? "").replace(/\s+/g, " ").slice(0, 1200);
    run.totalMs = Date.now() - t0;
    run.errors = logs.filter((l) => (l.startsWith("exception") || l.startsWith("error")) && !/Failed to load resource|favicon|React DevTools/.test(l)).slice(0, 20);
  } catch (e) {
    run.failure = String(e);
    await shot("zz-failure").catch(() => {});
  } finally {
    await close();
  }
  console.log(JSON.stringify({ name, bootMs: run.bootMs, totalMs: run.totalMs, beats: run.beats.length, shots: run.shots.length, errors: run.errors.length, chase: run.chase, failure: run.failure }));
  report.runs.push(run);
  // Each run on its own as it lands, so a stopped batch keeps what it played.
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(run, null, 2));
}

for (const who of opt("who", "guest,dev").split(",")) {
  for (const dev of opt("devices", "desktop,phone").split(",")) await playOnce(who, dev);
}
if (opt("perf", "") === "low") {
  for (const dev of opt("devices", "desktop,phone").split(",")) await playOnce("guest", dev, { tier: "low", cpu: 4, name: `perf-low-${dev}`, skipPages: true, skipLose: true });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, opt("json", "play.json")), JSON.stringify(report, null, 2));
