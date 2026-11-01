"use client";

import { Check, Handshake, Swords, Zap } from "@/components/icons";
import { HeroTile, Meter, type HeroSave } from "@/components/game/ui";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { MAX_FLUID } from "@/game/data";
import type { Patrol, Stop } from "@/game/types";

import { districtName, stopName, stopWho } from "./shared";

type StepState = "caught" | "knocked-out" | "done" | "now" | "next" | "upcoming" | "skipped";

function stepState(p: Patrol, i: number): StepState {
  const result = p.results[i];
  if (result) {
    if (result.kind === "errand") return "done";
    return result.outcome === "won" ? "caught" : "knocked-out";
  }
  if (p.phase === "summary") return "skipped";
  if (i === p.index) return p.phase === "stop" ? "now" : "next";
  return "upcoming";
}

const kindLabel = (stop: Stop) => (stop.kind === "errand" ? "Errand" : stop.boss ? "Boss" : "Fight");

function stateLabel(state: StepState, stop: Stop): string {
  switch (state) {
    case "caught":
      return "Caught";
    case "knocked-out":
      return "Knocked out";
    case "done":
      return "Helped";
    case "now":
      return "You’re here";
    case "next":
      return "Up next";
    case "skipped":
      return "Not reached";
    case "upcoming":
      return kindLabel(stop);
  }
}

/** The route: four stops with who's there, what kind of stop it is, and how it went. */
function RouteStepper({ p }: { p: Patrol }) {
  return (
    <ol aria-label="Tonight’s route" className="grid grid-cols-4 gap-1 rounded-card bg-surface p-1">
      {p.stops.map((stop, i) => {
        const state = stepState(p, i);
        const current = state === "now" || state === "next";
        const finished = state === "caught" || state === "done";
        const KindIcon = stop.kind === "fight" ? Swords : Handshake;
        return (
          <li
            key={i}
            aria-current={current ? "step" : undefined}
            className={`relative flex min-w-0 flex-col gap-2 rounded-[12px] p-1.5 min-[360px]:p-2 sm:flex-row sm:items-center sm:gap-3 sm:p-2.5 ${
              current ? "bg-canvas shadow-[var(--shadow-chip)]" : ""
            } ${state === "skipped" ? "opacity-60" : ""}`}
          >
            <span className="relative w-fit shrink-0">
              <MiniAvatar id={stopWho(stop)} className="size-9 rounded-[10px] sm:size-10" />
              {/* Corner badge: a check once it's done, otherwise what kind of stop it is. */}
              <span
                aria-hidden
                className={`absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full ring-2 ${
                  current ? "ring-canvas" : "ring-surface"
                } ${
                  finished
                    ? "bg-on-success text-canvas"
                    : state === "knocked-out"
                      ? "bg-accent text-on-accent"
                      : "bg-[image:var(--tile-solid)] text-on-tile"
                }`}
              >
                {finished ? <Check className="size-3" strokeWidth={2.5} /> : <KindIcon className="size-3" strokeWidth={2} />}
              </span>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-medium leading-4 text-ink-strong [overflow-wrap:anywhere] min-[360px]:text-[12px] sm:text-[13px]">
                {districtName(stop)}
              </span>
              <span
                className={`flex items-center gap-1 text-[11px] leading-4 sm:text-[12px] ${current ? "font-medium text-accent" : "text-ink-subtle"}`}
              >
                {current ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
                {stateLabel(state, stop)}
              </span>
              <span className="sr-only">
                {`, stop ${i + 1} of ${p.stops.length}: ${kindLabel(stop).toLowerCase()} with ${stopName(stop)}`}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The swing combo: perfect swings in a row. Said in words, not only the accent. */
function Combo({ combo, className = "" }: { combo: number; className?: string }) {
  return (
    <span
      className={`h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 text-[13px] font-medium leading-4 ${
        combo > 0 ? "bg-accent-subtle text-accent" : "bg-surface-2 text-ink-subtle"
      } ${className}`}
    >
      <Zap aria-hidden className="size-3.5" strokeWidth={2} />
      <span>
        Combo <span className="num">{combo}</span>
      </span>
    </span>
  );
}

/**
 * Every phase of the patrol sits under this: the night, what's happening now, the
 * route, health, web fluid and the swing combo.
 */
export function PatrolHeader({ save, headline }: { save: HeroSave; headline: string }) {
  const p = save.patrol!;
  return (
    <section aria-labelledby="patrol-title" className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
      <div className="flex flex-col gap-4 px-2 pb-4 pt-2 sm:px-3 sm:pt-3 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 items-center gap-3">
          <HeroTile suit={save.hero.suit} className="size-11 rounded-[12px]" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-[13px] leading-5 text-ink-subtle">{save.hero.name} on patrol</p>
            <h1
              id="patrol-title"
              tabIndex={-1}
              className="font-display text-[20px] font-medium leading-6 tracking-[-0.025em] outline-none sm:text-[26px] sm:leading-8"
            >
              <span className="num text-ink-faint">Night {p.night}</span> <span className="text-ink-strong">{headline}</span>
            </h1>
          </div>
          <Combo combo={p.combo} className="inline-flex self-start lg:hidden" />
        </div>
        <div className="grid grid-cols-2 items-end gap-4 lg:w-[480px] lg:shrink-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Meter label="Health" value={p.hp} max={p.maxHp} tone="accent" />
          <Meter label="Web fluid" value={p.fluid} max={MAX_FLUID} tone="fluid" />
          <Combo combo={p.combo} className="hidden lg:inline-flex" />
        </div>
      </div>
      <RouteStepper p={p} />
    </section>
  );
}
