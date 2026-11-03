import { COLUMN } from "@/components/frame";
import { StickerLink } from "@/components/game/kit";
import { ArrowRight, Github } from "@/components/icons";
import { PLAY_URL, REPO_URL } from "@/lib/site";

/** The last word, back in the night sky: one line and the red button. */
export function Closing() {
  return (
    <section id="play" aria-labelledby="closing-title" className="night">
      <div className={`${COLUMN} flex flex-col items-center gap-6 px-4 py-24 text-center sm:px-10 sm:py-32`}>
        <h2
          id="closing-title"
          className="font-display text-[clamp(2rem,1.3rem+2.4vw,3.25rem)] font-medium leading-[1.06] tracking-[-0.04em]"
        >
          <span className="text-(--night-ink-faint)">The city needs</span>
          <br />
          <span className="text-(--night-ink)">a friendly neighborhood hero.</span>
        </h2>
        <p className="max-w-[44ch] text-[17px] leading-7">
          Gas Goblin is already out. Swing in as a guest, or sign in with Google or a NEAR wallet to make the board.
        </p>
        <div className="mt-3 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <StickerLink href={PLAY_URL} variant="hero" size="lg" className="w-full sm:w-auto">
            Play now
            <ArrowRight aria-hidden strokeWidth={2.25} className="size-5" />
          </StickerLink>
          <StickerLink href={REPO_URL} variant="paper" size="lg" className="w-full sm:w-auto">
            <Github aria-hidden strokeWidth={2} className="size-5" />
            Read the source
          </StickerLink>
        </div>
      </div>
    </section>
  );
}
