import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CAST } from "@wgp/game-core/cast";
import { MAX_LOADOUT, VILLAINS } from "@wgp/game-core/data";
import { generatePatrol, newSave, reduce } from "@wgp/game-core/engine";

import { LOOPS } from "@/audio/loops";
import { TIERS } from "@/game3d/scene/quality";

import { CAST_INTRO, ERRAND_CAPTION, FIGHT_PANEL, HERO_HEADLINE, HERO_PITCH, NIGHT_HEADING, NIGHT_INTRO, SHARE_DESCRIPTION, SITE_DESCRIPTION, SOUNDTRACK_FACT, TIERS_FACT } from "./copy";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n]!;
const Word = (n: number) => word(n).replace(/^./, (c) => c.toUpperCase());

/** What a ranked night is made of, read from the patrols the game generates. */
function nightShape() {
  const save = reduce(newSave(), { type: "create-hero", name: "Copy Check", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
  const shapes = new Set<string>();
  let last = { stops: 0, fights: 0, errands: 0, bosses: 0 };
  for (let seed = 1; seed <= 200; seed++) {
    const p = generatePatrol({ ...save, night: 1 + (seed % 9) }, save.hero!, seed);
    const fights = p.stops.filter((s) => s.kind === "fight");
    last = { stops: p.stops.length, fights: fights.length, errands: p.stops.filter((s) => s.kind === "errand").length, bosses: fights.filter((s) => s.boss).length };
    // The boss is always the last stop.
    expect(p.stops[p.stops.length - 1]).toMatchObject({ kind: "fight", boss: true });
    shapes.add(JSON.stringify(last));
  }
  expect(shapes.size).toBe(1);
  return last;
}

describe("the landing page's counts", () => {
  it("says what a night is: four stops, two fights (a warm-up and a boss) and two errands", () => {
    const night = nightShape();
    expect(night).toEqual({ stops: 4, fights: 2, errands: 2, bosses: 1 });

    expect(HERO_PITCH.lead).toContain(`web up ${word(night.fights)} villains a night`);
    expect(NIGHT_HEADING.lead).toBe(`${Word(night.stops)} stops across the city,`);
    expect(NIGHT_INTRO).toContain(`a warm-up villain and ${word(night.errands)} errands`);
    expect(NIGHT_INTRO).toContain("then a boss");
    expect(ERRAND_CAPTION).toBe(`${Word(night.errands)} errands`);
    // One warm-up and one boss: the two fights.
    expect(FIGHT_PANEL.caption).toBe("A warm-up and a boss");
    expect(night.fights - night.bosses).toBe(1);
  });

  it("never gives a count of villains, fights, errands or stops that the simulation doesn't", () => {
    const night = nightShape();
    const allowed: Record<string, number[]> = {
      // "villains" may be the two a night has or the roster of four; the sentence has to say which.
      villain: [night.fights, Object.keys(VILLAINS).length],
      fight: [night.fights],
      errand: [night.errands],
      stop: [night.stops],
      boss: [night.bosses],
    };
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      ...readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts")).map((f) => path.join(here, f)),
      path.join(here, "../../app/layout.tsx"),
      path.join(here, "../../app/(site)/page.tsx"),
      path.join(here, "../../app/manifest.ts"),
    ];
    const re = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+) (?:parody |warm-up )?(villain|fight|errand|stop|boss)(?:s|es)?\b/gi;
    const found: string[] = [];
    for (const file of files) {
      for (const m of readFileSync(file, "utf8").matchAll(re)) {
        const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : WORDS.indexOf(m[1]!.toLowerCase());
        found.push(m[0]);
        expect(allowed[m[2]!.toLowerCase()], `${path.basename(file)}: “${m[0]}”`).toContain(n);
      }
    }
    // The scan reads the real copy: the night's sentences are among what it found.
    expect(found.map((f) => f.toLowerCase())).toEqual(expect.arrayContaining(["two villains", "four stops", "two errands"]));
    // The whole-game descriptions give no villain count: a night has two, the roster four.
    for (const s of [SHARE_DESCRIPTION, SITE_DESCRIPTION, HERO_PITCH.lead]) expect(s).not.toMatch(/four (parody )?villains/i);
  });

  it("counts powers, quality tiers, music themes and the cast as the game does", () => {
    expect(FIGHT_PANEL.body).toContain(`${Word(MAX_LOADOUT)} powers on 1–${MAX_LOADOUT}`);
    expect(TIERS_FACT).toMatch(new RegExp(`^${Word(TIERS.length)} quality tiers`));
    const themes = Object.keys(LOOPS).filter((k) => k.startsWith("music/"));
    expect(SOUNDTRACK_FACT).toMatch(new RegExp(`^${Word(themes.length)} looping themes`));
    expect(CAST_INTRO).toContain(`All ${word(CAST.length)} are original parodies`);
  });
});

describe("the hero's premise", () => {
  it("opens on the city's own motto and names only the game's villains as the economy's", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bible = readFileSync(path.join(here, "../../../../../docs/story/bible.md"), "utf8");
    // Uncle Gen's line, as the story bible gives it.
    expect(bible).toContain(`${HERO_HEADLINE.lead} ${HERO_HEADLINE.point.replace(/\.$/, "")}`);
    const villains = CAST.filter((c) => c.role === "Villain").map((c) => c.name);
    const named = ["Sandwich Man", "Gas Goblin", "Doc Octochain"];
    for (const name of named) {
      expect(villains).toContain(name);
      expect(HERO_PITCH.lead).toContain(name);
    }
    // Gwei Stacy is the vendor, not a villain: the pitch puts her on the trading side.
    expect(HERO_PITCH.lead).not.toContain("Gwei");
    expect(HERO_PITCH.more).toContain("sell their loot to Gwei Stacy");
  });
});

describe("the cast's role labels", () => {
  it("labels Gwei Stacy the vendor, the player's hero the only hero, and every villain a villain", () => {
    const role = Object.fromEntries(CAST.map((c) => [c.id, c.role]));
    expect(role).toEqual({
      node: "Hero",
      gwei: "Vendor",
      "uncle-gen": "Ally",
      "aunt-mainnet": "Ally",
      "mary-jpeg": "Ally",
      bearson: "Press",
      "gas-goblin": "Villain",
      "doc-octochain": "Villain",
      "sandwich-man": "Villain",
      sybil: "Villain",
    });
    // The fights' villains and the cast's villains are the same four.
    expect(CAST.filter((c) => c.role === "Villain").map((c) => c.id).sort()).toEqual(Object.keys(VILLAINS).sort());
  });

  it("keeps every cast member on an album page", async () => {
    const { GROUPS } = await import("@/components/album/entries");
    expect(GROUPS.flatMap((g) => CAST.filter((c) => c.role === g.role)).map((c) => c.id).sort()).toEqual(CAST.map((c) => c.id).sort());
  });
});
