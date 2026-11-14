/**
 * GET /api/intents/status?depositAddress=…[&depositMemo=…] → 200 RefillStatus
 * Where a gas-tank refill stands at NEAR Intents' 1Click API: PENDING_DEPOSIT,
 * KNOWN_DEPOSIT_TX, PROCESSING, SUCCESS, INCOMPLETE_DEPOSIT, REFUNDED or FAILED, with a label
 * in words and `final` once nothing more will happen. Public, never cached.
 * 400 bad address · 404 unknown to 1Click · 429 rate limited · 502 intents_unavailable
 */
import { badRequest, clientIp, handle, json } from "@/server/http";
import { depositAddressSchema, refillStatus, requireGasTank } from "@/server/intents/one-click";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

// Dynamic and never cached: the handler reads the request first (cacheComponents forbids `export const dynamic`), and json() answers no-store.

export const GET = handle("intents/status", async (request: Request) => {
  rateLimiter.enforce("intents-status-ip", clientIp(request), RATE_LIMITS.intentsStatusPerIp);
  const params = new URL(request.url).searchParams;
  const address = depositAddressSchema.safeParse(params.get("depositAddress") ?? "");
  if (!address.success) throw badRequest(address.error.issues[0]?.message ?? "That isn’t a deposit address.");
  const memoRaw = params.get("depositMemo");
  const memo = memoRaw ? depositAddressSchema.safeParse(memoRaw) : null;
  if (memo && !memo.success) throw badRequest("That isn’t a deposit memo.");
  const config = requireGasTank();
  return json(await refillStatus(address.data, memo?.data ?? null, { jwt: config.jwt }));
});
