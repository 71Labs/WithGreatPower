import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setVerifier } from "@/server/verify";

import { actionBody, applyAction, type MenuAction } from "./actions";
import { setDb, type Db } from "./client";
import { ensureSave } from "./players";
import { startRun } from "./runs";
import { fakeVerifier, freshDb, makePlayer } from "./test-helpers";

const create: MenuAction = { type: "create-hero", name: "Gwen", suit: "snow", powers: ["web-sling", "yank", "finality"] };

describe("server actions", () => {
  let db: Db;
  let playerId: string;

  beforeEach(async () => {
    db = await freshDb();
    playerId = (await makePlayer(db, "gwen")).id;
    setVerifier(fakeVerifier());
  });
  afterEach(() => {
    setVerifier(undefined);
    setDb(undefined);
  });

  it("reduces an action on the server and bumps the revision", async () => {
    const out = await applyAction(db, { playerId, action: create, rev: 0 });
    expect(out.applied).toBe(true);
    expect(out.rev).toBe(1);
    expect(out.save.hero).toMatchObject({ name: "Gwen", suit: "snow", level: 1 });
    expect((await ensureSave(db, playerId)).rev).toBe(1);
  });

  it("refuses a stale revision with the current save", async () => {
    await applyAction(db, { playerId, action: create, rev: 0 });
    const error = await applyAction(db, { playerId, action: { type: "vote", side: "hero" }, rev: 0 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: "rev_conflict", details: { rev: 1 } });
  });

  it("reports actions the rules refuse as not applied, without a new revision", async () => {
    await applyAction(db, { playerId, action: create, rev: 0 });
    const out = await applyAction(db, { playerId, action: { type: "sleep" }, rev: 1 }); // the night isn't done
    expect(out).toMatchObject({ applied: false, rev: 1 });
  });

  it("blocks actions while a run is in flight", async () => {
    await applyAction(db, { playerId, action: create, rev: 0 });
    await startRun(db, { playerId });
    const error = await applyAction(db, { playerId, action: { type: "set-loadout", loadout: ["yank"] }, rev: 1 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: "run_active" });
  });

  it("only accepts menu actions in the request body", () => {
    expect(actionBody.safeParse({ action: { type: "vote", side: "hero" }, rev: 3 }).success).toBe(true);
    expect(actionBody.safeParse({ action: { type: "finish-patrol" }, rev: 3 }).success).toBe(false);
    expect(actionBody.safeParse({ action: { type: "sim-fight", won: true, hp: 1, fluid: 1 }, rev: 3 }).success).toBe(false);
    expect(actionBody.safeParse({ action: { type: "pick-power", power: "laser-eyes" }, rev: 3 }).success).toBe(false);
    expect(actionBody.safeParse({ action: { type: "vote", side: "hero" }, rev: -1 }).success).toBe(false);
  });
});
