/**
 * The night sky in the 2D renderer's style: three flat bands (CITY.skyTop / skyMid /
 * skyLow, no gradient), square and sparkle stars, the ink-ringed moon sticker and a ring of
 * outlined clouds at a few heights, plus a ring of far skyline at the horizon (the 2D "far"
 * parallax layer, wrapped around the city). The dome, stars and sprites ride with the
 * camera; the skyline ring is fixed around the city so it parallaxes.
 *
 * Draw calls: dome, stars, sprites, skyline ring.
 */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type PerspectiveCamera,
} from "three";

import { CITY, INK, LINE } from "@/game/style";
import { hash01, mix } from "@/sim/render/draw";

import { C, FOG, type RGB } from "./palette";

const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);
const _fwd = new Vector3();

/**
 * Sky band cuts as fractions of the viewport height above the horizon line, so the bands are
 * straight and fixed to the horizon like the 2D sky (whatever the FOV or pitch).
 */
export const SKY_CUTS = [0.1, 0.24] as const;

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec2 uCuts;
uniform float uHorizon;   // the horizon's height on screen, NDC
uniform float uHeight;    // drawing-buffer height, px
varying vec3 vDir;
void main() {
  float above = ((gl_FragCoord.y / uHeight) * 2.0 - 1.0 - uHorizon) * 0.5;
  gl_FragColor = vec4(above < uCuts.x ? uLow : above < uCuts.y ? uMid : uTop, 1.0);
}
`;

const STAR_VERTEX = /* glsl */ `
attribute vec3 aStar;   // size px, big (0/1), phase
uniform float uTime;
uniform float uDpr;
uniform float uRadius;
varying float vBig;
void main() {
  vec3 world = cameraPosition + normalize(position) * uRadius;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aStar.z);
  vBig = aStar.y;
  gl_PointSize = (aStar.y > 0.5 ? (12.0 * tw + 4.0) : max(1.5, aStar.x * tw)) * uDpr;
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform vec3 uStar;
uniform vec3 uInk;
uniform float uHorizon;
uniform float uHeight;
uniform float uLowCut;
varying float vBig;
void main() {
  // No stars in the low band, like the 2D sky.
  if (((gl_FragCoord.y / uHeight) * 2.0 - 1.0 - uHorizon) * 0.5 < uLowCut) discard;
  if (vBig < 0.5) { gl_FragColor = vec4(uStar, 1.0); return; }
  vec2 p = abs(gl_PointCoord * 2.0 - 1.0);
  float s = sqrt(p.x) + sqrt(p.y);
  if (s > 1.0) discard;
  gl_FragColor = vec4(s > 0.78 ? uInk : uStar, 1.0);
}
`;

const SPRITE_VERTEX = /* glsl */ `
attribute vec4 aSky;    // azimuth, elevation, drift (rad/s), width (rad)
attribute vec4 aRect;   // uv rect: x, y, w, h
attribute float aAspect;
uniform float uTime;
uniform float uRadius;
varying vec2 vUv;
void main() {
  float az = aSky.x + uTime * aSky.z;
  float el = aSky.y;
  vec3 dir = vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el));
  vec3 center = cameraPosition + dir * uRadius;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float w = aSky.w * uRadius;
  vec3 world = center + right * position.x * w + up * position.y * w * aAspect;
  vUv = aRect.xy + (position.xy + 0.5) * aRect.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0);
}
`;

const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFog;
uniform float uFogAmt;
uniform vec2 uRepeat;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv * uRepeat);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(mix(c.rgb, uFog, uFogAmt), 1.0);
}
`;

/* ------------------------------------------------------------------ canvas art */

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | null, lw: number, stroke = INK) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** The moon sticker: white border, ink drop, craters and a shine (render/city.ts moonArt). */
function drawMoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const border = r * 0.13;
  const drop = r * 0.08;
  const k = r / 50;
  circle(ctx, cx, cy + drop, r + border, INK, 0);
  circle(ctx, cx, cy, r + border, "#FFFFFF", 2.5 * k);
  circle(ctx, cx, cy, r, CITY.moon, 2.5 * k);
  const crater = mix(CITY.moon, "#C9A64B", 0.35);
  circle(ctx, cx - r * 0.32, cy + r * 0.18, r * 0.2, crater, 1.75 * k);
  circle(ctx, cx + r * 0.3, cy - r * 0.22, r * 0.13, crater, 1.75 * k);
  circle(ctx, cx + r * 0.22, cy + r * 0.42, r * 0.09, crater, 1.5 * k);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cx - r * 0.12, cy - r * 0.1, r * 0.78, Math.PI * 1.05, Math.PI * 1.45);
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

/** An outlined cloud with a flat bottom (render/city.ts cloudArt), inside (x, y, w, h). */
function drawCloud(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, w: number, h: number, lw: number) {
  const n = 3 + Math.floor(hash01(seed) * 3);
  const puffs: [number, number, number][] = [];
  const ph = h * 0.82;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const r = ph * (0.32 + 0.22 * Math.sin(Math.PI * t)) * (0.85 + hash01(seed + i * 13) * 0.3);
    puffs.push([x + lw + r + t * (w - 2 * lw - 2 * r), y + h - lw - r * 0.95, r]);
  }
  const base = y + h - lw - ph * 0.08;
  const shape = () => {
    ctx.beginPath();
    for (const [px, py, r] of puffs) {
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.rect(x + ph * 0.2, base - ph * 0.3, w - ph * 0.4, ph * 0.3);
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, base - y + lw * 0.5);
  ctx.clip();
  shape();
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke();
  shape();
  ctx.fillStyle = CITY.cloud;
  ctx.fill();
  const big = puffs.reduce((a, b) => (b[2] > a[2] ? b : a));
  ctx.beginPath();
  ctx.arc(big[0], big[1], big[2] * 0.7, Math.PI * 1.15, Math.PI * 1.5);
  ctx.lineWidth = lw * 0.9;
  ctx.strokeStyle = mix(CITY.cloud, "#FFFFFF", 0.35);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(x + ph * 0.12, base);
  ctx.lineTo(x + w - ph * 0.12, base);
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.stroke();
}

interface SkyAtlas {
  texture: CanvasTexture;
  /** uv rects (x, y, w, h) and aspect (h / w) per sprite: the moon, then clouds. */
  rects: { rect: [number, number, number, number]; aspect: number }[];
}

function skyAtlas(): SkyAtlas {
  const W = 1024;
  const H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const rects: SkyAtlas["rects"] = [];
  const add = (x: number, y: number, w: number, h: number) => rects.push({ rect: [x / W, 1 - (y + h) / H, w / W, h / H], aspect: h / w });
  // The moon, centred in a 320 cell.
  drawMoon(ctx, 160, 152, 116);
  add(0, 0, 320, 320);
  const clouds = [
    [330, 10, 680, 290],
    [10, 340, 620, 260],
    [10, 620, 760, 300],
  ];
  clouds.forEach(([x, y, w, h], i) => {
    drawCloud(ctx, 101 + i * 37, x, y, w, h, 7);
    add(x, y, w, h);
  });
  const texture = new CanvasTexture(c);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  return { texture, rects };
}

/** The far skyline strip: flat far-palette towers, flat lit windows, thin ink outlines. */
function skylineTexture(): CanvasTexture {
  const W = 2048;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const lw = LINE.far * 2;
  let x = 0;
  let i = 0;
  while (x < W) {
    const k = 911 + i * 977;
    const w = Math.min(W - x, 70 + hash01(k) * 110);
    if (w < 30) break;
    const h = 150 + hash01(k + 1) * 280;
    const top = H - h;
    const fill = CITY.far[i % CITY.far.length];
    ctx.fillStyle = fill;
    ctx.fillRect(x, top, w, h);
    const roof = hash01(k + 2);
    if (roof < 0.25) {
      const sw = w * 0.3;
      ctx.fillRect(x + (w - sw) / 2, top - 40, sw, 41);
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw;
      ctx.strokeRect(x + (w - sw) / 2, top - 40, sw, 40);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, top - 40);
      ctx.lineTo(x + w / 2, top - 80);
      ctx.stroke();
    } else if (roof < 0.5) {
      ctx.fillRect(x + w * 0.15, top - 16, w * 0.7, 17);
      ctx.strokeStyle = INK;
      ctx.lineWidth = lw;
      ctx.strokeRect(x + w * 0.15, top - 16, w * 0.7, 16);
    }
    // Strip windows, flat light, no outline (the 2D far layer).
    const cols = Math.max(1, Math.floor((w - 16) / 18));
    const rows = Math.floor((h - 30) / 30);
    const ox = x + (w - (cols * 10 + (cols - 1) * 8)) / 2;
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const kk = k + r * 131 + cc * 17;
        if (hash01(kk) > 0.3) continue;
        ctx.fillStyle = hash01(kk + 7) < 0.4 ? CITY.windowWarm : CITY.windowLit;
        ctx.fillRect(ox + cc * 18, top + 14 + r * 30, 10, 20);
      }
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, top, w, h + 4);
    x += w + (hash01(k + 4) < 0.35 ? 0 : 6 + hash01(k + 5) * 30);
    i += 1;
  }
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ the sky */

export interface Sky {
  /** Follows the camera: dome, stars, moon and clouds. */
  dome: Group;
  /** Fixed around the city. */
  skyline: Mesh;
  starMaterial: ShaderMaterial;
  setStars(count: number): void;
  /** Per frame: follow the camera and find the horizon line on screen. */
  update(camera: PerspectiveCamera, time: number, dpr: number, bufferHeight: number): void;
  dispose(): void;
}

export function buildSky(center: { x: number; z: number }, horizon: number, far: number): Sky {
  const radius = far * 0.6;
  const dome = new Group();
  dome.name = "sky";
  const materials: Material[] = [];

  const domeGeo = new SphereGeometry(radius, 16, 8);
  const domeMat = new ShaderMaterial({
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTop: { value: v3(C.skyTop) },
      uMid: { value: v3(C.skyMid) },
      uLow: { value: v3(C.skyLow) },
      uCuts: { value: new Vector2(SKY_CUTS[0], SKY_CUTS[1]) },
      uHorizon: { value: 0 },
      uHeight: { value: 1 },
    },
  });
  const domeMesh = new Mesh(domeGeo, domeMat);
  domeMesh.renderOrder = -10;
  domeMesh.frustumCulled = false;
  dome.add(domeMesh);
  materials.push(domeMat);

  // Stars: up to 240 directions above the low band; the tier shows a prefix of them.
  const MAX_STARS = 240;
  const pos = new Float32Array(MAX_STARS * 3);
  const star = new Float32Array(MAX_STARS * 3);
  for (let i = 0; i < MAX_STARS; i++) {
    const az = hash01(i * 7 + 1) * Math.PI * 2;
    const el = Math.asin(0.05 + 0.95 * Math.pow(hash01(i * 11 + 3), 1.6));
    pos.set([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)], i * 3);
    star.set([1.5 + hash01(i * 5) * 1.8, i % 9 === 0 ? 1 : 0, hash01(i * 3) * 6.28], i * 3);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute("position", new BufferAttribute(pos, 3));
  starGeo.setAttribute("aStar", new BufferAttribute(star, 3));
  const starMaterial = new ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },
      uDpr: { value: 1 },
      uRadius: { value: radius * 0.95 },
      uStar: { value: v3(C.star) },
      uInk: { value: v3(C.ink) },
      uHorizon: domeMat.uniforms.uHorizon,
      uHeight: domeMat.uniforms.uHeight,
      uLowCut: { value: SKY_CUTS[0] },
    },
  });
  const stars = new Points(starGeo, starMaterial);
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  dome.add(stars);
  materials.push(starMaterial);

  // The moon and seven clouds (three drawings), as camera-facing stickers on the dome.
  const atlas = skyAtlas();
  const quad = new PlaneGeometry(1, 1);
  const spriteGeo = new BufferGeometry();
  spriteGeo.setAttribute("position", quad.getAttribute("position"));
  spriteGeo.setIndex(quad.getIndex());
  const sprites = [
    // azimuth, elevation, drift, width (radians), atlas cell (0 the moon, 1–3 clouds)
    [2.3, 0.3, 0, 0.17, 0],
    [2.0, 0.2, 0.004, 0.3, 1],
    [-0.4, 0.26, 0.003, 0.27, 2],
    [0.9, 0.16, 0.0025, 0.34, 3],
    [3.4, 0.13, 0.0035, 0.24, 2],
    [-1.6, 0.21, 0.002, 0.29, 1],
    [-2.6, 0.12, 0.003, 0.32, 3],
    [0.2, 0.32, 0.0015, 0.2, 1],
  ];
  const n = sprites.length;
  const sky = new Float32Array(n * 4);
  const rect = new Float32Array(n * 4);
  const aspect = new Float32Array(n);
  sprites.forEach(([az, el, drift, width, cell], i) => {
    sky.set([az, el, drift, width], i * 4);
    rect.set(atlas.rects[cell].rect, i * 4);
    aspect[i] = atlas.rects[cell].aspect;
  });
  spriteGeo.setAttribute("aSky", new InstancedBufferAttribute(sky, 4));
  spriteGeo.setAttribute("aRect", new InstancedBufferAttribute(rect, 4));
  spriteGeo.setAttribute("aAspect", new InstancedBufferAttribute(aspect, 1));
  const spriteMat = new ShaderMaterial({
    vertexShader: SPRITE_VERTEX,
    fragmentShader: SPRITE_FRAGMENT,
    depthWrite: false,
    depthTest: false,
    uniforms: { uTime: starMaterial.uniforms.uTime, uRadius: { value: radius * 0.9 }, uMap: { value: atlas.texture } },
  });
  const spriteMesh = new InstancedMesh(spriteGeo, spriteMat, n);
  spriteMesh.renderOrder = -8;
  spriteMesh.frustumCulled = false;
  dome.add(spriteMesh);
  materials.push(spriteMat);

  // The far skyline ring.
  const ringR = horizon * 0.95;
  const ringH = ringR * 0.16;
  const ringGeo = new CylinderGeometry(ringR, ringR, ringH, 72, 1, true);
  ringGeo.translate(0, ringH / 2 - 4, 0);
  const ringTex = skylineTexture();
  const ringMat = new ShaderMaterial({
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    side: BackSide,
    uniforms: { uMap: { value: ringTex }, uFog: { value: v3(FOG.color) }, uFogAmt: { value: 0.3 }, uRepeat: { value: new Vector2(6, 1) } },
  });
  const skyline = new Mesh(ringGeo, ringMat);
  skyline.name = "skyline";
  skyline.position.set(center.x, 0, center.z);
  skyline.updateMatrix();
  skyline.matrixAutoUpdate = false;
  skyline.frustumCulled = false;
  materials.push(ringMat);

  return {
    dome,
    skyline,
    starMaterial,
    setStars(count: number) {
      starGeo.setDrawRange(0, Math.max(0, Math.min(MAX_STARS, count)));
    },
    update(camera, time, dpr, bufferHeight) {
      dome.position.copy(camera.position);
      starMaterial.uniforms.uTime.value = time;
      starMaterial.uniforms.uDpr.value = dpr;
      // The horizon: a far point straight ahead on the camera's level, projected.
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
      _fwd.normalize().multiplyScalar(radius).add(camera.position);
      _fwd.project(camera);
      domeMat.uniforms.uHorizon.value = Number.isFinite(_fwd.y) ? _fwd.y : 0;
      domeMat.uniforms.uHeight.value = bufferHeight;
    },
    dispose() {
      domeGeo.dispose();
      starGeo.dispose();
      quad.dispose();
      spriteGeo.dispose();
      ringGeo.dispose();
      atlas.texture.dispose();
      ringTex.dispose();
      for (const m of materials) m.dispose();
      spriteMesh.dispose();
    },
  };
}
