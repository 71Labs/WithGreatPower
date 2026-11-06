/**
 * Ghosts in the city: each a translucent paper outline of the hero (the cut-out the Case File
 * 001 copies are printed from, media/chapters/case-001-copy-tex.webp, used for its silhouette
 * only), standing where its verified run was at this tick. Paper-white at low opacity inside, a
 * crisp die-cut edge in the ghost's colour (gold for first, silver, bronze; your own best in
 * cyan; a chosen rival in pink), turned to face the camera about its own up. On a web its up
 * points at the anchor, so it hangs from it, and a thin line in its colour draws the web.
 *
 * Cheap on purpose: one instanced draw for every ghost and one for every web line, no skinning,
 * no lights, nothing that writes depth. It keeps the frame's glow (alpha) as the scene left it,
 * so the bloom never picks a ghost up. Near the player a ghost fades, so it never hides him.
 */
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  SrcAlphaFactor,
  TextureLoader,
  Vector2,
  Vector3,
  ZeroFactor,
  type Texture,
} from "three";

import { assetUrl } from "@/lib/assets";

/** The cut-out: the hero's height, at the print's aspect. Its feet stand on the sim's ground (centre − radius). */
export const GHOST_HEIGHT = 92;
const ASPECT = 256 / 411;
const TEX_W = 256;
const TEX_H = 411;
const HERO_RADIUS = 26;
/** At most this many ghosts. */
export const MAX_GHOSTS = 4;
export const GHOST_TEXTURE = "/media/chapters/case-001-copy-tex.webp";

const VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aFade;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  vUv = uv;
  vColor = aColor;
  vFade = aFade;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform float uDpr;
uniform vec3 uPaper;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  float a = texture2D(uMap, vUv).a;
  // The die-cut edge, two screen pixels wide however far the ghost is.
  vec2 o = max(uTexel * 2.0, fwidth(vUv) * 1.6 * uDpr);
  float inside = min(min(texture2D(uMap, vUv + vec2(o.x, 0.0)).a, texture2D(uMap, vUv - vec2(o.x, 0.0)).a), min(texture2D(uMap, vUv + vec2(0.0, o.y)).a, texture2D(uMap, vUv - vec2(0.0, o.y)).a));
  if (a < 0.5) discard;
  bool edge = inside < 0.5;
  // Paper, tinted a little by the ghost's colour, nearly see-through; the edge in its colour.
  vec3 col = edge ? vColor : mix(uPaper, vColor, 0.28);
  float alpha = (edge ? 0.92 : 0.26) * vFade;
  gl_FragColor = vec4(col, alpha);
}
`;

const _m = new Matrix4();
const _p = new Vector3();
const _up = new Vector3();
const _to = new Vector3();
const _right = new Vector3();
const _normal = new Vector3();
const _x = new Vector3();

export interface GhostDraw {
  /** The hero's centre, as the sim keeps it. */
  x: number;
  y: number;
  z: number;
  /** The web's anchor, or null. */
  anchor: { x: number; y: number; z: number } | null;
  /** 0–1. */
  fade: number;
  /** Its colour, linear 0–1 RGB (the scene draws display colours as they are). */
  color: [number, number, number];
}

/** Draws up to MAX_GHOSTS ghosts and their webs. Add `group` to the scene; call update every frame. */
export class GhostCutouts {
  readonly group = new Group();
  private readonly geo: PlaneGeometry;
  private readonly mat: ShaderMaterial;
  private readonly mesh: InstancedMesh;
  private readonly color: InstancedBufferAttribute;
  private readonly fade: InstancedBufferAttribute;
  private readonly lineGeo = new BufferGeometry();
  private readonly linePos = new Float32Array(MAX_GHOSTS * 6);
  private readonly lineCol = new Float32Array(MAX_GHOSTS * 6);
  private readonly lineMat: LineBasicMaterial;
  private readonly lines: LineSegments;
  private readonly map: Texture;

  constructor() {
    this.map = new TextureLoader().load(assetUrl(GHOST_TEXTURE));
    this.map.colorSpace = NoColorSpace;
    this.geo = new PlaneGeometry(GHOST_HEIGHT * ASPECT, GHOST_HEIGHT);
    // Feet at the origin.
    this.geo.translate(0, GHOST_HEIGHT / 2, 0);
    this.color = new InstancedBufferAttribute(new Float32Array(MAX_GHOSTS * 3), 3).setUsage(DynamicDrawUsage);
    this.fade = new InstancedBufferAttribute(new Float32Array(MAX_GHOSTS), 1).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aColor", this.color);
    this.geo.setAttribute("aFade", this.fade);
    // Colour blends over the scene; alpha (the bloom's glow mask) is left as the scene wrote it.
    const blend = {
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    } as const;
    this.mat = new ShaderMaterial({
      name: "wgp-ghosts",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      ...blend,
      uniforms: {
        uMap: { value: this.map },
        uTexel: { value: new Vector2(1 / TEX_W, 1 / TEX_H) },
        uDpr: { value: 1 },
        uPaper: { value: new Vector3(1, 0.99, 0.97) },
      },
    });
    this.mesh = new InstancedMesh(this.geo, this.mat, MAX_GHOSTS);
    this.mesh.name = "ghosts";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.lineGeo.setAttribute("position", new BufferAttribute(this.linePos, 3).setUsage(DynamicDrawUsage));
    this.lineGeo.setAttribute("color", new BufferAttribute(this.lineCol, 3).setUsage(DynamicDrawUsage));
    this.lineGeo.setDrawRange(0, 0);
    this.lineMat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, ...blend });
    this.lines = new LineSegments(this.lineGeo, this.lineMat);
    this.lines.name = "ghost-webs";
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
    this.group.add(this.mesh, this.lines);
  }

  /** Stand this frame's ghosts, turned to the camera at `eye`. */
  update(ghosts: readonly GhostDraw[], eye: Vector3, dpr: number): void {
    this.mat.uniforms.uDpr.value = dpr;
    let n = 0;
    let l = 0;
    for (const g of ghosts) {
      if (n >= MAX_GHOSTS || g.fade <= 0.01) continue;
      const feet = g.y - HERO_RADIUS;
      // Up: toward the anchor on a web (hanging from it), else straight up.
      if (g.anchor) _up.set(g.anchor.x - g.x, g.anchor.y - g.y, g.anchor.z - g.z);
      else _up.set(0, 1, 0);
      if (_up.lengthSq() < 1e-6 || _up.y < 0.2 * _up.length()) _up.set(0, 1, 0);
      _up.normalize();
      // Face the camera about that up.
      _to.set(eye.x - g.x, eye.y - g.y, eye.z - g.z);
      _right.crossVectors(_up, _to);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _right.normalize();
      _normal.crossVectors(_right, _up).normalize();
      // The cut-out's feet on the ground under the hero's centre, pivoting there.
      _p.set(g.x, feet, g.z);
      _m.makeBasis(_right, _up, _normal).setPosition(_p);
      this.mesh.setMatrixAt(n, _m);
      this.color.setXYZ(n, g.color[0], g.color[1], g.color[2]);
      this.fade.setX(n, g.fade);
      n++;
      if (g.anchor) {
        // The web: from the hands (two thirds up the body) to the anchor.
        _x.copy(_up).multiplyScalar(GHOST_HEIGHT * 0.68).add(_p);
        this.linePos.set([_x.x, _x.y, _x.z, g.anchor.x, g.anchor.y, g.anchor.z], l * 6);
        const c = g.color;
        this.lineCol.set([c[0], c[1], c[2], c[0], c[1], c[2]], l * 6);
        l++;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.color.needsUpdate = true;
      this.fade.needsUpdate = true;
    }
    this.lineGeo.setDrawRange(0, l * 2);
    this.lines.visible = l > 0;
    if (l) {
      (this.lineGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (this.lineGeo.getAttribute("color") as BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
    this.lineGeo.dispose();
    this.lineMat.dispose();
    this.map.dispose();
  }
}
