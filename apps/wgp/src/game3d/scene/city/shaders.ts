/**
 * GLSL for the sticker city. Two materials draw every box and tank in the city:
 *
 * - TOON: unlit flat fills. Instance colour × a face tint (top 1.0, sides 0.92 / 0.84 /
 *   0.76), procedural outlined windows that mirror render/city.ts `windowGrid` (same cell
 *   sizes and the same integer hash, so a seed lights the same windows), parapet caps, doors,
 *   awnings and the white "shine" stroke; crease edges inked in screen pixels; flat banded fog
 *   per instance. Prop kinds (AC, light, billboard, lattice mast, bridge truss, tank) branch
 *   on `aInfo.x`.
 * - HULL: the inverted-hull outline. Back faces of the same instances pushed out along a
 *   smoothed direction (a box corner's (±1, ±1, ±1), so faces move out evenly and corners
 *   never gap) by a width in CSS px that thins from 3 near to 1.5 far.
 *
 * Colours are display sRGB throughout (see palette.ts).
 */

/** Shared GLSL: the 2D renderer's hash01 (integer exact), banded fog, face tint. */
const COMMON = /* glsl */ `
float hash01(float n) {
  uint h = uint(int(n)) ^ 0x9e3779b9u;
  h = (h ^ (h >> 16u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h ^= h >> 16u;
  return float(h) / 4294967296.0;
}

float fogBand(vec2 ref, vec3 bands) {
  float d = length(cameraPosition.xz - ref);
  return d < bands.x ? 0.0 : d < bands.y ? 1.0 : d < bands.z ? 2.0 : 3.0;
}

float fogAmount(float band, vec4 amt) {
  return band < 0.5 ? amt.x : band < 1.5 ? amt.y : band < 2.5 ? amt.z : amt.w;
}
`;

export const TOON_VERTEX = /* glsl */ `
${COMMON}
attribute vec3 aColor;
attribute vec4 aInfo;   // kind, seed, window style, atlas cell
attribute vec2 aRef;    // fog reference point (xz)

uniform vec3 uFogBands;

varying vec3 vLocal;    // position inside the box, world units from its min corner
varying vec3 vNormal;   // object-space normal (box faces are axis-aligned)
varying vec3 vWNormal;  // world normal, for the face tint
varying float vDepth;
flat varying vec3 vSize;
flat varying vec3 vColor;
flat varying vec4 vInfo;
flat varying float vBand;

void main() {
  vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#ifdef TANK
  vLocal = position * size;
#else
  vLocal = vec3((position.x + 0.5) * size.x, position.y * size.y, (position.z + 0.5) * size.z);
#endif
  vSize = size;
  vNormal = normal;
  mat3 R = mat3(instanceMatrix[0].xyz / size.x, instanceMatrix[1].xyz / size.y, instanceMatrix[2].xyz / size.z);
  vWNormal = normalize(mat3(modelMatrix) * (R * normal));
  vColor = aColor;
  vInfo = aInfo;
  vBand = fogBand(aRef, uFogBands);
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

export const TOON_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uInk;
uniform vec3 uRoof;
uniform vec3 uLit;
uniform vec3 uWarm;
uniform vec3 uDark;
uniform vec3 uPaper;
uniform vec3 uRed;
uniform vec3 uMint;
uniform vec3 uCrane;
uniform vec3 uTank;
uniform vec3 uTankBand;
uniform vec3 uStreet;
uniform vec3 uFog;
uniform vec4 uFogAmt;
uniform float uTime;
uniform float uDpr;
uniform float uCrease;
uniform sampler2D uAtlas;
uniform vec2 uAtlasGrid;

varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vWNormal;
varying float vDepth;
flat varying vec3 vSize;
flat varying vec3 vColor;
flat varying vec4 vInfo;
flat varying float vBand;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Antialiased "inside" for a signed distance, aa = one buffer pixel in the same units.
float fillOf(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }

float faceTint(vec3 n) {
  if (n.y > 0.5) return 1.0;
  if (n.y < -0.5) return 0.7;
  vec3 a = abs(n);
  if (a.x > a.z) return n.x > 0.0 ? 0.92 : 0.76;
  return 0.84;
}

// Face coordinates: u to the right and v down from the top edge as seen from outside, in
// world units; dims is the face's size.
void faceCoords(out vec2 uv, out vec2 dims, out float faceId) {
  vec3 L = vLocal;
  vec3 S = vSize;
  if (vNormal.y > 0.5) { uv = L.xz; dims = S.xz; faceId = 4.0; }
  else if (vNormal.y < -0.5) { uv = L.xz; dims = S.xz; faceId = 5.0; }
  else if (vNormal.z > 0.5) { uv = vec2(L.x, S.y - L.y); dims = S.xy; faceId = 0.0; }
  else if (vNormal.z < -0.5) { uv = vec2(S.x - L.x, S.y - L.y); dims = S.xy; faceId = 2.0; }
  else if (vNormal.x > 0.5) { uv = vec2(S.z - L.z, S.y - L.y); dims = S.zy; faceId = 1.0; }
  else { uv = vec2(L.z, S.y - L.y); dims = S.zy; faceId = 3.0; }
}

// Window cell metrics from windowGrid: (width, height, gap x, gap y), bottom margin.
vec4 windowMetrics(float style, out float bottom) {
  bottom = 46.0;
  if (style < 0.5) return vec4(20.0, 26.0, 18.0, 21.0);
  if (style < 1.5) return vec4(13.0, 38.0, 15.0, 21.0);
  if (style < 2.5) { bottom = 58.0; return vec4(20.0, 30.0, 18.0, 24.0); }
  return vec4(34.0, 20.0, 16.0, 21.0);
}

// Outlined windows on a facade, the 2D grid exactly. Writes the lit mask for the fog.
vec3 windows(vec3 base, vec2 uv, vec2 dims, float seed, float style, float scale, float aa, float px, inout float lit) {
  float bottom;
  vec4 m = windowMetrics(style, bottom) * scale;
  bottom *= scale;
  float mx = 17.0 * scale;
  float top = 24.0 * scale;
  float cols = floor((dims.x - 2.0 * mx + m.z) / (m.x + m.z));
  float rows = floor((dims.y - top - bottom + m.w) / (m.y + m.w));
  if (cols < 1.0 || rows < 1.0) return base;
  float ox = (dims.x - (cols * m.x + (cols - 1.0) * m.z)) * 0.5;
  vec2 pitch = m.xy + m.zw;
  vec2 q = vec2(uv.x - ox, uv.y - top);
  vec2 cell = floor(q / pitch);
  if (cell.x < 0.0 || cell.x >= cols || cell.y < 0.0 || cell.y >= rows) return base;
  vec2 local = q - cell * pitch;
  vec2 halfSize = m.xy * 0.5;
  float d = sdRoundBox(local - halfSize, halfSize, min(4.0 * scale, m.x * 0.25));
  float k = seed + cell.y * 131.0 + cell.x * 17.0;
  bool on = hash01(k) < 0.24 + hash01(seed) * 0.16;
  bool warm = hash01(k + 7.0) < 0.4;
  if (hash01(k + 29.0) < 0.045) {
    float period = 4.0 + hash01(k + 3.0) * 6.0;
    if (sin((uTime + hash01(k + 11.0) * 20.0) * 6.2831853 / period) > 0.2) on = !on;
  }
  vec3 fill = on ? (warm ? uWarm : uLit) : uDark;
  // How much detail the window gets: outlines fade out once a window is a few pixels wide,
  // and the far bands keep only flat lit windows, like the 2D far layers.
  float detail = smoothstep(2.5, 6.0, m.x / px) * (vBand < 1.5 ? 1.0 : 0.0);
  if (!on && vBand > 1.5) return base;
  float lw = max(1.5 * scale, 1.0 * px);
  float outer = fillOf(d - lw * 0.5, aa);
  float inner = fillOf(d + lw * 0.5, aa);
  vec3 c = mix(base, mix(fill, uInk, detail), outer);
  c = mix(c, fill, inner);
  if (on && m.y > 14.0) {
    // A sash bar, so lit windows read as windows and not as gold bricks.
    float bar = 1.0 - smoothstep(lw * 0.4 - aa, lw * 0.4 + aa, abs(local.y - m.y * 0.45));
    bar *= step(2.0, local.x) * step(local.x, m.x - 2.0);
    c = mix(c, uInk, bar * inner * detail);
  }
  if (on) lit = max(lit, outer);
  return c;
}

// The white shine stroke near a face's top-left corner (render/draw.ts shine).
float shine(vec2 uv, float len, float w, float aa) {
  vec2 c = vec2(9.0 + len, 16.0 + len * 0.7);
  vec2 r = vec2(len, len * 0.7);
  vec2 p = uv - c;
  if (p.x > 0.0 || p.y > 0.0) return 0.0;
  float d = (length(p / r) - 1.0) * min(r.x, r.y);
  return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(d));
}

void main() {
  float kind = vInfo.x;
  float seed = vInfo.y;
  vec2 uv;
  vec2 dims;
  float faceId;
  faceCoords(uv, dims, faceId);
  vec2 fw = max(fwidth(uv), vec2(1e-4));
  float px = max(fw.x, fw.y);           // world units per buffer pixel
  float aa = px;
  float creasePx = uCrease * uDpr;
  float lit = 0.0;
  float tint = faceTint(vWNormal);
  vec3 col = vColor * tint;
  bool creases = true;

#ifdef TANK
  // A water-tower tank: body with two bands, a conical roof; ink rims, no vertical creases.
  creases = false;
  float body = vSize.y * 0.78;
  float tv = (body - vLocal.y) / body;
  vec3 L = normalize(vec3(1.0, 0.25, 0.55));
  float cel = dot(vWNormal, L) > -0.05 ? 1.0 : 0.84;
  float fy = max(fwidth(vLocal.y), 1e-4);
  if (vLocal.y > body) {
    col = uTankBand * cel;
  } else {
    col = uTank * cel;
    float bandH = 7.0 / 78.0;
    float inBand = (step(0.28, tv) - step(0.28 + bandH, tv)) + (step(0.68, tv) - step(0.68 + bandH, tv));
    col = mix(col, uTankBand * cel, inBand);
    float e1 = min(abs(tv - 0.28), abs(tv - 0.28 - bandH));
    float e2 = min(abs(tv - 0.68), abs(tv - 0.68 - bandH));
    float lines = min(e1, e2) * body / fy;
    col = mix(col, uInk, (1.0 - smoothstep(creasePx * 0.6, creasePx * 0.6 + 1.0, lines)) * step(fy, 6.0));
  }
  float rim = min(abs(vLocal.y - body), vLocal.y) / fy;
  col = mix(col, uInk, 1.0 - smoothstep(creasePx - 0.5, creasePx + 0.5, rim));
#else
  bool topFace = faceId == 4.0;
  if (kind < 1.5) {
    // Buildings (0) and setback tops (1).
    float scale = kind < 0.5 ? 1.0 : 0.85;
    float lw = max(1.5, px);
    if (topFace) {
      float rim = min(min(uv.x, dims.x - uv.x), min(uv.y, dims.y - uv.y));
      float rimW = 9.0;
      // The deck is the building's fill at the top tint (1.0); the parapet ring is the dark rooftop.
      col = mix(vColor, uRoof, 1.0 - smoothstep(rimW - aa, rimW + aa, rim));
      col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, abs(rim - rimW)));
    } else {
      float style = kind < 0.5 ? vInfo.z : 0.0;
      col = windows(col, uv, dims, seed + faceId * 7919.0, style, scale, aa, px, lit);
      if (kind < 0.5 && (faceId == 0.0 || faceId == 2.0)) {
        // A door, sometimes under a striped awning.
        float dx = dims.x * (0.25 + hash01(seed + 11.0 + faceId) * 0.4);
        float dd = sdRoundBox(uv - vec2(dx + 11.0, dims.y - 20.0), vec2(11.0, 20.0), 6.0);
        col = mix(col, uDark, fillOf(dd, aa));
        col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, abs(dd)));
        if (hash01(seed + 5.0 + faceId) < 0.35 && dims.x > 80.0) {
          float aw = min(dims.x - 20.0, 110.0);
          float ax = 10.0 + hash01(seed + 8.0) * (dims.x - 20.0 - aw);
          vec2 a = vec2(uv.x - ax, uv.y - (dims.y - 66.0));
          float n = max(3.0, floor(aw / 18.0 + 0.5));
          float sw = aw / n;
          float s = floor(a.x / sw);
          float f = a.x / sw - s;
          float g = 2.0 * f - 1.0;
          float bottomEdge = 14.0 + 4.0 * (1.0 - g * g);
          if (a.x >= -lw && a.x <= aw + lw && a.y >= -lw && a.y <= bottomEdge + lw) {
            bool inside = a.x >= 0.0 && a.x <= aw && a.y >= 0.0 && a.y <= bottomEdge;
            vec3 stripe = mod(s, 2.0) < 0.5 ? uRed : uPaper;
            col = inside ? stripe * tint : uInk;
            float edge = min(min(a.x, aw - a.x), min(a.y, bottomEdge - a.y));
            if (inside && edge < lw) col = uInk;
          }
        }
      }
      // The parapet cap: a dark band along the top of every face.
      float capH = 10.0;
      if (uv.y < capH) col = uRoof * tint;
      col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, abs(uv.y - capH)));
      // Shine on the two lit faces.
      if (faceId == 0.0 || faceId == 1.0) {
        float len = min(kind < 0.5 ? 34.0 : 26.0, dims.x * 0.22);
        col = mix(col, vec3(1.0), shine(uv, len, max(2.6, px * 1.2), aa));
      }
    }
  } else if (kind < 2.5) {
    // Solid props: flat fill and creases.
  } else if (kind < 3.5) {
    // AC unit: a fan and a grille on the front.
    if (faceId == 0.0) {
      vec2 c = vec2(dims.x * 0.32, dims.y * 0.5);
      float r = dims.y * 0.3;
      float d = length(uv - c) - r;
      col = mix(col, mix(vColor, uInk, 0.12) * tint, fillOf(d, aa));
      float lw = max(1.5, px);
      col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, abs(d)));
      float bar = abs(uv.y - c.y) - lw * 0.5;
      col = mix(col, uInk, fillOf(bar, aa) * step(abs(uv.x - c.x), r * 0.75));
      float gx = uv.x / dims.x;
      float gy = mod(uv.y - dims.y * 0.25, dims.y * 0.22);
      col = mix(col, uInk, fillOf(abs(gy - lw) - lw * 0.5, aa) * step(0.66, gx) * step(gx, 0.88) * step(dims.y * 0.2, uv.y) * step(uv.y, dims.y * 0.75));
    }
  } else if (kind < 4.5) {
    // Antenna light: blinks red.
    bool on = sin(uTime * 3.0 + seed * 0.01) > -0.2;
    col = on ? uRed : mix(uRed, uInk, 0.55);
    lit = on ? 1.0 : 0.0;
  } else if (kind < 5.5) {
    // Billboard: the text atlas on the front, paper sides, a dark back.
    if (faceId == 0.0) {
      float cell = vInfo.w;
      float cx = mod(cell, uAtlasGrid.x);
      float cy = floor(cell / uAtlasGrid.x);
      vec2 t = vec2(uv.x / dims.x, uv.y / dims.y);
      vec2 tex = vec2((cx + t.x) / uAtlasGrid.x, 1.0 - (cy + t.y) / uAtlasGrid.y);
      col = texture2D(uAtlas, tex).rgb;
      lit = 0.6;
    } else if (faceId == 2.0) {
      col = uRoof * tint;
    }
  } else if (kind < 6.5) {
    // Crane mast: two rails and a zigzag, open in between.
    if (!topFace && faceId != 5.0) {
      float W = dims.x;
      float rail = min(uv.x, W - uv.x);
      float k = floor(uv.y / W);
      float lv = uv.y - k * W;
      float zz = (mod(k, 2.0) < 0.5 ? abs(uv.x - lv) : abs(uv.x - (W - lv))) * 0.7071;
      float bar = max(3.5, px * 1.5);
      float m = min(rail, zz);
      if (m > bar) discard;
      float ink = max(1.2, px);
      col = m > bar - ink || rail < ink ? uInk : uCrane * tint;
      creases = false;
    }
  } else if (kind < 7.5) {
    // Bridge deck: a road on top, a red truss on the sides.
    float lw = max(1.5, px);
    if (topFace) {
      bool alongX = dims.x >= dims.y;
      float across = alongX ? uv.y : uv.x;
      float along = alongX ? uv.x : uv.y;
      float width = alongX ? dims.y : dims.x;
      float rim = min(across, width - across);
      col = rim < 10.0 ? mix(uRed, uInk, 0.2) : uStreet;
      col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, abs(rim - 10.0)));
      float dash = step(mod(along, 84.0), 46.0) * (1.0 - smoothstep(3.5 - aa, 3.5 + aa, abs(across - width * 0.5)));
      col = mix(col, uLit, dash);
    } else if (faceId != 5.0) {
      float slab = 14.0;
      if (uv.y < slab) {
        col = mix(uRed, uInk, 0.25) * tint;
      } else {
        float h = dims.y - slab;
        float k = floor(uv.x / h);
        float lu = uv.x - k * h;
        float lv = uv.y - slab;
        float zz = (mod(k, 2.0) < 0.5 ? abs(lu - lv) : abs(lu - (h - lv))) * 0.7071;
        col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, zz));
      }
      col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, abs(uv.y - slab)));
    }
  }
#endif

  if (creases) {
    vec2 e = min(uv, dims - uv) / fw;
    float edgePx = min(e.x, e.y);
    float ink = 1.0 - smoothstep(creasePx - 0.5, creasePx + 0.5, edgePx);
    col = mix(col, uInk, ink);
  }

  float f = fogAmount(vBand, uFogAmt) * (1.0 - 0.55 * lit);
  col = mix(col, uFog, f);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const HULL_VERTEX = /* glsl */ `
${COMMON}
attribute vec3 aHullDir;
attribute float aHull;
attribute vec2 aRef;

uniform float uPxScale;   // world units per CSS px at view depth 1
uniform vec4 uHullPx;     // near px, far px, near depth, far depth
uniform vec3 uFogBands;

flat varying float vBand;

void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  mat3 R = mat3(instanceMatrix[0].xyz / size.x, instanceMatrix[1].xyz / size.y, instanceMatrix[2].xyz / size.z);
  vec3 dir = mat3(modelMatrix) * (R * aHullDir);
  float depth = max(1.0, -(viewMatrix * world).z);
  float px = mix(uHullPx.x, uHullPx.y, smoothstep(uHullPx.z, uHullPx.w, depth)) * aHull;
  world.xyz += dir * px * depth * uPxScale;
  vBand = fogBand(aRef, uFogBands);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const HULL_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uInk;
uniform vec3 uFog;
uniform vec4 uFogAmt;
flat varying float vBand;

void main() {
  gl_FragColor = vec4(mix(uInk, uFog, fogAmount(vBand, uFogAmt) * 0.5), 1.0);
}
`;

export const GROUND_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying float vDepth;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

export const GROUND_FRAGMENT = /* glsl */ `
${COMMON}
#define MAX_STREETS 16
uniform float uStreetX[MAX_STREETS];
uniform float uStreetXW[MAX_STREETS];
uniform int uStreetXN;
uniform float uStreetZ[MAX_STREETS];
uniform float uStreetZW[MAX_STREETS];
uniform int uStreetZN;
uniform vec4 uBounds;     // x0, z0, x1, z1
uniform vec4 uRiver;      // x0, z0, x1, z1 (empty when x1 < x0)
uniform vec3 uStreet;
uniform vec3 uCurb;
uniform vec3 uLine;
uniform vec3 uWater;
uniform vec3 uFoam;
uniform vec3 uInk;
uniform vec3 uFog;
uniform vec4 uFogAmt;
uniform vec3 uFogBands;
uniform float uTime;
uniform float uDpr;

varying vec3 vWorld;
varying float vDepth;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vWorld.xz;
  float px = max(max(fwidth(p.x), fwidth(p.y)), 1e-4);
  float aa = px;
  float lw = max(1.5, px * uDpr);
  vec3 col = uStreet;
  bool inCity = p.x > uBounds.x && p.x < uBounds.z && p.y > uBounds.y && p.y < uBounds.w;
  if (inCity) {
    float dx = 1e9; float wx = 0.0;
    for (int i = 0; i < MAX_STREETS; i++) {
      if (i >= uStreetXN) break;
      float d = abs(p.x - uStreetX[i]);
      if (d < dx) { dx = d; wx = uStreetXW[i]; }
    }
    float dz = 1e9; float wz = 0.0;
    for (int i = 0; i < MAX_STREETS; i++) {
      if (i >= uStreetZN) break;
      float d = abs(p.y - uStreetZ[i]);
      if (d < dz) { dz = d; wz = uStreetZW[i]; }
    }
    float ex = dx - wx * 0.5;   // > 0 outside the street running along z
    float ez = dz - wz * 0.5;
    if (ex > 0.0 && ez > 0.0) {
      // A block: sidewalk, with an inked curb.
      col = uCurb;
      float curb = min(ex, ez);
      col = mix(col, uInk, 1.0 - smoothstep(lw * 0.5 - aa, lw * 0.5 + aa, curb - lw * 0.5));
    } else {
      // A street, with a dashed centre line outside the crossings.
      bool alongZ = ex <= 0.0 && ez > 0.0;
      bool alongX = ez <= 0.0 && ex > 0.0;
      if (alongZ || alongX) {
        float c = alongZ ? dx : dz;
        float along = alongZ ? p.y : p.x;
        float cell = mod(along + 23.0, 84.0) - 42.0;
        float dash = sdRoundBox(vec2(cell + 19.0, c), vec2(23.0, 3.5), 3.5);
        float inside = 1.0 - smoothstep(-aa, aa, dash);
        float ring = 1.0 - smoothstep(-aa, aa, dash - max(1.0, px * uDpr * 0.8));
        float near = smoothstep(4.0, 1.5, px);   // dashes fade once they are sub-pixel
        col = mix(col, uInk, ring * near);
        col = mix(col, uLine, inside * near);
      }
    }
  }
  if (uRiver.z > uRiver.x && p.x > uRiver.x && p.x < uRiver.z && p.y > uRiver.y && p.y < uRiver.w) {
    col = uWater;
    bool alongZ = (uRiver.w - uRiver.y) >= (uRiver.z - uRiver.x);
    float s = alongZ ? p.y : p.x;
    float t = alongZ ? p.x - uRiver.x : p.y - uRiver.y;
    float width = alongZ ? uRiver.z - uRiver.x : uRiver.w - uRiver.y;
    // Rows of wavy foam dashes drifting with the flow (render/city.ts drawStreet).
    float row = floor(t / 64.0);
    float rc = row * 64.0 + 32.0;
    float speed = 14.0 + mod(row, 3.0) * 6.0;
    float ss = s + uTime * speed + row * 37.0;
    float seg = mod(ss, 110.0);
    float wave = rc + sin(ss * 6.2831853 / 48.0) * 5.0;
    float stroke = 1.0 - smoothstep(lw * 0.6 - aa, lw * 0.6 + aa, abs(t - wave));
    stroke *= step(seg, 64.0) * step(30.0, t) * step(t, width - 30.0) * smoothstep(6.0, 2.5, px);
    col = mix(col, uFoam, stroke);
    float bank = min(t, width - t);
    col = mix(col, uInk, 1.0 - smoothstep(lw - aa, lw + aa, bank));
  }
  // The ground's bands are measured per pixel (it has no single centre).
  col = mix(col, uFog, fogAmount(fogBand(p, uFogBands), uFogAmt));
  gl_FragColor = vec4(col, 1.0);
}
`;
