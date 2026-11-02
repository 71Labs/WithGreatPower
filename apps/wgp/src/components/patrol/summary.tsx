"use client";

import { useState } from "react";

import { AlertTriangle, Check, Handshake, Sparkles, Target } from "@/components/icons";
import { HeroSticker, Meter, type HeroSave } from "@/components/game/ui";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { Button, LinkButton } from "@/components/ui";
import { castById } from "@wgp/game-core/cast";
import { DISTRICTS, ITEMS, XP_TO_NEXT } from "@wgp/game-core/data";
import type { ItemId, Patrol, Quest, Save, StopResult } from "@wgp/game-core/types";

import { LootChips, Tag, districtName, stopName, stopWho, stopWhat } from "./shared";

/** Tonight's quest, from whichever edition set it, and whether it was caught. */
function nightQuest(save: Save, p: Patrol): { quest: Quest; paid: boolean } | null {
  const quest = save.editions.map((e) => e.quest).find((q): q is Quest => !!q && q.night === p.night) ?? null;
  if (!quest) return null;
  const paid = p.results.some((r) => r.kind === "fight" && r.outcome === "won" && r.who === quest.villain);
  return { quest, paid };
}

function addLoot(into: Partial<Record<ItemId, number>>, from: Partial<Record<ItemId, number>>) {
  for (const [k, n] of Object.entries(from) as [ItemId, number][]) into[k] = (into[k] ?? 0) + n;
}

function Outcome({ result }: { result: StopResult }) {
  if (result.kind === "errand") return <Tag icon={Handshake} tone="quiet" size="sm">Helped</Tag>;
  return result.outcome === "won" ? (
    <Tag icon={Check} tone="success" size="sm">
      Caught
    </Tag>
  ) : (
    <Tag icon={AlertTriangle} tone="danger" size="sm">
      Knocked out
    </Tag>
  );
}

/**
 * The end of the night: every stop and what it paid, the swings, the loot. Finishing
 * banks it all, levels you up if it's enough, and sends the story to The Daily Rug.
 */
export function PatrolSummary({ save, onFinish }: { save: HeroSave; onFinish: () => void }) {
  const p = save.patrol!;
  const hero = save.hero;
  const done = save.nightDone;
  // The hero before finishing, to show a level-up once the night is banked.
  const [before, setBefore] = useState<{ level: number; maxHp: number } | null>(null);

  const quest = nightQuest(save, p);
  const stopXp = p.results.reduce((n, r) => n + r.xp, 0);
  const questXp = quest?.paid ? quest.quest.rewardXp : 0;
  const total = p.swingXp + stopXp + questXp;
  const loot: Partial<Record<ItemId, number>> = {};
  for (const r of p.results) addLoot(loot, r.loot);
  if (quest?.paid) addLoot(loot, { [quest.quest.rewardItem]: 1 });
  const knockout = p.results.find((r) => r.kind === "fight" && r.outcome === "lost");
  const leveled = done && before && hero.level > before.level ? before : null;
  const need = XP_TO_NEXT(hero.level);

  function finish() {
    setBefore({ level: hero.level, maxHp: hero.maxHp });
    onFinish();
  }

  const stats = [
    { label: "Total XP", value: `+${total}` },
    { label: "From swings", value: `+${p.swingXp}` },
    { label: "Perfect swings", value: String(p.perfectSwings) },
    { label: "Stops", value: `${p.results.length} of ${p.stops.length}` },
  ];

  return (
    <section aria-labelledby="haul-title" className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
      <div className="flex flex-col gap-6 px-2 pb-2 pt-4 sm:px-4 sm:pt-5">
        <div className="flex flex-col gap-2 px-1">
          <h2 id="haul-title" className="font-display text-[26px] font-medium leading-8 tracking-[-0.03em] sm:text-[32px] sm:leading-[38px]">
            <span className="text-ink-faint">{done ? "Banked." : "Tonight’s haul,"}</span>{" "}
            <span className="text-ink-strong">{done ? "Get some sleep, web-head." : "before you bank it."}</span>
          </h2>
          <p className="max-w-[60ch] text-[14px] leading-[22px] text-ink-subtle">
            {done
              ? "The XP and loot are yours, and Bearson is already typing."
              : "Finishing the night adds this to your hero and sends the story to The Daily Rug."}
          </p>
        </div>

        {knockout ? (
          <div className="flex items-start gap-3 rounded-card bg-danger-fill p-3.5 text-on-danger">
            <MiniAvatar id="aunt-mainnet" className="size-10 rounded-[10px]" />
            <p className="text-[14px] leading-5">
              <span className="font-medium">Knocked out by {castById(knockout.who).name} in {DISTRICTS[knockout.district].name}.</span>{" "}
              Aunt Mainnet patched you up. The rest of the route waits for tomorrow.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-3">
            <h3 className="px-1 text-[15px] font-medium leading-5 text-ink-strong">Stop by stop</h3>
            <ol className="flex flex-col gap-1.5">
              {p.stops.map((stop, i) => {
                const r = p.results[i];
                return (
                  <li key={i} className={`flex items-start gap-3 rounded-card bg-surface p-3 ${r ? "" : "opacity-60"}`}>
                    <MiniAvatar id={stopWho(stop)} className="size-11 rounded-[12px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[14px] font-medium leading-5 text-ink-strong">{stopName(stop)}</span>
                        {r ? (
                          <Outcome result={r} />
                        ) : (
                          <Tag tone="quiet" size="sm">
                            Not reached
                          </Tag>
                        )}
                      </div>
                      <p className="text-[13px] leading-5 text-ink-subtle">
                        {districtName(stop)} · {r ? r.text : stopWhat(stop)}
                      </p>
                      {r ? <LootChips loot={r.loot} className="mt-1.5" /> : null}
                    </div>
                    {r ? <span className="num shrink-0 pt-0.5 text-[14px] font-medium leading-5 text-ink-strong">+{r.xp} XP</span> : null}
                  </li>
                );
              })}
            </ol>
            {quest ? (
              <div className="flex items-start gap-3 rounded-card border border-hairline p-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-strong">
                  <Target aria-hidden className="size-5" strokeWidth={1.75} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-[14px] font-medium leading-5 text-ink-strong">Quest: {quest.quest.text}</p>
                  <p className="text-[13px] leading-5 text-ink-subtle">
                    {quest.paid
                      ? `Done. +${quest.quest.rewardXp} XP and a ${ITEMS[quest.quest.rewardItem].name.toLowerCase()}.`
                      : "Not this time. He got away."}
                  </p>
                </div>
                {quest.paid ? (
                  <span className="num shrink-0 pt-0.5 text-[14px] font-medium leading-5 text-ink-strong">+{quest.quest.rewardXp} XP</span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Totals, loot and the way out. */}
          <div className="flex flex-col gap-5 lg:sticky lg:top-24">
            <h3 className="-mb-2 px-1 text-[15px] font-medium leading-5 text-ink-strong">Totals</h3>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-hairline">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col gap-1 bg-surface px-4 py-3.5">
                  <dt className="text-[12px] leading-4 text-ink-subtle">{s.label}</dt>
                  <dd className="num font-display text-[24px] font-medium leading-7 tracking-[-0.02em] text-ink-strong">{s.value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-3">
              <h3 className="px-1 text-[15px] font-medium leading-5 text-ink-strong">Loot</h3>
              {Object.keys(loot).length ? (
                <LootChips loot={loot} />
              ) : (
                <p className="px-1 text-[14px] leading-5 text-ink-subtle">Nothing tonight. Villains drop loot when you catch them.</p>
              )}
            </div>

            {done ? (
              <div className="flex flex-col gap-3 rounded-card bg-surface p-1.5">
                {leveled ? (
                  <div className="animate-rise flex flex-col gap-4 rounded-[10px] bg-canvas p-4 shadow-[var(--shadow-chip)]">
                    <div className="flex items-center gap-4">
                      <HeroSticker hero={hero} size="sm" />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="flex items-center gap-1.5 text-[13px] font-medium leading-5 text-accent">
                          <Sparkles aria-hidden className="size-4" strokeWidth={2} />
                          Level up
                        </p>
                        <p
                          tabIndex={-1}
                          ref={(el) => el?.focus()}
                          className="num font-display text-[26px] font-medium leading-8 tracking-[-0.03em] text-ink-strong outline-none"
                        >
                          Level {leveled.level} → {hero.level}
                        </p>
                        <p className="text-[13px] leading-5 text-ink-subtle">
                          <span className="num">+{hero.maxHp - leveled.maxHp}</span> max health
                          {hero.pendingPicks > 0 ? ", and a new power to pick" : ""}.
                        </p>
                      </div>
                    </div>
                    {hero.pendingPicks > 0 ? (
                      <LinkButton href="/play/hero" variant="secondary" className="w-full">
                        Pick a new power
                      </LinkButton>
                    ) : null}
                  </div>
                ) : (
                  <div className="px-2.5 pt-2.5">
                    <p
                      tabIndex={-1}
                      ref={(el) => {
                        if (before) el?.focus();
                      }}
                      className="mb-2 text-[14px] font-medium leading-5 text-ink-strong outline-none"
                    >
                      Night banked
                    </p>
                    <Meter label={`XP to level ${hero.level + 1}`} value={hero.xp} max={need} tone="ink" />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <LinkButton href="/play/rug" size="lg" className="w-full">
                    Read tomorrow’s Daily Rug
                  </LinkButton>
                  <LinkButton href="/play" size="lg" variant="secondary" className="w-full">
                    Back to tonight
                  </LinkButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-card bg-surface p-1.5">
                <p className="px-2.5 pt-2.5 text-[13px] leading-5 text-ink-subtle">
                  <span className="num font-medium text-ink-strong">+{total} XP</span> for {hero.name}
                  {hero.xp + total >= need ? ", enough for a level up" : ""}.
                </p>
                <Button type="button" size="lg" onClick={finish} className="w-full">
                  Finish the night
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
