import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "@/server/http";

import {
  buildQuoteRequest,
  checkBounds,
  cleanMessage,
  DESTINATION_ASSET,
  gasTankConfig,
  gasTokens,
  ORIGIN_ASSETS,
  ONE_CLICK_URL,
  QUOTE_DEADLINE_MS,
  quoteInput,
  quoteRefill,
  refillStatus,
  requireGasTank,
  resetOneClickCache,
  SLIPPAGE_BPS,
  statusView,
  SWAP_STATUSES,
  toBaseUnits,
  tokenAmount,
} from "./one-click";

const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SOL = "nep141:sol.omft.near";
const RELAYER = "relayer.wgpnear.near";
const CONFIG = { recipient: RELAYER, jwt: null };
const NOW = Date.parse("2026-11-14T20:00:00.000Z");
const REFUND = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const TOKENS = [
  { assetId: BASE_USDC, decimals: 6, blockchain: "base", symbol: "USDC", price: 1, priceUpdatedAt: "2026-11-14T19:59:00.000Z", contractAddress: "0x8335" },
  { assetId: SOL, decimals: 9, blockchain: "sol", symbol: "SOL", price: 150, priceUpdatedAt: "2026-11-14T19:59:00.000Z" },
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 3.1 },
  { assetId: "nep141:some-other.omft.near", decimals: 6, blockchain: "eth", symbol: "XYZ", price: 1 },
];

const QUOTE = {
  timestamp: "2026-11-14T20:00:00.000Z",
  signature: "ed25519:sig",
  quoteRequest: { recipient: RELAYER, destinationAsset: DESTINATION_ASSET },
  quote: {
    amountIn: "2000000",
    amountInFormatted: "2.0",
    amountInUsd: "2.0000",
    amountOut: "645700000000000000000000",
    amountOutFormatted: "0.6457",
    amountOutUsd: "1.996",
    minAmountOut: "639243000000000000000000",
    timeEstimate: 37,
  },
};

type Handler = (url: string, init: RequestInit) => { status?: number; body: unknown };

function mockFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit; body: unknown }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const { status = 200, body } = handler(url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const routes =
  (quote: { status?: number; body: unknown } = { body: QUOTE }, status: { status?: number; body: unknown } = { body: {} }): Handler =>
  (url) => {
    if (url.endsWith("/v0/tokens")) return { body: TOKENS };
    if (url.includes("/v0/quote")) return quote;
    if (url.includes("/v0/status")) return status;
    return { status: 500, body: {} };
  };

beforeEach(() => resetOneClickCache());
afterEach(() => vi.restoreAllMocks());

describe("gasTankConfig", () => {
  it("reads only the relayer account id, on mainnet, and the optional JWT", () => {
    expect(gasTankConfig({ RELAYER_ACCOUNT_ID: RELAYER, NEAR_NETWORK: "mainnet" })).toEqual({ recipient: RELAYER, jwt: null });
    expect(gasTankConfig({ RELAYER_ACCOUNT_ID: RELAYER, NEAR_NETWORK: "mainnet", ONE_CLICK_JWT: " abc " })).toEqual({ recipient: RELAYER, jwt: "abc" });
  });

  it("is not configured without a valid relayer id or off mainnet", () => {
    expect(gasTankConfig({ NEAR_NETWORK: "mainnet" })).toBeNull();
    expect(gasTankConfig({ RELAYER_ACCOUNT_ID: "Not An Account", NEAR_NETWORK: "mainnet" })).toBeNull();
    expect(gasTankConfig({ RELAYER_ACCOUNT_ID: "relayer.wgp.testnet", NEAR_NETWORK: "testnet" })).toBeNull();
    expect(() => requireGasTank({})).toThrow(/isn’t set up/);
    try {
      requireGasTank({});
    } catch (error) {
      expect((error as HttpError).status).toBe(503);
      expect((error as HttpError).code).toBe("intents_not_configured");
    }
  });
});

describe("buildQuoteRequest", () => {
  it("fixes the recipient, destination, slippage, types and a one-hour deadline", () => {
    const body = buildQuoteRequest({ originAsset: BASE_USDC, amount: 2_000_000n, refundTo: REFUND, dry: true, recipient: RELAYER, now: NOW });
    expect(body).toEqual({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: SLIPPAGE_BPS,
      originAsset: BASE_USDC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep141:wrap.near",
      amount: "2000000",
      refundTo: REFUND,
      refundType: "ORIGIN_CHAIN",
      recipient: RELAYER,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(NOW + QUOTE_DEADLINE_MS).toISOString(),
    });
    expect(SLIPPAGE_BPS).toBe(100);
    expect(QUOTE_DEADLINE_MS).toBe(3_600_000);
  });

  it("refuses an asset outside the curated list", () => {
    expect(() => buildQuoteRequest({ originAsset: "nep141:wrap.near", amount: 1n, refundTo: REFUND, dry: true, recipient: RELAYER, now: NOW })).toThrow(/listed tokens/);
  });

  it("curates nine origin assets on five chains, none of them NEAR", () => {
    expect(ORIGIN_ASSETS).toHaveLength(9);
    expect(new Set(ORIGIN_ASSETS.map((a) => a.chainName))).toEqual(new Set(["Ethereum", "Base", "Arbitrum", "Solana", "Bitcoin"]));
    expect(ORIGIN_ASSETS.every((a) => a.assetId.endsWith(".omft.near"))).toBe(true);
  });
});

describe("quoteInput", () => {
  const ok = { assetId: BASE_USDC, amount: "2", refundTo: REFUND };

  it("defaults to a dry quote", () => {
    expect(quoteInput.parse(ok).dry).toBe(true);
    expect(quoteInput.parse({ ...ok, dry: false }).dry).toBe(false);
  });

  it("ignores a recipient in the body: the schema has no such field", () => {
    const parsed = quoteInput.parse({ ...ok, recipient: "attacker.near" }) as Record<string, unknown>;
    expect(parsed.recipient).toBeUndefined();
  });

  it("refuses unknown assets, bad amounts and unsafe or missing refund addresses", () => {
    expect(quoteInput.safeParse({ ...ok, assetId: "nep141:usdt.tether-token.near" }).success).toBe(false);
    expect(quoteInput.safeParse({ ...ok, amount: "-1" }).success).toBe(false);
    expect(quoteInput.safeParse({ ...ok, amount: "1e3" }).success).toBe(false);
    expect(quoteInput.safeParse({ ...ok, refundTo: "" }).success).toBe(false);
    expect(quoteInput.safeParse({ ...ok, refundTo: "0xabc<script>" }).success).toBe(false);
    expect(quoteInput.safeParse({ ...ok, refundTo: "a".repeat(129) }).success).toBe(false);
    expect(quoteInput.safeParse({ ...ok, refundTo: "a".repeat(128) }).success).toBe(true);
    expect(quoteInput.safeParse({ ...ok, refundTo: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" }).success).toBe(true);
  });
});

describe("amounts and bounds", () => {
  it("converts decimal strings to base units exactly", () => {
    expect(toBaseUnits("2", 6)).toBe(2_000_000n);
    expect(toBaseUnits("2.5", 6)).toBe(2_500_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
    expect(toBaseUnits("1.50", 6)).toBe(1_500_000n);
    expect(toBaseUnits("0.1", 18)).toBe(10n ** 17n);
    expect(() => toBaseUnits("0.0000001", 6)).toThrow(/decimal places/);
  });

  it("keeps the input between $1 and $50 at the live price", () => {
    const usdc = { symbol: "USDC", decimals: 6, price: 1 };
    expect(() => checkBounds("1", usdc)).not.toThrow();
    expect(() => checkBounds("50", usdc)).not.toThrow();
    expect(() => checkBounds("0.99", usdc)).toThrow(/at least \$1 worth: 1 USDC/);
    expect(() => checkBounds("50.01", usdc)).toThrow(/at most \$50 worth at a time: 50 USDC/);
    expect(() => checkBounds("1", { symbol: "SOL", decimals: 9, price: 150 })).toThrow(/at most/);
    expect(() => checkBounds("1", { symbol: "SOL", decimals: 9, price: null })).toThrow(/no price/);
  });

  it("writes bounds in token units, rounded inward", () => {
    expect(tokenAmount(1, 150, 9, "up")).toBe("0.006667");
    expect(tokenAmount(50, 150, 9, "down")).toBe("0.3333");
    expect(tokenAmount(1, 1, 6, "up")).toBe("1");
    expect(tokenAmount(1, 0.999606, 6, "up")).toBe("1.001");
    expect(tokenAmount(50, 0.999606, 6, "down")).toBe("50.01");
    expect(tokenAmount(1, 65641, 8, "up")).toBe("0.00001524");
  });
});

describe("gasTokens", () => {
  it("keeps only curated assets, with live prices, cached for five minutes", async () => {
    const { fetch, calls } = mockFetch(routes());
    const tokens = await gasTokens({ fetch, now: NOW });
    expect(tokens).toHaveLength(ORIGIN_ASSETS.length);
    const usdc = tokens.find((t) => t.assetId === BASE_USDC)!;
    expect(usdc).toMatchObject({ symbol: "USDC", chainName: "Base", decimals: 6, price: 1, min: "1", max: "50" });
    // Not in /v0/tokens: no price, no bounds, curated decimals.
    expect(tokens.find((t) => t.assetId === "nep141:btc.omft.near")).toMatchObject({ price: null, min: null, decimals: 8 });
    await gasTokens({ fetch, now: NOW + 60_000 });
    expect(calls).toHaveLength(1);
    await gasTokens({ fetch, now: NOW + 6 * 60_000 });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(`${ONE_CLICK_URL}/v0/tokens`);
  });
});

describe("quoteRefill", () => {
  const input = { assetId: BASE_USDC, amount: "2", refundTo: REFUND, dry: true };

  it("sends a dry quote to the relayer and returns the estimate", async () => {
    const { fetch, calls } = mockFetch(routes());
    const quote = await quoteRefill(input, CONFIG, { fetch, now: NOW });
    const sent = calls.find((c) => c.url.endsWith("/v0/quote"))!;
    expect(sent.init.method).toBe("POST");
    expect(sent.body).toMatchObject({ dry: true, recipient: RELAYER, destinationAsset: DESTINATION_ASSET, amount: "2000000", originAsset: BASE_USDC });
    expect(new Headers(sent.init.headers).get("authorization")).toBeNull();
    expect(quote).toMatchObject({ dry: true, recipient: RELAYER, amountOutFormatted: "0.6457", timeEstimate: 37, depositAddress: null, deadline: null });
  });

  it("asks for a deposit address only when dry is false, and sends the JWT when set", async () => {
    const real = { ...QUOTE, quote: { ...QUOTE.quote, depositAddress: "0x76b4c56085ED136a8744D52bE956396624a730E8", deadline: "2026-11-14T21:00:00.000Z" } };
    const { fetch, calls } = mockFetch(routes({ body: real }));
    const quote = await quoteRefill({ ...input, dry: false }, { recipient: RELAYER, jwt: "jwt-token" }, { fetch, now: NOW });
    const sent = calls.find((c) => c.url.endsWith("/v0/quote"))!;
    expect(sent.body).toMatchObject({ dry: false });
    expect(new Headers(sent.init.headers).get("authorization")).toBe("Bearer jwt-token");
    // Our deadline (refunds start) is an hour out; 1Click's is when the address stops watching.
    expect(quote).toMatchObject({ dry: false, depositAddress: "0x76b4c56085ED136a8744D52bE956396624a730E8", deadline: new Date(NOW + QUOTE_DEADLINE_MS).toISOString(), inactiveAt: "2026-11-14T21:00:00.000Z" });
  });

  it("refuses a real quote that came back without a deposit address", async () => {
    const { fetch } = mockFetch(routes());
    await expect(quoteRefill({ ...input, dry: false }, CONFIG, { fetch, now: NOW })).rejects.toMatchObject({ status: 502 });
  });

  it("refuses a quote whose echoed request names another recipient", async () => {
    const { fetch } = mockFetch(routes({ body: { ...QUOTE, quoteRequest: { recipient: "someone.near", destinationAsset: DESTINATION_ASSET } } }));
    await expect(quoteRefill(input, CONFIG, { fetch, now: NOW })).rejects.toMatchObject({ status: 502, code: "intents_unavailable" });
  });

  it("passes 1Click's refusal through in its own words", async () => {
    const { fetch } = mockFetch(routes({ status: 400, body: { message: "refundTo is not valid" } }));
    await expect(quoteRefill(input, CONFIG, { fetch, now: NOW })).rejects.toMatchObject({ status: 422, code: "intents_refused", message: "refundTo is not valid" });
  });

  it("turns a 5xx, a refused JWT or a dropped connection into a retryable 502", async () => {
    for (const status of [500, 401, 429]) {
      resetOneClickCache();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { fetch } = mockFetch(routes({ status, body: { message: "nope" } }));
      await expect(quoteRefill(input, CONFIG, { fetch, now: NOW })).rejects.toMatchObject({ status: 502 });
    }
    resetOneClickCache();
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(quoteRefill(input, CONFIG, { fetch: failing, now: NOW })).rejects.toMatchObject({ status: 502 });
  });

  it("checks bounds before asking 1Click for a quote", async () => {
    const { fetch, calls } = mockFetch(routes());
    await expect(quoteRefill({ ...input, amount: "75" }, CONFIG, { fetch, now: NOW })).rejects.toMatchObject({ status: 400 });
    await expect(quoteRefill({ ...input, amount: "0" }, CONFIG, { fetch, now: NOW })).rejects.toMatchObject({ status: 400 });
    expect(calls.some((c) => c.url.endsWith("/v0/quote"))).toBe(false);
  });

  it("strips control characters from 1Click's message", () => {
    expect(cleanMessage("bad\u0000 thing\n")).toBe("bad  thing");
    expect(cleanMessage(42)).toBeNull();
    expect(cleanMessage("x".repeat(500))).toHaveLength(240);
  });
});

describe("status", () => {
  it("maps every 1Click status to words, and only SUCCESS, REFUNDED and FAILED are final", () => {
    const finals = SWAP_STATUSES.filter((s) => statusView(s).final);
    expect(finals).toEqual(["SUCCESS", "REFUNDED", "FAILED"]);
    expect(statusView("SUCCESS")).toMatchObject({ label: "Landed in the gas tank", tone: "done" });
    expect(statusView("PENDING_DEPOSIT")).toMatchObject({ label: "Waiting for your deposit", tone: "waiting" });
    expect(statusView("REFUNDED").tone).toBe("refunded");
    expect(statusView("SOMETHING_NEW")).toMatchObject({ status: "SOMETHING_NEW", final: false });
  });

  it("reads the status for a deposit address, keeping only https explorer links", async () => {
    const body = {
      status: "SUCCESS",
      updatedAt: "2026-11-14T20:05:00.000Z",
      swapDetails: {
        amountOutFormatted: "0.6457",
        intentHashes: [],
        originChainTxHashes: [],
        nearTxHashes: [{ hash: "abc", explorerUrl: "https://nearblocks.io/txns/abc" }],
        destinationChainTxHashes: [{ hash: "abc", explorerUrl: "https://nearblocks.io/txns/abc" }, { hash: "def", explorerUrl: "javascript:alert(1)" }],
      },
    };
    const { fetch, calls } = mockFetch(routes(undefined, { body }));
    const status = await refillStatus("0x76b4c56085ED136a8744D52bE956396624a730E8", null, { fetch });
    expect(calls[0]!.url).toBe(`${ONE_CLICK_URL}/v0/status?depositAddress=0x76b4c56085ED136a8744D52bE956396624a730E8`);
    expect(status).toMatchObject({ status: "SUCCESS", final: true, amountOutFormatted: "0.6457" });
    expect(status.txs).toEqual([
      { hash: "abc", url: "https://nearblocks.io/txns/abc" },
      { hash: "def", url: null },
    ]);
  });

  it("answers 404 for an address 1Click doesn't know", async () => {
    const { fetch } = mockFetch(routes(undefined, { status: 404, body: { message: "Deposit address not found" } }));
    await expect(refillStatus("0x76b4c56085ED136a8744D52bE956396624a730E8", null, { fetch })).rejects.toMatchObject({ status: 404, message: "Deposit address not found" });
  });
});
