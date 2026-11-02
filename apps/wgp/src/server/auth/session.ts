/**
 * Cookie sessions. The cookie holds 32 random bytes; the database holds only their
 * SHA-256, so a leaked table can't be replayed as cookies. HttpOnly, SameSite=Lax,
 * Secure in production (with the __Host- prefix), 30 days.
 *
 * Chain's sign-in routes call `createSession(player.id, request)` after verifying the
 * login; everything else calls `getSession(request)` or `requireSession(request)`.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb, type Db } from "@/server/db/client";
import { authSessions, players, type Player } from "@/server/db/schema";
import { HttpError, clientIp, unauthorized } from "@/server/http";

import { hmacHex, secret } from "./secrets";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionCookieName(env: Record<string, string | undefined> = process.env): string {
  return env.NODE_ENV === "production" ? "__Host-wgp_session" : "wgp_session";
}

export interface Session {
  /** SHA-256 of the cookie value: the row id. */
  idHash: string;
  playerId: string;
  player: Pick<Player, "id" | "handle" | "nearAccountId" | "authKind" | "bannedAt" | "migratedLocalAt" | "createdAt">;
  expiresAt: Date;
}

export interface SessionMeta {
  ua?: string | null;
  ip?: string | null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/* ------------------------------------------------------------------ storage (testable without Next) */

/** Stores a new session and returns the cookie value. */
export async function issueSession(db: Db, playerId: string, meta: SessionMeta = {}, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(authSessions).values({
    idHash: hashToken(token),
    playerId,
    createdAt: now,
    expiresAt,
    ua: meta.ua ? meta.ua.slice(0, 256) : null,
    ipHash: meta.ip ? hmacHex(secret("AUTH_SECRET"), "session-ip", meta.ip) : null,
  });
  return { token, expiresAt };
}

/** The live session for a cookie value, or null if it's unknown or expired. */
export async function readSession(db: Db, token: string, now = new Date()): Promise<Session | null> {
  if (!token || token.length > 128) return null;
  const idHash = hashToken(token);
  const [row] = await db
    .select({
      idHash: authSessions.idHash,
      expiresAt: authSessions.expiresAt,
      player: {
        id: players.id,
        handle: players.handle,
        nearAccountId: players.nearAccountId,
        authKind: players.authKind,
        bannedAt: players.bannedAt,
        migratedLocalAt: players.migratedLocalAt,
        createdAt: players.createdAt,
      },
    })
    .from(authSessions)
    .innerJoin(players, eq(players.id, authSessions.playerId))
    .where(and(eq(authSessions.idHash, idHash), gt(authSessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  return { idHash: row.idHash, playerId: row.player.id, player: row.player, expiresAt: row.expiresAt };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  if (!token) return;
  await db.delete(authSessions).where(eq(authSessions.idHash, hashToken(token)));
}

/** The session cookie's value from a request's Cookie header. */
export function sessionToken(request: Request, env: Record<string, string | undefined> = process.env): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = sessionCookieName(env);
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim()) || null;
  }
  return null;
}

/* ------------------------------------------------------------------ request helpers */

function cookieOptions(expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production";
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", expires: expiresAt };
}

/**
 * Signs `playerId` in: stores a session and sets the cookie on the response. Call it in
 * a Route Handler or Server Action after the login is verified.
 */
export async function createSession(playerId: string, request?: Request): Promise<{ expiresAt: Date }> {
  const db = await getDb();
  const meta: SessionMeta = request ? { ua: request.headers.get("user-agent"), ip: clientIp(request) } : {};
  const { token, expiresAt } = await issueSession(db, playerId, meta);
  const jar = await cookies();
  jar.set(sessionCookieName(), token, cookieOptions(expiresAt));
  return { expiresAt };
}

/** The signed-in session for this request, or null. */
export async function getSession(request: Request): Promise<Session | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return readSession(await getDb(), token);
}

/** The session, or a 401; banned players get a 403. */
export async function requireSession(request: Request): Promise<Session> {
  const session = await getSession(request);
  if (!session) throw unauthorized();
  if (session.player.bannedAt) throw new HttpError(403, "banned", "This account is suspended");
  return session;
}

/** Signs out: deletes the stored session and clears the cookie. */
export async function destroySession(request: Request): Promise<void> {
  const token = sessionToken(request);
  if (token) await revokeSession(await getDb(), token);
  const jar = await cookies();
  jar.set(sessionCookieName(), "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}
