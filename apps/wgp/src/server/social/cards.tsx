/**
 * The card images: a run's Open Graph image and the queue's attachments (a board's top
 * places, a market move, a season countdown, a Daily Rug front page), drawn with
 * `next/og` in the game's comic style: indigo night, a cream paper card with a heavy ink
 * outline and a hard drop, numbers big. Every number is read from the database here, by
 * the card itself, never taken from the URL.
 *
 * Satori lays out flexbox only, so every element with more than one child is a flex box.
 * Colors are the game kit's (globals.css `--game-*`); a PNG can't read CSS variables.
 */
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { formatPrice } from "@/components/market/sparkline";
import { SITE_HOST } from "@/lib/site";

import type { Db } from "../db/client";
import { ALLTIME_PERIOD, topEntries, type BoardRow } from "../db/leaderboard";
import { TROPHY_PLACES, type SeasonStanding } from "../db/season-close";
import { marketPrices, seasons, type Board } from "../db/schema";
import { CARD_FONT, cardFonts } from "./fonts";
import { DAY_MS, HOUR_MS, editionForRun } from "./generators";
import { publicRun, type PublicRun } from "./runs";

export const CARD_SIZE = { width: 1200, height: 630 } as const;

const C = {
  night: "#22264f",
  paper: "#fffdf8",
  paper2: "#f3efe6",
  ink: "#141414",
  muted: "#5e5a54",
  gold: "#ffd95a",
  hero: "#d62e21",
  mint: "#16a36a",
  white: "#ffffff",
} as const;

const points = new Intl.NumberFormat("en-US");
const fmt = (n: number) => points.format(n);
const day = (iso: string | Date) => new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** Stars in the night margin round the card. Decorative. */
const STARS: [number, number, number][] = [
  [70, 14, 6], [210, 22, 4], [430, 10, 5], [640, 24, 4], [905, 12, 6], [1090, 20, 4], [1170, 120, 5], [1176, 420, 4], [14, 300, 5], [20, 520, 4], [330, 600, 5], [780, 606, 4], [1050, 598, 6],
];

function Chip({ children, tone = "paper" }: { children: ReactNode; tone?: "paper" | "gold" | "mint" | "ink" | "hero" }) {
  const bg = { paper: C.paper, gold: C.gold, mint: C.mint, ink: C.ink, hero: C.hero }[tone];
  const fg = tone === "mint" || tone === "ink" || tone === "hero" ? C.white : C.ink;
  return (
    <div style={{ display: "flex", alignItems: "center", height: 46, padding: "0 20px", borderRadius: 999, border: `4px solid ${C.ink}`, backgroundColor: bg, color: fg, fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function Frame({ badge, footer, children }: { badge: ReactNode; footer: string; children: ReactNode }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", backgroundColor: C.night, padding: "38px 46px 56px", fontFamily: CARD_FONT, color: C.ink }}>
      {STARS.map(([x, y, s], i) => (
        <div key={i} style={{ position: "absolute", left: x, top: y, width: s, height: s, borderRadius: 999, backgroundColor: C.gold }} />
      ))}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, backgroundColor: C.paper, border: `6px solid ${C.ink}`, borderRadius: 40, boxShadow: `0 14px 0 ${C.ink}`, padding: "30px 46px 26px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Chip tone="ink">With Great Power</Chip>
          {badge}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>{children}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `3px solid ${C.paper2}`, paddingTop: 14, fontSize: 24, color: C.muted }}>
          <span>{footer}</span>
          <span>On NEAR · every run replay-verified</span>
        </div>
      </div>
    </div>
  );
}

/** A comic starburst with a label and a number in it. */
function Burst({ label, value, size = 250 }: { label: string; value: string; size?: number }) {
  const n = 14;
  const c = size / 2;
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const r = i % 2 ? c * 0.74 : c * 0.97;
    return `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <polygon points={pts} fill={C.gold} stroke={C.ink} strokeWidth={6} strokeLinejoin="round" />
      </svg>
      <div style={{ position: "absolute", left: 0, top: 0, width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3 }}>{label}</span>
        <span style={{ fontSize: 76, fontWeight: 700, lineHeight: 1 }}>{value}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

export function RunCard({ run }: { run: PublicRun }) {
  const score = fmt(run.score);
  return (
    <Frame badge={<Chip tone="mint">Replay-verified</Chip>} footer={`${SITE_HOST}/r/${run.runId.slice(0, 8)}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 1 }}>
          <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, color: C.muted }}>BANKED</span>
          <span style={{ fontSize: score.length > 7 ? 132 : 172, fontWeight: 700, lineHeight: 1, letterSpacing: -6, marginTop: 6 }}>{score}</span>
          <span style={{ fontSize: 44, fontWeight: 700, marginTop: 18 }}>{run.handle}</span>
          <span style={{ fontSize: 26, color: C.muted, marginTop: 4 }}>
            {[run.heroName, day(run.submittedAt ?? run.issuedAt), run.assist ? "assist on, not ranked" : null].filter(Boolean).join(" · ")}
          </span>
        </div>
        <Burst label="NIGHT" value={String(run.night)} />
      </div>
    </Frame>
  );
}

export function BoardCard({ title, detail, rows, final }: { title: string; detail: string; rows: Pick<BoardRow, "rank" | "handle" | "score">[]; final: boolean }) {
  const two = rows.length > 5;
  const columns = two ? [rows.slice(0, 5), rows.slice(5)] : [rows];
  return (
    <Frame badge={<Chip tone="gold">{final ? "Final" : detail}</Chip>} footer={SITE_HOST}>
      <span style={{ fontSize: two ? 52 : 60, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{title}</span>
      <div style={{ display: "flex", gap: 40, marginTop: two ? 18 : 24 }}>
        {columns.map((col, c) => (
          <div key={c} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, gap: two ? 6 : 10 }}>
            {col.map((r) => (
              <div key={r.rank} style={{ display: "flex", alignItems: "center", gap: 18, height: two ? 52 : 64 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: two ? 46 : 56, height: two ? 46 : 56, borderRadius: 999, border: `4px solid ${C.ink}`, backgroundColor: r.rank === 1 ? C.gold : C.paper2, fontSize: two ? 22 : 28, fontWeight: 700 }}>
                  {String(r.rank)}
                </div>
                <span style={{ fontSize: two ? 28 : 38, fontWeight: 700, flexGrow: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{r.handle}</span>
                <span style={{ fontSize: two ? 28 : 38, fontWeight: 700 }}>{fmt(r.score)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function MarketCard({ name, from, to, spark }: { name: string; from: number; to: number; spark: number[] }) {
  const change = (to - from) / from;
  const pct = `${change >= 0 ? "+" : "−"}${Math.abs(Math.round(change * 100))}%`;
  const w = 1000;
  const h = 150;
  const lo = Math.min(...spark);
  const hi = Math.max(...spark);
  const xy = spark.map((v, i) => [(i / Math.max(1, spark.length - 1)) * (w - 16) + 8, h - 10 - ((v - lo) / Math.max(1, hi - lo)) * (h - 20)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1]!;
  return (
    <Frame badge={<Chip tone={change >= 0 ? "gold" : "paper"}>{`${pct} in 24h`}</Chip>} footer={`Gwei’s stall · ${SITE_HOST}/play/market`}>
      <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: 3, color: C.muted }}>THE MEMPOOL MARKET</span>
      <span style={{ fontSize: 62, fontWeight: 700, letterSpacing: -2, marginTop: 2 }}>{name}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 4 }}>
        <span style={{ fontSize: 56, fontWeight: 700, color: C.muted }}>{formatPrice(from)}</span>
        <span style={{ fontSize: 56, fontWeight: 700 }}>→</span>
        <span style={{ fontSize: 72, fontWeight: 700 }}>{formatPrice(to)}</span>
        <span style={{ fontSize: 34, fontWeight: 700, color: C.muted }}>Bits</span>
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ marginTop: 14 }}>
        <polyline points={line} fill="none" stroke={C.ink} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lx} cy={ly} r={12} fill={C.hero} stroke={C.ink} strokeWidth={5} />
      </svg>
    </Frame>
  );
}

export function CountdownCard({ season, hours, starts }: { season: string; hours: number; starts: Date | null }) {
  return (
    <Frame badge={<Chip tone="hero">{starts ? "Starts soon" : "Closing"}</Chip>} footer={`${SITE_HOST}/play/leaderboard`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: 3, color: C.muted }}>{season.toUpperCase()}</span>
          <span style={{ fontSize: 64, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, marginTop: 6 }}>{starts ? "opens in" : "closes in"}</span>
          <span style={{ fontSize: 30, color: C.muted, marginTop: 18, maxWidth: 560 }}>
            {starts ? `${day(starts)}, 00:00 UTC. ` : ""}
            {`The top ${TROPHY_PLACES} get on-chain trophies.`}
          </span>
        </div>
        <Burst label="HOURS" value={String(hours)} size={300} />
      </div>
    </Frame>
  );
}

export function RugCard({ headline, dek, night, date }: { headline: string; dek: string; night: number; date: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: C.night, padding: "38px 46px 56px", fontFamily: CARD_FONT, color: C.ink }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, backgroundColor: C.paper, border: `6px solid ${C.ink}`, borderRadius: 18, boxShadow: `0 14px 0 ${C.ink}`, padding: "26px 46px" }}>
        <span style={{ fontSize: 78, fontWeight: 700, letterSpacing: -3, textAlign: "center", lineHeight: 1, alignSelf: "center" }}>The Daily Rug</span>
        <div style={{ display: "flex", height: 6, backgroundColor: C.ink, marginTop: 14 }} />
        <div style={{ display: "flex", height: 2, backgroundColor: C.ink, marginTop: 3 }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 700, letterSpacing: 2, padding: "8px 0" }}>
          <span>{`NIGHT ${night}`}</span>
          <span style={{ color: C.muted }}>THE CITY’S LEAST TRUSTED NEWSPAPER</span>
          <span>{date.toUpperCase()}</span>
        </div>
        <div style={{ display: "flex", height: 2, backgroundColor: C.ink }} />
        <span style={{ fontSize: headline.length > 34 ? 58 : 72, fontWeight: 700, textTransform: "uppercase", letterSpacing: -2, lineHeight: 1, marginTop: 26 }}>{headline}</span>
        <span style={{ fontSize: 28, lineHeight: 1.3, marginTop: 18, color: C.ink }}>{dek}.</span>
        <span style={{ fontSize: 24, fontWeight: 700, marginTop: "auto" }}>By J. Jonah Bearson, who already knows the answer</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ data */

const PERIOD = /^[a-z0-9-]{1,32}$/;

async function boardCard(db: Db, q: URLSearchParams): Promise<ReactElement | null> {
  const board = q.get("board") as Board | null;
  const period = q.get("period") ?? "";
  if (board === "tonight") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return null;
    const rows = await topEntries(db, "tonight", period, 3);
    if (rows.length === 0) return null;
    return <BoardCard title={rows.length === 1 ? "Tonight’s #1" : `Tonight’s top ${rows.length}`} detail={day(`${period}T00:00:00Z`)} rows={rows} final={false} />;
  }
  if (board === "alltime") {
    const rows = await topEntries(db, "alltime", ALLTIME_PERIOD, 5);
    return rows.length ? <BoardCard title="All-time best nights" detail="All time" rows={rows} final={false} /> : null;
  }
  if (board !== "season" || !PERIOD.test(period)) return null;
  const [s] = await db.select().from(seasons).where(eq(seasons.id, period)).limit(1);
  if (!s) return null;
  const final = s.status === "closed" || s.status === "recorded";
  const rows = final ? ((s.standings ?? []) as SeasonStanding[]).slice(0, TROPHY_PLACES) : await topEntries(db, "season", s.id, TROPHY_PLACES);
  if (rows.length === 0) return null;
  return <BoardCard title={final ? `${s.name}: the final top ${rows.length}` : `${s.name} standings`} detail={s.name} rows={rows} final={final} />;
}

async function marketCard(db: Db, q: URLSearchParams, at: Date): Promise<ReactElement | null> {
  const item = q.get("item") ?? "";
  if (!(item in ITEMS)) return null;
  const since = new Date(at.getTime() - DAY_MS);
  const [latest] = await db.select({ onChain: marketPrices.onChain }).from(marketPrices).where(lte(marketPrices.at, at)).orderBy(desc(marketPrices.at)).limit(1);
  if (!latest) return null;
  const notFill = sql`${marketPrices.kind} <> 'fill'`;
  const rows = await db
    .select({ priceMilli: marketPrices.priceMilli })
    .from(marketPrices)
    .where(and(eq(marketPrices.item, item), eq(marketPrices.onChain, latest.onChain), gte(marketPrices.at, since), lte(marketPrices.at, at), notFill))
    .orderBy(asc(marketPrices.at));
  const [open] = await db
    .select({ priceMilli: marketPrices.priceMilli })
    .from(marketPrices)
    .where(and(eq(marketPrices.item, item), eq(marketPrices.onChain, latest.onChain), lt(marketPrices.at, since), notFill))
    .orderBy(desc(marketPrices.at))
    .limit(1);
  const series = [...(open ? [open.priceMilli] : []), ...rows.map((r) => r.priceMilli)];
  if (series.length < 2 || series[0]! <= 0) return null;
  return <MarketCard name={ITEMS[item as ItemId].name} from={series[0]!} to={series[series.length - 1]!} spark={series.slice(-48)} />;
}

async function countdownCard(db: Db, q: URLSearchParams, at: Date): Promise<ReactElement | null> {
  const id = q.get("season") ?? "";
  if (!PERIOD.test(id)) return null;
  const [s] = await db.select().from(seasons).where(eq(seasons.id, id)).limit(1);
  if (!s) return null;
  if (at < s.startsAt) return <CountdownCard season={s.name} hours={Math.ceil((s.startsAt.getTime() - at.getTime()) / HOUR_MS)} starts={s.startsAt} />;
  if (at < s.endsAt) return <CountdownCard season={s.name} hours={Math.ceil((s.endsAt.getTime() - at.getTime()) / HOUR_MS)} starts={null} />;
  return null;
}

async function rugCard(db: Db, q: URLSearchParams): Promise<ReactElement | null> {
  const runId = q.get("run") ?? "";
  const run = await publicRun(db, runId);
  if (!run) return null;
  const found = await editionForRun(db, runId);
  if (!found) return null;
  return <RugCard headline={found.edition.headline} dek={found.edition.dek} night={found.night} date={day(run.submittedAt ?? run.issuedAt)} />;
}

export const CARD_KINDS = ["leaderboard", "market", "countdown", "rug"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** The queue's card for `kind` and its query, or null when the data isn't there. */
export async function queueCard(db: Db, kind: string, q: URLSearchParams): Promise<ReactElement | null> {
  const atParam = Date.parse(q.get("at") ?? "");
  const at = Number.isNaN(atParam) ? new Date() : new Date(atParam);
  switch (kind) {
    case "leaderboard":
      return boardCard(db, q);
    case "market":
      return marketCard(db, q, at);
    case "countdown":
      return countdownCard(db, q, at);
    case "rug":
      return rugCard(db, q);
    default:
      return null;
  }
}

/** Draws `element` as a 1200×630 PNG, in Neue Montreal where it's deployed. */
export async function renderCard(element: ReactElement, opts: { origin?: string | null; headers?: Record<string, string> } = {}): Promise<Response> {
  const fonts = await cardFonts(opts.origin ?? null);
  return new ImageResponse(element, { ...CARD_SIZE, ...(fonts.length ? { fonts } : {}), headers: opts.headers });
}
