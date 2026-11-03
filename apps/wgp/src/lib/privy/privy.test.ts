import { KeyPair, keyToImplicitAddress } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isImplicitAccountId, isUnclaimed } from "../near/policy";
import { beginOAuthReturn, endOAuthReturn, getPrivyState, isOAuthReturn, publishPrivy, reportPrivyFailure, PrivyBridgeError, whenPrivy, type PrivyApi } from "./bridge";
import { googleSignInMode } from "./config";
import { bytesToHex, hexToBytes, implicitToPublicKey, nearKeyFromWallet, NearKeyError, publicKeyBytes } from "./near-key";

const key = KeyPair.fromRandom("ed25519").getPublicKey().toString();
const implicit = keyToImplicitAddress(key);

describe("near-key", () => {
  it("turns a Privy NEAR wallet's address into the ed25519 key our accounts take, and back", () => {
    expect(implicitToPublicKey(implicit)).toBe(key);
    expect(nearKeyFromWallet({ address: implicit })).toEqual({ publicKey: key, implicitAccountId: implicit });
    expect(nearKeyFromWallet({ address: implicit.toUpperCase(), publicKey: key })).toEqual({ publicKey: key, implicitAccountId: implicit });
    expect(nearKeyFromWallet({ publicKey: `0x${implicit}` }).implicitAccountId).toBe(implicit);
    expect(bytesToHex(publicKeyBytes(key.slice("ed25519:".length)))).toBe(implicit);
    expect(bytesToHex(hexToBytes(`0x${implicit}`))).toBe(implicit);
  });

  it("refuses wallets whose address and key disagree, or that carry no ed25519 key", () => {
    const other = KeyPair.fromRandom("ed25519").getPublicKey().toString();
    expect(() => nearKeyFromWallet({ address: implicit, publicKey: other })).toThrow(NearKeyError);
    expect(() => nearKeyFromWallet({ address: "alice.near" })).toThrow(NearKeyError);
    expect(() => nearKeyFromWallet({})).toThrow(NearKeyError);
    expect(() => publicKeyBytes("ed25519:short")).toThrow(NearKeyError);
    expect(() => hexToBytes("abc")).toThrow(NearKeyError);
  });
});

describe("unclaimed players", () => {
  it("are Privy players on an implicit account id, and nobody else", () => {
    expect(isImplicitAccountId(implicit)).toBe(true);
    expect(isImplicitAccountId("peter.wgpnear.near")).toBe(false);
    expect(isUnclaimed({ authKind: "privy", nearAccountId: implicit })).toBe(true);
    expect(isUnclaimed({ authKind: "privy", nearAccountId: "peter.wgpnear.near" })).toBe(false);
    // A wallet player on an implicit account owns a real, funded account.
    expect(isUnclaimed({ authKind: "wallet", nearAccountId: implicit })).toBe(false);
  });
});

describe("googleSignInMode", () => {
  it("defaults to Privy when its app id is set, and honours an explicit choice", () => {
    expect(googleSignInMode("app", undefined)).toBe("privy");
    expect(googleSignInMode("", undefined)).toBe("near-auth");
    expect(googleSignInMode(undefined, undefined)).toBe("near-auth");
    expect(googleSignInMode("app", "near-auth")).toBe("near-auth");
    expect(googleSignInMode("app", " NEAR-AUTH ")).toBe("near-auth");
    expect(googleSignInMode("", "privy")).toBe("privy");
    expect(googleSignInMode("app", "something-else")).toBe("privy");
  });
});

describe("the Privy bridge", () => {
  afterEach(() => {
    publishPrivy(null);
    endOAuthReturn();
    vi.useRealTimers();
  });

  const api = (over: Partial<PrivyApi> = {}): PrivyApi => ({
    ready: true,
    authenticated: false,
    loginWithGoogle: async () => {},
    ensureNearWallet: async () => ({ address: implicit }),
    accessToken: async () => "token",
    signRawHash: async () => new Uint8Array(64),
    logout: async () => {},
    ...over,
  });

  it("recognises Privy's OAuth return, and only that", () => {
    expect(isOAuthReturn("?privy_oauth_code=c&privy_oauth_state=s&privy_oauth_provider=google")).toBe(true);
    expect(isOAuthReturn("?code=c&state=s")).toBe(false);
    expect(isOAuthReturn("")).toBe(false);
    expect(beginOAuthReturn("?tab=hero")).toBe(false);
    expect(getPrivyState().returning).toBe(false);
    expect(beginOAuthReturn("?privy_oauth_code=c&privy_oauth_state=s&privy_oauth_provider=google")).toBe(true);
    expect(getPrivyState()).toMatchObject({ wanted: true, returning: true });
  });

  it("waits for Privy to be ready, and for the login when asked", async () => {
    const ready = whenPrivy();
    const loggedIn = whenPrivy({ authenticated: true });
    publishPrivy(api({ ready: false }));
    publishPrivy(api());
    await expect(ready).resolves.toMatchObject({ ready: true });
    publishPrivy(api({ authenticated: true }));
    await expect(loggedIn).resolves.toMatchObject({ authenticated: true });
  });

  it("rejects on a reported failure, and gives up after the timeout", async () => {
    const waiting = whenPrivy({ authenticated: true });
    reportPrivyFailure(new PrivyBridgeError("cancelled", "oauth_failed"));
    await expect(waiting).rejects.toMatchObject({ code: "oauth_failed" });

    publishPrivy(api());
    vi.useFakeTimers();
    const slow = whenPrivy({ authenticated: true, timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(slow).rejects.toMatchObject({ code: "privy_not_signed_in" });
  });
});
