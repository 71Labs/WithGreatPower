import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newSave, reduce } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import type { Me } from "@/lib/api/client";

/**
 * The store against a fake browser (localStorage, events) and a fake API. Each test loads
 * a fresh copy of the module, since its state is module-level like in the app.
 */

type Store = typeof import("./store");
type Reply = { status: number; body: unknown } | "network";

const created = (name = "Peter", base: Save = newSave()) =>
  reduce(base, { type: "create-hero", name, suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });

function me(over: Partial<Me> = {}, player: Partial<Me["player"]> = {}): Me {
  return {
    signedIn: true,
    player: { id: "p1", handle: "peter", nearAccountId: "peter.wgp.testnet", authKind: "dev", createdAt: "2026-11-02T00:00:00Z", banned: false, migrated: false, ...player },
    save: newSave(),
    rev: 0,
    activeRun: null,
    runsToday: { used: 0, limit: 20 },
    ...over,
  };
}

let storage: Map<string, string>;
let routes: Record<string, (body: unknown) => Reply>;
let calls: { method: string; path: string; body: unknown }[];
let store: Store;

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(async () => {
  storage = new Map();
  calls = [];
  routes = { "GET /api/me": () => ({ status: 200, body: { signedIn: false } }) };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const reply = routes[`${method} ${path}`]?.(body) ?? { status: 404, body: { error: "not_found" } };
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  });
  vi.resetModules();
  store = await import("./store");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function signIn(m: Me) {
  routes["GET /api/me"] = () => ({ status: 200, body: m });
  return store.refreshAccount();
}

const posted = () => calls.filter((c) => c.path === "/api/actions");

describe("guests", () => {
  it("is loading until /api/me answers, then plays the local save", async () => {
    expect(store.getSave()).toBeNull();
    store.dispatch({ type: "sleep" }); // ignored while we don't know who's playing
    await store.refreshAccount();
    store.dispatch({ type: "create-hero", name: "Gwen", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
    expect(store.getSave()?.hero?.name).toBe("Gwen");
    expect(JSON.parse(storage.get("wgp:save:v1")!).hero.name).toBe("Gwen");
    expect(posted()).toHaveLength(0);
  });
});

describe("signed in", () => {
  it("shows a menu action at once, posts it on the current rev and takes the server's answer", async () => {
    storage.set("wgp:save:v1", JSON.stringify(created("Local Larry")));
    await signIn(me({}, { migrated: true }));
    const serverSave = created("Peter");
    routes["POST /api/actions"] = () => ({ status: 200, body: { applied: true, save: serverSave, rev: 1 } });

    store.dispatch({ type: "create-hero", name: "Peter", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
    expect(store.getSave()?.hero?.name).toBe("Peter"); // optimistic
    await flush();
    expect(posted()[0]!.body).toMatchObject({ action: { type: "create-hero", name: "Peter" }, rev: 0 });
    expect(store.getAccount().me?.rev).toBe(1);
    expect(store.getSave()).toEqual(serverSave);
    // The guest's own save is untouched.
    expect(JSON.parse(storage.get("wgp:save:v1")!).hero.name).toBe("Local Larry");
  });

  it("sends queued actions one at a time, each on the revision the last one produced", async () => {
    await signIn(me({ save: created(), rev: 4 }, { migrated: true }));
    let rev = 4;
    let save = created();
    routes["POST /api/actions"] = (body) => {
      const { action } = body as { action: Parameters<Store["dispatch"]>[0] };
      save = reduce(save, action);
      return { status: 200, body: { applied: true, save, rev: ++rev } };
    };
    store.dispatch({ type: "set-loadout", loadout: ["web-sling", "node-sense"] });
    store.dispatch({ type: "set-loadout", loadout: ["web-shield"] });
    // A move the rules refuse (no poll to vote in yet) is never sent.
    store.dispatch({ type: "vote", side: "hero" });
    expect(store.getSave()?.hero?.loadout).toEqual(["web-shield"]);
    await flush();
    expect(posted().map((c) => (c.body as { rev: number }).rev)).toEqual([4, 5]);
    expect(store.getAccount().me?.rev).toBe(6);
    expect(store.getSave()?.hero?.loadout).toEqual(["web-shield"]);
  });

  it("takes the server's save from a rev_conflict", async () => {
    await signIn(me({ save: created(), rev: 2 }, { migrated: true }));
    const theirs = created("Peter", { ...newSave(), night: 7 });
    routes["POST /api/actions"] = () => ({ status: 409, body: { error: "rev_conflict", message: "Your save changed elsewhere", save: theirs, rev: 9 } });
    store.dispatch({ type: "set-loadout", loadout: ["web-shield"] });
    await flush();
    expect(store.getAccount().me?.rev).toBe(9);
    expect(store.getSave()).toEqual(theirs);
    expect(store.getToast()?.tone).toBe("info");
  });

  it.each([
    ["run_active", { status: 409, body: { error: "run_active", runId: "r1" } } as Reply, /Finish or abandon your patrol/],
    ["a network error", "network" as Reply, /Couldn’t reach the server/],
  ])("reverts and raises a toast on %s", async (_name, reply, text) => {
    const save = created();
    await signIn(me({ save, rev: 3 }, { migrated: true }));
    routes["POST /api/actions"] = () => reply;
    store.dispatch({ type: "set-loadout", loadout: ["web-shield"] });
    expect(store.getSave()?.hero?.loadout).toEqual(["web-shield"]);
    await flush();
    expect(store.getSave()).toEqual(save);
    expect(store.getAccount().me?.rev).toBe(3);
    expect(store.getToast()).toMatchObject({ tone: "error" });
    expect(store.getToast()?.text).toMatch(text);
  });

  it("plays patrol steps on an unsaved copy until the run's verified save arrives", async () => {
    const save = created();
    await signIn(me({ save, rev: 1 }, { migrated: true }));
    store.dispatch({ type: "start-patrol" });
    expect(store.getSave()?.patrol).not.toBeNull();
    expect(posted()).toHaveLength(0);
    const verified = { ...save, nightDone: true };
    store.adoptServerSave(verified, 2);
    expect(store.getSave()).toEqual(verified);
    expect(store.getAccount().me?.rev).toBe(2);
    // A stale save never wins over a newer one.
    store.adoptServerSave(save, 1);
    expect(store.getSave()).toEqual(verified);
  });

  it("brings the guest's save back on sign-out", async () => {
    storage.set("wgp:save:v1", JSON.stringify(created("Local Larry")));
    await signIn(me({ save: created("Peter"), rev: 1 }, { migrated: true }));
    expect(store.getSave()?.hero?.name).toBe("Peter");
    routes["GET /api/me"] = () => ({ status: 200, body: { signedIn: false } });
    await store.refreshAccount();
    expect(store.getSave()?.hero?.name).toBe("Local Larry");
  });
});

describe("first sign-in import", () => {
  beforeEach(() => {
    storage.set("wgp:save:v1", JSON.stringify(created("Local Larry")));
  });

  it("is offered only to an unmigrated account with no hero while this browser has one", async () => {
    await signIn(me({ save: created("Peter") }));
    expect(store.getMigrationOffer()).toBeNull();
    await signIn(me({}, { migrated: true }));
    expect(store.getMigrationOffer()).toBeNull();
    await signIn(me());
    expect(store.getMigrationOffer()?.hero.name).toBe("Local Larry");
  });

  it("imports on accept and adopts the server's save", async () => {
    await signIn(me());
    const imported = created("Local Larry");
    routes["POST /api/migrate"] = () => ({ status: 200, body: { save: imported, rev: 1, items: [], trophy: "trophy:day-one" } });
    expect(await store.acceptMigration()).toEqual({ ok: true, imported: true });
    expect(calls.find((c) => c.path === "/api/migrate")?.body).toMatchObject({ save: { hero: { name: "Local Larry" } } });
    expect(store.getSave()).toEqual(imported);
    expect(store.getMigrationOffer()).toBeNull();
  });

  it("remembers Start fresh for this player", async () => {
    await signIn(me());
    store.declineMigration();
    expect(store.getMigrationOffer()).toBeNull();
    expect(storage.get("wgp:migrate-declined:p1")).toBe("1");
    await signIn(me());
    expect(store.getMigrationOffer()).toBeNull();
  });

  it.each([
    [409, "already_migrated"],
    [409, "server_save_exists"],
    [422, "nothing_to_import"],
  ])("ends quietly on %i %s", async (status, error) => {
    await signIn(me());
    routes["POST /api/migrate"] = () => ({ status, body: { error } });
    expect(await store.acceptMigration()).toEqual({ ok: true, imported: false });
    expect(store.getMigrationOffer()).toBeNull();
    expect(store.getToast()).toBeNull();
  });

  it("keeps the offer open with a message when the server can't be reached", async () => {
    await signIn(me());
    routes["POST /api/migrate"] = () => "network";
    const res = await store.acceptMigration();
    expect(res.ok).toBe(false);
    expect(store.getMigrationOffer()).not.toBeNull();
  });
});
