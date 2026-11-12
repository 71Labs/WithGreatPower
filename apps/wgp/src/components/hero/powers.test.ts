import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { POWERS } from "@wgp/game-core/data";
import { cooldownSeconds } from "@wgp/game-core/sim3d";
import type { PowerId } from "@wgp/game-core/types";

import { PowerFacts, powerBlurb, powerEffects, rechargeLabel, rechargeSeconds, secondsLabel, stunSeconds } from "./powers";

const IDS = Object.keys(POWERS) as PowerId[];

describe("a power card says what the real-time night does", () => {
  it("the recharge it prints is the sim's own cooldown, in seconds, for every power", () => {
    for (const id of IDS) expect(rechargeSeconds(POWERS[id].cooldown), id).toBe(cooldownSeconds(id));
  });

  it.each([
    [0, "1.5 s"],
    [1, "3.5 s"],
    [2, "5.5 s"],
    [3, "7.5 s"],
    [4, "9.5 s"],
  ])("a %i-turn cooldown in the rules data reads “%s”", (turns, label) => {
    expect(rechargeLabel(turns)).toBe(label);
  });

  it("writes seconds with at most one decimal", () => {
    expect(secondsLabel(2)).toBe("2 s");
    expect(secondsLabel(0.6)).toBe("0.6 s");
    expect(secondsLabel(2.3000000000000003)).toBe("2.3 s");
  });

  it("no card mentions turns: not the readout, not the effects, not the blurb", () => {
    for (const id of IDS) {
      const html = renderToStaticMarkup(createElement(PowerFacts, { power: POWERS[id] }));
      expect(html, id).toContain("Recharge");
      expect(html, id).not.toMatch(/turn|Cooldown/i);
      expect(powerBlurb(POWERS[id]), id).not.toMatch(/\bturns?\b/);
      for (const f of powerEffects(POWERS[id], 30)) expect(`${f.label} ${f.value}`, id).not.toMatch(/\bturns?\b/);
    }
  });

  it("a stun is printed in the seconds the sim holds a villain for", () => {
    expect(stunSeconds(POWERS["web-bomb"])).toBe(2);
    expect(stunSeconds(POWERS["validator-slam"])).toBe(0.6);
    expect(stunSeconds(POWERS["web-sling"])).toBeNull();
    expect(powerEffects(POWERS["web-bomb"])).toContainEqual({ label: "Webs them", value: "2 s" });
    expect(powerEffects(POWERS["validator-slam"])).toContainEqual({ label: "Stuns them", value: "0.6 s" });
  });
});
