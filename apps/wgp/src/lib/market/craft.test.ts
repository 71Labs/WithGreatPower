import { describe, expect, it } from "vitest";

import { SUITS } from "@wgp/game-core/data";
import type { SuitId } from "@wgp/game-core/types";

import { DEFAULT_PARAMS } from "./config";
import { bitsShortIn, CRAFT_BITS_SHORT, CRAFT_NEEDS_CHAIN, craftCost, craftGate, craftRefusalText, craftShortMessage } from "./craft";
import { feeText } from "./format";

const SUIT_IDS = Object.keys(SUITS) as SuitId[];

describe("what a craft costs", () => {
  it("is nothing while craft_bits is 0, for every suit (mainnet today)", () => {
    expect(DEFAULT_PARAMS.craftBits).toBe(0);
    for (const id of SUIT_IDS) expect(craftCost(id, DEFAULT_PARAMS)).toBe(0);
  });

  it("is craft_bits for a suit with a recipe and nothing for a starter, as the contract charges", () => {
    for (const id of SUIT_IDS) expect(craftCost(id, { craftBits: 250 })).toBe(Object.keys(SUITS[id].recipe).length ? 250 : 0);
    expect(craftCost("stealth", { craftBits: 250 })).toBe(250);
    expect(craftCost("snow", { craftBits: 250 })).toBe(0);
  });

  it("is nothing when the market's params aren't known", () => {
    expect(craftCost("stealth", null)).toBe(0);
    expect(craftCost("stealth", undefined)).toBe(0);
    expect(craftCost("stealth", { craftBits: Number.NaN })).toBe(0);
  });
});

describe("whether the player can pay it", () => {
  const known = (bits: number, onChain = false, signs = false) => ({ kind: "known", bits, onChain, signs }) as const;

  it("never blocks a free craft", () => {
    for (const wallet of [{ kind: "guest" }, { kind: "loading" }, { kind: "unknown" }, known(0), known(0, true)] as const) expect(craftGate(0, wallet)).toBeNull();
  });

  it("blocks a player who is short, and says by how much and what to do", () => {
    expect(craftGate(250, known(120))).toEqual({ code: "bits", short: 130, text: "Crafting burns 250 Bits and you have 120 Bits. Sell spare loot to Gwei or finish a ranked night for the other 130." });
    expect(craftGate(250, known(249, true, true))).toMatchObject({ code: "bits", short: 1 });
    expect(craftGate(250, known(250))).toBeNull();
    expect(craftGate(250, known(900))).toBeNull();
  });

  it("on the contract's market, needs quick play to sign the burn", () => {
    expect(craftGate(250, known(900, true, true))).toBeNull();
    expect(craftGate(250, known(900, true, false))).toEqual({ code: "quick-play", text: "Crafting burns 250 Bits on NEAR. Turn on quick play to sign the burn." });
    // In the simulated market the server burns them, so signing doesn't matter.
    expect(craftGate(250, known(900, false, false))).toBeNull();
  });

  it("tells a guest where Bits come from, waits while the wallet loads, and leaves an unreadable wallet to the server", () => {
    expect(craftGate(250, { kind: "guest" })).toEqual({ code: "sign-in", text: "Crafting burns 250 Bits. Bits come from ranked nights, so sign in to earn them." });
    expect(craftGate(250, { kind: "loading" })).toEqual({ code: "checking", text: "Checking your Bits…" });
    expect(craftGate(250, { kind: "unknown" })).toBeNull();
  });
});

describe("a refused craft", () => {
  it("reads how many Bits the contract says are missing", () => {
    expect(craftShortMessage(130)).toBe("Needs bits x130");
    expect(bitsShortIn("Smart contract panicked: Needs bits x130")).toBe(130);
    expect(bitsShortIn("Smart contract panicked: Needs sybil-goo x1, bits x15")).toBe(15);
    expect(bitsShortIn("Smart contract panicked: Needs sybil-goo x1")).toBeNull();
    // An item whose id merely ends in "bits" isn't the Bits token.
    expect(bitsShortIn("Needs rabbits x2")).toBeNull();
  });

  it("is put in words a player can act on", () => {
    expect(craftRefusalText(CRAFT_BITS_SHORT, "Needs bits x130")).toMatch(/130 Bits short.*nothing was spent/);
    expect(craftRefusalText(CRAFT_BITS_SHORT, undefined)).toMatch(/don’t have the Bits/);
    expect(craftRefusalText(CRAFT_NEEDS_CHAIN, "Crafting burns 250 Bits on NEAR; turn on quick play to craft")).toMatch(/quick play/);
    expect(craftRefusalText("rev_conflict", "Your save changed elsewhere")).toBeNull();
    expect(craftRefusalText(undefined, "Needs sybil-goo x1")).toBeNull();
  });
});

describe("the gas fee in words", () => {
  it("is the market's fee_bps, whatever it is set to", () => {
    expect(feeText(200)).toBe("2%");
    expect(feeText(500)).toBe("5%");
    expect(feeText(250)).toBe("2.5%");
    expect(feeText(1000)).toBe("10%");
    expect(feeText(0)).toBe("0%");
  });
});
