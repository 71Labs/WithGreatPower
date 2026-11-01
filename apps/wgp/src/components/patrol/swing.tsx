"use client";

import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { MEDIA_PALETTES } from "@/components/art/scenes";
import { ShaderCanvas } from "@/components/art/shader-canvas";
import { AlertTriangle, Check, MapPin, Sparkles } from "@/components/icons";
import { HeroTile, type HeroSave } from "@/components/game/ui";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { Button } from "@/components/ui";
import { DISTRICTS, SWING } from "@/game/data";
import { rand } from "@/game/engine";
import type { SwingGrade } from "@/game/types";

import { districtName, stopName, stopWhat, stopWho, useMotionOk } from "./shared";
import { SceneMedia } from "./scene-media";

/* ------------------------------------------------------------------ rules */

/** Widest swing either side of straight down, in degrees. */
const AMP = 48;
/**
 * Grading: how far the hero is from the middle of the sweet spot when you let go, in
 * degrees of swing. Within 5° is perfect, within 13° is good, anything else misses.
 */
export const SWING_ZONES = { perfect: 5, good: 13 } as const;

const DEG = Math.PI / 180;
/** How long the hero is in the air after letting go, then a beat before landing. */
const FLIGHT_MS = 760;
const LAND_PAUSE_MS = 220;

/** The sweet spot moves stop to stop (seeded, so it's the same on a reload). */
function sweetSpot(seed: number, index: number): number {
  const [r] = rand((seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
  return AMP * (0.5 + 0.34 * r);
}

/** A full swing takes 2.1s, a little quicker with every combo, down to 1.5s. */
const periodFor = (combo: number) => Math.max(1500, 2100 - 120 * Math.min(combo, 5));

function gradeFor(theta: number, center: number): SwingGrade {
  const d = Math.abs(theta - center);
  return d <= SWING_ZONES.perfect ? "perfect" : d <= SWING_ZONES.good ? "good" : "miss";
}

/** Angle at a moment: starts held back on the left, swings right first. */
const thetaAt = (elapsed: number, period: number) => -AMP * Math.cos((2 * Math.PI * elapsed) / period);

/* ------------------------------------------------------------------ geometry */

interface Pt {
  x: number;
  y: number;
}

interface Layout {
  w: number;
  h: number;
  pivot: Pt;
  /** Rope length to the middle of the hero tile. */
  rope: number;
  tile: number;
  /** Radius of the track the sweet spot is drawn on: just under the hero's path. */
  track: number;
  target: Pt;
}

function layoutFor(w: number, h: number): Layout {
  const tile = w < 480 ? 56 : 68;
  const pivot = { x: w / 2, y: 14 };
  const byWidth = (w / 2 - tile / 2 - 24) / Math.sin(AMP * DEG);
  const byHeight = h - pivot.y - tile - 84;
  const rope = Math.max(90, Math.min(byWidth, byHeight));
  return {
    w,
    h,
    pivot,
    rope,
    tile,
    track: rope + tile / 2 + 14,
    // Land on top of the "Swinging to" card in the bottom-right corner.
    target: { x: w - 12 - Math.min(64, w * 0.16), y: h - 12 - 48 - tile * 0.32 },
  };
}

const at = (l: Layout, theta: number, r: number): Pt => ({
  x: l.pivot.x + r * Math.sin(theta * DEG),
  y: l.pivot.y + r * Math.cos(theta * DEG),
});

function arcPath(l: Layout, from: number, to: number, r: number): string {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 1.5));
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const p = at(l, from + ((to - from) * i) / steps, r);
    d += `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return d;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface Release {
  /** When the flight starts (the click), and the grade, fixed at the press. */
  at: number;
  grade: SwingGrade;
  theta: number;
  flight?: { p0: Pt; v0: Pt; g: number; attach: Pt; spin: number; drop: boolean };
}

/* ------------------------------------------------------------------ component */

const GRADE_COPY: Record<SwingGrade, { title: string; icon: typeof Sparkles }> = {
  perfect: { title: "Perfect!", icon: Sparkles },
  good: { title: "Good swing", icon: Check },
  miss: { title: "Missed the web", icon: AlertTriangle },
};

/**
 * The swing between stops: the hero hangs from a web line and swings like a pendulum
 * over the city. Let go over the red arc. Space or Enter, a tap on the city, or the
 * button all let go; the timing is taken from the moment you press.
 */
export function SwingGame({ save, onDone }: { save: HeroSave; onDone: (grade: SwingGrade) => void }) {
  const p = save.patrol!;
  const stop = p.stops[p.index];
  const center = sweetSpot(p.seed, p.index);
  const period = periodFor(p.combo);

  const motionOk = useMotionOk();
  const [timedAnyway, setTimedAnyway] = useState(false);
  const animated = motionOk || timedAnyway;
  const [released, setReleased] = useState<SwingGrade | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const haloRef = useRef<SVGPathElement>(null);
  const trackRef = useRef<SVGPathElement>(null);
  const goodRef = useRef<SVGPathElement>(null);
  const goodEdgeRef = useRef<SVGPathElement>(null);
  const perfectRef = useRef<SVGPathElement>(null);
  const perfectEdgeRef = useRef<SVGPathElement>(null);
  const anchorRef = useRef<SVGGElement>(null);
  const markerRef = useRef<SVGCircleElement>(null);
  const streakRef = useRef<SVGPathElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  const startRef = useRef(0);
  const releaseRef = useRef<Release | null>(null);
  const pressRef = useRef<number | null>(null);

  const finish = useEffectEvent((grade: SwingGrade) => onDone(grade));

  // Draw and run the swing. Everything per frame goes straight to the DOM through refs.
  useEffect(() => {
    const stage = stageRef.current;
    const svg = svgRef.current;
    if (!stage || !svg) return;
    let layout = layoutFor(stage.clientWidth, stage.clientHeight);

    const setD = (el: SVGPathElement | null, d: string) => el?.setAttribute("d", d);

    const applyLayout = () => {
      layout = layoutFor(stage.clientWidth, stage.clientHeight);
      svg.setAttribute("viewBox", `0 0 ${layout.w} ${layout.h}`);
      const r = layout.track;
      setD(trackRef.current, arcPath(layout, -AMP - 4, AMP + 4, r));
      const good: [number, number] = [Math.max(-AMP, center - SWING_ZONES.good), Math.min(AMP + 4, center + SWING_ZONES.good)];
      const perfect: [number, number] = [center - SWING_ZONES.perfect, center + SWING_ZONES.perfect];
      setD(goodRef.current, arcPath(layout, good[0], good[1], r));
      setD(goodEdgeRef.current, arcPath(layout, good[0], good[1], r));
      setD(perfectRef.current, arcPath(layout, perfect[0], perfect[1], r));
      setD(perfectEdgeRef.current, arcPath(layout, perfect[0], perfect[1], r));
      anchorRef.current?.setAttribute("transform", `translate(${layout.pivot.x} ${layout.pivot.y})`);
      const hero = heroRef.current;
      if (hero) {
        hero.style.width = `${layout.tile}px`;
        hero.style.height = `${layout.tile}px`;
      }
      const label = labelRef.current;
      if (label) {
        const lp = at(layout, center, r + 40);
        label.style.transform = `translate(${lp.x}px, ${lp.y}px) translate(-50%, -50%)`;
      }
    };

    /** Hero on the rope at an angle. */
    const drawSwing = (theta: number, trail: number | null = null) => {
      const l = layout;
      const c = at(l, theta, l.rope);
      const attach = at(l, theta, l.rope - l.tile / 2 + 4);
      const d = `M${l.pivot.x} ${l.pivot.y}L${attach.x.toFixed(1)} ${attach.y.toFixed(1)}`;
      setD(lineRef.current, d);
      setD(haloRef.current, d);
      const hero = heroRef.current;
      if (hero) {
        hero.style.opacity = "1";
        hero.style.transform = `translate(${(c.x - l.tile / 2).toFixed(1)}px, ${(c.y - l.tile / 2).toFixed(1)}px) rotate(${(-theta).toFixed(2)}deg)`;
      }
      const m = at(l, theta, l.track);
      const marker = markerRef.current;
      if (marker) {
        marker.setAttribute("cx", m.x.toFixed(1));
        marker.setAttribute("cy", m.y.toFixed(1));
        // The marker lights up over the sweet spot, which teaches the rhythm.
        const d = Math.abs(theta - center);
        marker.setAttribute("fill", d <= SWING_ZONES.perfect ? "var(--vs-accent)" : "#FFFFFF");
        marker.setAttribute("r", d <= SWING_ZONES.good ? "6.5" : "5");
      }
      // A soft streak behind the hero: where it was a moment ago.
      setD(streakRef.current, trail === null || Math.abs(trail - theta) < 0.5 ? "" : arcPath(l, trail, theta, l.rope));
    };

    /** After letting go: a short arc toward the next stop, or a drop for a miss. */
    const drawFlight = (rel: Release, now: number) => {
      const l = layout;
      if (!rel.flight) {
        const elapsed = now - startRef.current;
        const theta = thetaAt(elapsed, period);
        const p0 = at(l, theta, l.rope);
        const tau = FLIGHT_MS / 1000;
        const g = 1500;
        const drop = rel.grade === "miss";
        const target = drop
          ? { x: p0.x + Math.min(90, l.w * 0.14), y: l.h + l.tile * 1.5 }
          : rel.grade === "good"
            ? { x: l.target.x - Math.min(56, l.w * 0.08), y: l.target.y + 6 }
            : l.target;
        const v0 = { x: (target.x - p0.x) / tau, y: (target.y - p0.y - 0.5 * g * tau * tau) / tau };
        rel.flight = { p0, v0, g, attach: at(l, theta, l.rope - l.tile / 2 + 4), spin: rel.grade === "perfect" ? 360 : 0, drop };
        rel.theta = theta;
      }
      const f = rel.flight;
      setD(streakRef.current, "");
      const t = Math.min(1, (now - rel.at) / FLIGHT_MS);
      const s = (t * FLIGHT_MS) / 1000;
      const x = f.p0.x + f.v0.x * s;
      const y = f.p0.y + f.v0.y * s + 0.5 * f.g * s * s;
      const hero = heroRef.current;
      if (hero) {
        const rot = lerp(-rel.theta, f.drop ? 40 : 0, easeOut(t)) + f.spin * easeOut(t);
        const scale = f.drop ? 1 : lerp(1, 0.78, t);
        hero.style.transform = `translate(${(x - l.tile / 2).toFixed(1)}px, ${(y - l.tile / 2).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
        hero.style.opacity = f.drop ? String(1 - Math.max(0, t - 0.6) / 0.4) : "1";
      }
      // The web snaps back up to the anchor.
      const k = easeOut(Math.min(1, t * 3));
      const ax = lerp(f.attach.x, l.pivot.x, k);
      const ay = lerp(f.attach.y, l.pivot.y, k);
      const d = `M${l.pivot.x} ${l.pivot.y}L${ax.toFixed(1)} ${ay.toFixed(1)}`;
      setD(lineRef.current, d);
      setD(haloRef.current, d);
    };

    applyLayout();
    if (!animated) drawSwing(0);
    const ro = new ResizeObserver(() => {
      applyLayout();
      if (!animated) drawSwing(0);
    });
    ro.observe(stage);
    if (!animated) return () => ro.disconnect();

    startRef.current = performance.now();
    let raf = 0;
    let done = false;
    const tick = (now: number) => {
      const rel = releaseRef.current;
      if (!rel) {
        const elapsed = now - startRef.current;
        drawSwing(thetaAt(elapsed, period), thetaAt(Math.max(0, elapsed - 110), period));
      } else if (now - rel.at < FLIGHT_MS) {
        drawFlight(rel, now);
      } else {
        drawFlight(rel, rel.at + FLIGHT_MS);
        if (!done && now - rel.at >= FLIGHT_MS + LAND_PAUSE_MS) {
          done = true;
          finish(rel.grade);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [animated, center, period]);

  /** Let go. `pressedAt` is when the key or pointer went down, which sets the grade. */
  function release(pressedAt: number) {
    if (!animated || releaseRef.current) return;
    const now = performance.now();
    const when = now - pressedAt < 400 ? pressedAt : now;
    const theta = thetaAt(when - startRef.current, period);
    const grade = gradeFor(theta, center);
    releaseRef.current = { at: now, grade, theta };
    setReleased(grade);
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    const onReleaseButton = !!target?.closest("[data-swing-release]");
    // Leave Space and Enter alone on other controls (links, the nav, other buttons).
    if (!onReleaseButton && target?.closest("a, button, input, textarea, select, summary, [role='button'], [contenteditable='true']")) return;
    e.preventDefault();
    release(performance.now());
  });

  useEffect(() => {
    if (!animated) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [animated]);

  const press = (e: { button: number }) => {
    if (e.button === 0) pressRef.current = performance.now();
  };
  const tap = () => {
    const pressed = pressRef.current;
    pressRef.current = null;
    release(pressed ?? performance.now());
  };

  const who = stopWho(stop);
  const district = districtName(stop);
  const graded = released ? GRADE_COPY[released] : null;
  const GradeIcon = graded?.icon;

  return (
    <section aria-labelledby="swing-title" className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The stage: dithered city, web line, hero, sweet spot. Clicking it lets go. */}
        <div className="relative isolate overflow-hidden rounded-card bg-surface-2">
          <SceneMedia>
            <ShaderCanvas scene="skyline" palette={MEDIA_PALETTES.nightcity} seed={p.night * 7 + p.index} fps={24} className="absolute inset-0" />
          </SceneMedia>
          <div
            ref={stageRef}
            aria-hidden
            onPointerDown={press}
            onClick={tap}
            className={`relative h-[360px] select-none [-webkit-tap-highlight-color:transparent] sm:h-[420px] lg:h-[460px] ${
              animated && !released ? "cursor-pointer" : ""
            }`}
          >
            <svg ref={svgRef} className="pointer-events-none absolute inset-0 size-full overflow-visible" fill="none">
              {/* The whole swing, dashed, so you can see the path you're on. */}
              <path ref={trackRef} stroke="#141414" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="2 6" strokeLinecap="round" />
              {/* Good zone, then the perfect core: ink outline under a fill, like the stickers. */}
              <path ref={goodEdgeRef} stroke="#141414" strokeWidth={15} strokeLinecap="round" />
              <path ref={goodRef} stroke="#FFFFFF" strokeWidth={11} strokeLinecap="round" />
              <path ref={perfectEdgeRef} stroke="#141414" strokeWidth={15} strokeLinecap="round" />
              <path ref={perfectRef} stroke="var(--vs-accent)" strokeWidth={11} strokeLinecap="round" />
              <circle ref={markerRef} r={5} fill="#FFFFFF" stroke="#141414" strokeWidth={2.5} cx={-20} cy={-20} />
              {/* Motion streak, drawn under the hero. */}
              <path ref={streakRef} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={22} strokeLinecap="round" />
              {/* The web line, with a white halo so it reads on sky and towers alike. */}
              <path ref={haloRef} stroke="#FFFFFF" strokeOpacity={0.85} strokeWidth={5} strokeLinecap="round" />
              <path ref={lineRef} stroke="#141414" strokeWidth={2} strokeLinecap="round" />
              <g ref={anchorRef}>
                <path d="M-14 -2L14 -2M-10 -10L10 6M10 -10L-10 6M0 -12L0 8" stroke="#141414" strokeWidth={1.5} strokeLinecap="round" />
                <circle r={5} fill="#FFFFFF" stroke="#141414" strokeWidth={2.5} />
              </g>
            </svg>

            <span
              ref={labelRef}
              className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-[7px] bg-canvas px-2 py-1 text-[11px] font-medium leading-4 text-ink-strong shadow-[var(--shadow-chip)]"
            >
              Let go here
            </span>

            <span className="pointer-events-none absolute left-3 top-3 inline-flex h-7 items-center rounded-chip bg-canvas px-2.5 text-[12px] font-medium leading-4 text-ink-strong shadow-[var(--shadow-chip)]">
              <span className="num">
                Stop {p.index + 1} of {p.stops.length}
              </span>
            </span>
            {animated && !released ? (
              <span className="pointer-events-none absolute right-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-chip bg-[image:var(--tile-solid)] px-2.5 text-[12px] font-medium leading-4 text-on-tile shadow-[var(--shadow-tile)]">
                <span className="pointer-fine:hidden">Tap to let go</span>
                <span className="hidden pointer-fine:inline">Space to let go</span>
              </span>
            ) : null}

            {/* Where you're headed: the flight lands here. */}
            <div className="pointer-events-none absolute bottom-3 right-3 flex max-w-[calc(100%-24px)] items-center gap-2.5 rounded-[14px] bg-canvas p-1.5 pr-3 shadow-[var(--shadow-float)]">
              <MiniAvatar id={who} className="size-9 rounded-[10px]" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[11px] leading-4 text-ink-subtle">Swinging to</span>
                <span className="truncate text-[13px] font-medium leading-4 text-ink-strong">{district}</span>
              </span>
            </div>

            <div ref={heroRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ opacity: 0 }}>
              <HeroTile suit={save.hero.suit} className="size-full rounded-[16px]" />
            </div>

            {graded && GradeIcon ? (
              <div className="pointer-events-none absolute inset-x-0 top-[22%] flex justify-center">
                <span
                  className={`animate-seal inline-flex h-12 items-center gap-2 rounded-[14px] border-2 border-ink-strong px-4 font-display text-[22px] font-medium tracking-[-0.02em] shadow-[var(--shadow-float)] ${
                    released === "miss" ? "bg-canvas text-ink-strong" : released === "perfect" ? "bg-accent text-on-accent" : "bg-canvas text-ink-strong"
                  }`}
                >
                  <GradeIcon className="size-5" strokeWidth={2.2} />
                  {graded.title}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* What's next and how to play. */}
        <div className="flex flex-col gap-5 px-3 pb-3 pt-4 sm:px-4 lg:py-5">
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-1.5 text-[13px] leading-5 text-ink-subtle">
              <MapPin aria-hidden className="size-4" />
              {DISTRICTS[stop.district].blurb}
            </p>
            <h2 id="swing-title" className="font-display text-[24px] font-medium leading-[30px] tracking-[-0.02em]">
              <span className="text-ink-faint">Swing to</span> <span className="text-ink-strong">{district}</span>
            </h2>
          </div>

          <div className="flex items-center gap-3 rounded-card bg-surface p-2.5">
            <MiniAvatar id={who} className="size-11 rounded-[12px]" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[14px] font-medium leading-5 text-ink-strong">{stopName(stop)}</span>
              <span className="text-[12px] leading-4 text-ink-subtle">
                {stop.kind === "fight" ? (stop.quest ? `${stopWhat(stop)} · tonight’s quest` : stopWhat(stop)) : stopWhat(stop)}
              </span>
            </div>
          </div>

          {animated ? (
            <>
              <div className="flex flex-col gap-3">
                <p className="text-[14px] leading-[22px] text-ink">
                  Let go while you’re over the red arc. Press{" "}
                  <kbd className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-sans text-[12px] font-medium text-ink-strong">Space</kbd> or{" "}
                  <kbd className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-sans text-[12px] font-medium text-ink-strong">Enter</kbd>, tap the city
                  or use the button.
                </p>
                <ul aria-label="Grades" className="flex flex-col gap-1.5 text-[13px] leading-5">
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full border-2 border-ink-strong bg-accent" />
                    <span className="font-medium text-ink-strong">Perfect</span>
                    <span className="text-ink-subtle">+{SWING.perfect.xp} XP, combo +1</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full border-2 border-ink-strong bg-white" />
                    <span className="font-medium text-ink-strong">Good</span>
                    <span className="text-ink-subtle">+{SWING.good.xp} XP, combo holds</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden className="h-0 w-6 shrink-0 border-t-2 border-dashed border-ink-subtle" />
                    <span className="font-medium text-ink-strong">Miss</span>
                    <span className="text-ink-subtle">−{Math.abs(SWING.miss.hp)} health, combo resets</span>
                  </li>
                </ul>
                {p.combo > 0 ? (
                  <p className="text-[12px] leading-4 text-ink-subtle">Each combo swings a little faster.</p>
                ) : null}
              </div>
              <Button
                type="button"
                size="lg"
                data-swing-release=""
                aria-disabled={released ? true : undefined}
                onPointerDown={press}
                onClick={tap}
                onKeyDown={(e: ReactKeyboardEvent) => {
                  // Handled on keydown by the window listener, so the timing is exact.
                  if (e.key === " " || e.key === "Enter") e.preventDefault();
                }}
                className="mt-auto w-full"
              >
                {released ? "Landing…" : "Let go"}
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2 rounded-card border border-hairline p-3.5 text-[14px] leading-[22px] text-ink">
                <p>
                  Reduced motion is on, so the swing doesn’t animate. Swinging now lands a{" "}
                  <span className="font-medium text-ink-strong">good swing</span>: +{SWING.good.xp} XP, and your combo of{" "}
                  <span className="num">{p.combo}</span> holds.
                </p>
                <p className="text-[13px] leading-5 text-ink-subtle">Perfect swings and combos need the timed swing.</p>
              </div>
              <div className="mt-auto flex flex-col gap-2">
                <Button type="button" size="lg" className="w-full" onClick={() => onDone("good")}>
                  Swing to {district}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setTimedAnyway(true)}>
                  Play the timed swing
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
