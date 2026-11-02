/**
 * The menu backdrop's engine: the same sticker city, drifting slowly, with the player's
 * hero perched on a rooftop edge. Cheap on purpose: ~30 fps, DPR ≤ 1.5, cached art,
 * paused while hidden or off-screen, and a single still frame under reduced motion.
 */
import type { SuitColors } from "@/components/cast";
import { INK, LINE } from "@/game/style";

import { generateWorld, type World } from "../core";
import {
  buildBuildingArt,
  buildLayer,
  drawBuildingLife,
  drawCable,
  drawCrane,
  drawLayer,
  drawSky,
  drawStreet,
  setCanvasFont,
  worldTransform,
  type BuildingArt,
  type Layer,
  type View,
} from "./city";
import { line, resolveFont } from "./draw";
import { buildHeroSprite, drawSticker, type StickerSprite } from "./sprites";

const FRAME_MS = 1000 / 30;

let sharedWorld: World | null = null;
/** One small, fixed city for every backdrop (no stops: just streets and roofs). */
function backdropWorld(): World {
  if (!sharedWorld) sharedWorld = generateWorld(0x5eed_c17, []);
  return sharedWorld;
}

export class BackdropEngine {
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private raf = 0;
  private last = 0;
  private time = 0;
  private visible = true;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private zoom = 1;
  private layers: { far: Layer; mid: Layer } | null = null;
  private cache = new Map<number, BuildingArt>();
  private hero: StickerSprite | null = null;
  private disposed = false;
  private font = resolveFont();
  private world = backdropWorld();
  private perch: { x: number; y: number };

  constructor(
    private canvas: HTMLCanvasElement,
    /** The hero's suit, or null for a city with nobody on the roof. */
    colors: SuitColors | null,
    private still: boolean,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    setCanvasFont(this.font);
    // Sit on the right edge of the launch roof, legs over the side.
    const roof = this.world.buildings.find((b) => b.x0 <= 0 && b.x0 + b.w >= 0) ?? this.world.buildings[0];
    this.perch = { x: roof.x0 + roof.w - 30, y: roof.h };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.kick();
    });
    this.io.observe(canvas);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    if (colors)
      buildHeroSprite(colors).then((s) => {
        if (this.disposed) return;
        this.hero = s;
        this.render();
      });
    this.kick();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.cache.clear();
  }

  private onVisibility = () => this.kick();

  private kick() {
    cancelAnimationFrame(this.raf);
    if (this.disposed || this.still || !this.visible || document.hidden) return;
    this.last = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      if (now - this.last < FRAME_MS) return;
      this.time += Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.render();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private resize() {
    const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // Landscape shows ~1000 × 900 units; portrait leans in so the city fills the lower half.
    const zoom = this.h > this.w ? Math.max(0.35, this.h / 1500) : Math.max(0.35, Math.min(this.w / 1000, this.h / 900));
    if (Math.abs(zoom - this.zoom) / this.zoom > 0.08 || !this.layers) {
      this.zoom = zoom;
      this.cache.clear();
      this.layers = null;
    }
    this.render();
  }

  private get ls() {
    return Math.max(1, Math.min(2.2, 0.9 / this.zoom));
  }

  private render() {
    if (this.disposed) return;
    const ctx = this.ctx;
    const z = this.zoom;
    const visH = this.h / z;
    const camYMin = visH / 2 - 80;
    const v: View = {
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      camX: this.perch.x - this.w / z / 2 + this.w / z * 0.38 + Math.sin(this.time * 0.05) * 220,
      camY: Math.max(camYMin, this.perch.y - visH * 0.02),
      zoom: z,
      camYMin,
      ls: this.ls,
      time: this.time,
      font: this.font,
    };
    if (!this.layers) {
      const scale = z * this.dpr;
      this.layers = { far: buildLayer("far", 0x31, scale * 0.62, this.ls), mid: buildLayer("mid", 0x47, scale * 0.8, this.ls) };
    }
    drawSky(ctx, v);
    drawLayer(ctx, this.layers.far, v);
    drawLayer(ctx, this.layers.mid, v);
    worldTransform(ctx, v);
    const left = v.camX - v.w / 2 / z - 120;
    const right = v.camX + v.w / 2 / z + 120;
    for (const c of this.world.cranes) if (c.x + c.jib > left && c.x - c.jib < right) drawCrane(ctx, c, v);
    for (const b of this.world.buildings) {
      if (b.x0 + b.w < left || b.x0 > right) continue;
      let art = this.cache.get(b.id);
      if (!art) {
        art = buildBuildingArt(b, z * this.dpr, this.ls);
        this.cache.set(b.id, art);
      }
      ctx.drawImage(art.canvas, art.x, -art.y, art.w, art.h);
      drawBuildingLife(ctx, art, v);
    }
    for (const c of this.world.cables) if (Math.max(c.a.x, c.b.x) > left && Math.min(c.a.x, c.b.x) < right) drawCable(ctx, c, v);
    drawStreet(ctx, this.world, v);
    if (this.hero) {
      const size = 92;
      const x = this.perch.x;
      const y = -this.perch.y - size * 0.42;
      const lw = LINE.near * this.ls;
      // Legs dangling over the edge, swinging a little.
      for (const side of [-1, 1]) {
        const swing = Math.sin(this.time * 1.6 + (side > 0 ? 1.4 : 0)) * 5;
        line(ctx, x + side * 12, -this.perch.y - 2, x + side * 12 + 8 + swing, -this.perch.y + 28, lw * 1.5, INK);
        line(ctx, x + side * 12 + 4 + swing, -this.perch.y + 30, x + side * 12 + 16 + swing, -this.perch.y + 30, lw * 1.8, INK);
      }
      drawSticker(ctx, this.hero, x, y + Math.sin(this.time * 0.9) * 1.5, size, Math.sin(this.time * 0.45) * 0.04);
    }
  }
}
