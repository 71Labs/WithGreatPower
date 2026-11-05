/**
 * Captive Mary on the bridge deck: her own cast body (cast-mary-jpeg.glb) saved as a compressed
 * screenshot, frozen mid-pose. The JPEG look (cast-shaders.ts, USE_JPEG) follows 1 − restore:
 * her vertices snap to a blocky grid, her face's features and her shading go chunky, and her
 * colours drop to a few levels in visible 8×8 blocks of an "image" anchored on her (math.ts
 * `jpegLook`). When she's freed the compression is gone and she waves (the ally animator's
 * wave, on the cast's clips); the scene pops a pixel burst off her.
 *
 * Her files are the same the ally's errand loads (fetched once, cached); until they're in she
 * isn't drawn. Two draws (fill and hull).
 */
import { Group, Vector3, type PerspectiveCamera } from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { raycastSolids, surfaceBelow, type CitySolids } from "../camera/raycast";
import type { SharedUniforms } from "../city/materials";
import { AllyAnimator } from "../characters/anim/allies";
import type { AnimContext } from "../characters/anim/types";
import { castModelUrl, loadCastAsset, type CastAsset } from "../characters/cast-asset";
import { CastModel } from "../characters/cast-model";
import { CAST_ANIMS } from "../characters/files";
import { HERO_ANIMS, loadHeroClips, type HeroClips } from "../characters/hero-asset";
import type { QualityTier } from "../quality";
import type { ChapterCaptive } from "./contract";
import { jpegLook } from "./math";

/** Her height for the "image" (units; the file's own is about 1.8 m). */
const MARY_TALL = 86;
/** Seconds her pose runs before it freezes (she settles into her idle, then the shot holds it). */
const SETTLE = 1.2;
/** Her full body within this distance of the camera (the cast's high-tier range). */
const NEAR = 950;

const _a = new Vector3();
const _b = new Vector3();

export class Captive {
  readonly root = new Group();
  private model: CastModel | null = null;
  private anim: AllyAnimator | null = null;
  private asset: CastAsset | null = null;
  private clips: HeroClips | null = null;
  private asked: string | null = null;
  private settled = 0;
  /** Stood somewhere yet (her first frame places her). */
  private placed = false;
  private freed = false;
  private readonly heroPos = new Vector3();
  private readonly ctx: AnimContext;
  private tier: QualityTier = "medium";
  private disposed = false;
  /** Where she stands (her feet), once placed. */
  readonly at = new Vector3();
  reducedMotion = false;

  constructor(
    private readonly shared: SharedUniforms,
    private readonly solids: CitySolids,
  ) {
    this.root.name = "chapter-captive";
    this.ctx = {
      ground: (x, z, y) => surfaceBelow(solids, x, z, y),
      ray: (o, d, max) => raycastSolids(solids, o, d, max),
      reducedMotion: false,
      secondary: true,
      hero: this.heroPos,
    };
  }

  get ready(): boolean {
    return this.model !== null;
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.asked) {
      this.drop();
      this.ask();
    }
  }

  /** Fetch her body and the cast's clips (once). */
  ask(): void {
    const url = castModelUrl("mary-jpeg", this.tier === "low");
    if (this.asked === url) return;
    this.asked = url;
    Promise.all([loadCastAsset(url, true), loadHeroClips(HERO_ANIMS), loadHeroClips(CAST_ANIMS)]).then(
      ([asset, hero, cast]) => {
        if (this.disposed || this.asked !== url) return;
        const merged: HeroClips = new Map([...hero, ...cast]);
        merged.pelvisRest = hero.pelvisRest;
        merged.restQ = hero.restQ;
        this.asset = asset;
        this.clips = merged;
        this.make();
      },
      () => {
        // No file: no captive drawn (the HUD still tracks her restore).
      },
    );
  }

  private make(): void {
    if (!this.asset || !this.clips) return;
    const model = new CastModel(this.asset, this.shared, this.tier === "low" ? ["lo"] : ["hi", "lo"], { jpeg: true });
    const anim = new AllyAnimator(model.rig, model.group, "hips");
    anim.setClips(this.clips, model.k);
    this.model = model;
    this.anim = anim;
    this.settled = 0;
    model.visible = false;
    this.root.add(model.group);
  }

  /** A fresh animator: her pose settles again from standing. */
  private restand(): void {
    if (!this.model || !this.clips) return;
    const anim = new AllyAnimator(this.model.rig, this.model.group, "hips");
    anim.setClips(this.clips, this.model.k);
    this.anim = anim;
    this.settled = 0;
  }

  private drop(): void {
    if (!this.model) return;
    this.root.remove(this.model.group);
    this.model.dispose();
    this.model = null;
    this.anim = null;
  }

  /**
   * Stand her at the captive's place with her compression from `restore`; `hero` is where the
   * hero is (she faces him once she's free). Returns her centre for the frame, or null.
   */
  update(c: ChapterCaptive | null, hero: Vec3, camera: PerspectiveCamera, size: { width: number; height: number }, dt: number): Vector3 | null {
    const model = this.model;
    const anim = this.anim;
    if (!c) {
      if (model) model.visible = false;
      return null;
    }
    this.ask();
    if (!model || !anim) return null;
    model.visible = true;
    const floor = surfaceBelow(this.solids, c.pos.x, c.pos.z, c.pos.y + 6);
    // Put somewhere else (a new night, the lab's scenes): stood up afresh there, not stepped over.
    if (this.placed && Math.hypot(c.pos.x - this.at.x, floor - this.at.y, c.pos.z - this.at.z) > 2) this.restand();
    this.placed = true;
    this.at.set(c.pos.x, floor, c.pos.z);
    this.heroPos.set(hero.x, hero.y, hero.z);
    this.ctx.reducedMotion = this.reducedMotion;
    if (c.freed && !this.freed) this.freed = true;
    if (!c.freed && this.freed) {
      // A new night or the lab's rewind: saved again.
      this.freed = false;
      this.settled = 0;
    }
    // Saved, she holds still (a screenshot); freed, she moves and waves.
    // (Held still by stepping no time: the pose is recomposed where it stopped.)
    const pose = this.anim ?? anim;
    if (this.freed) pose.update({ pos: this.at, state: "wave" }, dt, this.ctx);
    else {
      const step = this.settled < SETTLE ? Math.max(dt, 1 / 60) : 0;
      pose.update({ pos: this.at, state: "idle" }, step, this.ctx);
      this.settled += step;
    }
    // The JPEG look, its "image" anchored on her on screen.
    const look = jpegLook(c.freed ? 1 : c.restore);
    const u = model.fill.uniforms;
    u.uJpeg.value = look.strength;
    u.uJpegLevels.value = look.levels;
    u.uJpegSnap.value = look.snap;
    const mid = _a.set(this.at.x, this.at.y + MARY_TALL * 0.5, this.at.z).project(camera);
    const top = _b.set(this.at.x, this.at.y + MARY_TALL, this.at.z).project(camera);
    const tall = Math.max(4, Math.abs(top.y - mid.y) * size.height);
    const grid = u.uJpegGrid.value as Vector3;
    grid.set((mid.x * 0.5 + 0.5) * size.width, (mid.y * 0.5 + 0.5) * size.height, tall / look.pixelsTall);
    model.fill.uniforms.uFogMix.value = 0;
    // Her full body up close (the rescue); the light one across the city (she's there all night).
    const far = camera.position.distanceTo(this.at) > NEAR;
    model.setLod(far ? "lo" : "hi");
    return _a.set(this.at.x, this.at.y + MARY_TALL * 0.5, this.at.z);
  }

  hide(): void {
    if (this.model) this.model.visible = false;
  }

  dispose(): void {
    this.disposed = true;
    this.drop();
  }
}
