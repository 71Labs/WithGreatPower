/**
 * Who may run the social queue: players whose NEAR account id is in ADMIN_ACCOUNT_IDS
 * (comma-separated, e.g. "sele71.near,sele.wgpnear.near"). Everyone else, signed in or
 * not, is answered 404 by the page and the API alike, so the queue doesn't advertise
 * itself. Unset or empty, nobody is an admin.
 */
import { getDb, type Db } from "@/server/db/client";
import { notFound } from "@/server/http";
import { getSession, readSession, type Session } from "@/server/auth/session";

type Env = Record<string, string | undefined>;

/** The allowlisted account ids, lowercased. */
export function adminAccountIds(env: Env = process.env): Set<string> {
  return new Set(
    (env.ADMIN_ACCOUNT_IDS ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminSession(session: Session | null, env: Env = process.env): session is Session {
  return !!session && !session.player.bannedAt && adminAccountIds(env).has(session.player.nearAccountId.toLowerCase());
}

/** The admin's session for an API request, or a 404 for anyone else. */
export async function requireAdmin(request: Request, env: Env = process.env): Promise<Session> {
  const session = await getSession(request);
  if (!isAdminSession(session, env)) throw notFound();
  return session;
}

/** The admin's session for a cookie value (the admin page reads it from next/headers), or null. */
export async function adminForToken(token: string | undefined, db?: Db, env: Env = process.env): Promise<Session | null> {
  if (!token) return null;
  const session = await readSession(db ?? (await getDb()), token);
  return isAdminSession(session, env) ? session : null;
}
