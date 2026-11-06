/**
 * Words and numbers for the competitive screens: race clocks, gaps, medals, the day's reset.
 * Pure (no React), so the HUD, the hub and the results all say the same thing.
 */
import { COURSES, MEDAL_LABEL, raceClock, raceGap, type Medal } from "@wgp/game-core/compete";
import { POWERS } from "@wgp/game-core/data";
import type { PowerId, TrialCourseId } from "@wgp/game-core/types";

export { raceClock, raceGap };

const points = new Intl.NumberFormat("en-US");
export const formatScore = (n: number) => points.format(n);

/** Medal fills (on paper, each with its word beside it: never colour alone). */
export const MEDAL_FILL: Record<Medal, string> = {
  bronze: "bg-[#e3a46d]",
  silver: "bg-[#dfe3ea]",
  gold: "bg-game-gold",
  dev: "bg-[#8fe7ff]",
};

export const medalLabel = (m: Medal | null) => (m ? MEDAL_LABEL[m] : "No medal");

/** "2:31.4 to beat" style: the next medal up from `ticks`, or null at dev time. */
export function nextMedal(course: TrialCourseId, ticks: number | null): { medal: Medal; ticks: number } | null {
  const m = COURSES[course].medals;
  const order: Medal[] = ["bronze", "silver", "gold", "dev"];
  for (const medal of order) if (ticks === null || ticks > m[medal]) return { medal, ticks: m[medal] };
  return null;
}

/** "Web-sling, Node sense, Yank and Web bomb". */
export function kitLine(kit: PowerId[]): string {
  const names = kit.map((p) => POWERS[p].name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

/** "3 h 12 m" until `at` from `now`, or "under a minute". */
export function untilLabel(at: number, now: number): string {
  const s = Math.max(0, Math.floor((at - now) / 1000));
  if (s < 60) return "under a minute";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}

/** "Nov 5" for a UTC day key. */
export const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** A gap's tone for its chip: ahead (mint), behind (hero red), level. */
export const gapTone = (gap: number | null) => (gap === null ? "level" : gap < 0 ? "ahead" : gap > 0 ? "behind" : "level");

/** A gap in words for screen readers: "2.4 seconds behind #1". */
export function spokenGap(gap: number, who: string): string {
  const s = (Math.abs(gap) / 60).toFixed(1);
  return gap === 0 ? `level with ${who}` : `${s} seconds ${gap > 0 ? "behind" : "ahead of"} ${who}`;
}
