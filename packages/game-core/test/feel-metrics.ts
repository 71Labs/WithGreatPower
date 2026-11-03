/**
 * Feel metrics: scripted "human" inputs (a stick held toward the next stop, simple web
 * rhythms) and the bot, measured over many nights. Used by feel.test.ts for the ruleset
 * gates, and printed with FEEL_REPORT=1 for before/after numbers.
 *
 * Only the public sim surface is read (the hero, the events, travelBearing), so the same
 * harness measures any ruleset.
 */
import { chooseErrand, needsErrand, startRun, stepRun, type Run } from "../src/replay";
import { reduce } from "../src/rules/engine";
import type { InputFrame } from "../src/sim3d/contract";
import { dirIndex, len2, len3 } from "../src/sim3d/dmath";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { stopTarget } from "../src/sim3d/hero";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { heroSave, STANDARD } from "./helpers";

export type Policy = "holder" | "tapper" | "masher" | "releaser" | "bot";

interface PolicyMem {
  t: number;
  holding: boolean;
  /** Ticks of reaction delay left before the next decision lands. */
  lag: number;
  want: boolean;
  bot: ReturnType<typeof newBotMemory>;
}

const newPolicyMem = (): PolicyMem => ({ t: 0, holding: false, lag: 0, want: false, bot: newBotMemory() });

/** The stick a human would hold: full tilt toward the next stop. */
function towardStop(s: SimState): { dir: number; mag: number } {
  const t = stopTarget(s);
  if (!t) return { dir: 0, mag: 0 };
  const dx = t.x - s.hero.x;
  const dz = t.z - s.hero.z;
  if (len2(dx, dz) < 1) return { dir: 0, mag: 0 };
  return { dir: dirIndex(dx, dz), mag: 3 };
}

/**
 * Every policy holds the stick at full tilt toward the next stop.
 * - holder: holds the web the whole time.
 * - tapper: taps the web (0.1 s) whenever it isn't swinging and is falling or standing, with
 *   a 0.15 s reaction delay (a casual player).
 * - masher: web held 0.5 s, let go 0.25 s, over and over, whatever is happening.
 * - releaser: lets go when rising past the anchor, grabs again when falling or standing,
 *   with a 0.1 s reaction delay (a semi-skilled player).
 * - bot: the sim's own bot.
 */
export function policyFrame(policy: Policy, s: SimState, m: PolicyMem): InputFrame {
  if (policy === "bot") return botFrame(s, m.bot);
  const stick = towardStop(s);
  m.t += 1;
  let web = false;
  if (policy === "holder") web = true;
  else if (policy === "masher") web = m.t % 45 < 30;
  else if (policy === "tapper") {
    const h = s.hero;
    // m.lag counts down the reaction; then a 6-tick press; then wait for the next need.
    if (m.lag > 0) {
      m.lag -= 1;
      if (m.lag === 0) m.want = true;
    } else if (m.want) {
      m.holding = true;
      m.want = false;
      m.t = 0;
    } else if (!h.rope && (h.grounded || h.vy < 0) && !m.holding) m.lag = 9;
    if (m.holding && m.t >= 6) m.holding = false;
    web = m.holding;
  } else {
    const h = s.hero;
    let want = m.want;
    if (h.rope) {
      const past = (h.x - h.rope.x) * h.vx + (h.z - h.rope.z) * h.vz > 0;
      if (h.vy > 80 && past) want = false;
    } else if (h.grounded || h.vy < 0) want = true;
    if (want !== m.want && m.lag === 0) m.lag = 6;
    if (m.lag > 0) {
      m.lag -= 1;
      if (m.lag === 0) m.want = want;
    }
    web = m.want;
  }
  return { dir: stick.mag ? stick.dir : 0, mag: stick.mag, web, shot: 0 };
}

export interface LegStats {
  seconds: number;
  arrived: boolean;
  misses: number;
  releases: number;
  perfect: number;
  good: number;
  attaches: number;
  /** Seconds until 10 webs in a row without a miss, or null. */
  chain10: number | null;
  pickups: number;
}

/** A save on night `night`, its patrol started from `seed`. */
function nightRun(seed: number, night: number): Run {
  const save = heroSave(STANDARD, "Feel Hero", night);
  const run = startRun(save, seed);
  if (run.error) throw new Error(run.error);
  return run;
}

/** The same night with every fight swapped for an errand in its district: four legs of travel, nothing else. */
export function routeRun(seed: number, night: number): Run {
  const started = reduce(heroSave(STANDARD, "Feel Hero", night), { type: "start-patrol", seed });
  const stops = started.patrol!.stops.map((st) => (st.kind === "fight" ? { kind: "errand" as const, ally: "aunt-mainnet" as const, errand: "groceries", district: st.district } : st));
  const run = startRun({ ...started, patrol: { ...started.patrol!, stops } }, seed, { trustPatrol: true });
  if (run.error) throw new Error(run.error);
  return run;
}

/**
 * Travel a whole route (four legs, errands answered at once) with a policy, up to `limit`
 * seconds of play. Legs are timed from the start or the last errand to the next arrival.
 */
export function playRoute(policy: Policy, seed: number, night = 1, limit = 150): LegStats & { legs: number[] } {
  const run = routeRun(seed, night);
  const m = newPolicyMem();
  const out = { seconds: 0, arrived: false, misses: 0, releases: 0, perfect: 0, good: 0, attaches: 0, chain10: null as number | null, pickups: 0, legs: [] as number[] };
  let chain = 0;
  let mark = 0;
  const max = limit * 60;
  while (!run.over && !run.error && run.sim.tick < max) {
    if (needsErrand(run)) {
      chooseErrand(run, 0);
      mark = run.sim.tick;
      continue;
    }
    const events = stepRun(run, policyFrame(policy, run.sim, m));
    for (const e of events) {
      if (e.type === "miss") {
        out.misses += 1;
        chain = 0;
      } else if (e.type === "thwip") {
        out.attaches += 1;
        chain += 1;
        if (chain >= 10 && out.chain10 === null) out.chain10 = run.sim.tick / 60;
      } else if (e.type === "release") {
        out.releases += 1;
        if (e.grade === "perfect") out.perfect += 1;
        else if (e.grade === "good") out.good += 1;
      } else if ((e as { type: string }).type === "pickup") out.pickups += 1;
      else if (e.type === "arrive") out.legs.push((run.sim.tick - mark) / 60);
    }
  }
  out.arrived = run.over;
  out.seconds = run.sim.tick / 60;
  return out;
}

export interface Summary {
  /** Routes played, and how many were finished (all four stops) inside the time limit. */
  routes: number;
  finished: number;
  /** Median seconds a leg, over every leg reached. */
  medianLeg: number | null;
  missesPerMin: number;
  /** Webs shot per street touch. */
  websPerMiss: number;
  perfectRate: number;
  /** Median seconds from the start to 10 webs in a row without a miss (routes that managed it), and how many did. */
  medianChain10: number | null;
  chained: number;
  pickupsPerLeg: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((p, q) => p - q);
  return a[Math.floor(a.length / 2)];
};

export function summarize(routes: (LegStats & { legs: number[] })[]): Summary {
  const seconds = routes.reduce((n, l) => n + l.seconds, 0);
  const misses = routes.reduce((n, l) => n + l.misses, 0);
  const releases = routes.reduce((n, l) => n + l.releases, 0);
  const perfect = routes.reduce((n, l) => n + l.perfect, 0);
  const attaches = routes.reduce((n, l) => n + l.attaches, 0);
  const legs = routes.flatMap((l) => l.legs);
  const chained = routes.filter((l) => l.chain10 !== null);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    routes: routes.length,
    finished: routes.filter((l) => l.arrived).length,
    medianLeg: legs.length ? r2(median(legs)!) : null,
    missesPerMin: r2(seconds > 0 ? (misses / seconds) * 60 : 0),
    websPerMiss: r2(attaches / Math.max(1, misses)),
    perfectRate: r2(releases > 0 ? perfect / releases : 0),
    medianChain10: chained.length ? r2(median(chained.map((l) => l.chain10!))!) : null,
    chained: chained.length,
    pickupsPerLeg: r2(routes.reduce((n, l) => n + l.pickups, 0) / Math.max(1, legs.length)),
  };
}

export const FEEL_SEEDS = Array.from({ length: 24 }, (_, i) => (Math.imul(i + 1, 0x2545f491) >>> 0) || 1);

export function measure(policy: Policy, seeds = FEEL_SEEDS): Summary {
  const routes = seeds.map((seed, i) => playRoute(policy, seed, 1 + (i % 9)));
  if (process.env.FEEL_DEBUG === "1") console.log(policy, routes.map((r, i) => `${i}:${r.arrived ? "ok" : "--"}${r.legs.length}`).join(" "));
  return summarize(routes);
}

export interface LandingStats {
  /** Landings measured. */
  landings: number;
  /** Of those, how many came to a stop (under 5 u/s) within 3 s without leaving the roof. */
  stopped: number;
  /** Median distance and time from touchdown to standing still (stopped landings). */
  medianDistance: number | null;
  medianSeconds: number | null;
  /** How many walked or hopped off the roof, or took off again, within 3 s of touching down with no input. */
  leftRoof: number;
}

/**
 * Clean landings: the releaser swings; after `swings` releases it lets go of everything
 * (stick and web) and falls. If it touches down on a roof, no input at all from then on;
 * measures the slide to a stop. Each seed tries swings = 1, 2, 3… until one lands on a roof.
 */
export function measureLanding(seeds = FEEL_SEEDS): LandingStats {
  const out: LandingStats = { landings: 0, stopped: 0, medianDistance: null, medianSeconds: null, leftRoof: 0 };
  const dists: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < seeds.length; i++) {
    for (let swings = 1; swings <= 6; swings++) {
      const r = landingTry(seeds[i], 1 + (i % 9), swings);
      if (!r) continue;
      if (process.env.FEEL_DEBUG === "1") console.log(`landing seed ${i} swings ${swings}: ${JSON.stringify(r)}`);
      out.landings += 1;
      if (r.left) out.leftRoof += 1;
      else if (r.stopped) {
        out.stopped += 1;
        dists.push(r.distance);
        times.push(r.seconds);
      }
      break;
    }
  }
  out.medianDistance = median(dists);
  out.medianSeconds = median(times);
  return out;
}

function landingTry(seed: number, night: number, swings: number): { left: boolean; stopped: boolean; distance: number; seconds: number } | null {
  {
    const run = nightRun(seed, night);
    const m = newPolicyMem();
    let released = 0;
    let landed: { x: number; z: number; tick: number } | null = null;
    while (!run.over && !run.error && run.sim.tick < 90 * 60) {
      if (needsErrand(run)) return null;
      const s = run.sim;
      const idle: InputFrame = { dir: 0, mag: 0, web: false, shot: 0 };
      const frame = landed || released >= swings ? idle : policyFrame("releaser", s, m);
      const events: SimEvent[] = stepRun(run, frame);
      if (s.mode !== "travel") return null;
      const h = s.hero;
      released += events.filter((e) => e.type === "release").length;
      if (!landed) {
        if (released >= swings && events.some((e) => e.type === "miss")) return null;
        if (released >= swings && events.some((e) => e.type === "land") && h.grounded && !h.rope && h.y > 60) landed = { x: h.x, z: h.z, tick: s.tick };
        continue;
      }
      const dt = (s.tick - landed.tick) / 60;
      if (!h.grounded || h.rope) return { left: true, stopped: false, distance: 0, seconds: dt };
      if (len3(h.vx, h.vy, h.vz) < 5) {
        // Stopped: it must stay put for the rest of the 3 s.
        const at = { x: h.x, z: h.z };
        for (let k = 0; k < 180; k++) stepRun(run, idle);
        if (!h.grounded || len2(h.x - at.x, h.z - at.z) > 1) return { left: true, stopped: false, distance: 0, seconds: dt };
        return { left: false, stopped: true, distance: len2(at.x - landed.x, at.z - landed.z), seconds: dt };
      }
      if (dt > 3) return { left: false, stopped: false, distance: 0, seconds: dt };
    }
    return null;
  }
}

/** The bot over whole nights: misses a minute, perfect rate, seconds a leg, pickups a night. */
export function measureBotNights(nights = 12) {
  let misses = 0;
  let releases = 0;
  let perfect = 0;
  let travel = 0;
  let pickups = 0;
  let rings = 0;
  const legs: number[] = [];
  for (let night = 1; night <= nights; night++) {
    const seed = Math.imul(night, 0x9e3779b1) >>> 0;
    const run = nightRun(seed, night);
    const mem = newBotMemory();
    let mark = 0;
    while (!run.over && !run.error && run.sim.tick < 54_000) {
      if (needsErrand(run)) {
        chooseErrand(run, 0);
        mark = run.sim.tick;
        continue;
      }
      const travelling = run.sim.mode === "travel";
      const events = stepRun(run, botFrame(run.sim, mem));
      if (travelling) travel += 1;
      for (const e of events) {
        if (e.type === "miss" && travelling) misses += 1;
        if (e.type === "release") {
          releases += 1;
          if (e.grade === "perfect") perfect += 1;
        }
        const t = e as { type: string; kind?: string };
        if (t.type === "pickup") {
          if (t.kind === "ring") rings += 1;
          else pickups += 1;
        }
        if (e.type === "arrive") legs.push((run.sim.tick - mark) / 60);
        if (e.type === "stop-done" || e.type === "arrive") mark = run.sim.tick;
      }
    }
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    missesPerMin: r2((misses / Math.max(1, travel)) * 3600),
    perfectRate: r2(releases ? perfect / releases : 0),
    medianLeg: r2(median(legs) ?? 0),
    bitsPerNight: r2(pickups / nights),
    ringsPerNight: r2(rings / nights),
  };
}

/** For quick runs: everything, as one object. */
export function feelReport() {
  return {
    holder: measure("holder"),
    tapper: measure("tapper"),
    masher: measure("masher"),
    releaser: measure("releaser"),
    bot: measure("bot"),
    landing: measureLanding(),
    botNights: measureBotNights(),
  };
}
