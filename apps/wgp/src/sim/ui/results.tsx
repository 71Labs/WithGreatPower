"use client";

/**
 * The night's results, in the sticker kit: each stop and how it went, XP, loot and
 * perfect swings. "Finish the night" banks it (finish-patrol), then shows any level-up
 * and the way on: The Daily Rug, or back to the city.
 *
 * The 3D night banks the night itself (the server, or the local save for guests), so it
 * passes no `onFinish`, the hero as they were before the night (`before`, for the
 * level-up) and its ranking panel as `children`.
 */
import { useState, type ReactNode } from "react";

import { StickerButton, StickerEyebrow, StickerLink, StickerPanel } from "@/components/game/kit";
import { Check, Sparkles, Target } from "@/components/icons";
import { castById } from "@wgp/game-core/cast";
import { DISTRICTS, ERRANDS, ITEMS, RARITY_LABEL, SUITS, XP_TO_NEXT } from "@wgp/game-core/data";
import type { ItemId, Patrol, Quest, Save, Stop, StopResult } from "@wgp/game-core/types";

import { Chip, Face, HeroFace } from "./bits";
import type { HeroSave } from "./hooks";
import { stopCast } from "./hud";

function nightQuest(save: Save, p: Patrol): { quest: Quest; paid: boolean } | null {
  const quest = save.editions.map((e) => e.quest).find((q): q is Quest => !!q && q.night === p.night) ?? null;
  if (!quest) return null;
  return { quest, paid: p.results.some((r) => r.kind === "fight" && r.outcome === "won" && r.who === quest.villain) };
}

const stopTitle = (stop: Stop) =>
  stop.kind === "fight" ? `${castById(stop.villain).name}${stop.boss ? " (boss)" : ""}` : (ERRANDS.find((e) => e.id === stop.errand)?.title ?? "Errand");

function Outcome({ r }: { r: StopResult | undefined }) {
  if (!r)
    return (
      <Chip size="xs" tone="muted" flat>
        Not reached
      </Chip>
    );
  if (r.kind === "errand")
    return (
      <Chip size="xs" tone="muted" flat>
        <Check aria-hidden className="size-3" strokeWidth={3} />
        Helped
      </Chip>
    );
  return r.outcome === "won" ? (
    <Chip size="xs" tone="mint" flat>
      <Check aria-hidden className="size-3" strokeWidth={3} />
      Caught
    </Chip>
  ) : (
    <Chip size="xs" tone="hero" flat>
      Knocked out
    </Chip>
  );
}

function Loot({ loot }: { loot: Partial<Record<ItemId, number>> }) {
  const entries = (Object.entries(loot) as [ItemId, number][]).filter(([, n]) => n > 0);
  if (!entries.length) return null;
  return (
    <ul aria-label="Loot" className="flex flex-wrap gap-1.5">
      {entries.map(([id, n]) => (
        <li key={id}>
          <Chip size="sm">
            {n > 1 ? <span className="num text-game-muted">{n}×</span> : null}
            {ITEMS[id].name}
            <span className={`rounded-full px-1.5 text-[10px] font-bold uppercase leading-4 tracking-[0.04em] ${ITEMS[id].rarity === "rare" ? "bg-game-hero text-white" : ITEMS[id].rarity === "uncommon" ? "bg-game-gold" : "bg-game-paper-2"}`}>
              {RARITY_LABEL[ITEMS[id].rarity]}
            </span>
          </Chip>
        </li>
      ))}
    </ul>
  );
}

export function Results({
  save,
  onFinish,
  before: heroBefore,
  subtitle,
  children,
}: {
  save: HeroSave;
  /** Bank the night (2D). Without it, an unbanked night shows the way back instead. */
  onFinish?: () => void;
  /** The hero before the night, when someone else banked it. */
  before?: { level: number; maxHp: number } | null;
  /** Replaces the line under the title. */
  subtitle?: string;
  /** Shown under the header: the 3D night's ranking panel. */
  children?: ReactNode;
}) {
  const p = save.patrol!;
  const hero = save.hero;
  const done = save.nightDone;
  const [finishedFrom, setBefore] = useState<{ level: number; maxHp: number } | null>(null);
  const before = heroBefore ?? finishedFrom;

  const quest = nightQuest(save, p);
  const stopXp = p.results.reduce((n, r) => n + r.xp, 0);
  const questXp = quest?.paid ? quest.quest.rewardXp : 0;
  const total = p.swingXp + stopXp + questXp;
  const loot: Partial<Record<ItemId, number>> = {};
  for (const r of p.results) for (const [k, n] of Object.entries(r.loot) as [ItemId, number][]) loot[k] = (loot[k] ?? 0) + n;
  if (quest?.paid) loot[quest.quest.rewardItem] = (loot[quest.quest.rewardItem] ?? 0) + 1;
  const knockout = p.results.find((r) => r.kind === "fight" && r.outcome === "lost");
  const leveled = done && before && hero.level > before.level ? before : null;

  function finish() {
    setBefore({ level: hero.level, maxHp: hero.maxHp });
    onFinish?.();
  }

  const stats = [
    { label: "Total XP", value: `+${total}` },
    { label: "From swings", value: `+${p.swingXp}` },
    { label: "Perfect swings", value: String(p.perfectSwings) },
    { label: "Stops", value: `${p.results.length} of ${p.stops.length}` },
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center px-3 py-6 sm:px-6 sm:py-10">
        <StickerPanel as="section" aria-labelledby="results-title" className="flex flex-col gap-6 p-4 sm:p-6">
          <header className="flex items-start gap-4">
            <HeroFace colors={SUITS[hero.suit].colors} className="size-16 rounded-[20px] border-4" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <StickerEyebrow>
                <span className="num">Night {p.night}</span>
              </StickerEyebrow>
              <h1 id="results-title" tabIndex={-1} className="text-[28px] font-bold leading-8 tracking-[-0.025em] text-game-ink outline-none sm:text-[34px] sm:leading-10">
                {done ? "Banked. Get some sleep." : knockout ? "Knocked out." : "The night’s haul"}
              </h1>
              <p className="text-[14px] leading-5 text-game-muted">
                {subtitle ??
                  (done
                    ? "The XP and loot are yours, and Bearson is already typing."
                    : "Finishing the night adds this to your hero and sends the story to The Daily Rug.")}
              </p>
            </div>
          </header>

          {children}

          {knockout ? (
            <div className="flex items-start gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper-2 p-3">
              <Face id="aunt-mainnet" className="size-11" />
              <p className="text-[14px] leading-5">
                <span className="font-semibold">
                  {castById(knockout.who).name} knocked you out in {DISTRICTS[knockout.district].name}.
                </span>{" "}
                Aunt Mainnet patched you up. The rest of the route waits for tomorrow.
              </p>
            </div>
          ) : null}

          <section aria-labelledby="stops-title" className="flex flex-col gap-3">
            <h2 id="stops-title" className="text-[16px] font-bold leading-5">
              Stop by stop
            </h2>
            <ol className="flex flex-col gap-2">
              {p.stops.map((stop, i) => {
                const r = p.results[i];
                return (
                  <li key={i} className={`flex items-start gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper p-3 ${r ? "" : "opacity-60"}`}>
                    <Face id={stopCast(stop)} className="size-12" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold leading-5">{stopTitle(stop)}</span>
                        <Outcome r={r} />
                      </div>
                      <p className="text-[13px] leading-5 text-game-muted">
                        {DISTRICTS[stop.district].name}
                        {r ? ` · ${r.text}` : ""}
                      </p>
                      {r ? <Loot loot={r.loot} /> : null}
                    </div>
                    {r ? <span className="num shrink-0 pt-0.5 text-[15px] font-bold leading-5">+{r.xp} XP</span> : null}
                  </li>
                );
              })}
            </ol>
            {quest ? (
              <div className="flex items-start gap-3 rounded-[16px] border-2 border-dashed border-game-ink p-3">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold">
                  <Target className="size-5" strokeWidth={2} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-[14px] font-semibold leading-5">Quest: {quest.quest.text}</p>
                  <p className="text-[13px] leading-5 text-game-muted">
                    {quest.paid ? `Done. +${quest.quest.rewardXp} XP and a ${ITEMS[quest.quest.rewardItem].name.toLowerCase()}.` : "Not this time. He got away."}
                  </p>
                </div>
              </div>
            ) : null}
          </section>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col gap-1 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3">
                <dt className="text-[12px] font-semibold leading-4 text-game-muted">{s.label}</dt>
                <dd className="num text-[24px] font-bold leading-7 tracking-[-0.02em]">{s.value}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="loot-title" className="flex flex-col gap-2.5">
            <h2 id="loot-title" className="text-[16px] font-bold leading-5">
              Loot
            </h2>
            {Object.keys(loot).length ? <Loot loot={loot} /> : <p className="text-[14px] leading-5 text-game-muted">Nothing tonight. Villains drop loot when you catch them.</p>}
          </section>

          {done ? (
            <div className="flex flex-col gap-3">
              {leveled ? (
                <div className="animate-rise flex items-center gap-4 rounded-[18px] border-[2.5px] border-game-ink bg-game-gold p-4 shadow-[var(--game-shadow)]">
                  <HeroFace colors={SUITS[hero.suit].colors} className="size-14 rounded-[18px] border-4" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="flex items-center gap-1.5 text-[13px] font-bold uppercase leading-4 tracking-[0.06em]">
                      <Sparkles aria-hidden className="size-4" strokeWidth={2.25} />
                      Level up
                    </p>
                    <p
                      tabIndex={-1}
                      ref={(el) => {
                        // Focus follows "Finish the night"; banked elsewhere, the page keeps focus at the top.
                        if (finishedFrom) el?.focus();
                      }}
                      className="num text-[26px] font-bold leading-8 tracking-[-0.02em] outline-none">
                      Level {leveled.level} → {hero.level}
                    </p>
                    <p className="text-[13px] leading-5">
                      <span className="num">+{hero.maxHp - leveled.maxHp}</span> max health{hero.pendingPicks > 0 ? ", and a new power to pick" : ""}.
                    </p>
                  </div>
                </div>
              ) : (
                <p
                  tabIndex={-1}
                  ref={(el) => {
                    if (finishedFrom) el?.focus();
                  }}
                  className="num text-[14px] font-semibold leading-5 outline-none"
                >
                  Night banked. {hero.xp} of {XP_TO_NEXT(hero.level)} XP to level {hero.level + 1}.
                </p>
              )}
              <div className="flex flex-col gap-2.5 sm:flex-row">
                {leveled && hero.pendingPicks > 0 ? (
                  <StickerLink href="/play/hero" size="lg" variant="hero" className="w-full sm:flex-1">
                    Pick a new power
                  </StickerLink>
                ) : null}
                <StickerLink href="/play/rug" size="lg" variant={leveled && hero.pendingPicks > 0 ? "paper" : "hero"} className="w-full sm:flex-1">
                  Read The Daily Rug
                </StickerLink>
                <StickerLink href="/play" size="lg" className="w-full sm:flex-1">
                  Back to the city
                </StickerLink>
              </div>
            </div>
          ) : onFinish ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-[14px] leading-5">
                <span className="num font-bold">+{total} XP</span> for {hero.name}
                {hero.xp + total >= XP_TO_NEXT(hero.level) ? ", enough for a level up" : ""}.
              </p>
              <StickerButton variant="hero" size="xl" onClick={finish} className="w-full">
                Finish the night
              </StickerButton>
            </div>
          ) : (
            <StickerLink href="/play" size="lg" className="w-full">
              Back to the city
            </StickerLink>
          )}
        </StickerPanel>
      </div>
    </div>
  );
}
