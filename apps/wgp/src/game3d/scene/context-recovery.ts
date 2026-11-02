/**
 * The WebGL context-loss lifecycle, independent of React and three.js so the event order is
 * testable. Ported from blastoff battle/context-recovery.ts: cancel the loss event (so the
 * browser may restore), report it, and report a stall if the context hasn't come back
 * within `waitMs` while the page is visible.
 */
export const CONTEXT_RECOVERY_WAIT_MS = 6000;

export function watchContextRecovery(options: {
  canvas: EventTarget;
  visibility: EventTarget & { visibilityState: string };
  onLost(): void;
  onRestored(): void;
  onStalled(): void;
  waitMs?: number;
}): () => void {
  let lost = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    clear();
    if (lost && options.visibility.visibilityState === "visible") {
      timer = setTimeout(() => {
        timer = undefined;
        if (!stopped && lost) options.onStalled();
      }, options.waitMs ?? CONTEXT_RECOVERY_WAIT_MS);
    }
  };
  const onLost = (event: Event) => {
    // WebGL only restores a context whose loss event was cancelled.
    event.preventDefault();
    if (lost || stopped) return;
    lost = true;
    options.onLost();
    arm();
  };
  const onRestored = () => {
    if (!lost || stopped) return;
    lost = false;
    clear();
    options.onRestored();
  };
  options.canvas.addEventListener("webglcontextlost", onLost);
  options.canvas.addEventListener("webglcontextrestored", onRestored);
  options.visibility.addEventListener("visibilitychange", arm);
  return () => {
    stopped = true;
    clear();
    options.canvas.removeEventListener("webglcontextlost", onLost);
    options.canvas.removeEventListener("webglcontextrestored", onRestored);
    options.visibility.removeEventListener("visibilitychange", arm);
  };
}
