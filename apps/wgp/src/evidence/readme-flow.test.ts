/**
 * The README tells a reader what to press and what they will see. Each label and route it
 * names is looked up in the code that renders it, so renaming a button or moving a page fails
 * here until the README says the new thing. (The flows themselves were walked in a headless
 * browser on Nov 13; this pins what that walk found.)
 */
import { describe, expect, it } from "vitest";

import { newSave, reduce } from "@wgp/game-core/engine";
import { STARTER_POWERS, SUITS } from "@wgp/game-core/data";

import { QUICK_HERO } from "@/lib/first-minute/quick-hero";
import { START_URL, startUrl } from "@/lib/site";

import { exists, plainDoc, read } from "./repo";

const README = plainDoc("README.md");
const src = (rel: string) => read(`apps/wgp/src/${rel}`);
/** JSX text with its line breaks and indentation flattened, so a label split over lines is found. */
const flat = (rel: string) => src(rel).replace(/\s+/g, " ");

/** Every label the README prints in bold as something to press or to see, with the file that renders it. */
const LABELS: [label: string, file: string, inSource?: string][] = [
  ["Play now", "components/landing/hero.tsx"],
  ["Swing out", "components/tonight/tonight.tsx"],
  ["Make it yours", "components/first-minute/make-it-yours.tsx"],
  ["Get bitten", "components/hero/bitten.tsx"],
  ["Classic mode", "components/tonight/tonight.tsx"],
  ["Banked. Get some sleep.", "sim/ui/results.tsx"],
  ["Unranked score", "app/play/patrol/night-results.tsx"],
  ["Sign in", "components/account/account-chip.tsx"],
  ["Continue with Google", "components/account/account-sheet.tsx"],
  ["Use a NEAR wallet", "components/account/wallet-sign-in.tsx"],
  ["Play as a test player", "components/account/account-sheet.tsx"],
  ["Verified", "app/play/patrol/night-results.tsx"],
  ["Ranked", "app/play/patrol/night-results.tsx"],
  ["Score, from the server", "app/play/patrol/night-results.tsx"],
  ["You earned N Bits", "app/play/patrol/night-results.tsx", "You earned <span"],
  ["On NEAR mainnet · game.wgpnear.near", "components/market/market-screen.tsx", "On NEAR {view.network} · {view.contractId}"],
  ["Why this price?", "components/market/why-price.tsx"],
  ["Enable quick play", "components/account/quick-play.tsx"],
  ["Empty Gwei's … till", "components/market/invest.tsx", "Empty Gwei’s {drainName} till"],
  ["Invest in Gwei", "components/market/invest.tsx"],
  ["Run 21 days", "app/lab/economy/economy-lab.tsx", '`Run ${plural(days, "day")}`'],
  ["Instant", "app/lab/economy/economy-lab.tsx", 'label: "Instant"'],
  ["Recommended settings", "app/lab/economy/economy-lab.tsx"],
  ["Drain Gwei", "app/lab/economy/economy-lab.tsx"],
  ["Drain Gwei, then invest in her", "app/lab/economy/economy-lab.tsx"],
  ["Load a run where he goes broke", "app/lab/economy/npc-panel.tsx"],
];

/** Every page the README's "Pages" line and steps name, with the file that serves it. */
const PAGES: [route: string, file: string][] = [
  ["/play", "app/play/page.tsx"],
  ["/play/patrol", "app/play/patrol/page.tsx"],
  ["/play/bitten", "app/play/bitten/page.tsx"],
  ["/play/city", "app/play/city/page.tsx"],
  ["/play/cases", "app/play/cases/page.tsx"],
  ["/play/compete", "app/play/compete/page.tsx"],
  ["/play/market", "app/play/market/page.tsx"],
  ["/play/suits", "app/play/suits/page.tsx"],
  ["/play/hero", "app/play/hero/page.tsx"],
  ["/play/album", "app/play/album/page.tsx"],
  ["/play/rug", "app/play/rug/page.tsx"],
  ["/play/leaderboard", "app/play/leaderboard/page.tsx"],
  ["/play/invite", "app/play/invite/page.tsx"],
  ["/play/classic", "app/play/classic/page.tsx"],
  ["/stats", "app/stats/page.tsx"],
  ["/lab/economy", "app/lab/economy/page.tsx"],
  ["/lab/determinism", "app/lab/determinism/page.tsx"],
];

describe("the README's do-this, see-that steps name what the code renders", () => {
  it("a first visit is the quick start: /play and Play now lead to /play/start, which makes The Node and opens the night", () => {
    // The landing's button.
    expect(START_URL).toBe("/play/start");
    expect(startUrl("https://www.wgponnear.fun/play")).toBe("https://www.wgponnear.fun/play/start");
    expect(flat("components/landing/hero.tsx")).toMatch(/<StickerLink href=\{START_URL\}[^>]*> Play now/);
    // /play itself, with no hero: a guest goes to the quick start, a signed-in player to the origin.
    const guard = flat("components/game/ui.tsx");
    expect(guard).toContain('if (status === "signed-in") router.replace("/play/bitten"); else if (pathname === "/play") router.replace("/play/start");');
    // The quick start makes the ready hero and goes into the patrol; a signed-in player without a hero gets the origin.
    const quick = flat("components/first-minute/quick-start.tsx");
    expect(quick).toContain('dispatch({ type: "create-hero", ...QUICK_HERO })');
    expect(quick).toContain('router.replace(made.current ? "/play/patrol" : "/play")');
    expect(quick).toContain('if (status === "signed-in") { router.replace("/play/bitten"); return; }');

    // The hero the README describes: The Node, the Classic suit, three starter powers, accepted by the rules.
    expect(QUICK_HERO.name).toBe("The Node");
    expect(SUITS[QUICK_HERO.suit].name).toBe("Classic");
    expect(QUICK_HERO.powers).toHaveLength(3);
    for (const p of QUICK_HERO.powers) expect(STARTER_POWERS).toContain(p);
    expect(reduce(newSave(), { type: "create-hero", ...QUICK_HERO }).hero).toMatchObject({ name: "The Node", suit: "classic", level: 1 });

    // And the README says that, not the old form-first flow.
    expect(README).toContain("A first visit puts you straight into a night as a ready-made hero, The Node; there is no form first.");
    expect(README).toContain("A first visit goes straight into a night with a ready-made hero, The Node, in the Classic suit with three starter powers; there is no form first.");
    expect(README).toContain("A signed-in player with no hero yet chooses a name, a suit and three powers first (/play/bitten, Get bitten).");
    expect(README).not.toMatch(/press Get bitten, pick a name|Get bitten walks you through/);
  });

  it("every button and label the README names is in the component that renders it", () => {
    for (const [label, file, inSource] of LABELS) {
      expect(README, `the README no longer names “${label}”: drop it from this list`).toContain(label);
      expect(flat(file), `${file} no longer renders “${label}”: fix the README's step`).toContain(inSource ?? label);
    }
  });

  it("every page the README names is a route in the app", () => {
    for (const [route, file] of PAGES) {
      expect(README, `the README no longer names ${route}`).toContain(route);
      expect(exists(`apps/wgp/src/${file}`), `${route}: ${file} is gone`).toBe(true);
    }
    // Classic mode is reached from Tonight, as the README says.
    expect(flat("components/tonight/tonight.tsx")).toMatch(/href="\/play\/classic"/);
  });

  it("the keys the README gives for the City are the ones the game prints on screen", () => {
    expect(README).toContain("Shift sprints, F webs while held, Q zips, E talks or interacts, M opens the map.");
    const hud = flat("app/play/city/hud.tsx");
    expect(hud).toContain("Shift to sprint");
    expect(hud).toMatch(/Hold F or the mouse to swing, Q to zip/);
  });
});
