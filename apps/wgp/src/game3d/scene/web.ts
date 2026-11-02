/**
 * The web line: a white strand over a wider ink strand, as two screen-space ribbons in one
 * draw call (the 2D renderer's `line(…, lw·1.9, INK)` then `line(…, lw·0.75, webLine)`).
 * Widths are CSS px so the line reads the same near or far; the ends are square-capped by
 * half a width so the ink wraps the white at the hand and the anchor.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector2, Vector3 } from "three";

import { LINE } from "@/game/style";

import { C } from "./palette";

const VERTEX = /* glsl */ `
attribute vec3 aRib;     // end (0 hand, 1 anchor), side (−1, +1), layer (0 ink, 1 white)
uniform vec3 uA;
uniform vec3 uB;
uniform vec2 uWidth;     // ink, white (CSS px)
uniform vec2 uRes;       // half the viewport (CSS px)
varying float vLayer;
void main() {
  vec4 a = projectionMatrix * viewMatrix * vec4(uA, 1.0);
  vec4 b = projectionMatrix * viewMatrix * vec4(uB, 1.0);
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

  constructor() {
    const rib: number[] = [];
    for (const layer of [0, 1]) for (const [end, side] of [[0, -1], [0, 1], [1, 1], [1, -1]]) rib.push(end, side, layer);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", new BufferAttribute(new Float32Array(24), 3));
    this.geo.setAttribute("aRib", new BufferAttribute(new Float32Array(rib), 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      // The ribbon's winding depends on which way the line runs on screen.
      side: DoubleSide,
      uniforms: {
        uA: { value: new Vector3() },
        uB: { value: new Vector3() },
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

  /** Show the web from the hand to the anchor, or hide it with null. Viewport in CSS px. */
  set(from: Vector3 | null, to: { x: number; y: number; z: number } | null, width: number, height: number): void {
    if (!from || !to) {
      this.mesh.visible = false;
      return;
    }
    const u = this.material.uniforms;
    (u.uA.value as Vector3).copy(from);
    (u.uB.value as Vector3).set(to.x, to.y, to.z);
    (u.uRes.value as Vector2).set(width / 2, height / 2);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
