/**
 * The bot on Case File 002's polling station (bot.ts hands it every fight-mode frame there).
 * It reads the screen like a player: the tells the clues revealed, the voters' looks, the
 * fork vote's split and the ballots in the air.
 *
 * - The lineup: to the voter whose look matches what it knows (the nearest of them if it
 *   knows less than all three tells), and a fresh press beside him; after a wrong one, the next.
 * - The fight: across the split while a fork vote is called and it stands on the orphaned side
 *   (or, with one copy to pop for the quorum to fail and one in reach, that copy); sideways off
 *   a ballot about to land; a blow on a copy in reach, or on him when he's open; otherwise it
 *   circles a few steps off. In the recount, the one whose look matches.
 * - The rescue: after the runner (a blow or a zip), then the ballot to the box.
 */
import type { InputFrame } from "./contract";
import { DT } from "./constants";
import { takesHit } from "./combat";
import { dirIndex, len2, len3 } from "./dmath";
import { fightPress } from "./strike";
import { FORK_SAFE, forkSideOf, forkVotes } from "./sybil-vote";
import type { SimState, SybilBody } from "./types";
import { knownTells, liveCopies, realBody } from "./vote";

/** What the vote bot remembers between frames (kept on BotMemory.vote). */
export interface VoteBotMemory {
  /** The web was down last frame (a press is a fresh one). */
  holding: boolean;
  /** The lineup: which side of a voter's row to come at him from (±1), and ticks without getting closer. */
  side: number;
  stuck: number;
  lastGap: number;
  /** A sidestep under way: seconds left and its DIR64 heading. */
  dodgeT: number;
  dodgeDir: number;
  circle: number;
}

export const newVoteBotMemory = (): VoteBotMemory => ({ holding: false, side: 0, stuck: 0, lastGap: Infinity, dodgeT: 0, dodgeDir: 0, circle: 1 });

/**
 * The lineup: to the front or back of `b`'s row (the side the hero's on; the other after a
 * second without getting closer), then a fresh press once the blow would land on him.
 */
export function boothFrame(s: SimState, b: SybilBody, mem: VoteBotMemory, frame: InputFrame): InputFrame {
  const h = s.hero;
  const v = s.villain!;
  const gap = len3(b.x - h.x, b.y - h.y, b.z - h.z) - v.radius - 26;
  if (gap < mem.lastGap - 2) {
    mem.lastGap = gap;
    mem.stuck = 0;
  } else if ((mem.stuck += 1) > 60) {
    mem.side = mem.side > 0 ? -1 : 1;
    mem.stuck = 0;
    mem.lastGap = Infinity;
  }
  if (!mem.side) mem.side = h.z >= b.z ? 1 : -1;
  const px = b.x;
  const pz = b.z + mem.side * 64;
  const dx = px - h.x;
  const dz = pz - h.z;
  const press = fightPress(s);
  const onHim = press.kind === "strike" && v.bodies[press.target.body] === b;
  if (onHim) frame.web = !mem.holding;
  else if (len2(dx, dz) > 10) {
    frame.dir = dirIndex(dx, dz);
    frame.mag = len2(dx, dz) > 60 ? 3 : 2;
  }
  return frame;
}

/** The bodies whose look fits what's known (`known` bits of the real one's `real` look). */
export function suspects(s: SimState, known = knownTells(s)): SybilBody[] {
  const vt = s.chapter!.vote!;
  const v = s.villain;
  if (!v) return [];
  return v.bodies.filter((b) => b.alive && b.slot !== vt.runner && ((vt.tells[b.slot] ?? 0) & known) === (vt.real & known));
}

/** The nearest of `bodies` to the hero. */
export function nearestOf(s: SimState, bodies: SybilBody[]): SybilBody | null {
  const h = s.hero;
  let best: SybilBody | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    const d = len2(b.x - h.x, b.z - h.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** To `b` and a fresh press once the blow would land on him (and not a neighbour). */
export function markFrame(s: SimState, b: SybilBody, mem: VoteBotMemory, frame: InputFrame): InputFrame {
  const h = s.hero;
  const v = s.villain!;
  const dx = b.x - h.x;
  const dz = b.z - h.z;
  const gap = len3(dx, b.y - h.y, dz) - v.radius - 26;
  if (gap > 14) {
    let wx = dx;
    let wz = dz;
    // Round a voter standing in the way (the booths' rows, the recount's ring).
    const d = len2(dx, dz) || 1;
    for (const o of v.bodies) {
      if (!o.alive || o === b) continue;
      const ox = o.x - h.x;
      const oz = o.z - h.z;
      const along = (ox * dx + oz * dz) / d;
      const across = (ox * dz - oz * dx) / d;
      if (along > 0 && along < d && across < 80 && across > -80) {
        const away = across >= 0 ? -1 : 1;
        wx = (dz / d) * away * 1.2 + dx / d;
        wz = (-dx / d) * away * 1.2 + dz / d;
        break;
      }
    }
    frame.dir = dirIndex(wx, wz);
    frame.mag = gap > 60 ? 3 : 2;
  }
  const press = fightPress(s);
  if (press.kind === "strike" && v.bodies[press.target.body] === b) frame.web = !mem.holding;
  return frame;
}

/** The DIR64 heading across the fork vote's split, onto the canonical side. */
function acrossSplit(s: SimState): number {
  const vt = s.chapter!.vote!;
  return vt.forkAxis === 0 ? dirIndex(-vt.forkSide, 0) : dirIndex(0, -vt.forkSide);
}

/** A goo ballot about to hit: the DIR64 sidestep off its line, or −1. */
function gooDodge(s: SimState, circle: number): number {
  const h = s.hero;
  for (const z of s.hazards) {
    if (z.kind !== "goo") continue;
    const rx = h.x - z.x;
    const rz = h.z - z.z;
    const sp = len2(z.vx, z.vz) || 1;
    const ahead = (rx * z.vx + rz * z.vz) / sp;
    const miss = Math.abs(rx * z.vz - rz * z.vx) / sp;
    if (ahead > 0 && ahead < 220 && miss < 60) return dirIndex((-z.vz / sp) * circle, (z.vx / sp) * circle);
  }
  return -1;
}

/** One frame of Case File 002's fight mode (lineup, standoff, rescue). */
export function voteFightFrame(s: SimState, mem: VoteBotMemory, shot: InputFrame["shot"], known = knownTells(s), dt = DT): InputFrame {
  const h = s.hero;
  const c = s.chapter!;
  const vt = c.vote!;
  const v = s.villain!;
  const frame: InputFrame = { dir: 0, mag: 0, web: false, shot };
  const done = (f: InputFrame) => {
    mem.holding = f.web;
    return f;
  };
  mem.dodgeT = Math.max(0, mem.dodgeT - dt);
  if (s.mode !== "fight") return done({ ...frame, shot: 0 });

  if (c.phase === "lineup") {
    const b = nearestOf(s, suspects(s, known));
    return done(b ? boothFrame(s, b, mem, frame) : frame);
  }

  if (c.phase === "rescue") {
    if (vt.ballot === 0) {
      const runner = v.bodies.find((b) => b.slot === vt.runner && b.alive);
      if (runner) {
        frame.dir = dirIndex(runner.x - h.x, runner.z - h.z);
        frame.mag = 3;
        const press = fightPress(s);
        if ((press.kind === "strike" || press.kind === "zip") && !mem.holding) frame.web = true;
      }
      return done(frame);
    }
    const dx = vt.boxX - h.x;
    const dz = vt.boxZ - h.z;
    if (len2(dx, dz) > 30) {
      frame.dir = dirIndex(dx, dz);
      frame.mag = 3;
    }
    return done(frame);
  }

  // The standoff. The recount first: the one who looks like him.
  if (vt.stage === "recount") {
    const b = nearestOf(s, suspects(s, known));
    return done(b ? markFrame(s, b, mem, frame) : frame);
  }

  const r = realBody(v);
  // A fork vote called with us on the orphaned side: pop the last copy the quorum needs, else cross.
  if (vt.forkT > 0 && forkSideOf(vt, h.x, h.z) > -FORK_SAFE - 50) {
    const pops = forkVotes(v, vt) - vt.forkNeed + 1;
    const press = fightPress(s);
    const target = press.kind === "strike" ? v.bodies[press.target.body] : null;
    if (pops === 1 && target && !target.real && target.slot < vt.forkFrom) {
      frame.web = !mem.holding;
      return done(frame);
    }
    frame.dir = acrossSplit(s);
    frame.mag = 3;
    return done(frame);
  }
  // A ballot about to land.
  if (mem.dodgeT <= 0) {
    const d = gooDodge(s, mem.circle);
    if (d >= 0) {
      mem.dodgeT = 0.28;
      mem.dodgeDir = d;
    }
  }
  if (mem.dodgeT > 0) {
    frame.dir = mem.dodgeDir;
    frame.mag = 3;
    return done(frame);
  }
  const press = fightPress(s);
  const target = press.kind === "strike" || press.kind === "zip" ? v.bodies[press.target.body] : null;
  const open = takesHit(v);
  // A copy in the way is always worth a blow; him, only in an opening.
  if (target && (!target.real || open) && !mem.holding) {
    frame.web = true;
    frame.dir = dirIndex(target.x - h.x, target.z - h.z);
    frame.mag = 2;
    return done(frame);
  }
  const dx = r.x - h.x;
  const dz = r.z - h.z;
  const hd = len2(dx, dz);
  if (open) {
    frame.dir = dirIndex(dx, dz);
    frame.mag = 3;
  } else if (hd < 260) {
    frame.dir = dirIndex(-dx - dz * mem.circle * 0.6, -dz + dx * mem.circle * 0.6);
    frame.mag = 3;
  } else if (liveCopies(v, vt).length && hd > 380) {
    frame.dir = dirIndex(dx, dz);
    frame.mag = 2;
  }
  if (s.tick % 300 === 0) mem.circle = -mem.circle;
  return done(frame);
}
