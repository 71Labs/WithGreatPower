/**
 * The masked heroes: The Node (the player, in any suit from the save) and Gwei Stacy. Both
 * use the heroic body; the web on The Node's mask, chest and limbs is drawn in the shader,
 * and the lenses are sticker decals traced from the 2D busts (components/cast/avatars.tsx).
 */
import { Vector3 } from "three";

import { NODE_COLORS, type SuitColors } from "@/components/cast";

import { DETAIL } from "../builder";
import type { CastDef, DecalSpec } from "../model";
import { HERO_BODY, scaleBody } from "../rig";
import { chestWeb, limbWeb } from "./kit";

/** A suit colour pushed toward ink, for boots and gloves. */
export function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(c * (1 - k) + 0x14 * k);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, "0")).join("")}`;
}

/** The Node's lenses (from NODE_LENS), a white highlight and the chin seam. */
const NODE_DECALS: DecalSpec[] = [
  { shape: "ellipse", x: -0.44, y: 0.02, rx: 0.4, ry: 0.25, rot: -0.62, fill: "lens", ink: 3.4, mirror: true },
  { shape: "stroke", x: -0.42, y: 0.66, rx: 0.2, ry: 0.035, rot: 0.55, fill: "white" },
];

export const HERO: CastDef = {
  key: "hero",
  name: "The Node",
  body: HERO_BODY,
  height: 88,
  motion: "hero",
  webSpacing: 2.9,
  colors: (suit: SuitColors = NODE_COLORS) => ({
    web: suit.web,
    suit: suit.suit,
    dark: darken(suit.suit, 0.28),
    lens: suit.lens,
  }),
  decals: NODE_DECALS,
  build(k) {
    const y = k.y;
    k.torso({
      hip: [8.6, 6.3],
      waist: [7.4, 5.6],
      chest: [11, 7.2],
      shoulder: [11.4, 6.4],
      chestFwd: 0.9,
      neckRx: 4.4,
      colors: [{ y: 0, color: "suit" }],
      detail: chestWeb(y.chest + 2),
    });
    k.neck(3.5, "suit");
    const head = k.head({ y: 7.4, rx: 7.7, ry: 9.4, rz: 8.4, jaw: 0.66, chin: 0.6, faceY: -0.02, color: "suit", kind: DETAIL.faceWeb });
    k.both((side) => {
      k.arm(side, { r: [4.4, 3.7, 2.9, 3.4, 2.4], colors: [{ s: 0, color: "suit" }], detail: limbWeb });
      k.hand(side, 6.4, "suit");
      k.leg(side, { r: [5.6, 5.3, 3.9, 4.3, 2.8], colors: [{ s: 0, color: "suit" }, { s: 0.86, color: "dark" }], detail: limbWeb });
      k.foot(side, 10.5, 3.5, 3.6, "dark", "ink");
    });
    return head;
  },
};

const GWEI_DECALS: DecalSpec[] = [
  { shape: "ellipse", x: -0.42, y: -0.12, rx: 0.36, ry: 0.23, rot: -0.55, fill: "white", ink: 3.2, mirror: true },
  { shape: "stroke", x: 0, y: -0.86, rx: 0.34, ry: 0.03, fill: "ink" },
];

export const GWEI: CastDef = {
  key: "gwei",
  name: "Gwei Stacy",
  body: scaleBody(HERO_BODY, 0.97, { shoulderX: 10.6, hipWidth: 5 }),
  height: 86,
  motion: "ally",
  webSpacing: 2.6,
  colors: () => ({
    web: "#B6A2EC",
    suit: "#FFFFFF",
    panel: "#1E1E1E",
    hood: "#FFFFFF",
    lining: "#F3A6C8",
    hair: "#F8D978",
    shoe: "#2DB3A5",
  }),
  decals: GWEI_DECALS,
  build(k) {
    // Black side panels down the torso, from the 2D sticker's suit.
    const sides = { c1: k.c("panel"), mask: (p: Vector3) => [Math.abs(p.x) > 7.2 && p.z < 3 ? 1 : 0, 0] as [number, number] };
    k.torso({ hip: [8, 5.8], waist: [6.6, 5], chest: [9.6, 6.6], shoulder: [10, 5.8], chestFwd: 0.8, neckRx: 3.9, colors: [{ y: 0, color: "suit" }], overlay: sides });
    k.neck(3.1, "suit");
    const head = k.head({ y: 7.2, rx: 7.3, ry: 9, rz: 8, jaw: 0.68, chin: 0.5, faceY: -0.06, color: "suit", kind: DETAIL.faceWeb });
    // The hood: a shell open at the face, pink inside, with a blonde fringe under its brim.
    k.sphere("head", k.onHead(head, 0, 0.12, -0.2), [head.rx * 1.18, head.ry * 1.08, head.rz * 1.05], "hood");
    k.sphere("head", k.onHead(head, 0, 0.55, 0.62), [head.rx * 0.95, head.ry * 0.3, head.rz * 0.42], "hair", { rot: [0.35, 0, 0] });
    k.both((side, sign) => {
      k.sphere("head", k.onHead(head, sign * 0.78, 0.1, 0.35), [head.rx * 0.28, head.ry * 0.62, head.rz * 0.4], "lining", { rot: [0, sign * 0.4, 0] });
      k.arm(side, { r: [3.9, 3.2, 2.6, 3, 2.2], colors: [{ s: 0, color: "suit" }, { s: 0.15, color: "panel" }, { s: 0.75, color: "suit" }] });
      k.hand(side, 5.8, "suit");
      k.leg(side, { r: [5.2, 4.8, 3.5, 3.9, 2.5], colors: [{ s: 0, color: "suit" }, { s: 0.88, color: "shoe" }] });
      k.foot(side, 9.2, 3.1, 3.2, "shoe", "ink");
    });
    return head;
  },
};
