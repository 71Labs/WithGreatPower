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
 * The comic's frames, keys and start block are the generic CaseIntro's (case-intro.tsx).
 */
import { StickerFrame } from "@/components/game/kit";
import { AVATARS } from "@/components/cast";
import { KeyRound } from "@/components/icons";
import { CASE_003, CASE_003_PATHS, GAS_GOBLIN } from "@/lib/cases/content-003";

import { Caption, CaseIntro, Panel, type IntroStory } from "../case-intro";
import { CaseStamp, RugFront } from "../shared";
import { ColdWindowPhoto, DarkSignQueueArt, FeeMeterArt } from "./art";

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

const STORY: IntroStory = {
  id: CASE_003.id,
  number: CASE_003.number,
  title: CASE_003.title,
  panels: [
    { label: "The Daily Rug’s front page", Content: FrontPagePanel },
    { label: "Outside Aunt Mainnet’s", Content: QueuePanel },
    { label: "J. Jonah Bearson", Content: BearsonPanel },
    { label: "Case file 003", Content: CaseFilePanel },
  ],
  paths: CASE_003_PATHS,
};

/** Case file 003's intro: the generic comic (components/cases/case-intro.tsx) with its own four panels. */
export function FeeStrikeIntro() {
  return <CaseIntro story={STORY} />;
}
