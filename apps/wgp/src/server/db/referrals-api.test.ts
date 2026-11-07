/**
 * The referral APIs through their real route handlers: the shapes of GET /api/referrals,
 * POST /api/referrals/claim, GET /api/invite/:code and its accept redirect, the admin list and
 * its CSV (404 for everyone but admins, like the social queue), the X handle save's 409
 * x_taken, and the whole campaign end to end: a referrer's link, three friends who arrive
 * through it, sign in, add X and play a night the server verifies with the real replay, and the
 * referrer's page showing 3 of 3 with the Recruiter badge queued.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chooseErrand, needsErrand, runHash, runLog, startRun as startClientRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";

import { issueSession } from "@/server/auth/session";
import { rateLimiter } from "@/server/rate-limit";
import { setVerifier } from "@/server/verify";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
// Board cache tags need Next's request store; a verified run's board refresh is beside the point here.
vi.mock("@/server/db/leaderboard-cache", () => ({ refreshBoards: () => {} }));

import ReferralsAdminPage from "@/app/admin/referrals/page";
import { GET as adminGet } from "@/app/api/admin/referrals/route";
import { POST as devPost } from "@/app/api/auth/dev/route";
import { GET as acceptGet } from "@/app/api/invite/[code]/accept/route";
import { GET as inviteGet } from "@/app/api/invite/[code]/route";
import { PUT as socialPut } from "@/app/api/me/social/route";
import { POST as claimPost } from "@/app/api/referrals/claim/route";
import { GET as referralsGet } from "@/app/api/referrals/route";
import { POST as submitPost } from "@/app/api/runs/[id]/submit/route";
import { POST as startPost } from "@/app/api/runs/start/route";

import { setDb, type Db } from "./client";
import { ensureSave, getPlayer } from "./players";
import { ensureReferralCode, recruiterBadgeKey, referralView } from "./referrals";
import { chainOps, players, referralRewards } from "./schema";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

const ORIGIN = "http://wgp.test";
let db: Db;

beforeEach(async () => {
  rateLimiter.reset();
  setVerifier(undefined);
  db = await freshDb();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setVerifier(undefined);
  setDb(undefined);
  jar.clear();
});

const sessionOf = async (playerId: string) => (await issueSession(db, playerId)).token;

function req(path: string, init: { token?: string; cookie?: string; method?: string; json?: unknown; type?: string } = {}) {
  const cookie = [init.token ? `wgp_session=${init.token}` : null, init.cookie ?? null].filter(Boolean).join("; ");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (init.json !== undefined) headers["content-type"] = init.type ?? "application/json";
  return new Request(`${ORIGIN}${path}`, { method: init.method ?? (init.json !== undefined ? "POST" : "GET"), headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe("GET /api/referrals", () => {
  it("answers 401 signed out and 403 banned", async () => {
    expect((await referralsGet(req("/api/referrals"))).status).toBe(401);
    const p = await makePlayer(db, "bad");
    const token = await sessionOf(p.id);
    await db.update(players).set({ bannedAt: new Date() }).where(eq(players.id, p.id));
    expect((await referralsGet(req("/api/referrals", { token }))).status).toBe(403);
  });

  it("answers the contract's shape, with the link on this request's origin", async () => {
    const p = await makePlayer(db, "sele");
    const res = await referralsGet(req("/api/referrals", { token: await sessionOf(p.id) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    const code = body.code as string;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{7}$/);
    expect(body).toEqual({
      code,
      link: `${ORIGIN}/invite/${code}`,
      goal: 3,
      qualified: 0,
      invited: [],
      reward: { state: "locked", xp: 300, badge: "recruiter", tx: null },
      referredBy: null,
      canClaim: true,
      self: null,
    });
    // The same code on every read.
    expect(((await (await referralsGet(req("/api/referrals", { token: await sessionOf(p.id) }))).json()) as { code: string }).code).toBe(code);
  });
});

describe("POST /api/referrals/claim", () => {
  async function setup() {
    const sele = await makePlayer(db, "sele");
    const code = await ensureReferralCode(db, sele.id);
    const nora = await makePlayer(db, "nora");
    return { sele, code, nora, token: await sessionOf(nora.id) };
  }
  const claim = (token: string | undefined, code: unknown, type?: string) => claimPost(req("/api/referrals/claim", { token, json: { code }, type }));

  it("answers 200 { referredBy } and then 409 already_referred", async () => {
    const { code, nora, token, sele } = await setup();
    const res = await claim(token, code.toLowerCase());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ referredBy: "sele" });
    expect((await getPlayer(db, nora.id))!.referredBy).toBe(sele.id);
    const again = await claim(token, code);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_referred", message: expect.any(String) });
  });

  it("answers 422 bad_code, self, too_late and cycle", async () => {
    const { sele, code, nora, token } = await setup();
    const status = async (res: Response) => [res.status, ((await res.json()) as { error: string }).error];
    expect(await status(await claim(token, "ZZZZZZZ"))).toEqual([422, "bad_code"]);
    expect(await status(await claim(token, await ensureReferralCode(db, nora.id)))).toEqual([422, "self"]);
    await db.update(players).set({ referredBy: nora.id }).where(eq(players.id, sele.id));
    expect(await status(await claim(token, code))).toEqual([422, "cycle"]);
    await db.update(players).set({ referredBy: null }).where(eq(players.id, sele.id));
    await db.update(players).set({ createdAt: new Date(Date.now() - 49 * 3_600_000) }).where(eq(players.id, nora.id));
    expect(await status(await claim(token, code))).toEqual([422, "too_late"]);
  });

  it("answers 401 signed out, 415 to a form post, 400 without a code, and 429 when hammered", async () => {
    const { token } = await setup();
    expect((await claim(undefined, "ZZZZZZZ")).status).toBe(401);
    expect((await claim(token, "ZZZZZZZ", "text/plain")).status).toBe(415);
    expect((await claimPost(req("/api/referrals/claim", { token, json: {} }))).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await claim(token, "ZZZZZZZ")).status);
    expect(statuses).toContain(429);
  });
});

describe("GET /api/invite/:code and its accept", () => {
  it("names the referrer by game handle and hero, cached for a minute", async () => {
    const sele = await makePlayer(db, "sele");
    await givePlayerHero(db, sele.id, "The Node");
    const code = await ensureReferralCode(db, sele.id);
    const res = await inviteGet(req(`/api/invite/${code}`), params({ code: code.toLowerCase() }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    expect(await res.json()).toEqual({ valid: true, referrer: { handle: "sele", heroName: "The Node", suit: "classic" } });
    expect(await (await inviteGet(req("/api/invite/ZZZZZZZ"), params({ code: "ZZZZZZZ" }))).json()).toEqual({ valid: false, referrer: null });
  });

  it("sets the cookie and sends a known code to /play?invited=1, an unknown one to /play", async () => {
    const sele = await makePlayer(db, "sele");
    const code = await ensureReferralCode(db, sele.id);
    const ok = await acceptGet(req(`/api/invite/${code}/accept`), params({ code: code.toLowerCase() }));
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("/play?invited=1");
    expect(ok.headers.get("set-cookie")).toBe(`wgp_ref=${code}; Max-Age=2592000; Path=/; SameSite=Lax; HttpOnly`);
    expect(ok.headers.get("cache-control")).toBe("no-store");

    for (const bad of ["ZZZZZZZ", "not-a-code"]) {
      const res = await acceptGet(req(`/api/invite/${bad}/accept`), params({ code: bad }));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/play");
      expect(res.headers.get("set-cookie")).toBeNull();
    }

    vi.stubEnv("NODE_ENV", "production");
    const secure = await acceptGet(req(`/api/invite/${code}/accept`), params({ code }));
    expect(secure.headers.get("set-cookie")).toMatch(/; Secure$/);
  });
});

describe("the admin list", () => {
  it("answers 404 to guests and non-admins, on the API, the CSV and the page; admins get the list", async () => {
    vi.stubEnv("ADMIN_ACCOUNT_IDS", "boss.wgp.testnet");
    const boss = await makePlayer(db, "boss");
    const ben = await makePlayer(db, "ben");
    const bossToken = await sessionOf(boss.id);
    const benToken = await sessionOf(ben.id);

    expect((await adminGet(req("/api/admin/referrals"))).status).toBe(404);
    expect((await adminGet(req("/api/admin/referrals", { token: benToken }))).status).toBe(404);
    expect((await adminGet(req("/api/admin/referrals?format=csv", { token: benToken }))).status).toBe(404);

    const ok = await adminGet(req("/api/admin/referrals", { token: bossToken }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ admin: "boss.wgp.testnet", referrers: [] });
    const csv = await adminGet(req("/api/admin/referrals?format=csv", { token: bossToken }));
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="wgp-referrals-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect((await csv.text()).startsWith("referrer_handle,referrer_near_account,")).toBe(true);

    // The page: notFound() for anyone but an admin, before anything renders.
    const notFoundDigest = async () => {
      const error = await ReferralsAdminPage().then(
        () => null,
        (e: unknown) => e,
      );
      return (error as { digest?: string } | null)?.digest ?? null;
    };
    expect(await notFoundDigest()).toMatch(/404/);
    jar.set("wgp_session", benToken);
    expect(await notFoundDigest()).toMatch(/404/);
    jar.set("wgp_session", bossToken);
    const page = (await ReferralsAdminPage()) as { props: { admin: string; referrers: unknown[]; goal: number } };
    expect(page.props).toMatchObject({ admin: "boss.wgp.testnet", referrers: [], goal: 3 });
  });
});

describe("PUT /api/me/social", () => {
  it("refuses a handle another player has (409 x_taken), compared lowercased, but lets a player keep theirs", async () => {
    const ana = await makePlayer(db, "ana");
    const ben = await makePlayer(db, "ben");
    const put = async (token: string, xHandle: string | null, xTagOk = false) => socialPut(req("/api/me/social", { token, method: "PUT", json: { xHandle, xTagOk } }));
    const anaToken = await sessionOf(ana.id);
    const benToken = await sessionOf(ben.id);

    expect((await put(anaToken, "@Sele71")).status).toBe(200);
    const taken = await put(benToken, "sele71");
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: "x_taken", field: "xHandle", message: expect.stringContaining("Another player") });
    expect((await put(anaToken, "SELE71", true)).status).toBe(200);

    // Older rows may already share a handle: both may keep it.
    await db.update(players).set({ xHandle: "sele71" }).where(eq(players.id, ben.id));
    expect((await put(benToken, "Sele71", true)).status).toBe(200);
    expect((await put(anaToken, "sele71")).status).toBe(200);

    // Once it's free, anyone may take it.
    await db.update(players).set({ xHandle: null }).where(eq(players.id, ben.id));
    expect((await put(anaToken, null)).status).toBe(200);
    expect((await put(benToken, "sele71")).status).toBe(200);
  });
});

/** Plays a night as the browser would: same save, same seed, the bot's inputs recorded. */
function playNight(save: Save, seed: number) {
  const run = startClientRun(save, seed);
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    if (needsErrand(run)) chooseErrand(run, 0);
    else stepRun(run, botFrame(run.sim, mem));
  }
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

describe("Invite 3 friends, end to end", () => {
  it("three friends arrive by the link, add X and play verified nights; the referrer gets 3/3 and the badge", async () => {
    vi.stubEnv("ALLOW_DEV_AUTH", "1");
    vi.useFakeTimers({ toFake: ["Date"] });
    let clock = new Date("2026-11-08T18:00:00Z").getTime();
    vi.setSystemTime(clock);

    const signIn = async (handle: string, cookie?: string) => {
      jar.delete("wgp_session");
      const res = await devPost(req("/api/auth/dev", { cookie, json: { handle } }));
      expect(res.status).toBe(201);
      const { player } = (await res.json()) as { player: { id: string } };
      return { id: player.id, token: jar.get("wgp_session")! };
    };

    const sele = await signIn("sele");
    await givePlayerHero(db, sele.id, "The Node");
    const page = (await (await referralsGet(req("/api/referrals", { token: sele.token }))).json()) as { code: string; link: string };
    expect(page.link).toBe(`${ORIGIN}/invite/${page.code}`);
    const heroBefore = (await ensureSave(db, sele.id)).save.hero!;

    for (const name of ["nora", "omar", "pia"]) {
      const landing = (await (await inviteGet(req(`/api/invite/${page.code}`), params({ code: page.code }))).json()) as { referrer: { handle: string } };
      expect(landing.referrer.handle).toBe("sele");
      const accepted = await acceptGet(req(`/api/invite/${page.code}/accept`), params({ code: page.code }));
      const refCookie = accepted.headers.get("set-cookie")!.split(";")[0]!;

      const friend = await signIn(name, refCookie);
      expect((await getPlayer(db, friend.id))!.referredBy).toBe(sele.id);
      expect(jar.get("wgp_ref")).toBe("");
      await givePlayerHero(db, friend.id, name);
      expect((await socialPut(req("/api/me/social", { token: friend.token, method: "PUT", json: { xHandle: `${name}_on_x`, xTagOk: false } }))).status).toBe(200);

      const started = (await (await startPost(req("/api/runs/start", { token: friend.token, json: {} }))).json()) as { runId: string; seed: number };
      const played = playNight((await ensureSave(db, friend.id)).save, started.seed);
      clock += Math.ceil(played.ticks / 60) * 1000 + 5000;
      vi.setSystemTime(clock);
      const submitted = await submitPost(
        req(`/api/runs/${started.runId}/submit`, { token: friend.token, json: { log: Buffer.from(played.log).toString("base64"), clientHash: played.hash } }),
        params({ id: started.runId }),
      );
      expect(submitted.status).toBe(200);
      expect(await submitted.json()).toMatchObject({ status: "verified" });
    }

    // The referrer's page counts all three and grants the reward (the background trigger would too).
    const done = (await (await referralsGet(req("/api/referrals", { token: sele.token }))).json()) as Awaited<ReturnType<typeof referralView>>["view"];
    expect(done.qualified).toBe(3);
    expect(done.invited.map((f) => [f.handle, f.x, f.played, f.qualified])).toEqual([
      ["nora", true, true, true],
      ["omar", true, true, true],
      ["pia", true, true, true],
    ]);
    expect(done.reward).toEqual({ state: "queued", xp: 300, badge: "recruiter", tx: null });
    expect(JSON.stringify(done)).not.toContain("_on_x");

    const ops = await db.select().from(chainOps).where(eq(chainOps.dedupeKey, recruiterBadgeKey(sele.id)));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.payload).toMatchObject({ badges: ["recruiter"], items: [], accountId: "sele.dev.wgp.testnet" });
    expect(await db.select().from(referralRewards)).toHaveLength(1);
    const heroAfter = (await ensureSave(db, sele.id)).save.hero!;
    expect(heroAfter.level * 10_000 + heroAfter.xp).toBeGreaterThan(heroBefore.level * 10_000 + heroBefore.xp);

    // A friend's own page: who invited them, and their own steps done (the Tonight checklist goes).
    const nora = await signIn("nora");
    expect(((await (await referralsGet(req("/api/referrals", { token: nora.token }))).json()) as { referredBy: string; canClaim: boolean })).toMatchObject({
      referredBy: "sele",
      canClaim: false,
      self: { x: true, played: true, qualified: true },
    });
  }, 120_000);
});
