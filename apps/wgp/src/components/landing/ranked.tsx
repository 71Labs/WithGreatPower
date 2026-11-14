import type { ReactNode } from "react";

import { Chip, InlineTwoTone, Section } from "@/components/frame";
import { StickerLink } from "@/components/game/kit";
import { ArrowRight, Replay } from "@/components/icons";

/** What happens to a ranked night between the last swing and the board. */
const steps = [
  {
    title: "The server deals the night",
    body: "A ranked run starts from a seed the server issues and keeps, and ranked starts are capped each day. Your score has to come from the city you were dealt.",
  },
  {
    title: "Your inputs, not your score",
    body: "The game records your stick and buttons frame by frame, a few kilobytes a night, and sends that instead of a number.",
  },
  {
    title: "Replayed, then ranked",
    body: "The server runs the same deterministic simulation over your inputs and checks the clock and the checkpoints. If it agrees, the night is scored and ranked.",
  },
];

const boards: { name: string; detail: ReactNode }[] = [
  { name: "Tonight", detail: "Your best night today. Resets at midnight UTC." },
  {
    name: "Season",
    detail: (
      <>
        Your nightly bests, added up. Season 1 runs <span className="whitespace-nowrap">Nov 5–14</span>.
      </>
    ),
  },
  { name: "All time", detail: "The best single night anyone has played." },
];

export function Ranked() {
  return (
    <Section id="ranked" labelledBy="ranked-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 xl:gap-24">
        <div className="flex flex-col items-start">
          <Chip>Verified leaderboards</Chip>
          <InlineTwoTone id="ranked-title" className="mt-6 max-w-[18ch]" lead="Every ranked night" point="is replayed on the server." />
          <p className="mt-5 max-w-[56ch] text-[17px] leading-7 text-ink-subtle">
            The browser is trusted for nothing. Your score is whatever the server sees when it plays your night back.
          </p>

          <ol className="mt-12 flex flex-col gap-8">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4 sm:gap-5">
                <span
                  aria-hidden
                  className="num grid size-10 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-[15px] font-bold leading-none text-game-ink shadow-[var(--game-shadow-sm)]"
                >
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5 pt-1">
                  <h3 className="font-display text-[19px] font-medium leading-6 tracking-[-0.015em]">{s.title}</h3>
                  <p className="max-w-[54ch] text-[15px] leading-6 text-ink-subtle">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-6 self-center">
          <div className="rounded-[22px] border-[2.5px] border-game-ink bg-game-paper p-3 text-game-ink shadow-[var(--game-shadow)] [--vs-focus:var(--game-hero)]">
            <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-2">
              <h3 className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em] text-game-ink">Three boards</h3>
              <span className="text-[13px] font-medium leading-5 text-game-muted">Ties go to the faster run</span>
            </div>
            <ul className="flex flex-col gap-2">
              {boards.map((b, i) => (
                <li
                  key={b.name}
                  className={`flex flex-col gap-0.5 rounded-[10px] px-4 py-3.5 sm:flex-row sm:items-baseline sm:gap-4 ${i === 0 ? "bg-game-gold ring-2 ring-game-ink" : "bg-game-paper-2"}`}
                >
                  <span className="w-20 shrink-0 text-[15px] font-bold leading-6">{b.name}</span>
                  <span className={`text-[14px] leading-5 ${i === 0 ? "text-game-ink" : "text-game-muted"}`}>{b.detail}</span>
                </li>
              ))}
            </ul>
            <div className="px-1 pb-1 pt-4">
              <StickerLink href="/play/leaderboard" variant="ink" size="md" className="w-full">
                See tonight’s board
                <ArrowRight aria-hidden strokeWidth={2.25} className="size-[18px]" />
              </StickerLink>
            </div>
          </div>

          <p className="flex gap-3 px-1 text-[14px] leading-[22px] text-ink-subtle">
            <Replay aria-hidden strokeWidth={2} className="mt-0.5 size-5 shrink-0 text-ink-strong" />
            <span>
              Don’t take our word for it: any verified run’s seed and inputs are public at{" "}
              <code className="hash rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-[13px] text-ink-strong">/api/runs/&lt;id&gt;/replay</code>
              , so you can replay it yourself.
            </span>
          </p>
        </div>
      </div>
    </Section>
  );
}
