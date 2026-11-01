/**
 * The game renderer (Canvas 2D). It reads the sim state and the loop's interpolated
 * frame every animation frame and never writes either. It owns the camera (a smoothed
 * follow with look-ahead that zooms out with speed and locks onto arenas), the cached
 * city art, and the comic effects.
 */
import { CITY, INK, LINE, PAPER } from "@/game/style";

import { bestAnchor, HERO_SIZE, heroFacingFor, inArena, isVulnerable, type SimState } from "../core";
import type { LoopEvent, RenderFrame } from "../loop";
import {
  buildBuildingArt,
  buildLayer,
  drawBridgeBack,
  drawBridgeDeck,
  drawBuildingLife,
  drawCable,
  drawCrane,
  drawLayer,
  drawSky,
  drawStreet,
  screenTransform,
  setCanvasFont,
  toScreen,
  worldTransform,
  type BuildingArt,
  type Layer,
  type View,
} from "./city";
import { box, circle, inked, line, mix, resolveFont, sparkle } from "./draw";
import { Effects } from "./effects";
import { drawSticker, type SpriteSet } from "./sprites";

const STEEL = "#AEB4BD";
const BREAD = "#E8B66C";
const LETTUCE = "#78C043";
const GOO = "#19191B";
const GWEI_PINK = "#F3A6C8";

const HIT_WORDS = ["POW!", "BAM!", "WHAM!", "THWACK!"];

export interface RendererOptions {
  reducedMotion: boolean;
  maxDpr?: number;
}

export class GameRenderer {
  readonly effects: Effects;
  private ctx: CanvasRenderingContext2D;
  private ro: ResizeObserver;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private baseZoom = 1;
  private cam = { x: 0, y: 0, zoom: 1, ready: false };
  private layers: { far: Layer; mid: Layer } | null = null;
  private cache = new Map<number, BuildingArt>();
  private cacheKey = "";
  private font: string;
  private hits = 0;
  private time = 0;
  private lastState: SimState | null = null;
  private maxDpr: number;
  private slowFrames = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private sprites: SpriteSet,
    private opts: RendererOptions,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.effects = new Effects(opts.reducedMotion);
    this.maxDpr = opts.maxDpr ?? 1.5;
    this.font = resolveFont();
    setCanvasFont(this.font);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  dispose() {
    this.ro.disconnect();
    this.cache.clear();
  }

  private resize() {
    const box = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.w = Math.max(1, box.width);
    this.h = Math.max(1, box.height);
    this.dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    // Portrait phones see at least ~900 units across; landscape sees ~1000 tall.
    this.baseZoom = Math.min(this.w / 900, this.h / 1000);
    const key = `${Math.round(this.baseZoom * this.dpr * 20)}`;
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.cache.clear();
      this.layers = null;
    }
  }

  /** World-unit multiplier for outlines so small screens keep bold lines. */
  private get ls() {
    return Math.max(1, Math.min(2.2, 0.9 / this.baseZoom));
  }

  onEvent(ev: LoopEvent, s: SimState) {
    const fx = this.effects;
    const h = s.hero;
    switch (ev.type) {
      case "countdown":
        fx.burst(String(ev.value), h.x, h.y + 140, { size: 64, fill: CITY.windowLit, life: 0.7, rise: 10 });
        break;
      case "go":
        fx.burst("THWIP!", h.x, h.y + 150, { size: 52, fill: PAPER, textFill: CITY.neonRed, life: 0.9 });
        break;
      case "thwip":
        fx.particlesAt(ev.ax, ev.ay, 5, "web", PAPER, 140, 6);
        if (s.combo >= 2 || this.hits++ % 3 === 0) fx.burst("THWIP!", ev.ax, ev.ay + 30, { size: 17, fill: null, life: 0.45, rise: 20 });
        break;
      case "fizzle":
        fx.burst("pfft", ev.x, ev.y + 60, { size: 15, fill: null, life: 0.5 });
        break;
      case "release":
        if (ev.grade === "perfect") {
          fx.burst(ev.combo >= 2 ? `PERFECT ×${ev.combo}` : "PERFECT!", ev.x, ev.y + 70, { size: 22, fill: CITY.windowLit, textFill: PAPER, life: 0.8 });
          fx.particlesAt(ev.x, ev.y, 7, "star", CITY.windowLit, 300, 7);
        } else if (ev.grade === "good") {
          fx.burst("NICE", ev.x, ev.y + 60, { size: 15, fill: null, life: 0.5 });
        }
        break;
      case "miss":
        fx.burst(ev.water ? "SPLASH!" : "OOF!", ev.x, ev.y + 60, { size: 24, fill: PAPER, textFill: ev.water ? CITY.skyMid : CITY.neonRed, life: 0.8 });
        fx.particlesAt(ev.x, ev.y - 20, 8, ev.water ? "dot" : "puff", ev.water ? CITY.cable : mix(CITY.street, PAPER, 0.5), 220, 9);
        fx.addShake(5);
        break;
      case "land":
        if (ev.speed > 650) fx.particlesAt(ev.x, ev.y + 4, 5, "puff", mix(CITY.rooftop, PAPER, 0.4), 160, 7);
        break;
      case "villain-hit":
        if (ev.copy) {
          fx.burst("POP!", ev.x, ev.y + 50, { size: 30, fill: PAPER, textFill: INK, life: 0.8 });
          fx.particlesAt(ev.x, ev.y, 10, "goo", "#A3A3A0", 320, 8);
        } else {
          fx.burst(ev.double ? "FINALITY!" : HIT_WORDS[this.hits++ % HIT_WORDS.length], ev.x, ev.y + 50, { size: 34, fill: ev.by === "gwei" ? GWEI_PINK : CITY.windowLit, life: 0.85 });
          fx.particlesAt(ev.x, ev.y, 10, "star", CITY.windowLit, 380, 8);
        }
        fx.addShake(7);
        break;
      case "clang":
        fx.burst(ev.reason === "arms" ? "CLANG!" : "BLOCKED", ev.x, ev.y + 40, { size: ev.reason === "arms" ? 26 : 18, fill: ev.reason === "arms" ? STEEL : null, life: 0.6 });
        fx.particlesAt(ev.x, ev.y, 5, "star", PAPER, 260, 5);
        break;
      case "hero-hurt":
        fx.burst(`OUCH −${ev.damage}`, ev.x, ev.y + 70, { size: 24, fill: CITY.neonRed, textFill: PAPER, life: 0.85 });
        fx.particlesAt(ev.x, ev.y, 7, "star", CITY.neonRed, 300, 6);
        fx.addShake(9);
        break;
      case "shield-pop":
        fx.burst("BLOCKED!", ev.x, ev.y + 60, { size: 22, fill: PAPER, textFill: INK, life: 0.7 });
        fx.particlesAt(ev.x, ev.y, 9, "web", PAPER, 300, 8);
        break;
      case "dodge":
        fx.burst("NOT HERE", ev.x, ev.y + 60, { size: 16, fill: null, life: 0.6 });
        break;
      case "ability":
        fx.burst(ev.twice ? "FORKED!" : abilityWord(ev.id), ev.x, ev.y + 80, { size: 18, fill: null, textFill: CITY.windowLit, life: 0.65 });
        if (ev.id === "front-run") fx.particlesAt(ev.x, ev.y, 6, "puff", PAPER, 200, 7);
        break;
      case "gwei":
        fx.burst("GWEI!", ev.x, ev.y + 150, { size: 34, fill: GWEI_PINK, textFill: PAPER, life: 1 });
        break;
      case "blast":
        if (ev.kind === "bomb") {
          fx.burst("FOOM!", ev.x, ev.y + 40, { size: 26, fill: CITY.windowWarm, textFill: PAPER, life: 0.6 });
          fx.particlesAt(ev.x, ev.y, 10, "dot", CITY.windowWarm, 340, 8);
          fx.addShake(4);
        } else if (ev.kind === "web") {
          fx.burst("SPLAT!", ev.x, ev.y + 40, { size: 28, fill: PAPER, textFill: INK, life: 0.7 });
          fx.particlesAt(ev.x, ev.y, 14, "web", PAPER, 420, 10);
        } else {
          fx.burst("SLAM!", ev.x, ev.y + 40, { size: 32, fill: CITY.windowLit, life: 0.8 });
          fx.particlesAt(ev.x, ev.y, 12, "puff", PAPER, 360, 10);
          fx.addShake(12);
        }
        break;
      case "trap":
        fx.burst("CLAP!", ev.x, ev.y + 70, { size: 24, fill: BREAD, textFill: PAPER, life: 0.6 });
        break;
      case "goo":
        fx.particlesAt(ev.x, ev.y, 6, "goo", GOO, 200, 7);
        break;
      case "villain-attack":
        if (ev.label !== "Fee bomb") fx.burst(`${ev.label}!`, ev.x, ev.y + 90, { size: 16, fill: null, textFill: CITY.neonRed, life: 0.8 });
        break;
      case "fight-won": {
        const v = s.villain;
        fx.burst("WEBBED!", v?.x ?? h.x, (v?.y ?? h.y) + 90, { size: 56, fill: CITY.windowLit, life: 1.9, rise: 20 });
        fx.particlesAt(v?.x ?? h.x, v?.y ?? h.y, 18, "web", PAPER, 460, 11);
        fx.addShake(8);
        break;
      }
      case "ko":
        fx.burst("K.O.!", h.x, h.y + 120, { size: 60, fill: CITY.neonRed, textFill: PAPER, life: 2.2, rise: 16 });
        fx.particlesAt(h.x, h.y, 10, "star", CITY.windowLit, 300, 8);
        fx.addShake(14);
        break;
    }
  }

  /** Render one frame. `dt` is real seconds since the last frame. */
  draw(s: SimState, f: RenderFrame, dt: number) {
    if (this.lastState !== s) {
      this.lastState = s;
      this.cam.ready = false;
    }
    // Quality fallback: if frames run long for a couple of seconds, drop to 1× pixels.
    this.slowFrames = dt > 1 / 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.maxDpr > 1) {
      this.maxDpr = 1;
      this.slowFrames = 0;
      this.resize();
    }
    const ctx = this.ctx;
    this.time += dt;
    const live = f.status === "live" || f.status === "outro";
    if (live || f.status === "intro") this.effects.update(dt);

    const view = this.updateCamera(s, f, dt);
    if (!this.layers) {
      const scale = this.baseZoom * this.dpr;
      this.layers = { far: buildLayer("far", s.world.seed ^ 0x1f, scale * 0.62, this.ls), mid: buildLayer("mid", s.world.seed ^ 0x2e, scale * 0.8, this.ls) };
    }

    drawSky(ctx, view);
    drawLayer(ctx, this.layers.far, view);
    drawLayer(ctx, this.layers.mid, view);

    worldTransform(ctx, view);
    const left = view.camX - view.w / 2 / view.zoom - 120;
    const right = view.camX + view.w / 2 / view.zoom + 120;
    for (const c of s.world.cranes) if (c.x + c.jib > left && c.x - c.jib < right) drawCrane(ctx, c, view);
    drawBridgeBack(ctx, s.world, view);
    const visible: BuildingArt[] = [];
    for (const b of s.world.buildings) {
      if (b.x0 + b.w < left - 80 || b.x0 > right + 80) continue;
      let art = this.cache.get(b.id);
      if (!art) {
        art = buildBuildingArt(b, this.baseZoom * this.dpr, this.ls);
        this.cache.set(b.id, art);
      }
      ctx.drawImage(art.canvas, art.x, -art.y, art.w, art.h);
      visible.push(art);
    }
    for (const art of visible) drawBuildingLife(ctx, art, view);
    if (this.cache.size > 48) {
      for (const id of this.cache.keys()) {
        if (this.cache.size <= 32) break;
        if (!visible.includes(this.cache.get(id)!)) this.cache.delete(id);
      }
    }
    for (const c of s.world.cables) {
      const x0 = Math.min(c.a.x, c.b.x);
      const x1 = Math.max(c.a.x, c.b.x);
      if (x1 > left && x0 < right) drawCable(ctx, c, view);
    }
    drawStreet(ctx, s.world, view);
    drawBridgeDeck(ctx, s.world, view);

    this.drawAllies(ctx, s, view);
    if (live && (s.mode === "travel" || s.mode === "fight") && !s.hero.rope) this.drawTarget(ctx, s, view);
    this.drawVillain(ctx, s, f, view);
    this.drawHazards(ctx, s, view);
    this.drawShots(ctx, s, view);
    this.drawHero(ctx, s, f, view);
    this.drawGwei(ctx, s, view);
    this.effects.drawParticles(ctx, view);

    screenTransform(ctx, view);
    if (!this.opts.reducedMotion) this.drawSpeedLines(ctx, s, f, view);
    if (s.slowmo > 0) this.drawSlowmoFrame(ctx, view);
    this.effects.drawBursts(ctx, view);
  }

  private updateCamera(s: SimState, f: RenderFrame, dt: number): View {
    const h = s.hero;
    const speed = Math.hypot(h.vx, h.vy);
    const zone = inArena(s) ? s.world.zones[s.index] : null;
    let zoom = this.baseZoom * (1 - 0.12 * Math.max(0, Math.min(1, (speed - 350) / 1100)));
    // Arenas fit the whole fight on wide screens; portrait phones follow you inside it.
    if (zone) zoom = Math.max(Math.min(this.w / 1440, this.h / 1060), this.baseZoom * 0.92);
    const k = (rate: number) => (this.cam.ready ? 1 - Math.exp(-dt * rate) : 1);
    this.cam.zoom += (zoom - this.cam.zoom) * k(2.4);
    const z = this.cam.zoom;
    const visW = this.w / z;
    const visH = this.h / z;
    const camYMin = visH / 2 - 95;
    let tx = f.hero.x + Math.max(-260, Math.min(260, h.vx * 0.32)) + (zone ? 0 : visW * 0.1);
    let ty = Math.max(camYMin, f.hero.y - visH * 0.08);
    if (zone) {
      const lo = zone.x0 - 140;
      const hi = zone.x1 + 140;
      if (visW >= hi - lo) tx = zone.x;
      else tx = Math.max(lo + visW / 2, Math.min(hi - visW / 2, tx));
      ty = Math.max(camYMin, Math.min(ty, 560));
    }
    // An errand frames the ally and you in the top part of the screen, above the sheet.
    const errandAlly = s.mode === "errand" ? s.world.zones[s.index]?.ally : null;
    if (errandAlly) {
      tx = errandAlly.x - 50;
      ty = f.hero.y - visH * 0.16;
    }
    this.cam.x += (tx - this.cam.x) * k(4.5);
    this.cam.y += (ty - this.cam.y) * k(3.5);
    this.cam.ready = true;
    const shake = this.effects.shake;
    const sx = shake ? (this.effects.rnd() - 0.5) * shake : 0;
    const sy = shake ? (this.effects.rnd() - 0.5) * shake : 0;
    return {
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      camX: this.cam.x + sx / z,
      camY: (errandAlly ? this.cam.y : Math.max(camYMin, this.cam.y)) + sy / z,
      zoom: z,
      camYMin,
      ls: this.ls,
      time: this.time,
      font: this.font,
    };
  }

  /* ------------------------------------------------------------------ actors */

  private drawTarget(ctx: CanvasRenderingContext2D, s: SimState, v: View) {
    const a = bestAnchor(s, heroFacingFor(s));
    if (!a) return;
    const pulse = 1 + Math.sin(this.time * 6) * 0.12;
    const r = 13 * pulse;
    ctx.beginPath();
    ctx.arc(a.x, -a.y, r, 0, Math.PI * 2);
    ctx.lineWidth = 6 * v.ls;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 2.6 * v.ls;
    ctx.strokeStyle = PAPER;
    ctx.stroke();
  }

  private drawHero(ctx: CanvasRenderingContext2D, s: SimState, f: RenderFrame, v: View) {
    const h = s.hero;
    const x = f.hero.x;
    const y = -f.hero.y;
    const size = HERO_SIZE;
    const lw = LINE.near * v.ls;
    // The web: white with an ink outline, from the hand to the anchor.
    if (h.rope) {
      const hx = x + Math.sin(f.hero.angle) * size * 0.32;
      const hy = y - Math.cos(f.hero.angle) * size * 0.32;
      line(ctx, hx, hy, h.rope.x, -h.rope.y, lw * 1.9, INK);
      line(ctx, hx, hy, h.rope.x, -h.rope.y, lw * 0.75, CITY.webLine);
      ctx.beginPath();
      sparkle(ctx, h.rope.x, -h.rope.y, 11);
      inked(ctx, PAPER, LINE.detail * v.ls);
    }
    if (h.shieldT > 0) {
      const r = size * 0.72;
      circle(ctx, x, y, r, null, lw * 2.2);
      circle(ctx, x, y, r, null, lw * 0.9, PAPER);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.78, Math.PI * 1.1, Math.PI * 1.45);
      ctx.lineWidth = lw;
      ctx.strokeStyle = PAPER;
      ctx.stroke();
    }
    const speed = Math.hypot(h.vx, h.vy);
    let angle = f.hero.angle;
    if (h.spin > 0) angle += (1 - h.spin) * Math.PI * 2 * h.facing;
    // Stretch along the motion, squash on landing.
    const st = h.grounded || s.mode === "ko" ? 0 : Math.min(0.07, speed / 16000);
    const sq = h.squash * 0.28;
    const blink = h.invuln > 0 && s.mode === "fight" && !this.opts.reducedMotion && Math.floor(this.time * 16) % 2 === 0;
    ctx.save();
    if (h.cloakT > 0) ctx.globalAlpha = 0.4;
    else if (blink) ctx.globalAlpha = 0.55;
    if (h.grounded && Math.abs(h.vx) > 40 && s.mode !== "ko") this.drawLegs(ctx, x, y + size * 0.42, Math.abs(h.vx), lw);
    if (st > 0.01) {
      const va = Math.atan2(-h.vy, h.vx);
      ctx.translate(x, y);
      ctx.rotate(va);
      ctx.scale(1 + st, 1 - st * 0.6);
      ctx.rotate(-va);
      drawSticker(ctx, this.sprites.hero, 0, 0, size, angle, 1 + sq, 1 - sq, h.hurtT * 2.5);
    } else {
      drawSticker(ctx, this.sprites.hero, x, y, size, angle, 1 + sq, 1 - sq, h.hurtT * 2.5);
    }
    ctx.restore();
    if (h.finalityT > 0) this.chip(ctx, x + size * 0.45, y - size * 0.5, "×2", CITY.windowLit, v);
    if (s.mode === "ko") this.dizzy(ctx, x, y - size * 0.45, v);
  }

  /** Little running legs under a sticker. */
  private drawLegs(ctx: CanvasRenderingContext2D, x: number, y: number, speed: number, lw: number) {
    const phase = this.time * (6 + speed / 60);
    for (const side of [-1, 1]) {
      const swing = Math.sin(phase + (side > 0 ? Math.PI : 0)) * 14;
      line(ctx, x + side * 12, y - 6, x + side * 12 + swing, y + 14, lw * 1.5);
      line(ctx, x + side * 12 + swing - 4, y + 15, x + side * 12 + swing + 7, y + 15, lw * 1.8);
    }
  }

  private chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, v: View) {
    ctx.save();
    ctx.font = `800 ${16 * v.ls}px ${this.font}`;
    const w = ctx.measureText(text).width + 14 * v.ls;
    box(ctx, x - w / 2, y - 12 * v.ls, w, 24 * v.ls, 12 * v.ls, fill, 2 * v.ls);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  private dizzy(ctx: CanvasRenderingContext2D, x: number, y: number, v: View) {
    for (let i = 0; i < 3; i++) {
      const a = this.time * 3 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      sparkle(ctx, x + Math.cos(a) * 34, y + Math.sin(a) * 10, 9);
      inked(ctx, CITY.windowLit, LINE.detail * v.ls);
    }
  }

  private bubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, v: View, textFill = INK) {
    const lw = 2.4 * v.ls;
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 18);
    ctx.lineTo(x, y + 32);
    ctx.lineTo(x + 8, y + 16);
    inked(ctx, fill, lw);
    circle(ctx, x, y, 22, fill, lw);
    ctx.fillStyle = fill;
    ctx.fillRect(x - 6, y + 12, 12, 8);
    ctx.font = `800 28px ${this.font}`;
    ctx.fillStyle = textFill;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 2);
  }

  private drawAllies(ctx: CanvasRenderingContext2D, s: SimState, v: View) {
    for (const z of s.world.zones) {
      if (!z.ally) continue;
      const sprite = this.sprites.cast[z.ally.id];
      if (!sprite) continue;
      const size = 84;
      const bob = Math.sin(this.time * 2.4 + z.index) * 3;
      const x = z.ally.x;
      const y = -z.ally.y - size * 0.46 + bob;
      drawSticker(ctx, sprite, x, y, size, Math.sin(this.time * 1.7) * 0.05);
      const done = z.index < s.index || (z.index === s.index && s.mode !== "travel" && s.mode !== "errand");
      if (!done) this.bubble(ctx, x + 34, y - size * 0.72 + Math.sin(this.time * 4) * 3, "!", CITY.windowLit, v);
    }
  }

  private drawVillain(ctx: CanvasRenderingContext2D, s: SimState, f: RenderFrame, v: View) {
    const vil = s.villain;
    if (!vil) return;
    const sprite = this.sprites.cast[vil.cast];
    if (!sprite) return;
    const lw = LINE.near * v.ls;
    const x = f.villain.x;
    const y = -f.villain.y;
    const guard = vil.invuln > 0 && s.mode === "fight" && !this.opts.reducedMotion && Math.floor(this.time * 12) % 2 === 0;
    const flash = vil.flash;
    switch (vil.kind) {
      case "gas-goblin": {
        const size = vil.boss ? 134 : 122;
        const tilt = Math.max(-0.35, Math.min(0.35, vil.vx / 1600));
        const bob = vil.phase === "telegraph" ? Math.sin(this.time * 40) * 3 : Math.sin(this.time * 3) * 4;
        ctx.save();
        if (guard) ctx.globalAlpha = 0.55;
        drawSticker(ctx, sprite, x, y + bob, size, tilt, 1, 1, flash);
        ctx.restore();
        if (vil.phase === "telegraph") this.bubble(ctx, x + 50, y - size * 0.7, "!", CITY.neonRed, v, PAPER);
        break;
      }
      case "sandwich-man": {
        const size = vil.boss ? 124 : 112;
        const crouch = vil.phase === "telegraph" ? 0.12 : 0;
        if (vil.grounded && Math.abs(vil.vx) > 30) this.drawLegs(ctx, x, y + size * 0.42, Math.abs(vil.vx), lw);
        ctx.save();
        if (guard) ctx.globalAlpha = 0.55;
        drawSticker(ctx, sprite, x, y, size, vil.phase === "dash" ? vil.facing * 0.3 : 0, 1 + crouch, 1 - crouch, flash);
        ctx.restore();
        if (vil.phase === "dash") this.dashLines(ctx, x, y, vil.vx, vil.vy, v);
        if (vil.phase === "telegraph") this.bubble(ctx, x + 46, y - size * 0.7, "!", CITY.neonRed, v, PAPER);
        break;
      }
      case "doc-octochain": {
        const size = vil.boss ? 136 : 126;
        // Chain arms behind the body.
        vil.arms.forEach((a) => {
          const tx = x + Math.cos(a.angle) * a.len;
          const ty = y - Math.sin(a.angle) * a.len;
          this.chain(ctx, x, y, tx, ty, v, vil.phase === "slam-wind");
        });
        ctx.save();
        if (guard) ctx.globalAlpha = 0.55;
        drawSticker(ctx, sprite, x, y, size, Math.sin(this.time * 1.5) * 0.06, 1, 1, flash);
        ctx.restore();
        if (isVulnerable(vil) && s.mode === "fight") {
          for (let i = 0; i < 4; i++) {
            const a = this.time * 2 + (i * Math.PI) / 2;
            ctx.beginPath();
            sparkle(ctx, x + Math.cos(a) * size * 0.62, y + Math.sin(a) * size * 0.5, 9);
            inked(ctx, CITY.windowLit, LINE.detail * v.ls);
          }
        }
        if (vil.phase === "slam-wind") this.bubble(ctx, x + 56, y - size * 0.72, "!", CITY.neonRed, v, PAPER);
        break;
      }
      case "sybil": {
        const copy = this.sprites.sybilCopy ?? sprite;
        vil.bodies.forEach((b, i) => {
          if (!b.alive) return;
          const p = f.bodies[i] ?? b;
          const size = b.real ? (vil.boss ? 112 : 104) : 92;
          ctx.save();
          if (guard) ctx.globalAlpha = 0.6;
          drawSticker(ctx, b.real ? sprite : copy, p.x, -p.y, size, Math.sin(this.time * 2 + i) * 0.1, 1, 1, flash);
          ctx.restore();
        });
        break;
      }
    }
    if (vil.stun > 0 && s.mode === "fight") {
      this.webWrap(ctx, x, y, 0.5, v);
      this.dizzy(ctx, x, y - 70, v);
    }
    if (s.mode === "won") {
      // Webbed: a line up to the sky and a wrap over the sticker.
      line(ctx, x, y - 60, x, y - 900, lw * 1.9, INK);
      line(ctx, x, y - 60, x, y - 900, lw * 0.75, PAPER);
      this.webWrap(ctx, x, y, vil.webbed, v);
    }
  }

  private webWrap(ctx: CanvasRenderingContext2D, x: number, y: number, amount: number, v: View) {
    const lw = LINE.near * v.ls;
    const n = Math.round(3 + amount * 4);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const yy = y - 40 + (i * 80) / n;
      const tilt = (i % 2 ? 1 : -1) * 14;
      line(ctx, x - 52, yy - tilt, x + 52, yy + tilt, lw * 1.6, INK);
      line(ctx, x - 52, yy - tilt, x + 52, yy + tilt, lw * 0.6, PAPER);
    }
    ctx.restore();
  }

  private chain(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, v: View, hot: boolean) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.floor(d / 15));
    const a = Math.atan2(y1 - y0, x1 - x0);
    const detail = LINE.detail * v.ls * 1.1;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      if (i % 2) box(ctx, -9, -6, 18, 12, 5.5, hot ? mix(STEEL, CITY.neonRed, 0.5) : STEEL, detail);
      else box(ctx, -7, -2.5, 14, 5, 2.5, STEEL, detail);
      ctx.restore();
    }
    // Claw.
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(a);
    const claw = () => {
      ctx.beginPath();
      ctx.moveTo(2, -3);
      ctx.bezierCurveTo(8, -14, 18, -15, 24, -9);
      ctx.moveTo(4, 0);
      ctx.lineTo(24, 1);
      ctx.moveTo(2, 3);
      ctx.bezierCurveTo(8, 14, 18, 15, 24, 9);
    };
    claw();
    ctx.lineWidth = 8 * v.ls;
    ctx.strokeStyle = INK;
    ctx.lineCap = "round";
    ctx.stroke();
    claw();
    ctx.lineWidth = 3.4 * v.ls;
    ctx.strokeStyle = STEEL;
    ctx.stroke();
    circle(ctx, 0, 0, 8, STEEL, detail * 1.4);
    ctx.restore();
  }

  private dashLines(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, v: View) {
    const sp = Math.hypot(vx, vy) || 1;
    const ux = vx / sp;
    const uy = -vy / sp;
    for (let i = -2; i <= 2; i++) {
      const ox = -uy * i * 16;
      const oy = ux * i * 16;
      line(ctx, x - ux * 60 + ox, y - uy * 60 + oy, x - ux * (110 + Math.abs(i) * -10) + ox, y - uy * (110 + Math.abs(i) * -10) + oy, LINE.detail * v.ls * 1.6, PAPER);
    }
  }

  private drawHazards(ctx: CanvasRenderingContext2D, s: SimState, v: View) {
    const lw = LINE.near * v.ls;
    const d = LINE.detail * v.ls;
    for (const z of s.hazards) {
      const x = z.x;
      const y = -z.y;
      if (z.kind === "bomb") {
        // A fee bomb: red, a percent sign, a lit fuse.
        line(ctx, x + 6, y - z.r + 2, x + 12, y - z.r - 10, d * 1.6);
        if (Math.floor(this.time * 10) % 2 === 0) {
          ctx.beginPath();
          sparkle(ctx, x + 13, y - z.r - 13, 8);
          inked(ctx, CITY.windowLit, d);
        }
        circle(ctx, x, y, z.r, CITY.neonRed, lw);
        ctx.font = `800 ${z.r * 1.1}px ${this.font}`;
        ctx.fillStyle = PAPER;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("%", x, y + 1);
        ctx.beginPath();
        ctx.arc(x, y, z.r * 0.7, Math.PI * 1.1, Math.PI * 1.45);
        ctx.lineWidth = d;
        ctx.strokeStyle = PAPER;
        ctx.stroke();
      } else if (z.kind === "goo") {
        const wob = Math.sin(this.time * 14 + x) * 0.12;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1 + wob, 1 - wob);
        circle(ctx, 0, 0, z.r + 3 * v.ls, PAPER, 0);
        circle(ctx, 0, 0, z.r, GOO, d);
        circle(ctx, -z.r * 0.35, -z.r * 0.35, z.r * 0.22, PAPER, 0);
        ctx.restore();
      } else if (z.kind === "trap") {
        const w = 92;
        const hgt = 16;
        const open = z.state === "open" || z.state === "armed" ? 1 : z.state === "clap" ? 1 - Math.min(1, z.t / 0.14) : 0;
        const by = y - 2;
        box(ctx, x - w / 2, by - hgt, w, hgt, 8, BREAD, lw);
        if (open < 0.2) {
          // Shut: lettuce peeks out.
          ctx.beginPath();
          for (let i = 0; i <= 8; i++) ctx.lineTo(x - w / 2 + (w * i) / 8, by - hgt - (i % 2 ? 7 : 2));
          ctx.lineTo(x + w / 2, by - hgt);
          ctx.lineTo(x - w / 2, by - hgt);
          inked(ctx, LETTUCE, d);
        }
        ctx.save();
        ctx.translate(x - w / 2 + 6, by - hgt - 2);
        ctx.rotate(-open * 1.05);
        box(ctx, -6, -hgt, w, hgt, 8, BREAD, lw);
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.ellipse(10 + i * 20, -hgt / 2 - 1, 3, 1.6, 0.4, 0, Math.PI * 2);
          inked(ctx, "#FFF4D6", 1);
        }
        ctx.restore();
        if (z.state === "armed" && Math.floor(this.time * 4) % 2 === 0) {
          ctx.font = `800 14px ${this.font}`;
          ctx.fillStyle = CITY.neonRed;
          ctx.textAlign = "center";
          ctx.fillText("!", x, by - 40);
        }
      }
    }
  }

  private drawShots(ctx: CanvasRenderingContext2D, s: SimState, v: View) {
    const lw = LINE.near * v.ls;
    for (const shot of s.shots) {
      const x = shot.x;
      const y = -shot.y;
      const sp = Math.hypot(shot.vx, shot.vy) || 1;
      const tx = x - (shot.vx / sp) * 46;
      const ty = y + (shot.vy / sp) * 46;
      if (shot.kind === "sling") {
        line(ctx, tx, ty, x, y, lw * 1.8, INK);
        line(ctx, tx, ty, x, y, lw * 0.7, PAPER);
        ctx.beginPath();
        sparkle(ctx, x, y, 12);
        inked(ctx, PAPER, LINE.detail * v.ls);
      } else {
        circle(ctx, x, y, 17, PAPER, lw);
        line(ctx, x - 12, y, x + 12, y, LINE.detail * v.ls);
        line(ctx, x, y - 12, x, y + 12, LINE.detail * v.ls);
        line(ctx, x - 8, y - 8, x + 8, y + 8, LINE.detail * v.ls);
        line(ctx, x + 8, y - 8, x - 8, y + 8, LINE.detail * v.ls);
      }
    }
  }

  private drawGwei(ctx: CanvasRenderingContext2D, s: SimState, v: View) {
    const g = s.gwei;
    const sprite = this.sprites.cast.gwei;
    if (!g || !sprite) return;
    const lw = LINE.near * v.ls;
    line(ctx, g.x, -g.y, g.anchor.x, -g.anchor.y, lw * 1.9, INK);
    line(ctx, g.x, -g.y, g.anchor.x, -g.anchor.y, lw * 0.75, PAPER);
    const angle = Math.atan2(g.anchor.x - g.x, g.anchor.y - g.y);
    drawSticker(ctx, sprite, g.x, -g.y, 96, angle);
  }

  private drawSpeedLines(ctx: CanvasRenderingContext2D, s: SimState, f: RenderFrame, v: View) {
    const h = s.hero;
    const sp = Math.hypot(h.vx, h.vy);
    if (sp < 950 || s.mode === "ko") return;
    const p = toScreen(v, f.hero.x, f.hero.y);
    const ux = h.vx / sp;
    const uy = -h.vy / sp;
    const k = Math.min(1, (sp - 950) / 500);
    const tick = Math.floor(this.time * 20);
    for (let i = 0; i < 6; i++) {
      const r = ((tick * 7 + i * 13) % 17) / 17;
      const off = (r - 0.5) * 90;
      const ox = -uy * off;
      const oy = ux * off;
      const len = (60 + r * 80) * k;
      const sx = p.x - ux * (60 + r * 40) + ox;
      const sy = p.y - uy * (60 + r * 40) + oy;
      line(ctx, sx, sy, sx - ux * len, sy - uy * len, 4, INK);
      line(ctx, sx, sy, sx - ux * len, sy - uy * len, 1.6, PAPER);
    }
  }

  private drawSlowmoFrame(ctx: CanvasRenderingContext2D, v: View) {
    const m = 10;
    ctx.beginPath();
    ctx.rect(m, m, v.w - m * 2, v.h - m * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = CITY.neonMint;
    ctx.stroke();
  }
}

function abilityWord(id: string): string {
  const words: Record<string, string> = {
    "web-sling": "THWIP!",
    "web-shield": "SHIELD UP",
    "node-sense": "NODE SENSE",
    "wall-crawl": "+HEALTH",
    yank: "YANK!",
    finality: "FINALITY",
    "web-bomb": "WEB BOMB!",
    "gas-refund": "REFUNDED",
    fork: "FORK",
    "zk-cloak": "CLOAKED",
    "front-run": "FRONT-RUN!",
    "validator-slam": "SLAM!",
  };
  return words[id] ?? "THWIP!";
}
