/**
 * The 3D night's loop. It owns one game-core Run outside React.
 *
 * - advance(seconds) is called once per animation frame (a useFrame(-1) driver, so it runs
 *   before the scene reads the frame). It steps the run at a fixed 60 Hz through
 *   stepRun, at most MAX_STEPS a frame: a slow device or a backgrounded tab slows the game
 *   down rather than fast-forwarding it (the server refuses game time ahead of the wall).
 * - Each tick takes one InputFrame from `source` (the input latch, or the autopilot bot).
 * - It keeps the last two ticks' RenderFrame3Ds and writes `view`, the blend the scene
 *   draws, in place. Nothing per frame goes through React.
 * - Sim events go out on a synchronous bus (scene effects, audio, the page) and the HUD
 *   snapshot to an external store about 10 times a second, at once on anything urgent.
 * - Errands pause the sim (game-core consumes no ticks while one is open); the page
 *   answers with chooseErrand().
 * - Lifecycle: loading → intro (3, 2, 1) → live ⇄ paused → outro → done.
 */
import { chooseErrand, needsErrand, runActive, stepRun, type Run } from "@wgp/game-core/replay";
import { DT, fillRenderFrame, newRenderFrame, type SimEvent } from "@wgp/game-core/sim3d";
import type { InputFrame, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { EventBus, HudStore, type LoopStatus } from "@/sim/loop";

import { blendFrame, copyFrame, teleported } from "./blend";
import { hudSnapshot, LegTracker, routeProgress } from "./hud";

export type { LoopStatus };

export type LoopEvent3D =
  | SimEvent
  | { type: "countdown"; value: number }
  | { type: "go" }
  | { type: "status"; status: LoopStatus }
  /** The hero jumped further than a tick allows (stood beside an errand ally): cut the camera. */
  | { type: "teleport" };

/** At most this many ticks per animation frame (a 12 fps frame still runs in real time). */
export const MAX_STEPS = 5;
/**
 * Hit-stop (ruleset 4): the world holds still a beat on impact, seconds: a blow that lands, the
 * one that wins the fight, and getting hurt. The sim just waits (its log is per tick, so a
 * replay never sees it); game time falls a little behind the wall, never ahead.
 */
export const HIT_STOP = { hit: 0.06, last: 0.15, hurt: 0.045 };
/** A frame longer than this (a stall, a resumed tab) counts as this long. */
const MAX_FRAME_SECONDS = 0.25;
const HUD_INTERVAL_MS = 100;
export const INTRO_SECONDS = 2.4;
/** After the night ends, a beat before the results. */
export const OUTRO_SECONDS = 1.4;

const URGENT: ReadonlySet<LoopEvent3D["type"]> = new Set([
  "arrive",
  "encounter",
  "fight-live",
  "villain-hit",
  "hero-hurt",
  "ability",
  "denied",
  "fight-won",
  "ko",
  "errand",
  "stop-done",
  "night-over",
  "miss",
  "gwei",
  "countdown",
  "go",
  "status",
]);

export interface LoopOptions {
  introSeconds?: number;
  outroSeconds?: number;
  /** Publish into an existing store (the HUD may subscribe before the loop exists). */
  hud?: HudStore;
  /** Wall clock for HUD throttling, ms (tests pass a fake). */
  now?: () => number;
  /** Hold still on impact (HIT_STOP); on unless false. */
  hitStop?: boolean;
}

/** How long a tick's events hold the world still (HIT_STOP), or 0. */
export function impact(events: readonly SimEvent[]): number {
  let hold = 0;
  for (const e of events) {
    if (e.type === "villain-hit") hold = Math.max(hold, e.hits === 0 ? HIT_STOP.last : HIT_STOP.hit);
    else if (e.type === "hero-hurt") hold = Math.max(hold, HIT_STOP.hurt);
  }
  return hold;
}

export class RunLoop {
  readonly hud: HudStore;
  readonly bus = new EventBus<LoopEvent3D>();
  /** What the scene draws: the blend of the last two ticks. Mutated in place. */
  readonly view: RenderFrame3D;
  status: LoopStatus = "loading";
  /** One input per tick: the latch, or the autopilot (setSource). */
  private source: (run: Run) => InputFrame = () => ({ dir: 0, mag: 0, web: false, shot: 0 });

  private prev: RenderFrame3D;
  private curr: RenderFrame3D;
  private acc = 0;
  private resumeTo: LoopStatus = "live";
  private readonly introTotal: number;
  private introLeft: number;
  private outroLeft: number;
  private lastCount = -1;
  private lastHudAt = -Infinity;
  private hudDirty = true;
  private hinted = false;
  private disposed = false;
  private readonly leg = new LegTracker();
  private readonly now: () => number;
  private readonly hitStop: boolean;
  /** Seconds of hit-stop left. */
  private hold = 0;

  constructor(
    readonly run: Run,
    opts: LoopOptions = {},
  ) {
    this.hud = opts.hud ?? new HudStore();
    this.introTotal = opts.introSeconds ?? INTRO_SECONDS;
    this.introLeft = this.introTotal;
    this.outroLeft = opts.outroSeconds ?? OUTRO_SECONDS;
    this.now = opts.now ?? (() => performance.now());
    this.hitStop = opts.hitStop !== false;
    this.curr = fillRenderFrame(run.sim, newRenderFrame());
    this.prev = copyFrame(this.curr, newRenderFrame());
    this.view = copyFrame(this.curr, newRenderFrame());
    // A resumed run may already have played the first web.
    this.hinted = run.sim.tick > 0;
  }

  /** Where each tick's input comes from. Called exactly once per tick stepped. */
  setSource(source: (run: Run) => InputFrame): void {
    this.source = source;
  }

  /** Begin: the countdown (a resumed run too, to get your thumbs ready), or straight to the errand a resumed run stopped at. */
  start(): void {
    if (this.status !== "loading") return;
    if (this.run.over || this.run.error) {
      this.setStatus("outro");
      return;
    }
    if (needsErrand(this.run)) {
      this.setStatus("live");
      this.bus.emit({ type: "errand", index: this.run.sim.index });
      return;
    }
    this.setStatus("intro");
    this.lastCount = 3;
    this.bus.emit({ type: "countdown", value: 3 });
  }

  setPaused(paused: boolean): void {
    if (paused && (this.status === "live" || this.status === "intro" || this.status === "outro")) {
      this.resumeTo = this.status;
      this.acc = 0;
      this.setStatus("paused");
    } else if (!paused && this.status === "paused") {
      this.setStatus(this.resumeTo);
    }
  }

  /** Answer the open errand with choice `value`. False if no errand is open or the choice doesn't fit. */
  chooseErrand(value: number): boolean {
    if (!needsErrand(this.run)) return false;
    const events = chooseErrand(this.run, value);
    if (!events) {
      this.checkOver();
      return false;
    }
    fillRenderFrame(this.run.sim, this.curr);
    copyFrame(this.curr, this.prev);
    this.emit(events);
    this.checkOver();
    this.hudDirty = true;
    return true;
  }

  /** Whether the run waits on an errand choice. */
  get errandOpen(): boolean {
    return needsErrand(this.run);
  }

  /** Real seconds since the last call. */
  advance(seconds: number): void {
    if (this.disposed) return;
    const real = Math.min(MAX_FRAME_SECONDS, Math.max(0, seconds));
    if (this.status === "intro") this.tickIntro(real);
    else if (this.status === "live") this.tickLive(real);
    else if (this.status === "outro") {
      this.outroLeft -= real;
      if (this.outroLeft <= 0) this.setStatus("done");
    }
    const live = this.status === "live" && runActive(this.run);
    blendFrame(this.prev, this.curr, live ? this.acc / DT : 1, this.view);
    this.publish();
  }

  /** Publish the HUD now (after a pause, a choice, a resize). */
  markDirty(): void {
    this.hudDirty = true;
  }

  dispose(): void {
    this.disposed = true;
  }

  private setStatus(status: LoopStatus) {
    if (this.status === status) return;
    this.status = status;
    this.hudDirty = true;
    this.bus.emit({ type: "status", status });
  }

  private tickIntro(dt: number) {
    this.introLeft -= dt;
    if (this.introLeft > 0) {
      const value = Math.ceil(this.introLeft / (this.introTotal / 3));
      if (value !== this.lastCount) {
        this.lastCount = value;
        this.bus.emit({ type: "countdown", value });
        this.hudDirty = true;
      }
      return;
    }
    this.setStatus("live");
    this.bus.emit({ type: "go" });
  }

  private tickLive(dt: number) {
    if (this.hold > 0) {
      // Hit-stop: the world waits; what's left of this frame after it runs on.
      this.hold -= dt;
      if (this.hold > 0) return;
      dt = -this.hold;
      this.hold = 0;
    }
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS) {
      if (!runActive(this.run)) {
        this.acc = 0;
        break;
      }
      this.acc -= DT;
      steps += 1;
      const swap = this.prev;
      this.prev = this.curr;
      this.curr = swap;
      const events = stepRun(this.run, this.source(this.run));
      fillRenderFrame(this.run.sim, this.curr);
      if (teleported(this.prev, this.curr)) this.bus.emit({ type: "teleport" });
      this.emit(events);
      if (this.checkOver()) return;
      const stop = this.hitStop ? impact(events) : 0;
      if (stop > 0) {
        // Hold on the impact tick itself (the blend all the way to it), dropping the rest of the
        // backlog; the next tick runs as soon as the hold is over.
        this.hold = stop;
        this.acc = DT * 0.999;
        break;
      }
    }
    // Too far behind: drop the backlog instead of fast-forwarding.
    if (this.acc >= DT) this.acc = DT * 0.999;
  }

  /** The run ended (the route, a knockout, or a refused action): play the outro. */
  private checkOver(): boolean {
    if (!this.run.over && !this.run.error) return false;
    this.acc = 0;
    this.setStatus("outro");
    return true;
  }

  private emit(events: SimEvent[]) {
    for (const ev of events) {
      if (ev.type === "thwip") this.hinted = true;
      if (URGENT.has(ev.type)) this.hudDirty = true;
      this.bus.emit(ev);
    }
  }

  private publish() {
    const now = this.now();
    if (!this.hudDirty && now - this.lastHudAt < HUD_INTERVAL_MS) return;
    this.hudDirty = false;
    this.lastHudAt = now;
    this.hud.set(this.snapshot());
  }

  snapshot() {
    const s = this.run.sim;
    return hudSnapshot(s, {
      status: this.status,
      countdown: this.status === "intro" ? Math.max(1, this.lastCount) : null,
      hinted: this.hinted,
      progress: routeProgress(s, this.leg),
    });
  }
}
