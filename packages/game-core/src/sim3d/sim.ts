/**
 * The 3D swing sim: createSim builds a night from the patrol; stepSim advances it one
 * fixed step (1/60 s) from one InputFrame. Pure and deterministic: no DOM, no clocks,
 * randomness only from the seed, trig only from dmath. The driver (replay.ts) drains
 * `state.events` after each step and turns them into engine actions through bridge3d.
 *
 * Errands pause the sim: in "errand" (and "done") stepSim consumes no frame and no tick,
 * so an input log only holds ticks that moved the world, and the errand's choice is an
 * event logged at the tick it applies.
 */
import { COMBO_TICKS, DT, ERRAND_REACH, ERRAND_TOUCH, HERO_RADIUS, INTRO_SECONDS } from "./constants";
import { callGwei, fireAbility, makeSlots, stepAbilities } from "./abilities";
import { chapterCity, findClues, setupChapter } from "./chapter";
import { chapterInput, chapterWonEnd, stepRescue } from "./chapter-step";
import { CityIndex, generateCity, groundBelow } from "./city";
import { feeCity, setupFee } from "./fee-strike";
import { feeInput, feeWonEnd, showdownVillain, stepCool, stepFeeTravel } from "./fee-strike-step";
import { knockOut, winFight } from "./combat";
import type { InputFrame, Zone } from "./contract";
import { len2, len3 } from "./dmath";
import { newHero, stepHero, stopTarget, travelBearing } from "./hero";
import { collectPickups, placePickups, stepCombo } from "./pickups";
import { mix } from "./rng";
import { setupTrial, stepTrial, trialCity, trialGates } from "./trial";
import type { SimConfig, SimState } from "./types";
import { spawnVillain, stepHazards, stepVillain } from "./villains";

/** The frame that does nothing. */
export const IDLE_FRAME: InputFrame = Object.freeze({ dir: 0, mag: 0, web: false, shot: 0 }) as InputFrame;

/** Where to stand at the start of the swing to stop `index`: the start roof, or the last stop. */
function spawnPoint(s: Pick<SimState, "city" | "grid">, index: number): { x: number; y: number; z: number; grounded: boolean } {
  const { city, grid } = s;
  if (index <= 0 || !city.zones[index - 1]) return { ...city.start, grounded: true };
  const c = city.zones[index - 1].center;
  const top = groundBelow(grid, c.x, c.z, 5000);
  if (top > 0) return { x: c.x, y: top, z: c.z, grounded: true };
  return { x: c.x, y: 520, z: c.z, grounded: false };
}

export function createSim(config: SimConfig): SimState {
  // Case File 001 builds its own city (the bridge with a wider deck) and its clues and captive;
  // Case File 003 its Market District, the clues, the meter and Gas Goblin's route; a time
  // trial its course's city (no zones) and gates.
  const fee = config.chapter === "case-003";
  const city = fee ? feeCity(config.seed) : config.chapter ? chapterCity(config.chapter, config.seed) : config.trial ? trialCity(config.trial) : generateCity(config.seed, config.stops);
  const grid = new CityIndex(city);
  const chapter = config.chapter && !fee ? setupChapter(config.chapter, city, grid, config.seed) : null;
  const sp = spawnPoint({ city, grid }, config.index);
  const s: SimState = {
    config,
    city,
    grid,
    tick: 0,
    time: 0,
    rng: mix(config.seed, 0x5e17 + config.index * 977),
    mode: "travel",
    modeT: 0,
    index: config.index,
    hero: newHero(sp.x, sp.y, sp.z, sp.grounded),
    hp: Math.max(1, Math.round(config.hp)),
    maxHp: config.maxHp,
    fluid: Math.max(0, Math.round(config.fluid)),
    fluidAcc: 0,
    combo: config.combo,
    maxCombo: config.combo,
    // A combo carried in from an earlier session gets a fresh timer.
    comboT: config.combo > 0 ? COMBO_TICKS : 0,
    pickups: config.trial ? trialGates(config.trial, city, grid) : placePickups(city, grid),
    bits: 0,
    rings: 0,
    pickupPoints: 0,
    tally: { perfect: 0, good: 0, miss: 0 },
    total: { perfect: 0, good: 0, miss: 0 },
    uses: {},
    powers: makeSlots(config.loadout),
    villain: null,
    hazards: [],
    shots: [],
    gwei: null,
    gweiLeft: config.gweiCalls,
    gweiUsed: 0,
    slowmo: 0,
    input: IDLE_FRAME,
    events: [],
    chapter,
    ...(fee ? { fee: setupFee(city, grid, config.seed) } : {}),
  };
  // A time trial's state only on trial runs, so a patrol or chapter state has no trial field at all.
  if (config.trial) s.trial = setupTrial(config.trial);
  // Face the first stop.
  const b = travelBearing(s);
  if (b) {
    s.hero.fx = b.x;
    s.hero.fz = b.z;
  }
  if (config.index >= city.zones.length && !s.trial) {
    s.mode = "done";
  } else if (config.entry === "zone") {
    // Resumed mid-stop: already there, so no arrival to report.
    const z = city.zones[config.index];
    placeInZone(s, z);
    enterZone(s, z);
  }
  return s;
}

/** Stand the hero on something solid at (x, z), or in the air above the street. */
function standAt(s: SimState, x: number, z: number, below: number) {
  const h = s.hero;
  const top = groundBelow(s.grid, x, z, below);
  h.x = x;
  h.z = z;
  h.y = top + HERO_RADIUS;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  h.grounded = top > 0;
  h.rope = null;
}

/** Stand the hero somewhere sensible inside a zone (used when resuming there). */
function placeInZone(s: SimState, z: Zone) {
  if (z.kind === "errand") return; // enterZone puts you beside the ally
  const b = z.bounds;
  const c = z.center;
  if (z.stage) {
    // v4: on the stage, near one side.
    const alongX = !(s.city.bridge && z.villain === "doc-octochain") || s.city.bridge.axis !== "z";
    standAt(s, alongX ? z.stage.x0 + 150 : c.x, alongX ? c.z : z.stage.z0 + 150, z.stage.y + 60);
  } else if (s.city.bridge && z.villain === "doc-octochain") {
    // On the deck, near one end.
    const alongX = s.city.bridge.axis !== "z";
    standAt(s, alongX ? b.x0 + 150 : c.x, alongX ? c.z : b.z0 + 150, 400);
  } else standAt(s, b.x0 + 150, c.z, 400);
}

function enterZone(s: SimState, z: Zone) {
  s.hazards = [];
  s.shots = [];
  s.gwei = null;
  s.gweiUsed = 0;
  if (z.kind === "fight") {
    s.mode = "intro";
    s.modeT = INTRO_SECONDS;
    // Case File 003: Gas Goblin carries on from where the chase left him.
    s.villain = s.fee ? showdownVillain(s, z) : spawnVillain(s, z);
    s.events.push({ type: "encounter", index: z.index, villain: s.villain.kind });
  } else {
    s.mode = "errand";
    // Land beside the ally for the chat, on the side you came from.
    const h = s.hero;
    const a = z.allyAt ?? z.center;
    let dx = h.x - a.x;
    let dz = h.z - a.z;
    const d = len2(dx, dz);
    if (d > 1) {
      dx /= d;
      dz /= d;
    } else {
      dx = -1;
      dz = 0;
    }
    const b = z.bounds;
    const x = Math.max(b.x0 + 30, Math.min(b.x1 - 30, a.x + dx * 120));
    const zz = Math.max(b.z0 + 30, Math.min(b.z1 - 30, a.z + dz * 120));
    standAt(s, x, zz, a.y);
    const fx = a.x - x;
    const fz = a.z - zz;
    const f = len2(fx, fz);
    if (f > 1) {
      h.fx = fx / f;
      h.fz = fz / f;
    }
    s.events.push({ type: "errand", index: z.index });
  }
}

function arrive(s: SimState, z: Zone) {
  const uses = { ...s.uses };
  s.uses = {};
  s.events.push({
    type: "arrive",
    index: z.index,
    kind: z.kind,
    hp: s.hp,
    fluid: s.fluid,
    combo: s.combo,
    perfect: s.tally.perfect,
    good: s.tally.good,
    miss: s.tally.miss,
    uses,
  });
  s.tally = { perfect: 0, good: 0, miss: 0 };
  enterZone(s, z);
}

function nextStop(s: SimState) {
  s.index += 1;
  s.villain = null;
  s.hazards = [];
  s.shots = [];
  s.gwei = null;
  s.slowmo = 0;
  if (s.index >= s.city.zones.length) {
    s.mode = "done";
    s.events.push({ type: "night-over", reason: "route" });
  } else {
    s.mode = "travel";
  }
}

function checkArrival(s: SimState) {
  const z = s.city.zones[s.index];
  if (!z) return;
  // Case File 001: the bridge waits until every clue is found.
  if (s.chapter && s.chapter.phase === "investigate") return;
  // Case File 003: the bakery roof only once Gas Goblin has landed on it.
  if (s.fee && s.fee.phase !== "showdown") return;
  const h = s.hero;
  const b = z.bounds;
  if (z.kind === "fight") {
    // v4: over the stage, above its floor (the hero is kept on it from here on, so this never
    // moves him, and never traps him under Doc's deck).
    const st = z.stage;
    if (st ? h.x > st.x0 + 40 && h.x < st.x1 - 40 && h.z > st.z0 + 40 && h.z < st.z1 - 40 && h.y - HERO_RADIUS > st.y - 4 : h.x > b.x0 + 70 && h.x < b.x1 - 70 && h.z > b.z0 + 70 && h.z < b.z1 - 70) arrive(s, z);
    return;
  }
  const a = stopTarget(s)!;
  const near = len3(h.x - a.x, h.y - a.y, h.z - a.z) < ERRAND_REACH;
  // Reaching the ally's building counts too (on its roof, low over it, or against its walls),
  // like passing the ally in 2D; the errand then stands you beside them.
  const m = ERRAND_TOUCH;
  const touch = h.x > b.x0 - m && h.x < b.x1 + m && h.z > b.z0 - m && h.z < b.z1 + m && h.y < b.h + 500;
  if (near || touch) arrive(s, z);
}

/** A frame with every field in range (the decoder guarantees this; live input may not). */
function sane(f: InputFrame): InputFrame {
  const mag = f.mag === 1 || f.mag === 2 || f.mag === 3 ? f.mag : 0;
  const dir = mag > 0 && Number.isInteger(f.dir) && f.dir >= 0 && f.dir < 64 ? f.dir : 0;
  const shot = (Number.isInteger(f.shot) && f.shot >= 0 && f.shot <= 5 ? f.shot : 0) as InputFrame["shot"];
  // Always a fresh object: callers may reuse one mutable frame between ticks.
  return { dir, mag, web: f.web === true, shot };
}

/** Whether stepSim would move the world (false while an errand is open or the night is over). */
export const simRunning = (s: SimState) => s.mode !== "errand" && s.mode !== "done";

/**
 * One fixed step from one frame. The frame's one-shot (ability 1–4, Gwei 5) applies first.
 * Returns false, consuming nothing, while an errand is open or the night is over.
 */
export function stepSim(s: SimState, frame: InputFrame): boolean {
  if (!simRunning(s)) return false;
  const input = sane(frame);
  s.tick += 1;
  s.time += DT;
  s.input = input;
  if (input.shot >= 1 && input.shot <= 4) fireAbility(s, input.shot - 1);
  else if (input.shot === 5) callGwei(s);

  switch (s.mode) {
    case "travel":
      stepHero(s, input, DT);
      stepAbilities(s, DT);
      // A time trial's rings are its gates, taken in order (trial.ts).
      if (s.trial) stepTrial(s);
      else collectPickups(s);
      stepCombo(s);
      if (s.chapter) findClues(s);
      if (s.fee) stepFeeTravel(s);
      checkArrival(s);
      break;
    case "intro":
      stepHero(s, input, DT);
      stepVillain(s, DT);
      stepAbilities(s, DT);
      stepCombo(s);
      s.modeT -= DT;
      if (s.modeT <= 0) {
        s.mode = "fight";
        s.events.push({ type: "fight-live", index: s.index });
      }
      break;
    case "fight":
      if (s.chapter) {
        // Case File 001: SAVED, the lasso's pull and the rescue shape the hero's input.
        stepHero(s, chapterInput(s, input), DT);
        s.hero.holdPrev = input.web;
      } else if (s.fee) {
        // Case File 003: cooling, a held web on the meter cools it instead of swinging.
        stepHero(s, feeInput(s, input), DT);
        s.hero.holdPrev = input.web;
      } else stepHero(s, input, DT);
      stepVillain(s, DT);
      stepHazards(s, DT);
      stepAbilities(s, DT);
      stepCombo(s);
      if (s.chapter) stepRescue(s, input);
      if (s.fee) stepCool(s, input);
      break;
    case "won":
      stepHero(s, input, DT);
      stepVillain(s, DT);
      stepAbilities(s, DT);
      stepCombo(s);
      s.modeT -= DT;
      if (s.modeT <= 0) {
        if (s.chapter) chapterWonEnd(s);
        else if (s.fee) feeWonEnd(s);
        else {
          s.events.push({ type: "stop-done", index: s.index });
          nextStop(s);
        }
      }
      break;
    case "ko":
      stepHero(s, input, DT);
      s.modeT -= DT;
      if (s.modeT <= 0) {
        s.mode = "done";
        s.events.push({ type: "night-over", reason: "ko" });
      }
      break;
  }
  return true;
}

/**
 * After the errand sheet: take the engine's vitals (a choice may heal) and move on. v3: the
 * hero stands on the ally's roof, turned toward the next stop, until the player moves (v2
 * pushed him off toward it).
 */
export function resolveErrand(s: SimState, vitals: { hp: number; fluid: number }) {
  if (s.mode !== "errand") return;
  s.hp = Math.max(1, Math.min(s.maxHp, Math.round(vitals.hp)));
  s.fluid = Math.max(0, Math.round(vitals.fluid));
  nextStop(s);
  const h = s.hero;
  const b = travelBearing(s);
  if (b) {
    h.fx = b.x;
    h.fz = b.z;
  }
}

/* ------------------------------------------------------------------ test hooks */

/** Debug: set health. Zero in a fight is a knockout; elsewhere health stays at 1 or more. */
export function debugSetHp(s: SimState, hp: number) {
  if (hp <= 0 && s.mode === "fight") {
    s.hp = 0;
    knockOut(s);
    return;
  }
  s.hp = Math.max(1, Math.min(s.maxHp, Math.round(hp)));
}

export function debugWin(s: SimState) {
  if (s.mode !== "fight" || !s.villain) return false;
  s.villain.hits = 0;
  winFight(s);
  return true;
}
