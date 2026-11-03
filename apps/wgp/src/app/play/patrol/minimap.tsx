"use client";

/**
 * The minimap: a round paper sticker of the city around the hero, turning with the camera
 * (or north up), with the route dotted through the stops still ahead, the next stop's
 * sticker ringed (and pulsing, unless motion is reduced), pickups as dots and the hero as
 * an arrow. One canvas, redrawn about 18 times a second from the frame tap; React renders
 * it once per stop, never per frame. Pressing it (or M) opens the full city map.
 */
import { useCallback, useEffect, useRef } from "react";

import { AVATARS } from "@/components/cast";
import { Compass } from "@/components/icons";
import { drawMinimap, stickerBitmap } from "@/game3d/nav/draw";
import { headingUpRotation } from "@/game3d/nav/map";
import { throttled, type FrameTap } from "@/game3d/nav/tap";
import { Kbd } from "@/sim/ui/bits";
import { stopCast } from "@/sim/ui/hud";
import type { CastId } from "@wgp/game-core/cast";
import type { City } from "@wgp/game-core/sim3d/contract";
import type { Stop } from "@wgp/game-core/types";

/** How far the minimap sees: about two blocks each way. */
const RADIUS_UNITS = 1400;
const REDRAW_HZ = 18;
const PULSE_SECONDS = 1.4;

/**
 * The cast's faces as canvas stickers. The faces are the HUD's SVG art: rendered once,
 * hidden, then serialized and rasterized. `holder` must be rendered; `get` is null until
 * a face has loaded.
 */
function useStickerBitmaps(ids: readonly CastId[], px: number) {
  const holder = useRef<HTMLDivElement>(null);
  const bitmaps = useRef(new Map<CastId, HTMLCanvasElement>());
  const key = ids.join(",");
  useEffect(() => {
    const root = holder.current;
    if (!root) return;
    let live = true;
    const serializer = new XMLSerializer();
    for (const el of root.querySelectorAll<HTMLElement>("[data-cast]")) {
      const id = el.dataset.cast as CastId;
      const svg = el.querySelector("svg");
      if (!svg || bitmaps.current.has(id)) continue;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", "120");
      clone.setAttribute("height", "120");
      clone.removeAttribute("class");
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializer.serializeToString(clone))}`;
      img
        .decode()
        .then(() => {
          if (live) bitmaps.current.set(id, stickerBitmap(img, px));
        })
        .catch(() => {
          // The plain disc stays.
        });
    }
    return () => {
      live = false;
    };
  }, [key, px]);
  const get = useCallback((id: CastId) => bitmaps.current.get(id) ?? null, []);
  return {
    get,
    holder: (
      <div ref={holder} hidden>
        {ids.map((id) => {
          const Art = AVATARS[id];
          return (
            <span key={id} data-cast={id}>
              <Art />
            </span>
          );
        })}
      </div>
    ),
  };
}

export interface MinimapProps {
  tap: FrameTap;
  city: City;
  stops: Stop[];
  /** The hero's arrow fill (the suit colour). */
  heroColor: string;
  northUp: boolean;
  onNorthUp(next: boolean): void;
  /** Open the full city map. */
  onOpen(): void;
  /** No pulse (the steady camera, or reduced motion). */
  still: boolean;
  /** Touch layout: smaller, and the north-up switch lives in the full map. */
  touch: boolean;
  /** The next stop, for the button's name ("Gas Goblin", "Aunt Mainnet’s errand"). */
  nextLabel: string | null;
  /** Hidden below md for now (a phone in a fight, where the villain bar takes its place): skip drawing there. */
  hidden?: boolean;
}

export function Minimap({ tap, city, stops, heroColor, northUp, onNorthUp, onOpen, still, touch, nextLabel, hidden = false }: MinimapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef(0);
  const ids = [...new Set(stops.map(stopCast))];
  const stickers = useStickerBitmaps(ids, 64);
  const get = stickers.get;

  // The latest props for the draw loop, without re-subscribing it.
  const live = useRef({ northUp, still, heroColor, hidden });
  useEffect(() => {
    live.current = { northUp, still, heroColor, hidden };
  }, [northUp, still, heroColor, hidden]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(([entry]) => {
      const s = Math.round(entry.contentRect.width);
      if (s === size.current) return;
      size.current = s;
      el.width = el.height = Math.round(s * dpr);
    });
    ro.observe(el);
    const off = tap.on(
      throttled(REDRAW_HZ, (t) => {
        const p = live.current;
        // Hidden under md (a phone's fight): nothing to draw.
        if ((p.hidden && t.width < 768) || !size.current) return;
        const pose = t.pose;
        const rotation = p.northUp || !pose ? 0 : headingUpRotation(pose.target.x - pose.position.x, pose.target.z - pose.position.z);
        drawMinimap(ctx, {
          city,
          frame: t.frame,
          size: size.current,
          dpr,
          rotation,
          radiusUnits: RADIUS_UNITS,
          sticker: (i) => (stops[i] ? get(stopCast(stops[i])) : null),
          heroColor: p.heroColor,
          pulse: p.still ? null : (t.time % PULSE_SECONDS) / PULSE_SECONDS,
        });
      }),
    );
    return () => {
      off();
      ro.disconnect();
    };
  }, [tap, city, stops, get]);

  const label = `Open the city map${nextLabel ? `. Next stop: ${nextLabel}` : ""}`;
  return (
    <div className={`relative ${touch ? "[--map:112px] md:[--map:152px]" : "[--map:176px]"}`}>
      {stickers.holder}
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        aria-keyshortcuts="M"
        className="block rounded-full border-[2.5px] border-game-ink bg-white p-[3px] shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)]"
      >
        <canvas ref={canvas} className="block size-[var(--map)] rounded-full" />
      </button>
      {touch ? null : (
        <>
          <button
            type="button"
            onClick={() => onNorthUp(!northUp)}
            aria-pressed={northUp}
            aria-label="Keep north up"
            title={northUp ? "North stays up" : "The map turns with the camera"}
            className={`absolute -right-2 -top-2 grid size-11 place-items-center rounded-full border-[2.5px] border-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow,background-color] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none ${
              northUp ? "bg-game-ink text-game-paper" : "bg-game-paper text-game-ink pointer-fine:hover:bg-game-paper-2"
            }`}
          >
            <Compass aria-hidden className="size-5" strokeWidth={2} />
          </button>
          <Kbd className="absolute bottom-1 right-1">M</Kbd>
        </>
      )}
    </div>
  );
}
