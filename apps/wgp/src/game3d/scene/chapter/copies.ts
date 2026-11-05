/**
 * The Right-Clicker's paper copies (CTRL+C): cardboard cut-outs of the hero, die-cut on a card
 * border with an ink rim (media/chapters/case-001-copy-tex.webp, made from the hero's own
 * render by launch/brand/hero/case001_textures.py), standing where the frame puts them, each
 * on its own slight wobble. The front is the print, a little posterised (they're copies).
 * The back is unmistakably a standee's: dark kraft with strong flutes, inked all round the
 * die-cut edge, an easel strut with its foot up the middle (seen through the legs from the
 * front too), and a red cursor stamp on the shoulders; never a pale body seen from behind.
 * A new copy pops up like a pop-up book; a popped one is gone (the confetti is
 * particles.ts). One instanced draw for all of them.
 *
 * Low tier: no wobble, no pop-up, no posterising. Reduced motion: no wobble, no pop-up.
 */
import { DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector2, Vector3, type Texture } from "three";

import type { SharedUniforms } from "../city/materials";
import { KEY_LIGHT } from "../characters/materials";
import { C } from "../palette";
import type { ChapterCopy } from "./contract";
import { copyWobble, smooth } from "./math";
import { CURSOR_SDF, FOG_PARS } from "./shaders";

/** A copy is the hero's height (88 units), the cut-out's aspect wide. */
export const COPY_HEIGHT = 92;
export const COPY_ASPECT = 256 / 411;
/** The cut-out texture's size (case001_textures.py), for its edge's ink. */
const TEX_W = 256;
const TEX_H = 411;
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
uniform vec2 uTexel;
uniform vec3 uCard;
uniform vec3 uStrut;
uniform vec3 uStamp;
uniform vec3 uInk;
uniform vec3 uLight;
uniform float uDpr;
uniform float uAspect;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vPost;
${FOG_PARS}
${CURSOR_SDF}

// The easel strut, in the back's own uv (b: x mirrored, as seen from behind), in copy heights
// (x scaled by the aspect): a tapering leg up the middle from the floor to under the waist, and
// a wider foot on the floor. Negative inside.
float strutD(vec2 b) {
  vec2 p = vec2((b.x - 0.5) * uAspect, b.y);
  float hw = mix(0.042, 0.026, clamp(p.y / 0.46, 0.0, 1.0));
  float leg = max(abs(p.x) - hw, max(-p.y, p.y - 0.46));
  float foot = max(abs(p.x) - 0.1, max(-p.y, p.y - 0.032));
  return min(leg, foot);
}

void main() {
  vec4 tex = texture2D(uMap, vUv);
  vec2 b = vec2(1.0 - vUv.x, vUv.y);
  // One CSS pixel in copy heights, for ink lines a fixed width on screen.
  float px = max(fwidth(vUv.y), 1e-5) * uDpr;
  float sd = strutD(b);
  bool card = tex.a >= 0.5;
  if (!card && sd > 0.0) discard;
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  vec3 col;
  if (!card) {
    // The strut, seen through the gap between the legs (from either side).
    col = -sd < 1.6 * px ? uInk : uStrut;
  } else if (gl_FrontFacing) {
    col = tex.rgb;
    if (vPost > 0.5) {
      // A cheap copy: fewer colours, in visible 8×8 screen blocks.
      vec2 blk = floor(gl_FragCoord.xy / (8.0 * uDpr));
      float h = fract(sin(dot(blk, vec2(127.1, 311.7))) * 43758.5453);
      col = floor(col * 7.0 + h * 0.8) / 7.0;
    }
  } else {
    // Corrugated kraft: strong flutes, evened out where they'd shimmer (sub-pixel).
    float u = vUv.x * 46.0;
    float flute = 0.8 + 0.2 * step(0.5, fract(u));
    flute = mix(flute, 0.9, smoothstep(0.3, 0.7, fwidth(u)));
    col = uCard * flute;
    // The strut over it.
    if (sd < 0.0) col = -sd < 1.6 * px ? uInk : uStrut;
    // A stamp on the shoulders: a red cursor in a rounded box (Ctrl+C'd).
    vec2 q = vec2((b.x - 0.5) * uAspect, b.y - 0.66);
    float a = -0.2;
    q = vec2(cos(a) * q.x - sin(a) * q.y, sin(a) * q.x + cos(a) * q.y);
    vec2 box = abs(q) - vec2(0.05, 0.062);
    float boxD = length(max(box + 0.012, 0.0)) + min(max(box.x + 0.012, box.y + 0.012), 0.0) - 0.012;
    float s = 0.0042;
    float cur = sdCursor(vec2(q.x / s + 6.0, -q.y / s + 10.0)) * s;
    float stamp = max(step(abs(boxD), 1.4 * max(px, 0.0025)), step(cur, 0.0));
    col = mix(col, uStamp, stamp * 0.85);
    // The die-cut edge: any clear texel a few out (the print's own ink rim's width, or two
    // pixels on screen, whichever is wider) is the outside, so ink.
    vec2 o = max(uTexel * 2.5, fwidth(vUv) * 2.0 * uDpr);
    float edge = min(min(texture2D(uMap, vUv + vec2(o.x, 0.0)).a, texture2D(uMap, vUv - vec2(o.x, 0.0)).a), min(texture2D(uMap, vUv + vec2(0.0, o.y)).a, texture2D(uMap, vUv - vec2(0.0, o.y)).a));
    if (edge < 0.5) col = uInk;
  }
  // Lit like the night's props (a shade off the key light), never brighter than the card.
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
        uTexel: { value: new Vector2(1 / TEX_W, 1 / TEX_H) },
        uAspect: { value: COPY_ASPECT },
        // Dark, warm kraft (a standee's back at night), its strut darker still, the stamp red.
        uCard: { value: new Vector3(0.62, 0.45, 0.27) },
        uStrut: { value: new Vector3(0.42, 0.29, 0.17) },
        uStamp: { value: new Vector3(0.72, 0.16, 0.12) },
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
