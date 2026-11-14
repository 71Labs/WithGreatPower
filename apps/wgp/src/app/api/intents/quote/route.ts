/**
 * POST /api/intents/quote — a NEAR Intents 1Click quote for refilling the gas tank.
 *
 * Body: { assetId, amount: "2.5" (whole tokens), refundTo, dry?: boolean (default true) }
 *   assetId   one of the curated origin tokens (src/server/intents/one-click.ts)
 *   amount    worth $1–$50 at the token's live price
 *   refundTo  an address on the origin chain, ≤ 128 of [A-Za-z0-9._:-]
 *   dry       false asks 1Click for a real quote with a one-time deposit address
 *
 * The recipient is always the relayer account from RELAYER_ACCOUNT_ID; nothing in the body
 * can change it.
 *
 * 200 GasQuote                       dry: the estimate; real: plus depositAddress and deadline
 * 400 bad_request { message, field }  failed validation or out of bounds
 * 422 intents_refused { message }     1Click's own refusal, in its words ("refundTo is not valid")
 * 429 rate limited · 502 intents_unavailable · 503 intents_not_configured or no price
 */
import { badRequest, clientIp, handle, json, readText, assertJson } from "@/server/http";
import { quoteInput, quoteRefill, requireGasTank } from "@/server/intents/one-click";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

// Dynamic and never cached: the handler reads the request first (cacheComponents forbids `export const dynamic`), and json() answers no-store.

export const POST = handle("intents/quote", async (request: Request) => {
  const ip = clientIp(request);
  rateLimiter.enforce("intents-quote-ip", ip, RATE_LIMITS.intentsQuotePerIp);
  assertJson(request);
  let raw: unknown;
  try {
    raw = JSON.parse((await readText(request, 2 * 1024)) || "{}");
  } catch {
    throw badRequest("Body is not valid JSON");
  }
  const parsed = quoteInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw badRequest(first?.message ?? "Invalid body", { field: first?.path.join(".") || null });
  }
  const config = requireGasTank();
  if (!parsed.data.dry) rateLimiter.enforce("intents-deposit-ip", ip, RATE_LIMITS.intentsDepositPerIp);
  return json(await quoteRefill(parsed.data, config));
});
