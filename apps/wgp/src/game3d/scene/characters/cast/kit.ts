/**
 * The parts every cast member is made of, on top of the mesh builder: a torso lathed up the
 * spine, a neck, a lathed head that carries face decals, arms and legs swept along the bones
 * with sleeve, glove, trouser and boot colour cuts, mitten hands, boots, and rigid
 * accessories placed in bind space or relative to the head. Three levels of detail share
 * the same parts with fewer segments.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Matrix4, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry } from "three";

import { blendW, DETAIL, MeshBuilder, placeAt, type DetailFn, type Overlay, type Sample, type Weights } from "../builder";
import type { Rig, Side } from "../rig";
import { SIDE_SIGN } from "../rig";

export type Lod = "hi" | "lo" | "min";

const SEGS: Record<Lod, { torso: number; limb: number; head: number; rings: number; prim: number; cap: number }> = {
  hi: { torso: 16, limb: 10, head: 18, rings: 14, prim: 12, cap: 4 },
  lo: { torso: 11, limb: 7, head: 12, rings: 9, prim: 8, cap: 3 },
  min: { torso: 8, limb: 5, head: 9, rings: 7, prim: 6, cap: 2 },
};

/** Palette slots 0–2 are fixed: ink, white, and the web colour. */
export class Palette {
  readonly hex: string[] = ["#141414", "#FFFFFF", "#141414"];
  private readonly names = new Map<string, number>([
    ["ink", 0],
    ["white", 1],
    ["web", 2],
  ]);

  constructor(colors: Record<string, string>) {
    for (const [name, hex] of Object.entries(colors)) this.set(name, hex);
  }

  set(name: string, hex: string): number {
    const at = this.names.get(name);
    if (at !== undefined) {
      this.hex[at] = hex;
      return at;
    }
    if (this.hex.length >= 16) throw new Error("palette full");
    this.names.set(name, this.hex.length);
    this.hex.push(hex);
    return this.hex.length - 1;
  }

  i(name: string): number {
    const at = this.names.get(name);
    if (at === undefined) throw new Error(`no colour ${name}`);
    return at;
  }
}

/** Where a head sits, for decals and head accessories. */
export interface HeadFrame {
  c: Vector3;
  rx: number;
  ry: number;
  rz: number;
  /** Face coordinates for any point near the head (decals project radially). */
  face: DetailFn;
}

export interface TorsoOpts {
  /** Radii [width, depth] at the hips, waist, chest and shoulders. */
  hip: [number, number];
  waist: [number, number];
  chest: [number, number];
  shoulder: [number, number];
  /** How far below the hip joints the torso's rounded bottom reaches. */
  seat?: number;
  /** Forward shifts: chest (pecs), belly, and the seat pushed back. */
  chestFwd?: number;
  bellyFwd?: number;
  /** Shoulder line: how far the top tapers in toward the neck. */
  neckRx?: number;
  /** Colour bands from the bottom up: each applies from `y` (bind height) upward. */
  colors: { y: number; color: string }[];
  overlay?: Overlay;
  detail?: DetailFn;
}

export interface LimbOpts {
  /** Radii along the limb: root ball, upper middle, joint, lower middle, end. */
  r: [number, number, number, number, number];
  /** Colour bands along the limb from the root: each applies from `s` (0–1 of its length) on. */
  colors: { s: number; color: string }[];
  detail?: DetailFn;
  /** Depth / width ratio of the cross-section. */
  flat?: number;
}

export interface HeadOpts {
  /** Head centre above the head bone. */
  y: number;
  rx: number;
  ry: number;
  rz: number;
  /** Width of the jaw relative to the cranium (0.5 pointed – 1 round). */
  jaw?: number;
  /** The face's forward push at the jaw. */
  chin?: number;
  /** Face centre height, in ry units from the centre. */
  faceY?: number;
  color: string;
  kind?: number;
  /** Colour above this height (ry units) — hair caps, a bun. */
  capColor?: string;
  capFrom?: number;
}

export class BodyKit {
  readonly b = new MeshBuilder();
  readonly s: (typeof SEGS)[Lod];
  /** Bind heights of the main joints. */
  readonly y: { hipJoint: number; pelvis: number; spine: number; chest: number; neck: number; head: number; shoulder: number };

  constructor(
    readonly rig: Rig,
    readonly pal: Palette,
    readonly lod: Lod,
  ) {
    this.s = SEGS[lod];
    const j = (n: string) => rig.joints.get(n)!.y;
    this.y = { hipJoint: j("thighL"), pelvis: j("hips"), spine: j("spine"), chest: j("chest"), neck: j("neck"), head: j("head"), shoulder: j("armL") };
  }

  bone(name: string): number {
    return this.rig.index.get(name)!;
  }

  joint(name: string): Vector3 {
    return this.rig.joints.get(name)!.clone();
  }

  c(name: string): number {
    return this.pal.i(name);
  }

  /** Torso weights by height: hips → spine → chest. */
  private torsoW(y: number): Weights {
    const { spine, chest } = this.y;
    const h = this.bone("hips");
    const sp = this.bone("spine");
    const ch = this.bone("chest");
    if (y < spine - 3) return [[h, 1]];
    if (y < spine + 2) return blendW(h, sp, y, spine - 3, spine + 2);
    if (y < chest - 3) return [[sp, 1]];
    if (y < chest + 2) return blendW(sp, ch, y, chest - 3, chest + 2);
    return [[ch, 1]];
  }

  torso(o: TorsoOpts): void {
    const y = this.y;
    const neckRx = o.neckRx ?? o.shoulder[0] * 0.42;
    const prof: { y: number; rx: number; rz: number; z: number }[] = [
      { y: y.hipJoint - 1, rx: o.hip[0] * 0.92, rz: o.hip[1] * 0.92, z: 0 },
      { y: y.pelvis + 1, rx: o.hip[0], rz: o.hip[1], z: 0 },
      { y: y.spine + 1, rx: o.waist[0], rz: o.waist[1], z: o.bellyFwd ?? 0 },
      { y: y.chest + 1, rx: o.chest[0], rz: o.chest[1], z: o.chestFwd ?? 0 },
      { y: y.shoulder - 0.5, rx: o.shoulder[0], rz: o.shoulder[1], z: (o.chestFwd ?? 0) * 0.5 },
      { y: y.shoulder + (y.neck - y.shoulder) * 0.75, rx: (o.shoulder[0] + neckRx) * 0.5, rz: o.shoulder[1] * 0.8, z: 0 },
      { y: y.neck, rx: neckRx, rz: neckRx * 0.9, z: 0 },
    ];
    const samples = this.cutProfile(prof, o.colors, (yy) => this.torsoW(yy));
    this.b.tube({
      from: new Vector3(0, 0, 0),
      axis: new Vector3(0, 1, 0),
      ref: new Vector3(1, 0, 0),
      samples,
      segs: this.s.torso,
      capStart: o.seat ?? 3,
      capEnd: 0,
      capRings: this.s.cap,
      overlay: o.overlay,
      detail: o.detail,
    });
  }

  /** A profile up an axis, with duplicate rings inserted at colour cuts so each band has a crisp edge. */
  private cutProfile(prof: { y: number; rx: number; rz: number; z: number }[], colors: { y: number; color: string }[], weights: (y: number) => Weights): Sample[] {
    const colorAt = (yy: number) => {
      let c = colors[0].color;
      for (const band of colors) if (yy >= band.y) c = band.color;
      return this.c(c);
    };
    const at = (yy: number) => {
      for (let i = 0; i < prof.length - 1; i++) {
        const a = prof[i];
        const b = prof[i + 1];
        if (yy >= a.y && yy <= b.y) {
          const t = (yy - a.y) / (b.y - a.y || 1);
          return { rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, z: a.z + (b.z - a.z) * t };
        }
      }
      const e = yy < prof[0].y ? prof[0] : prof[prof.length - 1];
      return { rx: e.rx, rz: e.rz, z: e.z };
    };
    const out: Sample[] = [];
    const ys = prof.map((p) => p.y);
    const cuts = colors.slice(1).map((c) => c.y).filter((cy) => cy > ys[0] && cy < ys[ys.length - 1]);
    const all = [...new Set([...ys, ...cuts])].sort((a, b) => a - b);
    for (const yy of all) {
      const p = at(yy);
      const isCut = cuts.includes(yy);
      if (isCut) {
        out.push({ s: yy, rx: p.rx, rz: p.rz, off: [0, 0, p.z], w: weights(yy), color: colorAt(yy - 1e-3) });
      }
      out.push({ s: yy, rx: p.rx, rz: p.rz, off: [0, 0, p.z], w: weights(yy), color: colorAt(yy) });
    }
    return out;
  }

  neck(r: number, color: string, top = 1.5): void {
    const y = this.y;
    const n = this.bone("neck");
    const h = this.bone("head");
    const len = y.head - y.neck;
    this.b.tube({
      from: new Vector3(0, y.neck - 2, 0),
      axis: new Vector3(0, 1, 0),
      ref: new Vector3(1, 0, 0),
      samples: [
        { s: 0, rx: r * 1.08, w: [[n, 1]], color: this.c(color) },
        { s: 2 + len * 0.5, rx: r, w: [[n, 1]], color: this.c(color) },
        { s: 2 + len + top, rx: r * 0.95, w: blendW(n, h, 1, 0, 2), color: this.c(color) },
      ],
      segs: Math.max(6, this.s.limb),
    });
  }

  /** A lathed head: an egg with a narrower jaw, carrying face coordinates for the decals. */
  head(o: HeadOpts): HeadFrame {
    const hb = this.bone("head");
    const c = this.joint("head").add(new Vector3(0, o.y, 0));
    const jaw = o.jaw ?? 0.82;
    const chin = o.chin ?? 0;
    const faceY = o.faceY ?? -0.05;
    const fAxis = new Vector3(0, faceY, 1).normalize();
    const ex = new Vector3(1, 0, 0);
    const ey = fAxis.clone().cross(ex).normalize();
    const q = new Vector3();
    const t = new Vector3();
    const face: DetailFn = (p) => {
      q.copy(p).sub(c);
      q.set(q.x / o.rx, q.y / o.ry, q.z / o.rz).normalize();
      const cosA = Math.min(1, Math.max(-1, q.dot(fAxis)));
      const dist = Math.acos(cosA) * o.rx;
      t.copy(q).addScaledVector(fAxis, -cosA);
      const tl = t.length();
      if (tl < 1e-6) return [0, 0, 0, o.kind ?? DETAIL.face];
      return [(t.dot(ex) / tl) * dist, (t.dot(ey) / tl) * dist, 0, o.kind ?? DETAIL.face];
    };
    const rings = this.s.rings;
    const samples: Sample[] = [];
    const capC = o.capColor ? this.c(o.capColor) : -1;
    for (let k = 0; k <= rings; k++) {
      const phi = -Math.PI / 2 + (k / rings) * Math.PI;
      const sy = Math.sin(phi);
      const width = Math.cos(phi) * (sy < 0 ? jaw + (1 - jaw) * (1 - sy * sy) ** 1.5 : 1);
      const z = sy < 0 ? chin * -sy : 0;
      const color = capC >= 0 && sy >= (o.capFrom ?? 2) ? capC : this.c(o.color);
      const s: Sample = { s: sy * o.ry, rx: Math.max(0, width * o.rx), rz: Math.max(0, width * o.rz), off: [0, 0, z], w: [[hb, 1]], color };
      if (capC >= 0 && k > 0 && sy >= (o.capFrom ?? 2) && samples[samples.length - 1].color !== capC) samples.push({ ...s, color: this.c(o.color) });
      samples.push(s);
    }
    this.b.tube({ from: c, axis: new Vector3(0, 1, 0), ref: new Vector3(1, 0, 0), samples, segs: this.s.head, detail: face });
    return { c, rx: o.rx, ry: o.ry, rz: o.rz, face };
  }

  /** Bind-space point from head-normalised coordinates. */
  onHead(h: HeadFrame, x: number, y: number, z: number): Vector3 {
    return new Vector3(h.c.x + x * h.rx, h.c.y + y * h.ry, h.c.z + z * h.rz);
  }

  private limb(rootName: string, midName: string, endName: string, o: LimbOpts, ref: Vector3, capEnd: number) {
    const root = this.joint(rootName);
    const mid = this.joint(midName);
    const end = this.joint(endName);
    const axis = end.clone().sub(root).normalize();
    const l1 = mid.distanceTo(root);
    const l2 = end.distanceTo(mid);
    const L = l1 + l2;
    const a = this.bone(rootName);
    const m = this.bone(midName);
    const [r0, r1, r2, r3, r4] = o.r;
    const fz = o.flat ?? 1;
    const blend = Math.max(1.5, r2 * 0.75);
    const prof = [
      { y: 0, rx: r0, rz: r0 * fz, z: 0 },
      { y: l1 * 0.45, rx: r1, rz: r1 * fz, z: 0 },
      { y: l1, rx: r2, rz: r2 * fz, z: 0 },
      { y: l1 + l2 * 0.35, rx: r3, rz: r3 * fz, z: 0 },
      { y: L, rx: r4, rz: r4 * fz, z: 0 },
    ];
    const colors = o.colors.map((c) => ({ y: c.s * L, color: c.color }));
    const samples = this.cutProfile(prof, colors, (s) => blendW(a, m, s, l1 - blend, l1 + blend)).map((sm) => ({ ...sm, off: undefined }));
    this.b.tube({ from: root, axis, ref, samples, segs: this.s.limb, capStart: r0, capEnd, capRings: this.s.cap, detail: o.detail });
    return { root, axis, L };
  }

  arm(side: Side, o: LimbOpts): void {
    const k = side === 0 ? "L" : "R";
    this.limb(`arm${k}`, `fore${k}`, `hand${k}`, o, new Vector3(0, 0, 1), o.r[4] * 0.6);
  }

  leg(side: Side, o: LimbOpts): void {
    const k = side === 0 ? "L" : "R";
    this.limb(`thigh${k}`, `shin${k}`, `foot${k}`, o, new Vector3(1, 0, 0), o.r[4] * 0.8);
  }

  /** A mitten hand (palm and thumb) on the hand bone, along the bind arm. */
  hand(side: Side, size: number, color: string): void {
    const k = side === 0 ? "L" : "R";
    const wrist = this.joint(`hand${k}`);
    const dir = wrist.clone().sub(this.joint(`fore${k}`)).normalize();
    const fwd = new Vector3(0, 0, 1);
    const thick = dir.clone().cross(fwd).normalize();
    const hb = this.bone(`hand${k}`);
    const center = wrist.clone().addScaledVector(dir, size * 0.42);
    const basis = (u: Vector3, v: Vector3, w: Vector3, su: number, sv: number, sw: number, at: Vector3) =>
      new Matrix4().makeBasis(u.clone().multiplyScalar(su), v.clone().multiplyScalar(sv), w.clone().multiplyScalar(sw)).setPosition(at);
    const sph = new SphereGeometry(1, this.s.prim, Math.max(5, this.s.prim - 3));
    this.b.prim(sph, { matrix: basis(dir, fwd, thick, size * 0.55, size * 0.42, size * 0.34, center), w: [[hb, 1]], color: this.c(color) });
    const thumbAt = wrist.clone().addScaledVector(dir, size * 0.3).addScaledVector(fwd, size * 0.36);
    this.b.prim(sph, { matrix: basis(dir, fwd, thick, size * 0.3, size * 0.2, size * 0.2, thumbAt), w: [[hb, 1]], color: this.c(color) });
    sph.dispose();
  }

  /** A boot on the foot bone: an ellipsoid with a flat sole, toe forward. */
  foot(side: Side, len: number, width: number, height: number, color: string, sole?: string): void {
    const k = side === 0 ? "L" : "R";
    const ankle = this.joint(`foot${k}`);
    const fb = this.bone(`foot${k}`);
    const sph = new SphereGeometry(1, this.s.prim, Math.max(5, this.s.prim - 2), 0, Math.PI * 2, 0, Math.PI * 0.62);
    this.b.prim(sph, { matrix: placeAt(ankle.x, ankle.y - this.rig.spec.ankle, ankle.z + len * 0.28, 0, 0, 0, width, height * 1.2, len * 0.6), w: [[fb, 1]], color: this.c(color) });
    sph.dispose();
    if (sole) {
      const s = new CylinderGeometry(1, 1, 1, this.s.prim, 1);
      this.b.prim(s, { matrix: placeAt(ankle.x, ankle.y - this.rig.spec.ankle + height * 0.08, ankle.z + len * 0.28, 0, 0, 0, width * 0.98, height * 0.16, len * 0.58), w: [[fb, 1]], color: this.c(sole), hullMode: "radial" });
      s.dispose();
    }
  }

  /** Any rigid shape weighted to one bone. */
  add(geo: BufferGeometry, bone: string, matrix: Matrix4, color: string, opts: { hull?: number; flags?: number; detail?: DetailFn; radial?: boolean; overlay?: Overlay } = {}): void {
    this.b.prim(geo, { matrix, w: [[this.bone(bone), 1]], color: this.c(color), hull: opts.hull, flags: opts.flags, detail: opts.detail, overlay: opts.overlay, hullMode: opts.radial ? "radial" : "normal" });
  }

  sphere(bone: string, at: Vector3, r: [number, number, number], color: string, opts: { rot?: [number, number, number]; hull?: number; flags?: number; detail?: DetailFn } = {}): void {
    const g = new SphereGeometry(1, this.s.prim, Math.max(5, this.s.prim - 3));
    const [rx, ry, rz] = opts.rot ?? [0, 0, 0];
    this.add(g, bone, placeAt(at.x, at.y, at.z, rx, ry, rz, r[0], r[1], r[2]), color, opts);
    g.dispose();
  }

  box(bone: string, at: Vector3, size: [number, number, number], color: string, opts: { rot?: [number, number, number]; hull?: number; flags?: number } = {}): void {
    const g = new BoxGeometry(1, 1, 1);
    const [rx, ry, rz] = opts.rot ?? [0, 0, 0];
    this.add(g, bone, placeAt(at.x, at.y, at.z, rx, ry, rz, size[0], size[1], size[2]), color, { ...opts, radial: true });
    g.dispose();
  }

  cylinder(bone: string, at: Vector3, r: number, h: number, color: string, opts: { rot?: [number, number, number]; hull?: number; flags?: number; rTop?: number; segs?: number } = {}): void {
    const g = new CylinderGeometry(opts.rTop ?? 1, 1, 1, opts.segs ?? this.s.prim, 1);
    const [rx, ry, rz] = opts.rot ?? [0, 0, 0];
    this.add(g, bone, placeAt(at.x, at.y, at.z, rx, ry, rz, r, h, r), color, { ...opts, radial: true });
    g.dispose();
  }

  cone(bone: string, at: Vector3, r: number, h: number, color: string, opts: { rot?: [number, number, number]; hull?: number; depth?: number } = {}): void {
    const g = new ConeGeometry(1, 1, Math.max(5, this.s.prim - 2), 1);
    const [rx, ry, rz] = opts.rot ?? [0, 0, 0];
    this.add(g, bone, placeAt(at.x, at.y, at.z, rx, ry, rz, r, h, r * (opts.depth ?? 1)), color, { ...opts, radial: true });
    g.dispose();
  }

  torus(bone: string, at: Vector3, r: number, tube: number, color: string, opts: { rot?: [number, number, number]; hull?: number; scale?: [number, number, number] } = {}): void {
    const g = new TorusGeometry(1, tube / r, Math.max(4, this.s.prim - 6), this.s.prim + 4);
    const [rx, ry, rz] = opts.rot ?? [0, 0, 0];
    const [sx, sy, sz] = opts.scale ?? [1, 1, 1];
    this.add(g, bone, placeAt(at.x, at.y, at.z, rx, ry, rz, r * sx, r * sy, r * sz), color, opts);
    g.dispose();
  }

  /** Both sides at once: `fn(side, sign)` with sign +1 for the left (+x). */
  both(fn: (side: Side, sign: number) => void): void {
    fn(0, SIDE_SIGN[0]);
    fn(1, SIDE_SIGN[1]);
  }
}

/** Torso web for the hero's suit: a radial web centred on the chest, front and back. */
export function chestWeb(cy: number): DetailFn {
  return (p) => [p.x, p.y - cy, 0, DETAIL.web];
}

/** Limb web: lines down the limb and rings around it. */
export const limbWeb: DetailFn = (_p, _n, radial, s, theta) => {
  const r = radial.length();
  return [Math.cos(theta) * r, Math.sin(theta) * r, s, DETAIL.limbWeb];
};
