/**
 * What a player posts about their own night: their words, from their own X account, so
 * no approval is needed. The link goes to the run's public page (src/app/r/[runId]).
 */
import { SITE_URL, runPath } from "@/lib/site";

import { xIntentUrl } from "./x";

const points = new Intl.NumberFormat("en-US");

/** "I banked 12,340 in With Great Power. Beat me 🕸️ https://www.wgponnear.fun/r/…" */
export function runShareText(score: number, runId: string): string {
  return `I banked ${points.format(score)} in With Great Power. Beat me 🕸️ ${SITE_URL}${runPath(runId)}`;
}

/** A season total isn't one run, so it links the board instead of a run page. */
export function seasonShareText(score: number, seasonName: string): string {
  return `I banked ${points.format(score)} in ${seasonName} of With Great Power. Beat me 🕸️ ${SITE_URL}/play/leaderboard`;
}

export const shareUrl = (text: string) => xIntentUrl(text);
