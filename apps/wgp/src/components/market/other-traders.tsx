"use client";

/**
 * "Other traders" on the Mempool Market: Sandwich Man, the NPC arbitrageur. Who he is,
 * his wallet (his own NEAR account, linked to NearBlocks, when he trades on chain), what
 * he holds, his latest moves with the reason for each in his own words, and his rules in
 * a popover that links to the one file they live in (src/lib/market/npc-rules.ts).
 * Everything here is labelled as his: he is never shown as a player.
 *
 * The popover opens like "Why this price?" (hover, keyboard focus, or a press that pins
 * it; Escape or a press elsewhere closes it), on the same reducer.
 */
import { createElement, useEffect, useId, useReducer, useRef, useState } from "react";

import { StickerFrame, StickerPanel } from "@/components/game/kit";
import { AVATARS } from "@/components/cast";
import { CircleAlert, CircleSlash, ExternalLink, HelpCircle, Lock, Moon, Store } from "@/components/icons";
import { getNpcTrader, type NpcTraderView } from "@/lib/market/npc-api";

import { formatBits } from "./sparkline";
import { WHY_CLOSED, whyOpen, whyReduce } from "./why-price";

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
      {npc.mode === "simulated" ? (
        <span className={`${chip} bg-game-gold`}>
          <CircleAlert aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          Simulated
        </span>
      ) : null}
      {npc.status === "off" ? (
        <span className={`${chip} bg-game-paper-2`}>
          <CircleSlash aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
          Off
        </span>
      ) : npc.status === "closed-shop" ? (
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
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [state, send] = useReducer(whyReduce, WHY_CLOSED);
  const open = whyOpen(state);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) send("dismiss");
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") send("dismiss");
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className="relative shrink-0"
      onPointerEnter={(e) => e.pointerType === "mouse" && send("enter")}
      onPointerLeave={(e) => e.pointerType === "mouse" && send("leave")}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) send("blur");
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => send("press")}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && send("focus")}
        className={`inline-flex min-h-8 items-center gap-1 text-start text-[12px] leading-4 pointer-coarse:min-h-11 ${link}`}
      >
        <HelpCircle aria-hidden className="size-4 shrink-0" strokeWidth={2} />
        How he trades
      </button>
      {open ? (
        // The padding bridges the gap to the button, so a mouse can cross into the popover.
        <div id={id} role="group" aria-label={`${npc.name}’s rules`} className="absolute end-0 top-full z-30 w-[min(340px,calc(100vw-56px))] pt-1">
          <div className="flex flex-col gap-2 rounded-[16px] border-2 border-game-ink bg-game-paper p-3 text-game-ink shadow-[var(--game-shadow-sm)]">
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
      <dt className="text-game-muted">Wallet</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">
        {npc.explorerUrl ? (
          <a href={npc.explorerUrl} target="_blank" rel="noreferrer" className={link}>
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
          {npc.mode === "off" ? npc.statusLine : `“${npc.statusLine}” No moves yet: he acts when a trade or a listing lands.`}
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

/** The strip. Renders nothing until the first answer arrives, so the market never waits on it. */
export function OtherTraders({ stamp, bump = 0 }: { stamp: string; bump?: number }) {
  const npc = useNpcTrader(stamp, bump);
  const headingId = useId();
  if (!npc) return null;
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
              {npc.mode === "off" ? "He trades by fixed rules from his own wallet. He’s off right now." : npc.log.length > 0 ? `“${npc.statusLine}”` : "He trades by fixed rules from his own wallet."}
            </p>
            <Wallet npc={npc} />
          </div>
        </div>
        <Moves npc={npc} />
      </div>
    </StickerPanel>
  );
}
