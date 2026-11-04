import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RunView } from "@/components/social/run-view";
import { SITE_URL, runPath } from "@/lib/site";
import { cachedPublicRun } from "@/server/social/run-cache";

/**
 * /r/<runId>: a verified run's public page, what share posts link to, with a card image
 * for X and Open Graph (/api/social/card/run/<id>). Unknown and unverified runs are a 404.
 *
 * The page waits for its run before it sends anything (instant = false), so a missing
 * run answers a real 404 rather than a streamed one; the read is cached, since a verified
 * run never changes (src/server/social/run-cache.ts).
 */
export const instant = false;

const points = new Intl.NumberFormat("en-US");

export async function generateMetadata({ params }: PageProps<"/r/[runId]">): Promise<Metadata> {
  const { runId } = await params;
  const run = await cachedPublicRun(runId);
  if (!run) return { title: "Run not found", robots: { index: false } };
  const title = `${run.handle} banked ${points.format(run.score)}`;
  const description = `A replay-verified night ${run.night} in With Great Power, the web-swinging parody on NEAR. Beat it tonight.`;
  const image = { url: `/api/social/card/run/${run.runId}`, width: 1200, height: 630, alt: `${run.handle} banked ${points.format(run.score)} on night ${run.night}` };
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical: runPath(run.runId) },
    openGraph: { type: "website", siteName: "With Great Power", url: runPath(run.runId), title, description, images: [image] },
    twitter: { card: "summary_large_image", site: "@wgponnear", title, description, images: [image] },
  };
}

export default async function RunPage({ params }: PageProps<"/r/[runId]">) {
  const { runId } = await params;
  const run = await cachedPublicRun(runId);
  if (!run) notFound();
  return <RunView run={run} />;
}
