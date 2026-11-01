"use client";

import { ShaderCanvas } from "./shader-canvas";
import { usePalette } from "./use-art";

/**
 * The hero city: a dithered night skyline in the brand red, melting into the page at
 * the top so the headline stays on a clean ground. Uses the theme palette, so it
 * follows dark mode.
 */
export function HeroSkyline({ className = "" }: { className?: string }) {
  const p = usePalette();
  if (!p) return <div aria-hidden className={`bg-hero-wash ${className}`} />;
  return (
    <ShaderCanvas
      scene="skyline"
      palette={[p.page, p.light, p.ink, p.deep]}
      seed={4}
      resolution={0.5}
      fps={24}
      className={`[mask-image:linear-gradient(to_bottom,transparent_10%,black_46%)] ${className}`}
    />
  );
}
