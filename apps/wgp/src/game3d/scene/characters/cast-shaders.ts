/**
 * GLSL for the cast's MPFB bodies (cast-model.ts), in the hero's comic look (hero-shaders.ts):
 *
 * - Flat fills from the character's palette (one entry per face, `aPal`), so clothes, skin,
 *   hair and props keep crisp seams.
 * - Cel bands from the cast's key light with the baked AO folded in: a lit band, the fill, a
 *   mid band eased into the dark one with the city's Ben-Day dots, and a thin warm rim where
 *   the silhouette turns toward the light. Flat entries (ink, lenses) skip the bands; glossy
 *   ones (The Sybil's black) get a hard white highlight, like the sticker's.
 * - The face is painted like the sticker art: decals in cm on the face's plane (`aFace`), with
 *   ink rims a fixed number of pixels wide: eyes, pupils, brows, mouths, teeth, blush, the
 *   Sybil's jagged eyes and fangs.
 * - Gwei's mask web (USE_WEB) from build.py's coordinates, as on the hero.
 * - The scene's effects: hit flash, cloak dither, webbed strands, fog, and the Sybil copies'
 *   glitch. Copies are one instanced draw (USE_POSES): each copy reads one of a few poses
 *   packed in the bone texture, so they don't all move as one.
 *
 * The hull is the cast's own (shaders.ts HULL_VERTEX) for single bodies; the copies use
 * CAST_HULL_VERTEX, which skins through the same packed poses.
 */
import { GLITCH, JPEG_SNAP, SCREEN } from "./shaders";

/**
 * Case file 001's captive Mary (USE_JPEG): saved as a compressed screenshot, by `uJpeg` (0 clean
 * … 1 fully compressed). Her face's features snap to blocks, her shading to a few facets, and
 * her colours to `uJpegLevels` levels (luma dithered per image pixel, chroma coarser), in 8×8
 * blocks of an "image" anchored on her (`uJpegGrid`: her centre in CSS px, CSS px per image
 * pixel), each block a little off in tone with a faint seam.
 */
const JPEG_PARS = /* glsl */ `
#ifdef USE_JPEG
uniform float uJpeg;
uniform float uJpegLevels;
uniform vec3 uJpegGrid;
float jHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
#endif
`;

const JPEG_COLOUR = /* glsl */ `
#ifdef USE_JPEG
  if (uJpeg > 0.01) {
    vec2 vp = (gl_FragCoord.xy / uDpr - uJpegGrid.xy) / max(uJpegGrid.z, 0.05);
    vec2 blk = floor(vp / 8.0);
    vec2 inb = vp - blk * 8.0;
    float h = jHash(blk);
    float dither = jHash(floor(vp) + 17.0) - 0.5;
    float L = uJpegLevels;
    float Y = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 ch = col - Y;
    float Yq = floor(Y * L + 0.5 + dither * 0.9) / L + (h - 0.5) * 0.09 * uJpeg;
    vec3 chq = floor(ch * L * 0.5 + 0.5) / (L * 0.5) + (jHash(blk + 5.0) - 0.5) * 0.05 * uJpeg;
    vec3 q = clamp(vec3(Yq) + chq, 0.0, 1.0);
    float seam = (step(7.0, inb.x) + step(7.0, inb.y)) > 0.5 ? 0.14 * uJpeg : 0.0;
    col = mix(col, q * (1.0 - seam), smoothstep(0.0, 0.35, uJpeg));
  }
#endif
`;

export const CAST_MAX_DECALS = 24;
export const CAST_PALETTE = 16;

/** Skinning through a pose block of the bone texture (the copies), else three's chunks. */
const SKIN = /* glsl */ `
#ifdef USE_POSES
  float poseBase = aPose * uBones;
  mat4 boneMatX = getBoneMatrix(skinIndex.x + poseBase);
  mat4 boneMatY = getBoneMatrix(skinIndex.y + poseBase);
  mat4 boneMatZ = getBoneMatrix(skinIndex.z + poseBase);
  mat4 boneMatW = getBoneMatrix(skinIndex.w + poseBase);
#else
  #include <skinbase_vertex>
#endif
`;

const POSE_PARS = /* glsl */ `
#ifdef USE_POSES
attribute float aPose;
uniform float uBones;
#endif
`;

export const CAST_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
${GLITCH}
${JPEG_SNAP}
${POSE_PARS}
attribute float aPal;
attribute vec3 aFace;
attribute float aAO;
#ifdef USE_WEB
attribute vec3 aWebP;
attribute vec3 aWebQ;
attribute vec3 aWebR;
varying vec3 vWebP;
varying vec3 vWebQ;
varying vec3 vWebR;
#endif

varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vFace;
varying float vAO;
flat varying float vPal;
flat varying float vSeed;

void main() {
  #include <beginnormal_vertex>
  ${SKIN}
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
#ifdef USE_JPEG
  world.xyz = jpegSnap(world.xyz);
#endif
  world.xyz += glitchOffset(position, seed);
  vNormalW = normalize(mat3(model) * objectNormal);
  vWorld = world.xyz;
  vRest = position;
  vFace = aFace;
  vAO = aAO;
  vPal = aPal;
  vSeed = seed;
#ifdef USE_WEB
  vWebP = aWebP;
  vWebQ = aWebQ;
  vWebR = aWebR;
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** The cast hull, for the copies: the same push as HULL_VERTEX, skinned through the pose blocks. */
export const CAST_HULL_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
${GLITCH}
${POSE_PARS}
attribute vec4 aHull;
uniform float uPxScale;
uniform vec4 uHullPx;
uniform float uHullScale;
uniform float uHullBack;
void main() {
  vec3 objectNormal = aHull.xyz;
  ${SKIN}
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
  world.xyz += normalize(world.xyz - cameraPosition) * uHullBack;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const CAST_FRAGMENT = /* glsl */ `
#define MAX_DECALS ${CAST_MAX_DECALS}
uniform vec3 uPal[${CAST_PALETTE}];
uniform float uPalFlags[${CAST_PALETTE}];  // 1 flat, 2 gloss, 4 glow (a decal fill)
uniform vec4 uDecA[MAX_DECALS];   // x, y, rx, ry (cm)
uniform vec4 uDecB[MAX_DECALS];   // rotation, fill (−1 none), ink px, shape + 16·clip
uniform vec4 uDecC[MAX_DECALS];   // spikes or teeth, depth
uniform int uDecN;
uniform vec3 uLight;
uniform vec3 uShadeMid;
uniform vec3 uShadeDark;
uniform float uDpr;
uniform float uHalftone;
uniform float uHalftoneCell;
uniform float uAo;
uniform float uFlash;
uniform float uFade;
uniform float uWebbed;
uniform float uGlitch;
uniform float uTime;
uniform vec3 uFog;
uniform float uFogMix;
#ifdef USE_WEB
uniform vec3 uWebColor;
uniform float uWebHalf;
varying vec3 vWebP;
varying vec3 vWebQ;
varying vec3 vWebR;
#endif

varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vFace;
varying float vAO;
flat varying float vPal;
flat varying float vSeed;

${SCREEN}
${JPEG_PARS}

float ellipseD(vec2 q, vec2 r) {
  float k0 = length(q / r);
  float k1 = length(q / (r * r));
  return k1 > 0.0 ? k0 * (k0 - 1.0) / k1 : -min(r.x, r.y);
}

float tri(float u) {
  return 1.0 - abs(2.0 * fract(u) - 1.0);
}

#ifdef USE_WEB
// The hero's web (hero-shaders.ts), every c-th radial and ring.
float webAt(vec3 P, vec3 Q, vec3 R, float pxw, float c) {
  float n = Q.y / c;
  float S = Q.z * c;
  float t = fract(atan(P.y, P.x) / 6.28318530718 * n);
  float f = 4.0 * t * (1.0 - t);
  float dRad = min(t, 1.0 - t) * (6.28318530718 / n) * Q.x;
  float den = S * (1.0 - R.y * f);
  float q = (P.z + R.x * f) / den;
  float dRing = abs(q - floor(q + 0.5)) * den;
  float hw = clamp(uWebHalf, 0.5 * uDpr * pxw, 1.1 * uDpr * pxw);
  float aa = pxw * 0.6;
  float radial = 1.0 - smoothstep(hw - aa, hw + aa, dRad);
  float ring = (1.0 - smoothstep(hw - aa, hw + aa, dRing)) * step(0.6, q);
  radial *= max(step(0.97, q), step(1e-4, R.x));
  return max(radial, ring);
}

float web(vec3 P, vec3 Q, vec3 R, float pxw) {
  if (Q.y < 0.5) return 0.0;
  float px = Q.z / (pxw * uDpr);
  float fine = smoothstep(9.0, 14.0, px);
  float coarse = smoothstep(3.0, 5.0, px);
  float line = 0.0;
  if (fine > 0.0) line = webAt(P, Q, R, pxw, 1.0) * fine;
  if (fine < 1.0 && coarse > 0.0) line = max(line, webAt(P, Q, R, pxw, 2.0) * coarse);
  return line;
}
#endif

void main() {
  if (uFade > 0.0 && bayer4(gl_FragCoord.xy) < uFade) discard;
  int pi = int(vPal + 0.5);
  vec3 col = uPal[pi];
  float flags = uPalFlags[pi];
  bool isFlat = mod(flags, 2.0) > 0.5;
  bool gloss = mod(floor(flags / 2.0), 2.0) > 0.5;

#ifdef USE_WEB
  if (vWebR.z < 7.5) {
    float pxw = max(length(fwidth(vRest)) * 0.577, 1e-4);
    col = mix(col, uWebColor, web(vWebP, vWebQ, vWebR, pxw));
  }
#endif

  // The painted face, flat like the sticker art (under the bands, so it shades with the head).
  float decalGlow = 0.0;
  vec3 glowCol = vec3(0.0);
  if (vFace.z > 0.5) {
    vec2 uv = vFace.xy;
    float pxw = max(length(fwidth(uv)) * 0.7071, 1e-4);
#ifdef USE_JPEG
    if (uJpeg > 0.01) {
      float q = 0.3 + 1.1 * uJpeg;
      uv = (floor(uv / q) + 0.5) * q;
    }
#endif
    float lastD = 1e3;
    for (int i = 0; i < MAX_DECALS; i++) {
      if (i >= uDecN) break;
      vec4 a = uDecA[i];
      vec4 b = uDecB[i];
      vec4 c = uDecC[i];
      float shape = mod(b.w, 16.0);
      bool clip = b.w >= 15.5;
      vec2 q = uv - a.xy;
      float cs = cos(b.x);
      float sn = sin(b.x);
      q = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
      vec2 r = a.zw;
      float d;
      float hw = 0.5 * b.z * uDpr * pxw;
      if (shape < 1.5) d = ellipseD(q, r);
      else if (shape < 2.5) d = max(ellipseD(q, r), q.y);
      else if (shape < 3.5) d = length(vec2(q.x - clamp(q.x, -r.x, r.x), q.y)) - r.y;
      else if (shape < 4.5) d = max(ellipseD(q, r), -q.y);
      else if (shape < 5.5) d = max(abs(ellipseD(q, r)) - max(hw, 0.6 * uDpr * pxw), q.y);
      else if (shape < 6.5) {
        // Jagged: the rim pulled in between c.x spikes by c.y of the radius.
        float ang = atan(q.y / r.y, q.x / r.x) / 6.28318530718;
        float k0 = length(q / r);
        float edge = 1.0 - c.y * (1.0 - tri(ang * c.x));
        d = (k0 - edge) * min(r.x, r.y);
      } else if (shape < 7.5) {
        // Teeth: two rows of c.x points each, c.y of the half height long.
        float u = (q.x / r.x + 1.0) * 0.5 * c.x;
        float t = tri(u - 0.5);
        float top = r.y * (1.0 - 2.0 * c.y * t) - q.y;
        float bot = q.y + r.y * (1.0 - 2.0 * c.y * tri(u));
        d = max(min(top, bot), abs(q.x) - r.x);
      } else {
        // A rounded rectangle (the Right-Clicker's pixel eyes).
        float cr = 0.22 * min(r.x, r.y);
        vec2 e = abs(q) - r + cr;
        d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - cr;
      }
      if (clip) d = max(d, lastD);
      else lastD = d;
      float rim = min(hw, 0.4 * min(r.x, r.y));
      float aa = pxw * 0.75;
      int fill = int(b.y + 0.5);
      if (shape > 0.5 && shape < 1.5) {
        if (b.y >= 0.0) col = mix(col, uPal[fill], 0.3 * (1.0 - smoothstep(-aa, aa, d)));
      } else if (b.y >= 0.0) {
        col = mix(col, uPal[fill], 1.0 - smoothstep(-aa, aa, d));
        // A glowing fill (flag 4) keeps its colour through the bands and blooms.
        if (mod(floor(uPalFlags[fill] / 4.0), 2.0) > 0.5) {
          float inside = 1.0 - smoothstep(-aa, aa, d + (b.z > 0.0 ? rim : 0.0));
          if (inside > decalGlow) {
            decalGlow = inside;
            glowCol = uPal[fill];
          }
        }
      }
      if (b.z > 0.0 && (shape < 4.5 || shape > 5.5)) col = mix(col, uPal[0], 1.0 - smoothstep(rim - aa, rim + aa, abs(d)));
    }
  }

  vec3 n = normalize(vNormalW);
#ifdef USE_JPEG
  if (uJpeg > 0.01) {
    float k = mix(6.0, 1.6, uJpeg);
    n = normalize(floor(n * k + 0.5) + n * 0.001);
  }
#endif
  vec3 v = normalize(cameraPosition - vWorld);
  float l = dot(n, uLight);
  float glow = 0.0;
  if (!isFlat) {
    l -= (1.0 - vAO) * uAo;
    vec3 shade = vec3(1.0);
    if (l > 0.78) shade = vec3(1.08);
    else if (l < 0.16) {
      shade = uShadeMid;
      float k = smoothstep(-0.05, -0.42, l);
      if (k > 0.0 && uHalftone > 0.5) shade = mix(uShadeMid, uShadeDark, halftone(k));
      else if (k > 0.5) shade = uShadeDark;
      if (l < -0.42) shade = uShadeDark;
    }
    col = min(col * shade, vec3(1.0));
    float rim = smoothstep(0.62, 0.7, 1.0 - abs(dot(n, v))) * step(0.25, dot(n, uLight));
    col = mix(col, vec3(1.0, 0.93, 0.82), rim * 0.28);
    // A cool moonlit edge on the shadow side, so the body separates from the night.
    float back = smoothstep(0.68, 0.78, 1.0 - abs(dot(n, v))) * (1.0 - step(0.25, dot(n, uLight)));
    col = mix(col, vec3(0.62, 0.74, 1.0), back * 0.36);
    glow = rim * 0.2 + back * 0.25;
    if (gloss) {
      // A hard white streak where the key light glances off (the sticker's highlights).
      float s = dot(reflect(-uLight, n), v);
      col = mix(col, vec3(1.0), smoothstep(0.86, 0.9, s) * 0.85);
      col = mix(col, vec3(0.42, 0.44, 0.52), smoothstep(0.55, 0.62, 1.0 - abs(dot(n, v))) * 0.5);
    }
  }

  // Glowing decals (the Right-Clicker's eyes in the hood's shade): unshaded, and blooming.
  if (decalGlow > 0.0) {
    col = mix(col, glowCol, decalGlow);
    glow = max(glow, decalGlow * 0.7);
  }

  // Webbed up: two families of wrapped strands over a paled body.
  if (uWebbed > 0.0) {
    float u1 = (vRest.y + vRest.x * 0.6 + vRest.z * 0.3) / 6.5;
    float u2 = (vRest.y - vRest.x * 0.5 + vRest.z * 0.6) / 8.0;
    float a1 = max(fwidth(u1), 1e-4);
    float a2 = max(fwidth(u2), 1e-4);
    float s1 = 1.0 - smoothstep(0.1, 0.1 + a1 * 1.5, abs(fract(u1) - 0.5));
    float s2 = 1.0 - smoothstep(0.08, 0.08 + a2 * 1.5, abs(fract(u2) - 0.5));
    vec3 white = vec3(clamp(0.6 + 0.4 * l, 0.75, 1.0));
    col = mix(col, mix(col, white, 0.45), uWebbed);
    col = mix(col, white, max(s1, s2) * uWebbed);
  }

  if (uGlitch > 0.0) {
    float row = floor(gl_FragCoord.y / (2.0 * uDpr));
    col *= 0.9 + 0.1 * mod(row, 2.0);
    float band = step(0.93, fract(sin(floor(gl_FragCoord.y / (6.0 * uDpr)) * 12.9898 + floor(uTime * 10.0) + vSeed) * 43758.5453));
    col = mix(col, vec3(0.55, 0.95, 1.0), band * 0.5 * uGlitch);
  }

${JPEG_COLOUR}
  col = mix(col, vec3(1.0), uFlash);
  // Alpha: the bloom's inverted glow (render/post-shaders.ts).
  gl_FragColor = vec4(mix(col, uFog, uFogMix), 1.0 - glow * (1.0 - uFogMix));
}
`;
