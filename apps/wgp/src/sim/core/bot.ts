/**
 * A scripted player for checks and the debug autopilot: holds to web when falling,
 * lets go in the perfect window, and in fights flies at the villain and uses its powers.
 * It only reads the state and queues inputs, like a person would.
 */
import { abilityBlocked, gweiBlocked } from "./abilities";
import { docVulnerable, isVulnerable, nearestTarget } from "./combat";
import { bestAnchor } from "./hero";
import { queueAbility, queueGwei } from "./sim";
import type { SimInput, SimState } from "./types";

export interface BotMemory {
  hangT: number;
  abilityT: number;
  holding: boolean;
  /** Best x reached recently, and how long since it improved (a stuck watchdog). */
  bestX: number;
  stuckT: number;
  /** How long the current web has been held. */
  ropeT: number;
}

export const newBotMemory = (): BotMemory => ({ hangT: 0, abilityT: 0, holding: false, bestX: -Infinity, stuckT: 0, ropeT: 0 });

const DEG = 180 / Math.PI;

function pickAbilities(s: SimState, mem: BotMemory) {
  const v = s.villain;
  const h = s.hero;
  if (mem.abilityT > 0) return;
  if (s.mode === "travel") {
    // Now and then, use a travel power so mastery from swinging gets exercised too.
    const fr = s.powers.findIndex((p) => p.id === "front-run");
    if (fr >= 0 && !abilityBlocked(s, fr) && h.vy > 0 && s.fluid > 60) {
      queueAbility(s, fr);
      mem.abilityT = 3;
    }
    return;
  }
  if (s.mode !== "fight" || !v) return;
  const t = nearestTarget(s, h.x, h.y);
  const dist = t ? Math.hypot(t.x - h.x, t.y - h.y) : Infinity;
  const guarded = v.kind === "doc-octochain" && !docVulnerable(v);
  if (!gweiBlocked(s) && (v.boss || s.hp < s.maxHp * 0.4)) {
    queueGwei(s);
    mem.abilityT = 0.5;
    return;
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
      case "front-run":
        go = !!t && !guarded && Math.abs(t.y - h.y) < 120 && Math.sign(t.x - h.x) === h.facing && dist < 600;
        break;
    }
    if (go) {
      queueAbility(s, i);
      mem.abilityT = 0.35;
      return;
    }
  }
}

/** The bot's input for the next step (and any ability commands, queued on the state). */
export function botInput(s: SimState, mem: BotMemory, dt: number): SimInput {
  mem.abilityT = Math.max(0, mem.abilityT - dt);
  const h = s.hero;
  if (s.mode === "errand" || s.mode === "done" || s.mode === "ko") return { hold: false, steer: 0 };
  pickAbilities(s, mem);
  const fight = s.mode === "fight" || s.mode === "intro";
  if (fight || h.x > mem.bestX + 40) {
    mem.bestX = Math.max(mem.bestX, h.x);
    mem.stuckT = 0;
  } else {
    mem.stuckT += dt;
  }
  const t = fight ? nearestTarget(s, h.x, h.y) : null;
  // Doc with his arms out: keep clear and wait for the opening.
  const open = s.villain ? isVulnerable(s.villain) : true;
  const facing: 1 | -1 = fight ? (t ? (t.x >= h.x ? 1 : -1) : h.facing) : 1;
  let steer = 0;
  if (fight && t && Math.abs(t.x - h.x) > 160 && !h.grounded) steer = facing;
  if (fight && t && !open && Math.abs(t.x - h.x) < 420) steer = -facing as 1 | -1;

  let hold = mem.holding;
  if (h.rope) {
    const speed = Math.hypot(h.vx, h.vy);
    const dir = fight ? (h.vx >= 0 ? 1 : -1) : 1;
    const fx = h.vx * dir;
    const ang = Math.atan2(h.vy, Math.max(1e-6, fx)) * DEG;
    const perfect = h.vy > 150 && fx > 120 && speed > 570 && ang > 20 && ang < 68;
    mem.hangT = speed < 160 ? mem.hangT + dt : 0;
    mem.ropeT += dt;
    let let_go = perfect;
    // In a fight, a swing that isn't going anywhere is worth dropping for a better one.
    if (fight && mem.ropeT > 2.4 && h.vy > -100) let_go = true;
    if (fight && t && open) {
      // Fly at the villain: let go when moving straight at him.
      const want = Math.atan2(t.y - h.y, t.x - h.x);
      const have = Math.atan2(h.vy, h.vx);
      let diff = Math.abs(want - have);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      const dist = Math.hypot(t.x - h.x, t.y - h.y);
      if (speed > 520 && diff < 0.3 && dist < 650) let_go = true;
    }
    if (!fight && h.vy > 0 && h.x > h.rope.x + h.rope.len * 0.7) let_go = true;
    // Past the anchor and rising forward: a good release beats dangling.
    if (!fight && h.vy > 60 && h.vx > 150 && h.x > h.rope.x + 20 && mem.stuckT > 1.5) let_go = true;
    if (mem.hangT > 1.2 || mem.stuckT > 4) let_go = true;
    hold = !let_go;
    if (!hold) mem.ropeT = 0;
  } else if (fight && t && s.villain) {
    mem.ropeT = 0;
    // Aim a slam by timing the web: grab when the swing's circle passes through him.
    const a = bestAnchor(s, facing);
    mem.hangT += dt;
    if (a) {
      const rope = Math.hypot(a.x - h.x, a.y - h.y);
      const reach = Math.hypot(a.x - t.x, a.y - t.y);
      const lined = open && Math.abs(rope - reach) < 70 && t.y < a.y;
      hold = lined || h.y < 200 || (h.grounded && mem.hangT > 0.6) || (h.vy < -500 && mem.hangT > 1);
    } else hold = false;
    if (hold) mem.hangT = 0;
  } else {
    // Stuck under an anchor behind you: let it go and fall to something ahead.
    const a = bestAnchor(s, facing);
    const ok = !!a && (mem.stuckT < 2 || a.x > h.x + 40);
    hold = ok && (h.grounded || h.vy < 80);
  }
  mem.holding = hold;
  return { hold, steer };
}
