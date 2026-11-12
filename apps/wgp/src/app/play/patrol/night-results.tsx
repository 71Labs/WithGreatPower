"use client";

/**
 * The end of a 3D night: the shared results sheet over the city, with a panel saying what
 * counted. A ranked night shows the server's verified score and the player's place on
 * tonight's board (never a number the browser worked out); a rejected one says why and
 * keeps the local result off the board; a guest's night is banked in this browser with
 * an unranked score and a way to sign in. A verified night also says how many Bits it
 * earned for the Mempool Market.
 */
import { useEffect, type ReactNode } from "react";

import { StickerButton, StickerLink } from "@/components/game/kit";
import { BadgeCheck, CircleAlert, Coins, Medal } from "@/components/icons";
import { CopyRaceLink } from "@/components/compete/race-link";
import { GuestNightNext } from "@/components/first-minute/guest-night-next";
import { TradePromptCard, useTradePrompt } from "@/components/market/trade-prompt";
import { recordGuestNight } from "@/components/market/use-market-peek";
import { ShareOnX } from "@/components/social/share-on-x";
import { nightBits } from "@/lib/market/rewards";
import { runShareText } from "@/lib/social/share";
import { useAccount } from "@/game/store";
import type { NightOutcome, NightSession } from "@/game3d/session";
import { isUnclaimed } from "@/lib/near/policy";
import { Chip } from "@/sim/ui/bits";
import type { HeroSave } from "@/sim/ui/hooks";
import { Results } from "@/sim/ui/results";

export type Ending = { kind: "submitting" } | { kind: "done"; outcome: NightOutcome };

const fmt = (n: number) => n.toLocaleString("en-US");

/** The verifier's reasons, in words. */
const REASONS: Record<string, string> = {
  hash_mismatch: "The server’s replay of your inputs ended somewhere different from your game.",
  faster_than_wall_clock: "The night ran faster than real time.",
  too_short: "The night was too short to count.",
  run_expired: "The night took longer than the 45 minutes a ranked run has.",
  rev_conflict: "Your save changed somewhere else during the night.",
  ruleset_mismatch: "The game was updated during your night.",
  already_submitted: "This night was already sent with different inputs.",
  log_too_large: "The night’s input log was too big to check.",
};

function reasonText(reason: string): string {
  return REASONS[reason] ?? "The server couldn’t verify this night.";
}

function Panel({ tone = "paper", children }: { tone?: "paper" | "alert"; children: ReactNode }) {
  return (
    <section
      aria-label="Ranking"
      className={`flex flex-col gap-3 rounded-[16px] border-[2.5px] border-game-ink p-3.5 shadow-[var(--game-shadow-sm)] sm:p-4 ${tone === "alert" ? "bg-game-paper-2" : "bg-game-paper"}`}
    >
      {children}
    </section>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[12px] font-semibold leading-4 text-game-muted">{label}</p>
      <p className="num text-[32px] font-bold leading-9 tracking-[-0.02em]">{fmt(value)}</p>
    </div>
  );
}

/** The night's Bits, as the server minted them (src/lib/market/rewards.ts: the score, a level-up and the Bits tokens collected). */
function EarnedBits({ bits, prompted }: { bits: number; prompted: boolean }) {
  const account = useAccount();
  // The mint goes out after this screen; say when they'll be spendable so they never look lost.
  const unclaimed = account.status === "signed-in" && isUnclaimed(account.me.player);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border-2 border-game-ink bg-game-gold px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex items-center gap-2 text-[15px] font-bold leading-5">
          <Coins aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
          You earned <span className="num">{fmt(bits)}</span> Bits
        </p>
        <p className="pl-7 text-[12px] font-medium leading-4 text-game-ink [text-wrap:pretty]">
          {unclaimed ? "Saved for you. Claim your name to spend them." : "They reach your market wallet within a minute or two."}
        </p>
      </div>
      {/* With a trade to offer, that prompt is the one next step; otherwise point at the stall. */}
      {prompted ? null : (
        <StickerLink href="/play/market" size="sm">
          Spend them at the market
        </StickerLink>
      )}
    </div>
  );
}

/**
 * The night's loot against the recipes and Gwei's prices: the one trade worth making now
 * (finish a suit that's one part short, or sell loot no suit needs), linked into the
 * market with the sheet prefilled. Nothing shows until the market answers. With a prompt,
 * it replaces the plain link to the stall as the one next step.
 */
function VerifiedTrade({ bits, save }: { bits: number; save: HeroSave }) {
  const { prompt } = useTradePrompt(save);
  return (
    <>
      <EarnedBits bits={bits} prompted={!!prompt} />
      {prompt ? <TradePromptCard prompt={prompt} /> : null}
    </>
  );
}

/**
 * A guest's night earns no Bits; say what a verified one like it pays, and open the market
 * to them anyway: the practice market (src/lib/market/practice.ts), their own copy with
 * practice Bits, where the trade this night suggests (or any other) can be made now. It is
 * labelled as practice here and on the market itself; nothing in it is on NEAR.
 */
function GuestTrade({ score, save }: { score: number; save: HeroSave }) {
  const wouldPay = nightBits({ score, levelledUp: false });
  const night = save.patrol?.night ?? save.night;
  const { prompt } = useTradePrompt(save);
  useEffect(() => {
    recordGuestNight(night, wouldPay);
  }, [night, wouldPay]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border-2 border-game-ink bg-game-gold px-3 py-2.5">
        <p className="flex min-w-0 flex-1 basis-[240px] items-start gap-2 text-[14px] font-medium leading-5">
          <Coins aria-hidden className="mt-px size-5 shrink-0" strokeWidth={2.25} />
          <span className="[text-wrap:pretty]">
            Signed in, a night like this pays about <span className="num font-bold">{fmt(wouldPay)}</span> Bits to spend at the Mempool Market. As a guest you can trade in the practice market now: same rules, practice Bits, not on NEAR.
          </span>
        </p>
        {/* With a trade to offer, that prompt is the one next step; otherwise point at the practice market. */}
        {prompt ? null : (
          <StickerLink href="/play/market" size="sm" className="max-sm:w-full">
            Try the practice market
          </StickerLink>
        )}
      </div>
      {prompt ? <TradePromptCard prompt={prompt} eyebrow="Try it in the practice market" /> : null}
    </>
  );
}

function RankingPanel({ ending, onRetry }: { ending: Ending; onRetry(): void }) {
  if (ending.kind === "submitting") {
    return (
      <Panel>
        <p role="status" className="text-[15px] font-semibold leading-[22px]">
          Checking your night with the server…
        </p>
        <p className="text-[13px] leading-5 text-game-muted">It replays every input you made. Your score shows here once it agrees.</p>
      </Panel>
    );
  }
  const o = ending.outcome;
  switch (o.kind) {
    case "verified":
      return (
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="mint" size="sm">
              <BadgeCheck aria-hidden className="size-3.5" strokeWidth={2.25} />
              Verified
            </Chip>
            <Chip tone={o.ranked ? "gold" : "muted"} size="sm">
              <Medal aria-hidden className="size-3.5" strokeWidth={2.25} />
              {o.ranked ? "Ranked" : "Not ranked: assist on"}
            </Chip>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <Score label="Score, from the server" value={o.score} />
            {o.rank ? (
              <div className="flex flex-col gap-0.5">
                <p className="text-[12px] font-semibold leading-4 text-game-muted">Tonight’s board</p>
                <p className="num text-[32px] font-bold leading-9 tracking-[-0.02em]">
                  #{fmt(o.rank.rank)}
                  <span className="text-[15px] font-semibold tracking-normal text-game-muted"> of {fmt(o.rank.total)}</span>
                </p>
              </div>
            ) : null}
          </div>
          <VerifiedTrade bits={o.bits} save={o.save as HeroSave} />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {o.ranked ? <ShareOnX text={runShareText(o.score, o.runId)} className="w-full sm:w-auto" /> : null}
            {/* Race my ghost: anyone with the link races this night again, against this run. */}
            <CopyRaceLink runId={o.runId} className="w-full sm:w-auto" />
            <StickerLink href="/play/leaderboard" size="md" className="w-full sm:w-auto">
              See tonight’s board
            </StickerLink>
          </div>
        </Panel>
      );
    case "rejected":
      return (
        <Panel tone="alert">
          <p className="flex items-center gap-2 text-[15px] font-bold leading-5">
            <CircleAlert aria-hidden className="size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
            Not ranked
          </p>
          <p className="text-[14px] leading-5 text-pretty">{reasonText(o.reason)} Your hero keeps what they had, and you can play tonight again.</p>
          <p className="text-[12px] leading-4 text-game-muted">
            Unranked score <span className="num font-semibold text-game-ink">{fmt(o.score)}</span> · reason <code className="font-mono [overflow-wrap:anywhere]">{o.reason}</code>
          </p>
        </Panel>
      );
    case "guest":
      return (
        <Panel>
          <Score label="Unranked score" value={o.score} />
          {/* --- first-minute slot: a guest's ways on (sign in, the next night, tomorrow). Its logic lives in components/first-minute/guest-night-next.tsx. --- */}
          <GuestNightNext hero={o.save.hero} items={Object.values(o.save.inventory).reduce((sum, n) => sum + (n ?? 0), 0)} night={o.save.night} />
          {/* --- end first-minute slot --- */}
          <GuestTrade score={o.score} save={o.save as HeroSave} />
        </Panel>
      );
    case "unranked":
      return (
        <Panel>
          <Score label="Unranked score" value={o.score} />
          <p className="text-[14px] leading-5 text-pretty">Played off the board, so nothing was saved. Tomorrow’s ranked nights start at midnight UTC.</p>
        </Panel>
      );
    case "submit-failed":
      return (
        <Panel tone="alert">
          <p className="flex items-center gap-2 text-[15px] font-bold leading-5">
            <CircleAlert aria-hidden className="size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
            Couldn’t send your night
          </p>
          <p className="text-[14px] leading-5 text-pretty">{o.message} Your night is kept on this device, so you can send it again, even after a reload.</p>
          <StickerButton variant="hero" size="md" onClick={onRetry} className="w-full sm:w-auto sm:self-start">
            Send it again
          </StickerButton>
        </Panel>
      );
  }
}

export function NightResults({ session, ending, onRetry }: { session: NightSession; ending: Ending; onRetry(): void }) {
  const preview = session.run.save as HeroSave;
  // The results take over from the game: start keyboard and screen-reader users at their title.
  useEffect(() => {
    document.getElementById("results-title")?.focus({ preventScroll: true });
  }, []);
  const o = ending.kind === "done" ? ending.outcome : null;
  const banked = o?.kind === "verified" || o?.kind === "guest" ? (o.save as HeroSave) : null;
  const subtitle =
    ending.kind === "submitting"
      ? "Your haul, as soon as the server agrees."
      : o?.kind === "rejected" || o?.kind === "unranked"
        ? "This night wasn’t banked, so your hero keeps what they had."
        : o?.kind === "submit-failed"
          ? "Not banked yet."
          : undefined;
  return (
    <div className="absolute inset-0">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-game-night/55" />
      <Results save={banked ?? preview} before={banked ? session.before : null} subtitle={subtitle}>
        <RankingPanel ending={ending} onRetry={onRetry} />
      </Results>
    </div>
  );
}
