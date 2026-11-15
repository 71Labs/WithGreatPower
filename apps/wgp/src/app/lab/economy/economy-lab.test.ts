/**
 * /lab/economy as the server renders it, before the page hydrates. A click on Run before
 * then used to be lost, so Run is disabled and says Loading until the page is live; the
 * sliders and the Seed field each carry a label that is their name alone.
 */
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EconomyLab } from "./economy-lab";

const html = renderToStaticMarkup(createElement(EconomyLab));
/** The Setup panel's markup. */
const setup = html.slice(html.indexOf('aria-label="Setup"'), html.indexOf("</section>", html.indexOf('aria-label="Setup"')));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the economy lab before it hydrates", () => {
  it("shows Run as Loading and disabled, so an early click is never swallowed", () => {
    const run = setup.match(/<button[^>]*aria-busy="true"[^>]*>(.*?)<\/button>/);
    expect(run, "the Run button is marked busy").not.toBeNull();
    expect(run![0]).toMatch(/\sdisabled=""/);
    expect(text(run![1]!)).toBe("Loading…");
    expect(text(setup)).not.toContain("Run 21 days");
  });

  it("turns into Run 21 days once hydrated (the label the README names)", () => {
    const src = readFileSync(new URL("./economy-lab.tsx", import.meta.url), "utf8");
    expect(src).toContain("const ready = useSyncExternalStore(noop, () => true, () => false);");
    expect(src).toContain('{!ready ? "Loading…" : running ? "Pause" : done ? `Run ${plural(days, "day")} again` : last.day > 0 ? "Resume" : `Run ${plural(days, "day")}`}');
  });

  it("opens on the proposal (the owner's settings and the faucet taper), with the old settings one tick away", () => {
    const page = text(html);
    expect(page).toContain("The proposal: the owner’s settings, on mainnet once the owner’s call lands: 10% gas fee, crafting burns 250 Bits, nights pay less above 150 Bits held and 5 from 400");
    const old = setup.match(/<input type="checkbox"[^>]*>/)![0];
    expect(old).not.toMatch(/checked=""/);
    expect(text(setup)).toContain("Run the old settings 2% gas fee, free crafting, no taper");
  });

  it("labels each slider with its name alone, and the Seed as a whole number", () => {
    for (const name of ["Days", "Bot heroes"]) {
      const label = setup.match(new RegExp(`<label for="([^"]+)">${name}</label>`));
      expect(label, `${name} has a label of its own`).not.toBeNull();
      expect(setup).toMatch(new RegExp(`<input id="${label![1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" type="range"`));
    }
    const seed = setup.match(/<label for="([^"]+)"[^>]*>Seed<\/label>/);
    expect(seed).not.toBeNull();
    const input = setup.match(new RegExp(`<input id="${seed![1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`))![0];
    expect(input).toContain('type="number"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('min="0"');
    expect(input).toContain('step="1"');
  });
});
