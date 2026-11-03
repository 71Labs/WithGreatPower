/**
 * Comic speed lines: ink and paper streaks radiating from where the hero is heading, round
 * the edges of the frame, once the hero is fast. They redraw at 12 fps like a hand-drawn
 * panel and reach further in the faster the hero goes.
 *
 * One full-screen triangle drawn last, without depth; fragments are opaque or discarded, so
 * nothing blends. Hidden (no draw call) below the speed threshold, under reduced motion and
 * on tiers without it.
 *
 * The focus must always be a real number: the shader only draws a streak where its discard
 * tests fail, and every comparison with NaN fails, so a NaN focus paints the whole frame
 * ink. A hero who stops dead (stood beside an errand ally) has no vanishing point, so the
 * focus holds where it was; a camera cut clears the lines at once.
 */
import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector2, Vector3, type PerspectiveCamera } from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { C } from "../palette";

export const SPEED_LINES = {
  /** Hero speed (units/s) where the lines start and where they are at full strength. */
  from: 760,
  to: 1300,
  /** Easing of the strength (s). */
  ease: 0.25,
} as const;

const VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uStrength;
uniform vec2 uFocus;     // NDC
uniform vec2 uRes;       // drawing buffer, px
uniform float uTick;
uniform vec3 uInk;
uniform vec3 uPaper;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec2 d = (p - uFocus) * vec2(aspect, 1.0);
  float r = length(d);
  float turns = atan(d.y, d.x) / 6.2831853 + 0.5;
  float N = 120.0;
  float k = floor(turns * N);
  float f = fract(turns * N) - 0.5;
  float h = hash(k * 12.9898 + uTick * 78.233);
  if (h > 0.18 + 0.42 * uStrength) discard;
  // Where the streak starts: the frame's edge at low strength, further in at full.
  float reach = sqrt(aspect * aspect + 1.0);
  float start = reach * mix(0.92, 0.5, uStrength) + hash(k * 3.17 + uTick) * 0.3 * reach;
  if (r < start) discard;
  // Thin at the inner tip, widening outward.
  float hw = (r - start) * (0.012 + 0.02 * hash(k * 5.31 + uTick * 1.7)) + 0.0015;
  float dist = abs(f) * (6.2831853 / N) * r;
  if (dist > hw) discard;
  bool paper = hash(k * 7.77 + uTick * 3.1) < 0.4;
  float border = 1.6 / uRes.y * 2.0;
  gl_FragColor = vec4(paper && dist < hw - border ? uPaper : uInk, 1.0);
}
`;

const _v = new Vector3();
const clampFocus = (v: number) => Math.max(-0.6, Math.min(0.6, v));

/**
 * The vanishing point of motion along `vel` (NDC, kept within ±0.6 of the centre; the centre
 * when the motion points behind the camera), written into `out`. False, and `out` left as it
 * was, when there's no direction to project: a stopped hero (projecting the camera's own
 * position divides by zero) or a projection that isn't finite.
 */
export function motionFocus(vel: Vec3, camera: PerspectiveCamera, out: Vector2): boolean {
  const len = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  if (!(len > 1e-3) || !Number.isFinite(len)) return false;
  _v.set(vel.x / len, vel.y / len, vel.z / len).multiplyScalar(1000).add(camera.position).project(camera);
  if (!Number.isFinite(_v.x) || !Number.isFinite(_v.y) || !Number.isFinite(_v.z)) return false;
  const behind = _v.z > 1;
  out.set(behind ? 0 : clampFocus(_v.x), behind ? 0 : clampFocus(_v.y));
  return true;
}

export class SpeedLines {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private strength = 0;
  enabled = true;

  constructor() {
    const geo = new BufferGeometry();
    // One triangle that covers the screen.
    geo.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.material = new ShaderMaterial({
      name: "wgp-speed-lines",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uStrength: { value: 0 },
        uFocus: { value: new Vector2() },
        uRes: { value: new Vector2(1, 1) },
        uTick: { value: 0 },
        uInk: { value: new Vector3(...C.ink) },
        uPaper: { value: new Vector3(...C.paper) },
      },
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = "speed-lines";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
  }

  /** Per frame, after the camera moved: the hero's velocity (null: no run), buffer size. */
  update(vel: Vec3 | null, camera: PerspectiveCamera, width: number, height: number, dt: number, time: number): void {
    const speed = vel && this.enabled ? Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) : 0;
    const want = Math.min(1, Math.max(0, (speed - SPEED_LINES.from) / (SPEED_LINES.to - SPEED_LINES.from)));
    this.strength += (want - this.strength) * (1 - Math.exp(-Math.max(0, dt) / SPEED_LINES.ease));
    if (!this.enabled) this.strength = 0;
    const on = this.strength > 0.02;
    this.mesh.visible = on;
    if (!on || !vel) return;
    const u = this.material.uniforms;
    u.uStrength.value = this.strength;
    u.uRes.value.set(Math.max(1, width), Math.max(1, height));
    u.uTick.value = Math.floor(time * 12) % 97;
    // The vanishing point of the motion; a stopped hero keeps the last one while the lines fade.
    motionFocus(vel, camera, u.uFocus.value);
  }

  /** A camera cut: the lines belong to the last shot's motion, so they go at once. */
  reset(): void {
    this.strength = 0;
    this.mesh.visible = false;
  }

  /** The current strength (0–1), for tests. */
  get level(): number {
    return this.strength;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
