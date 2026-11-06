import type { Metadata, Viewport } from "next";

import { RaceNight } from "@/components/compete/race-night";

export const metadata: Metadata = { title: "Daily Run" };

/** It reads `?ghost=` on the server, so it renders per request (the race itself is all client). */
export const instant = false;

/** Edge to edge on a phone, like the patrol: the city under the notch, the HUD inside the safe area. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#22264f" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today's Daily Run, with the day's top three as ghosts (or `?ghost=<runId>` too). */
export default async function DailyPage({ searchParams }: PageProps<"/play/compete/daily">) {
  const ghost = (await searchParams).ghost;
  return <RaceNight spec={{ kind: "daily", ghost: typeof ghost === "string" && uuid.test(ghost) ? ghost : null }} />;
}
