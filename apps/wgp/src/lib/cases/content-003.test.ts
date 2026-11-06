import { describe, expect, it } from "vitest";

import { CHAPTERS } from "@wgp/game-core/chapters";

import { xLength } from "@/lib/social/x";
import { CASE_003, CASE_003_ID, CASE_003_PATHS, FEE_CLUES, case003ShareText, feeClueCopy } from "./content-003";

describe("case file 003's copy", () => {
  it("matches the game's case: its id, number, title and clues", () => {
    expect(CASE_003_ID).toBe("case-003");
    expect(CASE_003.number).toBe(CHAPTERS["case-003"].number);
    expect(CASE_003.title).toBe(CHAPTERS["case-003"].title);
    expect(FEE_CLUES.map((c) => c.id)).toEqual(CHAPTERS["case-003"].clues.map((c) => c.id));
    for (const c of FEE_CLUES) expect(c.note).toBe(CHAPTERS["case-003"].clues.find((k) => k.id === c.id)!.note);
    expect(feeClueCopy("florist").name).toBe("The florist");
    expect(CASE_003_PATHS).toEqual({ list: "/play/cases", intro: "/play/cases/003", play: "/play/patrol?case=003" });
  });

  it("ties the case to the season's arc: the meter's key is Aunt Mainnet's recipe book, out of the Right-Clicker's Downloads", () => {
    expect(CASE_003.file).toBe("recipes_DO_NOT_SHARE (1).pdf");
    expect(CASE_003.meter.note).toMatch(/Right-Clicker’s Downloads/);
    expect(CASE_003.meter.note).toContain(CASE_003.file);
    expect(CASE_003.tip).toMatch(/Downloads/);
    expect(CASE_003.badge).toBe("Never goes down");
    expect(CASE_003.found.headline).toBe("Fees fall. Loaf rises.");
    expect(CASE_003.found.story("The Node")[1]).toMatch(/“Everybody eats, dear\.”/);
    expect(CASE_003.found.thread).toMatch(/Doc’s Bridge Co\./);
  });

  it("keeps its words in sentence case with curly quotes, and never promises money or prizes", () => {
    const words = [
      CASE_003.summary,
      CASE_003.chaseRule,
      CASE_003.bearsonLine,
      CASE_003.bearsonAside,
      CASE_003.gone.headline,
      CASE_003.gone.dek,
      CASE_003.gone.caption,
      CASE_003.queue.caption,
      CASE_003.queue.line,
      CASE_003.tip,
      CASE_003.open,
      CASE_003.gone.photo,
      CASE_003.found.photo,
      CASE_003.found.headline,
      CASE_003.found.dek,
      CASE_003.found.caption,
      CASE_003.found.story("The Node")[0],
      ...CASE_003.steps,
      ...FEE_CLUES.map((c) => c.where),
    ];
    for (const w of words) {
      expect(w).not.toMatch(/["']/);
      expect(w).not.toMatch(/\b(prize|win money|cash|reward)\b/i);
    }
    // Headlines are stored in sentence case (the Rug sets them in caps with CSS).
    for (const h of [CASE_003.gone.headline, CASE_003.found.headline]) expect(h).not.toBe(h.toUpperCase());
  });

  it("writes a share post that fits on X", () => {
    const text = case003ShareText("https://www.wgponnear.fun/play/cases/003");
    expect(text).toBe("I cooled the fees and got the loaf back in With Great Power. Case file 003: closed 🕸️ https://www.wgponnear.fun/play/cases/003");
    expect(xLength(text)).toBeLessThanOrEqual(280);
  });
});
