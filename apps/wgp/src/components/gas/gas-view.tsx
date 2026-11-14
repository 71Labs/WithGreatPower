/**
 * The /gas page, on paper: the gas tank's level (the relayer's available NEAR against the
 * relay's cut-off) and what a refill is. Server-safe and pure. Given `null` it draws the
 * same panel still reading, every label in place, so the numbers stream in without moving
 * anything (src/app/gas/page.tsx). The refill form is ./refill-form.tsx.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { GameBackdrop } from "@/components/game/backdrop";
import { KitStyles, ON_PAPER, StickerEyebrow, StickerPanel } from "@/components/game/kit";
import { AlertTriangle, Check } from "@/components/icons";
import { formatNear, type GasTank } from "@/server/intents/tank";

import { nearblocksAccount, textLink } from "./links";


export function GasFrame({ children }: { children: ReactNode }) {
  return (
    <div data-wgp-night="" className="relative isolate min-h-dvh bg-game-night text-game-paper [--vs-focus:var(--game-gold)]">
      <KitStyles />
      <GameBackdrop variant="flow" />
      <main id="main" className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="flex w-full max-w-[760px] flex-col gap-5">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center self-start rounded-full text-[13px] font-bold uppercase tracking-[0.08em] text-game-paper/85 underline-offset-4 pointer-fine:hover:underline"
          >
            With Great Power
          </Link>
          <StickerPanel as="article" aria-labelledby="gas-title" className={`wgp-rise flex flex-col gap-8 p-5 sm:p-7 ${ON_PAPER}`}>
            {children}
          </StickerPanel>
        </div>
      </main>
    </div>
  );
}

export function GasHeader() {
  return (
    <header className="flex flex-col gap-2">
      <StickerEyebrow>With Great Power</StickerEyebrow>
      <h1 id="gas-title" className="font-display text-[30px] font-semibold leading-[34px] tracking-[-0.03em] text-game-ink [text-wrap:balance] sm:text-[38px] sm:leading-[42px]">
        The gas tank
      </h1>
      <p className="max-w-[65ch] text-[15px] leading-[22px] text-game-ink [text-wrap:pretty]">
        Signed-in players never pay gas. The game’s relayer pays for every move they make on NEAR. When its balance drops below the cut-off, signed-in trades pause
        until someone refills it, and anyone can, from another chain.
      </p>
    </header>
  );
}

function Reading({ className = "h-6 w-16" }: { className?: string }) {
  return (
    <span className={`inline-block rounded-[6px] bg-game-ink/10 align-middle motion-safe:animate-pulse ${className}`}>
      <span className="sr-only">Reading</span>
    </span>
  );
}

function Tile({ label, value, unit, wide = false }: { label: string; value: string | null; unit?: string; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-[13px] font-medium leading-[18px] text-game-muted">{label}</dt>
      <dd className="num font-display text-[26px] font-semibold leading-8 tracking-[-0.02em] text-game-ink [overflow-wrap:anywhere] sm:text-[30px] sm:leading-9">
        {value === null ? (
          <Reading />
        ) : (
          <>
            {value}
            {unit ? <span className="ms-1.5 text-[15px] font-semibold tracking-normal text-game-muted">{unit}</span> : null}
          </>
        )}
      </dd>
    </div>
  );
}

/** The level and its state in words, with an icon, so it never rests on colour alone. */
export function TankBody({ tank, configured }: { tank: GasTank | null; configured: boolean }) {
  if (!configured) {
    return (
      <section aria-labelledby="gas-level" className="flex flex-col gap-3">
        <StickerEyebrow as="h2" id="gas-level">
          The tank
        </StickerEyebrow>
        <p className="rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper-2 px-4 py-4 text-[15px] font-semibold leading-[22px] text-game-ink">
          The gas tank isn’t set up on this server. It runs on mainnet, where the relayer lives.
        </p>
      </section>
    );
  }
  const wrapped = tank?.wrappedYocto && BigInt(tank.wrappedYocto) > 0n ? tank.wrappedYocto : null;
  return (
    <section aria-labelledby="gas-level" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <StickerEyebrow as="h2" id="gas-level">
          The tank
        </StickerEyebrow>
        <p className="max-w-[65ch] text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">
          {tank ? (
            <>
              The relayer is{" "}
              <a href={nearblocksAccount(tank.accountId)} className={`${textLink} font-mono text-[12px] [overflow-wrap:anywhere]`}>
                {tank.accountId}
              </a>
              , read from NEAR at{" "}
              <time dateTime={tank.at} className="num whitespace-nowrap">
                {new Date(tank.at).toISOString().slice(11, 16)} UTC
              </time>
              .
            </>
          ) : (
            <span role="status">Reading the relayer’s balance from NEAR…</span>
          )}
        </p>
      </div>

      {tank ? (
        <p
          className={`flex items-start gap-2.5 rounded-[14px] border-2 border-game-ink px-3.5 py-3 text-[15px] font-semibold leading-[22px] text-game-ink ${tank.ok ? "bg-game-mint" : "bg-game-gold"}`}
        >
          {tank.ok ? <Check aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} /> : <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.25} />}
          <span>{tank.ok ? "Players’ gas is paid." : "Below the cut-off: signed-in trades are paused until someone refills it."}</span>
        </p>
      ) : (
        <Reading className="h-[50px] w-full" />
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Available" value={tank ? formatNear(tank.availableYocto) : null} unit="NEAR" />
        <Tile label="Cut-off" value={tank ? formatNear(tank.minYocto) : null} unit="NEAR" />
        <Tile label="Waiting to unwrap" value={tank ? formatNear(tank.wrappedYocto ?? "0") : null} unit="wNEAR" wide />
      </dl>
      <p className="max-w-[65ch] text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">
        NEAR Intents delivers NEAR as wNEAR, the wrapped token. {wrapped ? "The team unwraps it into the tank; until then it shows here." : "The team unwraps any that arrives into the tank."}
      </p>
    </section>
  );
}
