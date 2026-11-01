"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { MEDIA_PALETTES, type SceneName } from "@/components/art/scenes";
import { ShaderCanvas } from "@/components/art/shader-canvas";
import { Sticker } from "@/components/cast";
import { HeroSticker, HeroTile, Meter, type HeroSave } from "@/components/game/ui";
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  Layers,
  Link2,
  Lock,
  MapPin,
  Medal,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  Zap,
} from "@/components/icons";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { Button } from "@/components/ui";
import { DISTRICTS, GWEI_ASSIST, MAX_FLUID, POWERS, PUNCH, VILLAINS, powerLevel, powerScale } from "@/game/data";
import { moveBlocked, moveCost, reduce } from "@/game/engine";
import type { Fight, FightLine, Hero, Intent, MoveId, Patrol, PowerId, VillainId } from "@/game/types";

import { EFFECT_ICONS, Effect, LootChips, MOVE_ICONS, SpeechBubble, Tag } from "./shared";
import { SceneMedia } from "./scene-media";

/* ------------------------------------------------------------------ words */

const STRIKES: Intent["kind"][] = ["attack", "heavy", "drain", "frontrun", "grab", "swarm"];

/** What the villain does this turn, with the numbers, in a sentence. */
function intentDetail(intent: Intent, f: Fight): { damage: number | null; text: string } {
  const strike = STRIKES.includes(intent.kind);
  const per = f.charged && strike ? intent.value * 2 : intent.value;
  const doubled = f.charged && strike ? " (charged, so doubled)" : "";
  switch (intent.kind) {
    case "attack":
      return { damage: per, text: `Hits you for ${per}${doubled}.` };
    case "heavy":
      return { damage: per, text: `A heavy hit for ${per}${doubled}.` };
    case "frontrun":
      return { damage: per, text: `Strikes before your move, for ${per}${doubled}.` };
    case "drain":
      return { damage: per, text: `Hits for ${per}${doubled} and burns 10 web fluid.` };
    case "grab":
      return { damage: per, text: `Tears off your block, burns 8 fluid and hits for ${per}${doubled}.` };
    case "swarm": {
      const n = f.copies + 1;
      const total = per * n;
      return { damage: total, text: n > 1 ? `${n} of him hit for ${per} each: ${total}${doubled}.` : `Hits for ${per}${doubled}. More copies, more hits.` };
    }
    case "charge":
      return { damage: null, text: "Winds up. His next hit lands double." };
    case "summon":
      return { damage: null, text: `Adds a copy${f.copies >= 4 ? " (he’s at the limit of 4)" : ""}. Each copy soaks half of a hit.` };
    case "jam":
      return { damage: null, text: "Your powers cost 5 more web fluid for two turns." };
  }
}

/** A tip when one of your moves answers this turn, so the counters are learnable. */
function counterTip(save: HeroSave, intent: Intent, damage: number | null): string | null {
  const f = save.patrol!.fight!;
  const ready = (id: PowerId) => !moveBlocked(save, id);
  if (f.webbed > 0) return null;
  const strike = STRIKES.includes(intent.kind);
  if (f.dodges > 0 && strike) return "Node sense is up: it will miss.";
  if (intent.kind === "frontrun" && ready("front-run")) return "Front-run cancels it and hits 1.5×.";
  if ((intent.kind === "heavy" || intent.kind === "charge") && ready("yank")) return "Yank cancels it.";
  if (strike && damage !== null && damage >= 15) {
    if (ready("node-sense")) return "Node sense would dodge it.";
    if (ready("zk-cloak")) return "ZK cloak would dodge it.";
    if (ready("web-shield") && intent.kind !== "grab") {
      const block = Math.round((POWERS["web-shield"].block ?? 0) * powerScale(save.hero.powers["web-shield"]?.mastery ?? 0));
      return `Web shield would soak ${Math.min(block, damage)} of it.`;
    }
  }
  return null;
}

/** A power's effect at the hero's mastery, as short phrases. */
function powerStats(id: PowerId, hero: Hero, f: Fight): string[] {
  const pw = POWERS[id];
  const s = powerScale(hero.powers[id]?.mastery ?? 0);
  const out: string[] = [];
  if (pw.damage) {
    const dmg = Math.round(pw.damage * s);
    out.push(id === "finality" && f.webbed > 0 ? `${dmg * 2} damage, doubled` : `${dmg} damage`);
  }
  if (pw.block) out.push(`Soaks ${Math.round(pw.block * s)}`);
  if (pw.heal) out.push(`+${Math.round(pw.heal * s)} health`);
  if (pw.fluid) out.push(`+${Math.round(pw.fluid * s)} fluid`);
  if (pw.dodge) out.push(pw.dodge === 1 ? "Dodge 1 hit" : `Dodge ${pw.dodge} hits`);
  if (pw.stun) out.push("Webs 1 turn");
  if (id === "fork") out.push("Next power ×2");
  return out;
}

/* ------------------------------------------------------------------ scenery */

/** Each villain's district gets its own dithered backdrop. */
const SCENERY: Record<VillainId, { scene: SceneName; palette: [string, string, string, string]; seed: number }> = {
  "gas-goblin": { scene: "bloom", palette: MEDIA_PALETTES.ember, seed: 21 },
  "sandwich-man": { scene: "contours", palette: MEDIA_PALETTES.comic, seed: 5 },
  "doc-octochain": { scene: "beam", palette: MEDIA_PALETTES.nightcity, seed: 11 },
  sybil: { scene: "webs", palette: MEDIA_PALETTES.dusk2, seed: 17 },
};

/* ------------------------------------------------------------------ pieces */

interface Hit {
  n: number;
  /** Damage dealt to the villain and to you this turn (negative is a heal). */
  villain: number;
  hero: number;
  /** Lines the turn added to the log. */
  fresh: number;
}

function DamagePop({ value, heal = false }: { value: number; heal?: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute -top-3 right-2 z-10 rounded-[8px] border-2 border-ink-strong px-1.5 font-display text-[18px] font-semibold leading-6 shadow-[var(--shadow-chip)] motion-safe:animate-[wgp-patrol-pop_1100ms_var(--ease-out-quint)_both] ${
        heal ? "bg-success-fill text-on-success" : "bg-accent text-on-accent"
      }`}
    >
      <span className="num">
        {heal ? "+" : "−"}
        {value}
      </span>
    </span>
  );
}

function LogLine({ line, hero, villain, fresh }: { line: FightLine; hero: Hero; villain: VillainId; fresh: boolean }) {
  return (
    <li
      className={`flex items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] leading-5 ${
        fresh ? "bg-canvas text-ink-strong shadow-[var(--shadow-chip)]" : "text-ink"
      }`}
    >
      {line.who === "hero" ? (
        <HeroTile suit={hero.suit} className="mt-px size-[18px] rounded-[6px] ring-1" />
      ) : line.who === "villain" ? (
        <MiniAvatar id={villain} className="mt-px size-[18px] rounded-[6px] ring-1" />
      ) : (
        <span aria-hidden className="mt-px grid size-[18px] shrink-0 place-items-center rounded-[6px] bg-surface-2 text-ink-subtle">
          <Sparkles className="size-3" strokeWidth={2} />
        </span>
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="sr-only">{line.who === "hero" ? "You: " : line.who === "villain" ? "" : "Note: "}</span>
        {line.text}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ moves */

interface MoveView {
  id: MoveId;
  name: string;
  blurb: string;
  stats: string[];
  cost: number;
  level: number | null;
  jammed: boolean;
  blocked: string | null;
  cooldownBlocked: boolean;
}

function moveViews(save: HeroSave, p: Patrol, f: Fight): MoveView[] {
  const hero = save.hero;
  const views: MoveView[] = hero.loadout.map((id) => {
    const blocked = moveBlocked(save, id);
    return {
      id,
      name: POWERS[id].name,
      blurb: POWERS[id].blurb,
      stats: powerStats(id, hero, f),
      cost: moveCost(f, id),
      level: powerLevel(hero.powers[id]?.mastery ?? 0),
      jammed: f.jammed > 0,
      blocked,
      cooldownBlocked: (f.cooldowns[id] ?? 0) > 0,
    };
  });
  views.push({
    id: "punch",
    name: PUNCH.name,
    blurb: PUNCH.blurb,
    stats: [`${PUNCH.damage} damage`],
    cost: 0,
    level: null,
    jammed: false,
    blocked: moveBlocked(save, "punch"),
    cooldownBlocked: false,
  });
  if (p.gweiCalls > 0) {
    views.push({
      id: "gwei",
      name: GWEI_ASSIST.name,
      blurb: GWEI_ASSIST.blurb,
      stats: [`${GWEI_ASSIST.damage + 2 * hero.level} damage`, "Pops every copy"],
      cost: 0,
      level: null,
      jammed: false,
      blocked: moveBlocked(save, "gwei"),
      cooldownBlocked: false,
    });
  }
  return views;
}

function MoveCard({ view, index, onPick }: { view: MoveView; index: number; onPick: (id: MoveId) => void }) {
  const blocked = !!view.blocked;
  const reasonId = `move-${view.id}-reason`;
  const MoveIcon = view.id === "gwei" ? null : MOVE_ICONS[view.id];
  return (
    <button
      type="button"
      aria-disabled={blocked ? true : undefined}
      aria-describedby={blocked ? reasonId : undefined}
      aria-keyshortcuts={String(index + 1)}
      onClick={() => {
        if (!blocked) onPick(view.id);
      }}
      className={`group flex min-h-[132px] flex-col gap-2 rounded-card p-3 text-left motion-safe:transition-[scale,box-shadow,background-color] motion-safe:duration-200 motion-safe:ease-out ${
        blocked
          ? "cursor-not-allowed bg-surface"
          : "bg-canvas shadow-[var(--shadow-chip)] hover:shadow-[var(--shadow-float)] motion-safe:active:scale-[0.98]"
      }`}
    >
      <span className="flex items-center gap-2.5">
        {MoveIcon ? (
          <span
            aria-hidden
            className={`grid size-7 shrink-0 place-items-center rounded-[8px] [&>svg]:size-3.5 ${
              blocked ? "bg-surface-2 text-ink-subtle" : "bg-[image:var(--tile-solid)] text-on-tile shadow-[var(--shadow-tile)]"
            }`}
          >
            <MoveIcon strokeWidth={2} />
          </span>
        ) : (
          <MiniAvatar id="gwei" className="size-7 rounded-[8px]" />
        )}
        <span className={`min-w-0 flex-1 text-[15px] font-medium leading-5 tracking-[-0.01em] ${blocked ? "text-ink-subtle" : "text-ink-strong"}`}>
          {view.name}
        </span>
        <kbd
          aria-hidden
          className="hidden h-6 min-w-6 place-items-center rounded-[6px] bg-surface-2 px-1.5 font-sans text-[12px] font-medium leading-4 text-ink-subtle pointer-fine:grid"
        >
          {index + 1}
        </kbd>
      </span>
      <span className="text-[12px] leading-4 text-ink-subtle [text-wrap:pretty]">{view.blurb}</span>
      <span className="mt-auto flex flex-wrap items-center gap-1.5">
        {blocked ? (
          <span id={reasonId} className="inline-flex items-center gap-1.5 text-[12px] font-medium leading-4 text-ink-strong">
            {view.cooldownBlocked ? (
              <Clock aria-hidden className="size-3.5 text-ink-subtle" strokeWidth={2} />
            ) : (
              <Ban aria-hidden className="size-3.5 text-on-danger" strokeWidth={2} />
            )}
            {view.blocked}
          </span>
        ) : (
          <>
            <span className="num inline-flex h-6 items-center rounded-[7px] bg-surface-2 px-2 text-[11px] font-medium leading-4 text-ink">
              {view.stats[0]}
            </span>
            <span
              className={`inline-flex h-6 items-center gap-1 rounded-[7px] px-2 text-[11px] font-medium leading-4 ${
                view.jammed && view.cost > 0 ? "bg-warning-fill text-on-warning" : "bg-surface-2 text-ink"
              }`}
            >
              {view.jammed && view.cost > 0 ? <Lock aria-hidden className="size-3" strokeWidth={2} /> : null}
              {view.cost > 0 ? (
                <span className="num">
                  {view.cost} fluid{view.jammed ? ", jammed" : ""}
                </span>
              ) : (
                "Free"
              )}
            </span>
            {view.level ? <span className="num text-[11px] leading-4 text-ink-subtle">Lv {view.level}</span> : null}
          </>
        )}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ result */

function FightResult({ save, onLeave }: { save: HeroSave; onLeave: () => void }) {
  const p = save.patrol!;
  const f = p.fight!;
  const v = VILLAINS[f.villain];
  const result = p.results[p.results.length - 1];
  const won = f.result === "won";
  const ending = !won || p.index + 1 >= p.stops.length;
  const comboPct = Math.round(10 * Math.min(p.combo, 5));

  return (
    <section aria-labelledby="result-title" className="flex flex-col rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
      <div className="flex flex-1 flex-col gap-5 rounded-card bg-surface p-4 sm:p-6">
        <div className="flex items-start gap-4">
          {won ? (
            <Sticker id={f.villain} size="sm" label={false} />
          ) : (
            <span className="grid size-14 shrink-0 place-items-center">
              <MiniAvatar id="aunt-mainnet" className="size-14 rounded-[16px]" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <p className={`inline-flex items-center gap-1.5 text-[13px] font-medium leading-5 ${won ? "text-on-success" : "text-on-danger"}`}>
              {won ? <Check aria-hidden className="size-4" strokeWidth={2.5} /> : <AlertTriangle aria-hidden className="size-4" strokeWidth={2} />}
              {won ? `Caught ${v.name}` : "Knocked out"}
            </p>
            <h2
              id="result-title"
              tabIndex={-1}
              ref={(el) => el?.focus({ preventScroll: false })}
              className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em] text-ink-strong outline-none sm:text-[26px] sm:leading-8"
            >
              {won ? v.defeat : `${v.name} knocks you out.`}
            </h2>
            {!won ? (
              <p className="text-[14px] leading-[22px] text-ink-subtle">
                Aunt Mainnet patches you up with a slice of loaf. The rest of tonight’s route waits for tomorrow.
              </p>
            ) : null}
          </div>
        </div>

        {result ? (
          <div className="flex flex-col gap-3">
            <ul aria-label="What you got" className="flex flex-wrap gap-1.5">
              <Effect icon={EFFECT_ICONS.xp} value={result.xp} label="XP" />
              <Effect icon={EFFECT_ICONS.reputation} value={result.reputation} label="reputation" />
              <Effect icon={EFFECT_ICONS.responsibility} value={result.responsibility} label="responsibility" />
            </ul>
            {won && comboPct > 0 ? (
              <p className="text-[12px] leading-4 text-ink-subtle">
                XP includes <span className="num">+{comboPct}%</span> for your swing combo of <span className="num">{p.combo}</span>.
              </p>
            ) : null}
            {won ? <LootChips loot={result.loot} /> : null}
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] leading-5 text-ink-subtle">
            {ending
              ? won
                ? "That was the last stop tonight."
                : "Your patrol ends here tonight."
              : `Next: stop ${p.index + 2} of ${p.stops.length}, ${DISTRICTS[p.stops[p.index + 1].district].name}.`}
          </p>
          <Button type="button" size="lg" onClick={onLeave} className="w-full sm:w-auto">
            {ending ? "See the night’s haul" : "Swing on"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the fight */

/**
 * A fight at a stop: the villain, what he's about to do, you, your moves and the log.
 * Moves play on click or keys 1–6. Damage shakes whoever took it, when motion is on.
 */
export function FightStop({
  save,
  onMove,
  onLeave,
}: {
  save: HeroSave;
  onMove: (move: MoveId) => void;
  onLeave: () => void;
}) {
  const p = save.patrol!;
  const f = p.fight!;
  const hero = save.hero;
  const v = VILLAINS[f.villain];
  const stop = p.stops[p.index];
  const scenery = SCENERY[f.villain];
  const [hit, setHit] = useState<Hit | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  const views = f.result ? [] : moveViews(save, p, f);
  const intent = f.intents[0];
  const next = f.intents[1];
  const detail = intent ? intentDetail(intent, f) : null;
  const tip = intent && detail ? counterTip(save, intent, detail.damage) : null;

  function play(move: MoveId) {
    if (moveBlocked(save, move)) return;
    // The reducer is pure, so the turn can be previewed to show who took damage.
    const after = reduce(save, { type: "move", move });
    const ap = after.patrol;
    const af = ap?.fight;
    if (ap && af) {
      setHit({
        n: (hit?.n ?? 0) + 1,
        villain: f.hp - af.hp,
        hero: p.hp - ap.hp,
        // The log keeps its last 40 lines, so once it's full count at least the newest one.
        fresh: Math.max(1, af.log.length - f.log.length),
      });
    }
    onMove(move);
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1 || n > views.length) return;
    e.preventDefault();
    play(views[n - 1].id);
  });

  useEffect(() => {
    if (f.result) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [f.result]);

  // Keep the newest lines in view inside the log (the page itself doesn't scroll).
  const logLength = f.log.length;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLength, f.turn, f.result]);

  const villainHurt = !!hit && hit.villain > 0;
  const heroHurt = !!hit && hit.hero > 0;
  const heroHealed = !!hit && hit.hero < 0;
  const villainStatus = [
    f.webbed > 0 ? { icon: Link2, text: `Webbed, ${f.webbed} turn${f.webbed === 1 ? "" : "s"}` } : null,
    f.charged ? { icon: Zap, text: "Charged: next hit doubles" } : null,
    f.copies > 0 ? { icon: UsersRound, text: `${f.copies} Sybil cop${f.copies === 1 ? "y" : "ies"}` } : null,
    f.jammed > 0 ? { icon: Lock, text: `Chain jam, ${f.jammed} turn${f.jammed === 1 ? "" : "s"}` } : null,
  ].filter((s) => s !== null);
  const heroStatus = [
    f.block > 0 ? { icon: ShieldCheck, text: `Block ${f.block}` } : null,
    f.dodges > 0 ? { icon: Sparkles, text: f.dodges === 1 ? "Dodges the next hit" : `Dodges ${f.dodges} hits` } : null,
    f.forked ? { icon: Layers, text: "Fork: next power twice" } : null,
  ].filter((s) => s !== null);

  return (
    <div className="flex flex-col gap-4">
      {/* The scene. */}
      <section aria-labelledby="fight-title" className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
        <div className="relative isolate overflow-hidden rounded-card bg-surface-2">
          <SceneMedia>
            <ShaderCanvas scene={scenery.scene} palette={scenery.palette} seed={scenery.seed + p.night} fps={24} className="absolute inset-0" />
          </SceneMedia>
          <div className="relative flex flex-col gap-4 p-3 sm:p-5 lg:min-h-[400px] lg:p-6">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag icon={MapPin}>{DISTRICTS[stop.district].name}</Tag>
              {f.boss ? <Tag icon={Medal}>Boss</Tag> : null}
              {stop.kind === "fight" && stop.quest ? <Tag icon={Target}>Tonight’s quest</Tag> : null}
              <Tag>
                <span className="num">Turn {f.turn}</span>
              </Tag>
            </div>

            <div className="flex flex-1 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)_auto] lg:items-end lg:gap-6">
              {/* Villain. */}
              <div className="relative flex flex-col items-stretch gap-3 rounded-[20px] bg-canvas/95 p-3 shadow-[var(--shadow-float)] backdrop-blur-md min-[360px]:flex-row min-[360px]:items-center min-[360px]:gap-4 lg:order-3 lg:w-[256px] lg:flex-col lg:items-stretch lg:gap-3">
                <div
                  key={`v${villainHurt ? hit?.n : 0}`}
                  className={`relative shrink-0 self-center ${villainHurt ? "motion-safe:animate-[wgp-patrol-shake_420ms_var(--ease-out-quint)]" : ""}`}
                >
                  <Sticker id={f.villain} size="md" label={false} className="lg:hidden" />
                  <Sticker id={f.villain} size="lg" label={false} className="hidden lg:block" />
                  {villainHurt && hit ? <DamagePop value={hit.villain} /> : null}
                  {f.result === "won" ? (
                    <span className="animate-seal pointer-events-none absolute inset-x-0 top-1/2 mx-auto flex w-fit -translate-y-1/2 items-center gap-1.5 rounded-[10px] border-2 border-ink-strong bg-success-fill px-3 py-1 font-display text-[18px] font-semibold uppercase tracking-[0.04em] text-on-success shadow-[var(--shadow-float)]">
                      <Check aria-hidden className="size-4" strokeWidth={2.5} />
                      Caught
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 id="fight-title" className="truncate font-display text-[19px] font-medium leading-6 tracking-[-0.015em] text-ink-strong">
                      {v.name}
                    </h2>
                    <span className="num shrink-0 text-[12px] leading-4 text-ink-subtle">Lv {f.level}</span>
                  </div>
                  <Meter label="Health" value={f.hp} max={f.maxHp} tone="ink" />
                  {villainStatus.length ? (
                    <ul aria-label={`${v.name}’s status`} className="flex flex-wrap gap-1">
                      {villainStatus.map((s) => (
                        <li key={s.text}>
                          <Tag icon={s.icon} tone="quiet" size="sm">
                            {s.text}
                          </Tag>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              {/* What he's about to do. */}
              {intent && detail && !f.result ? (
                <SpeechBubble tail="top-then-right" className="mt-1 lg:order-2 lg:mt-0 lg:self-center">
                  <div className="flex flex-col gap-1.5 px-4 pb-3.5 pt-3">
                    <p className="text-[12px] font-medium leading-4 text-ink-subtle">{f.webbed > 0 ? "Stuck in your web" : "This turn"}</p>
                    <p className="flex items-baseline justify-between gap-3">
                      <span className={`font-display text-[20px] font-medium leading-6 tracking-[-0.02em] ${f.webbed > 0 ? "text-ink-subtle line-through" : "text-ink-strong"}`}>
                        {intent.label}
                      </span>
                      {detail.damage !== null && f.webbed === 0 ? (
                        <span className="num shrink-0 font-display text-[20px] font-semibold leading-6 text-accent">{detail.damage}</span>
                      ) : null}
                    </p>
                    <p className="text-[13px] leading-5 text-ink">
                      {f.webbed > 0 ? `He loses the turn, so this doesn’t happen.` : detail.text}
                    </p>
                    {tip ? (
                      <p className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-ink-strong">
                        <Sparkles aria-hidden className="size-3.5 text-accent" strokeWidth={2} />
                        {tip}
                      </p>
                    ) : null}
                    {next ? (
                      <p className="mt-1 border-t border-hairline pt-2 text-[12px] leading-4 text-ink-subtle">
                        Next: <span className="font-medium text-ink">{next.label}</span>
                        {STRIKES.includes(next.kind) ? (
                          <span className="num">
                            {" · "}
                            {next.kind === "swarm" ? `${next.value} per copy` : `${next.value} damage`}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </SpeechBubble>
              ) : (
                <div className="hidden lg:order-2 lg:block" />
              )}

              {/* You. */}
              <div
                key={`h${heroHurt || heroHealed ? hit?.n : 0}`}
                className={`relative flex items-center gap-3 rounded-[20px] bg-canvas/95 p-3 shadow-[var(--shadow-float)] backdrop-blur-md lg:order-1 lg:max-w-[360px] lg:gap-4 ${
                  heroHurt ? "motion-safe:animate-[wgp-patrol-shake_420ms_var(--ease-out-quint)]" : ""
                }`}
              >
                <div className="relative shrink-0">
                  <HeroSticker hero={hero} size="sm" className="lg:hidden" />
                  <HeroSticker hero={hero} size="md" className="hidden lg:block" />
                  {f.result === "lost" ? (
                    <span className="animate-seal pointer-events-none absolute inset-x-0 top-1/2 mx-auto flex w-fit -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-[8px] border-2 border-ink-strong bg-danger-fill px-2 py-0.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-on-danger shadow-[var(--shadow-float)]">
                      Knocked out
                    </span>
                  ) : null}
                </div>
                {(heroHurt || heroHealed) && hit ? <DamagePop value={Math.abs(hit.hero)} heal={heroHealed} /> : null}
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <p className="truncate text-[15px] font-medium leading-5 text-ink-strong">{hero.name}</p>
                  <div className="grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2 min-[360px]:gap-3 lg:grid-cols-1 lg:gap-2.5">
                    <Meter label="Health" value={p.hp} max={p.maxHp} tone="accent" size="sm" />
                    <Meter label="Web fluid" value={p.fluid} max={MAX_FLUID} tone="fluid" size="sm" />
                  </div>
                  {heroStatus.length ? (
                    <ul aria-label="Your status" className="flex flex-wrap gap-1">
                      {heroStatus.map((s) => (
                        <li key={s.text}>
                          <Tag icon={s.icon} tone="quiet" size="sm">
                            {s.text}
                          </Tag>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {f.result ? (
          <FightResult save={save} onLeave={onLeave} />
        ) : (
          <section aria-labelledby="moves-title" className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 pb-3 pt-3">
              <h2 id="moves-title" className="font-display text-[19px] font-medium leading-6 tracking-[-0.015em] text-ink-strong">
                Your move
              </h2>
              {intent && detail ? (
                <p className="text-[13px] leading-5 text-ink-subtle">
                  {f.webbed > 0 ? (
                    `${v.name} is webbed this turn`
                  ) : (
                    <>
                      {v.name}: <span className="font-medium text-ink-strong">{intent.label}</span>
                      {detail.damage !== null ? <span className="num">{` · ${detail.damage} damage`}</span> : null}
                    </>
                  )}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {views.map((view, i) => (
                <MoveCard key={view.id} view={view} index={i} onPick={play} />
              ))}
            </div>
            <p className="hidden px-3 pb-1.5 pt-3 text-[12px] leading-4 text-ink-subtle pointer-fine:block">
              Keys <span className="num">1</span>–<span className="num">{views.length}</span> play a move.
            </p>
          </section>
        )}

        <section aria-labelledby="log-title" className="flex flex-col rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
          <div className="flex items-baseline justify-between gap-3 px-3 pb-3 pt-3">
            <h2 id="log-title" className="font-display text-[19px] font-medium leading-6 tracking-[-0.015em] text-ink-strong">
              Battle log
            </h2>
            <span className="num text-[12px] leading-4 text-ink-subtle">Turn {f.turn}</span>
          </div>
          <ol
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-labelledby="log-title"
            tabIndex={0}
            className="relative flex max-h-[300px] min-h-[160px] flex-1 flex-col gap-1 overflow-y-auto rounded-card bg-surface p-1.5 lg:max-h-[340px]"
          >
            {f.log.map((line, i) => (
              <LogLine key={i} line={line} hero={hero} villain={f.villain} fresh={!!hit && i >= f.log.length - hit.fresh} />
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
