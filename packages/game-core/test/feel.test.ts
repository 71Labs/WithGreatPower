/**
 * Ruleset 3's controls and feel, pinned: nothing moves the hero without input, the stick
 * runs and brakes, roof edges hold unless pushed over, landings stop, the web button
 * buffers, taps and chains, pickups and the combo pay out, the render frame's v1.3 fields
 * are filled; and scripted "human" inputs chain swings across the city (feel-metrics.ts).
 */
import { describe, expect, it } from "vitest";

import { reduce } from "../src/rules/engine";
import { hashState } from "../src/hash";
import { CityIndex, generateCity, groundBelow } from "../src/sim3d/city";
import { COMBO_TICKS, GROUND_FRICTION, HERO_RADIUS, RING_SPEED, RUN_SPEED, WEB_BUFFER } from "../src/sim3d/constants";
import type { InputFrame } from "../src/sim3d/contract";
import { DIR64, dirIndex, len2, len3 } from "../src/sim3d/dmath";
import { comboMultiplier, placePickups } from "../src/sim3d/pickups";
import { fillRenderFrame, newRenderFrame } from "../src/sim3d/render";
import { createSim, IDLE_FRAME, stepSim } from "../src/sim3d/sim";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { measure, measureLanding } from "./feel-metrics";
import { heroSave, STANDARD } from "./helpers";

/** A fresh night's sim at its first stop, standing on the start roof. */
function night(seed = 0x5eed): SimState {
  const p = reduce(heroSave(STANDARD, "Feel", 2), { type: "start-patrol", seed }).patrol!;
  return createSim({ seed: p.seed, stops: p.stops, index: 0, entry: "travel", hp: 100, maxHp: 100, fluid: 100, combo: 0, gweiCalls: 0, heroLevel: 1, loadout: [] });
}

const stick = (dir: number, mag = 3, web = false): InputFrame => ({ dir, mag, web, shot: 0 });

function steps(s: SimState, frame: InputFrame, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepSim(s, frame);
    out.push(...s.events.splice(0));
  }
  return out;
}

/** The first of the 64 headings, from `start`, along which the start roof runs out within `max` units. */
function edgeDir(s: SimState): number {
  const h = s.hero;
  let best = 0;
  let bestD = Infinity;
  for (let d = 0; d < 64; d += 4) {
    const [dx, dz] = DIR64[d];
    for (let t = 0; t < 900; t += 10) {
      if (groundBelow(s.grid, h.x + dx * t, h.z + dz * t, h.y) < h.y - HERO_RADIUS - 1) {
        if (t < bestD) {
          bestD = t;
          best = d;
        }
        break;
      }
    }
  }
  return best;
}

describe("on the ground (v3: only the stick moves you)", () => {
  it("stands still with no input, indefinitely", () => {
    const s = night();
    const at = { ...s.hero };
    const events = steps(s, IDLE_FRAME, 60 * 20);
    expect(s.hero.grounded).toBe(true);
    expect(s.hero.x).toBe(at.x);
    expect(s.hero.y).toBe(at.y);
    expect(s.hero.z).toBe(at.z);
    expect(events.filter((e) => e.type === "thwip" || e.type === "miss")).toHaveLength(0);
    expect(s.mode).toBe("travel");
  });

  it("runs on the stick, brakes to a stop when it's let go, and turns around quickly", () => {
    const s = night();
    const d = (edgeDir(s) + 32) % 64; // away from the nearest edge
    steps(s, stick(d), 24);
    const [dx, dz] = DIR64[d];
    const along = s.hero.vx * dx + s.hero.vz * dz;
    expect(along).toBeGreaterThan(RUN_SPEED); // full tilt runs 1.25× RUN_SPEED, most of the way there in 0.4 s
    // Let go: stopped within a quarter second, and stays put.
    steps(s, IDLE_FRAME, 15);
    expect(len2(s.hero.vx, s.hero.vz)).toBeLessThan(1);
    const at = { x: s.hero.x, z: s.hero.z };
    steps(s, IDLE_FRAME, 120);
    expect(len2(s.hero.x - at.x, s.hero.z - at.z)).toBe(0);
    // Run, then pull the stick back: going the other way within 0.4 s, facing it within 0.2 s.
    steps(s, stick(d), 20);
    steps(s, stick((d + 32) % 64), 12);
    expect(s.hero.fx * -dx + s.hero.fz * -dz).toBeGreaterThan(0.99);
    steps(s, stick((d + 32) % 64), 12);
    expect(s.hero.vx * -dx + s.hero.vz * -dz).toBeGreaterThan(0);
    expect(GROUND_FRICTION).toBeGreaterThan(2000);
  });

  it("stops at a roof's edge unless the stick keeps pushing out over it, and never hops off", () => {
    const d = edgeDir(night());
    // Pushing on: walks off, falling (no hop).
    const a = night();
    let left = -1;
    for (let i = 0; i < 300 && left < 0; i++) {
      stepSim(a, stick(d));
      a.events.length = 0;
      if (!a.hero.grounded) left = i;
    }
    expect(left).toBeGreaterThan(0);
    expect(a.hero.vy).toBeLessThanOrEqual(0);
    const edgeAt = { x: a.hero.x, z: a.hero.z };
    // Running at it and letting go just short: slides to the edge at most, and stays on the roof.
    const b = night();
    for (let i = 0; i < 300; i++) {
      stepSim(b, stick(d));
      if (len2(edgeAt.x - b.hero.x, edgeAt.z - b.hero.z) < 30) break;
    }
    const events = steps(b, IDLE_FRAME, 180);
    expect(b.hero.grounded).toBe(true);
    expect(events.filter((e) => e.type === "miss")).toHaveLength(0);
    // Running along the edge (the stick across it, not out) stays on too.
    const c = night();
    for (let i = 0; i < 300; i++) {
      stepSim(c, stick(d));
      if (len2(edgeAt.x - c.hero.x, edgeAt.z - c.hero.z) < 20) break;
    }
    steps(c, stick((d + 16) % 64, 1), 30);
    expect(c.hero.grounded).toBe(true);
  });

  it("takes off only on the web: a jump into a swing toward the next stop when the stick is idle", () => {
    const s = night();
    const events = steps(s, { ...IDLE_FRAME, web: true }, 2);
    expect(s.hero.grounded).toBe(false);
    const thwip = events.find((e) => e.type === "thwip");
    expect(thwip).toBeTruthy();
    if (thwip?.type === "thwip") {
      const t = s.city.zones[0].kind === "errand" ? s.city.zones[0].allyAt! : s.city.zones[0].center;
      const toStop = { x: t.x - thwip.x, z: t.z - thwip.z };
      expect((thwip.ax - thwip.x) * toStop.x + (thwip.az - thwip.z) * toStop.z).toBeGreaterThan(0);
    }
  });
});

describe("landing (v3)", () => {
  it("lets go before touchdown: a short skid and a stop, no bounce, no re-web; held through it: a new swing", () => {
    const l = measureLanding();
    expect(l.landings).toBeGreaterThanOrEqual(8);
    expect(l.stopped / l.landings).toBeGreaterThanOrEqual(0.8);
    expect(l.medianDistance!).toBeLessThan(150);
    expect(l.medianSeconds!).toBeLessThan(0.5);

    // Dropped onto the start roof from 100 up, moving: web up → lands and stops; web held → off again next tick.
    for (const web of [false, true]) {
      const s = night();
      const h = s.hero;
      const roof = h.y - HERO_RADIUS;
      h.grounded = false;
      h.y = roof + HERO_RADIUS + 100;
      h.vx = 300;
      h.vy = -200;
      h.holdPrev = web;
      let landed = -1;
      for (let i = 0; i < 120; i++) {
        stepSim(s, { ...IDLE_FRAME, web });
        const ev = s.events.splice(0);
        if (landed < 0 && ev.some((e) => e.type === "land")) landed = i;
        if (landed >= 0 && i === landed + 1) {
          if (web) expect(h.grounded).toBe(false);
          else expect(h.grounded).toBe(true);
        }
      }
      expect(landed).toBeGreaterThanOrEqual(0);
      if (!web) {
        expect(len3(h.vx, h.vy, h.vz)).toBe(0);
        expect(h.y).toBeCloseTo(roof + HERO_RADIUS, 6);
      }
    }
  });
});

describe("the web button (v3)", () => {
  it("buffers a press: nothing in reach at the press, an anchor a moment later still takes, button up or not", () => {
    const s = night();
    const h = s.hero;
    const home = { x: h.x, y: h.y, z: h.z };
    // High above everything: nothing to web.
    h.grounded = false;
    h.y = 4000;
    stepSim(s, { ...IDLE_FRAME, web: true });
    expect(h.rope).toBeNull();
    // Back over the roof (in the air) a few ticks later, button already up: the buffered press webs.
    h.x = home.x;
    h.y = home.y + 40;
    h.z = home.z;
    h.vx = h.vy = h.vz = 0;
    stepSim(s, IDLE_FRAME);
    stepSim(s, IDLE_FRAME);
    expect(h.rope).not.toBeNull();
    // Shot from a press whose button is up: a tap, which swings on to the swing's natural end.
    expect(h.latched).toBe(true);
    expect(WEB_BUFFER).toBeGreaterThan(0.1);
  });

  it("a tap swings on until the swing ends by itself; holding chains swings", () => {
    const s = night();
    steps(s, { ...IDLE_FRAME, web: true }, 3);
    expect(s.hero.rope).not.toBeNull();
    const events = steps(s, IDLE_FRAME, 20);
    expect(s.hero.rope).not.toBeNull();
    expect(events.some((e) => e.type === "release")).toBe(false);
    // Holding the web (stick toward the stop) for 8 s: several webs, each let go by itself.
    const t = night();
    let webs = 0;
    let autos = 0;
    for (let i = 0; i < 480 && t.mode === "travel"; i++) {
      const g = t.city.zones[0].center;
      stepSim(t, stick(dirIndex(g.x - t.hero.x, g.z - t.hero.z), 3, true));
      for (const e of t.events.splice(0)) {
        if (e.type === "thwip") webs += 1;
        if (e.type === "release" && e.auto) autos += 1;
      }
    }
    expect(webs).toBeGreaterThanOrEqual(3);
    expect(autos).toBeGreaterThanOrEqual(1);
  });
});

describe("pickups and the combo (v3)", () => {
  it("are placed from the city alone: along every leg, with a ring, clear of buildings", () => {
    for (let n = 1; n <= 12; n++) {
      const s = night(Math.imul(n, 0x9e3779b1) >>> 0);
      const again = placePickups(generateCity(s.config.seed, s.config.stops), new CityIndex(generateCity(s.config.seed, s.config.stops)));
      expect(JSON.stringify(again)).toBe(JSON.stringify(s.pickups));
      for (let k = 0; k < s.city.zones.length; k++) {
        const leg = s.pickups.filter((p) => p.leg === k);
        expect(leg.length, `night ${n} leg ${k}`).toBeGreaterThanOrEqual(5);
        expect(leg.some((p) => p.kind === "ring"), `night ${n} leg ${k}`).toBe(true);
      }
      s.pickups.forEach((p, i) => {
        expect(p.id).toBe(i);
        expect(groundBelow(s.grid, p.x, p.z, 9999)).toBeLessThan(p.y - 40);
      });
    }
  });

  it("pay points × the multiplier, feed the combo, boost through rings, and the combo runs out or breaks on the street", () => {
    const s = night();
    const h = s.hero;
    const bits = s.pickups.filter((p) => p.kind === "bits").slice(0, 6);
    const ring = s.pickups.find((p) => p.kind === "ring")!;
    h.grounded = false;
    let points = 0;
    for (const p of bits) {
      h.x = p.x;
      h.y = p.y;
      h.z = p.z;
      h.vx = h.vy = h.vz = 0;
      const mult = comboMultiplier(s.combo);
      const ev = steps(s, IDLE_FRAME, 1).filter((e) => e.type === "pickup");
      expect(ev).toHaveLength(1);
      if (ev[0].type === "pickup") expect(ev[0].points).toBe(10 * mult);
      points += 10 * mult;
      expect(p.taken).toBe(true);
    }
    expect(s.bits).toBe(6);
    expect(s.combo).toBe(6);
    expect(s.pickupPoints).toBe(points);
    // A ring: a boost to at least RING_SPEED along the way you're going, and +2.
    h.x = ring.x - 30;
    h.y = ring.y;
    h.z = ring.z;
    h.vx = 400;
    h.vy = 0;
    h.vz = 0;
    steps(s, IDLE_FRAME, 1);
    expect(ring.taken).toBe(true);
    expect(s.rings).toBe(1);
    expect(s.combo).toBe(8);
    expect(len3(h.vx, h.vy, h.vz)).toBeGreaterThan(RING_SPEED * 0.9);
    // Taken is taken.
    h.x = ring.x;
    h.y = ring.y;
    h.z = ring.z;
    expect(steps(s, IDLE_FRAME, 1).some((e) => e.type === "pickup")).toBe(false);
    // Hovering out of reach of everything (held up artificially), the combo runs out.
    let ended: SimEvent | undefined;
    for (let i = 0; i < COMBO_TICKS + 2 && !ended; i++) {
      h.x = 30;
      h.z = 30;
      h.y = 3000;
      h.vx = h.vy = h.vz = 0;
      ended = steps(s, IDLE_FRAME, 1).find((e) => e.type === "combo-end");
    }
    expect(ended).toMatchObject({ type: "combo-end", count: 8, reason: "time" });
    expect(s.combo).toBe(0);
    expect(s.maxCombo).toBe(8);
  });
});

describe("the render frame's v1.3 fields", () => {
  it("carry the pickups, the combo, the route and whether the player is steering, without touching the hash", () => {
    const s = night();
    const f = newRenderFrame();
    const before = hashState(s);
    fillRenderFrame(s, f);
    expect(hashState(s)).toBe(before);
    expect(f.pickups).toHaveLength(s.pickups.length);
    expect(f.pickups![0]).toEqual({ id: 0, kind: s.pickups[0].kind, pos: { x: s.pickups[0].x, y: s.pickups[0].y, z: s.pickups[0].z }, taken: false });
    expect(f.combo).toEqual({ count: 0, multiplier: 1, ticksLeft: 0 });
    expect(f.route).toEqual(s.city.zones.map((z) => z.center));
    stepSim(s, IDLE_FRAME);
    fillRenderFrame(s, f);
    expect(f.hero.controlled).toBe(false);
    stepSim(s, stick(0, 1));
    fillRenderFrame(s, f);
    expect(f.hero.controlled).toBe(true);
  });
});

describe("scripted players chain swings across the city (24 routes each, four legs, the stick held toward the stop)", () => {
  it("holding the web, tapping it, or letting go when rising: few misses, ten webs in a row early on", () => {
    const holder = measure("holder");
    const tapper = measure("tapper");
    const releaser = measure("releaser");
    for (const [name, m] of [
      ["holder", holder],
      ["tapper", tapper],
      ["releaser", releaser],
    ] as const) {
      expect(m.finished, name).toBeGreaterThanOrEqual(22);
      expect(m.missesPerMin, name).toBeLessThan(1.2);
      expect(m.chained, name).toBeGreaterThanOrEqual(22);
      expect(m.medianChain10!, name).toBeLessThan(14);
      expect(m.medianLeg!, name).toBeLessThan(12);
    }
    expect(releaser.perfectRate).toBeGreaterThan(0.5);
  }, 120_000);
});
