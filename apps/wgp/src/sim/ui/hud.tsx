"use client";

/**
 * The HUD over the canvas, in the sticker kit. It reads a snapshot the loop publishes
 * about 10 times a second (never per-frame state) and sends abilities, Gwei and pause
 * back through callbacks. The 2D and 3D games share it: the 3D night passes its own hint
 * copy and, on touch, lays the powers out in a right-thumb arc.
 */
import { useSyncExternalStore, type ReactNode } from "react";

import type { SuitColors } from "@/components/cast";
import { StickerMeter, StickerPanel } from "@/components/game/kit";
import { Check, ShieldCheck, X, Zap } from "@/components/icons";
import type { CastId } from "@wgp/game-core/cast";
import { ALLY_CAST, VILLAINS } from "@wgp/game-core/data";
import type { Stop, StopResult } from "@wgp/game-core/types";

import type { AbilityHud, HudSnapshot, HudStore } from "../loop";
import { Chip, Face, HeroFace, Kbd, POWER_HELP, POWER_ICONS } from "./bits";

export const stopCast = (stop: Stop): CastId => (stop.kind === "fight" ? stop.villain : ALLY_CAST[stop.ally]);

export function useHud(store: HudStore): HudSnapshot | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}

function Vitals({ hud, combo }: { hud: HudSnapshot; combo?: ReactNode }) {
  const buffs = [
    hud.buffs.shield && "Shield",
    hud.buffs.cloak && "Cloaked",
    hud.buffs.finality && "Next hit ×2",
    hud.buffs.fork && "Forked",
    hud.buffs.slowmo && "Slow-mo",
  ].filter(Boolean) as string[];
  return (
    <div className="flex items-start gap-2 md:flex-col">
      <StickerPanel className="flex w-[164px] shrink-0 flex-col gap-2 rounded-[18px] px-3 py-2.5 sm:w-[224px]">
        <StickerMeter label="Health" value={hud.hp} max={hud.maxHp} fill="bg-game-hero" />
        <StickerMeter label="Web fluid" value={hud.fluid} max={hud.maxFluid} fill="bg-fluid" />
      </StickerPanel>
      <div className="flex flex-col items-start gap-1.5 md:flex-row md:flex-wrap">
        {combo ?? (
          <Chip tone={hud.combo > 0 ? "paper" : "muted"} size="sm" className="num">
            <Zap aria-hidden className="size-3.5" strokeWidth={2.25} />
            Combo {hud.combo}
          </Chip>
        )}
        {buffs.map((b) => (
          <Chip key={b} tone="gold" size="sm">
            <ShieldCheck aria-hidden className="size-3.5" strokeWidth={2.25} />
            {b}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function RouteBar({ hud, stops, results, positions, hero, className = "" }: { hud: HudSnapshot; stops: Stop[]; results: StopResult[]; positions: number[]; hero: SuitColors; className?: string }) {
  return (
    <StickerPanel as="nav" aria-label="Tonight’s route" className={`h-[60px] rounded-full px-6 ${className}`}>
      <div className="relative mx-3 h-full">
        <span aria-hidden className="absolute inset-x-0 top-[38px] h-[3px] -translate-y-1/2 rounded-full bg-game-paper-2" />
        <span aria-hidden className="absolute left-0 top-[38px] h-[3px] -translate-y-1/2 rounded-full bg-game-ink" style={{ width: `${hud.progress * 100}%` }} />
        <ol className="contents">
          {stops.map((stop, i) => {
            const r = results[i];
            const current = i === hud.index && !r;
            const label = stop.kind === "fight" ? `${VILLAINS[stop.villain].name}${stop.boss ? ", boss" : ""}` : "an errand";
            return (
              <li
                key={i}
                className="absolute top-[38px] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${positions[i] * 100}%` }}
                aria-current={current ? "step" : undefined}
              >
                <span className="sr-only">{`Stop ${i + 1}: ${label}${r ? (r.kind === "fight" ? (r.outcome === "won" ? ", caught" : ", knocked out") : ", done") : current ? ", next" : ""}`}</span>
                <span className="relative block">
                  <Face id={stopCast(stop)} className={`size-8 ${current ? "outline-[2.5px] outline-offset-1 outline-game-hero" : ""}`} />
                  {r ? (
                    <span aria-hidden className={`absolute -bottom-1 -right-1 grid size-[18px] place-items-center rounded-full border-2 border-game-ink ${r.kind === "fight" && r.outcome !== "won" ? "bg-game-hero text-white" : "bg-game-mint text-game-ink"}`}>
                      {r.kind === "fight" && r.outcome !== "won" ? <X className="size-2.5" strokeWidth={3} /> : <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                  ) : stop.kind === "fight" && stop.boss ? (
                    <span aria-hidden className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border-2 border-game-ink bg-game-hero px-1 text-[9px] font-bold uppercase leading-3 tracking-[0.04em] text-white">
                      Boss
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
        <span aria-hidden className="absolute top-[3px] -translate-x-1/2" style={{ left: `${hud.progress * 100}%` }}>
          <HeroFace colors={hero} className="size-[18px] rounded-full border-[1.5px]" />
        </span>
      </div>
    </StickerPanel>
  );
}

function VillainBar({ hud }: { hud: HudSnapshot }) {
  const v = hud.villain;
  if (!v || hud.mode === "intro") return null;
  const doc = v.kind === "doc-octochain";
  return (
    <StickerPanel className="flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4">
      <Face id={v.kind} className="size-9 rounded-full" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-4">
          <span className="truncate">{v.name}</span>
          {v.boss ? <span className="rounded-full bg-game-hero px-1.5 text-[10px] font-bold uppercase leading-4 tracking-[0.04em] text-white">Boss</span> : null}
        </p>
        <p className="flex items-center gap-1" aria-label={`${v.hits} of ${v.hitsMax} hits left`}>
          {Array.from({ length: v.hitsMax }, (_, i) => (
            <span key={i} aria-hidden className={`size-2.5 rounded-full border-2 border-game-ink ${i < v.hits ? "bg-game-hero" : "bg-game-paper-2"}`} />
          ))}
        </p>
      </div>
      {doc ? (
        <span className={`ml-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold leading-5 ${v.open ? "bg-game-gold" : "bg-game-paper-2 text-game-muted"}`}>
          {v.open ? "Open: hit him" : "Arms out"}
        </span>
      ) : null}
    </StickerPanel>
  );
}

function AbilityButton({ a, onUse, compact = false }: { a: AbilityHud; onUse: () => void; compact?: boolean }) {
  const Icon = POWER_ICONS[a.id];
  const cooling = a.cd > 0;
  const pct = cooling ? a.cd / a.cdMax : 0;
  const C = 2 * Math.PI * 29;
  const why = a.reason === "fluid" ? "not enough web fluid" : a.reason === "cooldown" ? `ready in ${Math.ceil(a.cd)} seconds` : a.reason === "target" ? "nobody in reach" : null;
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label={`${a.name}, key ${a.key}${why ? `, ${why}` : ""}. ${POWER_HELP[a.id]}`}
        aria-disabled={!a.ready || undefined}
        onPointerDown={(e) => e.preventDefault()}
        onClick={onUse}
        className={`relative grid size-14 place-items-center rounded-full border-[2.5px] border-game-ink shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)] ${compact ? "" : "sm:size-16"} ${
          a.ready ? "bg-game-paper text-game-ink" : "bg-game-paper-2 text-game-muted"
        }`}
      >
        {cooling ? (
          <span aria-hidden className="num text-[20px] font-bold leading-none sm:text-[22px]">
            {Math.ceil(a.cd)}
          </span>
        ) : (
          <Icon aria-hidden className="size-6 sm:size-7" strokeWidth={2} />
        )}
        {cooling ? (
          <svg aria-hidden viewBox="0 0 64 64" className="pointer-events-none absolute -inset-[2.5px] size-[calc(100%+5px)] -rotate-90">
            <circle cx="32" cy="32" r="29" fill="none" stroke="var(--game-hero)" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
          </svg>
        ) : null}
        {cooling ? null : a.reason === "fluid" ? (
          <span aria-hidden className="absolute -bottom-2 whitespace-nowrap rounded-full border-2 border-game-ink bg-fluid px-1.5 text-[10px] font-bold leading-4 text-white">
            Fluid
          </span>
        ) : null}
        <Kbd className="absolute -left-1.5 -top-1.5">{a.key}</Kbd>
      </button>
      {compact ? null : (
        <span aria-hidden className="hidden max-w-[76px] truncate text-[11px] font-semibold leading-4 text-game-paper [text-shadow:0_1px_0_var(--game-ink),0_-1px_0_var(--game-ink),1px_0_0_var(--game-ink),-1px_0_0_var(--game-ink)] pointer-fine:block">
          {a.name}
        </span>
      )}
    </div>
  );
}

/** The arc's centre (the thumb pad), CSS px from the bottom-right corner; buttons are 56px. */
const ARC_CORNER = 48;
const ARC_BUTTON = 56;

/** The arc's radius for `n` buttons: neighbours keep a 6px gap, and never closer than 104px to the pad. */
const arcRadius = (n: number) => (n < 2 ? 104 : Math.max(104, (ARC_BUTTON / 2 + 3) / Math.sin(Math.PI / (4 * (n - 1)))));

/**
 * Touch: the powers (and Gwei, in fights) on a quarter circle around a thumb pad in the
 * bottom-right corner, from left of the thumb to above it. The pad is only a picture of
 * where to hold: touches pass through it to the play surface, where the right side holds
 * the web.
 */
function AbilityArc({ hud, fight, onAbility, onGwei }: { hud: HudSnapshot; fight: boolean; onAbility: (slot: number) => void; onGwei: () => void }) {
  const gwei = fight && hud.gwei.left > 0;
  const n = hud.abilities.length + (gwei ? 1 : 0);
  const r = arcRadius(n);
  const at = (i: number) => {
    const angle = Math.PI * (1 + 0.5 * (n === 1 ? 0.5 : i / (n - 1)));
    return { right: ARC_CORNER - Math.cos(angle) * r - ARC_BUTTON / 2, bottom: ARC_CORNER - Math.sin(angle) * r - ARC_BUTTON / 2 };
  };
  return (
    <div className="absolute bottom-[env(safe-area-inset-bottom)] right-[env(safe-area-inset-right)] size-0">
      <span
        aria-hidden
        className="absolute grid size-[68px] place-items-center rounded-full border-[2.5px] border-dashed border-game-paper/80 bg-game-ink/30 text-[11px] font-bold uppercase leading-none tracking-[0.06em] text-game-paper"
        style={{ right: ARC_CORNER - 34, bottom: ARC_CORNER - 34 }}
      >
        Web
      </span>
      {hud.abilities.map((a, i) => (
        <div key={a.id} className="pointer-events-auto absolute" style={at(i)}>
          <AbilityButton a={a} onUse={() => onAbility(i)} compact />
        </div>
      ))}
      {gwei ? (
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={onGwei}
          aria-disabled={!hud.gwei.ready || undefined}
          aria-label="Call Gwei Stacy. She swings in for two hits."
          className="pointer-events-auto absolute grid size-14 place-items-center rounded-full border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)] aria-disabled:opacity-50"
          style={at(n - 1)}
        >
          <Face id="gwei" className="size-10 rounded-full" />
        </button>
      ) : null}
    </div>
  );
}

export function Hud({
  store,
  stops,
  results,
  positions,
  hero,
  onAbility,
  onGwei,
  onPause,
  touch,
  hint,
  arc = false,
  minimap,
  combo,
}: {
  store: HudStore;
  stops: Stop[];
  results: StopResult[];
  positions: number[];
  hero: SuitColors;
  onAbility: (slot: number) => void;
  onGwei: () => void;
  onPause: () => void;
  touch: boolean;
  /** The first-stop hint, if not the 2D game's (hold to swing, A and D steer). */
  hint?: { title: string; body: string };
  /** On touch, put the powers in a right-thumb arc (the 3D night, where the right side holds the web). */
  arc?: boolean;
  /**
   * The 3D night's minimap: bottom left with a mouse; on touch (with `arc`), top right under
   * the route bar, away from the left-side stick, and out of the way of the villain bar in a
   * phone's fights. The first-stop hint moves beside it.
   */
  minimap?: ReactNode;
  /** In place of the combo chip (the 3D night's combo meter). */
  combo?: ReactNode;
}) {
  const hud = useHud(store);
  if (!hud || hud.status === "loading") return null;
  // Controls only while there's swinging or fighting to do (not over an errand sheet or a knockout).
  const playing = (hud.status === "live" || hud.status === "intro") && (hud.mode === "travel" || hud.mode === "fight" || hud.mode === "intro");
  const fight = hud.mode === "fight" && !!hud.villain;
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 pt-[max(12px,env(safe-area-inset-top))] sm:p-4">
        <div className="pointer-events-auto">
          <Vitals hud={hud} combo={combo} />
        </div>
        <div className="pointer-events-auto absolute left-1/2 top-4 hidden w-[min(44vw,560px)] -translate-x-1/2 flex-col items-center gap-2 md:flex">
          <RouteBar hud={hud} stops={stops} results={results} positions={positions} hero={hero} className="w-full" />
          <VillainBar hud={hud} />
        </div>
        <button
          type="button"
          onClick={onPause}
          aria-label="Pause"
          className="pointer-events-auto grid size-11 place-items-center rounded-full border-[2.5px] border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)]"
        >
          <span aria-hidden className="flex gap-[5px]">
            <span className="h-4 w-[5px] rounded-full bg-game-ink" />
            <span className="h-4 w-[5px] rounded-full bg-game-ink" />
          </span>
        </button>
      </div>
      <div className="pointer-events-auto absolute inset-x-3 top-[118px] flex flex-col items-center gap-2 sm:top-[128px] md:hidden">
        <RouteBar hud={hud} stops={stops} results={results} positions={positions} hero={hero} className="w-full max-w-[520px]" />
        <VillainBar hud={hud} />
      </div>

      {minimap ? (
        arc && touch ? (
          <div className={`pointer-events-auto absolute right-3 top-[190px] sm:top-[200px] md:right-4 md:top-[76px] ${hud.villain ? "max-md:hidden" : ""}`}>{minimap}</div>
        ) : (
          <div className="pointer-events-auto absolute bottom-0 left-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:p-5 sm:pb-[max(20px,env(safe-area-inset-bottom))]">{minimap}</div>
        )
      ) : null}

      {playing && arc && touch ? <AbilityArc hud={hud} fight={fight} onAbility={onAbility} onGwei={onGwei} /> : null}
      {playing && !(arc && touch) ? (
        <div className="absolute bottom-0 right-0 flex flex-col items-end gap-3 p-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:p-5">
          {fight && hud.gwei.left > 0 ? (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={onGwei}
              aria-disabled={!hud.gwei.ready || undefined}
              aria-label="Call Gwei Stacy, key G. She swings in for two hits."
              className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full border-[2.5px] border-game-ink bg-game-paper py-1 pl-1 pr-4 text-[14px] font-semibold text-game-ink shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)] aria-disabled:opacity-50"
            >
              <Face id="gwei" className="size-9 rounded-full" />
              Call Gwei
              <Kbd>G</Kbd>
            </button>
          ) : null}
          <div className="pointer-events-auto flex items-start gap-2.5 sm:gap-3">
            {hud.abilities.map((a, i) => (
              <AbilityButton key={a.id} a={a} onUse={() => onAbility(i)} />
            ))}
          </div>
        </div>
      ) : null}

      {hud.hint && playing ? (
        <div
          className={
            arc && touch
              ? "absolute left-0 top-[184px] p-3 sm:top-[194px] md:top-[112px]"
              : minimap
                ? "absolute bottom-0 left-[196px] p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:left-[208px] sm:p-5 sm:pb-[max(20px,env(safe-area-inset-bottom))]"
                : "absolute bottom-[calc(84px+env(safe-area-inset-bottom))] left-0 p-3 sm:bottom-0 sm:p-5 sm:pb-[max(20px,env(safe-area-inset-bottom))]"
          }
        >
          <StickerPanel className={`flex flex-col gap-1 rounded-[16px] px-3.5 py-2.5 ${minimap && arc && touch ? "max-w-[min(260px,calc(100vw-156px))]" : "max-w-[260px]"} sm:max-w-[300px]`}>
            <p className="text-[14px] font-bold leading-5">{hint ? hint.title : touch ? "Hold the left side to swing" : "Hold to swing"}</p>
            <p className="text-[13px] leading-[18px] text-game-muted">
              {hint ? hint.body : touch ? "Let go while you’re rising for a perfect swing." : "Space, or hold the mouse. Let go while you’re rising for a perfect swing. A and D steer."}
            </p>
          </StickerPanel>
        </div>
      ) : null}
    </div>
  );
}
