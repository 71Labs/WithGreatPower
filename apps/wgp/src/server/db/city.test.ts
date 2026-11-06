/**
 * Free roam on the server, with the real replay: the browser plays an outing through game-core
 * (the scripted bot), files its log, and the server replays it from the record's base and pays
 * each first find's XP once. The same outing filed again as it grows pays only what's new; a
 * stale base, a night's log or a chapter's are refused.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { cityBase, cityRecord, emptyCity, roamStartFrom } from "@wgp/game-core/city";
import { encodeInputCodes } from "@wgp/game-core/input";
import { ROAM_LOG_RULESETS_PAST, ROAM_RULESET, roamLog, startRoamRun, stepRoamRun } from "@wgp/game-core/roam";
import { newRoamBot, PAGE_XP, roamBotFrame, roamWorld, TASK_DONE, TASK_XP, type RoamBotGoal } from "@wgp/game-core/sim3d/roam";

import { HttpError } from "@/server/http";

import { CITY_BUDGET_SCOPE, fileOuting, getCity } from "./city";
import type { Db } from "./client";
import { ensureSave } from "./players";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-07T20:00:00Z");
const ID_A = "6f1d6a1e-6a7b-4c39-9a3b-1f9e1a2b3c4d";
const ID_B = "0b9c3c1a-2d4e-4f50-8a61-7b8c9d0e1f2a";

/** Play an outing in "the browser" from a record, the bot doing `goals`; the log and how far it got. */
function play(base = cityBase(emptyCity()), goals: RoamBotGoal[], maxTicks = 60 * 120) {
  const run = startRoamRun(roamStartFrom(base));
  const mem = newRoamBot(goals);
  while (mem.i < goals.length && run.sim.tick < maxTicks) stepRoamRun(run, roamBotFrame(run.sim, mem));
  return { run, log: roamLog(run) };
}

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("free roam on the server", () => {
  let db: Db;
  let playerId: string;
  const w = roamWorld();
  const dev = w.folks.find((f) => f.key === "dev")!;
  const page = w.pages.find((p) => p.y === 0)!;
  const chase: RoamBotGoal[] = [{ kind: "go", x: dev.x, z: dev.z, r: 90, street: true }, { kind: "act" }, { kind: "wait", ticks: 30 }, { kind: "chase", ticks: 60 * 90 }, { kind: "go", x: dev.x, z: dev.z, r: 100, street: true }, { kind: "act" }];

  beforeAll(async () => {
    db = await freshDb();
    playerId = (await makePlayer(db, "roamer")).id;
    await givePlayerHero(db, playerId, "Roamer");
  });

  it("files an outing from the record's base and pays each first find once", async () => {
    // First part of the outing: off the roof, to Dev, the chase and back.
    const first = play(cityBase(emptyCity()), chase);
    const a = await fileOuting(db, { playerId, outingId: ID_A, base: cityBase(emptyCity()), log: first.log, now: T0 });
    expect(a.ruleset).toBe(ROAM_RULESET);
    expect(a.gains.tasks).toEqual(["pickpocket"]);
    expect(a.gains.xp).toBe(TASK_XP);
    expect(a.city.tasks.pickpocket).toBe(TASK_DONE);
    expect(a.city.outing?.id).toBe(ID_A);
    // The XP is on the hero (a level-1 hero's 40 XP of 100).
    expect(a.save.hero!.xp).toBe(TASK_XP);

    // The same outing, longer (on to a page): filed again, it pays only the page.
    const longer = play(cityBase(emptyCity()), [...chase, { kind: "go", x: page.x, z: page.z, r: 10, street: true }]);
    const b = await fileOuting(db, { playerId, outingId: ID_A, base: cityBase(emptyCity()), log: longer.log, now: T0 });
    expect(b.gains.tasks).toEqual([]);
    expect(b.gains.pages).toBe(1);
    expect(b.gains.xp).toBe(PAGE_XP);
    expect(b.save.hero!.xp).toBe(TASK_XP + PAGE_XP);

    // And again, the same log: nothing new.
    const c = await fileOuting(db, { playerId, outingId: ID_A, base: cityBase(emptyCity()), log: longer.log, now: T0 });
    expect(c.gains.xp).toBe(0);
    expect((await ensureSave(db, playerId)).save.hero!.xp).toBe(TASK_XP + PAGE_XP);
    const rec = await getCity(db, playerId);
    expect(rec.pages).toBe(b.city.pages);
    expect(rec.at).toEqual(b.city.at);
  });

  it("starts the next outing where the last one stood, and refuses a base that isn't the record's", async () => {
    const rec = cityRecord((await ensureSave(db, playerId)).save);
    // A new outing claiming the empty city it started from before: stale.
    const stale = await rejection(fileOuting(db, { playerId, outingId: ID_B, base: cityBase(emptyCity()), log: play(cityBase(emptyCity()), [{ kind: "wait", ticks: 10 }]).log, now: T0 }));
    expect(stale.status).toBe(409);
    expect(stale.code).toBe("stale_city");
    // From the record as it stands: fine, and it starts at the spot the last one ended.
    const next = play(cityBase(rec), [{ kind: "wait", ticks: 30 }]);
    expect(next.run.sim.hero.x).toBeCloseTo(rec.at!.x, 6);
    const ok = await fileOuting(db, { playerId, outingId: ID_B, base: cityBase(rec), log: next.log, now: T0 });
    expect(ok.gains.xp).toBe(0);
    expect(ok.city.outing?.id).toBe(ID_B);
  });

  it("refuses a night's log, a chapter's and a malformed one", async () => {
    const rec = cityRecord((await ensureSave(db, playerId)).save);
    const golden = fileURLToPath(new URL("../../../../../packages/game-core/test/golden/", import.meta.url));
    for (const name of ["night-1-standard.bin", "case-001-standard.bin"]) {
      const log = new Uint8Array(readFileSync(`${golden}${name}`));
      const e = await rejection(fileOuting(db, { playerId, outingId: ID_B, base: cityBase(rec), log, now: T0 }));
      expect(e.status, name).toBe(422);
      expect(e.message).toMatch(/is not free roam/);
    }
    const bad = await rejection(fileOuting(db, { playerId, outingId: ID_B, base: cityBase(rec), log: new Uint8Array([1, 2, 3]), now: T0 }));
    expect(bad.status).toBe(422);
  });

  it("refuses an outing played under older roam rules as stale, and keeps the record as it stands", async () => {
    const before = (await ensureSave(db, playerId)).save;
    const rec = cityRecord(before);
    // A tab open across a release: its outing's log carries roam-1's field.
    const now = play(cityBase(rec), [{ kind: "wait", ticks: 30 }]);
    const old = encodeInputCodes(now.run.codes, [], 0, ROAM_LOG_RULESETS_PAST[0]);
    const e = await rejection(fileOuting(db, { playerId, outingId: ID_A, base: cityBase(rec), log: old, now: T0 }));
    expect(e.status).toBe(409);
    expect(e.code).toBe("stale_rules");
    const after = (await ensureSave(db, playerId)).save;
    expect(after.city).toEqual(before.city);
    expect(after.hero!.xp).toBe(before.hero!.xp);
    // A fresh outing from the record files as ever.
    const fresh = await fileOuting(db, { playerId, outingId: "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f", base: cityBase(rec), log: now.log, now: T0 });
    expect(fresh.gains.xp).toBe(0);
  });

  it("counts filings against a daily budget", () => {
    expect(CITY_BUDGET_SCOPE).toBe("city:file");
  });
});
