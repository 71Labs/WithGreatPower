/**
 * GLSL for the hero's MPFB body (hero-model.ts), in the cast's comic look (shaders.ts):
 *
 * - The suit is drawn from the model's own web coordinates, the same pattern as the header
 *   renders (launch/brand/hero/render.py's web_mask): radial lines and sagging rings per
 *   cell, ink lines one to two CSS px wide. Where they would crowd (rings closer than ~12
 *   CSS px) every other line goes, and under ~4 px the rest go too, so it never shimmers.
 * - Cel bands from the cast's key light, with the baked AO folded into the light so muscle
 *   creases band too: a lit band, the suit colour, a mid band eased into the dark one with
 *   the city's Ben-Day dots, and a thin rim where the silhouette faces the light.
 * - The mask's lens and rim shells are flat (white and ink).
 * - A pale suit (Snow: near-white with a light web) would read as a bare, pale body, so it takes
 *   a suit's cues (uTrim, from the suit's lightness): its web lines in a deeper shade of the
 *   web's own colour (uWebLine) and a touch wider, and gloves and boots (aTrim) in the web
 *   colour, a shade deeper. Every other suit draws exactly as before (uTrim 0).
 *
 * The hull is the cast's own (HULL_VERTEX), fed by the model's `aHull`.
 */
import { SCREEN } from "./shaders";

export const HERO_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute vec3 aWebP;
attribute vec3 aWebQ;
attribute vec3 aWebR;
attribute float aAO;
attribute float aTrim;

varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vWebP;
varying vec3 vWebQ;
varying vec3 vWebR;
varying float vAO;
varying float vTrim;

void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  vWorld = world.xyz;
  vRest = position;
  vWebP = aWebP;
  vWebQ = aWebQ;
  vWebR = aWebR;
  vAO = aAO;
  vTrim = aTrim;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const HERO_FRAGMENT = /* glsl */ `
uniform vec3 uSuit;
uniform vec3 uWeb;
uniform vec3 uLens;
uniform vec3 uInk;
uniform vec3 uLight;
uniform vec3 uShadeMid;
uniform vec3 uShadeDark;
uniform float uDpr;
uniform float uHalftone;
uniform float uHalftoneCell;
uniform float uWebHalf;   // the web line's half width on the body (body units)
uniform float uAo;
uniform float uFlash;
uniform float uFade;
uniform float uTrim;      // a pale suit's cues: 0 none … 1 full
uniform vec3 uWebLine;    // its web lines' colour (the web's own, deeper)
uniform vec3 uFog;
uniform float uFogMix;

varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vRest;
varying vec3 vWebP;
varying vec3 vWebQ;
varying vec3 vWebR;
varying float vAO;
varying float vTrim;

${SCREEN}

// The web: P = (cos θ, sin θ, d), Q = (ρ, radials, ring spacing), R = (sag A, B, cell),
// drawn with every c-th radial and ring (c = 1, or 2 for the simplified far web).
float webAt(vec3 P, vec3 Q, vec3 R, float pxw, float c) {
  float n = Q.y / c;
  float S = Q.z * c;
  float t = fract(atan(P.y, P.x) / 6.28318530718 * n);
  float f = 4.0 * t * (1.0 - t);
  float dRad = min(t, 1.0 - t) * (6.28318530718 / n) * Q.x;
  float den = S * (1.0 - R.y * f);
  float q = (P.z + R.x * f) / den;
  float dRing = abs(q - floor(q + 0.5)) * den;
  float hw = clamp(uWebHalf * (1.0 + 0.35 * uTrim), (0.5 + 0.25 * uTrim) * uDpr * pxw, (1.1 + 0.4 * uTrim) * uDpr * pxw);
  float aa = pxw * 0.6;
  float radial = 1.0 - smoothstep(hw - aa, hw + aa, dRad);
  float ring = (1.0 - smoothstep(hw - aa, hw + aa, dRing)) * step(0.6, q);
  // Radial cells keep a clean hub: their radials start at the first ring.
  radial *= max(step(0.97, q), step(1e-4, R.x));
  return max(radial, ring);
}

// The full web up close; every other line once it crowds; nothing when even that would
// shimmer (ring spacing in CSS px decides).
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

void main() {
  if (uFade > 0.0 && bayer4(gl_FragCoord.xy) < uFade) discard;
  float kind = vWebR.z;
  vec3 col;
  float glow = 0.0;
  if (kind > 8.5) col = uInk;
  else if (kind > 7.5) col = uLens;
  else {
    float pxw = max(length(fwidth(vRest)) * 0.577, 1e-4);
    // A pale suit: gloves and boots in its web colour, a shade deeper; the lines deeper (inked on the trim).
    float trim = uTrim * step(0.5, vTrim);
    vec3 base = mix(uSuit, mix(uWeb, uWebLine, 0.45), trim);
    vec3 line = mix(mix(uWeb, uWebLine, uTrim), mix(uWeb, uInk, 0.55), trim);
    // A hit (or SAVED!) blinks the suit hot, in its own colour, under white Ben-Day dots;
    // never a flat wash toward white: far off the web fades out, and a washed-out suit reads
    // as a bare, pale figure (a mannequin). The ink and lenses don't blink.
    vec3 hot = mix(base / max(max(base.r, base.g), max(base.b, 0.05)), vec3(1.0), 0.12);
    vec3 suit = mix(mix(base, hot, uFlash), vec3(1.0), uFlash > 0.0 ? halftone(uFlash * 0.18) : 0.0);
    col = mix(suit, line, web(vWebP, vWebQ, vWebR, pxw));
    vec3 n = normalize(vNormalW);
    float l = dot(n, uLight) - (1.0 - vAO) * uAo;
    vec3 shade = vec3(1.0);
    if (l > 0.78) shade = vec3(1.1);
    else if (l < 0.16) {
      shade = uShadeMid;
      float k = smoothstep(-0.05, -0.42, l);
      if (k > 0.0 && uHalftone > 0.5) shade = mix(uShadeMid, uShadeDark, halftone(k));
      else if (k > 0.5) shade = uShadeDark;
      if (l < -0.42) shade = uShadeDark;
    }
    col = min(col * shade, vec3(1.0));
    // A thin rim of light where the silhouette turns toward the key.
    vec3 v = normalize(cameraPosition - vWorld);
    float rim = smoothstep(0.62, 0.7, 1.0 - abs(dot(n, v))) * step(0.25, dot(n, uLight));
    col = mix(col, vec3(1.0, 0.93, 0.82), rim * 0.32);
    // And a cool moonlit edge on the shadow side, so the suit separates from the night.
    float back = smoothstep(0.68, 0.78, 1.0 - abs(dot(n, v))) * (1.0 - step(0.25, dot(n, uLight)));
    col = mix(col, vec3(0.62, 0.74, 1.0), back * 0.4);
    glow = rim * 0.22 + back * 0.28;
  }
  // Alpha: the bloom's inverted glow (render/post-shaders.ts).
  gl_FragColor = vec4(mix(col, uFog, uFogMix), 1.0 - glow * (1.0 - uFogMix));
}
`;
