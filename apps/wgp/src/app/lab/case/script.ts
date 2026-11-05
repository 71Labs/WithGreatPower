/**
 * Fixture frames for Case file 001, until the gameplay build's chapter sim lands: a real night's
 * city (game-core's `generateCity`, with Doc's bridge-deck stage for the standoff), three clue
 * roofs picked near the bridge, and a `RenderFrame3D` with the v1.5 `chapter` written every
 * step from closed-form scripts, in the spec's field names (scene/chapter/contract.ts):
 *
 * - investigate: the hero on a clue's roof, looking at it (or walking roof to roof);
 * - standoff: the Right-Clicker on the deck running his moves (idle, aim, flash, recover,
 *   copy, drag, stunned) or holding one, two paper copies in the way, the SCREENSHOT hitting
 *   every other time;
 * - rescue: Mary saved on the deck, her restore filling (or held), two copies by her;
 * - done: Mary freed.
 *
 * The chapter's events (clue-found, screenshot, copy-spawn, copy-pop, drag, captive-restore,
 * captive-freed) are emitted as a sim would. Never the game's sim; never used outside /lab.
 */
import { generateCity } from "@wgp/game-core/sim3d";
import type { Building, City, HeroAction, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";
import type { Stop } from "@wgp/game-core/types";

import { citySolids } from "@/game3d/scene/camera/raycast";
import { cluePlacement, type CluePlace } from "@/game3d/scene/chapter/clues";
import type { ChapterEvent, ChapterFrame, ClueId, RightClickerPhase, SceneVillain } from "@/game3d/scene/chapter/contract";
import { AIM_TICKS } from "@/game3d/scene/chapter/math";

export type CaseScene = "investigate" | "standoff" | "rescue" | "done";
export const CASE_SCENES: CaseScene[] = ["investigate", "standoff", "rescue", "done"];
/** Which clue the investigation looks at ("walk": roof to roof). */
export type ClueView = ClueId | "walk";
export const CLUE_VIEWS: ClueView[] = ["tabs", "cursor", "pixels", "walk"];
/** The Right-Clicker's script: his fight's loop, or one phase held. */
export type PhaseChoice = "cycle" | RightClickerPhase;

/** A night with one fight on the bridge deck (Doc's stage) for the standoff. */
export const CASE_STOPS: Stop[] = [
  { kind: "errand", ally: "bearson", errand: "scoop", district: "queens-block" },
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 1, boss: false, quest: false },
];

/** His loop in a fight: phase and seconds. */
const LOOP: [RightClickerPhase, number][] = [
  ["idle", 1.6],
  ["aim", AIM_TICKS / 60],
  ["flash", 0.12],
  ["recover", 1.2],
  ["copy", 1.2],
  ["idle", 1.2],
  ["drag", 1.0],
  ["idle", 0.8],
  ["aim", AIM_TICKS / 60],
  ["flash", 0.12],
  ["recover", 1.2],
  ["stunned", 1.5],
];
const LOOP_LEN = LOOP.reduce((s, [, d]) => s + d, 0);

const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const HERO_R = 26;

export interface CaseSite {
  id: ClueId;
  pos: Vec3;
  roof: Building;
  /** Where the scene stands its prop (clues.ts). */
  place: CluePlace;
}

function roofOf(b: Building): number {
  return b.h;
}

/** Three clue roofs near the bridge, spread apart, deterministic for the city. */
export function pickClueRoofs(city: City): CaseSite[] {
  const solids = citySolids(city);
  const deck = city.bridge?.deck;
  const c = deck ? v((deck.x0 + deck.x1) / 2, deck.y, (deck.z0 + deck.z1) / 2) : city.start;
  const stageIds = new Set<number>();
  const zone = city.zones.find((z) => z.stage);
  if (zone?.stage) for (const b of city.buildings) if (Math.abs(b.h - zone.stage.y) < 2 && b.x0 < zone.bounds.x1 && b.x1 > zone.bounds.x0 && b.z0 < zone.bounds.z1 && b.z1 > zone.bounds.z0) stageIds.add(b.id);
  const fits = city.buildings
    .filter((b) => !b.top && b.x1 - b.x0 > 220 && b.z1 - b.z0 > 220 && !stageIds.has(b.id))
    .map((b) => ({ b, d: Math.hypot((b.x0 + b.x1) / 2 - c.x, (b.z0 + b.z1) / 2 - c.z) }))
    .filter((x) => x.d > 650 && x.d < 2600)
    .sort((a, b) => a.d - b.d);
  const out: CaseSite[] = [];
  const ids: ClueId[] = ["pixels", "cursor", "tabs"];
  for (const { b } of fits) {
    const p = v((b.x0 + b.x1) / 2, roofOf(b), (b.z0 + b.z1) / 2);
    if (out.some((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 520)) continue;
    const id = ids[out.length];
    out.push({ id, pos: p, roof: b, place: cluePlacement(city, solids, id, p) });
    if (out.length === 3) break;
  }
  return out;
}

export function caseCity(seed = 7): City {
  return generateCity(seed, CASE_STOPS);
}

export class CaseScript {
  readonly frame: RenderFrame3D & { chapter: ChapterFrame };
  readonly sites: CaseSite[];
  /** The fight zone on the deck, and its axis. */
  private readonly stop: number;
  private readonly centre: Vec3;
  private readonly axis: { x: number; z: number };
  scene: CaseScene = "investigate";
  clue: ClueView = "tabs";
  phase: PhaseChoice = "cycle";
  /** Mary's restore held at a value, or null to fill it (3 s) and loop. */
  restore: number | null = null;
  private t = 0;
  private sceneT = 0;
  private lastPhase = "";
  private loopIndex = -1;
  private copiesUp = false;
  private nextCopy = 1;
  private freed = false;
  private found = new Set<ClueId>();
  private lastRestoreQ = -1;

  constructor(readonly city: City) {
    this.sites = pickClueRoofs(city);
    const zi = city.zones.findIndex((z) => z.stage);
    this.stop = Math.max(0, zi);
    const z = city.zones[this.stop];
    const st = z?.stage;
    this.centre = st ? v((st.x0 + st.x1) / 2, st.y, (st.z0 + st.z1) / 2) : city.start;
    const ax = city.bridge?.axis ?? "x";
    this.axis = ax === "x" ? { x: 1, z: 0 } : { x: 0, z: 1 };
    this.frame = {
      tick: 0,
      alpha: 1,
      hero: { pos: v(), vel: v(), anchor: null, grounded: true, hp: 100, maxHp: 100, fluid: 100, hurtFlash: 0, shield: false, facing: v(1, 0, 0), action: "idle", actionTicks: 0, ropeLen: 0, cloak: false, controlled: false },
      villains: [],
      hazards: [],
      stop: 0,
      mode: "travel",
      timeScale: 1,
      route: [],
      chapter: {
        id: "case-001",
        phase: "investigate",
        clues: this.sites.map((s) => ({ id: s.id, pos: { ...s.pos }, found: false })),
        captive: null,
        copies: [],
      },
    };
  }

  /** Start a scene over (events from here on). */
  set(scene: CaseScene): void {
    this.scene = scene;
    this.sceneT = 0;
    this.loopIndex = -1;
    this.lastPhase = "";
    this.freed = scene === "done";
    this.lastRestoreQ = -1;
    this.found.clear();
  }

  /** Run his fight's loop, or hold one phase. */
  hold(phase: PhaseChoice): void {
    this.phase = phase;
  }

  /** Which clue the investigation looks at. */
  look(clue: ClueView): void {
    this.clue = clue;
  }

  /** Hold Mary's restore at a value, or null to fill it on a loop. */
  holdRestore(restore: number | null): void {
    this.restore = restore;
  }

  /** A point on the deck: `along` the bridge from the stage's centre, `across` it. */
  private deck(along: number, across = 0, up = 0): Vec3 {
    const a = this.axis;
    return v(this.centre.x + a.x * along - a.z * across, this.centre.y + up, this.centre.z + a.z * along + a.x * across);
  }

  private hero(pos: Vec3, face: Vec3, action: HeroAction = "idle", vel: Vec3 = v()): void {
    const h = this.frame.hero;
    Object.assign(h.pos, pos);
    Object.assign(h.vel, vel);
    const l = Math.hypot(face.x - pos.x, face.z - pos.z) || 1;
    h.facing = v((face.x - pos.x) / l, 0, (face.z - pos.z) / l);
    h.grounded = true;
    h.anchor = null;
    if (h.action !== action) h.actionTicks = 0;
    h.action = action;
    h.actionTicks = (h.actionTicks ?? 0) + 1;
  }

  step(dt: number, events: ChapterEvent[]): void {
    this.t += dt;
    this.sceneT += dt;
    const f = this.frame;
    const ch = f.chapter;
    f.tick++;
    f.hazards.length = 0;
    ch.phase = this.scene;
    // Clues: unfound while investigating (one found per few seconds walking), all found after.
    for (const c of ch.clues) {
      const want = this.scene !== "investigate" || this.found.has(c.id);
      if (want && !c.found) events.push({ type: "clue-found", id: c.id });
      c.found = want;
    }
    if (this.scene === "investigate") this.investigate(dt, events);
    else if (this.scene === "standoff") this.standoff(events);
    else this.rescue(events);
  }

  private investigate(dt: number, events: ChapterEvent[]): void {
    const f = this.frame;
    f.mode = "travel";
    f.stop = this.stop;
    f.villains.length = 0;
    f.chapter.captive = null;
    this.clearCopies(events, false);
    const sites = this.sites;
    if (!sites.length) return;
    let site: CaseSite;
    if (this.clue === "walk") {
      const i = Math.floor(this.sceneT / 6) % sites.length;
      site = sites[i];
      if (this.sceneT % 6 > 3.5) this.found.add(site.id);
    } else site = sites.find((s) => s.id === this.clue) ?? sites[0];
    // Stand on its roof in front of its prop (where the scene puts it), looking at it.
    const p = site.place;
    const b = site.roof;
    const d = site.id === "pixels" ? 150 : 200;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const x = Math.min(b.x1 - 30, Math.max(b.x0 + 30, p.x + fx * d - fz * 35));
    const z = Math.min(b.z1 - 30, Math.max(b.z0 + 30, p.z + fz * d + fx * 35));
    this.hero(v(x, p.floor + HERO_R, z), v(p.x, p.floor, p.z));
    f.route = [site.pos];
    void dt;
  }

  private phaseNow(): [RightClickerPhase, number, number] {
    if (this.phase !== "cycle") return [this.phase, this.sceneT % 4, 0];
    const u = this.sceneT % LOOP_LEN;
    let acc = 0;
    for (let i = 0; i < LOOP.length; i++) {
      const [p, d] = LOOP[i];
      if (u < acc + d) return [p, u - acc, i];
      acc += d;
    }
    return ["idle", 0, 0];
  }

  private standoff(events: ChapterEvent[]): void {
    const f = this.frame;
    f.mode = "fight";
    f.stop = this.stop;
    f.chapter.captive = { pos: this.deck(-330, 60), restore: 0, freed: false };
    const rcAt = this.deck(-140);
    const heroAt = this.deck(250, -30);
    const [phase, st, index] = this.phaseNow();
    // Pulled toward him on the drag; standing off otherwise.
    const pull = phase === "drag" ? Math.min(1, Math.max(0, (st - 0.25) / 0.5)) : 0;
    const hp = this.deck(250 - pull * 180, -30 + pull * 10, HERO_R);
    this.hero(hp, rcAt);
    void heroAt;
    // The SCREENSHOT: aimed at where the hero is, a little off on the misses.
    const miss = index > 6;
    const toHero = { x: hp.x - rcAt.x, z: hp.z - rcAt.z };
    const l = Math.hypot(toHero.x, toHero.z) || 1;
    const off = miss ? 0.5 : 0;
    const dir = v((toHero.x / l) * Math.cos(off) - (toHero.z / l) * Math.sin(off), 0, (toHero.x / l) * Math.sin(off) + (toHero.z / l) * Math.cos(off));
    const list = f.villains as SceneVillain[];
    list.length = 0;
    list.push({
      id: "right-clicker",
      copy: false,
      pos: v(rcAt.x, rcAt.y + HERO_R, rcAt.z),
      vel: v(),
      hits: phase === "stunned" ? 5 : 6,
      hitsMax: 8,
      state: phase,
      stateTicks: Math.floor(st * 60),
      facing: v(dir.x, 0, dir.z),
      aim: phase === "aim" || phase === "flash" ? { dir, half: 0.3 } : null,
    });
    if (phase !== this.lastPhase) {
      if (phase === "flash") events.push({ type: "screenshot", hit: !miss });
      if (phase === "drag") events.push({ type: "drag", from: { ...hp }, to: this.deck(70, -20, HERO_R) });
      this.lastPhase = phase;
      this.loopIndex = index;
    }
    // CTRL+C: two copies stand between them from the copy until the stun.
    const want = this.phase === "cycle" ? index >= 4 && index < 11 : this.phase === "copy";
    if (want && !this.copiesUp) {
      this.copiesUp = true;
      const a = this.nextCopy++;
      const b = this.nextCopy++;
      const yaw = Math.atan2(dir.x, dir.z) + Math.PI;
      f.chapter.copies = [
        { id: a, pos: this.deck(40, -30), yaw: yaw - 0.15, alive: true },
        { id: b, pos: this.deck(95, 25), yaw: yaw + 0.2, alive: true },
      ];
      events.push({ type: "copy-spawn", id: a }, { type: "copy-spawn", id: b });
    } else if (!want && this.copiesUp) this.clearCopies(events, true);
  }

  private rescue(events: ChapterEvent[]): void {
    const f = this.frame;
    f.mode = "fight";
    f.stop = this.stop;
    const at = this.deck(-60, 20);
    const done = this.scene === "done";
    const fill = this.restore ?? Math.min(1, (this.sceneT % 5) / 3);
    const restore = done ? 1 : fill;
    const freed = done || (this.restore === null && this.sceneT % 5 > 3.4);
    f.chapter.captive = { pos: at, restore, freed };
    if (!done) {
      const q = Math.floor(restore * 4);
      if (q !== this.lastRestoreQ) {
        this.lastRestoreQ = q;
        events.push({ type: "captive-restore", p: q / 4 });
      }
    }
    if (freed && !this.freed) events.push({ type: "captive-freed" });
    if (!freed && this.freed && !done) {
      this.lastRestoreQ = -1;
    }
    this.freed = freed;
    // The hero beside her, holding web to restore her.
    // Beside her, a little back, so the camera over his shoulder sees her.
    const hp = this.deck(15, -50, HERO_R);
    this.hero(hp, this.deck(-260, -40));
    // Beaten, he's out of the fight (his fall is the lab cast's `webbed`).
    f.villains.length = 0;
    // Two copies try to interrupt while she's saved.
    if (!done && !this.copiesUp) {
      this.copiesUp = true;
      const a = this.nextCopy++;
      const b = this.nextCopy++;
      f.chapter.copies = [
        { id: a, pos: this.deck(0, 45), yaw: Math.PI * 0.8, alive: true },
        { id: b, pos: this.deck(120, -30), yaw: -Math.PI * 0.6, alive: true },
      ];
      events.push({ type: "copy-spawn", id: a }, { type: "copy-spawn", id: b });
    } else if (done && this.copiesUp) this.clearCopies(events, true);
  }

  private clearCopies(events: ChapterEvent[], pop: boolean): void {
    const f = this.frame;
    if (!this.copiesUp && !f.chapter.copies.length) return;
    if (pop) for (const c of f.chapter.copies) if (c.alive) events.push({ type: "copy-pop", id: c.id });
    f.chapter.copies = [];
    this.copiesUp = false;
  }
}
