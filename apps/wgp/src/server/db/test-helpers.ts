/**
 * Shared fixtures for the server tests (vitest, in-memory PGlite). Not imported by app code.
 */
import { createHash } from "node:crypto";

import { newSave, reduce } from "@wgp/game-core/engine";
import type { ItemId, Save } from "@wgp/game-core/types";
import type { ReplayInput, ReplayResult } from "@wgp/game-core/sim3d/contract";

import type { Verifier } from "@/server/verify";

import { createTestDb, setDb, type Db } from "./client";
import { findOrCreatePlayer, writeSave, ensureSave } from "./players";
import type { Player } from "./schema";

/** A migrated in-memory database, also installed as getDb()'s answer. */
export async function freshDb(): Promise<Db> {
  const db = await createTestDb();
  setDb(db);
  return db;
}

export function makePlayer(db: Db, handle: string): Promise<Player> {
  return findOrCreatePlayer(db, { nearAccountId: `${handle}.wgp.testnet`, authKind: "near_auth", authSub: `sub:${handle}`, handle });
}

export function heroSave(name = "Peter"): Save {
  return reduce(newSave(), { type: "create-hero", name, suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
}

/** Gives the player a fresh hero (rev 0 → 1). */
export async function givePlayerHero(db: Db, playerId: string, name = "Peter"): Promise<number> {
  const { rev } = await ensureSave(db, playerId);
  const next = await writeSave(db, playerId, heroSave(name), rev);
  if (next === null) throw new Error("hero write conflicted");
  return next;
}

export const logHash = (log: Uint8Array) => createHash("sha256").update(log).digest("hex");

export interface FakeRun {
  score?: number;
  /** Game ticks at 60 Hz. Default 3 minutes. */
  ticks?: number;
  loot?: Partial<Record<ItemId, number>>;
  ok?: boolean;
  reason?: string;
  hash?: (log: Uint8Array) => string;
  stats?: Record<string, number>;
}

/**
 * A stand-in for game-core's replayRun: finishes the started patrol, adds `loot` and
 * answers a hash of the log, so the client hash is `logHash(log)`.
 */
export function fakeVerifier(run: FakeRun | ((input: ReplayInput) => FakeRun) = {}, ruleset = "test-1"): Verifier & { calls: ReplayInput[] } {
  const calls: ReplayInput[] = [];
  return {
    ruleset,
    tickHz: 60,
    calls,
    replay(input): ReplayResult {
      calls.push(input);
      const r = typeof run === "function" ? run(input) : run;
      const start = input.save as Save;
      const inventory = { ...start.inventory };
      for (const [item, n] of Object.entries(r.loot ?? { "fee-bomb": 1 }) as [ItemId, number][]) inventory[item] = (inventory[item] ?? 0) + n;
      const save: Save = { ...start, patrol: null, nightDone: true, inventory, stats: { ...start.stats, nights: start.stats.nights + 1 } };
      return {
        ok: r.ok ?? true,
        reason: r.reason,
        save,
        score: r.score ?? 5000,
        ticks: r.ticks ?? 60 * 180,
        stats: r.stats ?? { fights: 2, errands: 2 },
        checkpoints: ["c0", "c1"],
        hash: (r.hash ?? logHash)(input.log),
      };
    },
  };
}

export const bytes = (...values: number[]) => new Uint8Array(values);
