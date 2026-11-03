/**
 * Ranked-run load test: N players sign in (dev sign-in), make a hero, start a ranked run,
 * play the night with game-core's bot, submit the input log for the server to replay, and
 * read the public replay back to check it reproduces here. Reports latency percentiles and
 * errors for each step.
 *
 * Only against your own server: `next dev` with PGlite and dev sign-in. Never production or
 * a Vercel preview (previews share the production database). Base URLs that aren't this
 * machine are refused.
 *
 *   cd apps/wgp && ALLOW_DEV_AUTH=1 PGLITE_DIR=/tmp/wgp-load pnpm exec next dev -p 3640
 *   cd apps/wgp && pnpm exec tsx ../../scripts/load/ranked.ts --players 50
 *
 * Options:
 *   --base URL         the server (default http://localhost:3640)
 *   --players N        concurrent players (default 50)
 *   --nights K         ranked nights per player, with a sleep between (default 1)
 *   --concurrency C    requests in flight per step (default: every player at once)
 *   --same-ip          send every request from one IP; by default each player gets its own
 *                      x-real-ip, which a server with no proxy in front believes, so the
 *                      per-IP burst limits act as they would for N real players
 *   --timeout MS       per request (default 60000)
 *   --json FILE        also write the summary as JSON
 *   --allow-remote     a dev-mode server on another machine with its own database
 *
 * Each step is one burst: every player's request at once, so the percentiles are that
 * step's latency under N concurrent players. The bot plays between bursts, outside any
 * timing. One warm-up player goes first and isn't counted (next dev compiles each route on
 * its first request).
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { chooseErrand, needsErrand, replayRun, runHash, runLog, startRun, stepRun } from "../../packages/game-core/src/replay";
import type { Save } from "../../packages/game-core/src/rules/types";
import { botFrame, newBotMemory } from "../../packages/game-core/src/sim3d";
import { MAX_TICKS, SIM_HZ } from "../../packages/game-core/src/sim3d/constants";

/* ------------------------------------------------------------------ options */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const int = (name: string, fallback: number, min = 1) => {
  const n = Number(opt(name, String(fallback)));
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer of at least ${min}`);
  return n;
};

const base = opt("base", "http://localhost:3640").replace(/\/$/, "");
const playersWanted = int("players", 50);
const nights = int("nights", 1);
const concurrency = int("concurrency", playersWanted);
const timeoutMs = int("timeout", 60_000);
const sameIp = flag("same-ip");
const jsonOut = args.includes("--json") ? opt("json", "") : "";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const host = new URL(base).hostname;
if (!LOCAL_HOSTS.has(host) && !host.endsWith(".localhost") && !flag("allow-remote")) {
  console.error(`Refusing ${base}: this load test only runs against a server on this machine (see the header).`);
  process.exit(2);
}

/* ------------------------------------------------------------------ players and requests */

interface Played {
  log: Uint8Array;
  hash: string;
  ticks: number;
}

interface Player {
  handle: string;
  ip: string | null;
  cookies: Map<string, string>;
  save: Save | null;
  rev: number;
  run: { runId: string; seed: number; startedAt: number } | null;
  played: Played | null;
  /** Why this player stopped, if it did. */
  dead: string | null;
  verified: number;
  reproduced: number;
}

interface Sample {
  step: string;
  ms: number;
  status: number;
  /** The error code, when the request failed. */
  code?: string;
}

const samples: Sample[] = [];
const tag = randomBytes(4).toString("hex").slice(0, 6);

function newPlayer(name: string, index: number): Player {
  // 10.77.0.0/16: one address per player, never a real client's.
  const ip = sameIp ? null : `10.77.${(index >> 8) & 255}.${index & 255}`;
  return { handle: `load-${tag}-${name}`, ip, cookies: new Map(), save: null, rev: 0, run: null, played: null, dead: null, verified: 0, reproduced: 0 };
}

function keepCookies(p: Player, res: Response) {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value || /max-age=0/i.test(line)) p.cookies.delete(name);
    else p.cookies.set(name, value);
  }
}

/** One request as player `p`, timed from sending to the whole body read. Null on any failure. */
async function call<T>(p: Player, step: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T | null> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (p.cookies.size > 0) headers.cookie = [...p.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  if (p.ip) headers["x-real-ip"] = p.ip;
  const t0 = performance.now();
  let status = 0;
  let code: string | undefined;
  let data: unknown = null;
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = res.status;
    keepCookies(p, res);
    data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data as { error?: string; reason?: string } | null;
      code = `${status} ${e?.error ?? "http"}${e?.reason ? `:${e.reason}` : ""}`;
    }
  } catch (error) {
    code = (error as Error).name === "TimeoutError" ? "timeout" : `network (${(error as Error).message})`;
  }
  samples.push({ step, ms: performance.now() - t0, status, code });
  if (code) {
    p.dead = `${step}: ${code}`;
    return null;
  }
  return data as T;
}

/** Runs `fn` for every live player, at most `limit` at a time. */
async function burst(players: Player[], limit: number, fn: (p: Player) => Promise<void>): Promise<number> {
  const queue = players.filter((p) => !p.dead);
  const t0 = performance.now();
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) await fn(p);
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return performance.now() - t0;
}

/* ------------------------------------------------------------------ the steps */

const STARTERS = ["web-sling", "web-shield", "node-sense"];

async function signIn(p: Player, step = "sign-in") {
  await call(p, step, "POST", "/api/auth/dev", { handle: p.handle });
}

async function makeHero(p: Player, step = "create-hero") {
  const r = await call<{ save: Save; rev: number }>(p, step, "POST", "/api/actions", {
    action: { type: "create-hero", name: `Load ${p.handle.slice(-6)}`, suit: "classic", powers: STARTERS },
    rev: p.rev,
  });
  if (r) {
    p.save = r.save;
    p.rev = r.rev;
  }
}

async function start(p: Player, step = "start") {
  const r = await call<{ runId: string; seed: number; saveRev: number }>(p, step, "POST", "/api/runs/start", {});
  if (!r) return;
  if (r.saveRev !== p.rev) {
    p.dead = `start: the server's save is at rev ${r.saveRev}, this player's at ${p.rev}`;
    return;
  }
  p.run = { runId: r.runId, seed: r.seed, startedAt: Date.now() };
}

/** Plays the night as the browser would: the server's save and seed, the bot's inputs recorded. */
function play(p: Player): void {
  const run = startRun(p.save!, p.run!.seed);
  if (run.error) {
    p.dead = `play: ${run.error}`;
    return;
  }
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < MAX_TICKS) {
    if (needsErrand(run)) chooseErrand(run, 0);
    else stepRun(run, botFrame(run.sim, mem));
  }
  if (run.error) {
    p.dead = `play: ${run.error}`;
    return;
  }
  p.played = { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

async function submit(p: Player, step = "submit") {
  const r = await call<{ status: string; save: Save; rev: number }>(p, step, "POST", `/api/runs/${p.run!.runId}/submit`, {
    log: Buffer.from(p.played!.log).toString("base64"),
    clientHash: p.played!.hash,
  });
  if (!r) return;
  p.save = r.save;
  p.rev = r.rev;
  p.verified += 1;
}

/** Reads the public replay and re-runs it here, as scripts/verify-run.ts does. */
async function replay(p: Player, step = "replay") {
  const r = await call<{ seed: number; startSave: Save; log: string; score: number; ticks: number; hash: string | null }>(
    p,
    step,
    "GET",
    `/api/runs/${p.run!.runId}/replay`,
  );
  if (!r) return;
  const again = replayRun({ save: r.startSave, seed: r.seed, log: new Uint8Array(Buffer.from(r.log, "base64")) });
  if (again.ok && again.score === r.score && again.ticks === r.ticks && (r.hash === null || again.hash === r.hash)) p.reproduced += 1;
  else p.dead = `replay: didn't reproduce (${again.ok ? `score ${again.score} vs ${r.score}` : again.reason})`;
}

async function sleepNight(p: Player, step = "sleep") {
  const r = await call<{ save: Save; rev: number }>(p, step, "POST", "/api/actions", { action: { type: "sleep" }, rev: p.rev });
  if (r) {
    p.save = r.save;
    p.rev = r.rev;
  }
}

/** The server refuses a night whose game time runs more than 60 s ahead of the wall clock. */
function waitForWallClock(players: Player[]): number {
  const ready = players.filter((p) => !p.dead && p.played && p.run);
  const waits = ready.map((p) => p.played!.ticks / SIM_HZ - 60 + 1 - (Date.now() - p.run!.startedAt) / 1000);
  return Math.max(0, ...waits) * 1000;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ report */

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

interface StepSummary {
  step: string;
  requests: number;
  ok: number;
  errors: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  wallMs: number;
  perSecond: number;
}

function summarize(step: string, wallMs: number): StepSummary {
  const mine = samples.filter((s) => s.step === step);
  const ms = mine.map((s) => s.ms).sort((a, b) => a - b);
  const ok = mine.filter((s) => !s.code).length;
  return {
    step,
    requests: mine.length,
    ok,
    errors: mine.length - ok,
    p50: percentile(ms, 0.5),
    p90: percentile(ms, 0.9),
    p95: percentile(ms, 0.95),
    p99: percentile(ms, 0.99),
    max: ms.at(-1) ?? NaN,
    mean: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length),
    wallMs,
    perSecond: mine.length / Math.max(0.001, wallMs / 1000),
  };
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(n >= 100 ? 0 : 1) : "-");

function printTable(rows: StepSummary[]) {
  const head = ["step", "reqs", "ok", "err", "p50 ms", "p90 ms", "p95 ms", "p99 ms", "max ms", "mean ms", "wall s", "req/s"];
  const body = rows.map((r) => [r.step, r.requests, r.ok, r.errors, fmt(r.p50), fmt(r.p90), fmt(r.p95), fmt(r.p99), fmt(r.max), fmt(r.mean), (r.wallMs / 1000).toFixed(2), r.perSecond.toFixed(1)].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  console.log(line(head));
  for (const row of body) console.log(line(row));
}

/* ------------------------------------------------------------------ main */

async function main() {
  console.log(`Load test against ${base}: ${playersWanted} players, ${nights} night(s) each, ${concurrency} in flight, ${sameIp ? "one IP" : "one IP per player"}.`);

  // Warm-up: next dev compiles each route on its first request.
  const warm = newPlayer("warm", 0xffff);
  await signIn(warm, "warm");
  await makeHero(warm, "warm");
  await start(warm, "warm");
  if (!warm.dead) play(warm);
  if (!warm.dead) await pause(waitForWallClock([warm]));
  if (!warm.dead) await submit(warm, "warm");
  if (!warm.dead) await replay(warm, "warm");
  if (warm.dead) {
    console.error(`The warm-up player failed (${warm.dead}). Is the server up with ALLOW_DEV_AUTH=1?`);
    process.exit(1);
  }

  const players = Array.from({ length: playersWanted }, (_, i) => newPlayer(String(i), i));
  const walls = new Map<string, number>();
  const time = async (step: string, fn: (p: Player) => Promise<void>) => walls.set(step, (walls.get(step) ?? 0) + (await burst(players, concurrency, fn)));

  await time("sign-in", (p) => signIn(p));
  await time("create-hero", (p) => makeHero(p));

  let playMs = 0;
  let waitedMs = 0;
  const ticks: number[] = [];
  for (let night = 1; night <= nights; night++) {
    await time("start", (p) => start(p));
    const t0 = performance.now();
    for (const p of players) if (!p.dead) play(p);
    playMs += performance.now() - t0;
    for (const p of players) if (!p.dead && p.played) ticks.push(p.played.ticks);
    const wait = waitForWallClock(players);
    waitedMs += wait;
    await pause(wait);
    await time("submit", (p) => submit(p));
    await time("replay", (p) => replay(p));
    if (night < nights) await time("sleep", (p) => sleepNight(p));
  }

  const steps = ["sign-in", "create-hero", "start", "submit", "replay", ...(nights > 1 ? ["sleep"] : [])];
  const rows = steps.map((s) => summarize(s, walls.get(s) ?? 0));
  console.log("");
  printTable(rows);

  // A player stops at its first failure, so its reason is the whole story for it.
  const errors = new Map<string, number>();
  for (const p of players) if (p.dead) errors.set(p.dead, (errors.get(p.dead) ?? 0) + 1);
  console.log("");
  if (errors.size === 0) console.log("Errors: none");
  else {
    console.log("Errors (players stopped):");
    for (const [what, n] of [...errors].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${what}`);
  }

  const verified = players.reduce((n, p) => n + p.verified, 0);
  const reproduced = players.reduce((n, p) => n + p.reproduced, 0);
  const meanTicks = ticks.reduce((a, b) => a + b, 0) / Math.max(1, ticks.length);
  console.log("");
  console.log(`Runs verified by the server: ${verified} of ${playersWanted * nights}; replays that reproduced here: ${reproduced}.`);
  console.log(`Bot play: ${ticks.length} nights in ${(playMs / 1000).toFixed(1)} s (mean ${(meanTicks / SIM_HZ).toFixed(1)} s of game time); waited ${(waitedMs / 1000).toFixed(1)} s for the wall clock.`);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ base, players: playersWanted, nights, concurrency, sameIp, steps: rows, errors: Object.fromEntries(errors), verified, reproduced }, null, 2));
    console.log(`Wrote ${jsonOut}.`);
  }
  if (verified < playersWanted * nights || reproduced < verified) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
