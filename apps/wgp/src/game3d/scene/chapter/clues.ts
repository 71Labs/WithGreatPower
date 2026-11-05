/**
 * Case file 001's three clues, where the frame's `chapter.clues` puts them:
 *
 * - `tabs`: a street pole on the roof with the MISSING poster on it (our own poster art,
 *   media/chapters/case-001-tabs-tex.webp), every tear-off tab torn away along a ragged edge and
 *   the tabs lying round the pole's foot ("Somebody tore off a tab. Then all of them.").
 * - `cursor`: a rooftop billboard with a giant pointer-shaped scorch burnt into its ad, the
 *   char still glowing at the rim.
 * - `pixels`: a trail of chunky pixel cubes in Mary's hair red and shirt teal, bunched at the
 *   clue and thinning out toward the bridge; past the roof's edge they float, drifting.
 *
 * Each clue has a soft pickup glow (a halo and a tall beam to find it by) that dims once it's
 * found, and goes out after the investigation. Draw calls, each culled when off screen: a
 * fill and an ink hull per site with props (or the scorch on a city billboard), the crumbs,
 * and the glows while the clues are being hunted. Low tier: fewer crumbs, none floating.
 * Reduced motion: nothing bobs, spins, flickers or pulses.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Shape,
  Vector2,
  Vector3,
  BackSide,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { City, Prop, Vec3 } from "@wgp/game-core/sim3d/contract";

import { surfaceBelow, type CitySolids } from "../camera/raycast";
import type { SharedUniforms } from "../city/materials";
import { OCC_VERTEX, SCREEN_FRAGMENT } from "../city/shaders";
import { KEY_LIGHT } from "../characters/materials";
import { C, rgb, type RGB } from "../palette";
import type { ChapterClue, ClueId } from "./contract";
import { clueGlow, hash01, pixelTrail, type Crumb } from "./math";
import { BOX_FRAGMENT, BOX_VERTEX, CEL, CURSOR_SDF, FOG_PARS, HULL_FRAGMENT, HULL_VERTEX } from "./shaders";

/** Mary's colours (cast.py's palette): hair red, dark, light, the shirt's teal. */
export const MARY_COLOURS = ["#E8492F", "#C23722", "#F7774F", "#2DB3A5"];
/** Crumbs on the trail, by tier. */
export const CRUMBS = { full: 48, light: 20 } as const;
/** How far the trail runs toward the bridge (units). */
const TRAIL_LENGTH = 520;
/** The poster's paper (texture v from the bottom): the body above the tabs' line, a tab's box. */
const TAB_LINE = 0.154;
const TAB_U = 0.125;

const STEEL: RGB = rgb("#8D93A6");
const STEEL_DARK: RGB = rgb("#5D6274");
const FRAME: RGB = rgb("#3C4156");

const FILL_VERTEX = /* glsl */ `
attribute float aKind;
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vKind;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vUv = uv;
  vColor = aColor;
  vKind = aKind;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FILL_FRAGMENT = /* glsl */ `
uniform sampler2D uPoster;
uniform float uTime;
uniform float uStill;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vKind;
${CEL}
${FOG_PARS}
${CURSOR_SDF}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The billboard's ad (150 × 78 units) with the scorch: returns colour, and glow in .a.
vec4 billboard(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(150.0, 78.0);
  vec3 col = vec3(0.94, 0.9, 0.82);
  if (uv.y > 0.83) col = vec3(0.9, 0.22, 0.17);
  // A few lines of the ad's copy, off to the right.
  vec2 t = vec2(p.x - 44.0, p.y + 4.0);
  if (abs(t.x) < 22.0 && abs(t.y) < 16.0 && mod(t.y + 16.0, 8.0) < 3.6) col = mix(col, vec3(0.24, 0.26, 0.36), 0.85);
  // The pointer, tilted, burnt in: 3.3 units a cursor pixel.
  float s = 3.3;
  float a = -0.32;
  vec2 r = vec2(cos(a) * (p.x + 26.0) - sin(a) * p.y, sin(a) * (p.x + 26.0) + cos(a) * p.y);
  vec2 q = vec2(r.x / s + 6.0, -r.y / s + 10.0);
  float d = sdCursor(q) * s;
  float n = vnoise(p * 0.35) * 0.6 + vnoise(p * 1.3) * 0.4;
  float glow = 0.0;
  // The smoke's streaks: a halo stretched upward.
  float halo = 1.0 - smoothstep(2.0, 13.0 + 10.0 * n + max(0.0, p.y - r.y) * 0.0, d - max(0.0, (p.y + 10.0)) * 0.12);
  col *= 1.0 - 0.62 * halo * (0.7 + 0.3 * n);
  if (d < 2.4) col = mix(vec3(0.24, 0.15, 0.1), col, smoothstep(0.0, 2.4, d));
  if (d < 0.0) {
    col = mix(vec3(0.09, 0.07, 0.06), vec3(0.17, 0.12, 0.09), n);
    float flick = uStill > 0.5 ? 0.85 : 0.7 + 0.3 * vnoise(vec2(uTime * 3.0, p.x * 0.2));
    float ember = (1.0 - smoothstep(0.0, 1.8, -d)) * flick;
    col = mix(col, vec3(1.0, 0.48, 0.18), ember * 0.9);
    glow = ember * 0.55;
  }
  return vec4(col, glow);
}
void main() {
  vec3 col = vColor;
  float glow = 0.0;
  if (vKind > 0.5 && vKind < 1.5) col = texture2D(uPoster, vUv).rgb;
  else if (vKind > 1.5) {
    vec4 b = billboard(vUv);
    col = b.rgb;
    glow = b.a;
  }
  col = cel(col, vNormalW);
  float fog = fogAmount(vWorld) * 0.6;
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0 - glow * (1.0 - fog));
}
`;

/**
 * The scorch alone, burnt into a city billboard's face (a transparent overlay just in front of
 * it, placed in world space). It fades with the board when the city's occlusion thins the
 * board out of the way of the camera (city/shaders.ts: the board's box, `uBoard`).
 */
const SCORCH_VERTEX = /* glsl */ `
float sdBox3(vec3 p, vec3 c, vec3 h) {
  vec3 q = abs(p - c) - h;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
${OCC_VERTEX}
uniform mat4 uBoard;
varying vec2 vUv;
varying vec3 vWorld;
flat varying float vOcc;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vUv = uv;
  vWorld = world.xyz;
  vOcc = occlusion(uBoard);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SCORCH_FRAGMENT = /* glsl */ `
uniform vec2 uSize;
uniform float uTime;
uniform float uStill;
varying vec2 vUv;
varying vec3 vWorld;
flat varying float vOcc;
${SCREEN_FRAGMENT}
${FOG_PARS}
${CURSOR_SDF}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // The board thinned out of the camera's way: no scorch floating where it was.
  occDiscard(vOcc);
  if (vOcc > 0.25) discard;
  vec2 p = (vUv - 0.5) * uSize;
  // The pointer, tilted, burnt in left of the middle, sized to the board.
  float s = min(3.3, uSize.y * 0.04);
  float a = -0.32;
  vec2 o = vec2(p.x + uSize.x * 0.14, p.y);
  vec2 r = vec2(cos(a) * o.x - sin(a) * o.y, sin(a) * o.x + cos(a) * o.y);
  vec2 q = vec2(r.x / s + 6.0, -r.y / s + 10.0);
  float d = sdCursor(q) * s;
  float n = vnoise(p * 0.35) * 0.6 + vnoise(p * 1.3) * 0.4;
  // Soot round it, streaked upward; the char's rim; the char, its edge still glowing.
  float halo = 1.0 - smoothstep(2.0 * s / 3.3, (13.0 + 10.0 * n) * s / 3.3, d - max(0.0, p.y + 10.0) * 0.12);
  vec4 col = vec4(0.1, 0.07, 0.06, 0.62 * halo * (0.7 + 0.3 * n));
  if (d < 2.4) col = mix(vec4(0.24, 0.15, 0.1, 1.0), col, smoothstep(0.0, 2.4, d));
  if (d < 0.0) {
    col = vec4(mix(vec3(0.09, 0.07, 0.06), vec3(0.17, 0.12, 0.09), n), 1.0);
    float flick = uStill > 0.5 ? 0.85 : 0.7 + 0.3 * vnoise(vec2(uTime * 3.0, p.x * 0.2));
    float ember = (1.0 - smoothstep(0.0, 1.8, -d)) * flick;
    col.rgb = mix(col.rgb, vec3(1.0, 0.48, 0.18), ember * 0.9);
  }
  if (col.a < 0.01) discard;
  gl_FragColor = vec4(mix(col.rgb, uFog, fogAmount(vWorld) * 0.6), col.a);
}
`;

const GLOW_VERTEX = /* glsl */ `
attribute vec4 aGlow;  // kind (0 halo, 1 beam), strength, width, height
varying vec2 vUv;
varying vec2 vKS;
void main() {
  vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  if (aGlow.x > 0.5) {
    // The beam stands upright, turned to the camera about its own axis.
    up = vec3(0.0, 1.0, 0.0);
    vec3 toCam = cameraPosition - centre;
    right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
  }
  vec3 world = centre + right * position.x * aGlow.z + up * (position.y + (aGlow.x > 0.5 ? 0.5 : 0.0)) * aGlow.w;
  vUv = position.xy * 2.0;
  vKS = aGlow.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStill;
varying vec2 vUv;
varying vec2 vKS;
void main() {
  float a;
  if (vKS.x > 0.5) {
    // A soft column, brightest at its foot.
    float x = abs(vUv.x);
    float y = vUv.y * 0.5 + 0.5;
    a = (1.0 - smoothstep(0.0, 1.0, x)) * (1.0 - y) * 0.3;
  } else {
    float r = length(vUv);
    float pulse = uStill > 0.5 ? 0.0 : 0.5 + 0.5 * sin(uTime * 3.0);
    float ring = 1.0 - smoothstep(0.03, 0.08, abs(r - (0.62 + 0.12 * pulse)));
    a = (1.0 - smoothstep(0.0, 1.0, r)) * 0.7 + ring * 0.5 * (1.0 - r);
  }
  a *= vKS.y;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

interface Site {
  id: ClueId;
  at: Vector3;
  floor: number;
  /** Which way it faces (toward where the night starts). */
  yaw: number;
  /** The city's own billboard the cursor clue stands under (the sim puts it at its foot), if any. */
  board: Prop | null;
}

const _m = new Matrix4();
const _m2 = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const Y = new Vector3(0, 1, 0);

export class ClueProps {
  readonly root = new Group();
  private readonly fillMat: ShaderMaterial;
  private readonly hullMat: ShaderMaterial;
  private readonly crumbMat: ShaderMaterial;
  private readonly glowMat: ShaderMaterial;
  private readonly cube = new BoxGeometry(1, 1, 1);
  private readonly quad = new PlaneGeometry(1, 1);
  /** Each site's props, a fill and an ink hull, culled on their own (the sites are far apart). */
  private props: Mesh[] = [];
  /** The scorch on a city billboard's face (the cursor clue under one). */
  private scorch: Mesh | null = null;
  private readonly scorchMat: ShaderMaterial;
  private crumbs: InstancedMesh | null = null;
  private readonly crumbColour: InstancedBufferAttribute;
  private readonly glows: InstancedMesh;
  private readonly glowAttr: InstancedBufferAttribute;
  private key = "";
  private sites: Site[] = [];
  private trail: (Crumb & { y: number; floating: boolean; spin: number })[] = [];
  private readonly foundAt = new Map<ClueId, number>();
  reducedMotion = false;
  light = false;

  constructor(
    shared: SharedUniforms,
    poster: Texture,
    private readonly city: City,
    private readonly solids: CitySolids,
  ) {
    this.root.name = "chapter-clues";
    const fog = { uFog: shared.uFog, uFogBands: shared.uFogBands, uFogAmt: shared.uFogAmt };
    this.fillMat = new ShaderMaterial({
      name: "wgp-chapter-props",
      vertexShader: FILL_VERTEX,
      fragmentShader: FILL_FRAGMENT,
      uniforms: { uPoster: { value: poster }, uTime: shared.uTime, uStill: { value: 0 }, uLight: { value: KEY_LIGHT.clone() }, ...fog },
    });
    this.hullMat = new ShaderMaterial({
      name: "wgp-chapter-props-hull",
      vertexShader: HULL_VERTEX,
      fragmentShader: HULL_FRAGMENT,
      side: BackSide,
      uniforms: { uPxScale: shared.uPxScale, uHullPx: shared.uHullPx, uInk: { value: new Vector3(...C.ink) }, ...fog },
    });
    this.crumbColour = new InstancedBufferAttribute(new Float32Array(CRUMBS.full * 3), 3);
    this.cube.setAttribute("aColor", this.crumbColour);
    this.crumbMat = new ShaderMaterial({
      name: "wgp-chapter-crumbs",
      vertexShader: BOX_VERTEX,
      fragmentShader: BOX_FRAGMENT,
      uniforms: { uInk: { value: new Vector3(...C.ink) }, uDpr: shared.uDpr, uGlow: { value: 0.25 }, uLight: { value: KEY_LIGHT.clone() }, ...fog },
    });
    this.glowAttr = new InstancedBufferAttribute(new Float32Array(6 * 4), 4).setUsage(DynamicDrawUsage);
    this.quad.setAttribute("aGlow", this.glowAttr);
    this.scorchMat = new ShaderMaterial({
      name: "wgp-chapter-scorch",
      vertexShader: SCORCH_VERTEX,
      fragmentShader: SCORCH_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uSize: { value: new Vector2(100, 50) },
        uBoard: { value: new Matrix4() },
        uTime: shared.uTime,
        uStill: this.fillMat.uniforms.uStill,
        uDpr: shared.uDpr,
        uHalftone: shared.uHalftone,
        uHalftoneCell: shared.uHalftoneCell,
        uOccCam: shared.uOccCam,
        uOccA: shared.uOccA,
        uOccB: shared.uOccB,
        uOccR: shared.uOccR,
        uOccHero: shared.uOccHero,
        uOccNear: shared.uOccNear,
        ...fog,
      },
    });
    this.glowMat = new ShaderMaterial({
      name: "wgp-chapter-glow",
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: new Vector3(...rgb("#FFD45E")) }, uTime: shared.uTime, uStill: { value: 0 } },
    });
    this.glows = new InstancedMesh(this.quad, this.glowMat, 6);
    this.glows.name = "chapter-clue-glows";
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 3;
    this.glows.count = 0;
    this.root.add(this.glows);
  }

  /** Where each clue's glow and "+CLUE!" sit (its floor, a little up). */
  siteOf(id: ClueId, out: Vec3): Vec3 | null {
    const s = this.sites.find((x) => x.id === id);
    if (!s) return null;
    out.x = s.at.x;
    out.y = s.floor + 60;
    out.z = s.at.z;
    return out;
  }

  /** `spent`: the investigation is over (the found clues' glows go out once they've dimmed). */
  update(clues: readonly ChapterClue[], time: number, spent = false): void {
    const key = clues.map((c) => `${c.id}:${Math.round(c.pos.x)},${Math.round(c.pos.y)},${Math.round(c.pos.z)}`).join("|") + (this.light ? "L" : "H");
    if (key !== this.key) this.build(clues, key);
    const still = this.reducedMotion;
    this.fillMat.uniforms.uStill.value = still ? 1 : 0;
    this.glowMat.uniforms.uStill.value = still ? 1 : 0;

    // Glows: a halo and a beam per clue, dimming once found.
    let n = 0;
    for (const c of clues) {
      const s = this.sites.find((x) => x.id === c.id);
      if (!s) continue;
      if (c.found && !this.foundAt.has(c.id)) this.foundAt.set(c.id, time);
      if (!c.found) this.foundAt.delete(c.id);
      if (spent && c.found && time - (this.foundAt.get(c.id) ?? time) > 1) continue;
      const g = clueGlow(c.found, c.found ? time - (this.foundAt.get(c.id) ?? time) : 0);
      _m.makeTranslation(s.at.x, s.floor + 34, s.at.z);
      this.glows.setMatrixAt(n, _m);
      this.glowAttr.setXYZW(n, 0, g, 110, 110);
      n++;
      _m.makeTranslation(s.at.x, s.floor, s.at.z);
      this.glows.setMatrixAt(n, _m);
      this.glowAttr.setXYZW(n, 1, g * (c.found ? 0.35 : 1), 36, 420);
      n++;
    }
    this.glows.count = n;
    this.glows.visible = n > 0;
    this.glows.instanceMatrix.needsUpdate = true;
    this.glowAttr.needsUpdate = true;

    // The floating crumbs drift (on the roof they lie still).
    const cr = this.crumbs;
    if (cr && !still) {
      let i = 0;
      for (const c of this.trail) {
        if (c.floating) {
          const bob = Math.sin(time * 1.3 + c.spin * 7) * 5;
          _q.setFromAxisAngle(Y, c.spin + time * 0.6);
          _m.compose(_p.set(c.x, c.y + bob, c.z), _q, _s.setScalar(c.size));
          cr.setMatrixAt(i, _m);
        }
        i++;
      }
      cr.instanceMatrix.needsUpdate = true;
    }
  }

  private build(clues: readonly ChapterClue[], key: string): void {
    this.key = key;
    this.clearMeshes();
    this.sites = clues.map((c) => {
      // The cursor clue at a city billboard's foot: that billboard, scorched.
      const board = c.id === "cursor" ? billboardAt(this.city, c.pos) : null;
      if (board) return { id: c.id, at: new Vector3(board.at.x, board.at.y, board.at.z), floor: board.at.y, yaw: (board.facing & 3) * (Math.PI / 2), board };
      // Clear of the roof's own props (a water tower, a billboard), within reach of the clue.
      const p = cluePlacement(this.city, this.solids, c.id, c.pos);
      return { id: c.id, at: new Vector3(p.x, c.pos.y, p.z), floor: p.floor, yaw: p.yaw, board: null };
    });
    for (const s of this.sites) {
      const parts: BufferGeometry[] = [];
      if (s.id === "tabs") this.pole(s, parts);
      else if (s.id === "cursor" && s.board) this.scorchOn(s.board);
      else if (s.id === "cursor") this.billboard(s, parts);
      if (!parts.length) continue;
      const geo = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!geo) continue;
      geo.setAttribute("aHullN", weldedNormals(geo));
      // A little room for the hull's push, then culled like any prop.
      geo.computeBoundingSphere();
      if (geo.boundingSphere) geo.boundingSphere.radius += 12;
      const fill = new Mesh(geo, this.fillMat);
      const hull = new Mesh(geo, this.hullMat);
      fill.name = `chapter-clue-${s.id}`;
      hull.name = `chapter-clue-${s.id}-ink`;
      for (const m of [fill, hull]) m.renderOrder = 1;
      this.props.push(fill, hull);
      this.root.add(fill, hull);
    }
    const px = this.sites.find((s) => s.id === "pixels");
    if (px) this.pixels(px);
  }

  /** The tear-off tabs: a pole, the poster with its tabs torn away, the tabs at its foot. */
  private pole(s: Site, out: BufferGeometry[]): void {
    const base = _m2.makeRotationY(s.yaw).setPosition(s.at.x, s.floor, s.at.z).clone();
    const at = (x: number, y: number, z: number, rx = 0, ry = 0, sx = 1, sy = 1, sz = 1) =>
      base.clone().multiply(new Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(Y, ry).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rx)), _s.set(sx, sy, sz)));
    out.push(piece(new CylinderGeometry(2.2, 2.4, 128, 10), at(0, 64, 0), 0, STEEL));
    out.push(piece(new CylinderGeometry(3.2, 3.2, 3, 10), at(0, 129.5, 0), 0, STEEL_DARK));
    out.push(piece(new CylinderGeometry(10, 11, 2.4, 14), at(0, 1.2, 0), 0, STEEL_DARK));
    // The poster, its bottom torn ragged where the tabs were.
    const w = 46;
    const h = (w * (750 / 512)) * (1 - TAB_LINE);
    const shape = new Shape();
    shape.moveTo(-w / 2, h);
    shape.lineTo(w / 2, h);
    const teeth = 14;
    for (let i = 0; i <= teeth; i++) {
      const x = w / 2 - (w * i) / teeth;
      const y = (i % 2 ? 1.6 : 0) + hash01(i * 3.7 + 11) * 1.6;
      shape.lineTo(x, y);
    }
    shape.closePath();
    const poster = new ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false, curveSegments: 1 });
    const uv = poster.getAttribute("uv") as BufferAttribute;
    const pos = poster.getAttribute("position");
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, TAB_LINE + (pos.getY(i) / h) * (1 - TAB_LINE));
    out.push(piece(poster, at(0, 58, 2.6), 1, [1, 1, 1]));
    // The tabs, lying round its foot (one caught on the base plate).
    const tw = 46 * TAB_U;
    const th = tw * 1.8;
    for (let i = 0; i < 7; i++) {
      const a = hash01(i * 5.1 + 2) * Math.PI * 2;
      const r = 14 + hash01(i * 2.3 + 9) * 30;
      const tab = new BoxGeometry(tw, 0.35, th);
      const tuv = tab.getAttribute("uv") as BufferAttribute;
      for (let j = 0; j < tuv.count; j++) tuv.setXY(j, 0.004 + tuv.getX(j) * (TAB_U - 0.008), tuv.getY(j) * (TAB_LINE - 0.004));
      const lift = i === 0 ? 2.6 : 0.3;
      out.push(piece(tab, at(Math.cos(a) * r, lift, Math.sin(a) * r, i === 0 ? 0.25 : 0, a * 1.7), 1, [1, 1, 1]));
    }
  }

  /** The billboard with the pointer burnt into it. */
  private billboard(s: Site, out: BufferGeometry[]): void {
    const base = new Matrix4().makeRotationY(s.yaw).setPosition(s.at.x, s.floor, s.at.z);
    const at = (x: number, y: number, z: number) => base.clone().multiply(new Matrix4().makeTranslation(x, y, z));
    for (const x of [-56, 56]) {
      out.push(piece(new BoxGeometry(4.5, 52, 4.5), at(x, 26, -3), 0, STEEL));
      out.push(piece(new BoxGeometry(3, 46, 3), at(x, 22, -16), 0, STEEL_DARK));
    }
    out.push(piece(new BoxGeometry(158, 86, 5), at(0, 52 + 41, -3), 0, FRAME));
    out.push(piece(new BoxGeometry(150, 78, 0.6), at(0, 52 + 41, -0.2), 2, [1, 1, 1]));
    // A catwalk's lip under it.
    out.push(piece(new BoxGeometry(150, 2.4, 10), at(0, 49, 2), 0, STEEL_DARK));
  }

  /** The scorch burnt into a city billboard's face (city/layout.ts: a box on 34-unit legs, its front +z). */
  private scorchOn(b: Prop): void {
    const yaw = (b.facing & 3) * (Math.PI / 2);
    const q = new Quaternion().setFromAxisAngle(Y, yaw);
    // The board's own box, as the city draws it (legs 34, base at its foot, front +z).
    (this.scorchMat.uniforms.uBoard.value as Matrix4).compose(new Vector3(b.at.x, b.at.y + 34, b.at.z), q, new Vector3(b.w, b.h, b.d));
    // In world space (an identity model matrix), so the occlusion test reads the board's box.
    const geo = new PlaneGeometry(b.w * 0.98, b.h * 0.96);
    const out = b.d / 2 + 0.8;
    geo.applyMatrix4(new Matrix4().compose(new Vector3(b.at.x + Math.sin(yaw) * out, b.at.y + 34 + b.h / 2, b.at.z + Math.cos(yaw) * out), q, new Vector3(1, 1, 1)));
    const mesh = new Mesh(geo, this.scorchMat);
    mesh.name = "chapter-clue-scorch";
    mesh.renderOrder = 2;
    (this.scorchMat.uniforms.uSize.value as Vector2).set(b.w * 0.98, b.h * 0.96);
    this.scorch = mesh;
    this.root.add(mesh);
  }

  /** The pixel trail toward the bridge. */
  private pixels(s: Site): void {
    const deck = this.city.bridge?.deck;
    const to = deck ? { x: (deck.x0 + deck.x1) / 2, y: deck.y, z: (deck.z0 + deck.z1) / 2 } : this.city.start;
    const n = this.light ? CRUMBS.light : CRUMBS.full;
    const list = pixelTrail(s.at, to, n, TRAIL_LENGTH, Math.round(s.at.x * 7 + s.at.z * 3) % 9973);
    const colours = MARY_COLOURS.map(rgb);
    this.trail = [];
    for (const c of list) {
      const g = surfaceBelow(this.solids, c.x, c.z, s.floor + 30);
      const floating = s.floor - g > 24;
      if (floating && this.light) continue;
      const spin = hash01(c.x * 0.13 + c.z * 0.07) * Math.PI * 2;
      this.trail.push({ ...c, y: floating ? s.floor + 26 + c.along * 40 : g + c.size / 2, floating, spin });
    }
    const mesh = new InstancedMesh(this.cube, this.crumbMat, Math.max(1, this.trail.length));
    mesh.name = "chapter-pixel-trail";
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.trail.forEach((c, i) => {
      _q.setFromAxisAngle(Y, c.spin);
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.setScalar(c.size));
      mesh.setMatrixAt(i, _m);
      const col = colours[c.colour];
      this.crumbColour.setXYZ(i, col[0], col[1], col[2]);
    });
    this.crumbColour.needsUpdate = true;
    mesh.count = this.trail.length;
    // Culled with the trail's own bounds (with room for the floating ones' bob).
    mesh.frustumCulled = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 24;
    this.crumbs = mesh;
    this.root.add(mesh);
  }

  private clearMeshes(): void {
    if (this.scorch) {
      this.root.remove(this.scorch);
      this.scorch.geometry.dispose();
      this.scorch = null;
    }
    for (const m of this.props) {
      this.root.remove(m);
      if (m.material === this.fillMat) m.geometry.dispose();
    }
    this.props = [];
    if (this.crumbs) {
      this.root.remove(this.crumbs);
      this.crumbs.dispose();
      this.crumbs = null;
    }
  }

  dispose(): void {
    this.clearMeshes();
    this.fillMat.dispose();
    this.hullMat.dispose();
    this.crumbMat.dispose();
    this.glowMat.dispose();
    this.scorchMat.dispose();
    this.cube.dispose();
    this.quad.dispose();
    this.glows.dispose();
  }
}

/** The city billboard whose foot is at `pos` (the sim stands the cursor clue there when one fits). */
export function billboardAt(city: City, pos: Vec3): Prop | null {
  return city.props.find((p) => p.kind === "billboard" && Math.abs(p.at.x - pos.x) < 1 && Math.abs(p.at.z - pos.z) < 1 && Math.abs(p.at.y - pos.y) < 2) ?? null;
}

/** Where a clue's prop stands and which way it faces. */
export interface CluePlace {
  x: number;
  z: number;
  floor: number;
  /** Radians, 0 facing +z. */
  yaw: number;
}

/**
 * A clue's prop: clear of the roof's own props near the clue's point, facing the night's start
 * (or the side of the roof with the most open floor in front of it, so you can walk up to it).
 */
export function cluePlacement(city: City, solids: CitySolids, id: ClueId, pos: Vec3): CluePlace {
  const floor = surfaceBelow(solids, pos.x, pos.z, pos.y + 8);
  const onFloor = (x: number, z: number) => Math.abs(surfaceBelow(solids, x, z, floor + 8) - floor) < 2;
  const spot = clearSpot(city, pos, floor, CLEARANCE[id], onFloor);
  const start = city.start;
  const pref = Math.atan2(start.x - spot.x, start.z - spot.z);
  let yaw = pref;
  let best = -1;
  for (let k = 0; k < 4; k++) {
    const a = pref + (k * Math.PI) / 2;
    let open = 0;
    for (let d = 60; d <= 240; d += 60) {
      const x = spot.x + Math.sin(a) * d;
      const z = spot.z + Math.cos(a) * d;
      if (onFloor(x, z) && propClearance(city, x, z, floor) > 28) open++;
    }
    // Three steps' room (about 180 units) is enough: then the start's side wins.
    open = Math.min(open, 3);
    if (open > best) {
      best = open;
      yaw = a;
    }
  }
  return { x: spot.x, z: spot.z, floor, yaw };
}

/** Distance from (x, z) to the nearest rooftop prop's footprint at this floor. */
function propClearance(city: City, x: number, z: number, floor: number): number {
  let best = Infinity;
  for (const p of city.props) {
    if (p.kind === "crane" || Math.abs(p.at.y - floor) > 40) continue;
    const side = p.facing % 2 === 1;
    const hw = (side ? p.d : p.w) / 2;
    const hd = (side ? p.w : p.d) / 2;
    const dx = Math.max(0, Math.abs(x - p.at.x) - hw);
    const dz = Math.max(0, Math.abs(z - p.at.z) - hd);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Room each prop needs round its foot (units): the billboard is wide, the pole thin. */
const CLEARANCE: Record<ClueId, number> = { cursor: 95, tabs: 48, pixels: 30 };
/** How far a prop may stand from its clue's point (the sim finds it within ~140). */
const MAX_SHIFT = 110;

/**
 * The spot nearest `at` (xz) at least `room` from every rooftop prop's footprint and on the same
 * floor (`onFloor`), within MAX_SHIFT; `at` itself if none is.
 */
export function clearSpot(city: City, at: Vec3, floor: number, room: number, onFloor: (x: number, z: number) => boolean): { x: number; z: number } {
  const clearance = (x: number, z: number) => propClearance(city, x, z, floor);
  if (clearance(at.x, at.z) >= room) return { x: at.x, z: at.z };
  let pick: { x: number; z: number } | null = null;
  // If nothing within reach is clear enough, the clearest spot that is.
  let roomiest = { x: at.x, z: at.z };
  let roomiestC = clearance(at.x, at.z);
  for (let r = 15; r <= MAX_SHIFT && !pick; r += 15) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = at.x + Math.cos(a) * r;
      const z = at.z + Math.sin(a) * r;
      // The prop's foot (and the billboard's width) stays on the roof.
      if (!onFloor(x, z) || !onFloor(x + room * 0.6, z) || !onFloor(x - room * 0.6, z) || !onFloor(x, z + room * 0.6) || !onFloor(x, z - room * 0.6)) continue;
      const c = clearance(x, z);
      if (c >= room) {
        pick = { x, z };
        break;
      }
      if (c > roomiestC) {
        roomiestC = c;
        roomiest = { x, z };
      }
    }
  }
  return pick ?? roomiest;
}

/** One part of the props: non-indexed, placed, tagged with its kind and fill. */
function piece(g: BufferGeometry, m: Matrix4, kind: number, colour: RGB): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.applyMatrix4(m);
  const n = out.getAttribute("position").count;
  out.setAttribute("aKind", new BufferAttribute(new Float32Array(n).fill(kind), 1));
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(colour, i * 3);
  out.setAttribute("aColor", new BufferAttribute(c, 3));
  for (const name of Object.keys(out.attributes)) if (!["position", "normal", "uv", "aKind", "aColor"].includes(name)) out.deleteAttribute(name);
  out.clearGroups();
  return out;
}

/** Normals summed over every vertex at the same place, so the hull never cracks at an edge. */
export function weldedNormals(g: BufferGeometry): BufferAttribute {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const key = (i: number) => `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`;
  const sum = new Map<string, Vector3>();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let s = sum.get(k);
    if (!s) sum.set(k, (s = new Vector3()));
    s.add(v.fromBufferAttribute(nrm, i));
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sum.get(key(i))!;
    v.copy(s);
    if (v.lengthSq() < 1e-8) v.fromBufferAttribute(nrm, i);
    v.normalize();
    out.set([v.x, v.y, v.z], i * 3);
  }
  return new BufferAttribute(out, 3);
}
