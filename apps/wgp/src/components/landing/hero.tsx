import { COLUMN } from "@/components/frame";
import { StickerChip, StickerLink } from "@/components/game/kit";
import { ArrowRight } from "@/components/icons";
import { PLAY_URL } from "@/lib/site";

import { HeroLoop } from "./hero-loop";

/** The opener: the city at night, one parody line, one red action and the game itself. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="night relative isolate overflow-x-clip">
      <div
        className={`${COLUMN} grid items-center gap-12 px-4 pb-16 pt-12 sm:px-10 sm:pb-24 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14 lg:pb-28 lg:pt-20`}
      >
        <div className="flex flex-col items-start">
          <StickerChip>
            <span aria-hidden className="size-2 rounded-full bg-game-hero" />
            Free in your browser, now in 3D
          </StickerChip>
          <h1
            id="hero-title"
            className="mt-7 font-display text-[clamp(2.625rem,1.9rem+2.2vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.045em]"
          >
            <span className="text-(--night-ink-faint)">With great power</span>
            <br />
            <span className="text-(--night-ink)">comes great physics.</span>
          </h1>
          <p className="mt-6 max-w-[46ch] text-[17px] leading-7 sm:text-[18px] sm:leading-[30px]">
            A free-roam 3D web-swinging game in a comic-book city. Swing on real rope physics, web up four villains,
            help the neighbors, and bank a night the server replays before it ranks you.
          </p>
          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <StickerLink href={PLAY_URL} variant="hero" size="lg" className="w-full sm:w-auto">
              Play now
              <ArrowRight aria-hidden strokeWidth={2.25} className="size-5" />
            </StickerLink>
            <StickerLink href="#night" variant="paper" size="lg" className="w-full sm:w-auto">
              See how a night plays
            </StickerLink>
          </div>
          <p className="mt-5 text-[14px] leading-5">Play as a guest right away. Sign in with a NEAR wallet to rank.</p>
        </div>
        <HeroLoop />
      </div>
    </section>
  );
}
