/**
 * Case File 003's flow inside stepSim (sim.ts calls these only when `state.fee` is set):
 *
 * - investigate (sim mode "travel"): three clues (fee-strike.ts findFeeClues). The third sends
 *   Gas Goblin to perch on the fee meter: the phase is "meter".
 * - meter: coming within GRAB_REACH of it, he rips it off the roof and flees: "chase".
 * - chase (still "travel"): fee-chase.ts, his route to the bakery. There he plants the meter and
 *   circles: "showdown".
 * - showdown: landing on the bakery roof starts the fight (intro, fight) against him, by ruleset
 *   4's grounded rules (villains.ts stepGoblin, unchanged), from where he is.
 * - cool (sim mode "fight" again, after the win's beat; he's webbed): hold the web beside the
 *   meter to cool it (COOL_TICKS), paused while hurt. The meter vents a fee spike every
 *   SPIKE_GAP, telegraphed for SPIKE_WIND: step out of SPIKE_REACH or take it.
 * - done: the fees are cooled, the bread's back (a beat in mode "won"), then case-closed and
 *   the night ends.
 *
 * Deterministic: + − × ÷ and Math.sqrt only.
 */
import { hurtHero, mercy, moveDamage } from "./combat";
import { DT } from "./constants";
import type { InputFrame, Zone } from "./contract";
import { len2 } from "./dmath";
import { chaseGoblin, startChase, stepChase, stepPerch, stepShowdown } from "./fee-chase";
import { besideMeter, COOL_EVENT_TICKS, COOL_TICKS, COOLED_SECONDS, findFeeClues, GRAB_REACH } from "./fee-strike";
import type { SimState, Villain } from "./types";
import { spawnVillain } from "./villains";

/** The meter's fee spikes while it cools: the first this long in, then every SPIKE_GAP (+ mercy); each winds up SPIKE_WIND (+ mercy). */
export const SPIKE_FIRST = 1.2;
export const SPIKE_GAP = 2.6;
const SPIKE_GAP_MERCY = 0.4;
export const SPIKE_WIND = 0.8;
const SPIKE_WIND_MERCY = 0.2;
/** A fee spike's whole wind-up tonight, seconds. */
export const spikeWindSeconds = (s: SimState) => SPIKE_WIND + SPIKE_WIND_MERCY * (s.villain ? mercy(s.villain.level) : 0);
/** A spike catches the hero within this (across) of the meter, and SPIKE_RISE up or down; it hurts this share of a fee bomb, burns fluid and shoves him out. */
export const SPIKE_REACH = 190;
const SPIKE_RISE = 140;
const SPIKE_SHARE = 0.6;
const SPIKE_BURN = 8;
const SPIKE_SHOVE = 320;
/** Gas Goblin swoops in this high over the meter when the third clue's found, to perch on it. */
const SWOOP_UP = 520;
/** Landing on the bakery roof, a hero under this share of their health is patched up to it (Aunt Mainnet's last loaf). */
export const LOAF_SHARE = 0.45;

/** One travel step of the case: the clues, the meter, the chase and the circling over the bakery. */
export function stepFeeTravel(s: SimState) {
  const f = s.fee!;
  switch (f.phase) {
    case "investigate":
      if (findFeeClues(s)) {
        f.phase = "meter";
        const m = f.meter;
        s.villain = chaseGoblin(s, m.x, m.y + SWOOP_UP, m.z);
      }
      break;
    case "meter": {
      stepPerch(s);
      const h = s.hero;
      const m = f.meter;
      if (len2(h.x - m.x, h.z - m.z) < GRAB_REACH && h.y > m.y - 200) startChase(s);
      break;
    }
    case "chase":
      stepChase(s);
      break;
    case "showdown": {
      const zone = s.city.zones[s.index];
      if (zone) stepShowdown(s, zone);
      break;
    }
  }
}

/**
 * The arrival on the bakery roof: tonight's fight villain (the stop's, as any night's), where
 * the chase left him. Aunt Mainnet's last loaf: a hero under LOAF_SHARE of their health is
 * patched up to it (her ovens are cold, but she saved yesterday's heel for you).
 */
export function showdownVillain(s: SimState, zone: Zone): Villain {
  const prev = s.villain;
  const floor = Math.floor(s.maxHp * LOAF_SHARE + 0.5);
  if (s.hp < floor) {
    const gained = floor - s.hp;
    s.hp = floor;
    s.events.push({ type: "loaf", hp: s.hp, gained });
  }
  const v = spawnVillain(s, zone);
  if (prev) {
    v.x = prev.x;
    v.y = prev.y;
    v.z = prev.z;
    v.vx = prev.vx;
    v.vy = prev.vy;
    v.vz = prev.vz;
    v.bank = prev.bank;
    v.t = prev.t;
  }
  return v;
}

/**
 * The frame the hero steps with in the case's fight (the log keeps the real one): cooling,
 * beside the meter, a held web cools it instead of swinging. The caller puts the real web back
 * in `holdPrev`, so a hold is never a press.
 */
export function feeInput(s: SimState, input: InputFrame): InputFrame {
  const f = s.fee!;
  if (f.phase === "cool" && input.web && besideMeter(s)) return { dir: input.dir, mag: input.mag, web: false, shot: input.shot };
  return input;
}

/** The meter vents: a ring of fee round it that hurts and shoves the hero out. */
function spike(s: SimState) {
  const f = s.fee!;
  const h = s.hero;
  const m = f.meter;
  const v = s.villain;
  const dy = h.y - (m.y + 26);
  const caught = len2(h.x - m.x, h.z - m.z) <= SPIKE_REACH && dy <= SPIKE_RISE && dy >= -SPIKE_RISE;
  const damage = v ? Math.round(moveDamage(v, "Fee bomb") * SPIKE_SHARE) : 7;
  const hit = caught && hurtHero(s, damage, "a fee spike", m.x, m.y + 30, m.z, SPIKE_BURN, SPIKE_SHOVE);
  s.events.push({ type: "fee-spike", hit, x: m.x, y: m.y, z: m.z });
  s.events.push({ type: "blast", x: m.x, y: m.y + 30, z: m.z, r: SPIKE_REACH, kind: "bomb" });
}

/** After the fight-mode step while cooling: the meter's spikes, the cooling, and the end of the case. */
export function stepCool(s: SimState, input: InputFrame) {
  const f = s.fee!;
  if (f.phase !== "cool" || s.mode !== "fight") return;
  const v = s.villain;
  const m = v ? mercy(v.level) : 0;
  f.coolT += DT;
  if (f.spikeWind > 0) {
    f.spikeWind = Math.max(0, f.spikeWind - DT);
    if (f.spikeWind === 0) {
      spike(s);
      f.spikeT = SPIKE_GAP + SPIKE_GAP_MERCY * m;
      if (s.mode !== "fight") return;
    }
  } else {
    f.spikeT -= DT;
    if (f.spikeT <= 0) {
      f.spikeWind = spikeWindSeconds(s);
      s.events.push({ type: "villain-attack", label: "Fee spike", x: f.meter.x, y: f.meter.y, z: f.meter.z });
    }
  }
  const h = s.hero;
  const cooling = input.web && besideMeter(s) && h.hurtT <= 0 && h.heldT <= 0 && h.strike < 0 && h.zip < 0;
  if (!cooling) return;
  const meter = f.meter;
  meter.cool += 1;
  if (meter.cool % COOL_EVENT_TICKS === 0 || meter.cool >= COOL_TICKS) s.events.push({ type: "meter-cool", p: Math.min(1, meter.cool / COOL_TICKS) });
  if (meter.cool < COOL_TICKS) return;
  // Back to normal: the bread's back.
  meter.cooled = true;
  f.phase = "done";
  f.spikeWind = 0;
  s.events.push({ type: "fees-cooled", x: meter.x, y: meter.y, z: meter.z });
  s.mode = "won";
  s.modeT = COOLED_SECONDS;
  s.hazards.length = 0;
  s.shots.length = 0;
}

/** The end of a "won" beat on the case's night: after the fight, the cooling; after that, the case is closed. */
export function feeWonEnd(s: SimState) {
  const f = s.fee!;
  if (f.phase === "showdown") {
    f.phase = "cool";
    f.coolT = 0;
    f.spikeT = SPIKE_FIRST;
    f.spikeWind = 0;
    s.mode = "fight";
    s.modeT = 0;
    const v = s.villain;
    if (v) {
      v.stun = 0;
      v.phase = "idle";
    }
    return;
  }
  f.phase = "done";
  s.mode = "done";
  s.events.push({ type: "case-closed", id: f.id, ticks: s.tick });
  s.events.push({ type: "night-over", reason: "route" });
}
