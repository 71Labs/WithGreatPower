"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { SceneName } from "@/components/art/scenes";
import { ShaderCanvas } from "@/components/art/shader-canvas";
import { MediaFrame } from "@/components/frame";

export interface FeatureTab {
  id: string;
  label: string;
  /** The procedural "photo" behind the example card. Swap for exported media here. */
  media: { scene: SceneName; palette: [string, string, string, string]; seed: number };
  /** What the example card shows, for assistive tech: the card itself is a picture. */
  cardLabel: string;
  card: ReactNode;
  body: ReactNode;
}

/** How long the outgoing panel stays on screen while the incoming one fades in. */
const FADE_MS = 320;

/**
 * Mounts a scene and frees its WebGL context as soon as it leaves the page, rather than
 * when the browser gets round to collecting it: browsers cap live contexts, and the
 * hero's terrain must never be the one they drop.
 */
function SceneMedia({ media }: { media: FeatureTab["media"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = ref.current?.querySelector("canvas");
    return () => {
      // Deferred so a remount of the same node (Strict Mode) keeps its context.
      setTimeout(() => {
        if (!canvas || canvas.isConnected || canvas.dataset.ready !== "true") return;
        canvas.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();
      }, 0);
    };
  }, []);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      <ShaderCanvas scene={media.scene} palette={media.palette} seed={media.seed} className="absolute inset-0" />
    </div>
  );
}

/**
 * The feature showcase: a large segmented tab bar, then per tab a media panel with an
 * example product card floating in it and the words beside it. Arrow keys, Home and End
 * move between tabs (automatic activation). Only the active tab runs a shader; the
 * outgoing one stays mounted for the length of the cross-fade.
 */
export function FeatureTabs({ tabs, label }: { tabs: FeatureTab[]; label: string }) {
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (leaving === null) return;
    const t = setTimeout(() => setLeaving(null), FADE_MS + 40);
    return () => clearTimeout(t);
  }, [leaving]);

  function select(i: number, focus: boolean) {
    const tab = tabRefs.current[i];
    if (focus) tab?.focus();
    // On narrow screens the bar scrolls: bring the chosen tab to the middle.
    const track = trackRef.current;
    if (tab && track && track.scrollWidth > track.clientWidth) {
      track.scrollTo({ left: tab.offsetLeft - (track.clientWidth - tab.offsetWidth) / 2 });
    }
    if (i === active) return;
    setLeaving(active);
    setActive(i);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight"
        ? active === last
          ? 0
          : active + 1
        : e.key === "ArrowLeft"
          ? active === 0
            ? last
            : active - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    select(next, true);
  }

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      <div className="flex justify-center">
        <div
          ref={trackRef}
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="relative flex max-w-full gap-1 rounded-[18px] bg-surface-2 p-1.5 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] sm:rounded-[20px] max-lg:[&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((t, i) => {
            const selected = i === active;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`feature-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`feature-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(i, false)}
                className={`h-11 shrink-0 whitespace-nowrap rounded-[12px] px-4 text-[15px] font-medium leading-5 tracking-[-0.01em] focus-visible:outline-offset-[-2px] sm:h-[52px] sm:rounded-[14px] sm:px-6 sm:text-[17px] lg:px-8 ${
                  selected
                    ? "bg-canvas text-ink-strong shadow-[var(--shadow-chip)]"
                    : "text-ink-subtle hover:text-ink-strong"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid">
        {tabs.map((t, i) => {
          const selected = i === active;
          const outgoing = i === leaving;
          return (
            <div
              key={t.id}
              role="tabpanel"
              id={`feature-panel-${t.id}`}
              aria-labelledby={`feature-tab-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={`grid items-start gap-10 [grid-area:1/1] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14 xl:gap-20 ${
                selected ? "visible z-[2]" : outgoing ? "visible z-[1]" : "invisible z-0"
              }`}
            >
              {/* The incoming media fades in over the outgoing one, so the picture never dips. */}
              <MediaFrame
                media={selected || outgoing ? <SceneMedia media={t.media} /> : null}
                className={`sm:aspect-[5/4] lg:aspect-square xl:aspect-[5/4] ${
                  selected ? "opacity-100 motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-out" : outgoing ? "opacity-100" : "opacity-0"
                }`}
              >
                <div
                  role="img"
                  aria-label={t.cardLabel}
                  className="flex size-full items-center justify-center px-4 py-12 sm:p-10"
                >
                  {t.card}
                </div>
              </MediaFrame>
              {/* The words cross-fade. */}
              <div
                className={`flex flex-col items-start lg:pt-2 ${
                  selected
                    ? "opacity-100 motion-safe:transition-opacity motion-safe:delay-75 motion-safe:duration-300 motion-safe:ease-out"
                    : outgoing
                      ? "opacity-0 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-out"
                      : "opacity-0"
                }`}
              >
                {t.body}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
