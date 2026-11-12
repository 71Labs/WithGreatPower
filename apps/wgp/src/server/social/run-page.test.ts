import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDb, type Db } from "@/server/db/client";
import { players, runs } from "@/server/db/schema";
import { freshDb, givePlayerHero, heroSave, makePlayer } from "@/server/db/test-helpers";

import { RunCard, renderCard } from "./cards";
import { cardFonts, resetCardFonts } from "./fonts";
import { publicRun } from "./runs";
import { woff2ToSfnt } from "./woff2";

// Outside Next there's no cache to tag; the run page's cached read runs straight through.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, revalidateTag: () => {} }));

const PNG = [0x89, 0x50, 0x4e, 0x47];
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

let db: Db;
let verified: string;
let issued: string;
let playerId: string;

beforeEach(async () => {
  db = await freshDb();
  playerId = (await makePlayer(db, "ana")).id;
  await givePlayerHero(db, playerId, "Ana");
  const at = new Date("2026-11-06T20:00:00Z");
  const base = { playerId, night: 3, seed: 1, ruleset: "test-1", saveRevAtStart: 1, startSave: heroSave("Ana"), issuedAt: at, expiresAt: at };
  [{ id: verified }] = await db.insert(runs).values({ ...base, status: "verified", verifiedScore: 12_340, ticks: 10_800, submittedAt: at, digest: "ab".repeat(32) }).returning({ id: runs.id }) as [{ id: string }];
  [{ id: issued }] = await db.insert(runs).values({ ...base, status: "rejected", rejectReason: "hash_mismatch" }).returning({ id: runs.id }) as [{ id: string }];
});
afterEach(() => setDb(undefined));

describe("a run's public data", () => {
  it("is there for a verified run only", async () => {
    expect(await publicRun(db, verified)).toMatchObject({ runId: verified, score: 12_340, night: 3, handle: "ana", heroName: "Ana", suit: "classic", assist: false });
    expect(await publicRun(db, issued)).toBeNull();
    expect(await publicRun(db, UNKNOWN)).toBeNull();
    expect(await publicRun(db, "not-a-uuid")).toBeNull();
  });

  it("hides a banned player's runs", async () => {
    await db.update(players).set({ bannedAt: new Date() }).where(eq(players.id, playerId));
    expect(await publicRun(db, verified)).toBeNull();
  });
});

describe("the run page", () => {
  const props = (runId: string) => ({ params: Promise.resolve({ runId }), searchParams: Promise.resolve({}) }) as never;

  it("renders a verified run with its score, the replay link and a play button", async () => {
    const { default: RunPage } = await import("@/app/r/[runId]/page");
    const html = renderToStaticMarkup(await RunPage(props(verified)));
    expect(html).toContain("12,340");
    expect(html).toContain("ana");
    expect(html).toContain(`/api/runs/${verified}/replay`);
    // The way in for a visitor with no hero: the quick start, one tap into a night.
    expect(html).toContain('href="/play/start"');
    expect(html).toContain("Replay-verified");
  });

  it("offers the race only for a run that can be raced", async () => {
    const { RunView } = await import("@/components/social/run-view");
    const run = (await publicRun(db, verified))!;
    const raceable = renderToStaticMarkup(RunView({ run, raceable: true }));
    expect(raceable).toContain(`href="/play/compete/race/${verified}"`);
    expect(raceable).toContain("Race this run");
    const not = renderToStaticMarkup(RunView({ run, raceable: false }));
    expect(not).not.toContain("/play/compete/race/");
    expect(not).toContain('href="/play/start"');
  });

  it("answers 404 for unverified and unknown runs", async () => {
    const { default: RunPage } = await import("@/app/r/[runId]/page");
    for (const id of [issued, UNKNOWN, "nope"]) await expect(RunPage(props(id))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("gives X a large image card", async () => {
    const { generateMetadata } = await import("@/app/r/[runId]/page");
    const meta = await generateMetadata(props(verified));
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [expect.objectContaining({ url: `/api/social/card/run/${verified}` })] });
    expect(meta.openGraph).toMatchObject({ images: [expect.objectContaining({ width: 1200, height: 630 })] });
    expect(String(meta.metadataBase)).toBe("https://www.wgponnear.fun/");
  });
});

describe("the run card image", () => {
  const get = async (runId: string) => {
    const { GET } = await import("@/app/api/social/card/run/[runId]/route");
    return GET(new Request(`http://localhost/api/social/card/run/${runId}`), { params: Promise.resolve({ runId }) });
  };

  it("draws a PNG for a verified run, cached for good", async () => {
    const res = await get(verified);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("s-maxage=31536000");
    expect([...new Uint8Array(await res.arrayBuffer()).subarray(0, 4)]).toEqual(PNG);
  });

  it("answers 404 for unverified and unknown runs", async () => {
    expect((await get(issued)).status).toBe(404);
    expect((await get(UNKNOWN)).status).toBe(404);
  });
});

describe("card fonts", () => {
  it("fall back to next/og's bundled font when Neue Montreal isn't deployed", async () => {
    resetCardFonts();
    const empty = await mkdtemp(path.join(tmpdir(), "wgp-fonts-"));
    expect(await cardFonts(null, empty)).toEqual([]);
    await rm(empty, { recursive: true });
    resetCardFonts();
  });

  it("refuse a file that isn't WOFF2", () => {
    expect(() => woff2ToSfnt(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });

  // The licensed files are never committed; this runs where a deploy (or the owner) copied them in.
  const bold = path.join(process.cwd(), "public", "fonts", "NeueMontreal-Bold.woff2");
  it.skipIf(!existsSync(bold))("decode Neue Montreal into a font the card draws with", async () => {
    const sfnt = woff2ToSfnt(await readFile(bold));
    expect([0x00010000, 0x4f54544f]).toContain(sfnt.readUInt32BE(0));
    resetCardFonts();
    const fonts = await cardFonts(null);
    expect(fonts.map((f) => f.weight)).toContain(700);
    const run = (await publicRun(db, verified))!;
    const res = await renderCard(RunCard({ run }));
    expect([...new Uint8Array(await res.arrayBuffer()).subarray(0, 4)]).toEqual(PNG);
    resetCardFonts();
  });
});
