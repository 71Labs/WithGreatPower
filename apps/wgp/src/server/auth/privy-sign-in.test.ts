/**
 * Google sign-in through Privy on an in-memory database, with the factory faked: who a
 * verified login is (known, linked by email, new), the handle step, the no-factory
 * fallback onto the implicit account (rewards held), and claiming a name later.
 */
import { asc, eq } from "drizzle-orm";
import { KeyPair, keyToImplicitAddress } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isUnclaimed } from "@/lib/near/policy";

import { setDb, type Db } from "../db/client";
import { claimRewardBatch, enqueueRewardMint, rewardFromOp } from "../db/outbox";
import { findOrCreatePlayer, findPlayerForLogin, getPlayer } from "../db/players";
import { chainOps, marketSim, players, sessionKeys } from "../db/schema";
import { freshDb } from "../db/test-helpers";
import { HttpError } from "../http";
import { readSim, renameSimAccount, seedSim, SIM_ID, type SimState } from "../market/sim";
import { HandleError, type AccountKeys } from "../near/factory";
import type { PrivyIdentity } from "./privy";
import { claimInfo, claimName, privySignIn, unclaimedHandle, type AccountFactory } from "./privy-sign-in";

const PARENT = "wgpnear.near";
const NOW = new Date("2026-11-08T12:00:00Z");

const newKey = () => KeyPair.fromRandom("ed25519").getPublicKey().toString();

function identity(n: number, over: Partial<PrivyIdentity> = {}): PrivyIdentity {
  const publicKey = newKey();
  return { userId: `did:privy:user${n}`, email: `hero${n}@example.com`, near: { publicKey, implicitAccountId: keyToImplicitAddress(publicKey) }, ...over };
}

/** The account factory, faked: records what it would create; `existing` are accounts already on chain. */
function factory(existing: Record<string, AccountKeys> = {}) {
  const created: { handle: string; userPublicKey: string; sessionPublicKey: string }[] = [];
  const f: AccountFactory = {
    parentId: PARENT,
    inspect: async (accountId) => existing[accountId] ?? null,
    create: async (input) => {
      created.push(input);
      return { accountId: `${input.handle}.${PARENT}`, txHash: `tx-${input.handle}` };
    },
  };
  return { created, open: async () => f };
}
const closed = async () => null;

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(() => setDb(undefined));

const allPlayers = () => db.select().from(players).orderBy(asc(players.createdAt));

describe("a new player while the factory is live", () => {
  it("asks for a handle first, suggesting one from the email and naming the parent", async () => {
    const out = await privySignIn(db, { identity: identity(1), sessionPublicKey: newKey() }, { factory: factory().open });
    expect(out).toEqual({ kind: "needs-handle", suggestedHandle: "hero1", parentId: PARENT });
    expect(await allPlayers()).toHaveLength(0);
  });

  it("then creates <handle>.<parent> with the Privy NEAR key (full access) and the session key", async () => {
    const id = identity(2);
    const session = newKey();
    const f = factory();
    const out = await privySignIn(db, { identity: id, handle: "Spidey", sessionPublicKey: session }, { factory: f.open });
    expect(f.created).toEqual([{ handle: "spidey", userPublicKey: id.near!.publicKey, sessionPublicKey: session }]);
    if (out.kind !== "signed-in") throw new Error(out.kind);
    expect(out).toMatchObject({ created: true, txHash: "tx-spidey", sessionKeyLive: true, linked: false });
    expect(out.player).toMatchObject({ nearAccountId: `spidey.${PARENT}`, authKind: "privy", authSub: id.userId, handle: "spidey", email: "hero2@example.com" });
    const keys = await db.select().from(sessionKeys).where(eq(sessionKeys.playerId, out.player.id));
    expect(keys.map((k) => [k.publicKey, k.addTx])).toEqual([[session, "tx-spidey"]]);
  });

  it("refuses a handle someone else holds, and adopts one that already holds this user's key", async () => {
    const id = identity(3);
    const f = factory({ [`taken.${PARENT}`]: { userKey: false, sessionKey: false }, [`mine.${PARENT}`]: { userKey: true, sessionKey: false } });
    await expect(privySignIn(db, { identity: id, handle: "taken", sessionPublicKey: newKey() }, { factory: f.open })).rejects.toBeInstanceOf(HandleError);
    const out = await privySignIn(db, { identity: id, handle: "mine", sessionPublicKey: newKey() }, { factory: f.open });
    expect(f.created).toEqual([]);
    expect(out).toMatchObject({ kind: "signed-in", created: true, txHash: null, sessionKeyLive: false });
  });

  it("needs the Privy NEAR wallet, which is the key the account will hold", async () => {
    await expect(privySignIn(db, { identity: identity(4, { near: null }), handle: "nokey", sessionPublicKey: newKey() }, { factory: factory().open })).rejects.toMatchObject({
      code: "near_wallet_missing",
    });
  });
});

describe("returning players and linking", () => {
  it("signs a known player in by their Privy id and says whether this browser's key is live", async () => {
    const id = identity(5);
    const session = newKey();
    const first = await privySignIn(db, { identity: id, handle: "peter", sessionPublicKey: session }, { factory: factory().open });
    let asked = 0;
    const again = await privySignIn(
      db,
      { identity: id, sessionPublicKey: session },
      {
        factory: async () => {
          asked++;
          return null;
        },
      },
    );
    expect(again).toMatchObject({ kind: "signed-in", created: false, sessionKeyLive: true, linked: false });
    if (again.kind === "signed-in" && first.kind === "signed-in") expect(again.player.id).toBe(first.player.id);
    // A returning player never costs a factory lookup (an RPC call).
    expect(asked).toBe(0);
    const other = await privySignIn(db, { identity: id, sessionPublicKey: newKey() }, { factory: closed });
    expect(other).toMatchObject({ sessionKeyLive: false });
  });

  it("finds a NEAR Auth player by verified email instead of making a second hero", async () => {
    const nearAuth = await findOrCreatePlayer(db, { nearAccountId: `mj.${PARENT}`, authKind: "near_auth", authSub: "google-oauth2|99", handle: "mj", email: "mj@example.com" });
    const out = await privySignIn(db, { identity: identity(6, { email: "mj@example.com" }), handle: "ignored", sessionPublicKey: newKey() }, { factory: factory().open });
    expect(out).toMatchObject({ kind: "signed-in", created: false, linked: true });
    if (out.kind === "signed-in") expect(out.player.id).toBe(nearAuth.id);
    expect(await allPlayers()).toHaveLength(1);
  });

  it("never hands a player to another login of the same service that only shares the email", async () => {
    // A different Google account with the same address (a recycled mailbox, a re-registered domain).
    const first = await privySignIn(db, { identity: identity(11, { email: "ex@startup.example" }) }, { factory: closed });
    const second = await privySignIn(db, { identity: identity(12, { email: "ex@startup.example" }) }, { factory: closed });
    if (first.kind !== "signed-in" || second.kind !== "signed-in") throw new Error("not signed in");
    expect(second).toMatchObject({ created: true, linked: false });
    expect(second.player.id).not.toBe(first.player.id);

    const nearAuth = await findOrCreatePlayer(db, { nearAccountId: `ex.${PARENT}`, authKind: "near_auth", authSub: "google-oauth2|ex1", handle: "ex", email: "ex2@startup.example" });
    expect(await findPlayerForLogin(db, { authSub: "google-oauth2|ex2", authKind: "near_auth", email: "ex2@startup.example" })).toBeNull();
    expect(await findPlayerForLogin(db, { authSub: "google-oauth2|ex1", authKind: "near_auth", email: "ex2@startup.example" })).toEqual({
      player: expect.objectContaining({ id: nearAuth.id }),
      linked: false,
    });
  });

  it("lets NEAR Auth find a Privy player the same way, by verified email", async () => {
    const out = await privySignIn(db, { identity: identity(7, { email: "gwen@example.com" }) }, { factory: closed });
    if (out.kind !== "signed-in") throw new Error(out.kind);
    // What POST /api/auth/near-auth does with a Google sub it has never seen.
    const found = await findPlayerForLogin(db, { authSub: "google-oauth2|gwen", authKind: "near_auth", email: "gwen@example.com" });
    expect(found).toEqual({ player: expect.objectContaining({ id: out.player.id }), linked: true });
    expect(await findPlayerForLogin(db, { authSub: "google-oauth2|gwen", authKind: "near_auth", email: null })).toBeNull();
    expect(await findPlayerForLogin(db, { authSub: "google-oauth2|gwen", authKind: "near_auth", email: "other@example.com" })).toBeNull();
  });

  it("records the email on a known player who had none, and refuses banned players", async () => {
    const id = identity(8);
    const p = await findOrCreatePlayer(db, { nearAccountId: id.near!.implicitAccountId, authKind: "privy", authSub: id.userId, handle: "old" });
    expect(p.email).toBeNull();
    await privySignIn(db, { identity: id }, { factory: closed });
    expect((await getPlayer(db, p.id))?.email).toBe("hero8@example.com");
    await db.update(players).set({ bannedAt: NOW }).where(eq(players.id, p.id));
    await expect(privySignIn(db, { identity: id }, { factory: closed })).rejects.toMatchObject({ status: 403, code: "banned" });
  });
});

describe("before the factory is live", () => {
  it("signs a new player straight in on their key's implicit account, no handle step", async () => {
    const id = identity(9);
    const out = await privySignIn(db, { identity: id, sessionPublicKey: newKey() }, { factory: closed });
    if (out.kind !== "signed-in") throw new Error(out.kind);
    expect(out).toMatchObject({ created: true, txHash: null, sessionKeyLive: false });
    expect(out.player).toMatchObject({ nearAccountId: id.near!.implicitAccountId, authKind: "privy", handle: unclaimedHandle(id.near!.implicitAccountId) });
    expect(isUnclaimed(out.player)).toBe(true);
    expect(claimInfo(out.player, null)).toEqual({ unclaimed: true, open: false, parentId: null, suggestedHandle: "hero9" });
    expect(claimInfo(out.player, { parentId: PARENT })).toMatchObject({ unclaimed: true, open: true, parentId: PARENT });
  });

  it("holds an unclaimed player's reward mints (their account isn't on NEAR) and sends everyone else's", async () => {
    const out = await privySignIn(db, { identity: identity(10) }, { factory: closed });
    if (out.kind !== "signed-in") throw new Error(out.kind);
    const named = await findOrCreatePlayer(db, { nearAccountId: `ned.${PARENT}`, authKind: "near_auth", authSub: "google-oauth2|ned", handle: "ned" });
    for (const p of [out.player, named]) {
      await db.transaction((tx) =>
        enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: `mint_reward:${p.id}`, playerId: p.id, payload: { accountId: p.nearAccountId, items: [{ tokenId: "item:bits", amount: 9 }], digest: "0".repeat(64) } }, NOW),
      );
    }
    const batch = await claimRewardBatch(db, NOW);
    expect(batch.map((op) => op.playerId)).toEqual([named.id]);
  });
});

describe("claiming a name", () => {
  async function unclaimedPlayer(n: number) {
    const id = identity(n);
    const out = await privySignIn(db, { identity: id }, { factory: closed });
    if (out.kind !== "signed-in") throw new Error(out.kind);
    return { id, player: out.player };
  }

  it("moves the player, their held rewards and their market wallet onto <handle>.<parent>", async () => {
    const { id, player } = await unclaimedPlayer(11);
    const implicit = player.nearAccountId;
    for (const n of [1, 2]) {
      await db.transaction((tx) =>
        enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: `mint_reward:night-${n}`, playerId: player.id, payload: { accountId: implicit, items: [{ tokenId: "item:bits", amount: 10 * n }], digest: "0".repeat(64) } }, NOW),
      );
    }
    const sim: SimState = { ...seedSim(), wallets: { [implicit]: 7 } };
    await db.insert(marketSim).values({ id: SIM_ID, state: sim, rev: 0 });
    const session = newKey();
    const f = factory();

    const claimed = await claimName(db, { player, identity: id, handle: "Miles", sessionPublicKey: session, now: NOW }, { factory: f.open });
    const account = `miles.${PARENT}`;
    expect(f.created).toEqual([{ handle: "miles", userPublicKey: id.near!.publicKey, sessionPublicKey: session }]);
    expect(claimed).toMatchObject({ accountId: account, txHash: "tx-miles", sessionKeyLive: true });
    expect(claimed.player).toMatchObject({ id: player.id, nearAccountId: account, handle: "miles" });
    expect(isUnclaimed(claimed.player)).toBe(false);

    // The held mints now go out to the new account, with nonces 1 and 2: what a fresh account expects.
    const batch = await claimRewardBatch(db, NOW);
    expect(batch.map((op) => rewardFromOp(op)).map((r) => [r.accountId, r.nonce])).toEqual([
      [account, 1],
      [account, 2],
    ]);
    expect((await readSim(db)).wallets).toEqual({ [account]: 7 });
    expect((await db.select().from(sessionKeys).where(eq(sessionKeys.playerId, player.id))).map((k) => k.publicKey)).toEqual([session]);
    expect(claimInfo(claimed.player, { parentId: PARENT })).toMatchObject({ unclaimed: false });
  });

  it("waits while the factory isn't live, and refuses a second claim or a mismatched wallet", async () => {
    const { id, player } = await unclaimedPlayer(12);
    const err = await claimName(db, { player, identity: id, handle: "early", sessionPublicKey: newKey() }, { factory: closed }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 503, code: "names_closed" });

    const otherKey = identity(12);
    await expect(claimName(db, { player, identity: { ...id, near: otherKey.near }, handle: "thief", sessionPublicKey: newKey() }, { factory: factory().open })).rejects.toMatchObject({
      code: "wallet_mismatch",
    });

    const done = await claimName(db, { player, identity: id, handle: "ok", sessionPublicKey: newKey() }, { factory: factory().open });
    await expect(claimName(db, { player: done.player, identity: id, handle: "again", sessionPublicKey: newKey() }, { factory: factory().open })).rejects.toMatchObject({
      code: "already_claimed",
    });
  });

  it("sends a reward earned while the claim went through to the new account", async () => {
    const { id, player } = await unclaimedPlayer(15);
    // A run submitted with the player read before the claim still names the implicit account.
    const stale = player.nearAccountId;
    await claimName(db, { player, identity: id, handle: "racer", sessionPublicKey: newKey() }, { factory: factory().open });
    await db.transaction((tx) =>
      enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: "mint_reward:late", playerId: player.id, payload: { accountId: stale, items: [{ tokenId: "item:bits", amount: 5 }], digest: "0".repeat(64) } }, NOW),
    );
    const [op] = await claimRewardBatch(db, NOW);
    expect(rewardFromOp(op!).accountId).toBe(`racer.${PARENT}`);
  });

  it("leaves outbox rows already sent to chain as they were", async () => {
    const { id, player } = await unclaimedPlayer(14);
    await db.insert(chainOps).values({ kind: "note", dedupeKey: "sent-row", playerId: player.id, payload: { accountId: player.nearAccountId }, status: "sent" });
    await claimName(db, { player, identity: id, handle: "sentrow", sessionPublicKey: newKey() }, { factory: factory().open });
    const [row] = await db.select().from(chainOps).where(eq(chainOps.dedupeKey, "sent-row"));
    expect((row!.payload as { accountId: string }).accountId).toBe(player.nearAccountId);
  });

  it("keeps the handle field's errors for bad or taken handles, before anything is sent", async () => {
    const { id, player } = await unclaimedPlayer(13);
    const f = factory({ [`taken.${PARENT}`]: { userKey: false, sessionKey: false } });
    await expect(claimName(db, { player, identity: id, handle: "x", sessionPublicKey: newKey() }, { factory: f.open })).rejects.toMatchObject({ code: "invalid_handle" });
    await expect(claimName(db, { player, identity: id, handle: "admin", sessionPublicKey: newKey() }, { factory: f.open })).rejects.toMatchObject({ code: "reserved_handle" });
    await expect(claimName(db, { player, identity: id, handle: "taken", sessionPublicKey: newKey() }, { factory: f.open })).rejects.toMatchObject({ code: "handle_taken" });
    expect(f.created).toEqual([]);
    expect((await getPlayer(db, player.id))?.nearAccountId).toBe(player.nearAccountId);
  });
});

describe("renameSimAccount", () => {
  it("moves Bits, today's counters and open listings, and leaves others alone", () => {
    const base = seedSim();
    const state: SimState = {
      wallets: { a: 5, b: 1 },
      book: {
        ...base.book,
        accounts: { a: { day: 1, trades: 2, listings: 1, fills: 0, fillBits: 0, open: [3] } },
        listings: [
          { id: 3, seller: "a", item: "crumbs", amount: 1, price: 10, listedAtMs: 0 },
          { id: 4, seller: "b", item: "crumbs", amount: 1, price: 10, listedAtMs: 0 },
        ],
      },
    };
    const next = renameSimAccount(state, "a", "c");
    expect(next.wallets).toEqual({ b: 1, c: 5 });
    expect(next.book.accounts).toEqual({ c: { day: 1, trades: 2, listings: 1, fills: 0, fillBits: 0, open: [3] } });
    expect(next.book.listings.map((l) => l.seller)).toEqual(["c", "b"]);
    expect(state.wallets).toEqual({ a: 5, b: 1 });
    expect(renameSimAccount(state, "a", "a")).toBe(state);
  });
});
