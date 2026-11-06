/**
 * The bot on a time trial: the patrol bot (bot.ts) swings it from gate to gate, and this
 * lines up the last few hundred units of each, where the patrol bot (built to arrive at
 * arenas, not to thread a ring) would overshoot: climb to a gate up on a wall's top, run at
 * one on the same roof, let go of a web that's carrying you at it, and fall or fly into it
 * (steering out the sideways drift) rather than shoot another web. It reads only what a
 * player sees and answers with an InputFrame, so its runs are ordinary logs: the trials'
 * goldens, and the dev times, are its best runs (test/trial-golden.test.ts tries a few
 * styles per course and keeps the fastest, as a course designer practises a line).
 */
import { botFrame, type BotMemory } from "./bot";
import { DT } from "./constants";
import type { InputFrame } from "./contract";
import { dirIndex, len2, len3 } from "./dmath";
import { IDLE_FRAME } from "./sim";
import { nextGate } from "./trial";
import type { SimState } from "./types";

/** How the bot takes its gates: the distances it starts lining up from, and how hard it steers. */
export interface TrialBotStyle {
  /** On a roof: run at a gate within this. */
  run: number;
  /** On a web: let go within this, once it carries you at the gate. */
  release: number;
  /** In the air: no new web within this. */
  glide: number;
  /** Climb to a gate above within this. */
  climb: number;
  /** How hard the air steering corrects the drift. */
  gain: number;
}

export const TRIAL_BOT_STYLE: TrialBotStyle = { run: 420, release: 650, glide: 600, climb: 460, gain: 1.6 };

/** The bot's input for the next step of a trial (the patrol bot's off a trial). */
export function trialBotFrame(s: SimState, mem: BotMemory, style: TrialBotStyle = TRIAL_BOT_STYLE, dt = DT): InputFrame {
  const base = botFrame(s, mem, dt);
  const g = s.trial ? nextGate(s) : null;
  if (!g || s.mode !== "travel") return s.mode === "done" ? IDLE_FRAME : base;
  const f = lineUp(s, g, base.dir, style);
  if (!f) return base;
  // The patrol bot remembers what it pressed; it didn't.
  mem.holding = f.web;
  return f;
}

function lineUp(s: SimState, g: { x: number; y: number; z: number }, dir: number, style: TrialBotStyle): InputFrame | null {
  const h = s.hero;
  const dx = g.x - h.x;
  const dz = g.z - h.z;
  const d = len2(dx, dz);
  const dy = g.y - h.y;
  const toward = d > 1 ? dirIndex(dx, dz) : dir;
  // A gate up on a wall's top, close: press into the wall with the web held, and climb it.
  if (h.climbing || (dy > 140 && d < style.climb && (h.grounded || h.vy < 120))) return { dir: toward, mag: 3, web: true, shot: 0 };
  // On a roof near a gate at about this height: run through it.
  if (h.grounded) return d < style.run && dy < 150 && dy > -200 ? { dir: toward, mag: 3, web: false, shot: 0 } : null;
  // In the air, steer out the sideways drift (aim the stick at where the velocity should go,
  // not just at the gate), so a near miss curls in rather than orbiting it.
  const hs = len2(h.vx, h.vz);
  const want = Math.max(hs, 300) * style.gain;
  const sx = d > 1 ? (dx / d) * want - h.vx : dx;
  const sz = d > 1 ? (dz / d) * want - h.vz : dz;
  const steer: InputFrame = { dir: len2(sx, sz) > 1 ? dirIndex(sx, sz) : toward, mag: 3, web: false, shot: 0 };
  const speed = len3(h.vx, h.vy, h.vz) || 1;
  const along = (h.vx * dx + h.vz * dz) / (d || 1);
  if (h.rope) {
    // Swinging at it: let go once the swing carries you at it, and fly in.
    if (d < style.release && along > speed * 0.55 && dy > -320 && dy < 160) return steer;
    return null;
  }
  // In the air and coming in: no new web unless it's falling short (under the gate, sinking).
  const sinking = dy > 60 && h.vy < -150;
  if (d < style.glide && !sinking && dy > -360) return steer;
  return null;
}
