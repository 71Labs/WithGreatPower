/**
 * Case File 001, "Missing: Mary Jpeg": the chapter's city and clues, the Right-Clicker's moves,
 * the rescue, determinism and verification, the render contract (v1.5) and the save's case
 * record, plus the balance gates on chapter-metrics.ts (CHAPTER_REPORT=1 prints them all).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { hashState } from "../src/hash";
import { decodeInputLog, encodeInputLog } from "../src/input/log";
import { chapterCleared, replayRun, runLog, startChapterRun, startRun, stepRun, type Run } from "../src/replay";
import { applyCaseClear, CASE_XP, caseRecord, CHAPTER_ID, CHAPTER_RULESET, CHAPTERS } from "../src/rules/chapters";
import { RULESET_VERSION } from "../src/score";
import {
  CHAPTER_DECK_HALF,
  CHAPTER_HITS,
  chapterLogRuleset,
  FREED_SECONDS,
  RESTORE_TICKS,
} from "../src/sim3d/chapter";
import { HERO_RADIUS } from "../src/sim3d/constants";
import type { InputFrame, RenderFrame3D } from "../src/sim3d/contract";
import { dirIndex, len2 } from "../src/sim3d/dmath";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { fillRenderFrame, newRenderFrame } from "../src/sim3d/render";
import { DRAG_PULL, SAVED_FREEZE } from "../src/sim3d/right-clicker";
import { IDLE_FRAME } from "../src/sim3d/sim";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { chapterHero, chapterRuns, summarizeChapter } from "./chapter-metrics";
import { heroSave, playBot, STANDARD } from "./helpers";

const SEED = 0xca5e01;
const hero = () => heroSave(STANDARD, "Case Tester", 3);

/** Play the bot until `until` holds (or the night ends). Returns every event on the way. */
function botUntil(run: Run, until: (s: SimState) => boolean, max = 54_000): SimEvent[] {
  const mem = newBotMemory();
  const all: SimEvent[] = [];
  while (!run.over && !run.error && run.sim.tick < max && !until(run.sim)) all.push(...stepRun(run, botFrame(run.sim, mem)));
  return all;
}

const playChapterBot = (seed = SEED) => {
  const run = startChapterRun(hero(), seed, CHAPTER_ID);
  const events = botUntil(run, () => false);
  return { run, events };
};

/** The standoff, live: the bot investigates and walks onto the deck. */
function standoff(seed = SEED): Run {
  const run = startChapterRun(hero(), seed, CHAPTER_ID);
  botUntil(run, (s) => s.mode === "fight");
  expect(run.sim.mode).toBe("fight");
  expect(run.sim.chapter!.phase).toBe("standoff");
  return run;
}

/** Stand the hero on the deck at (x, z), still. */
function placeHero(s: SimState, x: number, z: number) {
  const h = s.hero;
  const st = s.city.zones[0].stage!;
  h.x = x;
  h.z = z;
  h.y = st.y + HERO_RADIUS;
  h.vx = 0;
  h.vy = 0;
  h.vz = 0;
  h.grounded = true;
  h.rope = null;
  h.invuln = 0;
  h.strike = -1;
  h.zip = -1;
  h.strikeCd = 0;
  h.zipCd = 0;
  h.hurtT = 0;
  h.heldT = 0;
  h.landT = 0;
  if (s.chapter) {
    s.chapter.savedT = 0;
    s.chapter.dragT = 0;
  }
}

const step = (run: Run, frame: InputFrame, n = 1) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...stepRun(run, frame));
  return out;
};

describe("Case File 001: the night", () => {
  it("keeps the patrol's ruleset and pins its own", () => {
    expect(RULESET_VERSION).toBe(4);
    expect(CHAPTER_ID).toBe("case-001");
    expect(CHAPTER_RULESET).toBe("c001-1");
    expect(chapterLogRuleset("case-001")).toBe(0x0c001104);
    expect(CHAPTERS["case-001"].clues.map((c) => c.id)).toEqual(["tabs", "cursor", "pixels"]);
  });

  it("builds the bridge city with a wide deck, three clues on reachable roofs and Mary on the deck", () => {
    let boards = 0;
    for (let k = 0; k < 40; k++) {
      const seed = Math.imul(k + 1, 0x2545f491) >>> 0;
      const run = startChapterRun(hero(), seed, CHAPTER_ID);
      expect(run.error).toBeNull();
      const s = run.sim;
      const c = s.chapter!;
      const z = s.city.zones[0];
      expect(s.city.zones).toHaveLength(1);
      expect(z.villain).toBe("right-clicker");
      const br = s.city.bridge!;
      expect(br.axis === "x" ? br.deck.z1 - br.deck.z0 : br.deck.x1 - br.deck.x0).toBe(CHAPTER_DECK_HALF * 2);
      const st = z.stage!;
      expect(c.captive.x).toBeGreaterThan(st.x0);
      expect(c.captive.x).toBeLessThan(st.x1);
      expect(c.captive.z).toBeGreaterThan(st.z0);
      expect(c.captive.z).toBeLessThan(st.z1);
      expect(c.captive.y).toBe(st.y);
      expect(c.clues.map((q) => q.id)).toEqual(["tabs", "cursor", "pixels"]);
      for (const q of c.clues) {
        // On a roof: some building's top tier (or main roof) holds it, at its height.
        const roof = s.city.buildings.find((b) => {
          const r = b.top ?? b;
          return q.x >= r.x0 && q.x <= r.x1 && q.z >= r.z0 && q.z <= r.z1 && (b.top ? b.top.h : b.h) === q.y;
        });
        expect(roof, `seed ${seed}: ${q.id} on a roof`).toBeTruthy();
        expect(q.y).toBeGreaterThanOrEqual(170);
        expect(q.y).toBeLessThanOrEqual(480);
      }
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(len2(c.clues[i].x - c.clues[j].x, c.clues[i].z - c.clues[j].z)).toBeGreaterThan(300);
      const pixels = c.clues[2];
      expect(len2(pixels.x - z.center.x, pixels.z - z.center.z)).toBeLessThan(1600);
      const cursor = c.clues[1];
      if (s.city.props.some((p) => p.kind === "billboard" && p.at.x === cursor.x && p.at.z === cursor.z)) boards += 1;
      // The same seed, the same night.
      expect(hashState(startChapterRun(hero(), seed, CHAPTER_ID).sim)).toBe(hashState(s));
    }
    expect(boards).toBeGreaterThan(30);
  });

  it("is cleared by the bot: clues in any order, then the standoff, the rescue and the case closed", () => {
    const { run, events } = playChapterBot();
    expect(run.error).toBeNull();
    expect(run.over).toBe(true);
    expect(chapterCleared(run)).toBe(true);
    const types = events.map((e) => e.type);
    const clues = events.filter((e): e is Extract<SimEvent, { type: "clue-found" }> => e.type === "clue-found");
    expect(new Set(clues.map((e) => e.id)).size).toBe(3);
    expect(clues.map((e) => e.found)).toEqual([1, 2, 3]);
    // The bridge only opens after the third clue.
    expect(types.indexOf("encounter")).toBeGreaterThan(types.lastIndexOf("clue-found"));
    expect(events.find((e) => e.type === "encounter")).toMatchObject({ villain: "right-clicker" });
    const won = types.indexOf("fight-won");
    expect(won).toBeGreaterThan(types.indexOf("fight-live"));
    const spawns = events.filter((e) => e.type === "copy-spawn");
    // Two copies interrupt the rescue (after the win).
    expect(events.slice(won).filter((e) => e.type === "copy-spawn")).toHaveLength(2);
    expect(new Set(spawns.map((e) => (e as { id: number }).id)).size).toBe(spawns.length);
    const restores = events.filter((e): e is Extract<SimEvent, { type: "captive-restore" }> => e.type === "captive-restore").map((e) => e.p);
    expect(restores.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < restores.length; i++) expect(restores[i]).toBeGreaterThan(restores[i - 1]);
    expect(restores[restores.length - 1]).toBe(1);
    const freed = types.indexOf("captive-freed");
    const closed = events.findIndex((e) => e.type === "case-closed");
    expect(freed).toBeGreaterThan(won);
    expect(closed).toBeGreaterThan(freed);
    expect(events.filter((e) => e.type === "case-closed")).toEqual([{ type: "case-closed", id: "case-001", ticks: run.sim.tick }]);
    expect(events[events.length - 1]).toEqual({ type: "night-over", reason: "route" });
    expect(types).not.toContain("stop-done");
    // The patrol's engine never saw it.
    expect(run.save).toBe(run.start);
    expect(run.save.patrol).toBeNull();
  });

  it("SCREENSHOT: in the cone at the flash, SAVED (frozen, hurt, combo broken); out of it, nothing", () => {
    const run = standoff();
    const s = run.sim;
    const v = s.villain!;
    const c = s.chapter!;
    const st = s.city.zones[0].stage!;
    const a = s.city.bridge!.axis === "z" ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const mid = { x: (st.x0 + st.x1) / 2, z: (st.z0 + st.z1) / 2 };
    v.x = mid.x - a.x * 200;
    v.z = mid.z - a.z * 200;
    placeHero(s, mid.x + a.x * 150, mid.z + a.z * 150);
    s.combo = 5;
    s.comboT = 300;
    v.phase = "aim";
    v.phaseT = 0.2;
    c.aimX = a.x;
    c.aimZ = a.z;
    const hp = s.hp;
    const flash = step(run, IDLE_FRAME, 14);
    const shot = flash.find((e) => e.type === "screenshot");
    expect(shot).toMatchObject({ type: "screenshot", hit: true });
    expect(s.hp).toBeLessThan(hp);
    expect(s.combo).toBe(0);
    expect(c.savedT).toBeGreaterThan(SAVED_FREEZE - 0.25);
    // Frozen: pushing the stick goes nowhere until the freeze is over.
    const x0 = s.hero.x;
    const z0 = s.hero.z;
    const push: InputFrame = { dir: dirIndex(-a.z, a.x), mag: 3, web: false, shot: 0 };
    step(run, push, 40);
    expect(len2(s.hero.x - x0, s.hero.z - z0)).toBeLessThan(3);
    step(run, push, 40);
    expect(len2(s.hero.x - x0, s.hero.z - z0)).toBeGreaterThan(40);

    // Sidestepped out of the cone: the flash misses.
    const run2 = standoff();
    const s2 = run2.sim;
    const v2 = s2.villain!;
    v2.x = mid.x - a.x * 200;
    v2.z = mid.z - a.z * 200;
    placeHero(s2, mid.x + a.x * 150 - a.z * 200, mid.z + a.z * 150 + a.x * 200);
    v2.phase = "aim";
    v2.phaseT = 0.2;
    s2.chapter!.aimX = a.x;
    s2.chapter!.aimZ = a.z;
    const hp2 = s2.hp;
    const miss = step(run2, IDLE_FRAME, 14);
    expect(miss.find((e) => e.type === "screenshot")).toMatchObject({ hit: false });
    expect(s2.hp).toBe(hp2);
    expect(s2.chapter!.savedT).toBe(0);
    // Reloading after the flash: open (a blow gets through his guard).
    expect(["flash", "recover"]).toContain(v2.phase);
  });

  it("DRAG pulls the hero about 200 toward him; a blow during the wind-up breaks it", () => {
    const run = standoff();
    const s = run.sim;
    const v = s.villain!;
    const st = s.city.zones[0].stage!;
    const a = s.city.bridge!.axis === "z" ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const mid = { x: (st.x0 + st.x1) / 2, z: (st.z0 + st.z1) / 2 };
    v.x = mid.x - a.x * 250;
    v.z = mid.z - a.z * 250;
    v.invuln = 99;
    placeHero(s, mid.x + a.x * 250, mid.z + a.z * 250);
    v.phase = "drag";
    v.phaseT = 0.05;
    v.dashHit = false;
    const d0 = len2(s.hero.x - v.x, s.hero.z - v.z);
    const events = step(run, IDLE_FRAME, 40);
    expect(events.some((e) => e.type === "drag")).toBe(true);
    const pulled = d0 - len2(s.hero.x - v.x, s.hero.z - v.z);
    expect(pulled).toBeGreaterThan(DRAG_PULL - 50);
    expect(pulled).toBeLessThan(DRAG_PULL + 50);

    const run2 = standoff();
    const s2 = run2.sim;
    const v2 = s2.villain!;
    v2.x = mid.x - a.x * 150;
    v2.z = mid.z - a.z * 150;
    v2.invuln = 99;
    placeHero(s2, mid.x + a.x * 250, mid.z + a.z * 250);
    v2.phase = "drag";
    v2.phaseT = 0.6;
    v2.dashHit = false;
    // A press: a zip at him, into a blow (it clangs on his guard, but it breaks the lasso).
    step(run2, { dir: 0, mag: 0, web: true, shot: 0 }, 2);
    const after = step(run2, IDLE_FRAME, 10);
    expect(after.some((e) => e.type === "drag")).toBe(false);
    expect(v2.phase).toBe("stagger");
  });

  it("CTRL+C: two paper copies stand in the way, and each takes one blow without it reaching him", () => {
    const run = standoff();
    const s = run.sim;
    const v = s.villain!;
    const st = s.city.zones[0].stage!;
    const a = s.city.bridge!.axis === "z" ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const mid = { x: (st.x0 + st.x1) / 2, z: (st.z0 + st.z1) / 2 };
    v.x = mid.x - a.x * 200;
    v.z = mid.z - a.z * 200;
    v.invuln = 0;
    placeHero(s, mid.x + a.x * 160, mid.z + a.z * 160);
    v.phase = "copy";
    v.phaseT = 0.01;
    s.slowmo = 0;
    const spawned = step(run, IDLE_FRAME, 2).filter((e) => e.type === "copy-spawn");
    expect(spawned).toHaveLength(2);
    expect(v.bodies.filter((b) => b.alive)).toHaveLength(2);
    // Between him and you.
    for (const b of v.bodies) {
      const along = (b.x - v.x) * a.x + (b.z - v.z) * a.z;
      expect(along).toBeGreaterThan(0);
      expect(along).toBeLessThan(360);
    }
    const hits = v.hits;
    const events: SimEvent[] = [];
    for (let i = 0; i < 120 && v.bodies.some((b) => b.alive); i++) {
      events.push(...step(run, { dir: 0, mag: 0, web: i % 8 < 2, shot: 0 }));
      if (events.some((e) => e.type === "copy-pop")) break;
    }
    const pop = events.findIndex((e) => e.type === "copy-pop");
    expect(pop).toBeGreaterThanOrEqual(0);
    expect(events.slice(0, pop + 1).some((e) => e.type === "villain-hit")).toBe(false);
    expect(v.hits).toBe(hits);
  });

  it("the rescue: holding the web beside Mary restores her in 3 s, paused while hurt; then the case closes", () => {
    const run = startChapterRun(hero(), SEED, CHAPTER_ID);
    botUntil(run, (s) => s.chapter!.phase === "rescue");
    const s = run.sim;
    const c = s.chapter!;
    expect(s.mode).toBe("fight");
    expect(s.villain!.hits).toBe(0);
    // Keep the copies out of it.
    for (const b of s.villain!.bodies) b.alive = false;
    c.rescueCopies = 2;
    placeHero(s, c.captive.x + 60, c.captive.z);
    const hold: InputFrame = { dir: 0, mag: 0, web: true, shot: 0 };
    step(run, hold, 60);
    expect(c.captive.restore).toBe(60);
    // Jumping and swinging don't happen beside her: the web restores.
    expect(s.hero.grounded).toBe(true);
    s.hero.hurtT = 0.3;
    step(run, hold, 10);
    expect(c.captive.restore).toBe(60);
    const rest = step(run, hold, 320);
    expect(c.captive.restore).toBe(RESTORE_TICKS);
    expect(c.captive.freed).toBe(true);
    expect(rest.some((e) => e.type === "captive-freed")).toBe(true);
    expect(run.over).toBe(true);
    const freedAt = rest.findIndex((e) => e.type === "captive-freed");
    expect(rest.slice(freedAt).some((e) => e.type === "case-closed")).toBe(true);
    expect(chapterCleared(run)).toBe(true);
    expect(FREED_SECONDS).toBeGreaterThan(1);
  });

  it("a knockout ends it uncleared, and replays", () => {
    const run = standoff(0xbad5);
    while (!run.over && run.sim.tick < 54_000) stepRun(run, IDLE_FRAME);
    expect(run.over).toBe(true);
    expect(chapterCleared(run)).toBe(false);
    const res = replayRun({ save: run.start, seed: 0xbad5, log: runLog(run) }, { chapter: CHAPTER_ID });
    expect(res.ok, res.reason).toBe(true);
    expect(res.stats.cleared).toBe(0);
    expect(res.stats.knockedOut).toBe(1);
  });
});

describe("Case File 001: determinism and verification", () => {
  it("the same log gives the same hash and checkpoints, twice and after other runs", () => {
    const { run } = playChapterBot();
    const log = runLog(run);
    expect(decodeInputLog(log).ruleset).toBe(chapterLogRuleset(CHAPTER_ID));
    const a = replayRun({ save: hero(), seed: SEED, log }, { chapter: CHAPTER_ID });
    playBot(heroSave(STANDARD, "Someone Else", 5), 4242);
    playChapterBot(SEED + 1);
    const b = replayRun({ save: hero(), seed: SEED, log }, { chapter: CHAPTER_ID });
    expect(a.ok, a.reason).toBe(true);
    expect(b).toEqual(a);
    expect(a.hash).toBe(hashState(run.sim));
    expect(a.ticks).toBe(run.sim.tick);
    expect(a.stats.cleared).toBe(1);
    expect(a.score).toBe(0);
    expect(a.checkpoints).toHaveLength(5);
  });

  it("two bots on the same seed play the same chapter, frame for frame; another seed is another city", () => {
    const one = playChapterBot().run;
    const two = playChapterBot().run;
    expect(two.codes).toEqual(one.codes);
    expect(hashState(two.sim)).toBe(hashState(one.sim));
    const other = startChapterRun(hero(), SEED + 1, CHAPTER_ID).sim;
    expect(other.chapter!.clues.map((c) => [c.x, c.z])).not.toEqual(startChapterRun(hero(), SEED, CHAPTER_ID).sim.chapter!.clues.map((c) => [c.x, c.z]));
  });

  it("refuses a chapter log as a patrol night and a patrol log as a chapter, tampering, and short logs", () => {
    const { run } = playChapterBot();
    const log = runLog(run);
    const asNight = replayRun({ save: hero(), seed: SEED, log });
    expect(asNight.ok).toBe(false);
    expect(asNight.reason).toMatch(/ruleset/);
    const night = playBot(hero(), SEED).run;
    const asCase = replayRun({ save: hero(), seed: SEED, log: runLog(night) }, { chapter: CHAPTER_ID });
    expect(asCase.ok).toBe(false);
    expect(asCase.reason).toMatch(/ruleset 4 is not chapter case-001/);
    // A patrol log relabelled with the chapter's ruleset still doesn't fit the chapter's night.
    const relabelled = encodeInputLog({ ...decodeInputLog(runLog(night)), ruleset: chapterLogRuleset(CHAPTER_ID) });
    const forged = replayRun({ save: hero(), seed: SEED, log: relabelled }, { chapter: CHAPTER_ID });
    expect(forged.ok && forged.stats.cleared === 1 && forged.hash === hashState(run.sim)).toBe(false);
    const decoded = decodeInputLog(log);
    const short = replayRun({ save: hero(), seed: SEED, log: encodeInputLog({ ...decoded, frames: decoded.frames.slice(0, 600) }) }, { chapter: CHAPTER_ID });
    expect(short.reason).toMatch(/didn't finish/);
    const other = replayRun({ save: hero(), seed: SEED + 7, log }, { chapter: CHAPTER_ID });
    expect(other.ok && other.hash === hashState(run.sim)).toBe(false);
    for (let i = 300; i < 320; i++) decoded.frames[i] = { ...decoded.frames[i], web: !decoded.frames[i].web };
    const tampered = replayRun({ save: hero(), seed: SEED, log: encodeInputLog(decoded) }, { chapter: CHAPTER_ID });
    expect(tampered.hash).not.toBe(hashState(run.sim));
  });

  it("leaves patrol nights alone: no chapter state, no chapter frame fields", () => {
    const run = startRun(hero(), SEED);
    expect(run.chapter).toBeNull();
    expect(run.sim.chapter).toBeNull();
    const mem = newBotMemory();
    const f = newRenderFrame();
    let villains = 0;
    while (!run.over && run.sim.tick < 6000) {
      if (run.sim.mode === "errand") break;
      stepRun(run, botFrame(run.sim, mem));
      fillRenderFrame(run.sim, f);
      expect(f.chapter).toBeNull();
      for (const v of f.villains) {
        villains += 1;
        expect("aim" in v).toBe(false);
      }
    }
    expect(villains + run.sim.tick).toBeGreaterThan(0);
  });
});

describe("Case File 001: the render contract (v1.5)", () => {
  it("fills the chapter, the Right-Clicker and his aim every tick, without touching the hash", () => {
    const run = startChapterRun(hero(), SEED, CHAPTER_ID);
    const mem = newBotMemory();
    const frames: [RenderFrame3D, RenderFrame3D] = [newRenderFrame(), newRenderFrame()];
    let flip = 0;
    const states = new Set<string>();
    const phases = new Set<string>();
    let aims = 0;
    let copies = 0;
    let lastFound = 0;
    while (!run.over && !run.error) {
      stepRun(run, botFrame(run.sim, mem));
      const s = run.sim;
      const before = hashState(s);
      const f = fillRenderFrame(s, frames[flip]);
      flip ^= 1;
      expect(hashState(s)).toBe(before);
      const ch = f.chapter!;
      expect(ch.id).toBe("case-001");
      phases.add(ch.phase);
      expect(ch.phase).toBe(s.chapter!.phase);
      expect(ch.clues.map((c) => c.id)).toEqual(["tabs", "cursor", "pixels"]);
      const found = ch.clues.filter((c) => c.found).length;
      expect(found).toBeGreaterThanOrEqual(lastFound);
      lastFound = found;
      expect(ch.captive!.restore).toBeGreaterThanOrEqual(0);
      expect(ch.captive!.restore).toBeLessThanOrEqual(1);
      expect(ch.captive!.freed).toBe(ch.captive!.restore === 1);
      const ids = ch.copies.map((c) => c.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of ch.copies) expect(Number.isFinite(c.yaw)).toBe(true);
      copies = Math.max(copies, ch.copies.length);
      for (const v of f.villains) {
        expect(v.id).toBe("right-clicker");
        expect(v.hitsMax).toBe(CHAPTER_HITS);
        states.add(v.state);
        expect(["idle", "aim", "flash", "recover", "copy", "drag", "stunned", "webbed"]).toContain(v.state);
        if (v.aim) {
          aims += 1;
          expect(["aim", "flash"]).toContain(v.state);
          expect(Math.abs(Math.hypot(v.aim.dir.x, v.aim.dir.z) - 1)).toBeLessThan(1e-9);
          expect(v.aim.dir.y).toBe(0);
          expect(v.aim.half).toBeGreaterThan(0.1);
        } else expect(v.state === "aim").toBe(false);
      }
    }
    expect([...phases]).toEqual(["investigate", "standoff", "rescue", "done"]);
    expect(aims).toBeGreaterThan(0);
    expect(copies).toBeGreaterThanOrEqual(2);
    for (const st of ["idle", "aim", "flash", "webbed"]) expect(states.has(st), st).toBe(true);
    expect(frames[0].chapter!.captive!.freed || frames[1].chapter!.captive!.freed).toBe(true);
  });
});

describe("Case File 001: the case in the save", () => {
  it("the first verified clear closes it with XP; later clears only lower the best time", () => {
    const save = hero();
    expect(caseRecord(save, CHAPTER_ID)).toEqual({ cleared: false, clearedAt: null, bestTicks: null, verified: false });
    const xp = save.hero!.xp;
    const level = save.hero!.level;
    const first = applyCaseClear(save, CHAPTER_ID, 4000, "2026-11-05T10:00:00.000Z", true);
    expect(first.firstClear).toBe(true);
    expect(first.save.cases!["case-001"]).toEqual({ cleared: true, clearedAt: "2026-11-05T10:00:00.000Z", bestTicks: 4000, verified: true });
    const h = first.save.hero!;
    expect(h.level * 1000 + h.xp).not.toBe(level * 1000 + xp);
    expect(CASE_XP).toBeGreaterThan(0);
    const slower = applyCaseClear(first.save, CHAPTER_ID, 5000, "2026-11-06T10:00:00.000Z", true);
    expect(slower.firstClear).toBe(false);
    expect(slower.save.cases!["case-001"]).toEqual(first.save.cases!["case-001"]);
    expect(slower.save.hero).toBe(first.save.hero);
    const faster = applyCaseClear(slower.save, CHAPTER_ID, 3500, "2026-11-07T10:00:00.000Z", true);
    expect(faster.save.cases!["case-001"]!.bestTicks).toBe(3500);
    expect(faster.save.cases!["case-001"]!.clearedAt).toBe("2026-11-05T10:00:00.000Z");
    expect(faster.save.hero).toBe(first.save.hero);
  });

  it("a guest's clear is kept unverified (sign in to file it), and a verified one still counts as the first", () => {
    const local = applyCaseClear(hero(), CHAPTER_ID, 4200, "2026-11-05T10:00:00.000Z", false);
    expect(local.firstClear).toBe(true);
    expect(local.save.cases!["case-001"]!.verified).toBe(false);
    const again = applyCaseClear(local.save, CHAPTER_ID, 4000, "2026-11-05T11:00:00.000Z", false);
    expect(again.firstClear).toBe(false);
    expect(again.save.cases!["case-001"]!.bestTicks).toBe(4000);
    const filed = applyCaseClear(hero(), CHAPTER_ID, 4100, "2026-11-05T12:00:00.000Z", true);
    expect(filed.firstClear).toBe(true);
    expect(filed.save.cases!["case-001"]!.verified).toBe(true);
  });
});

describe("Case File 001: balance (chapter-metrics.ts)", () => {
  type Summary = ReturnType<typeof summarizeChapter>;
  let bot: Summary;
  let simple: Summary;
  let average: Summary;
  let good: Summary;
  beforeAll(() => {
    const save = chapterHero(3);
    bot = summarizeChapter(chapterRuns("bot", undefined, save));
    simple = summarizeChapter(chapterRuns("simple", undefined, save));
    average = summarizeChapter(chapterRuns("average", undefined, save));
    good = summarizeChapter(chapterRuns("good", undefined, save));
  }, 120_000);

  it("the bot clears every night on its feet, in a minute or so", () => {
    expect(bot.clearRate).toBe(1);
    expect(bot.heroAir).toBeLessThan(0.15);
    expect(bot.medianFight).toBeGreaterThan(8);
    expect(bot.medianFight).toBeLessThan(40);
    expect(bot.medianInvestigate).toBeLessThan(60);
    expect(bot.p90Seconds).toBeLessThan(150);
  });

  it("a player who never dodges clears at least 80% of attempts; average and good players more", () => {
    expect(simple.clearRate).toBeGreaterThanOrEqual(0.8);
    expect(average.clearRate).toBeGreaterThanOrEqual(0.9);
    expect(good.clearRate).toBeGreaterThanOrEqual(0.95);
    // The night-1 hero (level 1, 100 health) too.
    expect(summarizeChapter(chapterRuns("simple", undefined, chapterHero(1))).clearRate).toBeGreaterThanOrEqual(0.8);
  });

  it("fights like ruleset 4: grounded, 15–45 s for an average player, and dodging pays", () => {
    expect(average.medianFight).toBeGreaterThan(15);
    expect(average.medianFight).toBeLessThan(45);
    expect(average.heroAir).toBeLessThan(0.15);
    expect(simple.heroAir).toBeLessThan(0.15);
    expect(average.meanFightDamage / 106).toBeGreaterThan(0.15);
    expect(simple.meanFightDamage).toBeGreaterThan(average.meanFightDamage);
    expect(simple.savedPerFight).toBeGreaterThan(good.savedPerFight);
    expect(simple.medianRescue).toBeGreaterThan(2.9);
  });
});
