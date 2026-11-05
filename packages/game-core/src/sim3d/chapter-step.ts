/**
 * Case File 001's flow inside stepSim (sim.ts calls these only when `state.chapter` is set):
 *
 * - investigate (sim mode "travel"): chapter.ts findClues; the bridge doesn't open until all
 *   three are found, then the phase is "standoff".
 * - standoff: arriving on the deck starts the fight (intro, fight) against the Right-Clicker
 *   (right-clicker.ts). Here: the SCREENSHOT's freeze and the DRAG's pull on the hero's input.
 * - rescue (sim mode "fight" again, after the win's beat): hold the web beside Mary to
 *   restore her (RESTORE_TICKS), paused while hurt; two paper copies come to interrupt. A
 *   fresh press with a copy in reach still strikes it.
 * - done: she's free ("gm", a beat in mode "won"), then case-closed and the night ends.
 *
 * Case File 002 (`chapter.vote`) goes its own way at each of these: vote.ts.
 */
import {
  besideCaptive,
  FREED_SECONDS,
  popCopies,
  RESCUE_COPIES,
  RESTORE_EVENT_TICKS,
  RESTORE_TICKS,
  SECOND_COPY_SECONDS,
  SECOND_COPY_TICKS,
  spawnCopy,
} from "./chapter";
import { DT } from "./constants";
import type { InputFrame } from "./contract";
import { len2 } from "./dmath";
import { DRAG_SPEED } from "./right-clicker";
import { fightPress } from "./strike";
import type { SimState, Villain } from "./types";
import { stepVoteRescue, voteWonEnd } from "./vote";

const STILL: InputFrame = Object.freeze({ dir: 0, mag: 0, web: false, shot: 0 }) as InputFrame;

/**
 * The frame the hero steps with in a chapter fight (the log keeps the real one): nothing while
 * SAVED; no stick while the lasso pulls (the web still breaks it); beside Mary in the rescue,
 * a held web restores her instead of striking or swinging, unless a fresh press has a copy to
 * strike. The caller puts the real web back in `holdPrev`, so a hold is never a press.
 */
export function chapterInput(s: SimState, input: InputFrame): InputFrame {
  const c = s.chapter!;
  // Case File 002 shapes nothing: no freeze, no lasso, and its rescue is a chase.
  if (c.vote) return input;
  const h = s.hero;
  if (c.savedT > 0) {
    c.savedT = Math.max(0, c.savedT - DT);
    return STILL;
  }
  if (c.dragT > 0) {
    c.dragT = Math.max(0, c.dragT - DT);
    const dx = c.dragX - h.x;
    const dz = c.dragZ - h.z;
    const d = len2(dx, dz);
    if (d < 6 || c.dragT === 0) {
      // Pulled in: the lasso holds him there, no slide.
      c.dragT = 0;
      h.vx = 0;
      h.vz = 0;
    } else {
      const k = Math.min(DRAG_SPEED, d / DT) / d;
      h.vx = dx * k;
      h.vz = dz * k;
    }
    return { dir: 0, mag: 0, web: input.web, shot: input.shot };
  }
  if (c.phase === "rescue" && input.web && besideCaptive(s)) {
    if (h.strike >= 0 || h.zip >= 0) return input;
    if (!h.holdPrev && fightPress(s).kind === "strike") return input;
    return { dir: input.dir, mag: input.mag, web: false, shot: input.shot };
  }
  return input;
}

/** A rescue copy, sent by the webbed Right-Clicker from beside him. */
function sendCopy(s: SimState, v: Villain) {
  const c = s.chapter!;
  const zone = s.city.zones[s.index];
  const floor = zone?.stage?.y ?? v.y - v.radius;
  const side = c.rescueCopies % 2 === 0 ? 1 : -1;
  c.rescueCopies += 1;
  spawnCopy(s, v, v.x - v.az * 70 * side, v.z + v.ax * 70 * side, floor, 0.8);
}

/** After the fight-mode step in the rescue: the second copy, Mary's restore, and her release. */
export function stepRescue(s: SimState, input: InputFrame) {
  const c = s.chapter!;
  if (c.vote) {
    stepVoteRescue(s);
    return;
  }
  const v = s.villain;
  if (c.phase !== "rescue" || s.mode !== "fight" || !v) return;
  c.rescueT += DT;
  const m = c.captive;
  if (c.rescueCopies < RESCUE_COPIES && (m.restore >= SECOND_COPY_TICKS || c.rescueT >= SECOND_COPY_SECONDS)) sendCopy(s, v);
  const h = s.hero;
  const restoring = input.web && besideCaptive(s) && h.hurtT <= 0 && h.heldT <= 0 && c.savedT <= 0 && h.strike < 0 && h.zip < 0;
  if (!restoring) return;
  m.restore += 1;
  if (m.restore % RESTORE_EVENT_TICKS === 0 || m.restore >= RESTORE_TICKS) s.events.push({ type: "captive-restore", p: Math.min(1, m.restore / RESTORE_TICKS) });
  if (m.restore < RESTORE_TICKS) return;
  // Full quality: she's free.
  m.freed = true;
  c.phase = "done";
  popCopies(s, v);
  s.events.push({ type: "captive-freed", x: m.x, y: m.y, z: m.z });
  s.mode = "won";
  s.modeT = FREED_SECONDS;
  s.hazards.length = 0;
  s.shots.length = 0;
}

/** The end of a "won" beat on a chapter night: after the fight, the rescue; after the release, the case is closed. */
export function chapterWonEnd(s: SimState) {
  const c = s.chapter!;
  if (c.vote) {
    voteWonEnd(s);
    return;
  }
  const v = s.villain;
  if (c.phase === "standoff" && v) {
    c.phase = "rescue";
    c.rescueT = 0;
    s.mode = "fight";
    s.modeT = 0;
    v.phase = "idle";
    v.stun = 0;
    sendCopy(s, v);
    return;
  }
  c.phase = "done";
  s.mode = "done";
  s.events.push({ type: "case-closed", id: c.id, ticks: s.tick });
  s.events.push({ type: "night-over", reason: "route" });
}
