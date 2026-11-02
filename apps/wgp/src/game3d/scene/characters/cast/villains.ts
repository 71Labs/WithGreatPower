/**
 * The four villains in 3D, traced from their 2D sticker busts (components/cast/avatars.tsx):
 * Gas Goblin with his hood, long ears, grin and bat-wing glider; Sandwich Man, a suit with a
 * sandwich for a head; Doc Octochain, stout in his lab coat and goggles, in a steel harness
 * whose four booms end at the sim's arm shoulders; The Sybil, a floating goo body on a tail with a mouthful of fangs, and the
 * grey copy he hides among.
 */
import { ExtrudeGeometry, Shape, Vector3 } from "three";

import { DETAIL, placeAt } from "../builder";
import type { CastDef, DecalSpec } from "../model";
import { HERO_BODY, scaleBody, type BodySpec } from "../rig";
import type { BodyKit } from "./kit";

/** Bind heights of a body's joints. */
export function jointHeights(b: BodySpec) {
  const hipJoint = b.ankle + b.shin + b.thigh;
  const pelvis = hipJoint + b.pelvis;
  const spine = pelvis + b.waist;
  const chest = spine + b.chest;
  return { hipJoint, pelvis, spine, chest, neck: chest + b.neckBase, shoulder: chest + b.shoulderY };
}

/* ------------------------------------------------------------------ Gas Goblin */

const GOBLIN_BODY = scaleBody(HERO_BODY, 1.05, { shoulderX: 11.6, hipWidth: 5.1 });

const GOBLIN_DECALS: DecalSpec[] = [
  { shape: "ellipse", x: -0.44, y: 0.16, rx: 0.3, ry: 0.13, rot: -0.22, fill: "eye", ink: 2.4, mirror: true },
  { shape: "ellipse", x: -0.44, y: 0.16, rx: 0.05, ry: 0.11, fill: "ink", clip: true, mirror: true },
  { shape: "stroke", x: -0.47, y: 0.4, rx: 0.32, ry: 0.065, rot: -0.36, fill: "ink", mirror: true },
  { shape: "lower", x: 0, y: -0.24, rx: 0.8, ry: 0.55, fill: "white", ink: 2.4 },
  { shape: "stroke", x: -0.22, y: -0.5, rx: 0.4, ry: 0.022, rot: Math.PI / 2, fill: "ink", clip: true, mirror: true },
  { shape: "stroke", x: -0.44, y: -0.45, rx: 0.4, ry: 0.022, rot: Math.PI / 2, fill: "ink", clip: true, mirror: true },
  { shape: "stroke", x: 0, y: -0.5, rx: 0.4, ry: 0.022, rot: Math.PI / 2, fill: "ink", clip: true },
  { shape: "stroke", x: 0, y: -0.42, rx: 0.7, ry: 0.02, fill: "ink", clip: true },
];

function glider(k: BodyKit): void {
  // A bat-wing deck, flat in xz with its top at the soles; the shape's y is −z.
  const s = new Shape();
  const half: [number, number][] = [
    [0, 17],
    [7, 12],
    [27, 3],
    [24, -2],
    [19, -7],
    [14, -3],
    [8, -9],
    [0, -6],
  ];
  const pts = [...half, ...half.slice(1, -1).reverse().map(([x, z]) => [-x, z] as [number, number])];
  pts.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 3, bevelEnabled: false, curveSegments: 1 });
  k.add(geo, "glider", placeAt(0, -3.4, 0, -Math.PI / 2), "glider", { radial: true });
  geo.dispose();
  k.sphere("glider", new Vector3(0, -1.6, -5), [4, 2.6, 5], "skin");
  k.box("glider", new Vector3(0, -2, 13), [5, 2, 4], "steel");
}

export const GOBLIN: CastDef = {
  key: "gas-goblin",
  name: "Gas Goblin",
  body: GOBLIN_BODY,
  extras: [{ name: "glider", parent: "root", at: [0, 0, 0] }],
  height: 100,
  motion: "glider",
  colors: () => ({ skin: "#8DC63F", suit: "#7C4DCC", dark: "#5B35A1", eye: "#F7D23E", glider: "#F7D23E", steel: "#B9BEC6" }),
  decals: GOBLIN_DECALS,
  build(k) {
    const y = k.y;
    k.torso({ hip: [8.6, 6.2], waist: [7.2, 5.6], chest: [10.2, 7], shoulder: [10.6, 6.2], chestFwd: 0.6, colors: [{ y: 0, color: "dark" }, { y: y.spine - 1, color: "suit" }] });
    k.neck(3.2, "skin");
    const head = k.head({ y: 7.6, rx: 7.6, ry: 9.2, rz: 8.4, jaw: 0.56, chin: 1.4, faceY: 0, color: "skin", kind: DETAIL.face });
    // The hood: a purple shell over the back of the head, a tip curling back.
    k.sphere("head", k.onHead(head, 0, 0.16, -0.22), [head.rx * 1.2, head.ry * 1.1, head.rz * 1.06], "suit");
    k.cone("head", k.onHead(head, 0, 1.12, -0.55), 4.2, 13, "suit", { rot: [-0.95, 0, 0] });
    k.both((side, sign) => {
      k.cone("head", k.onHead(head, sign * 1.12, 0.05, -0.05), 2.6, 13, "skin", { rot: [0, 0, -sign * (Math.PI / 2 - 0.3)], depth: 0.55 });
      k.arm(side, { r: [4, 3.3, 2.6, 3.1, 2.3], colors: [{ s: 0, color: "suit" }, { s: 0.88, color: "dark" }] });
      k.hand(side, 6.6, "skin");
      k.leg(side, { r: [5.2, 4.7, 3.4, 3.8, 2.6], colors: [{ s: 0, color: "suit" }, { s: 0.8, color: "dark" }] });
      k.foot(side, 12, 3.3, 3.4, "dark");
    });
    glider(k);
    return head;
  },
};

/* ------------------------------------------------------------------ Sandwich Man */

const SANDWICH_BODY = scaleBody(HERO_BODY, 1.03, { shoulderX: 12.6, hipWidth: 5.8, neck: 2 });

const SANDWICH_DECALS: DecalSpec[] = [
  { shape: "lower", x: -0.33, y: -0.36, rx: 0.2, ry: 0.22, rot: -0.38, fill: "white", ink: 2.2, mirror: true },
  { shape: "ellipse", x: -0.31, y: -0.42, rx: 0.075, ry: 0.075, fill: "ink", clip: true, mirror: true },
  { shape: "stroke", x: -0.34, y: -0.13, rx: 0.25, ry: 0.06, rot: -0.36, fill: "ink", mirror: true },
  { shape: "upper", x: 0, y: -0.78, rx: 0.24, ry: 0.11, fill: "ink" },
];

export const SANDWICH: CastDef = {
  key: "sandwich-man",
  name: "Sandwich Man",
  body: SANDWICH_BODY,
  height: 104,
  motion: "runner",
  colors: () => ({ suit: "#2A2A2D", lapel: "#3E3E43", shirt: "#FFFFFF", tie: "#C9302C", bun: "#EDB15E", seed: "#FFF4D6", lettuce: "#78C043", tomato: "#E5483A", cheese: "#F8C93A", bread: "#E8B66C" }),
  decals: SANDWICH_DECALS,
  build(k) {
    const y = k.y;
    // Shirt front and tie: crisp V and stripe in the suit, front only.
    const shirt = {
      c1: k.c("shirt"),
      c2: k.c("tie"),
      mask: (p: Vector3): [number, number] => {
        const front = p.z > 1.5;
        const v = Math.max(0, (p.y - (y.chest - 7)) * 0.55);
        const tie = Math.abs(p.x) < 1.3 + Math.max(0, (y.chest - p.y) * 0.08) && p.y > y.chest - 9 && p.y < y.neck - 1;
        return [front && Math.abs(p.x) < Math.min(v, 5) ? 1 : 0, front && tie ? 1 : 0];
      },
    };
    k.torso({ hip: [9.4, 7], waist: [8.8, 7], chest: [11.6, 7.8], shoulder: [12.2, 7], chestFwd: 0.6, colors: [{ y: 0, color: "suit" }], overlay: shirt });
    k.neck(3.4, "shirt", 0.5);
    // The sandwich: top bun (the face), lettuce, tomato, a cheese slice, a slab of bread.
    const head = k.head({ y: 13.5, rx: 12.4, ry: 8.4, rz: 11.4, jaw: 1, faceY: -0.25, color: "bun" });
    const c = head.c;
    k.cylinder("head", new Vector3(c.x, c.y - 1.6, c.z), 12.8, 2.4, "lettuce", { segs: 14 });
    k.cylinder("head", new Vector3(c.x, c.y - 4.2, c.z), 12.1, 3, "tomato");
    k.box("head", new Vector3(c.x, c.y - 6.4, c.z + 0.5), [21, 1.7, 21], "cheese", { rot: [0, Math.PI / 4, 0] });
    k.box("head", new Vector3(c.x, c.y - 10, c.z), [23, 5.6, 20], "bread");
    if (k.lod !== "min") {
      const seeds: [number, number, number][] = [
        [-0.42, 0.62, 0.55],
        [0.05, 0.86, 0.45],
        [0.45, 0.68, 0.5],
        [-0.15, 0.5, 0.8],
        [0.3, 0.42, 0.82],
        [-0.6, 0.3, 0.7],
        [0.68, 0.25, 0.65],
      ];
      for (const [sx, sy, sz] of seeds) k.sphere("head", k.onHead(head, sx, sy, sz), [1.4, 0.7, 0.9], "seed", { rot: [0, sx, 0.5], hull: 0.5 });
    }
    k.both((side) => {
      k.arm(side, { r: [4.4, 3.8, 3, 3.4, 2.6], colors: [{ s: 0, color: "suit" }, { s: 0.9, color: "shirt" }] });
      k.hand(side, 6.8, "bread");
      k.leg(side, { r: [5.6, 5.2, 4, 4.2, 3], colors: [{ s: 0, color: "suit" }] });
      k.foot(side, 11, 3.6, 3.4, "ink");
    });
    return head;
  },
};

/* ------------------------------------------------------------------ Doc Octochain */

const DOC_BODY = scaleBody(HERO_BODY, 1.02, { shoulderX: 12.8, hipWidth: 6.2 });
const DOC = jointHeights(DOC_BODY);

const DOC_DECALS: DecalSpec[] = [
  { shape: "lower", x: 0, y: -0.55, rx: 0.26, ry: 0.13, rot: 0.08, fill: "mouth", ink: 2 },
  { shape: "ellipse", x: -0.66, y: -0.36, rx: 0.15, ry: 0.08, fill: "blush", mirror: true },
  { shape: "stroke", x: -0.38, y: 0.32, rx: 0.2, ry: 0.05, rot: 0.15, fill: "ink", mirror: true },
];

export const DOC_OCTOCHAIN: CastDef = {
  key: "doc-octochain",
  name: "Doc Octochain",
  body: DOC_BODY,
  height: 98,
  motion: "hover",
  colors: () => ({ skin: "#E2A877", hair: "#6E4527", coat: "#4F9A4E", shirt: "#3A3D44", pants: "#3C3F48", shoe: "#5A3A22", goggle: "#26282E", steel: "#AEB4BD", mouth: "#7E2A2E", blush: "#F59AAA" }),
  decals: DOC_DECALS,
  // The boom ends, where the sim's arms leave his body (villains.ts SHOULDERS: ±0.55 and
  // ±0.3 of his 50 radius along the bridge, +6 and −16 from his centre, which sits 4 above
  // his hips). The chains root at the frame's own shoulder points when it sends them.
  sockets: {
    armUL: { bone: "spine", at: [27.5, DOC.pelvis + 10, 0] },
    armUR: { bone: "spine", at: [-27.5, DOC.pelvis + 10, 0] },
    armLL: { bone: "hips", at: [15, DOC.pelvis - 12, 0] },
    armLR: { bone: "hips", at: [-15, DOC.pelvis - 12, 0] },
  },
  build(k) {
    const y = k.y;
    const shirt = { c1: k.c("shirt"), mask: (p: Vector3): [number, number] => [p.z > 2 && Math.abs(p.x) < Math.min(5, Math.max(0, (p.y - (y.chest - 8)) * 0.5)) ? 1 : 0, 0] };
    k.torso({ hip: [11.4, 9.4], waist: [12.4, 10.6], chest: [12.6, 9.6], shoulder: [12.4, 7.8], bellyFwd: 2.6, chestFwd: 0.8, colors: [{ y: 0, color: "pants" }, { y: y.pelvis - 1, color: "coat" }], overlay: shirt });
    // Coat tails flaring over the thighs.
    k.b.tube({
      from: new Vector3(0, y.pelvis + 2, 0),
      axis: new Vector3(0, -1, 0),
      ref: new Vector3(1, 0, 0),
      samples: [
        { s: 0, rx: 12.2, rz: 10.2, off: [0, 0, 0.8], w: [[k.bone("hips"), 1]], color: k.c("coat") },
        { s: 10, rx: 13.4, rz: 11.2, off: [0, 0, 0.3], w: [[k.bone("hips"), 1]], color: k.c("coat") },
        { s: 15, rx: 14.2, rz: 11.8, w: [[k.bone("hips"), 1]], color: k.c("coat") },
      ],
      segs: k.s.torso,
    });
    k.neck(3.8, "skin");
    const head = k.head({ y: 7.4, rx: 8.4, ry: 9, rz: 8.8, jaw: 0.86, chin: 0.4, faceY: -0.05, color: "skin", kind: DETAIL.face, capColor: "hair", capFrom: 0.42 });
    // Bowl cut, goggles, nose.
    k.sphere("head", k.onHead(head, 0, 0.26, -0.14), [head.rx * 1.08, head.ry * 0.9, head.rz * 1.02], "hair");
    k.both((_side, sign) => {
      k.cylinder("head", k.onHead(head, sign * 0.38, 0.04, 0.9), head.rx * 0.27, 3.2, "goggle", { rot: [Math.PI / 2, 0, 0], hull: 1.5 });
      k.sphere("head", k.onHead(head, sign * 1.02, -0.02, 0), [1.6, 2.4, 1.8], "skin");
    });
    k.box("head", k.onHead(head, 0, 0.04, 0.96), [3.6, 1, 1.4], "goggle", { hull: 0.6 });
    k.sphere("head", k.onHead(head, 0, -0.22, 1.02), [1.8, 1.6, 1.6], "skin");
    // The harness: a steel belt and four booms out to the chains' shoulders, a pack behind.
    k.box("chest", new Vector3(0, y.chest + 2, -9.5), [13, 12, 4], "steel");
    k.torus("spine", new Vector3(0, y.pelvis + 7, 0.8), 12.6, 1.6, "steel", { rot: [Math.PI / 2, 0, 0], scale: [1, 0.86, 1] });
    for (const sock of Object.values(DOC_OCTOCHAIN.sockets!)) {
      const [sx, sy, sz] = sock.at;
      const inner = Math.sign(sx) * 9;
      k.cylinder(sock.bone, new Vector3((sx + inner) / 2, sy, sz - 1), 1.5, Math.abs(sx - inner), "steel", { rot: [0, 0, Math.PI / 2], segs: 6 });
      k.sphere(sock.bone, new Vector3(sx, sy, sz), [3, 3, 3], "steel");
    }
    k.both((side) => {
      k.arm(side, { r: [4.6, 4, 3.2, 3.6, 2.7], colors: [{ s: 0, color: "coat" }, { s: 0.9, color: "skin" }] });
      k.hand(side, 6.6, "skin");
      k.leg(side, { r: [5.6, 5, 3.8, 4, 2.9], colors: [{ s: 0, color: "pants" }] });
      k.foot(side, 10.5, 3.6, 3.4, "shoe", "ink");
    });
    return head;
  },
};

/* ------------------------------------------------------------------ The Sybil */

const SYBIL_BODY = scaleBody(HERO_BODY, 1, { shoulderX: 12.4, upperArm: 16.5, foreArm: 15.5, legs: false });

const SYBIL_DECALS: DecalSpec[] = [
  { shape: "ellipse", x: -0.46, y: 0.3, rx: 0.4, ry: 0.13, rot: 0.62, fill: "eye", ink: 2, mirror: true },
  { shape: "lower", x: 0, y: -0.08, rx: 0.86, ry: 0.66, fill: "mouth", ink: 2.2 },
  { shape: "ellipse", x: -0.5, y: -0.16, rx: 0.07, ry: 0.15, fill: "tooth", clip: true, mirror: true },
  { shape: "ellipse", x: -0.2, y: -0.2, rx: 0.07, ry: 0.15, fill: "tooth", clip: true, mirror: true },
  { shape: "ellipse", x: -0.36, y: -0.68, rx: 0.07, ry: 0.13, fill: "tooth", clip: true, mirror: true },
  { shape: "ellipse", x: 0, y: -0.72, rx: 0.07, ry: 0.13, fill: "tooth", clip: true },
];

function sybilBody(k: BodyKit): ReturnType<BodyKit["head"]> {
  const y = k.y;
  k.torso({ hip: [8, 6.8], waist: [8.6, 7], chest: [11.2, 7.6], shoulder: [11.8, 6.8], colors: [{ y: 0, color: "body" }], seat: 0.1 });
  // A gooey tail instead of legs: it sways with the leg bones' dangling springs.
  const hb = k.bone("hips");
  const tl = k.bone("thighL");
  const tr = k.bone("thighR");
  const sl = k.bone("shinL");
  const sr = k.bone("shinR");
  k.b.tube({
    from: new Vector3(0, y.hipJoint + 2, 0),
    axis: new Vector3(0, -1, 0),
    ref: new Vector3(1, 0, 0),
    samples: [
      { s: 0, rx: 8.2, rz: 6.9, w: [[hb, 1]], color: k.c("body") },
      { s: 10, rx: 6.6, rz: 5.8, w: [[hb, 0.5], [tl, 0.25], [tr, 0.25]], color: k.c("body") },
      { s: 22, rx: 4.2, rz: 3.8, w: [[tl, 0.5], [tr, 0.5]], color: k.c("body") },
      { s: 32, rx: 2, rz: 2, w: [[sl, 0.5], [sr, 0.5]], color: k.c("goo") },
    ],
    segs: k.s.torso,
    capEnd: 3,
    capRings: k.s.cap,
  });
  k.neck(4, "goo");
  const head = k.head({ y: 9, rx: 10.4, ry: 10.6, rz: 10, jaw: 0.92, faceY: 0, color: "goo", kind: DETAIL.face });
  k.cone("head", k.onHead(head, 0.35, -0.95, 0.4), 1.6, 5, "goo", { rot: [Math.PI, 0, 0] });
  k.cone("head", k.onHead(head, -0.5, -0.88, 0.2), 1.3, 4, "goo", { rot: [Math.PI, 0, 0] });
  k.both((side) => {
    k.arm(side, { r: [4, 3.2, 2.6, 3, 2.4], colors: [{ s: 0, color: "body" }, { s: 0.6, color: "goo" }] });
    k.hand(side, 7, "goo");
  });
  return head;
}

const SYBIL_COLORS = { goo: "#19191B", body: "#2C2C2F", eye: "#FFFFFF", mouth: "#7A1C2B", tooth: "#FFFFFF" };

export const SYBIL: CastDef = {
  key: "sybil",
  name: "The Sybil",
  body: SYBIL_BODY,
  height: 96,
  motion: "float",
  colors: () => SYBIL_COLORS,
  decals: SYBIL_DECALS,
  build: sybilBody,
};

export const SYBIL_COPY: CastDef = {
  ...SYBIL,
  key: "sybil-copy",
  name: "A copy",
  colors: () => ({ goo: "#A3A3A0", body: "#A3A3A0", eye: "#E4E4E1", mouth: "#74746F", tooth: "#D6D6D2" }),
};
