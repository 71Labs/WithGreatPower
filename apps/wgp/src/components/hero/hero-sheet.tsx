"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

import { HeroArt } from "@/components/cast";
import { StickerButton, StickerChip, StickerFrame, StickerMeter, StickerPanel } from "@/components/game/kit";
import { GameLoading, GameSheet, StickerTabs, tabPanelProps, useHeroSave, type HeroSave } from "@/components/game/ui";
import { Check, Lock, Sparkles } from "@/components/icons";
import { MAX_LOADOUT, POWERS, SUITS, XP_TO_NEXT } from "@/game/data";
import { useGame } from "@/game/store";
import type { PowerId, Stats } from "@/game/types";

import { MAX_POWER_LEVEL, POWER_ICONS, PowerFacts, USES_PER_LEVEL, costLabel, masteryProgress } from "./powers";

const ALL_POWERS = Object.keys(POWERS) as PowerId[];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Signed with a real minus sign, for reputation. */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

type Tab = "overview" | "powers" | "loadout";
const TABS_ID = "hero-tabs";

/** A power's icon on an ink tile. Decorative: the name is always written next to it. */
function PowerIcon({ id, size = "md" }: { id: PowerId; size?: "sm" | "md" }) {
  const Icon = POWER_ICONS[id];
  const s = size === "sm" ? "size-8 rounded-[8px] [&>svg]:size-4" : "size-10 rounded-[10px] [&>svg]:size-5";
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center bg-game-ink text-game-paper ${s}`}>
      <Icon strokeWidth={2} />
    </span>
  );
}

/* ------------------------------------------------------------------ overview */

function reputation(rep: number): { word: string; quip: string } {
  if (rep <= -60) return { word: "Public menace", quip: "J. Jonah Bearson has never been happier." };
  if (rep <= -20) return { word: "Mostly menace", quip: "The Daily Rug has a folder on you. It’s getting thick." };
  if (rep < 20) return { word: "The city can’t decide", quip: "Half the city waves. The other half calls Bearson." };
  if (rep < 60) return { word: "Mostly hero", quip: "Bearson still prints “menace”. Fewer people believe him." };
  return { word: "Hero of the city", quip: "Even Bearson’s readers are on your side. He is furious." };
}

/** Reputation on a menace-to-hero scale, with the verdict in words. */
function Reputation({ save }: { save: HeroSave }) {
  const rep = save.reputation;
  const pos = (rep + 100) / 2;
  const { word, quip } = reputation(rep);
  return (
    <section aria-labelledby="rep-title" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="rep-title" className="text-[12px] font-semibold leading-4 text-game-ink">
          What the city thinks
        </h2>
        <span className="num text-[12px] font-semibold leading-4">{signed(rep)}</span>
      </div>
      <p className="text-[18px] font-semibold leading-6 tracking-[-0.01em] text-game-ink">{word}</p>
      <div
        role="meter"
        aria-label="Reputation"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={rep}
        aria-valuetext={`${word}: ${signed(rep)}, on a scale from −100 (menace) to +100 (hero)`}
        className="relative mx-2 mt-1 h-3 rounded-full border-2 border-game-ink bg-game-paper-2"
      >
        <span aria-hidden className="absolute -inset-y-1.5 left-1/2 w-0.5 -translate-x-1/2 bg-game-ink" />
        <span aria-hidden className="absolute inset-y-0 bg-game-ink" style={{ left: `${Math.min(50, pos)}%`, width: `${Math.abs(pos - 50)}%` }} />
        <span
          aria-hidden
          className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-game-ink bg-game-hero motion-safe:transition-[left] motion-safe:duration-300 motion-safe:ease-out"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div aria-hidden className="flex justify-between text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-game-muted">
        <span>Menace</span>
        <span>Hero</span>
      </div>
      <p className="text-[13px] leading-5 text-game-muted">{quip}</p>
    </section>
  );
}

const RECORD: { key: keyof Stats; label: string }[] = [
  { key: "villainsCaught", label: "Villains caught" },
  { key: "errands", label: "Errands run" },
  { key: "perfectSwings", label: "Perfect swings" },
  { key: "nights", label: "Nights out" },
  { key: "knockouts", label: "Knockouts" },
];

function Overview({ save }: { save: HeroSave }) {
  const hero = save.hero;
  return (
    <div className="grid gap-5 md:grid-cols-2 md:gap-8">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <StickerMeter label="Responsibility" value={hero.responsibility} max={100} fill="bg-game-ink" />
          <p className="text-[13px] leading-5 text-game-muted">Goes up when you help people. Never as fast as Uncle Gen would like.</p>
        </div>
        <Reputation save={save} />
      </div>
      <section aria-labelledby="record-title" className="flex flex-col gap-2">
        <h2 id="record-title" className="text-[12px] font-semibold leading-4 text-game-ink">
          On the record
        </h2>
        <dl className="grid grid-cols-3 gap-2 md:grid-cols-2">
          {RECORD.map((r) => (
            <div key={r.key} className="flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-game-paper-2 px-3 py-2.5">
              <dt className="text-[11px] font-medium leading-4 text-game-muted">{r.label}</dt>
              <dd className="num text-[22px] font-semibold leading-7 tracking-[-0.02em]">{save.stats[r.key]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ powers */

function Powers({ save }: { save: HeroSave }) {
  const hero = save.hero;
  const owned = ALL_POWERS.filter((id) => hero.powers[id]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-5 text-game-muted">
        {plural(owned.length, "power")} learned. Every {USES_PER_LEVEL} uses is a level, up to {MAX_POWER_LEVEL}; each level adds 15%.
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {owned.map((id) => {
          const p = POWERS[id];
          const mastery = hero.powers[id]?.mastery ?? 0;
          const m = masteryProgress(mastery);
          const inLoadout = hero.loadout.includes(id);
          return (
            <li key={id} className="flex flex-col gap-2.5 rounded-[22px] border-2 border-game-ink bg-game-paper p-3">
              <div className="flex items-start gap-3">
                <PowerIcon id={id} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold leading-5 text-game-ink">
                    {p.name}
                    {inLoadout ? (
                      <span className="inline-flex h-5 items-center gap-1 rounded-full bg-game-ink px-1.5 text-[11px] font-semibold leading-none text-game-paper">
                        <Check aria-hidden className="size-3" strokeWidth={3} />
                        Loadout
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-[13px] leading-[18px] text-game-muted">{p.blurb}</p>
                </div>
                <span className="num inline-flex h-7 shrink-0 items-center rounded-full border-2 border-game-ink bg-game-gold px-2 text-[12px] font-bold leading-none text-game-ink">
                  Lv {m.level}
                  <span className="sr-only"> of {MAX_POWER_LEVEL}</span>
                </span>
              </div>
              <PowerFacts power={p} mastery={mastery} pills />
              <StickerMeter
                label={m.maxed ? "Mastered" : `Uses to level ${m.level + 1}`}
                value={m.into}
                max={USES_PER_LEVEL}
                fill="bg-game-ink"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ loadout */

function Loadout({ save }: { save: HeroSave }) {
  const { dispatch } = useGame();
  const hero = save.hero;
  const locked = save.patrol?.phase === "stop";
  const [message, setMessage] = useState<string | null>(null);
  // Don't greet a return visit with the last change's news.
  useLayoutEffect(() => () => setMessage(null), []);

  const owned = ALL_POWERS.filter((id) => hero.powers[id]);
  const current = hero.loadout;
  const full = current.length >= MAX_LOADOUT;

  function toggle(id: PowerId) {
    if (locked) return;
    const name = POWERS[id].name;
    if (current.includes(id)) {
      if (current.length <= 1) {
        setMessage("Take at least one power. Punch alone won’t cut it.");
        return;
      }
      const next = current.filter((p) => p !== id);
      dispatch({ type: "set-loadout", loadout: next });
      setMessage(`${name} left at home. ${next.length} of ${MAX_LOADOUT} slots used.`);
    } else if (full) {
      setMessage(`Your loadout is full. Take a power out to make room for ${name}.`);
    } else {
      const next = [...current, id];
      dispatch({ type: "set-loadout", loadout: next });
      setMessage(`${name} is coming on patrol. ${next.length} of ${MAX_LOADOUT} slots used.`);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {locked ? (
        <p className="flex items-start gap-2.5 rounded-[14px] border-2 border-game-ink bg-game-gold px-3 py-2.5 text-[13px] leading-5 text-game-ink">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
          <span>
            <span className="font-semibold">Locked mid-stop.</span> Nobody swaps powers in the middle of a fight. Finish this stop, then
            come back.{" "}
            <Link href="/play/patrol" className="font-semibold underline underline-offset-2">
              Back to the patrol
            </Link>
          </span>
        </p>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <p className="num text-[13px] leading-5 text-game-muted">
          <span className="font-semibold text-game-ink">
            {current.length} of {MAX_LOADOUT}
          </span>{" "}
          slots. Punch is always free.
        </p>
      </div>
      <fieldset disabled={locked} className="min-w-0">
        <legend className="sr-only">Powers to take on patrol</legend>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {owned.map((id) => {
            const p = POWERS[id];
            const Icon = POWER_ICONS[id];
            const checked = current.includes(id);
            const blocked = !checked && full;
            return (
              <li key={id} className="flex">
                <label
                  className={`relative flex min-h-[72px] w-full cursor-pointer items-center gap-2.5 rounded-[20px] border-2 border-game-ink p-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--vs-focus)] has-[:disabled]:cursor-not-allowed ${
                    checked ? "bg-game-ink text-game-paper shadow-[var(--game-shadow-sm)]" : "bg-game-paper text-game-ink"
                  } ${blocked ? "border-dashed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-disabled={blocked ? true : undefined}
                    aria-describedby={`loadout-${id}-meta`}
                    onChange={() => toggle(id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={`grid size-9 shrink-0 place-items-center rounded-[10px] [&>svg]:size-[18px] ${checked ? "bg-game-paper text-game-ink" : "bg-game-ink text-game-paper"}`}
                  >
                    <Icon strokeWidth={2} />
                  </span>
                  <span className={`flex min-w-0 flex-col ${blocked ? "opacity-60" : ""}`}>
                    <span className="text-[14px] font-semibold leading-[18px]">{p.name}</span>
                    <span id={`loadout-${id}-meta`} className={`num text-[12px] leading-4 ${checked ? "text-game-paper/75" : "text-game-muted"}`}>
                      {costLabel(p.cost)}
                      {p.cooldown ? ` · ${p.cooldown}-turn cooldown` : ""}
                    </span>
                  </span>
                  {checked ? (
                    <span aria-hidden className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-game-ink">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p role="status" className={message ? "text-[13px] font-medium leading-5 text-game-ink" : "sr-only"}>
        {message}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ level-up picks */

function PickPowerSheet({ save, open, onClose, onLearn }: { save: HeroSave; open: boolean; onClose: () => void; onLearn: (id: PowerId) => void }) {
  const hero = save.hero;
  const unowned = ALL_POWERS.filter((id) => !hero.powers[id]);
  const picks = hero.pendingPicks;
  return (
    <GameSheet
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={`Level ${hero.level} · ${plural(picks, "pick")} waiting`}
      title="Pick a new power"
      description="It joins your loadout if there’s a free slot."
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {unowned.map((id, i) => {
          const p = POWERS[id];
          return (
            <li key={id} className="flex flex-col gap-2.5 rounded-[22px] border-2 border-game-ink bg-game-paper p-3">
              <div className="flex items-start gap-3">
                <PowerIcon id={id} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h3 className="text-[15px] font-semibold leading-5 text-game-ink">{p.name}</h3>
                  <p className="text-[13px] leading-[18px] text-game-muted">{p.blurb}</p>
                </div>
              </div>
              <PowerFacts power={p} pills />
              <StickerButton variant="ink" size="sm" onClick={() => onLearn(id)} className="mt-auto w-full" data-autofocus={i === 0 ? "" : undefined}>
                Learn {p.name}
              </StickerButton>
            </li>
          );
        })}
      </ul>
    </GameSheet>
  );
}

/* ------------------------------------------------------------------ the screen */

export function HeroSheet() {
  const save = useHeroSave();
  const { dispatch } = useGame();
  const [tab, setTab] = useState<Tab>("overview");
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Next keeps this page alive when you leave it: don't come back to old news.
  useLayoutEffect(() => () => setNotice(null), []);

  if (!save) return <GameLoading />;
  const hero = save.hero;
  const need = XP_TO_NEXT(hero.level);
  const picks = hero.pendingPicks;

  function learn(id: PowerId) {
    const room = hero.loadout.length < MAX_LOADOUT;
    dispatch({ type: "pick-power", power: id });
    setNotice(`${POWERS[id].name} learned. ${room ? "It’s in your loadout." : "Your loadout is full; swap it in under Loadout."}`);
    if (picks <= 1) {
      // The last pick: the sheet and the button that opened it both go. Land on the news.
      setPicking(false);
      requestAnimationFrame(() => noticeRef.current?.focus());
    }
  }

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "powers" as const, label: "Powers" },
    { id: "loadout" as const, label: "Loadout" },
  ];

  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 sm:px-6">
      <header className="flex items-center gap-4">
        <StickerFrame label={`${hero.name}, in the ${SUITS[hero.suit].name} suit`} className="[--s:88px] sm:[--s:112px]">
          <HeroArt {...SUITS[hero.suit].colors} />
        </StickerFrame>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="font-display text-[28px] font-semibold leading-[30px] tracking-[-0.03em] text-game-paper [overflow-wrap:anywhere] [text-shadow:0_2px_0_var(--game-ink)] sm:text-[36px] sm:leading-[38px]">
            {hero.name}
          </h1>
          <div className="flex flex-wrap gap-1.5">
            <StickerChip className="num">Level {hero.level}</StickerChip>
            <StickerChip className="num max-sm:hidden">{hero.maxHp} max health</StickerChip>
            <StickerChip>{SUITS[hero.suit].name} suit</StickerChip>
          </div>
          <StickerMeter label={`XP to level ${hero.level + 1}`} value={hero.xp} max={need} fill="bg-game-gold" className="max-w-[360px] text-game-paper" />
        </div>
      </header>

      {picks > 0 ? (
        <StickerButton variant="hero" size="lg" className="w-full sm:w-auto sm:self-start" onClick={() => setPicking(true)}>
          <Sparkles aria-hidden className="size-5" strokeWidth={2.25} />
          Pick a new power
          <span aria-hidden className="num inline-grid h-6 min-w-6 place-items-center rounded-full bg-game-paper px-1.5 text-[14px] text-game-hero">
            {picks}
          </span>
          <span className="sr-only">, {plural(picks, "pick")} waiting</span>
        </StickerButton>
      ) : null}

      <p ref={noticeRef} tabIndex={-1} role="status" className={notice ? "flex items-center gap-2 rounded-full border-2 border-game-ink bg-game-mint px-4 py-2 text-[14px] font-semibold leading-5 text-game-paper" : "sr-only"}>
        {notice ? <Check aria-hidden className="size-4 shrink-0" strokeWidth={3} /> : null}
        {notice}
      </p>

      <StickerTabs tabs={tabs} value={tab} onChange={setTab} label="Hero" idPrefix={TABS_ID} className="sm:max-w-[420px]" />

      <StickerPanel className="p-4 [--vs-focus:var(--game-hero)] sm:p-5" {...tabPanelProps(TABS_ID, tab)}>
        {tab === "overview" ? <Overview save={save} /> : tab === "powers" ? <Powers save={save} /> : <Loadout save={save} />}
      </StickerPanel>

      <PickPowerSheet save={save} open={picking && picks > 0} onClose={() => setPicking(false)} onLearn={learn} />
    </div>
  );
}
