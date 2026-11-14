import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetOneClickCache } from "@/server/intents/one-click";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

import { POST as quote } from "./quote/route";
import { GET as status } from "./status/route";
import { GET as tokens } from "./tokens/route";

const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const REFUND = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const DEPOSIT = "0x76b4c56085ED136a8744D52bE956396624a730E8";

const QUOTE = {
  quoteRequest: { recipient: "relayer.wgpnear.near", destinationAsset: "nep141:wrap.near" },
  quote: { amountIn: "2000000", amountInFormatted: "2.0", amountOut: "6457", amountOutFormatted: "0.6457", minAmountOut: "6390", timeEstimate: 37, depositAddress: DEPOSIT },
};

let sent: { url: string; body: Record<string, unknown> | null }[] = [];

function stubOneClick() {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      sent.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/v0/tokens")) return Response.json([{ assetId: BASE_USDC, decimals: 6, blockchain: "base", symbol: "USDC", price: 1 }]);
      if (url.endsWith("/v0/quote")) return Response.json(QUOTE);
      if (url.includes("/v0/status")) return Response.json({ status: "PROCESSING", swapDetails: {} });
      return new Response("{}", { status: 500 });
    }),
  );
}

const post = (body: unknown, ip = "1.2.3.4") =>
  quote(new Request("http://localhost/api/intents/quote", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) }));

beforeEach(() => {
  rateLimiter.reset();
  resetOneClickCache();
  vi.stubEnv("RELAYER_ACCOUNT_ID", "relayer.wgpnear.near");
  vi.stubEnv("NEAR_NETWORK", "mainnet");
  vi.stubEnv("ONE_CLICK_JWT", "");
  stubOneClick();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/intents/quote", () => {
  it("answers a dry quote by default, always to the relayer", async () => {
    const res = await post({ assetId: BASE_USDC, amount: "2", refundTo: REFUND, recipient: "attacker.near" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ dry: true, recipient: "relayer.wgpnear.near", amountOutFormatted: "0.6457", depositAddress: null });
    const quoted = sent.find((s) => s.url.endsWith("/v0/quote"))!.body!;
    expect(quoted).toMatchObject({ dry: true, recipient: "relayer.wgpnear.near" });
  });

  it("names the field that failed validation", async () => {
    const missing = await post({ assetId: BASE_USDC, amount: "2", refundTo: "" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "bad_request", field: "refundTo", message: expect.stringMatching(/refund address/) });
    const unknown = await post({ assetId: "nep141:wrap.near", amount: "2", refundTo: REFUND });
    expect(await unknown.json()).toMatchObject({ field: "assetId" });
    const tooMuch = await post({ assetId: BASE_USDC, amount: "51", refundTo: REFUND });
    expect(tooMuch.status).toBe(400);
    expect(await tooMuch.json()).toMatchObject({ field: "amount" });
    expect(sent.some((s) => s.url.endsWith("/v0/quote"))).toBe(false);
  });

  it("refuses a body that isn't JSON", async () => {
    const res = await quote(new Request("http://localhost/api/intents/quote", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" }));
    expect(res.status).toBe(415);
  });

  it("is not configured off mainnet or without a relayer", async () => {
    vi.stubEnv("RELAYER_ACCOUNT_ID", "");
    const res = await post({ assetId: BASE_USDC, amount: "2", refundTo: REFUND });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "intents_not_configured" });
  });

  it("rate-limits quotes per IP", async () => {
    const body = { assetId: BASE_USDC, amount: "2", refundTo: REFUND };
    for (let i = 0; i < RATE_LIMITS.intentsQuotePerIp.limit; i++) expect((await post(body)).status).toBe(200);
    const limited = await post(body);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await post(body, "5.6.7.8")).status).toBe(200);
  });

  it("allows only a few deposit addresses per IP", async () => {
    const body = { assetId: BASE_USDC, amount: "2", refundTo: REFUND, dry: false };
    for (let i = 0; i < RATE_LIMITS.intentsDepositPerIp.limit; i++) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ dry: false, depositAddress: DEPOSIT });
    }
    expect((await post(body)).status).toBe(429);
    // Dry quotes keep working.
    expect((await post({ ...body, dry: true })).status).toBe(200);
  });
});

describe("GET /api/intents/tokens", () => {
  it("lists the curated tokens with live prices and bounds", async () => {
    const res = await tokens(new Request("http://localhost/api/intents/tokens"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ configured: true, recipient: "relayer.wgpnear.near", minUsd: 1, maxUsd: 50 });
    expect(body.tokens).toHaveLength(9);
    expect(body.tokens.find((t: { assetId: string }) => t.assetId === BASE_USDC)).toMatchObject({ price: 1, min: "1", max: "50" });
  });
});

describe("GET /api/intents/status", () => {
  it("maps the status for a deposit address", async () => {
    const res = await status(new Request(`http://localhost/api/intents/status?depositAddress=${DEPOSIT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "PROCESSING", label: "Swapping into NEAR", final: false });
  });

  it("refuses a missing or unsafe deposit address before asking 1Click", async () => {
    expect((await status(new Request("http://localhost/api/intents/status"))).status).toBe(400);
    expect((await status(new Request("http://localhost/api/intents/status?depositAddress=%3Cscript%3Ealert(1)%3C%2Fscript%3E"))).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});
