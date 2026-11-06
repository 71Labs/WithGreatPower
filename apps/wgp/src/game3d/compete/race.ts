/**
 * A race against ghosts, outside React: the ghosts (verified runs replayed into tracks,
 * game-core ghost.ts), the live gap to the one you're chasing, and the splits at each stop or
 * gate. The overlay feeds it the run every frame and the loop's events; the HUD reads a small
 * snapshot through useSyncExternalStore, published a few times a second and at every split.
 *
 * Loading: each ghost's replay (GET /api/runs/:id/replay) is replayed here through game-core,
 * the same driver the server verified it with, and kept only if its checkpoint hashes and final
 * hash are the server's: a ghost is exactly the verified run, or it isn't shown.
 */
import { buildGhost, ProgressMeter, type GhostTrack } from "@wgp/game-core/ghost";
import type { Run } from "@wgp/game-core/replay";
import type { TrialCourseId } from "@wgp/game-core/types";

import { getReplay, logBytes, type GhostEntry } from "@/lib/compete/api";

/** Ghost colours (display RGB), by role: first, second, third, your best, a chosen rival. */
export const GHOST_COLORS = {
  first: "#ffd95a",
  second: "#dfe4ec",
  third: "#f0a868",
  you: "#7fe3ff",
  rival: "#ff9ab0",
} as const;

export type GhostRole = keyof typeof GHOST_COLORS;

export interface RaceGhost {
  runId: string;
  /** "#1", "You", or the rival's handle. */
  label: string;
  handle: string;
  heroName: string | null;
  rank: number | null;
  score: number;
  ticks: number;
  finished: boolean;
  mine: boolean;
  role: GhostRole;
  css: string;
  rgb: [number, number, number];
  track: GhostTrack;
  /** Its replay here hashed exactly as the server's did, at every checkpoint and at the end. */
  synced: boolean;
}

const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

function roleOf(e: GhostEntry): GhostRole {
  if (e.mine) return "you";
  if (e.rank === 1) return "first";
  if (e.rank === 2) return "second";
  if (e.rank === 3) return "third";
  return "rival";
}

/** Wait a frame, so building several ghosts never freezes the page for long. */
const yieldFrame = () => new Promise<void>((resolve) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0)));

/**
 * Fetch and replay each ghost. `trial`: the course, for a trial's ghosts (their logs are the
 * course's); the Daily's and a duel's are patrol nights. Ghosts that fail to load or to match
 * the server are left out.
 */
export async function loadGhosts(entries: GhostEntry[], trial: TrialCourseId | null, signal?: AbortSignal): Promise<RaceGhost[]> {
  const out: RaceGhost[] = [];
  for (const e of entries) {
    const res = await getReplay(e.runId, signal).catch(() => null);
    if (!res?.ok) continue;
    const r = res.data;
    await yieldFrame();
    const track = buildGhost({ save: r.startSave, seed: r.seed, log: logBytes(r.log) }, trial ? { trial } : {});
    if (!track.ok) continue;
    const synced = track.hash === r.hash && track.checkpoints.length === r.checkpoints.length && track.checkpoints.every((c, i) => c === r.checkpoints[i]);
    if (!synced) continue;
    const role = roleOf(e);
    out.push({
      runId: e.runId,
      label: e.label,
      handle: e.handle,
      heroName: e.heroName,
      rank: e.rank,
      score: e.score,
      ticks: e.ticks,
      finished: track.finished,
      mine: e.mine,
      role,
      css: GHOST_COLORS[role],
      rgb: rgbOf(GHOST_COLORS[role]),
      track,
      synced,
    });
  }
  return out;
}

export interface Split {
  /** 0-based stop or gate. */
  index: number;
  /** Your tick there. */
  tick: number;
  /** Against the ghost you chase: your tick − theirs (positive: behind), or null if they never got there. */
  gap: number | null;
}

export interface RaceSnapshot {
  /** The ghost you chase (first among the others, else your own best), or null racing alone. */
  target: { label: string; handle: string; css: string } | null;
  /** The live gap to it, ticks (positive: behind), or null. */
  gap: number | null;
  splits: Split[];
  /** The newest split, to flash. */
  last: Split | null;
  /** Splits on the course (stops, or gates). */
  of: number;
}

/** The live race: gap and splits against the target ghost. */
export class Race {
  readonly target: RaceGhost | null;
  /** What the scene drew last frame: the (fractional) tick and each ghost's feet, for headless checks. */
  drawn: { tick: number; at: { x: number; y: number; z: number; fade: number }[] } | null = null;
  private readonly meter = new ProgressMeter();
  private snap: RaceSnapshot;
  private readonly listeners = new Set<() => void>();
  private lastPublish = 0;

  constructor(
    readonly ghosts: RaceGhost[],
    readonly kind: "daily" | "trial" | "duel",
    of: number,
  ) {
    this.target = ghosts.find((g) => !g.mine) ?? ghosts[0] ?? null;
    this.snap = { target: this.target ? { label: this.target.label, handle: this.target.handle, css: this.target.css } : null, gap: null, splits: [], last: null, of };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  private publish(force = false) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now - this.lastPublish < 150) return;
    this.lastPublish = now;
    for (const fn of this.listeners) fn();
  }

  /** After the run's latest tick (every frame): the live gap. */
  update(run: Run): void {
    const s = run.sim;
    if (!s) return;
    this.meter.update(s);
    const gap = this.target ? this.meter.gap(this.target.track, s.tick) : null;
    if (gap !== this.snap.gap) {
      this.snap = { ...this.snap, gap };
      this.publish();
    }
  }

  /** A stop reached (a patrol's `arrive`) or a gate passed (a trial's `trial-gate`), at `tick`. */
  split(index: number, tick: number): void {
    const theirs = this.target?.track.splits[index];
    const sp: Split = { index, tick, gap: theirs === undefined ? null : tick - theirs };
    this.snap = { ...this.snap, splits: [...this.snap.splits.filter((x) => x.index !== index), sp], last: sp };
    this.publish(true);
  }
}
