/**
 * The crowd on the GPU: every civilian body in one geometry per level of detail, drawn as one
 * instanced fill and one instanced ink hull (the cast's two passes), whoever is on screen.
 *
 * - Skinning reads a bone texture of pose blocks, a row each: one per body and channel
 *   (crowd/clips.ts), written by plain forward kinematics (crowd/skeleton.ts). Only the rows
 *   that changed go up each frame (texture update ranges).
 * - Each instance says which body, which pose block, which look (a row of the looks
 *   texture), and its own dither fade and fog; its matrix places and turns it.
 * - Both levels of detail share the materials, so the second draw switches nothing but the
 *   buffers.
 *
 * Draw calls: two per level of detail with anyone in it (fill and hull); none when empty.
 */
import { BackSide, BufferAttribute, BufferGeometry, DataTexture, DynamicDrawUsage, FloatType, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, NearestFilter, RGBAFormat, ShaderMaterial, Vector3, type IUniform } from "three";

import type { SharedUniforms } from "../city/materials";
import { castGeometry, type CastAsset } from "../characters/cast-asset";
import { castMaterial } from "../characters/cast-model";
import { C } from "../palette";
import { CROWD_FRAGMENT, CROWD_HULL_FRAGMENT, CROWD_HULL_VERTEX, CROWD_VERTEX } from "./shaders";
import { BLOCK_FLOATS, CROWD_BONE_COUNT, type CrowdSkeleton } from "./skeleton";
import type { ClipSample } from "./clips";

/** The hull sits this far behind the body along the view (metres): the cast's (cast-model.ts). */
const HULL_BACK = 0.014;

/** The pose blocks: a row of the bone texture per body and channel. */
export class CrowdPoses {
  readonly texture: DataTexture;
  readonly data: Float32Array;
  private readonly dirty = new Set<number>();

  constructor(
    readonly bodies: number,
    readonly channels: number,
  ) {
    const w = CROWD_BONE_COUNT * 4;
    const rows = Math.max(1, bodies * channels);
    this.data = new Float32Array(w * rows * 4);
    this.texture = new DataTexture(this.data, w, rows, RGBAFormat, FloatType);
    this.texture.minFilter = this.texture.magFilter = NearestFilter;
    this.texture.needsUpdate = true;
  }

  block(body: number, channel: number): number {
    return body * this.channels + channel;
  }

  write(skeleton: CrowdSkeleton, sample: ClipSample | null, body: number, channel: number): void {
    const row = this.block(body, channel);
    skeleton.pose(sample, this.data, row * BLOCK_FLOATS);
    this.dirty.add(row);
  }

  /** Upload the rows written since the last commit. Returns how many. */
  commit(): number {
    const n = this.dirty.size;
    if (!n) return 0;
    const t = this.texture;
    for (const row of this.dirty) t.addUpdateRange(row * BLOCK_FLOATS, BLOCK_FLOATS);
    t.needsUpdate = true;
    this.dirty.clear();
    return n;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/**
 * The crowd's two materials, built from the cast's (the first body's palette flags and the
 * shared painted face), skinning through the pose blocks and dressing from the looks.
 */
export class CrowdMaterials {
  readonly fill: ShaderMaterial;
  readonly hull: ShaderMaterial;

  constructor(shared: SharedUniforms, first: CastAsset, k: number, poses: CrowdPoses, looks: DataTexture) {
    const skin = { texture: poses.texture, bones: CROWD_BONE_COUNT };
    this.fill = castMaterial(shared, first.meta, k, { poses: skin });
    this.fill.name = "wgp-crowd";
    this.fill.vertexShader = CROWD_VERTEX;
    this.fill.fragmentShader = CROWD_FRAGMENT;
    this.fill.uniforms.uLooks = { value: looks } as IUniform;
    const u = this.fill.uniforms;
    this.hull = new ShaderMaterial({
      name: "wgp-crowd-hull",
      vertexShader: CROWD_HULL_VERTEX,
      fragmentShader: CROWD_HULL_FRAGMENT,
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
        boneTexture: { value: poses.texture },
        bindMatrix: { value: new Matrix4() },
        bindMatrixInverse: { value: new Matrix4() },
        uBones: { value: CROWD_BONE_COUNT },
      },
    });
  }

  dispose(): void {
    this.fill.dispose();
    this.hull.dispose();
  }
}

/**
 * Every body's mesh at one level of detail in one geometry, in game units, each vertex
 * tagged with its body (`aVariant`) and skinned to the crowd's 23 bones.
 */
export function mergeBodies(parts: { asset: CastAsset; geometry: BufferGeometry; skeleton: CrowdSkeleton }[], k: number): BufferGeometry {
  const geos = parts.map((p) => castGeometry(p.asset, p.geometry, k));
  const total = geos.reduce((s, g) => s + g.getAttribute("position").count, 0);
  const indices = geos.reduce((s, g) => s + g.getIndex()!.count, 0);
  const out = new BufferGeometry();
  const take = (name: string, size: number) => {
    const a = new Float32Array(total * size);
    let at = 0;
    for (const g of geos) {
      const src = g.getAttribute(name);
      for (let i = 0; i < src.count; i++) for (let c = 0; c < size; c++) a[(at + i) * size + c] = src.getComponent(i, c);
      at += src.count;
    }
    out.setAttribute(name, new BufferAttribute(a, size));
  };
  take("position", 3);
  take("normal", 3);
  take("skinWeight", 4);
  take("aPal", 1);
  take("aFace", 3);
  take("aAO", 1);
  take("aHull", 4);
  const skin = new Uint16Array(total * 4);
  const variant = new Float32Array(total);
  const index = total > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let at = 0;
  let ia = 0;
  geos.forEach((g, v) => {
    const src = g.getAttribute("skinIndex");
    const remap = parts[v].skeleton.remap;
    for (let i = 0; i < src.count; i++) {
      for (let c = 0; c < 4; c++) skin[(at + i) * 4 + c] = remap[src.getComponent(i, c)] ?? 0;
      variant[at + i] = v;
    }
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) index[ia + i] = idx.getX(i) + at;
    ia += idx.count;
    at += src.count;
    g.dispose();
  });
  out.setAttribute("skinIndex", new BufferAttribute(skin, 4));
  out.setAttribute("aVariant", new BufferAttribute(variant, 1));
  out.setIndex(new BufferAttribute(index, 1));
  return out;
}

/** One level of detail's instanced fill and hull. */
export class CrowdBatch {
  readonly group = new Group();
  readonly fill: InstancedMesh;
  readonly hull: InstancedMesh;
  private readonly pose: InstancedBufferAttribute;
  private readonly crowd: InstancedBufferAttribute;
  count = 0;

  constructor(
    readonly geometry: BufferGeometry,
    materials: CrowdMaterials,
    readonly max: number,
    name: string,
  ) {
    this.pose = new InstancedBufferAttribute(new Float32Array(max), 1);
    this.crowd = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.pose.setUsage(DynamicDrawUsage);
    this.crowd.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aPose", this.pose);
    geometry.setAttribute("aCrowd", this.crowd);
    this.fill = new InstancedMesh(geometry, materials.fill, max);
    this.hull = new InstancedMesh(geometry, materials.hull, max);
    // One set of matrices for both passes.
    this.fill.instanceMatrix.setUsage(DynamicDrawUsage);
    this.hull.instanceMatrix = this.fill.instanceMatrix;
    for (const m of [this.fill, this.hull]) {
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 1;
      m.visible = false;
    }
    this.fill.name = `${name}-fill`;
    this.hull.name = `${name}-ink`;
    this.group.name = name;
    this.group.add(this.fill, this.hull);
  }

  /** Place instance `i`: feet at (x, y, z), facing yaw (0 is +z), on pose block `block`. */
  set(i: number, x: number, y: number, z: number, yaw: number, block: number, body: number, look: number, fade: number, fog: number): void {
    const e = this.fill.instanceMatrix.array as Float32Array;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const o = i * 16;
    e[o] = c;
    e[o + 1] = 0;
    e[o + 2] = -s;
    e[o + 3] = 0;
    e[o + 4] = 0;
    e[o + 5] = 1;
    e[o + 6] = 0;
    e[o + 7] = 0;
    e[o + 8] = s;
    e[o + 9] = 0;
    e[o + 10] = c;
    e[o + 11] = 0;
    e[o + 12] = x;
    e[o + 13] = y;
    e[o + 14] = z;
    e[o + 15] = 1;
    (this.pose.array as Float32Array)[i] = block;
    const a = this.crowd.array as Float32Array;
    a[i * 4] = body;
    a[i * 4 + 1] = look;
    a[i * 4 + 2] = fade;
    a[i * 4 + 3] = fog;
  }

  /** Draw the first `n` instances set this frame. */
  commit(n: number): void {
    this.count = n;
    this.fill.count = this.hull.count = n;
    this.fill.visible = this.hull.visible = n > 0;
    if (!n) return;
    const m = this.fill.instanceMatrix;
    m.clearUpdateRanges();
    m.addUpdateRange(0, n * 16);
    m.needsUpdate = true;
    this.pose.clearUpdateRanges();
    this.pose.addUpdateRange(0, n);
    this.pose.needsUpdate = true;
    this.crowd.clearUpdateRanges();
    this.crowd.addUpdateRange(0, n * 4);
    this.crowd.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.fill.dispose();
    this.hull.dispose();
  }
}
