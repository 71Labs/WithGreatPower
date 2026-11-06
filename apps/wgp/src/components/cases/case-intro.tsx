"use client";

/**
 * /play/cases/001: the case's intro comic, four panels, then "Start the case". Another case
 * passes its own `story` (its panels, number and paths: case-002/intro.tsx).
 *
 * 1. The Daily Rug's front page: "JPEG GONE".
 * 2. The MISSING poster, taped to a wall in the Bridge District.
 * 3. Bearson: "Find her before the other papers do."
 * 4. The case file, stamped 001, with what you're there to do.
 *
 * Wide screens lay the page out as a strip (two by two on a tablet), empty frames waiting
 * for their panel; a phone shows one panel at a time. A tap on the comic, Turn the page, →, Space
 * or Enter turns to the next panel, ← goes back, and Skip (or Esc) shows them all. Panels
 * pop in, unless reduced motion is asked for. Guests can start too, and are told where
 * their clear is kept.
 */
import { createContext, useContext, useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from "react";

import { StickerButton, StickerFrame, StickerLink } from "@/components/game/kit";
import { AVATARS } from "@/components/cast";
import { ArrowLeft, ArrowRight, LogIn } from "@/components/icons";
import { useAccount, useGame } from "@/game/store";
import { CASE_001, CASE_PATHS, RIGHT_CLICKER } from "@/lib/cases/content";
import { markCaseSeen, markCaseStarted } from "@/lib/cases/local";

import { MaryPhoto, MissingPoster, RightClickerArt } from "./art";
import { CaseStamp, RugFront } from "./shared";

const PANELS = ["The Daily Rug’s front page", "The MISSING poster", "J. Jonah Bearson", "Case file 001"] as const;

/** A case's intro comic: its panels (a label each, for the frame's name) and where "Start the case" goes. */
export interface IntroStory {
  id: string;
  number: string;
  title: string;
  panels: readonly { label: string; Content: () => JSX.Element }[];
  paths: { list: string; play: string };
}

/** The panels' labels, for each frame's accessible name. */
const PanelLabels = createContext<readonly string[]>(PANELS);

/** A comic caption box: gold, ink-ruled, in caps. */
export function Caption({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`w-fit max-w-full rounded-[6px] border-2 border-game-ink bg-game-gold px-2.5 py-1 text-[11px] font-bold uppercase leading-[15px] tracking-[0.06em] text-game-ink shadow-[var(--game-shadow-sm)] ${className}`}
    >
      {children}
    </p>
  );
}

/** One panel's frame: an ink-ruled box with its own ground. */
export function Panel({ n, ground, children, className = "" }: { n: number; ground: string; children: ReactNode; className?: string }) {
  const labels = useContext(PanelLabels);
  return (
    <figure aria-label={`Panel ${n + 1} of ${labels.length}: ${labels[n]}`} className={`wgp-pop relative flex h-full min-h-0 flex-col overflow-hidden rounded-[16px] border-[3px] border-game-ink shadow-[var(--game-shadow)] ${ground} ${className}`}>
      {children}
    </figure>
  );
}

function FrontPagePanel() {
  return (
    <Panel n={0} ground="bg-game-paper">
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <Caption>Two nights ago…</Caption>
        <RugFront
          size="panel"
          headingLevel="h2"
          headline={CASE_001.gone.headline}
          dateline={["Late edition", "Bridge District"]}
          photo={<MaryPhoto alt="Mary Jpeg waving from a rooftop, in blocky, compressed pixels." />}
          caption={CASE_001.gone.caption}
          dek={CASE_001.gone.dek}
        />
        <p className="mt-auto border-t-2 border-game-ink pt-2 text-[12px] font-semibold leading-4 text-game-muted">
          Continued on page 2: “Who right-clicks a person?”
        </p>
      </div>
    </Panel>
  );
}

function PosterPanel() {
  return (
    <Panel n={1} ground="bg-game-night">
      {/* Brick courses on the wall behind the poster. Decorative. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(var(--game-ink)_2px,transparent_2px),linear-gradient(90deg,var(--game-ink)_2px,transparent_2px)] [background-size:44px_22px]"
      />
      <div className="relative flex flex-1 flex-col gap-3 p-3.5">
        <Caption>Meanwhile, on every lamppost…</Caption>
        <div className="flex flex-1 items-center justify-center px-2 py-1">
          <div className="relative w-full max-w-[260px] -rotate-2">
            <span aria-hidden className="absolute -left-3 -top-2 z-[1] h-6 w-16 -rotate-[24deg] rounded-[3px] bg-game-gold/60" />
            <span aria-hidden className="absolute -right-3 -top-2 z-[1] h-6 w-16 rotate-[21deg] rounded-[3px] bg-game-gold/60" />
            <div className="overflow-hidden rounded-[4px] shadow-[6px_8px_0_var(--game-ink)]">
              <MissingPoster eager sizes="(min-width: 1024px) 260px, (min-width: 768px) 300px, 82vw" />
            </div>
          </div>
        </div>
        <Caption className="self-end">Somebody keeps tearing off the tabs.</Caption>
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
          <p className="font-display text-[22px] font-bold leading-[26px] tracking-[-0.02em] text-game-ink text-balance">“{CASE_001.bearsonLine}”</p>
          <svg aria-hidden width="28" height="22" viewBox="0 0 28 22" className="absolute -bottom-[19px] right-12 block">
            <path d="M2 0 L26 0 L20 20 Z" fill="var(--game-paper)" />
            <path d="M2 1 L20 20 L26 1" fill="none" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </blockquote>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <p className="max-w-[16ch] rounded-[14px] border-2 border-dashed border-game-ink/50 bg-game-paper px-2.5 py-1.5 text-[13px] font-medium leading-[18px] text-game-ink">
            {CASE_001.bearsonAside}
          </p>
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
          <h2 className="pt-1 font-display text-[24px] font-bold leading-[26px] tracking-[-0.02em] text-game-ink text-balance">{CASE_001.title}</h2>
          <CaseStamp number={CASE_001.number} className="mr-1 mt-2 shrink-0 bg-game-folder/60" />
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-[18px] text-game-ink">
          {CASE_001.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        {/* The suspect, clipped to the file like a mugshot. */}
        <div className="flex items-center gap-3 rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper/60 p-2.5">
          <StickerFrame label={`${RIGHT_CLICKER.name}, the suspect`} drop="sm" className="[--s:76px]">
            <RightClickerArt />
          </StickerFrame>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-hero">Suspect</p>
            <p className="text-[16px] font-bold leading-5 text-game-ink">{RIGHT_CLICKER.name}</p>
            <p className="text-[13px] italic leading-[18px] text-game-muted">“{RIGHT_CLICKER.tagline}”</p>
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-2 rounded-[12px] border-2 border-game-ink bg-game-paper p-3">
          <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink">Your job</p>
          <ol className="flex flex-col gap-1.5 text-[14px] leading-5 text-game-ink">
            {CASE_001.steps.map((s, i) => (
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

const CONTENT = [FrontPagePanel, PosterPanel, BearsonPanel, CaseFilePanel];

/** Case file 001's intro. */
const STORY_001: IntroStory = {
  id: CASE_001.id,
  number: CASE_001.number,
  title: CASE_001.title,
  panels: PANELS.map((label, i) => ({ label, Content: CONTENT[i] })),
  paths: CASE_PATHS,
};

/** An empty frame waiting for its panel (wide screens only). */
function EmptyFrame() {
  return <div aria-hidden className="h-full min-h-[200px] rounded-[16px] border-[3px] border-dashed border-game-paper/30" />;
}

function StartBlock({ startRef, story }: { startRef: RefObject<HTMLAnchorElement | null>; story: IntroStory }) {
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
        <StickerLink ref={startRef} href={story.paths.play} onClick={() => markCaseStarted(story.id)} variant="hero" size="xl" className="w-full">
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
        <p className="text-[13px] leading-5 text-game-paper/85 text-pretty">Played off the boards. Your first clear files the “Case closed” badge with your hero.</p>
      )}
    </div>
  );
}

export function CaseIntro({ story = STORY_001 }: { story?: IntroStory }) {
  const labels = story.panels.map((p) => p.label);
  const LAST = labels.length - 1;
  const [step, setStep] = useState(0);
  const [announce, setAnnounce] = useState("");
  const start = useRef<HTMLAnchorElement>(null);
  const done = step >= LAST;

  const go = (to: number) => {
    const n = Math.max(0, Math.min(LAST, to));
    setStep(n);
    setAnnounce(`Panel ${n + 1} of ${labels.length}: ${labels[n]}.`);
  };
  const skip = () => {
    setStep(LAST);
    setAnnounce(`All ${labels.length} panels. Start the case when you’re ready.`);
    requestAnimationFrame(() => start.current?.focus({ preventScroll: true }));
  };

  // Keys turn the page: → Space Enter forward, ← back, Esc skips. Not while a control has
  // Space or Enter (it presses itself), and never with a modifier held.
  const keys = useRef({ go, skip, step, last: LAST });
  useEffect(() => {
    keys.current = { go, skip, step, last: LAST };
  });
  useEffect(() => markCaseSeen(story.id), [story.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const onControl = e.target instanceof HTMLElement && !!e.target.closest("a, button, input, textarea, select, [role=dialog]");
      const k = keys.current;
      if (e.key === "ArrowRight" || (!onControl && (e.key === " " || e.key === "Enter"))) {
        if (k.step >= k.last) return;
        e.preventDefault();
        k.go(k.step + 1);
      } else if (e.key === "ArrowLeft") {
        if (k.step <= 0) return;
        e.preventDefault();
        k.go(k.step - 1);
      } else if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        if (k.step >= k.last) return;
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
        <StickerLink href={story.paths.list} size="sm">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={2.25} />
          Case files
        </StickerLink>
        <p className="num inline-flex h-8 items-center rounded-full border-2 border-game-ink bg-game-paper px-3 text-[13px] font-semibold text-game-ink shadow-[var(--game-shadow-sm)]">
          <span className="max-[359px]:hidden">Panel&nbsp;</span>
          {step + 1}/{labels.length}
        </p>
        <StickerButton size="sm" onClick={skip} aria-keyshortcuts="Escape" className={done ? "invisible" : ""}>
          Skip intro
        </StickerButton>
      </header>

      <h1 className="sr-only">
        Case file {story.number}: {story.title}
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
        <PanelLabels.Provider value={labels}>
          {story.panels.map(({ Content }, i) => (
            <li key={i} className={`min-h-0 ${i === step ? "" : "max-md:hidden"}`}>
              {i <= step ? <Content /> : <EmptyFrame />}
            </li>
          ))}
        </PanelLabels.Provider>
      </ol>

      <footer className="flex flex-col items-center gap-2">
        {done ? (
          <StartBlock startRef={start} story={story} />
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
