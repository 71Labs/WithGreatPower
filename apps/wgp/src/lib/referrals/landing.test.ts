import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLandingInvite, requestOrigin, toLanding } from "./landing";

/**
 * The invite landing (src/app/invite/[code]): its lookup (the server's inviteView, called
 * directly) and the page it draws for a valid, unknown or unanswered code.
 */

let requestHeaders: Headers;
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

type Reply = { status: number; body: unknown } | "network";
let reply: Reply;
let fetched: string[];
// The server read the landing calls: answers `reply`, or throws as a database that's down would.
vi.mock("@/server/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/db/referrals", () => ({
  inviteView: async (_db: unknown, code: string) => {
    fetched.push(code);
    if (reply === "network" || reply.status !== 200) throw new Error("unavailable");
    return reply.body;
  },
}));

beforeEach(() => {
  requestHeaders = new Headers({ host: "127.0.0.1:3970" });
  reply = { status: 200, body: { valid: true, referrer: { handle: "sele", heroName: "Web Weaver", suit: "midnight" } } };
  fetched = [];
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    // next/og loads its own wasm and fonts through fetch (file: URLs): let those through.
    if (!String(url).includes("/api/invite/")) return real(url, init);
    throw new TypeError("the landing must not fetch its own API");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the request's origin", () => {
  it("is http on this machine and https elsewhere, forwarded headers first", async () => {
    expect(await requestOrigin()).toBe("http://127.0.0.1:3970");
    requestHeaders = new Headers({ host: "internal:3000", "x-forwarded-host": "www.wgponnear.fun", "x-forwarded-proto": "https" });
    expect(await requestOrigin()).toBe("https://www.wgponnear.fun");
    requestHeaders = new Headers({ host: "preview.vercel.app" });
    expect(await requestOrigin()).toBe("https://preview.vercel.app");
  });

  it("is null for a host that isn't one", async () => {
    requestHeaders = new Headers({ host: "evil.com/path?x=" });
    expect(await requestOrigin()).toBeNull();
  });
});

describe("the lookup", () => {
  it("asks the server for the code and names the inviter", async () => {
    expect(await loadLandingInvite("k7q2m9x")).toEqual({ state: "valid", code: "K7Q2M9X", referrer: { handle: "sele", heroName: "Web Weaver", suit: "midnight" } });
    expect(fetched).toEqual(["K7Q2M9X"]);
  });

  it("is unknown when the server says so, or the code can't be one (no lookup)", async () => {
    reply = { status: 200, body: { valid: false, referrer: null } };
    expect(await loadLandingInvite("K7Q2M9Y")).toEqual({ state: "unknown", code: "K7Q2M9Y" });
    expect(await loadLandingInvite("not-a-code")).toEqual({ state: "unknown", code: null });
    expect(fetched).toHaveLength(1);
  });

  it("is unavailable when the server can't answer, so the page still offers the invite", async () => {
    for (const r of ["network", { status: 404, body: "<html>" }, { status: 500, body: {} }, { status: 200, body: { nope: 1 } }] as Reply[]) {
      reply = r;
      expect(await loadLandingInvite("K7Q2M9Z")).toEqual({ state: "unavailable", code: "K7Q2M9Z" });
    }
  });

  it("takes a development fixture without a request", async () => {
    expect((await loadLandingInvite("K7Q2M9X", "landing-unknown")).state).toBe("unknown");
    expect((await loadLandingInvite("K7Q2M9X", "landing-unavailable")).state).toBe("unavailable");
    expect((await loadLandingInvite("K7Q2M9X", "landing-valid")).state).toBe("valid");
    expect(fetched).toHaveLength(0);
  });

  it("treats a valid answer without a referrer as unknown", () => {
    expect(toLanding("K7Q2M9X", { valid: true, referrer: null })).toEqual({ state: "unknown", code: "K7Q2M9X" });
  });
});

describe("the landing page", () => {
  const props = (code: string, fixture?: string) => ({ params: Promise.resolve({ code }), searchParams: Promise.resolve(fixture ? { fixture } : {}) }) as never;

  it("shows who invited you, with Start playing through the accept route", async () => {
    const { default: Page } = await import("@/app/invite/[code]/page");
    const html = renderToStaticMarkup(await Page(props("K7Q2M9X")));
    expect(html).toContain("invited you to With Great Power");
    expect(html).toContain(">sele<");
    expect(html).toContain("Their hero: <span");
    expect(html).toContain('href="/api/invite/K7Q2M9X/accept"');
    expect(html).toContain("Start playing");
    expect(html).toContain("you join sele’s crew");
    expect(html).not.toMatch(/\$|usdc|money|cash|prize/i);
  });

  it("names a referrer without a hero yet by handle, in the default suit", async () => {
    reply = { status: 200, body: { valid: true, referrer: { handle: "sele", heroName: null, suit: null } } };
    const { default: Page } = await import("@/app/invite/[code]/page");
    const html = renderToStaticMarkup(await Page(props("K7Q2M9X")));
    expect(html).toContain(">sele<");
    expect(html).toContain('aria-label="sele’s hero"');
    expect(html).not.toContain("Their hero");
    const { default: Image } = await import("@/app/invite/[code]/opengraph-image");
    expect((await Image({ params: Promise.resolve({ code: "K7Q2M9X" }) })).headers.get("content-type")).toBe("image/png");
  });

  it("says an unknown code doesn't work, and offers Play anyway", async () => {
    reply = { status: 200, body: { valid: false, referrer: null } };
    const { default: Page } = await import("@/app/invite/[code]/page");
    const html = renderToStaticMarkup(await Page(props("K7Q2M9X")));
    expect(html).toContain("This invite link doesn’t work");
    expect(html).toContain("K7Q2M9X");
    expect(html).toMatch(/href="\/play"[^>]*>Play anyway/);
    expect(html).not.toContain("/accept");
  });

  it("still offers the invite when the lookup can't answer", async () => {
    reply = "network";
    const { default: Page } = await import("@/app/invite/[code]/page");
    const html = renderToStaticMarkup(await Page(props("K7Q2M9X")));
    expect(html).toContain("You’re invited to With Great Power");
    expect(html).toContain('href="/api/invite/K7Q2M9X/accept"');
    expect(html).toContain("your friend’s crew");
  });

  it("draws its card as a 1200×630 PNG, for a named invite and an unanswered one", async () => {
    const { default: Image, size, contentType } = await import("@/app/invite/[code]/opengraph-image");
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    for (const r of [reply, "network"] as Reply[]) {
      reply = r;
      const res = await Image({ params: Promise.resolve({ code: "K7Q2M9X" }) });
      expect(res.headers.get("content-type")).toBe("image/png");
      expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it("gives X a large image card titled by the inviter, and stays out of search", async () => {
    const { generateMetadata } = await import("@/app/invite/[code]/page");
    const meta = await generateMetadata(props("K7Q2M9X"));
    expect(meta.title).toBe("sele invited you");
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(meta.robots).toEqual({ index: false });
    expect(meta.alternates).toEqual({ canonical: "/invite/K7Q2M9X" });
  });
});
