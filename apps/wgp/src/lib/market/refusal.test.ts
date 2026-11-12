/**
 * Failed trades in a player's words. The raw outcomes below are what the relayer answered on
 * the sandbox run of scripts/near/e2e-sandbox.ts (the deployed contract's own panics).
 */
import { describe, expect, it } from "vitest";

import { chainCall } from "./chain-calls";
import { INVEST_NOT_LIVE, marketProblem, panicText, refusalText } from "./refusal";

const relayed = (said: string) => JSON.stringify({ ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${said}` } } } });

const RAW_WORDS = /panicked|ActionError|ExecutionError|item:|yocto|nonce|Tgas|\.near\b|limit of/i;

describe("market refusals", () => {
  it("reads the contract's words out of a relayed outcome", () => {
    expect(panicText(relayed("That listing is gone"))).toBe("That listing is gone");
    expect(panicText('{"ActionError":{"kind":"DelegateActionInvalidNonce"}}')).toBeNull();
  });

  it("rephrases every refusal the market can give, with no chain words left", () => {
    const said = [
      "That costs 14 Bits now, over your limit of 13",
      "That pays 9 Bits now, under your limit of 10",
      "Needs 120 Bits",
      "Not enough item:crumbs",
      "Not enough item:bits",
      "The vendor has only 2 crumbs",
      "The vendor's till holds only 40 Bits",
      "That's worth less than a Bit",
      "Price it between 7 and 49 Bits",
      "You can have 3 listings open",
      "Daily market limit reached; it resets at midnight UTC",
      "That listing is gone",
      "That's your own listing",
      "Only the seller can cancel a listing",
      "The market is full; try again later",
      "The market is closed",
      "The game is paused",
      "Trade 1 to 20 at a time",
      "This account holds the maximum number of token kinds",
      "The market doesn't trade bits",
    ];
    const texts = said.map((s) => marketProblem(422, "call_failed", relayed(s)).text);
    for (const [i, text] of texts.entries()) {
      expect(text, said[i]).not.toMatch(RAW_WORDS);
      expect(text, said[i]).not.toBe("The market couldn’t do that, and nothing was spent. Try again.");
    }
    expect(texts[0]).toBe("The price moved before your trade went through: that’s 14 Bits now. Nothing was spent. Check the new price and try again.");
    expect(texts[3]).toBe("You don’t have that many Crumbs yet. Loot from a night arrives within a minute or two.");
    expect(texts[11]).toBe("Someone bought that lot first, or it was taken down.");
  });

  it("rephrases every refusal contract v3 has for investing, with no chain words left", () => {
    // contracts/wgp/src/invest.rs on review/contract-v3; invest-vectors.json holds each as the Rust printed it.
    const said = [
      "The vendor isn't taking investors right now",
      "Invest 10 to 500 Bits at a time",
      "The vendor can take only 329 more Bits for crumbs",
      "The vendor can take only 0 more Bits for crumbs",
      "You have no stake in sybil-goo",
      "You have 120 Bits staked in crumbs",
      "Your stake unlocks in about 42 minutes",
      "Your stake unlocks in about 1 minutes",
      "The till can pay back only 37 Bits right now; it refills as players buy crumbs",
      "The till can pay back only 0 Bits right now; it refills as players buy crumbs",
      "Nothing earned yet",
    ];
    const texts = said.map((s) => marketProblem(422, "call_failed", relayed(s)).text);
    for (const [i, text] of texts.entries()) {
      expect(text, said[i]).not.toMatch(RAW_WORDS);
      expect(text, said[i]).not.toMatch(/vendor/i);
      expect(text, said[i]).not.toBe("The market couldn’t do that, and nothing was spent. Try again.");
      // The simulated and practice markets answer a plain 422 with the same words.
      expect(marketProblem(422, "locked", said[i]).text).toBe(text);
    }
    expect(texts[2]).toBe("Gwei’s till for Crumbs can take only 329 Bits more. Try less.");
    expect(texts[3]).toBe("Gwei’s till for Crumbs is fully funded. It can’t take more.");
    expect(texts[7]).toMatch(/about 1 more minute\./);
    expect(texts[8]).toBe("Gwei’s till for Crumbs holds only 37 Bits right now, so that’s the most you can withdraw. It refills as players buy Crumbs from her.");
    expect(texts[9]).toMatch(/is empty right now, so your stake has to wait/);
  });

  it("says investing isn't live where the contract is older than v3, and points at the practice market", () => {
    expect(INVEST_NOT_LIVE).toBe("Investing in a merchant is built into contract v3, which isn’t live yet. Try it in the practice market.");
    // The relayer's gate (409) and the engine's own refusal (422) say the same sentence.
    expect(marketProblem(409, "invest_unsupported", "Investing in a merchant is built into contract v3, which isn't live yet").text).toBe(INVEST_NOT_LIVE);
    expect(marketProblem(422, "invest_unsupported", "This market doesn't take investors yet").text).toBe(INVEST_NOT_LIVE);
  });

  it("phrases the simulated market's refusals the same way (same words, plain 422)", () => {
    expect(marketProblem(422, "slippage", "That costs 14 Bits now, over your limit of 13").text).toBe(refusalText("That costs 14 Bits now, over your limit of 13"));
  });

  it("never shows a raw outcome when NEAR itself refused", () => {
    const p = marketProblem(422, "call_failed", '{"ActionError":{"index":0,"kind":{"DelegateActionInvalidNonce":{"delegate_nonce":5,"ak_nonce":7}}}}');
    expect(p.text).toBe("That didn’t go through, and nothing was spent. Try again.");
    expect(marketProblem(422, "call_failed", '{"ActionError":{"kind":{"DelegateActionAccessKeyError":{}}}}').code).toBe("quick_play");
  });

  it("keeps the relayer's status: rate limits, budgets, sign-out and a missing key each say what to do", () => {
    expect(marketProblem(429, "rate_limited").text).toMatch(/Wait a moment/);
    expect(marketProblem(429, "budget_exhausted", "Daily limit reached").text).toMatch(/midnight UTC/);
    expect(marketProblem(503, "budget_exhausted", "The relayer is out of budget for today; try again tomorrow").text).toMatch(/safe/);
    expect(marketProblem(503, "relayer_empty", "The relayer is out of funds").text).not.toMatch(/relayer|funds/i);
    expect(marketProblem(401, "unauthorized", "Sign in first").code).toBe("signed_out");
    expect(marketProblem(403, "unknown_key", "Unknown session key").code).toBe("quick_play");
    expect(marketProblem(409, "run_active").text).toMatch(/patrol/);
    expect(marketProblem(400, "expired", "The delegate has expired; sign it again").text).not.toMatch(/delegate/i);
  });

  it("says so when it can't tell whether a trade landed, so nobody pays twice", () => {
    expect(marketProblem(0, "network")).toMatchObject({ unsure: true });
    expect(marketProblem(500, "internal", "Internal error")).toMatchObject({ unsure: true });
    expect(marketProblem(422, "call_failed", relayed("Needs 120 Bits")).unsure).toBeUndefined();
  });
});

describe("the contract call for each market request", () => {
  it("matches market.rs's argument names and JSON types (U128 as strings, ids as numbers)", () => {
    expect(chainCall({ action: "buy", item: "crumbs", amount: 2, maxBits: 27 })).toEqual({ method: "market_buy", args: { item: "crumbs", amount: 2, max_bits: "27" } });
    expect(chainCall({ action: "sell", item: "crumbs", amount: 1, minBits: 10 })).toEqual({ method: "market_sell", args: { item: "crumbs", amount: 1, min_bits: "10" } });
    expect(chainCall({ action: "list", item: "crumbs", amount: 1, price: 12 })).toEqual({ method: "list_item", args: { item: "crumbs", amount: 1, price_bits: "12" } });
    expect(chainCall({ action: "fill", listingId: 7 })).toEqual({ method: "buy_listing", args: { listing_id: 7 } });
    expect(chainCall({ action: "cancel", listingId: 7 })).toEqual({ method: "cancel_listing", args: { listing_id: 7 } });
  });
});
