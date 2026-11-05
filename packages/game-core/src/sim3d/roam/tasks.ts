/**
 * The city's people and things to find, in free roam: talking (the interact button), the four
 * side tasks, Daily Rug pages and viewpoints, Mary Jpeg's pixels, Bearson's photos, and the
 * pickpocket bot's run over the roofs.
 *
 * - Interact picks one thing in this order (actTarget, which the HUD's prompt reads too): the
 *   nearest person in reach; a Gas Goblin tag in frame while Bearson wants photos; a viewpoint's
 *   perch underfoot.
 * - Pages and pixels are picked up by touching them; the bot by catching it.
 *
 * Deterministic: plain arithmetic in a fixed order; lines are picked by rules/city.ts talkLine.
 */
import { BREAD_WARM_SECONDS, talkLine } from "../../rules/city";
import { lineClear } from "../city";
import { HERO_RADIUS } from "../constants";
import { len2, len3 } from "../dmath";
import type { SimState } from "../types";
import {
  BOT_CATCH,
  BOT_HOP_GRAVITY,
  BOT_PANIC,
  BOT_PANIC_NEAR,
  BOT_RUN,
  BOT_WAIT_BACK,
  BOT_WAIT_FAR,
  PHOTO_CONE,
  PHOTO_RANGE,
  PICK_REACH,
  PICK_TALL,
  SYNC_REACH,
  TALK_REACH,
  TALK_RISE,
} from "./constants";
import { canTalk, type Presses } from "./move";
import { TASK_DONE, TASK_IDS, type RoamFolk, type RoamRoof, type TaskId } from "./types";

const R = HERO_RADIUS;
/** A line stays up this long (ticks), or until he walks away. */
export const CHAT_TICKS = 300;
const CHAT_LEAVE = 260;
const ti = (id: TaskId) => TASK_IDS.indexOf(id);

/** What the interact button would do right now. */
export type ActTarget = { kind: "talk"; folk: number } | { kind: "photo"; tag: number } | { kind: "sync"; view: number } | null;

/** The nearest person in reach (across and up or down), or −1. */
function folkInReach(s: SimState): number {
  const h = s.hero;
  const feet = h.y - R;
  let best = -1;
  let bd = TALK_REACH;
  for (const f of s.roam!.world.folks) {
    const dy = feet - f.y;
    if (dy > TALK_RISE || dy < -TALK_RISE) continue;
    const d = len2(f.x - h.x, f.z - h.z);
    if (d < bd) {
      bd = d;
      best = f.id;
    }
  }
  return best;
}

/** A tag Bearson still wants, in frame: in range, in front of its wall, the hero facing it, in plain sight. */
function tagInFrame(s: SimState): number {
  const r = s.roam!;
  if (r.progress.stage[ti("graffiti")] !== 1) return -1;
  const h = s.hero;
  const got = r.progress.items[ti("graffiti")];
  let best = -1;
  let bd = PHOTO_RANGE;
  r.world.tags.forEach((t, i) => {
    if (got & (1 << i)) return;
    const dx = t.x - h.x;
    const dy = t.y - h.y;
    const dz = t.z - h.z;
    const d = len3(dx, dy, dz);
    if (d >= bd) return;
    // Out in front of the wall, and facing it.
    if (-(dx * t.nx + dz * t.nz) < 40) return;
    const dh = len2(dx, dz);
    if (dh < 1 || (dx * h.fx + dz * h.fz) / dh < PHOTO_CONE) return;
    if (!lineClear(s.grid, h.x, h.y + 20, h.z, t.x + t.nx * 6, t.y, t.z + t.nz * 6)) return;
    bd = d;
    best = i;
  });
  return best;
}

/** A viewpoint not yet synced, its perch underfoot. */
function viewHere(s: SimState): number {
  const r = s.roam!;
  const h = s.hero;
  const feet = h.y - R;
  for (let i = 0; i < r.world.views.length; i++) {
    const v = r.world.views[i];
    if (r.progress.views & (1 << i)) continue;
    if (len2(v.x - h.x, v.z - h.z) < SYNC_REACH && feet - v.y < 40 && feet - v.y > -30) return i;
  }
  return -1;
}

/** What the interact button would do now (the HUD's prompt shows it): talk, photograph or sync. */
export function actTarget(s: SimState): ActTarget {
  if (!s.roam) return null;
  if (canTalk(s)) {
    const f = folkInReach(s);
    if (f >= 0) return { kind: "talk", folk: f };
  }
  const t = tagInFrame(s);
  if (t >= 0) return { kind: "photo", tag: t };
  const v = viewHere(s);
  if (v >= 0) return { kind: "sync", view: v };
  return null;
}

/** One tick of the city's people and things. */
export function stepPeople(s: SimState, press: Presses, dt: number) {
  const r = s.roam!;
  const p = r.progress;
  const h = s.hero;
  if (r.chat) {
    r.chat.ticks -= 1;
    const f = r.world.folks[r.chat.folk];
    if (r.chat.ticks <= 0 || len2(f.x - h.x, f.z - h.z) > CHAT_LEAVE) r.chat = null;
  }
  if (p.stage[ti("bread")] === 1) p.breadT += dt;
  if (press.act) act(s);
  pickUp(s);
  stepBot(s, dt);
}

function act(s: SimState) {
  const r = s.roam!;
  const t = actTarget(s);
  if (!t) {
    r.events.push({ type: "roam-nothing" });
    return;
  }
  if (t.kind === "talk") talk(s, r.world.folks[t.folk]);
  else if (t.kind === "photo") {
    const g = ti("graffiti");
    const tag = r.world.tags[t.tag];
    r.progress.items[g] |= 1 << t.tag;
    const got = bits(r.progress.items[g]);
    r.events.push({ type: "roam-item", task: "graffiti", item: t.tag, got, of: r.world.tags.length, x: tag.x, y: tag.y, z: tag.z });
    if (got >= r.world.tags.length) setStage(s, "graffiti", 2);
  } else {
    const v = r.world.views[t.view];
    r.progress.views |= 1 << t.view;
    r.events.push({ type: "roam-sync", view: t.view, x: v.x, y: v.y, z: v.z });
  }
}

function setStage(s: SimState, id: TaskId, stage: number) {
  const r = s.roam!;
  r.progress.stage[ti(id)] = stage;
  r.events.push({ type: "roam-task", task: id, stage, done: stage === TASK_DONE });
}

const bits = (n: number) => {
  let c = 0;
  for (let v = n >>> 0; v; v &= v - 1) c += 1;
  return c;
};

/** Talk to someone: their line, and whatever it moves on in their task. */
function talk(s: SimState, f: RoamFolk) {
  const r = s.roam!;
  const p = r.progress;
  const task = f.gives ?? f.takes;
  const stage = task ? p.stage[ti(task)] : 0;
  let line = talkLine(f.key, stage, p.talks[f.id] ?? 0);
  if (task === "bread") {
    if (f.gives === "bread" && stage === 0) {
      setStage(s, "bread", 1);
      p.breadT = 0;
    } else if (f.takes === "bread" && stage === 1) {
      line = talkLine(f.key, stage, p.talks[f.id] ?? 0, { warm: p.breadT <= BREAD_WARM_SECONDS });
      setStage(s, "bread", TASK_DONE);
    }
  } else if (task === "pickpocket") {
    if (stage === 0) {
      setStage(s, "pickpocket", 1);
      releaseBot(s);
    } else if (stage === 2) setStage(s, "pickpocket", TASK_DONE);
  } else if (task === "pixels" || task === "graffiti") {
    if (stage === 0) setStage(s, task, 1);
    else if (stage === 2) setStage(s, task, TASK_DONE);
  }
  p.talks[f.id] = (p.talks[f.id] ?? 0) + 1;
  r.chat = { folk: f.id, line, ticks: CHAT_TICKS };
  r.events.push({ type: "roam-talk", folk: f.id, line, task });
}

/** Touching a page, or one of Mary's pixels while she's looking for them. */
function pickUp(s: SimState) {
  const r = s.roam!;
  const p = r.progress;
  const h = s.hero;
  const touch = (x: number, y: number, z: number) => {
    const dy = h.y - (y + 24);
    return len2(x - h.x, z - h.z) < PICK_REACH && dy < PICK_REACH * PICK_TALL && dy > -PICK_REACH * PICK_TALL;
  };
  const pages = r.world.pages;
  for (let i = 0; i < pages.length; i++) {
    if (p.pages & (1 << i)) continue;
    const pg = pages[i];
    if (!touch(pg.x, pg.y, pg.z)) continue;
    p.pages |= 1 << i;
    r.events.push({ type: "roam-page", page: i, got: bits(p.pages), of: pages.length, x: pg.x, y: pg.y, z: pg.z });
  }
  const px = ti("pixels");
  if (p.stage[px] !== 1) return;
  const pixels = r.world.pixels;
  for (let i = 0; i < pixels.length; i++) {
    if (p.items[px] & (1 << i)) continue;
    const q = pixels[i];
    if (!touch(q.x, q.y, q.z)) continue;
    p.items[px] |= 1 << i;
    const got = bits(p.items[px]);
    r.events.push({ type: "roam-item", task: "pixels", item: i, got, of: pixels.length, x: q.x, y: q.y, z: q.z });
    if (got >= pixels.length) setStage(s, "pixels", 2);
  }
}

/* ------------------------------------------------------------------ the pickpocket bot */

/** The bot's centre above its feet (it's about 60 tall). */
export const BOT_HALF = 30;

function releaseBot(s: SimState) {
  const r = s.roam!;
  const b = r.bot;
  const path = r.world.botPath;
  if (!path.length) return;
  b.state = 1;
  b.leg = 0;
  b.part = 0;
  b.u = 0;
  b.x = path[0].x;
  b.y = path[0].y;
  b.z = path[0].z;
  r.events.push({ type: "roam-bot", state: "out", x: b.x, y: b.y, z: b.z });
}

/** Where a straight run from a roof's middle toward (tx, tz) leaves its rectangle (inset a little). */
function exitPoint(a: RoamRoof, tx: number, tz: number): { x: number; z: number } {
  const dx = tx - a.x;
  const dz = tz - a.z;
  let t = 1;
  const inset = 8;
  if (dx > 1e-9) t = Math.min(t, (a.x1 - inset - a.x) / dx);
  else if (dx < -1e-9) t = Math.min(t, (a.x0 + inset - a.x) / dx);
  if (dz > 1e-9) t = Math.min(t, (a.z1 - inset - a.z) / dz);
  else if (dz < -1e-9) t = Math.min(t, (a.z0 + inset - a.z) / dz);
  t = t < 0 ? 0 : t;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

/** The leg from roof i to the next round the loop: out to the edge, the hop, in to the middle. */
function leg(path: RoamRoof[], i: number) {
  const a = path[i % path.length];
  const b = path[(i + 1) % path.length];
  const out = exitPoint(a, b.x, b.z);
  const into = exitPoint(b, a.x, a.z);
  const gap = len2(into.x - out.x, into.z - out.z);
  return { a, b, out, into, gap, hop: Math.max(0.32, gap / BOT_RUN) };
}

function stepBot(s: SimState, dt: number) {
  const r = s.roam!;
  const b = r.bot;
  const path = r.world.botPath;
  const stage = r.progress.stage[ti("pickpocket")];
  if (b.state === 0 || b.state === 3 || !path.length) {
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    return;
  }
  if (stage !== 1) return;
  const h = s.hero;
  const px = b.x;
  const py = b.y;
  const pz = b.z;
  const d = len3(h.x - b.x, h.y - (b.y + BOT_HALF), h.z - b.z);
  if (d < BOT_CATCH) {
    // Caught: it powers down where it is (on the nearer roof, if it was mid-hop).
    if (b.part === 1) {
      const l = leg(path, b.leg);
      const near = b.u < l.hop / 2 ? { x: l.out.x, y: l.a.y, z: l.out.z } : { x: l.into.x, y: l.b.y, z: l.into.z };
      b.x = near.x;
      b.y = near.y;
      b.z = near.z;
    }
    b.state = 3;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    r.events.push({ type: "roam-bot", state: "caught", x: b.x, y: b.y, z: b.z });
    r.progress.stage[ti("pickpocket")] = 2;
    r.events.push({ type: "roam-task", task: "pickpocket", stage: 2, done: false });
    return;
  }
  // Too far behind: it waits on its roof (taunting) until he closes in.
  if (b.part !== 1) {
    if (b.state === 1 && d > BOT_WAIT_FAR) b.state = 2;
    else if (b.state === 2 && d < BOT_WAIT_BACK) b.state = 1;
  }
  if (b.state === 2) {
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    return;
  }
  const speed = d < BOT_PANIC_NEAR ? BOT_PANIC : BOT_RUN;
  const l = leg(path, b.leg);
  if (b.part === 0) {
    const len = len2(l.out.x - l.a.x, l.out.z - l.a.z);
    b.u += speed * dt;
    const k = len > 1e-9 ? Math.min(1, b.u / len) : 1;
    b.x = l.a.x + (l.out.x - l.a.x) * k;
    b.z = l.a.z + (l.out.z - l.a.z) * k;
    b.y = l.a.y;
    if (k >= 1) {
      b.part = 1;
      b.u = 0;
    }
  } else if (b.part === 1) {
    b.u += dt;
    const u = Math.min(1, b.u / l.hop);
    // A ballistic arc under BOT_HOP_GRAVITY, from the edge to the next roof's edge.
    const T = l.hop;
    const vy0 = (l.b.y - l.a.y) / T + 0.5 * BOT_HOP_GRAVITY * T;
    const t = u * T;
    b.x = l.out.x + (l.into.x - l.out.x) * u;
    b.z = l.out.z + (l.into.z - l.out.z) * u;
    b.y = l.a.y + vy0 * t - 0.5 * BOT_HOP_GRAVITY * t * t;
    if (u >= 1) {
      b.part = 2;
      b.u = 0;
      b.y = l.b.y;
    }
  } else {
    const len = len2(l.b.x - l.into.x, l.b.z - l.into.z);
    b.u += speed * dt;
    const k = len > 1e-9 ? Math.min(1, b.u / len) : 1;
    b.x = l.into.x + (l.b.x - l.into.x) * k;
    b.z = l.into.z + (l.b.z - l.into.z) * k;
    b.y = l.b.y;
    if (k >= 1) {
      b.leg = (b.leg + 1) % path.length;
      b.part = 0;
      b.u = 0;
    }
  }
  b.vx = (b.x - px) / dt;
  b.vy = (b.y - py) / dt;
  b.vz = (b.z - pz) / dt;
}
