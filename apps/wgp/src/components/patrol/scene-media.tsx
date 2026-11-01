"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Holds a shader scene behind a patrol screen and frees its WebGL context as soon as
 * the screen changes, rather than when the browser gets round to collecting it: a
 * night of patrol mounts a scene per stop, and browsers cap live contexts.
 */
export function SceneMedia({ children }: { children: ReactNode }) {
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
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      {children}
    </div>
  );
}
