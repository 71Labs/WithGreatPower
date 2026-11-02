/**
 * Drives the swing sim with a scripted bot through full 4-stop nights, through the real
 * reducer, and asserts: no NaN, every encounter completable, sensible durations, resume
 * after a reload, a knockout path, and determinism.
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.json scripts/sim-check.ts
 */
import { ERRANDS, VILLAINS } from "@wgp/game-core/data";
import { newSave, reduce } from "@wgp/game-core/engine";
import type { PowerId, Save, Stop, VillainId } from "@wgp/game-core/types";
import { actionFor, sessionStart } from "../src/sim/bridge";
import { botInput, createSim, debugSetHp, DT, newBotMemory, resolveErrand, stepSim, type SimState } from "../src/sim/core";

let failures = 0;
function check(ok: boolean, msg: string) {
  if (!ok) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function finite(s: SimState): boolean {
  const h = s.hero;
  const nums = [h.x, h.y, h.vx, h.vy, h.angle, s.hp, s.fluid];
  if (s.villain) nums.push(s.villain.x, s.villain.y, s.villain.vx, s.villain.vy);
  for (const z of s.hazards) nums.push(z.x, z.y);
  for (const b of s.villain?.bodies ?? []) nums.push(b.x, b.y);
  for (const a of s.villain?.arms ?? []) nums.push(a.angle, a.len);
  return nums.every(Number.isFinite);
}

interface RunOptions {
  /** Rebuild the sim from the save (as a reload would) when arriving at this stop. */
  reloadAt?: number;
  /** Drop the hero to this health when a fight goes live (the knockout path). */
  koAtFight?: number;
  maxSeconds?: number;
  label: string;
}

interface RunReport {
  save: Save;
  seconds: number;
  segments: number[];
  fights: { villain: VillainId; seconds: number; won: boolean; hits: number }[];
  perfect: number;
  good: number;
  miss: number;
  ticks: number;
}

function send(save: Save, action: ReturnType<typeof actionFor> & object, label: string): Save {
  const next = reduce(save, action);
  check(next !== save, `${label}: the engine refused ${action.type} (phase ${save.patrol?.phase}, index ${save.patrol?.index})`);
  return next;
}

function runNight(input: Save, opts: RunOptions): RunReport {
  let save = reduce(input, { type: "start-patrol" });
  const report: RunReport = { save, seconds: 0, segments: [], fights: [], perfect: 0, good: 0, miss: 0, ticks: 0 };
  const maxTicks = (opts.maxSeconds ?? 900) / DT;
  let segmentStart = 0;
  let fightStart = 0;
  let over = false;

  const boot = (): SimState | null => {
    for (let guard = 0; guard < 3; guard++) {
      const start = sessionStart(save);
      if (start.kind === "leave") save = send(save, { type: "leave-stop" }, opts.label);
      else if (start.kind === "play") return createSim(start.config);
      else return null;
    }
    return null;
  };

  let sim = boot();
  let mem = newBotMemory();
  let ticks = 0;
  let reloaded = false;
  while (sim && !over && ticks < maxTicks) {
    const input = botInput(sim, mem, DT);
    stepSim(sim, input);
    ticks += 1;
    if (!finite(sim)) {
      check(false, `${opts.label}: NaN at tick ${ticks} (mode ${sim.mode})`);
      break;
    }
    const events = sim.events.splice(0);
    for (const ev of events) {
      if (ev.type === "release") {
        if (ev.grade === "perfect") report.perfect += 1;
        if (ev.grade === "good") report.good += 1;
      }
      if (ev.type === "miss") report.miss += 1;
      if (ev.type === "arrive") {
        report.segments.push((ticks - segmentStart) * DT);
      }
      if (ev.type === "fight-live") {
        fightStart = ticks;
        if (opts.koAtFight !== undefined) debugSetHp(sim, opts.koAtFight);
      }
      if (ev.type === "fight-won" || ev.type === "ko") {
        report.fights.push({ villain: ev.villain, seconds: (ticks - fightStart) * DT, won: ev.type === "fight-won", hits: sim.villain?.hitsMax ?? 0 });
      }
      if (ev.type === "stop-done") segmentStart = ticks;
      const action = actionFor(ev);
      if (action) save = send(save, action, opts.label);
      if (ev.type === "errand") {
        const stop = save.patrol!.stops[save.patrol!.index] as Extract<Stop, { kind: "errand" }>;
        const errand = ERRANDS.find((e) => e.id === stop.errand)!;
        save = send(save, { type: "errand", choice: errand.choices[0].id }, opts.label);
        save = send(save, { type: "leave-stop" }, opts.label);
        resolveErrand(sim, { hp: save.patrol!.hp, fluid: save.patrol!.fluid });
        segmentStart = ticks;
      }
      if (ev.type === "night-over") over = true;
      // A reload right after arriving: rebuild everything from the save.
      if (ev.type === "arrive" && opts.reloadAt === ev.index && !reloaded) {
        reloaded = true;
        sim.events.length = 0;
        const fresh = boot();
        check(!!fresh && fresh.index === ev.index && (fresh.mode === "intro" || fresh.mode === "errand"), `${opts.label}: resume at stop ${ev.index} lands in the zone`);
        if (fresh) {
          // Resuming an errand re-emits it; let the loop above handle it next step.
          sim = fresh;
          mem = newBotMemory();
        }
        break;
      }
    }
  }
  check(over, `${opts.label}: the night ended (mode ${sim?.mode}, after ${(ticks * DT).toFixed(0)} s)`);
  check(save.patrol?.phase === "summary", `${opts.label}: patrol reached the summary (phase ${save.patrol?.phase})`);
  report.seconds = ticks * DT;
  report.ticks = ticks;
  report.save = save;
  return report;
}

function hero(loadout: PowerId[], name = "Check Hero"): Save {
  const all: PowerId[] = ["web-sling", "web-shield", "node-sense", "wall-crawl", "yank", "finality"];
  const starters = [...new Set([...loadout.filter((p) => all.includes(p)), ...all])].slice(0, 3);
  let s = reduce(newSave(), { type: "create-hero", name, suit: "classic", powers: starters });
  // Grant any non-starter powers directly, as level-ups would.
  const h = s.hero!;
  const powers = { ...h.powers };
  for (const p of loadout) powers[p] = powers[p] ?? { mastery: 0 };
  s = { ...s, hero: { ...h, powers, loadout: loadout.slice(0, 4) } };
  return s;
}

function withStops(save: Save, stops: Stop[]): Save {
  const started = reduce(save, { type: "start-patrol" });
  return { ...started, patrol: { ...started.patrol!, stops } };
}

function summarize(r: RunReport, label: string) {
  const fights = r.fights.map((f) => `${VILLAINS[f.villain].name} ${f.won ? "won" : "KO"} ${f.seconds.toFixed(1)}s/${f.hits}h`).join(", ");
  const results = r.save.patrol!.results.map((x) => `${x.kind === "fight" ? x.outcome : "errand"}`).join(" ");
  console.log(
    `${label.padEnd(28)} ${r.seconds.toFixed(1).padStart(6)}s  segments ${r.segments.map((s) => s.toFixed(1)).join("/")}  swings P${r.perfect} G${r.good} M${r.miss}  [${results}]  ${fights}`,
  );
}

const STANDARD: PowerId[] = ["web-sling", "web-shield", "wall-crawl", "node-sense"];
const HEAVY: PowerId[] = ["web-sling", "web-bomb", "validator-slam", "front-run"];
const SLAMMER: PowerId[] = ["web-shield", "node-sense", "wall-crawl", "yank"];

console.log("Full nights through the engine:");
const runs: RunReport[] = [];
for (let night = 1; night <= 6; night++) {
  let s = hero(night % 2 ? STANDARD : HEAVY, `Bot ${night}`);
  s = { ...s, night };
  const r = runNight(s, { label: `night ${night}` });
  runs.push(r);
  summarize(r, `night ${night} (${night % 2 ? "standard" : "heavy"})`);
  check(r.fights.every((f) => f.won), `night ${night}: every fight won`);
  check(r.seconds > 30 && r.seconds < 480, `night ${night}: duration ${r.seconds.toFixed(0)} s is sensible`);
  check(r.segments.every((x) => x < 60), `night ${night}: every swing segment under a minute`);
  const finished = reduce(r.save, { type: "finish-patrol" });
  check(finished.nightDone && finished.editions.length === 1, `night ${night}: finish-patrol banks the night`);
}

console.log("\nEvery villain, as a level 5 boss:");
const villains = Object.keys(VILLAINS) as VillainId[];
for (const v of villains) {
  for (const loadout of [STANDARD, HEAVY, SLAMMER]) {
    const base = hero(loadout, `Boss ${v}`);
    const stops: Stop[] = [
      { kind: "fight", villain: v, district: VILLAINS[v].district, level: 1, boss: false, quest: false },
      { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
      { kind: "errand", ally: "gwei", errand: "team-up", district: "validator-heights" },
      { kind: "fight", villain: v, district: VILLAINS[v].district, level: 5, boss: true, quest: true },
    ];
    const s = withStops(base, stops);
    const label = `${v} ${loadout === STANDARD ? "standard" : loadout === HEAVY ? "heavy" : "slam-only"}`;
    const r = runNight(s, { label, maxSeconds: 900 });
    summarize(r, label);
    check(r.fights.length === 2 && r.fights.every((f) => f.won), `${label}: both fights won`);
    // With no attack power at all you can only slam, and the bot is a clumsy slammer.
    const limit = loadout === SLAMMER ? 240 : 150;
    check(r.fights.every((f) => f.seconds < limit), `${label}: fights finish in under ${limit} s`);
  }
}

console.log("\nResume after a reload, at each stop:");
for (let at = 0; at < 4; at++) {
  const s = { ...hero(STANDARD, "Reload Hero"), night: 3 };
  const r = runNight(s, { label: `reload at ${at}`, reloadAt: at });
  summarize(r, `reload at stop ${at}`);
  check(r.save.patrol!.results.length === 4, `reload at ${at}: all four stops recorded`);
}

console.log("\nKnockout path:");
{
  const s = { ...hero(STANDARD, "Glass Jaw"), night: 2 };
  const r = runNight(s, { label: "knockout", koAtFight: 0 });
  summarize(r, "knockout");
  check(r.fights.length === 1 && !r.fights[0].won, "knockout: the first fight is lost");
  check(!!r.save.patrol?.knockedOut, "knockout: the engine records the knockout");
  const done = reduce(r.save, { type: "finish-patrol" });
  check(done.stats.knockouts === 1, "knockout: finish-patrol counts it");
}

console.log("\nDeterminism:");
{
  const a = runNight({ ...hero(STANDARD, "Twin"), night: 4 }, { label: "twin a" });
  const b = runNight({ ...hero(STANDARD, "Twin"), night: 4 }, { label: "twin b" });
  check(a.ticks === b.ticks && a.perfect === b.perfect && JSON.stringify(a.save.patrol) === JSON.stringify(b.save.patrol), "same seed, same night");
  console.log(`  twin runs: ${a.ticks} and ${b.ticks} ticks`);
}

const avg = runs.reduce((n, r) => n + r.seconds, 0) / runs.length;
console.log(`\nAverage night: ${avg.toFixed(0)} s`);
if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll sim checks passed.");
