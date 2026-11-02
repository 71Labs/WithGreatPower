/**
 * The night city in the characters' sticker style: flat fills from CITY, bold INK
 * outlines (thinner with depth), rounded corners, outlined windows, white shine strokes.
 * Static art (buildings and their rooftop props, clouds, the moon) is cached in
 * offscreen canvases; only flickering windows, blinking lights and moving things are
 * drawn every frame.
 */
import { CITY, INK, LINE, PAPER } from "@/game/style";

import { BILLBOARD_LEGS, cablePoint, WATER_TOWER_TOP, type Building, type Cable, type Crane, type Prop, type World } from "../core";
import { box, circle, hash01, inked, line, makeCanvas, mix, roundRect, shine, sparkle, type Ctx } from "./draw";

/* ------------------------------------------------------------------ view */

/** Where the camera is and how the world maps to the screen (CSS px). */
export interface View {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
  camX: number;
  camY: number;
  /** CSS px per world unit. */
  zoom: number;
  /** The camera's lowest y (street at the bottom edge), for parallax. */
  camYMin: number;
  /** World-unit multiplier for outlines, so they stay bold on small screens. */
  ls: number;
  time: number;
  /** Fonts resolved from the page (canvas can't read CSS variables). */
  font: string;
}

export const WATER = "#2E3A8C";
const STREET_CURB = "#2A2E62";
const CRANE = CITY.windowLit;
const STEEL = "#AEB4BD";

/** Put the canvas in world space: x right, world y up drawn at canvas −y. */
export function worldTransform(ctx: CanvasRenderingContext2D, v: View) {
  const k = v.dpr * v.zoom;
  ctx.setTransform(k, 0, 0, k, v.dpr * (v.w / 2 - v.camX * v.zoom), v.dpr * (v.h / 2 + v.camY * v.zoom));
}

export function screenTransform(ctx: CanvasRenderingContext2D, v: View) {
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
}

export function toScreen(v: View, x: number, y: number): { x: number; y: number } {
  return { x: (x - v.camX) * v.zoom + v.w / 2, y: v.h / 2 - (y - v.camY) * v.zoom };
}

/* ------------------------------------------------------------------ the sky */

interface SkyArt {
  moon: HTMLCanvasElement;
  clouds: HTMLCanvasElement[];
  stars: { x: number; y: number; r: number; big: boolean; phase: number }[];
  key: string;
}

let sky: SkyArt | null = null;

function moonArt(r: number, dpr: number): HTMLCanvasElement {
  const border = r * 0.13;
  const drop = r * 0.08;
  const size = (r + border + drop + 4) * 2;
  const c = makeCanvas(size * dpr, size * dpr);
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const cx = size / 2;
  const cy = size / 2;
  circle(ctx, cx, cy + drop, r + border, INK, 0);
  circle(ctx, cx, cy, r + border, "#FFFFFF", 0);
  circle(ctx, cx, cy, r, CITY.moon, 2.5);
  const crater = mix(CITY.moon, "#C9A64B", 0.35);
  circle(ctx, cx - r * 0.32, cy + r * 0.18, r * 0.2, crater, 1.75);
  circle(ctx, cx + r * 0.3, cy - r * 0.22, r * 0.13, crater, 1.75);
  circle(ctx, cx + r * 0.22, cy + r * 0.42, r * 0.09, crater, 1.5);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cx - r * 0.12, cy - r * 0.1, r * 0.78, Math.PI * 1.05, Math.PI * 1.45);
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
  return c;
}

function cloudArt(seed: number, w: number, dpr: number, lw: number): HTMLCanvasElement {
  const h = w * 0.42;
  const pad = lw * 2 + 4;
  const c = makeCanvas((w + pad * 2) * dpr, (h + pad * 2) * dpr);
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const n = 3 + Math.floor(hash01(seed) * 3);
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const r = h * (0.32 + 0.22 * Math.sin(Math.PI * t)) * (0.85 + hash01(seed + i * 13) * 0.3);
    puffs.push([pad + r + t * (w - 2 * r), pad + h - r * 0.95, r]);
  }
  const base = pad + h - h * 0.08;
  // Outline the union: stroke every puff wide in ink, then fill them all.
  const shape = () => {
    ctx.beginPath();
    for (const [x, y, r] of puffs) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.rect(pad + h * 0.2, base - h * 0.3, w - h * 0.4, h * 0.3);
  };
  shape();
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke();
  shape();
  ctx.fillStyle = CITY.cloud;
  ctx.fill();
  // A flat bottom.
  ctx.clearRect(0, base + lw * 0.2, c.width, c.height);
  line(ctx, pad + h * 0.12, base, pad + w - h * 0.12, base, lw);
  // Shine on the biggest puff.
  const big = puffs.reduce((a, b) => (b[2] > a[2] ? b : a));
  ctx.beginPath();
  ctx.arc(big[0], big[1], big[2] * 0.7, Math.PI * 1.15, Math.PI * 1.5);
  ctx.lineWidth = lw * 0.9;
  ctx.strokeStyle = mix(CITY.cloud, "#FFFFFF", 0.35);
  ctx.lineCap = "round";
  ctx.stroke();
  return c;
}

function skyArt(v: View): SkyArt {
  const key = `${v.dpr}:${Math.round(Math.min(v.w, v.h) / 40)}`;
  if (sky && sky.key === key) return sky;
  const moonR = Math.max(34, Math.min(70, Math.min(v.w, v.h) * 0.075));
  const stars: SkyArt["stars"] = [];
  for (let i = 0; i < 46; i++) {
    stars.push({ x: hash01(i * 7 + 1), y: hash01(i * 11 + 3) * 0.62, r: 1 + hash01(i * 5) * 1.6, big: i % 6 === 0, phase: hash01(i * 3) * 6.28 });
  }
  sky = {
    key,
    moon: moonArt(moonR, v.dpr),
    clouds: [0, 1, 2, 3].map((i) => cloudArt(101 + i * 37, 150 + hash01(i + 9) * 110, v.dpr, LINE.far)),
    stars,
  };
  return sky;
}

/** Flat bands, the moon sticker, sparkle stars and outlined clouds. Screen space. */
export function drawSky(ctx: CanvasRenderingContext2D, v: View) {
  screenTransform(ctx, v);
  const art = skyArt(v);
  const streetSy = v.h / 2 + v.camY * v.zoom;
  // Bands: fixed to the horizon so climbing reveals more of the top band.
  const horizon = Math.min(v.h, streetSy + 40);
  const lift = (v.camY - v.camYMin) * v.zoom * 0.18;
  const b1 = horizon - v.h * 0.48 + lift;
  const b2 = horizon - v.h * 0.26 + lift;
  ctx.fillStyle = CITY.skyTop;
  ctx.fillRect(0, 0, v.w, v.h);
  ctx.fillStyle = CITY.skyMid;
  ctx.fillRect(0, b1, v.w, v.h);
  ctx.fillStyle = CITY.skyLow;
  ctx.fillRect(0, b2, v.w, v.h);

  // Stars twinkle slowly; the big ones are outlined sparkles.
  const drift = v.camX * 0.02;
  for (const s of art.stars) {
    const x = (((s.x * v.w * 1.4 - drift) % (v.w * 1.4)) + v.w * 1.4) % (v.w * 1.4) - v.w * 0.2;
    const y = s.y * v.h + lift * 0.5;
    if (y > b2) continue;
    const tw = 0.75 + 0.25 * Math.sin(v.time * 1.3 + s.phase);
    if (s.big) {
      sparkle(ctx, x, y, 6 * tw + 2);
      inked(ctx, CITY.star, 1.5);
    } else {
      ctx.fillStyle = CITY.star;
      ctx.fillRect(x - s.r / 2, y - s.r / 2, s.r * tw, s.r * tw);
    }
  }

  const m = art.moon;
  const mw = m.width / v.dpr;
  const mx = v.w * 0.78 - (v.camX * 0.01) % 60;
  const my = Math.max(mw * 0.6, v.h * 0.14) + lift * 0.4;
  ctx.drawImage(m, mx - mw / 2, my - mw / 2, mw, mw);

  // Clouds drift with the time and a little parallax.
  art.clouds.forEach((c, i) => {
    const cw = c.width / v.dpr;
    const ch = c.height / v.dpr;
    const span = v.w + cw * 2 + 400;
    const speed = 6 + i * 3;
    const px = 0.06 + i * 0.025;
    const x = ((((hash01(i * 17) * span - v.camX * px - v.time * speed) % span) + span) % span) - cw;
    const y = v.h * (0.12 + i * 0.1) + lift * (0.6 + i * 0.1);
    if (y + ch < b2 + 60) ctx.drawImage(c, x, y, cw, ch);
  });
}

/* ------------------------------------------------------------------ windows */

export interface WindowCell {
  x: number;
  y: number;
  w: number;
  h: number;
  lit: boolean;
  warm: boolean;
}

/** A building face's windows in its own coords (x from its left edge, y down from its top). */
export function windowGrid(seed: number, w: number, h: number, style: "plain" | "strip" | "brown" | "wide", scale = 1): WindowCell[] {
  const cells: WindowCell[] = [];
  const ww = (style === "strip" ? 13 : style === "wide" ? 34 : 20) * scale;
  const wh = (style === "strip" ? 38 : style === "wide" ? 20 : style === "brown" ? 30 : 26) * scale;
  const gx = (style === "strip" ? 15 : style === "wide" ? 16 : 18) * scale;
  const gy = (style === "brown" ? 24 : 21) * scale;
  const mx = 17 * scale;
  const top = 24 * scale;
  const bottom = (style === "brown" ? 58 : 46) * scale;
  const cols = Math.floor((w - 2 * mx + gx) / (ww + gx));
  const rows = Math.floor((h - top - bottom + gy) / (wh + gy));
  if (cols < 1 || rows < 1) return cells;
  const ox = (w - (cols * ww + (cols - 1) * gx)) / 2;
  const litRate = 0.24 + hash01(seed) * 0.16;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = seed + r * 131 + c * 17;
      cells.push({ x: ox + c * (ww + gx), y: top + r * (wh + gy), w: ww, h: wh, lit: hash01(k) < litRate, warm: hash01(k + 7) < 0.4 });
    }
  }
  return cells;
}

export function drawWindow(ctx: Ctx, c: WindowCell, x: number, y: number, lw: number, lit = c.lit) {
  box(ctx, x + c.x, y + c.y, c.w, c.h, Math.min(4, c.w * 0.25), lit ? (c.warm ? CITY.windowWarm : CITY.windowLit) : CITY.windowDark, lw);
  if (lit && c.h > 14) {
    // A sash bar, so lit windows read as windows and not as gold bricks.
    line(ctx, x + c.x + 2, y + c.y + c.h * 0.45, x + c.x + c.w - 2, y + c.y + c.h * 0.45, lw * 0.8);
  }
}

/* ------------------------------------------------------------------ props */

/** Rooftop props, in a building's local canvas coords: (px, py) is where the prop stands. */
export function drawProp(ctx: Ctx, p: Prop, px: number, py: number, lw: number, detail: number) {
  switch (p.kind) {
    case "water-tower": {
      const legH = 70;
      const tankW = 62;
      const tankH = 78;
      const top = py - legH - tankH;
      // Legs and cross-braces.
      line(ctx, px - 22, py, px - 18, py - legH - 2, lw);
      line(ctx, px + 22, py, px + 18, py - legH - 2, lw);
      line(ctx, px - 8, py, px - 7, py - legH, detail);
      line(ctx, px + 8, py, px + 7, py - legH, detail);
      line(ctx, px - 20, py - legH * 0.35, px + 20, py - legH * 0.65, detail);
      line(ctx, px + 20, py - legH * 0.35, px - 20, py - legH * 0.65, detail);
      // The tank.
      box(ctx, px - tankW / 2, top, tankW, tankH, 10, CITY.waterTower, lw, 6);
      ctx.fillStyle = CITY.waterTowerBand;
      ctx.fillRect(px - tankW / 2 + lw / 2, top + tankH * 0.28, tankW - lw, 7);
      ctx.fillRect(px - tankW / 2 + lw / 2, top + tankH * 0.68, tankW - lw, 7);
      line(ctx, px - tankW / 2, top + tankH * 0.28, px + tankW / 2, top + tankH * 0.28, detail);
      line(ctx, px - tankW / 2, top + tankH * 0.28 + 7, px + tankW / 2, top + tankH * 0.28 + 7, detail);
      line(ctx, px - tankW / 2, top + tankH * 0.68, px + tankW / 2, top + tankH * 0.68, detail);
      line(ctx, px - tankW / 2, top + tankH * 0.68 + 7, px + tankW / 2, top + tankH * 0.68 + 7, detail);
      // Conical roof.
      ctx.beginPath();
      ctx.moveTo(px - tankW / 2 - 6, top + 4);
      ctx.quadraticCurveTo(px, top - 30, px + tankW / 2 + 6, top + 4);
      ctx.closePath();
      inked(ctx, CITY.waterTowerBand, lw);
      circle(ctx, px, top - WATER_TOWER_TOP + legH + tankH + 2, 4, CITY.waterTowerBand, detail);
      shine(ctx, px - tankW / 2 + 9, top + 12, 14, lw * 0.85);
      break;
    }
    case "antenna": {
      line(ctx, px, py, px, py - p.h, lw * 0.9);
      const bars = Math.max(2, Math.floor(p.h / 55));
      for (let i = 1; i <= bars; i++) {
        const y = py - (p.h * i) / (bars + 1);
        const half = 14 - i * 2.5;
        line(ctx, px - half, y, px + half, y, detail);
      }
      box(ctx, px - 9, py - 12, 18, 12, 3, CITY.rooftop, detail);
      break;
    }
    case "ac": {
      const h = p.w * 0.62;
      box(ctx, px, py - h, p.w, h, 5, CITY.cable, lw * 0.75, 2);
      circle(ctx, px + p.w * 0.32, py - h / 2, h * 0.3, mix(CITY.cable, INK, 0.12), detail);
      line(ctx, px + p.w * 0.32 - h * 0.22, py - h / 2, px + p.w * 0.32 + h * 0.22, py - h / 2, detail);
      for (let i = 0; i < 3; i++) line(ctx, px + p.w * 0.66, py - h * 0.75 + i * h * 0.22, px + p.w * 0.88, py - h * 0.75 + i * h * 0.22, detail);
      break;
    }
    case "billboard": {
      const legs = BILLBOARD_LEGS;
      line(ctx, px + p.w * 0.25, py, px + p.w * 0.25, py - legs, lw);
      line(ctx, px + p.w * 0.75, py, px + p.w * 0.75, py - legs, lw);
      line(ctx, px + p.w * 0.25, py - legs * 0.5, px + p.w * 0.75, py - legs * 0.5, detail);
      const top = py - legs - p.h;
      box(ctx, px, top, p.w, p.h, 8, CITY.billboard, lw);
      ctx.fillStyle = CITY.neonRed;
      ctx.fillRect(px + lw / 2, top + p.h - 13, p.w - lw, 9);
      line(ctx, px, top + p.h - 13, px + p.w, top + p.h - 13, detail);
      drawBillboardText(ctx, p.text, px + p.w / 2, top + (p.h - 13) / 2 + 2, p.w - 16, p.h - 22);
      break;
    }
    case "vent":
      box(ctx, px - 6, py - 22, 12, 22, 2, STEEL, detail, 0);
      box(ctx, px - 10, py - 30, 20, 9, 4, CITY.rooftop, detail);
      break;
  }
}

let billboardFont = "700 14px sans-serif";
export function setCanvasFont(family: string) {
  billboardFont = `700 14px ${family}`;
}

function drawBillboardText(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, maxH: number) {
  const [head, tail] = text.split(" · ");
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = billboardFont;
  const fit = (t: string, size: number) => {
    ctx.font = billboardFont.replace("14px", `${size}px`);
    let s = size;
    while (s > 6 && ctx.measureText(t).width > maxW) {
      s -= 1;
      ctx.font = billboardFont.replace("14px", `${s}px`);
    }
    return s;
  };
  if (tail) {
    const s1 = fit(head, Math.min(15, maxH * 0.42));
    ctx.fillText(head, cx, cy - s1 * 0.55);
    const s2 = fit(tail, Math.min(11, maxH * 0.3));
    ctx.fillText(tail, cx, cy + s2 * 0.75);
  } else {
    fit(head, Math.min(16, maxH * 0.5));
    ctx.fillText(head, cx, cy);
  }
}

/* ------------------------------------------------------------------ buildings */

/** The vertical neon on each arena tower, by district. */
const ARENA_SIGNS: Record<Building["district"], string> = {
  "sector-7": "GAS 400% OFF*",
  "mempool-market": "MEMPOOL ARENA",
  "bridge-district": "BRIDGE CO.",
  "queens-block": "QUEENS BLOCK",
  "validator-heights": "NODES 24/7",
};

export interface BuildingArt {
  canvas: HTMLCanvasElement;
  /** World coords of the canvas's top-left corner. */
  x: number;
  y: number;
  /** Canvas px per world unit. */
  scale: number;
  flicker: { cell: WindowCell; ox: number; oy: number; phase: number; period: number }[];
  lights: { x: number; y: number }[];
  w: number;
  h: number;
}

const tone = (b: Building) => (b.accent ? CITY.accentBuildings[b.tone % CITY.accentBuildings.length] : b.style === "arena-tower" ? CITY.near[3] : CITY.near[b.tone % CITY.near.length]);

/** Draw one near building, props and all, into its own canvas. */
export function buildBuildingArt(b: Building, scale: number, ls: number): BuildingArt {
  const lw = LINE.near * ls;
  const detail = LINE.detail * ls;
  const roofTop = b.h + (b.top?.h ?? 0);
  let propTop = 0;
  for (const p of b.props) {
    const ph = p.kind === "water-tower" ? WATER_TOWER_TOP + 30 : p.kind === "antenna" ? p.h + 10 : p.kind === "billboard" ? BILLBOARD_LEGS + p.h + 10 : 40;
    propTop = Math.max(propTop, p.y + ph);
  }
  const sign = b.style === "arena-tower";
  const left = b.x0 - 50 - (sign ? 60 : 0);
  const right = b.x0 + b.w + 50 + (sign ? 60 : 0);
  const top = Math.max(roofTop + 30, propTop + 10);
  const w = right - left;
  const h = top + 10;
  const c = makeCanvas(w * scale, h * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  // Local coords: x from `left`, y down from `top` (world y = top − local y).
  const X = (x: number) => x - left;
  const Y = (y: number) => top - y;
  const fill = tone(b);
  const shade = mix(fill, INK, 0.2);

  const body = (x0: number, bw: number, y0: number, y1: number, r: number) => {
    // y0 = top (world), y1 = bottom (world).
    ctx.beginPath();
    roundRect(ctx, X(x0), Y(y0), bw, y0 - y1, r, 0);
    ctx.fillStyle = fill;
    ctx.fill();
    // A flat cel-shade band down the right side.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = shade;
    ctx.fillRect(X(x0 + bw * 0.82), Y(y0), bw, y0 - y1);
    ctx.restore();
    ctx.beginPath();
    roundRect(ctx, X(x0), Y(y0), bw, y0 - y1, r, 0);
    inked(ctx, null, lw);
  };

  const r = b.style === "brownstone" ? 6 : b.style === "arena-tower" ? 16 : 12;
  body(b.x0, b.w, b.h, -4, r);
  const winStyle = b.style === "tower" || b.style === "arena-tower" ? "strip" : b.style === "brownstone" ? "brown" : hash01(b.seed + 3) < 0.25 ? "wide" : "plain";
  const cells = windowGrid(b.seed, b.w * 0.82, b.h, winStyle);
  const flicker: BuildingArt["flicker"] = [];
  cells.forEach((cell, i) => {
    drawWindow(ctx, cell, X(b.x0), Y(b.h), detail);
    if (hash01(b.seed + i * 29) < 0.045) flicker.push({ cell, ox: X(b.x0), oy: Y(b.h), phase: hash01(b.seed + i) * 20, period: 4 + hash01(b.seed + i * 3) * 6 });
  });
  // Parapet cap.
  box(ctx, X(b.x0) - 5, Y(b.h) - 4, b.w + 10, 13, 6, CITY.rooftop, lw);
  shine(ctx, X(b.x0) + 9, Y(b.h) + 16, Math.min(34, b.w * 0.22), lw * 0.9);

  if (b.style === "brownstone") {
    // Cornice line and a stoop.
    line(ctx, X(b.x0) + 4, Y(b.h) + 18, X(b.x0 + b.w) - 4, Y(b.h) + 18, detail);
    const dx = X(b.x0 + b.w * 0.42);
    box(ctx, dx, Y(44), 22, 44, 9, CITY.rooftop, detail, 0);
    for (let i = 0; i < 3; i++) box(ctx, dx - 8 - i * 5, Y(14 - i * 5), 38 + i * 10, 5, 1, mix(fill, "#FFFFFF", 0.15), detail);
  } else if (b.style !== "arena-tower") {
    // A door and, sometimes, a striped awning.
    const dx = X(b.x0 + b.w * (0.25 + hash01(b.seed + 11) * 0.4));
    box(ctx, dx, Y(40), 22, 40, 6, CITY.windowDark, detail, 0);
    if (hash01(b.seed + 5) < (b.district === "mempool-market" ? 0.8 : 0.35)) {
      const aw = Math.min(b.w - 20, 110);
      const ax = X(b.x0 + 10 + hash01(b.seed + 8) * (b.w - 20 - aw));
      const ay = Y(66);
      const stripes = Math.max(3, Math.round(aw / 18));
      for (let i = 0; i < stripes; i++) {
        ctx.beginPath();
        const x0 = ax + (aw / stripes) * i;
        ctx.moveTo(x0, ay);
        ctx.lineTo(x0 + aw / stripes, ay);
        ctx.lineTo(x0 + aw / stripes, ay + 14);
        ctx.quadraticCurveTo(x0 + aw / stripes / 2, ay + 22, x0, ay + 14);
        ctx.closePath();
        ctx.fillStyle = i % 2 ? PAPER : CITY.neonRed;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + aw, ay);
      ctx.lineTo(ax + aw, ay + 14);
      for (let i = stripes - 1; i >= 0; i--) {
        const x0 = ax + (aw / stripes) * i;
        ctx.quadraticCurveTo(x0 + aw / stripes / 2, ay + 22, x0, ay + 14);
      }
      ctx.closePath();
      inked(ctx, null, detail);
    }
  }

  if (b.top) {
    const t = b.top;
    body(t.x0, t.w, b.h + t.h, b.h, 10);
    const tc = windowGrid(b.seed + 77, t.w * 0.82, t.h + 30, "plain", 0.85);
    tc.forEach((cell) => {
      if (cell.y + cell.h < t.h - 6) drawWindow(ctx, cell, X(t.x0), Y(b.h + t.h), detail);
    });
    box(ctx, X(t.x0) - 4, Y(b.h + t.h) - 4, t.w + 8, 12, 5, CITY.rooftop, lw);
    shine(ctx, X(t.x0) + 8, Y(b.h + t.h) + 14, Math.min(26, t.w * 0.2), lw * 0.85);
  }

  if (b.style === "arena-tower") {
    // A vertical neon sign on the outer face, and flagpoles inward.
    const outer = b.ledges.length && b.ledges[0].x > b.x0 + b.w / 2 ? -1 : 1;
    const sx = outer < 0 ? X(b.x0) - 34 : X(b.x0 + b.w) + 6;
    box(ctx, sx, Y(b.h - 120), 28, 260, 8, CITY.neonRed, lw);
    ctx.save();
    ctx.translate(sx + 14, Y(b.h - 250));
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = billboardFont.replace("14px", "17px");
    ctx.fillText(ARENA_SIGNS[b.district], 0, 1);
    ctx.restore();
    for (const l of b.ledges) {
      const pole0 = l.x > b.x0 + b.w / 2 ? X(b.x0 + b.w) : X(b.x0);
      line(ctx, pole0, Y(l.y - 6), X(l.x), Y(l.y), lw);
      const dir = Math.sign(X(l.x) - pole0);
      ctx.beginPath();
      ctx.moveTo(X(l.x) - dir * 6, Y(l.y) + 2);
      ctx.lineTo(X(l.x) - dir * 6, Y(l.y) + 30);
      ctx.lineTo(X(l.x) - dir * 30, Y(l.y) + 22);
      ctx.lineTo(X(l.x) - dir * 30, Y(l.y) + 8);
      ctx.closePath();
      inked(ctx, l.y > 500 ? CITY.neonMint : CITY.windowLit, detail);
      circle(ctx, X(l.x), Y(l.y), 5, PAPER, detail);
    }
  }

  const lights: BuildingArt["lights"] = [];
  for (const p of b.props) {
    drawProp(ctx, p, X(p.x), Y(p.y), lw, detail);
    if (p.kind === "antenna") lights.push({ x: p.x, y: p.y + p.h });
  }
  // Roof hatch now and then.
  if (!b.props.some((p) => p.kind === "water-tower") && hash01(b.seed + 21) < 0.3 && b.w > 150) {
    const hx = X(b.x0 + b.w * 0.18);
    box(ctx, hx, Y(b.h) - 30, 34, 26, 5, CITY.rooftop, detail, 0);
    box(ctx, hx + 10, Y(b.h) - 22, 12, 18, 3, CITY.windowDark, detail, 0);
  }
  return { canvas: c, x: left, y: top, scale, flicker, lights, w, h };
}

/** Flickering windows and blinking antenna lights, drawn over a cached building. World transform. */
export function drawBuildingLife(ctx: CanvasRenderingContext2D, art: BuildingArt, v: View) {
  const detail = LINE.detail * v.ls;
  for (const f of art.flicker) {
    const lit = Math.sin((v.time + f.phase) * ((Math.PI * 2) / f.period)) > 0.2 ? !f.cell.lit : f.cell.lit;
    if (lit === f.cell.lit) continue;
    drawWindow(ctx, f.cell, art.x + f.ox, -art.y + f.oy, detail, lit);
  }
  for (const l of art.lights) {
    const on = Math.sin(v.time * 3 + l.x * 0.01) > -0.2;
    circle(ctx, l.x, -l.y - 4, 5.5, on ? CITY.neonRed : mix(CITY.neonRed, INK, 0.55), detail);
  }
}

/* ------------------------------------------------------------------ parallax layers */

export interface LayerBuilding {
  x: number;
  w: number;
  h: number;
  canvas: HTMLCanvasElement;
  flicker: { cell: WindowCell; phase: number; period: number }[];
  /** Canvas px per layer unit. */
  scale: number;
  pad: number;
  /** Where the building's body starts inside its canvas (layer units). */
  bodyTop: number;
}

export interface Layer {
  period: number;
  factor: number;
  /** Layer units per world unit on screen (smaller = farther). */
  size: number;
  /** How much of the camera's climb the layer follows. */
  lift: number;
  buildings: LayerBuilding[];
}

/** A repeating strip of distant buildings, each cached. */
export function buildLayer(depth: "far" | "mid", seed: number, scale: number, ls: number): Layer {
  const far = depth === "far";
  const palette = far ? CITY.far : CITY.mid;
  const lw = (far ? LINE.far : LINE.mid) * ls;
  const period = far ? 2600 : 2900;
  const buildings: LayerBuilding[] = [];
  let x = 0;
  let i = 0;
  while (x < period - 120) {
    const k = seed + i * 977;
    const w = Math.min(period - x - 40, (far ? 110 : 130) + hash01(k) * (far ? 140 : 170));
    if (w < 80) break;
    const h = (far ? 420 : 300) + hash01(k + 1) * (far ? 520 : 420);
    const pad = lw + 4;
    const roofKind = hash01(k + 2);
    const extra = roofKind < 0.25 ? 90 : 0;
    const c = makeCanvas((w + pad * 2) * scale, (h + extra + pad * 2) * scale);
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    const fill = palette[i % palette.length];
    const top = pad + extra;
    box(ctx, pad, top, w, h, 10, fill, lw, 0);
    if (roofKind < 0.25) {
      // A spire or antenna.
      const sw = w * 0.3;
      box(ctx, pad + (w - sw) / 2, top - extra * 0.55, sw, extra * 0.55 + 4, 6, fill, lw, 0);
      line(ctx, pad + w / 2, top - extra * 0.55, pad + w / 2, top - extra + 4, lw);
    } else if (roofKind < 0.5) {
      box(ctx, pad + w * 0.15, top - 26, w * 0.7, 30, 8, fill, lw, 0);
    }
    const flicker: LayerBuilding["flicker"] = [];
    const cells = windowGrid(k, w, h, far ? "strip" : "plain", far ? 0.8 : 0.9);
    cells.forEach((cell, j) => {
      // Far windows: no outline, just flat light.
      if (far) {
        if (cell.lit) {
          ctx.fillStyle = cell.warm ? CITY.windowWarm : CITY.windowLit;
          ctx.fillRect(pad + cell.x, top + cell.y, cell.w, cell.h);
        }
      } else {
        drawWindow(ctx, cell, pad, top, LINE.detail * ls * 0.8);
      }
      if (!far && hash01(k + j * 5) < 0.03) flicker.push({ cell, phase: hash01(k + j) * 20, period: 5 + hash01(k + j * 3) * 7 });
    });
    buildings.push({ x, w, h: h + extra, canvas: c, flicker, scale, pad, bodyTop: top });
    x += w + (hash01(k + 4) < 0.3 ? 0 : 20 + hash01(k + 5) * 60);
    i += 1;
  }
  return { period, factor: far ? 0.22 : 0.45, size: far ? 0.62 : 0.8, lift: far ? 0.3 : 0.55, buildings };
}

export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, v: View) {
  screenTransform(ctx, v);
  const z = v.zoom * layer.size;
  const ground = v.h / 2 + v.camYMin * v.zoom + (v.camY - v.camYMin) * v.zoom * layer.lift - (layer.size < 0.7 ? 30 : 10) * v.zoom;
  const offset = v.camX * layer.factor;
  const periodPx = layer.period * z;
  const start = -(((offset * z) % periodPx) + periodPx) % periodPx;
  // Same width the cache used, in layer units.
  const detail = LINE.detail * v.ls * 0.8;
  for (let base = start - periodPx; base < v.w + periodPx; base += periodPx) {
    for (const b of layer.buildings) {
      const k = z / b.scale;
      const cw = b.canvas.width * k;
      const ch = b.canvas.height * k;
      const x = base + (b.x - b.pad) * z;
      if (x > v.w || x + cw < 0) continue;
      const y = ground - ch + b.pad * z;
      ctx.drawImage(b.canvas, x, y, cw, ch);
      for (const f of b.flicker) {
        if (Math.sin((v.time + f.phase) * ((Math.PI * 2) / f.period)) < 0.3) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(z, z);
        drawWindow(ctx, f.cell, b.pad, b.bodyTop, detail, !f.cell.lit);
        ctx.restore();
      }
    }
  }
}

/* ------------------------------------------------------------------ cranes, cables, bridges */

export function drawCrane(ctx: CanvasRenderingContext2D, c: Crane, v: View) {
  const lw = LINE.near * v.ls;
  const d = LINE.detail * v.ls;
  const x = c.x;
  const top = -c.h;
  // Mast: two rails and a zigzag.
  const mw = 26;
  line(ctx, x - mw / 2, 0, x - mw / 2, top, lw);
  line(ctx, x + mw / 2, 0, x + mw / 2, top, lw);
  ctx.beginPath();
  for (let y = 0, i = 0; y > top; y -= mw, i++) {
    ctx.moveTo(x + (i % 2 ? mw / 2 : -mw / 2), y);
    ctx.lineTo(x + (i % 2 ? -mw / 2 : mw / 2), y - mw);
  }
  ctx.strokeStyle = CRANE;
  ctx.lineWidth = d * 2.2;
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = d;
  ctx.stroke();
  // Jib and counter-jib.
  const jx = x + c.dir * c.jib;
  const cx = x - c.dir * c.jib * 0.35;
  box(ctx, Math.min(x, jx), top - 4, Math.abs(jx - x), 16, 4, CRANE, lw);
  box(ctx, Math.min(x, cx), top - 4, Math.abs(cx - x), 16, 4, CRANE, lw);
  box(ctx, cx - c.dir * 10 - 18, top + 10, 36, 26, 4, CITY.rooftop, lw);
  // Cab and apex.
  box(ctx, x - 18, top + 10, 36, 30, 6, CRANE, lw);
  box(ctx, x - 11, top + 16, 22, 14, 3, CITY.windowLit, d);
  ctx.beginPath();
  ctx.moveTo(x - 12, top - 4);
  ctx.lineTo(x, top - 46);
  ctx.lineTo(x + 12, top - 4);
  inked(ctx, CRANE, lw);
  line(ctx, x, top - 46, jx, top - 4, d);
  line(ctx, x, top - 46, cx, top - 4, d);
  // Hook.
  const hookY = top + 160 + Math.sin(v.time * 0.8 + x) * 6;
  line(ctx, x + c.dir * c.jib * 0.7, top + 12, x + c.dir * c.jib * 0.7, hookY, d);
  ctx.beginPath();
  ctx.arc(x + c.dir * c.jib * 0.7 + 4, hookY + 4, 7, Math.PI, Math.PI * 2.6);
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function cablePath(ctx: CanvasRenderingContext2D, c: Cable) {
  ctx.beginPath();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const p = cablePoint(c, i / n);
    if (i === 0) ctx.moveTo(p.x, -p.y);
    else ctx.lineTo(p.x, -p.y);
  }
}

export function drawCable(ctx: CanvasRenderingContext2D, c: Cable, v: View) {
  const lw = LINE.near * v.ls;
  const d = LINE.detail * v.ls;
  if (c.kind === "wire") {
    // Little poles on each roof, and a wire between.
    line(ctx, c.a.x, -c.a.y + 70, c.a.x, -c.a.y, d * 1.4);
    line(ctx, c.b.x, -c.b.y + 70, c.b.x, -c.b.y, d * 1.4);
    cablePath(ctx, c);
    ctx.strokeStyle = INK;
    ctx.lineWidth = d * 1.2;
    ctx.stroke();
    return;
  }
  cablePath(ctx, c);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 2.2;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.strokeStyle = c.kind === "bridge" ? CITY.cable : PAPER;
  ctx.lineWidth = lw * 0.9;
  ctx.stroke();
  if (c.kind === "arena") {
    // Bunting.
    const n = 14;
    for (let i = 1; i < n; i++) {
      const p = cablePoint(c, i / n);
      const q = cablePoint(c, (i + 0.6) / n);
      ctx.beginPath();
      ctx.moveTo(p.x, -p.y);
      ctx.lineTo(q.x, -q.y);
      ctx.lineTo((p.x + q.x) / 2, -(p.y + q.y) / 2 + 30);
      ctx.closePath();
      inked(ctx, [CITY.neonRed, CITY.windowLit, CITY.neonMint][i % 3], d);
    }
  }
}

export function drawBridgeBack(ctx: CanvasRenderingContext2D, world: World, v: View) {
  const lw = LINE.near * v.ls;
  const d = LINE.detail * v.ls;
  for (const br of world.bridges) {
    for (const tx of br.towers) {
      const w = 54;
      // Two legs with cross-beams, rounded caps.
      box(ctx, tx - w / 2, -br.towerTop - 10, 16, br.towerTop + 10, 7, CITY.bridge, lw, 0);
      box(ctx, tx + w / 2 - 16, -br.towerTop - 10, 16, br.towerTop + 10, 7, CITY.bridge, lw, 0);
      for (const y of [br.towerTop - 40, br.towerTop * 0.62, br.deckY + 90]) {
        box(ctx, tx - w / 2 + 6, -y - 8, w - 12, 16, 4, CITY.bridge, lw);
      }
      box(ctx, tx - w / 2 - 6, -br.towerTop - 22, w + 12, 18, 8, mix(CITY.bridge, INK, 0.2), lw);
      shine(ctx, tx - w / 2 + 4, -br.towerTop + 6, 10, lw * 0.8);
    }
    // Hangers from the main cable to the deck.
    for (const c of world.cables) {
      if (c.kind !== "bridge") continue;
      const n = Math.round(Math.abs(c.b.x - c.a.x) / 46);
      for (let i = 1; i < n; i++) {
        const p = cablePoint(c, i / n);
        if (p.y - br.deckY < 30) continue;
        line(ctx, p.x, -p.y, p.x, -br.deckY - 10, d, CITY.cable);
      }
    }
  }
}

export function drawBridgeDeck(ctx: CanvasRenderingContext2D, world: World, v: View) {
  const lw = LINE.near * v.ls;
  const d = LINE.detail * v.ls;
  for (const br of world.bridges) {
    const top = -br.deckY;
    box(ctx, br.x0, top - 4, br.x1 - br.x0, 14, 4, mix(CITY.bridge, INK, 0.25), lw);
    // Truss.
    box(ctx, br.x0, top + 10, br.x1 - br.x0, 34, 0, CITY.bridge, lw);
    ctx.beginPath();
    for (let x = br.x0, i = 0; x < br.x1; x += 34, i++) {
      ctx.moveTo(x, top + (i % 2 ? 10 : 44));
      ctx.lineTo(x + 34, top + (i % 2 ? 44 : 10));
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = d;
    ctx.stroke();
    // Piers into the river.
    for (const tx of br.towers) box(ctx, tx - 34, top + 44, 68, br.deckY, 0, mix(CITY.bridge, INK, 0.3), lw);
    // Lamps.
    for (let x = br.x0 + 60; x < br.x1; x += 160) {
      line(ctx, x, top - 4, x, top - 46, d * 1.3);
      circle(ctx, x, top - 50, 6, CITY.windowLit, d);
    }
  }
}

/* ------------------------------------------------------------------ the street */

export function drawStreet(ctx: CanvasRenderingContext2D, world: World, v: View) {
  const lw = LINE.near * v.ls;
  const left = v.camX - v.w / 2 / v.zoom - 50;
  const right = v.camX + v.w / 2 / v.zoom + 50;
  const bottom = -(v.camY - v.h / 2 / v.zoom) + 20;
  if (bottom < -10) return;
  ctx.fillStyle = CITY.street;
  ctx.fillRect(left, -2, right - left, bottom + 2);
  // Curb.
  ctx.fillStyle = STREET_CURB;
  ctx.fillRect(left, 0, right - left, 14);
  line(ctx, left, 0, right, 0, lw);
  line(ctx, left, 14, right, 14, LINE.detail * v.ls);
  // Dashed centre line.
  ctx.fillStyle = CITY.streetLine;
  const dash = 46;
  const gap = 38;
  for (let x = Math.floor(left / (dash + gap)) * (dash + gap); x < right; x += dash + gap) {
    ctx.beginPath();
    roundRect(ctx, x, 44, dash, 7, 3.5);
    inked(ctx, CITY.streetLine, LINE.detail * v.ls * 0.8);
  }
  // The river under bridges.
  for (const wr of world.water) {
    if (wr.x1 < left || wr.x0 > right) continue;
    ctx.fillStyle = WATER;
    ctx.fillRect(wr.x0, -6, wr.x1 - wr.x0, bottom + 6);
    line(ctx, wr.x0, -6, wr.x1, -6, lw);
    ctx.strokeStyle = CITY.cable;
    ctx.lineWidth = LINE.detail * v.ls;
    for (let row = 0; row < 3; row++) {
      ctx.beginPath();
      const y = 18 + row * 26;
      const shift = (v.time * (14 + row * 6)) % 60;
      for (let x = wr.x0 + 20 - shift + row * 20; x < wr.x1 - 30; x += 60) {
        if (x < wr.x0 + 10) continue;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 8, y - 6, x + 16, y);
        ctx.quadraticCurveTo(x + 24, y + 6, x + 32, y);
      }
      ctx.stroke();
    }
  }
}
