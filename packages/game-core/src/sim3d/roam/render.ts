/**
 * Free roam's part of the render frame (RenderFrame3D.roam, v1.6), filled in place after the
 * night's own fillRenderFrame: the body's move, the zip reticle, the bot, the people, what's
 * found, the cars and a knock (roam-2), and the hero's `action` read off the move for the
 * animator. Presentation only: nothing here is read back by the sim or hashed.
 */
import { HERO_RADIUS } from "../constants";
import type { HeroAction, RenderFrame3D, RoamFrame, Vec3 } from "../contract";
import { datan2, len2 } from "../dmath";
import { knockPhase } from "./knock";
import type { SimState } from "../types";
import { roamHeading } from "../parkour/move";
import { actTarget } from "./tasks";
import { TASK_IDS } from "./types";
import { zipTarget } from "../parkour/zip";

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const set = (o: Vec3, x: number, y: number, z: number) => {
  o.x = x;
  o.y = y;
  o.z = z;
};

const bits = (n: number) => {
  let c = 0;
  for (let v = n >>> 0; v; v &= v - 1) c += 1;
  return c;
};

/** The hero's `action` word for a roam move (the animator's base state; RoamFrame.move has the rest). */
export function roamAction(s: SimState): HeroAction {
  const b = s.roam!.body;
  const h = s.hero;
  switch (b.move) {
    case "ground":
      return len2(h.vx, h.vz) > 30 ? "run" : "idle";
    case "roll":
      return "run";
    case "swing":
      return "swing";
    case "climb":
    case "hang":
    case "mantle":
      return "climb";
    case "zip":
      return "dash";
    case "knocked":
      return s.roam!.traffic.knock.down < 0 ? "air" : "idle";
    default:
      return "air";
  }
}

interface Track {
  action: HeroAction;
  start: number;
}
const tracks = new WeakMap<SimState, Track>();

function emptyRoam(): RoamFrame {
  return { move: "ground", moveT: 0, sprint: false, wall: null, path: null, zip: null, bot: null, folks: [], chat: null, act: null, pages: [], views: [], pixels: [], tags: [], tasks: [], cars: [], knock: null };
}

/** Write the outing into `out.roam` (and the hero's action off the move). A night's state leaves it null. */
export function fillRoamFrame(s: SimState, out: RenderFrame3D): RenderFrame3D {
  const r = s.roam;
  if (!r) {
    out.roam = null;
    return out;
  }
  const h = s.hero;
  const b = r.body;
  const f = out.roam ?? (out.roam = emptyRoam());
  f.move = b.move;
  f.moveT = b.moveT;
  f.sprint = b.sprintT > 0;

  // The animator's word for it, and how long it's lasted.
  const action = roamAction(s);
  let t = tracks.get(s);
  if (!t) tracks.set(s, (t = { action, start: s.tick }));
  if (t.action !== action) {
    t.action = action;
    t.start = s.tick;
  }
  out.hero.action = action;
  out.hero.actionTicks = s.tick - t.start;
  out.hero.grounded = b.move === "ground" || b.move === "roll" || (b.move === "knocked" && r.traffic.knock.down >= 0);
  // A zip's web, stuck where it pulls him: the roof's edge he lands over, or the perch's top.
  if (b.move === "zip") {
    const a = out.hero.anchor ?? (out.hero.anchor = v3());
    if (b.land === 1) set(a, b.bx, b.by - HERO_RADIUS, b.bz);
    else set(a, b.bx - b.wnx * (HERO_RADIUS + 6), b.by - HERO_RADIUS - 8, b.bz - b.wnz * (HERO_RADIUS + 6));
  }

  if (b.move === "climb" || b.move === "hang" || b.move === "mantle" || b.move === "wallrun") {
    const w = f.wall ?? (f.wall = { nx: 0, nz: 0, top: 0 });
    w.nx = b.wnx;
    w.nz = b.wnz;
    w.top = b.wtop;
  } else f.wall = null;
  if (b.move === "vault" || b.move === "mantle" || b.move === "zip") {
    const p = f.path ?? (f.path = { from: v3(), to: v3(), u: 0 });
    set(p.from, b.ax, b.ay, b.az);
    set(p.to, b.bx, b.by, b.bz);
    p.u = b.dur > 0 ? Math.min(1, b.moveT / b.dur) : 1;
  } else f.path = null;

  // The reticle: where a zip would go along the stick (or the way he's going, or faces).
  const canZip = b.move !== "mantle" && b.move !== "vault" && b.move !== "zip" && b.move !== "splash";
  let zt = null;
  if (canZip) {
    const head = roamHeading(s);
    zt = zipTarget(s, head.x, head.z);
  }
  if (zt) set(f.zip ?? (f.zip = v3()), zt.x, zt.y, zt.z);
  else f.zip = null;

  const bot = r.bot;
  if (bot.state === 0) f.bot = null;
  else {
    const fb = f.bot ?? (f.bot = { pos: v3(), vel: v3(), state: "running" });
    set(fb.pos, bot.x, bot.y, bot.z);
    set(fb.vel, bot.vx, bot.vy, bot.vz);
    fb.state = bot.state === 3 ? "caught" : bot.state === 2 ? "waiting" : "running";
  }

  const folks = r.world.folks;
  for (let i = 0; i < folks.length; i++) {
    const p = folks[i];
    const slot = f.folks[i] ?? (f.folks[i] = { id: p.id, key: p.key, pos: v3(), yaw: p.yaw, body: p.body, cast: p.cast, talking: false });
    slot.id = p.id;
    slot.key = p.key;
    set(slot.pos, p.x, p.y, p.z);
    slot.yaw = p.yaw;
    slot.body = p.body;
    slot.cast = p.cast;
    slot.talking = !!r.chat && r.chat.folk === p.id;
  }
  f.folks.length = folks.length;

  if (r.chat) {
    const c = f.chat ?? (f.chat = { folk: 0, line: 0, left: 0 });
    c.folk = r.chat.folk;
    c.line = r.chat.line;
    const who = folks[r.chat.folk];
    const task = who?.gives ?? who?.takes;
    const ti = task ? TASK_IDS.indexOf(task) : -1;
    const of = task === "pixels" ? r.world.pixels.length : task === "graffiti" ? r.world.tags.length : 0;
    c.left = ti >= 0 ? Math.max(0, of - bits(r.progress.items[ti])) : 0;
  } else f.chat = null;

  const a = actTarget(s);
  if (a) {
    const fa = f.act ?? (f.act = { kind: "talk", index: 0 });
    fa.kind = a.kind;
    fa.index = a.kind === "talk" ? a.folk : a.kind === "photo" ? a.tag : a.view;
  } else f.act = null;

  const p = r.progress;
  const fill = (list: { pos: Vec3; found: boolean }[], spots: readonly { x: number; y: number; z: number }[], got: number) => {
    for (let i = 0; i < spots.length; i++) {
      const slot = list[i] ?? (list[i] = { pos: v3(), found: false });
      set(slot.pos, spots[i].x, spots[i].y, spots[i].z);
      slot.found = (got & (1 << i)) !== 0;
    }
    list.length = spots.length;
  };
  fill(f.pages, r.world.pages, p.pages);
  fill(f.pixels, r.world.pixels, p.items[TASK_IDS.indexOf("pixels")]);
  const views = r.world.views;
  for (let i = 0; i < views.length; i++) {
    const slot = f.views[i] ?? (f.views[i] = { pos: v3(), roof: 0, synced: false });
    set(slot.pos, views[i].x, views[i].y, views[i].z);
    slot.roof = views[i].roof;
    slot.synced = (p.views & (1 << i)) !== 0;
  }
  f.views.length = views.length;
  const tags = r.world.tags;
  const shot = p.items[TASK_IDS.indexOf("graffiti")];
  for (let i = 0; i < tags.length; i++) {
    const slot = f.tags[i] ?? (f.tags[i] = { pos: v3(), normal: v3(), shot: false });
    set(slot.pos, tags[i].x, tags[i].y, tags[i].z);
    set(slot.normal, tags[i].nx, 0, tags[i].nz);
    slot.shot = (shot & (1 << i)) !== 0;
  }
  f.tags.length = tags.length;
  for (let i = 0; i < TASK_IDS.length; i++) {
    const slot = f.tasks[i] ?? (f.tasks[i] = { id: TASK_IDS[i], stage: 0, got: 0 });
    slot.id = TASK_IDS[i];
    slot.stage = p.stage[i];
    slot.got = bits(p.items[i]);
  }
  f.tasks.length = TASK_IDS.length;

  // roam-2: the cars as the sim has them, and a knock's phase.
  const cars = f.cars ?? (f.cars = []);
  const tr = r.traffic;
  for (let i = 0; i < tr.cars.length; i++) {
    const c = tr.cars[i];
    const slot = cars[i] ?? (cars[i] = { id: i, pos: v3(), yaw: 0, speed: 0, kind: 0 });
    slot.id = i;
    set(slot.pos, c.x, tr.loops[c.loop].y, c.z);
    slot.yaw = datan2(c.hx, c.hz);
    slot.speed = c.v;
    slot.kind = c.kind;
  }
  cars.length = tr.cars.length;
  const kp = knockPhase(s);
  if (kp) {
    const k = f.knock ?? (f.knock = { phase: "flung", t: 0, dir: v3() });
    k.phase = kp.phase;
    k.t = kp.t;
    set(k.dir, tr.knock.dx, 0, tr.knock.dz);
  } else f.knock = null;
  return out;
}
