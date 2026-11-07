"use client";

/**
 * The City's waypoint over the 3D view: where the tracked task's next step is (its giver, the
 * person to hand it in to, the bot, the nearest pixel or tag, or the task's own `next` mark: a
 * race gate, a relay; game3d/nav/roam-pins.ts taskTarget).
 *
 * - On screen: a paper pin above it with the distance, ringed (pulsing unless motion is
 *   reduced), drawn over the canvas so buildings never hide it.
 * - Off screen or behind: an arrow on the edge of the safe box pointing the way, the distance
 *   beside it, clear of the HUD (its panels and buttons are measured: `data-hud-zone`).
 * - Nothing tracked, or the task done: hidden.
 *
 * Placed every frame from the frame tap (after the camera moves) by writing a transform; React
 * renders it only when the tracked task changes.
 */
import { useEffect, useRef } from "react";

import { Plug, Target } from "@/components/icons";
import { NAV_COLORS as K } from "@/game3d/nav/colors";
import { metres } from "@/game3d/nav/map";
import { taskTarget, type TargetKind } from "@/game3d/nav/roam-pins";
import type { FrameTap } from "@/game3d/nav/tap";
import { edgePoint, inBox, project, waypointLayout, waypointLayoutFromHud, type HudZones, type Rect } from "@/game3d/nav/waypoint";
import type { TaskId } from "@wgp/game-core/city";
import type { Vec3 } from "@wgp/game-core/sim3d/contract";
import { roamWorld } from "@wgp/game-core/sim3d/roam";

import { NavStyles } from "../patrol/waypoint";

/** The pin floats this far above the point (world units; the hero is 88 tall). */
const LIFT = 130;
/** The distance chip sits this far from the arrow's centre, toward the middle of the screen. */
const CHIP_OFFSET = 50;
/** The HUD's boxes grow by this much (most of the arrow's 24 px radius; the layout adds 8 px of air), so the arrow never sits half over a button. */
const ARROW_CLEAR = 18;

/** The City HUD's boxes (`data-hud-zone`) and the safe area, in the canvas's CSS px. */
function measureHud(el: HTMLElement, probe: HTMLElement | null): HudZones {
  const scope = el.closest("[data-city]") ?? el.ownerDocument;
  const band: Rect[] = [];
  const avoid: Rect[] = [];
  scope.querySelectorAll<HTMLElement>("[data-hud-zone]").forEach((zone) => {
    const r = zone.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (zone.dataset.hudZone === "band") band.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    else avoid.push({ x0: r.left - ARROW_CLEAR, y0: r.top - ARROW_CLEAR, x1: r.right + ARROW_CLEAR, y1: r.bottom + ARROW_CLEAR });
  });
  const s = probe ? getComputedStyle(probe) : null;
  const px = (v: string | undefined) => Number.parseFloat(v ?? "") || 0;
  return { band, avoid, safe: { top: px(s?.paddingTop), right: px(s?.paddingRight), bottom: px(s?.paddingBottom), left: px(s?.paddingLeft) } };
}

export interface CityWaypointProps {
  tap: FrameTap;
  tracked: TaskId | null;
  still: boolean;
}

export function CityWaypoint({ tap, tracked, still }: CityWaypointProps) {
  const root = useRef<HTMLDivElement>(null);
  const wedge = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const pinDist = useRef<HTMLSpanElement>(null);
  const arrowDist = useRef<HTMLSpanElement>(null);
  const safe = useRef<HTMLSpanElement>(null);
  const live = useRef({ tracked });
  useEffect(() => {
    live.current = { tracked };
  }, [tracked]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const w = roamWorld();
    let shown = false;
    let mode = "";
    let kind = "";
    let lastM = -1;
    const at: Vec3 = { x: 0, y: 0, z: 0 };
    let layout = waypointLayout(0, 0, false);
    let layoutKey = "";
    let measuredAt = -Infinity;
    let lastPlace = "";
    let lastTurn = "";
    const off = tap.on((t) => {
      const roam = t.frame.roam;
      const id = live.current.tracked;
      const target = roam && id ? taskTarget(id, roam, t.frame.hero.pos, w) : null;
      const show = !!target && !!t.pose;
      if (show !== shown) {
        shown = show;
        el.style.visibility = show ? "visible" : "hidden";
      }
      if (!target || !t.pose) return;
      const k: TargetKind = target.kind;
      if (k !== kind) {
        kind = k;
        el.dataset.kind = k;
      }
      at.x = target.at.x;
      at.y = target.at.y + LIFT;
      at.z = target.at.z;
      const pr = project(at, t.pose, t.width, t.height);
      const key = `${t.width}x${t.height}`;
      // The HUD moves with the phone's orientation (and the tracker grows and shrinks): measure it twice a second.
      if (key !== layoutKey || t.time - measuredAt > 0.5) {
        layoutKey = key;
        measuredAt = t.time;
        layout = waypointLayoutFromHud(t.width, t.height, measureHud(el, safe.current));
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
      const place = `translate3d(${(Math.round(x * 2) / 2).toFixed(1)}px, ${(Math.round(y * 2) / 2).toFixed(1)}px, 0)`;
      if (place !== lastPlace) {
        lastPlace = place;
        el.style.transform = place;
      }
      const h = t.frame.hero.pos;
      const m = metres(Math.hypot(target.at.x - h.x, target.at.y - h.y, target.at.z - h.z));
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
  }, [tap]);

  // The mark in the pin: a target, a gate's hoop, a relay's plug.
  const mark = (big: boolean) => (
    <>
      <span className="grid place-items-center group-data-[kind=gate]:hidden group-data-[kind=relay]:hidden">
        <Target className={big ? "size-5" : "size-4"} strokeWidth={2.5} />
      </span>
      <span className="hidden place-items-center group-data-[kind=gate]:grid">
        <span className={`block rounded-full border-[3.5px] ${big ? "size-5" : "size-4"}`} style={{ borderColor: K.gate }} />
      </span>
      <span className="hidden place-items-center group-data-[kind=relay]:grid">
        <Plug className={big ? "size-5" : "size-4"} strokeWidth={2.5} />
      </span>
    </>
  );
  return (
    <div ref={root} aria-hidden data-mode="pin" data-kind="folk" className="group pointer-events-none invisible absolute left-0 top-0 z-0 will-change-transform">
      <NavStyles />
      <span ref={safe} className="invisible absolute size-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]" />
      {/* The pin: its tip on the point. */}
      <div className="absolute bottom-0 left-0 flex -translate-x-1/2 flex-col items-center group-data-[mode=arrow]:hidden">
        <span ref={pinDist} className="num mb-1.5 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper px-2 text-[12px] font-bold leading-5 text-game-ink shadow-[var(--game-shadow-sm)]" />
        <span className="relative">
          <span className={`absolute -inset-1.5 rounded-full border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} />
          <span className="grid size-11 place-items-center rounded-full border-[3px] border-game-ink bg-game-paper text-game-hero">{mark(true)}</span>
        </span>
        <svg width="16" height="12" viewBox="0 0 16 12" className="-mt-px block">
          <path d="M1.5 1.5 L8 10.5 L14.5 1.5 Z" fill="var(--game-paper)" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </div>
      {/* The edge arrow: centred on its point, the wedge turned toward the step. */}
      <div className="absolute left-0 top-0 group-data-[mode=pin]:hidden">
        <span ref={wedge} className="absolute left-0 top-0 block size-0 will-change-transform">
          <svg width="22" height="26" viewBox="0 0 22 26" className="absolute left-[22px] top-[-13px] block">
            <path d="M2 2 L20 13 L2 24 Z" className="fill-game-hero" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="absolute left-0 top-0 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[2.5px] border-game-ink bg-game-paper text-game-hero shadow-[var(--game-shadow-sm)]">{mark(false)}</span>
        <span ref={chip} className="absolute left-0 top-0 block size-0 will-change-transform">
          <span ref={arrowDist} className="num absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper px-2 text-[12px] font-bold leading-5 text-game-ink shadow-[var(--game-shadow-sm)]" />
        </span>
      </div>
    </div>
  );
}
