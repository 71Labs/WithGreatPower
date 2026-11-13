import Image from "next/image";
import type { ReactNode } from "react";

import { Chip, InlineTwoTone, Section } from "@/components/frame";
import { Gamepad, Headphones, Smartphone } from "@/components/icons";

import { ERRAND_CAPTION, FIGHT_PANEL, NIGHT_HEADING, NIGHT_INTRO, SOUNDTRACK_FACT, TIERS_FACT } from "./copy";

interface Panel {
  id: string;
  /** The comic caption in the panel's corner. */
  caption: string;
  title: string;
  body: string;
  src: string;
  alt: string;
  /** Spans two of the three columns on wide screens. */
  wide: boolean;
  /** Keeps the action in frame when the panel crops the still. */
  focus: string;
}

/** One night, as a comic page: four panels, each a still from a real night. */
const panels: Panel[] = [
  {
    id: "swing",
    caption: "Between every stop",
    title: "Swing",
    body: "Hold to shoot a web, let go on the rise. Release in the sweet spot for a Perfect, and string Perfects into a combo that pays off in your next fight.",
    src: "/media/night/swing.webp",
    alt: "The hero swings between apartment towers as a Perfect! burst pops beside him.",
    wide: true,
    focus: "50% 45%",
  },
  {
    id: "fight",
    caption: FIGHT_PANEL.caption,
    title: "Fight",
    body: FIGHT_PANEL.body,
    src: "/media/night/fight.webp",
    alt: "Sandwich Man on a rooftop as the hero lands a hit: Zap! Wham!",
    wide: false,
    focus: "56% 50%",
  },
  {
    id: "errand",
    caption: ERRAND_CAPTION,
    title: "Help the neighbors",
    body: "Aunt Mainnet, Uncle Gen, Mary Jpeg, Bearson and Gwei each need a hand. What you choose moves your responsibility and reputation.",
    src: "/media/night/errand.webp",
    alt: "Gwei Stacy waits on a water tower. Her errand card: she’ll swing in once tonight if you call.",
    wide: false,
    focus: "50% 60%",
  },
  {
    id: "banked",
    caption: "Night’s end",
    title: "Bank the night",
    body: "Signed in, your night goes to the server, which replays your inputs, agrees on a score and ranks it. Verified nights pay Bits for the market.",
    src: "/media/night/banked.webp",
    alt: "The night’s results: verified and ranked, 7,230 points from the server, first on tonight’s board.",
    wide: true,
    focus: "50% 0%",
  },
];

function NightPanel({ p, index }: { p: Panel; index: number }) {
  return (
    <li
      className={`flex flex-col overflow-hidden rounded-[22px] border-[2.5px] border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow)] ${p.wide ? "lg:col-span-2" : ""}`}
    >
      <div className="relative aspect-video border-b-[2.5px] border-game-ink bg-game-night lg:aspect-auto lg:h-[300px] xl:h-[340px]">
        <Image
          src={p.src}
          alt={p.alt}
          fill
          sizes={p.wide ? "(min-width: 1320px) 820px, (min-width: 1024px) 64vw, calc(100vw - 32px)" : "(min-width: 1320px) 400px, (min-width: 1024px) 32vw, calc(100vw - 32px)"}
          className="object-cover"
          style={{ objectPosition: p.focus }}
        />
        <p className="absolute bottom-3 left-3 flex items-center gap-2 rounded-[10px] border-2 border-game-ink bg-game-gold px-2.5 py-1.5 text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-game-ink shadow-[var(--game-shadow-sm)]">
          <span className="num">{index + 1}</span>
          <span aria-hidden className="h-3 w-px bg-game-ink/40" />
          {p.caption}
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5 sm:p-6">
        <h3 className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em] text-game-ink">{p.title}</h3>
        <p className="max-w-[60ch] text-[15px] leading-6 text-game-muted">{p.body}</p>
      </div>
    </li>
  );
}

const facts: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Gamepad strokeWidth={2} />,
    title: "Keyboard, mouse or touch",
    body: "WASD and Space at a desk. On a phone, hold the right side of the screen to web.",
  },
  {
    icon: <Smartphone strokeWidth={2} />,
    title: "Built for phones too",
    body: TIERS_FACT,
  },
  {
    icon: <Headphones strokeWidth={2} />,
    title: "A full original soundtrack",
    body: SOUNDTRACK_FACT,
  },
];

export function Night() {
  return (
    <Section id="night" labelledBy="night-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="flex flex-col items-start">
        <Chip>How a night plays</Chip>
        <InlineTwoTone id="night-title" className="mt-6 max-w-[22ch]" lead={NIGHT_HEADING.lead} point={NIGHT_HEADING.point} />
        <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-ink-subtle">
          {NIGHT_INTRO}
        </p>
      </div>

      <ol className="mt-14 grid gap-6 sm:mt-16 lg:grid-cols-3 lg:gap-7">
        {panels.map((p, i) => (
          <NightPanel key={p.id} p={p} index={i} />
        ))}
      </ol>

      <ul className="mt-16 grid gap-8 sm:mt-20 md:grid-cols-3 md:gap-10">
        {facts.map((f) => (
          <li key={f.title} className="flex gap-4">
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] [&>svg]:size-5"
            >
              {f.icon}
            </span>
            <div className="flex min-w-0 flex-col gap-1 pt-0.5">
              <h3 className="text-[16px] font-medium leading-6 tracking-[-0.01em]">{f.title}</h3>
              <p className="text-[15px] leading-6 text-ink-subtle">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
