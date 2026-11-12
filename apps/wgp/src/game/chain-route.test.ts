/**
 * Craft and equip routing, two ways: the pure rules (chain-route.ts), and the store end to
 * end with a fake API and a fake session key: on chain with quick play on (registering
 * the hero first), saved only without it, reverted when the contract refuses, and saved
 * only when the relayer can't take it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newSave, reduce, type Action } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import type { ChainStatus, Me } from "@/lib/api/client";
import type { QuickPlay } from "@/lib/near/quick-play";

import { classifyRelay, refusalText, routeAction } from "./chain-route";

const ON: QuickPlay = { state: "on", publicKey: "ed25519:K" };
const craft: Action = { type: "craft-suit", suit: "stealth" };
const equip: Action = { type: "equip-suit", suit: "stealth" };

describe("routing rules", () => {
  it("sends craft and equip on chain only with quick play on", () => {
    expect(routeAction(craft, { quickPlay: ON, onChainSuits: ["classic"] })).toBe("chain");
    expect(routeAction(equip, { quickPlay: ON, onChainSuits: ["classic", "stealth"] })).toBe("chain");
    for (const quickPlay of [{ state: "off" }, { state: "pending", publicKey: null }, { state: "unavailable", reason: "not-configured" }] as QuickPlay[]) {
      expect(routeAction(craft, { quickPlay, onChainSuits: null })).toBe("db");
    }
    expect(routeAction({ type: "sleep" }, { quickPlay: ON, onChainSuits: null })).toBe("db");
  });

  it("wears a suit that only the save holds through the save", () => {
    expect(routeAction(equip, { quickPlay: ON, onChainSuits: ["classic"] })).toBe("db");
    // Unknown chain state: try the chain.
    expect(routeAction(equip, { quickPlay: ON, onChainSuits: null })).toBe("chain");
  });

  it("reads the relayer's answers", () => {
    expect(classifyRelay({ ok: true, status: 200, txHash: "tx", save: newSave(), rev: 4 })).toMatchObject({ kind: "ok", txHash: "tx", rev: 4 });
    expect(classifyRelay({ ok: true, status: 200, txHash: "tx" })).toMatchObject({ kind: "ok", save: null, rev: null });
    expect(classifyRelay({ ok: false, status: 422, error: "call_failed", message: "Smart contract panicked: Needs sybil-goo x1" })).toMatchObject({ kind: "refused" });
    expect(classifyRelay({ ok: false, status: 409, error: "run_active" })).toMatchObject({ kind: "busy", code: "run_active" });
    expect(classifyRelay({ ok: false, status: 429, error: "rate_limited" })).toMatchObject({ kind: "busy" });
    expect(classifyRelay({ ok: false, status: 401, error: "unauthorized" })).toEqual({ kind: "signed-out" });
    expect(classifyRelay({ ok: false, status: 503, error: "near_not_configured" })).toMatchObject({ kind: "unavailable", keyGone: false });
    expect(classifyRelay({ ok: false, status: 403, error: "revoked_key" })).toMatchObject({ kind: "unavailable", keyGone: true });
    expect(classifyRelay({ thrown: "This session key isn't on the account yet" })).toMatchObject({ kind: "unavailable", keyGone: true });
    expect(classifyRelay({ thrown: "Failed to fetch" })).toMatchObject({ kind: "unavailable", keyGone: false });
  });

  it("says why the contract refused", () => {
    expect(refusalText("Smart contract panicked: Needs sybil-goo x2")).toMatch(/enough loot/);
    expect(refusalText("Smart contract panicked: Reach level 3 to craft this suit")).toMatch(/below level 3/);
    // The market's craft_bits: the Bits are named, with how many are missing.
    expect(refusalText("Smart contract panicked: Needs bits x130")).toBe("You’re 130 Bits short of what crafting burns, so nothing was spent. Sell spare loot to Gwei or finish a ranked night.");
    expect(refusalText("Needs bits x130")).not.toMatch(/loot for that yet/);
    expect(refusalText("Smart contract panicked: Needs sybil-goo x1, bits x130")).toMatch(/enough loot.*130 Bits short/);
    // The relayer's own check answers 422 craft_bits_short in the contract's words, before any gas.
    expect(classifyRelay({ ok: false, status: 422, error: "craft_bits_short", message: "Needs bits x1" })).toMatchObject({ kind: "refused", text: expect.stringContaining("1 Bit short") });
    expect(refusalText("Smart contract panicked: The game is paused")).toMatch(/paused/);
    expect(refusalText("something else")).toMatch(/nothing was spent/);
  });
});

/* ------------------------------------------------------------------ the store, end to end */

type Store = typeof import("./store");
type Reply = { status: number; body: unknown } | "network";

const ACCOUNT = "peter.near";
const PK = "ed25519:SessionKeyPublic";

/** A level-2 hero with the goo for Stealth. */
function readySave(): Save {
  const s = reduce(newSave(), { type: "create-hero", name: "Peter", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
  return { ...s, hero: { ...s.hero!, level: 2 }, inventory: { "sybil-goo": 3 } };
}

function me(save: Save, rev = 1): Me {
  return {
    signedIn: true,
    player: { id: "p1", handle: "peter", nearAccountId: ACCOUNT, authKind: "wallet", createdAt: "2026-11-02T00:00:00Z", banned: false, migrated: true },
    save,
    rev,
    activeRun: null,
    runsToday: { used: 0, limit: 20 },
  };
}

function status(over: Partial<ChainStatus> = {}): ChainStatus {
  return {
    available: true,
    unclaimed: false,
    configured: true,
    network: "mainnet",
    contractId: "game.wgpnear.near",
    accountId: ACCOUNT,
    hero: { status: "registered", txHash: "tx-hero", args: null },
    sessionKeys: [PK],
    onChain: { hero: { name: "Peter", suit: "classic" }, level: 2, suits: ["classic"], items: { "sybil-goo": 3 } },
    ...over,
  };
}

let routes: Record<string, (body: unknown) => Reply>;
let calls: { method: string; path: string; body: unknown }[];
let relayed: { method: string; args: Record<string, unknown> }[];
let relay: (method: string, args: Record<string, unknown>) => Record<string, unknown>;
let localKey: { publicKey: string; accountId: string | null } | null;
let store: Store;
let chain: typeof import("./chain");

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
};
const posted = () => calls.filter((c) => c.path === "/api/actions");

beforeEach(async () => {
  calls = [];
  relayed = [];
  localKey = { publicKey: PK, accountId: ACCOUNT };
  routes = { "GET /api/me": () => ({ status: 200, body: { signedIn: false } }) };
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const reply = routes[`${method} ${path}`]?.(body) ?? { status: 404, body: { error: "not_found" } };
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  });
  vi.resetModules();
  vi.doMock("@/lib/near/session-key", () => ({
    loadSessionKey: async () => localKey,
    callGame: async (method: string, args: Record<string, unknown>) => {
      relayed.push({ method, args });
      return relay(method, args);
    },
  }));
  store = await import("./store");
  chain = await import("./chain");
});

afterEach(() => {
  vi.doUnmock("@/lib/near/session-key");
  vi.unstubAllGlobals();
});

async function signIn(save: Save, chainStatus: ChainStatus) {
  routes["GET /api/me"] = () => ({ status: 200, body: me(save) });
  routes["GET /api/chain/status"] = () => ({ status: 200, body: chainStatus });
  await store.refreshAccount();
}

describe("the store routes suit changes", () => {
  it("crafts on chain with quick play on, and adopts the save the server mirrored", async () => {
    const save = readySave();
    await signIn(save, status());
    const mirrored = reduce(save, craft);
    relay = () => ({ ok: true, status: 200, txHash: "tx-craft", save: mirrored, rev: 2 });

    store.dispatch(craft);
    expect(store.getSave()?.hero?.suit).toBe("stealth"); // optimistic
    await settle();

    expect(relayed).toEqual([{ method: "craft_suit", args: { suit: "stealth" } }]);
    expect(posted()).toHaveLength(0);
    expect(store.getAccount().me?.rev).toBe(2);
    expect(store.getSave()).toEqual(mirrored);
    expect(chain.getChain().quickPlay.state).toBe("on");
    expect(chain.getActivity()).toMatchObject({ state: "on-chain", txHash: "tx-craft", action: craft });
  });

  it("registers a queued hero before its first craft", async () => {
    const save = readySave();
    await signIn(save, status({ hero: { status: "queued", txHash: null, args: { name: "Peter", suit: "classic" } } }));
    relay = (method) => (method === "register_hero" ? { ok: true, status: 200, txHash: "tx-hero" } : { ok: true, status: 200, txHash: "tx-craft", save: reduce(save, craft), rev: 2 });

    store.dispatch(craft);
    await settle();
    expect(relayed.map((r) => r.method)).toEqual(["register_hero", "craft_suit"]);
    expect(relayed[0]!.args).toEqual({ name: "Peter", suit: "classic" });
  });

  it("saves only, not on chain, without quick play", async () => {
    localKey = null;
    const save = readySave();
    await signIn(save, status({ sessionKeys: [] }));
    routes["POST /api/actions"] = () => ({ status: 200, body: { applied: true, save: reduce(save, craft), rev: 2 } });

    store.dispatch(craft);
    await settle();
    expect(relayed).toHaveLength(0);
    expect(posted()[0]!.body).toMatchObject({ action: craft, rev: 1 });
    expect(chain.getChain().quickPlay.state).toBe("off");
    expect(chain.getActivity()).toMatchObject({ state: "saved", reason: "quick-play-off" });
  });

  it("wears a suit only the save holds through the save, even with quick play on", async () => {
    const owned = { ...readySave(), suits: ["classic" as const, "stealth" as const] };
    await signIn(owned, status());
    routes["POST /api/actions"] = () => ({ status: 200, body: { applied: true, save: reduce(owned, equip), rev: 2 } });
    store.dispatch(equip);
    await settle();
    expect(relayed).toHaveLength(0);
    expect(posted()).toHaveLength(1);
    expect(chain.getActivity()).toMatchObject({ state: "saved", reason: "suit-off-chain" });
  });

  it("reverts and says why when the contract refuses", async () => {
    const save = readySave();
    await signIn(save, status());
    relay = () => ({ ok: false, status: 422, error: "call_failed", message: "Smart contract panicked: Needs sybil-goo x3" });

    store.dispatch(craft);
    await settle();
    expect(posted()).toHaveLength(0);
    expect(store.getSave()).toEqual(save);
    expect(store.getToast()).toMatchObject({ tone: "error", text: expect.stringMatching(/enough loot/) });
    expect(chain.getActivity()).toMatchObject({ state: "failed" });
  });

  it("saves a suit change the chain can't make because the suit only lives in the save", async () => {
    const owned = { ...readySave(), suits: ["classic" as const, "stealth" as const] };
    // The chain's suits couldn't be read, so the equip is tried on chain first.
    await signIn(owned, status({ onChain: null }));
    relay = () => ({ ok: false, status: 422, error: "call_failed", message: "Smart contract panicked: You don't own this suit" });
    routes["POST /api/actions"] = () => ({ status: 200, body: { applied: true, save: reduce(owned, equip), rev: 2 } });
    store.dispatch(equip);
    await settle();
    expect(relayed).toHaveLength(1);
    expect(posted()).toHaveLength(1);
    expect(store.getSave()?.hero?.suit).toBe("stealth");
    expect(store.getToast()).toBeNull();
    expect(chain.getActivity()).toMatchObject({ state: "saved", reason: "suit-off-chain" });
  });

  it("falls back to saving only when the relayer can't take it", async () => {
    const save = readySave();
    await signIn(save, status());
    relay = () => ({ ok: false, status: 503, error: "relayer_empty", message: "The relayer is out of funds" });
    routes["POST /api/actions"] = () => ({ status: 200, body: { applied: true, save: reduce(save, craft), rev: 2 } });

    store.dispatch(craft);
    await settle();
    expect(relayed).toHaveLength(1);
    expect(posted()).toHaveLength(1);
    expect(store.getSave()?.hero?.suit).toBe("stealth");
    expect(store.getAccount().me?.rev).toBe(2);
    expect(chain.getActivity()).toMatchObject({ state: "saved", reason: "relayer" });
  });
});
