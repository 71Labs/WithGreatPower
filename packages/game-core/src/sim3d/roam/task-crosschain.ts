/**
 * Cross-chain (roam-3), Uncle Gen's side task: Doc Octochain has bolted cross-chain relays to the
 * city's highest points, and they're draining Aunt Mainnet's node.
 *
 * - Stage 0 → 1: Uncle Gen tells you (tasks.ts talk). Stage 1: unplug the four relays. Stage 2:
 *   tell him they're down; he gives a speech, and it's done (TASK_DONE). `items` holds the relays
 *   unplugged, as bits (by their index in RoamWorld.relays).
 * - The relays sit on real tops, each a climb: the apex of the crane by Uncle Gen (up the
 *   skyscraper beside it and along its jib), the west tower of Doc's bridge (up a leg from the
 *   street, hanging from the cap), the antenna on the tallest building, and Doc's deck tower (the
 *   bridge's east tower). Each is a box, solid as drawn (world.ts adds it to roam's grid).
 * - Unplugging: interact held RELAY_HOLD ticks (1.5 s) within reach (RELAY_REACH across,
 *   RELAY_RISE up or down, on his feet, on a wall or hanging from a ledge). The relay fights back:
 *   at RELAY_SPARKS ticks into the hold it sparks and shoves him back a step (RELAY_KNOCK, slow
 *   enough that a roof's edge still stops him); a hold under way keeps its relay RELAY_KEEP
 *   further out, so the shove alone never breaks it. Letting go (a frame without interact, out
 *   of reach, knocked off his feet) resets that relay's progress.
 * - How a hold is logged: the interact one-shot (SHOT_ACT) is sent every tick the button is down,
 *   as sprint is (constants.ts). RoamHold.act remembers last tick's, so a talk, a photo or a sync
 *   takes only a hold's first tick (step.ts) and a relay takes every tick of it.
 *
 * Deterministic: plain arithmetic in a fixed order, the hold's state on RoamState.hold (hashed).
 */
import type { City, Prop, RoamMark, Vec3 } from "../contract";
import { len2 } from "../dmath";
import { canTalk } from "../parkour/move";
import type { SimState } from "../types";
import { MAST_HALF, poleHalf, turnLocal, type SolidBox } from "./furniture";
import { TASK_IDS, type RoamRelay } from "./types";

/** Ticks interact must be held to unplug a relay (1.5 s at 60 Hz). */
export const RELAY_HOLD = 90;
/** Ticks into a hold the relay sparks and shoves him back. */
export const RELAY_SPARKS: readonly number[] = [30, 60];
/** Within reach: the body's centre this far across from the relay's, and this far up or down. */
export const RELAY_REACH = 78;
export const RELAY_RISE = 92;
/**
 * A hold once begun keeps its relay this much further out (across and up or down), so a spark's
 * shove never pulls it out of the hands of a hero who started at the edge of reach.
 */
export const RELAY_KEEP = 30;
/**
 * The shove a spark gives (units a second, away from the relay, on his feet only): about a step.
 * Friction takes it under EDGE_WALK on the next tick, so a roof's edge (or a crane's jib) stops him.
 */
export const RELAY_KNOCK = 210;
/** A relay's box: half its width across, half its height (a big junction box, about 0.5 by 0.6 m). */
export const RELAY_HALF = 12;
export const RELAY_HALF_Y = 15;
/**
 * A bridge tower's relay stands this far in from its leg's outer face (to its box's near side):
 * clear of where a climber pulls up onto the cap (his body, R across, on the cap's middle line
 * just in from the edge), within reach of one hanging from the cap's lip.
 */
const CAP_IN = 30;

const CX = TASK_IDS.indexOf("crosschain");

const bits = (n: number) => {
  let c = 0;
  for (let v = n >>> 0; v; v &= v - 1) c += 1;
  return c;
};

/* ------------------------------------------------------------------ where they are */

/** A relay box (centre, half sizes), its front, and where its chains are bolted on. */
function relay(key: RoamRelay["key"], x: number, y: number, z: number, fx: number, fz: number, a: Vec3): RoamRelay {
  return { key, x, y, z, hx: RELAY_HALF, hy: RELAY_HALF_Y, hz: RELAY_HALF, fx, fz, ax: a.x, ay: a.y, az: a.z };
}

/** The crane nearest Uncle Gen: the relay sits on its apex (the short pole over the jibs), facing out along the jib. */
function craneRelay(city: City, near: { x: number; z: number }): RoamRelay | null {
  let best: Prop | null = null;
  for (const p of city.props) {
    if (p.kind !== "crane") continue;
    if (!best || len2(p.at.x - near.x, p.at.z - near.z) < len2(best.at.x - near.x, best.at.z - near.z)) best = p;
  }
  if (!best) return null;
  // The apex: furniture.ts propSolids' 6-wide pole from top + 12 (the jib's top) to top + 52.
  const top = best.at.y + best.h;
  const jib = turnLocal(best.facing, 0, 1);
  return relay("crane", best.at.x, top + 52 + RELAY_HALF_Y, best.at.z, jib.x, jib.z, { x: best.at.x, y: top + 12, z: best.at.z });
}

/**
 * Doc's bridge's two towers (each pair of legs under one cap): a relay on each cap, over its
 * outer leg, set far enough in from the leg's face that a scramble up that face still pulls up
 * onto the cap in front of it (the cap is narrower than a mantle's reach, so he lands on its
 * middle line where he grabbed), and near enough that a climber hanging from the cap's lip can
 * reach it too. The first tower along the deck is "bridge", the second Doc's deck tower.
 */
function bridgeRelays(city: City): RoamRelay[] {
  const br = city.bridge;
  if (!br) return [];
  const dk = br.deck;
  const alongX = br.axis ? br.axis === "x" : dk.x1 - dk.x0 >= dk.z1 - dk.z0;
  const half = br.towerHalf ?? 25;
  const U = (p: { x: number; z: number }) => (alongX ? p.x : p.z);
  const V = (p: { x: number; z: number }) => (alongX ? p.z : p.x);
  const P = (u: number, v: number) => (alongX ? { x: u, z: v } : { x: v, z: u });
  const groups: Vec3[][] = [];
  for (const t of br.towers) {
    const g = groups.find((q) => Math.abs(U(q[0]) - U(t)) < half * 2);
    if (g) g.push(t);
    else groups.push([t]);
  }
  const towers = groups.filter((g) => g.length >= 2).sort((a, b) => U(a[0]) - U(b[0]));
  const out: RoamRelay[] = [];
  towers.slice(0, 2).forEach((g, k) => {
    const u = g.reduce((sum, t) => sum + U(t), 0) / g.length;
    const top = Math.min(...g.map((t) => t.y));
    // The first tower's relay at its low-v end, the second's at its high-v end (both bank sides covered).
    const vs = g.map(V);
    const end = k === 0 ? Math.min(...vs) - half : Math.max(...vs) + half;
    const out1 = k === 0 ? -1 : 1;
    const at = P(u, end - out1 * (RELAY_HALF + CAP_IN));
    const face = P(0, out1);
    const bolt = P(u, end);
    // On the cap (furniture.ts: from the legs' top, 24 thick).
    out.push(relay(k === 0 ? "bridge" : "deck", at.x, top + 24 + RELAY_HALF_Y, at.z, face.x, face.z, { x: bolt.x, y: top - 60, z: bolt.z }));
  });
  return out;
}

/**
 * The tallest building's tallest plain antenna (not a sync mast): the relay bolted to its side near
 * the top, on the side with the most roof in front of it to stand on.
 */
function antennaRelay(city: City): RoamRelay | null {
  const roofTop = (b: City["buildings"][number]) => (b.top ? b.top.h : b.h);
  let tallest: City["buildings"][number] | null = null;
  for (const b of city.buildings) if (!tallest || roofTop(b) > roofTop(tallest)) tallest = b;
  if (!tallest) return null;
  const y = roofTop(tallest);
  const roof = tallest.top ?? tallest;
  const own = city.props.filter((p) => p.buildingId === tallest!.id && Math.abs(p.at.y - y) < 0.5);
  let pole: Prop | null = null;
  for (const p of own) if (p.kind === "antenna" && p.w < MAST_HALF * 2 && (!pole || p.h > pole.h)) pole = p;
  if (!pole) return null;
  const half = poleHalf(pole);
  const { x, z } = pole.at;
  // Room in front of each side: to the roof's edge, or to the nearest other prop in the way.
  const sides: [number, number][] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  let best = sides[0];
  let room = -Infinity;
  for (const [sx, sz] of sides) {
    let free = sx > 0 ? roof.x1 - x : sx < 0 ? x - roof.x0 : sz > 0 ? roof.z1 - z : z - roof.z0;
    for (const q of own) {
      if (q === pole) continue;
      const ax = (q.at.x - x) * sx + (q.at.z - z) * sz;
      const lat = Math.abs((q.at.x - x) * sz - (q.at.z - z) * sx);
      if (ax > 0 && lat < 40) free = Math.min(free, ax - Math.max(q.w, q.d, 18) / 2);
    }
    if (free > room) {
      room = free;
      best = [sx, sz];
    }
  }
  const top = y + pole.h;
  const cy = top - 11 - RELAY_HALF_Y;
  return relay("antenna", x + best[0] * (half + RELAY_HALF), cy, z + best[1] * (half + RELAY_HALF), best[0], best[1], { x, y: y + 12, z });
}

/** The four relays, in a fixed order (their bits in `items`): the crane, the bridge's west tower, the antenna, Doc's deck tower. */
export function placeRelays(city: City, uncle: { x: number; z: number }): RoamRelay[] {
  const crane = craneRelay(city, uncle);
  const [bridge, deck] = bridgeRelays(city);
  const antenna = antennaRelay(city);
  return [crane, bridge ?? null, antenna, deck ?? null].filter((r): r is RoamRelay => r !== null);
}

/** The relays' boxes, solid as drawn (world.ts adds them to roam's grid after the furniture). */
export function relaySolids(relays: readonly RoamRelay[]): SolidBox[] {
  return relays.map((r) => ({ x0: r.x - r.hx, y0: r.y - r.hy, z0: r.z - r.hz, x1: r.x + r.hx, y1: r.y + r.hy, z1: r.z + r.hz }));
}

/* ------------------------------------------------------------------ the hold */

/**
 * The relay he could unplug now (the task under way, not yet unplugged, in reach, the body able),
 * or −1. The one he's holding stays in reach RELAY_KEEP further out.
 */
export function relayInReach(s: SimState): number {
  const r = s.roam!;
  if (r.progress.stage[CX] !== 1 || !canTalk(s)) return -1;
  const got = r.progress.items[CX];
  const h = s.hero;
  let best = -1;
  let bd = Infinity;
  const list = r.world.relays;
  for (let i = 0; i < list.length; i++) {
    if (got & (1 << i)) continue;
    const rl = list[i];
    const keep = i === r.hold.relay ? RELAY_KEEP : 0;
    const dy = h.y - rl.y;
    if (dy > RELAY_RISE + keep || dy < -RELAY_RISE - keep) continue;
    const d = len2(rl.x - h.x, rl.z - h.z);
    if (d < RELAY_REACH + keep && d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/**
 * One tick of a hold. `held`: interact down this tick; `relay`: the relay the interact button
 * would work on now (tasks.ts actTarget's "unplug"), or −1. Progress builds while both hold, and
 * resets the moment either doesn't.
 */
export function stepRelays(s: SimState, held: boolean, relay: number): void {
  const r = s.roam!;
  const hold = r.hold;
  const target = held ? relay : -1;
  if (target !== hold.relay) {
    if (hold.relay >= 0 && hold.ticks > 0) {
      const was = r.world.relays[hold.relay];
      r.events.push({ type: "roam-relay", relay: hold.relay, state: "reset", x: was.x, y: was.y, z: was.z });
    }
    hold.relay = target;
    hold.ticks = 0;
  }
  if (target < 0) return;
  const rl = r.world.relays[target];
  hold.ticks += 1;
  if (hold.ticks === 1) r.events.push({ type: "roam-relay", relay: target, state: "hold", x: rl.x, y: rl.y, z: rl.z });
  if (RELAY_SPARKS.includes(hold.ticks)) {
    r.events.push({ type: "roam-relay", relay: target, state: "spark", x: rl.x, y: rl.y, z: rl.z });
    shove(s, rl);
  }
  if (hold.ticks < RELAY_HOLD) return;
  // Unplugged.
  hold.relay = -1;
  hold.ticks = 0;
  const p = r.progress;
  p.items[CX] = (p.items[CX] | (1 << target)) >>> 0;
  const got = bits(p.items[CX]);
  r.events.push({ type: "roam-relay", relay: target, state: "unplugged", x: rl.x, y: rl.y, z: rl.z });
  r.events.push({ type: "roam-item", task: "crosschain", item: target, got, of: r.world.relays.length, x: rl.x, y: rl.y, z: rl.z });
  if (got >= r.world.relays.length) {
    p.stage[CX] = 2;
    r.events.push({ type: "roam-task", task: "crosschain", stage: 2, done: false });
  }
}

/** A spark's shove: on his feet, a step back from the relay (out along its front if he's right under it). */
function shove(s: SimState, rl: RoamRelay) {
  if (s.roam!.body.move !== "ground") return;
  const h = s.hero;
  let dx = h.x - rl.x;
  let dz = h.z - rl.z;
  const d = len2(dx, dz);
  if (d < 1) {
    dx = rl.fx;
    dz = rl.fz;
  } else {
    dx /= d;
    dz /= d;
  }
  h.vx += dx * RELAY_KNOCK;
  h.vz += dz * RELAY_KNOCK;
}

/* ------------------------------------------------------------------ the render frame */

/** A map mark (RoamFrame.marks, render contract v1.9: contract.ts's one RoamMark). */
export type { RoamMark };

/**
 * Cross-chain's marks from slot `n` on (the relays while the task is under way: stage 1 or 2), the
 * nearest still plugged in flagged `next`. Returns the next free slot. Slots are reused in place.
 */
export function fillRelayMarks(s: SimState, out: RoamMark[], n: number): number {
  const r = s.roam!;
  const stage = r.progress.stage[CX];
  if (stage !== 1 && stage !== 2) return n;
  const got = r.progress.items[CX];
  const h = s.hero;
  let next = -1;
  let nd = Infinity;
  const list = r.world.relays;
  for (let i = 0; i < list.length; i++) {
    if (got & (1 << i)) continue;
    const d = len2(list[i].x - h.x, list[i].z - h.z);
    if (d < nd) {
      nd = d;
      next = i;
    }
  }
  for (let i = 0; i < list.length; i++) {
    const rl = list[i];
    const m = out[n] ?? (out[n] = { task: "crosschain", kind: "relay", pos: { x: 0, y: 0, z: 0 }, done: false, next: false });
    m.task = "crosschain";
    m.kind = "relay";
    m.pos.x = rl.x;
    m.pos.y = rl.y;
    m.pos.z = rl.z;
    m.done = (got & (1 << i)) !== 0;
    m.next = i === next;
    n++;
  }
  return n;
}

/** The hold for the frame (RoamFrame.relay): which relay, and how far it's unplugged (0–1), or null. */
export function relayHold(s: SimState): { index: number; progress: number } | null {
  const hold = s.roam!.hold;
  return hold.relay >= 0 ? { index: hold.relay, progress: Math.min(1, hold.ticks / RELAY_HOLD) } : null;
}
