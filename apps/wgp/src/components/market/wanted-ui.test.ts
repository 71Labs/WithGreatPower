/**
 * Gwei's wanted list on screen, rendered to markup: Tonight's tile (a list, and an empty
 * day) and the results' haul lines.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { seededPools } from "@/lib/market/config";
import { deriveWanted, wantedBonus, type WantedDay } from "@/lib/market/wanted";

import { WantedHaul, WantedTileView, wantedMeta } from "./wanted-tile";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function today(): WantedDay {
  const pools = seededPools().map((p) => (p.item === "crumbs" ? { ...p, stock: 0, bits: 900 } : p.item === "press-pass" ? { ...p, stock: 15, bits: 1029 } : p));
  return { day: "2026-11-15", at: "2026-11-15T00:00:05.000Z", onChain: true, items: deriveWanted({ pools, open: true, feeBps: 200 }) };
}

describe("Tonight's wanted list tile", () => {
  it("names each wanted item with its multiplier and why, and links to the market", () => {
    const html = renderToStaticMarkup(createElement(WantedTileView, { list: today() }));
    expect(html).toContain('href="/play/market"');
    expect(text(html)).toContain("Gwei’s wanted list");
    expect(text(html)).toContain("Crumbs ×3 : Sold out: 0 of the 40 she opened with");
    expect(text(html)).toContain("Press pass ×2 : Running low: 15 of the 20 she opened with");
    expect(text(html)).toContain(wantedMeta(today()));
  });

  it("says so when she's short of nothing", () => {
    const html = renderToStaticMarkup(createElement(WantedTileView, { list: { ...today(), items: [] } }));
    expect(text(html)).toContain("Nothing short today. Her stalls are stocked, so no bonus tonight.");
    expect(html).not.toContain('role="list"');
  });
});

describe("the results' wanted haul", () => {
  it("prints one line per wanted item the night brought", () => {
    const bonus = wantedBonus(today().items, { crumbs: 1, "press-pass": 2, "fee-bomb": 4 });
    const html = renderToStaticMarkup(createElement(WantedHaul, { wanted: bonus }));
    expect(text(html)).toContain("Gwei wanted crumbs: ×3 → you brought 3");
    expect(text(html)).toContain("1 dropped, +2 from her list.");
    expect(text(html)).toContain("Gwei wanted press passes: ×2 → you brought 4");
    expect(text(html)).not.toContain("fee bomb");
  });

  it("prints nothing when the night brought none of them", () => {
    expect(renderToStaticMarkup(createElement(WantedHaul, { wanted: [] }))).toBe("");
  });
});
