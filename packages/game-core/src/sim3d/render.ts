/**
 * The scene's view of the sim: fill a RenderFrame3D from the state, in place, so the
 * session loop allocates nothing per frame (apart from growing the villain and hazard
 * lists the first time they're needed). Interpolation between ticks is the loop's job;
 * this writes the current tick.
 *
 * Presentation only: nothing here is read back by the sim or hashed. The v1.2 animation
 * fields that need history (how long an action or state has lasted, a villain's velocity
 * and smoothed facing) are tracked per run, keyed on the SimState, because the loop fills
 * two frame objects in turn and a counter kept on the frame would only see every other tick.
 */
import { DT } from "./constants";
import type { HeroAction, RenderFrame3D, Vec3, VoteFrame, VoteLook } from "./contract";
import { datan2, dcos, dsin, len2 } from "./dmath";
import { RESTORE_TICKS } from "./chapter";
import { inOpening } from "./combat";
import { chaseGap, MAX_LOSSES } from "./fee-chase";
import { meterHeat } from "./fee-strike";
import { spikeWindSeconds } from "./fee-strike-step";
import { comboMultiplier } from "./pickups";
import { rightClickerAim, rightClickerState } from "./right-clicker";
import { forkVotes, sybilVoteState } from "./sybil-vote";
import { knownTells, RECOUNT_SECONDS, voteHidden } from "./vote";
import { TELL_BIT } from "../rules/chapters";
import { armShoulder, armTip } from "./villains";
import type { SimState, Villain } from "./types";

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

export function newRenderFrame(): RenderFrame3D {
  return {
    tick: 0,
    alpha: 1,
    hero: {
      pos: v3(),
      vel: v3(),
      anchor: null,
      grounded: false,
      hp: 0,
      maxHp: 0,
      fluid: 0,
      hurtFlash: 0,
      shield: false,
      facing: { x: 1, y: 0, z: 0 },
      action: "idle",
      actionTicks: 0,
      ropeLen: 0,
      cloak: false,
      controlled: false,
    },
    villains: [],
    hazards: [],
    stop: 0,
    mode: "travel",
    timeScale: 1,
    pickups: [],
    combo: { count: 0, multiplier: 1, ticksLeft: 0 },
    route: [],
    chapter: null,
  };
}

const set = (o: Vec3, x: number, y: number, z: number) => {
  o.x = x;
  o.y = y;
  o.z = z;
};

/* ------------------------------------------------------------------ history, per run */

interface BodyTrack {
  /** Sybil's body index, or −1 for the villain himself. */
  key: number;
  state: string;
  stateStart: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fx: number;
  fz: number;
  tick: number;
}

interface Track {
  action: HeroAction;
  actionStart: number;
  /** The fight these bodies belong to (a new villain resets them). */
  villain: Villain | null;
  bodies: BodyTrack[];
}

const tracks = new WeakMap<SimState, Track>();

function trackOf(s: SimState): Track {
  let t = tracks.get(s);
  if (!t) {
    t = { action: heroAction(s), actionStart: s.tick, villain: null, bodies: [] };
    tracks.set(s, t);
  }
  return t;
}

/** A villain turns at most this fast in the frame (radians a second), so facing never flips in one tick. */
const VILLAIN_TURN = 9;
/** Above this horizontal speed a villain faces where it's going; slower, it faces the hero. */
const FACE_MOVING = 60;

function bodyTrack(t: Track, key: number, x: number, y: number, z: number, tick: number, fx: number, fz: number): BodyTrack {
  for (const b of t.bodies) if (b.key === key) return b;
  const l = len2(fx, fz);
  const b: BodyTrack = { key, state: "", stateStart: tick, x, y, z, vx: 0, vy: 0, vz: 0, fx: l > 1e-9 ? fx / l : 1, fz: l > 1e-9 ? fz / l : 0, tick };
  t.bodies.push(b);
  return b;
}

/** Turn the unit xz vector (b.fx, b.fz) toward (wx, wz) by at most `max` radians. */
function turnToward(b: BodyTrack, wx: number, wz: number, max: number) {
  const wl = len2(wx, wz);
  if (wl < 1e-9) return;
  const ux = wx / wl;
  const uz = wz / wl;
  const cross = b.fx * uz - b.fz * ux;
  const dot = b.fx * ux + b.fz * uz;
  const angle = datan2(cross, dot);
  if (angle <= max && angle >= -max) {
    b.fx = ux;
    b.fz = uz;
    return;
  }
  const step = angle > 0 ? max : -max;
  const c = dcos(step);
  const sn = dsin(step);
  const nx = b.fx * c - b.fz * sn;
  const nz = b.fx * sn + b.fz * c;
  const l = len2(nx, nz) || 1;
  b.fx = nx / l;
  b.fz = nz / l;
}

/* ------------------------------------------------------------------ the hero's action */

/** What the hero's body is doing, most specific first. */
export function heroAction(s: SimState): HeroAction {
  const h = s.hero;
  if (s.mode === "ko" || s.hp <= 0) return "ko";
  if (h.heldT > 0) return "held";
  if (h.hurtT > 0) return "hurt";
  if (h.slam > 0) return "slam";
  // v4: a web-zip draws as a dash, with the web out to the villain.
  if (h.dashT > 0 || h.zip >= 0) return "dash";
  if (h.rope) return h.climbing ? "climb" : "swing";
  if (h.grounded) return len2(h.vx, h.vz) > 30 ? "run" : "idle";
  return "air";
}

/* ------------------------------------------------------------------ villains */

/** The body a zip pulls the hero at (Sybil's copy or the villain), or null. */
function zipTarget(s: SimState): Vec3 | null {
  const v = s.villain!;
  const b = s.hero.strikeBody >= 0 ? v.bodies[s.hero.strikeBody] : null;
  if (b && b.alive) return b;
  return b ? null : v;
}

/** A short state word for a villain, for animation. */
function villainState(s: SimState): string {
  const v = s.villain!;
  if (v.kind === "right-clicker") return rightClickerState(s, v);
  if (s.chapter?.vote) return sybilVoteState(s, v);
  // Case File 003: the chase (travel), and webbed through the cooling.
  if (s.fee && (s.mode === "travel" || s.fee.phase === "cool" || s.fee.phase === "done")) return feeVillainState(s, v);
  if (s.mode === "won") return "webbed";
  if (v.stun > 0) return "stunned";
  // v4: Gas Goblin's stall and Sandwich Man's stumble are openings: they read as dazed.
  if (inOpening(v)) return "stunned";
  if (v.invuln > 0) return "guard";
  if (v.kind === "doc-octochain" && v.phase === "retract") return "open";
  switch (v.phase) {
    case "telegraph":
    case "slam-wind":
      return "windup";
    case "dash":
    case "slam":
    case "sweep":
      return "attack";
    default:
      return "idle";
  }
}

type VillainSlot = RenderFrame3D["villains"][number];

/** Fill one villain body's motion fields from its history: velocity, facing and state age. */
function motion(s: SimState, t: Track, slot: VillainSlot, key: number, state: string) {
  const v = s.villain!;
  const h = s.hero;
  const p = slot.pos;
  const b = bodyTrack(t, key, p.x, p.y, p.z, s.tick, h.x - p.x, h.z - p.z);
  if (b.state !== state) {
    b.state = state;
    b.stateStart = s.tick;
  }
  const gap = s.tick - b.tick;
  if (gap > 0 && gap <= 10) {
    const k = 1 / (gap * DT);
    b.vx = (p.x - b.x) * k;
    b.vy = (p.y - b.y) * k;
    b.vz = (p.z - b.z) * k;
  } else if (gap !== 0) {
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
  }
  // Where it wants to face: along its flight or run, else at the hero; Doc squares up across his bridge.
  let wx: number;
  let wz: number;
  if (v.kind === "doc-octochain") {
    const side = (h.x - p.x) * -v.az + (h.z - p.z) * v.ax >= 0 ? 1 : -1;
    wx = -v.az * side;
    wz = v.ax * side;
  } else if (len2(b.vx, b.vz) > FACE_MOVING) {
    wx = b.vx;
    wz = b.vz;
  } else {
    wx = h.x - p.x;
    wz = h.z - p.z;
  }
  if (gap > 0) turnToward(b, wx, wz, VILLAIN_TURN * DT * gap);
  b.x = p.x;
  b.y = p.y;
  b.z = p.z;
  b.tick = s.tick;
  slot.vel = slot.vel ?? v3();
  set(slot.vel, b.vx, b.vy, b.vz);
  slot.facing = slot.facing ?? v3();
  set(slot.facing, b.fx, 0, b.fz);
  slot.stateTicks = s.tick - b.stateStart;
}

function fillArms(v: Villain, slot: VillainSlot) {
  const arms = slot.arms ?? (slot.arms = []);
  for (let i = 0; i < v.arms.length; i++) {
    const seg = arms[i] ?? (arms[i] = { from: v3(), to: v3() });
    const a = armShoulder(v, i);
    const b = armTip(v, i);
    set(seg.from, a.x, a.y, a.z);
    set(seg.to, b.x, b.y, b.z);
  }
  arms.length = v.arms.length;
}

/* ------------------------------------------------------------------ the frame */

/** Write the state into `out` (tick, hero, villains, hazards, stop, mode; v1.3: pickups, combo, route). */
export function fillRenderFrame(s: SimState, out: RenderFrame3D, alpha = 1, timeScale = 1): RenderFrame3D {
  const h = s.hero;
  const t = trackOf(s);
  out.tick = s.tick;
  out.alpha = alpha;
  out.timeScale = timeScale;
  out.stop = s.index;
  out.mode = s.mode;
  set(out.hero.pos, h.x, h.y, h.z);
  set(out.hero.vel, h.vx, h.vy, h.vz);
  const zipTo = h.zip >= 0 && s.villain ? zipTarget(s) : null;
  if (h.rope) {
    out.hero.anchor = out.hero.anchor ?? v3();
    set(out.hero.anchor, h.rope.x, h.rope.y, h.rope.z);
  } else if (zipTo) {
    // v4: the zip's web, stuck to the villain it pulls you at.
    out.hero.anchor = out.hero.anchor ?? v3();
    set(out.hero.anchor, zipTo.x, zipTo.y, zipTo.z);
  } else out.hero.anchor = null;
  out.hero.grounded = h.grounded;
  out.hero.hp = s.hp;
  out.hero.maxHp = s.maxHp;
  out.hero.fluid = s.fluid;
  out.hero.hurtFlash = h.invuln;
  out.hero.shield = h.shieldT > 0;

  // v1.2: the body for the animator.
  const fl = len2(h.fx, h.fz) || 1;
  out.hero.facing = out.hero.facing ?? v3();
  set(out.hero.facing, h.fx / fl, 0, h.fz / fl);
  const action = heroAction(s);
  if (action !== t.action) {
    t.action = action;
    t.actionStart = s.tick;
  }
  out.hero.action = action;
  out.hero.actionTicks = s.tick - t.actionStart;
  out.hero.ropeLen = h.rope ? h.rope.len : 0;
  out.hero.cloak = h.cloakT > 0;
  // v1.3.
  out.hero.controlled = !h.idle;
  const ps = out.pickups ?? (out.pickups = []);
  for (let i = 0; i < s.pickups.length; i++) {
    const p = s.pickups[i];
    const slot = ps[i] ?? (ps[i] = { id: p.id, kind: p.kind, pos: v3(), taken: false });
    slot.id = p.id;
    slot.kind = p.kind;
    set(slot.pos, p.x, p.y, p.z);
    slot.taken = p.taken;
  }
  ps.length = s.pickups.length;
  const c = out.combo ?? (out.combo = { count: 0, multiplier: 1, ticksLeft: 0 });
  c.count = s.combo;
  c.multiplier = comboMultiplier(s.combo);
  c.ticksLeft = s.combo > 0 ? Math.max(0, s.comboT) : 0;
  const route = out.route ?? (out.route = []);
  const zones = s.city.zones;
  let r = 0;
  for (let i = s.index; i < zones.length; i++, r++) {
    // Where the hero is sent: an errand's ally, else the stop's centre (as stopTarget picks).
    const z = zones[i];
    const to = z.kind === "errand" ? (z.allyAt ?? z.center) : z.center;
    const at = route[r] ?? (route[r] = v3());
    set(at, to.x, to.y, to.z);
  }
  // A time trial (no zones): the gates still ahead.
  if (s.trial) {
    for (let i = s.trial.next; i < s.pickups.length; i++, r++) {
      const g = s.pickups[i];
      const at = route[r] ?? (route[r] = v3());
      set(at, g.x, g.y, g.z);
    }
  }
  route.length = r;

  const vs = out.villains;
  let n = 0;
  const v = s.villain;
  if (v !== t.villain) {
    t.villain = v;
    t.bodies.length = 0;
  }
  if (v) {
    const state = villainState(s);
    const push = (pos: Vec3, copy: boolean, key: number) => {
      const slot = vs[n] ?? { id: v.kind, copy, pos: v3(), hits: 0, hitsMax: 0, state };
      slot.id = v.kind;
      slot.copy = copy;
      set(slot.pos, pos.x, pos.y, pos.z);
      slot.hits = v.hits;
      slot.hitsMax = v.hitsMax;
      slot.state = state;
      motion(s, t, slot, key, state);
      slot.bank = v.kind === "gas-goblin" ? v.bank : 0;
      if (v.kind === "doc-octochain") fillArms(v, slot);
      else delete slot.arms;
      if (v.kind === "right-clicker") {
        // v1.5: the SCREENSHOT cone.
        const a = rightClickerAim(s, v);
        if (a) {
          const aim = slot.aim ?? (slot.aim = { dir: v3(), half: a.half });
          set(aim.dir, a.x, 0, a.z);
          aim.half = a.half;
        } else slot.aim = null;
      } else delete slot.aim;
      vs[n++] = slot;
    };
    // Case File 002: in the lineup and the recount he reads as one of the copies (v1.6).
    const hidden = voteHidden(s);
    if (v.kind === "sybil") v.bodies.forEach((b, i) => b.alive && push(b, !b.real || hidden, i));
    else push(v, false, -1);
  }
  vs.length = n;

  const hz = out.hazards;
  let m = 0;
  const put = (kind: string, x: number, y: number, z: number, r: number, armed: boolean, to?: Vec3) => {
    const slot = hz[m] ?? { kind, pos: v3(), r, armed };
    slot.kind = kind;
    set(slot.pos, x, y, z);
    slot.r = r;
    slot.armed = armed;
    if (to) {
      slot.to = slot.to ?? v3();
      set(slot.to, to.x, to.y, to.z);
    } else delete slot.to;
    hz[m++] = slot;
  };
  for (const z of s.hazards) put(z.kind, z.x, z.y, z.z, z.r, z.kind === "trap" ? z.state === "armed" : true);
  for (const x of s.shots) put(x.kind === "sling" ? "sling" : "web-bomb", x.x, x.y, x.z, 14, true);
  if (v && v.kind === "doc-octochain") {
    const armed = v.phase === "sweep" || v.phase === "slam";
    for (let i = 0; i < v.arms.length; i++) {
      const o = armShoulder(v, i);
      put("arm", o.x, o.y, o.z, 20, armed && v.arms[i].len >= 110, armTip(v, i));
    }
  }
  // Gwei swings in on her own web: `to` is the anchor she hangs from.
  if (s.gwei) put("gwei", s.gwei.x, s.gwei.y, s.gwei.z, 30, !s.gwei.struck, s.gwei.anchor);
  hz.length = m;
  fillChapter(s, out);
  fillFee(s, out);
  fillTrial(s, out);
  return out;
}

/** v1.6: a time trial's clock, gates and splits (null otherwise). */
function fillTrial(s: SimState, out: RenderFrame3D) {
  const t = s.trial;
  if (!t) {
    if (out.trial) out.trial = null;
    return;
  }
  const tr = out.trial ?? (out.trial = { course: t.course, next: 0, gates: 0, ticks: 0, splits: [], finished: false, over: false });
  tr.course = t.course;
  tr.next = t.next;
  tr.gates = s.pickups.length;
  tr.ticks = t.endTick >= 0 ? t.endTick : s.tick;
  for (let i = 0; i < t.splits.length; i++) tr.splits[i] = t.splits[i];
  tr.splits.length = t.splits.length;
  tr.finished = t.finished;
  tr.over = t.endTick >= 0;
}


/** v1.6: Gas Goblin's state word through Case File 003's chase and cooling (see contract.ts). */
function feeVillainState(s: SimState, v: Villain): string {
  const f = s.fee!;
  switch (f.phase) {
    case "meter":
      return "perch";
    case "chase":
      if (f.holdT > 0 || chaseGap(s) > 1150) return "taunt";
      return v.phase === "telegraph" ? "throw" : "flee";
    case "showdown":
      return "circle";
    default:
      return "webbed";
  }
}

/** v1.6: Case File 003's clues, meter, route and chase (null on every other night). */
function fillFee(s: SimState, out: RenderFrame3D) {
  const f = s.fee;
  if (!f) {
    out.fee = null;
    return;
  }
  const zone = s.city.zones[0];
  const st = zone?.stage;
  const fe =
    out.fee ??
    (out.fee = {
      id: f.id,
      phase: f.phase,
      clues: [],
      meter: { pos: v3(), carried: false, heat: 1, cooled: false, spike: 0 },
      route: f.route.map((p) => ({ pos: { x: p.x, y: p.y, z: p.z }, roof: p.roof ? { x: p.rx, y: p.ry, z: p.rz } : null })),
      chase: null,
      bakery: st ? { x: (st.x0 + st.x1) / 2, y: st.y, z: (st.z0 + st.z1) / 2 } : { ...(zone?.center ?? s.city.start) },
    });
  fe.id = f.id;
  fe.phase = f.phase;
  // The route is fixed for a night: rebuilt only when the frame is filled from another night.
  const r0 = f.route[0];
  if (fe.route.length !== f.route.length || (r0 && (fe.route[0].pos.x !== r0.x || fe.route[0].pos.z !== r0.z))) {
    fe.route = f.route.map((p) => ({ pos: { x: p.x, y: p.y, z: p.z }, roof: p.roof ? { x: p.rx, y: p.ry, z: p.rz } : null }));
    if (st) set(fe.bakery, (st.x0 + st.x1) / 2, st.y, (st.z0 + st.z1) / 2);
  }
  for (let i = 0; i < f.clues.length; i++) {
    const k = f.clues[i];
    const slot = fe.clues[i] ?? (fe.clues[i] = { id: k.id, pos: v3(), found: false });
    slot.id = k.id;
    set(slot.pos, k.x, k.y, k.z);
    slot.found = k.found;
  }
  fe.clues.length = f.clues.length;
  const m = f.meter;
  set(fe.meter.pos, m.x, m.y, m.z);
  fe.meter.carried = m.carried;
  fe.meter.heat = meterHeat(f);
  fe.meter.cooled = m.cooled;
  fe.meter.spike = f.phase === "cool" && f.spikeWind > 0 ? Math.max(0, Math.min(1, 1 - f.spikeWind / spikeWindSeconds(s))) : 0;
  if (f.phase === "chase") {
    const c = fe.chase ?? (fe.chase = { next: 0, checkpoint: 0, escape: 0, gap: 0, losses: 0, maxLosses: MAX_LOSSES });
    c.next = f.next;
    c.checkpoint = f.checkpoint;
    c.escape = f.escape;
    c.gap = chaseGap(s);
    c.losses = f.losses;
    c.maxLosses = MAX_LOSSES;
  } else fe.chase = null;
}

type Case001 = NonNullable<RenderFrame3D["chapter"]>;
type Case001Clue = Case001["clues"][number]["id"];

/** v1.5: a chapter night's clues, captive and paper copies (null on a patrol night). */
function fillChapter(s: SimState, out: RenderFrame3D) {
  const c = s.chapter;
  if (!c) {
    out.chapter = null;
    return;
  }
  // Case File 001's ids (ChapterId and ClueId also name Case File 003's, which has its own `fee`).
  const id = c.id as Case001["id"];
  const ch = out.chapter ?? (out.chapter = { id, phase: c.phase, clues: [], captive: null, copies: [] });
  ch.id = id;
  ch.phase = c.phase;
  for (let i = 0; i < c.clues.length; i++) {
    const k = c.clues[i];
    const slot = ch.clues[i] ?? (ch.clues[i] = { id: k.id as Case001Clue, pos: v3(), found: false });
    slot.id = k.id as Case001Clue;
    set(slot.pos, k.x, k.y, k.z);
    slot.found = k.found;
  }
  ch.clues.length = c.clues.length;
  const m = c.captive;
  const cap = ch.captive ?? (ch.captive = { pos: v3(), restore: 0, freed: false });
  set(cap.pos, m.x, m.y, m.z);
  cap.restore = Math.min(1, m.restore / RESTORE_TICKS);
  cap.freed = m.freed;
  const v = s.villain;
  const h = s.hero;
  let n = 0;
  if (v && v.kind === "right-clicker") {
    for (const b of v.bodies) {
      const slot = ch.copies[n] ?? (ch.copies[n] = { id: b.slot, pos: v3(), yaw: 0, alive: true });
      slot.id = b.slot;
      set(slot.pos, b.x, b.y, b.z);
      // Facing the hero: the cutout's front (+z) turned to (sin yaw, cos yaw).
      slot.yaw = datan2(h.x - b.x, h.z - b.z);
      slot.alive = b.alive;
      n += 1;
    }
  }
  ch.copies.length = n;
  if (c.vote) fillVote(s, ch);
  else delete ch.vote;
}

const look = (t: number, out: VoteLook) => {
  out.shadow = (t & TELL_BIT.shadow) !== 0;
  out.blink = (t & TELL_BIT.blink) !== 0;
  out.left = (t & TELL_BIT.left) !== 0;
  return out;
};

/** v1.6: Case File 002's voters, fork vote, recount and Uncle Gen's ballot. */
function fillVote(s: SimState, ch: NonNullable<RenderFrame3D["chapter"]>) {
  const c = s.chapter!;
  const vt = c.vote!;
  const out: VoteFrame =
    ch.vote ??
    (ch.vote = {
      stage: vt.stage,
      real: { shadow: false, blink: false, left: false },
      known: { shadow: false, blink: false, left: false },
      voters: [],
      booths: [],
      wrong: 0,
      fork: null,
      recount: null,
      box: v3(),
      ballot: null,
    });
  out.stage = vt.stage;
  look(vt.real, out.real);
  look(knownTells(s), out.known);
  const floor = c.captive.y;
  for (let i = 0; i < vt.booths.length; i++) {
    const at = out.booths[i] ?? (out.booths[i] = v3());
    set(at, vt.booths[i].x, floor, vt.booths[i].z);
  }
  out.booths.length = vt.booths.length;
  const v = s.villain;
  let n = 0;
  if (v && v.kind === "sybil") {
    for (const b of v.bodies) {
      const slot = out.voters[n] ?? (out.voters[n] = { id: b.slot, pos: v3(), alive: true, runner: false, shadow: false, blink: false, left: false });
      slot.id = b.slot;
      set(slot.pos, b.x, b.y, b.z);
      slot.alive = b.alive;
      slot.runner = b.slot === vt.runner;
      look(vt.tells[b.slot] ?? 0, slot);
      n += 1;
    }
  }
  out.voters.length = n;
  out.wrong = vt.wrong;
  if (vt.forkT > 0 && v) {
    const f = out.fork ?? (out.fork = { axis: "x", at: 0, orphan: 1, left: 0, total: 0, need: 0, votes: 0 });
    f.axis = vt.forkAxis === 0 ? "x" : "z";
    f.at = vt.forkAt;
    f.orphan = vt.forkSide;
    f.left = vt.forkT;
    f.total = vt.forkLen;
    f.need = vt.forkNeed;
    f.votes = forkVotes(v, vt);
  } else out.fork = null;
  if (c.phase === "standoff" && vt.stage === "recount") {
    const r = out.recount ?? (out.recount = { left: 0 });
    r.left = Math.max(0, RECOUNT_SECONDS - vt.recountT);
  } else out.recount = null;
  set(out.box, vt.boxX, floor, vt.boxZ);
  if (vt.ballot >= 0) {
    const bl = out.ballot ?? (out.ballot = { state: "runner", pos: v3() });
    const runner = v?.bodies.find((b) => b.slot === vt.runner);
    const h = s.hero;
    if (vt.ballot === 0 && runner) {
      bl.state = "runner";
      set(bl.pos, runner.x, runner.y + 20, runner.z);
    } else if (vt.ballot === 1) {
      bl.state = "carried";
      set(bl.pos, h.x, h.y + 24, h.z);
    } else {
      bl.state = "counted";
      set(bl.pos, vt.boxX, floor + 40, vt.boxZ);
    }
  } else out.ballot = null;
}
