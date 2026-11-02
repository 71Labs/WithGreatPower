/**
 * Doc Octochain's four chain arms. Each arm is a Verlet chain from a socket on his harness
 * to the tip the sim says the arm reaches (a telescoping chain: its links lengthen with the
 * sim's arm length, plus a little slack so the middle sags under gravity). Every sub-step
 * integrates the links (inertia, gravity), then FABRIK passes hold the root on the socket,
 * reach the tip for the target and keep every link its length.
 *
 * Drawn as instanced steel links, alternate ones turned a quarter, with a three-prong claw
 * at each tip, cel-shaded with an inked hull: two draw calls for all four arms.
 */
import { BackSide, DynamicDrawUsage, FrontSide, Group, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, TorusGeometry, Vector3 } from "three";

import type { SharedUniforms } from "../city/materials";
import { C, rgb } from "../palette";
import { KEY_LIGHT, SHADE_DARK, SHADE_MID } from "./materials";
import { fabrik } from "./physics/ik";
import { FixedStepper } from "./physics/stepper";
import { Verlet } from "./physics/verlet";

export const ARMS = 4;
export const POINTS = 12;
const PRONGS = 3;
const PER_ARM = POINTS - 1 + PRONGS;
const SLACK = 1.07;

const VERTEX = /* glsl */ `
varying vec3 vN;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uSteel;
uniform vec3 uLight;
uniform vec3 uShadeMid;
uniform vec3 uShadeDark;
varying vec3 vN;
void main() {
  float l = dot(normalize(vN), uLight);
  vec3 shade = l > 0.16 ? vec3(1.0) : l > -0.4 ? uShadeMid : uShadeDark;
  gl_FragColor = vec4(uSteel * shade, 1.0);
}
`;

const HULL_VERTEX = /* glsl */ `
uniform float uPxScale;
uniform vec4 uHullPx;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 world = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  float depth = max(1.0, -(viewMatrix * world).z);
  float px = mix(uHullPx.x, uHullPx.y, smoothstep(uHullPx.z, uHullPx.w, depth)) * 0.8;
  world.xyz += n * px * depth * uPxScale;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const HULL_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 1.0); }
`;

const _m = new Matrix4();
const _q = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _w = new Vector3();
const _v = new Vector3();

export class DocChains {
  readonly group = new Group();
  readonly v = new Verlet(ARMS * POINTS, { gravity: 1750, damping: 0.06 });
  private readonly fill: InstancedMesh;
  private readonly hull: InstancedMesh;
  private readonly geo: TorusGeometry;
  private readonly matFill: ShaderMaterial;
  private readonly matHull: ShaderMaterial;
  private readonly clock = new FixedStepper();
  private readonly lengths = new Float32Array(POINTS - 1);
  private readonly linkLen = new Float32Array(ARMS);
  private readonly tips: Vector3[] = Array.from({ length: ARMS }, () => new Vector3());
  private readonly roots: Vector3[] = Array.from({ length: ARMS }, () => new Vector3());
  /** Which socket each arm hangs from. */
  private order = [0, 1, 2, 3];
  private started = false;

  constructor(shared: SharedUniforms) {
    this.geo = new TorusGeometry(1, 0.34, 3, 6);
    this.matFill = new ShaderMaterial({
      name: "wgp-chain",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: FrontSide,
      uniforms: {
        uSteel: { value: new Vector3(...rgb("#AEB4BD")) },
        uLight: { value: KEY_LIGHT.clone() },
        uShadeMid: { value: new Vector3(...SHADE_MID) },
        uShadeDark: { value: new Vector3(...SHADE_DARK) },
      },
    });
    this.matHull = new ShaderMaterial({
      name: "wgp-chain-hull",
      vertexShader: HULL_VERTEX,
      fragmentShader: HULL_FRAGMENT,
      side: BackSide,
      uniforms: { uPxScale: shared.uPxScale, uHullPx: shared.uHullPx, uInk: { value: new Vector3(...C.ink) } },
    });
    const n = ARMS * PER_ARM;
    this.fill = new InstancedMesh(this.geo, this.matFill, n);
    this.hull = new InstancedMesh(this.geo, this.matHull, n);
    for (const m of [this.fill, this.hull]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.renderOrder = 1;
    }
    this.fill.name = "doc-chains";
    this.hull.name = "doc-chains-ink";
    this.group.add(this.fill, this.hull);
    this.group.visible = false;
    for (let a = 0; a < ARMS; a++) this.v.pin(a * POINTS);
  }

  /** Assign arms to sockets so the chains don't cross: the cheapest of all 24 pairings. */
  private pair(sockets: Vector3[], tips: Vector3[]): void {
    let best = Infinity;
    const perm = [0, 1, 2, 3];
    const walk = (k: number) => {
      if (k === ARMS) {
        let cost = 0;
        for (let i = 0; i < ARMS; i++) cost += sockets[perm[i]].distanceTo(tips[i]);
        if (cost < best - 1) {
          best = cost;
          this.order = perm.slice();
        }
        return;
      }
      for (let i = k; i < ARMS; i++) {
        [perm[k], perm[i]] = [perm[i], perm[k]];
        walk(k + 1);
        [perm[k], perm[i]] = [perm[i], perm[k]];
      }
    };
    walk(0);
  }

  /**
   * Step the chains: roots in world space (the sim's shoulders, in arm order, or the body's
   * sockets, which get paired to the tips), and the sim's tips. `dt` is the frame time; the
   * chain runs on its own fixed sub-step.
   */
  update(dt: number, sockets: Vector3[], tips: Vector3[] | null, visible: boolean, paired = false): void {
    this.group.visible = visible;
    if (!visible || !tips) {
      this.started = false;
      return;
    }
    if (!this.started) {
      if (paired) this.order = [0, 1, 2, 3];
      else this.pair(sockets, tips);
      for (let a = 0; a < ARMS; a++) {
        const s = sockets[this.order[a]];
        for (let i = 0; i < POINTS; i++) {
          _a.copy(s).lerp(tips[a], i / (POINTS - 1));
          this.v.place(a * POINTS + i, _a.x, _a.y, _a.z);
        }
        this.linkLen[a] = (s.distanceTo(tips[a]) * SLACK) / (POINTS - 1);
      }
      this.started = true;
    }
    for (let a = 0; a < ARMS; a++) {
      this.roots[a].copy(sockets[this.order[a]]);
      this.tips[a].copy(tips[a]);
    }
    this.clock.advance(dt, (h) => this.substep(h));
    this.draw(this.clock.alpha);
  }

  private substep(h: number): void {
    const v = this.v;
    for (let a = 0; a < ARMS; a++) {
      const r = this.roots[a];
      v.moveTo(a * POINTS, r.x, r.y, r.z);
    }
    v.integrate(h);
    for (let a = 0; a < ARMS; a++) {
      // The links follow the sim's arm length (a telescoping chain), with slack to sag.
      const want = (this.roots[a].distanceTo(this.tips[a]) * SLACK) / (POINTS - 1);
      this.linkLen[a] += (Math.max(2, want) - this.linkLen[a]) * Math.min(1, h * 14);
      this.lengths.fill(this.linkLen[a]);
      const t = this.tips[a];
      fabrik(v.pos, POINTS, this.lengths, t.x, t.y, t.z, 3, 0.05, a * POINTS * 3);
    }
  }

  private draw(alpha: number): void {
    const v = this.v;
    let n = 0;
    for (let a = 0; a < ARMS; a++) {
      const L = this.linkLen[a];
      for (let i = 0; i < POINTS - 1; i++) {
        const p = v.sample(a * POINTS + i, alpha, _a);
        const q = v.sample(a * POINTS + i + 1, alpha, _b);
        const len = p.distanceTo(q);
        _y.copy(q).sub(p).divideScalar(len || 1);
        this.linkMatrix(_y, i % 2 === 1, p.add(q).multiplyScalar(0.5), Math.max(len, L * 0.6), n++);
      }
      // The claw: three prongs splayed from the tip along the last link.
      const tip = v.sample(a * POINTS + POINTS - 1, alpha, _a);
      const dir = _y.copy(tip).sub(v.sample(a * POINTS + POINTS - 2, alpha, _b)).normalize();
      perpendicular(dir, _x);
      for (let k = 0; k < PRONGS; k++) {
        _q.setFromAxisAngle(dir, (k / PRONGS) * Math.PI * 2);
        const out = _z.copy(_x).applyQuaternion(_q);
        const pd = _b.copy(dir).multiplyScalar(0.85).addScaledVector(out, 0.5).normalize();
        this.prong(pd, tip, n++);
      }
    }
    this.fill.count = n;
    this.hull.count = n;
    this.fill.instanceMatrix.needsUpdate = true;
    this.hull.instanceMatrix.needsUpdate = true;
  }

  /** A link along `dir` centred on `at`, `len` long, turned a quarter on odd links. */
  private linkMatrix(dir: Vector3, turned: boolean, at: Vector3, len: number, i: number): void {
    perpendicular(dir, _x);
    if (turned) _x.cross(dir).normalize();
    _z.copy(_x).cross(dir);
    const w = Math.max(2.2, len * 0.28);
    const l = len * 0.62;
    _m.makeBasis(_x.multiplyScalar(w), _w.copy(dir).multiplyScalar(l), _z.multiplyScalar(w * 0.7)).setPosition(at);
    this.fill.setMatrixAt(i, _m);
    this.hull.setMatrixAt(i, _m);
  }

  private prong(dir: Vector3, tip: Vector3, i: number): void {
    perpendicular(dir, _x);
    _z.copy(_x).cross(dir);
    _m.makeBasis(_x.multiplyScalar(1.6), _w.copy(dir).multiplyScalar(5.5), _z.multiplyScalar(1.1)).setPosition(_v.copy(tip).addScaledVector(dir, 6));
    this.fill.setMatrixAt(i, _m);
    this.hull.setMatrixAt(i, _m);
  }

  /** Verlet points (debug). */
  points(): Float32Array {
    return this.v.pos;
  }

  dispose(): void {
    this.geo.dispose();
    this.matFill.dispose();
    this.matHull.dispose();
    this.fill.dispose();
    this.hull.dispose();
  }
}

/** A unit vector perpendicular to the unit vector `d`. */
function perpendicular(d: Vector3, out: Vector3): Vector3 {
  if (Math.abs(d.y) < 0.9) out.set(0, 1, 0);
  else out.set(1, 0, 0);
  return out.addScaledVector(d, -out.dot(d)).normalize();
}
