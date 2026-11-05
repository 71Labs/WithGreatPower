/**
 * "Screenshot frames": a thin floating selection rectangle round a saved body (captive Mary;
 * the hero for a second after a SCREENSHOT lands), with square handles at its corners and
 * sides, a mouse pointer at its corner as if it had just been dragged out, and a file tag
 * ("mary-jpeg.jpg · 1 MB", "the-node.png · SAVED"). Camera-facing, its lines a fixed number of
 * pixels wide at any distance. One instanced draw for both.
 */
import { CanvasTexture, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, NoColorSpace, PlaneGeometry, ShaderMaterial, Vector3 } from "three";

import { resolveFont } from "@/sim/render/draw";

import type { SharedUniforms } from "../city/materials";
import { C } from "../palette";
import { CURSOR_SDF } from "./shaders";

export const FRAME_LABELS = ["mary-jpeg.jpg · 1 MB", "the-node.png · SAVED!"] as const;
export type FrameLabel = 0 | 1;
/** World units round the rectangle the quad leaves for the pointer and the tag. */
const MARGIN = 26;

const VERTEX = /* glsl */ `
attribute vec4 aFrame;  // width, height, opacity, label
attribute vec2 aPop;    // scale, unused
uniform float uPxScale;
varying vec2 vP;
varying vec4 vFrame;
void main() {
  vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  // Room round the rectangle for the pointer and the tag, whatever the distance.
  float pxW = max(1.0, -(viewMatrix * vec4(centre, 1.0)).z) * uPxScale;
  vec2 margin = vec2(max(${MARGIN.toFixed(1)}, 200.0 * pxW - aFrame.x), max(${MARGIN.toFixed(1)}, 44.0 * pxW));
  vec2 full = aFrame.xy + margin * 2.0;
  vP = position.xy * full;
  vFrame = aFrame;
  vec3 world = centre + (right * position.x * full.x + up * position.y * full.y) * aPop.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform float uDpr;
uniform sampler2D uTags;
varying vec2 vP;
varying vec4 vFrame;
${CURSOR_SDF}
void main() {
  vec2 half_ = vFrame.xy * 0.5;
  float px = max(length(fwidth(vP)) * 0.7071, 1e-4) * uDpr;  // world units per CSS px
  vec2 a = abs(vP);
  vec4 col = vec4(0.0);
  // The rectangle: ink, white, ink, from its edge out (CSS px).
  float d = max(a.x - half_.x, a.y - half_.y);
  float e = abs(d) / px;
  if (e < 3.5) col = vec4(e < 1.5 ? vec3(1.0) : uInk, 1.0);
  // Handles: corners and the middles of the sides, 9 px squares.
  vec2 c1 = abs(vec2(a.x - half_.x, a.y - half_.y)) / px;
  vec2 c2 = abs(vec2(vP.x, a.y - half_.y)) / px;
  vec2 c3 = abs(vec2(a.x - half_.x, vP.y)) / px;
  float hm = min(max(c1.x, c1.y), min(max(c2.x, c2.y), max(c3.x, c3.y)));
  if (hm < 6.0) col = vec4(hm < 4.0 ? vec3(1.0) : uInk, 1.0);
  // The pointer at the bottom-right corner, its tip on the corner: 2.2 px a cursor pixel.
  float s = 2.2 * px;
  vec2 q = vec2(vP.x - half_.x, -(vP.y + half_.y)) / s + vec2(-1.0, -1.0);
  float cd = sdCursor(q) * s / px;
  if (cd < 2.0) col = vec4(cd < 0.0 ? vec3(1.0) : uInk, 1.0);
  // The file tag over the top-left corner.
  vec2 tagSize = vec2(180.0, 20.0) * px;
  vec2 tp = (vP - vec2(-half_.x, half_.y + 6.0 * px)) / tagSize;
  if (tp.x > 0.0 && tp.x < 1.0 && tp.y > 0.0 && tp.y < 1.0) {
    vec4 t = texture2D(uTags, vec2(tp.x, (tp.y + (1.0 - vFrame.w)) * 0.5));
    if (t.a > 0.05) col = vec4(t.rgb, t.a);
  }
  if (col.a < 0.05) discard;
  gl_FragColor = vec4(col.rgb, col.a * vFrame.z);
}
`;

/** The two file tags, ink pills with paper text (one row each; row 0 at the top). */
function tagAtlas(): CanvasTexture {
  const w = 576;
  const h = 64;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h * 2;
  const ctx = c.getContext("2d")!;
  const font = resolveFont();
  FRAME_LABELS.forEach((label, i) => {
    const y = i * h;
    ctx.font = `700 34px ${font}`;
    const tw = Math.min(w - 8, ctx.measureText(label).width + 36);
    ctx.fillStyle = "#141414";
    ctx.beginPath();
    ctx.roundRect(2, y + 6, tw, h - 12, 12);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 20, y + h / 2 + 1);
  });
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const _m = new Matrix4();

export class ShotFrames {
  readonly mesh: InstancedMesh;
  private readonly geo: PlaneGeometry;
  private readonly mat: ShaderMaterial;
  private readonly frame: InstancedBufferAttribute;
  private readonly pop: InstancedBufferAttribute;
  private readonly tags: CanvasTexture;
  private n = 0;

  constructor(shared: SharedUniforms) {
    this.geo = new PlaneGeometry(1, 1);
    this.frame = new InstancedBufferAttribute(new Float32Array(2 * 4), 4).setUsage(DynamicDrawUsage);
    this.pop = new InstancedBufferAttribute(new Float32Array(2 * 2), 2).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aFrame", this.frame);
    this.geo.setAttribute("aPop", this.pop);
    this.tags = tagAtlas();
    this.mat = new ShaderMaterial({
      name: "wgp-chapter-frames",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uInk: { value: new Vector3(...C.ink) }, uDpr: shared.uDpr, uPxScale: shared.uPxScale, uTags: { value: this.tags } },
    });
    this.mesh = new InstancedMesh(this.geo, this.mat, 2);
    this.mesh.name = "chapter-shot-frames";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  begin(): void {
    this.n = 0;
  }

  /** A frame `w` × `h` (world units) round `centre`, at `opacity`, scaled by `scale`. */
  add(cx: number, cy: number, cz: number, w: number, h: number, opacity: number, label: FrameLabel, scale = 1): void {
    if (this.n >= 2 || opacity <= 0.01) return;
    _m.makeTranslation(cx, cy, cz);
    this.mesh.setMatrixAt(this.n, _m);
    this.frame.setXYZW(this.n, w, h, opacity, label);
    this.pop.setXY(this.n, scale, 0);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.frame.needsUpdate = true;
      this.pop.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.tags.dispose();
    this.mesh.dispose();
  }
}
