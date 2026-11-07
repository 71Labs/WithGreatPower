import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TASK_DONE, TASK_IDS } from "@wgp/game-core/city";
import { roamCity, roamWorld } from "@wgp/game-core/sim3d/roam";

import { marksFixture, renderFrameFixture, roamFrameFixture, type RoamFixture } from "@/game3d/nav/roam-fixture";

import { RoamMap, type MapTab, type RoamMapProps } from "./map";

/**
 * The City map drawn to static markup (no browser): what each state shows (the distance line,
 * the pins and their states, the tracked task, the drawer and its tabs) and its accessible
 * names. The camera's maths is tested in game3d/nav/pan-zoom.test.ts, the pins' in
 * roam-pins.test.ts.
 */

const w = roamWorld();
const city = roamCity();
const spawn = { x: w.spawn.x, y: w.spawn.y, z: w.spawn.z };
const hero = { suit: "#d62e21", trim: "#141414", eyes: "#ffffff" } as unknown as RoamMapProps["hero"];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const count = (html: string, needle: string) => html.split(needle).length - 1;

function render(fx: RoamFixture, opts: { tracked?: RoamMapProps["tracked"]; drawer?: boolean; tab?: MapTab; still?: boolean; touch?: boolean } = {}) {
  const frame = renderFrameFixture(roamFrameFixture(w, fx), spawn);
  return renderToStaticMarkup(
    h(RoamMap, {
      city,
      frame,
      hero,
      onClose: () => {},
      still: opts.still ?? false,
      touch: opts.touch ?? true,
      tracked: opts.tracked ?? null,
      onTrack: () => {},
      drawer: opts.drawer ?? true,
      onDrawer: () => {},
      initialTab: opts.tab,
    }),
  );
}

describe("the city map", () => {
  it("is a labelled dialog whose description is the distance line", () => {
    const html = render({});
    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"/);
    const desc = html.match(/aria-describedby="([^"]+)"/)![1];
    expect(html).toContain(`id="${desc}"`);
    expect(text(html)).toContain("City map");
    expect(text(html)).toContain("Talk to someone with a gold marker to pick up a task.");
  });

  it("says where the tracked task's next step is, with a ring and a line on the map", () => {
    const html = render({ stage: { pickpocket: 1 }, bot: { x: spawn.x + 40 * 60, y: 0, z: spawn.z } }, { tracked: "pickpocket" });
    expect(text(html)).toContain("Stop, thief.exe: the pickpocket bot is 60 m east of you.");
    expect(count(html, 'data-pin="target"')).toBe(1);
    expect(count(html, 'data-pin="bot"')).toBe(1);
  });

  it("points a pixel hunt at the nearest pixel (it used to say nothing)", () => {
    const t = text(render({ stage: { pixels: 1 }, got: { pixels: 2 } }, { tracked: "pixels" }));
    expect(t).toMatch(/Lossless: the nearest pixel is \d+ m [a-z-]+ of you\./);
  });

  it("shows you as an arrow the way you face, with a tag", () => {
    const html = render({});
    expect(count(html, 'data-pin="you"')).toBe(1);
    expect(text(html)).toContain("You");
  });

  it("pins every viewpoint, the givers, and pages only where they're revealed", () => {
    const html = render({ views: [0], pages: [1] });
    expect(count(html, 'data-pin="view"')).toBe(w.views.length);
    expect(count(html, 'data-pin="giver"')).toBe(w.folks.filter((f) => f.gives).length);
    const revealed = w.pages.filter((p, i) => i === 1 || p.district === w.views[0].district).length;
    expect(count(html, 'data-pin="page"')).toBe(revealed);
  });

  it("draws a race's gates numbered, passed ones checked, and the next one ringed", () => {
    const marks = marksFixture("gate", "pickpocket", spawn, { passed: 2 });
    const html = render({ stage: { pickpocket: 1 }, marks }, { tracked: "pickpocket" });
    expect(count(html, 'data-pin="gate"')).toBe(6);
    expect(count(html, 'data-pin="gate" data-done="true"')).toBe(2);
    expect(text(html)).toContain("Stop, thief.exe: gate 3 is");
    // The next gate carries its own ring as well as the target ring.
    expect(html).toMatch(/data-pin="gate"[^>]*>(?:(?!data-pin=).)*border-game-hero(?:(?!data-pin=).)*>3</);
  });

  it("draws relays with their plug, unplugged ones checked and faded, another task's dimmed", () => {
    const marks = marksFixture("relay", "graffiti", spawn, { unplugged: 1 });
    const html = render({ stage: { graffiti: 1, pixels: 1 }, marks }, { tracked: "pixels" });
    expect(count(html, 'data-pin="relay"')).toBe(4);
    expect(count(html, 'data-pin="relay" data-done="true"')).toBe(1);
    // Tracking the pixels: the relays (graffiti's) are faded.
    const relays = html.split('data-pin="relay"').slice(1);
    expect(relays.every((r) => r.slice(0, 200).includes("opacity-50"))).toBe(true);
  });

  it("lists the tasks with their state in words, and a Track button on each not done", () => {
    const html = render({ stage: { bread: TASK_DONE, pixels: 1 } }, { tracked: "pixels" });
    const t = text(html);
    expect(t).toContain("Still warm");
    expect(t).toContain("Done");
    expect(t).toContain("Under way");
    expect(t).toContain("New");
    expect(html).toContain('aria-label="Tracking Lossless"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Track Stop, thief.exe"');
    expect(html).not.toContain('aria-label="Track Still warm"');
    expect(html).toMatch(/<li aria-current="step"[^>]*>/);
  });

  it("folds the drawer away, and says so on its button", () => {
    const open = render({}, { drawer: true });
    expect(open).toMatch(/aria-label="Hide the task list"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*aria-label="Hide the task list"/);
    expect(open).toContain('role="tablist"');
    const shut = render({}, { drawer: false });
    expect(shut).toContain('aria-label="Show the task list"');
    expect(shut).toContain('aria-expanded="false"');
    expect(shut).not.toContain('role="tablist"');
  });

  it("has the finds and the key in the drawer's other tabs", () => {
    const finds = text(render({ pages: [0, 3], views: [1] }, { tab: "finds" }));
    expect(finds).toContain(`2 of ${w.pages.length} Daily Rug pages · 1 of ${w.views.length} viewpoints`);
    const key = text(render({}, { tab: "key" }));
    expect(key).toContain("A race gate, in order");
    expect(key).toContain("A relay to unplug");
    expect(key).toContain("Done: passed, unplugged, found");
    expect(key).toContain("pinch to zoom");
  });

  it("has its zoom and Center on me buttons named, and the map itself focusable as a map", () => {
    const html = render({});
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('aria-label="Center on me"');
    expect(html).toContain('aria-label="Close the map"');
    expect(html).toMatch(/data-map-view="true"[^>]*role="application"[^>]*aria-roledescription="map"/);
    // At the whole-city fit it can't zoom out further.
    expect(html).toMatch(/aria-label="Zoom out"[^>]*aria-disabled="true"/);
  });

  it("holds every pulse and ping still on the Steady camera", () => {
    const moving = render({ stage: { pickpocket: 1 }, bot: { x: spawn.x + 400, y: 0, z: spawn.z } }, { tracked: "pickpocket" });
    expect(moving).toContain("wgp-ping");
    expect(moving).toContain("wgp-pulse");
    const still = render({ stage: { pickpocket: 1 }, bot: { x: spawn.x + 400, y: 0, z: spawn.z } }, { tracked: "pickpocket", still: true });
    expect(still).not.toMatch(/class="[^"]*wgp-ping/);
    expect(still).not.toMatch(/class="[^"]*wgp-pulse/);
  });

  it("says every task's done once they are (all six, not just the first four)", () => {
    const t = text(render({ stage: Object.fromEntries(TASK_IDS.map((id) => [id, TASK_DONE])) }));
    expect(t).toContain("Every task’s done. The pages and the masts are still out there.");
    // Four done, Front-run and Cross-chain still to pick up: not all done.
    const four = text(render({ stage: { bread: TASK_DONE, pickpocket: TASK_DONE, pixels: TASK_DONE, graffiti: TASK_DONE } }));
    expect(four).not.toContain("Every task’s done.");
  });
});
