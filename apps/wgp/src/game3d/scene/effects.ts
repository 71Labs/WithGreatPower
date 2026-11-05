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
import { rgb, type RGB } from "./palette";

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
  "+1 BIT!": [NAV_COLORS.bits, PAPER],
  "BOOST!": [NAV_COLORS.ring, PAPER],
  /** Case file 001 (scene/chapter): a clue found, the SCREENSHOT's click, it landing, Ctrl+C, Mary's first word back. */
  "+CLUE!": [CITY.windowLit, INK],
  "CLICK!": [PAPER, INK],
  "SAVED!": [PAPER, CITY.neonRed],
  "CTRL+C!": [CITY.neonMint, INK],
  "gm": [CITY.neonMint, PAPER],
} as const;

export type BurstWord = keyof typeof BURST_WORDS;

const WORDS = Object.keys(BURST_WORDS) as BurstWord[];
const COLS = 2;
const ROWS = 8;
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

/* ------------------------------------------------------------------ sparks */

const SPARK_VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aVel;
attribute vec4 aParams;  // half size (CSS px), kind (0 shard, 1 star, 2 web splat), scale, turn
attribute vec3 aColor;
uniform float uPxScale;
varying vec2 vP;
varying vec3 vColor;
flat varying float vKind;
void main() {
  vec4 view = viewMatrix * vec4(aCenter, 1.0);
  float depth = max(1.0, -view.z);
  float s = aParams.x * depth * uPxScale * aParams.z;
  vec2 dir = vec2(cos(aParams.w), sin(aParams.w));
  if (aParams.y < 0.5) {
    // Shards point along their flight on screen.
    vec2 v = (viewMatrix * vec4(aVel, 0.0)).xy;
    if (length(v) > 1e-3) dir = normalize(v);
  }
  vec2 n = vec2(-dir.y, dir.x);
  float stretch = aParams.y < 0.5 ? 2.6 : 1.0;
  view.xy += (dir * position.x * stretch + n * position.y) * s * 2.0;
  vP = position.xy * 2.0;
  vColor = aColor;
  vKind = aParams.y;
  gl_Position = projectionMatrix * view;
}
`;

const SPARK_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uPaper;
varying vec2 vP;
varying vec3 vColor;
flat varying float vKind;
void main() {
  vec2 p = vP;
  float d;
  vec3 fill = vColor;
  float glow = 0.4;
  if (vKind < 0.5) {
    // A shard: a long thin diamond.
    d = abs(p.y) - (1.0 - abs(p.x)) * 0.42;
  } else if (vKind < 1.5) {
    // A four-point sparkle.
    vec2 a = abs(p);
    d = (sqrt(a.x) + sqrt(a.y) - 1.0) * 0.5;
    glow = 0.55;
  } else {
    // A web splat: eight spokes and two rings, white over ink.
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);
    float k = fract(ang / 0.785398 + 0.5) - 0.5;
    float spoke = abs(k) * 0.785398 * r;
    float ring = min(abs(r - 0.45), abs(r - 0.82));
    float w = min(spoke, ring);
    float pxw = fwidth(r);
    if (w > 0.12 + pxw && r > 0.2) discard;
    gl_FragColor = (w < 0.06 || r < 0.15) ? vec4(uPaper, 0.6) : vec4(uInk, 1.0);
    return;
  }
  float pxw = max(fwidth(d), 1e-4);
  if (d > pxw) discard;
  // Ink rim, a pixel and a half wide whatever the size.
  gl_FragColor = d > -1.5 * pxw ? vec4(uInk, 1.0) : vec4(fill, 1.0 - glow);
}
`;

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  size: number;
  kind: number;
  turn: number;
  color: RGB;
}

const MAX_SPARKS = 96;
const SPARK_GRAVITY = 900;
const IMPACTS: Record<string, string> = { "POW!": CITY.windowLit, "WHAM!": CITY.windowLit, "ZAP!": CITY.neonMint, "OOF!": CITY.neonRed, "SPLASH!": PAPER };

/**
 * Comic impact debris, one instanced draw: a hit throws ink-rimmed shards in the burst's
 * colour and a few paper sparkles, which fly out, fall and shrink; a web that sticks leaves a
 * white web splat that pops and fades on the wall. Off (no draw call) on the low tier and
 * under reduced motion, apart from the splat, which then just appears.
 */
export class Sparks {
  readonly mesh: InstancedMesh;
  private readonly geo: BufferGeometry;
  private readonly quad: PlaneGeometry;
  private readonly material: ShaderMaterial;
  private readonly center = new Float32Array(MAX_SPARKS * 3);
  private readonly vel = new Float32Array(MAX_SPARKS * 3);
  private readonly params = new Float32Array(MAX_SPARKS * 4);
  private readonly colors = new Float32Array(MAX_SPARKS * 3);
  private readonly attrs: InstancedBufferAttribute[];
  private live: Spark[] = [];
  private seed = 0x9e3779b9;
  private on = true;
  /** Draw once, empty, as soon as sparks are on: the program compiles then, not on the night's first hit. */
  private warm = true;
  reducedMotion = false;

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    if (on && !this.on) this.warm = true;
    this.on = on;
  }

  constructor(shared: SharedUniforms) {
    this.quad = new PlaneGeometry(1, 1);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", this.quad.getAttribute("position"));
    this.geo.setIndex(this.quad.getIndex());
    this.attrs = [
      new InstancedBufferAttribute(this.center, 3).setUsage(DynamicDrawUsage),
      new InstancedBufferAttribute(this.vel, 3).setUsage(DynamicDrawUsage),
      new InstancedBufferAttribute(this.params, 4).setUsage(DynamicDrawUsage),
      new InstancedBufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage),
    ];
    ["aCenter", "aVel", "aParams", "aColor"].forEach((name, i) => this.geo.setAttribute(name, this.attrs[i]));
    this.material = new ShaderMaterial({
      name: "wgp-sparks",
      vertexShader: SPARK_VERTEX,
      fragmentShader: SPARK_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: { uPxScale: shared.uPxScale, uInk: { value: rgb(INK) }, uPaper: { value: rgb(PAPER) } },
    });
    this.mesh = new InstancedMesh(this.geo, this.material, MAX_SPARKS);
    this.mesh.name = "sparks";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private add(s: Spark) {
    if (this.live.length >= MAX_SPARKS) this.live.shift();
    this.live.push(s);
  }

  /** Debris for a burst word that marks a hit (POW!, WHAM!, ZAP!, OOF!, SPLASH!); other words throw nothing. */
  impact(word: string, at: Vec3): void {
    const hex = IMPACTS[word];
    if (!hex || !this.enabled || this.reducedMotion) return;
    const color = rgb(hex);
    // The burst sits 60 above what it marks; the debris comes from a little under it.
    const y = at.y - 36;
    const shards = word === "SPLASH!" ? 8 : 11;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + this.rnd() * 0.5;
      const up = 0.15 + this.rnd() * 0.75;
      const speed = 260 + this.rnd() * 300;
      const flat = Math.sqrt(1 - up * up);
      this.add({ x: at.x, y, z: at.z, vx: Math.cos(a) * flat * speed, vy: up * speed, vz: Math.sin(a) * flat * speed, t: 0, life: 0.38 + this.rnd() * 0.22, size: 9 + this.rnd() * 6, kind: 0, turn: 0, color: word === "SPLASH!" ? rgb(CITY.cable) : color });
    }
    for (let i = 0; i < 4; i++) {
      const a = this.rnd() * Math.PI * 2;
      const speed = 120 + this.rnd() * 160;
      this.add({ x: at.x, y, z: at.z, vx: Math.cos(a) * speed, vy: 160 + this.rnd() * 200, vz: Math.sin(a) * speed, t: 0, life: 0.5 + this.rnd() * 0.25, size: 9 + this.rnd() * 6, kind: 1, turn: this.rnd() * 0.6, color: rgb(PAPER) });
    }
  }

  /** A web splat where the hero's web just stuck. */
  splat(at: Vec3): void {
    if (!this.enabled) return;
    this.add({ x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, t: 0, life: 0.5, size: 20, kind: 2, turn: this.rnd() * Math.PI, color: rgb(PAPER) });
  }

  update(dt: number): void {
    if (this.live.length === 0) {
      // Nothing flying: no draw (an empty instanced draw compiles the program but issues no call).
      this.mesh.count = 0;
      this.mesh.visible = this.warm && this.on;
      if (this.on) this.warm = false;
      return;
    }
    for (const s of this.live) {
      s.t += dt;
      if (s.kind === 2) continue;
      s.vy -= SPARK_GRAVITY * dt;
      const drag = Math.exp(-dt * 2.2);
      s.vx *= drag;
      s.vz *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
    }
    if (this.live.some((s) => s.t >= s.life)) this.live = this.live.filter((s) => s.t < s.life);
    let n = 0;
    for (const s of this.live) {
      const u = s.t / s.life;
      // Shards and sparkles shrink away; the splat pops past full size, settles, then fades.
      const scale = s.kind === 2 ? (this.reducedMotion ? 1 : u < 0.15 ? 0.5 + (u / 0.15) * 0.65 : u < 0.3 ? 1.15 - ((u - 0.15) / 0.15) * 0.15 : 1) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1) : 1 - u * u;
      if (scale <= 0.02) continue;
      this.center.set([s.x, s.y, s.z], n * 3);
      this.vel.set([s.vx, s.vy, s.vz], n * 3);
      this.params.set([s.size, s.kind, scale, s.turn], n * 4);
      this.colors.set(s.color, n * 3);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    for (const a of this.attrs) a.needsUpdate = true;
  }

  clear(): void {
    this.live = [];
  }

  dispose(): void {
    this.quad.dispose();
    this.geo.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
