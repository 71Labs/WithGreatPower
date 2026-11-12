/**
 * "Come back tomorrow", in numbers: the Daily Run and the ranked boards turn over at
 * midnight UTC, so the time left until then is the reason to return that the hub and the
 * results can state exactly.
 */
import { useSyncExternalStore } from "react";

const DAY = 86_400_000;

/** Milliseconds from `now` to the next midnight UTC (a full day at midnight itself). */
export function msToUtcMidnight(now: number): number {
  return DAY - (((now % DAY) + DAY) % DAY);
}

/** "6 h 12 min", "42 min", "under a minute": rounded down, never zero. */
export function formatCountdown(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/* A shared half-minute tick, so every countdown on a screen changes together. */
const listeners = new Set<() => void>();
let timer: number | null = null;
let minute = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    timer = window.setInterval(() => {
      const next = Math.floor(Date.now() / 60_000);
      if (next === minute) return;
      minute = next;
      listeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

const currentMinute = () => (minute ||= Math.floor(Date.now() / 60_000));

/**
 * The time until the Daily Run resets, as text that updates each minute. Null on the server
 * and for the first client render (the clock isn't the server's), so render a still fallback.
 */
export function useDailyReset(): string | null {
  const at = useSyncExternalStore(subscribe, currentMinute, () => 0);
  return at ? formatCountdown(msToUtcMidnight(at * 60_000)) : null;
}
