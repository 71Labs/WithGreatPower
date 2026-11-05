/**
 * Aunt Mainnet on her own roof: her cast body (cast-aunt-mainnet.glb, the errand ally's files,
 * fetched once and cached) standing in a corner of the bakery roof by a tower, out of the fight's
 * way, hands clasped and watching the hero. She talks him on while he cools the meter and waves
 * once the fees are back down. Two draws (fill and hull) when she's on screen; nothing until her
 * files are in.
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

export type AuntMood = "idle" | "talk" | "wave";

/** Her full body within this distance of the camera. */
const NEAR = 900;
/** She isn't drawn beyond this. */
const FAR = 3000;

export class AuntOnRoof {
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
  private readonly at = new Vector3();
  reducedMotion = false;

  constructor(
    private readonly shared: SharedUniforms,
    private readonly solids: CitySolids,
  ) {
    this.root.name = "fee-aunt-mainnet";
    this.ctx = {
      ground: (x, z, y) => surfaceBelow(solids, x, z, y),
      ray: (o, d, max) => raycastSolids(solids, o, d, max),
      reducedMotion: false,
      secondary: true,
      hero: this.heroPos,
    };
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    if (this.asked) {
      this.drop();
      this.asked = null;
      this.ask();
    }
  }

  /** Fetch her body and the cast's clips (once). */
  ask(): void {
    const url = castModelUrl("aunt-mainnet", this.tier === "low");
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
        // No file: the bakery stands without her.
      },
    );
  }

  private make(): void {
    if (!this.asset || !this.clips) return;
    const model = new CastModel(this.asset, this.shared, this.tier === "low" ? ["lo"] : ["hi", "lo"]);
    const anim = new AllyAnimator(model.rig, model.group, "clasp");
    anim.setClips(this.clips, model.k);
    model.visible = false;
    this.model = model;
    this.anim = anim;
    this.root.add(model.group);
  }

  private drop(): void {
    if (!this.model) return;
    this.root.remove(this.model.group);
    this.model.dispose();
    this.model = null;
    this.anim = null;
  }

  /** Stand her at `spot` (feet level), watching `hero`, in `mood`. */
  update(spot: Vec3, hero: Vec3, mood: AuntMood, camera: PerspectiveCamera, dt: number): void {
    this.ask();
    const model = this.model;
    const anim = this.anim;
    if (!model || !anim) return;
    const d = camera.position.distanceTo(this.at.set(spot.x, spot.y, spot.z));
    if (d > FAR) {
      model.visible = false;
      return;
    }
    model.visible = true;
    this.at.y = surfaceBelow(this.solids, spot.x, spot.z, spot.y + 6);
    this.heroPos.set(hero.x, hero.y, hero.z);
    this.ctx.reducedMotion = this.reducedMotion;
    anim.update({ pos: this.at, state: mood }, dt, this.ctx);
    model.setLod(d > NEAR ? "lo" : "hi");
  }

  hide(): void {
    if (this.model) this.model.visible = false;
  }

  dispose(): void {
    this.disposed = true;
    this.drop();
  }
}
