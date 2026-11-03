import Image from "next/image";
import Link from "next/link";

import { Chip, InlineTwoTone, Section } from "@/components/frame";
import { ArrowRight } from "@/components/icons";
import { castById, type CastId, type Role } from "@wgp/game-core/cast";

/**
 * Stills of the 3D cast, captured from /lab/cast: the hero, the four villains, then the
 * neighbors. The file is the body's name in the game's model folder.
 */
const STILLS: { id: CastId; file: string; alt: string }[] = [
  { id: "node", file: "hero", alt: "The Node’s 3D body in the red web suit, standing on a rooftop" },
  { id: "gas-goblin", file: "gas-goblin", alt: "Gas Goblin, purple-hooded, riding his yellow glider" },
  { id: "sandwich-man", file: "sandwich-man", alt: "Sandwich Man, a burger head on a black suit, squaring up" },
  { id: "doc-octochain", file: "doc-octochain", alt: "Doc Octochain in a green coat, held up by four chain arms" },
  { id: "sybil", file: "sybil", alt: "The Sybil in black, with one of his copies at his shoulder" },
  { id: "aunt-mainnet", file: "aunt-mainnet", alt: "Aunt Mainnet in a lilac dress and pearls, waving" },
  { id: "uncle-gen", file: "uncle-gen", alt: "Uncle Gen in a brown cardigan, mid-sentence" },
  { id: "mary-jpeg", file: "mary-jpeg", alt: "Mary Jpeg with blocky pixel hair, waving" },
  { id: "bearson", file: "bearson", alt: "J. Jonah Bearson, a bear in a suit and red tie, chewing a cigar" },
  { id: "gwei", file: "gwei", alt: "Gwei Stacy in a white mask, crouched on a perch" },
];

/** Role is said in words, never by color alone; villains also get the accent. */
const roleTone: Record<Role, string> = {
  Hero: "text-ink-strong",
  Ally: "text-ink-subtle",
  Press: "text-ink-subtle",
  Villain: "text-accent",
};

export function Cast() {
  return (
    <Section id="cast" labelledBy="cast-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col items-start">
          <Chip>The cast</Chip>
          <InlineTwoTone id="cast-title" className="mt-6 max-w-[20ch]" lead="Real bodies," point="comic-book ink." />
          <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-ink-subtle">
            Every character is a MakeHuman body moved by CC0 motion capture, cel-shaded in hard bands and outlined in
            ink like the rest of the city. All ten are original parodies.
          </p>
        </div>
        <Link
          href="/lab/cast"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start text-[15px] font-medium text-ink-strong underline decoration-hairline-strong underline-offset-4 lg:self-auto [@media(hover:hover)]:hover:decoration-current"
        >
          Watch them move in the cast lab
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      <ul className="mt-14 grid grid-cols-2 gap-x-4 gap-y-10 sm:mt-16 sm:gap-x-6 lg:grid-cols-5 lg:gap-y-14">
        {STILLS.map(({ id, file, alt }) => {
          const c = castById(id);
          return (
            <li key={id} className="flex min-w-0 flex-col">
              <div className="rounded-[22px] bg-white p-1.5 shadow-[var(--game-shadow)] ring-2 ring-game-ink">
                <div className="relative aspect-[4/5] overflow-hidden rounded-[16px] bg-game-night">
                  <Image
                    src={`/media/cast/${file}.webp`}
                    alt={alt}
                    fill
                    sizes="(min-width: 1320px) 230px, (min-width: 1024px) 18vw, calc(50vw - 28px)"
                    className="object-cover"
                  />
                </div>
              </div>
              <h3 className="mt-4 font-display text-[18px] font-medium leading-6 tracking-[-0.02em]">{c.name}</h3>
              <p className={`mt-0.5 text-[13px] font-medium leading-5 ${roleTone[c.role]}`}>{c.role}</p>
              <p className="mt-1.5 text-[14px] leading-5 text-ink-subtle">{c.line}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
