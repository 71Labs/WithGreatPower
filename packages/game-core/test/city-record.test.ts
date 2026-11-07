/**
 * Free roam's save record (rules/city.ts): an outing filed into the save moves stages on only,
 * keeps what was found, moves the spot, and pays each first finish's XP once, ever (XP only:
 * nothing else in the save changes).
 */
import { describe, expect, it } from "vitest";

import { applyOuting, cityRecord, cityTotals, emptyCity, roamStartFrom, taskStep, TASKS, PAGES, type CityOuting } from "../src/rules/city";
import { XP_TO_NEXT } from "../src/rules/data";
import { PAGE_XP, TASK_XP, VIEW_XP } from "../src/sim3d/roam/constants";
import { TASK_DONE, TASK_IDS } from "../src/sim3d/roam/types";
import { roamWorld } from "../src/sim3d/roam/world";
import { heroSave, STANDARD } from "./helpers";

const zeros = () => TASK_IDS.map(() => 0);
const outing = (o: Partial<CityOuting> = {}): CityOuting => ({ stage: zeros(), items: zeros(), pages: 0, views: 0, at: { x: 1, y: 2, z: 3, fx: 1, fz: 0 }, ...o });

describe("the city record", () => {
  it("starts empty, and an empty start is the spawn roof with nothing found", () => {
    const s = heroSave(STANDARD, "Roamer");
    expect(cityRecord(s)).toEqual(emptyCity());
    const start = roamStartFrom(cityRecord(s));
    expect(start).toEqual({ stage: zeros(), items: zeros(), pages: 0, views: 0, talks: [], at: null });
  });

  it("pays XP for each first finish, once: tasks, pages and viewpoints", () => {
    const s = heroSave(STANDARD, "Roamer");
    const out = outing({ stage: [TASK_DONE, 2, 1, 0], pages: 0b1011, views: 0b1 });
    const first = applyOuting(s, out);
    expect(first.gains).toEqual({ tasks: ["bread"], pages: 3, views: 1, xp: TASK_XP + 3 * PAGE_XP + VIEW_XP });
    expect(first.record.xp).toBe(first.gains.xp);
    expect(first.record.tasks).toEqual({ bread: TASK_DONE, pickpocket: 2, pixels: 1 });
    expect(first.record.at).toEqual(out.at);
    // XP lands on the hero (a level-1 hero needs XP_TO_NEXT(1) for level 2).
    const xp = s.hero!.xp + first.gains.xp;
    expect(first.save.hero!.xp + (first.save.hero!.level > s.hero!.level ? XP_TO_NEXT(s.hero!.level) : 0)).toBe(xp);
    // Filed again: nothing new.
    const again = applyOuting(first.save, out);
    expect(again.gains.xp).toBe(0);
    expect(again.save.hero).toEqual(first.save.hero);
    expect(again.record.outings).toBe(2);
  });

  it("never moves a stage back, and keeps every item found", () => {
    const s = heroSave(STANDARD, "Roamer");
    const a = applyOuting(s, outing({ stage: [1, 2, 1, 1], items: [0, 0, 0b0101, 0b1] }));
    const b = applyOuting(a.save, outing({ stage: [0, 0, 1, 0], items: [0, 0, 0b1010, 0b10] }));
    expect(b.record.tasks).toEqual({ bread: 1, pickpocket: 2, pixels: 1, graffiti: 1 });
    expect(b.record.items).toEqual({ pixels: 0b1111, graffiti: 0b11 });
  });

  it("levels the hero up past XP_TO_NEXT, as a night does", () => {
    const s = heroSave(STANDARD, "Roamer");
    const near = { ...s, hero: { ...s.hero!, xp: XP_TO_NEXT(1) - 1 } };
    const r = applyOuting(near, outing({ pages: 1 }));
    expect(r.save.hero!.level).toBe(2);
    expect(r.save.hero!.maxHp).toBeGreaterThan(s.hero!.maxHp);
  });

  it("rebuilds a start from a record, refusing junk", () => {
    const start = roamStartFrom({ ...emptyCity(), tasks: { bread: 99 as number, pixels: 1 }, items: { pixels: 3 }, at: { x: Number.NaN, y: 0, z: 0, fx: 1, fz: 0 } });
    expect(start.stage.slice(0, 4)).toEqual([0, 0, 1, 0]);
    expect(start.items.slice(0, 4)).toEqual([0, 0, 3, 0]);
    expect(start.stage).toHaveLength(TASK_IDS.length);
    expect(start.at).toBeNull();
  });

  it("roam-3: a record from before Cross-chain (four tasks) starts it fresh and pays it once", () => {
    const s = heroSave(STANDARD, "Roamer");
    // A finished four-task record, as a roam-2 player's save holds it (no crosschain key at all).
    const old = { ...emptyCity(), tasks: { bread: TASK_DONE, pickpocket: TASK_DONE, pixels: TASK_DONE, graffiti: TASK_DONE }, items: { pixels: 0xff, graffiti: 0xf }, pages: 0xfff, views: 0x1f, xp: 4 * TASK_XP, outings: 9 };
    const saved = { ...s, city: old };
    const start = roamStartFrom(cityRecord(saved));
    const cx = TASK_IDS.indexOf("crosschain");
    expect(start.stage[cx]).toBe(0);
    expect(start.items[cx]).toBe(0);
    expect(start.stage.slice(0, 4)).toEqual([TASK_DONE, TASK_DONE, TASK_DONE, TASK_DONE]);
    expect(cityTotals(cityRecord(saved), { pages: 12, views: 5 })).toEqual({ tasks: 4, pages: 12, views: 5 });
    // Under way across an outing: its stage and relays are kept, nothing paid yet.
    const half = applyOuting(saved, outing({ stage: [...start.stage.slice(0, cx), 1], items: [...start.items.slice(0, cx), 0b0101] }));
    expect(half.gains.xp).toBe(0);
    expect(half.record.tasks.crosschain).toBe(1);
    expect(half.record.items.crosschain).toBe(0b0101);
    expect(roamStartFrom(half.record).stage[cx]).toBe(1);
    // Finished: 40 XP, once; the old four stay done.
    const done = applyOuting(half.save, outing({ stage: [...start.stage.slice(0, cx), TASK_DONE], items: [...start.items.slice(0, cx), 0b1111] }));
    expect(done.gains).toEqual({ tasks: ["crosschain"], pages: 0, views: 0, xp: TASK_XP });
    expect(done.record.tasks).toMatchObject({ bread: TASK_DONE, pickpocket: TASK_DONE, pixels: TASK_DONE, graffiti: TASK_DONE, crosschain: TASK_DONE });
    expect(applyOuting(done.save, outing({ stage: [...start.stage.slice(0, cx), TASK_DONE] })).gains.xp).toBe(0);
    expect(cityTotals(done.record, { pages: 12, views: 5 }).tasks).toBe(5);
  });

  it("has content for every task and page the world places", () => {
    const w = roamWorld();
    expect(PAGES).toHaveLength(w.pages.length);
    for (const id of TASK_IDS) {
      expect(TASKS[id].steps[0]).toBeTruthy();
      expect(TASKS[id].steps[TASK_DONE]).toBeTruthy();
    }
    expect(TASKS.pixels.items).toBe(w.pixels.length);
    expect(TASKS.graffiti.items).toBe(w.tags.length);
    expect(TASKS.crosschain.items).toBe(w.relays.length);
    expect(taskStep("crosschain", 1, 2)).toBe("Unplug Doc Octochain’s relays (2 of 4)");
    expect(taskStep("pixels", 1, 3)).toBe(`Find Mary’s pixels (3 of ${w.pixels.length})`);
    expect(cityTotals({ ...emptyCity(), pages: 0b111, views: 0b1, tasks: { bread: TASK_DONE } }, { pages: 12, views: 5 })).toEqual({ tasks: 1, pages: 3, views: 1 });
  });
});
