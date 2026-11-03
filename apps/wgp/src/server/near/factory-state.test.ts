/** Whether the account factory is open: configured, and its account on chain (read-only, cached). */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearFactoryState, factoryState } from "./factory";

const ENV = {
  NEAR_NETWORK: "mainnet",
  WGP_CONTRACT_ID: "game.wgpnear.near",
  FACTORY_ACCOUNT_ID: "wgpnear.near",
  FACTORY_PRIVATE_KEY: `ed25519:${"3".repeat(64)}`,
};

describe("factoryState", () => {
  beforeEach(() => clearFactoryState());

  it("is closed without the factory's settings, without asking the chain", async () => {
    const exists = vi.fn(async () => true);
    expect(await factoryState({ env: { NEAR_NETWORK: "mainnet", WGP_CONTRACT_ID: "game.wgpnear.near" }, exists })).toEqual({ open: false, reason: "not_configured" });
    // Local development: NEAR_NETWORK unset on purpose.
    expect(await factoryState({ env: { ...ENV, NEAR_NETWORK: undefined }, exists })).toEqual({ open: false, reason: "not_configured" });
    expect(exists).not.toHaveBeenCalled();
  });

  it("is closed until the factory account exists on chain, then open (and remembered)", async () => {
    let onChain = false;
    const exists = vi.fn(async () => onChain);
    expect(await factoryState({ env: ENV, exists, now: 0 })).toEqual({ open: false, reason: "not_on_chain" });
    onChain = true;
    // A missing factory is looked for again after 30 s, not before.
    expect(await factoryState({ env: ENV, exists, now: 10_000 })).toEqual({ open: false, reason: "not_on_chain" });
    expect(await factoryState({ env: ENV, exists, now: 31_000 })).toEqual({ open: true, parentId: "wgpnear.near" });
    expect(await factoryState({ env: ENV, exists, now: 60_000 })).toEqual({ open: true, parentId: "wgpnear.near" });
    expect(exists).toHaveBeenCalledTimes(2);
  });

  it("treats an unreachable RPC as closed, briefly", async () => {
    const exists = vi.fn(async () => {
      throw new Error("rpc down");
    });
    expect(await factoryState({ env: ENV, exists, now: 0 })).toEqual({ open: false, reason: "unreachable" });
  });
});
