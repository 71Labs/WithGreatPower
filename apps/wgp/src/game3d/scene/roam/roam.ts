/**
 * Free roam in the 3D scene: what an outing draws on top of the city, from the frame's v1.6
 * `roam` (nothing is built until one arrives, so a night pays nothing):
 *
 * - Stickers, one instanced draw call: the Daily Rug's torn pages (paper, a headline's rules,
 *   fluttering), Mary Jpeg's lost pixels (her colours, while she's looking for them), a gold "!"
 *   over whoever has a task for you, a red arrow over the task's next step, the web-zip's
 *   reticle where a zip would go, and a light beam over each viewpoint's mast until it's synced.
 * - Gas Goblin's tags, one instanced draw call: graffiti on the walls (a canvas texture), framed
 *   while Bearson wants photos, a check stuck on once photographed.
 * - The pickpocket bot, two draw calls: a small paper-and-ink robot with a red eye, bobbing as
 *   it runs, slumped once caught.
 * - Bursts on the city's events: "GOT IT!" for a page, "SNAP!" for a photo, "SYNCED!", "GOTCHA!".
 * - roam-2: the street traffic, two draw calls (roam/cars.ts): the sim's cars, where the sim has
 *   them. A car that knocks the hero down: "WHAM!" over him and a short camera shake (none on
 *   the Steady camera or with reduced motion).
 *
 * Reduced motion: no flutter, no bob, no beam shimmer, no shake. About six draw calls in all.
 */
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";

import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { SharedUniforms } from "../city/materials";
import type { BurstOptions } from "../effects";
import { C, rgb } from "../palette";
import { RoamCars } from "./cars";

export interface RoamHost {
  burst(word: string, at: Vec3, opts?: BurstOptions): void;
  /** A short camera shake (the host leaves it out on the Steady camera and with reduced motion). */
  shake?(amount: number): void;
}

/** A roam sim event, typed loosely (the scene only reads a few fields). */
export interface RoamSceneEvent {
  type: string;
  x?: number;
  y?: number;
  z?: number;
  task?: string | null;
  state?: string;
  /** roam-car-hit: the car's speed. */
  speed?: number;
}

const KIND = { page: 0, pixel: 1, marker: 2, next: 3, reticle: 4, beam: 5 } as const;
const MARY = ["#E8492F", "#C23722", "#F7774F", "#2DB3A5"].map(rgb);
const GOLD = rgb("#FFD95A");
const HERO_RED = rgb("#E5392C");
const MINT = rgb("#3DDC97");
const MAX = 96;

const SPRITE_VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aParams;  // x: width, y: height (world units), z: kind, w: spin (radians)
attribute vec3 aColor;
uniform float uPxScale;
varying vec2 vUv;
varying float vKind;
varying vec3 vColor;
void main() {
  vec4 view = viewMatrix * vec4(aCenter, 1.0);
  float depth = max(1.0, -view.z);
  // Never smaller than a dozen pixels across, so a find reads from across the street.
  float k = max(1.0, 12.0 * depth * uPxScale / max(1.0, min(aParams.x, aParams.y)));
  if (aParams.z > 4.5) k = 1.0;
  vec2 p = position.xy;
  float c = cos(aParams.w);
  float s = sin(aParams.w);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  view.xy += p * aParams.xy * k;
  vUv = position.xy * 2.0;
  vKind = aParams.z;
  vColor = aColor;
  gl_Position = projectionMatrix * view;
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uDpr;
uniform float uTime;
varying vec2 vUv;
varying float vKind;
varying vec3 vColor;
// Distance to the edge of a box of half size b (negative inside).
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main() {
  vec2 uv = vUv;
  float k = floor(vKind + 0.5);
  vec3 c = vColor;
  float a = 1.0;
  if (k < 0.5) {
    // A torn page: paper with an ink edge, a masthead bar and headline rules; the edge torn.
    float tear = 0.06 * sin(uv.y * 31.0) + 0.04 * sin(uv.y * 57.0 + 1.0);
    float d = box(uv, vec2(0.78 + tear * step(0.0, uv.x), 0.98));
    if (d > 0.0) discard;
    float px = max(fwidth(d), 1e-4);
    c = uPaper;
    if (-d / px < 2.2 * uDpr) c = uInk;
    else if (uv.y > 0.55 && uv.y < 0.78 && abs(uv.x) < 0.62) c = uInk;
    else if (uv.y < 0.4 && abs(fract(uv.y * 4.0) - 0.5) < 0.12 && abs(uv.x) < 0.6) c = mix(uPaper, uInk, 0.55);
    a = c == uInk ? 1.0 : 0.6;
  } else if (k < 1.5) {
    // A pixel: a square of Mary's colour, inked.
    float d = box(uv, vec2(0.9));
    if (d > 0.0) discard;
    float px = max(fwidth(d), 1e-4);
    if (-d / px < 2.0 * uDpr) c = uInk;
    a = c == uInk ? 1.0 : 0.5;
  } else if (k < 2.5) {
    // A task marker: a gold diamond with an ink "!".
    float d = abs(uv.x) + abs(uv.y) - 0.95;
    if (d > 0.0) discard;
    float px = max(fwidth(d), 1e-4);
    if (-d / px < 2.4 * uDpr) c = uInk;
    else if (abs(uv.x) < 0.1 && uv.y > -0.12 && uv.y < 0.52) c = uInk;
    else if (length(uv - vec2(0.0, -0.36)) < 0.11) c = uInk;
    a = c == uInk ? 1.0 : 0.62;
  } else if (k < 3.5) {
    // The next step: a red arrow pointing down.
    float d = max(abs(uv.x) * 1.4 + uv.y * 0.9 - 0.6, -uv.y - 0.95);
    if (uv.y > 0.15) d = max(abs(uv.x) - 0.32, uv.y - 0.95);
    if (d > 0.0) discard;
    float px = max(fwidth(d), 1e-4);
    if (-d / px < 2.4 * uDpr) c = uInk;
    a = c == uInk ? 1.0 : 0.6;
  } else if (k < 4.5) {
    // The zip reticle: an ink ring round a white one, ticks at the quarters.
    float r = length(uv);
    float ring = abs(r - 0.72);
    float px = max(fwidth(r), 1e-4);
    float tick = (abs(uv.x) < 0.06 || abs(uv.y) < 0.06) && r > 0.82 && r < 1.0 ? 1.0 : 0.0;
    if (ring / px < 1.6 * uDpr) c = uPaper;
    else if (ring / px < 3.8 * uDpr || tick > 0.5) c = uInk;
    else discard;
    a = 1.0;
  } else {
    // A viewpoint's beam: a soft vertical shaft, brightest at its core, fading up.
    float x = abs(uv.x);
    float up = (uv.y + 1.0) * 0.5;
    float core = exp(-x * x * 9.0) * (1.0 - up * 0.85);
    float shimmer = 0.85 + 0.15 * sin(uTime * 3.0 + uv.y * 12.0);
    a = core * shimmer * 0.55;
    if (a < 0.02) discard;
    gl_FragColor = vec4(c, a);
    return;
  }
  gl_FragColor = vec4(c, a);
}
`;

const TAG_VERTEX = /* glsl */ `
attribute vec4 aTag; // x: shot (0/1), y: wanted (0/1), z: phase, w: unused
varying vec2 vUv;
varying vec4 vTag;
void main() {
  vUv = uv;
  vTag = aTag;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const TAG_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uInk;
uniform vec3 uGold;
uniform vec3 uMint;
uniform float uTime;
varying vec2 vUv;
varying vec4 vTag;
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec2 e = abs(vUv - 0.5);
  float edge = max(e.x, e.y);
  // Wanted: a gold frame pulses round it; shot: a mint check sticker in its corner.
  if (vTag.y > 0.5 && vTag.x < 0.5 && edge > 0.44 && edge < 0.5) {
    gl_FragColor = vec4(mix(uGold, uInk, step(0.475, edge)), 0.62 + 0.38 * step(0.5, fract(uTime * 1.5)));
    return;
  }
  if (vTag.x > 0.5 && length(vUv - vec2(0.84, 0.84)) < 0.12) {
    float r = length(vUv - vec2(0.84, 0.84));
    gl_FragColor = vec4(r > 0.1 ? uInk : uMint, 1.0);
    return;
  }
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(t.rgb, 1.0);
}
`;

/** Gas Goblin's tag, painted once: his grin and a dripping "GAS!". */
function tagTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d");
  if (!g) return null;
  g.lineJoin = "round";
  g.lineCap = "round";
  // The goblin's face.
  g.fillStyle = "#7CD957";
  g.strokeStyle = "#141414";
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(52, 84);
  g.lineTo(84, 70);
  g.quadraticCurveTo(128, 40, 172, 70);
  g.lineTo(204, 84);
  g.lineTo(182, 112);
  g.quadraticCurveTo(176, 166, 128, 172);
  g.quadraticCurveTo(80, 166, 74, 112);
  g.closePath();
  g.fill();
  g.stroke();
  // Eyes and the grin.
  g.fillStyle = "#FFD95A";
  for (const x of [104, 152]) {
    g.beginPath();
    g.ellipse(x, 104, 13, 9, x < 128 ? -0.4 : 0.4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.moveTo(96, 134);
  g.quadraticCurveTo(128, 162, 160, 134);
  g.closePath();
  g.fill();
  g.stroke();
  // "GAS!" with drips.
  g.font = "900 64px system-ui, sans-serif";
  g.textAlign = "center";
  g.lineWidth = 10;
  g.strokeStyle = "#141414";
  g.strokeText("GAS!", 128, 236);
  g.fillStyle = "#B55CE6";
  g.fillText("GAS!", 128, 236);
  g.fillStyle = "#B55CE6";
  for (const [x, l] of [
    [86, 16],
    [140, 22],
    [176, 12],
  ]) {
    g.fillRect(x, 238, 6, l);
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A merged box geometry with flat vertex colours, for the bot. */
function boxes(parts: { x: number; y: number; z: number; w: number; h: number; d: number; c: [number, number, number] }[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const b = new BoxGeometry(p.w, p.h, p.d);
    b.translate(p.x, p.y, p.z);
    const base = pos.length / 3;
    const ap = b.getAttribute("position");
    for (let i = 0; i < ap.count; i++) {
      pos.push(ap.getX(i), ap.getY(i), ap.getZ(i));
      col.push(...p.c);
    }
    const ix = b.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    b.dispose();
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Parts {
  sprites: InstancedMesh;
  spriteGeo: BufferGeometry;
  spriteMat: ShaderMaterial;
  center: Float32Array;
  params: Float32Array;
  color: Float32Array;
  centerAttr: InstancedBufferAttribute;
  paramsAttr: InstancedBufferAttribute;
  colorAttr: InstancedBufferAttribute;
  tags: InstancedMesh;
  tagMat: ShaderMaterial;
  tagAttr: InstancedBufferAttribute;
  tagTex: CanvasTexture | null;
  bot: Group;
  botFill: Mesh;
  botHull: Mesh;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _n = new Vector3();
const Z = new Vector3(0, 0, 1);

export class RoamScene {
  readonly root = new Group();
  reducedMotion = false;
  private parts: Parts | null = null;
  private botYaw = 0;
  private lastFrame: RenderFrame3D | null = null;
  /** roam-2: the sim's cars (built on the first frame that has them). */
  private cars: RoamCars | null = null;

  constructor(
    private readonly city: City,
    private readonly shared: SharedUniforms,
    private readonly host: RoamHost,
  ) {
    this.root.name = "roam";
  }

  /** Whether an outing's frames have arrived (the parts are built). */
  get active(): boolean {
    return this.parts !== null;
  }

  private build(): Parts {
    const quad = new PlaneGeometry(1, 1);
    const spriteGeo = new BufferGeometry();
    spriteGeo.setAttribute("position", quad.getAttribute("position"));
    spriteGeo.setIndex(quad.getIndex());
    const center = new Float32Array(MAX * 3);
    const params = new Float32Array(MAX * 4);
    const color = new Float32Array(MAX * 3);
    const centerAttr = new InstancedBufferAttribute(center, 3).setUsage(DynamicDrawUsage);
    const paramsAttr = new InstancedBufferAttribute(params, 4).setUsage(DynamicDrawUsage);
    const colorAttr = new InstancedBufferAttribute(color, 3).setUsage(DynamicDrawUsage);
    spriteGeo.setAttribute("aCenter", centerAttr);
    spriteGeo.setAttribute("aParams", paramsAttr);
    spriteGeo.setAttribute("aColor", colorAttr);
    const spriteMat = new ShaderMaterial({
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPxScale: this.shared.uPxScale,
        uDpr: this.shared.uDpr,
        uTime: this.shared.uTime,
        uInk: { value: new Vector3(...C.ink) },
        uPaper: { value: new Vector3(...C.paper) },
      },
    });
    const sprites = new InstancedMesh(spriteGeo, spriteMat, MAX);
    sprites.name = "roam-stickers";
    sprites.frustumCulled = false;
    sprites.count = 0;
    sprites.renderOrder = 2;

    const tagTex = tagTexture();
    const tagGeo = new PlaneGeometry(1, 1);
    const tagAttr = new InstancedBufferAttribute(new Float32Array(16 * 4), 4).setUsage(DynamicDrawUsage);
    tagGeo.setAttribute("aTag", tagAttr);
    const tagMat = new ShaderMaterial({
      vertexShader: TAG_VERTEX,
      fragmentShader: TAG_FRAGMENT,
      side: DoubleSide,
      uniforms: { uMap: { value: tagTex }, uInk: { value: new Vector3(...C.ink) }, uGold: { value: new Vector3(...GOLD) }, uMint: { value: new Vector3(...MINT) }, uTime: this.shared.uTime },
    });
    const tags = new InstancedMesh(tagGeo, tagMat, 16);
    tags.name = "roam-tags";
    tags.count = 0;
    tags.frustumCulled = false;

    // The bot: a paper body, an ink visor with a red eye, little legs and an antenna.
    const paper = C.paper;
    const ink = C.ink;
    const red = HERO_RED;
    const steel = C.steel;
    const geo = boxes([
      { x: 0, y: 30, z: 0, w: 30, h: 26, d: 20, c: paper },
      { x: 0, y: 52, z: 0, w: 24, h: 18, d: 18, c: steel },
      { x: 0, y: 53, z: 9.5, w: 18, h: 8, d: 2, c: ink },
      { x: 0, y: 53, z: 10.8, w: 5, h: 4, d: 1, c: red },
      { x: 0, y: 66, z: 0, w: 2.5, h: 10, d: 2.5, c: ink },
      { x: 0, y: 72, z: 0, w: 5, h: 5, d: 5, c: red },
      { x: -8, y: 9, z: 0, w: 7, h: 18, d: 8, c: ink },
      { x: 8, y: 9, z: 0, w: 7, h: 18, d: 8, c: ink },
      { x: 0, y: 30, z: -12, w: 22, h: 18, d: 6, c: rgb("#C9A86A") },
    ]);
    const botFill = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true }));
    const botHull = new Mesh(geo, new MeshBasicMaterial({ color: 0x141414, side: BackSide }));
    botHull.scale.setScalar(1.09);
    const bot = new Group();
    bot.name = "roam-bot";
    bot.add(botHull, botFill);
    bot.visible = false;

    this.root.add(tags, sprites, bot);
    return { sprites, spriteGeo, spriteMat, center, params, color, centerAttr, paramsAttr, colorAttr, tags, tagMat, tagAttr, tagTex, bot, botFill, botHull };
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  /** The city's finds as bursts (a page, a photo, a sync, the bot caught, the river). */
  event(ev: RoamSceneEvent): void {
    if (ev.x === undefined || ev.y === undefined || ev.z === undefined) return;
    const at = { x: ev.x, y: ev.y + 70, z: ev.z };
    switch (ev.type) {
      case "roam-page":
        this.host.burst("GOT IT!", at, { size: 70, life: 0.8 });
        break;
      case "roam-item":
        this.host.burst(ev.task === "graffiti" ? "SNAP!" : "PIXEL!", at, { size: 64, life: 0.7 });
        break;
      case "roam-sync":
        this.host.burst("SYNCED!", at, { size: 84, life: 1.1 });
        break;
      case "roam-bot":
        if (ev.state === "caught") this.host.burst("GOTCHA!", at, { size: 80, life: 0.9 });
        break;
      case "roam-splash":
        this.host.burst("SPLASH!", { x: ev.x, y: 40, z: ev.z }, { size: 72, life: 0.8 });
        break;
      case "roam-car-hit": {
        const hard = (ev.speed ?? 0) > 220;
        this.host.burst(hard ? "WHAM!" : "BONK!", { x: ev.x, y: ev.y + 40, z: ev.z }, { size: hard ? 110 : 90, life: 0.8 });
        if (!this.reducedMotion) this.host.shake?.(Math.min(1, (ev.speed ?? 0) / 330));
        break;
      }
    }
  }

  update(frame: RenderFrame3D, dt: number, time: number): void {
    const r = frame.roam;
    if (!r) {
      if (this.parts) this.root.visible = false;
      return;
    }
    this.parts ??= this.build();
    if (r.cars && r.cars.length) {
      if (!this.cars || this.cars.max < r.cars.length) {
        this.cars?.dispose();
        if (this.cars) this.root.remove(this.cars.fill, this.cars.hull);
        this.cars = new RoamCars(this.city, this.shared, r.cars.length);
        this.root.add(this.cars.fill, this.cars.hull);
      }
      this.cars.update(r.cars);
    }
    this.root.visible = true;
    this.lastFrame = frame;
    const P = this.parts;
    const still = this.reducedMotion;
    let n = 0;
    const put = (x: number, y: number, z: number, w: number, h: number, kind: number, spin: number, c: readonly number[]) => {
      if (n >= MAX) return;
      P.center[n * 3] = x;
      P.center[n * 3 + 1] = y;
      P.center[n * 3 + 2] = z;
      P.params[n * 4] = w;
      P.params[n * 4 + 1] = h;
      P.params[n * 4 + 2] = kind;
      P.params[n * 4 + 3] = spin;
      P.color[n * 3] = c[0];
      P.color[n * 3 + 1] = c[1];
      P.color[n * 3 + 2] = c[2];
      n++;
    };
    // Pages, fluttering a little on their spot.
    r.pages.forEach((p, i) => {
      if (p.found) return;
      const f = still ? 0 : Math.sin(time * 2.2 + i * 1.7);
      put(p.pos.x, p.pos.y + 26 + (still ? 0 : f * 4), p.pos.z, 30, 38, KIND.page, still ? 0.08 : 0.12 * f, C.paper);
    });
    // Mary's pixels, while she's looking for them.
    const pixTask = r.tasks.find((t) => t.id === "pixels");
    if (pixTask && pixTask.stage === 1) {
      r.pixels.forEach((p, i) => {
        if (p.found) return;
        const bob = still ? 0 : Math.sin(time * 3 + i) * 5;
        put(p.pos.x, p.pos.y + 24 + bob, p.pos.z, 20, 20, KIND.pixel, still ? 0 : time * 0.8 + i, MARY[i % MARY.length]);
      });
    }
    // Task markers: a "!" over a giver whose task hasn't started, an arrow over the next step.
    const stage = (id: string) => r.tasks.find((t) => t.id === id)?.stage ?? 0;
    for (const f of r.folks) {
      const head = f.pos.y + (f.cast ? 118 : 110) + (still ? 0 : Math.sin(time * 2 + f.id) * 4);
      const gives = GIVES[f.key];
      const takes = TAKES[f.key];
      if (gives && stage(gives) === 0) put(f.pos.x, head, f.pos.z, 30, 30, KIND.marker, 0, GOLD);
      else if (takes && isHandIn(takes, stage(takes))) put(f.pos.x, head, f.pos.z, 26, 30, KIND.next, 0, HERO_RED);
    }
    // The bot's arrow while it's loose.
    if (r.bot && r.bot.state !== "caught" && stage("pickpocket") === 1) put(r.bot.pos.x, r.bot.pos.y + 108, r.bot.pos.z, 24, 28, KIND.next, 0, HERO_RED);
    // Viewpoint beams until synced.
    for (const v of r.views) {
      if (v.synced) continue;
      put(v.pos.x, v.pos.y + 360, v.pos.z, 40, 720, KIND.beam, 0, GOLD);
    }
    // The zip reticle.
    if (r.zip && (r.move === "ground" || r.move === "air" || r.move === "climb" || r.move === "hang" || r.move === "wallrun" || r.move === "swing" || r.move === "roll")) {
      const pulse = still ? 1 : 1 + 0.06 * Math.sin(time * 8);
      put(r.zip.x, r.zip.y + 6, r.zip.z, 34 * pulse, 34 * pulse, KIND.reticle, 0, C.paper);
    }
    P.sprites.count = n;
    P.sprites.visible = n > 0;
    P.centerAttr.needsUpdate = true;
    P.paramsAttr.needsUpdate = true;
    P.colorAttr.needsUpdate = true;

    // Tags on their walls, a little off the face.
    const wanted = stage("graffiti") === 1;
    let t = 0;
    for (const g of r.tags) {
      if (t >= 16) break;
      _n.set(g.normal.x, 0, g.normal.z);
      _q.setFromUnitVectors(Z, _n);
      _m.compose(_p.set(g.pos.x + g.normal.x * 1.5, g.pos.y, g.pos.z + g.normal.z * 1.5), _q, _s.set(120, 120, 1));
      P.tags.setMatrixAt(t, _m);
      P.tagAttr.setXYZW(t, g.shot ? 1 : 0, wanted ? 1 : 0, t, 0);
      t++;
    }
    P.tags.count = t;
    P.tags.visible = t > 0 && !!P.tagTex;
    P.tags.instanceMatrix.needsUpdate = true;
    P.tagAttr.needsUpdate = true;

    // The bot.
    const b = r.bot;
    P.bot.visible = !!b && stage("pickpocket") >= 1 && stage("pickpocket") < 9;
    if (b && P.bot.visible) {
      const hs = Math.hypot(b.vel.x, b.vel.z);
      if (hs > 20) {
        const want = Math.atan2(b.vel.x, b.vel.z);
        let d = want - this.botYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.botYaw += d * Math.min(1, dt * 12);
      }
      const run = b.state === "running" && hs > 20 && !still;
      P.bot.position.set(b.pos.x, b.pos.y + (run ? Math.abs(Math.sin(time * 18)) * 5 : 0), b.pos.z);
      P.bot.rotation.set(b.state === "caught" ? 0.5 : run ? 0.25 : 0, this.botYaw, b.state === "caught" ? 0.35 : 0);
    }
  }

  /** The bot's place, for the camera or the lab (null when it isn't out). */
  botAt(): Vec3 | null {
    const b = this.lastFrame?.roam?.bot;
    return b ? b.pos : null;
  }

  dispose(): void {
    const P = this.parts;
    if (!P) return;
    P.spriteGeo.dispose();
    P.spriteMat.dispose();
    P.sprites.dispose();
    P.tags.geometry.dispose();
    P.tagMat.dispose();
    P.tags.dispose();
    P.tagTex?.dispose();
    P.botFill.geometry.dispose();
    (P.botFill.material as MeshBasicMaterial).dispose();
    (P.botHull.material as MeshBasicMaterial).dispose();
    this.parts = null;
    this.cars?.dispose();
    this.cars = null;
    void this.city;
  }
}

/** Who hands out which task, and who takes it back (rules/city.ts, by folk key). */
const GIVES: Record<string, string> = { aunt: "bread", dev: "pickpocket", mary: "pixels", bearson: "graffiti" };
const TAKES: Record<string, string> = { uncle: "bread", dev: "pickpocket", mary: "pixels", bearson: "graffiti" };

/** Whether a task's next step is handing it in to its taker. */
function isHandIn(task: string, stage: number): boolean {
  if (task === "bread") return stage === 1;
  return stage === 2;
}
