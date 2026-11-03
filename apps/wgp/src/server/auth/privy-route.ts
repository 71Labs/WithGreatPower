/**
 * Route glue shared by POST /api/auth/privy and /api/auth/privy/claim: Privy and NEAR
 * errors mapped to HTTP, the verified identity, and the account factory with its limits
 * (a burst limit per IP and the durable daily budget, as NEAR Auth sign-up has).
 */
import type { Db } from "@/server/db/client";
import { rateLimiter } from "@/server/rate-limit";
import { createPlayerAccount, factoryState, inspectAccount } from "@/server/near/factory";
import { NEAR_BUDGETS, NEAR_RATE_LIMITS, nearRoute, spend } from "@/server/near/http";

import { privyEnv, privyPort, readPrivyIdentity, toPrivyHttpError, verifyPrivyLogin, type PrivyIdentity } from "./privy";
import type { AccountFactory } from "./privy-sign-in";

/** Runs a route body, mapping Privy and NEAR errors. Wrap it in `handle()` from server/http. */
export function privyRoute(fn: () => Promise<Response>): Promise<Response> {
  return nearRoute(async () => {
    try {
      return await fn();
    } catch (error) {
      throw toPrivyHttpError(error);
    }
  });
}

/** The identity behind a Privy access token, read from Privy. */
export async function identityFromToken(accessToken: string): Promise<PrivyIdentity> {
  const env = privyEnv();
  return verifyPrivyLogin(accessToken, { port: await privyPort(env), appId: env.appId });
}

/** A known Privy user, read from Privy again. */
export async function identityOf(userId: string): Promise<PrivyIdentity> {
  return readPrivyIdentity(userId, { port: await privyPort(privyEnv()) });
}

/** The account factory when it's live on chain, else null (sign-up falls back to the implicit account). */
export async function openFactory(db: Db, ip: string): Promise<AccountFactory | null> {
  const state = await factoryState();
  if (!state.open) return null;
  return {
    parentId: state.parentId,
    inspect: inspectAccount,
    async create(input) {
      rateLimiter.enforce("privy-signup-ip", ip, NEAR_RATE_LIMITS.signUpPerIp);
      const release = await spend(db, "chain:accounts", "global", NEAR_BUDGETS.accountsPerDay(), 1);
      try {
        return await createPlayerAccount(input);
      } catch (error) {
        await release(1);
        throw error;
      }
    },
  };
}
