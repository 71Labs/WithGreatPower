/**
 * GLSL for the 3D cast, matched to the city's look (city/shaders.ts):
 *
 * - BODY: flat fills from a per-character palette with two or three hard cel bands from
 *   one fixed key light (from +x and above, like the city's face tints), Ben-Day dots in
 *   the shadow band (screen-space, rotated 45°), crisp overlay edges (shirt fronts, ties)
 *   from thresholded masks, the hero's web drawn procedurally in body space (radial on the
 *   mask and chest, ringed lines down the limbs), and sticker-style face decals (lenses,
 *   eyes, brows, mouths, teeth) with ink rims a fixed number of pixels wide.
 * - HULL: the inverted-hull ink outline, skinned with the mesh, pushed out by a CSS-px
 *   width that thins with depth exactly like the city's hulls (3 px near, 1.5 px far), and
 *   optionally back along the view ray so it can't surface in a body's shallow creases.
 *
 * Both skin through three's skinning chunks, so they run on a SkinnedMesh, or on an
 * InstancedMesh that shares one skeleton (The Sybil's copies). Colours are display sRGB.
 */

export const MAX_DECALS = 24;
export const PALETTE_SIZE = 16;

export const GLITCH = /* glsl */ `
uniform float uGlitch;
uniform float uTime;
float gHash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
// Sybil copies: horizontal slices of the body jump sideways for a frame or two.
vec3 glitchOffset(vec3 rest, float seed) {
  if (uGlitch <= 0.0) return vec3(0.0);
  float tick = floor(uTime * 14.0);
  float band = floor(rest.y / 7.0);
  float on = step(0.8, gHash(band * 13.1 + tick * 7.7 + seed * 31.0));
  vec3 side = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  return side * (gHash(band + tick * 3.1 + seed * 5.0) - 0.5) * 10.0 * on * uGlitch;
}
`;

/** Screen-space patterns: the cloak's ordered dither and the Ben-Day dots (needs uDpr, uHalftoneCell). */
export const SCREEN = /* glsl */ `
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int k = i.x + i.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[k]) + 0.5) / 16.0;
}

// Ben-Day dots on a 45° screen grid; k = 0 none … 1 cells fully covered.
float halftone(float k) {
  vec2 p = gl_FragCoord.xy / (uDpr * uHalftoneCell);
  p = vec2(p.x + p.y, p.y - p.x) * 0.70710678;
  vec2 c = fract(p) - 0.5;
  float d = length(c);
  float r = sqrt(clamp(k, 0.0, 1.0)) * 0.72;
  float aa = 0.12;
  return 1.0 - smoothstep(r - aa, r + aa, d);
}
`;

export const BODY_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
${GLITCH}
attribute vec4 aPal;
attribute vec2 aMask;
attribute vec4 aDetail;

varying vec3 vNormalW;
varying vec3 vRest;
varying vec2 vMask;
varying vec4 vDetail;
flat varying vec4 vPal;
flat varying float vSeed;

void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  mat4 model = modelMatrix;
  float seed = 0.0;
#ifdef USE_INSTANCING
  model = modelMatrix * instanceMatrix;
  seed = float(gl_InstanceID) + 1.0;
#endif
  vec4 world = model * vec4(transformed, 1.0);
  world.xyz += glitchOffset(position, seed);
  vNormalW = normalize(mat3(model) * objectNormal);
  vRest = position;
  vMask = aMask;
  vDetail = aDetail;
  vPal = aPal;
  vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const BODY_FRAGMENT = /* glsl */ `
#define MAX_DECALS ${MAX_DECALS}
uniform vec3 uPal[${PALETTE_SIZE}];
uniform vec4 uDecA[MAX_DECALS];   // x, y, rx, ry (face units)
uniform vec4 uDecB[MAX_DECALS];   // rotation, fill index (−1 none), ink px, shape + 8·clip
uniform int uDecN;
uniform vec3 uLight;
uniform vec3 uShadeMid;
uniform vec3 uShadeDark;
uniform float uDpr;
uniform float uHalftone;      // the city's Ben-Day switch (off on the low tier)
uniform float uHalftoneCell;  // its cell, CSS px
uniform float uFlash;
uniform float uFade;
uniform float uWebbed;
uniform float uWebSpacing;
uniform float uGlitch;
uniform float uTime;
uniform vec3 uFog;
uniform float uFogMix;

varying vec3 vNormalW;
varying vec3 vRest;
varying vec2 vMask;
varying vec4 vDetail;
flat varying vec4 vPal;
flat varying float vSeed;

${SCREEN}

// Signed distance (approx) to an ellipse with radii r, in its own frame.
float ellipseD(vec2 q, vec2 r) {
  float k0 = length(q / r);
  float k1 = length(q / (r * r));
  return k1 > 0.0 ? k0 * (k0 - 1.0) / k1 : -min(r.x, r.y);
}

// Web lines: spokes every 2π/n, scalloped rings every \`spacing\`. arcR turns angle into distance.
float webLine(float ang, float r, float arcR, float n, float spacing, float pxw) {
  float sector = 6.28318530718 / n;
  float k = fract(ang / sector + 0.5);
  float ds = min(k, 1.0 - k) * sector * arcR;
  float sp = spacing * (1.0 - 0.18 * sin(3.14159265 * k));
  float rr = r / sp;
  float dr = rr < 0.55 ? 1e3 : abs(rr - floor(rr + 0.5)) * sp;
  float lw = 0.62 * uDpr * pxw;
  float line = 1.0 - smoothstep(lw - pxw * 0.6, lw + pxw * 0.6, min(ds, dr));
  // Too dense on screen (far away): let the lines go rather than shimmer.
  return line * smoothstep(5.0, 10.0, spacing / pxw);
}

void main() {
  if (uFade > 0.0 && bayer4(gl_FragCoord.xy) < uFade) discard;
  int i0 = int(vPal.x + 0.5);
  int i1 = int(vPal.y + 0.5);
  int i2 = int(vPal.z + 0.5);
  int flags = int(vPal.w + 0.5);
  vec3 col = uPal[i0];
  if (vMask.x > 0.5) col = uPal[i1];
  if (vMask.y > 0.5) col = uPal[i2];
  int kind = int(vDetail.w + 0.5);

  // The hero's web, drawn in the fill colour's place (palette 2 is the web colour).
  if (kind == 1 || kind == 3) {
    vec2 uv = vDetail.xy;
    float pxw = max(length(fwidth(uv)) * 0.7071, 1e-4);
    float line = webLine(atan(uv.y, uv.x), length(uv), length(uv), 12.0, uWebSpacing, pxw);
    col = mix(col, uPal[2], line);
  } else if (kind == 4) {
    vec2 ab = vDetail.xy;
    float pxw = max(length(fwidth(vDetail.xyz)) * 0.577, 1e-4);
    float line = webLine(atan(ab.y, ab.x), vDetail.z, length(ab), 6.0, uWebSpacing * 1.5, pxw);
    col = mix(col, uPal[2], line);
  }

  // Cel bands from the fixed key light, with dots easing the mid band into the dark one.
  vec3 n = normalize(vNormalW);
  float l = dot(n, uLight);
  vec3 shade = vec3(1.0);
  if ((flags & 1) == 0) {
    if (l < 0.16) {
      shade = uShadeMid;
      float k = smoothstep(-0.05, -0.42, l);
      if ((flags & 2) == 0 && k > 0.0 && uHalftone > 0.5) shade = mix(uShadeMid, uShadeDark, halftone(k));
      else if (k > 0.5) shade = uShadeDark;
      if (l < -0.42) shade = uShadeDark;
    }
  }
  col *= shade;

  // Face decals on top, flat like the sticker art.
  if (kind == 2 || kind == 3) {
    vec2 uv = vDetail.xy;
    float pxw = max(length(fwidth(uv)) * 0.7071, 1e-4);
    float lastD = 1e3;
    for (int i = 0; i < MAX_DECALS; i++) {
      if (i >= uDecN) break;
      vec4 a = uDecA[i];
      vec4 b = uDecB[i];
      float shape = mod(b.w, 8.0);
      bool clip = b.w >= 7.5;
      vec2 q = uv - a.xy;
      float c = cos(b.x);
      float s = sin(b.x);
      q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
      float d;
      if (shape < 0.5 || (shape > 0.5 && shape < 1.5)) d = ellipseD(q, a.zw);
      else if (shape < 2.5) d = max(ellipseD(q, a.zw), q.y);
      else if (shape < 3.5) d = length(vec2(q.x - clamp(q.x, -a.z, a.z), q.y)) - a.w;
      else d = max(ellipseD(q, a.zw), -q.y);
      if (clip) d = max(d, lastD);
      else lastD = d;
      float rim = min(0.5 * b.z * uDpr * pxw, 0.4 * min(a.z, a.w));
      float aa = pxw * 0.75;
      int fill = int(b.y + 0.5);
      if (shape > 0.5 && shape < 1.5) {
        // A ring (glasses): ink rim and a faint tint inside.
        if (b.y >= 0.0) col = mix(col, uPal[fill], 0.3 * (1.0 - smoothstep(-aa, aa, d)));
      } else if (b.y >= 0.0) {
        col = mix(col, uPal[fill], 1.0 - smoothstep(-aa, aa, d));
      }
      if (b.z > 0.0) col = mix(col, uPal[0], 1.0 - smoothstep(rim - aa, rim + aa, abs(d)));
    }
  }

  // Webbed up: two families of wrapped strands over a paled body.
  if (uWebbed > 0.0) {
    float u1 = (vRest.y + vRest.x * 0.6 + vRest.z * 0.3) / 6.5;
    float u2 = (vRest.y - vRest.x * 0.5 + vRest.z * 0.6) / 8.0;
    float a1 = max(fwidth(u1), 1e-4);
    float a2 = max(fwidth(u2), 1e-4);
    float s1 = 1.0 - smoothstep(0.1, 0.1 + a1 * 1.5, abs(fract(u1) - 0.5));
    float s2 = 1.0 - smoothstep(0.08, 0.08 + a2 * 1.5, abs(fract(u2) - 0.5));
    col = mix(col, mix(col, vec3(1.0) * shade, 0.45), uWebbed);
    col = mix(col, vec3(1.0) * shade, max(s1, s2) * uWebbed);
  }

  if (uGlitch > 0.0) {
    // Scanlines and a cold edge flicker on the copies.
    float row = floor(gl_FragCoord.y / (2.0 * uDpr));
    col *= 0.9 + 0.1 * mod(row, 2.0);
    float band = step(0.93, fract(sin(floor(gl_FragCoord.y / (6.0 * uDpr)) * 12.9898 + floor(uTime * 10.0) + vSeed) * 43758.5453));
    col = mix(col, vec3(0.55, 0.95, 1.0), band * 0.5 * uGlitch);
  }

  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(mix(col, uFog, uFogMix), 1.0);
}
`;

export const HULL_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
${GLITCH}
attribute vec4 aHull;     // push direction (bind space), width multiplier
uniform float uPxScale;   // world units per CSS px at view depth 1
uniform vec4 uHullPx;     // near px, far px, near depth, far depth
uniform float uHullScale;
uniform float uHullBack;  // pushed this far away from the camera (hides it in shallow creases)
void main() {
  vec3 objectNormal = aHull.xyz;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  mat4 model = modelMatrix;
  float seed = 0.0;
#ifdef USE_INSTANCING
  model = modelMatrix * instanceMatrix;
  seed = float(gl_InstanceID) + 1.0;
#endif
  vec4 world = model * vec4(transformed, 1.0);
  world.xyz += glitchOffset(position, seed);
  vec3 dir = normalize(mat3(model) * objectNormal);
  float depth = max(1.0, -(viewMatrix * world).z);
  float px = mix(uHullPx.x, uHullPx.y, smoothstep(uHullPx.z, uHullPx.w, depth)) * aHull.w * uHullScale;
  world.xyz += dir * px * depth * uPxScale;
  // Along the view ray, so the line keeps its place and width on screen.
  world.xyz += normalize(world.xyz - cameraPosition) * uHullBack;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const HULL_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uFog;
uniform float uFogMix;
uniform float uFade;
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int k = i.x + i.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[k]) + 0.5) / 16.0;
}
void main() {
  if (uFade > 0.0 && bayer4(gl_FragCoord.xy) < uFade) discard;
  gl_FragColor = vec4(mix(uInk, uFog, uFogMix * 0.5), 1.0);
}
`;
