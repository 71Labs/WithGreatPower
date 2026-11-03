"use client";

import { useEffect, useState, type RefObject } from "react";

export type RGB = [number, number, number];

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
