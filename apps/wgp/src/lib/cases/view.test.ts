import { describe, expect, it } from "vitest";

import { xLength } from "@/lib/social/x";
import { FIXTURE_TICKS, chapterFixture, withChapterFixture } from "./fixtures";
import { CASE_001, CLUES, caseShareText } from "./content";
import { rugLeadFor } from "./local";
import type { CaseRecordApi, ChapterFrame, ChapterRenderFrame } from "./types";

/** A GET /api/cases entry. */
const api = (over: Partial<CaseRecordApi> = {}): CaseRecordApi => ({
  id: "case-001",
  number: "001",
  title: "Missing: Mary Jpeg",
  status: "new",
  clearedAt: null,
  bestTicks: null,
  badge: { status: "none", tokenId: "trophy:badge:case-001", tx: null },
  active: null,
  ...over,
});
import { badgeView, bestTicks, caseStatus, chapterHud, chapterLine, formatTicks, isChapterEvent, objective, spokenTicks, txUrl, villainCue } from "./view";

const frame = (chapter: Partial<ChapterFrame> | null, villains: ChapterRenderFrame["villains"] = []): Pick<ChapterRenderFrame, "chapter" | "villains"> => ({
  villains,
  chapter: chapter
    ? {
        id: "case-001",
        phase: "investigate",
        clues: [
          { id: "tabs", pos: { x: 0, y: 0, z: 0 }, found: false },
          { id: "cursor", pos: { x: 0, y: 0, z: 0 }, found: false },
          { id: "pixels", pos: { x: 0, y: 0, z: 0 }, found: false },
        ],
        captive: null,
        copies: [],
        ...chapter,
      }
    : null,
});

describe("objective", () => {
  it("counts the clues while investigating", () => {
    expect(objective({ phase: "investigate", found: 0, total: 3 }).text).toBe("Find the clues 0/3");
    expect(objective({ phase: "investigate", found: 1, total: 3 })).toEqual({ text: "Find the clues 1/3", label: "Find the clues", count: { found: 1, total: 3 } });
  });

  it("names the fight, the rescue and the end", () => {
    expect(objective({ phase: "standoff", found: 3, total: 3 }).text).toBe("Stop the Right-Clicker");
    expect(objective({ phase: "rescue", found: 3, total: 3 }).text).toBe("Restore Mary");
    expect(objective({ phase: "done", found: 3, total: 3 })).toEqual({ text: "Case closed", label: "Case closed", count: null });
  });
});

describe("caseStatus", () => {
  it("is new with nothing on record", () => {
    expect(caseStatus({})).toBe("new");
    expect(caseStatus({ api: api() })).toBe("new");
  });

  it("is in progress once started in this browser, or with a run in flight on the server", () => {
    expect(caseStatus({ local: { startedAt: 1 } })).toBe("in-progress");
    expect(caseStatus({ api: api({ active: { runId: "r1", expiresAt: "2026-11-05T22:00:00.000Z" } }) })).toBe("in-progress");
  });

  it("is closed by any clear: the server, the save or this browser", () => {
    expect(caseStatus({ api: api({ status: "cleared", bestTicks: 900 }), local: { startedAt: 1 } })).toBe("closed");
    expect(caseStatus({ saved: { cleared: true, bestTicks: 900 } })).toBe("closed");
    expect(caseStatus({ local: { startedAt: 1, cleared: true } })).toBe("closed");
  });

  it("keeps the best time from any source", () => {
    expect(bestTicks({})).toBeNull();
    expect(bestTicks({ api: api({ status: "cleared", bestTicks: 9000 }), local: { bestTicks: 8000 } })).toBe(8000);
    expect(bestTicks({ saved: { cleared: true, bestTicks: 0 } })).toBeNull();
  });
});

describe("badgeView", () => {
  it("asks guests to sign in, closed or not", () => {
    expect(badgeView({ signedIn: false, status: "new" })).toMatchObject({ kind: "sign-in", label: "Sign in to file the case" });
    expect(badgeView({ signedIn: false, status: "closed" })).toMatchObject({ kind: "sign-in", label: "Sign in to file the case" });
  });

  it("is locked until the case is closed", () => {
    expect(badgeView({ signedIn: true, status: "in-progress", badge: { status: "none", tx: null } }).kind).toBe("locked");
  });

  it("says queued, then minted with a NearBlocks link", () => {
    expect(badgeView({ signedIn: true, status: "closed", badge: { status: "queued", tx: null } })).toMatchObject({ kind: "queued", label: "Badge queued" });
    const minted = badgeView({ signedIn: true, status: "closed", badge: { status: "minted", tx: "abc123" } });
    expect(minted).toMatchObject({ kind: "minted", label: "Badge minted" });
    expect(minted.kind === "minted" && minted.href).toMatch(/nearblocks\.io\/txns\/abc123$/);
    expect(badgeView({ signedIn: true, status: "closed", badge: { status: "minted", tx: null } })).toMatchObject({ kind: "minted", href: null });
  });

  it("is on its way for a clear the server hasn't queued yet, and unknown when the server didn't answer", () => {
    expect(badgeView({ signedIn: true, status: "closed", badge: { status: "none", tx: null } }).kind).toBe("pending");
    expect(badgeView({ signedIn: true, status: "closed", failed: true }).kind).toBe("unknown");
  });

  it("escapes the transaction hash in the link", () => {
    expect(txUrl("a/b")).toMatch(/\/txns\/a%2Fb$/);
  });
});

describe("times", () => {
  it("formats ticks as m:ss.t", () => {
    expect(formatTicks(0)).toBe("0:00.0");
    expect(formatTicks(60)).toBe("0:01.0");
    expect(formatTicks(FIXTURE_TICKS)).toBe("4:16.4");
    expect(formatTicks(60 * 61 + 30)).toBe("1:01.5");
  });

  it("says them in words", () => {
    expect(spokenTicks(FIXTURE_TICKS)).toBe("4 minutes 16.4 seconds");
    expect(spokenTicks(60)).toBe("1 second");
  });
});

describe("chapterHud", () => {
  it("is null on a normal night", () => {
    expect(chapterHud(frame(null))).toBeNull();
  });

  it("counts found clues and leaves the villain out before the standoff", () => {
    const hud = chapterHud(frame({ clues: [{ id: "tabs", pos: { x: 0, y: 0, z: 0 }, found: true }, ...frame({})!.chapter!.clues.slice(1)] }));
    expect(hud).toMatchObject({ phase: "investigate", found: 1, total: 3, villain: null, restore: null, freed: false });
  });

  it("reads the Right-Clicker's state in the standoff", () => {
    const rc = { id: "right-clicker" as const, copy: false, pos: { x: 0, y: 0, z: 0 }, hits: 6, hitsMax: 8, state: "aim", aim: { dir: { x: 1, y: 0, z: 0 }, half: 0.4 } };
    expect(chapterHud(frame({ phase: "standoff" }, [rc]))?.villain).toEqual({ phase: "aim", hits: 6, hitsMax: 8, open: false });
    expect(chapterHud(frame({ phase: "standoff" }, [{ ...rc, state: "windup" }]))?.villain?.phase).toBe("idle");
    expect(chapterHud(frame({ phase: "standoff" }, [{ ...rc, state: "recover" }]))?.villain?.open).toBe(true);
    // Webbed: beaten, so no bar.
    expect(chapterHud(frame({ phase: "standoff" }, [{ ...rc, state: "webbed" }]))?.villain).toBeNull();
  });

  it("takes what only the sim knows from its HUD: open, beside Mary, SAVED", () => {
    const rc = { id: "right-clicker" as const, copy: false, pos: { x: 0, y: 0, z: 0 }, hits: 3, hitsMax: 8, state: "idle" };
    const sim = {
      id: "case-001" as const,
      phase: "standoff" as const,
      cluesFound: 3,
      clues: 3,
      villain: { name: "The Right-Clicker", hits: 3, hitsMax: 8, state: "idle", open: true, guard: false },
      saved: true,
      restore: 0,
      beside: true,
      freed: false,
    };
    expect(chapterHud(frame({ phase: "standoff" }, [rc]), sim)).toMatchObject({ villain: { open: true }, saved: true, beside: true });
  });

  it("rounds the restore to a percent, only in the rescue", () => {
    expect(chapterHud(frame({ phase: "rescue", captive: { pos: { x: 0, y: 0, z: 0 }, restore: 0.4567, freed: false } }))?.restore).toBe(0.46);
    expect(chapterHud(frame({ phase: "done", captive: { pos: { x: 0, y: 0, z: 0 }, restore: 1, freed: true } }))).toMatchObject({ restore: null, freed: true });
  });
});

describe("villainCue", () => {
  it("warns while he aims and opens up while he reloads", () => {
    expect(villainCue("aim")).toEqual({ text: "Saving…", tone: "warn" });
    // Aim shows over a flinch: still Saving…, open or not.
    expect(villainCue("aim", true)).toEqual({ text: "Saving…", tone: "warn" });
    expect(villainCue("recover")).toEqual({ text: "Open: hit him", tone: "open" });
    expect(villainCue("idle", true)).toEqual({ text: "Open: hit him", tone: "open" });
    expect(villainCue("idle")).toBeNull();
    expect(villainCue("webbed")).toBeNull();
  });
});

describe("chapter events", () => {
  it("knows its own events", () => {
    expect(isChapterEvent({ type: "clue-found" })).toBe(true);
    expect(isChapterEvent({ type: "thwip" })).toBe(false);
  });

  it("reads each clue's case note", () => {
    for (const c of CLUES) expect(chapterLine({ type: "clue-found", id: c.id, x: 0, y: 0, z: 0, found: 2, of: 3 })?.text).toContain(c.note);
    expect(chapterLine({ type: "clue-found", id: "tabs", x: 0, y: 0, z: 0, found: 2, of: 3 })?.text).toMatch(/^Clue 2 of 3 found: torn tabs/);
    expect(chapterLine({ type: "screenshot", hit: true, x: 0, y: 0, z: 0 })).toEqual({ text: "Saved! Frozen for a second.", urgent: true });
    expect(chapterLine({ type: "captive-restore", p: 0.5 })).toBeNull();
  });
});

describe("fixtures", () => {
  it("lay a chapter over a frame without touching it", () => {
    const city = { buildings: [], bridge: null } as unknown as Parameters<typeof chapterFixture>[1];
    const fx = chapterFixture("standoff", city, { x: 10, y: 0, z: 10 });
    expect(fx.villain?.state).toBe("aim");
    const base = { villains: [], chapter: undefined } as unknown as Parameters<typeof withChapterFixture>[0];
    const out = withChapterFixture(base, fx) as unknown as ChapterRenderFrame;
    expect(out.chapter?.phase).toBe("standoff");
    expect(base.villains).toHaveLength(0);
  });
});

describe("copy", () => {
  it("shares the spec's line under X's limit", () => {
    const text = caseShareText("https://www.wgponnear.fun/play/cases/001");
    expect(text).toBe("I found Mary Jpeg in With Great Power. Case file 001: closed 🕸️ https://www.wgponnear.fun/play/cases/001");
    expect(xLength(text)).toBeLessThanOrEqual(280);
  });

  it("keeps the case's words in sentence case with curly quotes", () => {
    const words = [CASE_001.summary, CASE_001.bearsonLine, CASE_001.gone.dek, CASE_001.found.dek, ...CASE_001.found.story("The Node"), ...CLUES.map((c) => c.note)];
    for (const w of words) expect(w).not.toMatch(/["']/);
  });

  it("leads the Rug with a clear until the next edition", () => {
    const marks = { cases: {}, rugLead: { id: "case-001", edition: 4, hero: "Pat" } };
    expect(rugLeadFor(marks, 4)).toEqual(marks.rugLead);
    expect(rugLeadFor(marks, 5)).toBeNull();
    expect(rugLeadFor({ cases: {}, rugLead: null }, 1)).toBeNull();
  });
});
