/**
 * The Suit lab's crafting cost, rendered to markup: with `craft_bits` 0 nothing about Bits
 * shows; with it set, the recipe prints "Costs N Bits", and Craft is off with the reason in
 * words (and the way to earn Bits offered) while the player can't pay. Also Gwei's patter,
 * which must name the market's live gas fee.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { newSave, reduce } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import type { HeroSave } from "@/components/game/ui";
import { vendorAfter, vendorLine } from "@/components/market/copy";
import { craftCost, craftGate, type CraftWallet } from "@/lib/market/craft";

import { Recipe, RecipeCounts, SuitSheet, type CraftBits } from "./suit-lab";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};

function hero(inventory: Save["inventory"], level = 3): HeroSave {
  const made = reduce(newSave(), { type: "create-hero", name: "Peter", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
  return { ...made, inventory, hero: { ...made.hero!, level } } as HeroSave;
}

const bitsFor = (craftBits: number, wallet: CraftWallet): CraftBits => {
  const cost = craftCost("stealth", { craftBits });
  return { cost, gate: craftGate(cost, wallet), bits: cost > 0 && wallet.kind === "known" ? wallet.bits : null };
};
const known = (bits: number, onChain = false, signs = false): CraftWallet => ({ kind: "known", bits, onChain, signs });

function sheet(save: HeroSave, craft: CraftBits) {
  return html(
    createElement(SuitSheet, { save, id: "stealth", open: true, onClose: noop, onCraft: noop, onWear: noop, onChainSuits: null, offerQuickPlay: false, market: null, craft }),
  );
}
/** The Craft button's opening tag. */
const craftButton = (markup: string) => /<button[^>]*>(?:(?!<\/button>).)*Craft Stealth/s.exec(markup)?.[0] ?? "";

describe("with craft_bits 0", () => {
  const ready = hero({ "sybil-goo": 3 });
  const free = bitsFor(0, known(0));

  it("shows no Bits anywhere and Craft is on", () => {
    expect(free).toEqual({ cost: 0, gate: null, bits: null });
    const tile = html(createElement(RecipeCounts, { save: ready, id: "stealth", craft: free }));
    const recipe = html(createElement(Recipe, { save: ready, id: "stealth", craft: free }));
    const out = sheet(ready, free);
    for (const markup of [tile, recipe, out]) {
      expect(text(markup)).not.toMatch(/Bits/);
      expect(markup).not.toContain("data-craft-cost");
    }
    expect(text(out)).toContain("Crafting uses the loot up and puts the suit on.");
    expect(craftButton(out)).not.toBe("");
    expect(craftButton(out)).not.toMatch(/\sdisabled=""/);
  });
});

describe("with craft_bits 250", () => {
  const ready = hero({ "sybil-goo": 3, crumbs: 9 });

  it("prints the cost on the tile and in the recipe, with what the player has", () => {
    const short = bitsFor(250, known(120));
    const tile = html(createElement(RecipeCounts, { save: ready, id: "stealth", craft: short }));
    expect(tile).toContain('data-craft-cost="250"');
    expect(text(tile)).toContain("Costs 250 Bits , you have 120");
    const recipe = text(html(createElement(Recipe, { save: ready, id: "stealth", craft: short })));
    expect(recipe).toContain("Costs 250 Bits");
    expect(recipe).toContain("Burned when you craft, on top of the loot");
    expect(recipe).toContain("120 / 250 not enough");
    expect(text(html(createElement(Recipe, { save: ready, id: "stealth", craft: bitsFor(250, known(300)) })))).toContain("300 / 250 enough");
  });

  it("turns Craft off with the reason printed, and offers the spare loot that sells for Bits", () => {
    const out = sheet(ready, bitsFor(250, known(120)));
    expect(craftButton(out)).toMatch(/\sdisabled=""/);
    expect(craftButton(out)).toContain('aria-describedby="craft-blocked"');
    expect(out).toContain('id="craft-blocked"');
    expect(out).toContain('data-craft-gate="bits"');
    // The sheet's own label agrees with the tile: not "Ready".
    expect(text(out)).toMatch(/^Needs Bits Stealth/);
    expect(text(out)).toContain("Crafting burns 250 Bits and you have 120 Bits. Sell spare loot to Gwei or finish a ranked night for the other 130.");
    // The market loop's offer: crumbs aren't in any recipe this hero still needs nine of.
    expect(text(out)).toContain("Spare loot:");
    expect(out).toContain("/play/market?");
  });

  it("leaves Craft on, with the price on the button, when the player can pay", () => {
    const out = sheet(ready, bitsFor(250, known(300)));
    expect(craftButton(out)).not.toMatch(/\sdisabled=""/);
    expect(text(out)).toMatch(/^Ready Stealth/);
    expect(text(out)).toContain("Craft Stealth · 250 Bits");
    expect(text(out)).toContain("Crafting uses the loot up, burns 250 Bits and puts the suit on.");
    expect(out).not.toContain("craft-blocked");
  });

  it("asks a guest to sign in, and an on-chain player without quick play to turn it on", () => {
    const guest = sheet(ready, bitsFor(250, { kind: "guest" }));
    expect(craftButton(guest)).toMatch(/\sdisabled=""/);
    expect(text(guest)).toContain("Bits come from ranked nights, so sign in to earn them.");
    expect(text(guest)).toContain("Sign in to earn Bits");

    const off = sheet(ready, bitsFor(250, known(900, true, false)));
    expect(craftButton(off)).toMatch(/\sdisabled=""/);
    expect(text(off)).toContain("Crafting burns 250 Bits on NEAR. Turn on quick play to sign the burn.");
    expect(text(off)).toContain("Enable quick play");

    expect(craftButton(sheet(ready, bitsFor(250, known(900, true, true))))).not.toMatch(/\sdisabled=""/);
  });

  it("still shows what's missing for a suit that lacks loot, with the cost in the recipe", () => {
    const out = sheet(hero({ "sybil-goo": 1 }), bitsFor(250, known(120)));
    expect(text(out)).toContain("Needs Sybil goo ×2");
    expect(text(out)).toContain("Costs 250 Bits");
    expect(text(out)).toContain("Swing out for loot");
  });
});

describe("Gwei's patter", () => {
  it("names the market's live gas fee, never a number of its own", () => {
    const lines = (feeBps: number) => Array.from({ length: 12 }, (_, day) => vendorLine(day, feeBps)).join(" ") + " " + vendorAfter("fill", feeBps);
    expect(lines(200)).toContain("A 2% gas fee on everything");
    expect(lines(200)).toContain("minus the 2% gas fee");
    expect(lines(500)).toContain("A 5% gas fee on everything");
    expect(lines(500)).toContain("minus the 5% gas fee");
    expect(lines(500)).not.toMatch(/2%|two percent/i);
    for (const action of ["buy", "sell", "list", "cancel"] as const) expect(vendorAfter(action, 500)).not.toMatch(/%|percent/i);
  });
});
