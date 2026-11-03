/** Quick play's state, from the server's live keys and this browser's session key. */
import { describe, expect, it } from "vitest";

import { quickPlayState, type QuickPlayInput } from "./quick-play";

const ME = "peter.near";
const PK = "ed25519:AAAA";
const base: QuickPlayInput = { available: true, configured: true, accountId: ME, liveKeys: [], localKey: null, enabling: false };

describe("quick play state", () => {
  it("is on when this browser's key is one the relayer accepts", () => {
    expect(quickPlayState({ ...base, liveKeys: [PK], localKey: { publicKey: PK, accountId: ME } })).toEqual({ state: "on", publicKey: PK });
    // A Google sign-up's key is live before the browser has bound it to the account.
    expect(quickPlayState({ ...base, liveKeys: [PK], localKey: { publicKey: PK, accountId: null } }).state).toBe("on");
  });

  it("is off with no key here, or a key the relayer doesn't know that was never added here", () => {
    expect(quickPlayState(base)).toEqual({ state: "off" });
    expect(quickPlayState({ ...base, liveKeys: ["ed25519:OTHER"], localKey: { publicKey: PK, accountId: null } })).toEqual({ state: "off" });
    // A key this browser added to another account.
    expect(quickPlayState({ ...base, liveKeys: [PK], localKey: { publicKey: PK, accountId: "miles.near" } })).toEqual({ state: "off" });
  });

  it("is pending while enabling, and when the key is on the account but not recorded yet", () => {
    expect(quickPlayState({ ...base, enabling: true })).toEqual({ state: "pending", publicKey: null });
    expect(quickPlayState({ ...base, localKey: { publicKey: PK, accountId: ME } })).toEqual({ state: "pending", publicKey: PK });
  });

  it("is unavailable for test sign-ins and servers without NEAR settings", () => {
    expect(quickPlayState({ ...base, available: false, liveKeys: [PK], localKey: { publicKey: PK, accountId: ME } })).toEqual({ state: "unavailable", reason: "test-account" });
    expect(quickPlayState({ ...base, configured: false, enabling: true })).toEqual({ state: "unavailable", reason: "not-configured" });
  });
});
