/**
 * Case File 002, "The Sybil Vote": the night's flow around the fight (sybil-vote.ts is the
 * fight itself). A leaf: it steps nothing and hurts no one (combat.ts calls in here on a hit).
 *
 * - investigate (travel): three drop boxes on Validator Heights roofs (chapter.ts setupVote),
 *   each with a clue that reveals one of the real Sybil's tells (rules/chapters.ts TELL_BIT):
 *   whether he casts a shadow, whether he blinks, which hand holds his ballot.
 * - lineup (intro, then fight): at the polling station eight identical voters stand in two
 *   rows of booths, one of each mix of the three tells. A blow marks one: the real Sybil
 *   (markReal) starts the standoff; a copy pops (wrongVoter), with a paper cut, and forks one
 *   more copy into the fight (at most FORKED_MAX).
 * - standoff (fight): sybil-vote.ts. At RECOUNT_AT hits left he hides in a ring of copies
 *   again (startRecount): a blow on him ends it (endRecount), a copy pops with a paper cut.
 * - rescue (fight): the last copy runs off with Uncle Gen's ballot (startRunner). Catch it
 *   (takeBallot), carry the ballot to the box beside Gen: counted (stepVoteRescue), and the
 *   case closes after the beat (voteWonEnd).
 *
 * Deterministic: the sim's roll(), + − × ÷ and Math.sqrt / Math.floor only.
 */
import { CHAPTERS, SYBIL_VOTE_MOVES, TELL_BIT } from "../rules/chapters";
import { damageScale } from "../rules/data";

import { BOOTH_ROW, FREED_SECONDS, popCopy, RESTORE_TICKS, VOTE_LEVEL, VOTER_LIFT } from "./chapter";
import { DT, HERO_RADIUS } from "./constants";
import type { Zone } from "./contract";
import { dcos, dsin, len2, PI } from "./dmath";
import { roll } from "./rng";
import type { SimState, SybilBody, Villain, VoteState } from "./types";

/** Blows to beat him (three stages: the polls, the recount's one, the runoff). */
export const VOTE_HITS = 10;
/** A voter's radius (a person standing; the patrol Sybil's swarm is 40). */
export const VOTER_RADIUS = 34;
/** Copies at his side when he's unmasked, and the most wrong marks add (one each). */
export const BASE_COPIES = 3;
export const FORKED_MAX = 3;
/** The most copies standing at once in the fight. */
export const MAX_ALIVE = 6;
/** The recount: at this many hits left he hides again, in a ring of RECOUNT_BODIES (him and copies) this far round the stage's middle, for at most RECOUNT_SECONDS. */
export const RECOUNT_AT = 5;
export const RECOUNT_BODIES = 6;
export const RECOUNT_RADIUS = 175;
export const RECOUNT_SECONDS = 10;
/** After a blow lands he guards this long (openings get through). */
export const VOTE_GUARD = 3.2;
/** Unmasked, he takes this long to call his first move. */
export const REVEAL_SECONDS = 1.6;
/** The ballot box takes Gen's ballot within this across, and BALLOT_RISE up and down. */
export const BALLOT_REACH = 110;
export const BALLOT_RISE = 160;
/** The runner: this far beside the webbed Sybil when he grabs the ballot. */
const RUNNER_SPAWN = 80;

/** A Case File 002 move's damage at the villain's level (rules/chapters.ts SYBIL_VOTE_MOVES). */
export function voteDamage(v: Villain, label: string): number {
  const base = SYBIL_VOTE_MOVES.find((m) => m.label === label)?.value ?? 10;
  return Math.round(base * damageScale(v.level));
}

/** Whether the tonight's real Sybil has `bit` (TELL_BIT). */
export const hasTell = (tells: number, bit: number) => (tells & bit) !== 0;

/** Whether every body reads as a copy right now (the lineup, and the recount's ring): the scene draws them all alike. */
export function voteHidden(s: SimState): boolean {
  const c = s.chapter;
  if (!c?.vote) return false;
  return c.phase === "lineup" || c.phase === "investigate" || (c.phase === "standoff" && c.vote.stage === "recount");
}

/** The fight's floor and a voter's centre height on it. */
export const floorOf = (zone: Zone | undefined, fallback: number) => zone?.stage?.y ?? zone?.center.y ?? fallback;

/** A Sybil body at (x, z) with `tells` (its slot is the next copy id): a voter, a fight copy, the runner. */
export function voteBody(s: SimState, v: Villain, x: number, z: number, floor: number, tells: number, real = false): SybilBody {
  const c = s.chapter!;
  const vt = c.vote!;
  const slot = c.copies;
  c.copies += 1;
  const y = floor + VOTER_LIFT;
  const b: SybilBody = { x, y, z, real, alive: true, slot, shootT: 0, vx: 0, vy: 0, vz: 0 };
  v.bodies.push(b);
  c.copyWind.push(0);
  c.copyCd.push(0);
  vt.tells[slot] = tells;
  vt.ring[slot] = -1;
  s.events.push({ type: "copy-spawn", id: slot, x, y, z });
  return b;
}

/**
 * The Sybil at the polling station: one villain whose bodies are the eight voters, the real
 * one (slot 0) in his booth among them (chapter.ts setupVote placed and dressed them).
 */
export function spawnVoteSybil(s: SimState, zone: Zone): Villain {
  const c = s.chapter!;
  const vt = c.vote!;
  const floor = floorOf(zone, s.hero.y);
  const rate = 1 + 0.08 * (VOTE_LEVEL - 1);
  const home = vt.booths[0];
  const v: Villain = {
    kind: "sybil",
    cast: "sybil",
    level: VOTE_LEVEL,
    boss: false,
    quest: false,
    x: home.x,
    y: floor + VOTER_LIFT,
    z: home.z,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: VOTER_RADIUS,
    hits: VOTE_HITS,
    hitsMax: VOTE_HITS,
    invuln: 0,
    stun: 0,
    t: 0,
    phase: "enter",
    phaseT: 0,
    attackT: REVEAL_SECONDS / rate,
    attack2T: 0,
    rate,
    grounded: true,
    dashToX: home.x,
    dashToZ: home.z,
    dashHit: false,
    arms: [],
    bodies: [],
    cx: zone.center.x,
    cy: floor,
    cz: zone.center.z,
    cycle: 0,
    home: { x: zone.center.x, y: floor + VOTER_LIFT, z: zone.center.z },
    ax: 1,
    az: 0,
    fleeT: 0,
    dodgeT: 0,
    cvx: 0,
    cvy: 0,
    cvz: 0,
    diveX: 0,
    diveY: 0,
    diveZ: 0,
    bank: 0,
  };
  // The voters, in slot order (setupVote dressed slots 0–7; the real one is 0).
  const tells = vt.tells.slice(0, vt.booths.length);
  vt.tells.length = 0;
  vt.ring.length = 0;
  vt.booths.forEach((b, i) => voteBody(s, v, b.x, b.z, floor, tells[i], i === 0));
  return v;
}

/** The real Sybil's body. */
export const realBody = (v: Villain): SybilBody => v.bodies.find((b) => b.real) ?? v.bodies[0];

/** Copies standing (not him, not the runner). */
export function liveCopies(v: Villain, vt: VoteState): SybilBody[] {
  return v.bodies.filter((b) => b.alive && !b.real && b.slot !== vt.runner);
}

/** Pop every copy still standing (never him). */
export function popVoteCopies(s: SimState, v: Villain) {
  for (const b of v.bodies) if (!b.real) popCopy(s, b);
}

/** A copy at the real one's side, `k` of `n` round him (the fight's copies, a duplicate, a fork). */
export function copyBeside(s: SimState, v: Villain, k: number, n: number) {
  const vt = s.chapter!.vote!;
  const r = realBody(v);
  const zone = s.city.zones[s.index];
  const floor = floorOf(zone, r.y - VOTER_LIFT);
  const a = (k * 2 * PI) / Math.max(1, n) + roll(s) * 0.6;
  const st = zone?.stage;
  let x = r.x + dcos(a) * 90;
  let z = r.z + dsin(a) * 90;
  if (st) {
    x = Math.max(st.x0 + VOTER_RADIUS, Math.min(st.x1 - VOTER_RADIUS, x));
    z = Math.max(st.z0 + VOTER_RADIUS, Math.min(st.z1 - VOTER_RADIUS, z));
  }
  // A copy's look: any of the eight but his (the recount deals them out again anyway).
  const look = (vt.real + 1 + Math.floor(roll(s) * 7)) % 8;
  voteBody(s, v, x, z, floor, look);
}

/* ------------------------------------------------------------------ the lineup */

/** A copy in the lineup (or the recount's ring) took a blow meant for him: it pops; the hero pays a paper cut (combat.ts). */
export function wrongVoter(s: SimState, b: SybilBody) {
  const vt = s.chapter!.vote!;
  if (s.chapter!.phase === "lineup") vt.wrong += 1;
  popCopy(s, b);
  s.events.push({ type: "voter-mark", id: b.slot, real: false, wrong: vt.wrong, x: b.x, y: b.y, z: b.z });
}

/** The real one is marked: the line breaks (every other voter pops) and he calls his copies. The standoff begins. */
export function markReal(s: SimState, v: Villain) {
  const c = s.chapter!;
  const vt = c.vote!;
  const r = realBody(v);
  s.events.push({ type: "voter-mark", id: r.slot, real: true, wrong: vt.wrong, x: r.x, y: r.y, z: r.z });
  popVoteCopies(s, v);
  c.phase = "standoff";
  vt.stage = "polls";
  v.phase = "idle";
  v.phaseT = 0;
  v.invuln = 0;
  v.attackT = REVEAL_SECONDS / v.rate;
  const n = BASE_COPIES + Math.min(FORKED_MAX, vt.wrong);
  for (let k = 0; k < n; k++) copyBeside(s, v, k, n);
}

/* ------------------------------------------------------------------ the recount */

/** At RECOUNT_AT hits left: he and RECOUNT_BODIES − 1 copies take a ring round the stage's middle, every look dealt again. */
export function startRecount(s: SimState, v: Villain) {
  const c = s.chapter!;
  const vt = c.vote!;
  vt.stage = "recount";
  vt.recountT = 0;
  vt.forkT = 0;
  v.phase = "count";
  v.phaseT = 0;
  v.invuln = 0;
  v.stun = 0;
  s.hazards.length = 0;
  let copies = liveCopies(v, vt);
  for (const b of copies.slice(RECOUNT_BODIES - 1)) popCopy(s, b);
  for (let k = copies.length; k < RECOUNT_BODIES - 1; k++) copyBeside(s, v, k, RECOUNT_BODIES - 1);
  copies = liveCopies(v, vt).slice(0, RECOUNT_BODIES - 1);
  // The looks: his, and five of the other seven (a seeded deal), so each copy differs from him in at least one tell.
  const others = [0, 1, 2, 3, 4, 5, 6, 7].filter((t) => t !== vt.real);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(roll(s) * (i + 1));
    const t = others[i];
    others[i] = others[j];
    others[j] = t;
  }
  // The ring's places, dealt too: where he stands is anyone's guess.
  const places = [0, 1, 2, 3, 4, 5];
  for (let i = places.length - 1; i > 0; i--) {
    const j = Math.floor(roll(s) * (i + 1));
    const t = places[i];
    places[i] = places[j];
    places[j] = t;
  }
  const r = realBody(v);
  vt.ring[r.slot] = places[0];
  copies.forEach((b, i) => {
    vt.tells[b.slot] = others[i];
    vt.ring[b.slot] = places[i + 1];
  });
  s.events.push({ type: "recount", end: false, x: r.x, y: r.y, z: r.z });
}

/** Where ring place `k` stands. */
export function ringPlace(zone: Zone, k: number): { x: number; z: number } {
  const a = (k * 2 * PI) / RECOUNT_BODIES + PI / 6;
  return { x: zone.center.x + dcos(a) * RECOUNT_RADIUS, z: zone.center.z + dsin(a) * RECOUNT_RADIUS };
}

/** The recount's over: found (a blow on him), or he steps out after RECOUNT_SECONDS. The runoff. */
export function endRecount(s: SimState, v: Villain) {
  const vt = s.chapter!.vote!;
  vt.stage = "runoff";
  vt.recountT = 0;
  for (const b of v.bodies) vt.ring[b.slot] = -1;
  v.phase = "idle";
  v.phaseT = 0;
  v.attackT = 1.2 / v.rate;
  const r = realBody(v);
  s.events.push({ type: "recount", end: true, x: r.x, y: r.y, z: r.z });
}

/* ------------------------------------------------------------------ the rescue */

/** After the win's beat: the last copy grabs Uncle Gen's ballot from the webbed Sybil and runs. */
export function startRunner(s: SimState, v: Villain) {
  const c = s.chapter!;
  const vt = c.vote!;
  const r = realBody(v);
  const zone = s.city.zones[s.index];
  const floor = floorOf(zone, r.y - VOTER_LIFT);
  const h = s.hero;
  // On his far side from the hero.
  const dx = r.x - h.x;
  const dz = r.z - h.z;
  const d = len2(dx, dz) || 1;
  const st = zone?.stage;
  let x = r.x + (dx / d) * RUNNER_SPAWN;
  let z = r.z + (dz / d) * RUNNER_SPAWN;
  if (st) {
    x = Math.max(st.x0 + VOTER_RADIUS, Math.min(st.x1 - VOTER_RADIUS, x));
    z = Math.max(st.z0 + VOTER_RADIUS, Math.min(st.z1 - VOTER_RADIUS, z));
  }
  const b = voteBody(s, v, x, z, floor, (vt.real + 1) % 8);
  vt.runner = b.slot;
  vt.ballot = 0;
}

/** The runner's down: the ballot's the hero's. */
export function takeBallot(s: SimState, b: SybilBody) {
  const vt = s.chapter!.vote!;
  popCopy(s, b);
  vt.ballot = 1;
  s.events.push({ type: "ballot", state: "taken", x: b.x, y: b.y, z: b.z });
}

/** Whether the hero stands by the ballot box (the ballot goes in). */
export function atBallotBox(s: SimState): boolean {
  const vt = s.chapter?.vote;
  if (!vt) return false;
  const h = s.hero;
  const m = s.chapter!.captive;
  const dy = h.y - (m.y + HERO_RADIUS);
  return len2(h.x - vt.boxX, h.z - vt.boxZ) <= BALLOT_REACH && dy <= BALLOT_RISE && dy >= -BALLOT_RISE;
}

/** After the fight-mode step in the rescue: carried to the box, Uncle Gen's ballot is counted, and he's "free". */
export function stepVoteRescue(s: SimState) {
  const c = s.chapter!;
  const vt = c.vote!;
  if (c.phase !== "rescue" || s.mode !== "fight") return;
  c.rescueT += DT;
  if (vt.ballot !== 1 || !atBallotBox(s)) return;
  vt.ballot = 2;
  const m = c.captive;
  m.restore = RESTORE_TICKS;
  m.freed = true;
  c.phase = "done";
  s.events.push({ type: "ballot", state: "counted", x: vt.boxX, y: m.y, z: vt.boxZ });
  s.events.push({ type: "captive-freed", x: m.x, y: m.y, z: m.z });
  s.mode = "won";
  s.modeT = FREED_SECONDS;
  s.hazards.length = 0;
  s.shots.length = 0;
}

/** The end of a "won" beat: after the fight, the rescue (the runner); after the count, the case is closed. */
export function voteWonEnd(s: SimState) {
  const c = s.chapter!;
  const v = s.villain;
  if (c.phase === "standoff" && v) {
    c.phase = "rescue";
    c.rescueT = 0;
    s.mode = "fight";
    s.modeT = 0;
    v.phase = "idle";
    v.stun = 0;
    startRunner(s, v);
    return;
  }
  c.phase = "done";
  s.mode = "done";
  s.events.push({ type: "case-closed", id: c.id, ticks: s.tick });
  s.events.push({ type: "night-over", reason: "route" });
}

/* ------------------------------------------------------------------ reading it */

/** The tells the found clues have revealed, as bits (TELL_BIT): what the hero knows about him. */
export function knownTells(s: SimState): number {
  const c = s.chapter;
  if (!c?.vote) return 0;
  const info = CHAPTERS[c.id];
  let known = 0;
  for (const k of c.clues) {
    const t = info.tells?.[k.id];
    if (k.found && t) known |= TELL_BIT[t.tell];
  }
  return known;
}

/** The booths' rows sit BOOTH_ROW either side of the stage's middle (for the scene's station). */
export const STATION_ROW = BOOTH_ROW;
