/**
 * POST /api/auth/near-auth/nonce → 200 { nonce, expiresAt }
 *
 * Starts a Google sign-in through NEAR Auth: a single-use nonce, live for ten minutes,
 * returned here and in an HttpOnly cookie. The browser asks Auth0 to put it in the ID
 * token (`nonce` claim); POST /api/auth/near-auth accepts the token only if that claim
 * equals this cookie and is still unused (src/server/near/login-nonce.ts).
 * 503 near_not_configured when NEAR Auth isn't set up on this server.
 */
import { cookies } from "next/headers";

import { issueNonce } from "@/server/auth/nonces";
import { getDb } from "@/server/db/client";
import { clientIp, handle, json } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { nearAuthEnv } from "@/server/near/env";
import { NEAR_RATE_LIMITS, nearRoute } from "@/server/near/http";
import { nearAuthNonceCookieName } from "@/server/near/login-nonce";

export const POST = handle("auth/near-auth/nonce", (request: Request) =>
  nearRoute(async () => {
    rateLimiter.enforce("near-auth-nonce-ip", clientIp(request), NEAR_RATE_LIMITS.signInPerIp);
    nearAuthEnv();
    const { nonce, expiresAt } = await issueNonce(await getDb(), "near-auth");
    const jar = await cookies();
    jar.set(nearAuthNonceCookieName(), nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
    });
    return json({ nonce, expiresAt: expiresAt.toISOString() });
  }),
);
