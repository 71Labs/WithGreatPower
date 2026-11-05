"use client";

/**
 * /play/cases/002, "The Sybil Vote": the intro comic (case-intro.tsx draws the page, turns it
 * and starts the case), four panels:
 *
 * 1. The Daily Rug's front page: "Turnout: 10,000%".
 * 2. The line at the polling station: the same man, five times, "We're all here to vote."
 * 3. Bearson: "Find the real one. Then find me a headline."
 * 4. The case file, stamped 002: the facts, the suspect, Uncle Gen's line and your job.
 */
import { StickerFrame } from "@/components/game/kit";
import { AVATARS } from "@/components/cast";
import { CASE_002, CASE_002_PATHS, SYBIL } from "@/lib/cases/content-002";

import { Caption, CaseIntro, Panel, type IntroStory } from "../case-intro";
import { CaseStamp, RugFront } from "../shared";
import { GenPhoto, SybilLine, SybilPhoto } from "./art";

function FrontPagePanel() {
  return (
    <Panel n={0} ground="bg-game-paper">
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <Caption>Polling day…</Caption>
        <RugFront
          size="panel"
          headingLevel="h2"
          headline={CASE_002.gone.headline}
          dateline={["Late edition", CASE_002.district]}
          photo={<SybilLine count={4} alt="Four identical voters in a queue, grey and glossy, all grinning the same grin." />}
          caption={CASE_002.gone.caption}
          dek={CASE_002.gone.dek}
        />
        <p className="mt-auto border-t-2 border-game-ink pt-2 text-[12px] font-semibold leading-4 text-game-muted">Continued on page 2: “Is it still a landslide if it’s one guy?”</p>
      </div>
    </Panel>
  );
}

function LinePanel() {
  return (
    <Panel n={1} ground="bg-game-night">
      {/* Floor tiles of the roof under the booths. Decorative. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(var(--game-ink)_2px,transparent_2px),linear-gradient(90deg,var(--game-ink)_2px,transparent_2px)] [background-size:36px_36px]"
      />
      <div className="relative flex flex-1 flex-col gap-3 p-3.5">
        <Caption>{CASE_002.line.caption}</Caption>
        <div className="relative flex flex-1 flex-col justify-center gap-3 py-2">
          <blockquote className="relative self-start rounded-[18px] border-[2.5px] border-game-ink bg-game-paper px-3 py-2 shadow-[var(--game-shadow-sm)]">
            <p className="font-display text-[18px] font-bold leading-[22px] tracking-[-0.01em] text-game-ink">“{CASE_002.line.bubble}”</p>
            <svg aria-hidden width="22" height="16" viewBox="0 0 22 16" className="absolute -bottom-[14px] left-8 block">
              <path d="M2 0 L20 0 L6 14 Z" fill="var(--game-paper)" />
              <path d="M2 1 L6 14 L20 1" fill="none" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
          </blockquote>
          <div className="h-[132px] sm:h-[150px]">
            <SybilLine count={5} pick={2} alt="Five identical voters in a line. One of them, the third, is in full colour: the original." />
          </div>
        </div>
        <Caption className="self-end">{CASE_002.line.aside}</Caption>
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
        <blockquote className="relative mt-1 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper px-4 py-3 shadow-[var(--game-shadow-sm)]">
          <p className="font-display text-[22px] font-bold leading-[26px] tracking-[-0.02em] text-game-ink text-balance">“{CASE_002.bearsonLine}”</p>
          <svg aria-hidden width="28" height="22" viewBox="0 0 28 22" className="absolute -bottom-[19px] right-12 block">
            <path d="M2 0 L26 0 L20 20 Z" fill="var(--game-paper)" />
            <path d="M2 1 L20 20 L26 1" fill="none" stroke="var(--game-ink)" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </blockquote>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <p className="max-w-[16ch] rounded-[14px] border-2 border-dashed border-game-ink/50 bg-game-paper px-2.5 py-1.5 text-[13px] font-medium leading-[18px] text-game-ink">
            {CASE_002.bearsonAside}
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
          <h2 className="pt-1 font-display text-[24px] font-bold leading-[26px] tracking-[-0.02em] text-game-ink text-balance">{CASE_002.title}</h2>
          <CaseStamp number={CASE_002.number} className="mr-1 mt-2 shrink-0 bg-game-folder/60" />
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-[18px] text-game-ink">
          {CASE_002.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center gap-3 rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper/60 p-2.5">
          <span className="block size-[64px] shrink-0 overflow-hidden rounded-[16px] border-2 border-game-ink">
            <SybilPhoto alt="" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-hero">Suspect</p>
            <p className="text-[16px] font-bold leading-5 text-game-ink">{SYBIL.name}</p>
            <p className="text-[13px] italic leading-[18px] text-game-muted">“{SYBIL.tagline}”</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[14px] border-2 border-game-ink bg-game-paper p-2.5">
          <span className="block size-[52px] shrink-0 overflow-hidden rounded-full border-2 border-game-ink">
            <GenPhoto alt="" />
          </span>
          <p className="text-[13px] font-medium leading-[18px] text-game-ink text-pretty">
            <span className="font-bold">{CASE_002.gen.name}:</span> “{CASE_002.gen.line}”
          </p>
        </div>
        <div className="mt-auto flex flex-col gap-2 rounded-[12px] border-2 border-game-ink bg-game-paper p-3">
          <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink">Your job</p>
          <ol className="flex flex-col gap-1.5 text-[14px] leading-5 text-game-ink">
            {CASE_002.steps.map((s, i) => (
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

const STORY: IntroStory = {
  id: CASE_002.id,
  number: CASE_002.number,
  title: CASE_002.title,
  panels: [
    { label: "The Daily Rug’s front page", Content: FrontPagePanel },
    { label: "The line at the polling station", Content: LinePanel },
    { label: "J. Jonah Bearson", Content: BearsonPanel },
    { label: "Case file 002", Content: CaseFilePanel },
  ],
  paths: CASE_002_PATHS,
};

export function Case002Intro() {
  return <CaseIntro story={STORY} />;
}
