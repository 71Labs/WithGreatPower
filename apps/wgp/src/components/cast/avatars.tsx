/**
 * The cast, drawn as sticker busts: flat fills, bold #141414 outlines, a couple of white
 * highlights and pink blush. Every avatar is a 120×120 SVG with a transparent
 * background; the head sits in the upper part and the shoulders run off the bottom edge
 * so the sticker frame clips them. Colors are fixed: this is illustration, not UI.
 *
 * All characters are original parody designs. No studio artwork, logos or emblems.
 */
import type { JSX, ReactNode } from "react";

import type { SuitColors } from "@wgp/game-core/types";

import type { CastId } from "@wgp/game-core/cast";

import {
  along,
  ellipse,
  endHeading,
  fangs,
  intersect,
  linesIn,
  mirror,
  pixelate,
  rect,
  webIn,
  type Poly,
} from "./geometry";

const INK = "#141414";
const WHITE = "#FFFFFF";
const BLUSH = "#F59AAA";

function Art({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke={INK}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="block size-full"
    >
      {children}
    </svg>
  );
}

/** Shoulders that run off both sides and the bottom of the frame. */
const BUST = "M-8 130C-8 110 6 99 28 96C38 94.5 45 93.5 50 93L70 93C75 93.5 82 94.5 92 96C114 99 128 110 128 130Z";

/** A neck that disappears into the shoulders: a fill with outlined sides only. */
function Neck({ x, width, top, bottom = 97, fill }: { x: number; width: number; top: number; bottom?: number; fill: string }) {
  return (
    <>
      <rect x={x} y={top} width={width} height={bottom - top + 1} fill={fill} stroke="none" />
      <path d={`M${x} ${top}L${x} ${bottom}M${x + width} ${top}L${x + width} ${bottom}`} />
    </>
  );
}

function Blush({ cx, cy, rx = 4.6, ry = 2.8, fill = BLUSH }: { cx: number; cy: number; rx?: number; ry?: number; fill?: string }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} stroke="none" />;
}

/* ------------------------------------------------------------------ The Node */

const NODE_RED = "#E5392C";
const NODE_HEAD = "M60 9C80 9 93 25 93 45C93 63 85 78 74 86C69 90 64 92 60 92C56 92 51 90 46 86C35 78 27 63 27 45C27 25 40 9 60 9Z";
const NODE_FACE_WEB = webIn(NODE_HEAD, {
  center: [60, 49],
  spokes: [-90, -60, -30, 0, 30, 60, 90, 120, 150, 180, 210, 240],
  rings: [10, 20, 30],
  aspect: 1.2,
});
const NODE_SUIT_WEB = webIn(BUST, {
  center: [60, 140],
  spokes: [-168, -146, -124, -102, -78, -56, -34, -12],
  rings: [30, 45, 61],
  aspect: 0.85,
  closed: false,
});
const NODE_LENS = "M31 33C40 33 51 37.5 55.5 45C58.5 51.5 56.5 59 50.5 60.5C43.5 62 36.5 57.5 34.2 50C33 45.5 31.8 39.5 31 33Z";

/** Colors of a masked hero's suit: the player's hero and every suit in the game recolor The Node. */
export type { SuitColors };

export const NODE_COLORS: SuitColors = { suit: NODE_RED, web: INK, lens: WHITE };

/** The masked hero in any suit. Outlines stay ink so every suit reads as the same sticker style. */
export function HeroArt({ suit, web, lens }: SuitColors = NODE_COLORS) {
  return (
    <Art>
      <path d={BUST} fill={suit} />
      <path d={NODE_SUIT_WEB} stroke={web} strokeWidth={1.2} />
      <Neck x={49} width={22} top={74} fill={suit} />
      <g transform="rotate(-6 60 90)">
        <path d={NODE_HEAD} fill={suit} />
        <path d={NODE_FACE_WEB} stroke={web} strokeWidth={1.2} />
        <path d={NODE_LENS} fill={lens} strokeWidth={4.2} />
        <path d={mirror(NODE_LENS)} fill={lens} strokeWidth={4.2} />
        <path d="M38 22C41.5 17 46.5 13.5 52.5 12.5" stroke={WHITE} strokeWidth={2.6} />
        <circle cx={35.4} cy={26.8} r={1.3} fill={WHITE} stroke="none" />
      </g>
    </Art>
  );
}

function TheNode() {
  return <HeroArt {...NODE_COLORS} />;
}

/* ---------------------------------------------------------------- Gwei Stacy */

const GWEI_PINK = "#F3A6C8";
const GWEI_VIOLET = "#B6A2EC";
const GWEI_HAIR = "#F8D978";
const GWEI_PANEL = "#1E1E1E";
const GWEI_HOOD = "M60 5C86 5 102 24 102 51C102 74 97 90 88 100C80 106 70 107 60 107C50 107 40 106 32 100C23 90 18 74 18 51C18 24 34 5 60 5Z";
const GWEI_OPENING = "M60 17C79 17 92 32 92 53C92 75 79 95 60 97C41 95 28 75 28 53C28 32 41 17 60 17Z";
const GWEI_FACE = "M60 22C77 22 87 37 87 55C87 74 76 91 60 93C44 91 33 74 33 55C33 37 43 22 60 22Z";
const GWEI_WEB = webIn(GWEI_FACE, {
  center: [60, 62],
  spokes: [-90, -60, -30, 0, 30, 60, 90, 120, 150, 180, 210, 240],
  rings: [9.5, 19, 28.5],
  aspect: 1.2,
});
const GWEI_LENS = "M35.5 51C44 50 52.5 53 56 58.5C58.5 63 56.5 69.5 50.5 70.5C43.5 71.5 38 66.5 36.4 60C35.8 57 35.4 54 35.5 51Z";
const GWEI_FRINGE =
  "M28 46C34 42 40 41 46 42.5C49 43.5 51 45 53 47.5C54 43.5 57 41 61 41C66 41 71 44 74 48.5C75 45.5 77 43.5 80 43C85 45 89 50 91 57.5L96 30C88 8 32 8 24 30Z";
const GWEI_PANEL_L = "M-8 130C-8 110 6 99 28 96C33 104 35 117 33 130Z";

function GweiStacy() {
  return (
    <Art>
      <path d={BUST} fill={WHITE} />
      <path d={GWEI_PANEL_L} fill={GWEI_PANEL} />
      <path d={mirror(GWEI_PANEL_L)} fill={GWEI_PANEL} />
      <g transform="rotate(5 60 90)">
        <path d={GWEI_HOOD} fill={WHITE} />
        <path d={GWEI_OPENING} fill={GWEI_PINK} />
        <path d={GWEI_FACE} fill={WHITE} />
        <path d={GWEI_WEB} stroke={GWEI_VIOLET} strokeWidth={1.3} />
        <path d={GWEI_FACE} />
        <path d={GWEI_FRINGE} fill={GWEI_HAIR} />
        <path d="M41 34C48 33.5 55 35.5 60 39M65 31C72 33 78.5 37.5 82.5 43.5" strokeWidth={1.4} />
        <path d="M38 29C43 25 49 23 55 22.5" stroke={WHITE} strokeWidth={2.2} />
        <path d={`${GWEI_HOOD}${GWEI_OPENING}`} fill={WHITE} fillRule="evenodd" />
        <path d={GWEI_LENS} fill={WHITE} strokeWidth={4} />
        <path d={mirror(GWEI_LENS)} fill={WHITE} strokeWidth={4} />
        <path d="M40 101C47 104 73 104 80 101" strokeWidth={1.6} />
      </g>
    </Art>
  );
}

/* ---------------------------------------------------------------- Uncle Gen */

const GEN_SKIN = "#F3C6A2";
const GEN_CARDIGAN = "#8C5A3A";
const GEN_BAND = "#764A2D";
const GEN_SHIRT = "#A9CFF2";
const GEN_HAIR = "#CACAC6";
const GEN_BROW = "#8F8F8B";
const GEN_HEAD = "M57 15C75 15 86 27 86 45C86 58 85 69 80 78C76 85 69 88 62 88C52 88 44 83 40 75C35 67 32 57 32 45C32 27 41 15 57 15Z";
const GEN_MOUTH = "M55 72C60 75.5 69 75.5 75 71.5C74 78.5 69 82.5 64 82.5C59.5 82.5 56 78.5 55 72Z";
const GEN_TEETH = intersect(GEN_MOUTH, rect(50, 66, 30, 9.6));

function UncleGen() {
  return (
    <Art>
      <path d={BUST} fill={GEN_CARDIGAN} />
      <path d="M42 93L78 93L60 136Z" fill={GEN_SHIRT} />
      <path d="M37 94.5L42 93L60 136L54 136Z" fill={GEN_BAND} />
      <path d="M83 94.5L78 93L60 136L66 136Z" fill={GEN_BAND} />
      <circle cx={67.5} cy={115} r={1.8} fill={GEN_SHIRT} strokeWidth={1.5} />
      <Neck x={49} width={20} top={74} bottom={95} fill={GEN_SKIN} />
      <path d="M49 89L46 103L58.5 97Z" fill={GEN_SHIRT} />
      <path d="M69 89L72 103L59.5 97Z" fill={GEN_SHIRT} />
      <path d={GEN_HEAD} fill={GEN_SKIN} />
      <path
        d="M45 39C41 36 35 38 34 43C31 45 30 50 32 53C30 57 31 62 34 64C34 67 37 69 40 68C42 66 43 63 43 60L41 50C42 46 43.5 42 45 39Z"
        fill={GEN_HAIR}
      />
      <path d="M83 32C87 35 88.5 41 87.5 47C86.5 50 84.5 50 84 49C85 44 85 38 83 33Z" fill={GEN_HAIR} />
      <path d="M42 52C37 49 34 54 35 59C36 64 40 66 44 64" fill={GEN_SKIN} />
      <path d="M40.5 55.5C39 57 39.5 60 42 61" strokeWidth={1.6} />
      <path d="M45 22C49 19 54 18 58 18" stroke={WHITE} strokeWidth={2.4} />
      <path d="M51 31C55 29.5 61 29.5 65 31M53 35.5C56.5 34.3 61 34.3 64 35.5" strokeWidth={1.5} />
      <path d="M47 43C50 40.5 55 40.5 59 42.5" stroke={GEN_BROW} strokeWidth={3.4} />
      <path d="M70 42C73 40 77 40 80 41.5" stroke={GEN_BROW} strokeWidth={3.2} />
      <Blush cx={50} cy={66} />
      <Blush cx={79.5} cy={65.5} rx={3.2} ry={2.6} />
      <path d="M50.5 54.5C52 52 56 52 57.5 54.5M71.5 54.5C73 52.2 76 52.2 77.5 54.5" strokeWidth={2.2} />
      <rect x={46} y={47} width={16} height={11.5} rx={3} fill={WHITE} fillOpacity={0.3} strokeWidth={2} />
      <rect x={68} y={47} width={13} height={11.5} rx={3} fill={WHITE} fillOpacity={0.3} strokeWidth={2} />
      <path d="M62 51.5C64 50 66 50 68 51.5M46 51L41.5 53" strokeWidth={2} />
      <path d="M66 57C68 61 72 64.5 70.5 67C69 69 66.5 68.5 65 67" strokeWidth={2.2} />
      <path d="M74.5 66C76.5 68 77.5 70.5 77 73" strokeWidth={1.5} />
      <path d={GEN_MOUTH} fill="#8B3434" />
      <path d={GEN_TEETH} fill={WHITE} stroke="none" />
      <path d={GEN_MOUTH} strokeWidth={2.2} />
    </Art>
  );
}

/* ------------------------------------------------------------- Aunt Mainnet */

const MAY_SKIN = "#B9805A";
const MAY_HAIR = "#DADAD6";
const MAY_LILAC = "#C9B6EF";
const MAY_LILAC_DEEP = "#9F86D6";
const MAY_BLUSH = "#DC7880";
const MAY_HEAD = "M58 19C75 19 85 31 85 48C85 61 83 70 78 78C74 84 68 87 62 87C53 87 46 83 42 76C37 68 34 59 34 48C34 31 42 19 58 19Z";
const PEARLS = Array.from({ length: 9 }, (_, k) => {
  const t = k / 8;
  const u = 1 - t;
  return [u * u * 46.5 + 2 * u * t * 57.5 + t * t * 68.5, u * u * 94.5 + 2 * u * t * 106 + t * t * 94.5] as const;
});
const MAY_HAIR_PATH =
  "M34 59C29 53 28.5 45 31.5 39.5C30.5 30 37 22.5 45 21C50 15 59.5 14 66 17C74 16 83 21 86 30C90 35 90 42 87 46.5C84 40.5 79 37.5 74 38.5C70 34.5 63 34.5 59 37.5C54 35.5 48 38.5 46 43.5C43 46.5 42 50.5 42 55.5C39.5 58.5 36.5 60 34 59Z";

function AuntMainnet() {
  return (
    <Art>
      <g transform="matrix(-1 0 0 1 120 0)">
        <circle cx={44} cy={16} r={9.5} fill={MAY_HAIR} />
        <path d="M39.5 15.5C40.5 11.5 46 10.5 48.5 14.5" strokeWidth={1.5} />
        <path d={BUST} fill={MAY_LILAC} />
        <path d="M43 93C45 100 51 104.5 57.5 104.5C64 104.5 70 100 72 93Z" fill={MAY_SKIN} />
        <path d="M57.5 104.5L57.5 130" strokeWidth={1.8} />
        <circle cx={57.5} cy={113} r={1.7} fill={MAY_LILAC_DEEP} strokeWidth={1.4} />
        <circle cx={57.5} cy={121} r={1.7} fill={MAY_LILAC_DEEP} strokeWidth={1.4} />
        <Neck x={48} width={19} top={72} bottom={93} fill={MAY_SKIN} />
        {PEARLS.map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r={2.2} fill={WHITE} strokeWidth={1.4} />
        ))}
        <path d={MAY_HEAD} fill={MAY_SKIN} />
        <path d={MAY_HAIR_PATH} fill={MAY_HAIR} />
        <path d="M47 27C51 24 56 23 61 24M68 23C74 24.5 79 28 81.5 32.5M35.5 44C36 40 38 37 41 35" strokeWidth={1.5} />
        <path d="M43 53C38 50 35 55 36 60C37 65 41 67 45 65" fill={MAY_SKIN} />
        <circle cx={41.5} cy={67.5} r={1.9} fill={WHITE} strokeWidth={1.4} />
        <Blush cx={50} cy={65.5} fill={MAY_BLUSH} />
        <Blush cx={79} cy={64.5} rx={3} ry={2.4} fill={MAY_BLUSH} />
        <path d="M49 43.5C52 42 56 42 59 43.5M71 43C74 42 77 42.3 79 43.5" stroke="#6E6E6A" strokeWidth={2} />
        <ellipse cx={55} cy={55} rx={2.3} ry={2.9} fill={INK} stroke="none" />
        <ellipse cx={76} cy={55} rx={2} ry={2.8} fill={INK} stroke="none" />
        <circle cx={55.9} cy={54} r={0.9} fill={WHITE} stroke="none" />
        <circle cx={76.8} cy={54} r={0.8} fill={WHITE} stroke="none" />
        <circle cx={55} cy={54} r={8} fill={WHITE} fillOpacity={0.3} strokeWidth={2} />
        <ellipse cx={76} cy={54} rx={6} ry={7.5} fill={WHITE} fillOpacity={0.3} strokeWidth={2} />
        <path d="M63 53C65 51.5 68 51.5 70 53M47 53L42.5 55" strokeWidth={2} />
        <path d="M70 59C72 62.5 72 65 69 66" strokeWidth={2.2} />
        <path d="M58 73C62 76.5 68 76.5 72 73" strokeWidth={2.3} />
      </g>
    </Art>
  );
}

/* --------------------------------------------------------- J. Jonah Bearson */

const BEAR_FUR = "#9C6B43";
const BEAR_MUZZLE = "#DDB98C";
const BEAR_FLAT = "#BDBDB8";
const BEAR_SUIT = "#3B4150";
const BEAR_TIE = "#C9453B";
const BEAR_HEAD = "M60 21C83 21 95 36 95 55C95 73 81 87 60 87C39 87 25 73 25 55C25 36 37 21 60 21Z";

function Bearson() {
  return (
    <Art>
      <path d={BUST} fill={BEAR_SUIT} />
      <path d="M44 93L76 93L60 128Z" fill={WHITE} />
      <Neck x={47} width={26} top={78} bottom={93} fill={BEAR_FUR} />
      <path d="M47 90L42 102L54 99L53 93Z" fill={WHITE} />
      <path d="M73 90L78 102L66 99L67 93Z" fill={WHITE} />
      <g transform="rotate(7 60 101)">
        <path d="M57.5 107L62.5 107L65 124L60 129L55 124Z" fill={BEAR_TIE} />
        <path d="M56.5 100.5L63.5 100.5L62.5 107L57.5 107Z" fill={BEAR_TIE} />
      </g>
      <path d="M42 93L58 128L50 130L38 104Z" fill={BEAR_SUIT} />
      <path d="M78 93L62 128L70 130L82 104Z" fill={BEAR_SUIT} />
      <circle cx={33} cy={30} r={10.5} fill={BEAR_FUR} />
      <circle cx={33} cy={30} r={5.5} fill={BEAR_MUZZLE} strokeWidth={0} />
      <circle cx={87} cy={30} r={10.5} fill={BEAR_FUR} />
      <circle cx={87} cy={30} r={5.5} fill={BEAR_MUZZLE} strokeWidth={0} />
      <path d={BEAR_HEAD} fill={BEAR_FUR} />
      <path
        d="M43 31C42.5 25 43 20 45 17.5C46 16.5 47 16 48.5 16L71.5 16C73 16 74 16.5 75 17.5C77 20 77.5 25 77 31L72 27L66 31L60 27L54 31L48 27Z"
        fill={BEAR_FLAT}
      />
      <path d="M49 19.5L67 19.5" stroke={WHITE} strokeWidth={2} />
      <ellipse cx={60} cy={67} rx={15} ry={11.5} fill={BEAR_MUZZLE} />
      <path d="M40 41L55 46.5M80 41L65 46.5" strokeWidth={4.2} />
      <path d="M45.5 46.5L55 49.5C55 53.5 52.5 55.5 50 55.5C47 55.5 45 52 45.5 46.5Z" fill={INK} />
      <path d="M74.5 46.5L65 49.5C65 53.5 67.5 55.5 70 55.5C73 55.5 75 52 74.5 46.5Z" fill={INK} />
      <path d="M52.5 56C52.5 52.5 67.5 52.5 67.5 56C67.5 59.5 63.5 62 60 62C56.5 62 52.5 59.5 52.5 56Z" fill={INK} />
      <ellipse cx={57} cy={55.2} rx={2} ry={1} fill={WHITE} stroke="none" />
      <path
        d="M60 62.5C56 60.5 50 60.5 45 62.5C42 63.5 39.5 66 38 69.5C43 69 46.5 70.5 50.5 70.5C54.5 70.5 57.5 69.5 60 68C62.5 69.5 65.5 70.5 69.5 70.5C73.5 70.5 77 69 82 69.5C80.5 66 78 63.5 75 62.5C70 60.5 64 60.5 60 62.5Z"
        fill={INK}
      />
      <path d="M54 75.5C57 73.2 63 73.2 66 75.5" />
      <g transform="translate(65.5 75) rotate(-14)">
        <rect x={0} y={-3} width={27} height={6} rx={2.5} fill="#7B4A2B" />
        <rect x={5} y={-3} width={3.5} height={6} fill="#E3B341" strokeWidth={1.5} />
        <rect x={23} y={-3} width={4.5} height={6} rx={2} fill="#F47A3B" />
      </g>
      <path d="M97 63C94 59.5 95.5 56 99 54.5C102.5 53 102.5 48 99.5 46C96.5 44 97 40.5 99.5 39" stroke="#9E9E9A" strokeWidth={2.2} />
    </Art>
  );
}

/* ----------------------------------------------------------------- Mary Jpeg */

const MJ_RED = "#E8492F";
const MJ_DARK = "#C23722";
const MJ_LIGHT = "#F7774F";
const MJ_SKIN = "#F8D5BC";
const MJ_TEAL = "#2DB3A5";
const MJ_HAIR = pixelate(
  "M58 7C82 7 97 23 96 45C95.5 62 99 80 106 98C96 104 82 103 74 93L46 93C38 103 22 104 13 98C19 80 22 62 22 45C22 23 36 7 58 7Z",
  5,
);
const MJ_BANGS = pixelate(
  "M33 54C30 32 42 17 61 17C78 17 90 28 89 46C84 41 78 37 72 33C66 38 55 41 44 41C40 45 37 49 36 55Z",
  5,
);
const MJ_FACE = "M57 22C74 22 84 34 84 50C84 63 81 72 76 79C72 84 67 86 61 86C52 86 45 81 41 74C37 67 35 59 35 50C35 34 43 22 57 22Z";
const MJ_MOUTH = "M54 70C60 73.5 70 73.5 76 69C75.5 77 70 82 64 82C58.5 82 55 77 54 70Z";
const MJ_TEETH = intersect(MJ_MOUTH, rect(50, 64, 30, 10.4));
const MJ_TONGUE = intersect(MJ_MOUTH, ellipse(65.5, 83.5, 8, 5.5));

function MaryJpeg() {
  return (
    <Art>
      <path d={BUST} fill={MJ_TEAL} />
      <path d={MJ_HAIR} strokeWidth={5} strokeLinejoin="miter" />
      <path d={MJ_HAIR} fill={MJ_RED} stroke="none" />
      <rect x={25} y={45} width={5} height={5} fill={MJ_DARK} stroke="none" />
      <rect x={90} y={75} width={5} height={5} fill={MJ_LIGHT} stroke="none" />
      <rect x={30} y={85} width={5} height={5} fill={MJ_DARK} stroke="none" />
      <rect x={101} y={30} width={4} height={4} fill={MJ_RED} strokeWidth={1.5} strokeLinejoin="miter" />
      <rect x={11} y={55} width={3} height={3} fill={MJ_RED} strokeWidth={1.5} strokeLinejoin="miter" />
      <Neck x={50} width={18} top={74} bottom={94} fill={MJ_SKIN} />
      <path d="M42 93C45 101 51 104 58 104C65 104 71 101 74 93Z" fill={MJ_SKIN} />
      <rect x={50} y={88} width={18} height={6.5} fill={MJ_SKIN} stroke="none" />
      <path d={MJ_FACE} fill={MJ_SKIN} />
      <path d={MJ_BANGS} strokeWidth={5} strokeLinejoin="miter" />
      <path d={MJ_BANGS} fill={MJ_RED} stroke="none" />
      <Blush cx={50.5} cy={66.5} rx={5} ry={3} />
      <Blush cx={79.5} cy={65.5} rx={3.5} ry={2.6} />
      <g fill="#C2703F" stroke="none">
        <circle cx={47} cy={63} r={0.9} />
        <circle cx={50.5} cy={64.2} r={0.9} />
        <circle cx={48.5} cy={66.6} r={0.9} />
        <circle cx={63} cy={61} r={0.8} />
        <circle cx={66} cy={60} r={0.8} />
        <circle cx={78} cy={62} r={0.8} />
        <circle cx={80.5} cy={64} r={0.8} />
      </g>
      <path d="M49 46.5C51.5 44.5 55 44 58 45M70 45C72.5 44 75.5 44.2 77.5 45.5" stroke="#B33A22" strokeWidth={2.2} />
      <ellipse cx={54} cy={56} rx={3.4} ry={4.4} fill={INK} stroke="none" />
      <ellipse cx={73.5} cy={55.5} rx={3} ry={4.2} fill={INK} stroke="none" />
      <circle cx={55.2} cy={54.3} r={1.3} fill={WHITE} stroke="none" />
      <circle cx={74.5} cy={53.8} r={1.1} fill={WHITE} stroke="none" />
      <path d="M50.5 53L48 51.5M76.5 52.5L78.5 50.8" strokeWidth={1.8} />
      <path d="M68.5 61C70 63.5 70 65 67.5 66" strokeWidth={2} />
      <path d={MJ_MOUTH} fill="#7E2A2E" />
      <path d={MJ_TONGUE} fill="#EE7D86" stroke="none" />
      <path d={MJ_TEETH} fill={WHITE} stroke="none" />
      <path d={MJ_MOUTH} strokeWidth={2.2} />
    </Art>
  );
}

/* ---------------------------------------------------------------- Gas Goblin */

const GOB_GREEN = "#8DC63F";
const GOB_COWL = "#7C4DCC";
const GOB_EYE = "#F7D23E";
const STEEL = "#B9BEC6";
const GOB_GRIN = "M41 68C49 76 71 76 79 68C76 79 69 85 60 85C51 85 44 79 41 68Z";
const GOB_TEETH = linesIn(GOB_GRIN, [
  ...[46, 50.5, 55, 60, 65, 69.5, 74].map((x): Poly => [
    [x, 60],
    [x, 90],
  ]),
]);
const GOB_EAR = "M39 49C31 44 20 38 6 33C13 44 22 56 39 61Z";
const GOB_EYE_L = "M43 50.5L56 53C55 57 51.5 58.5 48 57.5C45 56.5 43.5 54 43 50.5Z";

function GasGoblin() {
  return (
    <Art>
      <path d={BUST} fill={GOB_COWL} />
      <path
        d="M26 102C21 84 21 62 25 46C29 30 40 19 54 15C64 12 76 9 88 3C83 12 81 18 83 25C92 35 96 51 95 67C94 81 91 93 86 102Z"
        fill={GOB_COWL}
      />
      <path d="M83 25C78 22 71 20 64 20" strokeWidth={1.6} />
      <path d="M34 34C38 27 44 22 51 19" stroke={WHITE} strokeWidth={2.2} />
      <path d={GOB_EAR} fill={GOB_GREEN} />
      <path d={mirror(GOB_EAR)} fill={GOB_GREEN} />
      <path d="M33 51C27 47.5 21 44 15 41M87 51C93 47.5 99 44 105 41" strokeWidth={1.5} />
      <path d="M60 29C74 29 82 38 83 50C84 61 80 71 72 80C68 85 64 88 60 89C56 88 52 85 48 80C40 71 36 61 37 50C38 38 46 29 60 29Z" fill={GOB_GREEN} />
      <path d={GOB_EYE_L} fill={GOB_EYE} />
      <path d={mirror(GOB_EYE_L)} fill={GOB_EYE} />
      <ellipse cx={50.5} cy={54.6} rx={1.2} ry={2.4} fill={INK} stroke="none" />
      <ellipse cx={69.5} cy={54.6} rx={1.2} ry={2.4} fill={INK} stroke="none" />
      <path d="M41 45L56 50M79 45L64 50" strokeWidth={4} />
      <path d="M44 64C45 68 47 71 50 72M76 64C75 68 73 71 70 72" strokeWidth={1.5} />
      <path d={GOB_GRIN} fill={WHITE} />
      <path d="M43 71.5C51 78.5 69 78.5 77 71.5" strokeWidth={1.5} />
      <path d={GOB_TEETH} strokeWidth={1.5} />
      <path d="M58.5 53C60 59 64 64 65.5 67C66.5 69.5 64 71 61.5 69.5" fill={GOB_GREEN} strokeWidth={2.4} />
      <path d="M76 130C78 121 80 114 83 108L97 111C96 118 97 124 99 130Z" fill={GOB_COWL} />
      <g transform="translate(91 99) rotate(-64)">
        <path d="M-21 1C-33 1 -45 6 -57 14" stroke={INK} strokeWidth={8.5} />
        <path d="M-21 1C-33 1 -45 6 -57 14" stroke="#3A3A3A" strokeWidth={4} />
        <path d="M10 0L29 0L35 6" stroke={INK} strokeWidth={8.5} />
        <path d="M10 0L29 0L35 6" stroke={STEEL} strokeWidth={4} />
        <path d="M-17 7C-17 18 5 18 7 7" strokeWidth={2.6} />
        <path d="M-22 -6L6 -7C9 -7 11 -5 11 -2L11 4C11 6 9 7 7 7L-22 7Z" fill={GOB_EYE} />
        <path d="M2 -7L2 7" strokeWidth={1.6} />
        <rect x={-19} y={-10} width={15} height={19} rx={6} fill={GOB_GREEN} />
        <path d="M-19 -3.5C-15 -6.5 -9 -6.5 -5 -3.5M-14.5 0L-14.5 9M-9.5 0L-9.5 9" strokeWidth={1.6} />
      </g>
    </Art>
  );
}

/* ------------------------------------------------------------- Doc Octochain */

const OCT_SKIN = "#E2A877";
const OCT_HAIR = "#6E4527";
const OCT_COAT = "#4F9A4E";
const OCT_SHIRT = "#3A3D44";
const OCT_STEEL = "#AEB4BD";
const OCT_SLOT = "#6E7581";
const OCT_ARM_OUTER = "M34 106C20 98 8 86 6 68C5 58 8 50 13 44";
const OCT_ARM_INNER = "M40 100C32 84 26 66 26 49C26 40 28 32 31 26";
const OCT_ARMS = [OCT_ARM_OUTER, OCT_ARM_INNER, mirror(OCT_ARM_OUTER), mirror(OCT_ARM_INNER)].map((d) => ({
  links: along(d, 7, 2),
  claw: endHeading(d),
}));

function Claw({ x, y, angle }: { x: number; y: number; angle: number }) {
  const prongs = "M2 -2C6 -8 11 -9 15 -6M3 0L15 0.5M2 2C6 8 11 9 15 6";
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d={prongs} strokeWidth={5} />
      <path d={prongs} stroke={OCT_STEEL} strokeWidth={2.2} />
      <circle cx={0} cy={0} r={4.5} fill={OCT_STEEL} />
    </g>
  );
}

function DocOctochain() {
  return (
    <Art>
      {OCT_ARMS.map(({ links, claw }, a) => (
        <g key={a}>
          {links.map((l, k) =>
            k % 2 === 1 ? (
              <rect
                key={k}
                x={-4.5}
                y={-1.5}
                width={9}
                height={3}
                rx={1.5}
                fill={OCT_STEEL}
                strokeWidth={1.8}
                transform={`translate(${l.x} ${l.y}) rotate(${l.angle})`}
              />
            ) : null,
          )}
          {links.map((l, k) =>
            k % 2 === 0 ? (
              <g key={k} transform={`translate(${l.x} ${l.y}) rotate(${l.angle})`}>
                <rect x={-5} y={-3.6} width={10} height={7.2} rx={3.2} fill={OCT_STEEL} strokeWidth={1.8} />
                <rect x={-2.4} y={-1} width={4.8} height={2} rx={1} fill={OCT_SLOT} stroke="none" />
              </g>
            ) : null,
          )}
          <Claw {...claw} />
        </g>
      ))}
      <path d={BUST} fill={OCT_COAT} />
      <path d="M46 93L74 93L60 124Z" fill={OCT_SHIRT} />
      <Neck x={50} width={20} top={74} bottom={93} fill={OCT_SKIN} />
      <path d="M50 93C44 90 40 86 38 81L31 98C38 100 46 98 52 96Z" fill={OCT_COAT} />
      <path d="M70 93C76 90 80 86 82 81L89 98C82 100 74 98 68 96Z" fill={OCT_COAT} />
      <path d="M46 96L58 124M74 96L62 124" strokeWidth={2} />
      <path d="M37 54C32 52 30 58 31.5 62C33 66 36 67 38 66" fill={OCT_SKIN} />
      <path d="M83 54C88 52 90 58 88.5 62C87 66 84 67 82 66" fill={OCT_SKIN} />
      <path d="M60 25C77 25 86 37 86 54C86 71 77 84 60 85C43 84 34 71 34 54C34 37 43 25 60 25Z" fill={OCT_SKIN} />
      <path
        d="M33 58C31 37 42 21 60 21C78 21 89 37 87 58C86 59 84 59 83 58C83 54 82.5 50 82 47L38 47C37.5 50 37 54 37 58C36 59 34 59 33 58Z"
        fill={OCT_HAIR}
      />
      <path d="M52 30C50.5 35 50 40 50.5 45M68 30C69.5 35 70 40 69.5 45" strokeWidth={1.4} />
      <path d="M41 33C44 28 48 25 53 23.5" stroke={WHITE} strokeWidth={2.2} />
      <path d="M41.5 54L37 54M78.5 54L83 54" strokeWidth={2.4} />
      <circle cx={49.5} cy={55} r={8} fill="#26282E" strokeWidth={3} />
      <circle cx={70.5} cy={55} r={8} fill="#26282E" strokeWidth={3} />
      <path d="M57.5 54C59 52.5 61 52.5 62.5 54" strokeWidth={2.4} />
      <path d="M45 51.5C46 50 47.5 49.2 49 49M66 51.5C67 50 68.5 49.2 70 49" stroke={WHITE} strokeWidth={1.8} />
      <circle cx={53} cy={58.5} r={1.1} fill={WHITE} stroke="none" />
      <circle cx={74} cy={58.5} r={1.1} fill={WHITE} stroke="none" />
      <Blush cx={43} cy={67} rx={4} ry={2.5} />
      <Blush cx={77} cy={67} rx={4} ry={2.5} />
      <path d="M56 62C55 66 58 67.5 60 67.5C62 67.5 65 66 64 62" strokeWidth={2.2} />
      <path d="M50 72.5C55 75.5 63 76 69 71.5L71 70" />
      <path d="M53 81C57 83 63 83 67 81M40 68C41.5 72.5 44 76 47.5 78.5M80 68C78.5 72.5 76 76 72.5 78.5" strokeWidth={1.5} />
    </Art>
  );
}

/* -------------------------------------------------------------- Sandwich Man */

const SW_BUN = "#EDB15E";
const SW_SEED = "#FFF4D6";
const SW_LETTUCE = "#78C043";
const SW_TOMATO = "#E5483A";
const SW_CHEESE = "#F8C93A";
const SW_BREAD = "#E8B66C";
const SW_SUIT = "#2A2A2D";
const SW_LAPEL = "#3E3E43";
const SW_LETTUCE_PATH = (() => {
  const step = 74 / 9;
  let d = "M24 56L96 56C100.5 58 101 63 97 66";
  for (let k = 0; k < 9; k++) {
    const x = 97 - k * step;
    d += `Q${x - step / 2} ${k % 2 ? 73 : 71.5} ${x - step} 66`;
  }
  return `${d}C19 63 19.5 58 24 56Z`;
})();
const SEEDS: [number, number, number][] = [
  [45, 24, -35],
  [57, 19.5, -10],
  [69, 21, 15],
  [79, 27.5, 38],
  [38, 34, -55],
  [85, 37, 60],
  [63, 28.5, 5],
  [51, 30, -20],
  [74, 32, 25],
];

function SandwichMan() {
  return (
    <Art>
      <path d={BUST} fill={SW_SUIT} />
      <path d="M46 92L74 92L60 120Z" fill={WHITE} />
      <path d="M58 98L62 98L64.5 116L60 121L55.5 116Z" fill="#C9302C" />
      <path d="M57 92L63 92L62 98L58 98Z" fill="#C9302C" />
      <path d="M46 92L60 120L53 124L40 101Z" fill={SW_LAPEL} />
      <path d="M74 92L60 120L67 124L80 101Z" fill={SW_LAPEL} />
      <rect x={30} y={79} width={60} height={15} rx={5} fill={SW_BREAD} />
      <path
        d="M24 74L96 74C98 74 99 76 98.5 78L97 84C96.6 85.5 95 85.5 94.6 84L93.5 81L76 81C75 81 74.5 82 74.5 83L74.5 87C74.5 89 72 89 72 87L72 83C72 82 71.5 81 70.5 81L44 81C43 81 42.5 82 42.5 83L42.5 90C42.5 92.5 39 92.5 39 90L39 83C39 82 38.5 81 37.5 81L26.5 81L25.4 84C25 85.5 23.4 85.5 23 84L21.5 78C21 76 22 74 24 74Z"
        fill={SW_CHEESE}
      />
      <rect x={26} y={66} width={68} height={10.5} rx={5} fill={SW_TOMATO} />
      <path d={SW_LETTUCE_PATH} fill={SW_LETTUCE} />
      <path d="M27 58C27 32 42 13 60 13C78 13 93 32 93 58C93 60.5 91 61.5 89 61.5L31 61.5C29 61.5 27 60.5 27 58Z" fill={SW_BUN} />
      <path d="M35 33C38 26 43 21 49 18" stroke={WHITE} strokeWidth={2.4} />
      {SEEDS.map(([x, y, r], k) => (
        <ellipse key={k} cx={x} cy={y} rx={2.4} ry={1.3} transform={`rotate(${r} ${x} ${y})`} fill={SW_SEED} strokeWidth={1.2} />
      ))}
      <path d="M43 40L55 44.5C55 48.5 52.5 51 49.5 51C46 51 43 47.5 43 40Z" fill={WHITE} />
      <path d="M77 40L65 44.5C65 48.5 67.5 51 70.5 51C74 51 77 47.5 77 40Z" fill={WHITE} />
      <circle cx={50.5} cy={46.5} r={2.3} fill={INK} stroke="none" />
      <circle cx={69.5} cy={46.5} r={2.3} fill={INK} stroke="none" />
      <path d="M41 36.5L56 41.5M79 36.5L64 41.5" strokeWidth={3.6} />
      <path d="M52 56C55 52.5 65 52.5 68 56" strokeWidth={2.6} />
    </Art>
  );
}

/* ----------------------------------------------------------------- The Sybil */

const SYB_GOO = "#19191B";
const SYB_BODY = "#2C2C2F";
const SYB_HEAD = "M60 12C84 12 97 28 97 48C97 64 93 76 86 84C80 91 71 95 60 95C49 95 40 91 34 84C27 76 23 64 23 48C23 28 36 12 60 12Z";
const SYB_EYE = "M56 50L49 41L41 35L28 27L32 37L29 39L35 43L33 46L41 49L40 52L48 52Z";
const SYB_MOUTH = "M27 57C41 69 79 69 93 57C90 93 30 93 27 57Z";
const SYB_TOP_TEETH = fangs(
  [
    [27, 57],
    [41, 69],
    [79, 69],
    [93, 57],
  ],
  10,
  10,
  1,
);
const SYB_BOTTOM_TEETH = fangs(
  [
    [27, 57],
    [30, 93],
    [90, 93],
    [93, 57],
  ],
  9,
  9,
  -1,
);

/** One of the many: the same goo, gone gray, offset behind him. */
function SybilCopy({ transform }: { transform: string }) {
  return (
    <g transform={transform}>
      <path d={BUST} fill="#A3A3A0" />
      <path d={SYB_HEAD} fill="#A3A3A0" />
      <path d={SYB_EYE} fill="#E4E4E1" />
      <path d={mirror(SYB_EYE)} fill="#E4E4E1" />
      <path d={SYB_MOUTH} fill="#74746F" />
    </g>
  );
}

function TheSybil() {
  return (
    <Art>
      <SybilCopy transform="translate(18 56) scale(0.8) translate(-60 -60)" />
      <SybilCopy transform="translate(102 56) scale(0.8) translate(-60 -60)" />
      <path d={BUST} fill={SYB_BODY} />
      <path d="M14 104C20 100 27 98 33 97.5M87 97.5C93 98 100 100 106 104" stroke={WHITE} strokeWidth={2} />
      <path d={SYB_HEAD} fill={SYB_GOO} />
      <path d="M34 28C38.5 21 46 16.5 54 15.5" stroke={WHITE} strokeWidth={3} />
      <circle cx={31.2} cy={33.5} r={1.5} fill={WHITE} stroke="none" />
      <path d="M90 34C91.5 37 92.2 40 92.4 43" stroke={WHITE} strokeWidth={2} />
      <path d={SYB_EYE} fill={WHITE} />
      <path d={mirror(SYB_EYE)} fill={WHITE} />
      <path d={SYB_MOUTH} fill="#7A1C2B" />
      <path d={SYB_TOP_TEETH} fill={WHITE} strokeWidth={1.4} />
      <path d={SYB_BOTTOM_TEETH} fill={WHITE} strokeWidth={1.4} />
      <path d={SYB_MOUTH} strokeWidth={2.2} />
    </Art>
  );
}

/** Each cast member's bust, keyed by cast id. */
export const AVATARS: Record<CastId, () => JSX.Element> = {
  node: TheNode,
  gwei: GweiStacy,
  "uncle-gen": UncleGen,
  "aunt-mainnet": AuntMainnet,
  bearson: Bearson,
  "mary-jpeg": MaryJpeg,
  "gas-goblin": GasGoblin,
  "doc-octochain": DocOctochain,
  "sandwich-man": SandwichMan,
  sybil: TheSybil,
};
