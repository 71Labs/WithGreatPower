/** The Season tab's clock: the countdown text and the phase as time passes. Pure. */
import type { SeasonPhase, SeasonView } from "@/server/db/season-view";

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "2d 03:14:09", or "03:14:09" inside the last day. Never negative. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hms = `${pad(Math.floor((s % 86_400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return s >= 86_400 ? `${Math.floor(s / 86_400)}d ${hms}` : hms;
}

/** The phase as of `now`: a live season whose countdown ran out reads as closing without a refetch. */
export function phaseAt(season: Pick<SeasonView, "phase" | "startsAt" | "endsAt">, now: number): SeasonPhase {
  if (season.phase === "final") return "final";
  if (now < Date.parse(season.startsAt)) return "upcoming";
  if (now < Date.parse(season.endsAt)) return "live";
  return "closing";
}

/** How far the device's clock is behind the server's (server − device), ignoring nonsense over 30 days. */
export function clockSkew(serverNow: string, receivedAt: number): number {
  const server = Date.parse(serverNow);
  return Number.isFinite(server) && Math.abs(server - receivedAt) < 30 * DAY_MS ? server - receivedAt : 0;
}
