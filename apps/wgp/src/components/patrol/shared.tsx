"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import {
  Award,
  Building,
  EyeOff,
  Heart,
  Landmark,
  Layers,
  Link2,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Stamp,
  Swords,
  Target,
  Timer,
  Undo2,
  Zap,
  type Icon,
} from "@/components/icons";
import { castById, type CastId } from "@wgp/game-core/cast";
import { ALLY_CAST, DISTRICTS, ERRANDS, ITEMS, RARITY_LABEL, VILLAINS } from "@wgp/game-core/data";
import type { ItemId, MoveId, Rarity, Stop } from "@wgp/game-core/types";

/* ------------------------------------------------------------------ stops */

/** Who is at a stop: the villain, or the ally the errand is for. */
export function stopWho(stop: Stop): CastId {
  return stop.kind === "fight" ? stop.villain : ALLY_CAST[stop.ally];
}

export function stopName(stop: Stop): string {
  return castById(stopWho(stop)).name;
}

export function districtName(stop: Stop): string {
  return DISTRICTS[stop.district].name;
}

/** "Boss fight", "Fight" or the errand's title. */
export function stopWhat(stop: Stop): string {
  if (stop.kind === "fight") return stop.boss ? "Boss fight" : "Fight";
  return ERRANDS.find((e) => e.id === stop.errand)?.title ?? "Errand";
}

export const villainName = (id: keyof typeof VILLAINS) => VILLAINS[id].name;

/* ------------------------------------------------------------------ motion */

function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * True when the player hasn't asked for reduced motion. Read synchronously on the
 * client, so the animated swing never flashes in for someone who turned motion off.
 */
export function useMotionOk(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Keyframes for hit feedback. They only exist when motion is allowed, so an
 * `animate-[…]` that names them does nothing for reduced motion.
 */
const MOTION_CSS = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes wgp-patrol-shake {
    0% { translate: 0 0; rotate: 0deg; }
    18% { translate: -9px 0; rotate: -3deg; }
    36% { translate: 7px 0; rotate: 2deg; }
    54% { translate: -4px 0; rotate: -1deg; }
    72% { translate: 2px 0; rotate: 0.5deg; }
    100% { translate: 0 0; rotate: 0deg; }
  }
  @keyframes wgp-patrol-pop {
    0% { opacity: 0; translate: 0 10px; scale: 0.6; }
    18% { opacity: 1; translate: 0 0; scale: 1.15; }
    32% { scale: 1; }
    75% { opacity: 1; }
    100% { opacity: 0; translate: 0 -26px; }
  }
  @keyframes wgp-patrol-flash {
    0% { opacity: 0; }
    20% { opacity: 1; }
    100% { opacity: 0; }
  }
}
`;

export function PatrolMotion() {
  return (
    <style href="wgp-patrol-motion" precedence="default">
      {MOTION_CSS}
    </style>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * A speech bubble like the cast sheet's: 2px ink border, 20px corners, and a tail made
 * from a rotated square carrying the border on two sides.
 */
export function SpeechBubble({
  children,
  tail = "bottom",
  className = "",
}: {
  children: ReactNode;
  /** Which side the tail points out of; it always points at the speaker. */
  tail?: "bottom" | "left" | "right" | "top" | "top-then-right" | "top-then-left";
  className?: string;
}) {
  const tails = {
    bottom: "-bottom-[9px] left-10 border-b-2 border-r-2",
    top: "-top-[9px] left-10 border-l-2 border-t-2",
    left: "-left-[9px] top-8 border-b-2 border-l-2",
    right: "-right-[9px] top-8 border-r-2 border-t-2",
    /* Points up at a speaker above on phones, right at a speaker beside it from 1024px. */
    "top-then-right":
      "-top-[9px] left-10 border-l-2 border-t-2 lg:-right-[9px] lg:left-auto lg:top-10 lg:border-l-0 lg:border-r-2",
    /* Points up on phones, left at a speaker beside it from 1024px. */
    "top-then-left": "-top-[9px] left-10 border-l-2 border-t-2 lg:-left-[9px] lg:top-10 lg:border-b-2 lg:border-t-0",
  } as const;
  return (
    <div className={`relative rounded-[20px] border-2 border-ink-strong bg-canvas shadow-[var(--shadow-chip)] ${className}`}>
      {children}
      <span aria-hidden className={`absolute size-4 rotate-45 border-ink-strong bg-canvas ${tails[tail]}`} />
    </div>
  );
}

/** Small white chip used on scenes and in rows: an optional icon and a label. */
export function Tag({
  icon: IconCmp,
  children,
  tone = "plain",
  size = "md",
  className = "",
}: {
  icon?: Icon;
  children: ReactNode;
  tone?: "plain" | "accent" | "quiet" | "success" | "danger";
  /** "sm" is the compact status chip; its text may wrap on narrow cards. */
  size?: "sm" | "md";
  className?: string;
}) {
  const tones = {
    plain: "bg-canvas text-ink-strong shadow-[var(--shadow-chip)]",
    accent: "bg-accent-subtle text-accent",
    quiet: "bg-surface-2 text-ink",
    success: "bg-success-fill text-on-success",
    danger: "bg-danger-fill text-on-danger",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-chip font-medium ${
        size === "sm" ? "min-h-6 px-2 py-1 text-[11px] leading-[14px]" : "h-7 shrink-0 whitespace-nowrap px-2.5 text-[12px] leading-4"
      } ${tones[tone]} ${className}`}
    >
      {IconCmp ? <IconCmp aria-hidden className="size-3.5 shrink-0" strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

const rarityTone: Record<Rarity, string> = {
  common: "text-ink-subtle",
  uncommon: "text-on-success",
  rare: "text-accent",
};

/** Loot as chips: item name and rarity in words (never color alone). */
export function LootChips({ loot, className = "" }: { loot: Partial<Record<ItemId, number>>; className?: string }) {
  const entries = (Object.entries(loot) as [ItemId, number][]).filter(([, n]) => n > 0);
  if (!entries.length) return null;
  return (
    <ul aria-label="Loot" className={`flex flex-wrap gap-1.5 ${className}`}>
      {entries.map(([id, n]) => {
        const item = ITEMS[id];
        return (
          <li
            key={id}
            className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-[9px] bg-canvas pl-2.5 pr-2 text-[13px] font-medium leading-4 text-ink-strong shadow-[var(--shadow-chip)]"
          >
            {n > 1 ? <span className="num text-ink-subtle">{n}×</span> : null}
            {item.name}
            <span className={`rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 ${rarityTone[item.rarity]}`}>
              {RARITY_LABEL[item.rarity]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One change from a stop, e.g. "+12 XP" or "−2 reputation", with an icon and a sign. */
export function Effect({ icon: IconCmp, value, label }: { icon: Icon; value: number; label: string }) {
  if (!value) return null;
  const sign = value > 0 ? "+" : "−";
  return (
    <li className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[9px] bg-canvas px-2.5 text-[13px] leading-4 text-ink shadow-[var(--shadow-chip)]">
      <IconCmp aria-hidden className="size-3.5 text-ink-subtle" strokeWidth={2} />
      <span className="num font-medium text-ink-strong">
        {sign}
        {Math.abs(value)}
      </span>
      {label}
    </li>
  );
}

/** One icon per kind of change, used for stop results and the night's haul. */
export const EFFECT_ICONS = {
  xp: Award,
  health: Heart,
  fluid: Link2,
  responsibility: ShieldCheck,
  reputation: Megaphone,
} as const;

/** The icon for each move, from the shared Hugeicons set. */
export const MOVE_ICONS: Record<Exclude<MoveId, "gwei">, Icon> = {
  "web-sling": Target,
  "web-shield": ShieldCheck,
  "node-sense": Sparkles,
  "wall-crawl": Building,
  yank: Link2,
  finality: Stamp,
  "web-bomb": Zap,
  "gas-refund": Undo2,
  fork: Layers,
  "zk-cloak": EyeOff,
  "front-run": Timer,
  "validator-slam": Landmark,
  punch: Swords,
};

