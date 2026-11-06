/**
 * Compete played end to end over CDP against a running WGP server (`ALLOW_DEV_AUTH=1 next dev`,
 * PGlite, no .env.local), with the bot at the controls (`?autopilot=1`):
 *
 *   cd apps/wgp && pnpm exec tsx ../../launch/brand/hero/compete-play.ts --out <dir> [--base http://127.0.0.1:3930]
 *
 * Racer A (a dev player) runs today's Daily and a ranked night. Racer B then runs the Daily with
 * A's ghost, a time trial, and a duel against A's ranked night through its challenge link. A
 * guest runs a trial on a phone. Proofs, written to <out>/play.json:
 * - each ghost the page built hashed exactly as the server's replay (checkpoints and final hash);
 * - what the scene drew is the ghost run's own hero at the drawn tick: sampled during B's Daily
 *   and compared with an independent replay of A's log here in Node;
 * - the Season and Tonight boards are the same before and after every competitive run.
 * Screenshots at each beat; the console's errors.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildGhost } from "../../../packages/game-core/src/ghost";
import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:3930");
const out = opt("out", "launch/brand/hero/game-shots/compete/run");
const SAVE = readFileSync(opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json"), "utf8");
const stamp = Date.now() % 100000;
mkdirSync(out, { recursive: true });

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };

type Cdp = Awaited<ReturnType<typeof launch>>;
const report: Record<string, unknown> = { base, stamp, errors: {} as Record<string, string[]> };

async function browser(name: string, device = DESKTOP) {
  const c: Cdp = await launch({ port: 9700 + Math.floor(Math.random() * 200), profile: `/private/tmp/claude-501/wgp-compete/${name}-${stamp}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", device);
  await c.send("Emulation.setTouchEmulationEnabled", { enabled: device.mobile });
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(SAVE)}); localStorage.setItem("wgp:sound:v1", "off"); } catch {}` });
  const shot = async (file: string) => {
    const { data } = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, `${name}-${file}.png`), Buffer.from(data, "base64"));
  };
  const go = async (path: string, wait = 5000) => {
    await c.send("Page.navigate", { url: `${base}${path}` });
    await sleep(wait);
  };
  const api = (path: string, init?: object) => c.evaluate(`fetch(${JSON.stringify(path)}, ${JSON.stringify(init ?? {})}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
  const signIn = async (handle: string) => {
    await go("/play", 6000);
    const r = await api("/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }) });
    const m = await api("/api/migrate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ save: JSON.parse(SAVE) }) });
    return { signIn: r.status, migrate: m.status };
  };
  return { ...c, shot, go, api, signIn, name };
}

type B = Awaited<ReturnType<typeof browser>>;

/** Wait for a race's results (or a night's), returning their title. */
async function waitResults(b: B, id: string, timeoutS = 420): Promise<string> {
  for (let i = 0; i < timeoutS * 2; i++) {
    await sleep(500);
    const t = await b.evaluate(`document.getElementById(${JSON.stringify(id)})?.textContent ?? ""`).catch(() => "");
    if (t && !/^Checking/.test(t)) return t;
  }
  throw new Error(`${b.name}: no results (${id}) after ${timeoutS}s`);
}

/** Wait until the night is live (the countdown done). */
async function waitLive(b: B, timeoutS = 120) {
  for (let i = 0; i < timeoutS * 4; i++) {
    await sleep(250);
    const s = await b.evaluate(`window.__wgpPlay?.peek?.().status ?? ""`).catch(() => "");
    if (s === "live") return;
  }
  throw new Error(`${b.name}: never went live`);
}

const errorsOf = (b: B) => b.logs.filter((l: string) => /^(error|exception)/.test(l) && !/Failed to load resource|favicon|DevTools|\[Fast Refresh\]|webpack-hmr|net::ERR/.test(l));

async function main() {
  // ---------------------------------------------------------------- racer A
  const a = await browser("a");
  report.aSignIn = await a.signIn(`racer-a-${stamp}`);
  await a.go("/play/compete", 7000);
  await a.shot("01-hub-empty");
  const seasonBefore = await a.api("/api/leaderboard?board=season");
  await a.go("/play/compete/daily?autopilot=1&debug=1", 1000);
  await waitLive(a);
  await sleep(4000);
  await a.shot("02-daily-solo");
  report.aDaily = await waitResults(a, "race-results-title");
  await sleep(1500);
  await a.shot("03-daily-results");
  const hubA = (await a.api("/api/compete")) as { body: { daily: { best: { runId: string; score: number; ticks: number } } } };
  const aDailyRun = hubA.body.daily.best.runId;
  report.aDailyRun = aDailyRun;
  // A ranked night (Season 1's own), for B's duel.
  await a.go("/play/patrol?autopilot=1&debug=1", 1000);
  report.aNight = await waitResults(a, "results-title", 480);
  await sleep(1500);
  await a.shot("04-night-results-challenge-link");
  const tonight = (await a.api("/api/leaderboard?board=tonight&around=me")) as { body: { me: { runId: string } } };
  const aNightRun = tonight.body.me.runId;
  report.aNightRun = aNightRun;
  const seasonMid = await a.api("/api/leaderboard?board=season");
  const tonightMid = await a.api("/api/leaderboard?board=tonight");
  report.errors = { ...(report.errors as object), a: errorsOf(a) };

  // ---------------------------------------------------------------- racer B
  const b = await browser("b");
  report.bSignIn = await b.signIn(`racer-b-${stamp}`);
  await b.go("/play/compete/daily?autopilot=1&debug=1", 1000);
  await waitLive(b);
  const ghosts = await b.evaluate(`window.__wgpRace?.ghosts ?? null`);
  const ref = (await b.api(`/api/runs/${aDailyRun}/replay`)) as { body: { startSave: unknown; seed: number; log: string; checkpoints: string[]; hash: string } };
  report.bGhosts = ghosts;
  report.ghostHashesMatchServer = Array.isArray(ghosts) && ghosts.length > 0 && JSON.stringify(ghosts[0].checkpoints) === JSON.stringify(ref.body.checkpoints) && ghosts[0].hash === ref.body.hash;
  // An independent replay of A's log, here in Node, to check what the page drew.
  const track = buildGhost({ save: ref.body.startSave, seed: ref.body.seed, log: new Uint8Array(Buffer.from(ref.body.log, "base64")) });
  const samples: { tick: number; drawn: { x: number; y: number; z: number }; ref: { x: number; y: number; z: number }; err: number }[] = [];
  const shots = [3, 9, 20, 40];
  const t0 = Date.now();
  let done = false;
  while (!done && Date.now() - t0 < 420_000) {
    await sleep(1700);
    const d = (await b.evaluate(`window.__wgpRace?.drawn?.() ?? null`).catch(() => null)) as { tick: number; at: { x: number; y: number; z: number }[] } | null;
    if (d && d.at[0] && d.tick > 0 && d.tick <= track.ticks) {
      const i = Math.floor(d.tick);
      const j = Math.min(track.ticks, i + 1);
      const f = d.tick - i;
      const jump = Math.abs(track.x[j] - track.x[i]) + Math.abs(track.z[j] - track.z[i]) > 200;
      const k = jump ? 0 : f;
      const r = { x: track.x[i] + (track.x[j] - track.x[i]) * k, y: track.y[i] + (track.y[j] - track.y[i]) * k, z: track.z[i] + (track.z[j] - track.z[i]) * k };
      const at = d.at[0];
      samples.push({ tick: d.tick, drawn: at, ref: r, err: Math.hypot(at.x - r.x, at.y - r.y, at.z - r.z) });
    }
    const secs = (Date.now() - t0) / 1000;
    while (shots.length && secs >= shots[0]) await b.shot(`05-daily-ghosts-${String(shots.shift()).padStart(2, "0")}s`);
    done = !!(await b.evaluate(`document.getElementById("race-results-title")?.textContent ?? ""`).catch(() => ""));
  }
  report.syncSamples = samples;
  report.syncMaxError = samples.reduce((m, s) => Math.max(m, s.err), 0);
  report.bDaily = await waitResults(b, "race-results-title");
  report.bDailyResultText = await b.evaluate(`document.querySelector('[aria-labelledby="race-results-title"]')?.innerText ?? ""`);
  await sleep(1500);
  await b.shot("06-daily-results-vs-ghost");

  // A time trial: medals.
  await b.go("/play/compete/trial/canyon-swing?autopilot=1&debug=1", 1000);
  await waitLive(b);
  await sleep(2500);
  await b.shot("07-trial-gates");
  report.bTrial = await waitResults(b, "race-results-title", 300);
  report.bTrialText = await b.evaluate(`document.querySelector('[aria-labelledby="race-results-title"]')?.innerText ?? ""`);
  await sleep(1500);
  await b.shot("08-trial-results-medal");

  // A duel through A's challenge link.
  await b.go(`/play/compete/race/${aNightRun}`, 6000);
  report.raceLinkLandedOn = await b.evaluate(`location.pathname`);
  await b.go(`/play/compete/duel/${aNightRun}?autopilot=1&debug=1`, 1000);
  await waitLive(b);
  await sleep(5000);
  await b.shot("09-duel-ghost");
  report.bDuel = await waitResults(b, "race-results-title", 480);
  report.bDuelText = await b.evaluate(`document.querySelector('[aria-labelledby="race-results-title"]')?.innerText ?? ""`);
  await sleep(1500);
  await b.shot("10-duel-results");
  await b.go("/play/compete", 7000);
  await b.shot("11-hub-after");
  report.bHub = (await b.api("/api/compete")).body;
  report.errors = { ...(report.errors as object), b: errorsOf(b) };

  // Season boards untouched by every competitive run.
  const seasonAfter = await a.api("/api/leaderboard?board=season");
  const tonightAfter = await a.api("/api/leaderboard?board=tonight");
  const rows = (v: unknown) => JSON.stringify((v as { body: { rows: unknown[] } }).body.rows);
  report.seasonBefore = (seasonBefore as { body: { rows: unknown[] } }).body.rows;
  report.seasonAfter = (seasonAfter as { body: { rows: unknown[] } }).body.rows;
  report.seasonUnchangedByCompete = rows(seasonMid) === rows(seasonAfter) && rows(tonightMid) === rows(tonightAfter);
  report.dailyBoard = (await a.api("/api/leaderboard?board=daily")).body;
  report.trialBoard = (await a.api("/api/leaderboard?board=trial:canyon-swing")).body;
  await a.close();
  await b.close();

  // ---------------------------------------------------------------- a guest on a phone
  const g = await browser("guest", PHONE);
  await g.go("/play/compete", 7000);
  await g.shot("12-hub-phone");
  await g.go("/play/compete/trial/rooftop-sprint?autopilot=1", 1000);
  await waitLive(g);
  await sleep(2500);
  await g.shot("13-trial-phone");
  report.guestTrial = await waitResults(g, "race-results-title", 300);
  report.guestTrialText = await g.evaluate(`document.querySelector('[aria-labelledby="race-results-title"]')?.innerText ?? ""`);
  await sleep(1200);
  await g.shot("14-trial-results-phone");
  report.errors = { ...(report.errors as object), guest: errorsOf(g) };
  await g.close();

  writeFileSync(join(out, "play.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ghostHashesMatchServer: report.ghostHashesMatchServer, syncMaxError: report.syncMaxError, samples: samples.length, seasonUnchangedByCompete: report.seasonUnchangedByCompete, errors: report.errors }, null, 2));
}

main().catch((e) => {
  writeFileSync(join(out, "play.json"), `${JSON.stringify({ ...report, failed: String(e?.stack ?? e) }, null, 2)}\n`);
  console.error(e);
  process.exit(1);
});
