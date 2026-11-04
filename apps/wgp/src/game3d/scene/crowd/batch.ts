/**
 * The crowd on the GPU: per level of detail, one instanced fill and one instanced ink hull
 * (the cast's two passes) for each civilian body that has anyone on screen, all on two shared
 * materials, so a draw after the first switches nothing but its buffers.
 *
 * - Skinning reads a bone texture of pose blocks, a row each: one per body and channel
 *   (crowd/clips.ts), written by plain forward kinematics (crowd/skeleton.ts). Only the rows
 *   that changed go up each frame (texture update ranges).
 * - Each instance says which pose block and which look (a row of the looks texture), with its
 *   own dither fade and fog; its matrix places and turns it.
 * - A body's instances draw its own mesh only: no vertex is processed for anyone else.
 *
 * Draw calls: two per body with someone drawn in that level of detail; none when it's empty.
 */
import { BackSide, BufferAttribute, BufferGeometry, DataTexture, DynamicDrawUsage, FloatType, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, NearestFilter, RGBAFormat, ShaderMaterial, Vector3, type IUniform } from "three";

import type { SharedUniforms } from "../city/materials";
import { castGeometry, type CastAsset } from "../characters/cast-asset";
import { castMaterial } from "../characters/cast-model";
import { C } from "../palette";
import type { ClipSample } from "./clips";
import { CROWD_FRAGMENT, CROWD_HULL_FRAGMENT, CROWD_HULL_VERTEX, CROWD_VERTEX } from "./shaders";
import { BLOCK_FLOATS, CROWD_BONE_COUNT, type CrowdSkeleton } from "./skeleton";

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
 * One body's mesh at one level of detail in game units, with what the cast shader reads,
 * skinned to the crowd's 23 bones and tagged with its body (`aVariant`).
 */
export function bodyGeometry(asset: CastAsset, src: BufferGeometry, skeleton: CrowdSkeleton, body: number, k: number): BufferGeometry {
  const g = castGeometry(asset, src, k);
  const si = g.getAttribute("skinIndex");
  const skin = new Uint16Array(si.count * 4);
  for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) skin[i * 4 + c] = skeleton.remap[si.getComponent(i, c)] ?? 0;
  g.setAttribute("skinIndex", new BufferAttribute(skin, 4));
  g.setAttribute("aVariant", new BufferAttribute(new Float32Array(si.count).fill(body), 1));
  return g;
}

/** One body's instanced fill and hull, and how many it draws this frame. */
class BodyDraw {
  readonly fill: InstancedMesh;
  readonly hull: InstancedMesh;
  readonly pose: InstancedBufferAttribute;
  readonly crowd: InstancedBufferAttribute;
  readonly triangles: number;
  n = 0;

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
    this.triangles = (geometry.getIndex()?.count ?? 0) / 3;
  }
}

/** One level of detail: a fill and a hull per body. */
export class CrowdBatch {
  readonly group = new Group();
  private readonly draws: BodyDraw[];

  constructor(parts: { asset: CastAsset; geometry: BufferGeometry; skeleton: CrowdSkeleton }[], k: number, materials: CrowdMaterials, max: number, name: string) {
    this.group.name = name;
    this.draws = parts.map((p, v) => {
      const d = new BodyDraw(bodyGeometry(p.asset, p.geometry, p.skeleton, v, k), materials, max, `${name}-${p.asset.meta.who}`);
      this.group.add(d.fill, d.hull);
      return d;
    });
  }

  /** Start a frame's instances. */
  begin(): void {
    for (const d of this.draws) d.n = 0;
  }

  /** Add someone: feet at (x, y, z), facing yaw (0 is +z), on pose block `block`. */
  add(x: number, y: number, z: number, yaw: number, block: number, body: number, look: number, fade: number, fog: number): void {
    const d = this.draws[body];
    if (!d || d.n >= d.max) return;
    const i = d.n++;
    const e = d.fill.instanceMatrix.array as Float32Array;
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
    (d.pose.array as Float32Array)[i] = block;
    const a = d.crowd.array as Float32Array;
    a[i * 4] = body;
    a[i * 4 + 1] = look;
    a[i * 4 + 2] = fade;
    a[i * 4 + 3] = fog;
  }

  /** Draw what was added since `begin`. Returns the draw calls it makes. */
  commit(): number {
    let calls = 0;
    for (const d of this.draws) {
      const n = d.n;
      d.fill.count = d.hull.count = n;
      d.fill.visible = d.hull.visible = n > 0;
      if (!n) continue;
      calls += 2;
      const m = d.fill.instanceMatrix;
      m.clearUpdateRanges();
      m.addUpdateRange(0, n * 16);
      m.needsUpdate = true;
      d.pose.clearUpdateRanges();
      d.pose.addUpdateRange(0, n);
      d.pose.needsUpdate = true;
      d.crowd.clearUpdateRanges();
      d.crowd.addUpdateRange(0, n * 4);
      d.crowd.needsUpdate = true;
    }
    return calls;
  }

  /** Triangles drawn this frame (fills; the hulls double it). */
  get triangles(): number {
    return this.draws.reduce((s, d) => s + d.n * d.triangles, 0);
  }

  /** People drawn this frame. */
  get count(): number {
    return this.draws.reduce((s, d) => s + d.n, 0);
  }

  dispose(): void {
    for (const d of this.draws) {
      d.geometry.dispose();
      d.fill.dispose();
      d.hull.dispose();
    }
  }
}
