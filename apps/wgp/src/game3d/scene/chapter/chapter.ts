/**
 * Case file 001, "Missing: Mary Jpeg", in the 3D scene: everything a chapter night draws on top
 * of a normal one, from the frame's v1.5 `chapter` and the Right-Clicker's villain fields
 * (docs/chapters/case-001.md), plus the chapter's sim events:
 *
 * - the clues (clues.ts): the torn poster on its pole, the scorched billboard, the pixel trail,
 *   each with a glow that dims once found, and "+CLUE!" when one is;
 * - SCREENSHOT (flash.ts): the aim cone on the deck while he aims, then the flash (an outline
 *   pulse instead under reduced motion or the Steady camera), "CLICK!"; when it lands, the
 *   hero framed as a screenshot and his pose held for the sim's 1 s freeze (the word "Saved!"
 *   is the HUD's);
 * - CTRL+C: "CTRL+C!" and the paper copies (copies.ts), which burst into card confetti when
 *   they pop (particles.ts); DRAG: a lasso from his cursor to the hero;
 * - captive Mary (captive.ts) compressed by 1 − restore inside her screenshot frame
 *   (frames.ts), its file tag under her feet so the HUD's restore bar has the space over her
 *   head; freed, a pixel burst, one "gm" (the HUD captions it too) and her wave.
 *
 * The Right-Clicker himself is a villain in characters.ts (anim/right-clicker.ts). Nothing is
 * built until a chapter frame arrives, so a normal night pays nothing. Visual triggers come
 * from the frames themselves (a clue's `found`, a copy's `alive`, the villain's phase), so
 * they show even if an event's missed; the events add what only they carry (a SCREENSHOT that
 * hit) and are de-duplicated against the frames.
 */
import { Group, NoColorSpace, TextureLoader, Vector3, type PerspectiveCamera, type Texture } from "three";

import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { assetUrl } from "@/lib/assets";

import { surfaceBelow, type CitySolids } from "../camera/raycast";
import type { CharacterSystem } from "../characters/characters";
import type { SharedUniforms } from "../city/materials";
import type { BurstOptions } from "../effects";
import type { QualityTier } from "../quality";
import { WebLine } from "../web";
import { Captive } from "./captive";
import { ClueProps, MARY_COLOURS } from "./clues";
import { chapterOf, rightClickerOf, type ChapterEvent, type ClueId, type SceneVillain } from "./contract";
import { PaperCopies } from "./copies";
import { AimCone, ScreenFlash } from "./flash";
import { ShotFrames } from "./frames";
import { aimCharge, inCone, SAVED_SECONDS, smooth } from "./math";
import { Pops } from "./particles";

export const POSTER_URL = "/media/chapters/case-001-tabs-tex.webp";
export const CUTOUT_URL = "/media/chapters/case-001-copy-tex.webp";

/** What the chapter needs from the rest of the scene. */
export interface ChapterHost {
  readonly characters: CharacterSystem;
  burst(word: string, at: Vec3, opts?: BurstOptions): void;
}

/** The confetti a cut-out bursts into: its card, the suit's red, ink-dark scraps. */
const PAPER_COLOURS = ["#E8DFCC", "#D2B48A", "#E5392C", "#C8A877", "#FFFFFF"];
/** Seconds the cone stays white after the shot. */
const CONE_FLASH = 0.35;

interface Parts {
  clues: ClueProps;
  copies: PaperCopies;
  pops: Pops;
  cone: AimCone;
  flash: ScreenFlash;
  frames: ShotFrames;
  captive: Captive;
  lasso: WebLine;
  poster: Texture;
  cutout: Texture;
}

function texture(url: string): Texture {
  const t = new TextureLoader().load(assetUrl(url));
  t.colorSpace = NoColorSpace;
  return t;
}

const _a = new Vector3();
const _b = new Vector3();
const _hero = new Vector3();
const _site: Vec3 = { x: 0, y: 0, z: 0 };

export class ChapterScene {
  readonly root = new Group();
  private parts: Parts | null = null;
  private tier: QualityTier = "medium";
  private reduced = false;
  /** Seen the chapter's first frame (states before it don't pop or burst). */
  private primed = false;
  private readonly found = new Set<ClueId>();
  private rcState = "";
  private lastAim: { dir: Vec3; half: number } | null = null;
  private lastFlashAt = -10;
  private coneFlash = -1;
  private savedT = -1;
  private freedT = -1;
  private freed = false;
  private readonly copyAt = new Map<number, Vec3>();
  private readonly popped = new Set<number>();
  private readonly gone: number[] = [];
  private time = 0;
  private readonly lassoPts = new Float32Array(2 * 3);
  /** The SCREENSHOT that fired last: shown as the outline pulse (reduced motion), for the lab. */
  lastPulsed = false;

  constructor(
    private readonly city: City,
    private readonly solids: CitySolids,
    private readonly shared: SharedUniforms,
    private readonly host: ChapterHost,
  ) {
    this.root.name = "wgp-chapter";
    this.root.visible = false;
  }

  /** Whether a chapter night is on (its first frame has arrived). */
  get active(): boolean {
    return this.parts !== null && this.root.visible;
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
    const p = this.parts;
    if (!p) return;
    const light = tier === "low";
    p.clues.light = light;
    p.copies.light = light;
    p.pops.light = light;
    p.captive.setTier(tier);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    const p = this.parts;
    if (!p) return;
    p.clues.reducedMotion = on;
    p.copies.reducedMotion = on;
    p.pops.reducedMotion = on;
    p.cone.reducedMotion = on;
    p.flash.reducedMotion = on;
    p.captive.reducedMotion = on;
  }

  private ensure(): Parts {
    if (this.parts) return this.parts;
    const poster = texture(POSTER_URL);
    const cutout = texture(CUTOUT_URL);
    const s = this.shared;
    const p: Parts = {
      clues: new ClueProps(s, poster, this.city, this.solids),
      copies: new PaperCopies(s, cutout),
      pops: new Pops(s),
      cone: new AimCone(s),
      flash: new ScreenFlash(),
      frames: new ShotFrames(s),
      captive: new Captive(s, this.solids),
      lasso: new WebLine(),
      poster,
      cutout,
    };
    p.lasso.mesh.visible = false;
    this.root.add(p.clues.root, p.copies.mesh, p.pops.mesh, p.cone.mesh, p.flash.mesh, p.frames.mesh, p.captive.root, p.lasso.mesh);
    this.parts = p;
    this.setTier(this.tier);
    this.setReducedMotion(this.reduced);
    // His body and clips come down while the hero hunts the clues.
    this.host.characters.prepareVillain("right-clicker");
    p.captive.ask();
    return p;
  }

  update(frame: RenderFrame3D, camera: PerspectiveCamera, size: { width: number; height: number }, dt: number, time: number): void {
    const ch = chapterOf(frame);
    if (!ch) {
      if (this.root.visible) this.reset();
      return;
    }
    const p = this.ensure();
    this.root.visible = true;
    this.time = time;
    const first = !this.primed;
    this.primed = true;
    const hero = this.heroCentre(frame);

    // Clues.
    p.clues.update(ch.clues, time);
    for (const c of ch.clues) {
      if (c.found && !this.found.has(c.id)) this.clueFound(c.id, !first);
      else if (!c.found) this.found.delete(c.id);
    }

    // The Right-Clicker's SCREENSHOT, CTRL+C and DRAG.
    const rc = rightClickerOf(frame);
    this.villain(frame, rc, hero, first, size, dt);

    // Paper copies: stand the live ones, pop the ones that went.
    let list = ch.copies;
    if (this.popped.size) list = list.filter((c) => !this.popped.has(c.id) || !c.alive);
    for (const c of list) if (c.alive) this.copyAt.set(c.id, c.pos);
    p.copies.update(list, (x, z, y) => surfaceBelow(this.solids, x, z, y), time, this.gone);
    for (const id of this.gone) this.popCopy(id);

    // Captive Mary and her frame.
    // The sim's position, not his breathing hips: a jittering target would keep her stepping round.
    const centre = p.captive.update(ch.captive, frame.hero.pos, camera, size, dt);
    p.frames.begin();
    if (ch.captive && centre) {
      const c = centre.clone();
      if (ch.captive.freed && !this.freed) this.free(c, !first);
      if (!ch.captive.freed) {
        this.freed = false;
        this.freedT = -1;
        const bob = this.reduced ? 0 : Math.sin(time * 1.6) * 2;
        p.frames.add(c.x, c.y + 2 + bob, c.z, 64, 100, 1, 0);
      } else if (this.freedT >= 0 && this.freedT < 0.35) {
        // The frame lets go of her: it swells and fades.
        const u = this.freedT / 0.35;
        p.frames.add(c.x, c.y + 2, c.z, 64, 100, 1 - u, 0, this.reduced ? 1 : 1 + 0.4 * smooth(u));
      }
    }
    if (this.freedT >= 0) this.freedT += dt;

    // SAVED: the hero in a screenshot frame, his pose held.
    const chars = this.host.characters;
    if (this.savedT >= 0) {
      const u = this.savedT / SAVED_SECONDS;
      p.frames.add(hero.x, hero.y + 6, hero.z, 74, 120, u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15, 1);
      chars.heroWash = this.savedT < 0.4 ? 0.55 * (1 - this.savedT / 0.4) : 0;
      this.savedT += dt;
      if (this.savedT >= SAVED_SECONDS) {
        this.savedT = -1;
        chars.heroWash = 0;
      }
    }
    p.frames.end();

    p.flash.update(dt, size.width, size.height);
    p.pops.update(dt);
  }

  private heroCentre(frame: RenderFrame3D): Vector3 {
    const at = this.host.characters.jointOf("hero", "hips", _hero);
    return at ?? _hero.set(frame.hero.pos.x, frame.hero.pos.y, frame.hero.pos.z);
  }

  private villain(frame: RenderFrame3D, rc: SceneVillain | null, hero: Vector3, first: boolean, size: { width: number; height: number }, dt: number): void {
    const p = this.parts!;
    if (!rc) {
      p.cone.hide();
      p.lasso.mesh.visible = false;
      this.rcState = "";
      return;
    }
    const state = rc.state;
    if (state !== this.rcState) {
      if (!first) {
        if (state === "flash") this.fireFlash(rc);
        else if (state === "copy") this.host.burst("CTRL+C!", { x: rc.pos.x, y: rc.pos.y + 96, z: rc.pos.z }, { size: 84, life: 0.8, rise: 24 });
      }
      this.rcState = state;
    }
    if (rc.aim) this.lastAim = { dir: { ...rc.aim.dir }, half: rc.aim.half };
    const zone = this.city.zones[frame.stop];
    const floor = frame.mode === "fight" && zone?.stage ? zone.stage.y : surfaceBelow(this.solids, rc.pos.x, rc.pos.z, rc.pos.y + 6);
    const aim = rc.aim ?? this.lastAim;
    const flashing = this.coneFlash >= 0 && this.coneFlash < CONE_FLASH;
    if (aim && (state === "aim" || state === "flash" || flashing)) {
      const charge = state === "aim" ? aimCharge(rc.stateTicks ?? 0) : 1;
      const hot = inCone(rc.pos, aim.dir, aim.half, hero);
      const white = flashing ? 1 - this.coneFlash / CONE_FLASH : state === "flash" ? 1 : 0;
      p.cone.show(rc.pos.x, floor, rc.pos.z, aim.dir, aim.half, charge, white, hot);
    } else p.cone.hide();
    if (this.coneFlash >= 0) {
      this.coneFlash += dt;
      if (this.coneFlash > CONE_FLASH) this.coneFlash = -1;
    }
    // DRAG: a lasso from his cursor hand to the hero.
    if (state === "drag") {
      const hand = this.host.characters.jointOf("right-clicker", "handR", _a) ?? _a.set(rc.pos.x, rc.pos.y + 60, rc.pos.z);
      this.lassoPts.set([hand.x, hand.y, hand.z, hero.x, hero.y + 10, hero.z]);
      p.lasso.setPoints(this.lassoPts, 2, size.width, size.height, 0.8);
      p.lasso.mesh.visible = true;
    } else p.lasso.mesh.visible = false;
  }

  /** The shot: the flash (or the pulse), "CLICK!", the cone goes white. */
  private fireFlash(rc: SceneVillain): void {
    if (this.time - this.lastFlashAt < 0.3) return;
    this.lastFlashAt = this.time;
    const p = this.parts!;
    p.flash.fire();
    this.lastPulsed = p.flash.pulsed;
    this.coneFlash = 0;
    const hand = this.host.characters.jointOf("right-clicker", "handR", _b);
    this.host.burst("CLICK!", hand ? { x: hand.x, y: hand.y + 30, z: hand.z } : { x: rc.pos.x, y: rc.pos.y + 90, z: rc.pos.z }, { size: 76, life: 0.6, rise: 18 });
  }

  private clueFound(id: ClueId, burst: boolean): void {
    this.found.add(id);
    if (!burst) return;
    const at = this.parts!.clues.siteOf(id, _site);
    if (at) this.host.burst("+CLUE!", { ...at }, { size: 92, life: 1, rise: 36 });
  }

  private popCopy(id: number): void {
    if (this.popped.has(id) && !this.copyAt.has(id)) return;
    const at = this.copyAt.get(id);
    this.copyAt.delete(id);
    if (!at) return;
    this.popped.add(id);
    this.parts!.pops.pop("paper", { x: at.x, y: surfaceBelow(this.solids, at.x, at.z, at.y + 4) + 46, z: at.z }, PAPER_COLOURS);
  }

  private free(centre: Vector3, burst: boolean): void {
    this.freed = true;
    this.freedT = 0;
    if (!burst) return;
    this.parts!.pops.pop("pixel", centre, [...MARY_COLOURS, "#F8D5BC", "#3B5BA8"]);
    this.host.burst("gm", { x: centre.x, y: centre.y + 64, z: centre.z }, { size: 96, life: 1.4, rise: 30 });
  }

  /** SAVED: the hero in a screenshot frame, his pose held (the word is the HUD's "Saved!"). */
  private saved(): void {
    this.savedT = 0;
    this.host.characters.freezeHero(SAVED_SECONDS);
  }

  /** The chapter's sim events (session/effects.ts passes them on). */
  event(ev: ChapterEvent): void {
    if (!this.parts) return;
    switch (ev.type) {
      case "clue-found":
        if (!this.found.has(ev.id)) this.clueFound(ev.id, true);
        break;
      case "screenshot":
        // The frame's phase fires the flash; an event that beats it there fires it now.
        if (this.time - this.lastFlashAt > 0.3) {
          this.parts.flash.fire();
          this.lastPulsed = this.parts.flash.pulsed;
          this.lastFlashAt = this.time;
          this.coneFlash = 0;
        }
        if (ev.hit) this.saved();
        break;
      case "copy-spawn":
        this.popped.delete(ev.id);
        this.parts.copies.spawn(ev.id, this.time);
        break;
      case "copy-pop":
        if (this.copyAt.has(ev.id)) this.popCopy(ev.id);
        else this.popped.add(ev.id);
        break;
      case "captive-freed":
        // The frame's `freed` does it on the next frame (it knows where she stands).
        break;
      default:
        break;
    }
  }

  /** Off a chapter night (a new run, the lab's reset): nothing shows, nothing's remembered. */
  private reset(): void {
    this.root.visible = false;
    this.primed = false;
    this.found.clear();
    this.rcState = "";
    this.lastAim = null;
    this.coneFlash = -1;
    this.savedT = -1;
    this.freedT = -1;
    this.freed = false;
    this.copyAt.clear();
    this.popped.clear();
    this.host.characters.heroWash = 0;
    const p = this.parts;
    if (!p) return;
    p.copies.clear();
    p.pops.clear();
    p.cone.hide();
    p.captive.hide();
  }

  dispose(): void {
    const p = this.parts;
    if (!p) return;
    p.clues.dispose();
    p.copies.dispose();
    p.pops.dispose();
    p.cone.dispose();
    p.flash.dispose();
    p.frames.dispose();
    p.captive.dispose();
    p.lasso.dispose();
    p.poster.dispose();
    p.cutout.dispose();
    this.parts = null;
  }
}
