/**
 * Free roam's sim: createRoamSim builds an outing in the roam city from where the save's city
 * record left off; stepRoam advances it one fixed step (1/60 s) from one InputFrame. The state
 * is an ordinary SimState (mode "travel", no stops, no villain) with SimState.roam set, so the
 * swing integrator, the anchor choice and the render frame work as on a night, while patrol
 * nights (roam null) never reach a line of this.
 *
 * No timer and no end: an outing runs until the player leaves (or the log's MAX_TICKS), and
 * nothing hurts the hero (roam-2: a car knocks him down, and he gets up).
 */
import type { CityIndex } from "../city";
import { DT, HERO_RADIUS } from "../constants";
import type { InputFrame } from "../contract";
import { newHero } from "../hero";
import { mix } from "../rng";
import type { SimState } from "../types";
import { ROAM_CITY_SEED, SHOT_ACT, SHOT_DROP, SHOT_JUMP, SHOT_SPRINT, SHOT_ZIP, SPRINT_GRACE } from "./constants";
import { stepMove, type Presses } from "../parkour/move";
import { stepKnock } from "./knock";
import { stepRelays } from "./task-crosschain";
import { stepPeople, unplugTarget } from "./tasks";
import { buildTraffic, stepTraffic } from "./traffic";
import { TASK_DONE, TASK_IDS, type RoamBody, type RoamStart, type RoamState } from "./types";
import { clearAt, roamCity, roamGrid, roamWorld } from "./world";

function newBody(): RoamBody {
  return {
    move: "ground",
    moveT: 0,
    sprintT: 0,
    jumpBuf: 0,
    coyote: 0,
    grabCd: 0,
    zipCd: 0,
    leapCd: 0,
    awayT: 0,
    wallruns: 0,
    wnx: 0,
    wnz: 0,
    wtop: 0,
    wface: 0,
    wdx: 0,
    wdz: 0,
    ax: 0,
    ay: 0,
    az: 0,
    bx: 0,
    by: 0,
    bz: 0,
    dur: 0,
    arc: 0,
    ex: 0,
    ez: 0,
    land: 0,
    launchT: 0,
    webHeld: false,
  };
}

/** A start with nothing found yet, on the spawn roof. */
export const freshStart = (): RoamStart => ({ stage: TASK_IDS.map(() => 0), items: TASK_IDS.map(() => 0), pages: 0, views: 0, talks: [], at: null });

/** Whether a start's spot can be stood on (a feet point with room for the body): else the spawn. */
function spotOk(grid: CityIndex, at: RoamStart["at"]): boolean {
  if (!at) return false;
  const { x, y, z } = at;
  if (![x, y, z, at.fx, at.fz].every(Number.isFinite)) return false;
  const c = grid.city.bounds;
  if (x < c.x0 + HERO_RADIUS || x > c.x1 - HERO_RADIUS || z < c.z0 + HERO_RADIUS || z > c.z1 - HERO_RADIUS || y < 0 || y > 2000) return false;
  // Room for the body there (never inside a building).
  return clearAt(grid, x, y + HERO_RADIUS + 1, z, HERO_RADIUS);
}

/**
 * An outing: the roam city, the hero (full health; nothing hurts him here) at `start.at` (or
 * the spawn roof), and the city's progress as the save left it.
 */
export function createRoamSim(start: RoamStart, heroLevel = 1): SimState {
  const city = roamCity();
  const world = roamWorld();
  const grid = roamGrid(city);
  const at = spotOk(grid, start.at) ? start.at! : world.spawn;
  const hero = newHero(at.x, at.y, at.z, true);
  const fl = Math.sqrt(at.fx * at.fx + at.fz * at.fz);
  hero.fx = fl > 1e-6 ? at.fx / fl : 1;
  hero.fz = fl > 1e-6 ? at.fz / fl : 0;
  const stage = TASK_IDS.map((_, i) => {
    const v = start.stage[i] ?? 0;
    return Number.isInteger(v) && v >= 0 && v <= TASK_DONE ? v : 0;
  });
  // A chase can't carry over between outings: the bot goes home, the jogger asks again.
  if (stage[1] === 1) stage[1] = 0;
  const roam: RoamState = {
    body: newBody(),
    world,
    progress: {
      stage,
      items: TASK_IDS.map((_, i) => (start.items[i] ?? 0) >>> 0),
      pages: start.pages >>> 0,
      views: start.views >>> 0,
      talks: world.folks.map(() => 0),
      breadT: 0,
    },
    bot: { state: stage[1] >= 2 ? 3 : 0, leg: 0, part: 0, u: 0, x: world.botPath[0]?.x ?? 0, y: world.botPath[0]?.y ?? 0, z: world.botPath[0]?.z ?? 0, vx: 0, vy: 0, vz: 0 },
    chat: null,
    events: [],
    traffic: buildTraffic(city, grid, at),
    hold: { act: false, relay: -1, ticks: 0 },
  };
  const s: SimState = {
    config: { seed: ROAM_CITY_SEED, stops: [], index: city.zones.length, entry: "travel", hp: 100, maxHp: 100, fluid: 0, combo: 0, gweiCalls: 0, heroLevel, loadout: [] },
    city,
    grid,
    tick: 0,
    time: 0,
    rng: mix(ROAM_CITY_SEED, 0x40a3),
    mode: "travel",
    modeT: 0,
    index: city.zones.length,
    hero,
    hp: 100,
    maxHp: 100,
    fluid: 0,
    fluidAcc: 0,
    combo: 0,
    maxCombo: 0,
    comboT: 0,
    pickups: [],
    bits: 0,
    rings: 0,
    pickupPoints: 0,
    tally: { perfect: 0, good: 0, miss: 0 },
    total: { perfect: 0, good: 0, miss: 0 },
    uses: {},
    powers: [],
    villain: null,
    hazards: [],
    shots: [],
    gwei: null,
    gweiLeft: 0,
    gweiUsed: 0,
    slowmo: 0,
    input: { dir: 0, mag: 0, web: false, shot: 0 },
    events: [],
    chapter: null,
    roam,
  };
  return s;
}

/** A frame with every field in range (as the patrol sim's sane()). */
function sane(f: InputFrame): InputFrame {
  const mag = f.mag === 1 || f.mag === 2 || f.mag === 3 ? f.mag : 0;
  const dir = mag > 0 && Number.isInteger(f.dir) && f.dir >= 0 && f.dir < 64 ? f.dir : 0;
  const shot = (Number.isInteger(f.shot) && f.shot >= 0 && f.shot <= 5 ? f.shot : 0) as InputFrame["shot"];
  return { dir, mag, web: f.web === true, shot };
}

/** One fixed step of an outing. Always steps (there's nothing to wait on and no end). */
export function stepRoam(s: SimState, frame: InputFrame): boolean {
  const r = s.roam;
  if (!r) return false;
  const input = sane(frame);
  s.tick += 1;
  s.time += DT;
  s.input = input;
  const b = r.body;
  b.sprintT = input.shot === SHOT_SPRINT ? SPRINT_GRACE : Math.max(0, b.sprintT - 1);
  // roam-3: interact is held over ticks (constants.ts): a talk, a photo or a sync takes a hold's
  // first tick; a relay takes every tick of it (task-crosschain.ts).
  const held = input.shot === SHOT_ACT;
  const press: Presses = { jump: input.shot === SHOT_JUMP, zip: input.shot === SHOT_ZIP, act: held && !r.hold.act, drop: input.shot === SHOT_DROP };
  r.hold.act = held;
  // roam-2: the cars move first (and may knock him down); down, the parkour set waits.
  stepTraffic(s);
  if (b.move === "knocked") stepKnock(s);
  else stepMove(s, input, press, DT);
  stepPeople(s, press, DT);
  stepRelays(s, held, held ? unplugTarget(s) : -1);
  return true;
}
