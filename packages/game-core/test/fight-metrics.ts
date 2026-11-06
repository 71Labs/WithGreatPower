/**
 * Fight metrics: how grounded, readable and balanced the fights are, measured over real
 * runs. The bot travels between stops; in a fight one of five players takes over:
 *
 * - bot: the sim's own bot (sim3d/bot.ts).
 * - simple: chases the villain and mashes the web button when close, fires power 1 when it's
 *   ready, never dodges (a first-time player). Reacts in 0.3 s.
 * - average: chases, presses the web when close and the villain isn't guarding, shoots power 1
 *   at range, heals when low, and dodges a wind-up sideways about half the time. 0.3 s.
 * - good: spaces itself, presses only into openings, dodges every wind-up and incoming shot,
 *   uses every power and calls Gwei for the boss. 0.15 s.
 * - idle: stands still (how long a fight takes to knock you out).
 *
 * Only public state is read (the hero, the villain, hazards, events), so the same harness
 * measures any ruleset. Printed with FIGHT_REPORT=1 (fight-report.test.ts) for before/after
 * numbers; fights.test.ts pins the ruleset's gates on it.
 */
import { chooseErrand, needsErrand, startRun, stepRun, type Run } from "../src/replay";
import { VILLAINS } from "../src/rules/data";
import { reduce } from "../src/rules/engine";
import type { PowerId, Save, Stop, VillainId } from "../src/rules/types";
import { abilityBlocked, gweiBlocked } from "../src/sim3d/abilities";
import { groundBelow } from "../src/sim3d/city";
import { isVulnerable, nearestTarget, takesHit } from "../src/sim3d/combat";
import type { InputFrame } from "../src/sim3d/contract";
import { dirIndex, len2, len3 } from "../src/sim3d/dmath";
import { botFrame, newBotMemory, type BotMemory } from "../src/sim3d/bot";
import type { SimEvent, SimState, SimVillainId } from "../src/sim3d/types";
import { heroSave } from "./helpers";

export type FightPolicy = "bot" | "simple" | "average" | "good" | "idle";
export const FIGHT_POLICIES: FightPolicy[] = ["bot", "simple", "average", "good"];
export const VILLAIN_IDS = Object.keys(VILLAINS) as VillainId[];

/* ------------------------------------------------------------------ the players */

export interface PlayerMem {
  t: number;
  /** A deterministic per-player random stream (the "human" coin flips). */
  rng: number;
  stickDir: number;
  stickMag: number;
  nextDecide: number;
  /** Ticks the web stays down, and the earliest tick it may be pressed again. */
  webLeft: number;
  webReady: number;
  /** A dodge: when it starts (after the reaction delay), how long it runs, which way. */
  dodgeAt: number;
  dodgeLeft: number;
  dodgeDir: number;
  shotReady: number;
  bot: BotMemory;
}

export const newPlayerMem = (seed: number): PlayerMem => ({
  t: 0,
  rng: seed >>> 0 || 1,
  stickDir: 0,
  stickMag: 0,
  nextDecide: 0,
  webLeft: 0,
  webReady: 0,
  dodgeAt: -1,
  dodgeLeft: 0,
  dodgeDir: 0,
  shotReady: 0,
  bot: newBotMemory(),
});

export function coin(m: PlayerMem): number {
  // xorshift32
  let x = m.rng;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  m.rng = x >>> 0;
  return m.rng / 4294967296;
}

interface Skill {
  /** Reaction delay and how often the stick is re-aimed, in ticks. */
  react: number;
  decide: number;
  /** Chance of dodging a wind-up, and whether incoming shots are dodged too. */
  dodge: number;
  dodgeShots: boolean;
  /** Only press into an opening (the villain not guarding, Doc's arms in). */
  patient: boolean;
  /** Keeps clear of Doc's arms and bread traps. */
  aware: boolean;
  /** How close it wants to stand. */
  close: number;
  /** Uses powers beyond slot 1, and Gwei. */
  powers: boolean;
}

const SKILL: Record<"simple" | "average" | "good", Skill> = {
  simple: { react: 18, decide: 15, dodge: 0, dodgeShots: false, patient: false, aware: false, close: 90, powers: false },
  average: { react: 18, decide: 10, dodge: 0.5, dodgeShots: false, patient: true, aware: true, close: 110, powers: false },
  good: { react: 9, decide: 6, dodge: 0.95, dodgeShots: true, patient: true, aware: true, close: 120, powers: true },
};

/** The big, telegraphed attacks a player can see coming. */
const WINDUPS = new Set(["Glider dive", "Front-run", "Cross-chain slam", "Eight-arm flurry", "Fake vote", "Bread trap", "Fee bomb", "Screenshot"]);

/** The power slot holding `id`, or −1. */
const slotOf = (s: SimState, id: PowerId) => s.powers.findIndex((p) => p.id === id);

function shotFor(s: SimState, m: PlayerMem, skill: Skill, dist: number): InputFrame["shot"] {
  if (m.t < m.shotReady) return 0;
  const v = s.villain!;
  const ready = (id: PowerId) => {
    const i = slotOf(s, id);
    return i >= 0 && !abilityBlocked(s, i) ? ((i + 1) as InputFrame["shot"]) : 0;
  };
  const fire = (shot: InputFrame["shot"], wait: number) => {
    if (shot) m.shotReady = m.t + wait;
    return shot;
  };
  if (!skill.powers) {
    // Power 1 (whatever it is) when it's up; average players also heal when low.
    if (!skill.patient) return fire(abilityBlocked(s, 0) ? 0 : 1, 30);
    if (s.hp < s.maxHp * 0.4) {
      const heal = ready("wall-crawl") || ready("gas-refund");
      if (heal) return fire(heal, 30);
    }
    if (dist > 200 && dist < 900 && !abilityBlocked(s, 0)) return fire(1, 30);
    return 0;
  }
  if (!gweiBlocked(s) && (v.boss || s.hp < s.maxHp * 0.35)) return fire(5, 30);
  if (s.hp < s.maxHp * 0.5) {
    const heal = ready("wall-crawl") || ready("gas-refund");
    if (heal) return fire(heal, 20);
  }
  const shield = s.hero.shieldT <= 0 ? ready("web-shield") : 0;
  if (shield) return fire(shield, 20);
  const open = isVulnerable(v);
  const bomb = dist < 480 && open ? ready("web-bomb") : 0;
  if (bomb) return fire(bomb, 20);
  const sling = dist > 160 && dist < 900 && open ? ready("web-sling") : 0;
  if (sling) return fire(sling, 20);
  const cloak = s.hp < s.maxHp * 0.6 ? ready("zk-cloak") : 0;
  if (cloak) return fire(cloak, 20);
  const yank = !open && dist < 700 ? ready("yank") : 0;
  if (yank) return fire(yank, 20);
  return 0;
}

/** A human-ish player's frame in a fight. `events` are last tick's. */
export function playerFrame(policy: "simple" | "average" | "good", s: SimState, m: PlayerMem, events: SimEvent[]): InputFrame {
  const skill = SKILL[policy];
  const h = s.hero;
  const v = s.villain!;
  m.t += 1;
  const t = nearestTarget(s, h.x, h.y, h.z) ?? { x: v.x, y: v.y, z: v.z, r: v.radius, body: -1 };
  const dx = t.x - h.x;
  const dz = t.z - h.z;
  const hd = len2(dx, dz);
  const dist = len3(dx, t.y - h.y, dz);
  // What a player sees: not guarding, or stumbling or stalled after an attack (Doc: arms in).
  // (The Right-Clicker's openings are his reload and his stagger; a paper copy in the way is always open.
  // So is one of Case File 002's Sybil copies: any hit pops it.)
  const open = takesHit(v) || (v.kind === "right-clicker" && t.body >= 0) || (!!s.chapter?.vote && t.body >= 0 && !v.bodies[t.body]?.real);

  // Dodges: a wind-up seen (after the reaction delay), sideways to the line between you.
  if (skill.dodge > 0) {
    for (const e of events) {
      if (e.type === "villain-attack" && WINDUPS.has(e.label) && m.dodgeLeft <= 0 && coin(m) < skill.dodge) {
        m.dodgeAt = m.t + skill.react;
        m.dodgeLeft = 0;
        const side = coin(m) < 0.5 ? 1 : -1;
        m.dodgeDir = dirIndex(-dz * side, dx * side);
      }
    }
    if (skill.dodgeShots && m.dodgeAt < 0 && m.dodgeLeft <= 0) {
      for (const z of s.hazards) {
        if (z.kind !== "goo" && z.kind !== "bomb") continue;
        const rx = h.x - z.x;
        const rz = h.z - z.z;
        const d = len2(rx, rz);
        const closing = (rx * z.vx + rz * z.vz) / Math.max(1, d);
        if (d < 320 && closing > 120) {
          m.dodgeAt = m.t + skill.react;
          const side = rx * -z.vz + rz * z.vx > 0 ? 1 : -1;
          m.dodgeDir = dirIndex(-z.vz * side, z.vx * side);
          break;
        }
      }
    }
  }
  if (m.dodgeAt >= 0 && m.t >= m.dodgeAt) {
    m.dodgeAt = -1;
    m.dodgeLeft = 36;
  }
  let frame: InputFrame;
  if (m.dodgeLeft > 0) {
    m.dodgeLeft -= 1;
    frame = { dir: m.dodgeDir, mag: 3, web: false, shot: 0 };
  } else {
    if (m.t >= m.nextDecide) {
      m.nextDecide = m.t + skill.decide;
      let mag = 3;
      let dir = dirIndex(dx, dz);
      const docArms = skill.aware && v.kind === "doc-octochain" && !isVulnerable(v);
      if (docArms && hd < 400) dir = dirIndex(-dx, -dz);
      else if (skill.patient && !open && hd < 260) {
        // Guarding: circle at a distance instead of running into him.
        dir = dirIndex(-dz, dx);
        mag = 2;
      } else if (hd < skill.close) mag = 0;
      // Step round an armed bread trap in the way.
      if (skill.aware && mag > 0) {
        for (const z of s.hazards) {
          if (z.kind !== "trap" || z.state !== "armed") continue;
          const tx = z.x - h.x;
          const tz = z.z - h.z;
          if (len2(tx, tz) < 140 && tx * dx + tz * dz > 0) {
            dir = dirIndex(-tz, tx);
            break;
          }
        }
      }
      m.stickDir = mag ? dir : 0;
      m.stickMag = mag;
    }
    frame = { dir: m.stickDir, mag: m.stickMag, web: false, shot: 0 };
  }
  // The web button: pressed close in (a tap), on the patient ones only into an opening.
  if (m.webLeft > 0) {
    m.webLeft -= 1;
    frame.web = true;
  } else if (m.t >= m.webReady && dist < (skill.patient ? 210 : 260) && (!skill.patient || open)) {
    m.webLeft = 5;
    m.webReady = m.t + (skill.patient ? 14 : 24);
    frame.web = true;
  }
  frame.shot = shotFor(s, m, skill, dist);
  return frame;
}

function fightFrame(policy: FightPolicy, s: SimState, m: PlayerMem, events: SimEvent[]): InputFrame {
  if (policy === "bot") return botFrame(s, m.bot);
  if (policy === "idle" || !s.villain || s.mode !== "fight") return { dir: 0, mag: 0, web: false, shot: 0 };
  return playerFrame(policy, s, m, events);
}

/* ------------------------------------------------------------------ measuring */

export interface FightStats {
  villain: SimVillainId;
  level: number;
  boss: boolean;
  policy: FightPolicy;
  won: boolean;
  /** Seconds from the fight going live to the win or the knockout (or the time limit). */
  seconds: number;
  /** Health lost in the fight, and as a share of the health it started with. */
  damage: number;
  damageShare: number;
  hpStart: number;
  hits: number;
  /** Of those, strikes (v4's melee). */
  melee: number;
  clangs: number;
  hurts: number;
  /** Share of fight ticks the hero is off the ground; the villain's feet more than 40 above what's under them. */
  heroAir: number;
  villainAir: number;
  /** Ground-to-air takeoffs by the hero, and upward launches of the villain (an impulse of 250 u/s or more in a tick). */
  heroTakeoffs: number;
  villainLaunches: number;
  /** Standard deviation of vertical velocity, units a second. */
  heroVySd: number;
  villainVySd: number;
  /** p90 − p10 of the hero's and the villain's height, units. */
  heroYSpread: number;
  villainYSpread: number;
  /** Webs shot, and street touches (misses), in the fight. */
  webs: number;
  misses: number;
  /** Fight ticks. */
  ticks: number;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};

class FightProbe {
  ticks = 0;
  heroAir = 0;
  villainAir = 0;
  heroTakeoffs = 0;
  villainLaunches = 0;
  hvy = 0;
  hvy2 = 0;
  vvy = 0;
  vvy2 = 0;
  heroY: number[] = [];
  villainY: number[] = [];
  webs = 0;
  misses = 0;
  hits = 0;
  melee = 0;
  clangs = 0;
  hurts = 0;
  damage = 0;
  private prevGrounded = true;
  private prevVillainGrounded = true;
  private prevVvy = 0;
  private first = true;

  sample(s: SimState) {
    const h = s.hero;
    const v = s.villain!;
    this.ticks += 1;
    if (!h.grounded) this.heroAir += 1;
    if (!this.first && this.prevGrounded && !h.grounded) this.heroTakeoffs += 1;
    this.prevGrounded = h.grounded;
    this.hvy += h.vy;
    this.hvy2 += h.vy * h.vy;
    this.heroY.push(h.y);
    const real = v.kind === "sybil" ? (v.bodies.find((b) => b.real) ?? v) : v;
    const foot = real.y - v.radius;
    const ground = groundBelow(s.grid, real.x, real.z, real.y);
    const air = v.kind === "sandwich-man" ? !v.grounded : foot - ground > 40;
    if (air) this.villainAir += 1;
    if (!this.first) {
      if (v.kind === "sandwich-man" ? this.prevVillainGrounded && !v.grounded : real.vy - this.prevVvy > 250) this.villainLaunches += 1;
    }
    this.prevVillainGrounded = v.grounded;
    this.prevVvy = real.vy;
    this.vvy += real.vy;
    this.vvy2 += real.vy * real.vy;
    this.villainY.push(real.y);
    this.first = false;
  }

  events(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === "thwip") this.webs += 1;
      else if (e.type === "miss") this.misses += 1;
      else if (e.type === "villain-hit") {
        this.hits += 1;
        if ((e.by as string) === "strike") this.melee += 1;
      }
      else if (e.type === "clang") this.clangs += 1;
      else if (e.type === "hero-hurt") {
        this.hurts += 1;
        this.damage += e.damage;
      }
    }
  }

  stats(base: Pick<FightStats, "villain" | "level" | "boss" | "policy" | "won" | "seconds" | "hpStart">, missDamage: number): FightStats {
    const n = Math.max(1, this.ticks);
    const sd = (sum: number, sum2: number) => Math.sqrt(Math.max(0, sum2 / n - (sum / n) * (sum / n)));
    const damage = this.damage + missDamage;
    return {
      ...base,
      damage,
      damageShare: damage / Math.max(1, base.hpStart),
      hits: this.hits,
      melee: this.melee,
      clangs: this.clangs,
      hurts: this.hurts,
      heroAir: this.heroAir / n,
      villainAir: this.villainAir / n,
      heroTakeoffs: this.heroTakeoffs,
      villainLaunches: this.villainLaunches,
      heroVySd: sd(this.hvy, this.hvy2),
      villainVySd: sd(this.vvy, this.vvy2),
      heroYSpread: pct(this.heroY, 0.9) - pct(this.heroY, 0.1),
      villainYSpread: pct(this.villainY, 0.9) - pct(this.villainY, 0.1),
      webs: this.webs,
      misses: this.misses,
      ticks: this.ticks,
    };
  }
}

/** The most a fight may last before it counts as lost (the bot-nights test allows 150 s). */
export const FIGHT_LIMIT = 150;

/**
 * Play a run: the bot between stops, `policy` in fights. Returns every fight's stats. A fight
 * longer than FIGHT_LIMIT ends the run there (counted as lost). With `only`, `policy` plays (and
 * the stats count) only that villain's fights, the bot the rest; `once` stops after the first.
 */
export function playFights(run: Run, policy: FightPolicy, seed: number, onTick?: (s: SimState, events: SimEvent[]) => void, only?: VillainId, once = false): FightStats[] {
  const out: FightStats[] = [];
  const travel = newBotMemory();
  const m = newPlayerMem(seed ^ 0x9e3779b1);
  let probe: FightProbe | null = null;
  let liveAt = 0;
  let hpStart = 0;
  let missDamage = 0;
  let last: SimEvent[] = [];
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    if (needsErrand(run)) {
      chooseErrand(run, 0);
      continue;
    }
    const s = run.sim;
    const mine = !only || s.villain?.kind === only;
    const fighting = (s.mode === "fight" || s.mode === "intro") && mine;
    const frame = fighting ? fightFrame(policy, s, m, last) : botFrame(s, travel);
    const events = stepRun(run, frame);
    last = events;
    for (const e of events) {
      if (e.type === "fight-live" && mine) {
        probe = new FightProbe();
        liveAt = s.tick;
        hpStart = s.hp;
        missDamage = 0;
        m.bot = newBotMemory();
      }
    }
    if (probe && s.mode === "fight") {
      probe.sample(s);
      onTick?.(s, events);
    }
    if (probe) {
      probe.events(events);
      for (const e of events) if (e.type === "miss") missDamage += e.damage;
    }
    const v = s.villain;
    const end = events.find((e) => e.type === "fight-won" || e.type === "ko");
    const seconds = (s.tick - liveAt) / 60;
    if (probe && v && (end || seconds > FIGHT_LIMIT)) {
      out.push(probe.stats({ villain: v.kind, level: v.level, boss: v.boss, policy, won: end?.type === "fight-won", seconds, hpStart }, missDamage));
      probe = null;
      if (!end || once) break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ the scenarios */

/** A hero for night `night`: level, health and power mastery a player would have by then, and a loadout that fits. */
export function nightHero(night: number): Save {
  const loadout: PowerId[] =
    night <= 2 ? ["web-sling", "web-shield", "wall-crawl", "node-sense"] : night <= 6 ? ["web-sling", "web-bomb", "web-shield", "wall-crawl"] : ["web-sling", "web-bomb", "zk-cloak", "wall-crawl"];
  let s = heroSave(loadout, `Night ${night}`, night);
  const h = s.hero!;
  const level = 1 + Math.floor((night - 1) * 0.75);
  const mastery = Math.min(24, (night - 1) * 2);
  const powers = { ...h.powers };
  for (const id of loadout) powers[id] = { ...powers[id], mastery };
  s = { ...s, hero: { ...h, level, maxHp: 100 + 6 * (level - 1), powers } };
  return s;
}

/** A patrol for `save` with these stops, started from `seed` (trusted, as the beatable test does). */
export function patrolRun(save: Save, seed: number, stops: Stop[]): Run {
  const started = reduce(save, { type: "start-patrol", seed });
  const patrolled = { ...started, patrol: { ...started.patrol!, stops } };
  const run = startRun(patrolled, seed, { trustPatrol: true });
  if (run.error) throw new Error(run.error);
  return run;
}

/**
 * A night's stops at `night`'s level: a warm-up fight, two errands, the boss. `villain` is the
 * warm-up (boss false) or the boss (boss true); the other fight is someone else, as in a real
 * patrol (never two Docs: a night has one bridge).
 */
export function duelStops(villain: VillainId, night: number, boss = false): Stop[] {
  const level = 1 + Math.floor((night - 1) / 2);
  const other: VillainId = villain === "sybil" ? "gas-goblin" : "sybil";
  const fight = (v: VillainId, b: boolean): Stop => ({ kind: "fight", villain: v, district: VILLAINS[v].district, level, boss: b, quest: false });
  return [
    fight(boss ? other : villain, false),
    { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
    { kind: "errand", ally: "uncle-gen", errand: "the-speech", district: "queens-block" },
    fight(boss ? villain : other, true),
  ];
}

export const BALANCE_NIGHTS = [1, 5, 9];
/** The first nights a newcomer plays (villain levels 1–3). */
export const NEW_PLAYER_NIGHTS = [1, 3, 5];
export const BALANCE_SEEDS = [11, 23, 37, 41, 59, 67];

/** Every villain, at nights 1, 5 and 9, warm-up and boss, over the seeds, with one policy (the bot plays the other fight). */
export function balanceFights(policy: FightPolicy, nights = BALANCE_NIGHTS, seeds = BALANCE_SEEDS): FightStats[] {
  const out: FightStats[] = [];
  for (const villain of VILLAIN_IDS) {
    for (const night of nights) {
      for (const seed of seeds) {
        for (const boss of [false, true]) {
          const run = patrolRun(nightHero(night), seed * 7919 + night, duelStops(villain, night, boss));
          out.push(...playFights(run, policy, seed, undefined, villain, true));
        }
      }
    }
  }
  return out;
}

/** Real nights: the bot's own patrols (shuffled villains, warm-up then boss), nights 1–n. */
export function nightFights(policy: FightPolicy, nights = 12): FightStats[] {
  const out: FightStats[] = [];
  for (let night = 1; night <= nights; night++) {
    const seed = Math.imul(night, 0x9e3779b1) >>> 0;
    const run = startRun(nightHero(night), seed);
    if (run.error) throw new Error(run.error);
    out.push(...playFights(run, policy, seed));
  }
  return out;
}

/* ------------------------------------------------------------------ summaries */

export interface FightSummary {
  fights: number;
  winRate: number;
  medianSeconds: number;
  p90Seconds: number;
  meanDamage: number;
  meanDamageShare: number;
  heroAir: number;
  villainAir: number;
  heroTakeoffsPerMin: number;
  villainLaunchesPerMin: number;
  heroVySd: number;
  villainVySd: number;
  heroYSpread: number;
  villainYSpread: number;
  websPerMin: number;
  missesPerMin: number;
  hitsPerMin: number;
  /** Share of hits that were strikes. */
  meleeShare: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r0 = (v: number) => Math.round(v);

export function summarizeFights(fs: FightStats[]): FightSummary {
  const n = Math.max(1, fs.length);
  const ticks = Math.max(1, fs.reduce((a, f) => a + f.ticks, 0));
  const perMin = (k: keyof FightStats) => r2((fs.reduce((a, f) => a + (f[k] as number), 0) / ticks) * 3600);
  const weighted = (k: keyof FightStats) => fs.reduce((a, f) => a + (f[k] as number) * f.ticks, 0) / ticks;
  const secs = fs.map((f) => f.seconds);
  return {
    fights: fs.length,
    winRate: r2(fs.filter((f) => f.won).length / n),
    medianSeconds: r2(pct(secs, 0.5)),
    p90Seconds: r2(pct(secs, 0.9)),
    meanDamage: r2(fs.reduce((a, f) => a + f.damage, 0) / n),
    meanDamageShare: r2(fs.reduce((a, f) => a + f.damageShare, 0) / n),
    heroAir: r2(weighted("heroAir")),
    villainAir: r2(weighted("villainAir")),
    heroTakeoffsPerMin: perMin("heroTakeoffs"),
    villainLaunchesPerMin: perMin("villainLaunches"),
    heroVySd: r0(weighted("heroVySd")),
    villainVySd: r0(weighted("villainVySd")),
    heroYSpread: r0(weighted("heroYSpread")),
    villainYSpread: r0(weighted("villainYSpread")),
    websPerMin: perMin("webs"),
    missesPerMin: perMin("misses"),
    hitsPerMin: perMin("hits"),
    meleeShare: r2(fs.reduce((a, f) => a + f.melee, 0) / Math.max(1, fs.reduce((a, f) => a + f.hits, 0))),
  };
}

/** A fixed-width table of summaries, one row each. */
export function table(rows: [string, FightSummary][]): string {
  const cols: [keyof FightSummary, string][] = [
    ["fights", "n"],
    ["winRate", "win"],
    ["medianSeconds", "med s"],
    ["p90Seconds", "p90 s"],
    ["meanDamage", "dmg"],
    ["meanDamageShare", "dmg%"],
    ["heroAir", "hero air"],
    ["villainAir", "vil air"],
    ["heroTakeoffsPerMin", "hero hop/m"],
    ["villainLaunchesPerMin", "vil hop/m"],
    ["heroVySd", "hero vy sd"],
    ["villainVySd", "vil vy sd"],
    ["heroYSpread", "hero y p10-90"],
    ["villainYSpread", "vil y p10-90"],
    ["websPerMin", "webs/m"],
    ["missesPerMin", "street/m"],
    ["hitsPerMin", "hits/m"],
    ["meleeShare", "melee"],
  ];
  const w = Math.max(...rows.map(([k]) => k.length), 8);
  const head = ["".padEnd(w), ...cols.map(([, l]) => l.padStart(Math.max(6, l.length)))].join(" ");
  const lines = rows.map(([k, s]) => [k.padEnd(w), ...cols.map(([c, l]) => String(s[c]).padStart(Math.max(6, l.length)))].join(" "));
  return [head, ...lines].join("\n");
}

/** Group fights by a key and summarise each group, in key order. */
export function byKey(fs: FightStats[], key: (f: FightStats) => string): [string, FightSummary][] {
  const groups = new Map<string, FightStats[]>();
  for (const f of fs) {
    const k = key(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return [...groups.entries()].map(([k, g]) => [k, summarizeFights(g)]);
}

/* ------------------------------------------------------------------ tracks for the camera */

/** One fight's motion, tick by tick, for the camera report in apps/wgp (it rebuilds the city from seed and stops). */
export interface FightTrack {
  villain: SimVillainId;
  policy: FightPolicy;
  seed: number;
  stops: Stop[];
  zone: number;
  /** Per tick: hero x y z vx vy vz, then the rival's (Sybil's real body) x y z vx vy vz. */
  frames: number[][];
}

/** Record the fights of real nights 1–n with a policy. */
export function fightTracks(policy: FightPolicy, nights = 6): FightTrack[] {
  const out: FightTrack[] = [];
  for (let night = 1; night <= nights; night++) {
    const seed = Math.imul(night, 0x9e3779b1) >>> 0;
    const run = startRun(nightHero(night), seed);
    if (run.error) throw new Error(run.error);
    let track: FightTrack | null = null;
    playFights(run, policy, seed, (s) => {
      const v = s.villain!;
      if (!track || track.zone !== s.index) {
        track = { villain: v.kind, policy, seed: s.config.seed, stops: s.config.stops, zone: s.index, frames: [] };
        out.push(track);
      }
      const h = s.hero;
      const r = v.kind === "sybil" ? (v.bodies.find((b) => b.real) ?? v) : v;
      const q = (n: number) => Math.round(n * 10) / 10;
      track.frames.push([h.x, h.y, h.z, h.vx, h.vy, h.vz, r.x, r.y, r.z, r.vx, r.vy, r.vz].map(q));
    });
  }
  return out;
}

/** Everything the report prints. */
export function fightReport(): string {
  const parts: string[] = [];
  const nights = nightFights("bot", 12);
  parts.push("REAL NIGHTS 1-12, the bot (warm-up and boss fights)", table([["all", summarizeFights(nights)], ...byKey(nights, (f) => f.villain)]));
  const all: FightStats[] = [];
  for (const policy of FIGHT_POLICIES) {
    const fs = balanceFights(policy);
    all.push(...fs);
    parts.push(`\nBALANCE, ${policy}: every villain at nights 1, 5, 9 (warm-up + boss), ${BALANCE_SEEDS.length} seeds`, table([["all", summarizeFights(fs)], ...byKey(fs, (f) => `${f.villain}${f.boss ? " boss" : ""}`)]));
  }
  parts.push("\nBALANCE by villain x player", table(byKey(all, (f) => `${f.villain} ${f.policy}`)));
  parts.push("\nBALANCE by night x player", table(byKey(all, (f) => `L${f.level} ${f.policy}`)));
  // First-timers: nights 1, 3 and 5, warm-up and boss apart, for the players who don't dodge yet and those who do.
  for (const policy of ["simple", "average"] as FightPolicy[]) {
    const early = balanceFights(policy, NEW_PLAYER_NIGHTS);
    parts.push(`\nNEW PLAYERS, ${policy}: nights ${NEW_PLAYER_NIGHTS.join(", ")}`, table([["all", summarizeFights(early)], ...byKey(early, (f) => `${f.villain}${f.boss ? " boss" : ""}`)]));
  }
  return parts.join("\n");
}
