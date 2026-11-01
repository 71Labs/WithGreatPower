import { AsciiTerrain } from "@/components/art/ascii";
import { Chip, Section, TwoTone } from "@/components/frame";
import { LinkButton } from "@/components/ui";
import { PLAY_URL } from "@/lib/site";

/** The last word: one line, two buttons, and the city again, drawn in ASCII. */
export function Closing() {
  return (
    <Section id="play" labelledBy="closing-title" className="overflow-x-clip" inner="px-4 pt-24 sm:px-10 sm:pt-32">
      <div className="relative z-[1] flex flex-col items-center gap-6 text-center">
        <Chip>Suit up</Chip>
        <TwoTone id="closing-title" lead="The city needs" point="a friendly neighborhood hero." />
        <p className="text-[17px] leading-7 text-ink-subtle">Pick your powers in under a minute. The villains are already out.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <LinkButton href={PLAY_URL} size="lg">
            Play now
          </LinkButton>
          <LinkButton href="#cast" size="lg" variant="secondary">
            Meet the cast
          </LinkButton>
        </div>
      </div>
      {/* Full-bleed band: break out of the content column to the viewport edges. */}
      <AsciiTerrain
        variant="skyline"
        className="-mt-16 ml-[calc(50%-50vw)] h-[360px] w-screen [mask-image:linear-gradient(to_bottom,transparent,black_35%)] sm:-mt-24 sm:h-[520px]"
        fontSize={11}
        seed={4}
        lift={0}
      />
    </Section>
  );
}
