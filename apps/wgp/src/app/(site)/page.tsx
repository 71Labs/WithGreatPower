import Link from "next/link";
import { ArrowRight } from "@/components/icons";

import { HeroSkyline } from "@/components/art/hero-skyline";
import { BuiltOn } from "@/components/built-on";
import { COLUMN, Chip, Section, TwoTone } from "@/components/frame";
import { Cast } from "@/components/landing/cast";
import { Closing } from "@/components/landing/closing";
import { DailyRug } from "@/components/landing/daily-rug";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { HeroCard } from "@/components/landing/hero-card";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { LinkButton } from "@/components/ui";
import type { CastId } from "@/content/cast";
import { PLAY_URL } from "@/lib/site";

/** What's happening in the city right now, pinned around the hero card. Illustrative. */
const alerts: { id: CastId; title: string; detail: string; place: string }[] = [
  {
    id: "gas-goblin",
    title: "Gas Goblin spotted",
    detail: "Sector 7 · fees up 400%",
    place: "xl:right-[calc(100%-20px)] xl:top-16",
  },
  {
    id: "sandwich-man",
    title: "Sandwich Man in the mempool",
    detail: "2 trades sandwiched",
    place: "xl:left-[calc(100%-20px)] xl:top-[42%]",
  },
  {
    id: "bearson",
    title: "The Daily Rug, page 1",
    detail: "“The Node: hero or menace?”",
    place: "xl:right-[calc(100%-20px)] xl:bottom-16",
  },
];

/** A white chip floating beside the hero card, like a notification over a product shot. */
function Alert({ id, title, detail, className = "" }: { id: CastId; title: string; detail: string; className?: string }) {
  return (
    <li className={`flex items-center gap-3 rounded-[14px] bg-canvas p-2 pr-4 text-left shadow-[var(--shadow-float)] ${className}`}>
      <MiniAvatar id={id} className="size-10 rounded-[10px]" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium leading-4 text-ink-strong">{title}</span>
        <span className="hash text-[11px] leading-4 text-ink-subtle">{detail}</span>
      </span>
    </li>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-x-clip">
      {/* A dithered night city rises behind the whole hero: sky behind the headline, towers under the card. */}
      <HeroSkyline className="absolute inset-0 -z-10" />
      <div className={`${COLUMN} flex flex-col items-center px-4 pb-8 pt-14 text-center sm:px-10 sm:pb-10 sm:pt-20`}>
        <div className="animate-rise">
          <Chip>
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            A friendly neighborhood parody, on NEAR
          </Chip>
        </div>
        <TwoTone
          as="h1"
          id="hero-title"
          size="hero"
          lead="With great power"
          point="comes great responsibility."
          className="animate-rise mt-7 max-sm:text-[2.5rem]! [animation-delay:60ms]"
        />
        <p className="animate-rise mt-6 max-w-[54ch] text-[17px] leading-7 text-ink-subtle [animation-delay:120ms] sm:text-[18px] sm:leading-[30px]">
          WGP is a superhero parody game on NEAR. Get bitten by a radioactive validator, pick your powers and swing
          across the city to stop the villains draining its treasury. Your hero and everything you catch are yours to
          keep.
        </p>
        <div className="animate-rise mt-9 flex flex-col items-center gap-4 [animation-delay:180ms]">
          <div className="flex flex-wrap justify-center gap-3">
            <LinkButton href={PLAY_URL} size="lg">
              Play now
            </LinkButton>
            <LinkButton href="#cast" size="lg" variant="secondary">
              Meet the cast
            </LinkButton>
          </div>
          <Link
            href="#rug"
            className="inline-flex min-h-10 items-center gap-1.5 text-[14px] font-medium text-ink-subtle hover:text-ink-strong"
          >
            Read today’s Daily Rug
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </div>

      {/* The hero card floats over the city, with what's happening tonight pinned around it. */}
      <div className="relative">
        <div className={`${COLUMN} px-4 pb-16 pt-[clamp(24px,4vw,64px)] sm:px-10 sm:pb-28`}>
          <div className="relative mx-auto max-w-[720px]">
            <div className="animate-rise rounded-panel bg-canvas/70 p-2 shadow-[var(--shadow-float)] backdrop-blur-md [animation-delay:240ms]">
              <HeroCard />
            </div>
            <ul
              aria-label="Tonight in the city"
              className="mt-4 flex flex-col items-center gap-2.5 xl:pointer-events-none xl:absolute xl:inset-0 xl:m-0 xl:block"
            >
              {alerts.map((a) => (
                <Alert
                  key={a.title}
                  {...a}
                  className={`w-full max-w-[340px] xl:pointer-events-auto xl:absolute xl:w-max xl:max-w-none xl:whitespace-nowrap ${a.place}`}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <Hero />

      <Section inner="" labelledBy="built-on">
        <BuiltOn />
      </Section>

      <Section inner="px-4 py-20 sm:px-10 sm:py-32">
        <p className="mx-auto max-w-[1040px] font-display text-[clamp(1.625rem,1.05rem+1.9vw,2.625rem)] font-medium leading-[1.24] tracking-[-0.03em]">
          <span className="text-ink-faint">
            Every superhero game makes you grind for a suit you never get to keep. Log off, and it all belongs to the
            studio.
          </span>{" "}
          <span className="text-ink-strong">
            In WGP your hero, your powers and every villain you catch live on NEAR, so what you earn is yours: trade it,
            lend it to a friend, or retire it a legend.
          </span>
        </p>
      </Section>

      <Cast />
      <FeatureShowcase />
      <HowItWorks />
      <DailyRug />
      <Closing />
    </>
  );
}
