import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getDb } from "@/server/db/client";
import { raceTarget } from "@/server/db/compete";

/**
 * /play/compete/race/<runId>: a challenge link. It opens the race against that verified run's
 * ghost: today's Daily with it ("daily"), its course ("trial"), or its own night again as a
 * duel. A run that can't be raced (unknown, unverified, a case file) is a 404.
 */
export const metadata: Metadata = { title: "Race this ghost", robots: { index: false } };

/** It reads the run before it answers, so a link that can't be raced gets a real 404. */
export const instant = false;

export default async function RacePage({ params }: PageProps<"/play/compete/race/[runId]">) {
  const { runId } = await params;
  const target = await raceTarget(await getDb(), runId);
  if (!target) notFound();
  if (target.opens === "daily") redirect(`/play/compete/daily?ghost=${runId}`);
  if (target.opens === "trial" && target.course) redirect(`/play/compete/trial/${target.course}?ghost=${runId}`);
  redirect(`/play/compete/duel/${runId}`);
}
