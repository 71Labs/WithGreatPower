/**
 * The balance the faucet's taper reads when a verified night is paid (./held.ts): the
 * contract's `bits_of` plus mints still on their way, the simulated wallet where there is no
 * contract, and null (pay the whole night) when the read fails or is slow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDb, type Db } from "../db/client";
import { chainOps } from "../db/schema";
import { freshDb, makePlayer } from "../db/test-helpers";
import { NearConfigError } from "../near/env";
import type { ChainReader } from "./chain";
import { heldBits } from "./held";

const reader = (view: ChainReader["view"]): (() => ChainReader) => () => ({ contractId: "game.wgp.testnet", network: "testnet", view });

describe("heldBits", () => {
  let db: Db;
  let player: { playerId: string; accountId: string };

  beforeEach(async () => {
    db = await freshDb();
    const p = await makePlayer(db, "peter");
    player = { playerId: p.id, accountId: p.nearAccountId };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setDb(undefined);
    vi.restoreAllMocks();
  });

  async function queueMint(status: "pending" | "sent", bits: number, key: string) {
    await db.insert(chainOps).values({
      kind: "mint_reward",
      dedupeKey: key,
      playerId: player.playerId,
      status,
      payload: { accountId: player.accountId, items: [{ tokenId: "item:bits", amount: bits }], digest: "d" },
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("reads bits_of on chain and adds the Bits in mints that haven't landed yet", async () => {
    await queueMint("pending", 40, "mint_reward:a");
    await queueMint("sent", 900, "mint_reward:b"); // already in bits_of
    const calls: [string, unknown][] = [];
    const bits = await heldBits(db, player, {
      reader: reader(async (method, args) => {
        calls.push([method, args]);
        return "310";
      }),
    });
    expect(calls).toEqual([["bits_of", { account_id: player.accountId }]]);
    expect(bits).toBe(350);
  });

  it("reads the simulated wallet when NEAR isn't configured", async () => {
    await queueMint("sent", 120, "mint_reward:a");
    const bits = await heldBits(db, player, {
      reader: () => {
        throw new NearConfigError(["NEAR_NETWORK"]);
      },
    });
    expect(bits).toBe(120);
  });

  it("answers null, so the whole night is paid, when the chain read fails, answers nonsense or is slow", async () => {
    expect(await heldBits(db, player, { reader: reader(async () => Promise.reject(new Error("RPC down"))) })).toBeNull();
    expect(await heldBits(db, player, { reader: reader(async () => ({ not: "a number" })) })).toBeNull();
    const slow = reader(() => new Promise((resolve) => setTimeout(() => resolve("10"), 200)));
    expect(await heldBits(db, player, { reader: slow, timeoutMs: 20 })).toBeNull();
    expect(
      await heldBits(db, player, {
        reader: () => {
          throw new Error("something else");
        },
      }),
    ).toBeNull();
  });
});
