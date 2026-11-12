import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import { afterBuy, buyCost, type Pool } from "@/lib/market/math";
import { explainPrice } from "@/lib/market/reasoning";

import { placeWhy, VendorChips, WHY_CLOSED, whyOpen, WhyPrice, whyReduce, type WhyEvent } from "./why-price";

describe("where the popover goes (placeWhy)", () => {
  // A 1440×900 desktop with the dock's top at 836 and the chips ending at 60.
  const room = { top: 68, right: 1432, bottom: 828, left: 8 };
  const natural = { left: 218, width: 300, height: 190 };

  it("opens below when the whole popover fits there", () => {
    expect(placeWhy({ top: 580, bottom: 602 }, natural, room)).toEqual({ side: "below", dx: 0, dy: 0, maxHeight: null });
  });

  it("flips above a second-row card whose popover would run under the dock", () => {
    expect(placeWhy({ top: 780, bottom: 802 }, natural, room)).toEqual({ side: "above", dx: 0, dy: 0, maxHeight: null });
  });

  it("takes the roomier side and caps the height when neither fits (a phone on its side)", () => {
    const tight = { top: 68, right: 804, bottom: 307, left: 8 };
    expect(placeWhy({ top: 150, bottom: 194 }, natural, tight)).toEqual({ side: "below", dx: 0, dy: 0, maxHeight: 113 });
    expect(placeWhy({ top: 240, bottom: 284 }, natural, tight)).toEqual({ side: "above", dx: 0, dy: 0, maxHeight: 172 });
  });

  it("never caps below a readable height", () => {
    expect(placeWhy({ top: 100, bottom: 144 }, natural, { top: 68, right: 804, bottom: 180, left: 8 }).maxHeight).toBe(96);
  });

  it("slides left off the right edge and right off the left edge", () => {
    expect(placeWhy({ top: 300, bottom: 322 }, { ...natural, left: 1200 }, room).dx).toBe(-68);
    expect(placeWhy({ top: 300, bottom: 322 }, { ...natural, left: -40 }, room).dx).toBe(48);
  });

  it("hangs from the dock's edge when the button itself is under the dock", () => {
    expect(placeWhy({ top: 860, bottom: 882 }, natural, room)).toEqual({ side: "above", dx: 0, dy: -32, maxHeight: null });
  });

  it("keeps the left edge on screen when the popover is wider than the room", () => {
    expect(placeWhy({ top: 300, bottom: 322 }, { left: 20, width: 400, height: 190 }, { top: 0, right: 312, bottom: 600, left: 8 }).dx).toBe(-12);
  });
});

const glider = (): Pool => seededPools().find((p) => p.item === "goblin-glider")!;
function bought(pool: Pool, n: number): Pool {
  let p = pool;
  for (let i = 0; i < n; i++) p = afterBuy(p, 1, buyCost(p, 1)!);
  return p;
}
const why = (pool: Pool, open = true) => explainPrice({ pool, open, feeBps: DEFAULT_PARAMS.feeBps });
const after = (...events: WhyEvent[]) => events.reduce(whyReduce, WHY_CLOSED);

describe("the popover's behaviour (whyReduce)", () => {
  it("opens on hover and closes when the mouse leaves", () => {
    expect(whyOpen(after("enter"))).toBe(true);
    expect(whyOpen(after("enter", "leave"))).toBe(false);
  });

  it("opens on keyboard focus and closes on blur", () => {
    expect(whyOpen(after("focus"))).toBe(true);
    expect(whyOpen(after("focus", "blur"))).toBe(false);
  });

  it("a tap pins it open; a second tap closes it", () => {
    expect(whyOpen(after("press"))).toBe(true);
    expect(whyOpen(after("press", "press"))).toBe(false);
  });

  it("a click while hovering pins it, so it stays when the mouse leaves", () => {
    expect(whyOpen(after("enter", "press", "leave"))).toBe(true);
    // Pressing the pinned one closes it even with the mouse still over it.
    expect(whyOpen(after("enter", "press", "press"))).toBe(false);
  });

  it("Escape or a press elsewhere closes it however it was opened", () => {
    expect(after("enter", "focus", "press", "dismiss")).toEqual(WHY_CLOSED);
  });

  it("tabbing away closes a pinned popover", () => {
    expect(whyOpen(after("focus", "press", "blur"))).toBe(false);
  });
});

describe("WhyPrice", () => {
  const reasoning = why(bought(glider(), 1));

  it("renders a real, collapsed button named for the item, and no popover", () => {
    const html = renderToStaticMarkup(createElement(WhyPrice, { name: "for Goblin glider", reasoning }));
    expect(html).toMatch(/<button type="button" aria-expanded="false"/);
    expect(html).toContain("Why this price?");
    expect(html).toContain("for Goblin glider");
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain("aria-describedby");
  });

  it("open, the button points at a popover holding the headline and every reason", () => {
    const html = renderToStaticMarkup(createElement(WhyPrice, { name: "for Goblin glider", reasoning, defaultOpen: true }));
    const id = /aria-controls="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(`aria-describedby="${id}"`);
    expect(html).toContain(`<div id="${id}" role="tooltip"`);
    expect(html).toContain("Up 14% since I opened.");
    expect(reasoning.reasons.length).toBeGreaterThanOrEqual(2);
    for (const r of reasoning.reasons) expect(html).toContain(r);
  });
});

describe("VendorChips", () => {
  const chips = (pool: Pool, open = true) => renderToStaticMarkup(createElement(VendorChips, { reasoning: why(pool, open) }));

  it("shows nothing while she can trade both ways", () => {
    expect(chips(glider())).toBe("");
  });

  it("labels a sold-out item in words, with an icon", () => {
    const html = chips(bought(glider(), 8));
    expect(html).toContain("Sold out");
    expect(html).toContain("<svg");
    expect(html).not.toContain("Gwei can’t pay");
  });

  it("labels a till that can't pay", () => {
    const html = chips({ ...glider(), bits: 0 });
    expect(html).toContain("Gwei can’t pay");
    expect(html).toContain("<svg");
  });

  it("labels the levels her reasoning names, and only those", () => {
    // Seven of eight is not "running low"; four of eight is; one of eight is "nearly out".
    expect(chips(bought(glider(), 1))).toBe("");
    expect(chips(bought(glider(), 4))).toContain("Running low");
    const last = chips(bought(glider(), 7));
    expect(last).toContain("Nearly out");
    expect(last).not.toContain("Running low");
    expect(chips({ ...glider(), bits: 600 })).toContain("Till running low");
    expect(chips({ ...glider(), bits: 240 })).toContain("Till nearly empty");
    expect(chips({ ...glider(), bits: 601 })).toBe("");
  });

  it("labels a closed market instead", () => {
    const html = chips(bought(glider(), 8), false);
    expect(html).toContain("Closed");
    expect(html).not.toContain("Sold out");
  });
});
