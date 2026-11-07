/**
 * Free roam's controls (the City mode): one InputFrame per sim tick, as on a night, with the
 * frame's one-shot read as roam's buttons (game-core sim3d/roam/constants.ts SHOT_*).
 *
 * Keyboard (by KeyboardEvent.code, so the keys stay put on any layout):
 * - WASD or the arrows steer, camera-relative. Tapped they walk, held they build to a run
 *   over ROAM_KEY_RAMP seconds (analogue speed from digital keys); C held keeps it a walk.
 * - Shift held sprints. Space jumps (up a wall, off it, a launch off a zip). F or the left
 *   mouse button holds the web: a swing, only while it's held. Q zips the web to the point the
 *   reticle shows. E talks, takes a photo or syncs a viewpoint. X lets go of a wall or a ledge.
 * - Escape or P pauses, M opens the city map. Mouse look locks the pointer on the first click.
 *
 * Touch: the left of the screen is the floating stick (double-tap it to sprint while it's held),
 * the rest is the open screen: drag there to look round, hold there to swing (at once in the
 * air; on a roof or a wall a thumb that drags first is a look, never a web: touch.ts). The
 * stick and a look go together, one thumb each. The HUD's buttons push jump, zip, act, drop
 * and the sprint toggle.
 *
 * The latch queues one-shots so two presses in one tick both count, a tick each, and sends
 * the sprint one-shot every tick it's held (the sim keeps a sprint SPRINT_GRACE ticks).
 */
import { SHOT_ACT, SHOT_DROP, SHOT_JUMP, SHOT_SPRINT, SHOT_ZIP } from "@wgp/game-core/sim3d/roam";
import type { InputFrame } from "@wgp/game-core/sim3d/contract";

import { LOOK_PITCH_PER_PX, LOOK_YAW_PER_PX, ORBIT_PITCH_PER_PX, ORBIT_YAW_PER_PX, WEB_HOLD_MS } from "./bindings";
import { InputLatch } from "./latch";
import { keysStick, stickInput, type View } from "./stick";
import { TouchRouter, type StickVisual } from "./touch";

export type RoamAction = "forward" | "back" | "left" | "right" | "jump" | "sprint" | "web" | "zip" | "act" | "drop" | "walk" | "pause" | "map";

export const ROAM_KEYS: Readonly<Record<string, RoamAction>> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "jump",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  KeyF: "web",
  KeyQ: "zip",
  KeyE: "act",
  KeyX: "drop",
  KeyC: "walk",
  Escape: "pause",
  KeyP: "pause",
  KeyM: "map",
};

export const roamActionFor = (code: string): RoamAction | null => (Object.hasOwn(ROAM_KEYS, code) ? ROAM_KEYS[code] : null);

/** Keys held this long reach full tilt (a third at once: a tap walks a step). */
export const ROAM_KEY_RAMP = 0.32;
/** A second stick touch this soon after the last one lifted is a double tap: sprint. */
export const DOUBLE_TAP_MS = 320;

type RoamShot = typeof SHOT_JUMP | typeof SHOT_ZIP | typeof SHOT_ACT | typeof SHOT_DROP;

export class RoamLatch {
  /** The stick and the web (shared with the touch router and the chase camera's held stick). */
  readonly base = new InputLatch();
  private queue: RoamShot[] = [];
  private readonly sprints = new Set<string>();
  /** The keys' stick: its unit direction and when the keys went down (seconds), for the ramp. */
  private keys = { x: 0, y: 0, since: 0, on: false };
  /** C held: keep it a walk. */
  walk = false;

  /** A one-shot for the next free tick. */
  push(shot: RoamShot): void {
    if (this.queue.length < 4) this.queue.push(shot);
  }

  /** A source (Shift, the touch toggle, a double-tapped stick) holding sprint, or letting go. */
  setSprint(source: string, held: boolean): void {
    if (held) this.sprints.add(source);
    else this.sprints.delete(source);
  }

  get sprinting(): boolean {
    return this.sprints.size > 0;
  }

  /** The keyboard's stick (unit or zero); the ramp starts when it goes from centred to steering. */
  setKeys(x: number, y: number, now: number): void {
    const on = x !== 0 || y !== 0;
    if (on && !this.keys.on) this.keys.since = now;
    this.keys = { x, y, since: this.keys.since, on };
    this.base.setStick({ x, y });
  }

  /** The frame for the next tick (clears one queued shot). `now` in seconds. */
  take(view: View | null, now: number): InputFrame {
    let dir: number;
    let mag: number;
    if (this.keys.on) {
      // The keys ramp from a walk to full tilt.
      const k = Math.min(1, 0.34 + ((now - this.keys.since) / ROAM_KEY_RAMP) * 0.66);
      ({ dir, mag } = stickInput({ x: this.keys.x * k, y: this.keys.y * k }, view));
    } else ({ dir, mag } = this.base.peek(view));
    if (this.walk) mag = Math.min(mag, 1);
    const shot = this.queue.shift() ?? (this.sprinting && mag > 0 ? SHOT_SPRINT : 0);
    return { dir: mag ? dir : 0, mag, web: this.base.web, shot: shot as InputFrame["shot"] };
  }

  clear(): void {
    this.base.clear();
    this.queue = [];
    this.sprints.clear();
    this.keys = { x: 0, y: 0, since: 0, on: false };
    this.walk = false;
  }
}

export interface RoamControlsOptions {
  latch: RoamLatch;
  surface: HTMLElement;
  orbit(dYaw: number, dPitch: number, holding: boolean): void;
  onPause(): void;
  onMap(): void;
  enabled(): boolean;
  onStick?(visual: StickVisual): void;
  /** The look speed setting: a multiplier on every look; a function is read on every turn, so a change applies at once. */
  lookSensitivity?: number | (() => number);
  /** Whether a thumb on the web side holds the web the moment it lands (in the air), else it waits to see if it drags (default: at once). */
  webAtOnce?(): boolean;
}

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export interface RoamControls {
  release(): void;
  detach(): void;
}

const SHOT_OF: Partial<Record<RoamAction, RoamShot>> = { jump: SHOT_JUMP, zip: SHOT_ZIP, act: SHOT_ACT, drop: SHOT_DROP };

/** Attach free roam's controls to the window and the play surface. */
export function attachRoamControls(opts: RoamControlsOptions): RoamControls {
  const { latch, surface } = opts;
  const held = { forward: false, back: false, left: false, right: false };
  let touchOn = false;
  let lastStickEnd = -Infinity;
  let mouseOrbit: { id: number; x: number; y: number } | null = null;
  const sens = () => {
    const v = typeof opts.lookSensitivity === "function" ? opts.lookSensitivity() : opts.lookSensitivity;
    return v ?? 1;
  };
  const orbit = (dy: number, dp: number, holding: boolean) => {
    const k = sens();
    opts.orbit(dy * k, dp * k, holding);
  };
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const clearPoll = () => {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
  };
  /** A web-side thumb waiting to see if it drags: decide it once it has stayed put long enough. */
  const schedulePoll = () => {
    clearPoll();
    if (!touch.waiting) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      touch.poll(performance.now());
      schedulePoll();
    }, WEB_HOLD_MS + 4);
  };
  const lockable = typeof surface.requestPointerLock === "function";
  const locked = () => typeof document !== "undefined" && document.pointerLockElement === surface;
  const now = () => performance.now() / 1000;

  const touch = new TouchRouter({
    latch: latch.base,
    orbit,
    webAtOnce: opts.webAtOnce,
    stick: (v) => {
      if (v.active && !touchOn) {
        // A double tap of the stick sprints while the thumb stays down.
        if (performance.now() - lastStickEnd < DOUBLE_TAP_MS) latch.setSprint("double-tap", true);
      }
      if (!v.active && touchOn) {
        lastStickEnd = performance.now();
        latch.setSprint("double-tap", false);
      }
      touchOn = v.active;
      if (!v.active) steer();
      opts.onStick?.(v);
    },
  });

  const steer = () => {
    if (touchOn) return;
    const k = keysStick(held);
    latch.setKeys(k.x, k.y, now());
  };

  const letGo = () => {
    held.forward = held.back = held.left = held.right = false;
    clearPoll();
    touch.reset();
    touchOn = false;
    if (mouseOrbit) opts.orbit(0, 0, false);
    mouseOrbit = null;
    if (locked()) document.exitPointerLock();
    latch.clear();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const action = roamActionFor(e.code);
    if (!action) return;
    if (action === "pause") {
      e.preventDefault();
      if (!e.repeat) opts.onPause();
      return;
    }
    if (action === "map") {
      e.preventDefault();
      if (!e.repeat) opts.onMap();
      return;
    }
    if (!opts.enabled()) return;
    e.preventDefault();
    if (action === "forward" || action === "back" || action === "left" || action === "right") {
      held[action] = true;
      steer();
    } else if (action === "sprint") latch.setSprint("key", true);
    else if (action === "walk") latch.walk = true;
    else if (action === "web") latch.base.setWeb("key", true);
    else if (!e.repeat) {
      const shot = SHOT_OF[action];
      if (shot) latch.push(shot);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const action = roamActionFor(e.code);
    if (!action) return;
    if (action === "forward" || action === "back" || action === "left" || action === "right") {
      held[action] = false;
      steer();
    } else if (action === "sprint") latch.setSprint("key", false);
    else if (action === "walk") latch.walk = false;
    else if (action === "web") latch.base.setWeb("key", false);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!opts.enabled()) return;
    if (e.pointerType === "touch") {
      e.preventDefault();
      if (e.isPrimary && touch.size > 0) touch.reset();
      surface.setPointerCapture(e.pointerId);
      touch.down(e.pointerId, e.clientX, e.clientY, surface.clientWidth || window.innerWidth, performance.now());
      if (touch.waiting) schedulePoll();
      return;
    }
    if (e.button === 0) {
      if (!locked() && lockable) Promise.resolve(surface.requestPointerLock()).catch(() => {});
      surface.setPointerCapture(e.pointerId);
      latch.base.setWeb("mouse", true);
    } else if (e.button === 2 && !locked()) {
      surface.setPointerCapture(e.pointerId);
      mouseOrbit = { id: e.pointerId, x: e.clientX, y: e.clientY };
      opts.orbit(0, 0, true);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      touch.move(e.pointerId, e.clientX, e.clientY, performance.now());
      return;
    }
    if (locked()) {
      if (opts.enabled() && (e.movementX || e.movementY)) orbit(-e.movementX * LOOK_YAW_PER_PX, e.movementY * LOOK_PITCH_PER_PX, false);
      return;
    }
    if (mouseOrbit && mouseOrbit.id === e.pointerId) {
      orbit(-(e.clientX - mouseOrbit.x) * ORBIT_YAW_PER_PX, (e.clientY - mouseOrbit.y) * ORBIT_PITCH_PER_PX, true);
      mouseOrbit.x = e.clientX;
      mouseOrbit.y = e.clientY;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      touch.up(e.pointerId);
      return;
    }
    if (mouseOrbit && mouseOrbit.id === e.pointerId && (e.button === 2 || e.type === "pointercancel")) {
      mouseOrbit = null;
      opts.orbit(0, 0, false);
    }
    if (e.button === 0 || e.type === "pointercancel") latch.base.setWeb("mouse", false);
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", letGo);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);
  surface.addEventListener("contextmenu", onContextMenu);
  return {
    release: letGo,
    detach: () => {
      clearPoll();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", letGo);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerUp);
      surface.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
