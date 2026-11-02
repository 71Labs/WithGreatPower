/**
 * The DOM side of the controls: keyboard on the window, mouse and touch on the play
 * surface, all reporting into one InputLatch.
 *
 * - Keys: WASD or the arrows steer (camera-relative), Space holds the web, 1–4 and G latch
 *   a power or Gwei, Escape or P asks to pause (the page decides what that means).
 * - Mouse: the left button holds the web; a right-button drag orbits the camera.
 * - Touch: the floating stick, hold-to-web and two-finger orbit (touch.ts).
 *
 * While `enabled()` is false (paused, an errand sheet open) presses are ignored and keys
 * pass through to the page, so a sheet's own shortcuts (1–3 on an errand) still work.
 * Losing focus lets go of everything.
 */
import { actionForKey, isDirection, ORBIT_PITCH_PER_PX, ORBIT_YAW_PER_PX, shotFor, type Direction } from "./bindings";
import type { InputLatch } from "./latch";
import { keysStick } from "./stick";
import { TouchRouter, type StickVisual } from "./touch";

export interface ControlsOptions {
  latch: InputLatch;
  /** The element that takes mouse and touch: the full-screen play surface. */
  surface: HTMLElement;
  orbit(dYaw: number, dPitch: number, holding: boolean): void;
  /** Escape or P. */
  onPause(): void;
  /** Whether play input counts right now. */
  enabled(): boolean;
  /** The floating touch stick moved, appeared or went away. */
  onStick?(visual: StickVisual): void;
}

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export interface Controls {
  /** Let go of every held control (pause, a sheet opening). */
  release(): void;
  detach(): void;
}

/** Attach the controls to the window and the surface. */
export function attachControls(opts: ControlsOptions): Controls {
  const { latch, surface } = opts;
  const held: Record<Direction, boolean> = { forward: false, back: false, left: false, right: false };
  let touchStick = false;
  let mouseOrbit: { id: number; x: number; y: number } | null = null;
  const touch = new TouchRouter({
    latch,
    orbit: opts.orbit,
    stick: (v) => {
      touchStick = v.active;
      if (!v.active) latch.setStick(keysStick(held));
      opts.onStick?.(v);
    },
  });

  const steer = () => {
    if (!touchStick) latch.setStick(keysStick(held));
  };

  const letGo = () => {
    held.forward = held.back = held.left = held.right = false;
    touch.reset();
    touchStick = false;
    if (mouseOrbit) opts.orbit(0, 0, false);
    mouseOrbit = null;
    latch.clear();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const action = actionForKey(e.code);
    if (!action) return;
    if (action === "pause") {
      e.preventDefault();
      if (!e.repeat) opts.onPause();
      return;
    }
    if (!opts.enabled()) return;
    e.preventDefault();
    if (isDirection(action)) {
      held[action] = true;
      steer();
    } else if (action === "web") latch.setWeb("key", true);
    else if (!e.repeat) latch.pushShot(shotFor(action));
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const action = actionForKey(e.code);
    if (!action) return;
    if (isDirection(action)) {
      held[action] = false;
      steer();
    } else if (action === "web") latch.setWeb("key", false);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!opts.enabled()) return;
    if (e.pointerType === "touch") {
      e.preventDefault();
      surface.setPointerCapture(e.pointerId);
      touch.down(e.pointerId, e.clientX, e.clientY, surface.clientWidth || window.innerWidth);
      return;
    }
    if (e.button === 0) {
      surface.setPointerCapture(e.pointerId);
      latch.setWeb("mouse", true);
    } else if (e.button === 2) {
      surface.setPointerCapture(e.pointerId);
      mouseOrbit = { id: e.pointerId, x: e.clientX, y: e.clientY };
      opts.orbit(0, 0, true);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      touch.move(e.pointerId, e.clientX, e.clientY);
      return;
    }
    if (mouseOrbit && mouseOrbit.id === e.pointerId) {
      opts.orbit(-(e.clientX - mouseOrbit.x) * ORBIT_YAW_PER_PX, (e.clientY - mouseOrbit.y) * ORBIT_PITCH_PER_PX, true);
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
    if (e.button === 0 || e.type === "pointercancel") latch.setWeb("mouse", false);
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
  const detach = () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", letGo);
    surface.removeEventListener("pointerdown", onPointerDown);
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("pointerup", onPointerUp);
    surface.removeEventListener("pointercancel", onPointerUp);
    surface.removeEventListener("contextmenu", onContextMenu);
  };
  return { release: letGo, detach };
}
