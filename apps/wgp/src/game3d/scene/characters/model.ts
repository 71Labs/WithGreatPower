/**
 * One drawable character: its rig, its skinned geometry at each level of detail, and the
 * fill and ink-hull meshes that share them. The group sits at the character's root (the
 * soles) in world space; the root bone carries the body's rotation, so moving the group
 * moves the culling sphere with the character.
 *
 * `CopyBatch` draws any number of identical bodies (The Sybil's copies) as one instanced
 * pair of draw calls: every instance shares one skeleton, skinned through its bone texture.
 */
import { DataTexture, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Sphere, SkinnedMesh, Vector3, type BufferGeometry, type ShaderMaterial } from "three";

import type { SuitColors } from "@/components/cast";

import type { SharedUniforms } from "../city/materials";
import { BodyKit, Palette, type HeadFrame, type Lod } from "./cast/kit";
import { bodyMaterial, decalUniforms, hullMaterial, paletteUniform, type Decal } from "./materials";
import { createRig, type BodySpec, type ExtraBone, type Rig } from "./rig";

/** Every body the scene can draw: the hero, the cast, and the grey Sybil copy. */
export type CharacterKey = "hero" | "gwei" | "uncle-gen" | "aunt-mainnet" | "bearson" | "mary-jpeg" | "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil" | "sybil-copy";

/** How a body moves, which picks its animator. */
export type Motion = "hero" | "glider" | "runner" | "hover" | "float" | "ally";

/** A decal as authored: fill by palette name. */
export type DecalSpec = Omit<Decal, "fill"> & { fill: string | null };

export interface CastDef {
  key: CharacterKey;
  name: string;
  body: BodySpec;
  extras?: ExtraBone[];
  /** Height to the top of the head (or bun, or hood). */
  height: number;
  motion: Motion;
  colors(suit?: SuitColors): Record<string, string>;
  decals: DecalSpec[];
  /** World units between web rings (heroes only). */
  webSpacing?: number;
  /** Adds every part; returns the face frame the decals sit in. */
  build(k: BodyKit): HeadFrame;
  /** Bind-space points for attachments (Doc's chain sockets), by name. */
  sockets?: Record<string, { bone: string; at: [number, number, number] }>;
}

export interface BuiltGeometry {
  geometry: BufferGeometry;
  head: HeadFrame;
  triangles: number;
}

/** Build a cast member's geometry at one level of detail. */
export function buildGeometry(def: CastDef, rig: Rig, palette: Palette, lod: Lod): BuiltGeometry {
  const kit = new BodyKit(rig, palette, lod);
  const head = def.build(kit);
  const geometry = kit.b.build();
  // Poses swing limbs well past the bind pose; cull against a generous sphere around the root.
  geometry.boundingSphere = new Sphere(new Vector3(0, def.height * 0.45, 0), def.height * 1.25);
  return { geometry, head, triangles: kit.b.triangleCount };
}

export function decalsFor(def: CastDef, palette: Palette): Decal[] {
  return def.decals.map((d) => ({ ...d, fill: d.fill === null ? -1 : palette.i(d.fill) }));
}

export class CharacterModel {
  readonly group = new Group();
  readonly rig: Rig;
  readonly fill: ShaderMaterial;
  readonly ink: ShaderMaterial;
  readonly body: SkinnedMesh;
  readonly hull: SkinnedMesh;
  readonly palette: Palette;
  readonly head: HeadFrame;
  private readonly geos = new Map<Lod, BuiltGeometry>();
  lod: Lod;

  constructor(
    readonly def: CastDef,
    shared: SharedUniforms,
    lods: Lod[],
    suit?: SuitColors,
  ) {
    this.group.name = `cast-${def.key}`;
    this.rig = createRig(def.body, def.extras, def.height);
    this.palette = new Palette(def.colors(suit));
    for (const l of lods) this.geos.set(l, buildGeometry(def, this.rig, this.palette, l));
    this.lod = lods[0];
    const first = this.geos.get(this.lod)!;
    this.head = first.head;
    this.fill = bodyMaterial(shared, paletteUniform(this.palette.hex), decalUniforms(decalsFor(def, this.palette), first.head.rx), def.webSpacing ?? 3);
    this.ink = hullMaterial(shared, this.fill);
    this.body = new SkinnedMesh(first.geometry, this.fill);
    this.hull = new SkinnedMesh(first.geometry, this.ink);
    this.body.name = `${def.key}-fill`;
    this.hull.name = `${def.key}-ink`;
    this.group.add(this.rig.bones[0], this.body, this.hull);
    const identity = new Matrix4();
    this.body.bind(this.rig.skeleton, identity);
    this.hull.bind(this.rig.skeleton, identity);
    for (const m of [this.body, this.hull]) {
      m.boundingSphere = first.geometry.boundingSphere!.clone();
      m.renderOrder = 1;
    }
  }

  /** Triangles in the current level of detail (fill only; the hull draws as many again). */
  get triangles(): number {
    return this.geos.get(this.lod)?.triangles ?? 0;
  }

  hasLod(l: Lod): boolean {
    return this.geos.has(l);
  }

  setLod(l: Lod): void {
    const g = this.geos.get(l);
    if (!g || l === this.lod) return;
    this.lod = l;
    this.body.geometry = g.geometry;
    this.hull.geometry = g.geometry;
  }

  /** Recolour (a new suit) without rebuilding. */
  setColors(colors: Record<string, string>): void {
    for (const [name, hex] of Object.entries(colors)) this.palette.set(name, hex);
    this.fill.uniforms.uPal.value = paletteUniform(this.palette.hex);
  }

  set visible(on: boolean) {
    this.group.visible = on;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  dispose(): void {
    for (const g of this.geos.values()) g.geometry.dispose();
    this.fill.dispose();
    this.ink.dispose();
    this.rig.skeleton.dispose();
  }
}

/**
 * Many copies of one body sharing a single pose: an InstancedMesh pair (fill and hull) that
 * skins every instance through one skeleton's bone texture. Pose `rig` at the origin, then
 * place each copy with `setInstance`.
 */
export class CopyBatch {
  readonly group = new Group();
  readonly rig: Rig;
  readonly fill: ShaderMaterial;
  readonly ink: ShaderMaterial;
  readonly body: InstancedMesh;
  readonly hull: InstancedMesh;
  /** Holds the copy rig at the origin, outside the scene graph. */
  readonly holder = new Group();
  private readonly boneTexture: DataTexture;
  private readonly geometry: BufferGeometry;

  constructor(def: CastDef, shared: SharedUniforms, lod: Lod, max: number) {
    this.rig = createRig(def.body, def.extras, def.height);
    const palette = new Palette(def.colors());
    const built = buildGeometry(def, this.rig, palette, lod);
    this.geometry = built.geometry;
    this.holder.add(this.rig.bones[0]);
    this.holder.updateMatrixWorld(true);
    this.rig.skeleton.computeBoneTexture();
    this.boneTexture = this.rig.skeleton.boneTexture!;
    const skin = { boneTexture: this.boneTexture };
    this.fill = bodyMaterial(shared, paletteUniform(palette.hex), decalUniforms(decalsFor(def, palette), built.head.rx), def.webSpacing ?? 3, skin);
    this.ink = hullMaterial(shared, this.fill, skin);
    this.body = new InstancedMesh(this.geometry, this.fill, max);
    this.hull = new InstancedMesh(this.geometry, this.ink, max);
    for (const m of [this.body, this.hull]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 1;
    }
    this.body.name = `${def.key}-copies-fill`;
    this.hull.name = `${def.key}-copies-ink`;
    this.group.add(this.body, this.hull);
  }

  /** Upload the shared pose (call after posing the rig). */
  commitPose(): void {
    this.holder.updateMatrixWorld(true);
    this.rig.skeleton.update();
  }

  setCount(n: number): void {
    this.body.count = n;
    this.hull.count = n;
    this.group.visible = n > 0;
  }

  setInstance(i: number, m: Matrix4): void {
    this.body.setMatrixAt(i, m);
    this.hull.setMatrixAt(i, m);
  }

  commitInstances(): void {
    this.body.instanceMatrix.needsUpdate = true;
    this.hull.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.fill.dispose();
    this.ink.dispose();
    this.body.dispose();
    this.hull.dispose();
    this.rig.skeleton.dispose();
  }
}
