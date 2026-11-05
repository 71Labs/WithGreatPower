"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { MusicId } from "@/audio/manifest";
import { playMusic, setSoundEnabled, soundEnabled, subscribeSound } from "@/audio/player";
import { SoundSliders } from "@/components/game/sound-sliders";
import { AccountCenter, AccountChip } from "@/components/account/account-center";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { ArrowUpRight, City, FolderSearch, HelpCircle, Medal, Newspaper, Settings, Shirt, Store, TriangleAlert, Vote, Zap, Award } from "@/components/icons";
import type { CastId } from "@wgp/game-core/cast";
import { XP_TO_NEXT } from "@wgp/game-core/data";
import { useAccount, useGame } from "@/game/store";
import { CASE_PATHS } from "@/lib/cases/content";
import { useNewCase } from "@/lib/cases/local";
import type { Hero, Save } from "@wgp/game-core/types";

import { GameBackdrop, type BackdropVariant } from "./backdrop";
import { KitStyles, ON_PAPER, StickerBadge, StickerButton, StickerIconButton, StickerLink } from "./kit";
import { GameSheet, HeroTile } from "./ui";

export const GAME_NAV = [
  { href: "/play", label: "Tonight", icon: City },
  { href: "/play/hero", label: "Hero", icon: Zap },
  { href: "/play/suits", label: "Suits", icon: Shirt },
  { href: "/play/market", label: "Market", icon: Store },
  { href: "/play/album", label: "Album", icon: Medal },
  { href: "/play/rug", label: "Daily Rug", icon: Newspaper },
  { href: CASE_PATHS.list, label: "Cases", icon: FolderSearch },
  // Compete: the Daily Run, time trials, rivals, and the way to the Season boards (it stays lit on them).
  { href: "/play/compete", label: "Compete", icon: Award },
] as const;

const isActive = (pathname: string | null, href: string) =>
  !!pathname && (href === "/play" ? pathname === "/play" : pathname.startsWith(href) || (href === "/play/compete" && pathname.startsWith("/play/leaderboard")));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/* ------------------------------------------------------------------ the Rug's read marker */

/*
 * Which edition of The Daily Rug you've seen, for the dock's "new" badge. A per-browser
 * convenience, so it lives in localStorage next to the save; it never affects the game.
 */
const READ_KEY = "wgp:rug-read:v1";
const readListeners = new Set<() => void>();

function readNight(): number {
  try {
    return Number(window.localStorage.getItem(READ_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function subscribeRead(listener: () => void) {
  readListeners.add(listener);
  return () => readListeners.delete(listener);
}

/** Mark the edition for `night` as read. The Daily Rug calls this while it's on screen. */
export function markEditionRead(night: number) {
  if (readNight() >= night) return;
  try {
    window.localStorage.setItem(READ_KEY, String(night));
  } catch {
    // Blocked storage: the badge just stays until the next edition.
  }
  readListeners.forEach((l) => l());
}

/** Forget what was read, for a fresh hero whose nights start again at 1. */
export function forgetEditionsRead() {
  try {
    window.localStorage.removeItem(READ_KEY);
  } catch {}
  readListeners.forEach((l) => l());
}

/** True when the newest edition hasn't been opened yet. False until the save loads. */
export function useUnreadEdition(save: Save | null): boolean {
  const read = useSyncExternalStore(subscribeRead, readNight, () => Number.POSITIVE_INFINITY);
  const latest = save?.editions[0]?.night ?? 0;
  return latest > 0 && latest > read;
}

/* ------------------------------------------------------------------ top chips */

/** The XP ring round the hero's tile: ink track, gold progress. Decorative. */
function XpRing({ value, children }: { value: number; children: ReactNode }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <span className="relative grid size-11 shrink-0 place-items-center">
      <svg aria-hidden viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--game-ink)" strokeWidth="5" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="var(--game-gold)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${pct * c} ${c}`}
          className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-500 motion-safe:ease-out"
        />
      </svg>
      {children}
    </span>
  );
}

const chip =
  "pointer-events-auto flex h-12 items-center rounded-full border-2 border-game-ink bg-game-paper text-game-ink shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2";

function HeroChip({ hero }: { hero: Hero }) {
  const need = XP_TO_NEXT(hero.level);
  return (
    <Link href="/play/hero" className={`${chip} min-w-0 gap-2 pl-0.5 pr-4`}>
      <XpRing value={hero.xp / need}>
        <HeroTile suit={hero.suit} className="size-[30px] rounded-full ring-0" />
      </XpRing>
      <span className="flex min-w-0 flex-col">
        <span className="max-w-[9.5rem] truncate text-[14px] font-semibold leading-4 sm:max-w-[14rem]">{hero.name}</span>
        <span className="num whitespace-nowrap text-[12px] font-medium leading-4 text-game-muted">
          Lv {hero.level}
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          {hero.xp}/{need} XP
        </span>
      </span>
      {hero.pendingPicks > 0 ? (
        <>
          <StickerBadge className="-mr-1 ml-0.5">+{hero.pendingPicks}</StickerBadge>
          <span className="sr-only">, {plural(hero.pendingPicks, "new power")} to pick</span>
        </>
      ) : null}
    </Link>
  );
}

function reputationWord(rep: number) {
  if (rep <= -20) return "Menace";
  if (rep < 20) return "On the fence";
  return "Hero";
}

/** What the city thinks, as a signed number. Opens the Rug, where the poll moves it. */
function ReputationChip({ rep }: { rep: number }) {
  return (
    <Link href="/play/rug" className={`${chip} gap-1.5 px-3.5 max-sm:hidden`}>
      <Vote aria-hidden className="size-[18px]" strokeWidth={2} />
      <span className="num text-[14px] font-semibold">{signed(rep)}</span>
      <span className="text-[12px] font-medium text-game-muted">{reputationWord(rep)}</span>
      <span className="sr-only">reputation. Open The Daily Rug</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ help */

const HOW_TO: { who: CastId; title: string; text: string }[] = [
  { who: "node", title: "Swing out every night", text: "Four stops across the city: a fight, two errands and a boss at the end." },
  { who: "gas-goblin", title: "Catch villains, keep the loot", text: "Stitch what they drop into new suits in the Suit lab." },
  { who: "aunt-mainnet", title: "Help the neighbors", text: "Errands raise your responsibility and fill your sticker album." },
  { who: "uncle-gen", title: "Level up, learn powers", text: "Each level brings a new power. Up to four ride along on patrol." },
  { who: "bearson", title: "Read The Daily Rug", text: "Bearson writes up every night. Vote in his poll and take his quest for bonus XP." },
  { who: "mary-jpeg", title: "Open a case file", text: "Special nights from Bearson’s desk: one mystery and one new villain, played off the boards." },
];

function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const signedIn = useAccount().status === "signed-in";
  return (
    <GameSheet open={open} onClose={onClose} eyebrow="With Great Power" title="How to play">
      <ol className="flex flex-col gap-3">
        {HOW_TO.map((s, i) => (
          <li key={s.title} className="flex items-center gap-3.5 rounded-[20px] border-2 border-game-ink bg-game-paper-2 p-2.5 pr-4">
            <span className="relative shrink-0">
              <MiniAvatar id={s.who} className="size-12 rounded-[10px]" />
              <span
                aria-hidden
                className="num absolute -left-1.5 -top-1.5 grid size-6 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-[12px] font-bold text-game-ink"
              >
                {i + 1}
              </span>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold leading-5">{s.title}</span>
              <span className="text-[13px] leading-[18px] text-game-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[13px] leading-5 text-game-muted">
        {signedIn ? "Your hero is saved to your account." : "Your hero is saved in this browser."} Swing out from Tonight; everything else is one tap away in the
        dock.
      </p>
    </GameSheet>
  );
}

/* ------------------------------------------------------------------ settings */

/** Sound on or off and the two volumes, remembered in this browser. A real switch, labelled by the state it turns on. */
function SoundSwitch() {
  const on = useSyncExternalStore(subscribeSound, soundEnabled, () => true);
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border-2 border-game-ink bg-game-paper-2 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span id="sound-switch-label" className="text-[15px] font-semibold leading-5">
            Play sound
          </span>
          <span className="text-[13px] leading-5 text-game-muted">Effects, voices and music</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="sound-switch-label"
          onClick={() => setSoundEnabled(!on)}
          className={`relative h-8 w-14 shrink-0 rounded-full border-2 border-game-ink shadow-[var(--game-shadow-sm)] ${on ? "bg-game-mint" : "bg-game-paper"}`}
        >
          <span
            aria-hidden
            className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-full border-2 border-game-ink bg-game-paper motion-safe:transition-[left] motion-safe:duration-150 ${on ? "left-[26px]" : "left-[3px]"}`}
          />
        </button>
      </div>
      <SoundSliders />
    </div>
  );
}

function SettingsSheet({ save, open, onClose }: { save: Save; open: boolean; onClose: () => void }) {
  const { dispatch } = useGame();
  const where = useAccount().status === "signed-in" ? "your account" : "this browser";
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const dangerRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const hero = save.hero;

  // The confirm step is the visible state only while the sheet is open.
  function close() {
    setConfirming(false);
    onClose();
  }

  if (!hero) return null;
  const powers = Object.keys(hero.powers).length;
  const items = Object.values(save.inventory).reduce((sum, n) => sum + (n ?? 0), 0);
  const what = `level ${hero.level}, ${plural(powers, "power")}, ${plural(save.suits.length, "suit")} and ${plural(items, "item")}`;

  function remove() {
    dispatch({ type: "reset" });
    forgetEditionsRead();
    close();
    router.replace("/play/bitten");
  }

  return (
    <GameSheet
      open={open}
      onClose={close}
      eyebrow="Settings"
      title={confirming ? `Delete ${hero.name}?` : "Your hero"}
      footer={
        confirming ? (
          <>
            <StickerButton
              onClick={() => {
                setConfirming(false);
                requestAnimationFrame(() => dangerRef.current?.focus());
              }}
              className="sm:order-first"
            >
              Keep my hero
            </StickerButton>
            <StickerButton variant="hero" onClick={remove}>
              <TriangleAlert aria-hidden className="size-5" strokeWidth={2} />
              Delete my hero
            </StickerButton>
          </>
        ) : undefined
      }
    >
      {confirming ? (
        <div className="flex flex-col gap-3">
          {/* Focus lands here, so the consequence is the first thing read. */}
          <p ref={confirmRef} tabIndex={-1} className="rounded-[10px] text-[15px] leading-6 text-game-ink focus-visible:outline-offset-4">
            This wipes {hero.name} from {where}: {what}. There’s no undo, and Bearson will print that you quit.
          </p>
          <p className="text-[13px] leading-5 text-game-muted">You can get bitten again, but you start from level 1.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-[20px] border-2 border-game-ink bg-game-paper-2 p-2.5 pr-4">
            <HeroTile suit={hero.suit} className="size-12 rounded-[10px]" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[16px] font-semibold leading-5">{hero.name}</span>
              <span className="num text-[13px] leading-5 text-game-muted">
                Level {hero.level} · bitten on night {hero.createdNight} · saved {where === "this browser" ? "in this browser" : "to your account"}
              </span>
            </span>
          </div>

          <SoundSwitch />

          <StickerLink href="/" size="sm" className="self-start">
            Visit the website
            <ArrowUpRight aria-hidden className="size-4" strokeWidth={2} />
          </StickerLink>

          <section aria-labelledby={`${ids}-danger`} className="flex flex-col gap-3 border-t-2 border-dashed border-game-ink/30 pt-5">
            <h3 id={`${ids}-danger`} className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink">
              Danger zone
            </h3>
            <p className="text-[14px] leading-5 text-game-muted">
              Deleting {hero.name} wipes {what} from {where}.
            </p>
            <StickerButton
              ref={dangerRef}
              size="sm"
              className="self-start text-game-hero"
              onClick={() => {
                setConfirming(true);
                requestAnimationFrame(() => confirmRef.current?.focus());
              }}
            >
              <TriangleAlert aria-hidden className="size-4" strokeWidth={2} />
              Delete my hero
            </StickerButton>
          </section>
        </div>
      )}
    </GameSheet>
  );
}

function TopChips({ save }: { save: Save | null }) {
  const [sheet, setSheet] = useState<"help" | "settings" | null>(null);
  const hero = save?.hero ?? null;
  const close = () => setSheet(null);

  return (
    <>
      {/* A soft night scrim so content scrolling under the chips stays out of their way. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-20 h-24 bg-[linear-gradient(to_bottom,var(--game-night)_35%,transparent)]"
      />
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 px-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
        <div className="mx-auto flex max-w-[1180px] items-start justify-between gap-2">
          <div className="flex min-w-0 gap-2">
            {hero ? (
              <>
                <HeroChip hero={hero} />
                <ReputationChip rep={save!.reputation} />
              </>
            ) : null}
          </div>
          <div className="pointer-events-auto flex shrink-0 gap-2">
            <AccountChip className={chip} phoneIcon="signed-in" />
            <StickerIconButton label="How to play" size="lg" onClick={() => setSheet("help")} className="text-[20px] font-bold">
              <HelpCircle aria-hidden strokeWidth={2} />
            </StickerIconButton>
            <StickerIconButton label="Settings" size="lg" onClick={() => setSheet("settings")} disabled={!hero}>
              <Settings aria-hidden strokeWidth={2} />
            </StickerIconButton>
          </div>
        </div>
      </header>
      <HelpSheet open={sheet === "help"} onClose={close} />
      {save ? <SettingsSheet save={save} open={sheet === "settings"} onClose={close} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ dock */

/** Short-landscape and wide screens lay each tab out in a row; upright phones stack it. */
const ROW = "sm:flex-row sm:gap-2 [@media(max-height:520px)]:flex-row [@media(max-height:520px)]:gap-2";

function Dock({ pathname, save }: { pathname: string | null; save: Save | null }) {
  const picks = save?.hero?.pendingPicks ?? 0;
  const unread = useUnreadEdition(save);
  const newCase = useNewCase(save);
  return (
    <nav
      aria-label="Game"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-2 sm:px-6"
    >
      {/* Eight tabs: on a 360px phone the labels go a hair smaller and tighter so each fits its column. */}
      <ul
        className={`pointer-events-auto grid w-full max-w-[720px] grid-cols-8 gap-0.5 rounded-t-[26px] border-[2.5px] border-b-0 border-game-ink bg-game-paper px-1.5 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 min-[400px]:gap-1 min-[400px]:px-2 sm:max-w-[900px] ${ON_PAPER}`}
      >
        {GAME_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const badge =
            item.href === "/play/hero" && picks > 0
              ? { value: `+${picks}`, label: `${plural(picks, "new power")} to pick` }
              : item.href === "/play/rug" && unread
                ? { value: "New", label: "new edition" }
                : item.href === CASE_PATHS.list && newCase
                  ? { value: "New", label: "new case file" }
                  : null;
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] px-0.5 text-[10.5px] font-semibold leading-3 tracking-[-0.01em] focus-visible:outline-offset-1 min-[400px]:px-1 min-[400px]:text-[11px] min-[400px]:tracking-normal sm:h-12 sm:text-[13px] [@media(max-height:520px)]:h-11 [@media(max-height:520px)]:text-[13px] ${ROW} ${
                  active ? "bg-game-ink text-game-paper" : "text-game-ink pointer-fine:hover:bg-game-paper-2"
                }`}
              >
                <Icon aria-hidden className="size-[22px] shrink-0 sm:size-5" strokeWidth={active ? 2.25 : 1.9} />
                {/* A line tall enough for descenders, which `truncate` would otherwise clip ("Daily Rug"). */}
                <span className="truncate leading-[14px] sm:leading-4">{item.label}</span>
                {badge ? (
                  <>
                    <StickerBadge className="absolute right-[calc(50%-26px)] top-0.5 sm:-top-1.5 sm:right-1 [@media(max-height:520px)]:-top-1.5 [@media(max-height:520px)]:right-1">
                      {badge.value}
                    </StickerBadge>
                    <span className="sr-only">, {badge.label}</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ music */

/**
 * The bed each screen plays: the hub theme across the tabs, the market's own, and nothing
 * on the patrol, whose night runs its own score. The same bed carries on between tabs;
 * the Rug plays its jingle over it.
 */
export function routeMusic(pathname: string): MusicId | null {
  if (pathname.startsWith("/play/patrol")) return null;
  // A race (the Daily, a trial, a duel) is a night: it runs its own score.
  if (/^\/play\/compete\/(daily|trial|duel)/.test(pathname)) return null;
  if (pathname.startsWith("/play/market")) return "market";
  return "lobby";
}

function useRouteMusic(pathname: string | null) {
  const on = useSyncExternalStore(subscribeSound, soundEnabled, () => false);
  useEffect(() => {
    const cue = on && pathname ? routeMusic(pathname) : null;
    if (cue) playMusic(cue, { fade: 1 });
  }, [pathname, on]);
}

/* ------------------------------------------------------------------ the shell */

/**
 * The frame round every game screen: the living city behind, the hero, account, help
 * and settings chips floating along the top, and the tab dock seated on the bottom edge.
 * The game itself (/play/patrol) gets the whole screen; onboarding (/play/bitten) keeps
 * the city and the account chip but brings its own back control, and a case's intro comic
 * (/play/cases/001) keeps the city and brings its own way back. The account sheet,
 * the import offer and toasts float over all of them.
 */
export function GameShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { save } = useGame();
  const game = !!pathname?.startsWith("/play/patrol");
  const onboarding = !!pathname?.startsWith("/play/bitten");
  /** A case's intro comic: the whole screen, with its own way back. */
  const comic = pathname === CASE_PATHS.intro;
  const chrome = !game && !onboarding && !comic;
  const variant: BackdropVariant = pathname === "/play" ? "home" : onboarding || comic ? "flow" : "tab";
  useRouteMusic(pathname);

  return (
    <div
      data-wgp-night={game ? undefined : ""}
      className={`relative isolate min-h-dvh ${game ? "" : "bg-game-night text-game-paper [--vs-focus:var(--game-gold)]"}`}
    >
      <KitStyles />
      {game ? null : <GameBackdrop variant={variant} suit={save?.hero?.suit} />}
      {chrome ? <TopChips save={save} /> : null}
      <main
        id="main"
        className={chrome ? "pb-[calc(104px+env(safe-area-inset-bottom))] pt-[calc(76px+env(safe-area-inset-top))] sm:pb-[calc(96px+env(safe-area-inset-bottom))]" : ""}
      >
        {children}
      </main>
      {chrome ? <Dock pathname={pathname} save={save} /> : null}
      {onboarding ? (
        // Onboarding hides the chips, but a returning player on a new device lands here first: let them sign in.
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 px-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
          <div className="mx-auto flex max-w-[1040px] justify-end">
            <AccountChip className={chip} phoneIcon="always" />
          </div>
        </div>
      ) : null}
      <AccountCenter chrome={chrome} />
    </div>
  );
}
