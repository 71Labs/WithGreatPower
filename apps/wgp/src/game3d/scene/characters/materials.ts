/**
 * The cast's two materials: the cel-shaded fill and the ink hull, both skinned. Each
 * character owns one of each (its palette and face decals are uniforms), and references the
 * scene's shared uniforms (px scale, hull widths, time, pixel ratio) so the frame loop
 * updates them once for the city and the cast together.
 */
import { BackSide, DataTexture, FrontSide, Matrix4, ShaderMaterial, Vector3, Vector4, type IUniform } from "three";

import type { SharedUniforms } from "../city/materials";
import { C, rgb, type RGB } from "../palette";
import { BODY_FRAGMENT, BODY_VERTEX, HULL_FRAGMENT, HULL_VERTEX, MAX_DECALS, PALETTE_SIZE } from "./shaders";

/** The key light: from +x (the city's brightest walls) and above, a little toward +z. */
export const KEY_LIGHT = new Vector3(0.62, 0.74, 0.26).normalize();
/** Band tints: mid and dark, a touch cool like the night city's shadows. */
export const SHADE_MID: RGB = [0.86, 0.87, 0.94];
export const SHADE_DARK: RGB = [0.68, 0.7, 0.84];

export type DecalShape = "ellipse" | "ring" | "lower" | "stroke" | "upper";
const SHAPES: Record<DecalShape, number> = { ellipse: 0, ring: 1, lower: 2, stroke: 3, upper: 4 };

/** A flat sticker shape painted on the face, in face units (the head's own scale). */
export interface Decal {
  shape: DecalShape;
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot?: number;
  /** Palette index, or −1 for no fill. */
  fill: number;
  /** Ink rim width in CSS px (0 for none). */
  ink?: number;
  /** Only draw inside the previous unclipped decal (pupils in eyes, teeth in a mouth). */
  clip?: boolean;
  /** Also draw the mirror image at −x. */
  mirror?: boolean;
}

/**
 * Expand mirrored decals. A decal and the clipped ones after it form a group; each group is
 * followed by its mirror image, so a mirrored pupil still clips to its mirrored eye and
 * mirrored teeth still clip to the one mouth.
 */
export function expandDecals(list: Decal[]): Decal[] {
  const out: Decal[] = [];
  let group: Decal[] = [];
  const flush = () => {
    out.push(...group);
    for (const d of group) if (d.mirror) out.push({ ...d, x: -d.x, rot: -(d.rot ?? 0), mirror: false });
    group = [];
  };
  for (const d of list) {
    if (!d.clip) flush();
    group.push(d);
  }
  flush();
  return out.slice(0, MAX_DECALS);
}

const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);

export interface BodyUniforms {
  uPal: IUniform<Vector3[]>;
  uDecA: IUniform<Vector4[]>;
  uDecB: IUniform<Vector4[]>;
  uDecN: IUniform<number>;
  uFlash: IUniform<number>;
  uFade: IUniform<number>;
  uWebbed: IUniform<number>;
  uGlitch: IUniform<number>;
  uFogMix: IUniform<number>;
  uWebSpacing: IUniform<number>;
}

/** Instanced skinning: the skeleton's bone texture and bind matrices, supplied by hand. */
export interface SharedSkin {
  boneTexture: DataTexture;
}

export function paletteUniform(hexes: string[]): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) out.push(v3(rgb(hexes[i] ?? "#FF00FF")));
  return out;
}

export function decalUniforms(decals: Decal[], scale: number): { a: Vector4[]; b: Vector4[]; n: number } {
  const list = expandDecals(decals);
  const a: Vector4[] = [];
  const b: Vector4[] = [];
  for (let i = 0; i < MAX_DECALS; i++) {
    const d = list[i];
    if (!d) {
      a.push(new Vector4());
      b.push(new Vector4(0, -1, 0, 0));
      continue;
    }
    a.push(new Vector4(d.x * scale, d.y * scale, d.rx * scale, d.ry * scale));
    b.push(new Vector4(d.rot ?? 0, d.fill, d.ink ?? 0, SHAPES[d.shape] + (d.clip ? 8 : 0)));
  }
  return { a, b, n: list.length };
}

export function bodyMaterial(shared: SharedUniforms, palette: Vector3[], decals: { a: Vector4[]; b: Vector4[]; n: number }, webSpacing: number, skin?: SharedSkin): ShaderMaterial {
  const own: BodyUniforms = {
    uPal: { value: palette },
    uDecA: { value: decals.a },
    uDecB: { value: decals.b },
    uDecN: { value: decals.n },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    uWebbed: { value: 0 },
    uGlitch: { value: 0 },
    uFogMix: { value: 0 },
    uWebSpacing: { value: webSpacing },
  };
  return new ShaderMaterial({
    name: "wgp-cast",
    vertexShader: BODY_VERTEX,
    fragmentShader: BODY_FRAGMENT,
    side: FrontSide,
    defines: skin ? { USE_SKINNING: "" } : {},
    uniforms: {
      uTime: shared.uTime,
      uDpr: shared.uDpr,
      uHalftone: shared.uHalftone,
      uHalftoneCell: shared.uHalftoneCell,
      uFog: shared.uFog,
      uLight: { value: KEY_LIGHT.clone() },
      uShadeMid: { value: v3(SHADE_MID) },
      uShadeDark: { value: v3(SHADE_DARK) },
      ...own,
      ...(skin ? skinUniforms(skin) : {}),
    },
  });
}

export function hullMaterial(shared: SharedUniforms, body: ShaderMaterial, skin?: SharedSkin, opts: { jpeg?: boolean } = {}): ShaderMaterial {
  const u = body.uniforms;
  const defines: Record<string, string> = {};
  if (skin) defines.USE_SKINNING = "";
  // The body's JPEG snap (Case file 001's captive Mary): the hull snaps with it.
  const jpeg = !!opts.jpeg && !!u.uJpegSnap;
  if (jpeg) defines.USE_JPEG = "";
  return new ShaderMaterial({
    name: "wgp-cast-hull",
    vertexShader: HULL_VERTEX,
    fragmentShader: HULL_FRAGMENT,
    side: BackSide,
    defines,
    uniforms: {
      uTime: shared.uTime,
      uPxScale: shared.uPxScale,
      uHullPx: shared.uHullPx,
      uInk: { value: v3(C.ink) },
      uFog: shared.uFog,
      uHullScale: { value: 1 },
      uHullBack: { value: 0 },
      // Shared with the fill, so a fade or a glitch moves both.
      uFade: u.uFade,
      uFogMix: u.uFogMix,
      uGlitch: u.uGlitch,
      ...(jpeg ? { uJpegSnap: u.uJpegSnap } : {}),
      ...(skin ? skinUniforms(skin) : {}),
    },
  });
}

function skinUniforms(skin: SharedSkin) {
  return {
    boneTexture: { value: skin.boneTexture },
    bindMatrix: { value: new Matrix4() },
    bindMatrixInverse: { value: new Matrix4() },
  };
}
