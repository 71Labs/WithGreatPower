/**
 * The allies in 3D, from their sticker busts: Aunt Mainnet (grey bun, round glasses,
 * pearls, a lilac cardigan and skirt), Uncle Gen (bald on top, grey tufts, glasses, a big
 * grin, cardigan over a blue shirt), Mary JPEG (red pixel hair, freckles, teal top) and
 * J. Jonah Bearson (a bear in a suit and tie, flat-top, scowl, cigar).
 */
import { Vector3 } from "three";

import { DETAIL } from "../builder";
import type { CastDef, DecalSpec } from "../model";
import { HERO_BODY, scaleBody } from "../rig";

/* ------------------------------------------------------------------ Aunt Mainnet */

const AUNT_DECALS: DecalSpec[] = [
  { shape: "ring", x: -0.38, y: 0.06, rx: 0.26, ry: 0.25, fill: "white", ink: 2, mirror: true },
  { shape: "ellipse", x: -0.38, y: 0.04, rx: 0.07, ry: 0.09, fill: "ink", mirror: true },
  { shape: "ellipse", x: -0.36, y: 0.08, rx: 0.025, ry: 0.025, fill: "white", mirror: true },
  { shape: "stroke", x: 0, y: 0.08, rx: 0.1, ry: 0.025, fill: "ink" },
  { shape: "stroke", x: -0.38, y: 0.36, rx: 0.17, ry: 0.03, fill: "brow", mirror: true },
  { shape: "lower", x: 0, y: -0.5, rx: 0.22, ry: 0.1, fill: "mouth", ink: 1.6 },
  { shape: "ellipse", x: -0.62, y: -0.3, rx: 0.14, ry: 0.08, fill: "blush", mirror: true },
];

export const AUNT: CastDef = {
  key: "aunt-mainnet",
  name: "Aunt Mainnet",
  body: scaleBody(HERO_BODY, 0.9, { shoulderX: 10, hipWidth: 5.4 }),
  height: 80,
  motion: "ally",
  colors: () => ({ skin: "#B9805A", hair: "#DADAD6", top: "#C9B6EF", skirt: "#9F86D6", shoe: "#4A3A5A", pearl: "#FFFFFF", brow: "#6E6E6A", mouth: "#7E2A2E", blush: "#DC7880" }),
  decals: AUNT_DECALS,
  build(k) {
    const y = k.y;
    k.torso({ hip: [10, 8], waist: [9.4, 8], chest: [10.4, 8.2], shoulder: [10, 7], bellyFwd: 0.8, chestFwd: 1, colors: [{ y: 0, color: "skirt" }, { y: y.spine - 1, color: "top" }] });
    // A skirt flaring to the knee.
    k.b.tube({
      from: new Vector3(0, y.spine - 1, 0),
      axis: new Vector3(0, -1, 0),
      ref: new Vector3(1, 0, 0),
      samples: [
        { s: 0, rx: 9.4, rz: 8, w: [[k.bone("hips"), 1]], color: k.c("skirt") },
        { s: 12, rx: 11.4, rz: 9.6, w: [[k.bone("hips"), 1]], color: k.c("skirt") },
        { s: 20, rx: 12.6, rz: 10.6, w: [[k.bone("hips"), 1]], color: k.c("skirt") },
      ],
      segs: k.s.torso,
    });
    k.neck(3.2, "skin");
    const head = k.head({ y: 7, rx: 7.6, ry: 8.4, rz: 8, jaw: 0.8, faceY: -0.05, color: "skin", kind: DETAIL.face, capColor: "hair", capFrom: 0.42 });
    k.sphere("head", k.onHead(head, 0, 0.3, -0.12), [head.rx * 1.06, head.ry * 0.82, head.rz * 1.02], "hair");
    k.sphere("head", k.onHead(head, 0, 1.02, -0.42), [4.4, 4, 4.4], "hair");
    if (k.lod !== "min") {
      for (let i = 0; i < 7; i++) {
        const a = -0.9 + (i / 6) * 1.8;
        k.sphere("chest", new Vector3(Math.sin(a) * 5.2, y.neck - 2.2 - Math.cos(a) * 2.2, 5.6 + Math.cos(a) * 1.2), [1.2, 1.2, 1.2], "pearl", { hull: 0.6 });
      }
    }
    k.both((side) => {
      k.arm(side, { r: [3.8, 3.2, 2.6, 2.8, 2.1], colors: [{ s: 0, color: "top" }, { s: 0.82, color: "skin" }] });
      k.hand(side, 5.4, "skin");
      k.leg(side, { r: [4.6, 4.2, 3.2, 3.4, 2.4], colors: [{ s: 0, color: "skin" }] });
      k.foot(side, 8.4, 2.8, 2.8, "shoe");
    });
    return head;
  },
};

/* ------------------------------------------------------------------ Uncle Gen */

const GEN_DECALS: DecalSpec[] = [
  { shape: "ring", x: -0.36, y: 0.08, rx: 0.27, ry: 0.19, fill: "white", ink: 2, mirror: true },
  { shape: "lower", x: -0.36, y: 0.04, rx: 0.12, ry: 0.07, rot: Math.PI, fill: "ink", mirror: true },
  { shape: "stroke", x: 0, y: 0.1, rx: 0.1, ry: 0.025, fill: "ink" },
  { shape: "stroke", x: -0.38, y: 0.4, rx: 0.2, ry: 0.06, rot: 0.15, fill: "brow", mirror: true },
  { shape: "lower", x: 0, y: -0.5, rx: 0.36, ry: 0.22, fill: "mouth", ink: 2 },
  { shape: "ellipse", x: 0, y: -0.36, rx: 0.4, ry: 0.1, fill: "white", clip: true },
  { shape: "ellipse", x: -0.66, y: -0.28, rx: 0.14, ry: 0.08, fill: "blush", mirror: true },
];

export const UNCLE_GEN: CastDef = {
  key: "uncle-gen",
  name: "Uncle Gen",
  body: scaleBody(HERO_BODY, 0.96, { shoulderX: 11, hipWidth: 5.6 }),
  height: 85,
  motion: "ally",
  colors: () => ({ skin: "#F3C6A2", hair: "#CACAC6", cardigan: "#8C5A3A", band: "#764A2D", shirt: "#A9CFF2", pants: "#5A4F46", shoe: "#3A2A20", brow: "#8F8F8B", mouth: "#8B3434", blush: "#F59AAA" }),
  decals: GEN_DECALS,
  build(k) {
    const y = k.y;
    const front = {
      c1: k.c("shirt"),
      c2: k.c("band"),
      mask: (p: Vector3): [number, number] => {
        const v = Math.max(0, (p.y - (y.spine - 4)) * 0.32);
        const fr = p.z > 2;
        const ax = Math.abs(p.x);
        return [fr && ax < Math.min(v, 5) ? 1 : 0, fr && ax >= Math.min(v, 5) && ax < Math.min(v, 5) + 1.6 && p.y > y.spine - 4 ? 1 : 0];
      },
    };
    k.torso({ hip: [9.6, 7.8], waist: [9.8, 8.8], chest: [10.8, 8.2], shoulder: [10.8, 7], bellyFwd: 2.2, chestFwd: 0.6, colors: [{ y: 0, color: "pants" }, { y: y.pelvis, color: "cardigan" }], overlay: front });
    k.neck(3.4, "skin");
    const head = k.head({ y: 7.2, rx: 7.9, ry: 9, rz: 8.3, jaw: 0.85, chin: 0.3, faceY: -0.04, color: "skin", kind: DETAIL.face });
    k.both((side, sign) => {
      k.sphere("head", k.onHead(head, sign * 0.9, 0.02, -0.25), [2.4, 4, 3.6], "hair");
      k.sphere("head", k.onHead(head, sign * 1.0, -0.12, 0.05), [1.6, 2.6, 1.8], "skin");
      k.arm(side, { r: [4, 3.4, 2.8, 3, 2.3], colors: [{ s: 0, color: "cardigan" }, { s: 0.85, color: "skin" }] });
      k.hand(side, 5.8, "skin");
      k.leg(side, { r: [5, 4.6, 3.5, 3.7, 2.7], colors: [{ s: 0, color: "pants" }] });
      k.foot(side, 9.6, 3.3, 3, "shoe");
    });
    k.sphere("head", k.onHead(head, 0, -0.14, 1.0), [2.2, 2.4, 2.4], "skin");
    return head;
  },
};

/* ------------------------------------------------------------------ Mary JPEG */

const MARY_DECALS: DecalSpec[] = [
  { shape: "ellipse", x: -0.3, y: 0.02, rx: 0.12, ry: 0.16, fill: "ink", mirror: true },
  { shape: "ellipse", x: -0.27, y: 0.08, rx: 0.045, ry: 0.045, fill: "white", mirror: true },
  { shape: "stroke", x: -0.3, y: 0.34, rx: 0.16, ry: 0.035, rot: -0.15, fill: "brow", mirror: true },
  { shape: "lower", x: 0.04, y: -0.44, rx: 0.3, ry: 0.24, fill: "mouth", ink: 2 },
  { shape: "ellipse", x: 0.04, y: -0.38, rx: 0.4, ry: 0.1, fill: "white", clip: true },
  { shape: "ellipse", x: 0.08, y: -0.7, rx: 0.16, ry: 0.12, fill: "tongue", clip: true },
  { shape: "ellipse", x: -0.56, y: -0.3, rx: 0.15, ry: 0.09, fill: "blush", mirror: true },
  { shape: "ellipse", x: -0.5, y: -0.16, rx: 0.025, ry: 0.025, fill: "freckle", mirror: true },
  { shape: "ellipse", x: -0.4, y: -0.22, rx: 0.025, ry: 0.025, fill: "freckle", mirror: true },
];

export const MARY: CastDef = {
  key: "mary-jpeg",
  name: "Mary JPEG",
  body: scaleBody(HERO_BODY, 0.95, { shoulderX: 10, hipWidth: 5 }),
  height: 86,
  motion: "ally",
  colors: () => ({ skin: "#F8D5BC", hair: "#E8492F", hairDark: "#C23722", hairLight: "#F7774F", top: "#2DB3A5", jeans: "#3B5BA8", shoe: "#FFFFFF", brow: "#B33A22", mouth: "#7E2A2E", tongue: "#EE7D86", blush: "#F59AAA", freckle: "#C2703F" }),
  decals: MARY_DECALS,
  build(k) {
    const y = k.y;
    k.torso({ hip: [8.4, 6.2], waist: [7, 5.4], chest: [9.4, 6.6], shoulder: [9.8, 6], chestFwd: 0.8, colors: [{ y: 0, color: "jeans" }, { y: y.spine - 2, color: "top" }] });
    k.neck(3, "skin");
    const head = k.head({ y: 7, rx: 7.2, ry: 8.6, rz: 7.8, jaw: 0.75, chin: 0.4, faceY: -0.04, color: "skin", kind: DETAIL.face });
    // Pixel hair: cubes on a lattice in a shell around the head, long down the back.
    const step = k.lod === "hi" ? 3.4 : k.lod === "lo" ? 4.2 : 5.2;
    const c = head.c;
    const names = ["hair", "hairDark", "hairLight", "hair"];
    for (let gx = -13; gx <= 13; gx += step) {
      for (let gy = -22; gy <= 13; gy += step) {
        for (let gz = -12; gz <= 10; gz += step) {
          const nx = gx / (head.rx * 1.12);
          const ny = gy / (head.ry * 1.08);
          const nz = gz / (head.rz * 1.1);
          const r = Math.hypot(nx, Math.max(0, ny), nz);
          const shell = r > 0.86 && r < 1.12;
          const face = gz > 1.5 && gy < head.ry * 0.5 && Math.abs(gx) < head.rx * 0.82;
          const long = ny < 0 && gz < 1 && Math.hypot(nx, nz) > 0.78 && Math.hypot(nx, nz) < 1.12 && gy > -22;
          if ((!shell && !long) || face) continue;
          const h = Math.abs(Math.sin(gx * 12.9898 + gy * 78.233 + gz * 37.719) * 43758.5453) % 1;
          k.box("head", new Vector3(c.x + gx, c.y + gy, c.z + gz), [step, step, step], names[Math.floor(h * 4)], { hull: 0.7 });
        }
      }
    }
    k.both((side) => {
      k.arm(side, { r: [3.6, 3, 2.4, 2.7, 2], colors: [{ s: 0, color: "top" }, { s: 0.35, color: "skin" }] });
      k.hand(side, 5.4, "skin");
      k.leg(side, { r: [4.8, 4.4, 3.2, 3.4, 2.4], colors: [{ s: 0, color: "jeans" }] });
      k.foot(side, 9, 3, 3, "shoe", "ink");
    });
    return head;
  },
};

/* ------------------------------------------------------------------ J. Jonah Bearson */

const BEAR_DECALS: DecalSpec[] = [
  { shape: "lower", x: -0.3, y: 0.06, rx: 0.17, ry: 0.13, rot: -0.3, fill: "ink", mirror: true },
  { shape: "stroke", x: -0.34, y: 0.3, rx: 0.26, ry: 0.07, rot: -0.36, fill: "ink", mirror: true },
  { shape: "ellipse", x: 0, y: -0.2, rx: 0.2, ry: 0.12, fill: "ink" },
  { shape: "ellipse", x: -0.06, y: -0.15, rx: 0.06, ry: 0.03, fill: "white", clip: true },
  { shape: "upper", x: 0, y: -0.42, rx: 0.48, ry: 0.13, fill: "ink" },
  { shape: "stroke", x: 0, y: -0.62, rx: 0.16, ry: 0.025, fill: "ink" },
];

export const BEARSON: CastDef = {
  key: "bearson",
  name: "J. Jonah Bearson",
  body: scaleBody(HERO_BODY, 1.02, { shoulderX: 13.4, hipWidth: 6 }),
  height: 92,
  motion: "ally",
  colors: () => ({ fur: "#9C6B43", muzzle: "#DDB98C", flat: "#BDBDB8", suit: "#3B4150", shirt: "#FFFFFF", tie: "#C9453B", cigar: "#7B4A2B", band: "#E3B341", ember: "#F47A3B", shoe: "#22252C" }),
  decals: BEAR_DECALS,
  build(k) {
    const y = k.y;
    const front = {
      c1: k.c("shirt"),
      c2: k.c("tie"),
      mask: (p: Vector3): [number, number] => {
        const fr = p.z > 2;
        const v = Math.max(0, (p.y - (y.chest - 8)) * 0.5);
        const tie = Math.abs(p.x) < 1.4 + Math.max(0, (y.chest - p.y) * 0.1) && p.y > y.chest - 10 && p.y < y.neck - 1;
        return [fr && Math.abs(p.x) < Math.min(v, 5.2) ? 1 : 0, fr && tie ? 1 : 0];
      },
    };
    k.torso({ hip: [10.4, 8.6], waist: [10.8, 9.6], chest: [12.6, 9], shoulder: [13, 7.8], bellyFwd: 2, chestFwd: 0.8, colors: [{ y: 0, color: "suit" }], overlay: front });
    k.neck(4.6, "fur");
    const head = k.head({ y: 7.6, rx: 9.6, ry: 9.2, rz: 9.2, jaw: 0.95, faceY: 0, color: "fur", kind: DETAIL.face });
    k.both((side, sign) => {
      k.sphere("head", k.onHead(head, sign * 0.78, 0.8, -0.1), [3.4, 3.4, 2.4], "fur");
      k.sphere("head", k.onHead(head, sign * 0.8, 0.82, 0.12), [1.8, 1.8, 0.8], "muzzle", { hull: 0 });
      k.arm(side, { r: [5, 4.4, 3.4, 3.8, 2.9], colors: [{ s: 0, color: "suit" }, { s: 0.9, color: "shirt" }] });
      k.hand(side, 7.2, "fur");
      k.leg(side, { r: [6, 5.6, 4.2, 4.4, 3.2], colors: [{ s: 0, color: "suit" }] });
      k.foot(side, 11, 3.8, 3.4, "shoe");
    });
    // Flat-top, muzzle (the nose decal lands on it), cigar with its band and ember.
    k.box("head", k.onHead(head, 0, 0.94, 0.02), [head.rx * 1.15, head.ry * 0.4, head.rz * 1.1], "flat");
    k.sphere("head", k.onHead(head, 0, -0.34, 0.78), [head.rx * 0.5, head.ry * 0.36, head.rz * 0.42], "muzzle", { detail: head.face });
    const dir = new Vector3(0.45, -0.18, 1).normalize();
    const base = k.onHead(head, 0.22, -0.5, 0.92);
    const at = (t: number) => base.clone().addScaledVector(dir, t);
    const rot: [number, number, number] = [Math.PI / 2 + 0.18, 0, -0.45];
    k.cylinder("head", at(4.5), 1.15, 9, "cigar", { rot });
    k.cylinder("head", at(2.2), 1.3, 1.4, "band", { rot, hull: 0.6 });
    k.cylinder("head", at(9.2), 1.12, 1.2, "ember", { rot, hull: 0.6 });
    return head;
  },
};
