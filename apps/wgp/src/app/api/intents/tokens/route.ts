/**
 * GET /api/intents/tokens → 200 { configured, recipient, tokens: GasToken[], minUsd, maxUsd }
 * The Gas tank's curated origin tokens (src/server/intents/one-click.ts) with live decimals
 * and prices from NEAR Intents' 1Click API (kept five minutes on the server), and each
 * token's $1–$50 bounds in its own units. Public, never cached by the CDN.
 * 503 intents_not_configured · 502 intents_unavailable · 429 rate limited
 */
import { clientIp, handle, json } from "@/server/http";
import { gasTokens, MAX_USD, MIN_USD, requireGasTank } from "@/server/intents/one-click";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

// Dynamic and never cached: the handler reads the request first (cacheComponents forbids `export const dynamic`), and json() answers no-store.

export const GET = handle("intents/tokens", async (request: Request) => {
  rateLimiter.enforce("intents-tokens-ip", clientIp(request), RATE_LIMITS.intentsTokensPerIp);
  const config = requireGasTank();
  return json({ configured: true, recipient: config.recipient, minUsd: MIN_USD, maxUsd: MAX_USD, tokens: await gasTokens({ jwt: config.jwt }) });
});
