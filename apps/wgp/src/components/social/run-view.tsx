/**
 * A verified run's public page body (src/app/r/[runId]): who played it, the score the
 * server replayed, the night, and the replay anyone can check, with one red action: play.
 * Server-safe.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { RaceGhostLink } from "@/components/compete/race-link";
import { StickerLink, StickerPanel } from "@/components/game/kit";
import { HeroTile } from "@/components/game/ui";
import { ArrowRight, BadgeCheck, ExternalLink } from "@/components/icons";
import type { PublicRun } from "@/server/social/runs";

const points = new Intl.NumberFormat("en-US");
const utcDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
/** Game ticks at 60 Hz as m:ss. */
const length = (ticks: number) => `${Math.floor(ticks / 3600)}:${String(Math.floor(ticks / 60) % 60).padStart(2, "0")}`;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-2.5">
      <dt className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{label}</dt>
      <dd className="num text-[15px] font-semibold leading-5 text-game-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function RunView({ run }: { run: PublicRun }) {
  return (
    <main id="main" data-wgp-night="" className="flex min-h-dvh flex-col items-center bg-game-night px-4 pb-16 pt-10 text-game-paper [--vs-focus:var(--game-gold)] sm:pt-16">
      <div className="flex w-full max-w-[640px] flex-col gap-5">
        <Link href="/" className="inline-flex min-h-11 items-center self-start rounded-full text-[13px] font-bold uppercase tracking-[0.08em] text-game-paper/80 underline-offset-4 pointer-fine:hover:underline">
          With Great Power
        </Link>
        <StickerPanel as="article" aria-labelledby="run-title" className="flex flex-col gap-5 p-5 [--vs-focus:var(--game-hero)] sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-mint px-3 text-[13px] font-semibold text-game-ink shadow-[var(--game-shadow-sm)]">
              <BadgeCheck aria-hidden className="size-4" strokeWidth={2.25} />
              Replay-verified
            </span>
            {run.mode === "daily" ? (
              <span className="inline-flex h-8 items-center whitespace-nowrap rounded-full border-2 border-game-ink bg-[#8fe7ff] px-3 text-[13px] font-semibold text-game-ink">
                Daily Run{run.course ? `, ${utcDate(`${run.course}T12:00:00Z`)}` : ""}
              </span>
            ) : null}
            {run.assist ? (
              <span className="inline-flex h-8 items-center whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper-2 px-3 text-[13px] font-semibold text-game-ink">
                Assist on: not ranked
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            <HeroTile suit={run.suit ?? "classic"} className="size-16 rounded-[16px] sm:size-20 sm:rounded-[20px]" />
            <div className="flex min-w-0 flex-col">
              <h1 id="run-title" className="font-display text-[26px] font-semibold leading-8 tracking-[-0.02em] text-game-ink [overflow-wrap:anywhere] sm:text-[30px]">
                {run.handle}
              </h1>
              <p className="text-[14px] leading-5 text-game-muted [overflow-wrap:anywhere]">
                {run.heroName ? `${run.heroName} · ` : ""}
                {run.nearAccountId}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Banked</p>
            <p className="num font-display text-[64px] font-bold leading-[64px] tracking-[-0.04em] text-game-ink sm:text-[88px] sm:leading-[88px]">{points.format(run.score)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label={run.mode === "daily" ? "Mode" : "Night"}>{run.mode === "daily" ? "Daily Run" : run.night}</Fact>
            <Fact label="Date (UTC)">{utcDate(run.submittedAt ?? run.issuedAt)}</Fact>
            <Fact label="Night length">{length(run.ticks)}</Fact>
          </dl>
          <p className="max-w-[60ch] text-[14px] leading-6 text-game-ink">
            Our server replayed every input of this night before it counted. The seed, the starting save and the input log are public, so anyone can replay it and check the score.
          </p>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
            <StickerLink href="/play" variant="hero" size="lg" className="w-full sm:w-auto">
              Play tonight
              <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
            </StickerLink>
            {/* Every verified run is a ghost: race this one (its night again, or today’s Daily beside it). */}
            <RaceGhostLink runId={run.runId} size="lg" label={`Race ${run.handle}’s ghost`} className="w-full sm:w-auto" />
            <a
              href={`/api/runs/${run.runId}/replay`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[14px] font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
            >
              Get the replay to verify
              <ExternalLink aria-hidden className="size-4" strokeWidth={2} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
          {run.digest ? (
            <p className="text-[12px] leading-4 text-game-muted">
              Run digest <span className="hash">{run.digest}</span>
            </p>
          ) : null}
        </StickerPanel>
      </div>
    </main>
  );
}
