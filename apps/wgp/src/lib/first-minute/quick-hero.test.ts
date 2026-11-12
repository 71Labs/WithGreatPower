import { describe, expect, it } from "vitest";

import { STARTER_POWERS, SUITS } from "@wgp/game-core/data";
import { newSave, reduce } from "@wgp/game-core/engine";

import type { Hero, Save } from "@wgp/game-core/types";

import { HERO_NAME_MAX, QUICK_HERO, cleanHeroName, personalize } from "./quick-hero";

const quickSave = () => reduce(newSave(), { type: "create-hero", ...QUICK_HERO }) as Save & { hero: Hero };

describe("the quick-start hero", () => {
  it("is a hero the rules accept: a starter suit and three starter powers", () => {
    expect(SUITS[QUICK_HERO.suit].starter).toBe(true);
    expect(new Set(QUICK_HERO.powers).size).toBe(3);
    for (const p of QUICK_HERO.powers) expect(STARTER_POWERS).toContain(p);
    const save = reduce(newSave(), { type: "create-hero", ...QUICK_HERO });
    expect(save.hero?.name).toBe("The Node");
    expect(save.hero?.loadout).toEqual(QUICK_HERO.powers);
    expect(save.suits).toEqual([QUICK_HERO.suit]);
  });

  it("can start its first night straight away", () => {
    const save = reduce(reduce(newSave(), { type: "create-hero", ...QUICK_HERO }), { type: "start-patrol" });
    expect(save.patrol?.phase).toBe("swing");
    expect(save.patrol?.stops).toHaveLength(4);
  });

  it("cleans a name the way the reducer does", () => {
    expect(cleanHeroName("  Peter Parquet  ")).toBe("Peter Parquet");
    expect(cleanHeroName("x".repeat(40))).toHaveLength(HERO_NAME_MAX);
    expect(cleanHeroName("   ")).toBe("");
  });
});

describe("making the quick-start hero yours", () => {
  it("renames the hero and swaps the starter suit, and nothing else", () => {
    const save = quickSave();
    const next = personalize(save, "  Peter Parquet ", "mint");
    expect(next.hero.name).toBe("Peter Parquet");
    expect(next.hero.suit).toBe("mint");
    expect(next.suits).toEqual(["mint"]);
    expect({ ...next, hero: { ...next.hero, name: save.hero.name, suit: save.hero.suit }, suits: save.suits }).toEqual(save);
  });

  it("keeps the name when none is given", () => {
    expect(personalize(quickSave(), "   ", "classic").hero.name).toBe("The Node");
  });

  it("never hands out a suit that isn't a starter", () => {
    const next = personalize(quickSave(), "Miles Mempool", "sesame");
    expect(next.hero.suit).toBe("classic");
    expect(next.suits).toEqual(["classic"]);
  });

  it("leaves the wardrobe alone once the player owns more than the starter", () => {
    const save = { ...quickSave(), suits: ["classic", "midnight"] } as Save & { hero: Hero };
    const next = personalize(save, "Gwen Gas", "snow");
    expect(next.hero.name).toBe("Gwen Gas");
    expect(next.hero.suit).toBe("classic");
    expect(next.suits).toEqual(["classic", "midnight"]);
  });
});
