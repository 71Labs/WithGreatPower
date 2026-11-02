"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { playVoice } from "@/audio/player";
import { HeroArt } from "@/components/cast";
import { ON_PAPER, StickerButton, StickerFrame, StickerIconButton, StickerPanel } from "@/components/game/kit";
import { GameLoading } from "@/components/game/ui";
import { ArrowLeft, ArrowRight, Check, CircleAlert, City, Heart, Swords, Zap } from "@/components/icons";
import { POWERS, STARTER_POWERS, SUITS } from "@wgp/game-core/data";
import { useGame } from "@/game/store";
import type { PowerId, SuitId } from "@wgp/game-core/types";

import { Mark, SELECT_CARD, SELECT_CARD_OFF, SELECT_CARD_ON } from "./controls";
import { HeroCardPreview } from "./hero-card";
import { POWER_ICONS, PowerFacts } from "./powers";

const NAME_MAX = 24;
const PICKS = 3;
const STARTER_SUITS = (Object.keys(SUITS) as SuitId[]).filter((id) => SUITS[id].starter);
const SUGGESTIONS = ["The Node", "Web3 Crawler", "Peter Parquet", "Captain Finality", "Miles Mempool", "Gwen Gas"];
const STEPS = ["Name", "Suit", "Powers", "Confirm"] as const;

/** What the first night holds, on the confirm step. */
const FIRST_NIGHT = [
  { icon: City, text: "Four stops across the city, one swing at a time." },
  { icon: Swords, text: "Catch villains and keep the loot they drop." },
  { icon: Heart, text: "Help your neighbors. Responsibility goes up, slowly." },
];

/** Intro, then the four steps. */
type Step = 0 | 1 | 2 | 3 | 4;

function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Give your hero a name. Even “The Node” will do.";
  if (name.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters. That one is ${name.length}.`;
  return null;
}

/* ------------------------------------------------------------------ chrome */

const backClass =
  "grid size-12 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2";

/** The flow's only way back: to the website from the intro, to the last step after it. */
function TopBar({ step, onBack }: { step: Step; onBack: () => void }) {
  return (
    <div className="sticky top-0 z-20 bg-[linear-gradient(to_bottom,var(--game-night)_55%,transparent)] px-3 pb-4 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
      <div className="mx-auto flex max-w-[1040px] items-center gap-3">
        {step === 0 ? (
          <Link href="/" aria-label="Back to the website" className={backClass}>
            <ArrowLeft aria-hidden className="size-5" strokeWidth={2.25} />
          </Link>
        ) : (
          <StickerIconButton label="Back" size="lg" onClick={onBack}>
            <ArrowLeft strokeWidth={2.25} />
          </StickerIconButton>
        )}
        {step > 0 ? <Progress step={step} /> : null}
      </div>
    </div>
  );
}

function Progress({ step }: { step: Step }) {
  return (
    <ol aria-label="Progress" className="flex h-12 min-w-0 items-center gap-1 rounded-full border-2 border-game-ink bg-game-paper p-1 text-game-ink shadow-[var(--game-shadow-sm)]">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={`flex h-full items-center gap-1.5 rounded-full pl-1 text-[13px] font-semibold leading-4 ${state === "current" ? "bg-game-ink pr-3 text-game-paper" : "pr-1"}`}
          >
            <span
              aria-hidden
              className={`num grid size-7 place-items-center rounded-full border-2 text-[12px] font-bold ${
                state === "done" ? "border-game-ink bg-game-gold text-game-ink" : state === "current" ? "border-game-paper" : "border-game-ink/30 text-game-muted"
              }`}
            >
              {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : n}
            </span>
            <span className={state === "current" ? "" : "sr-only"}>{label}</span>
            {state === "done" ? <span className="sr-only">, done</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The step's heading. It takes focus when the step mounts, so keyboard and screen
 * reader users land on the new step rather than on a button that has gone.
 */
function StepHeading({ lead, point }: { lead: ReactNode; point: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      className="max-w-[22ch] font-display text-[clamp(1.75rem,1.3rem+1.8vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-game-ink [@media(max-height:520px)]:max-w-none [@media(max-height:520px)]:text-[24px]"
    >
      <span className="text-game-muted">{lead}</span> {point}
    </h1>
  );
}

function StepIntro({ eyebrow, lead, point, lede, legend = false }: { eyebrow: string; lead: ReactNode; point: ReactNode; lede: ReactNode; legend?: boolean }) {
  const heading = <StepHeading lead={lead} point={point} />;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-hero">{eyebrow}</p>
      {legend ? <legend className="block w-full p-0">{heading}</legend> : heading}
      <p className="max-w-[56ch] text-[15px] leading-[22px] text-game-muted">{lede}</p>
    </div>
  );
}

/** The step's one action, pinned to the bottom of the screen while the step scrolls. */
function Actions({ status, submit = "Continue" }: { status?: ReactNode; submit?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-4 bg-[linear-gradient(to_top,var(--game-night)_60%,transparent)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-6 sm:-mx-6 sm:px-6 lg:bg-none">
      <div className="flex items-center gap-4">
        {status ? <div className="min-w-0 flex-1 text-[14px] font-medium leading-5 text-game-paper">{status}</div> : <div className="flex-1 max-sm:hidden" />}
        <StickerButton type="submit" variant="hero" size="lg" className="shrink-0 max-sm:flex-1">
          {submit}
          <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
        </StickerButton>
      </div>
    </div>
  );
}

function ErrorLine({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-[14px] font-semibold leading-5 text-game-hero">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ intro */

/** The origin moment: a comic narration box over the night city, and one big button. */
function Intro({ onStart }: { onStart: () => void }) {
  return (
    <section aria-labelledby="bitten-intro-title" className="mx-auto flex min-h-[calc(100dvh-96px)] w-full max-w-[560px] flex-col justify-center px-4 pb-10">
      <div className="relative">
        {/* The sound effect, stamped on after the box lands. Decorative. */}
        <span
          aria-hidden
          className="animate-seal pointer-events-none absolute -top-6 right-4 z-10 rotate-[-8deg] rounded-[12px] border-[2.5px] border-game-ink bg-game-hero px-4 py-1 font-display text-[28px] font-bold uppercase leading-9 tracking-[0.02em] text-game-paper shadow-[var(--game-shadow-sm)] [animation-delay:560ms]"
        >
          Chomp!
        </span>
        <StickerPanel className={`wgp-rise flex flex-col gap-4 p-6 sm:p-8 ${ON_PAPER}`}>
          <div className="flex items-center gap-3">
            <StickerFrame drop="sm" className="[--s:56px]">
              <HeroArt {...SUITS.classic.colors} />
            </StickerFrame>
            <p className="text-[13px] font-semibold leading-5 text-game-muted">Night 1 · Aunt Mainnet’s basement, 11:58 p.m.</p>
          </div>
          <h1 id="bitten-intro-title" className="font-display text-[clamp(2rem,1.5rem+2vw,2.75rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-game-ink">
            <span className="text-game-muted">A radioactive validator</span> bites you.
          </h1>
          <p className="text-[16px] leading-6 text-game-muted">
            You were only rebooting Aunt Mainnet’s node. Now your hands stick to walls, you feel blocks land before they do, and
            Uncle Gen has a speech ready about responsibility.
          </p>
          <StickerButton variant="hero" size="xl" onClick={onStart} className="mt-2 w-full">
            <Zap aria-hidden className="size-6" strokeWidth={2.25} />
            Get bitten
          </StickerButton>
          <p className="text-center text-[13px] leading-5 text-game-muted">Name, suit, powers. About a minute.</p>
        </StickerPanel>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ flow */

export function Bitten() {
  const { save, dispatch } = useGame();
  const router = useRouter();
  const hasHero = !!save?.hero;

  // Already bitten: this page has nothing for you.
  useEffect(() => {
    if (hasHero) router.replace("/play");
  }, [hasHero, router]);

  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameChecked, setNameChecked] = useState(false);
  const [suit, setSuit] = useState<SuitId>("classic");
  const [powers, setPowers] = useState<PowerId[]>([]);
  const [powersError, setPowersError] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);

  const ids = useId();
  const nameId = `${ids}-name`;
  const nameHintId = `${ids}-name-hint`;
  const nameErrorId = `${ids}-name-error`;
  const suggestId = `${ids}-suggest`;
  const powersErrorId = `${ids}-powers-error`;
  const cardTitleId = `${ids}-card-title`;
  const nameRef = useRef<HTMLInputElement>(null);
  const powersRef = useRef<HTMLFieldSetElement>(null);

  if (!save || hasHero) return <GameLoading />;

  const heroName = name.trim();
  const preview = heroName || "Your hero";
  const back = () => setStep((s) => (s > 0 ? ((s - 1) as Step) : s));

  if (step === 0) {
    return (
      <>
        <TopBar step={0} onBack={back} />
        <Intro
          onStart={() => {
            playVoice("narrator-bite");
            setStep(1);
          }}
        />
      </>
    );
  }

  function submitName(e: FormEvent) {
    e.preventDefault();
    const problem = nameProblem(name);
    setNameChecked(true);
    setNameError(problem);
    if (problem) {
      nameRef.current?.focus();
      return;
    }
    setStep(2);
  }

  function togglePower(id: PowerId) {
    if (powers.includes(id)) {
      setPowers(powers.filter((p) => p !== id));
      setNudge(false);
      setPowersError(null);
      return;
    }
    if (powers.length >= PICKS) {
      setNudge(true);
      return;
    }
    setPowers([...powers, id]);
    setNudge(false);
    setPowersError(null);
  }

  function submitPowers(e: FormEvent) {
    e.preventDefault();
    if (powers.length !== PICKS) {
      const left = PICKS - powers.length;
      setPowersError(`Pick ${left} more power${left === 1 ? "" : "s"}. The bite gave you three.`);
      powersRef.current?.querySelector<HTMLInputElement>("input:not(:checked)")?.focus();
      return;
    }
    setStep(4);
  }

  function start(e: FormEvent) {
    e.preventDefault();
    dispatch({ type: "create-hero", name: heroName, suit, powers });
    // Start fresh if this hero is ever deleted and the page shows again. The redirect
    // above takes over from here.
    setStep(0);
    setName("");
    setNameChecked(false);
    setNameError(null);
    setSuit("classic");
    setPowers([]);
  }

  const picked = powers.length;
  const counter = (
    <span role="status" className="num block">
      <span className="font-semibold">
        {picked} of {PICKS}
      </span>{" "}
      picked
      {nudge ? <span className="max-sm:block">. Uncheck one to swap</span> : null}
    </span>
  );

  const panel = `p-5 sm:p-8 ${ON_PAPER}`;

  return (
    <>
      <TopBar step={step} onBack={back} />
      <div className="wgp-rise mx-auto w-full max-w-[1040px] px-4 sm:px-6">
        {step === 1 ? (
          <form key="name" onSubmit={submitName} noValidate>
            <StickerPanel className={`${panel} grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center`}>
              <div className="flex min-w-0 flex-col gap-6">
                <StepIntro
                  eyebrow="Secret identity"
                  lead="Every hero needs"
                  point="a name."
                  lede="It goes on your hero card and on the front page of The Daily Rug. Bearson will misspell it either way."
                />
                <div className="flex flex-col gap-2">
                  <label htmlFor={nameId} className="text-[14px] font-semibold leading-5 text-game-ink">
                    Hero name
                  </label>
                  <div className="relative">
                    <input
                      ref={nameRef}
                      id={nameId}
                      name="hero-name"
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="words"
                      spellCheck={false}
                      required
                      maxLength={NAME_MAX}
                      value={name}
                      placeholder="The Node"
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={nameError ? `${nameErrorId} ${nameHintId}` : nameHintId}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (nameChecked) setNameError(nameProblem(e.target.value));
                      }}
                      className="h-14 w-full rounded-[16px] border-2 border-game-ink bg-game-paper-2 pl-4 pr-20 font-display text-[20px] font-semibold tracking-[-0.01em] text-game-ink placeholder:font-medium placeholder:text-game-muted/70 focus-visible:outline-offset-2 aria-invalid:border-game-hero"
                    />
                    <span aria-hidden className="num pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-medium leading-4 text-game-muted">
                      {name.length}/{NAME_MAX}
                    </span>
                  </div>
                  {nameError ? <ErrorLine id={nameErrorId}>{nameError}</ErrorLine> : null}
                  <p id={nameHintId} className="text-[13px] leading-5 text-game-muted">
                    Up to {NAME_MAX} characters. You can’t change it later, so no pressure.
                  </p>
                </div>

                <div role="group" aria-labelledby={suggestId} className="flex flex-col gap-2">
                  <p id={suggestId} className="text-[13px] font-semibold leading-5 text-game-muted">
                    Stuck? Borrow one
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => {
                      const chosen = heroName === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-label={`Use “${s}”`}
                          aria-pressed={chosen}
                          onClick={() => {
                            setName(s);
                            if (nameChecked) setNameError(null);
                          }}
                          className={`inline-flex h-11 items-center gap-1.5 rounded-full border-2 border-game-ink px-4 text-[14px] font-semibold focus-visible:outline-offset-2 active:translate-y-[2px] ${
                            chosen ? "bg-game-ink pl-3 text-game-paper" : "bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] active:shadow-none pointer-fine:hover:bg-game-paper-2"
                          }`}
                        >
                          {chosen ? <Check aria-hidden className="size-4" strokeWidth={3} /> : null}
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* A preview that updates as you type: a small reward for choosing. */}
              <div aria-hidden className="hidden flex-col items-center gap-4 rounded-[20px] bg-game-paper-2 px-4 py-8 lg:flex">
                <StickerFrame className="[--s:160px]">
                  <HeroArt {...SUITS[suit].colors} />
                </StickerFrame>
                <span className="max-w-full break-words text-center font-display text-[22px] font-semibold leading-7 tracking-[-0.02em] text-game-ink">
                  {heroName || <span className="text-game-muted">Your hero</span>}
                </span>
              </div>
            </StickerPanel>
            <Actions />
          </form>
        ) : null}

        {step === 2 ? (
          <form
            key="suit"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(3);
            }}
          >
            <StickerPanel className={panel}>
              <fieldset className="min-w-0">
                <StepIntro
                  legend
                  eyebrow="Suit up"
                  lead="Pick a suit."
                  point="This one’s on the house."
                  lede="Four starter suits, one choice. The other three unlock free at level 2, and fancier ones get stitched from villain loot."
                />
                <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {STARTER_SUITS.map((id) => {
                    const s = SUITS[id];
                    const checked = suit === id;
                    return (
                      <label key={id} className={`${SELECT_CARD} ${checked ? SELECT_CARD_ON : SELECT_CARD_OFF} p-1.5`}>
                        <input
                          type="radio"
                          name="suit"
                          value={id}
                          checked={checked}
                          onChange={() => setSuit(id)}
                          aria-labelledby={`${ids}-suit-${id}`}
                          aria-describedby={`${ids}-suit-${id}-blurb`}
                          className="sr-only"
                        />
                        <span aria-hidden className="grid place-items-center rounded-[14px] bg-game-paper-2 py-4">
                          <StickerFrame drop="sm" className="[--s:84px] sm:[--s:112px]">
                            <HeroArt {...s.colors} />
                          </StickerFrame>
                        </span>
                        <span className="flex flex-col gap-1 px-1.5 pb-1.5 pt-2.5">
                          <span className="flex items-center justify-between gap-2">
                            <span id={`${ids}-suit-${id}`} className="text-[15px] font-semibold leading-5">
                              {s.name}
                            </span>
                            <Mark checked={checked} shape="radio" />
                          </span>
                          <span id={`${ids}-suit-${id}-blurb`} className={`text-[12px] leading-4 max-sm:line-clamp-3 ${checked ? "text-game-paper/75" : "text-game-muted"}`}>
                            {s.blurb}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </StickerPanel>
            <Actions status={<span className="max-sm:sr-only">{SUITS[suit].name} suit</span>} />
          </form>
        ) : null}

        {step === 3 ? (
          <form key="powers" onSubmit={submitPowers} noValidate>
            <StickerPanel className={panel}>
              <fieldset ref={powersRef} className="min-w-0" aria-describedby={powersError ? powersErrorId : undefined}>
                <StepIntro
                  legend
                  eyebrow="The bite"
                  lead="The bite gave you"
                  point="three powers."
                  lede="Pick 3 of these 6. You learn more as you level up, and every use makes a power stronger."
                />
                {powersError ? (
                  <div className="mt-4">
                    <ErrorLine id={powersErrorId}>{powersError}</ErrorLine>
                  </div>
                ) : null}
                <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {STARTER_POWERS.map((id) => {
                    const p = POWERS[id];
                    const Icon = POWER_ICONS[id];
                    const checked = powers.includes(id);
                    const full = !checked && picked >= PICKS;
                    return (
                      <label key={id} className={`${SELECT_CARD} ${checked ? SELECT_CARD_ON : SELECT_CARD_OFF} ${full ? "cursor-not-allowed border-dashed" : ""} gap-3 p-3`}>
                        <input
                          type="checkbox"
                          name="powers"
                          value={id}
                          checked={checked}
                          aria-disabled={full ? true : undefined}
                          onChange={() => togglePower(id)}
                          aria-labelledby={`${ids}-power-${id}`}
                          aria-describedby={`${ids}-power-${id}-blurb ${ids}-power-${id}-facts`}
                          className="sr-only"
                        />
                        <span className={`flex items-start gap-3 ${full ? "opacity-60" : ""}`}>
                          <span
                            aria-hidden
                            className={`grid size-10 shrink-0 place-items-center rounded-[8px] [&>svg]:size-5 ${checked ? "bg-game-paper text-game-ink" : "bg-game-ink text-game-paper"}`}
                          >
                            <Icon strokeWidth={2} />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span id={`${ids}-power-${id}`} className="text-[15px] font-semibold leading-5">
                              {p.name}
                            </span>
                            <span id={`${ids}-power-${id}-blurb`} className={`text-[13px] leading-[18px] ${checked ? "text-game-paper/75" : "text-game-muted"}`}>
                              {p.blurb}
                            </span>
                          </span>
                          <Mark checked={checked} shape="checkbox" />
                        </span>
                        <PowerFacts power={p} plain pills id={`${ids}-power-${id}-facts`} cell={checked ? "bg-game-paper" : "bg-game-paper-2"} />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </StickerPanel>
            <Actions status={counter} />
          </form>
        ) : null}

        {step === 4 ? (
          <form key="confirm" onSubmit={start}>
            <StickerPanel className={`${panel} grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-10`}>
              <div className="flex min-w-0 flex-col gap-5">
                <StepIntro
                  eyebrow="Origin story"
                  lead="One last look"
                  point="before the city meets you."
                  lede="Level 1, three powers and a suit that still smells new."
                />
                <ul aria-label="Your first night" className="flex flex-col gap-2.5">
                  {FIRST_NIGHT.map((f) => (
                    <li key={f.text} className="flex items-center gap-3 text-[14px] leading-5 text-game-ink">
                      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-game-ink text-game-paper [&>svg]:size-[18px]">
                        <f.icon strokeWidth={2} />
                      </span>
                      <span>{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <HeroCardPreview name={preview} suit={suit} powers={powers} titleId={cardTitleId} />
            </StickerPanel>
            <Actions submit="Start your first night" />
          </form>
        ) : null}
      </div>
    </>
  );
}
