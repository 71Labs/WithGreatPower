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
import { roamLog, ROAM_RULESET, startRoamRun, stepRoamRun } from "@wgp/game-core/roam";
import { crosschainTour, newRoamBot, PAGE_XP, ROAM_OLD_LOG_RULESETS, roamBotFrame, roamWorld, TASK_DONE, TASK_XP, type RoamBotGoal } from "@wgp/game-core/sim3d/roam";

import { HttpError } from "@/server/http";

import { CITY_BUDGET_SCOPE, fileOuting, getCity } from "./city";
import type { Db } from "./client";
import { ensureSave, writeSave } from "./players";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-07T20:00:00Z");
const ID_A = "6f1d6a1e-6a7b-4c39-9a3b-1f9e1a2b3c4d";
const ID_B = "0b9c3c1a-2d4e-4f50-8a61-7b8c9d0e1f2a";
const ID_C = "5a7e2c0d-91b3-4f6a-b8d2-3c4e5f6a7b8c";
const ID_D = "9d2b7e41-3c5a-4e86-b1f0-2a4c6e8d0b13";

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

  it("refuses an outing played under older roam rules (roam-1, roam-2) as stale, keeping the record, and hands back the record to start fresh from", async () => {
    const before = cityRecord((await ensureSave(db, playerId)).save);
    const xp = (await ensureSave(db, playerId)).save.hero!.xp;
    // The same frames an older tab would send, under its log field.
    const played = play(cityBase(before), [{ kind: "wait", ticks: 20 }]);
    expect(ROAM_OLD_LOG_RULESETS).toHaveLength(2);
    for (const ruleset of ROAM_OLD_LOG_RULESETS) {
      const old = encodeInputCodes(played.run.codes, [], 0, ruleset);
      for (const id of [ID_B, ID_C]) {
        const e = await rejection(fileOuting(db, { playerId, outingId: id, base: cityBase(before), log: old, now: T0 }));
        expect(e.status).toBe(409);
        expect(e.code).toBe("old_rules");
        expect(e.details?.ruleset).toBe(ROAM_RULESET);
        expect(e.details?.city).toEqual(before);
      }
    }
    // Nothing moved: the record and the XP are as they were.
    const after = (await ensureSave(db, playerId)).save;
    expect(cityRecord(after)).toEqual(before);
    expect(after.hero!.xp).toBe(xp);
    // A fresh outing from that record files.
    const fresh = play(cityBase(before), [{ kind: "wait", ticks: 20 }]);
    const ok = await fileOuting(db, { playerId, outingId: ID_C, base: cityBase(before), log: fresh.log, now: T0 });
    expect(ok.ruleset).toBe(ROAM_RULESET);
  });

  it("roam-3: files Cross-chain over a four-task record, the whole task in one outing, and pays its 40 XP once", async () => {
    const id = (await makePlayer(db, "relays")).id;
    await givePlayerHero(db, id, "Relays");
    const uncle = w.folks.find((f) => f.key === "uncle")!;
    // A roam-2 player's record: the four old tasks done (no crosschain key), standing by Uncle Gen.
    const stored = await ensureSave(db, id);
    const old = { ...emptyCity(), tasks: { bread: TASK_DONE, pickpocket: TASK_DONE, pixels: TASK_DONE, graffiti: TASK_DONE }, items: { pixels: 0xff, graffiti: 0xf }, xp: 4 * TASK_XP, outings: 4, at: { x: uncle.x - 60, y: uncle.y, z: uncle.z, fx: 1, fz: 0 } };
    expect(await writeSave(db, id, { ...stored.save, city: old }, stored.rev)).not.toBeNull();
    const base = cityBase(cityRecord((await ensureSave(db, id)).save));
    const xp = (await ensureSave(db, id)).save.hero!.xp;
    // The browser plays it: Uncle Gen, the four relays (held), back to him.
    const played = play(base, crosschainTour(w), 60 * 60 * 5);
    const a = await fileOuting(db, { playerId: id, outingId: ID_D, base, log: played.log, now: T0 });
    expect(a.ruleset).toBe(ROAM_RULESET);
    expect(a.gains.tasks).toEqual(["crosschain"]);
    expect(a.gains.xp).toBe(TASK_XP);
    expect(a.city.tasks).toMatchObject({ bread: TASK_DONE, pickpocket: TASK_DONE, pixels: TASK_DONE, graffiti: TASK_DONE, crosschain: TASK_DONE });
    expect(a.city.items.crosschain).toBe(0b1111);
    expect(a.save.hero!.xp).toBe(xp + TASK_XP);
    // Filed again (the browser files on every find): nothing more.
    const b = await fileOuting(db, { playerId: id, outingId: ID_D, base, log: played.log, now: T0 });
    expect(b.gains.xp).toBe(0);
    expect((await ensureSave(db, id)).save.hero!.xp).toBe(xp + TASK_XP);
  });

  it("counts filings against a daily budget", () => {
    expect(CITY_BUDGET_SCOPE).toBe("city:file");
  });
});
