/**
 * GLSL shared by the chapter's props: a flat sticker fill with the cast's cel bands and the
 * city's banded fog, an inked edge for unit boxes (the pixel crumbs and the confetti, so a
 * whole instanced batch is one draw with its outline), the hull for the props, and the
 * cursor arrow as a signed distance (the scorch, the screenshot frame's badge).
 */

/** The pointer arrow's outline (a 12 × 20 cursor, y down from the tip): CURSOR_ARROW. */
export const CURSOR_SDF = /* glsl */ `
float sdCursor(vec2 p) {
  vec2 v[7] = vec2[7](vec2(0.0, 0.0), vec2(0.0, 17.0), vec2(4.0, 13.0), vec2(7.0, 19.5), vec2(9.6, 18.4), vec2(6.6, 12.0), vec2(12.0, 12.0));
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0, j = 6; i < 7; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}
`;

/** The city's banded fog (palette.ts FOG), by distance on the ground from the camera. */
export const FOG_PARS = /* glsl */ `
uniform vec3 uFog;
uniform vec3 uFogBands;
uniform vec4 uFogAmt;
float fogAmount(vec3 world) {
  float d = length(world.xz - cameraPosition.xz);
  return d < uFogBands.x ? uFogAmt.x : d < uFogBands.y ? uFogAmt.y : d < uFogBands.z ? uFogAmt.z : uFogAmt.w;
}
`;

/** Three cel bands from the key light (the cast's look, without the halftone). */
export const CEL = /* glsl */ `
uniform vec3 uLight;
vec3 cel(vec3 col, vec3 n) {
  float l = dot(normalize(n), uLight);
  vec3 shade = l > 0.62 ? vec3(1.06) : l > 0.05 ? vec3(0.92, 0.93, 0.98) : vec3(0.72, 0.74, 0.86);
  return min(col * shade, vec3(1.0));
}
`;

/** Instanced unit boxes (crumbs, confetti) with an ink edge a fixed number of pixels wide. */
export const BOX_VERTEX = /* glsl */ `
attribute vec3 aColor;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vLocal = position;
  vColor = aColor;
  vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const BOX_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform float uDpr;
uniform float uGlow;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
${CEL}
${FOG_PARS}
void main() {
  vec3 a = abs(vLocal);
  vec3 f = max(fwidth(vLocal), vec3(1e-4)) * 1.6 * uDpr;
  // On each face one coordinate sits at ±0.5; ink where either of the others reaches an edge.
  vec3 near = step(vec3(0.5) - f, a);
  float edge = (near.x + near.y + near.z) >= 2.0 ? 1.0 : 0.0;
  vec3 col = cel(vColor, vNormalW);
  col = mix(col, uInk, edge);
  gl_FragColor = vec4(mix(col, uFog, fogAmount(vWorld) * 0.5), edge > 0.5 ? 1.0 : 1.0 - uGlow);
}
`;

/** The props' ink hull: pushed out along welded normals, a fixed number of pixels wide. */
export const HULL_VERTEX = /* glsl */ `
attribute vec3 aHullN;
uniform float uPxScale;
uniform vec4 uHullPx;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 dir = normalize(mat3(modelMatrix) * aHullN);
  float depth = max(1.0, -(viewMatrix * world).z);
  float px = mix(uHullPx.x, uHullPx.y, smoothstep(uHullPx.z, uHullPx.w, depth));
  world.xyz += dir * px * depth * uPxScale;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const HULL_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
varying vec3 vWorld;
${FOG_PARS}
void main() {
  gl_FragColor = vec4(mix(uInk, uFog, fogAmount(vWorld) * 0.5), 1.0);
}
`;
