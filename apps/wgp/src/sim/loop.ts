/**
 * The sim loop owns one SimState outside React.
 *
 * - advance(now) is called every animation frame. It steps the core at a fixed 60 Hz,
 *   with at most 0.25 s of catch-up (a backgrounded tab pauses rather than fast-forwards).
 * - Input is level-triggered (hold, steer) plus a queue of commands (abilities, Gwei)
 *   applied right before the next step.
 * - After each step it drains the sim's events onto a synchronous bus (the renderer and
 *   the React bridge listen), and keeps `frame` (interpolated hero and villain
 *   positions) mutated in place for the renderer.
 * - It publishes a HUD snapshot to a tiny external store about 10 times a second, and at
 *   once when something important happens.
 * - Lifecycle: loading → intro (3, 2, 1, THWIP) → live ⇄ paused → outro → done.
 */
import { MAX_FLUID, POWERS, VILLAINS } from "@wgp/game-core/data";
import type { PowerId, VillainId } from "@wgp/game-core/types";

import {
  abilityBlocked,
  DT,
  gweiBlocked,
  isVulnerable,
  queueAbility,
  queueGwei,
  stepSim,
  type SimEvent,
  type SimInput,
  type SimMode,
  type SimState,
} from "./core";

export type LoopStatus = "loading" | "intro" | "live" | "paused" | "outro" | "done";

export type LoopEvent = SimEvent | { type: "countdown"; value: number } | { type: "go" } | { type: "status"; status: LoopStatus };

export interface AbilityHud {
  id: PowerId;
  name: string;
  key: string;
  cost: number;
  cd: number;
  cdMax: number;
  ready: boolean;
  reason: "cooldown" | "fluid" | "target" | "mode" | null;
}

export interface HudSnapshot {
  status: LoopStatus;
  countdown: number | null;
  mode: SimMode;
  index: number;
  hp: number;
  maxHp: number;
  fluid: number;
  maxFluid: number;
  combo: number;
  perfect: number;
  progress: number;
  abilities: AbilityHud[];
  gwei: { left: number; ready: boolean };
  villain: { kind: VillainId; name: string; hits: number; hitsMax: number; open: boolean; boss: boolean; quest: boolean } | null;
  buffs: { shield: boolean; cloak: boolean; finality: boolean; fork: boolean; slowmo: boolean };
  /** True until the first web of the session. */
  hint: boolean;
}

/** A tiny external store for useSyncExternalStore. Snapshots are replaced, never mutated. */
export class HudStore {
  private snap: HudSnapshot | null = null;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;
  set(next: HudSnapshot) {
    if (this.snap && sameHud(this.snap, next)) return;
    this.snap = next;
    this.listeners.forEach((l) => l());
  }
}

function sameHud(a: HudSnapshot, b: HudSnapshot): boolean {
  if (
    a.status !== b.status ||
    a.countdown !== b.countdown ||
    a.mode !== b.mode ||
    a.index !== b.index ||
    a.hp !== b.hp ||
    a.maxHp !== b.maxHp ||
    a.fluid !== b.fluid ||
    a.combo !== b.combo ||
    a.perfect !== b.perfect ||
    Math.abs(a.progress - b.progress) > 0.002 ||
    a.hint !== b.hint ||
    a.gwei.left !== b.gwei.left ||
    a.gwei.ready !== b.gwei.ready
  )
    return false;
  if (JSON.stringify(a.buffs) !== JSON.stringify(b.buffs) || JSON.stringify(a.villain) !== JSON.stringify(b.villain)) return false;
  if (a.abilities.length !== b.abilities.length) return false;
  return a.abilities.every((x, i) => {
    const y = b.abilities[i];
    return x.ready === y.ready && x.reason === y.reason && Math.abs(x.cd - y.cd) < 0.05;
  });
}

export class EventBus<T> {
  private fns = new Set<(e: T) => void>();
  on(fn: (e: T) => void) {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
  emit(e: T) {
    this.fns.forEach((f) => f(e));
  }
}

/** What the renderer reads every frame. Mutated in place. */
export interface RenderFrame {
  alpha: number;
  status: LoopStatus;
  countdown: number | null;
  hero: { x: number; y: number; angle: number };
  villain: { x: number; y: number };
  bodies: { x: number; y: number }[];
  /** Real seconds since the loop started (for idle animation). */
  clock: number;
}

const MAX_FRAME_SECONDS = 0.25;
const MAX_STEPS = 16;
const HUD_INTERVAL_MS = 100;
const INTRO_SECONDS = 2.4;
const URGENT: ReadonlySet<LoopEvent["type"]> = new Set([
  "arrive",
  "encounter",
  "fight-live",
  "villain-hit",
  "hero-hurt",
  "ability",
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
  /** Slow-motion assist (reduced motion): the whole game runs at this rate. */
  timeScale?: number;
  introSeconds?: number;
  /** Publish into an existing store (the HUD may subscribe before the loop exists). */
  hud?: HudStore;
}

export class SimLoop {
  readonly hud: HudStore;
  readonly bus = new EventBus<LoopEvent>();
  readonly frame: RenderFrame;
  status: LoopStatus = "loading";
  input: SimInput = { hold: false, steer: 0 };
  timeScale: number;
  /** Debug autopilot: replaces the player's input each step. */
  autopilot: ((s: SimState) => SimInput) | null = null;

  private acc = 0;
  private lastNow = -1;
  private resumeTo: LoopStatus = "live";
  private introLeft: number;
  private lastCount = -1;
  private lastHudAt = -Infinity;
  private hudDirty = true;
  private hinted = false;
  private prev = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, bodies: [] as { x: number; y: number }[] };
  private disposed = false;
  private routeStart: number;
  private routeEnd: number;

  constructor(
    public state: SimState,
    opts: LoopOptions = {},
  ) {
    this.hud = opts.hud ?? new HudStore();
    this.timeScale = opts.timeScale ?? 1;
    this.introLeft = opts.introSeconds ?? INTRO_SECONDS;
    const h = state.hero;
    this.frame = {
      alpha: 1,
      status: "loading",
      countdown: null,
      hero: { x: h.x, y: h.y, angle: h.angle },
      villain: { x: 0, y: 0 },
      bodies: [],
      clock: 0,
    };
    const zones = state.world.zones;
    this.routeStart = state.world.startX;
    this.routeEnd = zones.length ? zones[zones.length - 1].x : state.world.endX;
    this.capture();
  }

  /** Where each stop sits on the route bar, 0–1. */
  stopProgress(): number[] {
    return this.state.world.zones.map((z) => (z.x - this.routeStart) / (this.routeEnd - this.routeStart));
  }

  start() {
    if (this.status !== "loading") return;
    // Resumed at an errand: nothing to count down to, so open it straight away.
    if (this.state.mode === "errand") {
      this.setStatus("live");
      this.drain();
      return;
    }
    this.setStatus("intro");
  }

  setStatus(status: LoopStatus) {
    if (this.status === status) return;
    this.status = status;
    this.hudDirty = true;
    this.bus.emit({ type: "status", status });
  }

  setPaused(paused: boolean) {
    if (paused && (this.status === "live" || this.status === "intro" || this.status === "outro")) {
      this.resumeTo = this.status;
      this.setStatus("paused");
      this.input = { hold: false, steer: 0 };
    } else if (!paused && this.status === "paused") {
      this.setStatus(this.resumeTo);
      this.lastNow = -1;
    }
  }

  /** The slow-motion assist: the whole game runs at this rate. */
  setTimeScale(scale: number) {
    this.timeScale = scale;
  }

  setHold(hold: boolean) {
    this.input = { ...this.input, hold };
  }

  setSteer(steer: number) {
    this.input = { ...this.input, steer };
  }

  ability(slot: number) {
    if (this.status !== "live") return;
    queueAbility(this.state, slot);
    this.hudDirty = true;
  }

  gwei() {
    if (this.status !== "live") return;
    queueGwei(this.state);
    this.hudDirty = true;
  }

  /** Swap the state (debug teleports keep the same loop). */
  markDirty() {
    this.hudDirty = true;
  }

  advance(nowMs: number) {
    if (this.disposed) return;
    if (this.lastNow < 0) {
      this.lastNow = nowMs;
      this.writeFrame();
      this.publish(nowMs);
      return;
    }
    const real = Math.min(MAX_FRAME_SECONDS, (nowMs - this.lastNow) / 1000);
    this.lastNow = nowMs;
    if (real <= 0) return;
    this.frame.clock += real;
    const dt = real * this.timeScale;
    if (this.status === "intro") this.tickIntro(dt);
    else if (this.status === "live" || this.status === "outro") this.tickLive(dt);
    this.writeFrame();
    this.publish(nowMs);
  }

  dispose() {
    this.disposed = true;
  }

  private tickIntro(dt: number) {
    this.introLeft -= dt;
    if (this.introLeft > 0) {
      const value = Math.ceil(this.introLeft / (INTRO_SECONDS / 3));
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
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS) {
      this.acc -= DT;
      steps += 1;
      this.capture();
      const input = this.autopilot ? this.autopilot(this.state) : this.input;
      stepSim(this.state, input);
      this.drain();
      if (this.status === "done") {
        this.acc = 0;
        return;
      }
    }
    if (this.acc >= DT) this.acc = DT * 0.999;
  }

  private drain() {
    const s = this.state;
    if (!s.events.length) return;
    const events = s.events.splice(0);
    for (const ev of events) {
      if (ev.type === "thwip") this.hinted = true;
      if (URGENT.has(ev.type)) this.hudDirty = true;
      this.bus.emit(ev);
      if (ev.type === "ko" || (ev.type === "fight-won" && ev.index === s.world.zones.length - 1)) this.setStatus("outro");
      if (ev.type === "night-over") this.setStatus("done");
    }
  }

  private capture() {
    const h = this.state.hero;
    this.prev.x = h.x;
    this.prev.y = h.y;
    this.prev.angle = h.angle;
    const v = this.state.villain;
    this.prev.vx = v?.x ?? 0;
    this.prev.vy = v?.y ?? 0;
    const bodies = v?.bodies ?? [];
    this.prev.bodies.length = bodies.length;
    bodies.forEach((b, i) => {
      this.prev.bodies[i] = { x: b.x, y: b.y };
    });
  }

  private writeFrame() {
    const s = this.state;
    const live = this.status === "live" || this.status === "outro";
    const a = live ? Math.min(1, this.acc / DT) : 1;
    const f = this.frame;
    f.alpha = a;
    f.status = this.status;
    f.countdown = this.status === "intro" ? Math.max(1, this.lastCount) : null;
    const h = s.hero;
    // A jump of more than ~2 ticks of travel (a teleport, a resume) snaps instead of sliding.
    const snap = Math.hypot(h.x - this.prev.x, h.y - this.prev.y) > 80;
    const t = snap ? 1 : a;
    f.hero.x = this.prev.x + (h.x - this.prev.x) * t;
    f.hero.y = this.prev.y + (h.y - this.prev.y) * t;
    let da = h.angle - this.prev.angle;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    f.hero.angle = this.prev.angle + da * t;
    const v = s.villain;
    if (v) {
      f.villain.x = this.prev.vx + (v.x - this.prev.vx) * t;
      f.villain.y = this.prev.vy + (v.y - this.prev.vy) * t;
      f.bodies.length = v.bodies.length;
      v.bodies.forEach((b, i) => {
        const p = this.prev.bodies[i] ?? b;
        const o = f.bodies[i] ?? { x: 0, y: 0 };
        o.x = p.x + (b.x - p.x) * t;
        o.y = p.y + (b.y - p.y) * t;
        f.bodies[i] = o;
      });
    }
  }

  private publish(nowMs: number) {
    if (!this.hudDirty && nowMs - this.lastHudAt < HUD_INTERVAL_MS) return;
    this.hudDirty = false;
    this.lastHudAt = nowMs;
    this.hud.set(this.snapshot());
  }

  snapshot(): HudSnapshot {
    const s = this.state;
    const h = s.hero;
    const v = s.villain;
    const progress = Math.max(0, Math.min(1, (h.x - this.routeStart) / (this.routeEnd - this.routeStart)));
    return {
      status: this.status,
      countdown: this.status === "intro" ? Math.max(1, this.lastCount) : null,
      mode: s.mode,
      index: s.index,
      hp: Math.round(s.hp),
      maxHp: s.maxHp,
      fluid: Math.round(s.fluid),
      maxFluid: MAX_FLUID,
      combo: s.combo,
      perfect: s.total.perfect,
      progress,
      abilities: s.powers.map((p, i) => {
        const reason = abilityBlocked(s, i);
        return {
          id: p.id,
          name: POWERS[p.id].name,
          key: String(i + 1),
          cost: p.cost,
          cd: Math.round(p.cd * 10) / 10,
          cdMax: p.cdMax,
          ready: !reason,
          reason,
        };
      }),
      gwei: { left: s.gweiLeft, ready: !gweiBlocked(s) },
      villain:
        v && (s.mode === "intro" || s.mode === "fight" || s.mode === "won" || s.mode === "ko")
          ? { kind: v.kind, name: VILLAINS[v.kind].name, hits: v.hits, hitsMax: v.hitsMax, open: isVulnerable(v) && v.invuln <= 0, boss: v.boss, quest: v.quest }
          : null,
      buffs: { shield: h.shieldT > 0, cloak: h.cloakT > 0, finality: h.finalityT > 0, fork: h.forked, slowmo: s.slowmo > 0 },
      hint: !this.hinted && s.index === 0 && s.mode === "travel",
    };
  }
}
