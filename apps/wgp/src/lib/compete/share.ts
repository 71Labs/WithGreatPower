/**
 * What a player posts about a race, from their own X account (no approval needed: their words,
 * their run): the result and a challenge link that opens their ghost. Built on lib/social's
 * intent link; never promises anything but a race.
 */
import { COURSES, MEDAL_LABEL, raceClock, type Medal } from "@wgp/game-core/compete";
import type { TrialCourseId } from "@wgp/game-core/types";

import { SITE_URL } from "@/lib/site";
import { xIntentUrl } from "@/lib/social/x";

/** A challenge link: opens the run's ghost to race (today's Daily, its course, or its night). */
export const racePath = (runId: string) => `/play/compete/race/${runId}`;
export const raceUrl = (runId: string) => `${SITE_URL}${racePath(runId)}`;

const points = new Intl.NumberFormat("en-US");

/** "I ran today's Daily in 3:12.4 for 9,120 and beat @alice's ghost. Race mine 🕸️ <link>" */
export function raceShareText(input: {
  kind: "daily" | "trial" | "duel";
  course: string;
  ticks: number;
  score: number;
  medal: Medal | null;
  runId: string;
  ghost?: { handle: string; won: boolean } | null;
}): string {
  const time = raceClock(input.ticks);
  const what =
    input.kind === "trial"
      ? `${COURSES[input.course as TrialCourseId]?.name ?? "a time trial"} in ${time}${input.medal ? ` (${MEDAL_LABEL[input.medal]})` : ""}`
      : input.kind === "daily"
        ? `today’s Daily Run in ${time} for ${points.format(input.score)}`
        : `a night again in ${time} for ${points.format(input.score)}`;
  const vs = input.ghost ? (input.ghost.won ? ` and beat ${input.ghost.handle}’s ghost` : ` against ${input.ghost.handle}’s ghost`) : "";
  return `I ran ${what}${vs} in With Great Power. Race my ghost 🕸️ ${raceUrl(input.runId)}`;
}

export const raceShareUrl = (text: string) => xIntentUrl(text);
