/**
 * Where a visitor without a hero goes, as two pure decisions the pages act on:
 *
 * - `quickStartStep`: /play/start, where the landing's "Play now" leads
 *   (components/first-minute/quick-start.tsx);
 * - `noHeroStep`: any other game page that needs a hero (components/game/ui.tsx `useHeroSave`).
 *
 * Together they are the first visit the README describes: /play or Play now puts a guest
 * straight into a night as the ready-made hero, with no form first, and a signed-in player
 * with no hero chooses theirs at /play/bitten.
 */
export type AccountStatus = "loading" | "guest" | "signed-in";

export type FirstVisitStep =
  /** Nothing to decide yet: the account or the save is still loading. */
  | { kind: "wait" }
  | { kind: "go"; to: string }
  /** Make the quick-start hero in this browser's save. */
  | { kind: "make-hero" }
  /** There is a hero: stay on the page. */
  | { kind: "stay" };

export const START_PATH = "/play/start";
export const NIGHT_PATH = "/play/patrol";
export const HUB_PATH = "/play";
export const ORIGIN_PATH = "/play/bitten";

/**
 * /play/start. `madeHere` is true once this visit made the hero: that visitor goes into
 * their first night, and anyone who already had one goes to Tonight.
 */
export function quickStartStep(input: { status: AccountStatus; saveLoaded: boolean; hasHero: boolean; madeHere: boolean }): FirstVisitStep {
  if (input.status === "loading" || !input.saveLoaded) return { kind: "wait" };
  if (input.hasHero) return { kind: "go", to: input.madeHere ? NIGHT_PATH : HUB_PATH };
  // A signed-in player's name goes on the boards, so they choose it.
  if (input.status === "signed-in") return { kind: "go", to: ORIGIN_PATH };
  return { kind: "make-hero" };
}

/** A game page that needs a hero, opened without one. /play itself sends a guest to the quick start. */
export function noHeroStep(input: { status: AccountStatus; saveLoaded: boolean; hasHero: boolean; pathname: string }): FirstVisitStep {
  if (!input.saveLoaded || input.status === "loading") return { kind: "wait" };
  if (input.hasHero) return { kind: "stay" };
  if (input.status === "signed-in") return { kind: "go", to: ORIGIN_PATH };
  if (input.pathname === HUB_PATH) return { kind: "go", to: START_PATH };
  return { kind: "make-hero" };
}
