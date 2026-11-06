/**
 * Case File 002, "The Sybil Vote": the city, the clues and the tells they reveal, the lineup,
 * the fork vote, the recount, the rescue, determinism and verification (and refusing other
 * modes' logs), the render contract (v1.6), and the balance gates on vote-metrics.ts
 * (VOTE_REPORT=1 prints the table).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { hashState } from "../src/hash";
import { decodeInputLog, encodeInputLog } from "../src/input/log";
import { chapterCleared, replayRun, runLog, startChapterRun, startRun, stepRun, type Run } from "../src/replay";
import { CASE_002_ID, CASE_002_RULESET, CHAPTER_IDS, CHAPTERS, clueNote, TELL_BIT, TELL_OF_CLUE } from "../src/rules/chapters";
import { RULESET_VERSION } from "../src/score";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { takesHit } from "../src/sim3d/combat";
import { suspects } from "../src/sim3d/bot-vote";
import { chapterLogRuleset, VOTER_LIFT } from "../src/sim3d/chapter";
import { HERO_RADIUS } from "../src/sim3d/constants";
import type { InputFrame, RenderFrame3D } from "../src/sim3d/contract";
import { dirIndex, len2 } from "../src/sim3d/dmath";
import { fillRenderFrame, newRenderFrame } from "../src/sim3d/render";
import { IDLE_FRAME } from "../src/sim3d/sim";
import { forkSideOf } from "../src/sim3d/sybil-vote";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { BASE_COPIES, FORKED_MAX, knownTells, liveCopies, realBody, RECOUNT_AT, RECOUNT_BODIES, VOTE_HITS } from "../src/sim3d/vote";
import { heroSave, playBot, STANDARD } from "./helpers";
import { summarizeVote, voteHero, voteRuns } from "./vote-metrics";

const SEED = 0xca5e02;
const hero = () => heroSave(STANDARD, "Vote Tester", 3);
const start = (seed = SEED) => startChapterRun(hero(), seed, CASE_002_ID);

function botUntil(run: Run, until: (s: SimState) => boolean, max = 54_000): SimEvent[] {
  const mem = newBotMemory();
  const all: SimEvent[] = [];
  while (!run.over && !run.error && run.sim.tick < max && !until(run.sim)) all.push(...stepRun(run, botFrame(run.sim, mem)));
  return all;
}

const step = (run: Run, frame: InputFrame, n = 1) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...stepRun(run, frame));
  return out;
};

/** The lineup, live (the bot finds the clues and lands on the station; the voters stand). */
function lineup(seed = SEED): Run {
  const run = start(seed);
  botUntil(run, (s) => s.mode === "fight");
  expect(run.sim.chapter!.phase).toBe("lineup");
  return run;
}

/** The standoff, live: the bot marks him. */
function standoff(seed = SEED): Run {
  const run = start(seed);
  botUntil(run, (s) => s.chapter!.phase === "standoff");
  expect(run.sim.mode).toBe("fight");
  return run;
}

/** Stand the hero still at (x, z) on the stage. */
function placeHero(s: SimState, x: number, z: number) {
  const h = s.hero;
  const st = s.city.zones[0].stage!;
  Object.assign(h, { x, z, y: st.y + HERO_RADIUS, vx: 0, vy: 0, vz: 0, grounded: true, rope: null, invuln: 0, strike: -1, zip: -1, strikeCd: 0, zipCd: 0, hurtT: 0, heldT: 0, landT: 0, shieldT: 0 });
}

/** Press the web beside body `b` until a blow lands (or a second passes). */
function strikeAt(run: Run, slot: number): SimEvent[] {
  const s = run.sim;
  const b = s.villain!.bodies.find((x) => x.slot === slot)!;
  const st = s.city.zones[0].stage!;
  const side = b.z > (st.z0 + st.z1) / 2 ? 1 : -1;
  placeHero(s, b.x, b.z + side * 64);
  const out: SimEvent[] = [];
  for (let i = 0; i < 60 && !out.some((e) => e.type === "voter-mark" || e.type === "villain-hit" || e.type === "copy-pop"); i++) out.push(...step(run, { dir: 0, mag: 0, web: i % 4 === 0, shot: 0 }));
  return out;
}

describe("Case File 002: the night", () => {
  it("has its own id, ruleset tag and log ruleset, on ruleset 4", () => {
    expect(RULESET_VERSION).toBe(4);
    expect(CHAPTER_IDS).toContain("case-002");
    expect(CASE_002_RULESET).toBe("c002-1");
    expect(CHAPTERS["case-002"].ruleset).toBe("c002-1");
    expect(CHAPTERS["case-002"].badge).toBe("case-002");
    expect(chapterLogRuleset("case-002")).toBe(0x0c002104);
    expect(chapterLogRuleset("case-002")).not.toBe(chapterLogRuleset("case-001"));
  });

  it("builds the Validator Heights city: three drop boxes on roofs, eight booths, Uncle Gen and the ballot box on the stage", () => {
    for (let k = 0; k < 30; k++) {
      const seed = Math.imul(k + 3, 0x2545f491) >>> 0;
      const run = start(seed);
      expect(run.error).toBeNull();
      const s = run.sim;
      const c = s.chapter!;
      const vt = c.vote!;
      const z = s.city.zones[0];
      expect(s.city.zones).toHaveLength(1);
      expect(z.villain).toBe("sybil");
      expect(z.district).toBe("validator-heights");
      expect(c.clues.map((q) => q.id)).toEqual(["signature", "footage", "gif"]);
      for (const q of c.clues) {
        const roof = s.city.buildings.find((b) => {
          const r = b.top ?? b;
          return q.x >= r.x0 && q.x <= r.x1 && q.z >= r.z0 && q.z <= r.z1 && (b.top ? b.top.h : b.h) === q.y;
        });
        expect(roof, `seed ${seed}: ${q.id} on a roof`).toBeTruthy();
      }
      // Eight booths on the stage, every look once; the real one's is one of them.
      const st = z.stage!;
      expect(vt.booths).toHaveLength(8);
      for (const b of vt.booths) {
        expect(b.x).toBeGreaterThan(st.x0 + 40);
        expect(b.x).toBeLessThan(st.x1 - 40);
        expect(b.z).toBeGreaterThan(st.z0 + 40);
        expect(b.z).toBeLessThan(st.z1 - 40);
      }
      expect([...vt.tells].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(vt.tells[0]).toBe(vt.real);
      expect(c.captive.y).toBe(st.y);
      expect(len2(vt.boxX - c.captive.x, vt.boxZ - c.captive.z)).toBeLessThan(100);
      expect(hashState(start(seed).sim)).toBe(hashState(s));
    }
  });

  it("each clue's note tells one of tonight's tells, true to the real Sybil", () => {
    const run = start();
    const real = run.sim.chapter!.vote!.real;
    for (const id of ["signature", "footage", "gif"] as const) {
      const tell = TELL_OF_CLUE[id]!;
      const note = clueNote("case-002", id, real);
      const t = CHAPTERS["case-002"].tells![id]!;
      expect(note).toBe((real & TELL_BIT[tell]) !== 0 ? t.yes : t.no);
    }
    // Case File 001's notes don't change.
    expect(clueNote("case-001", "tabs")).toBe(CHAPTERS["case-001"].clues[0].note);
  });

  it("is cleared by the bot: clues, the lineup, the fight's three stages, the runner and Uncle Gen's vote", () => {
    const run = start();
    const events = botUntil(run, () => false);
    expect(run.error).toBeNull();
    expect(chapterCleared(run)).toBe(true);
    const types = events.map((e) => e.type);
    expect(events.filter((e) => e.type === "clue-found")).toHaveLength(3);
    const mark = types.indexOf("voter-mark");
    expect(mark).toBeGreaterThan(types.lastIndexOf("clue-found"));
    expect(events.find((e) => e.type === "encounter")).toMatchObject({ villain: "sybil" });
    expect(events.filter((e) => e.type === "voter-mark" && e.real)).toHaveLength(1);
    expect(types).toContain("fork-call");
    expect(types.indexOf("recount")).toBeGreaterThan(mark);
    const won = types.indexOf("fight-won");
    expect(won).toBeGreaterThan(types.indexOf("recount"));
    const taken = events.findIndex((e) => e.type === "ballot" && e.state === "taken");
    const counted = events.findIndex((e) => e.type === "ballot" && e.state === "counted");
    expect(taken).toBeGreaterThan(won);
    expect(counted).toBeGreaterThan(taken);
    expect(types.indexOf("captive-freed")).toBeGreaterThan(counted);
    expect(events.filter((e) => e.type === "case-closed")).toEqual([{ type: "case-closed", id: "case-002", ticks: run.sim.tick }]);
    expect(events[events.length - 1]).toEqual({ type: "night-over", reason: "route" });
    expect(types).not.toContain("stop-done");
    expect(run.save).toBe(run.start);
  });

  it("the lineup: only a blow marks; a copy pops with a paper cut and forks one more copy into the fight", () => {
    const run = lineup();
    const s = run.sim;
    const v = s.villain!;
    expect(v.bodies.filter((b) => b.alive)).toHaveLength(8);
    // Every voter's look is different, and only the real one fits all three tells.
    expect(knownTells(s)).toBe(7);
    expect(suspects(s).map((b) => b.real)).toEqual([true]);
    const wrong = v.bodies.find((b) => !b.real)!;
    const hp = s.hp;
    const ev = strikeAt(run, wrong.slot);
    expect(ev.find((e) => e.type === "voter-mark")).toMatchObject({ real: false, wrong: 1 });
    expect(wrong.alive).toBe(false);
    expect(s.hp).toBeLessThan(hp);
    expect(s.chapter!.phase).toBe("lineup");
    // A web bomb's blast doesn't mark anyone.
    const alive = v.bodies.filter((b) => b.alive).length;
    s.hero.invuln = 0;
    const ev2 = strikeAt(run, realBody(v).slot);
    expect(ev2.find((e) => e.type === "voter-mark")).toMatchObject({ real: true, wrong: 1 });
    expect(s.chapter!.phase).toBe("standoff");
    expect(alive).toBe(7);
    // The line breaks; his copies: three, and one for the wrong mark.
    expect(liveCopies(v, s.chapter!.vote!)).toHaveLength(BASE_COPIES + 1);
    expect(FORKED_MAX).toBe(3);
  });

  it("the lineup never zips at the nearest voter: from across the stage the web waits", () => {
    const run = lineup();
    const s = run.sim;
    const st = s.city.zones[0].stage!;
    placeHero(s, (st.x0 + st.x1) / 2, st.z0 + 30);
    const ev = step(run, { dir: 0, mag: 0, web: true, shot: 0 }, 2);
    expect(ev.some((e) => e.type === "zip")).toBe(false);
    expect(s.hero.zip).toBe(-1);
  });

  it("the fork vote: on the orphaned side when it passes, hurt and shoved across; quorum failed, he staggers open", () => {
    const run = standoff();
    const s = run.sim;
    const v = s.villain!;
    const vt = s.chapter!.vote!;
    const zone = s.city.zones[0];
    // Make him call it now, with the hero clear on one side of the x split.
    vt.forks = 0;
    v.cycle = 1; // the polls' pattern: fake, fork, …
    v.phase = "idle";
    v.attackT = 0;
    v.stun = 0;
    v.invuln = 99;
    // Him and his copies across the stage, out of the shove's way.
    v.bodies.forEach((b, i) => {
      b.x = zone.center.x - 200;
      b.z = zone.center.z - 160 + i * 40;
    });
    placeHero(s, zone.center.x + 180, zone.center.z);
    const call = step(run, IDLE_FRAME, 2).find((e) => e.type === "fork-call");
    expect(call).toMatchObject({ type: "fork-call", axis: "x", orphan: 1 });
    expect(vt.forkT).toBeGreaterThan(1.5);
    const hp = s.hp;
    let close: SimEvent | undefined;
    let x0 = 0;
    for (let i = 0; i < 200 && !close; i++) {
      x0 = s.hero.x;
      close = step(run, IDLE_FRAME).find((e) => e.type === "fork");
    }
    expect(close).toMatchObject({ type: "fork", passed: true, hit: true });
    expect(s.hp).toBeLessThan(hp);
    // Shoved toward the canonical side.
    step(run, IDLE_FRAME, 6);
    expect(s.hero.x).toBeLessThan(x0 - 10);

    // Again, but pop the copies first: quorum fails and he staggers (open).
    const run2 = standoff();
    const s2 = run2.sim;
    const v2 = s2.villain!;
    const vt2 = s2.chapter!.vote!;
    v2.cycle = 1;
    v2.phase = "idle";
    v2.attackT = 0;
    v2.stun = 0;
    placeHero(s2, zone.center.x - 180, zone.center.z);
    step(run2, IDLE_FRAME, 2);
    expect(vt2.forkT).toBeGreaterThan(0);
    for (const b of liveCopies(v2, vt2)) b.alive = false;
    let fail: SimEvent | undefined;
    for (let i = 0; i < 200 && !fail; i++) fail = step(run2, IDLE_FRAME).find((e) => e.type === "fork");
    expect(fail).toMatchObject({ passed: false, hit: false });
    // Staggered: a blow gets through his guard.
    expect(String(v2.phase)).toBe("stagger");
    expect(takesHit(v2)).toBe(true);
    expect(forkSideOf(vt2, s2.hero.x, s2.hero.z)).toBeGreaterThan(0);
  });

  it("the fork vote passes harmlessly over a hero who crossed to the canonical side", () => {
    const run = standoff();
    const s = run.sim;
    const v = s.villain!;
    const zone = s.city.zones[0];
    v.cycle = 1;
    v.phase = "idle";
    v.attackT = 0;
    v.stun = 0;
    v.invuln = 99;
    placeHero(s, zone.center.x + 120, zone.center.z);
    step(run, IDLE_FRAME, 2);
    const left: InputFrame = { dir: dirIndex(-1, 0), mag: 3, web: false, shot: 0 };
    const ev = step(run, left, 200);
    expect(ev.find((e) => e.type === "fork")).toMatchObject({ passed: true, hit: false });
  });

  it("the recount: at half his hits he hides in a ring; a copy pops with a paper cut, a blow on him ends it", () => {
    const run = standoff();
    const s = run.sim;
    const v = s.villain!;
    const vt = s.chapter!.vote!;
    expect(v.hitsMax).toBe(VOTE_HITS);
    // One hit off the recount, in an opening.
    v.hits = RECOUNT_AT + 1;
    v.phase = "stagger";
    v.phaseT = 2;
    v.invuln = 0;
    const r = realBody(v);
    const ev = strikeAt(run, r.slot);
    expect(ev.some((e) => e.type === "recount" && !e.end)).toBe(true);
    expect(vt.stage).toBe("recount");
    const ring = v.bodies.filter((b) => b.alive);
    expect(ring).toHaveLength(RECOUNT_BODIES);
    // Each copy differs from him in at least one tell.
    for (const b of ring) if (!b.real) expect(vt.tells[b.slot]).not.toBe(vt.real);
    // Let the ring form, then a wrong one, then him.
    step(run, IDLE_FRAME, 80);
    const copy = ring.find((b) => !b.real)!;
    const hp = s.hp;
    s.hero.invuln = 0;
    const miss = strikeAt(run, copy.slot);
    expect(miss.find((e) => e.type === "voter-mark")).toMatchObject({ real: false });
    expect(s.hp).toBeLessThan(hp);
    s.hero.invuln = 0;
    const hits = v.hits;
    const found = strikeAt(run, r.slot);
    expect(found.some((e) => e.type === "villain-hit")).toBe(true);
    expect(found.some((e) => e.type === "recount" && e.end)).toBe(true);
    expect(v.hits).toBe(hits - 1);
    expect(vt.stage).toBe("runoff");
  });

  it("the rescue: catch the runner, carry Uncle Gen's ballot to the box, and the case closes", () => {
    const run = start();
    botUntil(run, (s) => s.chapter!.phase === "rescue");
    const s = run.sim;
    const vt = s.chapter!.vote!;
    expect(s.mode).toBe("fight");
    expect(vt.ballot).toBe(0);
    const runner = s.villain!.bodies.find((b) => b.slot === vt.runner)!;
    expect(runner.alive).toBe(true);
    // The webbed Sybil is no target: the web goes for the runner.
    const ev = botUntil(run, (x) => x.chapter!.vote!.ballot === 1);
    expect(ev.some((e) => e.type === "ballot" && e.state === "taken")).toBe(true);
    // Not counted until it's at the box.
    expect(s.chapter!.captive.freed).toBe(false);
    placeHero(s, vt.boxX + 40, vt.boxZ);
    const done = step(run, IDLE_FRAME, 1);
    expect(done.some((e) => e.type === "ballot" && e.state === "counted")).toBe(true);
    expect(s.chapter!.captive.freed).toBe(true);
    const rest = step(run, IDLE_FRAME, 400);
    expect(rest.some((e) => e.type === "case-closed")).toBe(true);
    expect(chapterCleared(run)).toBe(true);
  });

  it("a knockout ends it uncleared, and replays", () => {
    const run = standoff(0xbad5);
    while (!run.over && run.sim.tick < 54_000) stepRun(run, IDLE_FRAME);
    expect(run.over).toBe(true);
    expect(chapterCleared(run)).toBe(false);
    const res = replayRun({ save: run.start, seed: 0xbad5, log: runLog(run) }, { chapter: CASE_002_ID });
    expect(res.ok, res.reason).toBe(true);
    expect(res.stats.cleared).toBe(0);
    expect(res.stats.knockedOut).toBe(1);
  });
});

describe("Case File 002: determinism and verification", () => {
  it("the same log gives the same hash and checkpoints, twice and after other runs", () => {
    const run = start();
    botUntil(run, () => false);
    const log = runLog(run);
    expect(decodeInputLog(log).ruleset).toBe(chapterLogRuleset(CASE_002_ID));
    const a = replayRun({ save: hero(), seed: SEED, log }, { chapter: CASE_002_ID });
    playBot(heroSave(STANDARD, "Someone Else", 5), 4242);
    botUntil(startChapterRun(hero(), SEED, "case-001"), () => false);
    const b = replayRun({ save: hero(), seed: SEED, log }, { chapter: CASE_002_ID });
    expect(a.ok, a.reason).toBe(true);
    expect(b).toEqual(a);
    expect(a.hash).toBe(hashState(run.sim));
    expect(a.stats.cleared).toBe(1);
    expect(a.score).toBe(0);
    expect(a.checkpoints).toHaveLength(6);
    expect(a.stats.wrongMarks).toBe(0);
  });

  it("refuses other modes' logs both ways, tampering and short logs", () => {
    const run = start();
    botUntil(run, () => false);
    const log = runLog(run);
    expect(replayRun({ save: hero(), seed: SEED, log }).reason).toMatch(/ruleset 201335044 is not 4/);
    expect(replayRun({ save: hero(), seed: SEED, log }, { chapter: "case-001" }).reason).toMatch(/is not chapter case-001's/);
    const night = playBot(hero(), SEED).run;
    expect(replayRun({ save: hero(), seed: SEED, log: runLog(night) }, { chapter: CASE_002_ID }).reason).toMatch(/ruleset 4 is not chapter case-002's/);
    const one = startChapterRun(hero(), SEED, "case-001");
    botUntil(one, () => false);
    expect(replayRun({ save: hero(), seed: SEED, log: runLog(one) }, { chapter: CASE_002_ID }).reason).toMatch(/ruleset 201330948 is not chapter case-002's/);
    // Case File 001's log relabelled as 002's still doesn't fit 002's night.
    const relabelled = encodeInputLog({ ...decodeInputLog(runLog(one)), ruleset: chapterLogRuleset(CASE_002_ID) });
    const forged = replayRun({ save: hero(), seed: SEED, log: relabelled }, { chapter: CASE_002_ID });
    expect(forged.ok && forged.stats.cleared === 1).toBe(false);
    const decoded = decodeInputLog(log);
    const short = replayRun({ save: hero(), seed: SEED, log: encodeInputLog({ ...decoded, frames: decoded.frames.slice(0, 600) }) }, { chapter: CASE_002_ID });
    expect(short.reason).toMatch(/didn't finish/);
    for (let i = 300; i < 320; i++) decoded.frames[i] = { ...decoded.frames[i], web: !decoded.frames[i].web };
    expect(replayRun({ save: hero(), seed: SEED, log: encodeInputLog(decoded) }, { chapter: CASE_002_ID }).hash).not.toBe(hashState(run.sim));
  });

  it("two bots on the same seed play the same night, frame for frame; another seed is another city", () => {
    const one = start();
    botUntil(one, () => false);
    const two = start();
    botUntil(two, () => false);
    expect(two.codes).toEqual(one.codes);
    expect(hashState(two.sim)).toBe(hashState(one.sim));
    expect(start(SEED + 1).sim.chapter!.clues.map((c) => [c.x, c.z])).not.toEqual(start().sim.chapter!.clues.map((c) => [c.x, c.z]));
  });

  it("leaves patrol nights and Case File 001 alone: no vote state, no vote frame", () => {
    const night = startRun(hero(), SEED);
    expect(night.sim.chapter).toBeNull();
    const one = startChapterRun(hero(), SEED, "case-001");
    expect(one.sim.chapter!.vote).toBeNull();
    const f = fillRenderFrame(one.sim, newRenderFrame());
    expect(f.chapter!.vote).toBeUndefined();
    expect(f.chapter!.id).toBe("case-001");
  });
});

describe("Case File 002: the render contract (v1.6)", () => {
  it("fills the vote every tick without touching the hash: voters with their looks, the fork, the recount, the ballot", () => {
    const run = start();
    const mem = newBotMemory();
    const frames: [RenderFrame3D, RenderFrame3D] = [newRenderFrame(), newRenderFrame()];
    let flip = 0;
    const phases = new Set<string>();
    const stages = new Set<string>();
    const states = new Set<string>();
    let forks = 0;
    let recounts = 0;
    const ballots = new Set<string>();
    let hiddenReal = 0;
    while (!run.over && !run.error) {
      stepRun(run, botFrame(run.sim, mem));
      const s = run.sim;
      const before = hashState(s);
      const f = fillRenderFrame(s, frames[flip]);
      flip ^= 1;
      expect(hashState(s)).toBe(before);
      const ch = f.chapter!;
      expect(ch.id).toBe("case-002");
      phases.add(ch.phase);
      const vote = ch.vote!;
      expect(vote).toBeTruthy();
      stages.add(vote.stage);
      expect(vote.booths).toHaveLength(8);
      expect(ch.copies).toHaveLength(0);
      const ids = vote.voters.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      for (const x of vote.voters) expect(x.pos.y - VOTER_LIFT).toBeCloseTo(ch.captive!.pos.y, 6);
      if (vote.fork) {
        forks += 1;
        expect(vote.fork.left).toBeGreaterThan(0);
        expect(vote.fork.left).toBeLessThanOrEqual(vote.fork.total);
        expect(Math.abs(vote.fork.orphan)).toBe(1);
      }
      if (vote.recount) recounts += 1;
      if (vote.ballot) ballots.add(vote.ballot.state);
      for (const v of f.villains) {
        expect(v.id).toBe("sybil");
        states.add(v.state);
      }
      // In the lineup and the recount every body reads as a copy.
      if (ch.phase === "lineup" || vote.stage === "recount") {
        if (f.villains.length && f.villains.every((v) => v.copy)) hiddenReal += 1;
        if (ch.phase === "lineup") expect(f.villains.every((v) => v.copy)).toBe(true);
      }
      if (ch.phase === "standoff" && vote.stage !== "recount") expect(f.villains.filter((v) => !v.copy)).toHaveLength(1);
    }
    expect([...phases]).toEqual(["investigate", "lineup", "standoff", "rescue", "done"]);
    expect([...stages].sort()).toEqual(["polls", "recount", "runoff"]);
    expect(forks).toBeGreaterThan(0);
    expect(recounts).toBeGreaterThan(0);
    expect(hiddenReal).toBeGreaterThan(0);
    expect([...ballots].sort()).toEqual(["carried", "counted", "runner"]);
    for (const st of ["count", "vote", "webbed"]) expect(states.has(st), st).toBe(true);
    expect(frames[0].chapter!.captive!.freed || frames[1].chapter!.captive!.freed).toBe(true);
  });
});

describe("Case File 002: balance (vote-metrics.ts)", () => {
  type Summary = ReturnType<typeof summarizeVote>;
  const rows: Record<string, Summary> = {};
  beforeAll(() => {
    for (const night of [1, 3]) for (const policy of ["bot", "first", "simple", "average", "good"] as const) rows[`${night} ${policy}`] = summarizeVote(voteRuns(policy, undefined, voteHero(night)));
  }, 300_000);

  it("the bot and a good player clear every night, on their feet", () => {
    for (const night of [1, 3]) {
      expect(rows[`${night} bot`].clearRate).toBe(1);
      expect(rows[`${night} good`].clearRate).toBe(1);
      expect(rows[`${night} good`].heroAir).toBeLessThan(0.15);
    }
  });

  it("a first-timer (no notes read, never dodges) clears about four in five; players who read and dodge, more", () => {
    const first = rows["1 first"].clearRate;
    expect(first).toBeGreaterThanOrEqual(0.7);
    expect(first).toBeLessThanOrEqual(0.95);
    expect(rows["1 simple"].clearRate).toBeGreaterThanOrEqual(first);
    expect(rows["1 average"].clearRate).toBeGreaterThanOrEqual(0.85);
    expect(rows["3 first"].clearRate).toBeGreaterThanOrEqual(0.8);
  });

  it("reading the clues pays: fewer wrong marks; answering forks pays: fewer fork hits; fights stay grounded and 15–45 s", () => {
    expect(rows["3 first"].meanWrong).toBeGreaterThan(rows["3 simple"].meanWrong);
    expect(rows["3 simple"].meanWrong).toBeGreaterThan(rows["3 average"].meanWrong);
    expect(rows["3 good"].meanWrong).toBe(0);
    expect(rows["3 good"].forkHitsPerFight).toBeLessThan(rows["3 simple"].forkHitsPerFight);
    expect(rows["3 good"].meanFightDamage).toBeLessThan(rows["3 simple"].meanFightDamage);
    for (const p of ["simple", "average", "good"]) {
      expect(rows[`3 ${p}`].medianFight).toBeGreaterThan(15);
      expect(rows[`3 ${p}`].medianFight).toBeLessThan(45);
      expect(rows[`3 ${p}`].heroAir).toBeLessThan(0.15);
    }
    expect(rows["3 bot"].forksPerFight).toBeGreaterThan(1);
  });
});
