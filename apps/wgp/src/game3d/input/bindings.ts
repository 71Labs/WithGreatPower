/**
 * What every key and mouse button means, by KeyboardEvent.code (the physical key, so WASD
 * stays put on any layout). WASD or the arrows steer relative to the camera, Space holds
 * the web, 1–4 fire powers, G calls Gwei, Escape or P pauses; plus the look speeds for drag
 * orbit and mouse look. Pure, no DOM.
 */
import type { Shot } from "./latch";

export type ControlAction = "forward" | "back" | "left" | "right" | "web" | "power-1" | "power-2" | "power-3" | "power-4" | "gwei" | "pause";

export const KEY_BINDINGS: Readonly<Record<string, ControlAction>> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "web",
  Digit1: "power-1",
  Digit2: "power-2",
  Digit3: "power-3",
  Digit4: "power-4",
  Numpad1: "power-1",
  Numpad2: "power-2",
  Numpad3: "power-3",
  Numpad4: "power-4",
  KeyG: "gwei",
  Escape: "pause",
  KeyP: "pause",
};

export function actionForKey(code: string): ControlAction | null {
  return Object.hasOwn(KEY_BINDINGS, code) ? KEY_BINDINGS[code] : null;
}

/** The one-shot an action fires (0 for held actions). */
export function shotFor(action: ControlAction): Shot {
  switch (action) {
    case "power-1":
      return 1;
    case "power-2":
      return 2;
    case "power-3":
      return 3;
    case "power-4":
      return 4;
    case "gwei":
      return 5;
    default:
      return 0;
  }
}

export type Direction = "forward" | "back" | "left" | "right";

export const isDirection = (a: ControlAction): a is Direction => a === "forward" || a === "back" || a === "left" || a === "right";

/** Touch: the left share of the screen is the floating stick; the rest holds the web. */
export const STICK_ZONE = 0.4;
/** How far (CSS px) a thumb drags for a full stick. */
export const STICK_RADIUS = 56;
/** Drag to orbit: radians per CSS px, yaw and pitch. */
export const ORBIT_YAW_PER_PX = 0.006;
export const ORBIT_PITCH_PER_PX = 0.004;
/** Mouse look (pointer lock): radians per px of mouse movement, yaw and pitch. */
export const LOOK_YAW_PER_PX = 0.0024;
export const LOOK_PITCH_PER_PX = 0.0018;
