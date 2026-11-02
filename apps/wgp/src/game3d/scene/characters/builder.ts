/**
 * Builds a character's one skinned geometry in code: tubes swept along the bones (limbs,
 * torso, neck) and lathed shapes (heads), each a ring-by-ring profile with smooth skin
 * weights that blend across the joints, plus rigid accessories (ears, glasses, a cigar, a
 * glider, chains) weighted wholly to one bone. Everything lands in one BufferGeometry, so a
 * character is one draw call for its fill and one for its ink hull.
 *
 * Per-vertex data the character shader reads:
 * - `aPal`: palette indices (base, overlay 1, overlay 2) and shading flags;
 * - `aMask`: the two overlay masks, interpolated and thresholded in the fragment shader, so
 *   a shirt front or a tie has a crisp edge that doesn't follow the triangles;
 * - `aDetail`: pattern coordinates and kind (the hero's web, face decals; see shaders.ts);
 * - `aHull`: the ink hull's push direction (smooth across hard edges) and width multiplier.
 */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector3 } from "three";

/** Bone influences: [bone index, weight] pairs. */
export type Weights = [number, number][];

/** Shading flags in aPal.w. */
export const FLAG = {
  /** Flat fill, no cel bands (lenses, eyes, glow). */
  unlit: 1,
  /** No halftone dots in the shadow band. */
  noDots: 2,
} as const;

/** Pattern kinds in aDetail.w. */
export const DETAIL = {
  none: 0,
  /** Radial web around a centre; (a, b) = position in the web's plane. */
  web: 1,
  /** Face decals; (a, b) = face coordinates. */
  face: 2,
  /** Both: the hero's mask. */
  faceWeb: 3,
  /** Web on a limb; (a, b) = radial offset around the limb, c = distance along it. */
  limbWeb: 4,
} as const;

export interface Sample {
  /** Distance along the tube's axis from its start. */
  s: number;
  rx: number;
  /** Depth radius (defaults to rx). */
  rz?: number;
  /** Shift of the ring centre, bind space. */
  off?: [number, number, number];
  w: Weights;
  /** Palette index. */
  color: number;
}

export interface Overlay {
  /** Palette indices for the two overlays. */
  c1: number;
  c2?: number;
  /** Mask values per vertex (thresholded at 0.5 in the shader): bind position, ring, angle. */
  mask(p: Vector3, theta: number): [number, number];
}

export type DetailFn = (p: Vector3, n: Vector3, radial: Vector3, s: number, theta: number) => [number, number, number, number];

export interface TubeOpts {
  from: Vector3;
  axis: Vector3;
  /** Reference for the ring frame's first axis (the rx direction); projected off the axis. */
  ref?: Vector3;
  samples: Sample[];
  segs: number;
  /** Rounded caps: how far each extends past its end sample, and in how many rings. */
  capStart?: number;
  capEnd?: number;
  capRings?: number;
  hull?: number;
  flags?: number;
  overlay?: Overlay;
  detail?: DetailFn;
}

export interface PrimOpts {
  matrix: Matrix4;
  w: Weights;
  color: number;
  hull?: number;
  flags?: number;
  overlay?: Overlay;
  detail?: DetailFn;
  /** Hull push: the surface normal (smooth shapes) or radial from the shape's centre (boxes, discs). */
  hullMode?: "normal" | "radial";
}

interface Ring {
  c: Vector3;
  rx: number;
  rz: number;
  w: Weights;
  color: number;
  s: number;
}

const _p = new Vector3();
const _n = new Vector3();
const _r = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private hull: number[] = [];
  private skinI: number[] = [];
  private skinW: number[] = [];
  private pal: number[] = [];
  private mask: number[] = [];
  private detail: number[] = [];
  private index: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.index.length / 3;
  }

  private vertex(p: Vector3, n: Vector3, hd: Vector3, hullW: number, w: Weights, base: number, overlay: Overlay | undefined, flags: number, theta: number, detail: [number, number, number, number]): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.hull.push(hd.x, hd.y, hd.z, hullW);
    const ws = [...w].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const total = ws.reduce((t, x) => t + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.skinI.push(ws[k] ? ws[k][0] : 0);
      this.skinW.push(ws[k] ? ws[k][1] / total : 0);
    }
    const m = overlay ? overlay.mask(p, theta) : [0, 0];
    this.pal.push(base, overlay ? overlay.c1 : base, overlay?.c2 ?? base, flags);
    this.mask.push(m[0], m[1]);
    this.detail.push(detail[0], detail[1], detail[2], detail[3]);
    return i;
  }

  /** A tube swept along `axis`: rings from the samples, optional rounded caps, smooth normals. */
  tube(o: TubeOpts): void {
    const axis = o.axis.clone().normalize();
    const ref = (o.ref ?? (Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0))).clone();
    const fa = ref.sub(axis.clone().multiplyScalar(ref.dot(axis))).normalize();
    const fb = axis.clone().cross(fa).normalize();
    const rings: Ring[] = [];
    const ringAt = (sm: Sample, along: number, scale: number): Ring => {
      const c = o.from.clone().addScaledVector(axis, along);
      if (sm.off) c.add(new Vector3(...sm.off));
      return { c, rx: sm.rx * scale, rz: (sm.rz ?? sm.rx) * scale, w: sm.w, color: sm.color, s: along };
    };
    const capN = o.capRings ?? 4;
    const first = o.samples[0];
    const last = o.samples[o.samples.length - 1];
    if (o.capStart) {
      for (let k = capN; k >= 1; k--) {
        const phi = (k / capN) * (Math.PI / 2);
        rings.push(ringAt(first, first.s - o.capStart * Math.sin(phi), Math.cos(phi)));
      }
    }
    for (const sm of o.samples) rings.push(ringAt(sm, sm.s, 1));
    if (o.capEnd) {
      for (let k = 1; k <= capN; k++) {
        const phi = (k / capN) * (Math.PI / 2);
        rings.push(ringAt(last, last.s + o.capEnd * Math.sin(phi), Math.cos(phi)));
      }
    }
    const segs = o.segs;
    const R = rings.length;
    // Positions first, for finite-difference normals.
    const P: Vector3[] = [];
    for (const r of rings) {
      for (let j = 0; j < segs; j++) {
        const t = (j / segs) * Math.PI * 2;
        P.push(r.c.clone().addScaledVector(fa, Math.cos(t) * r.rx).addScaledVector(fb, Math.sin(t) * r.rz));
      }
    }
    const same = (x: Ring, y: Ring) => x.c.distanceToSquared(y.c) < 1e-8 && Math.abs(x.rx - y.rx) < 1e-6 && Math.abs(x.rz - y.rz) < 1e-6;
    const prevDistinct = (k: number) => {
      let i = k - 1;
      while (i >= 0 && same(rings[i], rings[k])) i--;
      return i < 0 ? k : i;
    };
    const nextDistinct = (k: number) => {
      let i = k + 1;
      while (i < R && same(rings[i], rings[k])) i++;
      return i >= R ? k : i;
    };
    const ids: number[] = [];
    for (let k = 0; k < R; k++) {
      const r = rings[k];
      const kp = prevDistinct(k);
      const kn = nextDistinct(k);
      const pole = r.rx < 1e-4 && r.rz < 1e-4;
      for (let j = 0; j < segs; j++) {
        const p = P[k * segs + j];
        const t = (j / segs) * Math.PI * 2;
        if (pole) {
          const other = kn !== k ? rings[kn] : rings[kp];
          _n.copy(r.c).sub(other.c).normalize();
        } else {
          const pt = _a.copy(P[k * segs + ((j + 1) % segs)]).sub(P[k * segs + ((j - 1 + segs) % segs)]);
          const ps = _b.copy(P[kn * segs + j]).sub(P[kp * segs + j]);
          if (ps.lengthSq() < 1e-10) ps.copy(axis);
          _n.copy(pt).cross(ps).normalize();
          _r.copy(p).sub(r.c);
          if (_n.dot(_r) < 0) _n.negate();
        }
        _r.copy(p).sub(r.c);
        const along = r.s;
        const det = o.detail ? o.detail(p, _n, _r, along, t) : ([0, 0, 0, 0] as [number, number, number, number]);
        ids.push(this.vertex(p, _n, _n, o.hull ?? 1, r.w, r.color, o.overlay, o.flags ?? 0, t, det));
      }
    }
    for (let k = 0; k < R - 1; k++) {
      for (let j = 0; j < segs; j++) {
        const a = ids[k * segs + j];
        const b = ids[k * segs + ((j + 1) % segs)];
        const c = ids[(k + 1) * segs + j];
        const d = ids[(k + 1) * segs + ((j + 1) % segs)];
        this.index.push(a, b, c, b, d, c);
      }
    }
  }

  /** A rigid accessory from any indexed or non-indexed geometry, placed by `matrix`. */
  prim(geo: BufferGeometry, o: PrimOpts): void {
    const pos = geo.getAttribute("position");
    const nrm = geo.getAttribute("normal");
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const center = bb.getCenter(new Vector3());
    const ext = bb.getSize(new Vector3()).multiplyScalar(0.5).max(new Vector3(1e-3, 1e-3, 1e-3));
    const nm = new Matrix3().getNormalMatrix(o.matrix);
    const base = this.pos.length / 3;
    const hd = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i);
      if (o.hullMode === "radial") hd.copy(_p).sub(center).divide(ext).normalize();
      else hd.fromBufferAttribute(nrm, i);
      _p.applyMatrix4(o.matrix);
      _n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      hd.applyMatrix3(nm).normalize();
      _r.copy(_n);
      const det = o.detail ? o.detail(_p, _n, _r, 0, 0) : ([0, 0, 0, 0] as [number, number, number, number]);
      this.vertex(_p, _n, hd, o.hull ?? 1, o.w, o.color, o.overlay, o.flags ?? 0, 0, det);
    }
    const idx = geo.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) this.index.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) this.index.push(base + i);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute("aHull", new BufferAttribute(new Float32Array(this.hull), 4));
    g.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(this.skinI), 4));
    g.setAttribute("skinWeight", new BufferAttribute(new Float32Array(this.skinW), 4));
    g.setAttribute("aPal", new BufferAttribute(new Float32Array(this.pal), 4));
    g.setAttribute("aMask", new BufferAttribute(new Float32Array(this.mask), 2));
    g.setAttribute("aDetail", new BufferAttribute(new Float32Array(this.detail), 4));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(this.index), 1) : new BufferAttribute(new Uint16Array(this.index), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Weights that blend from bone a to bone b as s runs from s0 to s1 (smoothstep). */
export function blendW(a: number, b: number, s: number, s0: number, s1: number): Weights {
  if (s <= s0) return [[a, 1]];
  if (s >= s1) return [[b, 1]];
  const t = (s - s0) / (s1 - s0);
  const k = t * t * (3 - 2 * t);
  return [
    [a, 1 - k],
    [b, k],
  ];
}

/** Matrix from a position, Euler-ish rotations (radians, applied Y then X then Z) and a scale. */
export function placeAt(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 {
  const m = new Matrix4();
  const r = new Matrix4().makeRotationY(ry).multiply(new Matrix4().makeRotationX(rx)).multiply(new Matrix4().makeRotationZ(rz));
  m.makeTranslation(x, y, z).multiply(r).multiply(new Matrix4().makeScale(sx, sy, sz));
  return m;
}
