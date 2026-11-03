import { describe, expect, it } from "vitest";

import { WINDOWS, claimWindow } from "./background";
import { freshDb } from "./db/test-helpers";

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
