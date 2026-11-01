/**
 * Geometry for the cast art. It runs once at module load and turns pattern lines (mask
 * webs, grin teeth, chain links, pixel hair) into plain path strings fitted to a shape,
 * so every avatar is a static SVG with no clipPath, mask or id.
 *
 * Paths passed in here use absolute M, L, C, Q and Z commands only.
 */

export type Pt = readonly [number, number];
export type Poly = Pt[];

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const fmt = (n: number) => `${Math.round(n * 100) / 100}`;

export function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function quadAt(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/** Points along a path, about `step` apart. Each subpath becomes its own ring. */
export function trace(d: string, step = 0.5): Poly[] {
  const tokens = d.match(/[MLCQZ]|-?(?:\d+\.?\d*|\.\d+)/gi) ?? [];
  const rings: Poly[] = [];
  let ring: Poly = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let cmd = "";
  let i = 0;
  const pt = (): Pt => [Number(tokens[i++]), Number(tokens[i++])];
  const segment = (at: (t: number) => Pt, length: number) => {
    const count = Math.max(1, Math.ceil(length / step));
    for (let k = 1; k <= count; k++) ring.push(at(k / count));
  };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === "M") {
      if (ring.length) rings.push(ring);
      cur = start = pt();
      ring = [cur];
      cmd = "L";
    } else if (cmd === "L") {
      const a = cur;
      const p = pt();
      segment((t) => lerp(a, p, t), dist(a, p));
      cur = p;
    } else if (cmd === "C") {
      const a = cur;
      const c1 = pt();
      const c2 = pt();
      const p = pt();
      segment((t) => cubicAt(a, c1, c2, p, t), dist(a, c1) + dist(c1, c2) + dist(c2, p));
      cur = p;
    } else if (cmd === "Q") {
      const a = cur;
      const c = pt();
      const p = pt();
      segment((t) => quadAt(a, c, p, t), dist(a, c) + dist(c, p));
      cur = p;
    } else if (cmd === "Z") {
      const a = cur;
      const s = start;
      if (dist(a, s) > 0.01) segment((t) => lerp(a, s, t), dist(a, s));
      cur = start;
      cmd = "";
    } else {
      i++;
    }
  }
  if (ring.length) rings.push(ring);
  return rings;
}

/** Even-odd point-in-shape test. */
export function inside([x, y]: Pt, shape: Poly[]): boolean {
  let hit = false;
  for (const ring of shape) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

function densify(line: Poly, step: number): Poly {
  const out: Pt[] = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const count = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let j = 1; j <= count; j++) out.push(lerp(a, b, j / count));
  }
  return out;
}

/** Drops points that sit within `tolerance` of a straight run (Ramer–Douglas–Peucker). */
function simplify(line: Poly, tolerance: number): Poly {
  if (line.length < 3) return line;
  const [a, b] = [line[0], line[line.length - 1]];
  const len = dist(a, b) || 1;
  let worst = 0;
  let at = 0;
  for (let k = 1; k < line.length - 1; k++) {
    const p = line[k];
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > worst) {
      worst = d;
      at = k;
    }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(line.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(line.slice(at), tolerance)];
}

/** Bisects between a point outside `shape` and one inside it to find the boundary. */
function boundary(outside: Pt, within: Pt, shape: Poly[]): Pt {
  let a = outside;
  let b = within;
  for (let k = 0; k < 14; k++) {
    const m = lerp(a, b, 0.5);
    if (inside(m, shape)) b = m;
    else a = m;
  }
  return b;
}

/** Keeps the parts of each line that fall inside `shape`. */
export function clipLines(lines: Poly[], shapeD: string): Poly[] {
  const shape = trace(shapeD);
  const out: Poly[] = [];
  for (const line of lines) {
    let run: Pt[] = [];
    let prev: Pt | null = null;
    let prevIn = false;
    for (const p of densify(line, 0.4)) {
      const isIn = inside(p, shape);
      if (prev && isIn && !prevIn) run = [boundary(prev, p, shape)];
      if (isIn) run.push(p);
      if (prev && !isIn && prevIn) {
        run.push(boundary(p, prev, shape));
        out.push(run);
        run = [];
      }
      prev = p;
      prevIn = isIn;
    }
    if (run.length > 1) out.push(run);
  }
  return out.filter((r) => r.length > 1).map((r) => simplify(r, 0.08));
}

/** Open polylines as one path string. */
export function toPath(lines: Poly[], close = false): string {
  return lines
    .filter((l) => l.length > 1)
    .map((l) => `M${l.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join("L")}${close ? "Z" : ""}`)
    .join("");
}

/**
 * A spider web around `center`: straight spokes at the given angles (degrees, 0 = right,
 * 90 = down) and rings whose segments sag toward the center between spokes.
 */
export function web({
  center,
  spokes,
  rings,
  aspect = 1,
  sag = 0.14,
  closed = true,
}: {
  center: Pt;
  spokes: number[];
  rings: number[];
  aspect?: number;
  sag?: number;
  closed?: boolean;
}): Poly[] {
  const [cx, cy] = center;
  const at = (deg: number, r: number): Pt => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * aspect];
  };
  const lines: Poly[] = spokes.map((a) => [at(a, 0), at(a, 400)]);
  for (const r of rings) {
    const count = closed ? spokes.length : spokes.length - 1;
    for (let k = 0; k < count; k++) {
      const a0 = spokes[k];
      const a1 = k + 1 < spokes.length ? spokes[k + 1] : spokes[0] + 360;
      const s = at(a0, r);
      const e = at(a1, r);
      const q = at((a0 + a1) / 2, r * (1 - sag));
      lines.push(Array.from({ length: 17 }, (_, j) => quadAt(s, q, e, j / 16)));
    }
  }
  return lines;
}

/** A web clipped to a shape, as one path string. */
export function webIn(shapeD: string, options: Parameters<typeof web>[0]): string {
  return toPath(clipLines(web(options), shapeD));
}

/** Straight lines clipped to a shape, as one path string. */
export function linesIn(shapeD: string, lines: Poly[]): string {
  return toPath(clipLines(lines, shapeD));
}

function signedArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function intersectLines(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  const d = (p[0] - q[0]) * (a[1] - b[1]) - (p[1] - q[1]) * (a[0] - b[0]);
  if (Math.abs(d) < 1e-9) return q;
  const t = ((p[0] - a[0]) * (a[1] - b[1]) - (p[1] - a[1]) * (a[0] - b[0])) / d;
  return lerp(p, q, t);
}

/**
 * The part of `subjectD` inside `convexD` (Sutherland–Hodgman). The clipper must be
 * convex; the subject may be any simple shape. Used for teeth and tongues in mouths.
 */
export function intersect(subjectD: string, convexD: string): string {
  const clipper = trace(convexD, 1)[0];
  const sign = signedArea(clipper) > 0 ? 1 : -1;
  let out: Poly = trace(subjectD, 0.5)[0];
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    if (dist(a, b) < 1e-6) continue;
    const isIn = (p: Pt) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pIn = isIn(p);
      if (pIn) out.push(p);
      if (pIn !== isIn(q)) out.push(intersectLines(p, q, a, b));
    }
  }
  return out.length > 2 ? toPath([out], true) : "";
}

/** An ellipse as a path, for use as a convex clipper. */
export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx + rx} ${cy}C${cx + rx} ${cy + ry * 0.5523} ${cx + rx * 0.5523} ${cy + ry} ${cx} ${cy + ry}C${cx - rx * 0.5523} ${cy + ry} ${cx - rx} ${cy + ry * 0.5523} ${cx - rx} ${cy}C${cx - rx} ${cy - ry * 0.5523} ${cx - rx * 0.5523} ${cy - ry} ${cx} ${cy - ry}C${cx + rx * 0.5523} ${cy - ry} ${cx + rx} ${cy - ry * 0.5523} ${cx + rx} ${cy}Z`;
}

/** A rectangle as a path, for use as a convex clipper. */
export function rect(x: number, y: number, w: number, h: number): string {
  return `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
}

/**
 * Pointed teeth along a cubic lip. `side` 1 points them to the right of the direction of
 * travel (down, for a lip drawn left to right). Teeth shrink toward the mouth corners.
 */
export function fangs(lip: [Pt, Pt, Pt, Pt], count: number, depth: number, side: 1 | -1 = 1): string {
  const pts = Array.from({ length: count + 1 }, (_, k) => cubicAt(...lip, k / count));
  let d = "";
  for (let k = 0; k < count; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const len = dist(a, b) || 1;
    const nx = (-(b[1] - a[1]) / len) * side;
    const ny = ((b[0] - a[0]) / len) * side;
    const size = depth * (0.5 + 0.5 * Math.sin((Math.PI * (k + 0.5)) / count));
    const mid = lerp(a, b, 0.5);
    d += `M${fmt(a[0])} ${fmt(a[1])}L${fmt(mid[0] + nx * size)} ${fmt(mid[1] + ny * size)}L${fmt(b[0])} ${fmt(b[1])}Z`;
  }
  return d;
}

/** Evenly spaced stations along a path: position and heading in degrees. */
export function along(d: string, spacing: number, offset = 0): { x: number; y: number; angle: number }[] {
  const pts = trace(d, 0.25)[0];
  const out: { x: number; y: number; angle: number }[] = [];
  let travelled = 0;
  let next = offset;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const len = dist(a, b);
    while (travelled + len >= next) {
      const p = lerp(a, b, (next - travelled) / (len || 1));
      out.push({ x: p[0], y: p[1], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI });
      next += spacing;
    }
    travelled += len;
  }
  return out;
}

/** Heading in degrees at the very end of a path. */
export function endHeading(d: string): { x: number; y: number; angle: number } {
  const pts = trace(d, 0.25)[0];
  const b = pts[pts.length - 1];
  const a = pts[pts.length - 4] ?? pts[0];
  return { x: b[0], y: b[1], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
}

/**
 * The cells of a `size` grid whose centres fall inside the shape, merged into one
 * rectangle per horizontal run: the JPEG-artifact staircase.
 */
export function pixelate(d: string, size: number): string {
  const shape = trace(d);
  const all = shape.flat();
  const minX = Math.floor(Math.min(...all.map((p) => p[0])) / size) - 1;
  const maxX = Math.ceil(Math.max(...all.map((p) => p[0])) / size) + 1;
  const minY = Math.floor(Math.min(...all.map((p) => p[1])) / size) - 1;
  const maxY = Math.ceil(Math.max(...all.map((p) => p[1])) / size) + 1;
  let out = "";
  for (let row = minY; row <= maxY; row++) {
    let runStart: number | null = null;
    for (let col = minX; col <= maxX; col++) {
      const isIn = inside([(col + 0.5) * size, (row + 0.5) * size], shape);
      if (isIn && runStart === null) runStart = col;
      if (!isIn && runStart !== null) {
        const x0 = runStart * size;
        const x1 = col * size;
        const y0 = row * size;
        out += `M${x0} ${y0}H${x1}V${y0 + size}H${x0}Z`;
        runStart = null;
      }
    }
  }
  return out;
}

/** Mirrors a path of absolute coordinate pairs across x = `axis`. */
export function mirror(d: string, axis = 60): string {
  let even = true;
  return d.replace(/-?(?:\d+\.?\d*|\.\d+)/g, (n) => {
    const out = even ? fmt(axis * 2 - Number(n)) : n;
    even = !even;
    return out;
  });
}
