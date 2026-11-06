/**
 * Case File 002's Sybil ("One man. Ten thousand votes."), on foot on the polling station's
 * roof with his copies, fought by ruleset 4's grounded rules (strikes beside him, zips from
 * range, knocks along the floor, mercy). vote.ts has the night around it.
 *
 * Unmasked, he keeps a few steps off and circles; his copies stand round him between you and
 * him, and each throws a small fake ballot (goo) now and then. Every 1.5–2.2 s (/ his rate,
 * quicker in the runoff) he does one of, in turn:
 * - FAKE VOTE: a wind-up (FAKE_WIND), then a big slow ballot at you; sidestep it. Throwing, he
 *   recovers a moment, open (a blow gets through his guard).
 * - FORK VOTE: the copies call a vote to fork the arena (FORK_CALL). The roof splits along
 *   one axis through its middle, and the side you stand on at the call is orphaned. At the
 *   close, if a majority of the copies that called it still stand, it passes: the orphaned
 *   side reorgs (you're hurt and shoved across, if you're still on it) and the chain forks one
 *   more copy. Pop enough of them first and quorum fails: he staggers, open.
 * - DUPLICATE: a copy steps out of him (while there are fewer than MAX_ALIVE).
 * At RECOUNT_AT hits left he hides in a ring of copies (vote.ts startRecount); found or not,
 * the runoff follows, its fork votes coming twice as often.
 *
 * Deterministic: dmath trig, the sim's roll(), + − × ÷ and Math.sqrt only.
 */
import { hurtHero, mercy } from "./combat";
import type { Zone } from "./contract";
import { clamp, datan2, dcos, dsin, len2, len3 } from "./dmath";
import { stageBox, walk, walkTo, type Box } from "./right-clicker";
import { roll } from "./rng";
import type { Hazard, SimState, SybilBody, Villain, VoteState } from "./types";
import { VOTER_LIFT } from "./chapter";
import { copyBeside, endRecount, floorOf, liveCopies, MAX_ALIVE, realBody, RECOUNT_SECONDS, ringPlace, voteDamage, voteHidden, VOTER_RADIUS } from "./vote";

/** On foot: walking speed (× his rate), acceleration and braking; the gap he keeps, and more just after a hit. */
const SPEED = 190;
const ACCEL = 1100;
const BRAKE = 1600;
const KEEP = 300;
const KEEP_FLEE = 440;
/** His copies: how fast they keep their places round him, and how far out. */
const COPY_SPEED = 260;
const COPY_ACCEL = 1100;
const COPY_RING = 115;
/** A copy's small fake ballot: every COPY_SHOT + up to COPY_SHOT_JITTER seconds (/ his rate), this fast. */
const COPY_SHOT = 3.6;
const COPY_SHOT_JITTER = 1.2;
const COPY_GOO_SPEED = 290;
/** FAKE VOTE: the wind-up (+ mercy), the ballot's speed, and the recovery after (open). */
export const FAKE_WIND = 0.75;
const FAKE_MERCY = 0.25;
const FAKE_SPEED = 280;
export const FAKE_RECOVER = 0.75;
const RECOVER_MERCY = 0.25;
/** FORK VOTE: the call (+ mercy; the runoff's is quicker), the reorg's shove, and how far across the split counts as safe. */
export const FORK_CALL = 2.0;
const FORK_MERCY = 0.4;
export const FORK_CALL_RUNOFF = 1.7;
const FORK_SHOVE = 430;
export const FORK_SAFE = 14;
/** A fork vote has at least this many copies to vote (he calls more in). */
export const FORK_VOTERS = 3;
/** Quorum failed: his stagger (+ mercy), open. */
export const STAGGER = 1.7;
const STAGGER_MERCY = 0.3;
/** DUPLICATE's wind-up. */
const DUP_WIND = 0.5;
/** The runner: how fast it flees, and how hard it leans off the walls. */
const RUNNER_SPEED = 235;
const RUNNER_ACCEL = 1400;

/** His moves in turn: the polls, and the runoff (forks twice as often). */
const PATTERN = {
  polls: ["fake", "fork", "fake", "dup"],
  runoff: ["fork", "fake", "fork", "dup"],
} as const;
type Move = (typeof PATTERN)["polls"][number];

/** Seconds between his moves, before his rate. */
const gap = (s: SimState, vt: VoteState) => (vt.stage === "runoff" ? 1.25 + roll(s) * 0.5 : 1.5 + roll(s) * 0.7);

/** Where the villain's position follows: his real body. */
function sync(v: Villain) {
  const r = realBody(v);
  v.x = r.x;
  v.y = r.y;
  v.z = r.z;
  v.vx = r.vx;
  v.vy = r.vy;
  v.vz = r.vz;
}

/** A goo ballot from `b` at the hero (led a little), or wide of him while he's cloaked. */
function throwBallot(s: SimState, v: Villain, b: SybilBody, big: boolean) {
  const h = s.hero;
  const lead = 0.35;
  const tx = h.cloakT > 0 ? h.x + dsin(s.time * 1.7) * 320 : h.x + h.vx * lead;
  const tz = h.cloakT > 0 ? h.z + dcos(s.time * 1.7) * 320 : h.z + h.vz * lead;
  const ty = h.y;
  const dx = tx - b.x;
  const dy = ty - b.y;
  const dz = tz - b.z;
  const d = len3(dx, dy, dz) || 1;
  const speed = big ? FAKE_SPEED : COPY_GOO_SPEED;
  const goo: Hazard = {
    kind: "goo",
    x: b.x,
    y: b.y,
    z: b.z,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    vz: (dz / d) * speed,
    r: big ? 20 : 13,
    t: 0,
    damage: voteDamage(v, big ? "Fake vote" : "Swarm"),
    burn: 0,
    big,
    state: "open",
    dead: false,
  };
  s.hazards.push(goo);
}

/** Where copy `k` of `n` stands round him: an arc between him and the hero. */
function guardPlace(r: SybilBody, hx: number, hz: number, k: number, n: number): { x: number; z: number } {
  const base = datan2(hz - r.z, hx - r.x);
  // Spread over about 150° facing you, the middle one straight between.
  const spread = n > 1 ? 2.6 / (n - 1) : 0;
  const a = base + (k - (n - 1) / 2) * spread;
  return { x: r.x + dcos(a) * COPY_RING, z: r.z + dsin(a) * COPY_RING };
}

/** The fork vote's split: the hero's side of it (+1/−1), and how far across (positive: on the orphaned side). */
export function forkSideOf(vt: VoteState, x: number, z: number): number {
  const along = vt.forkAxis === 0 ? x - vt.forkAt : z - vt.forkAt;
  return along * vt.forkSide;
}

/** Copies that may still vote in the fork under way (standing since its call). */
export const forkVotes = (v: Villain, vt: VoteState) => liveCopies(v, vt).filter((b) => b.slot < vt.forkFrom).length;

function startMove(s: SimState, v: Villain, zone: Zone) {
  const vt = s.chapter!.vote!;
  const h = s.hero;
  const list = vt.stage === "runoff" ? PATTERN.runoff : PATTERN.polls;
  let move: Move = list[v.cycle % list.length];
  v.cycle += 1;
  let n = liveCopies(v, vt).length;
  if (move === "dup" && n >= MAX_ALIVE) move = "fake";
  const m = mercy(v.level);
  const r = realBody(v);
  if (move === "fake") {
    v.phase = "telegraph";
    v.phaseT = FAKE_WIND + FAKE_MERCY * m;
    s.events.push({ type: "villain-attack", label: "Fake vote", x: r.x, y: r.y, z: r.z });
  } else if (move === "dup") {
    v.phase = "copy";
    v.phaseT = DUP_WIND;
    s.events.push({ type: "villain-attack", label: "Duplicate", x: r.x, y: r.y, z: r.z });
  } else {
    // He calls in voters to make up FORK_VOTERS, then the split alternates its axis; the side
    // you stand on is orphaned.
    for (let k = n; k < FORK_VOTERS; k++) copyBeside(s, v, k, FORK_VOTERS);
    n = liveCopies(v, vt).length;
    v.phase = "vote";
    vt.forkAxis = vt.forks % 2;
    vt.forks += 1;
    vt.forkAt = vt.forkAxis === 0 ? zone.center.x : zone.center.z;
    const along = vt.forkAxis === 0 ? h.x - vt.forkAt : h.z - vt.forkAt;
    vt.forkSide = along >= 0 ? 1 : -1;
    vt.forkNeed = Math.floor(n / 2) + 1;
    vt.forkFrom = s.chapter!.copies;
    vt.forkT = (vt.stage === "runoff" ? FORK_CALL_RUNOFF : FORK_CALL) + FORK_MERCY * m;
    vt.forkLen = vt.forkT;
    s.events.push({ type: "fork-call", axis: vt.forkAxis === 0 ? "x" : "z", at: vt.forkAt, orphan: vt.forkSide, need: vt.forkNeed, voters: n });
    s.events.push({ type: "villain-attack", label: "Fork vote", x: r.x, y: r.y, z: r.z });
  }
}

function toIdle(s: SimState, v: Villain, vt: VoteState, scale = 1) {
  v.phase = "idle";
  v.phaseT = 0;
  v.attackT = (gap(s, vt) * scale) / v.rate;
}

/** The fork vote closes: passed (the orphaned side reorgs, the chain forks a copy), or quorum failed (he staggers). */
function closeFork(s: SimState, v: Villain) {
  const vt = s.chapter!.vote!;
  const h = s.hero;
  const votes = forkVotes(v, vt);
  const passed = votes >= vt.forkNeed;
  vt.forkT = 0;
  let hit = false;
  if (passed) {
    if (forkSideOf(vt, h.x, h.z) > -FORK_SAFE) {
      // Shoved across the split, away from a point further out on the orphaned side.
      const fx = vt.forkAxis === 0 ? h.x + vt.forkSide * 240 : h.x;
      const fz = vt.forkAxis === 1 ? h.z + vt.forkSide * 240 : h.z;
      hit = hurtHero(s, voteDamage(v, "Fork vote"), "a fork", fx, h.y, fz, 0, FORK_SHOVE);
    }
    if (liveCopies(v, vt).length < MAX_ALIVE) copyBeside(s, v, 0, 1);
    s.events.push({ type: "fork", passed, hit, votes, need: vt.forkNeed });
    if (s.mode === "fight") toIdle(s, v, vt, 0.8);
    return;
  }
  s.events.push({ type: "fork", passed, hit, votes, need: vt.forkNeed });
  v.phase = "stagger";
  v.phaseT = STAGGER + STAGGER_MERCY * mercy(v.level);
}

/** The copies: in the booths (the lineup), round him (the fight), standing to vote, or in the recount's ring. */
function stepCopies(s: SimState, v: Villain, dt: number, zone: Zone, box: Box, y: number) {
  const vt = s.chapter!.vote!;
  const h = s.hero;
  const r = realBody(v);
  const guards = liveCopies(v, vt);
  const voting = vt.forkT > 0;
  guards.forEach((b, k) => {
    if (vt.stage === "recount") {
      const p = ringPlace(zone, vt.ring[b.slot] ?? 0);
      walkTo(b, p.x, p.z, COPY_SPEED, COPY_ACCEL, dt, box, y);
      return;
    }
    if (voting && b.slot < vt.forkFrom) {
      // Ballots up: they stand still to vote (easy to pop).
      walk(b, 0, 0, COPY_ACCEL, COPY_ACCEL, dt, box, y);
      return;
    }
    const p = guardPlace(r, h.x, h.z, k, guards.length);
    walkTo(b, clamp(p.x, box.x0, box.x1), clamp(p.z, box.z0, box.z1), COPY_SPEED, COPY_ACCEL, dt, box, y);
    if (s.mode !== "fight" || voting) return;
    b.shootT -= dt;
    if (b.shootT > 0) return;
    b.shootT = (COPY_SHOT + roll(s) * COPY_SHOT_JITTER) / v.rate;
    throwBallot(s, v, b, false);
  });
}

/** The runner with Uncle Gen's ballot: away from the hero, leaning off the walls and round the corners. */
function stepRunner(s: SimState, b: SybilBody, dt: number, zone: Zone, box: Box, y: number) {
  const h = s.hero;
  const dx = b.x - h.x;
  const dz = b.z - h.z;
  const d = len2(dx, dz) || 1;
  const speed = RUNNER_SPEED;
  // Away, and a little round you (so a corner turns into a run along the wall).
  let wx = (dx / d) * speed - (dz / d) * speed * 0.45;
  let wz = (dz / d) * speed + (dx / d) * speed * 0.45;
  const st = zone.stage ?? zone.bounds;
  const margin = 120;
  const push = 360;
  if (b.x < st.x0 + margin) wx += push * (1 - (b.x - st.x0) / margin);
  else if (b.x > st.x1 - margin) wx -= push * (1 - (st.x1 - b.x) / margin);
  if (b.z < st.z0 + margin) wz += push * (1 - (b.z - st.z0) / margin);
  else if (b.z > st.z1 - margin) wz -= push * (1 - (st.z1 - b.z) / margin);
  const w = len2(wx, wz);
  if (w > speed) {
    wx *= speed / w;
    wz *= speed / w;
  }
  walk(b, wx, wz, RUNNER_ACCEL, RUNNER_ACCEL, dt, box, y);
}

/** One step of Case File 002's Sybil and his copies (stepVillain calls it in intro and fight). */
export function stepSybilVote(s: SimState, v: Villain, dt: number, zone: Zone) {
  const c = s.chapter;
  const vt = c?.vote;
  if (!c || !vt) return;
  const h = s.hero;
  const floor = floorOf(zone, v.y - VOTER_LIFT);
  const y = floor + VOTER_LIFT;
  const box = stageBox(zone, VOTER_RADIUS);
  const r = realBody(v);
  if (c.phase === "lineup" || c.phase === "investigate") {
    // In their booths, waiting to vote.
    for (const b of v.bodies) {
      if (!b.alive) continue;
      const at = vt.booths[b.slot] ?? { x: b.x, z: b.z };
      walkTo(b, at.x, at.z, COPY_SPEED, COPY_ACCEL, dt, box, y);
    }
    sync(v);
    return;
  }
  if (c.phase === "rescue" || c.phase === "done") {
    // Webbed where he stood; the runner runs.
    walk(r, 0, 0, BRAKE, BRAKE, dt, box, y);
    const runner = v.bodies.find((b) => b.slot === vt.runner);
    if (runner?.alive) stepRunner(s, runner, dt, zone, box, y);
    sync(v);
    return;
  }
  if (vt.stage === "recount") {
    vt.recountT += dt;
    const p = ringPlace(zone, vt.ring[r.slot] ?? 0);
    walkTo(r, p.x, p.z, COPY_SPEED, COPY_ACCEL, dt, box, y);
    stepCopies(s, v, dt, zone, box, y);
    sync(v);
    if (vt.recountT >= RECOUNT_SECONDS && s.mode === "fight") endRecount(s, v);
    return;
  }
  const dx = h.x - r.x;
  const dz = h.z - r.z;
  const d = len2(dx, dz) || 1;
  // The fork vote runs on its own clock, whatever he's doing.
  if (vt.forkT > 0 && s.mode === "fight") {
    vt.forkT = Math.max(0, vt.forkT - dt);
    if (vt.forkT === 0) closeFork(s, v);
  }
  switch (v.phase) {
    case "telegraph":
      walk(r, 0, 0, ACCEL, BRAKE, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT <= 0 && s.mode === "fight") {
        throwBallot(s, v, r, true);
        v.phase = "recover";
        v.phaseT = FAKE_RECOVER + RECOVER_MERCY * mercy(v.level);
      }
      break;
    case "recover":
    case "stagger":
      walk(r, 0, 0, ACCEL, BRAKE * 0.6, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT <= 0) toIdle(s, v, vt, v.phase === "stagger" ? 0.7 : 1);
      break;
    case "copy":
      walk(r, 0, 0, ACCEL, BRAKE, dt, box, y);
      v.phaseT -= dt;
      if (v.phaseT <= 0) {
        if (liveCopies(v, vt).length < MAX_ALIVE) copyBeside(s, v, 0, 1);
        toIdle(s, v, vt);
      }
      break;
    case "vote":
      // Calling the vote: he stands and counts.
      walk(r, 0, 0, ACCEL, BRAKE, dt, box, y);
      if (vt.forkT <= 0 && v.phase === "vote") toIdle(s, v, vt, 0.8);
      break;
    default: {
      if (v.stun > 0) {
        walk(r, 0, 0, ACCEL, BRAKE * 0.6, dt, box, y);
        break;
      }
      // Keep a few steps off and circle; just hit, back off further.
      const keep = v.fleeT > 0 ? KEEP_FLEE : KEEP;
      const speed = SPEED * v.rate * (v.fleeT > 0 ? 1.3 : 1);
      const ux = dx / d;
      const uz = dz / d;
      const radial = clamp((keep - d) * -2.5, -speed, speed);
      const circle = (v.cycle & 1 ? 1 : -1) * speed * 0.45;
      let wx = ux * radial - uz * circle;
      let wz = uz * radial + ux * circle;
      const w = len2(wx, wz);
      if (w > speed) {
        wx *= speed / w;
        wz *= speed / w;
      }
      walk(r, wx, wz, ACCEL, BRAKE, dt, box, y);
      v.attackT -= dt;
      if (v.attackT <= 0 && s.mode === "fight") startMove(s, v, zone);
    }
  }
  stepCopies(s, v, dt, zone, box, y);
  sync(v);
}

/** Webbed after the win (the won beats): he slides to a stop where he stood. */
export function stepSybilVoteWebbed(v: Villain, dt: number, zone: Zone) {
  const floor = floorOf(zone, v.y - VOTER_LIFT);
  const r = realBody(v);
  walk(r, 0, 0, BRAKE, BRAKE, dt, stageBox(zone, VOTER_RADIUS), floor + VOTER_LIFT);
  for (const b of v.bodies) if (b.alive && b !== r) walk(b, 0, 0, BRAKE, BRAKE, dt, stageBox(zone, VOTER_RADIUS), floor + VOTER_LIFT);
  sync(v);
}

/* ------------------------------------------------------------------ for the scene */

/**
 * The render state word: "idle", "windup" (a fake vote or a duplicate coming), "vote" (the
 * fork vote's call), "open" (recovering from a throw), "stunned" (quorum failed, or a flinch),
 * "guard", "count" (hiding in the lineup or the recount), "webbed" from the win on.
 */
export function sybilVoteState(s: SimState, v: Villain): string {
  const c = s.chapter;
  if (s.mode === "won" || (c && (c.phase === "rescue" || c.phase === "done"))) return "webbed";
  if (voteHidden(s)) return "count";
  if (c?.vote && c.vote.forkT > 0) return "vote";
  switch (v.phase) {
    case "telegraph":
    case "copy":
      return "windup";
    case "recover":
      return "open";
    case "stagger":
      return "stunned";
  }
  if (v.stun > 0) return "stunned";
  if (v.invuln > 0) return "guard";
  return "idle";
}
