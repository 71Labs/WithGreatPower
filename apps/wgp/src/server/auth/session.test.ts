import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setDb, type Db } from "@/server/db/client";
import { players } from "@/server/db/schema";
import { freshDb, makePlayer } from "@/server/db/test-helpers";
import { HttpError } from "@/server/http";

const jar = vi.hoisted(() => new Map<string, { value: string; options: Record<string, unknown> }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => jar.set(name, { value, options }),
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
  }),
}));

import {
  SESSION_TTL_MS,
  createSession,
  destroySession,
  getSession,
  issueSession,
  readSession,
  requireSession,
  revokeSession,
  sessionCookieName,
  sessionToken,
} from "./session";

const withCookie = (token: string) => new Request("http://test/api/me", { headers: { cookie: `other=1; ${sessionCookieName()}=${token}` } });

describe("sessions", () => {
  let db: Db;
  let playerId: string;

  beforeEach(async () => {
    jar.clear();
    db = await freshDb();
    playerId = (await makePlayer(db, "alice")).id;
    return () => setDb(undefined);
  });

  it("issues a session that reads back, storing only a hash", async () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const { token, expiresAt } = await issueSession(db, playerId, { ua: "vitest", ip: "1.2.3.4" }, now);
    expect(expiresAt.getTime()).toBe(now.getTime() + SESSION_TTL_MS);

    const session = await readSession(db, token, now);
    expect(session?.playerId).toBe(playerId);
    expect(session?.player.handle).toBe("alice");
    expect(session?.idHash).not.toContain(token);
    expect(session?.idHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unknown, expired and revoked tokens", async () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const { token } = await issueSession(db, playerId, {}, now);
    expect(await readSession(db, "nope", now)).toBeNull();
    expect(await readSession(db, token, new Date(now.getTime() + SESSION_TTL_MS + 1))).toBeNull();
    await revokeSession(db, token);
    expect(await readSession(db, token, now)).toBeNull();
  });

  it("reads the cookie from a request", () => {
    expect(sessionToken(withCookie("abc"))).toBe("abc");
    expect(sessionToken(new Request("http://test/"))).toBeNull();
    expect(sessionCookieName({ NODE_ENV: "production" })).toBe("__Host-wgp_session");
  });

  it("createSession sets an HttpOnly Lax cookie that getSession accepts", async () => {
    await createSession(playerId, new Request("http://test/", { headers: { "user-agent": "vitest" } }));
    const cookie = jar.get(sessionCookieName());
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const session = await getSession(withCookie(cookie!.value));
    expect(session?.playerId).toBe(playerId);
  });

  it("requireSession answers 401 signed out and 403 when banned", async () => {
    await expect(requireSession(new Request("http://test/"))).rejects.toMatchObject({ status: 401 });
    const { token } = await issueSession(db, playerId);
    await db.update(players).set({ bannedAt: new Date() }).where(eq(players.id, playerId));
    const error = await requireSession(withCookie(token)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(403);
  });

  it("destroySession revokes the row and clears the cookie", async () => {
    const { token } = await issueSession(db, playerId);
    await destroySession(withCookie(token));
    expect(await readSession(db, token)).toBeNull();
    expect(jar.get(sessionCookieName())?.value).toBe("");
  });
});
