/**
 * Uncle Gen at the polling station: his own cast body (cast-uncle-gen.glb, the ally the errands
 * load), standing by the ballot box with his hands behind his back, turning to talk when the
 * hero brings his ballot, and waving once it's counted. Until his files arrive he isn't drawn.
 * Two draws (fill and hull).
 */
import { Group, Vector3, type PerspectiveCamera } from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { raycastSolids, surfaceBelow, type CitySolids } from "../../camera/raycast";
import type { SharedUniforms } from "../../city/materials";
import { AllyAnimator } from "../../characters/anim/allies";
import type { AnimContext } from "../../characters/anim/types";
import { castModelUrl, loadCastAsset, type CastAsset } from "../../characters/cast-asset";
import { CastModel } from "../../characters/cast-model";
import { CAST_ANIMS } from "../../characters/files";
import { HERO_ANIMS, loadHeroClips, type HeroClips } from "../../characters/hero-asset";
import type { QualityTier } from "../../quality";

/** His full body within this distance of the camera. */
const NEAR = 950;

export type GenState = "idle" | "talk" | "wave";

export class GenFigure {
  readonly root = new Group();
  private model: CastModel | null = null;
  private anim: AllyAnimator | null = null;
  private asset: CastAsset | null = null;
  private clips: HeroClips | null = null;
  private asked: string | null = null;
  private tier: QualityTier = "medium";
  private disposed = false;
  private readonly heroPos = new Vector3();
  private readonly ctx: AnimContext;
  /** Where he stands (his feet), once placed. */
  readonly at = new Vector3();

  constructor(
    private readonly shared: SharedUniforms,
    private readonly solids: CitySolids,
  ) {
    this.root.name = "vote-gen";
    this.ctx = {
      ground: (x, z, y) => surfaceBelow(solids, x, z, y),
      ray: (o, d, max) => raycastSolids(solids, o, d, max),
      reducedMotion: false,
      secondary: true,
      hero: this.heroPos,
    };
  }

  set reducedMotion(on: boolean) {
    this.ctx.reducedMotion = on;
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.asked) {
      this.drop();
      this.ask();
    }
  }

  /** Fetch his body and the cast's clips (once). */
  ask(): void {
    const url = castModelUrl("uncle-gen", this.tier === "low");
    if (this.asked === url) return;
    this.asked = url;
    Promise.all([loadCastAsset(url), loadHeroClips(HERO_ANIMS), loadHeroClips(CAST_ANIMS)]).then(
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
        // No file: no Gen drawn (the HUD still tracks his ballot).
      },
    );
  }

  private make(): void {
    if (!this.asset || !this.clips) return;
    const model = new CastModel(this.asset, this.shared, this.tier === "low" ? ["lo"] : ["hi", "lo"]);
    const anim = new AllyAnimator(model.rig, model.group, "behind");
    anim.setClips(this.clips, model.k);
    this.model = model;
    this.anim = anim;
    model.visible = false;
    this.root.add(model.group);
  }

  private drop(): void {
    if (!this.model) return;
    this.root.remove(this.model.group);
    this.model.dispose();
    this.model = null;
    this.anim = null;
  }

  /** Stand him at `pos` (deck level) doing `state`; he faces the hero. */
  update(pos: Vec3 | null, state: GenState, hero: Vec3, camera: PerspectiveCamera, dt: number): void {
    const model = this.model;
    if (!pos) {
      if (model) model.visible = false;
      return;
    }
    this.ask();
    if (!model || !this.anim) return;
    model.visible = true;
    const floor = surfaceBelow(this.solids, pos.x, pos.z, pos.y + 6);
    this.at.set(pos.x, floor, pos.z);
    this.heroPos.set(hero.x, hero.y, hero.z);
    this.anim.update({ pos: this.at, state }, dt, this.ctx);
    model.fill.uniforms.uFogMix.value = 0;
    model.setLod(camera.position.distanceTo(this.at) > NEAR ? "lo" : "hi");
  }

  hide(): void {
    if (this.model) this.model.visible = false;
  }

  dispose(): void {
    this.disposed = true;
    this.drop();
  }
}
