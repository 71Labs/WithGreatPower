/**
 * The hero's body file: an MPFB (MakeHuman, CC0) model in public/models, made by
 * launch/brand/hero/export.py --game. Loaded at most once per file with three's GLTFLoader,
 * which is itself fetched on first use, so neither ever reaches a page without the 3D scene.
 *
 * What the file holds (glTF metres: +Y up, facing +Z, the soles at y = 0):
 * - one skinned mesh in the rest A-pose on a 53-bone UE-style skeleton;
 * - three custom attributes: build.py's web coordinates per face corner, `_web_p` (cos θ,
 *   sin θ, d), `_web_q` (ρ, radials, ring spacing) and `_web_r` (ring sag A, B, kind), where
 *   kinds 0–6 are the web's cells and 8 / 9 the mask's lens and rim shells;
 * - `_ao`: ambient occlusion per vertex, baked against the same limb only.
 *
 * `heroGeometry` turns it into game units with the attributes the hero's shaders read.
 *
 * The clips (hero-anims.glb) come from a separate file of the same skeleton with no mesh:
 * one glTF animation per clip, resampled here to plain arrays per bone.
 */
import { BufferAttribute, BufferGeometry, Sphere, Vector3, type AnimationClip, type Object3D, type SkinnedMesh } from "three";

/** The two levels of detail: the full body, and the low tier's lighter one. */
export const HERO_MODEL = { hi: "/models/hero.glb", lo: "/models/hero-lo.glb" } as const;

/** The hero's motion-capture clips (Quaternius' UAL, CC0, retargeted by launch/brand/hero/retarget.py). */
export const HERO_ANIMS = "/models/hero-anims.glb";

/** Clips are resampled to this rate. */
export const CLIP_FPS = 30;

export interface HeroClip {
  name: string;
  /** Samples (the first at t = 0, the last at `duration`). */
  frames: number;
  duration: number;
  /** Local rotations per bone name, xyzw per frame. */
  rot: Map<string, Float32Array>;
  /** The pelvis's local position per frame, metres. */
  pelvis: Float32Array | null;
}

/** Clips by name, and the source skeleton's rest pose when known (its pelvis, local metres, and
 *  each bone's local rest rotation): a body of other proportions plays the clips as moves from
 *  its own rest pose (anim/motion.ts). */
export type HeroClips = Map<string, HeroClip> & { pelvisRest?: [number, number, number]; restQ?: Map<string, [number, number, number, number]> };

/** Web kinds past the cells. */
export const KIND_LENS = 8;
export const KIND_RIM = 9;

export interface HeroBone {
  name: string;
  /** Index of the parent bone, or −1 for the root. Parents come first. */
  parent: number;
  /** Rest local transform, metres. */
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export interface HeroAsset {
  url: string;
  /** In skinning order: `skinIndex` points into this list; [0] is the root. */
  bones: HeroBone[];
  /** As loaded, in metres: position, normal, skinIndex, skinWeight, _web_p/q/r, _ao. */
  geometry: BufferGeometry;
  /** Top of the head above the soles, metres. */
  height: number;
}

const pending = new Map<string, Promise<HeroAsset>>();
const loaded = new Map<string, HeroAsset>();

/** Load a body file once (later calls share the first request). */
export function loadHeroAsset(url: string): Promise<HeroAsset> {
  let p = pending.get(url);
  if (!p) {
    p = fetchAsset(url).then((a) => {
      loaded.set(url, a);
      return a;
    });
    pending.set(url, p);
  }
  return p;
}

/** A body file that has already loaded, or null. */
export function heroAssetNow(url: string): HeroAsset | null {
  return loaded.get(url) ?? null;
}

const clipsPending = new Map<string, Promise<HeroClips>>();

/** Load the clip file once. */
export function loadHeroClips(url: string = HERO_ANIMS): Promise<HeroClips> {
  let p = clipsPending.get(url);
  if (!p) {
    p = (async () => {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(url);
      const clips = clipsFromGltf(gltf.animations);
      const pelvis = gltf.scene.getObjectByName("pelvis");
      if (pelvis) clips.pelvisRest = [pelvis.position.x, pelvis.position.y, pelvis.position.z];
      // The armature's nodes at rest (the file has no skin, so they load as plain objects).
      const rest = new Map<string, [number, number, number, number]>();
      gltf.scene.traverse((o) => {
        if (o.name) rest.set(o.name, [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]);
      });
      clips.restQ = rest;
      return clips;
    })();
    clipsPending.set(url, p);
  }
  return p;
}

/** Resample glTF animations to CLIP_FPS: bone rotations and the pelvis's position. */
export function clipsFromGltf(animations: AnimationClip[]): HeroClips {
  const out: HeroClips = new Map();
  for (const a of animations) {
    const frames = Math.max(2, Math.round(a.duration * CLIP_FPS) + 1);
    const clip: HeroClip = { name: a.name, frames, duration: a.duration, rot: new Map(), pelvis: null };
    for (const track of a.tracks) {
      const dot = track.name.lastIndexOf(".");
      const bone = track.name.slice(0, dot);
      const prop = track.name.slice(dot + 1);
      const quat = prop === "quaternion";
      if (!quat && !(prop === "position" && bone === "pelvis")) continue;
      const n = quat ? 4 : 3;
      const data = new Float32Array(frames * n);
      // Linear (slerp for rotations): the clips are sampled at every frame already.
      const f = track.InterpolantFactoryMethodLinear(new Float32Array(n));
      for (let i = 0; i < frames; i++) data.set(f.evaluate(Math.min(a.duration, i / CLIP_FPS)) as Float32Array, i * n);
      if (quat) clip.rot.set(bone, data);
      else clip.pelvis = data;
    }
    out.set(a.name, clip);
  }
  return out;
}

async function fetchAsset(url: string): Promise<HeroAsset> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url);
  return assetFromScene(gltf.scene, url);
}

/**
 * A skinned mesh's skeleton in the game's order (parents first, the root at 0) and the map
 * from the file's joint indices to it.
 */
export function orderedBones(skinned: SkinnedMesh): { bones: HeroBone[]; remap: Map<number, number> } {
  const src = skinned.skeleton.bones;
  const at = new Map<Object3D, number>(src.map((b, i) => [b, i]));
  // Parents first, the root at 0: a depth-first walk from the root, and the skin remapped.
  const order: number[] = [];
  const visit = (i: number) => {
    order.push(i);
    src.forEach((b, j) => {
      if (b.parent === src[i]) visit(j);
    });
  };
  src.forEach((b, i) => {
    if (!b.parent || !at.has(b.parent)) visit(i);
  });
  const remap = new Map<number, number>(order.map((from, to) => [from, to]));
  const bones: HeroBone[] = order.map((i) => {
    const b = src[i];
    const parent = b.parent ? (at.get(b.parent) ?? -1) : -1;
    return {
      name: b.name,
      parent: parent < 0 ? -1 : remap.get(parent)!,
      position: [b.position.x, b.position.y, b.position.z],
      quaternion: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
    };
  });
  return { bones, remap };
}

/** Rewrite a geometry's `skinIndex` through `remap` (file joint → game bone). */
export function remapSkin(geometry: BufferGeometry, remap: Map<number, number>): void {
  const skin = geometry.getAttribute("skinIndex");
  const idx = new Uint16Array(skin.count * 4);
  for (let i = 0; i < skin.count; i++) for (let c = 0; c < 4; c++) idx[i * 4 + c] = remap.get(skin.getComponent(i, c)) ?? 0;
  geometry.setAttribute("skinIndex", new BufferAttribute(idx, 4));
}

/** Pull the skinned body and its skeleton out of a loaded glTF scene. */
export function assetFromScene(scene: Object3D, url: string): HeroAsset {
  let mesh: SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new Error(`${url}: no skinned mesh`);
  const skinned: SkinnedMesh = mesh;
  const { bones, remap } = orderedBones(skinned);
  const geometry = skinned.geometry;
  remapSkin(geometry, remap);
  for (const name of ["_web_p", "_web_q", "_web_r", "_ao", "normal"]) {
    if (!geometry.getAttribute(name)) throw new Error(`${url}: no ${name}`);
  }
  geometry.computeBoundingBox();
  return { url, bones, geometry, height: geometry.boundingBox!.max.y };
}

/** Metres to game units for a body `height` tall. */
export function heroScale(asset: HeroAsset, height: number): number {
  return height / asset.height;
}

const HAND = /^(hand|thumb|index|middle|ring|pinky)_/;

/**
 * The body in game units, with what the hero's shaders read: `aWebP`/`aWebQ`/`aWebR` (the
 * web's lengths scaled too), `aAO`, and `aHull` for the ink outline: normals averaged over
 * the vertices that share a position, so the hull never cracks where the web's cells split
 * the mesh, and a thinner line on the hands and lenses so fingers stay fingers.
 */
export function heroGeometry(asset: HeroAsset, k: number): BufferGeometry {
  const src = asset.geometry;
  const pos = src.getAttribute("position");
  const nrm = src.getAttribute("normal");
  const n = pos.count;
  const g = new BufferGeometry();
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = pos.getX(i) * k;
    p[i * 3 + 1] = pos.getY(i) * k;
    p[i * 3 + 2] = pos.getZ(i) * k;
  }
  g.setAttribute("position", new BufferAttribute(p, 3));
  g.setAttribute("normal", nrm.clone());
  g.setAttribute("skinIndex", src.getAttribute("skinIndex").clone());
  g.setAttribute("skinWeight", src.getAttribute("skinWeight").clone());

  const wp = src.getAttribute("_web_p");
  const wq = src.getAttribute("_web_q");
  const wr = src.getAttribute("_web_r");
  const P = new Float32Array(n * 3);
  const Q = new Float32Array(n * 3);
  const R = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    P.set([wp.getX(i), wp.getY(i), wp.getZ(i) * k], i * 3);
    Q.set([wq.getX(i) * k, wq.getY(i), wq.getZ(i) * k], i * 3);
    R.set([wr.getX(i) * k, wr.getY(i), wr.getZ(i)], i * 3);
  }
  g.setAttribute("aWebP", new BufferAttribute(P, 3));
  g.setAttribute("aWebQ", new BufferAttribute(Q, 3));
  g.setAttribute("aWebR", new BufferAttribute(R, 3));
  g.setAttribute("aAO", src.getAttribute("_ao").clone());

  // Hull directions: welded normals.
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const sum = new Map<string, Vector3>();
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    const kk = key(i);
    const s = sum.get(kk) ?? sum.set(kk, new Vector3()).get(kk)!;
    s.add(v.fromBufferAttribute(nrm, i));
  }
  const hand = asset.bones.map((b) => HAND.test(b.name));
  const si = src.getAttribute("skinIndex");
  const sw = src.getAttribute("skinWeight");
  const hull = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    v.copy(sum.get(key(i))!).normalize();
    let w = 1;
    if (wr.getZ(i) > KIND_LENS - 0.5) w = 0.6;
    else {
      let onHand = 0;
      for (let c = 0; c < 4; c++) if (hand[si.getComponent(i, c)]) onHand += sw.getComponent(i, c);
      w = 1 - 0.45 * onHand;
    }
    hull.set([v.x, v.y, v.z, w], i * 4);
  }
  g.setAttribute("aHull", new BufferAttribute(hull, 4));
  g.setIndex(src.getIndex()!.clone());
  // Poses swing limbs well past the bind pose; cull against a generous sphere around the root.
  const h = asset.height * k;
  g.boundingSphere = new Sphere(new Vector3(0, h * 0.45, 0), h * 1.25);
  return g;
}
