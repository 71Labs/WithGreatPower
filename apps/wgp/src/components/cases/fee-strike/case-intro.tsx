"use client";

/**
 * /play/cases/003: case file 003's intro comic, four panels, then "Start the case". The same
 * comic as case 001's (components/cases/case-intro.tsx):
 *
 * 1. The Daily Rug's front page: "Fees up 400%. Loaf down?", Aunt Mainnet's cold window.
 * 2. Her dark OPEN sign, and a queue in the dawn cold.
 * 3. Bearson: "Find out who's pricing this city out. I already know. Prove it."
 * 4. The case file, stamped 003: the suspect, a tip about the meter, and the job.
 * (docs/story/bible.md, "003 Fee Strike".)
 *
 * Wide screens lay the page out as a strip (two by two on a tablet), empty frames waiting
 * for their panel; a phone shows one panel at a time. A tap on the comic, Turn the page, →,
 * Space or Enter turns to the next panel, ← goes back, and Skip (or Esc) shows them all.
 * Panels pop in, unless reduced motion is asked for. Guests can start too, and are told
 * where their clear is kept.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { StickerButton, StickerFrame, StickerLink } from "@/components/game/kit";
import { AVATARS } from "@/components/cast";
import { ArrowLeft, ArrowRight, KeyRound, LogIn } from "@/components/icons";
import { useAccount, useGame } from "@/game/store";
import { CASE_003, CASE_003_PATHS, GAS_GOBLIN } from "@/lib/cases/content-003";
import { markCaseSeen, markCaseStarted } from "@/lib/cases/local";

import { CaseStamp, RugFront } from "../shared";
import { ColdWindowPhoto, DarkSignQueueArt, FeeMeterArt } from "./art";

const PANELS = ["The Daily Rug’s front page", "Outside Aunt Mainnet’s", "J. Jonah Bearson", "Case file 003"] as const;
const LAST = PANELS.length - 1;

/** A comic caption box: gold, ink-ruled, in caps. */
function Caption({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`w-fit max-w-full rounded-[6px] border-2 border-game-ink bg-game-gold px-2.5 py-1 text-[11px] font-bold uppercase leading-[15px] tracking-[0.06em] text-game-ink shadow-[var(--game-shadow-sm)] ${className}`}
    >
      {children}
    </p>
  );
}

/** One panel's frame: an ink-ruled box with its own ground. */
function Panel({ n, ground, children, className = "" }: { n: number; ground: string; children: ReactNode; className?: string }) {
  return (
    <figure aria-label={`Panel ${n + 1} of ${PANELS.length}: ${PANELS[n]}`} className={`wgp-pop relative flex h-full min-h-0 flex-col overflow-hidden rounded-[16px] border-[3px] border-game-ink shadow-[var(--game-shadow)] ${ground} ${className}`}>
      {children}
    </figure>
  );
}

function FrontPagePanel() {
  return (
    <Panel n={0} ground="bg-game-paper">
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <Caption>This morning…</Caption>
        <RugFront
          size="panel"
          headingLevel="h2"
          headline={CASE_003.gone.headline}
          dateline={["Early edition", CASE_003.district]}
          photo={<ColdWindowPhoto alt={CASE_003.gone.photo} />}
          caption={CASE_003.gone.caption}
          dek={CASE_003.gone.dek}
        />
        <p className="mt-auto border-t-2 border-game-ink pt-2 text-[12px] font-semibold leading-4 text-game-muted">Continued on page 2: “Who prices a pretzel at four hundred percent?”</p>
      </div>
    </Panel>
  );
}

function QueuePanel() {
  return (
    <Panel n={1} ground="bg-game-night">
      <div className="relative flex flex-1 flex-col gap-3 p-3.5">
        <Caption>{CASE_003.queue.caption}</Caption>
        <div className="flex flex-1 items-center justify-center px-1 py-1">
          <div className="w-full max-w-[300px] overflow-hidden rounded-[10px] border-[2.5px] border-game-ink shadow-[6px_8px_0_var(--game-ink)]">
            <DarkSignQueueArt />
          </div>
        </div>
        <Caption className="self-end">{CASE_003.queue.line}</Caption>
      </div>
    </Panel>
  );
}

function BearsonPanel() {
  return (
    <Panel n={2} ground="bg-game-paper-2">
      {/* Speed lines from the corner, the way an outburst reads in a comic. Decorative. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:repeating-conic-gradient(from_0deg_at_80%_78%,var(--game-ink)_0deg_3deg,transparent_3deg_14deg)]"
      />
      <div className="relative flex flex-1 flex-col gap-3 p-3.5">
        <Caption>The Daily Rug, editor’s office</Caption>
        {/* The bubble, its tail pointing down at him. */}
        <blockquote className="relative mt-1 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper px-4 py-3 shadow-[var(--game-shadow-sm)]">
          <p className="font-display text-[22px] font-bold leading-[26px] tracking-[-0.02em] text-game-ink text-balance">“{CASE_003.bearsonLine}”</p>
          <svg aria-hidden width="28" height="22" viewBox="0 0 28 22" className="absolute -bottom-[19px] right-12 block">
            <path d="M2 0 L26 0 L20 20 Z" fill="var(--game-paper)" />
            <path d="M2 1 L20 20 L26 1" fill="none" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </blockquote>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <p className="max-w-[16ch] rounded-[14px] border-2 border-dashed border-game-ink/50 bg-game-paper px-2.5 py-1.5 text-[13px] font-medium leading-[18px] text-game-ink">{CASE_003.bearsonAside}</p>
          <StickerFrame label="J. Jonah Bearson, editor of The Daily Rug" className="[--s:136px] md:[--s:124px]">
            {AVATARS.bearson()}
          </StickerFrame>
        </div>
      </div>
    </Panel>
  );
}

function CaseFilePanel() {
  return (
    <Panel n={3} ground="bg-game-folder">
      <div className="relative flex flex-1 flex-col gap-3 p-3.5">
        <Caption>Your desk, tonight</Caption>
        <div className="flex items-start justify-between gap-3">
          <h2 className="pt-1 font-display text-[24px] font-bold leading-[26px] tracking-[-0.02em] text-game-ink text-balance">{CASE_003.title}</h2>
          <CaseStamp number={CASE_003.number} className="mr-1 mt-2 shrink-0 bg-game-folder/60" />
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-[18px] text-game-ink">
          {CASE_003.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        {/* The suspect, clipped to the file like a mugshot. */}
        <div className="flex items-center gap-3 rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper/60 p-2.5">
          <StickerFrame label={`${GAS_GOBLIN.name}, the suspect`} drop="sm" className="[--s:76px]">
            {AVATARS["gas-goblin"]()}
          </StickerFrame>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-hero">Suspect</p>
            <p className="text-[16px] font-bold leading-5 text-game-ink">{GAS_GOBLIN.name}</p>
            <p className="text-[13px] italic leading-[18px] text-game-muted">“{GAS_GOBLIN.tagline}”</p>
          </div>
        </div>
        {/* The tip line: where the meter's key came from (the season's arc). */}
        <div className="flex items-start gap-2.5 rounded-[14px] border-2 border-game-ink bg-game-paper-2 p-2.5">
          <span aria-hidden className="size-12 shrink-0">
            <FeeMeterArt />
          </span>
          <p className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-[18px] text-game-ink">
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
              <KeyRound aria-hidden className="size-3.5" strokeWidth={2.5} />
              From the tip line
            </span>
            <span className="text-pretty">{CASE_003.tip}</span>
          </p>
        </div>
        <div className="mt-auto flex flex-col gap-2 rounded-[12px] border-2 border-game-ink bg-game-paper p-3">
          <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink">Your job</p>
          <ol className="flex flex-col gap-1.5 text-[14px] leading-5 text-game-ink">
            {CASE_003.steps.map((s, i) => (
              <li key={s} className="flex items-start gap-2">
                <span aria-hidden className="num mt-px grid size-5 shrink-0 place-items-center rounded-full bg-game-ink text-[11px] font-bold leading-none text-game-paper">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Panel>
  );
}

const CONTENT = [FrontPagePanel, QueuePanel, BearsonPanel, CaseFilePanel];

/** An empty frame waiting for its panel (wide screens only). */
function EmptyFrame() {
  return <div aria-hidden className="h-full min-h-[200px] rounded-[16px] border-[3px] border-dashed border-game-paper/30" />;
}

function StartBlock({ startRef }: { startRef: RefObject<HTMLAnchorElement | null> }) {
  const account = useAccount();
  const { save } = useGame();
  const guest = account.status === "guest";
  const noHero = !!save && !save.hero;
  return (
    <div className="wgp-rise flex w-full max-w-[460px] flex-col items-center gap-2.5 text-center">
      {noHero ? (
        <StickerLink ref={startRef} href="/play/bitten" variant="hero" size="xl" className="w-full">
          Get bitten to start the case
          <ArrowRight aria-hidden className="size-6" strokeWidth={2.25} />
        </StickerLink>
      ) : (
        <StickerLink ref={startRef} href={CASE_003_PATHS.play} onClick={() => markCaseStarted(CASE_003.id)} variant="hero" size="xl" className="w-full">
          Start the case
          <ArrowRight aria-hidden className="size-6" strokeWidth={2.25} />
        </StickerLink>
      )}
      {noHero ? (
        <p className="text-[13px] leading-5 text-game-paper/85 text-pretty">Every case needs someone to swing it. Get bitten first; the case file waits on Tonight.</p>
      ) : guest ? (
        <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-[13px] leading-5 text-game-paper/85 text-pretty">
          <span>Playing as a guest: your clear stays in this browser unless you sign in.</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("wgp:sign-in"))}
            className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 font-semibold text-game-paper underline decoration-game-paper/50 underline-offset-4 pointer-fine:hover:decoration-game-paper"
          >
            <LogIn aria-hidden className="size-4" strokeWidth={2.25} />
            Sign in
          </button>
        </p>
      ) : (
        <p className="text-[13px] leading-5 text-game-paper/85 text-pretty">Played off the boards. Your first clear files the “{CASE_003.badge}” badge with your hero.</p>
      )}
      <p className="max-w-[44ch] text-[12px] leading-[18px] text-game-paper/75 text-pretty">{CASE_003.chaseRule}</p>
    </div>
  );
}

export function FeeStrikeIntro() {
  const [step, setStep] = useState(0);
  const [announce, setAnnounce] = useState("");
  const start = useRef<HTMLAnchorElement>(null);
  const done = step >= LAST;

  const go = (to: number) => {
    const n = Math.max(0, Math.min(LAST, to));
    setStep(n);
    setAnnounce(`Panel ${n + 1} of ${PANELS.length}: ${PANELS[n]}.`);
  };
  const skip = () => {
    setStep(LAST);
    setAnnounce("All four panels. Start the case when you’re ready.");
    requestAnimationFrame(() => start.current?.focus({ preventScroll: true }));
  };

  // Keys turn the page: → Space Enter forward, ← back, Esc skips. Not while a control has
  // Space or Enter (it presses itself), and never with a modifier held.
  const keys = useRef({ go, skip, step });
  useEffect(() => {
    keys.current = { go, skip, step };
  });
  useEffect(() => markCaseSeen(CASE_003.id), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const onControl = e.target instanceof HTMLElement && !!e.target.closest("a, button, input, textarea, select, [role=dialog]");
      const k = keys.current;
      if (e.key === "ArrowRight" || (!onControl && (e.key === " " || e.key === "Enter"))) {
        if (k.step >= LAST) return;
        e.preventDefault();
        k.go(k.step + 1);
      } else if (e.key === "ArrowLeft") {
        if (k.step <= 0) return;
        e.preventDefault();
        k.go(k.step - 1);
      } else if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        if (k.step >= LAST) return;
        e.preventDefault();
        k.skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1320px] flex-col gap-4 px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] sm:px-6 lg:gap-6 lg:px-8">
      <header className="flex items-center justify-between gap-2">
        <StickerLink href={CASE_003_PATHS.list} size="sm">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={2.25} />
          Case files
        </StickerLink>
        <p className="num inline-flex h-8 items-center rounded-full border-2 border-game-ink bg-game-paper px-3 text-[13px] font-semibold text-game-ink shadow-[var(--game-shadow-sm)]">
          <span className="max-[359px]:hidden">Panel&nbsp;</span>
          {step + 1}/{PANELS.length}
        </p>
        <StickerButton size="sm" onClick={skip} aria-keyshortcuts="Escape" className={done ? "invisible" : ""}>
          Skip intro
        </StickerButton>
      </header>

      <h1 className="sr-only">
        Case file {CASE_003.number}: {CASE_003.title}
      </h1>

      {/* The comic. A tap anywhere on it turns the page. */}
      <ol
        aria-label="The story so far"
        onClick={(e) => {
          if (done || (e.target instanceof HTMLElement && e.target.closest("a, button"))) return;
          go(step + 1);
        }}
        className={`grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:gap-5 ${done ? "" : "cursor-pointer"}`}
      >
        {CONTENT.map((Content, i) => (
          <li key={i} className={`min-h-0 ${i === step ? "" : "max-md:hidden"}`}>
            {i <= step ? <Content /> : <EmptyFrame />}
          </li>
        ))}
      </ol>

      <footer className="flex flex-col items-center gap-2">
        {done ? (
          <StartBlock startRef={start} />
        ) : (
          <div className="flex w-full max-w-[460px] items-center gap-2.5">
            {step > 0 ? (
              <StickerButton size="lg" onClick={() => go(step - 1)} aria-label="Go back a panel" aria-keyshortcuts="ArrowLeft" className="shrink-0 md:hidden">
                <ArrowLeft aria-hidden className="size-5" strokeWidth={2.25} />
              </StickerButton>
            ) : null}
            <StickerButton size="lg" onClick={() => go(step + 1)} aria-keyshortcuts="ArrowRight" className="flex-1">
              Turn the page
              <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
            </StickerButton>
          </div>
        )}
        {done ? null : (
          <p aria-hidden className="text-[12px] font-medium leading-4 text-game-paper/75">
            <span className="pointer-coarse:hidden">Click the comic or press → to turn the page</span>
            <span className="pointer-fine:hidden">Tap the comic to turn the page</span>
          </p>
        )}
      </footer>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
