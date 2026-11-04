/**
 * Warm light spilling on the roofs: a flat pool of lamplight on the deck in front of every
 * roof door (its lamp is over the door, city/shaders.ts) and a paler wash under every
 * billboard's lit face. Comic light, not falloff: two flat bands (a brighter core, a fainter
 * ring) whose outer edge breaks up into Ben-Day dots, laid over the roof as a tint.
 *
 * One instanced draw for the whole city, blended after the opaque pass, faded out
 * by distance before the far fog bands. Shown on tiers with material lights; hidden (no draw
 * call) on low.
 */
import { BufferGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial, Vector3 } from "three";

import { CITY } from "@/game/style";

import { mixRgb, rgb, type RGB } from "../palette";
import { KIND, type BoxSpec } from "./kinds";
import type { SharedUniforms } from "./materials";

const VERTEX = /* glsl */ `
attribute vec4 aPool;   // r, g, b (the light's colour), radius
attribute float aStrength;
varying vec2 vP;
varying vec3 vLight;
varying float vStrength;
varying float vDist;
void main() {
  vP = position.xy * 2.0;
  vLight = aPool.rgb;
  vStrength = aStrength;
  vec4 world = modelMatrix * instanceMatrix * vec4(position.x * 2.0 * aPool.w, 0.0, -position.y * 2.0 * aPool.w, 1.0);
  vDist = length(world.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uDpr;
uniform float uHalftoneCell;
uniform vec2 uFade;      // distance where pools start fading, and where they're gone
varying vec2 vP;
varying vec3 vLight;
varying float vStrength;
varying float vDist;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  // The outer ring dissolves into dots toward its edge.
  float cell = uHalftoneCell * uDpr;
  vec2 g = gl_FragCoord.xy / cell;
  vec2 q = vec2(g.x + g.y, g.x - g.y) * 0.70710678;
  float d = length(fract(q) - 0.5);
  float edge = smoothstep(0.72, 1.0, r);
  if (r > 0.72 && d > mix(0.7, 0.18, edge)) discard;
  float band = r < 0.5 ? 1.0 : 0.55;
  float a = vStrength * band * (1.0 - smoothstep(uFade.x, uFade.y, vDist));
  // Premultiplied: the roof takes on the lamp's colour (alpha stays 1: a pool doesn't glow).
  gl_FragColor = vec4(vLight * a, a);
}
`;

/** Where pools go: in front of roof doors (their +z face) and under billboards' faces. */
export interface PoolSpec {
  x: number;
  y: number;
  z: number;
  r: number;
  color: RGB;
  /** How much of the light's colour the core band lays over the roof (the ring takes about half). */
  strength: number;
}

export function poolSpecs(boxes: readonly BoxSpec[]): PoolSpec[] {
  const warm = mixRgb(rgb(CITY.windowWarm), rgb(CITY.windowLit), 0.35);
  const paper = rgb(CITY.billboard);
  const out: PoolSpec[] = [];
  for (const b of boxes) {
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    if (b.kind === KIND.door) {
      const ahead = b.d / 2 + 24;
      out.push({ x: b.x + fx * ahead, y: b.y + 0.8, z: b.z + fz * ahead, r: 40, color: warm, strength: 0.3 });
    } else if (b.kind === KIND.billboard) {
      // The billboard stands on 34-unit legs; its light falls on the roof in front.
      const ahead = b.d / 2 + 30;
      out.push({ x: b.x + fx * ahead, y: b.y - 34 + 0.8, z: b.z + fz * ahead, r: Math.min(78, b.w * 0.5), color: paper, strength: 0.18 });
    }
  }
  return out;
}

export class LightPools {
  readonly mesh: InstancedMesh;
  private readonly geo: BufferGeometry;
  private readonly quad: PlaneGeometry;
  private readonly material: ShaderMaterial;

  constructor(boxes: readonly BoxSpec[], shared: SharedUniforms) {
    const pools = poolSpecs(boxes);
    const n = Math.max(1, pools.length);
    this.quad = new PlaneGeometry(1, 1);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", this.quad.getAttribute("position"));
    this.geo.setIndex(this.quad.getIndex());
    const attr = new Float32Array(n * 4);
    const strength = new Float32Array(n);
    pools.forEach((p, i) => {
      attr.set([...p.color, p.r], i * 4);
      strength[i] = p.strength;
    });
    this.geo.setAttribute("aPool", new InstancedBufferAttribute(attr, 4));
    this.geo.setAttribute("aStrength", new InstancedBufferAttribute(strength, 1));
    this.material = new ShaderMaterial({
      name: "wgp-light-pools",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uDpr: shared.uDpr, uHalftoneCell: shared.uHalftoneCell, uFade: { value: [1300, 2600] } },
    });
    this.mesh = new InstancedMesh(this.geo, this.material, n);
    this.mesh.name = "light-pools";
    const m = new Matrix4();
    const p = new Vector3();
    pools.forEach((pool, i) => this.mesh.setMatrixAt(i, m.makeTranslation(p.set(pool.x, pool.y, pool.z))));
    this.mesh.count = pools.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  setVisible(on: boolean): void {
    this.mesh.visible = on && this.mesh.count > 0;
  }

  dispose(): void {
    this.quad.dispose();
    this.geo.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
