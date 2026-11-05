import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { COURSES, isTrialCourse } from "@wgp/game-core/compete";

import { RaceNight } from "@/components/compete/race-night";

/** It reads `?ghost=` on the server, so it renders per request (the race itself is all client). */
export const instant = false;

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#22264f" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/play/compete/trial/[course]">): Promise<Metadata> {
  const { course } = await params;
  return { title: isTrialCourse(course) ? `${COURSES[course].name}, time trial` : "Time trial" };
}

/** A time trial: the course's best three as ghosts, your best, and `?ghost=<runId>` if you chose one. */
export default async function TrialPage({ params, searchParams }: PageProps<"/play/compete/trial/[course]">) {
  const { course } = await params;
  if (!isTrialCourse(course)) notFound();
  const ghost = (await searchParams).ghost;
  return <RaceNight spec={{ kind: "trial", course, ghost: typeof ghost === "string" && uuid.test(ghost) ? ghost : null }} />;
}
