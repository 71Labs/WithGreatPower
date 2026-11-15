import { describe, expect, it, vi } from "vitest";

import { NPC_VISIT_GAP_MS, NPC_VISIT_RECHECK_MS, WINDOWS, claimWindow, npcVisitSoon } from "./background";
import { freshDb } from "./db/test-helpers";

/** after() from next/server, recorded instead of run: what a request would leave to do after its response. */
const scheduled = vi.hoisted(() => [] as unknown[]);
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after: (work: unknown) => void scheduled.push(work) }));

describe("background work windows", () => {
  it("lets one caller per window run a job, across callers", async () => {
    const db = await freshDb();
    const t0 = new Date("2026-11-06T20:00:00Z");
    const claims = await Promise.all([claimWindow(db, "sweep", t0), claimWindow(db, "sweep", t0), claimWindow(db, "sweep", t0)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimWindow(db, "sweep", new Date(t0.getTime() + WINDOWS.sweep / 2))).toBe(false);
  });

  it("opens a new window once the old one has passed", async () => {
    const db = await freshDb();
    const t0 = new Date("2026-11-06T20:00:00Z");
    expect(await claimWindow(db, "mint", t0)).toBe(true);
    expect(await claimWindow(db, "mint", new Date(t0.getTime() + WINDOWS.mint))).toBe(true);
  });

  it("keeps each job's window separate", async () => {
    const db = await freshDb();
    const t0 = new Date("2026-11-06T20:00:00Z");
    expect(await claimWindow(db, "sweep", t0)).toBe(true);
    expect(await claimWindow(db, "mint", t0)).toBe(true);
    expect(await claimWindow(db, "marketSnapshot", t0)).toBe(true);
  });
});

describe("Sandwich Man's visit trigger", () => {
  it("asks for a turn after a visit's response, at most once a minute per instance; the 15-minute gap is his lock's", () => {
    expect(NPC_VISIT_GAP_MS).toBe(15 * 60_000);
    const t0 = Date.parse("2030-01-01T00:00:00Z");
    const before = scheduled.length;
    npcVisitSoon(t0);
    npcVisitSoon(t0 + 1_000);
    npcVisitSoon(t0 + NPC_VISIT_RECHECK_MS - 1);
    expect(scheduled.length - before).toBe(1);
    npcVisitSoon(t0 + NPC_VISIT_RECHECK_MS);
    expect(scheduled.length - before).toBe(2);
  });
});
