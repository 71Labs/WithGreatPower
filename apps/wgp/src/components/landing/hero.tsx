import { COLUMN } from "@/components/frame";
import { StickerChip, StickerLink } from "@/components/game/kit";
import { ArrowRight } from "@/components/icons";
import { START_URL } from "@/lib/site";

import { HERO_HEADLINE, HERO_PITCH } from "./copy";
import { HeroLoop } from "./hero-loop";
import { LiveProof } from "./live-proof";

/** The three things a visitor needs to know before the tap. */
const FACTS = ["Free", "In your browser", "No wallet needed"] as const;

/**
 * The opener: the three facts, the world in two lines, one red action that goes straight into a
 * night, the live count, and the game itself in motion. On a phone the clip sits inside the
 * first screen, under the button.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="night relative isolate overflow-x-clip">
      <div
        className={`${COLUMN} grid items-center gap-8 px-4 pb-16 pt-8 sm:px-10 sm:pb-24 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14 lg:pb-28 lg:pt-20`}
      >
        <div className="flex flex-col items-start">
          <StickerChip className="max-w-full">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-game-hero" />
            <ul className="flex items-center gap-1.5">
              {FACTS.map((fact, i) => (
                <li key={fact} className="flex items-center gap-1.5">
                  {i > 0 ? <span aria-hidden className="text-game-muted">·</span> : null}
                  {fact}
                </li>
              ))}
            </ul>
          </StickerChip>
          <h1
            id="hero-title"
            className="mt-5 font-display text-[clamp(2.625rem,1.9rem+2.2vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.045em] sm:mt-7"
          >
            <span className="text-(--night-ink-faint)">{HERO_HEADLINE.lead}</span>
            <br />
            <span className="text-(--night-ink)">{HERO_HEADLINE.point}</span>
          </h1>
          <p className="mt-4 max-w-[46ch] text-[17px] leading-7 text-pretty sm:mt-6 sm:text-[18px] sm:leading-[30px]">
            {HERO_PITCH.lead}
            <span className="max-sm:hidden">{HERO_PITCH.more}</span>.
          </p>
          <div className="mt-6 flex w-full flex-col gap-3 sm:mt-9 sm:w-auto sm:flex-row">
            <StickerLink href={START_URL} variant="hero" size="lg" className="w-full sm:w-auto">
              Play now
              <ArrowRight aria-hidden strokeWidth={2.25} className="size-5" />
            </StickerLink>
            <StickerLink href="#night" variant="paper" size="lg" className="w-full max-sm:hidden sm:w-auto">
              See how a night plays
            </StickerLink>
          </div>
          <div className="mt-2 sm:mt-4">
            <LiveProof />
          </div>
          <p className="text-[14px] leading-5 max-sm:hidden">One tap puts you in the city as a guest. Sign in with Google later to rank.</p>
        </div>
        <HeroLoop />
      </div>
    </section>
  );
}
