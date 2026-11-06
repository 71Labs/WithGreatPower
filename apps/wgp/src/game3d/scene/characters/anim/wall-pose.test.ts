import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { CLIMB, ClimbGait, GAITS, LF, LH, RF, RH, WallFrame, type WallBody } from "./wall-pose";

/**
 * The climb's holds and gait on their own (no rig): a face at x = 0 facing +x, the body's hips
 * driven along it the way the sim moves him, one 60 Hz frame at a time.
 */

const DT = 1 / 60;
/** The MPFB hero's measures at 88 tall (wallBody(rig) on the real body). */
const BODY: WallBody = { shoulderY: 22.3, shoulderX: 11.1, reach: 26.6, forearm: 13.5, leg: 44.5, ankle: 3.64, hipH: 48.1, foot: 6.4, hand: 5.6 };

interface Frame {
  t: number;
  pos: Vector3[];
  planted: boolean[];
  starts: number[];
}

/** Drive the gait with the hips moving at (vu, vv) along the face for `secs` (u: toward his left, v: up). */
function drive(g: ClimbGait, w: WallFrame, base: Vector3, legs: { vu: number; vv: number; secs: number }[]): Frame[] {
  const out: Frame[] = [];
  let t = 0;
  let last = g.holds.map((h) => h.moves);
  for (const leg of legs) {
    for (let s = 0; s < leg.secs - 1e-9; s += DT) {
      const du = leg.vu * DT;
      const dv = leg.vv * DT;
      base.addScaledVector(w.left, du);
      base.y += dv;
      g.step(w, base, out.length ? du : 0, out.length ? dv : 0, DT);
      const moves = g.holds.map((h) => h.moves);
      out.push({ t, pos: g.holds.map((h) => h.pos.clone()), planted: g.planted(), starts: moves.map((m, i) => m - last[i]) });
      last = moves;
      t += DT;
    }
  }
  return out;
}

function setup() {
  const w = new WallFrame().set(1, 0, new Vector3(0, 0, 0), 2000);
  const base = new Vector3(BODY.forearm * CLIMB.hipOff, 300, 0);
  return { w, base, g: new ClimbGait(BODY) };
}

describe("the climb's holds", () => {
  it("plants every hold on the face and never slides a planted one", () => {
    const { w, base, g } = setup();
    const frames = drive(g, w, base, [{ vu: 0, vv: 120, secs: 4 }]);
    let slide = 0;
    let planted = 0;
    for (let i = 1; i < frames.length; i++) {
      for (let k = 0; k < 4; k++) {
        if (!frames[i].planted[k]) continue;
        planted++;
        // On the face at its gap: a wrist's, an ankle's (the ball of the foot on the face).
        expect(Math.abs(w.off(frames[i].pos[k]) - g.gap(k))).toBeLessThan(1e-6);
        if (frames[i - 1].planted[k]) slide = Math.max(slide, frames[i].pos[k].distanceTo(frames[i - 1].pos[k]));
      }
    }
    expect(planted).toBeGreaterThan(frames.length * 2.5);
    expect(slide).toBe(0);
    // Every limb moved, about once per cycle climbed (480 units at 44 a cycle).
    for (const h of g.holds) expect(h.moves).toBeGreaterThan(8);
  });

  it("climbs a limb at a time: a hand reaches while the other three hold, then the opposite foot steps", () => {
    const { w, base, g } = setup();
    const frames = drive(g, w, base, [{ vu: 0, vv: 120, secs: 4 }]);
    expect(g.mode).toBe("up");
    let bothHands = 0;
    let threeOrMore = 0;
    const order: number[] = [];
    for (const f of frames.slice(30)) {
      const moving = f.planted.map((p) => !p);
      if (moving[LH] && moving[RH]) bothHands++;
      if (moving.filter(Boolean).length >= 3) threeOrMore++;
      for (let k = 0; k < 4; k++) if (f.starts[k]) order.push(k);
    }
    expect(bothHands).toBe(0);
    expect(threeOrMore).toBe(0);
    // Right hand, left foot, left hand, right foot, over and over.
    const seq = order.slice(order.indexOf(RH), order.indexOf(RH) + 8);
    expect(seq).toEqual([RH, LF, LH, RF, RH, LF, LH, RF]);
  });

  it("at rest on the wall, a move in progress finishes and all four hold, breathing aside", () => {
    const { w, base, g } = setup();
    const frames = drive(g, w, base, [
      { vu: 0, vv: 120, secs: 1.05 },
      { vu: 0, vv: 0, secs: 1.5 },
    ]);
    const rest = frames.filter((f) => f.t > 1.05 + CLIMB.moveMax + 0.02);
    expect(rest.length).toBeGreaterThan(60);
    for (const f of rest) expect(f.planted).toEqual([true, true, true, true]);
    const first = rest[0].pos;
    for (const f of rest) for (let k = 0; k < 4; k++) expect(f.pos[k].distanceTo(first[k])).toBe(0);
  });

  it("climbs down feet first, scrambles each hand with its opposite foot when fast, and leads sideways with the near hand", () => {
    const starts = (frames: Frame[]) => {
      const order: number[][] = [];
      for (const f of frames.slice(40)) {
        const s = [0, 1, 2, 3].filter((k) => f.starts[k]);
        if (s.length) order.push(s);
      }
      return order;
    };
    const down = setup();
    const df = drive(down.g, down.w, down.base, [{ vu: 0, vv: -110, secs: 3 }]);
    expect(down.g.mode).toBe("down");
    const dOrder = starts(df).flat();
    const i0 = dOrder.indexOf(LF);
    expect(dOrder.slice(i0, i0 + 4)).toEqual([LF, RH, RF, LH]);

    const fast = setup();
    const ff = drive(fast.g, fast.w, fast.base, [{ vu: 0, vv: 230, secs: 3 }]);
    expect(fast.g.mode).toBe("fast");
    const pairs = starts(ff).filter((s) => s.length === 2);
    expect(pairs.length).toBeGreaterThan(8);
    for (const p of pairs) expect([`${LH},${RF}`, `${RH},${LF}`]).toContain(p.join(","));

    const side = setup();
    const sf = drive(side.g, side.w, side.base, [{ vu: 100, vv: 0, secs: 2 }]);
    expect(side.g.mode).toBe("left");
    const sOrder = starts(sf).flat();
    const j = sOrder.indexOf(LH);
    expect(sOrder.slice(j, j + 4)).toEqual([LH, LF, RH, RF]);
    // Planted, sideways too, nothing slides.
    for (let i = 1; i < sf.length; i++) for (let k = 0; k < 4; k++) if (sf[i].planted[k] && sf[i - 1].planted[k]) expect(sf[i].pos[k].distanceTo(sf[i - 1].pos[k])).toBe(0);
  });

  it("keeps every limb finite through a frame with no time in it (a paused render)", () => {
    const { w, base, g } = setup();
    drive(g, w, base, [{ vu: 0, vv: 120, secs: 0.5 }]);
    g.step(w, base, 0, 0, 0);
    base.y += 2;
    g.step(w, base, 0, 2, 0);
    drive(g, w, base, [{ vu: 0, vv: 120, secs: 0.5 }]);
    for (const h of g.holds) expect(Number.isFinite(h.pos.x + h.pos.y + h.pos.z)).toBe(true);
    expect(Number.isFinite(g.dir.u + g.dir.v + g.speed)).toBe(true);
  });

  it("re-plants a hold the body has left behind (a leap up the wall, a corner)", () => {
    const { w, base, g } = setup();
    drive(g, w, base, [{ vu: 0, vv: 120, secs: 1 }]);
    // A leap: 150 up in a blink, then on at the climb's pace.
    base.y += 150;
    g.step(w, base, 0, 150, DT);
    drive(g, w, base, [{ vu: 0, vv: 120, secs: 0.6 }]);
    for (let k = 0; k < 4; k++) {
      const h = g.home(k);
      const home = w.point(base, h.u, h.y, g.gap(k), new Vector3());
      expect(g.holds[k].pos.distanceTo(home)).toBeLessThan(GAITS.up.L);
    }
    // Round a corner: the face turns; within a few moves every hold is on the new one.
    const turned = new WallFrame().set(0, 1, new Vector3(base.x + 20, 0, 0), 2000);
    const b2 = new Vector3(base.x + 20, base.y, BODY.forearm * CLIMB.hipOff);
    drive(g, turned, b2, [{ vu: 0, vv: 120, secs: 1 }]);
    for (let k = 0; k < 4; k++) expect(Math.abs(turned.off(g.holds[k].pos) - g.gap(k))).toBeLessThan(CLIMB.footLift + 0.01);
  });
});
