/**
 * Fragment shaders for WGP's procedural media. Each scene is a full-screen pass that
 * paints a landscape-like image and finishes it with a print treatment — ordered
 * dithering, a halftone dot matrix, "+" glyph sparkles or contour lines — the way a
 * photo is treated in an editorial layout. Colors come in as a 4-stop palette
 * (uC0 lightest → uC3 deepest).
 *
 * WebGL 1 / GLSL ES 1.00 so it runs everywhere.
 */

const PRELUDE = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uSeed;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i); float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.02 + vec2(3.1, 1.7); a *= 0.5; } return s; }
float ridged(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 6; i++) { float n = 1.0 - abs(noise(p) * 2.0 - 1.0); s += a * n * n; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
vec3 ramp(float t) {
  vec3 c = mix(uC0, uC1, smoothstep(0.0, 0.33, t));
  c = mix(c, uC2, smoothstep(0.33, 0.7, t));
  return mix(c, uC3, smoothstep(0.7, 1.0, t));
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
/* Dot of a size set by tone, centred in each cell of a square grid. */
float halftone(vec2 frag, float cell, float tone) {
  vec2 g = mod(frag, cell) - 0.5 * cell;
  float r = sqrt(clamp(tone, 0.0, 1.0)) * cell * 0.5;
  return 1.0 - smoothstep(r - 0.6, r + 0.6, length(g));
}
/* A "+" glyph in each cell of a grid. */
float plusGlyph(vec2 frag, float cell, float thick) {
  vec2 g = abs(mod(frag, cell) - 0.5 * cell);
  float arm = cell * 0.3;
  return max(step(g.x, thick) * step(g.y, arm), step(g.y, thick) * step(g.x, arm));
}
`;

/** Layered ridged mountain ranges, shaded by slope and rock strata. Tone 0 = sky. */
const TERRAIN_FN = /* glsl */ `
float terrain(vec2 uv, float t) {
  float x = uv.x * uRes.x / uRes.y;
  for (int j = 0; j < 4; j++) {
    float k = 3.0 - float(j);
    float drift = t * (0.004 + 0.006 * k);
    float f = 1.2 + k * 0.9;
    float base = 0.62 - k * 0.15;
    float amp = 0.3 - k * 0.03;
    float px = (x * 0.55 + drift) * f + uSeed + k * 13.7;
    float h = base + amp * (ridged(vec2(px, k * 4.1)) - 0.35);
    if (uv.y < h) {
      float e = 0.01;
      float dh = (ridged(vec2(px + e * f, k * 4.1)) - ridged(vec2(px - e * f, k * 4.1))) * amp / (2.0 * e);
      float depth = h - uv.y;
      float light = clamp(0.5 - dh * 0.35, 0.0, 1.0);
      float strata = ridged(vec2(x * 4.0 + drift * 3.0 + k * 7.0 + uSeed, depth * 9.0 + k));
      float snow = clamp(1.0 - depth / 0.06, 0.0, 1.0);
      float tone = 0.22 + 0.62 * (1.0 - light) * strata + k * 0.07;
      tone = mix(tone, 0.04, snow * 0.65);
      return clamp(tone * (0.55 + 0.15 * k), 0.0, 1.0);
    }
  }
  return max(0.0, 0.1 * (1.0 - uv.y / 0.75));
}
`;

/** Dithered mountains: the hero landscape. One canvas pixel = one dither cell. */
export const TERRAIN = /* glsl */ `${PRELUDE}${TERRAIN_FN}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float tone = terrain(uv, uTime);
  float mist = fbm(vec2(uv.x * uRes.x / uRes.y * 1.5 - uTime * 0.01, uv.y * 3.0));
  tone *= 1.0 - smoothstep(0.3, 0.0, abs(uv.y - 0.38)) * mist * 0.45;
  float levels = 6.0;
  float q = clamp(floor(tone * levels + bayer8(frag)) / levels, 0.0, 1.0);
  gl_FragColor = vec4(ramp(q), 1.0);
}`;

/** Open water seen from the side, with a white halftone matrix drifting over it. */
export const WAVES = /* glsl */ `${PRELUDE}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  float horizon = 0.68;
  float tone;
  if (uv.y > horizon) {
    float s = (uv.y - horizon) / (1.0 - horizon);
    tone = 0.18 + 0.22 * s + 0.12 * fbm(vec2(uv.x * aspect * 1.4 + t * 0.012 + uSeed, uv.y * 5.0));
  } else {
    float depth = (horizon - uv.y) / horizon;
    float persp = 1.0 / (0.12 + depth);
    vec2 q = vec2(uv.x * aspect * persp * 0.7 + t * 0.035 + uSeed, depth * 14.0 - t * 0.05);
    float w = fbm(q + vec2(1.6 * fbm(q * 0.6 + t * 0.03), 0.0));
    float crest = smoothstep(0.58, 0.74, w);
    tone = 0.38 + 0.5 * depth + 0.3 * (w - 0.5) - crest * 0.55;
  }
  tone = clamp(tone, 0.0, 1.0);
  vec3 col = ramp(tone);
  float region = smoothstep(0.52, 0.7, fbm(uv * vec2(aspect, 1.0) * 1.1 + vec2(t * 0.02, 0.0) + uSeed));
  float dots = halftone(frag, 6.0, (1.0 - tone) * 0.7);
  col = mix(col, uC0, dots * region * 0.75);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Out-of-focus color blooms, like flowers shot wide open, under a dot matrix and "+" sparkles. */
export const BLOOM = /* glsl */ `${PRELUDE}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  vec2 p = vec2(uv.x * aspect, uv.y) * 1.3 + uSeed;
  vec2 w = vec2(fbm(p + t * 0.02), fbm(p + vec2(5.2, 1.3) - t * 0.015));
  float n = fbm(p + 1.9 * w);
  vec3 col = mix(uC1, uC2, smoothstep(0.3, 0.72, n));
  col = mix(col, uC3, smoothstep(0.52, 0.8, fbm(p * 0.8 + w * 2.2 + 3.0)) * 0.95);
  float bright = luma(col);
  float band = smoothstep(0.45, 0.7, fbm(vec2(uv.x * aspect * 0.9 - t * 0.01, uv.y * 1.2) + 7.0 + uSeed));
  float dots = halftone(frag, 6.0, bright * 0.9);
  col = mix(col, uC0, dots * band * 0.85);
  float spark = plusGlyph(frag, 9.0, 0.5) * smoothstep(0.64, 0.8, n) * (1.0 - band);
  col = mix(col, uC0, spark * 0.9);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Topographic contours over soft relief, with "+" survey marks on the high ground. */
export const CONTOURS = /* glsl */ `${PRELUDE}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * 1.5 + uSeed;
  float h = fbm(p + vec2(uTime * 0.01, 0.0) + 0.6 * fbm(p * 1.7));
  vec3 col = ramp(h * 0.75);
  float bands = abs(fract(h * 16.0) - 0.5);
  float line = 1.0 - smoothstep(0.02, 0.08, bands);
  float major = 1.0 - smoothstep(0.0, 0.03, abs(fract(h * 4.0) - 0.5));
  col = mix(col, uC2, line * 0.55);
  col = mix(col, uC3, major * 0.5);
  float mark = plusGlyph(frag, 11.0, 0.5) * smoothstep(0.56, 0.66, h);
  col = mix(col, uC0, mark * 0.95);
  float d = bayer8(frag) - 0.5;
  col += d * 0.03;
  gl_FragColor = vec4(col, 1.0);
}`;

/* Soft gradient field: three palette colors flowing through domain-warped noise. */
const FIELD_FN = /* glsl */ `
vec3 field(vec2 p, float t) {
  vec2 w = vec2(fbm(p * 0.9 + vec2(0.0, t * 0.03)), fbm(p * 0.9 + vec2(4.7, 2.3) - t * 0.025));
  float n = fbm(p * 0.8 + 1.7 * w + t * 0.01);
  vec3 c = mix(uC1, uC2, smoothstep(0.25, 0.7, n));
  c = mix(c, uC3, smoothstep(0.5, 0.85, fbm(p * 0.6 + w * 2.0 + 9.0)) * 0.9);
  c = mix(c, uC0, smoothstep(0.62, 0.9, fbm(p * 1.3 - w + 3.0)) * 0.55);
  return c;
}
`;

/**
 * Fluted glass over a flowing gradient: each vertical rib refracts the field like a
 * cylinder lens, with chromatic aberration, a bright edge on every rib, a slow light
 * beam and film grain.
 */
export const GLASS = /* glsl */ `${PRELUDE}${FIELD_FN}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  float rib = 22.0;
  float r = fract(frag.x / rib) - 0.5;
  float lens = r * 0.11;
  vec2 p = vec2(uv.x * aspect, uv.y) * 1.6 + uSeed;
  vec3 col;
  col.r = field(p + vec2(lens * 1.25, 0.0), t).r;
  col.g = field(p + vec2(lens, 0.0), t).g;
  col.b = field(p + vec2(lens * 0.75, 0.0), t).b;
  float edge = smoothstep(0.38, 0.5, abs(r));
  col = mix(col, uC0, edge * 0.22);
  col *= 1.0 - (0.5 - abs(r)) * 0.08;
  float beam = smoothstep(0.24, 0.0, abs(uv.x * 0.8 + uv.y * 0.55 - 0.85 - sin(t * 0.07) * 0.08));
  col = mix(col, uC0, beam * 0.35);
  float grain = hash(frag + fract(t) * 91.7) - 0.5;
  col += grain * 0.06;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Light beams through haze over a gradient field, with grain. */
export const BEAM = /* glsl */ `${PRELUDE}${FIELD_FN}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  vec2 p = vec2(uv.x * aspect, uv.y) * 1.2 + uSeed;
  vec3 col = field(p, t);
  float a = uv.x * 0.9 - uv.y * 0.45;
  float shafts = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float c = 0.18 + fi * 0.27 + sin(t * (0.05 + fi * 0.02) + fi) * 0.05;
    shafts += smoothstep(0.09 + fi * 0.03, 0.0, abs(a - c)) * (0.55 - fi * 0.12);
  }
  float haze = fbm(vec2(a * 6.0, uv.y * 2.0 - t * 0.02));
  col = mix(col, uC0, shafts * (0.5 + 0.5 * haze));
  float grain = hash(frag + fract(t) * 57.3) - 0.5;
  col += grain * 0.07;
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * A city at night, three depths of towers drifting at different speeds, lit windows that
 * flicker on and off, antennas on the tallest, and two web strands slung across the
 * rooftops. Tone 0 = sky.
 */
const SKYLINE_FN = /* glsl */ `
float spike(float id, float k) { return step(0.86, hash(vec2(id * 1.37, k * 3.1 + uSeed))); }
float tower(float id, float k) {
  return 0.14 + 0.06 * (2.0 - k) + hash(vec2(id, k * 7.13 + uSeed)) * 0.2 + spike(id, k) * 0.1;
}
float skyline(vec2 uv, vec2 frag, float t) {
  // Narrow screens still get a row of towers, not three giants.
  float xs = max(uRes.x / uRes.y, 1.1);
  float unitPx = uRes.x / xs;
  float x = uv.x * xs;
  float tone = 0.05 + 0.07 * (1.0 - smoothstep(0.05, 0.75, uv.y)) + 0.04 * fbm(vec2(x * 1.3 - t * 0.008 + uSeed, uv.y * 2.5));
  float cell = 26.0;
  float star = plusGlyph(frag, cell, 0.6) * step(0.95, hash(floor(frag / cell) + uSeed));
  tone = mix(tone, 0.3, star * smoothstep(0.45, 0.8, uv.y));
  for (int j = 0; j < 3; j++) {
    float k = float(j);
    float w = 0.085 - k * 0.012;
    float px = x / w + t * (0.03 + k * 0.04) + k * 17.0 + uSeed;
    float id = floor(px);
    float fx = fract(px);
    float gap = 0.04 + 0.12 * hash(vec2(id, k + 5.0));
    float h = tower(id, k);
    float body = step(gap, fx) * step(fx, 1.0 - gap) * step(uv.y, h);
    float ant = spike(id, k) * step(abs(fx - 0.5) * w * unitPx, 1.0) * step(h, uv.y) * step(uv.y, h + 0.07);
    if (body + ant > 0.5) {
      float base = 0.3 + k * 0.24;
      float shade = step(0.62, fx) * 0.07;
      float u = (fx - gap) / (1.0 - 2.0 * gap);
      float rowH = 0.024;
      float wx = fract(u * 4.0);
      float wy = fract(uv.y / rowH);
      float win = step(0.28, wx) * step(wx, 0.72) * step(0.3, wy) * step(wy, 0.72) * body * step(uv.y, h - 0.02);
      vec2 wid = vec2(floor(u * 4.0) + id * 8.0, floor(uv.y / rowH) + k * 40.0);
      float lit = step(0.64, hash(wid + floor(t * 0.12 + hash(wid) * 7.0)));
      float cap = step(h - 0.007, uv.y) * body;
      tone = base + shade + cap * 0.14;
      tone = mix(tone, mix(base + 0.08, base - 0.3, lit), win);
    }
  }
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float span = 1.3 + fi * 0.8;
    float f = fract((x + fi * 0.7 + uSeed * 0.1) / span);
    float ys = 0.4 - fi * 0.09 - 0.1 * sin(3.14159 * f);
    float d = abs(uv.y - ys) * uRes.y;
    tone = mix(tone, 0.95, 1.0 - smoothstep(0.5, 1.3, d));
  }
  return clamp(tone, 0.0, 1.0);
}
`;
export const SKYLINE = /* glsl */ `${PRELUDE}${SKYLINE_FN}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float tone = skyline(uv, frag, uTime);
  float levels = 6.0;
  float q = clamp(floor(tone * levels + bayer8(frag)) / levels, 0.0, 1.0);
  gl_FragColor = vec4(ramp(q), 1.0);
}`;

/** An orb web strung across soft dithered blooms, turning very slowly. */
export const WEBS = /* glsl */ `${PRELUDE}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - vec2(0.3, 0.68)) * vec2(aspect, 1.0);
  float r = length(p);
  float sector = 6.28318 / 14.0;
  float a = atan(p.y, p.x) + uTime * 0.01 + uSeed;
  float al = mod(a, sector) - 0.5 * sector;
  float onePx = 1.0 / uRes.y;
  float thread = 1.0 - smoothstep(0.5, 1.4, abs(sin(al)) * r / onePx);
  for (int i = 1; i < 13; i++) {
    float fi = float(i);
    float R = 0.065 * fi * (1.0 + 0.05 * sin(fi * 3.7 + uSeed));
    float rp = R * cos(0.5 * sector) / cos(al) - R * 0.07 * (1.0 - abs(al) / (0.5 * sector));
    thread = max(thread, 1.0 - smoothstep(0.5, 1.4, abs(r - rp) / onePx));
  }
  thread *= 1.0 - smoothstep(0.7, 0.86, r);
  float bg = fbm(uv * vec2(aspect, 1.0) * 1.3 + vec2(uTime * 0.012, uSeed));
  float tone = clamp(0.2 + 0.7 * bg + 0.15 * (1.0 - uv.y), 0.0, 1.0);
  float q = clamp(floor(tone * 5.0 + bayer8(frag)) / 5.0, 0.0, 1.0);
  vec3 col = mix(ramp(q), uC0, thread * 0.95);
  gl_FragColor = vec4(col, 1.0);
}`;

export type SceneName = "terrain" | "waves" | "bloom" | "contours" | "glass" | "beam" | "skyline" | "webs";

export const SCENES: Record<SceneName, string> = {
  terrain: TERRAIN,
  waves: WAVES,
  bloom: BLOOM,
  contours: CONTOURS,
  glass: GLASS,
  beam: BEAM,
  skyline: SKYLINE,
  webs: WEBS,
};

/** Photo-like palettes (light → deep) for media panels; they don't follow the theme. */
export const MEDIA_PALETTES: Record<string, [string, string, string, string]> = {
  glacier: ["#f6f8ff", "#b9cbff", "#3567f2", "#0b1f63"],
  ocean: ["#f2f7ff", "#8fb2ff", "#2459e6", "#081a52"],
  dusk: ["#ffffff", "#7ea6ff", "#8b6cf0", "#ff7fb8"],
  survey: ["#ffffff", "#d6e0ff", "#4b6fff", "#1c2f8f"],
  lagoon: ["#ffffff", "#7fd6ff", "#3a7bff", "#7a5cff"],
  /** Fluted-glass and beam looks. */
  sapphire: ["#eef3ff", "#5b8cff", "#1d3fd6", "#0a1440"],
  aurora: ["#f4f1ff", "#9fb8ff", "#6a4cff", "#ff8fc7"],
  mist: ["#ffffff", "#dfe7ff", "#8aa6ff", "#2d4bd8"],
  /** WGP: hero reds, a night city and a comic-print dusk. */
  ember: ["#fff6f3", "#ffb3a6", "#e0362a", "#4a0b08"],
  nightcity: ["#f4f5ff", "#a4acdf", "#2e3375", "#0c0e26"],
  comic: ["#fffaf0", "#ffcf6b", "#e5392c", "#2a1638"],
  dusk2: ["#ffffff", "#ffbfd0", "#e6475d", "#3a1240"],
};

/** CSS fallback with the same palette when WebGL is unavailable. */
export function paletteFallback(p: [string, string, string, string]): string {
  return `radial-gradient(120% 80% at 30% 20%, ${p[0]}, transparent 60%), linear-gradient(160deg in oklab, ${p[1]}, ${p[2]} 60%, ${p[3]})`;
}
