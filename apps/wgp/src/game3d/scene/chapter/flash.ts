/**
 * SCREENSHOT, in 3D:
 *
 * - `AimCone`: while the Right-Clicker aims, the cone (the frame villain's `aim`: direction and
 *   half-angle) lies on the deck as a decal: a red hatch that fills outward as the shot
 *   charges, an inked rim, brighter when the hero stands in it; on the flash it goes white and
 *   fades. Reduced motion: the hatch doesn't crawl, and the flash is a white rim, not a fill.
 * - `ScreenFlash`: the camera flash over the whole frame, once, fading in a third of a second
 *   (photosensitive-safe: one flash per shot, well under three a second). Under reduced motion
 *   or the Steady camera there's no full-screen flash: a viewfinder outline round the frame's
 *   edge pulses once instead.
 *
 * One draw each, and none while there's nothing to show.
 */
import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from "three";

import type { SharedUniforms } from "../city/materials";
import { C, rgb } from "../palette";
import { CONE_RANGE, flashAlpha, pulseAlpha } from "./math";

const CONE_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CONE_FRAGMENT = /* glsl */ `
uniform float uHalf;
uniform float uCharge;
uniform float uFlash;
uniform float uHot;
uniform float uTime;
uniform float uStill;
uniform float uDpr;
uniform vec3 uRed;
uniform vec3 uInk;
varying vec2 vP;  // x across, y along the cone, in units of its range
void main() {
  float r = length(vP);
  float ang = atan(vP.x, vP.y);
  if (vP.y < 0.0 || r > 1.0 || abs(ang) > uHalf) discard;
  // Distances to the rim, in CSS px.
  float pxw = max(length(fwidth(vP)), 1e-5) * uDpr;
  float side = (uHalf - abs(ang)) * r / pxw;
  float end = (1.0 - r) / pxw;
  float rim = min(side, end);
  float hatch = step(0.5, fract((vP.y * 0.8 + vP.x * 0.6) * 22.0 - (uStill > 0.5 ? 0.0 : uTime * 1.6)));
  float filled = step(r, uCharge);
  vec3 col = uRed;
  float a = (0.1 + 0.16 * hatch) * (0.45 + 0.55 * filled) * (0.75 + 0.5 * uHot);
  if (rim < 2.5) {
    col = uInk;
    a = 0.85;
  } else if (rim < 5.0) {
    col = uRed;
    a = 0.9;
  }
  // The shot: the cone goes white (a white rim only, under reduced motion).
  if (uFlash > 0.0) {
    if (uStill > 0.5) {
      if (rim < 6.0) col = mix(col, vec3(1.0), uFlash);
    } else {
      col = mix(col, vec3(1.0), uFlash);
      a = mix(a, 0.85, uFlash);
    }
  }
  gl_FragColor = vec4(col, a);
}
`;

const _v = new Vector3();

export class AimCone {
  readonly mesh: Mesh;
  private readonly geo: PlaneGeometry;
  private readonly mat: ShaderMaterial;
  reducedMotion = false;

  constructor(shared: SharedUniforms) {
    // A square two ranges wide, the cone's apex at its centre; lying on the floor, +y along the cone.
    this.geo = new PlaneGeometry(2, 2);
    this.mat = new ShaderMaterial({
      name: "wgp-chapter-aim-cone",
      vertexShader: CONE_VERTEX,
      fragmentShader: CONE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: {
        uHalf: { value: 0.3 },
        uCharge: { value: 0 },
        uFlash: { value: 0 },
        uHot: { value: 0 },
        uTime: shared.uTime,
        uStill: { value: 0 },
        uDpr: shared.uDpr,
        uRed: { value: new Vector3(...rgb("#E5392C")) },
        uInk: { value: new Vector3(...C.ink) },
      },
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.name = "chapter-aim-cone";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * Lay the cone at (x, floor, z) along `dir` (xz) with half-angle `half`: `charge` 0–1, `flash`
   * 0–1 (the shot's white), `hot` 1 when the hero's in it.
   */
  show(x: number, floor: number, z: number, dir: { x: number; z: number }, half: number, charge: number, flash: number, hot: boolean): void {
    const m = this.mesh;
    m.visible = true;
    m.position.set(x, floor + 1.2, z);
    m.scale.setScalar(CONE_RANGE);
    // Flat on the floor (plane +y → world −z, its normal up), then turned so +y runs along dir.
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.rotateOnWorldAxis(_v.set(0, 1, 0), Math.atan2(dir.x, dir.z) + Math.PI);
    const u = this.mat.uniforms;
    u.uHalf.value = half;
    u.uCharge.value = charge;
    u.uFlash.value = flash;
    u.uHot.value = hot ? 1 : 0;
    u.uStill.value = this.reducedMotion ? 1 : 0;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const SCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SCREEN_FRAGMENT = /* glsl */ `
uniform float uFlash;
uniform float uPulse;
uniform vec2 uSize;   // CSS px
uniform vec3 uInk;
varying vec2 vUv;
void main() {
  if (uFlash > 0.0) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, uFlash);
    return;
  }
  // The viewfinder: a frame inset from the edge, its corners bracketed.
  vec2 p = vUv * uSize;
  vec2 e = min(p, uSize - p);
  float inset = 18.0;
  float d = min(e.x, e.y) - inset;
  vec2 c = e - inset;
  bool corner = max(c.x, c.y) < 46.0 && min(c.x, c.y) > -6.0;
  float line = corner ? abs(min(c.x, c.y) - 2.0) : abs(d);
  float w = corner ? 4.0 : 1.6;
  if (line > w + 1.5) discard;
  vec3 col = line < w ? vec3(1.0) : uInk;
  gl_FragColor = vec4(col, uPulse * (line < w ? 0.95 : 0.7));
}
`;

export class ScreenFlash {
  readonly mesh: Mesh;
  private readonly geo: PlaneGeometry;
  private readonly mat: ShaderMaterial;
  private t = -1;
  private still = false;
  reducedMotion = false;

  constructor() {
    this.geo = new PlaneGeometry(2, 2);
    this.mat = new ShaderMaterial({
      name: "wgp-chapter-screen-flash",
      vertexShader: SCREEN_VERTEX,
      fragmentShader: SCREEN_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uFlash: { value: 0 }, uPulse: { value: 0 }, uSize: { value: new Vector2(1, 1) }, uInk: { value: new Vector3(...C.ink) } },
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.name = "chapter-screen-flash";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
    this.mesh.visible = false;
  }

  /** The shot goes off: a flash, or (reduced motion, the Steady camera) the outline's pulse. */
  fire(): void {
    this.t = 0;
    this.still = this.reducedMotion;
  }

  /** Whether the last shot showed as the outline pulse (for tests and the lab). */
  get pulsed(): boolean {
    return this.still;
  }

  update(dt: number, width: number, height: number): void {
    if (this.t < 0) {
      this.mesh.visible = false;
      return;
    }
    const u = this.mat.uniforms;
    const f = this.still ? 0 : flashAlpha(this.t);
    const p = this.still ? pulseAlpha(this.t) : 0;
    u.uFlash.value = f;
    u.uPulse.value = p;
    (u.uSize.value as Vector2).set(width, height);
    this.mesh.visible = f > 0 || p > 0;
    this.t += dt;
    if (!this.mesh.visible && this.t > 0.05) this.t = -1;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
