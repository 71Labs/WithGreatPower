/** Shared helpers for the 3D sim tests: saves, the bot driving a run, and sanity checks. */
import { chooseErrand, needsErrand, startRun, stepRun, type Run, type RunOptions } from "../src/replay";
import { newSave, reduce } from "../src/rules/engine";
import type { PowerId, Save } from "../src/rules/types";
import type { InputFrame } from "../src/sim3d/contract";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { IDLE_FRAME } from "../src/sim3d/sim";
import type { SimEvent, SimState } from "../src/sim3d/types";

export const STANDARD: PowerId[] = ["web-sling", "web-shield", "wall-crawl", "node-sense"];
export const HEAVY: PowerId[] = ["web-sling", "web-bomb", "validator-slam", "front-run"];
export const SLAMMER: PowerId[] = ["web-shield", "node-sense", "wall-crawl", "yank"];
const STARTERS: PowerId[] = ["web-sling", "web-shield", "node-sense", "wall-crawl", "yank", "finality"];

/** A hero with this loadout (non-starter powers granted, as level-ups would), on this night. */
export function heroSave(loadout: PowerId[], name: string, night = 1): Save {
  const starters = [...new Set([...loadout.filter((p) => STARTERS.includes(p)), ...STARTERS])].slice(0, 3);
  let s = reduce(newSave(), { type: "create-hero", name, suit: "classic", powers: starters });
  const h = s.hero!;
  const powers = { ...h.powers };
  for (const p of loadout) powers[p] = powers[p] ?? { mastery: 0 };
  s = { ...s, night, hero: { ...h, powers, loadout: loadout.slice(0, 4) } };
  return s;
}

/** Every number the scene or the hash reads, finite. */
export function finite(s: SimState): boolean {
  const h = s.hero;
  const nums = [h.x, h.y, h.z, h.vx, h.vy, h.vz, h.fx, h.fz, s.hp, s.fluid];
  if (h.rope) nums.push(h.rope.x, h.rope.y, h.rope.z, h.rope.len);
  const v = s.villain;
  if (v) {
    nums.push(v.x, v.y, v.z, v.vx, v.vy, v.vz, v.cx, v.cy, v.cz);
    for (const b of v.bodies) nums.push(b.x, b.y, b.z);
    for (const a of v.arms) nums.push(a.angle, a.len);
  }
  for (const z of s.hazards) nums.push(z.x, z.y, z.z, z.vx, z.vy, z.vz);
  for (const x of s.shots) nums.push(x.x, x.y, x.z, x.vx, x.vy, x.vz);
  if (s.gwei) nums.push(s.gwei.x, s.gwei.y, s.gwei.z);
  return nums.every(Number.isFinite) && Number.isInteger(s.hp) && Number.isInteger(s.fluid);
}

export interface Played {
  run: Run;
  /** Seconds from each arrival (or the start) to the next arrival or stop end. */
  segments: number[];
  fights: { villain: string; won: boolean; seconds: number }[];
  nanAt: number | null;
}

export interface PlayOptions extends RunOptions {
  /** Stop after this many ticks (the run stays live). */
  maxTicks?: number;
  /** Errand option to pick. */
  errand?: (run: Run) => number;
  /** Stand still once a fight starts (a knockout). */
  idleInFights?: boolean;
  /** Called with each step's events. */
  onEvents?: (events: SimEvent[], run: Run) => void;
}

/** The bot's frame, or standing still in fights when asked. */
export function policyFrame(run: Run, mem: ReturnType<typeof newBotMemory>, idleInFights: boolean): InputFrame {
  const s = run.sim;
  if (idleInFights && (s.mode === "intro" || s.mode === "fight")) return IDLE_FRAME;
  return botFrame(s, mem);
}

/** Play a run with the bot from a save and seed, up to the end of the night (or maxTicks). */
export function playBot(save: Save, seed: number, opts: PlayOptions = {}): Played {
  const run = startRun(save, seed, opts);
  if (run.error) throw new Error(run.error);
  return continueBot(run, opts);
}

/** Keep playing an existing run with a fresh bot. */
export function continueBot(run: Run, opts: PlayOptions = {}, mem = newBotMemory()): Played {
  const out: Played = { run, segments: [], fights: [], nanAt: null };
  const max = opts.maxTicks ?? 54_000;
  let mark = run.sim.tick;
  while (!run.over && !run.error && run.sim.tick < max) {
    if (needsErrand(run)) {
      chooseErrand(run, opts.errand ? opts.errand(run) : 0);
      out.segments.push((run.sim.tick - mark) / 60);
      mark = run.sim.tick;
      continue;
    }
    const events = stepRun(run, policyFrame(run, mem, !!opts.idleInFights));
    if (out.nanAt === null && !finite(run.sim)) out.nanAt = run.sim.tick;
    for (const e of events) {
      if (e.type === "arrive") {
        out.segments.push((run.sim.tick - mark) / 60);
        mark = run.sim.tick;
      }
      if (e.type === "fight-won" || e.type === "ko") {
        out.fights.push({ villain: e.villain, won: e.type === "fight-won", seconds: (run.sim.tick - mark) / 60 });
        mark = run.sim.tick;
      }
    }
    opts.onEvents?.(events, run);
  }
  return out;
}
