import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { RaceNight } from "@/components/compete/race-night";
import { SITE_URL } from "@/lib/site";
import { loadPublicRun } from "@/server/social/run-cache";

const points = new Intl.NumberFormat("en-US");

/**
 * A challenge link lands here (through /play/compete/race/<runId>), so its card is the
 * challenge: whose run, the score to beat, and the run's own card image.
 */
export async function generateMetadata({ params }: PageProps<"/play/compete/duel/[runId]">): Promise<Metadata> {
  const { runId } = await params;
  const run = uuid.test(runId) ? await loadPublicRun(runId).catch(() => null) : null;
  if (!run) return { title: "Duel", robots: { index: false } };
  const title = `Race ${run.handle}’s ghost: ${points.format(run.score)} to beat`;
  const description = "A replay-verified night in With Great Power, raced again on the same city. Free, in your browser, no wallet or sign-in needed.";
  const image = { url: `/api/social/card/run/${run.runId}`, width: 1200, height: 630, alt: `${run.handle} banked ${points.format(run.score)}` };
  return {
    metadataBase: new URL(SITE_URL),
    title: "Duel",
    description,
    robots: { index: false },
    openGraph: { type: "website", siteName: "With Great Power", title, description, images: [image] },
    twitter: { card: "summary_large_image", site: "@wgponnear", title, description, images: [image] },
  };
}

export const instant = false;

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#22264f" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A duel: a verified night raced again on its own seed and save, its run as the ghost. Verified, never ranked. */
export default async function DuelPage({ params }: PageProps<"/play/compete/duel/[runId]">) {
  const { runId } = await params;
  if (!uuid.test(runId)) notFound();
  return <RaceNight spec={{ kind: "duel", runId }} />;
}
