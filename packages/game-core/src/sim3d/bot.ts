/**
 * A scripted player for tests, golden logs and the debug autopilot. It reads the state
 * like a person reads the screen and answers with an InputFrame, the only thing a real
 * player can send: hold to web when falling, let go in the perfect window, and in fights
 * fly at the villain and use its powers. Ported from the 2D bot.
 *
 * Ruleset 3: nothing moves the hero without the stick, so the bot steers: at the next
 * pickup when one is close and on the way, else at the next stop.
 */
import { abilityBlocked, gweiBlocked } from "./abilities";
import { besideCaptive, COPY_RADIUS, RESTORE_REACH } from "./chapter";
import { docVulnerable, isVulnerable, mercy, nearestTarget, takesHit } from "./combat";
import { inShotCone } from "./right-clicker";
import { DT } from "./constants";
import type { InputFrame } from "./contract";
import { DIR64, dirIndex, len2, len3 } from "./dmath";
import { raycastCity } from "./city";
import { bestAnchor, heroHeading, stopTarget, travelBearing } from "./hero";
import { nextPickup } from "./pickups";
import { fightPress } from "./strike";
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
  /** How long the web has been held on the ground with nothing taking (then it lets go, to jump). */
  groundT: number;
  /** v4, fights: a sidestep under way (seconds left, and its DIR64 heading), and which way the bot circles. */
  dodgeT: number;
  dodgeDir: number;
  circle: number;
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
  groundT: 0,
  dodgeT: 0,
  dodgeDir: 0,
  circle: 1,
});

/** tan 22° and tan 56°: the bot aims inside the perfect window (15–65°), with a margin, early (where the swing carries furthest). */
const TAN_LO = 0.4040262258351568;
const TAN_HI = 1.4825609685127403;
/** A pickup this close, and not behind on the way to the stop, is worth steering at. */
const PICKUP_DETOUR = 520;

/** Where to steer while travelling: the next pickup on this leg if it's close and on the way, else the stop. */
function travelGoal(s: SimState): { x: number; z: number } | null {
  const goal = stopTarget(s);
  if (!goal) return null;
  const h = s.hero;
  const p = nextPickup(s);
  if (p) {
    const dx = p.x - h.x;
    const dz = p.z - h.z;
    const d = len2(dx, dz);
    const gx = goal.x - h.x;
    const gz = goal.z - h.z;
    const gd = len2(gx, gz) || 1;
    // Only a small turn off the way to the stop (within about 37°): bigger detours cost more misses than they pay.
    if (d < PICKUP_DETOUR && d > 1 && (dx * gx + dz * gz) / (gd * d) > 0.8 && d < gd) return { x: p.x, z: p.z };
  }
  return { x: goal.x, z: goal.z };
}

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

/** v4, fights: the gap the bot keeps from a guarding villain, and from Doc's swinging arms. */
const SPACING = 300;
const DOC_CLEAR = 430;

/** The DIR64 heading sideways to (dx, dz), toward the side with more of the stage (or `pref`). */
function sideways(s: SimState, dx: number, dz: number, pref: number): number {
  const h = s.hero;
  const st = s.city.zones[s.index]?.stage;
  const d = len2(dx, dz) || 1;
  const px = -dz / d;
  const pz = dx / d;
  let side = pref;
  if (st) {
    const room = (sx: number, sz: number) => {
      const x = h.x + sx * 160;
      const z = h.z + sz * 160;
      return Math.min(x - st.x0, st.x1 - x, z - st.z0, st.z1 - z);
    };
    const a = room(px, pz);
    const b = room(-px, -pz);
    if (Math.abs(a - b) > 40) side = a > b ? 1 : -1;
  }
  return dirIndex(px * side, pz * side);
}

/**
 * Case File 001's rescue: to Mary and hold the web there; let go and strike a paper copy that
 * winds up a slap in reach (a fresh press), then back to holding.
 */
function rescueFrame(s: SimState, mem: BotMemory, shot: InputFrame["shot"]): InputFrame {
  const h = s.hero;
  const c = s.chapter!;
  const v = s.villain!;
  const m = c.captive;
  const frame: InputFrame = { dir: 0, mag: 0, web: false, shot };
  const dx = m.x - h.x;
  const dz = m.z - h.z;
  if (len2(dx, dz) > RESTORE_REACH * 0.5) {
    frame.dir = dirIndex(dx, dz);
    frame.mag = 3;
  }
  // A copy about to slap, within a blow: punch it (a fresh press, so let go first).
  let threat = false;
  for (const b of v.bodies) {
    if (!b.alive) continue;
    const gap = len3(b.x - h.x, b.y - h.y, b.z - h.z) - COPY_RADIUS - 26;
    if (gap < 110 && c.copyWind[b.slot] > 0) threat = true;
  }
  if (threat && fightPress(s).kind === "strike") {
    frame.web = !mem.holding;
    return frame;
  }
  frame.web = besideCaptive(s) && h.strike < 0;
  return frame;
}

/**
 * v4: the bot in a fight, on its feet. It sidesteps a dive or a lunge as it comes, a shot or a
 * fee bomb about to land on it, and keeps clear of Doc's arms and bread traps; with the villain
 * open it runs in and strikes (or zips in from further out), and while he guards it circles at
 * a distance. It never swings in a fight.
 */
function fightFrame(s: SimState, mem: BotMemory, shot: InputFrame["shot"], dt: number): InputFrame {
  const h = s.hero;
  const v = s.villain!;
  if (s.chapter && s.chapter.phase === "rescue" && s.mode === "fight") return rescueFrame(s, mem, shot);
  const frame: InputFrame = { dir: 0, mag: 0, web: false, shot };
  const t = nearestTarget(s, h.x, h.y, h.z) ?? { x: v.x, y: v.y, z: v.z, r: v.radius, body: -1 };
  const dx = t.x - h.x;
  const dz = t.z - h.z;
  const hd = len2(dx, dz);
  const gap = len3(dx, t.y - h.y, dz) - t.r - 26;
  // Case File 001: a paper copy in the way is always worth a blow.
  const open = (takesHit(v) || (v.kind === "right-clicker" && t.body >= 0)) && s.mode === "fight";
  mem.dodgeT = Math.max(0, mem.dodgeT - dt);

  // Case File 001: out of the SCREENSHOT's cone, sideways; a blow breaks the DRAG.
  if (v.kind === "right-clicker" && s.mode === "fight" && s.chapter) {
    const c = s.chapter;
    if (mem.dodgeT <= 0 && v.phase === "aim" && inShotCone(s, v)) {
      mem.dodgeT = 0.3;
      mem.dodgeDir = sideways(s, c.aimX, c.aimZ, mem.circle);
    }
    if (v.phase === "drag" && mem.dodgeT <= 0) {
      const press = fightPress(s);
      if (press.kind === "strike" || press.kind === "zip") {
        frame.dir = dirIndex(v.x - h.x, v.z - h.z);
        frame.mag = 3;
        frame.web = !mem.holding;
        return frame;
      }
    }
  }

  // Threats first: a dive or a lunge in flight at us, a shot closing in, a bomb coming down.
  if (mem.dodgeT <= 0 && s.mode === "fight") {
    const lunging = (v.kind === "gas-goblin" || v.kind === "sandwich-man") && v.phase === "dash";
    if (lunging && len3(v.x - h.x, v.y - h.y, v.z - h.z) < 520) {
      mem.dodgeT = 0.45;
      mem.dodgeDir = sideways(s, v.vx || -dx, v.vz || -dz, mem.circle);
    } else {
      for (const z of s.hazards) {
        if (z.kind === "goo") {
          const rx = h.x - z.x;
          const rz = h.z - z.z;
          const sp = len2(z.vx, z.vz) || 1;
          const ahead = (rx * z.vx + rz * z.vz) / sp;
          const miss = Math.abs(rx * z.vz - rz * z.vx) / sp;
          if (ahead > 0 && ahead < 240 && miss < 70) {
            mem.dodgeT = 0.3;
            mem.dodgeDir = sideways(s, z.vx, z.vz, mem.circle);
            break;
          }
        } else if (z.kind === "bomb") {
          // Where it lands: a fall under the bombs' 900 u/s² (less on the first nights).
          const fall = Math.max(0, z.y - h.y);
          const g = 900 * (1 - 0.3 * mercy(v.level));
          const tl = (z.vy + Math.sqrt(z.vy * z.vy + 2 * g * fall)) / g;
          const lx = z.x + z.vx * tl - h.x;
          const lz = z.z + z.vz * tl - h.z;
          if (len2(lx, lz) < 130) {
            mem.dodgeT = 0.35;
            mem.dodgeDir = dirIndex(-lx || 1, -lz);
            break;
          }
        }
      }
    }
  }
  if (mem.dodgeT > 0) {
    frame.dir = mem.dodgeDir;
    frame.mag = 3;
    return frame;
  }

  let dir = dirIndex(dx, dz);
  let mag = 0;
  const docArms = v.kind === "doc-octochain" && !docVulnerable(v);
  if (docArms) {
    // Out of his arms' reach along the bridge (he follows, so keep moving).
    const along = (h.x - v.x) * v.ax + (h.z - v.z) * v.az;
    if (Math.abs(along) < DOC_CLEAR) {
      const away = along >= 0 ? 1 : -1;
      const st = s.city.zones[s.index]?.stage;
      const end = st ? (v.ax ? (away > 0 ? st.x1 - h.x : h.x - st.x0) : away > 0 ? st.z1 - h.z : h.z - st.z0) : 999;
      // Cornered at the end of the deck: run past him the other way instead.
      const go = end < 80 ? -away : away;
      dir = dirIndex(v.ax * go, v.az * go);
      mag = 3;
    }
  } else if (open) {
    // In for the blow.
    if (gap > 40) mag = 3;
  } else if (hd < SPACING) {
    // He's guarding: circle out to a distance.
    const out = hd > 1 ? 1 : 0;
    dir = dirIndex(-dx * out - dz * mem.circle * 0.6, -dz * out + dx * mem.circle * 0.6);
    mag = 3;
  } else if (hd > SPACING + 120) mag = 2;
  // Round an armed bread trap in the way.
  if (mag > 0) {
    const [ux, uz] = DIR64[dir];
    for (const z of s.hazards) {
      if (z.kind !== "trap" || z.state === "closed") continue;
      const tx = z.x - h.x;
      const tz = z.z - h.z;
      const along = tx * ux + tz * uz;
      if (along > 0 && along < 150 && Math.abs(tx * uz - tz * ux) < z.r + 40) {
        dir = dirIndex(-tz * mem.circle, tx * mem.circle);
        break;
      }
    }
  }
  frame.dir = mag ? dir : 0;
  frame.mag = mag;
  // The web: a strike in reach, a zip from further out, only into an opening; a tap each time.
  const press = fightPress(s);
  if (open && (press.kind === "strike" || press.kind === "zip") && !mem.holding) frame.web = true;
  // Now and then circle the other way.
  if (s.tick % 300 === 0) mem.circle = -mem.circle;
  return frame;
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
  // The watchdog measures one goal: the stop, or (Case File 001) each clue in turn.
  const goalKey = s.chapter ? s.index * 8 + s.chapter.clues.filter((k) => k.found).length : s.index;
  if (mem.stop !== goalKey) {
    mem.stop = goalKey;
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
  // v4: fights are fought on foot.
  if (fight && s.villain) {
    const f = fightFrame(s, mem, shot, dt);
    mem.holding = f.web;
    mem.ropeT = 0;
    mem.hangT = 0;
    return f;
  }

  const v = s.villain;
  const t = fight ? (nearestTarget(s, h.x, h.y, h.z) ?? (v ? { x: v.x, y: v.y, z: v.z, r: v.radius, body: -1 } : null)) : null;
  // Doc with his arms out: keep clear and wait for the opening.
  const open = v ? isVulnerable(v) : true;

  // The stick: at the stop (or a pickup on the way) while travelling, toward or away from him in fights.
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
    } else {
      // v3: steer, or nothing moves (no auto-run): at a pickup on the way, else the stop.
      const g = travelGoal(s);
      if (g && len2(g.x - h.x, g.z - h.z) > 1) {
        dir = dirIndex(g.x - h.x, g.z - h.z);
        mag = 3;
      }
    }
  }
  const frame: InputFrame = { dir: mag ? dir : 0, mag, web: false, shot };
  const head = heroHeading(s, frame);

  let hold = mem.holding;
  if (h.rope) {
    const speed = len3(h.vx, h.vy, h.vz);
    const hs = len2(h.vx, h.vz);
    const perfect = h.vy > 110 && hs > 120 && speed > 480 && h.vy >= hs * TAN_LO && h.vy <= hs * TAN_HI;
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
    // On a roof, always press: a web, or with nothing in reach a jump (v3: only the web takes off).
    hold = h.grounded || (ok && h.vy < 80);
  }
  // Held on the ground with nothing taking: let go a tick, so the next press jumps.
  if (hold && h.grounded && !h.rope && mem.holding) {
    mem.groundT += dt;
    if (mem.groundT > 0.3) {
      hold = false;
      mem.groundT = 0;
    }
  } else mem.groundT = 0;
  mem.holding = hold;
  frame.web = hold;
  return frame;
}
