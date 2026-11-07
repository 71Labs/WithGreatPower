/**
 * Free roam's loop: the fixed-step driver around game-core's roam run, outside React, shaped
 * like the night's RunLoop so the same scene reads it (`view`, `cue`, `bus`).
 *
 * - advance(seconds) once per animation frame steps the outing at 60 Hz (at most MAX_STEPS a
 *   frame; a slow tab slows the city rather than fast-forwarding it), one InputFrame a tick.
 * - `view` is the blend of the last two ticks, the night's fields (blend.ts) plus the outing's
 *   (RenderFrame3D.roam: the latest tick's, the bot and the cars sliding between ticks).
 * - Events go out on a synchronous bus; the HUD snapshot to its store about 10 times a second
 *   and at once on anything that changes what it says.
 * - No countdown and no end: loading → live ⇄ paused. replace() swaps in the next outing.
 */
import { lineText } from "@wgp/game-core/city";
import { roamActive, stepRoamRun, type RoamRun, type RoamRunEvent } from "@wgp/game-core/roam";
import { DT, fillRenderFrame, newRenderFrame } from "@wgp/game-core/sim3d";
import { fillRoamFrame, TASK_DONE, TASK_IDS } from "@wgp/game-core/sim3d/roam";
import type { InputFrame, RenderFrame3D, RoamCarFrame, RoamFrame, RoamMoveName } from "@wgp/game-core/sim3d/contract";

import { EventBus } from "@/sim/loop";
import type { SceneCue } from "@/game3d/scene/camera/director";

import { blendFrame, copyFrame, teleported } from "./blend";

export type RoamStatus = "loading" | "live" | "paused";

export type RoamLoopEvent = RoamRunEvent | { type: "status"; status: RoamStatus } | { type: "teleport" };

export const MAX_STEPS = 5;
const MAX_FRAME_SECONDS = 0.25;
const HUD_INTERVAL_MS = 100;

/** What the City HUD shows (published about 10 times a second). */
export interface RoamHud {
  status: RoamStatus;
  move: RoamMoveName;
  sprint: boolean;
  /** What E would do: talk to someone, photograph a tag, sync a viewpoint. */
  act: { kind: "talk" | "photo" | "sync"; index: number } | null;
  /** The line on screen: who said it and what. */
  chat: { folk: number; key: string; text: string } | null;
  /** Per task (TASK_IDS order): stage and items found. */
  tasks: { id: string; stage: number; got: number }[];
  pages: number;
  pagesOf: number;
  views: number;
  viewsOf: number;
  /** A web-zip has somewhere to go right now. */
  zip: boolean;
  /** Ticks this outing has recorded (it files near MAX_TICKS). */
  ticks: number;
  /**
   * roam-3, Front-run's race while it runs or has just ended (RoamFrame.race): the gates each
   * has passed, of how many, and how it ended. Null otherwise.
   */
  race: { heroGate: number; rivalGate: number; of: number; over: "won" | "lost" | null; why: "rival" | "river" | null } | null;
}

/** A tiny external store for the HUD (useSyncExternalStore). */
export class RoamHudStore {
  private snap: RoamHud | null = null;
  private readonly fns = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  };
  getSnapshot = () => this.snap;
  set(next: RoamHud) {
    if (this.snap && sameHud(this.snap, next)) return;
    this.snap = next;
    this.fns.forEach((f) => f());
  }
}

function sameHud(a: RoamHud, b: RoamHud): boolean {
  if (a.status !== b.status || a.move !== b.move || a.sprint !== b.sprint || a.zip !== b.zip || a.pages !== b.pages || a.views !== b.views) return false;
  if ((a.act?.kind ?? null) !== (b.act?.kind ?? null) || (a.act?.index ?? -1) !== (b.act?.index ?? -1)) return false;
  if ((a.chat?.text ?? null) !== (b.chat?.text ?? null)) return false;
  if (Math.floor(a.ticks / 600) !== Math.floor(b.ticks / 600)) return false;
  const ra = a.race;
  const rb = b.race;
  if (!ra !== !rb || (ra && rb && (ra.heroGate !== rb.heroGate || ra.rivalGate !== rb.rivalGate || ra.over !== rb.over || ra.why !== rb.why))) return false;
  return a.tasks.every((t, i) => t.stage === b.tasks[i]?.stage && t.got === b.tasks[i]?.got);
}

const URGENT = new Set<string>(["roam-talk", "roam-task", "roam-item", "roam-page", "roam-sync", "roam-bot", "roam-move", "roam-gate", "roam-race", "status"]);

const bits = (n: number) => {
  let c = 0;
  for (let v = n >>> 0; v; v &= v - 1) c += 1;
  return c;
};

export function roamHud(run: RoamRun, status: RoamStatus, f: RoamFrame | null | undefined): RoamHud {
  const r = run.sim.roam!;
  const b = r.body;
  const chat = f?.chat && r.chat ? { folk: f.chat.folk, key: r.world.folks[f.chat.folk].key, text: lineText(r.world.folks[f.chat.folk].key, f.chat.line, f.chat.left) } : null;
  return {
    status,
    move: b.move,
    sprint: b.sprintT > 0,
    act: f?.act ? { kind: f.act.kind, index: f.act.index } : null,
    chat,
    tasks: TASK_IDS.map((id, i) => ({ id, stage: r.progress.stage[i], got: bits(r.progress.items[i]) })),
    pages: bits(r.progress.pages),
    pagesOf: r.world.pages.length,
    views: bits(r.progress.views),
    viewsOf: r.world.views.length,
    zip: !!f?.zip,
    ticks: run.codes.length,
    race: f?.race ? { heroGate: f.race.heroGate, rivalGate: f.race.rivalGate, of: f.race.of, over: f.race.over, why: f.race.why } : null,
  };
}

/** Whether every task is finished (the tracker says so). */
export const allTasksDone = (h: RoamHud) => h.tasks.every((t) => t.stage === TASK_DONE);

/** The outing's frame: the night's fields, then roam's (game-core fills both in place). */
function fill(run: RoamRun, out: RenderFrame3D): RenderFrame3D {
  fillRenderFrame(run.sim, out);
  return fillRoamFrame(run.sim, out);
}

/**
 * The roam part of the blend: the latest tick's (its lists shared, read only), the bot sliding
 * between ticks. `out.roam` is the view's own object, never a tick's.
 */
function blendRoam(prev: RenderFrame3D, curr: RenderFrame3D, t: number, out: RenderFrame3D) {
  const c = curr.roam;
  if (!c) {
    out.roam = null;
    return;
  }
  const o = out.roam && out.roam !== c && out.roam !== prev.roam ? out.roam : (out.roam = { ...c });
  Object.assign(o, c);
  const k = Math.max(0, Math.min(1, t));
  // roam-2: the cars slide between ticks too (the hero does), so nothing stutters past him.
  const pc = prev.roam?.cars;
  const cc = c.cars;
  if (cc && pc && pc.length === cc.length) {
    let list = viewCars.get(o);
    if (!list || list.length !== cc.length) {
      list = cc.map((q) => ({ id: q.id, pos: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 0, kind: q.kind }));
      viewCars.set(o, list);
    }
    for (let i = 0; i < cc.length; i++) {
      const a = pc[i];
      const b = cc[i];
      const v = list[i];
      v.id = b.id;
      v.kind = b.kind;
      v.speed = b.speed;
      v.pos.x = a.pos.x + (b.pos.x - a.pos.x) * k;
      v.pos.y = a.pos.y + (b.pos.y - a.pos.y) * k;
      v.pos.z = a.pos.z + (b.pos.z - a.pos.z) * k;
      let dy = b.yaw - a.yaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      else if (dy < -Math.PI) dy += Math.PI * 2;
      v.yaw = a.yaw + dy * k;
    }
    o.cars = list;
  }
  // roam-3: Sandwich Man runs between ticks too (Front-run's race).
  const pr = prev.roam?.race;
  if (c.race && pr) {
    let race = viewRaces.get(o);
    if (!race) viewRaces.set(o, (race = { ...c.race, rival: { x: 0, y: 0, z: 0 } }));
    Object.assign(race, c.race, { rival: race.rival });
    race.rival.x = pr.rival.x + (c.race.rival.x - pr.rival.x) * k;
    race.rival.y = pr.rival.y + (c.race.rival.y - pr.rival.y) * k;
    race.rival.z = pr.rival.z + (c.race.rival.z - pr.rival.z) * k;
    o.race = race;
  }
  const pb = prev.roam?.bot;
  if (!c.bot || !pb) return;
  const bot = (viewBots.get(o) ?? viewBots.set(o, { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, state: "running" }).get(o))!;
  bot.pos.x = pb.pos.x + (c.bot.pos.x - pb.pos.x) * k;
  bot.pos.y = pb.pos.y + (c.bot.pos.y - pb.pos.y) * k;
  bot.pos.z = pb.pos.z + (c.bot.pos.z - pb.pos.z) * k;
  bot.vel = c.bot.vel;
  bot.state = c.bot.state;
  o.bot = bot;
}
const viewBots = new WeakMap<RoamFrame, NonNullable<RoamFrame["bot"]>>();
const viewRaces = new WeakMap<RoamFrame, NonNullable<RoamFrame["race"]>>();
const viewCars = new WeakMap<RoamFrame, RoamCarFrame[]>();

export class RoamLoop {
  readonly hud = new RoamHudStore();
  readonly bus = new EventBus<RoamLoopEvent>();
  readonly view: RenderFrame3D;
  status: RoamStatus = "loading";
  /** The scene's camera beats read this (no countdown, no outro in the city). */
  readonly cue: SceneCue = { status: "live", introLeft: 0, introTotal: 0 };
  private source: (run: RoamRun) => InputFrame = () => ({ dir: 0, mag: 0, web: false, shot: 0 });
  private prev: RenderFrame3D;
  private curr: RenderFrame3D;
  private acc = 0;
  private lastHudAt = -Infinity;
  private hudDirty = true;
  private disposed = false;

  constructor(
    public run: RoamRun,
    private readonly now: () => number = () => performance.now(),
  ) {
    // Each tick's frame keeps its own roam part (fillRoamFrame fills it in place).
    this.curr = fill(run, newRenderFrame());
    this.prev = fill(run, newRenderFrame());
    this.view = copyFrame(this.curr, newRenderFrame());
    blendRoam(this.prev, this.curr, 1, this.view);
  }

  setSource(source: (run: RoamRun) => InputFrame): void {
    this.source = source;
  }

  start(): void {
    if (this.status === "loading") this.setStatus("live");
  }

  setPaused(paused: boolean): void {
    if (paused && this.status === "live") {
      this.acc = 0;
      this.setStatus("paused");
    } else if (!paused && this.status === "paused") this.setStatus("live");
  }

  /** The next outing (the last one filed): the city carries on from where it stood. */
  replace(run: RoamRun): void {
    this.run = run;
    fill(run, this.curr);
    fill(run, this.prev);
    this.acc = 0;
    this.hudDirty = true;
  }

  markDirty(): void {
    this.hudDirty = true;
  }

  dispose(): void {
    this.disposed = true;
  }

  advance(seconds: number): void {
    if (this.disposed) return;
    const real = Math.min(MAX_FRAME_SECONDS, Math.max(0, seconds));
    if (this.status === "live") this.tick(real);
    const live = this.status === "live" && roamActive(this.run);
    const t = live ? this.acc / DT : 1;
    blendFrame(this.prev, this.curr, t, this.view);
    blendRoam(this.prev, this.curr, t, this.view);
    this.cue.status = this.status === "paused" ? "paused" : "live";
    this.publish();
  }

  private tick(dt: number) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS) {
      if (!roamActive(this.run)) {
        this.acc = 0;
        break;
      }
      this.acc -= DT;
      steps += 1;
      const swap = this.prev;
      this.prev = this.curr;
      this.curr = swap;
      const events = stepRoamRun(this.run, this.source(this.run));
      fill(this.run, this.curr);
      if (teleported(this.prev, this.curr)) this.bus.emit({ type: "teleport" });
      for (const ev of events) {
        if (URGENT.has(ev.type)) this.hudDirty = true;
        this.bus.emit(ev);
      }
    }
    if (this.acc >= DT) this.acc = DT * 0.999;
  }

  private setStatus(status: RoamStatus) {
    if (this.status === status) return;
    this.status = status;
    this.hudDirty = true;
    this.bus.emit({ type: "status", status });
  }

  private publish() {
    const now = this.now();
    if (!this.hudDirty && now - this.lastHudAt < HUD_INTERVAL_MS) return;
    this.hudDirty = false;
    this.lastHudAt = now;
    this.hud.set(roamHud(this.run, this.status, this.curr.roam));
  }
}
