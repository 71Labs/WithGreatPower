/**
 * Case file 003's props as inked boxes (the chapter's box shader: cel bands, an ink edge a fixed
 * number of pixels wide): one instanced batch for everything that stands still all night (the
 * pretzel cart, the florist's stall, the market stalls on the route's roofs, the bakery's crates,
 * flour sacks, chimney and sign posts), so the whole case dresses the city in one draw call.
 *
 * Each builder takes a spot on a roof (feet level) and the way it faces (yaw: 0 along +z,
 * turning toward +x) and adds its boxes. Sizes are world units (the hero is about 88 tall).
 */
import { BoxGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, Vector3 } from "three";

import type { SharedUniforms } from "../city/materials";
import { KEY_LIGHT } from "../characters/materials";
import { BOX_FRAGMENT, BOX_VERTEX } from "../chapter/shaders";
import { hash01 } from "../chapter/math";
import { C, rgb, type RGB } from "../palette";

export const WOOD = rgb("#B07A45");
export const WOOD_DARK = rgb("#7A4F2B");
export const AWNING = [rgb("#E5392C"), rgb("#2FA36B"), rgb("#3B5BA8"), rgb("#F4C542")];
export const CREAM = rgb("#FFF4DE");
const PRETZEL = rgb("#C98A3D");
const FLOWERS = [rgb("#E8492F"), rgb("#F4C542"), rgb("#F28AB8"), rgb("#9B6BD6"), rgb("#FFFFFF")];
const STEM = rgb("#2E8B57");
const TIN = rgb("#8D93A6");
const CRATE = rgb("#A8743F");
const SACK = rgb("#EFE6D2");
const BRICK = rgb("#9E3B32");
const SLATE = rgb("#3C4156");
const BREAD = rgb("#D9984A");

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const Y = new Vector3(0, 1, 0);

/** An instanced batch of inked unit boxes. `add` takes a box's bottom centre. */
export class BoxBatch {
  readonly mesh: InstancedMesh;
  private readonly geo = new BoxGeometry(1, 1, 1);
  private readonly mat: ShaderMaterial;
  private readonly colour: InstancedBufferAttribute;
  private n = 0;

  constructor(
    shared: SharedUniforms,
    readonly max: number,
    name: string,
  ) {
    this.colour = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.geo.setAttribute("aColor", this.colour);
    this.mat = new ShaderMaterial({
      name: `wgp-${name}`,
      vertexShader: BOX_VERTEX,
      fragmentShader: BOX_FRAGMENT,
      uniforms: {
        uInk: { value: new Vector3(...C.ink) },
        uDpr: shared.uDpr,
        uGlow: { value: 0 },
        uLight: { value: KEY_LIGHT.clone() },
        uFog: shared.uFog,
        uFogBands: shared.uFogBands,
        uFogAmt: shared.uFogAmt,
      },
    });
    this.mesh = new InstancedMesh(this.geo, this.mat, max);
    this.mesh.name = name;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  /** A box `sx × sy × sz` with its bottom centre at (x, y, z), turned `yaw` about the vertical. */
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, colour: RGB): void {
    if (this.n >= this.max) return;
    _q.setFromAxisAngle(Y, yaw);
    _m.compose(_p.set(x, y + sy / 2, z), _q, _s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, _m);
    this.colour.setXYZ(this.n, colour[0], colour[1], colour[2]);
    this.n++;
  }

  /** A box placed in a frame turned `yaw` about (ox, oz): `lx` to the right, `lz` forward. */
  addLocal(ox: number, oy: number, oz: number, yaw: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, colour: RGB, turn = 0): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Forward is (sin yaw, cos yaw); right is (cos yaw, −sin yaw).
    this.add(ox + lx * c + lz * s, oy + ly, oz - lx * s + lz * c, sx, sy, sz, yaw + turn, colour);
  }

  commit(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colour.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.visible = this.n > 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

/** A striped awning on four poles over (ox, oz), `w` wide and `d` deep, its canopy at `h`. */
function awning(b: BoxBatch, ox: number, oy: number, oz: number, yaw: number, w: number, d: number, h: number, stripe: RGB, stripes = 5) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.addLocal(ox, oy, oz, yaw, (sx * w) / 2 - sx * 2, 0, (sz * d) / 2 - sz * 2, 3, h, 3, WOOD_DARK);
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) b.addLocal(ox, oy, oz, yaw, -w / 2 + sw * (i + 0.5), h, 0, sw + 0.2, 4, d + 8, i % 2 === 0 ? stripe : CREAM);
}

/** The pretzel cart: a wooden barrow with two wheels, a red-striped awning, pretzels piled on top. */
export function pretzelCart(b: BoxBatch, x: number, y: number, z: number, yaw: number) {
  b.addLocal(x, y, z, yaw, 0, 10, 0, 50, 24, 28, WOOD);
  b.addLocal(x, y, z, yaw, 0, 34, 0, 54, 3, 32, WOOD_DARK);
  for (const sx of [-1, 1]) b.addLocal(x, y, z, yaw, sx * 22, 0, 15, 14, 14, 4, SLATE);
  b.addLocal(x, y, z, yaw, -30, 22, 0, 12, 3, 4, WOOD_DARK);
  for (let i = 0; i < 6; i++) {
    const px = -18 + (i % 3) * 18;
    const pz = i < 3 ? -6 : 7;
    b.addLocal(x, y, z, yaw, px, 37, pz, 11, 4, 9, PRETZEL, 0.5 * i);
  }
  awning(b, x, y, z, yaw, 60, 38, 66, AWNING[0]);
}

/** The florist's stall: a green-clothed table, tin buckets of flowers in front, a green awning. */
export function floristStall(b: BoxBatch, x: number, y: number, z: number, yaw: number) {
  b.addLocal(x, y, z, yaw, 0, 0, -4, 58, 28, 24, rgb("#2E8B57"));
  b.addLocal(x, y, z, yaw, 0, 28, -4, 62, 2, 28, CREAM);
  for (let i = 0; i < 5; i++) {
    const bx = -24 + i * 12;
    b.addLocal(x, y, z, yaw, bx, 0, 16, 9, 12, 9, TIN);
    for (let k = 0; k < 3; k++) {
      const fx = bx + (k - 1) * 3;
      const fh = 18 + hash01(i * 3 + k) * 8;
      b.addLocal(x, y, z, yaw, fx, 12, 16 + (k - 1) * 2, 1.5, fh - 4, 1.5, STEM);
      b.addLocal(x, y, z, yaw, fx, 12 + fh - 5, 16 + (k - 1) * 2, 5, 5, 5, FLOWERS[(i + k) % FLOWERS.length], 0.6 * k);
    }
  }
  awning(b, x, y, z, yaw, 66, 44, 62, AWNING[1]);
}

/** A market stall on a route roof: an awning in the stall's colour, a trestle and a couple of crates. */
export function marketStall(b: BoxBatch, x: number, y: number, z: number, yaw: number, seed: number) {
  const colour = AWNING[Math.floor(hash01(seed * 1.7) * AWNING.length) % AWNING.length];
  b.addLocal(x, y, z, yaw, 0, 0, 0, 46, 20, 20, WOOD);
  b.addLocal(x, y, z, yaw, 0, 20, 0, 50, 3, 24, WOOD_DARK);
  b.addLocal(x, y, z, yaw, -12, 23, 0, 12, 7, 10, FLOWERS[Math.floor(hash01(seed) * FLOWERS.length)]);
  b.addLocal(x, y, z, yaw, 10, 23, 2, 14, 6, 12, BREAD);
  b.addLocal(x, y, z, yaw, 30, 0, 14, 16, 14, 16, CRATE, 0.3);
  if (hash01(seed * 3.1) > 0.4) b.addLocal(x, y, z, yaw, 30, 14, 14, 12, 10, 12, CRATE, 0.7);
  awning(b, x, y, z, yaw, 54, 34, 58, colour, 4);
}

/** Bread crates and flour sacks, a short stack against an edge of the bakery roof. */
export function bakeryStock(b: BoxBatch, x: number, y: number, z: number, yaw: number, seed: number) {
  b.addLocal(x, y, z, yaw, 0, 0, 0, 26, 16, 20, CRATE);
  b.addLocal(x, y, z, yaw, 0, 16, 0, 22, 4, 16, BREAD);
  b.addLocal(x, y, z, yaw, 24, 0, 2, 18, 22, 16, SACK, 0.2);
  if (hash01(seed) > 0.3) b.addLocal(x, y, z, yaw, -20, 0, -2, 18, 18, 14, SACK, -0.3);
  if (hash01(seed * 2.3) > 0.5) b.addLocal(x, y, z, yaw, 4, 20, 0, 24, 14, 18, CRATE, 0.15);
}

/** The bakery's chimney: brick, a slate cap. */
export function chimney(b: BoxBatch, x: number, y: number, z: number) {
  b.add(x, y, z, 28, 72, 28, 0, BRICK);
  b.add(x, y + 72, z, 34, 6, 34, 0, SLATE);
}

/** Two posts holding a sign `w` wide with its foot at `lift`. */
export function signPosts(b: BoxBatch, x: number, y: number, z: number, yaw: number, w: number, lift: number) {
  for (const sx of [-1, 1]) b.addLocal(x, y, z, yaw, (sx * w) / 2 - sx * 10, 0, -3, 6, lift + 8, 6, WOOD_DARK);
}
