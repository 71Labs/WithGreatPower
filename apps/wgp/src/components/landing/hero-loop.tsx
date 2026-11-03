"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { StickerChip } from "@/components/game/kit";
import { Pause, Play } from "@/components/icons";
import { assetUrl } from "@/lib/assets";

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Poster only: the viewer asked for less motion, or for less data (Save-Data). */
const stillInBrowser = () =>
  window.matchMedia(REDUCE).matches || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
/** The server renders the poster alone; the clip only exists once the browser says it's wanted. */
const stillOnServer = () => true;

/**
 * The hero's gameplay clip in a die-cut sticker frame. The poster is the LCP image; the
 * clip loads after hydration, once the frame is near the viewport, plays muted and looped
 * only while on screen, and fades in over the poster on its first frame. With reduced
 * motion or Save-Data there is no clip at all, just the poster.
 */
export function HeroLoop() {
  const still = useSyncExternalStore(subscribe, stillInBrowser, stillOnServer);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [shown, setShown] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  // Load the clip when the frame comes near; play it only while it's on screen.
  useEffect(() => {
    const frame = frameRef.current;
    if (still || !frame) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) setNear(true);
        const video = videoRef.current;
        if (!video) return;
        if (entry.isIntersecting && !pausedRef.current) void video.play().catch(() => {});
        else video.pause();
      },
      { rootMargin: "160px 0px" },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [still, near]);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    if (next) video.pause();
    else void video.play().catch(() => {});
  }

  return (
    <figure className="relative w-full min-w-0">
      <div className="rounded-[28px] bg-white p-2 shadow-[0_6px_0_var(--game-ink)] ring-2 ring-game-ink">
        <div ref={frameRef} className="relative aspect-video overflow-hidden rounded-[20px] bg-game-night">
          <Image
            src="/media/hero-poster.webp"
            alt="The hero swings across the rooftops of the comic-book city at night, mid-combo, as a Perfect! release pops beside him."
            width={1280}
            height={720}
            sizes="(min-width: 1320px) 700px, (min-width: 1024px) 54vw, calc(100vw - 32px)"
            loading="eager"
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
          {!still && near ? (
            <video
              ref={videoRef}
              aria-hidden
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              onPlaying={() => setShown(true)}
              className={`absolute inset-0 size-full object-cover motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-out ${shown ? "opacity-100" : "opacity-0"}`}
            >
              <source src={assetUrl("/media/hero-loop.webm")} type='video/webm; codecs="vp9"' />
              <source src={assetUrl("/media/hero-loop.mp4")} type="video/mp4" />
            </video>
          ) : null}
        </div>
      </div>

      <StickerChip className="absolute -left-1.5 -top-3.5 -rotate-3 sm:-left-3">
        <span aria-hidden className="size-2 rounded-full bg-game-hero" />
        Real gameplay
      </StickerChip>

      {!still && shown ? (
        <button
          type="button"
          onClick={toggle}
          className="absolute -bottom-4 right-4 inline-flex h-9 items-center gap-1.5 rounded-full border-2 border-game-ink bg-game-paper pl-2.5 pr-3.5 text-[13px] font-semibold leading-none text-game-ink shadow-[var(--game-shadow-sm)] motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-coarse:h-11 pointer-fine:hover:bg-game-paper-2"
        >
          <span aria-hidden className="grid size-4 place-items-center">
            <Pause
              strokeWidth={2.25}
              className={`col-start-1 row-start-1 size-4 motion-safe:transition-[opacity,scale,filter] motion-safe:duration-200 motion-safe:ease-out ${paused ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-[0px]"}`}
            />
            <Play
              strokeWidth={2.25}
              className={`col-start-1 row-start-1 size-4 motion-safe:transition-[opacity,scale,filter] motion-safe:duration-200 motion-safe:ease-out ${paused ? "scale-100 opacity-100 blur-[0px]" : "scale-25 opacity-0 blur-[4px]"}`}
            />
          </span>
          {paused ? "Play clip" : "Pause clip"}
        </button>
      ) : null}

      <figcaption className="sr-only">
        An 11-second muted clip of real play: swinging between stops, then fights with The Sybil, Gas Goblin,
        Sandwich Man and Doc Octochain.
      </figcaption>
    </figure>
  );
}
