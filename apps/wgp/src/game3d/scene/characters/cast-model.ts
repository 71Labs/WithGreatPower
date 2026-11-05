/**
 * A cast member's drawable MPFB body (cast-asset.ts): the hero's rig builder on its own
 * skeleton (hero-rig.ts), its levels of detail in game units, and the cast shader's fill and
 * ink hull sharing them. It's a `BodyModel` like the procedural cast's `CharacterModel`, so the
 * scene and the animators treat both alike.
 *
 * `CastCopies` draws The Sybil's copies: one instanced fill and hull for all of them, skinned
 * through a bone texture that packs a few poses (each copy reads one), so the crowd doesn't
 * move in lockstep.
 */
import { BackSide, DataTexture, DynamicDrawUsage, FloatType, FrontSide, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, RGBAFormat, ShaderMaterial, SkinnedMesh, Vector3, Vector4, type BufferGeometry } from "three";

import type { SharedUniforms } from "../city/materials";
import { C, rgb } from "../palette";
import { castGeometry, rigSource, UNITS_PER_METRE, type CastAsset, type CastDecal, type CastMeta } from "./cast-asset";
import { CAST_FRAGMENT, CAST_HULL_VERTEX, CAST_MAX_DECALS, CAST_PALETTE, CAST_VERTEX } from "./cast-shaders";
import type { Lod } from "./cast/kit";
import { rigFromAsset } from "./hero-rig";
import { hullMaterial, KEY_LIGHT, SHADE_DARK, SHADE_MID } from "./materials";
import type { BodyModel } from "./model";
import type { Rig } from "./rig";
import { HULL_FRAGMENT } from "./shaders";

const SHAPES: Record<CastDecal["shape"], number> = { ellipse: 0, ring: 1, lower: 2, stroke: 3, upper: 4, arc: 5, jag: 6, teeth: 7 };
/** How far the baked AO pushes a crease down the bands. */
const AO_STRENGTH = 0.6;
/** The hull sits this far behind the body along the view (metres), as on the hero. */
const HULL_BACK = 0.014;
/** Gwei's web line, half width (metres). */
const WEB_HALF = 0.0032;

const v3 = (hex: string) => new Vector3(...rgb(hex));

/** Mirrored decals expanded (a decal and the clipped ones after it mirror as a group). */
export function expandCastDecals(list: CastDecal[]): CastDecal[] {
  const out: CastDecal[] = [];
  let group: CastDecal[] = [];
  const flush = () => {
    out.push(...group);
    for (const d of group) if (d.mirror) out.push({ ...d, x: -d.x, rot: -d.rot, mirror: false });
    group = [];
  };
  for (const d of list) {
    if (!d.clip) flush();
    group.push(d);
  }
  flush();
  return out.slice(0, CAST_MAX_DECALS);
}

export function castUniforms(meta: CastMeta, colors?: string[]) {
  const pal: Vector3[] = [];
  const flags: number[] = [];
  const hex = colors ?? meta.palette;
  for (let i = 0; i < CAST_PALETTE; i++) {
    pal.push(v3(hex[i] ?? "#FF00FF"));
    flags.push((meta.flat.includes(i) ? 1 : 0) + (meta.gloss.includes(i) ? 2 : 0));
  }
  const list = expandCastDecals(meta.decals);
  const a: Vector4[] = [];
  const b: Vector4[] = [];
  const c: Vector4[] = [];
  for (let i = 0; i < CAST_MAX_DECALS; i++) {
    const d = list[i];
    if (!d) {
      a.push(new Vector4(0, 0, 1, 1));
      b.push(new Vector4(0, -1, 0, 0));
      c.push(new Vector4());
      continue;
    }
    a.push(new Vector4(d.x, d.y, d.rx, d.ry));
    b.push(new Vector4(d.rot, d.fill, d.ink, SHAPES[d.shape] + (d.clip ? 16 : 0)));
    c.push(new Vector4(d.n, d.amp, 0, 0));
  }
  return { pal, flags, a, b, c, n: list.length };
}

export function castMaterial(shared: SharedUniforms, meta: CastMeta, k: number, opts: { colors?: string[]; poses?: { texture: DataTexture; bones: number }; jpeg?: boolean } = {}): ShaderMaterial {
  const u = castUniforms(meta, opts.colors);
  const defines: Record<string, string> = {};
  if (meta.web) defines.USE_WEB = "";
  // Case file 001's captive Mary: the compressed-screenshot look (cast-shaders.ts JPEG_*).
  if (opts.jpeg) defines.USE_JPEG = "";
  if (opts.poses) {
    defines.USE_SKINNING = "";
    defines.USE_POSES = "";
  }
  return new ShaderMaterial({
    name: `wgp-cast-${meta.who}`,
    vertexShader: CAST_VERTEX,
    fragmentShader: CAST_FRAGMENT,
    side: FrontSide,
    defines,
    uniforms: {
      uTime: shared.uTime,
      uDpr: shared.uDpr,
      uHalftone: shared.uHalftone,
      uHalftoneCell: shared.uHalftoneCell,
      uFog: shared.uFog,
      uLight: { value: KEY_LIGHT.clone() },
      uShadeMid: { value: new Vector3(...SHADE_MID) },
      uShadeDark: { value: new Vector3(...SHADE_DARK) },
      uPal: { value: u.pal },
      uPalFlags: { value: u.flags },
      uDecA: { value: u.a },
      uDecB: { value: u.b },
      uDecC: { value: u.c },
      uDecN: { value: u.n },
      uAo: { value: AO_STRENGTH },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uFogMix: { value: 0 },
      uWebbed: { value: 0 },
      uGlitch: { value: 0 },
      uWebColor: { value: v3(meta.palette[meta.names.indexOf("web")] ?? "#B6A2EC") },
      uWebHalf: { value: WEB_HALF * k },
      ...(opts.jpeg ? { uJpeg: { value: 0 }, uJpegLevels: { value: 32 }, uJpegGrid: { value: new Vector3(0, 0, 1) }, uJpegSnap: { value: 0 } } : {}),
      ...(opts.poses
        ? { boneTexture: { value: opts.poses.texture }, bindMatrix: { value: new Matrix4() }, bindMatrixInverse: { value: new Matrix4() }, uBones: { value: opts.poses.bones } }
        : {}),
    },
  });
}

export class CastModel implements BodyModel {
  readonly group = new Group();
  readonly rig: Rig;
  readonly fill: ShaderMaterial;
  readonly ink: ShaderMaterial;
  readonly body: SkinnedMesh;
  readonly hull: SkinnedMesh;
  /** Metres to game units. */
  readonly k = UNITS_PER_METRE;
  private readonly geos = new Map<Lod, BufferGeometry>();
  lod: Lod;

  /** `jpeg`: Case file 001's compressed-screenshot look (captive Mary). */
  constructor(
    readonly asset: CastAsset,
    shared: SharedUniforms,
    lods: Lod[],
    opts: { jpeg?: boolean } = {},
  ) {
    const k = this.k;
    this.group.name = `cast-${asset.meta.who}`;
    this.rig = rigFromAsset(rigSource(asset), asset.height * k);
    // "hi" is the full body; "lo" and "min" both take the light one.
    if (asset.hi && lods.includes("hi")) this.geos.set("hi", castGeometry(asset, asset.hi, k));
    const light = castGeometry(asset, asset.lo, k);
    this.geos.set("lo", light);
    this.geos.set("min", light);
    this.lod = this.geos.has("hi") ? "hi" : "lo";
    const first = this.geos.get(this.lod)!;
    this.fill = castMaterial(shared, asset.meta, k, { jpeg: opts.jpeg });
    this.ink = hullMaterial(shared, this.fill, undefined, { jpeg: opts.jpeg });
    this.ink.uniforms.uHullBack.value = HULL_BACK * k;
    this.body = new SkinnedMesh(first, this.fill);
    this.hull = new SkinnedMesh(first, this.ink);
    this.body.name = `${asset.meta.who}-fill`;
    this.hull.name = `${asset.meta.who}-ink`;
    this.group.add(this.rig.bones[0], this.body, this.hull);
    const identity = new Matrix4();
    this.body.bind(this.rig.skeleton, identity);
    this.hull.bind(this.rig.skeleton, identity);
    for (const m of [this.body, this.hull]) {
      m.boundingSphere = first.boundingSphere!.clone();
      m.renderOrder = 1;
    }
  }

  get triangles(): number {
    return (this.geos.get(this.lod)?.getIndex()?.count ?? 0) / 3;
  }

  hasLod(l: Lod): boolean {
    return l === "hi" ? this.geos.has("hi") : true;
  }

  setLod(l: Lod): void {
    const want: Lod = l === "hi" && this.geos.has("hi") ? "hi" : "lo";
    if (want === this.lod) return;
    this.lod = want;
    const g = this.geos.get(want)!;
    this.body.geometry = g;
    this.hull.geometry = g;
  }

  /** The cast's colours come from the file. */
  setColors(): void {}

  /** A point in the rest pose (metres, glTF axes) as a bind-space point in game units. */
  restPoint(at: [number, number, number], out: Vector3): Vector3 {
    return out.set(at[0], at[1], at[2]).multiplyScalar(this.k);
  }

  set visible(on: boolean) {
    this.group.visible = on;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  dispose(): void {
    const seen = new Set<BufferGeometry>();
    for (const g of this.geos.values()) {
      if (seen.has(g)) continue;
      seen.add(g);
      g.dispose();
    }
    this.fill.dispose();
    this.ink.dispose();
    this.rig.skeleton.dispose();
  }
}

/**
 * Many copies of one MPFB body as one instanced pair of draws. `poses` rigs are posed by the
 * caller (each at the origin, facing +z); `commitPose` packs their skinning matrices into one
 * bone texture, and each instance reads the pose `setInstance` gave it.
 */
export class CastCopies {
  readonly group = new Group();
  readonly rigs: Rig[] = [];
  readonly holders: Group[] = [];
  readonly fill: ShaderMaterial;
  readonly ink: ShaderMaterial;
  readonly body: InstancedMesh;
  readonly hull: InstancedMesh;
  private readonly texture: DataTexture;
  private readonly data: Float32Array;
  private readonly pose: InstancedBufferAttribute;
  private readonly geometry: BufferGeometry;
  private readonly bones: number;

  constructor(asset: CastAsset, shared: SharedUniforms, colors: string[], max: number, poses: number) {
    const k = UNITS_PER_METRE;
    for (let i = 0; i < poses; i++) {
      const rig = rigFromAsset(rigSource(asset), asset.height * k);
      const holder = new Group();
      holder.add(rig.bones[0]);
      holder.updateMatrixWorld(true);
      this.rigs.push(rig);
      this.holders.push(holder);
    }
    this.bones = asset.bones.length;
    // Four texels per matrix, a square power-of-two texture holding every pose.
    let size = 4;
    while (size * size < this.bones * poses * 4) size *= 2;
    this.data = new Float32Array(size * size * 4);
    this.texture = new DataTexture(this.data, size, size, RGBAFormat, FloatType);
    this.texture.needsUpdate = true;
    this.geometry = castGeometry(asset, asset.min ?? asset.lo, k);
    this.pose = new InstancedBufferAttribute(new Float32Array(max), 1);
    this.pose.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute("aPose", this.pose);
    const skin = { texture: this.texture, bones: this.bones };
    this.fill = castMaterial(shared, asset.meta, k, { colors, poses: skin });
    const u = this.fill.uniforms;
    this.ink = new ShaderMaterial({
      name: "wgp-cast-copies-hull",
      vertexShader: CAST_HULL_VERTEX,
      fragmentShader: HULL_FRAGMENT,
      side: BackSide,
      defines: { USE_SKINNING: "", USE_POSES: "" },
      uniforms: {
        uTime: shared.uTime,
        uPxScale: shared.uPxScale,
        uHullPx: shared.uHullPx,
        uInk: { value: new Vector3(...C.ink) },
        uFog: shared.uFog,
        uHullScale: { value: 1 },
        uHullBack: { value: HULL_BACK * k },
        uFade: u.uFade,
        uFogMix: u.uFogMix,
        uGlitch: u.uGlitch,
        boneTexture: { value: this.texture },
        bindMatrix: { value: new Matrix4() },
        bindMatrixInverse: { value: new Matrix4() },
        uBones: { value: this.bones },
      },
    });
    this.body = new InstancedMesh(this.geometry, this.fill, max);
    this.hull = new InstancedMesh(this.geometry, this.ink, max);
    for (const m of [this.body, this.hull]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 1;
    }
    this.body.name = `${asset.meta.who}-copies-fill`;
    this.hull.name = `${asset.meta.who}-copies-ink`;
    this.group.add(this.body, this.hull);
  }

  /** Pack every pose rig's skinning matrices (call after posing them). */
  commitPose(): void {
    const n = this.bones;
    this.rigs.forEach((rig, p) => {
      this.holders[p].updateMatrixWorld(true);
      const sk = rig.skeleton;
      sk.update();
      this.data.set(sk.boneMatrices!.subarray(0, n * 16), p * n * 16);
    });
    this.texture.needsUpdate = true;
  }

  setCount(n: number): void {
    this.body.count = n;
    this.hull.count = n;
    this.group.visible = n > 0;
  }

  setInstance(i: number, m: Matrix4, pose: number): void {
    this.body.setMatrixAt(i, m);
    this.hull.setMatrixAt(i, m);
    this.pose.setX(i, pose % this.rigs.length);
  }

  commitInstances(): void {
    this.body.instanceMatrix.needsUpdate = true;
    this.hull.instanceMatrix.needsUpdate = true;
    this.pose.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.fill.dispose();
    this.ink.dispose();
    this.body.dispose();
    this.hull.dispose();
    this.texture.dispose();
    for (const r of this.rigs) r.skeleton.dispose();
  }
}
