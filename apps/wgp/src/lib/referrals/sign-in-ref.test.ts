import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishPrivy, type PrivyApi } from "@/lib/privy/bridge";
import { finishPrivySignIn } from "@/lib/privy/sign-in";

import { rememberInvite } from "./ref";

/** The Google (Privy) sign-in request carries the stored invite code as `ref`, a fallback for a lost cookie. */

// The browser's session key lives in IndexedDB: stand in for it.
vi.mock("@/lib/near/session-key", () => ({
  assembleSignedDelegate: vi.fn(),
  bindSessionKey: vi.fn(async () => {}),
  createSessionKey: vi.fn(async () => ({ publicKey: "ed25519:new", accountId: null })),
  delegateHash: vi.fn(),
  deviceId: () => "device-1",
  ensureSessionKey: vi.fn(async () => ({ publicKey: "ed25519:session", accountId: null })),
  loadSessionKey: vi.fn(async () => null),
  postToRelay: vi.fn(),
}));

const privy: PrivyApi = {
  ready: true,
  authenticated: true,
  loginWithGoogle: async () => {},
  ensureNearWallet: async () => ({ address: "a".repeat(64) }),
  accessToken: async () => "privy-token",
  signRawHash: async () => new Uint8Array(64),
  logout: async () => {},
};

let storage: Map<string, string>;
let sent: { path: string; body: Record<string, unknown> }[];

beforeEach(() => {
  storage = new Map();
  sent = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    sent.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ accountId: "nora.wgp.testnet", created: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
  publishPrivy(privy);
});
afterEach(() => {
  publishPrivy(null);
  vi.unstubAllGlobals();
});

describe("the Google sign-in body", () => {
  it("sends ref: null without a stored invite", async () => {
    await finishPrivySignIn({ handle: "nora" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe("/api/auth/privy");
    expect(sent[0]!.body).toHaveProperty("ref", null);
  });

  it("sends the stored code as ref, next to the usual fields", async () => {
    rememberInvite("K7Q2M9X", "sele");
    await finishPrivySignIn({ handle: "nora" });
    expect(sent[0]!.body).toMatchObject({ accessToken: "privy-token", handle: "nora", sessionPublicKey: "ed25519:new", ref: "K7Q2M9X" });
  });
});
