"use client";

/**
 * Waypoint guidance over the 3D view while swinging to a stop:
 *
 * - On screen: a sticker pin above the stop with the villain's (or, on an errand, the
 *   ally's) face, ringed, with the distance. It's drawn over the canvas, so buildings never
 *   hide it.
 * - Off screen or behind: an arrow on the edge of the safe box pointing the way, the face
 *   in it and the distance beside it.
 * - Hidden once you're in the arena (the HUD shows the villain's health there), on an
 *   errand and at the end of the night.
 *
 * Placed every frame from the frame tap (after the camera moves, so it doesn't lag the
 * picture) by writing a transform; React renders it only when the stop changes.
 */
import { useEffect, useRef } from "react";

import { metres, stopPoint } from "@/game3d/nav/map";
import type { FrameTap } from "@/game3d/nav/tap";
import { edgePoint, inBox, project, waypointLayout, waypointLayoutFromHud, type HudZones, type Rect } from "@/game3d/nav/waypoint";
import { Face } from "@/sim/ui/bits";
import { stopCast } from "@/sim/ui/hud";
import type { City, Vec3 } from "@wgp/game-core/sim3d/contract";
import type { Stop } from "@wgp/game-core/types";

/** The pin floats this far above the stop's point (world units; the hero is 88 tall). */
const LIFT = 150;
/** The distance chip sits this far from the arrow's centre, toward the middle of the screen. */
const CHIP_OFFSET = 50;

/** The pins' pulse, only for people who haven't asked for less motion. */
const NAV_CSS = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes wgp-ping { 0% { opacity: 0.95; scale: 1; } 80%, 100% { opacity: 0; scale: 1.55; } }
  .wgp-ping { animation: wgp-ping 1.4s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
}
`;

export function NavStyles() {
  return (
    <style href="wgp-nav" precedence="medium">
      {NAV_CSS}
    </style>
  );
}

/**
 * The touch HUD's zones (sim/ui/hud.tsx marks them `data-hud-zone`) and the safe area (read
 * off a probe padded with env(safe-area-inset-*)), in the canvas's CSS px; null when there's
 * no touch HUD on the page.
 */
function measureHud(el: HTMLElement, probe: HTMLElement | null): HudZones | null {
  const scope = el.closest("[data-night]") ?? el.ownerDocument;
  const band: Rect[] = [];
  const avoid: Rect[] = [];
  scope.querySelectorAll<HTMLElement>("[data-hud-zone]").forEach((zone) => {
    const r = zone.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    (zone.dataset.hudZone === "band" ? band : avoid).push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  });
  if (!band.length) return null;
  const s = probe ? getComputedStyle(probe) : null;
  const px = (v: string | undefined) => Number.parseFloat(v ?? "") || 0;
  return { band, avoid, safe: { top: px(s?.paddingTop), right: px(s?.paddingRight), bottom: px(s?.paddingBottom), left: px(s?.paddingLeft) } };
}

export interface WaypointProps {
  tap: FrameTap;
  city: City;
  stops: Stop[];
  /** The stop being travelled to (the HUD's index). */
  index: number;
  /** No pulse. */
  still: boolean;
  touch: boolean;
}

export function Waypoint({ tap, city, stops, index, still, touch }: WaypointProps) {
  const root = useRef<HTMLDivElement>(null);
  const wedge = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const pinDist = useRef<HTMLSpanElement>(null);
  const arrowDist = useRef<HTMLSpanElement>(null);
  const safe = useRef<HTMLSpanElement>(null);
  const isTouch = useRef(touch);
  useEffect(() => {
    isTouch.current = touch;
  }, [touch]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let shown = false;
    let mode = "";
    let lastM = -1;
    const at: Vec3 = { x: 0, y: 0, z: 0 };
    let layout = waypointLayout(0, 0, false);
    let layoutKey = "";
    let measuredAt = -Infinity;
    let lastPlace = "";
    let lastTurn = "";
    const off = tap.on((t) => {
      const f = t.frame;
      const zone = city.zones[f.stop];
      const show = !!zone && !!t.pose && f.mode === "travel";
      if (show !== shown) {
        shown = show;
        el.style.visibility = show ? "visible" : "hidden";
      }
      if (!show || !t.pose) return;
      const p = stopPoint(zone);
      at.x = p.x;
      at.y = p.y + LIFT;
      at.z = p.z;
      const pr = project(at, t.pose, t.width, t.height);
      const key = `${t.width}x${t.height}${isTouch.current ? "t" : ""}`;
      // The touch HUD moves with the phone's orientation and the night (the hint goes, a
      // fight swaps the minimap for the villain bar): measure it twice a second.
      if (key !== layoutKey || (isTouch.current && t.time - measuredAt > 0.5)) {
        layoutKey = key;
        measuredAt = t.time;
        const zones = isTouch.current ? measureHud(el, safe.current) : null;
        layout = zones ? waypointLayoutFromHud(t.width, t.height, zones) : waypointLayout(t.width, t.height, isTouch.current);
      }
      let x: number;
      let y: number;
      let next: "pin" | "arrow";
      if (inBox(pr, t.width, t.height, layout.pin, layout.avoidPin)) {
        x = pr.x;
        y = pr.y;
        next = "pin";
      } else {
        const e = edgePoint(pr, t.width, t.height, layout.arrow, layout.avoid);
        x = e.x;
        y = e.y;
        next = "arrow";
        // A hundredth of a radian is under a pixel at the wedge's tip: skip smaller turns.
        const turn = e.angle.toFixed(2);
        if (turn !== lastTurn) {
          lastTurn = turn;
          if (wedge.current) wedge.current.style.transform = `rotate(${turn}rad)`;
          if (chip.current) chip.current.style.transform = `translate3d(${(-Math.cos(e.angle) * CHIP_OFFSET).toFixed(1)}px, ${(-Math.sin(e.angle) * CHIP_OFFSET).toFixed(1)}px, 0)`;
        }
      }
      if (next !== mode) {
        mode = next;
        el.dataset.mode = next;
      }
      // Half-pixel steps: a stop holding still on screen writes nothing.
      const place = `translate3d(${(Math.round(x * 2) / 2).toFixed(1)}px, ${(Math.round(y * 2) / 2).toFixed(1)}px, 0)`;
      if (place !== lastPlace) {
        lastPlace = place;
        el.style.transform = place;
      }
      const h = f.hero.pos;
      const m = metres(Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z));
      if (m !== lastM) {
        lastM = m;
        const text = `${m} m`;
        if (pinDist.current) pinDist.current.textContent = text;
        if (arrowDist.current) arrowDist.current.textContent = text;
      }
    });
    return () => {
      off();
      el.style.visibility = "hidden";
    };
  }, [tap, city]);

  const stop = stops[Math.min(index, stops.length - 1)];
  if (!stop) return null;
  const cast = stopCast(stop);
  const ring = stop.kind === "fight" ? "border-game-hero" : "border-game-gold";
  return (
    <div ref={root} aria-hidden data-mode="pin" className="group pointer-events-none invisible absolute left-0 top-0 z-0 will-change-transform">
      <NavStyles />
      <span ref={safe} className="invisible absolute size-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]" />
      {/* The pin: its tip on the point. */}
      <div className="absolute bottom-0 left-0 flex -translate-x-1/2 flex-col items-center group-data-[mode=arrow]:hidden">
        <span
          ref={pinDist}
          className="num mb-1.5 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper px-2 text-[12px] font-bold leading-5 text-game-ink shadow-[var(--game-shadow-sm)]"
        />
        <span className="relative">
          <span className={`absolute -inset-1.5 rounded-[34%] border-[3px] ${ring} ${still ? "" : "wgp-ping"}`} />
          <Face id={cast} className="size-11 border-[3px] ring-2 ring-game-ink" />
        </span>
        <svg width="16" height="12" viewBox="0 0 16 12" className="-mt-px block">
          <path d="M1.5 1.5 L8 10.5 L14.5 1.5 Z" fill="var(--game-paper)" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </div>
      {/* The edge arrow: centred on its point, the wedge turned toward the stop. */}
      <div className="absolute left-0 top-0 group-data-[mode=pin]:hidden">
        <span ref={wedge} className="absolute left-0 top-0 block size-0 will-change-transform">
          <svg width="22" height="26" viewBox="0 0 22 26" className="absolute left-[22px] top-[-13px] block">
            <path d="M2 2 L20 13 L2 24 Z" fill={stop.kind === "fight" ? "var(--game-hero)" : "var(--game-gold)"} stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="absolute left-0 top-0 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)]">
          <Face id={cast} className="size-9 rounded-full" />
        </span>
        <span ref={chip} className="absolute left-0 top-0 block size-0 will-change-transform">
          <span
            ref={arrowDist}
            className="num absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper px-2 text-[12px] font-bold leading-5 text-game-ink shadow-[var(--game-shadow-sm)]"
          />
        </span>
      </div>
    </div>
  );
}
