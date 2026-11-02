/**
 * The rules of With Great Power, as one pure reducer: reduce(save, action) → save.
 * No randomness without a seed, no clocks, no I/O, so a save replays the same way and
 * every rule can be tested on its own.
 */
import { castById } from "./cast";

import {
  ALLY_CAST,
  BOSS_HP,
  DISTRICTS,
  FLUID_REGEN,
  LANDING_HEAL,
  ERRANDS,
  GWEI_ASSIST,
  HERO_BASE_HP,
  HP_PER_LEVEL,
  ITEMS,
  MAX_FLUID,
  MAX_LOADOUT,
  POWERS,
  PUNCH,
  STARTER_POWERS,
  STARTER_UNLOCK_LEVEL,
  SUITS,
  SIM_SWING_XP_CAP,
  SWING,
  VILLAINS,
  XP_TO_NEXT,
  damageScale,
  levelScale,
  powerScale,
  villainLevel,
} from "./data";
import type {
  Edition,
  Fight,
  FightLine,
  Hero,
  Intent,
  ItemId,
  MoveId,
  Patrol,
  PowerId,
  Quest,
  Save,
  Stop,
  StopResult,
  Story,
  SuitId,
  SwingGrade,
  VillainId,
} from "./types";

export type Action =
  | { type: "create-hero"; name: string; suit: SuitId; powers: PowerId[] }
  | { type: "start-patrol" }
  | { type: "swing"; grade: SwingGrade }
  | { type: "move"; move: MoveId }
  | { type: "errand"; choice: string }
  | { type: "leave-stop" }
  | { type: "finish-patrol" }
  /** Real-time play: you've swung to the next stop. Vitals and swing stats come from the sim. */
  | {
      type: "sim-arrive";
      hp: number;
      fluid: number;
      perfect: number;
      good: number;
      miss: number;
      combo: number;
      /** Powers used on the way, for mastery. */
      uses?: Partial<Record<PowerId, number>>;
    }
  /** Real-time play: a villain encounter ended. Loot and XP are still decided by the engine. */
  | { type: "sim-fight"; won: boolean; hp: number; fluid: number; uses?: Partial<Record<PowerId, number>>; gweiCalls?: number }
  | { type: "sleep" }
  | { type: "vote"; side: "hero" | "menace" }
  | { type: "pick-power"; power: PowerId }
  | { type: "set-loadout"; loadout: PowerId[] }
  | { type: "craft-suit"; suit: SuitId }
  | { type: "equip-suit"; suit: SuitId }
  | { type: "reset" };

/* ------------------------------------------------------------------ helpers */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** mulberry32: one step of a seeded generator. Returns [value in [0, 1), next state]. */
export function rand(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** A stable seed from a night and a hero name. */
export function seedOf(night: number, name: string): number {
  let h = 0x811c9dc5 ^ night;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function pick<T>(items: T[], state: number): [T, number] {
  const [r, next] = rand(state);
  return [items[Math.floor(r * items.length)], next];
}

function shuffle<T>(items: T[], state: number): [T[], number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [r, next] = rand(s);
    s = next;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

const addLoot = (a: Partial<Record<ItemId, number>>, b: Partial<Record<ItemId, number>>) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b) as [ItemId, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
};

export function newSave(): Save {
  return {
    version: 1,
    hero: null,
    night: 1,
    patrol: null,
    nightDone: false,
    inventory: {},
    suits: [],
    album: {},
    editions: [],
    reputation: 0,
    stats: { villainsCaught: 0, errands: 0, knockouts: 0, perfectSwings: 0, nights: 0 },
  };
}

/** The quest that applies tonight, if the last edition set one and it isn't done. */
export function activeQuest(save: Save): Quest | null {
  const q = save.editions[0]?.quest ?? null;
  return q && q.night === save.night && !q.done ? q : null;
}

/** Fluid a power costs right now (Doc's jam adds 5). */
export function moveCost(fight: Fight, move: MoveId): number {
  if (move === "punch" || move === "gwei") return 0;
  return POWERS[move].cost + (fight.jammed > 0 ? 5 : 0);
}

/** Why a move can't be used right now, or null if it can. For disabled buttons. */
export function moveBlocked(save: Save, move: MoveId): string | null {
  const p = save.patrol;
  const f = p?.fight;
  if (!p || !f || f.result || !save.hero) return "No fight";
  if (move === "punch") return null;
  if (move === "gwei") return p.gweiCalls > 0 ? null : "Gwei has gone home";
  if (!save.hero.loadout.includes(move)) return "Not in your loadout";
  const cd = f.cooldowns[move] ?? 0;
  if (cd > 0) return `Ready in ${cd} turn${cd === 1 ? "" : "s"}`;
  if (p.fluid < moveCost(f, move)) return "Not enough web fluid";
  return null;
}

/* ------------------------------------------------------------------ patrols */

export function generatePatrol(save: Save, hero: Hero): Patrol {
  const level = villainLevel(save.night);
  const quest = activeQuest(save);

  const [order, s1] = shuffle(Object.keys(VILLAINS) as VillainId[], seedOf(save.night, hero.name));
  // The boss is the quest villain when there is one; the warm-up fight is someone else.
  const boss = quest ? quest.villain : order[0];
  const warmup = order.find((v) => v !== boss)!;

  const [errands, s2] = shuffle(ERRANDS, s1);

  const fight = (v: VillainId, isBoss: boolean): Stop => ({
    kind: "fight",
    villain: v,
    district: VILLAINS[v].district,
    level,
    boss: isBoss,
    quest: isBoss && !!quest,
  });
  const errand = (e: (typeof ERRANDS)[number]): Stop => ({ kind: "errand", ally: e.ally, errand: e.id, district: e.district });

  const [early, s3] = shuffle([fight(warmup, false), errand(errands[0]), errand(errands[1])], s2);
  const maxHp = hero.maxHp;
  return {
    night: save.night,
    seed: s3,
    stops: [...early, fight(boss, true)],
    index: 0,
    phase: "briefing",
    hp: maxHp,
    maxHp,
    fluid: MAX_FLUID,
    combo: 0,
    perfectSwings: 0,
    fight: null,
    results: [],
    swingXp: 0,
    gweiCalls: 1,
    quote: null,
    knockedOut: false,
  };
}

/* ------------------------------------------------------------------ fights */

const DAMAGE_KINDS: Intent["kind"][] = ["attack", "heavy", "drain", "frontrun", "grab", "swarm"];

function nextIntent(villain: VillainId, level: number, cursor: number, rng: number): [Intent, number, number] {
  const moves = VILLAINS[villain].moves;
  const [r, s1] = rand(rng);
  // Mostly the pattern, sometimes a surprise, so players learn it but can't script it.
  let idx = (cursor + 1) % moves.length;
  let s = s1;
  if (r < 0.22) {
    const [r2, s2] = rand(s1);
    idx = Math.floor(r2 * moves.length);
    s = s2;
  }
  const m = moves[idx];
  const value = DAMAGE_KINDS.includes(m.kind) ? Math.round(m.value * damageScale(level)) : m.value;
  return [{ ...m, value }, idx, s];
}

export function startFight(stop: Extract<Stop, { kind: "fight" }>, seed: number): Fight {
  const v = VILLAINS[stop.villain];
  const maxHp = Math.round(v.hp * levelScale(stop.level) * (stop.boss ? BOSS_HP : 1));
  let rng = seed;
  let cursor = -1;
  const intents: Intent[] = [];
  for (let i = 0; i < 3; i++) {
    const [intent, c, s] = nextIntent(stop.villain, stop.level, cursor, rng);
    intents.push(intent);
    cursor = c;
    rng = s;
  }
  const log: FightLine[] = [{ who: "villain", text: `${v.name}: “${v.taunt}”` }];
  if (stop.quest) log.push({ who: "system", text: "Quest target. Catch him tonight for the bonus." });
  return {
    villain: stop.villain,
    level: stop.level,
    boss: stop.boss,
    hp: maxHp,
    maxHp,
    intents,
    turn: 1,
    block: 0,
    dodges: 0,
    webbed: 0,
    charged: false,
    copies: 0,
    jammed: 0,
    forked: false,
    cooldowns: {},
    cursor,
    log,
    rng,
    result: null,
  };
}

/** Damage to the villain. Sybil copies soak the hit: a hit pops one copy and half of it lands. */
function hitVillain(f: Fight, dmg: number, log: FightLine[], what: string, clearsCopies = false) {
  if (f.copies > 0) {
    const popped = clearsCopies ? f.copies : 1;
    f.copies -= popped;
    const landed = clearsCopies ? dmg : Math.round(dmg / 2);
    f.hp = Math.max(0, f.hp - landed);
    log.push({ who: "hero", text: `${what} pops ${popped === 1 ? "a copy" : `${popped} copies`} and lands ${landed}.` });
    return;
  }
  f.hp = Math.max(0, f.hp - dmg);
  log.push({ who: "hero", text: `${what} hits for ${dmg}.` });
}

/** Apply one power's effect. Returns true if the villain's action this turn is cancelled. */
function applyPower(f: Fight, p: Patrol, hero: Hero, id: PowerId, log: FightLine[]): boolean {
  const power = POWERS[id];
  const s = powerScale(hero.powers[id]?.mastery ?? 0);
  const intent = f.intents[0];
  let cancel = false;
  if (power.damage) {
    let dmg = Math.round(power.damage * s);
    if (id === "finality" && f.webbed > 0) dmg *= 2;
    if (id === "front-run" && intent?.kind === "frontrun") {
      dmg = Math.round(dmg * 1.5);
      cancel = true;
    }
    if (id === "yank" && (intent?.kind === "charge" || intent?.kind === "heavy")) {
      cancel = true;
      f.charged = false;
    }
    hitVillain(f, dmg, log, power.name, id === "web-bomb");
    if (cancel) log.push({ who: "system", text: `${power.name} breaks ${VILLAINS[f.villain].name}’s ${intent.label.toLowerCase()}.` });
  }
  if (power.block) {
    const b = Math.round(power.block * s);
    f.block += b;
    log.push({ who: "hero", text: `${power.name}: ${b} damage will be soaked.` });
  }
  if (power.dodge) {
    f.dodges += power.dodge;
    log.push({ who: "hero", text: `${power.name}: the next ${power.dodge === 1 ? "attack" : `${power.dodge} attacks`} will miss.` });
  }
  if (power.heal) {
    const h = Math.round(power.heal * s);
    p.hp = Math.min(p.maxHp, p.hp + h);
    log.push({ who: "hero", text: `${power.name}: +${h} health.` });
  }
  if (power.fluid) {
    const fl = Math.round(power.fluid * s);
    p.fluid = Math.min(MAX_FLUID, p.fluid + fl);
    log.push({ who: "hero", text: `${power.name}: +${fl} web fluid.` });
  }
  if (power.stun) {
    f.webbed += power.stun;
    log.push({ who: "system", text: `${VILLAINS[f.villain].name} is webbed for a turn.` });
  }
  if (id === "fork") {
    f.forked = true;
    log.push({ who: "hero", text: "Fork: your next power happens twice." });
  }
  return cancel;
}

/** The villain's action for this turn. */
function villainActs(f: Fight, p: Patrol, log: FightLine[]) {
  const v = VILLAINS[f.villain];
  const intent = f.intents[0];
  if (!intent) return;
  if (f.webbed > 0) {
    f.webbed -= 1;
    log.push({ who: "villain", text: `${v.name} struggles in the web and loses the turn.` });
    return;
  }
  const strike = (dmg: number, label: string) => {
    if (f.dodges > 0) {
      f.dodges -= 1;
      log.push({ who: "villain", text: `${label} misses. Node sense.` });
      return;
    }
    const total = f.charged ? dmg * 2 : dmg;
    f.charged = false;
    const soaked = Math.min(f.block, total);
    f.block -= soaked;
    p.hp = Math.max(0, p.hp - (total - soaked));
    log.push({ who: "villain", text: `${label} hits you for ${total - soaked}${soaked ? ` (${soaked} soaked)` : ""}.` });
  };
  switch (intent.kind) {
    case "attack":
    case "heavy":
    case "frontrun":
      strike(intent.value, intent.label);
      break;
    case "drain":
      strike(intent.value, intent.label);
      p.fluid = Math.max(0, p.fluid - 10);
      log.push({ who: "villain", text: "It burns 10 of your web fluid." });
      break;
    case "grab":
      f.block = 0;
      p.fluid = Math.max(0, p.fluid - 8);
      strike(intent.value, intent.label);
      break;
    case "swarm":
      strike(intent.value * (f.copies + 1), f.copies > 0 ? `${intent.label} (${f.copies + 1} of him)` : intent.label);
      break;
    case "charge":
      f.charged = true;
      log.push({ who: "villain", text: `${v.name} ${intent.label.toLowerCase()}. His next hit doubles.` });
      break;
    case "summon":
      f.copies = Math.min(4, f.copies + intent.value);
      log.push({ who: "villain", text: `Another Sybil appears. ${f.copies === 1 ? "One copy" : `${f.copies} copies`} now.` });
      break;
    case "jam":
      f.jammed = intent.value + 1;
      log.push({ who: "villain", text: "Chain jam: your powers cost 5 more fluid for two turns." });
      break;
  }
}

function fightMove(save: Save, move: MoveId): Save {
  const blocked = moveBlocked(save, move);
  if (blocked) return save;
  const hero: Hero = { ...save.hero!, powers: { ...save.hero!.powers } };
  const p: Patrol = { ...save.patrol!, results: save.patrol!.results.slice() };
  const f: Fight = { ...p.fight!, intents: p.fight!.intents.slice(), cooldowns: { ...p.fight!.cooldowns } };
  const log: FightLine[] = [];
  const intent = f.intents[0];
  const v = VILLAINS[f.villain];

  // Sandwich Man's front-run lands before your move, unless you front-run him first.
  let villainDone = false;
  if (intent?.kind === "frontrun" && move !== "front-run") {
    log.push({ who: "system", text: `${v.name} front-runs you.` });
    villainActs(f, p, log);
    villainDone = true;
  }

  let cancelled = false;
  if (p.hp > 0) {
    if (move === "punch") {
      hitVillain(f, PUNCH.damage, log, PUNCH.name);
    } else if (move === "gwei") {
      p.gweiCalls -= 1;
      hitVillain(f, GWEI_ASSIST.damage + 2 * hero.level, log, "Gwei Stacy swings in and", true);
    } else {
      p.fluid -= moveCost(f, move);
      const times = f.forked && move !== "fork" ? 2 : 1;
      if (times === 2) f.forked = false;
      for (let i = 0; i < times; i++) {
        cancelled = applyPower(f, p, hero, move, log) || cancelled;
        hero.powers[move] = { mastery: (hero.powers[move]?.mastery ?? 0) + 1 };
      }
      f.cooldowns[move] = POWERS[move].cooldown + 1;
    }
  }

  if (f.hp <= 0) {
    f.result = "won";
    log.push({ who: "system", text: v.defeat });
  } else if (!villainDone && !cancelled && p.hp > 0) {
    villainActs(f, p, log);
  }

  if (p.hp <= 0 && !f.result) {
    f.result = "lost";
    log.push({ who: "system", text: `${v.name} knocks you out. Aunt Mainnet will patch you up.` });
  }

  // End of turn: shields fade, cooldowns and jams tick, the next intent is revealed.
  f.block = 0;
  for (const k of Object.keys(f.cooldowns) as PowerId[]) {
    const left = (f.cooldowns[k] ?? 0) - 1;
    if (left > 0) f.cooldowns[k] = left;
    else delete f.cooldowns[k];
  }
  if (f.jammed > 0) f.jammed -= 1;
  if (!f.result) {
    p.fluid = Math.min(MAX_FLUID, p.fluid + FLUID_REGEN);
    const [nxt, c, s] = nextIntent(f.villain, f.level, f.cursor, f.rng);
    f.intents = [...f.intents.slice(1), nxt];
    f.cursor = c;
    f.rng = s;
    f.turn += 1;
  }
  f.log = [...f.log, ...log].slice(-40);
  p.fight = f;

  if (f.result) p.results.push(fightResult(p, f));
  return { ...save, hero, patrol: p };
}

function fightResult(p: Patrol, f: Fight): StopResult {
  const v = VILLAINS[f.villain];
  const stop = p.stops[p.index] as Extract<Stop, { kind: "fight" }>;
  if (f.result === "lost") {
    return {
      kind: "fight",
      outcome: "lost",
      who: f.villain,
      district: v.district,
      text: `Knocked out by ${v.name}`,
      xp: 5,
      loot: {},
      responsibility: 0,
      reputation: -6,
    };
  }
  // Loot is seeded by the fight, so it's fixed the moment you win.
  const [r] = rand(f.rng ^ 0x5bd1e995);
  const rareChance = 0.2 + (f.boss ? 0.3 : 0) + (stop.quest ? 0.5 : 0);
  const loot: Partial<Record<ItemId, number>> = { [v.loot.common]: f.boss ? 2 : 1 };
  if (r < rareChance) loot[v.loot.rare] = (loot[v.loot.rare] ?? 0) + 1;
  const comboBonus = 1 + 0.1 * Math.min(p.combo, 5);
  const xp = Math.round(28 * levelScale(f.level) * (f.boss ? 1.5 : 1) * comboBonus);
  return {
    kind: "fight",
    outcome: "won",
    who: f.villain,
    district: v.district,
    text: `Caught ${v.name}`,
    xp,
    loot,
    responsibility: 1,
    reputation: 4,
  };
}

/* ------------------------------------------------------------------ the night */

function edition(save: Save, p: Patrol, hero: Hero, rep: number, responsibility: number): Edition {
  const name = hero.name;
  const stories: Story[] = [];
  const won = p.results.filter((r) => r.kind === "fight" && r.outcome === "won");
  const bossStop = p.stops[p.stops.length - 1] as Extract<Stop, { kind: "fight" }>;
  const bossCaught = won.some((r) => r.who === bossStop.villain);
  const lost = p.results.find((r) => r.kind === "fight" && r.outcome === "lost");

  const bossLines: Record<VillainId, [string, string]> = {
    "gas-goblin": ["Web-head grounds Gas Goblin", `Fees fall back to normal as ${name} ties the goblin to a lamppost. Editor demands a refund anyway`],
    "sandwich-man": ["Sandwich Man wrapped to go", `${name} stops the Mempool Market’s worst queue-jumper. Trades arrive in one piece for once`],
    "doc-octochain": ["Bridge reopens after arm-wrestle", `${name} knots all eight of Doc Octochain’s arms. Commuters cross for the first time in days`],
    sybil: ["All of The Sybil caught. Probably", `${name} webs every copy of the city’s most crowded villain. Editor counts them twice`],
  };

  let headline: string;
  let dek: string;
  let who = bossStop.villain as Story["who"];
  if (lost) {
    headline = `${name} flattened in ${DISTRICTS[lost.district].name}`;
    dek = `Menace finally meets his match, says a delighted editor. ${castById(lost.who).name} unavailable for comment`;
    who = lost.who;
  } else if (bossCaught) {
    [headline, dek] = bossLines[bossStop.villain];
  } else {
    headline = "Quiet night, suspicious hero";
    dek = "Nothing exploded. Bearson suspects a cover-up";
    who = "bearson";
  }

  if (p.quote) stories.push({ headline: "Masked menace speaks", dek: `“${p.quote}” — ${name}, to this newspaper, under duress`, who: "bearson" });
  // A real-time night has dozens of swings; it takes a lot more of them to be "reckless".
  if (p.perfectSwings >= (p.realtime ? 15 : 3))
    stories.push({ headline: "Reckless stunts over the rooftops", dek: `${p.perfectSwings} perfect swings in one night. Pigeons file complaints`, who: "mary-jpeg" });
  // One story per person: Bearson doesn't vouch for you in the same paper he quotes you in.
  const covered = (who: Story["who"]) => stories.some((s) => s.who === who);
  for (const r of p.results.filter((x) => x.kind === "errand")) {
    if (stories.length >= 3) break;
    if (covered(r.who)) continue;
    stories.push({ headline: `${castById(r.who).name} vouches for ${name}`, dek: r.text, who: r.who });
  }
  const filler: Story[] = [
    { headline: "Bears were right", dek: "Editor reminds everyone he called it, again, about something, probably", who: "bearson" },
    { headline: "Aunt Mainnet: still up", dek: "Local aunt marks another night without downtime, credits early nights and a good loaf", who: "aunt-mainnet" },
    { headline: "Gas prices: who’s really responsible?", dek: "This paper investigates. Spoiler: a goblin", who: "gas-goblin" },
  ];
  for (const s of filler) if (stories.length < 3 && !covered(s.who)) stories.push(s);

  const heroPoll = clamp(Math.round(50 + rep * 0.35 + (responsibility - 50) * 0.2 + (lost ? -10 : 5)), 3, 97);

  // Tomorrow's quest: a villain who got away tonight.
  const caught = new Set(won.map((r) => r.who));
  const free = (Object.keys(VILLAINS) as VillainId[]).filter((v) => !caught.has(v));
  const [target] = pick(free.length ? free : (Object.keys(VILLAINS) as VillainId[]), p.seed ^ 0x9e3779b9);
  const questText: Record<VillainId, string> = {
    "gas-goblin": "Ground Gas Goblin before fees hit five hundred percent",
    "sandwich-man": "Catch Sandwich Man before he eats another trade",
    "doc-octochain": "Get Doc Octochain off the bridge",
    sybil: "Catch The Sybil. All of him",
  };
  const quest: Quest = {
    villain: target,
    text: questText[target],
    rewardXp: 40 + 10 * villainLevel(p.night + 1),
    rewardItem: VILLAINS[target].loot.rare,
    night: p.night + 1,
    done: false,
  };

  return { night: p.night, headline, dek, who, stories: stories.slice(0, 3), heroPoll, vote: null, quest };
}

function finishPatrol(save: Save): Save {
  const p = save.patrol;
  if (!p || p.phase !== "summary" || save.nightDone || !save.hero) return save;
  let hero: Hero = { ...save.hero };
  let inventory = { ...save.inventory };
  const album = { ...save.album };
  let xp = p.swingXp;
  let rep = save.reputation;
  let responsibility = hero.responsibility;
  let caught = 0;
  let errands = 0;

  for (const r of p.results) {
    xp += r.xp;
    inventory = addLoot(inventory, r.loot);
    rep += r.reputation;
    responsibility += r.responsibility;
    if (r.kind === "fight" && r.outcome === "won") {
      caught += 1;
      album[r.who] = (album[r.who] ?? 0) + 1;
    }
    if (r.kind === "errand") {
      errands += 1;
      album[r.who] = (album[r.who] ?? 0) + 1;
    }
  }

  // Tonight's quest pays out if its villain was caught.
  let editions = save.editions;
  const quest = activeQuest(save);
  if (quest && p.results.some((r) => r.kind === "fight" && r.outcome === "won" && r.who === quest.villain)) {
    xp += quest.rewardXp;
    inventory = addLoot(inventory, { [quest.rewardItem]: 1 });
    editions = [{ ...editions[0], quest: { ...quest, done: true } }, ...editions.slice(1)];
  }

  hero.xp += xp;
  const owned = Object.keys(hero.powers).length;
  const total = Object.keys(POWERS).length;
  while (hero.xp >= XP_TO_NEXT(hero.level)) {
    hero.xp -= XP_TO_NEXT(hero.level);
    hero = { ...hero, level: hero.level + 1, maxHp: hero.maxHp + HP_PER_LEVEL };
    if (owned + hero.pendingPicks < total) hero.pendingPicks += 1;
  }
  rep = clamp(rep, -100, 100);
  hero.responsibility = clamp(responsibility, 0, 100);

  const ed = edition(save, p, hero, rep, hero.responsibility);
  return {
    ...save,
    hero,
    inventory,
    album,
    reputation: rep,
    nightDone: true,
    editions: [ed, ...editions].slice(0, 14),
    stats: {
      villainsCaught: save.stats.villainsCaught + caught,
      errands: save.stats.errands + errands,
      knockouts: save.stats.knockouts + (p.knockedOut ? 1 : 0),
      perfectSwings: save.stats.perfectSwings + p.perfectSwings,
      nights: save.stats.nights + 1,
    },
  };
}

/** Mastery from powers used in real-time play. Only powers the hero owns count. */
function addMastery(hero: Hero, uses: Partial<Record<PowerId, number>> | undefined): Hero {
  if (!uses) return hero;
  const powers = { ...hero.powers };
  for (const [id, n] of Object.entries(uses) as [PowerId, number][]) {
    const owned = powers[id];
    if (owned && n > 0) powers[id] = { mastery: owned.mastery + Math.round(n) };
  }
  return { ...hero, powers };
}

/* ------------------------------------------------------------------ reducer */

export function reduce(save: Save, action: Action): Save {
  switch (action.type) {
    case "create-hero": {
      if (save.hero) return save;
      const name = action.name.trim().slice(0, 24).trim();
      const powers = [...new Set(action.powers)].filter((p) => STARTER_POWERS.includes(p));
      if (!name || powers.length !== 3 || !SUITS[action.suit]?.starter) return save;
      const hero: Hero = {
        name,
        level: 1,
        xp: 0,
        maxHp: HERO_BASE_HP,
        responsibility: 20,
        powers: Object.fromEntries(powers.map((p) => [p, { mastery: 0 }])),
        loadout: powers,
        suit: action.suit,
        pendingPicks: 0,
        createdNight: save.night,
      };
      return { ...save, hero, suits: [action.suit] };
    }

    case "start-patrol": {
      if (!save.hero || save.nightDone) return save;
      const patrol = save.patrol ?? generatePatrol(save, save.hero);
      return { ...save, patrol: patrol.phase === "briefing" ? { ...patrol, phase: "swing" } : patrol };
    }

    case "swing": {
      const p = save.patrol;
      if (!p || p.phase !== "swing") return save;
      const g = SWING[action.grade];
      const stop = p.stops[p.index];
      const next: Patrol = {
        ...p,
        phase: "stop",
        fluid: clamp(p.fluid + g.fluid, 0, MAX_FLUID),
        // Landing gives a breather; a missed web costs some of it back.
        hp: clamp(p.hp + g.hp + Math.round(p.maxHp * LANDING_HEAL), 1, p.maxHp),
        combo: action.grade === "miss" ? 0 : p.combo + g.combo,
        perfectSwings: p.perfectSwings + (action.grade === "perfect" ? 1 : 0),
        swingXp: p.swingXp + g.xp,
        fight: stop.kind === "fight" ? startFight(stop, (p.seed ^ Math.imul(p.index + 1, 0x9e3779b1)) >>> 0) : null,
      };
      return { ...save, patrol: next };
    }

    case "move": {
      const p = save.patrol;
      if (!p || p.phase !== "stop" || !p.fight || p.fight.result) return save;
      return fightMove(save, action.move);
    }

    case "errand": {
      const p = save.patrol;
      const stop = p?.stops[p.index];
      if (!p || p.phase !== "stop" || stop?.kind !== "errand" || p.results.length > p.index) return save;
      const errand = ERRANDS.find((e) => e.id === stop.errand);
      const choice = errand?.choices.find((c) => c.id === action.choice);
      if (!errand || !choice) return save;
      const result: StopResult = {
        kind: "errand",
        outcome: choice.id,
        who: ALLY_CAST[errand.ally],
        district: errand.district,
        text: choice.result,
        xp: choice.xp,
        loot: choice.item ? { [choice.item]: 1 } : {},
        responsibility: choice.responsibility,
        reputation: choice.reputation,
      };
      return {
        ...save,
        patrol: {
          ...p,
          hp: Math.min(p.maxHp, p.hp + (choice.heal ?? 0)),
          fluid: Math.min(MAX_FLUID, p.fluid + (choice.fluid ?? 0)),
          gweiCalls: p.gweiCalls + (errand.ally === "gwei" && choice.id === "team" ? 1 : 0),
          quote: choice.quote ?? p.quote,
          results: [...p.results, result],
        },
      };
    }

    case "leave-stop": {
      const p = save.patrol;
      if (!p || p.phase !== "stop") return save;
      if (p.results.length <= p.index) return save; // the stop isn't finished
      const knockedOut = p.knockedOut || p.fight?.result === "lost";
      const index = p.index + 1;
      const done = knockedOut || index >= p.stops.length;
      return { ...save, patrol: { ...p, index, knockedOut, phase: done ? "summary" : "swing", fight: null } };
    }

    case "finish-patrol":
      return finishPatrol(save);

    case "sim-arrive": {
      const p = save.patrol;
      if (!p || p.phase !== "swing") return save;
      const perfect = Math.max(0, Math.round(action.perfect));
      const good = Math.max(0, Math.round(action.good));
      // Every perfect swing counts for the paper; only the first few per stop earn XP.
      const xpPerfect = Math.min(perfect, SIM_SWING_XP_CAP);
      const xpGood = Math.min(good, SIM_SWING_XP_CAP - xpPerfect);
      const stop = p.stops[p.index];
      return {
        ...save,
        hero: save.hero ? addMastery(save.hero, action.uses) : save.hero,
        patrol: {
          ...p,
          phase: "stop",
          hp: clamp(Math.round(action.hp), 1, p.maxHp),
          fluid: clamp(Math.round(action.fluid), 0, MAX_FLUID),
          combo: Math.max(0, Math.round(action.combo)),
          perfectSwings: p.perfectSwings + perfect,
          swingXp: p.swingXp + xpPerfect * SWING.perfect.xp + xpGood * SWING.good.xp,
          realtime: true,
          // Same fight the turn-based mode starts, so a player can switch to classic mid-night.
          fight: stop.kind === "fight" ? startFight(stop, (p.seed ^ Math.imul(p.index + 1, 0x9e3779b1)) >>> 0) : null,
        },
      };
    }

    case "sim-fight": {
      const p = save.patrol;
      const stop = p?.stops[p.index];
      if (!p || p.phase !== "stop" || stop?.kind !== "fight" || p.results.length > p.index) return save;
      // The same seeded fight the turn-based mode would start, so loot is decided the same way.
      const f = startFight(stop, (p.seed ^ Math.imul(p.index + 1, 0x9e3779b1)) >>> 0);
      f.result = action.won ? "won" : "lost";
      const next: Patrol = {
        ...p,
        hp: clamp(Math.round(action.hp), 0, p.maxHp),
        fluid: clamp(Math.round(action.fluid), 0, MAX_FLUID),
        gweiCalls: Math.max(0, p.gweiCalls - Math.max(0, Math.round(action.gweiCalls ?? 0))),
        knockedOut: p.knockedOut || !action.won,
        results: p.results.slice(),
        fight: { ...(p.fight ?? f), result: f.result },
      };
      next.results.push(fightResult(next, f));
      return { ...save, hero: save.hero ? addMastery(save.hero, action.uses) : save.hero, patrol: next };
    }

    case "sleep": {
      if (!save.nightDone) return save;
      return { ...save, night: save.night + 1, patrol: null, nightDone: false };
    }

    case "vote": {
      const ed = save.editions[0];
      if (!ed || ed.vote) return save;
      const delta = action.side === "hero" ? 3 : -3;
      return {
        ...save,
        reputation: clamp(save.reputation + delta, -100, 100),
        editions: [{ ...ed, vote: action.side, heroPoll: clamp(ed.heroPoll + (delta > 0 ? 1 : -1), 0, 100) }, ...save.editions.slice(1)],
      };
    }

    case "pick-power": {
      const hero = save.hero;
      if (!hero || hero.pendingPicks < 1 || hero.powers[action.power] || !POWERS[action.power]) return save;
      const loadout = hero.loadout.length < MAX_LOADOUT ? [...hero.loadout, action.power] : hero.loadout;
      return {
        ...save,
        hero: { ...hero, pendingPicks: hero.pendingPicks - 1, powers: { ...hero.powers, [action.power]: { mastery: 0 } }, loadout },
      };
    }

    case "set-loadout": {
      const hero = save.hero;
      if (!hero || save.patrol?.phase === "stop") return save;
      const loadout = [...new Set(action.loadout)].filter((p) => hero.powers[p]);
      if (loadout.length < 1 || loadout.length > MAX_LOADOUT) return save;
      return { ...save, hero: { ...hero, loadout } };
    }

    case "craft-suit": {
      const hero = save.hero;
      const suit = SUITS[action.suit];
      const minLevel = suit.starter ? STARTER_UNLOCK_LEVEL : suit.minLevel;
      if (!hero || !suit || save.suits.includes(suit.id) || hero.level < minLevel) return save;
      const inventory = { ...save.inventory };
      for (const [item, n] of Object.entries(suit.recipe) as [ItemId, number][]) {
        if ((inventory[item] ?? 0) < n) return save;
        inventory[item] = (inventory[item] ?? 0) - n;
      }
      return { ...save, inventory, suits: [...save.suits, suit.id], hero: { ...hero, suit: suit.id } };
    }

    case "equip-suit": {
      if (!save.hero || !save.suits.includes(action.suit)) return save;
      return { ...save, hero: { ...save.hero, suit: action.suit } };
    }

    case "reset":
      return newSave();
  }
}

/** The stop being swung to or played, if a patrol is running. */
export function currentStop(save: Save): Stop | null {
  const p = save.patrol;
  return p && p.phase !== "summary" ? (p.stops[p.index] ?? null) : null;
}

/** What a craft is missing, item by item, or null if it can be crafted now. */
export function craftShortfall(save: Save, suit: SuitId): string | null {
  const s = SUITS[suit];
  if (!save.hero) return "No hero";
  if (save.suits.includes(suit)) return "Already yours";
  const minLevel = s.starter ? STARTER_UNLOCK_LEVEL : s.minLevel;
  const needs: string[] = [];
  if (save.hero.level < minLevel) needs.push(`level ${minLevel}`);
  for (const [item, n] of Object.entries(s.recipe) as [ItemId, number][]) {
    const short = n - (save.inventory[item] ?? 0);
    if (short > 0) needs.push(`${ITEMS[item].name} ×${short}`);
  }
  return needs.length ? `Needs ${needs.join(", ")}` : null;
}
