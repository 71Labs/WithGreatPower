/**
 * The swing sim: createSim builds a night from the patrol; stepSim advances it one fixed
 * step (1/60 s). Pure and deterministic: no DOM, no clocks, randomness only from the
 * seed. The loop drains `state.events` after each step and turns them into engine
 * actions (sim-arrive, sim-fight, leave-stop) and effects.
 */
import { DT, ERRAND_REACH, HERO_RADIUS, INTRO_SECONDS } from "./constants";
import { callGwei, fireAbility, makeSlots, stepAbilities } from "./abilities";
import { knockOut, winFight } from "./combat";
import { newHero, stepHero } from "./hero";
import { mix } from "./rng";
import type { SimConfig, SimInput, SimState, Zone } from "./types";
import { spawnVillain, stepHazards, stepVillain } from "./villains";
import { generateWorld, spawnPoint } from "./world";

export function createSim(config: SimConfig): SimState {
  const world = generateWorld(config.seed, config.stops);
  const sp = spawnPoint(world, config.index);
  const s: SimState = {
    config,
    world,
    tick: 0,
    time: 0,
    rng: mix(config.seed, 0x5e17 + config.index * 977),
    mode: "travel",
    modeT: 0,
    index: config.index,
    hero: newHero(sp.x, sp.y, sp.grounded),
    hp: Math.max(1, config.hp),
    maxHp: config.maxHp,
    fluid: config.fluid,
    combo: config.combo,
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
    events: [],
    commands: [],
  };
  if (config.index >= world.zones.length) {
    s.mode = "done";
  } else if (config.entry === "zone") {
    // Resumed mid-stop: already there, so no arrival to report.
    const z = world.zones[config.index];
    placeInZone(s, z);
    enterZone(s, z);
  }
  return s;
}

/** Stand the hero somewhere sensible inside a zone (used when resuming there). */
function placeInZone(s: SimState, z: Zone) {
  const x = z.kind === "errand" && z.ally ? z.ally.x - 150 : z.x0 + 150;
  let top = 0;
  for (const p of s.world.platforms) if (x >= p.x0 && x <= p.x1 && p.y > top && p.y < 400) top = p.y;
  const h = s.hero;
  h.x = x;
  h.y = top + HERO_RADIUS;
  h.vx = 0;
  h.vy = 0;
  h.grounded = top > 0;
  h.rope = null;
}

function enterZone(s: SimState, z: Zone) {
  s.hazards = [];
  s.shots = [];
  s.gwei = null;
  s.gweiUsed = 0;
  if (z.kind === "fight") {
    s.mode = "intro";
    s.modeT = INTRO_SECONDS;
    s.villain = spawnVillain(s, z);
    s.events.push({ type: "encounter", index: z.index, villain: s.villain.kind });
  } else {
    s.mode = "errand";
    // Land beside the ally for the chat.
    const h = s.hero;
    h.rope = null;
    if (z.ally) {
      const x = z.ally.x - 120;
      let top = 0;
      for (const p of s.world.platforms) if (x >= p.x0 && x <= p.x1 && p.y > top && p.y <= z.ally.y) top = p.y;
      h.x = x;
      h.y = top + HERO_RADIUS;
      h.vx = 0;
      h.vy = 0;
      h.grounded = top > 0;
      h.facing = 1;
      h.angle = 0;
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
  if (s.index >= s.world.zones.length) {
    s.mode = "done";
    s.events.push({ type: "night-over", reason: "route" });
  } else {
    s.mode = "travel";
  }
}

function checkArrival(s: SimState) {
  const z = s.world.zones[s.index];
  if (!z) return;
  const h = s.hero;
  if (z.kind === "fight") {
    if (h.x >= z.x0 + 70) arrive(s, z);
  } else if (z.ally) {
    const near = Math.hypot(h.x - z.ally.x, h.y - z.ally.y) < ERRAND_REACH;
    if (near || h.x > z.ally.x + 60) arrive(s, z);
  }
}

/** One fixed step. Commands queued since the last step apply first. */
export function stepSim(s: SimState, input: SimInput) {
  s.tick += 1;
  s.time += DT;
  for (const c of s.commands) {
    if (c.type === "ability") fireAbility(s, c.slot);
    else callGwei(s);
  }
  s.commands.length = 0;

  switch (s.mode) {
    case "travel":
      stepHero(s, input, DT);
      stepAbilities(s, DT);
      checkArrival(s);
      break;
    case "intro":
      stepHero(s, input, DT);
      stepVillain(s, DT);
      stepAbilities(s, DT);
      s.modeT -= DT;
      if (s.modeT <= 0) {
        s.mode = "fight";
        s.events.push({ type: "fight-live", index: s.index });
      }
      break;
    case "fight":
      stepHero(s, input, DT);
      stepVillain(s, DT);
      stepHazards(s, DT);
      stepAbilities(s, DT);
      break;
    case "won":
      stepHero(s, input, DT);
      stepVillain(s, DT);
      stepAbilities(s, DT);
      s.modeT -= DT;
      if (s.modeT <= 0) {
        s.events.push({ type: "stop-done", index: s.index });
        nextStop(s);
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
    case "errand":
    case "done":
      break;
  }
}

/** After the errand sheet: take the engine's vitals (a choice may heal) and swing on. */
export function resolveErrand(s: SimState, vitals: { hp: number; fluid: number }) {
  if (s.mode !== "errand") return;
  s.hp = Math.max(1, Math.min(s.maxHp, vitals.hp));
  s.fluid = vitals.fluid;
  nextStop(s);
  // A little push off the ally's roof, so the swing starts with momentum.
  const h = s.hero;
  if (h.grounded) h.vx = Math.max(h.vx, 200);
}

export function queueAbility(s: SimState, slot: number) {
  s.commands.push({ type: "ability", slot });
}

export function queueGwei(s: SimState) {
  s.commands.push({ type: "gwei" });
}

/* ------------------------------------------------------------------ debug hooks */

/** Debug: put the hero just short of the current stop, swinging in. */
export function debugTeleport(s: SimState) {
  const z = s.world.zones[s.index];
  if (!z || s.mode !== "travel") return false;
  const h = s.hero;
  const x = z.kind === "errand" && z.ally ? z.ally.x - 700 : z.x0 - 600;
  h.x = x;
  h.y = 620;
  h.vx = 650;
  h.vy = 200;
  h.grounded = false;
  h.rope = null;
  return true;
}

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

