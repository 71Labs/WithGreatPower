"use client";

/**
 * "Other traders" on the Mempool Market: Sandwich Man, the NPC arbitrageur. While he has no
 * account on this market he is shown as practice only, with a link to the economy lab where
 * he does trade, and no wallet is claimed for him. Otherwise: who he is,
 * his wallet (his own NEAR account, linked to NearBlocks, when he trades on chain), what
 * he holds, his latest moves with the reason for each in his own words, and his rules in
 * a popover that links to the one file they live in (src/lib/market/npc-rules.ts).
 * Everything here is labelled as his: he is never shown as a player.
 *
 * The popover is "Why this price?"'s own (`usePopover`): it opens on hover, keyboard focus or
 * a press that pins it, closes on Escape or a press elsewhere, and stays clear of the dock.
 */
import Link from "next/link";
import { createElement, useEffect, useId, useRef, useState } from "react";

import { StickerFrame, StickerPanel } from "@/components/game/kit";
import { AVATARS } from "@/components/cast";
import { ArrowRight, CircleAlert, ExternalLink, HelpCircle, Lock, Moon, Store, TestTube } from "@/components/icons";
import { getNpcTrader, type NpcTraderView } from "@/lib/market/npc-api";

import { formatBits } from "./sparkline";
import { POPOVER_SHELL, usePopover } from "./why-price";

/** He acts after the response to a trade, so the strip looks again a little later. */
const AFTER_TRADE_MS = [3_000, 12_000] as const;

/** Sandwich Man as the server last described him; refetched when `stamp` or `bump` changes. */
function useNpcTrader(stamp: string, bump: number): NpcTraderView | null {
  const [npc, setNpc] = useState<NpcTraderView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getNpcTrader(controller.signal)
      .then((v) => {
        if (v && !controller.signal.aborted) setNpc(v);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [stamp]);

  useEffect(() => {
    if (bump === 0) return;
    const controller = new AbortController();
    const timers = AFTER_TRADE_MS.map((ms) =>
      window.setTimeout(() => {
        getNpcTrader(controller.signal)
          .then((v) => {
            if (v && !controller.signal.aborted) setNpc(v);
          })
          .catch(() => {});
      }, ms),
    );
    return () => {
      controller.abort();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [bump]);

  return npc;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", against the server's own clock. */
export function ago(at: string, now: string): string {
  const s = Math.max(0, (Date.parse(now) - Date.parse(at)) / 1000);
  if (s < 60) return "just now";
  if (s < 3_600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

const chip = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink pl-1 pr-2 text-[12px] font-bold leading-none text-game-ink";
const link =
  "rounded-[6px] font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-[3px] [text-decoration-skip-ink:auto] focus-visible:outline-offset-2 pointer-fine:hover:decoration-game-ink";

/** Where he is trading and whether he is, as labelled chips (an icon and a word each, never colour alone). */
function Chips({ npc }: { npc: NpcTraderView }) {
  return (
    <p className="flex flex-wrap gap-1.5">
      <span className={`${chip} bg-game-paper-2 pl-2`}>NPC</span>
      {npc.mode === "practice" ? (
        <span className={`${chip} bg-game-gold`}>
          <CircleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          Practice
        </span>
      ) : null}
      {npc.mode === "simulated" ? (
        <span className={`${chip} bg-game-gold`}>
          <CircleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          Simulated
        </span>
      ) : null}
      {npc.status === "closed-shop" ? (
        <span className={`${chip} bg-game-gold`}>
          <Lock aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          Closed shop
        </span>
      ) : npc.status === "resting" || npc.status === "market-closed" ? (
        <span className={`${chip} bg-game-paper-2`}>
          <Moon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          {npc.status === "resting" ? "Done for today" : "Market closed"}
        </span>
      ) : (
        <span className={`${chip} bg-game-paper`}>
          <Store aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          Trading
        </span>
      )}
    </p>
  );
}

/** The "How he trades" button and its popover: his rules, his seed, and the file they live in. */
function Rules({ npc }: { npc: NpcTraderView }) {
  const { id, open, pop, boxProps, buttonProps } = usePopover();

  return (
    <div {...boxProps} className="relative shrink-0">
      <button {...buttonProps} className={`inline-flex min-h-8 items-center gap-1 text-start text-[12px] leading-4 max-sm:min-h-11 pointer-coarse:min-h-11 ${link}`}>
        <HelpCircle aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        How he trades
      </button>
      {open ? (
        // Placed like "Why this price?": it flips above the button when the dock is in the way, and scrolls inside itself.
        <div ref={pop} id={id} role="group" aria-label={`${npc.name}’s rules`} className={`${POPOVER_SHELL} end-0 w-[min(340px,calc(100vw-56px))]`}>
          <div className="flex flex-col gap-2 overflow-y-auto overscroll-contain rounded-[16px] border-2 border-game-ink bg-game-paper p-3 text-game-ink shadow-[var(--game-shadow-sm)]">
            <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">His rules</p>
            <ul className="num flex list-disc flex-col gap-1.5 ps-4 text-[13px] leading-[18px] marker:text-game-muted [text-wrap:pretty]">
              {npc.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="num text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
              He uses the same market calls you do, with no special powers. He started with a one-off seed of {formatBits(npc.seedBits)} Bits; everything since is from trading.
            </p>
            <a href={npc.rulesUrl} target="_blank" rel="noreferrer" className={`inline-flex min-h-8 items-center gap-1 self-start text-[13px] leading-4 pointer-coarse:min-h-11 ${link}`}>
              Read his rules file on GitHub
              <ExternalLink aria-hidden className="size-4 shrink-0" strokeWidth={2} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Wallet({ npc }: { npc: NpcTraderView }) {
  if (npc.mode === "off" || npc.accountId === null) return null;
  const holds = [...npc.items.map((i) => `${formatBits(i.amount)} × ${i.name}`), ...npc.listings.map((l) => `${formatBits(l.amount)} × ${l.name} listed at ${formatBits(l.price)}`)];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-[18px]">
      {/* A wallet only where one exists: on chain. In the simulated market it's a name in the sim's books. */}
      <dt className="text-game-muted">{npc.mode === "on-chain" ? "Wallet" : "Sim account"}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">
        {npc.explorerUrl ? (
          <a href={npc.explorerUrl} target="_blank" rel="noreferrer" className={`inline-block py-[3px] ${link}`}>
            {npc.accountId}
            <ExternalLink aria-hidden className="ms-1 inline size-3.5 align-[-2px]" strokeWidth={2} />
            <span className="sr-only"> on NearBlocks (opens in a new tab)</span>
          </a>
        ) : (
          <span className="font-semibold">{npc.accountId}</span>
        )}
      </dd>
      <dt className="text-game-muted">Bits</dt>
      <dd className="num font-semibold">{npc.bits === null ? "—" : formatBits(npc.bits)}</dd>
      <dt className="text-game-muted">Holds</dt>
      <dd className="num min-w-0 [text-wrap:pretty]">{holds.length > 0 ? holds.join(", ") : "Nothing right now"}</dd>
    </dl>
  );
}

function Moves({ npc }: { npc: NpcTraderView }) {
  const headingId = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 border-t-2 border-dashed border-game-ink/20 pt-3 sm:border-s-2 sm:border-t-0 sm:ps-5 sm:pt-0">
      <h3 id={headingId} className="text-[12px] font-semibold leading-4 text-game-muted">
        His latest moves
      </h3>
      {npc.log.length === 0 ? (
        <p className="max-w-[52ch] text-[14px] leading-5 [text-wrap:pretty]">
          “{npc.statusLine}” No moves yet: he acts when a trade or a listing lands.
        </p>
      ) : (
        <ol aria-labelledby={headingId} className="flex flex-col divide-y-2 divide-dashed divide-game-ink/10">
          {npc.log.map((e) => (
            <li key={`${e.at}-${e.text}`} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
              <p className="num text-[14px] font-semibold leading-5 [text-wrap:pretty]">{e.text}</p>
              <p className="num text-[13px] leading-[18px] [text-wrap:pretty]">“{e.reason}”</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[12px] leading-4 text-game-muted">
                <time dateTime={e.at} className="num">
                  {ago(e.at, npc.now)}
                </time>
                {e.txUrl ? (
                  <a href={e.txUrl} target="_blank" rel="noreferrer" className={`inline-flex min-h-6 items-center gap-1 pointer-coarse:min-h-11 ${link}`}>
                    See the transaction
                    <ExternalLink aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Where a reader can watch him trade while he isn't on this market. */
export const NPC_LAB_HREF = "/lab/economy#lab-npc";
/** The practice market (src/lib/market/practice.ts), where he trades in the visitor's own browser. */
export const NPC_PRACTICE_HREF = "/play/market?practice=1";

/**
 * Sandwich Man when he isn't configured for this market (no account of his own yet): said
 * plainly, with where he does trade. No wallet, no "latest moves", nothing that reads as broken.
 */
function PracticeOnly({ npc, headingId }: { npc: NpcTraderView; headingId: string }) {
  return (
    <StickerPanel as="section" aria-labelledby={headingId} className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Other traders
        </h2>
        <Rules npc={npc} />
      </div>
      <div className="flex min-w-0 items-start gap-3.5">
        <StickerFrame drop="sm" label={`${npc.name}, the arbitrageur`} className="[--s:64px] sm:[--s:76px]">
          {createElement(AVATARS[npc.id])}
        </StickerFrame>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col gap-1.5">
            <p className="text-[16px] font-semibold leading-5">
              {npc.name} <span className="font-normal text-game-muted">· the arbitrageur</span>
            </p>
            <p className="flex flex-wrap gap-1.5">
              <span className={`${chip} bg-game-paper-2 pl-2`}>NPC</span>
              <span className={`${chip} bg-game-paper-2`}>
                <TestTube aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
                Practice only
              </span>
            </p>
          </div>
          <p className="max-w-[62ch] text-[14px] leading-5 [text-wrap:pretty]">
            {npc.name} isn’t trading on this market yet: his NEAR account isn’t funded. For now he trades in the practice market and in the economy lab’s simulation, by the same rules he’ll follow here.
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href={NPC_PRACTICE_HREF} className={`inline-flex min-h-8 items-center gap-1 text-[14px] leading-5 max-sm:min-h-11 pointer-coarse:min-h-11 ${link}`}>
              Trade alongside him in the practice market
              <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />
            </Link>
            <Link href={NPC_LAB_HREF} className={`inline-flex min-h-8 items-center gap-1 text-[14px] leading-5 max-sm:min-h-11 pointer-coarse:min-h-11 ${link}`}>
              Watch him trade in the economy lab
              <ArrowRight aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />
            </Link>
          </p>
        </div>
      </div>
    </StickerPanel>
  );
}

/** The strip for one answer from the server: his practice-only notice while he's off, else who he is, what he holds and his moves. */
export function TraderStrip({ npc }: { npc: NpcTraderView }) {
  const headingId = useId();
  if (npc.mode === "off") return <PracticeOnly npc={npc} headingId={headingId} />;
  // His Bits are real tokens only on chain; in the simulated market nothing moves.
  const how =
    npc.mode === "on-chain"
      ? "He trades by fixed rules from his own NEAR account."
      : npc.mode === "practice"
        ? "He trades by fixed rules with his own practice Bits, in your browser."
        : "He trades by fixed rules with his own simulated Bits.";
  return (
    <StickerPanel as="section" aria-labelledby={headingId} className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Other traders
        </h2>
        <Rules npc={npc} />
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div className="flex min-w-0 items-start gap-3.5 sm:w-[360px] sm:shrink-0">
          <StickerFrame drop="sm" label={`${npc.name}, the arbitrageur`} className="[--s:64px] sm:[--s:76px]">
            {createElement(AVATARS[npc.id])}
          </StickerFrame>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-[16px] font-semibold leading-5">
                {npc.name} <span className="font-normal text-game-muted">· the arbitrageur</span>
              </p>
              <Chips npc={npc} />
            </div>
            {/* A status the reader should hear when it changes: he closed shop, he reopened. */}
            <p role="status" className="text-[13px] leading-[18px] [text-wrap:pretty]">
              {npc.log.length > 0 ? `“${npc.statusLine}”` : how}
            </p>
            {/* Once he has moves his own words take the line above; where his Bits live still has to be said. */}
            {npc.log.length > 0 ? <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">{how}</p> : null}
            <Wallet npc={npc} />
          </div>
        </div>
        <Moves npc={npc} />
      </div>
    </StickerPanel>
  );
}

/**
 * The strip on the market. Renders nothing until the first answer arrives, so the market
 * never waits on it. `onMove` fires when a new move of his shows up after the first load:
 * he may have bought the viewer's listing, so the screen reloads its listings and wallet.
 */
export function OtherTraders({ stamp, bump = 0, onMove }: { stamp: string; bump?: number; onMove?(): void }) {
  const npc = useNpcTrader(stamp, bump);
  const newest = npc ? (npc.log[0] ? `${npc.log[0].at}-${npc.log[0].text}` : "") : null;
  const seen = useRef<string | null>(null);
  const moved = useRef(onMove);
  useEffect(() => {
    moved.current = onMove;
  }, [onMove]);
  useEffect(() => {
    if (newest === null) return;
    if (seen.current !== null && seen.current !== newest) moved.current?.();
    seen.current = newest;
  }, [newest]);
  if (!npc) return null;
  return <TraderStrip npc={npc} />;
}
