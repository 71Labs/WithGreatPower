import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatNear, minBalanceYocto, readGasTank, resetTankCache, type TankReads } from "./tank";

const NEAR = 10n ** 24n;
const ENV = { RELAYER_ACCOUNT_ID: "relayer.wgpnear.near", NEAR_NETWORK: "mainnet" };

const reads = (available: bigint, wrapped: bigint | Error): TankReads => ({
  available: vi.fn(async () => available),
  wrapped: vi.fn(async () => {
    if (wrapped instanceof Error) throw wrapped;
    return wrapped;
  }),
});

beforeEach(() => resetTankCache());

describe("readGasTank", () => {
  it("is null when the gas tank isn't configured", async () => {
    expect(await readGasTank({}, reads(0n, 0n))).toBeNull();
  });

  it("compares available NEAR with the cut-off, and shows wNEAR beside it", async () => {
    const tank = await readGasTank(ENV, reads(5n * NEAR, 2n * NEAR), 1000);
    expect(tank).toMatchObject({ accountId: "relayer.wgpnear.near", availableYocto: (5n * NEAR).toString(), wrappedYocto: (2n * NEAR).toString(), minYocto: NEAR.toString(), ok: true });
    resetTankCache();
    expect((await readGasTank({ ...ENV, RELAYER_MIN_BALANCE_NEAR: "10" }, reads(5n * NEAR, 0n)))!.ok).toBe(false);
  });

  it("still answers when the wNEAR read fails, and caches for 30 seconds", async () => {
    const r = reads(NEAR / 2n, new Error("rpc down"));
    const tank = await readGasTank(ENV, r, 1000);
    expect(tank).toMatchObject({ ok: false, wrappedYocto: null });
    await readGasTank(ENV, r, 20_000);
    expect(r.available).toHaveBeenCalledTimes(1);
    await readGasTank(ENV, r, 40_000);
    expect(r.available).toHaveBeenCalledTimes(2);
  });
});

describe("helpers", () => {
  it("parses the cut-off like relayerEnv (default 1 NEAR)", () => {
    expect(minBalanceYocto({})).toBe(NEAR);
    expect(minBalanceYocto({ RELAYER_MIN_BALANCE_NEAR: "0.5" })).toBe(NEAR / 2n);
  });

  it("formats yocto as NEAR", () => {
    expect(formatNear(0n)).toBe("0");
    expect(formatNear(1234n * NEAR + NEAR / 4n)).toBe("1,234.25");
    expect(formatNear("645700000000000000000000")).toBe("0.645");
  });
});
