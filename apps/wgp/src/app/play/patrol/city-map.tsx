"use client";

/**
 * The full city map (M, the minimap, or the pause sheet): the whole city north up, every
 * stop of the night as its sticker with its number, done ones checked (or crossed, for a
 * knockout), the next one ringed, the route through them, pickups and where you are. The
 * list beside it says the same in words. The night is paused while it's open; Esc or M
 * closes it (the page's controls handle both keys).
 */
import { useEffect, useId, useRef } from "react";

import type { SuitColors } from "@/components/cast";
import { StickerEyebrow, StickerIconButton, StickerPanel } from "@/components/game/kit";
import { Check, X } from "@/components/icons";
import { chapterOf } from "@/game3d/nav/chapter-pins";
import { drawFullMap } from "@/game3d/nav/draw";
import { compass, fitCity, metres, stopPoint, toMap } from "@/game3d/nav/map";
import { Chip, Face, HeroFace, Kbd } from "@/sim/ui/bits";
import { stopCast } from "@/sim/ui/hud";
import { ALLY_CAST, DISTRICTS, VILLAINS } from "@wgp/game-core/data";
import { castById } from "@wgp/game-core/cast";
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";
import type { Stop, StopResult } from "@wgp/game-core/types";

import { ChapterMapList, ChapterPinsLayer, chapterWhere } from "./chapter-map";

/** Padding around the city, as a share of the map's side. */
const PAD = 0.035;

export function stopName(stop: Stop): string {
  return stop.kind === "fight" ? VILLAINS[stop.villain].name : `${castById(ALLY_CAST[stop.ally]).name}’s errand`;
}

type Status = "won" | "lost" | "done" | "next" | "ahead";

function statusOf(i: number, current: number, r: StopResult | undefined): Status {
  if (r) return r.kind === "fight" ? (r.outcome === "won" ? "won" : "lost") : "done";
  return i === current ? "next" : i < current ? "done" : "ahead";
}

const STATUS_WORD: Record<Status, string> = { won: "Caught", lost: "Knocked out", done: "Done", next: "Next", ahead: "Later" };

export interface CityMapProps {
  city: City;
  stops: Stop[];
  results: StopResult[];
  /** The loop's view (read once when the map opens and on resize; the night is paused). */
  frame: RenderFrame3D;
  hero: SuitColors;
  northUp: boolean;
  onNorthUp(next: boolean): void;
  onClose(): void;
  /** No pulse on the next stop. */
  still: boolean;
  touch: boolean;
}

export function CityMap({ city, stops, results, frame, hero, northUp, onNorthUp, onClose, still, touch }: CityMapProps) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const current = Math.min(frame.stop, stops.length);

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(([entry]) => {
      const s = Math.round(entry.contentRect.width);
      if (!s) return;
      el.width = el.height = Math.round(s * dpr);
      drawFullMap(ctx, { city, frame, view: fitCity(city.bounds, s, s, s * PAD), width: s, height: s, dpr, heroColor: hero.suit });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [city, frame, hero.suit]);

  // Stop stickers sit over the canvas at the same spots, as shares of its side.
  const unit = fitCity(city.bounds, 1, 1, PAD);
  const h = frame.hero.pos;
  const next = city.zones[current];
  const togo = next && frame.mode === "travel" ? stopPoint(next) : null;
  // A case night: its clues and the bridge on the map, and its case file beside it.
  const chapter = chapterOf(frame);
  const where = chapter
    ? chapterWhere(chapter, city, h)
    : togo
      ? `${stopName(stops[current])} is ${metres(Math.hypot(togo.x - h.x, togo.z - h.z))} m ${compass(togo.x - h.x, togo.z - h.z)} of you.`
      : null;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-game-night/70 p-3 sm:p-4">
      <StickerPanel
        as="section"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={where ? `${id}-where` : undefined}
        className="animate-rise flex max-h-[calc(100dvh-24px)] w-full max-w-[920px] flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <StickerEyebrow>
              <span className="num">{chapter ? "Case file 001" : current < stops.length ? `Stop ${current + 1} of ${stops.length}` : "Route done"}</span>
            </StickerEyebrow>
            <h2 id={`${id}-title`} className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-game-ink">
              City map
            </h2>
            {where ? (
              <p id={`${id}-where`} className="text-[14px] leading-5 text-game-muted">
                {where}
              </p>
            ) : null}
          </div>
          <StickerIconButton ref={close} label="Close the map" onClick={onClose} aria-keyshortcuts="Escape M">
            <X aria-hidden strokeWidth={2.25} />
          </StickerIconButton>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="relative mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-220px),560px)] shrink-0 overflow-hidden rounded-[18px] border-[2.5px] border-game-ink bg-game-paper-2 md:w-[min(56vw,calc(100dvh-200px),560px)]">
            <canvas ref={canvas} aria-hidden className="absolute inset-0 block size-full" />
            <ol aria-hidden className="contents">
              {(chapter ? [] : stops).map((stop, i) => {
                const p = toMap(unit, stopPoint(city.zones[i]).x, stopPoint(city.zones[i]).z);
                const s = statusOf(i, current, results[i]);
                return (
                  <li key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>
                    <span className="relative block">
                      {s === "next" ? <span className={`absolute -inset-1.5 rounded-[34%] border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} /> : null}
                      <Face id={stopCast(stop)} className={`size-8 ring-2 ring-game-ink sm:size-10 ${s === "ahead" ? "opacity-70" : ""}`} />
                      <span className="num absolute -left-2 -top-2 grid size-5 place-items-center rounded-full border-2 border-white bg-game-ink text-[11px] font-bold leading-none text-game-paper">
                        {i + 1}
                      </span>
                      {s === "won" || s === "done" || s === "lost" ? (
                        <span
                          className={`absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full border-2 border-game-ink ${s === "lost" ? "bg-game-hero text-white" : "bg-game-mint text-game-ink"}`}
                        >
                          {s === "lost" ? <X className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            {chapter ? <ChapterPinsLayer chapter={chapter} city={city} unit={unit} still={still} /> : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {chapter ? <ChapterMapList chapter={chapter} /> : null}
            <ol aria-label="Tonight’s stops" className={`flex flex-col gap-2 ${stops.length && !chapter ? "" : "hidden"}`}>
              {stops.map((stop, i) => {
                const s = statusOf(i, current, results[i]);
                return (
                  <li
                    key={i}
                    aria-current={s === "next" ? "step" : undefined}
                    className={`flex items-center gap-3 rounded-[14px] border-2 px-2.5 py-2 ${s === "next" ? "border-game-ink bg-game-paper" : "border-transparent bg-game-paper-2"}`}
                  >
                    <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-game-ink text-[12px] font-bold text-game-paper">{i + 1}</span>
                    <Face id={stopCast(stop)} className="size-9" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[14px] font-semibold leading-5 text-pretty">
                        {stopName(stop)}
                        {stop.kind === "fight" && stop.boss ? ", boss" : ""}
                      </span>
                      <span className="text-[12px] leading-4 text-game-muted">{DISTRICTS[stop.district].name}</span>
                    </span>
                    <Chip size="xs" flat tone={s === "next" ? "hero" : s === "won" || s === "done" ? "mint" : s === "lost" ? "paper" : "muted"}>
                      {s === "won" || s === "done" ? <Check aria-hidden className="size-3" strokeWidth={3} /> : s === "lost" ? <X aria-hidden className="size-3" strokeWidth={3} /> : null}
                      {STATUS_WORD[s]}
                    </Chip>
                  </li>
                );
              })}
            </ol>
            <p className="flex items-center gap-2 text-[13px] leading-5 text-game-muted">
              <HeroFace colors={hero} className="size-6 rounded-full" />
              {chapter ? "The arrow is you; the pins are the case’s." : "The arrow is you; the dots lead to the next stop."}
            </p>
            <label htmlFor={`${id}-n`} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t-2 border-dashed border-game-ink/30 pt-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-bold leading-4">Keep north up</span>
                <span className="text-[12px] leading-4 text-game-muted">Otherwise the minimap turns with the camera.</span>
              </span>
              <input id={`${id}-n`} type="checkbox" role="switch" checked={northUp} onChange={(e) => onNorthUp(e.currentTarget.checked)} className="peer sr-only" />
              <span
                aria-hidden
                className="relative h-7 w-12 shrink-0 rounded-full border-2 border-game-ink bg-game-paper peer-checked:bg-game-mint peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-game-hero motion-safe:transition-[background-color] motion-safe:duration-150 after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border-2 after:border-game-ink after:bg-game-paper after:content-[''] motion-safe:after:transition-[translate] motion-safe:after:duration-150 peer-checked:after:translate-x-5"
              />
            </label>
            {touch ? null : (
              <p aria-hidden className="hidden items-center gap-1.5 text-[12px] leading-4 text-game-muted pointer-fine:flex">
                <Kbd>M</Kbd>
                <span>or</span>
                <Kbd>Esc</Kbd>
                <span>closes the map.</span>
              </p>
            )}
          </div>
        </div>
      </StickerPanel>
    </div>
  );
}
