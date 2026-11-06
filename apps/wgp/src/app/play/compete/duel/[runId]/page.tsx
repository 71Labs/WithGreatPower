import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { RaceNight } from "@/components/compete/race-night";

export const metadata: Metadata = { title: "Duel" };

export const instant = false;

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#22264f" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A duel: a verified night raced again on its own seed and save, its run as the ghost. Verified, never ranked. */
export default async function DuelPage({ params }: PageProps<"/play/compete/duel/[runId]">) {
  const { runId } = await params;
  if (!uuid.test(runId)) notFound();
  return <RaceNight spec={{ kind: "duel", runId }} />;
}
