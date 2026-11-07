import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acceptInvitePath, claimInvite, getInvite, getReferrals, type ReferralsView } from "./api";

/** The referral fetchers against a fake API: paths, methods, bodies, and the error codes screens branch on. */

type Reply = { status: number; body: unknown } | "network";
let routes: Record<string, (body: unknown) => Reply>;
let calls: { method: string; path: string; body: unknown }[];

beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const reply = routes[`${method} ${path}`]?.(body) ?? { status: 404, body: { error: "not_found" } };
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const VIEW: ReferralsView = {
  code: "K7Q2M9X",
  link: "https://www.wgponnear.fun/invite/K7Q2M9X",
  goal: 3,
  qualified: 1,
  invited: [{ handle: "nora", joinedAt: "2026-11-07T10:00:00Z", x: true, played: false, qualified: false }],
  reward: { state: "locked", xp: 300, badge: "recruiter", tx: null },
  referredBy: "sele",
  canClaim: true,
};

describe("GET /api/referrals", () => {
  it("returns the contract's shape", async () => {
    routes["GET /api/referrals"] = () => ({ status: 200, body: VIEW });
    expect(await getReferrals()).toEqual({ ok: true, data: VIEW });
  });

  it("says 401 for a signed-out player, and status 0 offline", async () => {
    routes["GET /api/referrals"] = () => ({ status: 401, body: { error: "unauthorized" } });
    expect(await getReferrals()).toMatchObject({ ok: false, status: 401, error: "unauthorized" });
    routes["GET /api/referrals"] = () => "network";
    expect(await getReferrals()).toEqual({ ok: false, status: 0, error: "network" });
  });
});

describe("GET /api/invite/{code}", () => {
  it("looks a code up, encoded", async () => {
    routes["GET /api/invite/K7Q2M9X"] = () => ({ status: 200, body: { valid: true, referrer: { handle: "sele", heroName: "Ana", suit: "classic" } } });
    expect(await getInvite("K7Q2M9X")).toEqual({ ok: true, data: { valid: true, referrer: { handle: "sele", heroName: "Ana", suit: "classic" } } });
    await getInvite("a/b");
    expect(calls.at(-1)!.path).toBe("/api/invite/a%2Fb");
  });
});

describe("POST /api/referrals/claim", () => {
  it("posts the code and returns the inviter", async () => {
    routes["POST /api/referrals/claim"] = (body) => ({ status: 200, body: { referredBy: (body as { code: string }).code === "K7Q2M9X" ? "sele" : "?" } });
    expect(await claimInvite("K7Q2M9X")).toEqual({ ok: true, data: { referredBy: "sele" } });
    expect(calls[0]).toEqual({ method: "POST", path: "/api/referrals/claim", body: { code: "K7Q2M9X" } });
  });

  it("passes the refusal codes through", async () => {
    for (const [status, error] of [
      [409, "already_referred"],
      [422, "bad_code"],
      [422, "self"],
      [422, "too_late"],
      [422, "cycle"],
    ] as const) {
      routes["POST /api/referrals/claim"] = () => ({ status, body: { error } });
      expect(await claimInvite("K7Q2M9X")).toMatchObject({ ok: false, status, error });
    }
  });
});

describe("accept", () => {
  it("is the server's redirect route for the code", () => {
    expect(acceptInvitePath("K7Q2M9X")).toBe("/api/invite/K7Q2M9X/accept");
  });
});
