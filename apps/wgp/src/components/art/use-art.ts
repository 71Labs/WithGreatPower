"use client";

import { useEffect, useState, type RefObject } from "react";

export type RGB = [number, number, number];

export interface ArtPalette {
  /** Section background, for art that should melt into the page. */
  page: RGB;
  paper: RGB;
  light: RGB;
  ink: RGB;
  deep: RGB;
  faint: RGB;
}

function parseColor(value: string): RGB {
  const v = value.trim();
  if (v.startsWith("#")) {
    const hex = v.length === 4 ? v.slice(1).replace(/./g, (c) => c + c) : v.slice(1, 7);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
  }
  const m = v.match(/[\d.]+/g);
  return m ? (m.slice(0, 3).map((n) => Number(n) / 255) as RGB) : [0, 0, 0];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The art palette, derived from the design tokens so dark mode is handled for free. */
export function readPalette(): ArtPalette {
  const css = getComputedStyle(document.documentElement);
  const paper = parseColor(css.getPropertyValue("--vs-canvas"));
  const page = parseColor(css.getPropertyValue("--vs-page"));
  const ink = parseColor(css.getPropertyValue("--vs-accent"));
  const strong = parseColor(css.getPropertyValue("--vs-ink-strong"));
  const faint = parseColor(css.getPropertyValue("--vs-ink-faint"));
  return { page, paper, ink, faint, light: mix(ink, page, 0.78), deep: mix(ink, strong, 0.4) };
}

/** Palette that follows the color scheme. Null until mounted. */
export function usePalette(): ArtPalette | null {
  const [palette, setPalette] = useState<ArtPalette | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setPalette(readPalette());
    // Read after the first paint so the token values are applied.
    const raf = requestAnimationFrame(update);
    media.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(raf);
      media.removeEventListener("change", update);
    };
  }, []);
  return palette;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    const raf = requestAnimationFrame(update);
    media.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(raf);
      media.removeEventListener("change", update);
    };
  }, []);
  return reduced;
}

/** True while the element is on screen and the tab is visible, so animations can pause. */
export function useOnScreen(ref: RefObject<Element | null>, margin = "200px"): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let intersecting = false;
    const update = () => setOnScreen(intersecting && document.visibilityState === "visible");
    const io = new IntersectionObserver(
      ([entry]) => {
        intersecting = entry.isIntersecting;
        update();
      },
      { rootMargin: margin },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref, margin]);
  return onScreen;
}
