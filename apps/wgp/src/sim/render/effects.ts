/**
 * Comic effects: bold outlined text bursts (THWIP!, POW!, WEBBED!), flat outlined
 * particles, speed lines and screen shake. Visual only, so it keeps its own little
 * random stream and never touches the sim.
 */
import { CITY, INK, PAPER } from "@/game/style";

import { inked, sparkle, starburst } from "./draw";
import type { View } from "./city";
import { screenTransform, toScreen } from "./city";

export type ParticleKind = "dot" | "star" | "puff" | "goo" | "web";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  r: number;
  color: string;
  kind: ParticleKind;
  g: number;
}

interface Burst {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  size: number;
  fill: string | null;
  ink: string;
  textFill: string;
  rot: number;
  seed: number;
  rise: number;
}

const MAX_PARTICLES = 160;
const MAX_BURSTS = 7;

export class Effects {
  private particles: Particle[] = [];
  private bursts: Burst[] = [];
  shake = 0;
  private s = 0x2545f491;
  constructor(public reducedMotion: boolean) {}

  rnd(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }

  addShake(amount: number) {
    if (this.reducedMotion) return;
    this.shake = Math.min(18, this.shake + amount);
  }

  particlesAt(x: number, y: number, n: number, kind: ParticleKind, color: string, speed = 260, size = 6) {
    const count = this.reducedMotion ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sp = speed * (0.4 + this.rnd() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + (kind === "puff" ? 60 : 0),
        t: 0,
        life: 0.35 + this.rnd() * 0.45,
        r: size * (0.6 + this.rnd() * 0.8),
        color,
        kind,
        g: kind === "puff" ? -80 : kind === "star" ? 300 : 900,
      });
    }
  }

  /** A comic text burst at a world point. `fill` draws a starburst behind it. */
  burst(text: string, x: number, y: number, opts: { size?: number; fill?: string | null; textFill?: string; life?: number; rise?: number } = {}) {
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push({
      text,
      x,
      y,
      t: 0,
      life: opts.life ?? 0.9,
      size: opts.size ?? 30,
      fill: opts.fill === undefined ? CITY.windowLit : opts.fill,
      ink: INK,
      textFill: opts.textFill ?? PAPER,
      rot: (this.rnd() - 0.5) * 0.22,
      seed: Math.floor(this.rnd() * 1e9),
      rise: opts.rise ?? 40,
    });
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 40);
    for (const p of this.particles) {
      p.t += dt;
      p.vy -= p.g * dt;
      p.vx *= 1 - 2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (this.particles.some((p) => p.t >= p.life)) this.particles = this.particles.filter((p) => p.t < p.life);
    for (const b of this.bursts) b.t += dt;
    if (this.bursts.some((b) => b.t >= b.life)) this.bursts = this.bursts.filter((b) => b.t < b.life);
  }

  /** World transform must be set. */
  drawParticles(ctx: CanvasRenderingContext2D, v: View) {
    const lw = 1.6 * v.ls;
    for (const p of this.particles) {
      const k = 1 - p.t / p.life;
      const r = p.r * (p.kind === "puff" ? 1 + (1 - k) * 0.8 : 0.5 + k * 0.5);
      ctx.beginPath();
      if (p.kind === "star") {
        sparkle(ctx, p.x, -p.y, r * 1.6);
      } else if (p.kind === "web") {
        ctx.moveTo(p.x - r, -p.y);
        ctx.lineTo(p.x + r, -p.y);
        ctx.moveTo(p.x, -p.y - r);
        ctx.lineTo(p.x, -p.y + r);
        ctx.strokeStyle = INK;
        ctx.lineWidth = lw * 2;
        ctx.stroke();
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = lw;
        ctx.stroke();
        continue;
      } else {
        ctx.arc(p.x, -p.y, r, 0, Math.PI * 2);
      }
      inked(ctx, p.color, lw);
    }
  }

  /** Screen space. */
  drawBursts(ctx: CanvasRenderingContext2D, v: View) {
    screenTransform(ctx, v);
    const scale = Math.max(0.78, Math.min(1.15, v.zoom * 1.25));
    for (const b of this.bursts) {
      const u = b.t / b.life;
      // Pop in, hold, shrink away.
      const pop = u < 0.12 ? (u / 0.12) * 1.25 : u < 0.22 ? 1.25 - ((u - 0.12) / 0.1) * 0.25 : u > 0.82 ? 1 - (u - 0.82) / 0.18 : 1;
      if (pop <= 0) continue;
      const p = toScreen(v, b.x, b.y);
      const size = b.size * scale;
      ctx.save();
      ctx.font = `800 ${size}px ${v.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(b.text).width;
      // Keep the whole burst on screen.
      const halfW = (w * 0.66 + size * 0.6) * pop;
      const halfH = size * 1.1 * pop;
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      const cx = Math.max(halfW + 6, Math.min(v.w - halfW - 6, p.x));
      const cy = Math.max(halfH + 6, Math.min(v.h - halfH - 6, p.y - u * b.rise * scale));
      ctx.translate(cx, cy);
      ctx.rotate(b.rot);
      ctx.scale(pop, pop);
      if (b.fill) {
        starburst(ctx, 2, 3, w * 0.66 + size * 0.5, size * 1.05, 11, b.seed);
        ctx.fillStyle = INK;
        ctx.fill();
        starburst(ctx, 0, 0, w * 0.66 + size * 0.5, size * 1.05, 11, b.seed);
        inked(ctx, b.fill, 3);
      }
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.2;
      ctx.strokeStyle = b.ink;
      ctx.fillStyle = b.ink;
      ctx.fillText(b.text, size * 0.06, size * 0.1);
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = b.textFill;
      ctx.fillText(b.text, 0, 0);
      ctx.restore();
    }
  }

  clear() {
    this.particles.length = 0;
    this.bursts.length = 0;
    this.shake = 0;
  }
}
