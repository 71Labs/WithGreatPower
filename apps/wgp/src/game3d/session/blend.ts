/**
 * Drawing between ticks. The loop keeps the last two ticks' RenderFrame3Ds (filled by
 * game-core's fillRenderFrame) and writes the frame the scene reads as a blend of them,
 * in place: positions slide by `alpha`, everything else (velocity, facing, the animation
 * state words and their ages, Doc's arms, the Goblin's bank; v1.3's pickups, combo, route and
 * the hero's `controlled`; v1.5's chapter and a villain's aim, though the paper copies slide)
 * is the latest tick's. A jump too
 * big for one tick (a teleport beside an errand ally, a resume) snaps instead of sliding.
 * Allocates only when a list grows.
 */
import type { RenderFrame3D, Vec3, VoteFrame } from "@wgp/game-core/sim3d/contract";

/** More than this in one tick is a teleport, not motion (top speed is ~28 units a tick). */
export const SNAP_DISTANCE = 200;

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

function lerpInto(out: Vec3, a: Vec3 | undefined, b: Vec3, t: number) {
  if (!a) {
    out.x = b.x;
    out.y = b.y;
    out.z = b.z;
    return;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  if (dx * dx + dy * dy + dz * dz > SNAP_DISTANCE * SNAP_DISTANCE) t = 1;
  out.x = a.x + dx * t;
  out.y = a.y + dy * t;
  out.z = a.z + dz * t;
}

const copyInto = (out: Vec3, v: Vec3) => {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
};

/** Copies an optional vector into `out`'s slot, reusing it; clears the slot when absent. */
function copyOptional(v: Vec3 | undefined, slot: Vec3 | undefined): Vec3 | undefined {
  if (!v) return undefined;
  const out = slot ?? v3();
  copyInto(out, v);
  return out;
}

/** Whether the hero moved further than one tick allows between the two frames. */
export function teleported(prev: RenderFrame3D, curr: RenderFrame3D): boolean {
  const a = prev.hero.pos;
  const b = curr.hero.pos;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz > SNAP_DISTANCE * SNAP_DISTANCE;
}

/** Copy `src` into `out` field by field (no shared objects), so `src` can be refilled. */
export function copyFrame(src: RenderFrame3D, out: RenderFrame3D): RenderFrame3D {
  return blendFrame(src, src, 1, out);
}

/** Write the frame `alpha` of the way from `prev` to `curr` into `out`. */
export function blendFrame(prev: RenderFrame3D, curr: RenderFrame3D, alpha: number, out: RenderFrame3D): RenderFrame3D {
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  out.tick = curr.tick;
  out.alpha = t;
  out.stop = curr.stop;
  out.mode = curr.mode;
  out.timeScale = curr.timeScale;

  const h = out.hero;
  const c = curr.hero;
  lerpInto(h.pos, prev.hero.pos, c.pos, t);
  copyInto(h.vel, c.vel);
  if (c.anchor) {
    h.anchor = h.anchor ?? v3();
    copyInto(h.anchor, c.anchor);
  } else h.anchor = null;
  h.grounded = c.grounded;
  h.hp = c.hp;
  h.maxHp = c.maxHp;
  h.fluid = c.fluid;
  h.hurtFlash = c.hurtFlash;
  h.shield = c.shield;
  h.facing = copyOptional(c.facing, h.facing);
  h.action = c.action;
  h.actionTicks = c.actionTicks;
  h.ropeLen = c.ropeLen;
  h.cloak = c.cloak;
  h.controlled = c.controlled;

  // v1.3 (ruleset 3): pickups never move, so they're copied as they are; the combo and the route too.
  if (curr.pickups) {
    const ps = (out.pickups ??= []);
    for (let i = 0; i < curr.pickups.length; i++) {
      const cp = curr.pickups[i];
      const slot = (ps[i] ??= { id: cp.id, kind: cp.kind, pos: v3(), taken: cp.taken });
      slot.id = cp.id;
      slot.kind = cp.kind;
      copyInto(slot.pos, cp.pos);
      slot.taken = cp.taken;
    }
    ps.length = curr.pickups.length;
  } else delete out.pickups;
  if (curr.combo) {
    const combo = (out.combo ??= { count: 0, multiplier: 1, ticksLeft: 0 });
    combo.count = curr.combo.count;
    combo.multiplier = curr.combo.multiplier;
    combo.ticksLeft = curr.combo.ticksLeft;
  } else delete out.combo;
  if (curr.route) {
    const route = (out.route ??= []);
    for (let i = 0; i < curr.route.length; i++) copyInto((route[i] ??= v3()), curr.route[i]);
    route.length = curr.route.length;
  } else delete out.route;

  const vs = out.villains;
  for (let i = 0; i < curr.villains.length; i++) {
    const cv = curr.villains[i];
    const pv = prev.villains[i];
    const slot = vs[i] ?? { id: cv.id, copy: cv.copy, pos: v3(), hits: 0, hitsMax: 0, state: "" };
    slot.id = cv.id;
    slot.copy = cv.copy;
    lerpInto(slot.pos, pv && pv.id === cv.id && pv.copy === cv.copy ? pv.pos : undefined, cv.pos, t);
    slot.hits = cv.hits;
    slot.hitsMax = cv.hitsMax;
    slot.state = cv.state;
    slot.vel = copyOptional(cv.vel, slot.vel);
    slot.facing = copyOptional(cv.facing, slot.facing);
    slot.stateTicks = cv.stateTicks;
    slot.bank = cv.bank;
    // v1.5: the Right-Clicker's SCREENSHOT cone (absent for the patrol villains).
    if (cv.aim) {
      const aim = (slot.aim ??= { dir: v3(), half: cv.aim.half });
      copyInto(aim.dir, cv.aim.dir);
      aim.half = cv.aim.half;
    } else if (cv.aim === null) slot.aim = null;
    else delete slot.aim;
    if (cv.arms) {
      const same = pv && pv.id === cv.id && pv.copy === cv.copy && pv.arms?.length === cv.arms.length;
      const arms = (slot.arms ??= []);
      for (let a = 0; a < cv.arms.length; a++) {
        const arm = (arms[a] ??= { from: v3(), to: v3() });
        lerpInto(arm.from, same ? pv.arms![a].from : undefined, cv.arms[a].from, t);
        lerpInto(arm.to, same ? pv.arms![a].to : undefined, cv.arms[a].to, t);
      }
      arms.length = cv.arms.length;
    } else delete slot.arms;
    vs[i] = slot;
  }
  vs.length = curr.villains.length;

  const hz = out.hazards;
  for (let i = 0; i < curr.hazards.length; i++) {
    const ch = curr.hazards[i];
    const ph = prev.hazards[i];
    const same = ph && ph.kind === ch.kind;
    const slot = hz[i] ?? { kind: ch.kind, pos: v3(), r: 0, armed: false };
    slot.kind = ch.kind;
    lerpInto(slot.pos, same ? ph.pos : undefined, ch.pos, t);
    slot.r = ch.r;
    slot.armed = ch.armed;
    if (ch.to) {
      slot.to = slot.to ?? v3();
      lerpInto(slot.to, same ? ph.to : undefined, ch.to, t);
    } else delete slot.to;
    hz[i] = slot;
  }
  hz.length = curr.hazards.length;
  blendChapter(prev, curr, t, out);
  return out;
}

/** v1.5: a chapter night's clues, captive and paper copies; the copies slide, the rest is the latest tick's. */
function blendChapter(prev: RenderFrame3D, curr: RenderFrame3D, t: number, out: RenderFrame3D) {
  const cc = curr.chapter;
  if (!cc) {
    if (cc === undefined) delete out.chapter;
    else out.chapter = null;
    return;
  }
  const oc = (out.chapter ??= { id: cc.id, phase: cc.phase, clues: [], captive: null, copies: [] });
  oc.id = cc.id;
  oc.phase = cc.phase;
  for (let i = 0; i < cc.clues.length; i++) {
    const k = cc.clues[i];
    const slot = (oc.clues[i] ??= { id: k.id, pos: v3(), found: k.found });
    slot.id = k.id;
    copyInto(slot.pos, k.pos);
    slot.found = k.found;
  }
  oc.clues.length = cc.clues.length;
  if (cc.captive) {
    const cap = (oc.captive ??= { pos: v3(), restore: 0, freed: false });
    copyInto(cap.pos, cc.captive.pos);
    cap.restore = cc.captive.restore;
    cap.freed = cc.captive.freed;
  } else oc.captive = null;
  const pc = prev.chapter?.copies;
  for (let i = 0; i < cc.copies.length; i++) {
    const k = cc.copies[i];
    const p = pc?.[i];
    const slot = (oc.copies[i] ??= { id: k.id, pos: v3(), yaw: k.yaw, alive: k.alive });
    slot.id = k.id;
    lerpInto(slot.pos, p && p.id === k.id ? p.pos : undefined, k.pos, t);
    slot.yaw = k.yaw;
    slot.alive = k.alive;
  }
  oc.copies.length = cc.copies.length;
  if (cc.vote) oc.vote = blendVote(prev.chapter?.vote ?? null, cc.vote, t, oc.vote ?? null);
  else delete oc.vote;
}

/** v1.6: Case file 002's vote. The voters (by id) and the ballot slide with their bodies; the rest is the latest tick's. */
function blendVote(prev: VoteFrame | null, curr: VoteFrame, t: number, into: VoteFrame | null): VoteFrame {
  const out: VoteFrame = into ?? { ...curr, real: { ...curr.real }, known: { ...curr.known }, voters: [], booths: [], fork: null, recount: null, box: v3(), ballot: null };
  out.stage = curr.stage;
  Object.assign(out.real, curr.real);
  Object.assign(out.known, curr.known);
  for (let i = 0; i < curr.voters.length; i++) {
    const k = curr.voters[i];
    const p = prev?.voters[i];
    const slot = (out.voters[i] ??= { ...k, pos: v3() });
    Object.assign(slot, { id: k.id, alive: k.alive, runner: k.runner, shadow: k.shadow, blink: k.blink, left: k.left });
    lerpInto(slot.pos, p && p.id === k.id ? p.pos : undefined, k.pos, t);
  }
  out.voters.length = curr.voters.length;
  for (let i = 0; i < curr.booths.length; i++) copyInto((out.booths[i] ??= v3()), curr.booths[i]);
  out.booths.length = curr.booths.length;
  out.wrong = curr.wrong;
  out.fork = curr.fork ? Object.assign(out.fork ?? { ...curr.fork }, curr.fork) : null;
  out.recount = curr.recount ? Object.assign(out.recount ?? { left: 0 }, curr.recount) : null;
  copyInto(out.box, curr.box);
  if (curr.ballot) {
    const b = (out.ballot ??= { state: curr.ballot.state, pos: v3() });
    lerpInto(b.pos, prev?.ballot && prev.ballot.state === curr.ballot.state ? prev.ballot.pos : undefined, curr.ballot.pos, t);
    b.state = curr.ballot.state;
  } else out.ballot = null;
  return out;
}
