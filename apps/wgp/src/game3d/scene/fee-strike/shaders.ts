/**
 * GLSL for case file 003's scene: flat decals on the roofs (the fee-bomb scorches, the fee
 * spike's telegraph ring and its burst), soft glows (the clues' halos and beams, the meter's
 * warning), the meter's dial, and puffs of smoke and steam. Everything runs in display sRGB
 * like the rest of the scene (palette.ts).
 */
import { FOG_PARS } from "../chapter/shaders";

/** A decal lying on a roof (an instanced quad turned flat): aDecal = kind, param, seed, alpha. */
export const DECAL_VERTEX = /* glsl */ `
attribute vec4 aDecal;
varying vec2 vUv;
varying vec4 vDecal;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vUv = uv;
  vDecal = aDecal;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const DECAL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uStill;
varying vec2 vUv;
varying vec4 vDecal;
varying vec3 vWorld;
${FOG_PARS}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float kind = vDecal.x;
  float param = vDecal.y;
  float seed = vDecal.z;
  vec4 col;
  if (kind < 0.5) {
    // A fee-bomb scorch: green glider-exhaust soot splashed out in ragged spokes, a charred
    // middle, a few lime embers.
    float ang = atan(p.y, p.x);
    float n = vnoise(vec2(ang * 3.0 + seed * 9.0, seed * 5.0)) * 0.55 + vnoise(p * 6.0 + seed * 3.0) * 0.45;
    float edge = 0.62 + 0.3 * n;
    float soot = 1.0 - smoothstep(edge - 0.25, edge, r);
    float core = 1.0 - smoothstep(0.18, 0.42 + 0.1 * n, r);
    col = vec4(mix(vec3(0.12, 0.2, 0.12), vec3(0.05, 0.07, 0.05), core), soot * 0.86);
    // A pale ash rim where the splash ends, so the burn reads on a dark roof.
    float rim = (1.0 - smoothstep(0.0, 0.07, abs(r - (edge - 0.1)))) * step(r, edge);
    col = mix(col, vec4(0.62, 0.78, 0.5, 0.75), rim * 0.8);
    float flick = uStill > 0.5 ? 0.7 : 0.55 + 0.45 * vnoise(vec2(uTime * 2.5 + seed * 11.0, ang));
    float ember = step(0.8, vnoise(p * 9.0 + seed * 7.0)) * core * param * flick;
    col.rgb = mix(col.rgb, vec3(0.6, 1.0, 0.25), ember);
  } else if (kind < 1.5) {
    // The fee spike's telegraph: a striped warning ring at the reach, the fill spreading out to it.
    float ring = 1.0 - smoothstep(0.035, 0.07, abs(r - 0.94));
    float stripe = step(0.5, fract((atan(p.y, p.x) / 6.2831853) * 24.0 + (uStill > 0.5 ? 0.0 : uTime * 0.6)));
    float fill = (1.0 - smoothstep(param - 0.03, param, r)) * step(r, 0.94);
    vec3 warn = mix(vec3(0.08, 0.07, 0.1), vec3(1.0, 0.36, 0.2), stripe);
    col = vec4(mix(vec3(1.0, 0.36, 0.2), warn, ring), max(ring * 0.95, fill * 0.32));
  } else {
    // A spike's burst: one bright ring, thinning as it goes.
    float w = 0.05 + 0.08 * (1.0 - param);
    float ring = 1.0 - smoothstep(w * 0.5, w, abs(r - 0.92));
    col = vec4(vec3(1.0, 0.75, 0.35), ring);
  }
  col.a *= vDecal.w;
  if (col.a < 0.01) discard;
  gl_FragColor = vec4(mix(col.rgb, uFog, fogAmount(vWorld) * 0.5), col.a);
}
`;

/** Soft glows: instanced quads, halos facing the camera, beams standing upright. aGlow = kind, strength, width, height. */
export const GLOW_VERTEX = /* glsl */ `
attribute vec4 aGlow;
attribute vec3 aColor;
varying vec2 vUv;
varying vec2 vKS;
varying vec3 vColor;
void main() {
  vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  if (aGlow.x > 0.5) {
    up = vec3(0.0, 1.0, 0.0);
    vec3 toCam = cameraPosition - centre;
    right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
  }
  vec3 world = centre + right * position.x * aGlow.z + up * (position.y + (aGlow.x > 0.5 ? 0.5 : 0.0)) * aGlow.w;
  vUv = position.xy * 2.0;
  vKS = aGlow.xy;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const GLOW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uStill;
varying vec2 vUv;
varying vec2 vKS;
varying vec3 vColor;
void main() {
  float a;
  if (vKS.x > 0.5) {
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
  gl_FragColor = vec4(vColor, a);
}
`;

/** The fee meter's dial (a disc, uv 0–1): brass rim, cream face, green to red zones, ticks and the needle. */
export const DIAL_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vUv = uv;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const DIAL_FRAGMENT = /* glsl */ `
uniform float uNeedle;
uniform float uHeat;
uniform float uTime;
uniform float uStill;
uniform float uSweep;
varying vec2 vUv;
varying vec3 vWorld;
${FOG_PARS}
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // Angle clockwise from straight up.
  float ang = atan(p.x, p.y);
  vec3 ink = vec3(0.08, 0.07, 0.1);
  vec3 col = vec3(0.99, 0.95, 0.85);
  // The zones round the top: green, amber, then the red MAX.
  if (r > 0.6 && r < 0.8 && abs(ang) < uSweep) {
    float u = (ang + uSweep) / (2.0 * uSweep);
    col = u < 0.4 ? vec3(0.31, 0.82, 0.54) : u < 0.72 ? vec3(1.0, 0.7, 0.24) : vec3(0.93, 0.2, 0.17);
  }
  // Ticks.
  float tick = abs(fract((ang + uSweep) / (2.0 * uSweep) * 10.0 + 0.5) - 0.5);
  if (r > 0.56 && r < 0.62 && abs(ang) < uSweep + 0.02 && tick < 0.06) col = ink;
  // The rim: brass, inked.
  if (r > 0.86) col = r > 0.95 ? ink : vec3(0.86, 0.62, 0.26);
  // The needle and its hub.
  vec2 tip = vec2(sin(uNeedle), cos(uNeedle)) * 0.74;
  float d = segment(p, vec2(0.0), tip);
  if (d < 0.05) col = vec3(0.86, 0.12, 0.1);
  if (d < 0.05 && d > 0.032) col = ink;
  if (r < 0.12) col = r < 0.07 ? vec3(0.86, 0.62, 0.26) : ink;
  // Hot: the face blushes red, throbbing (steady under reduced motion).
  float hot = smoothstep(0.75, 1.0, uHeat) * (uStill > 0.5 ? 0.35 : 0.25 + 0.2 * sin(uTime * 7.0));
  if (r < 0.86) col = mix(col, vec3(1.0, 0.3, 0.22), hot);
  gl_FragColor = vec4(mix(col, uFog, fogAmount(vWorld) * 0.5), 1.0);
}
`;

/** Puffs of smoke and steam: camera-facing quads, soft round blobs. aPuff = alpha, shade (0 smoke … 1 steam). */
export const PUFF_VERTEX = /* glsl */ `
attribute vec2 aPuff;
varying vec2 vUv;
varying vec2 vPuff;
void main() {
  vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vec3 world = centre + (right * position.x + up * position.y) * s;
  vUv = position.xy * 2.0;
  vPuff = aPuff;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const PUFF_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec2 vPuff;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // A toon puff: a flat body with an inked rim.
  vec3 body = mix(vec3(0.6, 0.62, 0.72), vec3(0.96, 0.97, 1.0), vPuff.y);
  vec3 col = r > 0.86 ? vec3(0.12, 0.11, 0.16) : body * (1.0 - 0.12 * smoothstep(0.2, 0.86, r));
  float a = vPuff.x * (r > 0.86 ? 0.8 : 0.85);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

/** Painted signs from one canvas atlas: instanced quads, each with its own corner of the atlas (aRect = u0, v0, u1, v1) and opacity. */
export const SIGN_VERTEX = /* glsl */ `
attribute vec4 aRect;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vUv = mix(aRect.xy, aRect.zw, uv);
  vAlpha = aAlpha;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const SIGN_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
${FOG_PARS}
void main() {
  if (vAlpha < 0.01) discard;
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(mix(t.rgb, uFog, fogAmount(vWorld) * 0.5), 1.0);
}
`;
