/**
 * Small pieces shared by the game's HUD, sheets and results: character faces in the
 * sticker style, power icons and keyboard hints.
 */
import type { ReactNode } from "react";

import { AVATARS, HeroArt, type SuitColors } from "@/components/cast";
import {
  Building,
  EyeOff,
  Landmark,
  Layers,
  Link2,
  ShieldCheck,
  Sparkles,
  Stamp,
  Target,
  Timer,
  Undo2,
  Zap,
  type Icon,
} from "@/components/icons";
import type { CastId } from "@wgp/game-core/cast";
import type { PowerId } from "@wgp/game-core/types";

export const POWER_ICONS: Record<PowerId, Icon> = {
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
};

/** What each power does in real time, for How to play and button labels. */
export const POWER_HELP: Record<PowerId, string> = {
  "web-sling": "Web the nearest villain. One hit if it lands.",
  "web-shield": "A bubble that eats the next hit.",
  "node-sense": "Three seconds of slow motion.",
  "wall-crawl": "Catch your breath: heal.",
  yank: "Pull the nearest villain in and stun him for a second.",
  finality: "Your next hit counts double.",
  "web-bomb": "Area hit, and everyone in it is stunned for two seconds.",
  "gas-refund": "Refill your web fluid, and a little health.",
  fork: "Your next power fires twice.",
  "zk-cloak": "Three seconds nobody can touch you.",
  "front-run": "Dash forward, untouchable for a moment.",
  "validator-slam": "Dive and slam: two hits to everyone nearby.",
};

/** A character face as a little sticker: white rim, light paper, ink drop. Decorative. */
export function Face({ id, className = "size-9" }: { id: CastId; className?: string }) {
  const Art = AVATARS[id];
  return (
    <span
      aria-hidden
      className={`grid shrink-0 overflow-hidden rounded-[28%] border-2 border-white bg-sticker shadow-[0_2px_0_var(--game-ink)] [&>svg]:size-full ${className}`}
    >
      <Art />
    </span>
  );
}

export function HeroFace({ colors, className = "size-9" }: { colors: SuitColors; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 overflow-hidden rounded-[28%] border-2 border-white bg-sticker shadow-[0_2px_0_var(--game-ink)] [&>svg]:size-full ${className}`}
    >
      <HeroArt {...colors} />
    </span>
  );
}

const CHIP_TONES = {
  paper: "bg-game-paper text-game-ink",
  muted: "bg-game-paper-2 text-game-ink",
  hero: "bg-game-hero text-white",
  gold: "bg-game-gold text-game-ink",
  mint: "bg-game-mint text-game-ink",
  fluid: "bg-fluid text-white",
} as const;

const CHIP_SIZES = {
  md: "h-8 px-3 text-[13px]",
  sm: "h-7 px-2.5 text-[12px]",
  xs: "h-6 px-2 text-[11px]",
} as const;

/**
 * A sticker chip with a tone. (The kit's StickerChip bakes in a paper background, so a
 * colored chip needs its own classes rather than an override that may lose the cascade.)
 */
export function Chip({
  tone = "paper",
  size = "md",
  flat = false,
  className = "",
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  size?: keyof typeof CHIP_SIZES;
  flat?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink font-semibold leading-none ${flat ? "" : "shadow-[var(--game-shadow-sm)]"} ${CHIP_TONES[tone]} ${CHIP_SIZES[size]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A key hint, shown only to fine pointers (keyboards are rare on touch screens). */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={`hidden h-5 min-w-5 items-center justify-center rounded-[6px] border-2 border-game-ink bg-game-paper px-1 font-sans text-[11px] font-bold leading-none text-game-ink pointer-fine:inline-flex ${className}`}
    >
      {children}
    </kbd>
  );
}
