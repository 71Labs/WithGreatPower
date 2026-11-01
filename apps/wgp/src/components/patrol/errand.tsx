"use client";

import { MEDIA_PALETTES, type SceneName } from "@/components/art/scenes";
import { ShaderCanvas } from "@/components/art/shader-canvas";
import { Sticker } from "@/components/cast";
import { ArrowRight, MapPin, Newspaper, UsersRound } from "@/components/icons";
import { type HeroSave } from "@/components/game/ui";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { Button } from "@/components/ui";
import { castById } from "@/content/cast";
import { ALLY_CAST, DISTRICTS, ERRANDS, type ErrandChoice } from "@/game/data";
import type { DistrictId } from "@/game/types";

import { EFFECT_ICONS, Effect, LootChips, SpeechBubble } from "./shared";
import { SceneMedia } from "./scene-media";

/** Each district's backdrop for errands. */
const SCENERY: Record<DistrictId, { scene: SceneName; palette: [string, string, string, string]; seed: number }> = {
  "queens-block": { scene: "bloom", palette: MEDIA_PALETTES.comic, seed: 4 },
  "mempool-market": { scene: "contours", palette: MEDIA_PALETTES.dusk2, seed: 9 },
  "bridge-district": { scene: "beam", palette: MEDIA_PALETTES.nightcity, seed: 3 },
  "validator-heights": { scene: "webs", palette: MEDIA_PALETTES.aurora, seed: 6 },
  "sector-7": { scene: "bloom", palette: MEDIA_PALETTES.ember, seed: 12 },
};

/** Button labels start with a verb: quotes become "Say …". */
function choiceLabel(errandId: string, choice: ErrandChoice): string {
  if (choice.label.startsWith("“")) return `Say ${choice.label}`;
  if (errandId === "selfie" && choice.id === "decline") return "Say no, there’s a villain";
  return choice.label;
}

/**
 * An errand: the ally asks, you pick what to do, and the result lands with what it
 * changed. Then you swing on.
 */
export function ErrandStop({
  save,
  onChoose,
  onLeave,
}: {
  save: HeroSave;
  onChoose: (choice: string) => void;
  onLeave: () => void;
}) {
  const p = save.patrol!;
  const stop = p.stops[p.index];
  if (stop.kind !== "errand") return null;
  const errand = ERRANDS.find((e) => e.id === stop.errand);
  if (!errand) return null;
  const ally = ALLY_CAST[errand.ally];
  const allyName = castById(ally).name;
  const result = p.results.length > p.index ? p.results[p.index] : null;
  const choice = result ? errand.choices.find((c) => c.id === result.outcome) ?? null : null;
  const ending = p.index + 1 >= p.stops.length;
  const scenery = SCENERY[errand.district];

  return (
    <section aria-labelledby="errand-title" className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
      <div className="relative isolate overflow-hidden rounded-card bg-surface-2">
        <SceneMedia>
          <ShaderCanvas scene={scenery.scene} palette={scenery.palette} seed={scenery.seed + p.night} fps={24} className="absolute inset-0" />
        </SceneMedia>
        <div className="relative flex flex-col items-center gap-7 px-4 pb-6 pt-6 sm:px-8 sm:pb-8 lg:min-h-[360px] lg:flex-row lg:items-center lg:gap-10 lg:px-12 lg:py-10">
          <Sticker id={ally} size="lg" label={false} />
          <SpeechBubble tail="top-then-left" className="w-full max-w-[560px]">
            <div className="flex flex-col gap-2 px-5 pb-5 pt-4">
              <p className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-ink-subtle">
                <MapPin aria-hidden className="size-3.5" strokeWidth={2} />
                {allyName} · {DISTRICTS[errand.district].name}
              </p>
              <h2 id="errand-title" className="font-display text-[24px] font-medium leading-[30px] tracking-[-0.02em] text-ink-strong">
                {errand.title}
              </h2>
              <p className="text-[16px] leading-[25px] text-ink [text-wrap:pretty]">{errand.prompt}</p>
            </div>
          </SpeechBubble>
        </div>
      </div>

      {result && choice ? (
        <div className="flex flex-col gap-5 px-3 pb-3 pt-5 sm:px-5 sm:pt-6">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] leading-5 text-ink-subtle">
              You chose: <span className="font-medium text-ink-strong">{choiceLabel(errand.id, choice)}</span>
            </p>
            <p
              tabIndex={-1}
              ref={(el) => el?.focus({ preventScroll: true })}
              className="max-w-[60ch] font-display text-[22px] font-medium leading-[30px] tracking-[-0.02em] text-ink-strong outline-none"
            >
              {result.text}
            </p>
          </div>
          <ul aria-label="What changed" className="flex flex-wrap gap-1.5">
            <Effect icon={EFFECT_ICONS.xp} value={result.xp} label="XP" />
            <Effect icon={EFFECT_ICONS.health} value={choice.heal ?? 0} label="health" />
            <Effect icon={EFFECT_ICONS.fluid} value={choice.fluid ?? 0} label="web fluid" />
            <Effect icon={EFFECT_ICONS.responsibility} value={result.responsibility} label="responsibility" />
            <Effect icon={EFFECT_ICONS.reputation} value={result.reputation} label="reputation" />
          </ul>
          <LootChips loot={result.loot} />
          {errand.ally === "gwei" && choice.id === "team" ? (
            <p className="flex items-center gap-2.5 text-[14px] leading-5 text-ink">
              <MiniAvatar id="gwei" className="size-8 rounded-[9px]" />
              <span>
                Gwei can be called <span className="num font-medium text-ink-strong">{p.gweiCalls}</span>{" "}
                {p.gweiCalls === 1 ? "time" : "times"} tonight.
              </span>
            </p>
          ) : null}
          {choice.quote ? (
            <p className="flex items-start gap-2.5 text-[14px] leading-5 text-ink">
              <Newspaper aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
              <span>
                Tomorrow’s Daily Rug quotes you: <span className="font-medium text-ink-strong">“{choice.quote}”</span>
              </span>
            </p>
          ) : null}
          <div className="flex flex-col gap-3 border-t border-hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-5 text-ink-subtle">
              {ending ? "That was the last stop tonight." : `Next: stop ${p.index + 2} of ${p.stops.length}, ${DISTRICTS[p.stops[p.index + 1].district].name}.`}
            </p>
            <Button type="button" size="lg" onClick={onLeave} className="w-full sm:w-auto">
              {ending ? "See the night’s haul" : "Swing on"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-3 pb-3 pt-5 sm:px-5 sm:pt-6">
          <h3 className="flex items-center gap-2 text-[15px] font-medium leading-5 text-ink-strong">
            <UsersRound aria-hidden className="size-4 text-ink-subtle" strokeWidth={2} />
            What do you do?
          </h3>
          <ul className={`grid gap-2 ${errand.choices.length === 3 ? "lg:grid-cols-3" : "sm:grid-cols-2"}`}>
            {errand.choices.map((c) => (
              <li key={c.id} className="flex">
                <button
                  type="button"
                  onClick={() => onChoose(c.id)}
                  className="group flex min-h-16 w-full items-center justify-between gap-3 rounded-card bg-canvas px-4 py-3 text-left text-[15px] font-medium leading-5 text-ink-strong shadow-[var(--shadow-chip)] motion-safe:transition-[scale,box-shadow] motion-safe:duration-200 motion-safe:ease-out hover:shadow-[var(--shadow-float)] motion-safe:active:scale-[0.98]"
                >
                  <span className="[text-wrap:pretty]">{choiceLabel(errand.id, c)}</span>
                  <ArrowRight
                    aria-hidden
                    className="size-4 shrink-0 text-ink-subtle motion-safe:transition-[translate] motion-safe:duration-200 group-hover:translate-x-0.5"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
