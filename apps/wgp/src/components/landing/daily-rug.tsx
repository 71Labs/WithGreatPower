import { Chip, InlineTwoTone, Section } from "@/components/frame";
import type { CastId } from "@/content/cast";

import { MiniAvatar } from "./mini-avatar";

interface Story {
  headline: string;
  dek: string;
  page: string;
  who: CastId;
}

/** Front-page stories, written the way the in-game paper writes them. */
const stories: Story[] = [
  {
    headline: "Web-head strikes again",
    dek: "Masked validator ties Gas Goblin to a lamppost. Fees fall 90%; editor unimpressed",
    page: "Page 1",
    who: "node",
  },
  {
    headline: "Who is Sandwich Man?",
    dek: "Readers report trades eaten from both sides. Police baffled, bread consulted",
    page: "Page 2",
    who: "sandwich-man",
  },
  {
    headline: "Aunt Mainnet: still up",
    dek: "Local aunt marks 1,000 days without downtime, credits early nights and a good loaf",
    page: "Page 6",
    who: "aunt-mainnet",
  },
  {
    headline: "Bears were right",
    dek: "Editor reminds everyone he called it, again, about something, probably",
    page: "Opinion",
    who: "bearson",
  },
];

function StoryCard({ s }: { s: Story }) {
  return (
    <li className="flex flex-col gap-4 rounded-card bg-canvas p-6 shadow-[var(--shadow-panel)] sm:p-7">
      <p className="flex items-center justify-between gap-3 border-b border-ink-strong pb-2.5 font-display text-[12px] font-semibold uppercase leading-4 tracking-[0.12em] text-ink-strong">
        The Daily Rug
        <span className="hash font-normal normal-case tracking-normal text-ink-subtle">{s.page}</span>
      </p>
      <p className="font-display text-[30px] font-semibold uppercase leading-[30px] tracking-[-0.02em] text-ink-strong [text-wrap:balance]">
        {s.headline}
      </p>
      <p className="flex-1 text-[15px] leading-6 text-ink-subtle">{s.dek}.</p>
      <MiniAvatar id={s.who} className="size-10 rounded-[11px]" />
    </li>
  );
}

export function DailyRug() {
  return (
    <Section id="rug" labelledBy="rug-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="flex flex-col items-start">
        <Chip>The Daily Rug</Chip>
        <InlineTwoTone id="rug-title" className="mt-6 max-w-[22ch]" lead="Today’s front page:" point="hero or menace?" />
        <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-ink-subtle">
          J. Jonah Bearson runs the city’s least trusted newspaper. Every edition is written from what players did the
          night before, so your best patrol might be tomorrow’s scandal.
        </p>
      </div>
      <ul className="mt-14 grid gap-4 sm:mt-16 sm:grid-cols-2 xl:grid-cols-4">
        {stories.map((s) => (
          <StoryCard key={s.headline} s={s} />
        ))}
      </ul>
    </Section>
  );
}
