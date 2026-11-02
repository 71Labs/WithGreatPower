/**
 * Web strands: a white line over a wider ink line, as screen-space ribbons in one draw
 * call (the 2D renderer's `line(…, lw·1.9, INK)` then `line(…, lw·0.75, webLine)`). A
 * strand is a polyline of up to MAX_POINTS points (taut it is two; slack, falling or
 * dangling it bends), each segment a ribbon whose ends are square-capped by half a width so
 * the ink wraps the white at the joints and the ends. Widths are CSS px, so a strand reads
 * the same near or far; `widthScale` thins one out as it fades.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial, Vector2, Vector3 } from "three";

import { LINE } from "@/game/style";

import { C } from "./palette";

export const MAX_POINTS = 16;
const SEGS = MAX_POINTS - 1;

const VERTEX = /* glsl */ `
attribute vec3 aA;       // segment start
attribute vec3 aB;       // segment end
attribute vec3 aRib;     // end (0 start, 1 end), side (−1, +1), layer (0 ink, 1 white)
uniform vec2 uWidth;     // ink, white (CSS px)
uniform vec2 uRes;       // half the viewport (CSS px)
varying float vLayer;
void main() {
  vec4 a = projectionMatrix * viewMatrix * vec4(aA, 1.0);
  vec4 b = projectionMatrix * viewMatrix * vec4(aB, 1.0);
  a.w = max(a.w, 1e-3);
  b.w = max(b.w, 1e-3);
  vec2 sa = a.xy / a.w * uRes;
  vec2 sb = b.xy / b.w * uRes;
  vec2 d = sb - sa;
  vec2 dir = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float w = aRib.z < 0.5 ? uWidth.x : uWidth.y;
  float end = aRib.x;
  vec4 p = end < 0.5 ? a : b;
  vec2 off = (n * aRib.y + dir * (end < 0.5 ? -1.0 : 1.0)) * w * 0.5;
  p.xy += off / uRes * p.w;
  p.z -= aRib.z * 2e-4 * p.w;
  vLayer = aRib.z;
  gl_Position = p;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uWhite;
varying float vLayer;
void main() { gl_FragColor = vec4(vLayer < 0.5 ? uInk : uWhite, 1.0); }
`;

export class WebLine {
  readonly mesh: Mesh;
  private readonly geo: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly aAttr: BufferAttribute;
  private readonly bAttr: BufferAttribute;
  private readonly two = new Float32Array(6);

  constructor() {
    // Every segment is a quad per layer (vertices: all ink quads, then all white ones). The
    // index runs segment by segment, ink then white, so a draw range covers exactly the
    // segments in use; the white layer's depth bias keeps it over every ink quad.
    const verts = 2 * SEGS * 4;
    const rib: number[] = [];
    const index: number[] = [];
    for (const layer of [0, 1]) {
      for (let s = 0; s < SEGS; s++) {
        for (const [end, side] of [
          [0, -1],
          [0, 1],
          [1, 1],
          [1, -1],
        ])
          rib.push(end, side, layer);
      }
    }
    for (let s = 0; s < SEGS; s++) {
      for (const layer of [0, 1]) {
        const base = (layer * SEGS + s) * 4;
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    this.a = new Float32Array(verts * 3);
    this.b = new Float32Array(verts * 3);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", new BufferAttribute(new Float32Array(verts * 3), 3));
    this.aAttr = new BufferAttribute(this.a, 3).setUsage(DynamicDrawUsage);
    this.bAttr = new BufferAttribute(this.b, 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aA", this.aAttr);
    this.geo.setAttribute("aB", this.bAttr);
    this.geo.setAttribute("aRib", new BufferAttribute(new Float32Array(rib), 3));
    this.geo.setIndex(index);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      // The ribbon's winding depends on which way the line runs on screen.
      side: DoubleSide,
      uniforms: {
        uWidth: { value: new Vector2(LINE.near * 1.9, LINE.near * 0.75) },
        uRes: { value: new Vector2(1, 1) },
        uInk: { value: new Vector3(...C.ink) },
        uWhite: { value: new Vector3(1, 1, 1) },
      },
    });
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.name = "web";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** A taut strand from `from` to `to`, or hide it with null. Viewport in CSS px. */
  set(from: Vector3 | null, to: { x: number; y: number; z: number } | null, width: number, height: number): void {
    if (!from || !to) {
      this.mesh.visible = false;
      return;
    }
    const t = this.two;
    t[0] = from.x;
    t[1] = from.y;
    t[2] = from.z;
    t[3] = to.x;
    t[4] = to.y;
    t[5] = to.z;
    this.setPoints(t, 2, width, height);
  }

  /** A strand through `count` packed xyz points (2 to MAX_POINTS), or hide it with count < 2. */
  setPoints(points: Float32Array, count: number, width: number, height: number, widthScale = 1): void {
    const n = Math.min(count, MAX_POINTS);
    if (n < 2 || widthScale <= 0.01) {
      this.mesh.visible = false;
      return;
    }
    const segs = n - 1;
    for (let layer = 0; layer < 2; layer++) {
      for (let s = 0; s < segs; s++) {
        const i0 = s * 3;
        const i1 = (s + 1) * 3;
        const base = (layer * SEGS + s) * 4;
        for (let k = 0; k < 4; k++) {
          const o = (base + k) * 3;
          this.a[o] = points[i0];
          this.a[o + 1] = points[i0 + 1];
          this.a[o + 2] = points[i0 + 2];
          this.b[o] = points[i1];
          this.b[o + 1] = points[i1 + 1];
          this.b[o + 2] = points[i1 + 2];
        }
      }
    }
    this.aAttr.needsUpdate = true;
    this.bAttr.needsUpdate = true;
    this.geo.setDrawRange(0, segs * 12);
    const u = this.material.uniforms;
    (u.uRes.value as Vector2).set(width / 2, height / 2);
    (u.uWidth.value as Vector2).set(LINE.near * 1.9 * widthScale, LINE.near * 0.75 * widthScale);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
