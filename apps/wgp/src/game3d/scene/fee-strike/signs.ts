/**
 * Case file 003's painted signs, drawn once into one canvas atlas and shown as instanced quads
 * (one draw call for them all): Aunt Mainnet's bakery sign, the "Sorry: fees too high" note that
 * hangs on it until the fees are cooled and the "Open: fresh bread" one after, and the price
 * cards on the pretzel cart and the florist's stall. Comic paper and ink, in sentence case
 * where it's a note and caps where it's a shop's name, as a sign painter would.
 */
import { CanvasTexture, InstancedBufferAttribute, InstancedMesh, Matrix4, NoColorSpace, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from "three";

import type { SharedUniforms } from "../city/materials";
import { SIGN_FRAGMENT, SIGN_VERTEX } from "./shaders";

export type SignId = "bakery" | "closed" | "open" | "pretzel" | "florist";

/** Each sign's corner of the 1024 × 512 atlas (px) and its size in the world (units). */
const LAYOUT: Record<SignId, { x: number; y: number; w: number; h: number; size: [number, number] }> = {
  bakery: { x: 0, y: 0, w: 1024, h: 288, size: [250, 70] },
  closed: { x: 0, y: 296, w: 512, h: 104, size: [130, 26] },
  open: { x: 512, y: 296, w: 512, h: 104, size: [130, 26] },
  pretzel: { x: 0, y: 408, w: 512, h: 104, size: [62, 12.6] },
  florist: { x: 512, y: 408, w: 512, h: 104, size: [54, 11] },
};

const INK = "#141414";
const PAPER = "#FFF4DE";
const RED = "#E5392C";
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, border: string, r = 18) {
  ctx.fillStyle = border;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x + 10, y + 10, w - 20, h - 20, Math.max(4, r - 8));
  ctx.fill();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour: string, weight = 800, max = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (max > 0) {
    const w = ctx.measureText(s).width;
    if (w > max) ctx.font = `${weight} ${Math.floor((size * max) / w)}px ${FONT}`;
  }
  ctx.fillText(s, x, y);
}

/** Paint the atlas. Null where there's no canvas (tests). */
export function paintSigns(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1024, 512);
  // Aunt Mainnet's sign: red and cream, her name big, the slogan under it, a loaf at each end.
  const b = LAYOUT.bakery;
  card(ctx, b.x + 4, b.y + 4, b.w - 8, b.h - 8, PAPER, INK, 34);
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.roundRect(b.x + 22, b.y + 22, b.w - 44, 150, 18);
  ctx.fill();
  text(ctx, "AUNT MAINNET’S", b.x + b.w / 2, b.y + 98, 108, PAPER, 900, b.w - 120);
  text(ctx, "FRESH BLOCKS DAILY", b.x + b.w / 2, b.y + 222, 66, INK, 800, b.w - 220);
  for (const lx of [b.x + 90, b.x + b.w - 90]) {
    ctx.fillStyle = "#D9984A";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(lx, b.y + 222, 52, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (const dx of [-22, 0, 22]) {
      ctx.moveTo(lx + dx - 8, b.y + 206);
      ctx.lineTo(lx + dx + 8, b.y + 238);
    }
    ctx.stroke();
  }
  // The notes that hang under it.
  const c = LAYOUT.closed;
  card(ctx, c.x + 4, c.y + 4, c.w - 8, c.h - 8, "#FFFFFF", INK, 14);
  text(ctx, "Sorry: fees too high", c.x + c.w / 2, c.y + c.h / 2 + 2, 52, RED, 800, c.w - 60);
  const o = LAYOUT.open;
  card(ctx, o.x + 4, o.y + 4, o.w - 8, o.h - 8, "#4FD08A", INK, 14);
  text(ctx, "Open: fresh bread", o.x + o.w / 2, o.y + o.h / 2 + 2, 52, INK, 800, o.w - 60);
  // The price cards: what a fee spike does to a pretzel and a rose.
  const p = LAYOUT.pretzel;
  card(ctx, p.x + 4, p.y + 4, p.w - 8, p.h - 8, PAPER, INK, 12);
  text(ctx, "Fee: 400,000,000,000 gwei", p.x + p.w / 2, p.y + p.h / 2 + 2, 50, INK, 800, p.w - 50);
  const f = LAYOUT.florist;
  card(ctx, f.x + 4, f.y + 4, f.w - 8, f.h - 8, PAPER, INK, 12);
  text(ctx, "Roses: pending", f.x + f.w / 2, f.y + f.h / 2 + 2, 50, INK, 800, f.w - 50);
  return canvas;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const Y = new Vector3(0, 1, 0);

/** The signs as one instanced batch over the atlas; each placed once, shown or hidden after. */
export class Signs {
  readonly mesh: InstancedMesh;
  private readonly geo = new PlaneGeometry(1, 1);
  private readonly mat: ShaderMaterial;
  private readonly rect: InstancedBufferAttribute;
  private readonly alpha: InstancedBufferAttribute;
  private readonly texture: CanvasTexture | null;
  private readonly ids: SignId[] = [];

  constructor(shared: SharedUniforms, max = 12) {
    const canvas = paintSigns();
    this.texture = canvas ? new CanvasTexture(canvas) : null;
    if (this.texture) {
      this.texture.colorSpace = NoColorSpace;
      this.texture.anisotropy = 4;
    }
    this.rect = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.alpha = new InstancedBufferAttribute(new Float32Array(max), 1);
    this.geo.setAttribute("aRect", this.rect);
    this.geo.setAttribute("aAlpha", this.alpha);
    this.mat = new ShaderMaterial({
      name: "wgp-fee-signs",
      vertexShader: SIGN_VERTEX,
      fragmentShader: SIGN_FRAGMENT,
      uniforms: { uAtlas: { value: this.texture }, uFog: shared.uFog, uFogBands: shared.uFogBands, uFogAmt: shared.uFogAmt },
    });
    this.mesh = new InstancedMesh(this.geo, this.mat, max);
    this.mesh.name = "fee-signs";
    this.mesh.count = 0;
    this.mesh.visible = !!this.texture;
  }

  clear(): void {
    this.ids.length = 0;
    this.mesh.count = 0;
  }

  /** A sign with its bottom centre at (x, y, z), its face toward yaw (0: +z); front only (a board or a stall backs each). */
  add(id: SignId, x: number, y: number, z: number, yaw: number, shown = true): void {
    const i = this.ids.length;
    if (i >= this.rect.count) return;
    const L = LAYOUT[id];
    const [w, h] = L.size;
    _q.setFromAxisAngle(Y, yaw);
    _m.compose(_p.set(x, y + h / 2, z), _q, _s.set(w, h, 1));
    this.mesh.setMatrixAt(i, _m);
    // The atlas's v runs up from its bottom; the layout's y runs down from its top.
    this.rect.setXYZW(i, L.x / 1024, 1 - (L.y + L.h) / 512, (L.x + L.w) / 1024, 1 - L.y / 512);
    this.alpha.setX(i, shown ? 1 : 0);
    this.ids.push(id);
    this.mesh.count = this.ids.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rect.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  /** Show or hide every sign of a kind. */
  show(id: SignId, on: boolean): void {
    let changed = false;
    this.ids.forEach((s, i) => {
      if (s !== id) return;
      const v = on ? 1 : 0;
      if (this.alpha.getX(i) !== v) {
        this.alpha.setX(i, v);
        changed = true;
      }
    });
    if (changed) this.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.texture?.dispose();
    this.mesh.dispose();
  }
}
