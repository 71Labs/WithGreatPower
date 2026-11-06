/**
 * The hero's drawable body from the MPFB model (hero-asset.ts): the rig built on its own
 * skeleton (hero-rig.ts), one skinned geometry shared by the cel-shaded fill and the ink
 * hull, and the suit's colours as uniforms. It stands in for `CharacterModel` (the same
 * `BodyModel` surface), so the scene and the hero's animator treat it like any cast member.
 * One file is one level of detail: the low tier loads the lighter file instead.
 */
import { FrontSide, Group, Matrix4, ShaderMaterial, SkinnedMesh, Vector3, type BufferGeometry } from "three";

import type { SharedUniforms } from "../city/materials";
import { C, rgb } from "../palette";
import { heroGeometry, heroScale, type HeroAsset } from "./hero-asset";
import { rigFromAsset } from "./hero-rig";
import { HERO_FRAGMENT, HERO_VERTEX } from "./hero-shaders";
import { hullMaterial, KEY_LIGHT, SHADE_DARK, SHADE_MID } from "./materials";
import type { BodyModel } from "./model";
import type { Rig } from "./rig";

/** The web line's half width on the body, metres (the header renders' 3.6 mm). */
const WEB_HALF = 0.0036;
/** How far the baked AO pushes a crease down the bands. */
const AO_STRENGTH = 1.25;
/** The hull sits this far behind the body along the view (metres): a real body's creases
 *  (under the pecs, beside the nose) are concave enough that a hull right on it shows. */
const HULL_BACK = 0.018;

const v3 = (hex: string) => new Vector3(...rgb(hex));

/**
 * How much of a pale suit's cues a suit takes (hero-shaders.ts uTrim): 0 for every suit with
 * colour in it, 1 for a near-white one (Snow), by its lightness (Rec. 709 weights on sRGB).
 */
export function suitTrim(suit: string): number {
  const [r, g, b] = rgb(suit);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const t = Math.min(1, Math.max(0, (l - 0.78) / (0.9 - 0.78)));
  return t * t * (3 - 2 * t);
}

/** A pale suit's web lines: the web's own colour, deeper, so they hold against the white. */
export function webLine(web: string): Vector3 {
  return v3(web).multiplyScalar(0.58);
}

export function heroMaterial(shared: SharedUniforms, colors: Record<string, string>, k: number): ShaderMaterial {
  return new ShaderMaterial({
    name: "wgp-hero",
    vertexShader: HERO_VERTEX,
    fragmentShader: HERO_FRAGMENT,
    side: FrontSide,
    uniforms: {
      uTime: shared.uTime,
      uDpr: shared.uDpr,
      uHalftone: shared.uHalftone,
      uHalftoneCell: shared.uHalftoneCell,
      uFog: shared.uFog,
      uLight: { value: KEY_LIGHT.clone() },
      uShadeMid: { value: new Vector3(...SHADE_MID) },
      uShadeDark: { value: new Vector3(...SHADE_DARK) },
      uSuit: { value: v3(colors.suit) },
      uWeb: { value: v3(colors.web) },
      uLens: { value: v3(colors.lens) },
      uInk: { value: new Vector3(...C.ink) },
      uWebHalf: { value: WEB_HALF * k },
      uAo: { value: AO_STRENGTH },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uTrim: { value: suitTrim(colors.suit) },
      uWebLine: { value: webLine(colors.web) },
      uFogMix: { value: 0 },
      // Unused by the hero, kept so the scene and the hull treat every body alike.
      uWebbed: { value: 0 },
      uGlitch: { value: 0 },
    },
  });
}

export class HeroModel implements BodyModel {
  readonly group = new Group();
  readonly rig: Rig;
  readonly fill: ShaderMaterial;
  readonly ink: ShaderMaterial;
  readonly body: SkinnedMesh;
  readonly hull: SkinnedMesh;
  readonly triangles: number;
  private readonly geometry: BufferGeometry;

  constructor(
    readonly asset: HeroAsset,
    shared: SharedUniforms,
    colors: Record<string, string>,
    height: number,
  ) {
    const k = heroScale(asset, height);
    this.group.name = "cast-hero";
    this.rig = rigFromAsset(asset, height);
    this.geometry = heroGeometry(asset, k);
    this.triangles = this.geometry.getIndex()!.count / 3;
    this.fill = heroMaterial(shared, colors, k);
    this.ink = hullMaterial(shared, this.fill);
    this.ink.uniforms.uHullBack.value = HULL_BACK * k;
    this.body = new SkinnedMesh(this.geometry, this.fill);
    this.hull = new SkinnedMesh(this.geometry, this.ink);
    this.body.name = "hero-fill";
    this.hull.name = "hero-ink";
    this.group.add(this.rig.bones[0], this.body, this.hull);
    const identity = new Matrix4();
    this.body.bind(this.rig.skeleton, identity);
    this.hull.bind(this.rig.skeleton, identity);
    for (const m of [this.body, this.hull]) {
      m.boundingSphere = this.geometry.boundingSphere!.clone();
      m.renderOrder = 1;
    }
  }

  /** One level of detail per file: nothing to switch. */
  hasLod(): boolean {
    return false;
  }

  setLod(): void {}

  /** Recolour (a new suit): `suit`, `web` and `lens`, as CAST_DEFS.hero.colors gives them. */
  setColors(colors: Record<string, string>): void {
    const u = this.fill.uniforms;
    if (colors.suit) {
      u.uSuit.value = v3(colors.suit);
      u.uTrim.value = suitTrim(colors.suit);
    }
    if (colors.web) {
      u.uWeb.value = v3(colors.web);
      u.uWebLine.value = webLine(colors.web);
    }
    if (colors.lens) u.uLens.value = v3(colors.lens);
  }

  set visible(on: boolean) {
    this.group.visible = on;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  dispose(): void {
    this.geometry.dispose();
    this.fill.dispose();
    this.ink.dispose();
    this.rig.skeleton.dispose();
  }
}
