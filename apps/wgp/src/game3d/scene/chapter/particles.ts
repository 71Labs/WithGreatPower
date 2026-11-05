/**
 * Pops: a paper copy bursting into card confetti, Mary's pixels flying off as she's restored,
 * as one instanced batch of inked unit boxes (one draw call, none when nothing's flying).
 * Each piece's flight is closed-form (math.ts `flakeAt`). Reduced motion: the pieces don't
 * fly or spin; they settle out of the shape where it stood and shrink away.
 */
import { BoxGeometry, DynamicDrawUsage, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, Vector3 } from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import type { SharedUniforms } from "../city/materials";
import { KEY_LIGHT } from "../characters/materials";
import { C, rgb } from "../palette";
import { FLAKE_LIFE, flakeAt, hash01, type Flake } from "./math";
import { BOX_FRAGMENT, BOX_VERTEX } from "./shaders";

export type PopKind = "paper" | "pixel";

interface Pop {
  kind: PopKind;
  x: number;
  y: number;
  z: number;
  seed: number;
  t: number;
  count: number;
  colours: number[][];
}

const MAX = 240;
/** Pieces per pop, by tier. */
export const POP_PIECES: Record<PopKind, { full: number; light: number }> = {
  paper: { full: 28, light: 14 },
  pixel: { full: 64, light: 28 },
};

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export class Pops {
  readonly mesh: InstancedMesh;
  private readonly geo: BoxGeometry;
  private readonly mat: ShaderMaterial;
  private readonly colour: InstancedBufferAttribute;
  private live: Pop[] = [];
  private readonly flake: Flake = { x: 0, y: 0, z: 0, rx: 0, ry: 0, alive: false };
  private seed = 1;
  reducedMotion = false;
  /** The light tier: fewer pieces. */
  light = false;

  constructor(shared: SharedUniforms) {
    this.geo = new BoxGeometry(1, 1, 1);
    this.colour = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aColor", this.colour);
    this.mat = new ShaderMaterial({
      name: "wgp-chapter-pops",
      vertexShader: BOX_VERTEX,
      fragmentShader: BOX_FRAGMENT,
      uniforms: {
        uInk: { value: new Vector3(...C.ink) },
        uDpr: shared.uDpr,
        uGlow: { value: 0.2 },
        uLight: { value: KEY_LIGHT.clone() },
        uFog: shared.uFog,
        uFogBands: shared.uFogBands,
        uFogAmt: shared.uFogAmt,
      },
    });
    this.mesh = new InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.name = "chapter-pops";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Pop at a point: `colours` are hex fills the pieces pick from. */
  pop(kind: PopKind, at: Vec3, colours: string[]): void {
    const n = POP_PIECES[kind][this.light ? "light" : "full"];
    this.seed = (this.seed * 16807) % 2147483647;
    this.live.push({ kind, x: at.x, y: at.y, z: at.z, seed: (this.seed % 1000) + 0.5, t: 0, count: n, colours: colours.map(rgb) });
    // Oldest first out if the batch would overflow.
    let total = this.live.reduce((s, p) => s + p.count, 0);
    while (total > MAX && this.live.length > 1) total -= this.live.shift()!.count;
  }

  get active(): number {
    return this.live.length;
  }

  update(dt: number): void {
    for (const p of this.live) p.t += dt;
    if (this.live.some((p) => p.t >= FLAKE_LIFE)) this.live = this.live.filter((p) => p.t < FLAKE_LIFE);
    let n = 0;
    const still = this.reducedMotion;
    for (const p of this.live) {
      const pixel = p.kind === "pixel";
      for (let i = 0; i < p.count && n < MAX; i++) {
        const f = flakeAt(i, p.seed, p.t, pixel ? 1.6 : 1, this.flake);
        if (!f.alive) continue;
        const u = p.t / FLAKE_LIFE;
        const shrink = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
        if (still) {
          // In place: the pieces lie where the shape was and shrink away.
          const h = hash01(p.seed + i * 3.3);
          const h2 = hash01(p.seed * 2 + i * 1.7);
          _p.set(p.x + (h - 0.5) * 36, p.y + (h2 - 0.2) * 60 * (1 - u * 0.5), p.z + (hash01(p.seed + i) - 0.5) * 20);
          _q.identity();
        } else {
          _p.set(p.x + f.x, p.y + f.y, p.z + f.z);
          _q.setFromEuler(_e.set(f.rx, f.ry, 0));
        }
        if (pixel) _s.setScalar(5 * shrink);
        else _s.set(7 * shrink, 4.5 * shrink, 0.5);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(n, _m);
        const c = p.colours[i % p.colours.length];
        this.colour.setXYZ(n, c[0], c[1], c[2]);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.colour.needsUpdate = true;
    }
  }

  clear(): void {
    this.live = [];
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
