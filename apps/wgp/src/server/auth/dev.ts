/**
 * Dev sign-in, so the game, runs and boards can be exercised without NEAR Auth. Only
 * when NODE_ENV isn't production AND ALLOW_DEV_AUTH=1; otherwise the route answers 404.
 */
import { z } from "zod";

import type { Db } from "@/server/db/client";
import { findOrCreatePlayer } from "@/server/db/players";
import type { Player } from "@/server/db/schema";

export function devAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ALLOW_DEV_AUTH === "1";
}

export const devLoginBody = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "2–31 characters: a–z, 0–9 and dashes")
    .default("dev-hero"),
});

/** A dev player per handle, under a namespace no real NEAR account uses. */
export function findOrCreateDevPlayer(db: Db, handle: string): Promise<Player> {
  return findOrCreatePlayer(db, { nearAccountId: `${handle}.dev.wgp.testnet`, authKind: "dev", authSub: `dev:${handle}`, handle });
}
