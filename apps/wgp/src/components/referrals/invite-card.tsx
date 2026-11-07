/**
 * The invite link's Open Graph and X card (src/app/invite/[code]/opengraph-image.tsx),
 * drawn with `next/og` in the run cards' comic style (src/server/social/cards.tsx):
 * indigo night with gold stars, a cream paper card with a heavy ink outline and a hard
 * drop, the inviter's hero as a sticker and their handle big. An invite that can't be
 * looked up gets the same card without a name.
 *
 * Satori lays out flexbox only, so every element with more than one child is a flex box.
 * Colours are the game kit's (globals.css `--game-*`) as hex: a PNG can't read CSS variables.
 */
import { Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { HeroArt } from "@/components/cast";
import { SITE_HOST } from "@/lib/site";
import { SUITS } from "@wgp/game-core/data";
import type { SuitId } from "@wgp/game-core/types";

export const INVITE_CARD_SIZE = { width: 1200, height: 630 } as const;

const C = {
  night: "#22264f",
  paper: "#fffdf8",
  paper2: "#f3efe6",
  ink: "#141414",
  muted: "#5e5a54",
  gold: "#ffd95a",
  hero: "#d62e21",
  white: "#ffffff",
} as const;

/** Stars in the night margin round the card. Decorative. */
const STARS: [number, number, number][] = [
  [70, 14, 6], [210, 22, 4], [430, 10, 5], [640, 24, 4], [905, 12, 6], [1090, 20, 4], [1170, 120, 5], [1176, 420, 4], [14, 300, 5], [20, 520, 4], [330, 600, 5], [780, 606, 4], [1050, 598, 6],
];

function Chip({ children, tone }: { children: ReactNode; tone: "ink" | "gold" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 46,
        padding: "0 20px",
        borderRadius: 999,
        border: `4px solid ${C.ink}`,
        backgroundColor: tone === "ink" ? C.ink : C.gold,
        color: tone === "ink" ? C.white : C.ink,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Satori draws only plain SVG elements inside an <svg>: expand the art's own little
 * components (HeroArt's Neck) and fragments into them. They're pure drawings, no hooks.
 */
export function intrinsic(node: ReactNode): ReactNode[] {
  if (Array.isArray(node)) return node.flatMap(intrinsic);
  if (!isValidElement(node)) return node === null || node === undefined || typeof node === "boolean" ? [] : [node];
  const { type, props } = node as ReactElement<{ children?: ReactNode }>;
  if (type === Fragment) return intrinsic(props.children);
  if (typeof type === "function") return intrinsic((type as (p: unknown) => ReactNode)(props));
  return [props.children === undefined ? node : cloneElement(node, {}, ...intrinsic(props.children))];
}

/** The hero's art at a set size: HeroArt's shapes in an <svg> Satori can size (it ignores class names). */
function HeroSticker({ suit, size }: { suit: SuitId; size: number }) {
  const art = HeroArt(SUITS[suit].colors) as ReactElement<{ children: ReactNode }>;
  const inner = Math.round(size * 0.86);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: C.white,
        border: `5px solid ${C.ink}`,
        boxShadow: `0 10px 0 ${C.ink}`,
        transform: "rotate(-4deg)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", width: inner, height: inner, borderRadius: size * 0.21, backgroundColor: "#ececea", overflow: "hidden" }}>
        <svg viewBox="0 0 120 120" width={inner} height={inner} fill="none" stroke={C.ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          {intrinsic(art.props.children)}
        </svg>
      </div>
    </div>
  );
}

/** `fontFamily`: the card font when it loaded (src/server/social/fonts.ts), else next/og's own. */
export function InviteCard({ handle, heroName, suit, code, fontFamily }: { handle: string | null; heroName: string | null; suit: SuitId; code: string | null; fontFamily?: string }) {
  const name = handle ?? "A friend";
  const big = name.length > 18 ? 64 : name.length > 12 ? 84 : name.length > 8 ? 104 : 124;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", backgroundColor: C.night, padding: "38px 46px 56px", color: C.ink, ...(fontFamily ? { fontFamily } : {}) }}>
      {STARS.map(([x, y, s], i) => (
        <div key={i} style={{ position: "absolute", left: x, top: y, width: s, height: s, borderRadius: 999, backgroundColor: C.gold }} />
      ))}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, backgroundColor: C.paper, border: `6px solid ${C.ink}`, borderRadius: 40, boxShadow: `0 14px 0 ${C.ink}`, padding: "30px 46px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Chip tone="ink">With Great Power</Chip>
          <Chip tone="gold">You’re invited</Chip>
        </div>
        <div style={{ display: "flex", alignItems: "center", flexGrow: 1, gap: 52 }}>
          <HeroSticker suit={suit} size={250} />
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, minWidth: 0 }}>
            <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, color: C.muted }}>JOIN THE CREW</span>
            <span style={{ fontSize: big, fontWeight: 700, lineHeight: 1, letterSpacing: -4, marginTop: 8, color: handle ? C.hero : C.ink }}>{name}</span>
            <span style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1, marginTop: 14 }}>invited you to swing the city</span>
            {heroName ? <span style={{ fontSize: 28, color: C.muted, marginTop: 12 }}>{`Their hero: ${heroName}`}</span> : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `3px solid ${C.paper2}`, paddingTop: 14, fontSize: 24, color: C.muted }}>
          <span>{code ? `${SITE_HOST}/invite/${code}` : SITE_HOST}</span>
          <span>On NEAR · play in your browser</span>
        </div>
      </div>
    </div>
  );
}
