/**
 * The Right-Clicker's paper copies (CTRL+C): cardboard cut-outs of the hero, die-cut on a card
 * border with an ink rim (media/chapters/case-001-copy-tex.webp, made from the hero's own
 * render by launch/brand/hero/case001_textures.py), standing where the frame puts them, each
 * on its own slight wobble. The front is the print, a little posterised (they're copies);
 * the back is bare corrugated card. A new copy pops up like a pop-up book; a popped one is
 * gone (the confetti is particles.ts). One instanced draw for all of them.
 *
 * Low tier: no wobble, no pop-up, no posterising. Reduced motion: no wobble, no pop-up.
 */
import { DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, type Texture } from "three";

import type { SharedUniforms } from "../city/materials";
import { KEY_LIGHT } from "../characters/materials";
import { C } from "../palette";
import type { ChapterCopy } from "./contract";
import { copyWobble, smooth } from "./math";
import { FOG_PARS } from "./shaders";

/** A copy is the hero's height (88 units), the cut-out's aspect wide. */
export const COPY_HEIGHT = 92;
export const COPY_ASPECT = 256 / 411;
const MAX = 8;
/** Seconds a new copy takes to pop up. */
const POP_UP = 0.28;

const VERTEX = /* glsl */ `
attribute float aPost;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vPost;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vUv = uv;
  vPost = aPost;
  vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uCard;
uniform vec3 uInk;
uniform vec3 uLight;
uniform float uDpr;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vPost;
${FOG_PARS}
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  vec3 n = normalize(vNormalW);
  vec3 col;
  if (gl_FrontFacing) {
    col = tex.rgb;
    if (vPost > 0.5) {
      // A cheap copy: fewer colours, in visible 8×8 screen blocks.
      vec2 blk = floor(gl_FragCoord.xy / (8.0 * uDpr));
      float h = fract(sin(dot(blk, vec2(127.1, 311.7))) * 43758.5453);
      col = floor(col * 7.0 + h * 0.8) / 7.0;
    }
  } else {
    n = -n;
    // Bare corrugated card, the cut's rim inked.
    float flute = 0.92 + 0.08 * step(0.5, fract(vUv.x * 46.0));
    col = uCard * flute;
    if (tex.r < 0.16 && tex.g < 0.16 && tex.b < 0.16) col = uInk;
  }
  float l = dot(n, uLight);
  col *= l > 0.0 ? 1.0 : 0.82;
  gl_FragColor = vec4(mix(col, uFog, fogAmount(vWorld) * 0.5), 1.0);
}
`;

interface Live {
  id: number;
  bornAt: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

export class PaperCopies {
  readonly mesh: InstancedMesh;
  private readonly geo: PlaneGeometry;
  private readonly mat: ShaderMaterial;
  private readonly post: InstancedBufferAttribute;
  private readonly live = new Map<number, Live>();
  reducedMotion = false;
  /** The light tier: still, no posterising. */
  light = false;

  constructor(shared: SharedUniforms, map: Texture) {
    this.geo = new PlaneGeometry(COPY_HEIGHT * COPY_ASPECT, COPY_HEIGHT);
    // The base at the origin, so it leans and pops up from its feet.
    this.geo.translate(0, COPY_HEIGHT / 2, 0);
    this.post = new InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aPost", this.post);
    this.mat = new ShaderMaterial({
      name: "wgp-chapter-copies",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      uniforms: {
        uMap: { value: map },
        uCard: { value: new Vector3(0.78, 0.66, 0.47) },
        uInk: { value: new Vector3(...C.ink) },
        uLight: { value: KEY_LIGHT.clone() },
        uDpr: shared.uDpr,
        uFog: shared.uFog,
        uFogBands: shared.uFogBands,
        uFogAmt: shared.uFogAmt,
      },
    });
    this.mesh = new InstancedMesh(this.geo, this.mat, MAX);
    this.mesh.name = "chapter-copies";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** A copy-spawn: pop it up from now (it may already be standing in the frame). */
  spawn(id: number, time: number): void {
    this.live.set(id, { id, bornAt: time });
  }

  /**
   * Stand this frame's live copies. `ground(x, z, y)` is the floor under a point. Returns the
   * ids that were standing last frame and aren't now (popped, or gone from the list).
   */
  update(copies: readonly ChapterCopy[], ground: (x: number, z: number, y: number) => number, time: number, out: number[]): number[] {
    out.length = 0;
    const seen = new Set<number>();
    let n = 0;
    const still = this.reducedMotion || this.light;
    for (const c of copies) {
      if (!c.alive) continue;
      seen.add(c.id);
      let l = this.live.get(c.id);
      if (!l) {
        l = { id: c.id, bornAt: time };
        this.live.set(c.id, l);
      }
      if (n >= MAX) continue;
      const age = time - l.bornAt;
      const up = still ? 1 : popUp(age / POP_UP);
      const [lean, sway] = still ? [0, 0] : copyWobble(c.id, time);
      _q.setFromAxisAngle(Y, c.yaw + sway);
      _q.multiply(_q2.setFromAxisAngle(X, lean));
      _p.set(c.pos.x, ground(c.pos.x, c.pos.z, c.pos.y + 4) + 0.5, c.pos.z);
      _s.set(1, Math.max(0.05, up), 1);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.post.setX(n, this.light ? 0 : 1);
      n++;
    }
    for (const id of this.live.keys()) {
      if (!seen.has(id)) {
        out.push(id);
        this.live.delete(id);
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.post.needsUpdate = true;
    }
    return out;
  }

  clear(): void {
    this.live.clear();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

/** The pop-up: 0 → a little past 1 → 1. */
function popUp(u: number): number {
  if (u >= 1) return 1;
  const a = smooth(u);
  return a + Math.sin(Math.PI * a) * 0.18;
}
