/**
 * Comic bursts ("THWIP!", "POW!") as a pooled set of camera-facing stickers: every word is
 * pre-drawn once into an atlas with the 2D renderer's `starburst` (render/draw.ts) and the
 * same ink-drop, stroke-and-fill lettering as render/effects.ts. Bursts pop in, hold and
 * shrink away, sized in CSS px so they read the same at any distance, and draw over the
 * city like the 2D screen-space bursts. One draw call for all of them.
 *
 * Also the little paper sparkle where the web sticks.
 */
import {
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  PlaneGeometry,
  ShaderMaterial,
} from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { NAV_COLORS } from "@/game3d/nav/colors";
import { CITY, INK, PAPER } from "@/game/style";
import { inked, resolveFont, sparkle, starburst } from "@/sim/render/draw";

import type { SharedUniforms } from "./city/materials";

/** Words in the atlas, with the 2D renderer's colours (burst fill, letter fill). */
export const BURST_WORDS = {
  "THWIP!": [PAPER, CITY.neonRed],
  "POW!": [CITY.windowLit, PAPER],
  "WHAM!": [CITY.windowLit, PAPER],
  "ZAP!": [CITY.neonMint, PAPER],
  "PERFECT!": [CITY.windowLit, PAPER],
  "OOF!": [PAPER, CITY.neonRed],
  "SPLASH!": [PAPER, CITY.skyMid],
  sparkle: [PAPER, PAPER],
  /** Pickups (v1.3): a Bits token, a boost ring. */
  "+5 BITS!": [NAV_COLORS.bits, PAPER],
  "BOOST!": [NAV_COLORS.ring, PAPER],
} as const;

export type BurstWord = keyof typeof BURST_WORDS;

const WORDS = Object.keys(BURST_WORDS) as BurstWord[];
const COLS = 2;
const ROWS = 5;
const CELL_W = 512;
const CELL_H = 256;

function burstAtlas(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = COLS * CELL_W;
  c.height = ROWS * CELL_H;
  const ctx = c.getContext("2d")!;
  const font = resolveFont();
  WORDS.forEach((word, i) => {
    const [fill, textFill] = BURST_WORDS[word];
    const cx = (i % COLS) * CELL_W + CELL_W / 2;
    const cy = Math.floor(i / COLS) * CELL_H + CELL_H / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (word === "sparkle") {
      ctx.beginPath();
      sparkle(ctx, 0, 0, 100);
      inked(ctx, fill, 14);
      ctx.restore();
      return;
    }
    // Fit the burst inside the cell: rx = 0.66·textWidth + 0.5·size, ry = 1.05·size.
    let size = 104;
    ctx.font = `800 ${size}px ${font}`;
    let w = ctx.measureText(word).width;
    while (size > 40 && (w * 0.66 + size * 0.5 > CELL_W / 2 - 12 || size * 1.05 > CELL_H / 2 - 10)) {
      size -= 4;
      ctx.font = `800 ${size}px ${font}`;
      w = ctx.measureText(word).width;
    }
    const rx = w * 0.66 + size * 0.5;
    const ry = size * 1.05;
    const seed = 1000 + i * 7919;
    starburst(ctx, 5, 7, rx, ry, 11, seed);
    ctx.fillStyle = INK;
    ctx.fill();
    starburst(ctx, 0, 0, rx, ry, 11, seed);
    inked(ctx, fill, 7);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.fillText(word, size * 0.06, size * 0.1);
    ctx.strokeText(word, 0, 0);
    ctx.fillStyle = textFill;
    ctx.fillText(word, 0, 0);
    ctx.restore();
  });
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

const VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aParams;  // cell, height px, rotation, scale
uniform float uPxScale;
uniform vec2 uGrid;
varying vec2 vUv;
void main() {
  vec4 view = viewMatrix * vec4(aCenter, 1.0);
  float depth = max(1.0, -view.z);
  float h = aParams.y * depth * uPxScale * aParams.w;
  float c = cos(aParams.z);
  float s = sin(aParams.z);
  vec2 p = vec2(position.x * 2.0, position.y) * h;
  view.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float cell = aParams.x;
  float cx = mod(cell, uGrid.x);
  float cy = floor(cell / uGrid.x);
  vUv = vec2((cx + position.x + 0.5) / uGrid.x, 1.0 - (cy + 0.5 - position.y) / uGrid.y);
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0);
}
`;

interface Burst {
  cell: number;
  x: number;
  y: number;
  z: number;
  t: number;
  life: number;
  size: number;
  rot: number;
  rise: number;
}

export interface BurstOptions {
  /** On-screen height of the burst, CSS px. */
  size?: number;
  /** Seconds. */
  life?: number;
  /** World units it drifts up over its life. */
  rise?: number;
}

const MAX = 12;

export class Bursts {
  readonly mesh: InstancedMesh;
  private readonly geo: BufferGeometry;
  private readonly quad: PlaneGeometry;
  private readonly material: ShaderMaterial;
  private readonly texture: CanvasTexture;
  private readonly center = new Float32Array(MAX * 3);
  private readonly params = new Float32Array(MAX * 4);
  private readonly centerAttr: InstancedBufferAttribute;
  private readonly paramsAttr: InstancedBufferAttribute;
  private live: Burst[] = [];
  private anchor: Vec3 | null = null;
  private seed = 0x2545f491;
  reducedMotion = false;

  constructor(shared: SharedUniforms) {
    this.texture = burstAtlas();
    this.quad = new PlaneGeometry(1, 1);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", this.quad.getAttribute("position"));
    this.geo.setIndex(this.quad.getIndex());
    this.centerAttr = new InstancedBufferAttribute(this.center, 3).setUsage(DynamicDrawUsage);
    this.paramsAttr = new InstancedBufferAttribute(this.params, 4).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aCenter", this.centerAttr);
    this.geo.setAttribute("aParams", this.paramsAttr);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uPxScale: shared.uPxScale, uMap: { value: this.texture }, uGrid: { value: [COLS, ROWS] } },
    });
    this.mesh = new InstancedMesh(this.geo, this.material, MAX);
    this.mesh.name = "bursts";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = 0;
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Pop a word at a world point. Unknown words fall back to "POW!". */
  burst(word: string, at: Vec3, opts: BurstOptions = {}): void {
    const cell = Math.max(0, WORDS.indexOf((word in BURST_WORDS ? word : "POW!") as BurstWord));
    if (this.live.length >= MAX - 1) this.live.shift();
    this.live.push({ cell, x: at.x, y: at.y, z: at.z, t: 0, life: opts.life ?? 0.9, size: opts.size ?? 110, rot: (this.rnd() - 0.5) * 0.22, rise: opts.rise ?? 40 });
  }

  /** The sparkle on the web's anchor, or null to hide it. */
  setAnchor(at: Vec3 | null): void {
    this.anchor = at;
  }

  clear(): void {
    this.live = [];
  }

  update(dt: number, time: number): void {
    for (const b of this.live) b.t += dt;
    if (this.live.some((b) => b.t >= b.life)) this.live = this.live.filter((b) => b.t < b.life);
    let n = 0;
    for (const b of this.live) {
      const u = b.t / b.life;
      let pop = u < 0.12 ? (u / 0.12) * 1.25 : u < 0.22 ? 1.25 - ((u - 0.12) / 0.1) * 0.25 : u > 0.82 ? 1 - (u - 0.82) / 0.18 : 1;
      if (this.reducedMotion) pop = u > 0.82 ? 1 - (u - 0.82) / 0.18 : 1;
      if (pop <= 0.01) continue;
      this.center.set([b.x, b.y + u * b.rise, b.z], n * 3);
      this.params.set([b.cell, b.size, b.rot, pop], n * 4);
      n++;
    }
    if (this.anchor) {
      const pulse = this.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 9);
      this.center.set([this.anchor.x, this.anchor.y, this.anchor.z], n * 3);
      this.params.set([WORDS.indexOf("sparkle"), 30, 0, pulse], n * 4);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.centerAttr.needsUpdate = true;
    this.paramsAttr.needsUpdate = true;
  }

  dispose(): void {
    this.quad.dispose();
    this.geo.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}
