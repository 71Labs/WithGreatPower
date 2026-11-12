"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ON_PAPER } from "@/components/game/kit";
import { Award, BadgeCheck, ChevronRight, CircleAlert, ExternalLink, Hourglass, ShieldCheck } from "@/components/icons";
import { EXPLORER_URL, GAME_CONTRACT_ID } from "@/lib/near/config";
import type { SeasonPhase, SeasonView } from "@/server/db/season-view";

import { clockSkew, formatLeft, phaseAt } from "./season-clock";

const utc = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: "UTC", ...opts });
const dateOnly = (iso: string) => utc(iso, { month: "short", day: "numeric" });
const dateTime = (iso: string) => `${utc(iso, { month: "short", day: "numeric" })}, ${utc(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} UTC`;
/** ends_at is exclusive: the last day is the one before. */
const lastDay = (endsAt: string) => new Date(Date.parse(endsAt) - 1).toISOString();

/** The server's clock, ticking once a second. `serverNow` is the server's answer time, `receivedAt` the device's. */
export function useServerNow(serverNow: string, receivedAt: number, ticking: boolean): number {
  const skew = clockSkew(serverNow, receivedAt);
  const [deviceNow, setDeviceNow] = useState(receivedAt);
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setDeviceNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  return Math.max(deviceNow, receivedAt) + skew;
}

const CHIP: Record<SeasonPhase, { label: string; className: string }> = {
  upcoming: { label: "Starts soon", className: "bg-game-paper" },
  live: { label: "Live", className: "bg-game-mint" },
  closing: { label: "Closing", className: "bg-game-gold" },
  final: { label: "Final", className: "bg-game-ink text-game-paper" },
};

/** What the countdown counts to, as a phrase for screen readers ("Ends Nov 15, 00:00 UTC"). */
const TARGET: Record<Exclude<SeasonPhase, "final">, { label: string; spoken: string }> = {
  upcoming: { label: "Starts in", spoken: "Starts" },
  live: { label: "Ends in", spoken: "Ends" },
  closing: { label: "Final standings in", spoken: "The standings freeze" },
};

/** A trophy marker: gold, ink-rimmed, so it reads on paper and on your gold row alike. Decorative; say it in text too. */
export function TrophyMark({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-game-ink ${className}`}>
      <Award className="size-3.5" strokeWidth={2.25} />
    </span>
  );
}

function StatusLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-[18px] text-game-ink [text-wrap:pretty]">
      <span className="mt-px shrink-0 [&>svg]:size-4">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function ExternalA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1 font-semibold underline decoration-2 underline-offset-2 focus-visible:outline-offset-2">
      {children}
      <ExternalLink aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Where the trophies stand: before the close, what will happen; after, what did. */
function ChainStatus({ season }: { season: SeasonView }) {
  const r = season.record;
  if (!r) {
    if (season.contractLive === false) {
      return (
        <StatusLine icon={<CircleAlert aria-hidden strokeWidth={2} />}>
          The game contract isn’t live on NEAR yet. At the close, the trophies are queued, and they mint when it goes live.
        </StatusLine>
      );
    }
    return (
      <StatusLine icon={<ShieldCheck aria-hidden strokeWidth={2} />}>
        At the close, the final top {season.trophies} and the standings’ Merkle root go on NEAR in one record, and the trophies mint with it.
      </StatusLine>
    );
  }
  switch (r.state) {
    case "empty":
      return <StatusLine icon={<CircleAlert aria-hidden strokeWidth={2} />}>Nobody finished a ranked night this season, so there’s nothing to record and no trophies to mint.</StatusLine>;
    case "queued":
      return (
        <StatusLine icon={<Hourglass aria-hidden strokeWidth={2} />}>
          <strong className="font-semibold">Trophies queued.</strong> The standings are locked in. They go on NEAR with the trophies once the game contract is live there.
        </StatusLine>
      );
    case "sending":
      return (
        <StatusLine icon={<Hourglass aria-hidden strokeWidth={2} />}>
          <strong className="font-semibold">Recording on NEAR.</strong> The record and the trophies go out with the next background pass.
        </StatusLine>
      );
    case "stuck":
      return (
        <StatusLine icon={<CircleAlert aria-hidden strokeWidth={2} />}>
          <strong className="font-semibold">Recording paused.</strong> The record is waiting for an operator to check it. The final standings and trophies are safe in the queue.
        </StatusLine>
      );
    case "recorded":
      return (
        <StatusLine icon={<BadgeCheck aria-hidden strokeWidth={2} />}>
          <strong className="font-semibold">Recorded on NEAR</strong>
          {r.recordedAt ? ` ${dateOnly(r.recordedAt)}` : ""}, trophies minted.{" "}
          {r.txHash ? (
            <ExternalA href={`${EXPLORER_URL}/txns/${encodeURIComponent(r.txHash)}`}>View the record on NearBlocks</ExternalA>
          ) : (
            <ExternalA href={`${EXPLORER_URL}/address/${encodeURIComponent(GAME_CONTRACT_ID)}`}>View the contract on NearBlocks</ExternalA>
          )}
        </StatusLine>
      );
  }
}

/** Root, digest and the results file, folded away: anyone can check a placement with them. */
function Verify({ season }: { season: SeasonView }) {
  const r = season.record;
  if (!r?.root || !r.digest) return null;
  return (
    <details className="group border-t-2 border-dashed border-game-ink/20 pt-2 text-[13px] leading-[18px]">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-semibold focus-visible:outline-offset-2 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 motion-safe:transition-[rotate] motion-safe:duration-150 group-open:rotate-90" strokeWidth={2.25} />
        Check the results yourself
      </summary>
      <div className="flex flex-col gap-2 pb-1 pt-1">
        <p className="text-game-muted [text-wrap:pretty]">
          Every place is a leaf in a Merkle tree. The results file lists each leaf with its proof; its sha256 is the digest on chain.
        </p>
        <dl className="grid gap-1">
          <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-game-muted">Root</dt>
          <dd className="hash text-[12px] leading-4">{r.root}</dd>
          <dt className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-game-muted">Digest</dt>
          <dd className="hash text-[12px] leading-4">{r.digest}</dd>
        </dl>
        <p className="flex pointer-coarse:min-h-11 pointer-coarse:items-center">
          <ExternalA href={`/api/seasons/${encodeURIComponent(season.id)}/results`}>Open the results file</ExternalA>
        </p>
      </div>
    </details>
  );
}

/**
 * The Season tab's head: dates, a countdown to the end (or the start, or the freeze),
 * the trophies, and where they stand on chain.
 */
export function SeasonCard({ season, serverNow, receivedAt }: { season: SeasonView; serverNow: string; receivedAt: number }) {
  const now = useServerNow(serverNow, receivedAt, season.phase !== "final");
  const phase = phaseAt(season, now);
  const chip = CHIP[phase];
  const target = phase === "upcoming" ? season.startsAt : phase === "live" ? season.endsAt : phase === "closing" ? season.freezesAt : null;
  const words = phase === "final" ? null : TARGET[phase];

  return (
    <section aria-label={`${season.name} details`} className={`flex flex-col gap-4 rounded-[14px] bg-game-paper-2 p-3 sm:p-4 ${ON_PAPER}`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{words ? words.label : "Final standings"}</span>
          <span className={`inline-flex h-7 items-center whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[12px] font-bold leading-none text-game-ink shadow-[var(--game-shadow-sm)] ${chip.className}`}>
            {chip.label}
          </span>
        </div>
        {target && words ? (
          <span role="timer" className="num font-display text-[30px] font-semibold leading-8 tracking-[-0.02em] sm:text-[34px] sm:leading-9">
            <span aria-hidden>{formatLeft(Date.parse(target) - now)}</span>
            <span className="sr-only">{`${words.spoken} ${dateTime(target)}`}</span>
          </span>
        ) : (
          <span className="font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] [text-wrap:balance]">
            {season.closedAt ? `Frozen ${dateTime(season.closedAt)}` : "Frozen"}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="num text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">
          {phase === "upcoming"
            ? `Starts ${dateTime(season.startsAt)}. Your nightly bests through ${dateOnly(lastDay(season.endsAt))} add up.`
            : phase === "live"
              ? `Your nightly bests add up until ${dateTime(season.endsAt)}.`
              : phase === "closing"
                ? `Ended ${dateTime(season.endsAt)}. Runs started before then still count until ${dateTime(season.freezesAt)}.`
                : "Nightly bests added up, ranked by points, then the faster nights."}
        </p>
        <p className="flex items-center gap-2 text-[13px] font-semibold leading-[18px]">
          <TrophyMark />
          <span className="[text-wrap:pretty]">
            {phase !== "final"
              ? `The top ${season.trophies} at the close each win a soulbound season trophy on NEAR.`
              : season.record?.state === "recorded"
                ? `The top ${season.trophies} each won a soulbound season trophy, minted on NEAR.`
                : `The top ${season.trophies} each won a soulbound season trophy.`}
          </span>
        </p>
        <ChainStatus season={season} />
      </div>

      <Verify season={season} />
    </section>
  );
}
