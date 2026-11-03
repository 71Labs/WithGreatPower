/**
 * The cast's body files: MPFB (MakeHuman, CC0) bodies on the hero's 53-bone skeleton, made by
 * launch/brand/hero/build_cast.py. One file per character and tier:
 *
 * - `cast-<id>.glb` (medium and high): the full body, "Body" (about 7–8k triangles), and a
 *   lighter one for distance, "BodyLo" (about 2.6k), on one skeleton;
 * - `cast-<id>-lo.glb` (the low tier): "BodyLo" alone;
 * - the Sybil's files also carry "BodyMin" (about 1.3k) for his copies.
 *
 * What each mesh holds (glTF metres: +Y up, facing +Z, the soles at y = 0):
 * - `_pal`: the palette entry per face corner (clothes, skin, hair, props);
 * - `_face`: per vertex, cm from between the eyes on the face's plane (x to the body's left,
 *   y up) and a mask, 1 where the painted features (decals) may land;
 * - `_ao`: ambient occlusion per vertex, baked against the same limb only;
 * - Gwei's file also has build.py's web coordinates (`_web_p`, `_web_q`, `_web_r`) for her mask.
 *
 * The node extras ("wgp", a JSON string) carry the palette's colours, which entries are flat or
 * glossy, the face's decals and any sockets (Doc's chain booms), so the files are the only
 * source of each character's look. Loaded at most once per file (packed by
 * scripts/models/compress.sh), with GLTFLoader fetched on first use, only for the characters on
 * the current night, and queued behind the hero's files (files.ts).
 */
import { BufferAttribute, BufferGeometry, Sphere, Vector3, type Object3D, type SkinnedMesh } from "three";

import { castModelUrl as fileUrl, queueModel } from "./files";
import { loadGltf } from "./gltf";
import { orderedBones, remapSkin, type HeroAsset, type HeroBone } from "./hero-asset";

export { CAST_ANIMS } from "./files";

/** Game units per metre: the hero's 88 units for his 1.886 m. Every body shares it. */
export const UNITS_PER_METRE = 88 / 1.886;

/** The characters with an MPFB body. */
export const CAST_BODIES = ["aunt-mainnet", "uncle-gen", "mary-jpeg", "bearson", "gwei", "gas-goblin", "sandwich-man", "doc-octochain", "sybil"] as const;
export type CastBodyId = (typeof CAST_BODIES)[number];

export function castModelUrl(id: CastBodyId, low: boolean): string {
  return fileUrl(id, low);
}

export type DecalShapeName = "ellipse" | "ring" | "lower" | "stroke" | "upper" | "arc" | "jag" | "teeth";

export interface CastDecal {
  shape: DecalShapeName;
  /** cm from between the eyes, x to the body's left, y up. */
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
  /** Palette entry, or −1 for none. */
  fill: number;
  /** Ink rim (or an arc's line), CSS px. */
  ink: number;
  clip: boolean;
  mirror: boolean;
  /** Jag spikes or teeth per row, and their depth (fraction of the radius). */
  n: number;
  amp: number;
}

export interface CastMeta {
  who: string;
  /** Hex colours; [0] is ink. */
  palette: string[];
  names: string[];
  /** Entries drawn flat (no bands) and glossy (a hard white highlight). */
  flat: number[];
  gloss: number[];
  decals: CastDecal[];
  /** Attachment points in the rest pose (metres), by name: Doc's chain booms. */
  sockets: Record<string, { bone: string; at: [number, number, number] }>;
  /** Whether the file carries web coordinates (Gwei's mask). */
  web: boolean;
  /** Top of the tallest part above the soles (metres). */
  height: number;
}

export interface CastAsset {
  url: string;
  bones: HeroBone[];
  /** The meshes by level of detail, as loaded (metres). */
  hi: BufferGeometry | null;
  lo: BufferGeometry;
  /** A lighter body still, for a crowd (the Sybil's copies), when the file has one. */
  min: BufferGeometry | null;
  meta: CastMeta;
  /** Top of the head (or hood, or bear ears) above the soles, metres. */
  height: number;
}

const pending = new Map<string, Promise<CastAsset>>();
const loaded = new Map<string, CastAsset>();

/** Load a body file once, in the queue behind the hero's files (`urgent`: at the front of it). */
export function loadCastAsset(url: string, urgent = false): Promise<CastAsset> {
  let p = pending.get(url);
  if (!p) {
    p = (async () => {
      const gltf = await loadGltf(url, queueModel(url, urgent));
      const a = castFromScene(gltf.scene, url);
      loaded.set(url, a);
      return a;
    })();
    pending.set(url, p);
  }
  return p;
}

export function castAssetNow(url: string): CastAsset | null {
  return loaded.get(url) ?? null;
}

/** Pull the skeleton, both levels of detail and the look out of a loaded file. */
export function castFromScene(scene: Object3D, url: string): CastAsset {
  const meshes = new Map<string, SkinnedMesh>();
  scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.set(o.name, o as SkinnedMesh);
  });
  const lo = meshes.get("BodyLo");
  if (!lo) throw new Error(`${url}: no BodyLo`);
  const hi = meshes.get("Body") ?? null;
  const min = meshes.get("BodyMin") ?? null;
  const { bones, remap } = orderedBones(lo);
  const raw = (lo.userData as { wgp?: string }).wgp;
  if (!raw) throw new Error(`${url}: no wgp extras`);
  const meta = JSON.parse(raw) as CastMeta;
  for (const m of [hi, lo, min]) {
    if (!m) continue;
    remapSkin(m.geometry, remap);
    for (const name of ["_pal", "_face", "_ao", "normal"]) if (!m.geometry.getAttribute(name)) throw new Error(`${url}: ${m.name} has no ${name}`);
  }
  return { url, bones, hi: hi?.geometry ?? null, lo: lo.geometry, min: min?.geometry ?? null, meta, height: meta.height };
}

/** The asset as the hero's rig builder takes it (bones and height). */
export function rigSource(a: CastAsset): HeroAsset {
  return { url: a.url, bones: a.bones, geometry: a.lo, height: a.height };
}

const HAND = /^(hand|thumb|index|middle|ring|pinky)_/;

/**
 * One level of detail in game units, with what the cast shader reads: `aPal`, `aFace`, `aAO`,
 * and `aHull` for the ink outline (normals welded over shared positions so the hull never
 * cracks at a colour seam; thinner on the hands, and on flat bits like glasses, so they stay
 * fine). Gwei's web coordinates come along as `aWebP/Q/R`, lengths scaled.
 */
export function castGeometry(a: CastAsset, src: BufferGeometry, k: number): BufferGeometry {
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
  g.setAttribute("aPal", src.getAttribute("_pal").clone());
  g.setAttribute("aFace", src.getAttribute("_face").clone());
  g.setAttribute("aAO", src.getAttribute("_ao").clone());
  const wp = src.getAttribute("_web_p");
  if (wp) {
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
  }

  // Hull directions: welded normals.
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const sum = new Map<string, Vector3>();
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    const kk = key(i);
    const s = sum.get(kk) ?? sum.set(kk, new Vector3()).get(kk)!;
    s.add(v.fromBufferAttribute(nrm, i));
  }
  const hand = a.bones.map((b) => HAND.test(b.name));
  const flat = new Set(a.meta.flat);
  const pal = src.getAttribute("_pal");
  const si = src.getAttribute("skinIndex");
  const sw = src.getAttribute("skinWeight");
  const hull = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    v.copy(sum.get(key(i))!).normalize();
    let onHand = 0;
    for (let c = 0; c < 4; c++) if (hand[si.getComponent(i, c)]) onHand += sw.getComponent(i, c);
    let w = 1 - 0.45 * onHand;
    if (flat.has(Math.round(pal.getX(i)))) w = 0.55;
    hull.set([v.x, v.y, v.z, w], i * 4);
  }
  g.setAttribute("aHull", new BufferAttribute(hull, 4));
  g.setIndex(src.getIndex()!.clone());
  const h = a.height * k;
  g.boundingSphere = new Sphere(new Vector3(0, h * 0.45, 0), h * 1.25);
  return g;
}
