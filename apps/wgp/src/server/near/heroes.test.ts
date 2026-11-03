/**
 * Heroes on chain and the relay mirror, on an in-memory database: register_hero queued
 * for the player's session key and marked registered once the relayer sees it land;
 * craft and equip mirrored into the save; run guards; and /api/chain/status's view.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { setDb, type Db } from "@/server/db/client";
import { ensureSave, findOrCreatePlayer, writeSave } from "@/server/db/players";
import { startRun } from "@/server/db/runs";
import { chainOps, type Player } from "@/server/db/schema";
import { fakeVerifier, freshDb, givePlayerHero, heroSave, makePlayer } from "@/server/db/test-helpers";
import { HttpError } from "@/server/http";
import { setVerifier } from "@/server/verify";

import { cleanHeroName, heroOnChain, heroOpKey, markHeroRegistered, queueHeroRegistration, registerHeroArgs } from "./heroes";
import { guardGameCall, mirrorCraft, mirrorGameCall, parseCallArgs } from "./mirror";
import { addSessionKey } from "./session-keys";
import { chainStatus, toOnChainPlayer, type PlayerView } from "./status";

const T0 = new Date("2026-11-06T20:00:00Z");
const KEY = `ed25519:${"3".repeat(20)}${"A".repeat(40)}`;
const PK = `ed25519:${"4".repeat(44)}`;

/** A hero at level 2 holding 3 Sybil goo: enough to craft Stealth. */
async function readyToCraft(db: Db, playerId: string): Promise<void> {
  const { save, rev } = await ensureSave(db, playerId);
  const base = save.hero ? save : heroSave();
  const next: Save = { ...base, hero: { ...base.hero!, level: 2 }, inventory: { "sybil-goo": 3 } };
  if ((await writeSave(db, playerId, next, rev)) === null) throw new Error("write conflicted");
}

describe("register_hero arguments", () => {
  it("uses the hero's name and the starter suit being worn", () => {
    expect(registerHeroArgs(heroSave("Peter"))).toEqual({ name: "Peter", suit: "classic" });
    const midnight: Save = { ...heroSave(), suits: ["classic", "midnight"], hero: { ...heroSave().hero!, suit: "midnight" } };
    expect(registerHeroArgs(midnight)?.suit).toBe("midnight");
  });

  it("falls back to an owned starter when a crafted suit is worn", () => {
    const save: Save = { ...heroSave(), suits: ["mint", "stealth"], hero: { ...heroSave().hero!, suit: "stealth" } };
    expect(registerHeroArgs(save)?.suit).toBe("mint");
  });

  it("cleans the name to what the contract accepts", () => {
    expect(cleanHeroName("  Spider\u0000-Ham\n ")).toBe("Spider-Ham");
    expect(Array.from(cleanHeroName("🕷".repeat(30)))).toHaveLength(24);
    expect(registerHeroArgs({ ...heroSave(), hero: null })).toBeNull();
    expect(registerHeroArgs({ ...heroSave(), hero: { ...heroSave().hero!, name: "\u0007" } })).toBeNull();
  });
});

describe("hero registration mirror", () => {
  let db: Db;
  let peter: Player;

  beforeEach(async () => {
    db = await freshDb();
    peter = await makePlayer(db, "peter");
  });
  afterEach(() => setDb(undefined));

  it("queues register_hero once, for the player's key to send", async () => {
    const save = heroSave("Peter");
    const first = await queueHeroRegistration(db, peter, save, T0);
    expect(first).toEqual({ status: "queued", txHash: null, args: { name: "Peter", suit: "classic" } });
    await queueHeroRegistration(db, peter, { ...save, hero: { ...save.hero!, name: "Renamed" } }, T0);
    const rows = await db.select().from(chainOps).where(eq(chainOps.dedupeKey, heroOpKey(peter.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "register_hero", status: "pending", rewardNonce: null, payload: { accountId: peter.nearAccountId, name: "Peter", suit: "classic" } });
  });

  it("queues nothing without a hero, or for a test sign-in", async () => {
    expect((await queueHeroRegistration(db, peter, { ...heroSave(), hero: null })).status).toBe("none");
    const dev = await findOrCreatePlayer(db, { nearAccountId: "tester.dev.wgp.testnet", authKind: "dev", authSub: "dev:tester", handle: "tester" });
    expect((await queueHeroRegistration(db, dev, heroSave())).status).toBe("none");
  });

  it("marks the hero registered, with or without a queued row", async () => {
    await queueHeroRegistration(db, peter, heroSave(), T0);
    await markHeroRegistered(db, { player: peter, txHash: "tx-hero" });
    expect(await heroOnChain(db, peter.id)).toEqual({ status: "registered", txHash: "tx-hero", args: null });
    // A later mark without a hash keeps the first one.
    await markHeroRegistered(db, { player: peter, txHash: null });
    expect((await heroOnChain(db, peter.id)).txHash).toBe("tx-hero");

    const miles = await makePlayer(db, "miles");
    await markHeroRegistered(db, { player: miles, txHash: "tx-miles", args: { name: "Miles", suit: "midnight" } });
    expect(await heroOnChain(db, miles.id)).toMatchObject({ status: "registered", txHash: "tx-miles" });
  });

  it("stays out of the mint worker's way (no reward nonce)", async () => {
    await queueHeroRegistration(db, peter, heroSave(), T0);
    const { claimRewardBatch } = await import("@/server/db/outbox");
    expect(await claimRewardBatch(db, new Date(T0.getTime() + 60_000))).toEqual([]);
  });
});

describe("mirroring relayed game calls", () => {
  let db: Db;
  let peter: Player;

  beforeEach(async () => {
    db = await freshDb();
    peter = await makePlayer(db, "peter");
    await givePlayerHero(db, peter.id);
  });
  afterEach(() => {
    setVerifier(undefined);
    setDb(undefined);
  });

  const call = (method: string, args: Record<string, unknown> | null, ok = true, error?: string) =>
    mirrorGameCall(db, { player: peter, method, args, ok, txHash: "tx-1", error }, T0);

  it("parses only JSON-object args", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(parseCallArgs(enc('{"suit":"stealth"}'))).toEqual({ suit: "stealth" });
    expect(parseCallArgs(enc("[1]"))).toBeNull();
    expect(parseCallArgs(enc("nope"))).toBeNull();
  });

  it("register_hero that landed, or found a hero already there, marks the hero registered", async () => {
    await queueHeroRegistration(db, peter, heroSave(), T0);
    expect(await call("register_hero", { name: "Peter", suit: "classic" }, false, "Smart contract panicked: The game is paused")).toBeNull();
    expect((await heroOnChain(db, peter.id)).status).toBe("queued");

    await call("register_hero", { name: "Peter", suit: "classic" }, false, '{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: This account already has a hero"}}}}');
    expect(await heroOnChain(db, peter.id)).toMatchObject({ status: "registered", txHash: null });

    const miles = await makePlayer(db, "miles");
    await mirrorGameCall(db, { player: miles, method: "register_hero", args: { name: "Miles", suit: "midnight" }, ok: true, txHash: "tx-m" }, T0);
    expect(await heroOnChain(db, miles.id)).toMatchObject({ status: "registered", txHash: "tx-m" });
  });

  it("craft_suit on chain crafts in the save: the loot is used up and the suit worn", async () => {
    await readyToCraft(db, peter.id);
    const before = await ensureSave(db, peter.id);
    const out = await call("craft_suit", { suit: "stealth" });
    expect(out?.rev).toBe(before.rev + 1);
    expect(out?.save.suits).toContain("stealth");
    expect(out?.save.hero?.suit).toBe("stealth");
    expect(out?.save.inventory["sybil-goo"]).toBe(0);
    expect((await ensureSave(db, peter.id)).rev).toBe(out?.rev);
  });

  it("follows the chain when the save lacked what the chain had", () => {
    const save = heroSave();
    const out = mirrorCraft(save, "stealth");
    expect(out.suits).toEqual(["classic", "stealth"]);
    expect(out.hero?.suit).toBe("stealth");
    expect(out.inventory).toEqual(save.inventory);
  });

  it("equip_suit on chain changes the suit worn; refusals and other methods change nothing", async () => {
    await readyToCraft(db, peter.id);
    await call("craft_suit", { suit: "stealth" });
    expect((await call("equip_suit", { suit: "classic" }))?.save.hero?.suit).toBe("classic");
    const rev = (await ensureSave(db, peter.id)).rev;
    expect(await call("equip_suit", { suit: "stealth" }, false, "You don't own this suit")).toBeNull();
    expect(await call("craft_suit", { suit: "not-a-suit" })).toBeNull();
    expect(await call("market_buy", { item: "bits" })).toBeNull();
    expect((await ensureSave(db, peter.id)).rev).toBe(rev);
  });

  it("refuses craft and equip while a ranked run is in flight, but not register_hero", async () => {
    setVerifier(fakeVerifier());
    await startRun(db, { playerId: peter.id, now: T0 });
    await expect(guardGameCall(db, peter.id, "craft_suit", new Date(T0.getTime() + 1000))).rejects.toMatchObject({ status: 409, code: "run_active" });
    await expect(guardGameCall(db, peter.id, "equip_suit", new Date(T0.getTime() + 1000))).rejects.toBeInstanceOf(HttpError);
    await expect(guardGameCall(db, peter.id, "register_hero", new Date(T0.getTime() + 1000))).resolves.toBeUndefined();
  });
});

describe("chain status", () => {
  let db: Db;
  let peter: Player;
  const view = (over: Partial<NonNullable<PlayerView>> = {}): PlayerView => ({
    hero: null,
    level: 1,
    tokens: [],
    ...over,
  });

  beforeEach(async () => {
    db = await freshDb();
    peter = await makePlayer(db, "peter");
    for (const name of ["NEAR_NETWORK", "WGP_CONTRACT_ID", "RELAYER_ACCOUNT_ID", "RELAYER_PRIVATE_KEYS"]) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setDb(undefined);
  });

  const configure = () => {
    vi.stubEnv("NEAR_NETWORK", "mainnet");
    vi.stubEnv("WGP_CONTRACT_ID", "game.wgpnear.near");
    vi.stubEnv("RELAYER_ACCOUNT_ID", "relayer.wgpnear.near");
    vi.stubEnv("RELAYER_PRIVATE_KEYS", KEY);
  };

  it("maps the contract's player view", () => {
    expect(toOnChainPlayer(null)).toEqual({ hero: null, level: 0, suits: [], items: {} });
    expect(
      toOnChainPlayer(view({ hero: { name: "Peter", suit: "classic" }, level: 3, tokens: [["hero:peter.near", "1"], ["suit:classic", "1"], ["item:sybil-goo", "2"], ["trophy:badge:day-one", "1"]] })),
    ).toEqual({ hero: { name: "Peter", suit: "classic" }, level: 3, suits: ["classic"], items: { "sybil-goo": 2 } });
  });

  it("without NEAR settings: queues the hero, reads nothing from chain", async () => {
    const readPlayer = vi.fn();
    const s = await chainStatus(db, { player: peter, save: heroSave(), readPlayer, now: T0 });
    expect(s).toMatchObject({ available: true, configured: false, accountId: peter.nearAccountId, hero: { status: "queued" }, sessionKeys: [], onChain: null });
    expect(readPlayer).not.toHaveBeenCalled();
  });

  it("reports live session keys and the contract's view, and heals the hero mirror from the chain", async () => {
    configure();
    await addSessionKey(db, { playerId: peter.id, publicKey: PK });
    const readPlayer = vi.fn(async () => view({ hero: { name: "Peter", suit: "classic" }, tokens: [["suit:classic", "1"]] }));
    const s = await chainStatus(db, { player: peter, save: heroSave(), readPlayer, now: T0 });
    expect(readPlayer).toHaveBeenCalledWith(peter.nearAccountId);
    expect(s).toMatchObject({ configured: true, network: "mainnet", contractId: "game.wgpnear.near", sessionKeys: [PK], hero: { status: "registered" } });
    expect(s.onChain?.suits).toEqual(["classic"]);
  });

  it("answers onChain null when the chain can't be read", async () => {
    configure();
    const s = await chainStatus(db, { player: peter, save: heroSave(), readPlayer: async () => Promise.reject(new Error("rpc down")), now: T0 });
    expect(s).toMatchObject({ configured: true, onChain: null, hero: { status: "queued" } });
  });

  it("says a test sign-in isn't on NEAR", async () => {
    const dev = await findOrCreatePlayer(db, { nearAccountId: "t.dev.wgp.testnet", authKind: "dev", authSub: "dev:t", handle: "t" });
    configure();
    const s = await chainStatus(db, { player: dev, save: heroSave(), readPlayer: vi.fn(), now: T0 });
    expect(s).toMatchObject({ available: false, unclaimed: false, configured: false, hero: { status: "none" }, onChain: null });
  });

  it("says an unclaimed Google player isn't on NEAR yet, and queues no hero for their implicit account", async () => {
    const implicit = "ab".repeat(32);
    const gwen = await findOrCreatePlayer(db, { nearAccountId: implicit, authKind: "privy", authSub: "did:privy:gwen", handle: "hero-ababab" });
    configure();
    const readPlayer = vi.fn();
    const s = await chainStatus(db, { player: gwen, save: heroSave(), readPlayer, now: T0 });
    expect(s).toMatchObject({ available: false, unclaimed: true, hero: { status: "none" }, sessionKeys: [], onChain: null });
    expect(readPlayer).not.toHaveBeenCalled();
  });
});
