"use client";

/**
 * The HUD over the canvas, in the sticker kit. It reads a snapshot the loop publishes
 * about 10 times a second (never per-frame state) and sends abilities, Gwei and pause
 * back through callbacks. The 2D and 3D games share it: the 3D night passes its own hint
 * copy and, on touch, a layout of its own (TouchHud): the powers in a right-thumb arc and
 * the rest stacked down from the top, inside the screen's safe area, in a column on a
 * phone held upright and across the top on one held sideways.
 *
 * Only the pause button, the minimap and the powers take touches; every other panel lets
 * them through to the play surface, so a thumb landing on a sticker still steers or webs.
 */
import { useRef, useSyncExternalStore, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";

import type { SuitColors } from "@/components/cast";
import { StickerMeter, StickerPanel } from "@/components/game/kit";
import { Check, ShieldCheck, Smartphone, X, Zap } from "@/components/icons";
import type { CastId } from "@wgp/game-core/cast";
import { ALLY_CAST, VILLAINS } from "@wgp/game-core/data";
import type { Stop, StopResult } from "@wgp/game-core/types";

import type { AbilityHud, HudSnapshot, HudStore } from "../loop";
import { ARC_BUTTON, ARC_PAD, arcLayout } from "./arc";
import { Chip, Face, HeroFace, Kbd, POWER_HELP, POWER_ICONS } from "./bits";
import { useNarrowViewport, useShortViewport } from "./hooks";

export const stopCast = (stop: Stop): CastId => (stop.kind === "fight" ? stop.villain : ALLY_CAST[stop.ally]);

export function useHud(store: HudStore): HudSnapshot | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
}

/**
 * One value from the HUD snapshot: the component re-renders only when that value changes,
 * not on every snapshot (about 10 a second while the route bar and meters move).
 */
export function useHudValue<T extends string | number | boolean | null | undefined>(store: HudStore, select: (hud: HudSnapshot | null) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(null),
  );
}

/**
 * A game button's press: on touch it fires the moment the finger lands (no wait for the
 * lift, and a thumb that slides a little still counts); a mouse click or the keyboard
 * fires on click as usual. The click a touch press leaves behind is skipped.
 */
function usePress(onUse: () => void) {
  const touchedAt = useRef(-Infinity);
  return {
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      if (e.pointerType !== "touch") return;
      touchedAt.current = e.timeStamp;
      onUse();
    },
    onClick: (e: MouseEvent) => {
      if (e.timeStamp - touchedAt.current < 1000) return;
      onUse();
    },
  };
}

function Vitals({ hud, combo, stack = false, panel = "w-[164px] sm:w-[224px]" }: { hud: HudSnapshot; combo?: ReactNode; /** Combo and buffs under the meters (a phone on its side). */ stack?: boolean; panel?: string }) {
  const buffs = [
    hud.buffs.shield && "Shield",
    hud.buffs.cloak && "Cloaked",
    hud.buffs.finality && "Next hit ×2",
    hud.buffs.fork && "Forked",
    hud.buffs.slowmo && "Slow-mo",
  ].filter(Boolean) as string[];
  return (
    <div className={`flex items-start gap-2 ${stack ? "flex-col" : "md:flex-col"}`}>
      <StickerPanel className={`flex shrink-0 flex-col gap-2 rounded-[18px] px-3 py-2.5 ${stack ? "gap-1.5 py-2" : ""} ${panel}`}>
        <StickerMeter label="Health" value={hud.hp} max={hud.maxHp} fill="bg-game-hero" />
        <StickerMeter label="Web fluid" value={hud.fluid} max={hud.maxFluid} fill="bg-fluid" />
      </StickerPanel>
      <div className={`flex items-start gap-1.5 ${stack ? "flex-row flex-wrap" : "flex-col md:flex-row md:flex-wrap"}`}>
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
      {/* The Right-Clicker (Case File 001) has no sticker face yet. */}
      {v.kind !== "right-clicker" ? <Face id={v.kind} className="size-9 rounded-full" /> : null}
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
      ) : v.opening ? (
        // 3D: Gas Goblin's stall, Sandwich Man's stumble.
        <span className="ml-1 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-gold px-2 text-[11px] font-bold leading-5">Open: hit him</span>
      ) : v.guard ? (
        <span className="ml-1 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper-2 px-2 text-[11px] font-bold leading-5 text-game-muted">Guarding</span>
      ) : null}
    </StickerPanel>
  );
}

function AbilityButton({ a, onUse, compact = false }: { a: AbilityHud; onUse: () => void; compact?: boolean }) {
  const Icon = POWER_ICONS[a.id];
  const press = usePress(onUse);
  const cooling = a.cd > 0;
  const pct = cooling ? a.cd / a.cdMax : 0;
  const C = 2 * Math.PI * 29;
  const why = a.reason === "fluid" ? "not enough web fluid" : a.reason === "cooldown" ? `ready in ${Math.ceil(a.cd)} seconds` : a.reason === "target" ? "nobody in reach" : null;
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        data-power={a.id}
        aria-label={`${a.name}, key ${a.key}${why ? `, ${why}` : ""}. ${POWER_HELP[a.id]}`}
        aria-disabled={!a.ready || undefined}
        {...press}
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

function GweiButton({ ready, onGwei, className = "", style }: { ready: boolean; onGwei: () => void; className?: string; style?: CSSProperties }) {
  const press = usePress(onGwei);
  return (
    <button
      type="button"
      {...press}
      aria-disabled={!ready || undefined}
      aria-label="Call Gwei Stacy. She swings in for two hits."
      className={`pointer-events-auto absolute grid size-14 place-items-center rounded-full border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)] aria-disabled:opacity-50 ${className}`}
      style={style}
    >
      <Face id="gwei" className="size-10 rounded-full" />
    </button>
  );
}

/**
 * Touch: the powers on a quarter circle around a thumb pad in the bottom-right corner of
 * the safe area, from left of the thumb to above it, and Gwei (in fights) above the top
 * one (sim/ui/arc.ts). The pad is only a picture of where to hold: touches pass through it
 * to the play surface, where the right side holds the web. The arc's box is a HUD zone the
 * waypoint keeps out of.
 */
function AbilityArc({ hud, fight, onAbility, onGwei }: { hud: HudSnapshot; fight: boolean; onAbility: (slot: number) => void; onGwei: () => void }) {
  const gwei = fight && hud.gwei.left > 0;
  const arc = arcLayout(hud.abilities.length, gwei);
  return (
    <div data-hud-zone="avoid" className="absolute bottom-[env(safe-area-inset-bottom)] right-[env(safe-area-inset-right)]" style={{ width: arc.width, height: arc.height }}>
      <span
        aria-hidden
        className="absolute grid place-items-center rounded-full border-[2.5px] border-dashed border-game-paper/80 bg-game-ink/30 text-[11px] font-bold uppercase leading-none tracking-[0.06em] text-game-paper"
        style={{ right: arc.pad.right, bottom: arc.pad.bottom, width: ARC_PAD, height: ARC_PAD }}
      >
        Web
      </span>
      {hud.abilities.map((a, i) => (
        <div key={a.id} className="pointer-events-auto absolute" style={{ ...arc.powers[i], width: ARC_BUTTON, height: ARC_BUTTON }}>
          <AbilityButton a={a} onUse={() => onAbility(i)} compact />
        </div>
      ))}
      {arc.gwei ? <GweiButton ready={hud.gwei.ready} onGwei={onGwei} style={arc.gwei} /> : null}
    </div>
  );
}

function PauseButton({ onPause }: { onPause: () => void }) {
  return (
    <button
      type="button"
      onClick={onPause}
      aria-label="Pause"
      className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full border-[2.5px] border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)] pointer-coarse:size-12"
    >
      <span aria-hidden className="flex gap-[5px]">
        <span className="h-4 w-[5px] rounded-full bg-game-ink" />
        <span className="h-4 w-[5px] rounded-full bg-game-ink" />
      </span>
    </button>
  );
}

function HintPanel({ title, body, turn = false, className = "" }: { title: string; body: string; /** Suggest turning a phone held upright. */ turn?: boolean; className?: string }) {
  return (
    <StickerPanel className={`flex flex-col gap-1 rounded-[16px] px-3.5 py-2.5 ${className}`}>
      <p className="text-[14px] font-bold leading-5 text-balance">{title}</p>
      <p className="text-[13px] leading-[18px] text-pretty text-game-muted">{body}</p>
      {turn ? (
        <p className="mt-1.5 flex items-center gap-1.5 border-t-2 border-dashed border-game-ink/20 pt-2 text-[12px] font-semibold leading-4 text-game-muted">
          <Smartphone aria-hidden className="size-4 shrink-0 rotate-90" strokeWidth={2} />
          Turn your phone sideways for a wider view.
        </p>
      ) : null}
    </StickerPanel>
  );
}

interface HudProps {
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
  /** On touch, the 3D night's layout: the powers in a right-thumb arc (the right side holds the web) and the rest from the top (TouchHud). */
  arc?: boolean;
  /**
   * The 3D night's minimap: bottom left with a mouse; on touch (with `arc`), at the right
   * under the route bar (beside the pause button on a phone held sideways), away from the
   * left-side stick, and hidden in a phone's fights, where the villain bar takes its place.
   */
  minimap?: ReactNode;
  /** In place of the combo chip (the 3D night's combo meter). */
  combo?: ReactNode;
}

/**
 * The 3D night on touch. The top stacks down inside the safe area: on a phone held upright,
 * the meters and pause, the route bar (and the villain bar in a fight), then the first-leg
 * hint and the minimap side by side; on one held sideways, the meters and the hint down the
 * left, the route and villain bars in the middle, pause and the minimap at the right. It's
 * all flow layout, so nothing overlaps whichever way the phone is held, and the middle of
 * the screen, where the hero is, stays clear. Elements marked `data-hud-zone` are measured
 * by the waypoint (patrol/waypoint.tsx) to stay out of their way.
 */
function TouchHud({ hud, stops, results, positions, hero, onAbility, onGwei, onPause, hint, minimap, combo, playing }: Omit<HudProps, "store" | "touch" | "arc"> & { hud: HudSnapshot; playing: boolean }) {
  const short = useShortViewport();
  const narrow = useNarrowViewport();
  const fight = hud.mode === "fight" && !!hud.villain;
  // Phones (upright or sideways) give the minimap's spot to the villain bar in a fight; it
  // keeps its space, so nothing jumps when a fight starts.
  const mapHidden = (short || narrow) && !!hud.villain;
  const help = hint ?? { title: "Hold the right side to web", body: "Let go while you’re rising for a perfect swing." };
  const hintPanel = hud.hint && playing ? <HintPanel title={help.title} body={help.body} turn={narrow && !short} className={short ? "w-[248px]" : "max-w-[300px]"} /> : null;
  const map = minimap ? (
    <div data-hud-zone={mapHidden ? undefined : "avoid"} aria-hidden={mapHidden || undefined} className={`shrink-0 ${mapHidden ? "invisible" : "pointer-events-auto"}`}>
      {minimap}
    </div>
  ) : null;
  const route = <RouteBar hud={hud} stops={stops} results={results} positions={positions} hero={hero} className={`w-full ${short ? "max-w-[460px]" : "max-w-[520px]"}`} />;
  const edges = "pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] pt-[max(12px,env(safe-area-inset-top))]";
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {short ? (
        <div className={`absolute inset-x-0 top-0 flex items-start gap-3 ${edges}`}>
          <div className="flex w-[180px] shrink-0 flex-col gap-2">
            {/* Sideways, the band is only the middle column: the waypoint may come up beside it. */}
            <div data-hud-zone="avoid">
              <Vitals hud={hud} combo={combo} stack panel="w-full" />
            </div>
            {hintPanel ? <div data-hud-zone="avoid" className="w-fit">{hintPanel}</div> : null}
          </div>
          <div data-hud-zone="band" className="flex min-w-0 flex-1 flex-col items-center gap-2">
            {route}
            <VillainBar hud={hud} />
          </div>
          <PauseButton onPause={onPause} />
          {map}
        </div>
      ) : (
        <div className={`absolute inset-x-0 top-0 flex flex-col gap-2 ${edges}`}>
          <div className="flex items-start justify-between gap-2">
            <div data-hud-zone="band" className="min-w-0">
              {/* On a 360px phone the meters' labels go a size down so "Web fluid 100 / 100" stays on one line. */}
              <Vitals hud={hud} combo={combo} panel="w-[clamp(140px,40vw,164px)] sm:w-[224px] max-[379px]:[&>div>div:first-child]:gap-2 max-[379px]:[&>div>div:first-child]:text-[11px]" />
            </div>
            <PauseButton onPause={onPause} />
          </div>
          <div data-hud-zone="band" className="flex flex-col items-center gap-2">
            {route}
            <VillainBar hud={hud} />
          </div>
          {hintPanel || map ? (
            <div className="flex items-start justify-between gap-3">
              {hintPanel ? (
                <div data-hud-zone="avoid" className="min-w-0">
                  {hintPanel}
                </div>
              ) : (
                <span />
              )}
              {map}
            </div>
          ) : null}
        </div>
      )}
      {playing ? <AbilityArc hud={hud} fight={fight} onAbility={onAbility} onGwei={onGwei} /> : null}
    </div>
  );
}

export function Hud({ store, stops, results, positions, hero, onAbility, onGwei, onPause, touch, hint, arc = false, minimap, combo }: HudProps) {
  const hud = useHud(store);
  if (!hud || hud.status === "loading") return null;
  // Controls only while there's swinging or fighting to do (not over an errand sheet or a knockout).
  const playing = (hud.status === "live" || hud.status === "intro") && (hud.mode === "travel" || hud.mode === "fight" || hud.mode === "intro");
  if (arc && touch)
    return <TouchHud hud={hud} stops={stops} results={results} positions={positions} hero={hero} onAbility={onAbility} onGwei={onGwei} onPause={onPause} hint={hint} minimap={minimap} combo={combo} playing={playing} />;
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
        <PauseButton onPause={onPause} />
      </div>
      <div className="pointer-events-auto absolute inset-x-3 top-[118px] flex flex-col items-center gap-2 sm:top-[128px] md:hidden">
        <RouteBar hud={hud} stops={stops} results={results} positions={positions} hero={hero} className="w-full max-w-[520px]" />
        <VillainBar hud={hud} />
      </div>

      {minimap ? <div className="pointer-events-auto absolute bottom-0 left-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:p-5 sm:pb-[max(20px,env(safe-area-inset-bottom))]">{minimap}</div> : null}

      {playing ? (
        <div className="absolute bottom-0 right-0 flex flex-col items-end gap-3 p-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:p-5">
          {fight && hud.gwei.left > 0 ? <GweiChip ready={hud.gwei.ready} onGwei={onGwei} /> : null}
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
            minimap
              ? "absolute bottom-0 left-[196px] p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:left-[208px] sm:p-5 sm:pb-[max(20px,env(safe-area-inset-bottom))]"
              : "absolute bottom-[calc(84px+env(safe-area-inset-bottom))] left-0 p-3 sm:bottom-0 sm:p-5 sm:pb-[max(20px,env(safe-area-inset-bottom))]"
          }
        >
          <HintPanel
            title={hint ? hint.title : touch ? "Hold the left side to swing" : "Hold to swing"}
            body={hint ? hint.body : touch ? "Let go while you’re rising for a perfect swing." : "Space, or hold the mouse. Let go while you’re rising for a perfect swing. A and D steer."}
            className="max-w-[260px] sm:max-w-[300px]"
          />
        </div>
      ) : null}
    </div>
  );
}

/** Desktop and the 2D game: Gwei as a labelled chip above the powers. */
function GweiChip({ ready, onGwei }: { ready: boolean; onGwei: () => void }) {
  const press = usePress(onGwei);
  return (
    <button
      type="button"
      {...press}
      aria-disabled={!ready || undefined}
      aria-label="Call Gwei Stacy, key G. She swings in for two hits."
      className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full border-[2.5px] border-game-ink bg-game-paper py-1 pl-1 pr-4 text-[14px] font-semibold text-game-ink shadow-[var(--game-shadow)] focus-visible:outline-offset-4 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-[var(--game-shadow-sm)] aria-disabled:opacity-50"
    >
      <Face id="gwei" className="size-9 rounded-full" />
      Call Gwei
      <Kbd>G</Kbd>
    </button>
  );
}
