"use client";

/**
 * The City's minimap: a round paper sticker of the streets round the hero (two blocks each
 * way), turning with the camera (or north up, the night's setting), with the same pins as the
 * big map, the tracked task's next step ringed (on the rim with a wedge while it's further
 * out) and you as an arrow in the middle. One canvas, redrawn about 18 times a second from the
 * frame tap; React renders it only when the tracked task changes. It's the map button too:
 * pressing it (or M) opens the city map.
 *
 * On a phone it sits top right under the pause button, clear of the tracker and the thumbs'
 * buttons: bigger on its side (the screen's short, so the corner's free) than upright.
 */
import { useEffect, useRef } from "react";

import { headingUpRotation } from "@/game3d/nav/map";
import { drawRoamMinimap } from "@/game3d/nav/roam-draw";
import { roamPins, taskTarget } from "@/game3d/nav/roam-pins";
import { throttled, type FrameTap } from "@/game3d/nav/tap";
import { Kbd } from "@/sim/ui/bits";
import type { TaskId } from "@wgp/game-core/city";
import type { City } from "@wgp/game-core/sim3d/contract";
import { roamWorld } from "@wgp/game-core/sim3d/roam";

/** How far the minimap sees: about two blocks each way. */
export const MINIMAP_RADIUS = 1500;
const REDRAW_HZ = 18;
const PULSE_SECONDS = 1.4;

export interface CityMinimapProps {
  tap: FrameTap;
  city: City;
  heroColor: string;
  tracked: TaskId | null;
  /** The tracked task's title, for the button's name. */
  trackedTitle: string | null;
  northUp: boolean;
  /** No pulse (the Steady camera, or reduced motion). */
  still: boolean;
  touch: boolean;
  onOpen(): void;
}

export function CityMinimap({ tap, city, heroColor, tracked, trackedTitle, northUp, still, touch, onOpen }: CityMinimapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef(0);
  // The latest props for the draw loop, without re-subscribing it.
  const live = useRef({ heroColor, tracked, northUp, still });
  useEffect(() => {
    live.current = { heroColor, tracked, northUp, still };
  }, [heroColor, tracked, northUp, still]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(([entry]) => {
      const s = Math.round(entry.contentRect.width);
      if (s === size.current) return;
      size.current = s;
      el.width = el.height = Math.round(s * dpr);
    });
    ro.observe(el);
    const w = roamWorld();
    const off = tap.on(
      throttled(REDRAW_HZ, (t) => {
        const roam = t.frame.roam;
        if (!roam || !size.current) return;
        const p = live.current;
        const pose = t.pose;
        const rotation = p.northUp || !pose ? 0 : headingUpRotation(pose.target.x - pose.position.x, pose.target.z - pose.position.z);
        drawRoamMinimap(ctx, {
          city,
          frame: t.frame,
          pins: roamPins(roam, w, p.tracked),
          target: p.tracked ? taskTarget(p.tracked, roam, t.frame.hero.pos, w) : null,
          size: size.current,
          dpr,
          rotation,
          radiusUnits: MINIMAP_RADIUS,
          heroColor: p.heroColor,
          pulse: p.still ? null : (t.time % PULSE_SECONDS) / PULSE_SECONDS,
        });
      }),
    );
    return () => {
      off();
      ro.disconnect();
    };
  }, [tap, city]);

  return (
    <div className={`pointer-events-auto relative ${touch ? "[--map:112px] short:[--map:132px] md:[--map:156px]" : "[--map:184px]"}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the city map${trackedTitle ? `. Tracking: ${trackedTitle}` : ""}`}
        aria-keyshortcuts="M"
        className="block touch-none select-none rounded-full border-[2.5px] border-game-ink bg-white p-[3px] shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)]"
      >
        <canvas ref={canvas} className="block size-[var(--map)] rounded-full" />
      </button>
      {touch ? null : <Kbd className="absolute bottom-1 right-1">M</Kbd>}
    </div>
  );
}
