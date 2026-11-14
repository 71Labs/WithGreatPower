/**
 * The first visit, as the README's check 1 and step 1 describe it: /play or "Play now" puts a
 * guest straight into a night as the ready-made hero, with no form first. These run the two
 * decisions the pages act on (the pages themselves are client-rendered, so the live check
 * can only show that /play is served).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { newSave, reduce } from "@wgp/game-core/engine";

import { START_URL } from "@/lib/site";

import { QUICK_HERO } from "./quick-hero";
import { HUB_PATH, NIGHT_PATH, ORIGIN_PATH, START_PATH, noHeroStep, quickStartStep } from "./quick-start-route";

describe("a first visit goes straight into a night", () => {
  it("walks a new guest from /play to the quick start, makes The Node, and opens the night", () => {
    // 1. /play with no hero: a guest is sent to the quick start (the landing's Play now links there directly).
    expect(noHeroStep({ status: "guest", saveLoaded: true, hasHero: false, pathname: "/play" })).toEqual({ kind: "go", to: START_PATH });
    expect(START_URL).toBe(START_PATH);
    // 2. The quick start, still with no hero: it makes one. No form, no other page.
    expect(quickStartStep({ status: "guest", saveLoaded: true, hasHero: false, madeHere: false })).toEqual({ kind: "make-hero" });
    // 3. The rules accept that hero, so the save now has one...
    const save = reduce(newSave(), { type: "create-hero", ...QUICK_HERO });
    expect(save.hero).toMatchObject({ name: "The Node", suit: "classic", level: 1 });
    // 4. ...and the same page, having made it, goes into the night.
    expect(quickStartStep({ status: "guest", saveLoaded: true, hasHero: !!save.hero, madeHere: true })).toEqual({ kind: "go", to: NIGHT_PATH });
    expect(NIGHT_PATH).toBe("/play/patrol");
  });

  it("sends a visitor who already has a hero to Tonight, not into a night", () => {
    expect(quickStartStep({ status: "guest", saveLoaded: true, hasHero: true, madeHere: false })).toEqual({ kind: "go", to: HUB_PATH });
    expect(quickStartStep({ status: "signed-in", saveLoaded: true, hasHero: true, madeHere: false })).toEqual({ kind: "go", to: HUB_PATH });
    expect(noHeroStep({ status: "guest", saveLoaded: true, hasHero: true, pathname: "/play" })).toEqual({ kind: "stay" });
  });

  it("sends a signed-in player with no hero to choose one: their name goes on the boards", () => {
    expect(quickStartStep({ status: "signed-in", saveLoaded: true, hasHero: false, madeHere: false })).toEqual({ kind: "go", to: ORIGIN_PATH });
    for (const pathname of ["/play", "/play/market", "/play/patrol"]) expect(noHeroStep({ status: "signed-in", saveLoaded: true, hasHero: false, pathname })).toEqual({ kind: "go", to: ORIGIN_PATH });
    expect(ORIGIN_PATH).toBe("/play/bitten");
  });

  it("gives a guest who deep-links to another game page the ready hero in place", () => {
    for (const pathname of ["/play/market", "/play/suits", "/play/patrol", "/play/city"]) expect(noHeroStep({ status: "guest", saveLoaded: true, hasHero: false, pathname })).toEqual({ kind: "make-hero" });
  });

  it("starts a guest's deep link to the patrol or the city as the ready hero, not on a Get bitten notice", () => {
    const src = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\s+/g, " ");
    // Every game page acts on the same step: useHeroSave is useNoHeroStep plus "wait for the hero".
    const ui = src("components/game/ui.tsx");
    expect(ui).toContain("export function useNoHeroStep(): Save | null {");
    expect(ui).toMatch(/export function useHeroSave\(\): HeroSave \| null \{ const save = useNoHeroStep\(\);/);
    // The 3D patrol and the city boot from the save themselves, so they call it directly...
    const night = src("app/play/patrol/night.tsx");
    const city = src("app/play/city/city.tsx");
    expect(night).toContain("const save = useNoHeroStep();");
    expect(city).toContain("const save = useNoHeroStep();");
    // ...and wait while it makes the hero (or sends a signed-in player to choose one) instead of saying "No hero yet".
    expect(night).toContain("const heroless = !!save && !save.hero;");
    expect(night).toContain('if (phase.kind !== "boot" || account.status === "loading" || heroless) return;');
    expect(city).toContain('else if (!save?.hero) body = <Loading label="Heading into the city…" />;');
    expect(city).not.toContain("Get bitten first");
    // A signed-in player with no hero on either page still goes to choose one.
    for (const pathname of [NIGHT_PATH, "/play/city"]) expect(noHeroStep({ status: "signed-in", saveLoaded: true, hasHero: false, pathname })).toEqual({ kind: "go", to: ORIGIN_PATH });
  });

  it("decides nothing while the account or the save is still loading", () => {
    expect(quickStartStep({ status: "loading", saveLoaded: true, hasHero: false, madeHere: false })).toEqual({ kind: "wait" });
    expect(quickStartStep({ status: "guest", saveLoaded: false, hasHero: false, madeHere: false })).toEqual({ kind: "wait" });
    expect(noHeroStep({ status: "loading", saveLoaded: true, hasHero: false, pathname: "/play" })).toEqual({ kind: "wait" });
    expect(noHeroStep({ status: "guest", saveLoaded: false, hasHero: false, pathname: "/play" })).toEqual({ kind: "wait" });
  });
});
