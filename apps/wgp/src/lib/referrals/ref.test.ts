import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { devSignIn } from "@/lib/api/client";

import { REF_BY_KEY, REF_KEY, forgetInvite, rememberInvite, storedReferrer, storedRef, withRef } from "./ref";

/** The invite this browser carries, against a fake localStorage, and the `ref` it adds to sign-in bodies. */

let storage: Map<string, string>;
let bodies: unknown[];

beforeEach(() => {
  storage = new Map();
  bodies = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
  vi.stubGlobal("fetch", async (_path: string, init: RequestInit = {}) => {
    bodies.push(typeof init.body === "string" ? JSON.parse(init.body) : undefined);
    return new Response(JSON.stringify({ player: { id: "p1", handle: "nora" } }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the stored invite", () => {
  it("keeps the landing's code and who sent it", () => {
    rememberInvite("K7Q2M9X", "sele");
    expect(storage.get(REF_KEY)).toBe("K7Q2M9X");
    expect(storedRef()).toBe("K7Q2M9X");
    expect(storedReferrer()).toBe("sele");
  });

  it("ignores a code that can't be one, and a tampered value", () => {
    rememberInvite("nope", "sele");
    expect(storage.size).toBe(0);
    storage.set(REF_KEY, "<script>");
    expect(storedRef()).toBeNull();
  });

  it("is forgotten after a signed-in response", () => {
    rememberInvite("K7Q2M9X", "sele");
    forgetInvite();
    expect(storage.has(REF_KEY)).toBe(false);
    expect(storage.has(REF_BY_KEY)).toBe(false);
    expect(storedRef()).toBeNull();
  });

  it("survives blocked storage without throwing", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(() => rememberInvite("K7Q2M9X", "sele")).not.toThrow();
    expect(storedRef()).toBeNull();
    expect(withRef({ a: 1 })).toEqual({ a: 1, ref: null });
    expect(() => forgetInvite()).not.toThrow();
  });
});

describe("the ref fallback in sign-in bodies", () => {
  it("adds `ref`: the code the browser holds, or null", () => {
    expect(withRef({ handle: "nora" })).toEqual({ handle: "nora", ref: null });
    rememberInvite("K7Q2M9X", "sele");
    expect(withRef({ handle: "nora" })).toEqual({ handle: "nora", ref: "K7Q2M9X" });
  });

  it("goes with the dev sign-in request", async () => {
    await devSignIn("nora");
    rememberInvite("K7Q2M9X", "sele");
    await devSignIn("nora");
    await devSignIn();
    expect(bodies).toEqual([{ handle: "nora", ref: null }, { handle: "nora", ref: "K7Q2M9X" }, { ref: "K7Q2M9X" }]);
  });
});
