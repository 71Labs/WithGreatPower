/**
 * A scripted player for tests, golden logs and the debug autopilot. It reads the state
 * like a person reads the screen and answers with an InputFrame, the only thing a real
 * player can send: hold to web when falling, let go in the perfect window, and in fights
 * fly at the villain and use its powers. Ported from the 2D bot.
 */
import { abilityBlocked, gweiBlocked } from "./abilities";
import { docVulnerable, isVulnerable, nearestTarget } from "./combat";
import { DT } from "./constants";
import type { InputFrame } from "./contract";
import { DIR64, dirIndex, len2, len3 } from "./dmath";
import { raycastCity } from "./city";
import { bestAnchor, heroHeading, stopTarget, travelBearing } from "./hero";
import { pickForecast } from "./swing";
import { IDLE_FRAME } from "./sim";
import type { SimState } from "./types";

export interface BotMemory {
  hangT: number;
  abilityT: number;
  holding: boolean;
  /** The stop the progress watchdog is measuring. */
  stop: number;
  /** Closest the hero has come to the stop, and how long since that improved. */
  bestD: number;
  stuckT: number;
  /** How long the current web has been held. */
  ropeT: number;
  /** Escaping a dead end: seconds left, which way to break ties, and the DIR64 heading chosen. */
  escapeT: number;
  escapeSide: number;
  escapeDir: number;
  /** Where the hero was last tick, to measure real movement (velocity can lie when wedged). */
  lastX: number;
  lastY: number;
  lastZ: number;
}

export const newBotMemory = (): BotMemory => ({
  hangT: 0,
  abilityT: 0,
  holding: false,
  stop: -1,
  bestD: Infinity,
  stuckT: 0,
  ropeT: 0,
  escapeT: 0,
  escapeSide: 1,
  escapeDir: 0,
  lastX: 0,
  lastY: 0,
  lastZ: 0,
});

/** tan 23° and tan 56°: the bot aims inside the perfect window (20–60°), with a margin. */
const TAN_LO = 0.4244748162096047;
const TAN_HI = 1.4825609685127403;

/** The ability or Gwei to fire this tick, as an InputFrame one-shot (0 for none). */
function pickShot(s: SimState, mem: BotMemory): InputFrame["shot"] {
  const v = s.villain;
  const h = s.hero;
  if (mem.abilityT > 0) return 0;
  if (s.mode === "travel") {
    // Now and then, use a travel power so mastery from swinging gets exercised too.
    const fr = s.powers.findIndex((p) => p.id === "front-run");
    if (fr >= 0 && !abilityBlocked(s, fr) && h.vy > 0 && s.fluid > 60) {
      mem.abilityT = 3;
      return (fr + 1) as InputFrame["shot"];
    }
    return 0;
  }
  if (s.mode !== "fight" || !v) return 0;
  const t = nearestTarget(s, h.x, h.y, h.z);
  const dist = t ? len3(t.x - h.x, t.y - h.y, t.z - h.z) : Infinity;
  const guarded = v.kind === "doc-octochain" && !docVulnerable(v);
  if (!gweiBlocked(s) && (v.boss || s.hp < s.maxHp * 0.4)) {
    mem.abilityT = 0.5;
    return 5;
  }
  for (let i = 0; i < s.powers.length; i++) {
    if (abilityBlocked(s, i)) continue;
    const id = s.powers[i].id;
    let go = false;
    switch (id) {
      case "web-sling":
        go = !guarded;
        break;
      case "web-bomb":
        go = dist < 520;
        break;
      case "validator-slam":
        go = !!t && dist < 360 && t.y < h.y;
        break;
      case "wall-crawl":
        go = s.hp < s.maxHp * 0.55;
        break;
      case "web-shield":
        go = h.shieldT <= 0;
        break;
      case "zk-cloak":
        go = s.hp < s.maxHp * 0.6;
        break;
      case "gas-refund":
        go = s.fluid < 30;
        break;
      case "node-sense":
        go = s.hazards.length > 1;
        break;
      case "yank":
        go = guarded || dist < 500;
        break;
      case "finality":
        go = h.finalityT <= 0;
        break;
      case "fork":
        go = !h.forked && s.fluid > 40;
        break;
      case "front-run": {
        if (!t || guarded) break;
        const dx = t.x - h.x;
        const dz = t.z - h.z;
        const hd = len2(dx, dz) || 1;
        go = Math.abs(t.y - h.y) < 120 && (dx * h.fx + dz * h.fz) / hd > 0.9 && dist < 600;
        break;
      }
    }
    if (go) {
      mem.abilityT = 0.35;
      return (i + 1) as InputFrame["shot"];
    }
  }
  return 0;
}

/**
 * The most open way out of a dead end: of eight headings, the one whose horizontal ray
 * runs furthest before a wall (ties toward the route, then toward `side`).
 */
function openestDir(s: SimState, side: number): number {
  const h = s.hero;
  const b = travelBearing(s);
  const base = b ? dirIndex(b.x, b.z) : 0;
  let best = base;
  let bestScore = -1;
  for (let k = 0; k < 8; k++) {
    const step = (k + 1) >> 1;
    const turn = k === 0 ? 0 : step * 8 * (k & 1 ? side : -side);
    const d = (base + turn + 64) % 64;
    const v = DIR64[d];
    const hit = raycastCity(s.grid, h.x, h.y, h.z, v[0], 0, v[1], 700);
    // Open space counts, and so does going the right way: straight back scores a third.
    const score = (hit ? hit.t : 700) * (1 - step / 6);
    if (score > bestScore + 20) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** The bot's input for the next step. */
export function botFrame(s: SimState, mem: BotMemory, dt = DT): InputFrame {
  mem.abilityT = Math.max(0, mem.abilityT - dt);
  if (s.mode === "errand" || s.mode === "done" || s.mode === "ko") return IDLE_FRAME;
  const h = s.hero;
  const moved = len3(h.x - mem.lastX, h.y - mem.lastY, h.z - mem.lastZ) / dt;
  mem.lastX = h.x;
  mem.lastY = h.y;
  mem.lastZ = h.z;
  const shot = pickShot(s, mem);
  const fight = s.mode === "fight" || s.mode === "intro";
  if (mem.stop !== s.index) {
    mem.stop = s.index;
    mem.bestD = Infinity;
    mem.stuckT = 0;
  }
  const goal = stopTarget(s);
  const dist = goal ? len2(goal.x - h.x, goal.z - h.z) : 0;
  if (fight || dist < mem.bestD - 40) {
    mem.bestD = fight ? Infinity : Math.min(mem.bestD, dist);
    mem.stuckT = 0;
  } else {
    mem.stuckT += dt;
  }

  const v = s.villain;
  const t = fight ? (nearestTarget(s, h.x, h.y, h.z) ?? (v ? { x: v.x, y: v.y, z: v.z, r: v.radius, body: -1 } : null)) : null;
  // Doc with his arms out: keep clear and wait for the opening.
  const open = v ? isVulnerable(v) : true;

  // The stick: none while travelling (the heading follows the route), toward or away from him in fights.
  let dir = 0;
  let mag = 0;
  if (fight && t) {
    const dx = t.x - h.x;
    const dz = t.z - h.z;
    const hd = len2(dx, dz);
    if (!open && hd < 420) {
      dir = dirIndex(-dx, -dz);
      mag = 3;
    } else if (hd > (h.grounded ? 200 : 160)) {
      // Fly at him; on a roof (or Doc's deck), run at him to line up the next swing.
      dir = dirIndex(dx, dz);
      mag = 3;
    }
  } else if (!fight) {
    if (mem.stuckT > 3 && mem.escapeT <= 0) {
      mem.escapeT = 1.6;
      mem.escapeSide = -mem.escapeSide;
    }
    if (mem.escapeT > 0) {
      if (mem.escapeT === 1.6) {
        // The most open way, but never the same way twice running (that one didn't work).
        const d = openestDir(s, mem.escapeSide);
        mem.escapeDir = d === mem.escapeDir ? (d + 16 * mem.escapeSide + 64) % 64 : d;
      }
      mem.escapeT -= dt;
      dir = mem.escapeDir;
      mag = 3;
    }
  }
  const frame: InputFrame = { dir: mag ? dir : 0, mag, web: false, shot };
  const head = heroHeading(s, frame);

  let hold = mem.holding;
  if (h.rope) {
    const speed = len3(h.vx, h.vy, h.vz);
    const hs = len2(h.vx, h.vz);
    const perfect = h.vy > 140 && hs > 120 && speed > 540 && h.vy >= hs * TAN_LO && h.vy <= hs * TAN_HI;
    mem.hangT = Math.min(speed, moved) < 160 ? mem.hangT + dt : 0;
    mem.ropeT += dt;
    let letGo = perfect;
    // In a fight, a swing that isn't going anywhere is worth dropping for a better one.
    if (fight && mem.ropeT > 2.4 && h.vy > -100) letGo = true;
    if (fight && t && open) {
      // Fly at the villain: let go when moving straight at him.
      const wx = t.x - h.x;
      const wy = t.y - h.y;
      const wz = t.z - h.z;
      const d = len3(wx, wy, wz) || 1;
      const cos = (h.vx * wx + h.vy * wy + h.vz * wz) / ((speed || 1) * d);
      if (speed > 520 && cos > 0.955 && d < 650) letGo = true;
    }
    if (!fight) {
      const b = travelBearing(s);
      if (b) {
        const past = (h.x - h.rope.x) * b.x + (h.z - h.rope.z) * b.z;
        const along = h.vx * b.x + h.vz * b.z;
        if (h.vy > 0 && past > h.rope.len * 0.7) letGo = true;
        // Past the anchor and rising forward: a good release beats dangling.
        if (h.vy > 60 && along > 150 && past > 20 && mem.stuckT > 1.5) letGo = true;
      }
    }
    // Dangling, or stuck on a web that points backwards: drop it.
    const b = travelBearing(s);
    const behind = !fight && b ? (h.rope.x - h.x) * b.x + (h.rope.z - h.z) * b.z < 0 : false;
    if (mem.hangT > 1.2 || (mem.stuckT > 4 && behind)) letGo = true;
    hold = !letGo;
    if (!hold) mem.ropeT = 0;
  } else if (fight && t && v) {
    mem.ropeT = 0;
    // Aim a slam by timing the web: grab when the forecast swing carries you through him.
    const a = pickForecast(s, head.x, head.z);
    mem.hangT += dt;
    if (a) {
      const rope = len3(a.x - h.x, a.y - h.y, a.z - h.z);
      const reach = len3(a.x - t.x, a.y - t.y, a.z - t.z);
      const lined = open && (a.slam || (Math.abs(rope - reach) < 70 && t.y < a.y));
      hold = lined || h.y < 200 || (h.grounded && mem.hangT > 0.6) || (h.vy < -500 && mem.hangT > 1);
    } else hold = false;
    if (hold) mem.hangT = 0;
  } else {
    // Stuck under an anchor behind you: let it go and fall to something ahead.
    const a = bestAnchor(s, head.x, head.z);
    const b = travelBearing(s);
    const ahead = a && b ? (a.x - h.x) * b.x + (a.z - h.z) * b.z : 0;
    // Stuck, only webs that go forward; pinned on a roof, anything (it may climb out).
    const pinned = h.grounded && moved < 20;
    const ok = !!a && (mem.stuckT < 2 || ahead > 40 || pinned);
    hold = ok && (h.grounded || h.vy < 80);
  }
  mem.holding = hold;
  frame.web = hold;
  return frame;
}
