/**
 * Traffic: little toon cars driving the street grid, presentation only.
 *
 * - Every street segment is a loop. The cars go down one lane, U-turn round a half circle
 *   and come back up the other, so nothing ever pops in or out. The river cuts the streets
 *   that cross it into two loops, each turning short of the bank, and the street the river
 *   runs down has none.
 * - The bridge deck has its own loop up on the deck; it empties while Doc fights there.
 * - Positions come from the clock in the vertex shader (phase + speed × time round the
 *   loop), so the CPU never touches a car after the build.
 * - A car is a body and a cabin (one merged geometry), drawn as a flat toon fill with
 *   wheels, lights and windows painted on, plus an inverted-hull ink pass.
 *
 * Draw calls: 2 (fill and ink), none when the tier has no cars.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, ShaderMaterial, Sphere, Vector3, BackSide } from "three";

import type { City } from "@wgp/game-core/sim3d/contract";

import { C, CAR_COLORS, type RGB } from "../palette";
import type { SharedUniforms } from "./materials";
import { COMMON } from "./shaders";
import { inferStreets, type Street } from "./streets";

/** Car parts in car space (x across, y up, z forward): centre and size of the body and the cabin. */
export interface CarPart {
  y: number;
  h: number;
  w: number;
  l: number;
  z: number;
}
const BODY: CarPart = { y: 4, h: 16, w: 30, l: 72, z: 0 };
const CABIN: CarPart = { y: 20, h: 12, w: 26, l: 38, z: -5 };

export const TRAFFIC = {
  /** Lane offset from the street's centre line, as a share of its width. */
  lane: 0.25,
  /** Speed range, units/s. */
  speedMin: 150,
  speedMax: 250,
  /** Gap kept from the city edge and the river bank before a U-turn. */
  margin: 30,
} as const;

export interface Traffic {
  fill: InstancedMesh;
  hull: InstancedMesh;
  /** How many cars to draw (the tier); 0 hides the traffic. */
  setCount(n: number): void;
  /** Empty the bridge deck (a fight is on it). */
  setDeckClear(clear: boolean): void;
  readonly max: number;
  dispose(): void;
}

interface Loop {
  /** 0: the lanes run along x; 1: along z. */
  axis: number;
  /** The street's centre line across the axis. */
  c: number;
  lo: number;
  hi: number;
  /** Lane offset from the centre (the U-turn radius). */
  r: number;
  y: number;
  deck: boolean;
}

function hash01(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The loops cars drive: every street, split where the river crosses it, plus the deck. */
export function trafficLoops(city: City): Loop[] {
  const grid = inferStreets(city);
  const { bounds, river, bridge } = city;
  const loops: Loop[] = [];
  const m = TRAFFIC.margin;
  const add = (axis: number, s: Street, lo: number, hi: number) => {
    const r = s.w * TRAFFIC.lane;
    const a = lo + m + r;
    const b = hi - m - r;
    if (b - a > 200) loops.push({ axis, c: s.c, lo: a, hi: b, r, y: 0, deck: false });
  };
  const riverAlongZ = river ? river.z1 - river.z0 >= river.x1 - river.x0 : false;
  for (const [axis, list] of [
    [1, grid.xs],
    [0, grid.zs],
  ] as const) {
    for (const s of list) {
      const lo = axis === 1 ? bounds.z0 : bounds.x0;
      const hi = axis === 1 ? bounds.z1 : bounds.x1;
      if (!river) {
        add(axis, s, lo, hi);
        continue;
      }
      // Lanes along z run down the river when the river runs along z (and the same for x).
      const parallel = (axis === 1) === riverAlongZ;
      const r0 = parallel ? (axis === 1 ? river.x0 : river.z0) : axis === 1 ? river.z0 : river.x0;
      const r1 = parallel ? (axis === 1 ? river.x1 : river.z1) : axis === 1 ? river.z1 : river.x1;
      if (parallel) {
        if (s.c + s.w / 2 > r0 && s.c - s.w / 2 < r1) continue;
        add(axis, s, lo, hi);
      } else {
        add(axis, s, lo, r0);
        add(axis, s, r1, hi);
      }
    }
  }
  if (bridge) {
    const d = bridge.deck;
    const alongX = bridge.axis ? bridge.axis === "x" : d.x1 - d.x0 >= d.z1 - d.z0;
    const width = alongX ? d.z1 - d.z0 : d.x1 - d.x0;
    const r = width * TRAFFIC.lane;
    const lo = (alongX ? d.x0 : d.z0) + 60 + r;
    const hi = (alongX ? d.x1 : d.z1) - 60 - r;
    if (hi - lo > 200) loops.push({ axis: alongX ? 0 : 1, c: alongX ? (d.z0 + d.z1) / 2 : (d.x0 + d.x1) / 2, lo, hi, r, y: d.y, deck: true });
  }
  return loops;
}

/** Body and cabin boxes merged, bottoms dropped, with corner-sign hull directions and a part id. */
export function carGeometry(body: CarPart = BODY, cabin: CarPart = CABIN): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const hull: number[] = [];
  const part: number[] = [];
  const index: number[] = [];
  [body, cabin].forEach((p, k) => {
    const box = new BoxGeometry(1, 1, 1);
    const P = box.getAttribute("position") as BufferAttribute;
    const N = box.getAttribute("normal") as BufferAttribute;
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i) * p.w, (P.getY(i) + 0.5) * p.h + p.y, P.getZ(i) * p.l + p.z);
      nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      hull.push(Math.sign(P.getX(i)), Math.sign(P.getY(i)), Math.sign(P.getZ(i)));
      part.push(k);
    }
    const idx = box.getIndex()!;
    const bottom = box.groups[3];
    for (let i = 0; i < idx.count; i++) {
      if (i >= bottom.start && i < bottom.start + bottom.count) continue;
      index.push(base + idx.getX(i));
    }
    box.dispose();
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("aHullDir", new BufferAttribute(new Float32Array(hull), 3));
  g.setAttribute("aPart", new BufferAttribute(new Float32Array(part), 1));
  g.setIndex(index);
  return g;
}

/** Where a car is on its loop: world xz, heading (atan2(x, z)), and its height. */
const DRIVE = /* glsl */ `
attribute vec4 aLane;   // axis, centre, lo, hi
attribute vec4 aCar;    // phase, speed, lane radius, deck (1) or street (0)
attribute float aY;

uniform float uTime;
uniform float uDeckClear;

// The stadium loop: out along the +r lane, a half turn, back along the −r lane, a half turn.
vec3 drive(out float heading) {
  float L = aLane.w - aLane.z;
  float r = aCar.z;
  float P = 2.0 * L + 6.2831853 * r;
  float s = mod(aCar.x * P + aCar.y * uTime, P);
  vec2 q;   // (along, across)
  vec2 dir;
  if (s < L) {
    q = vec2(aLane.z + s, r);
    dir = vec2(1.0, 0.0);
  } else if (s < L + 3.1415927 * r) {
    float a = (s - L) / r;
    q = vec2(aLane.w + r * sin(a), r * cos(a));
    dir = vec2(cos(a), -sin(a));
  } else if (s < 2.0 * L + 3.1415927 * r) {
    q = vec2(aLane.w - (s - L - 3.1415927 * r), -r);
    dir = vec2(-1.0, 0.0);
  } else {
    float a = (s - 2.0 * L - 3.1415927 * r) / r;
    q = vec2(aLane.z - r * sin(a), -r * cos(a));
    dir = vec2(-cos(a), sin(a));
  }
  vec2 xz = aLane.x < 0.5 ? vec2(q.x, aLane.y + q.y) : vec2(aLane.y + q.y, q.x);
  vec2 d = aLane.x < 0.5 ? dir : dir.yx;
  heading = atan(d.x, d.y);
  return vec3(xz.x, aY, xz.y);
}

vec3 carToWorld(vec3 p, vec3 at, float heading) {
  float c = cos(heading);
  float s = sin(heading);
  return at + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

float hidden() { return aCar.w > 0.5 && uDeckClear > 0.5 ? 0.0 : 1.0; }
`;

const CAR_VERTEX = /* glsl */ `
${COMMON}
${DRIVE}
attribute vec3 aColor;
attribute float aPart;
uniform vec3 uFogBands;
varying vec3 vLocal;
flat varying vec3 vN;
flat varying vec3 vColor;
flat varying float vPart;
flat varying float vBand;
flat varying float vTaxi;
varying vec3 vWN;

void main() {
  float heading;
  vec3 at = drive(heading);
  vec3 p = position * hidden();
  vec3 world = carToWorld(p, at, heading);
  vLocal = position;
  vN = normal;
  vWN = carToWorld(normal, vec3(0.0), heading);
  vColor = aColor;
  vPart = aPart;
  vTaxi = aColor.b < 0.5 && aColor.r > 0.9 && aColor.g > 0.8 ? 1.0 : 0.0;
  vBand = fogBand(at.xz, uFogBands);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const CAR_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uInk;
uniform vec3 uDark;
uniform vec3 uLit;
uniform vec3 uRed;
uniform vec3 uPaper;
uniform vec3 uSteel;
uniform vec3 uFog;
uniform vec4 uFogAmt;
uniform float uDpr;
uniform float uCrease;
uniform vec4 uBody;    // y, h, w, l
uniform vec4 uCabin;   // y, h, w, l
uniform vec2 uZ;       // body z, cabin z
uniform float uWheel;  // wheel radius
varying vec3 vLocal;
flat varying vec3 vN;
flat varying vec3 vColor;
flat varying float vPart;
flat varying float vBand;
flat varying float vTaxi;
varying vec3 vWN;

float fillOf(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }

void main() {
  bool body = vPart < 0.5;
  vec4 S = body ? uBody : uCabin;
  float z0 = body ? uZ.x : uZ.y;
  // Part-local coordinates from its min corner, and the face's 2D coordinates.
  vec3 L = vec3(vLocal.x + S.z * 0.5, vLocal.y - S.x, vLocal.z - z0 + S.w * 0.5);
  vec3 size = vec3(S.z, S.y, S.w);
  vec2 uv;
  vec2 dims;
  if (abs(vN.y) > 0.5) { uv = L.xz; dims = size.xz; }
  else if (abs(vN.x) > 0.5) { uv = vec2(L.z, L.y); dims = size.zy; }
  else { uv = vec2(L.x, L.y); dims = size.xy; }
  vec2 fw = max(fwidth(uv), vec2(1e-4));
  float aa = max(fw.x, fw.y);
  vec3 n = normalize(vWN);
  float tint = n.y > 0.5 ? 1.0 : abs(n.x) > abs(n.z) ? (n.x > 0.0 ? 0.92 : 0.76) : 0.84;
  vec3 col = vColor * tint;
  // Head and tail lights glow (alpha: the bloom's inverted glow, render/post-shaders.ts).
  float glow = 0.0;
  if (body) {
    if (abs(vN.x) > 0.5) {
      // Sides: a taxi's checker band, and the wheels.
      if (vTaxi > 0.5 && abs(L.y - S.y * 0.55) < 2.5) col = mod(floor(L.z / 5.0), 2.0) < 0.5 ? uInk : uPaper;
      for (int i = 0; i < 2; i++) {
        vec2 c = vec2(i == 0 ? S.w * 0.2 : S.w * 0.8, 0.0);
        float d = length(uv - c) - uWheel;
        col = mix(col, uInk, fillOf(d, aa));
        col = mix(col, uSteel, fillOf(length(uv - c) - uWheel * 0.375, aa));
      }
    } else if (vN.z > 0.5) {
      // Front: headlights.
      for (int i = 0; i < 2; i++) {
        vec2 c = vec2(i == 0 ? S.z * 0.2 : S.z * 0.8, S.y * 0.6);
        float lamp = fillOf(length((uv - c) / vec2(1.0, 0.7)) - 3.4, aa);
        col = mix(col, uLit, lamp);
        glow = max(glow, lamp);
      }
    } else if (vN.z < -0.5) {
      // Back: tail lights.
      for (int i = 0; i < 2; i++) {
        vec2 c = vec2(i == 0 ? S.z * 0.18 : S.z * 0.82, S.y * 0.62);
        float lamp = fillOf(max(abs(uv.x - c.x) - 3.5, abs(uv.y - c.y) - 2.0), aa);
        col = mix(col, uRed, lamp);
        glow = max(glow, lamp * 0.85);
      }
    }
  } else if (abs(vN.y) < 0.5) {
    // Cabin: glass with a white glint.
    float inset = 2.5;
    float d = max(abs(uv.x - dims.x * 0.5) - (dims.x * 0.5 - inset), abs(uv.y - dims.y * 0.5) - (dims.y * 0.5 - inset));
    col = mix(col, uDark, fillOf(d, aa));
    float glint = abs(uv.x - uv.y * 0.8 - dims.x * 0.3) - 1.2;
    col = mix(col, mix(uDark, uPaper, 0.7), fillOf(glint, aa) * fillOf(d + 1.0, aa));
  } else if (vTaxi > 0.5) {
    // A taxi light on the roof.
    float roofLight = fillOf(max(abs(uv.x - dims.x * 0.5) - 6.0, abs(uv.y - dims.y * 0.5) - 3.0), aa);
    col = mix(col, uPaper, roofLight);
    glow = roofLight * 0.6;
  }
  // Creases.
  vec2 e = min(uv, dims - uv) / fw;
  float creasePx = uCrease * uDpr;
  float ink = 1.0 - smoothstep(creasePx - 0.5, creasePx + 0.5, min(e.x, e.y));
  col = mix(col, uInk, ink);
  float f = fogAmount(vBand, uFogAmt);
  col = mix(col, uFog, f);
  gl_FragColor = vec4(col, 1.0 - glow * (1.0 - ink) * (1.0 - 0.5 * f));
}
`;

const CAR_HULL_VERTEX = /* glsl */ `
${COMMON}
${DRIVE}
attribute vec3 aHullDir;
uniform float uPxScale;
uniform vec4 uHullPx;
uniform vec3 uFogBands;
flat varying float vBand;

void main() {
  float heading;
  vec3 at = drive(heading);
  vec3 world = carToWorld(position * hidden(), at, heading);
  vec3 dir = carToWorld(aHullDir, vec3(0.0), heading);
  float depth = max(1.0, -(viewMatrix * vec4(world, 1.0)).z);
  float px = mix(uHullPx.x, uHullPx.y, smoothstep(uHullPx.z, uHullPx.w, depth)) * 0.8 * hidden();
  world += dir * px * depth * uPxScale;
  vBand = fogBand(at.xz, uFogBands);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const CAR_HULL_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uInk;
uniform vec3 uFog;
uniform vec4 uFogAmt;
flat varying float vBand;
void main() {
  gl_FragColor = vec4(mix(uInk, uFog, fogAmount(vBand, uFogAmt) * 0.5), 1.0);
}
`;

const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);

/** The car fill's uniforms: the shared ones, the paints, and the body, cabin and wheel sizes. */
export function carUniforms(shared: SharedUniforms, body: CarPart, cabin: CarPart, wheel: number) {
  return {
    ...shared,
    uDark: { value: v3(C.windowDark) },
    uLit: { value: v3(C.windowLit) },
    uRed: { value: v3(C.neonRed) },
    uPaper: { value: v3(C.paper) },
    uSteel: { value: v3(C.steel) },
    uBody: { value: new Float32Array([body.y, body.h, body.w, body.l]) },
    uCabin: { value: new Float32Array([cabin.y, cabin.h, cabin.w, cabin.l]) },
    uZ: { value: new Float32Array([body.z, cabin.z]) },
    uWheel: { value: wheel },
  };
}

export function buildTraffic(city: City, shared: SharedUniforms, max = 240): Traffic {
  const loops = trafficLoops(city);
  const total = loops.reduce((s, l) => s + 2 * (l.hi - l.lo) + 2 * Math.PI * l.r, 0);
  // Spread the cars over the loops by length; a shuffled order, so any prefix is spread too.
  const cars: { loop: Loop; phase: number; speed: number; color: RGB }[] = [];
  loops.forEach((l, i) => {
    const len = 2 * (l.hi - l.lo) + 2 * Math.PI * l.r;
    const n = Math.max(l.deck ? 3 : 1, Math.round((max * len) / total));
    for (let k = 0; k < n; k++) {
      const h = hash01(i * 7919 + k * 104729 + 17);
      cars.push({
        loop: l,
        phase: (k + 0.35 * hash01(i * 31 + k * 13 + 5)) / n,
        speed: TRAFFIC.speedMin + (TRAFFIC.speedMax - TRAFFIC.speedMin) * hash01(i * 13 + k * 101 + 3),
        color: CAR_COLORS[Math.floor(h * CAR_COLORS.length) % CAR_COLORS.length],
      });
    }
  });
  cars.sort((a, b) => hash01(Math.floor(a.phase * 1e6) + a.loop.c) - hash01(Math.floor(b.phase * 1e6) + b.loop.c));
  const n = cars.length;
  const lane = new Float32Array(n * 4);
  const car = new Float32Array(n * 4);
  const ys = new Float32Array(n);
  const color = new Float32Array(n * 3);
  cars.forEach((c, i) => {
    lane.set([c.loop.axis, c.loop.c, c.loop.lo, c.loop.hi], i * 4);
    car.set([c.phase, c.speed, c.loop.r, c.loop.deck ? 1 : 0], i * 4);
    ys[i] = c.loop.y;
    color.set(c.color, i * 3);
  });

  const geo = carGeometry();
  const attach = (g: BufferGeometry) => {
    g.setAttribute("aLane", new InstancedBufferAttribute(lane, 4));
    g.setAttribute("aCar", new InstancedBufferAttribute(car, 4));
    g.setAttribute("aY", new InstancedBufferAttribute(ys, 1));
    g.setAttribute("aColor", new InstancedBufferAttribute(color, 3));
  };
  attach(geo);
  const deckClear = { value: 0 };
  const fillMat = new ShaderMaterial({
    name: "wgp-car",
    vertexShader: CAR_VERTEX,
    fragmentShader: CAR_FRAGMENT,
    uniforms: { ...carUniforms(shared, BODY, CABIN, 8), uDeckClear: deckClear },
  });
  const hullMat = new ShaderMaterial({
    name: "wgp-car-ink",
    vertexShader: CAR_HULL_VERTEX,
    fragmentShader: CAR_HULL_FRAGMENT,
    side: BackSide,
    uniforms: { ...shared, uDeckClear: deckClear },
  });
  const fill = new InstancedMesh(geo, fillMat, n);
  const hull = new InstancedMesh(geo, hullMat, n);
  // Positions come from the shader: the bounds are the whole city.
  const cx = (city.bounds.x0 + city.bounds.x1) / 2;
  const cz = (city.bounds.z0 + city.bounds.z1) / 2;
  const radius = Math.hypot(city.bounds.x1 - city.bounds.x0, city.bounds.z1 - city.bounds.z0) / 2 + 400;
  for (const mesh of [fill, hull]) {
    mesh.boundingSphere = new Sphere(new Vector3(cx, 0, cz), radius);
    mesh.geometry.boundingSphere = mesh.boundingSphere.clone();
    mesh.matrixAutoUpdate = false;
  }
  fill.name = "cars";
  hull.name = "cars-ink";
  hull.renderOrder = 1;
  return {
    fill,
    hull,
    max: n,
    setCount(count: number) {
      const k = Math.max(0, Math.min(n, Math.round(count)));
      fill.count = hull.count = k;
      fill.visible = hull.visible = k > 0;
    },
    setDeckClear(clear: boolean) {
      deckClear.value = clear ? 1 : 0;
    },
    dispose() {
      geo.dispose();
      fillMat.dispose();
      hullMat.dispose();
    },
  };
}
