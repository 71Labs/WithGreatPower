/**
 * GLSL for the post-processing (post.ts). Colours are display sRGB end to end, as in every
 * scene material (palette.ts): the offscreen target holds exactly what the canvas would
 * have shown, so the grade works on the picture the 2D palette was picked for.
 *
 * The scene's materials write how much a pixel glows into alpha, inverted: 1 (what every
 * material wrote before) is no glow, 0 is all glow. Lit windows, lamps, neon, the moon, the
 * web and the river's reflections glow; ink, walls and the cast don't. So the bloom is
 * selective from one ordinary render, with no second pass over the glowing things.
 */

/** One triangle over the screen, with uv from 0 to 1. */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * The first bloom level from the scene: what glows (colour × glow) averaged over the 4×4
 * pixels under it (four bilinear taps a source pixel off the centre). Writes a quarter or a
 * half of the screen.
 */
export const PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uGain;
varying vec2 vUv;
vec3 glow(vec2 uv) {
  vec4 c = texture2D(uSrc, uv);
  return c.rgb * (1.0 - c.a);
}
void main() {
  vec3 s = glow(vUv + vec2(-uTexel.x, -uTexel.y)) + glow(vUv + vec2(uTexel.x, -uTexel.y)) + glow(vUv + vec2(-uTexel.x, uTexel.y)) + glow(vUv + uTexel);
  gl_FragColor = vec4(s * 0.25 * uGain, 1.0);
}
`;

/** Dual-filter downsample: the centre and four diagonal taps (Bjørge, SIGGRAPH 2015). */
export const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(uSrc, vUv).rgb * 4.0;
  s += texture2D(uSrc, vUv - uTexel).rgb;
  s += texture2D(uSrc, vUv + uTexel).rgb;
  s += texture2D(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
  s += texture2D(uSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(s * 0.125, 1.0);
}
`;

/**
 * Dual-filter upsample of the level below (a tent of eight taps), plus this level's own
 * downsample at `uWeight`: the levels sum on the way up into one wide, soft glow.
 */
export const UP_FRAGMENT = /* glsl */ `
uniform sampler2D uLow;
uniform sampler2D uCur;
uniform vec2 uTexel;   // the level below's texel
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D(uLow, vUv + vec2(-2.0 * h.x, 0.0)).rgb;
  s += texture2D(uLow, vUv + vec2(2.0 * h.x, 0.0)).rgb;
  s += texture2D(uLow, vUv + vec2(0.0, -2.0 * h.y)).rgb;
  s += texture2D(uLow, vUv + vec2(0.0, 2.0 * h.y)).rgb;
  s += texture2D(uLow, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  s += texture2D(uLow, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture2D(uLow, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture2D(uLow, vUv + h).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(uCur, vUv).rgb * uWeight, 1.0);
}
`;

/**
 * The picture: FXAA (when the target isn't multisampled), the speed blur, the bloom, the
 * grade (cool shadows, warm highlights, a touch of saturation, a soft shoulder so a bloomed
 * window never clips flat) and a vignette that darkens toward the ink-blue of the sky.
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uTexel;        // one scene pixel, uv
uniform float uFxaa;
uniform float uBloomGain;
uniform vec3 uBloomTint;
uniform vec4 uGrade;        // shadow tint amount, highlight tint amount, saturation, shoulder start
uniform vec3 uLowTint;
uniform vec3 uHighTint;
uniform vec4 uVignette;     // amount, start, end, aspect
uniform vec3 uVignetteTint;
uniform vec3 uBlur;         // focus (uv), strength
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// FXAA in Lottes' console form: the edge's direction from the four diagonal lumas, then two
// or four taps along it.
vec3 fxaa(vec2 uv) {
  vec3 rgbM = texture2D(uScene, uv).rgb;
  vec3 rgbNW = texture2D(uScene, uv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(uScene, uv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(uScene, uv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(uScene, uv + vec2(1.0, 1.0) * uTexel).rgb;
  float lM = luma(rgbM);
  float lNW = luma(rgbNW);
  float lNE = luma(rgbNE);
  float lSW = luma(rgbSW);
  float lSE = luma(rgbSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return rgbM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, -8.0, 8.0) * uTexel;
  vec3 a = 0.5 * (texture2D(uScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(uScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(uScene, uv - dir * 0.5).rgb + texture2D(uScene, uv + dir * 0.5).rgb);
  float lB = luma(b);
  return lB < lMin || lB > lMax ? a : b;
}

vec3 shoulder(vec3 c, float k) {
  vec3 over = max(c - k, 0.0);
  return min(c, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

void main() {
  vec3 c = uFxaa > 0.5 ? fxaa(vUv) : texture2D(uScene, vUv).rgb;

  if (uBlur.z > 0.001) {
    // Toward the edges at speed: a few taps back along the line from the motion's focus.
    vec2 d = vUv - uBlur.xy;
    float w = smoothstep(0.32, 0.9, length(d * vec2(uVignette.w, 1.0))) * uBlur.z;
    if (w > 0.002) {
      vec3 s = c;
      for (int i = 1; i <= 4; i++) s += texture2D(uScene, vUv - d * (float(i) * 0.008 * w)).rgb;
      c = s * 0.2;
    }
  }

  vec3 bloom = texture2D(uBloom, vUv).rgb * uBloomTint * uBloomGain;
  c += bloom;

  float l = clamp(luma(c), 0.0, 1.0);
  c = mix(c, c * uLowTint, (1.0 - l) * (1.0 - l) * uGrade.x);
  c = mix(c, c * uHighTint, l * l * uGrade.y);
  c = mix(vec3(luma(c)), c, uGrade.z);
  c = shoulder(c, uGrade.w);

  vec2 q = (vUv - 0.5) * vec2(uVignette.w, 1.0);
  float r = length(q) / length(vec2(uVignette.w, 1.0) * 0.5);
  c = mix(c, c * uVignetteTint, smoothstep(uVignette.y, uVignette.z, r) * uVignette.x);

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
