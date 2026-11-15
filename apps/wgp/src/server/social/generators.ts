/**
 * Draft generators: each one looks at the database (and, for the dev log, the public
 * GitHub repo) and describes the posts it can back with real data. Every number in a
 * post comes from a row, and every draft lists the rows behind it (`sources`).
 *
 * A generator only describes; src/server/social/queue.ts writes. A plan's `sourceEvent`
 * names the fact it's about, and the queue stores at most one draft per fact, so running
 * the generators again (each admin visit, each verified run) drafts nothing twice.
 *
 * Times are UTC: Tonight resets at 00:00 UTC (01:00 in Lagos).
 */
import { and, asc, desc, eq, gt, gte, inArray, like, lt, lte, sql } from "drizzle-orm";

import { ITEMS } from "@wgp/game-core/data";
import type { Edition, ItemId, Save } from "@wgp/game-core/types";

import { formatPrice } from "@/components/market/sparkline";
import { EXPLORER_URL } from "@/lib/near/config";
import { REPO_URL, SITE_HOST } from "@/lib/site";
import { utcDay } from "@/server/rate-limit";

import type { Db } from "../db/client";
import { readChainMarket } from "../market/chain";
import { readSim } from "../market/sim";
import { ALLTIME_PERIOD, countEntries, topEntries, type BoardRow } from "../db/leaderboard";
import { TROPHY_PLACES, recordSeasonKey, type SeasonStanding } from "../db/season-close";
import { plural } from "@/lib/plural";

import { chainOps, marketPrices, runs, saves, seasons, socialDrafts, type Board } from "../db/schema";
import type { Tagger } from "./compose";
import { nameables, type Nameable } from "./players";

export const DRAFT_KINDS = ["tonight_top3", "new_leader", "season_standings", "season_countdown", "season_recap", "market_move", "daily_rug", "dev_log"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** One fact behind a draft: what it is, its value, and where to check it. */
export interface DraftSource {
  label: string;
  value: string;
  href?: string | null;
}

export interface DraftPlan {
  kind: DraftKind;
  /** The fact the draft is about; unique, so a second pass drafts nothing new. */
  sourceEvent: string;
  /** The card to attach: a path on this site (src/app/api/social/card). */
  mediaUrl: string | null;
  sources: DraftSource[];
  /** When the post stops being true, if that's sooner than 24 hours. */
  expiresAt?: Date;
  /** Season start and wrap posts may tag @NEARProtocol, if it's free today. */
  near?: boolean;
  /** The post's body. Players are named through the tagger, which applies the opt-in. */
  compose(t: Tagger): string;
}

export interface GenContext {
  db: Db;
  /**
   * The market's gas fee for market-move posts, in basis points. Left out, it is read live:
   * the contract's `fee_bps` when the prices are on chain, the simulated market's otherwise.
   * Null (or a failed read) leaves the number out of the post.
   */
  feeBps?: number | null;
  now: Date;
  /** Look up the dev log on GitHub (admin visits only; never on a player's request). */
  devLog?: boolean;
  fetch?: typeof fetch;
  /** "owner/repo"; defaults to the public repo in src/lib/site.ts. */
  repo?: string | null;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** A price move worth a post: more than this over 24 hours, either way. */
export const MARKET_MOVE = 0.15;

const points = new Intl.NumberFormat("en-US");
const fmt = (n: number) => points.format(n);
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
export const txUrl = (hash: string) => `${EXPLORER_URL}/txns/${hash}`;
const runLink = (runId: string) => `${SITE_HOST}/r/${runId}`;

/** A board's name as a post says it. */
function boardName(board: Board, seasonName: string | null): string {
  return board === "tonight" ? "Tonight" : board === "alltime" ? "All-time" : (seasonName ?? "Season");
}

function rowSources(rows: BoardRow[], label: (r: BoardRow) => string): DraftSource[] {
  return rows.map((r) => ({ label: label(r), value: `${fmt(r.score)} (${r.handle}, ${r.nearAccountId})`, href: r.runId ? `/r/${r.runId}` : null }));
}

const fallback = (people: Map<string, Nameable>, r: BoardRow): Nameable => people.get(r.playerId) ?? { playerId: r.playerId, handle: r.handle, xHandle: null, xTagOk: false };

/* ------------------------------------------------------------------ tonight's top 3 */

/** Tonight's top 3, for the board that closed at the last 00:00 UTC. */
export async function tonightTop3({ db, now }: GenContext): Promise<DraftPlan[]> {
  const day = utcDay(new Date(now.getTime() - DAY_MS));
  const rows = await topEntries(db, "tonight", day, 3);
  const lead = rows.find((r) => r.runId);
  if (!lead) return [];
  const people = await nameables(db, rows.map((r) => r.playerId));
  return [
    {
      kind: "tonight_top3",
      sourceEvent: `tonight_top3:${day}`,
      mediaUrl: `/api/social/card/leaderboard?board=tonight&period=${day}`,
      sources: [{ label: "Board", value: `Tonight, ${day} (closed 00:00 UTC)`, href: null }, ...rowSources(rows, (r) => `#${r.rank}`)],
      compose: (t) => {
        const lines = rows.map((r) => `${r.rank}. ${t.name(fallback(people, r))}: ${fmt(r.score)}`);
        const title = rows.length === 1 ? "Tonight’s #1" : `Tonight’s top ${rows.length}`;
        return `${title} in the city 🕸️\n${lines.join("\n")}\nEvery run is replay-verified: ${runLink(lead.runId!)}\nBeat them tonight → ${SITE_HOST}`;
      },
    },
  ];
}

/* ------------------------------------------------------------------ a new #1 */

/** "Tonight", "Tonight and All-time", "Tonight, Season 1 and All-time". */
const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * A shout-out to whoever holds #1 on Tonight, the live season or All time, once per
 * player per board and period. Only when they beat someone (two or more on the board)
 * and took it in the last 24 hours, so an old record doesn't read as news. One run that
 * tops several boards gets one shout-out naming them all; its source event joins each
 * board's key with "+", and a board already shouted out about is never drafted again.
 */
export async function newLeaders({ db, now }: GenContext): Promise<DraftPlan[]> {
  const drafted = new Set(
    (await db.select({ e: socialDrafts.sourceEvent }).from(socialDrafts).where(like(socialDrafts.sourceEvent, "new_leader:%"))).flatMap((r) => r.e.split("+")),
  );
  const [live] = await db
    .select({ id: seasons.id, name: seasons.name })
    .from(seasons)
    .where(and(lte(seasons.startsAt, now), gt(seasons.endsAt, now), inArray(seasons.status, ["scheduled", "live"])))
    .limit(1);
  const boards: { board: Board; period: string; name: string }[] = [
    { board: "tonight", period: utcDay(now), name: boardName("tonight", null) },
    ...(live ? [{ board: "season" as const, period: live.id, name: live.name }] : []),
    { board: "alltime", period: ALLTIME_PERIOD, name: boardName("alltime", null) },
  ];
  const groups = new Map<string, { top: BoardRow; score: number; night: number; keys: string[]; names: string[]; sources: DraftSource[] }>();
  for (const b of boards) {
    const [top] = await topEntries(db, b.board, b.period, 1);
    if (!top?.runId || now.getTime() - Date.parse(top.updatedAt) > DAY_MS) continue;
    const key = `new_leader:${b.board}:${b.period}:${top.playerId}`;
    if (drafted.has(key)) continue;
    const total = await countEntries(db, b.board, b.period);
    if (total < 2) continue;
    const [run] = await db
      .select({ score: runs.verifiedScore, night: runs.night })
      .from(runs)
      .where(and(eq(runs.id, top.runId), eq(runs.status, "verified")))
      .limit(1);
    if (run?.score == null) continue;
    const group = groups.get(`${top.playerId}:${top.runId}`) ?? { top, score: run.score, night: run.night, keys: [], names: [], sources: [] };
    group.keys.push(key);
    group.names.push(b.name);
    group.sources.push({ label: `#1 on ${b.name}`, value: `${b.period}, of ${plural(total, "hero", "heroes")}${b.board === "season" ? `, season total ${fmt(top.score)}` : ""}`, href: null });
    groups.set(`${top.playerId}:${top.runId}`, group);
  }
  const plans: DraftPlan[] = [];
  for (const g of groups.values()) {
    const runId = g.top.runId!;
    const person = fallback(await nameables(db, [g.top.playerId]), g.top);
    plans.push({
      kind: "new_leader",
      sourceEvent: g.keys.join("+"),
      mediaUrl: `/api/social/card/run/${runId}`,
      sources: [...g.sources, { label: "Run", value: `${fmt(g.score)}, night ${g.night}, by ${g.top.handle}`, href: `/r/${runId}` }],
      compose: (t) =>
        `Hey ${t.name(person)}, you just banked a ${fmt(g.score)} night and took #1 on the ${listed(g.names)} ${g.names.length > 1 ? "boards" : "board"}. Nothing for you to sign. ${runLink(runId)}`,
    });
  }
  return plans;
}

/* ------------------------------------------------------------------ seasons */

/**
 * Per season: "starts tomorrow" in the day before it opens; standings once at the
 * halfway mark; the countdown at 48 and 24 hours left; and the recap once its record
 * (and so its trophies) is on chain. Each expires when it stops being true.
 */
export async function seasonPosts({ db, now }: GenContext): Promise<DraftPlan[]> {
  const all = await db.select().from(seasons).orderBy(asc(seasons.startsAt));
  const plans: DraftPlan[] = [];
  const t = now.getTime();
  const trophies = `The top ${TROPHY_PLACES} get on-chain trophies.`;
  for (const s of all) {
    const start = s.startsAt.getTime();
    const end = s.endsAt.getTime();
    const open = s.status === "scheduled" || s.status === "live";
    const nights = Math.round((end - start) / DAY_MS);

    if (open && t >= start - DAY_MS && t < start) {
      plans.push({
        kind: "season_countdown",
        sourceEvent: `season_countdown:${s.id}:starts`,
        mediaUrl: `/api/social/card/countdown?season=${s.id}&at=${now.toISOString()}`,
        sources: [{ label: s.name, value: `${s.startsAt.toISOString()} to ${s.endsAt.toISOString()}`, href: "/api/seasons" }],
        expiresAt: s.startsAt,
        near: true,
        compose: () =>
          `${s.name} starts tomorrow, ${shortDate(s.startsAt)} at 00:00 UTC. ${plural(nights, "night")}; every night you finish adds to your total. ${trophies}\n${SITE_HOST}`,
      });
    }

    if (open && t >= start + (end - start) / 2 && t < end) {
      const rows = await topEntries(db, "season", s.id, 3);
      if (rows.length > 0) {
        const total = await countEntries(db, "season", s.id);
        const people = await nameables(db, rows.map((r) => r.playerId));
        const left = Math.ceil((end - t) / DAY_MS);
        plans.push({
          kind: "season_standings",
          sourceEvent: `season_standings:${s.id}:mid`,
          mediaUrl: `/api/social/card/leaderboard?board=season&period=${s.id}`,
          sources: [{ label: "Board", value: `${s.name}, ${plural(total, "hero", "heroes")}, ends ${s.endsAt.toISOString()}`, href: null }, ...rowSources(rows, (r) => `#${r.rank}`)],
          expiresAt: s.endsAt,
          compose: (tg) => {
            const lines = rows.map((r) => `${r.rank}. ${tg.name(fallback(people, r))}: ${fmt(r.score)}`);
            return `${s.name}, halfway 🕸️\n${lines.join("\n")}\n${fmt(total)} heroes on the board, ${left} ${left === 1 ? "night" : "nights"} left. ${trophies}\n${SITE_HOST}`;
          },
        });
      }
    }

    for (const mark of [48, 24] as const) {
      const from = end - mark * HOUR_MS;
      const until = mark === 48 ? end - 24 * HOUR_MS : end;
      if (!open || t < from || t >= until) continue;
      const hours = Math.ceil((end - t) / HOUR_MS);
      plans.push({
        kind: "season_countdown",
        sourceEvent: `season_countdown:${s.id}:${mark}h`,
        mediaUrl: `/api/social/card/countdown?season=${s.id}&at=${now.toISOString()}`,
        sources: [{ label: `${s.name} ends`, value: `${s.endsAt.toISOString()} (${hours}h after this draft)`, href: "/api/seasons" }],
        expiresAt: s.endsAt,
        compose: () => `${s.name} closes in ${hours}h. ${trophies}\n${SITE_HOST}`,
      });
    }

    if (s.status === "recorded") {
      const standings = ((s.standings ?? []) as SeasonStanding[]).slice(0, TROPHY_PLACES);
      if (standings.length === 0) continue;
      const [op] = await db.select({ txHash: chainOps.txHash }).from(chainOps).where(eq(chainOps.dedupeKey, recordSeasonKey(s.id))).limit(1);
      const tx = s.recordTx ?? op?.txHash ?? null;
      const people = await nameables(db, standings.map((r) => r.playerId));
      plans.push({
        kind: "season_recap",
        sourceEvent: `season_recap:${s.id}`,
        mediaUrl: `/api/social/card/leaderboard?board=season&period=${s.id}`,
        sources: [
          ...standings.map((r) => ({ label: `trophy:${s.id}:${r.rank}`, value: `${r.nearAccountId} (${fmt(r.score)})`, href: tx ? txUrl(tx) : null })),
          { label: "Final standings", value: s.digest ? `sha256 ${s.digest.slice(0, 12)}…` : "results file", href: `/api/seasons/${s.id}/results` },
        ],
        near: true,
        compose: (tg) => {
          const names = standings.map((r) => `${r.rank}. ${tg.name(fallback(people, r))}`).join(" · ");
          const proof = tx ? txUrl(tx) : `${SITE_HOST}/api/seasons/${s.id}/results`;
          return `${s.name} is final 🏆 The top ${standings.length} got their trophies on NEAR:\n${names}\n${proof}`;
        },
      });
    }
  }
  return plans;
}

/* ------------------------------------------------------------------ the market */

/**
 * An item whose price moved more than 15% over the last 24 hours, at most one post per
 * item per UTC day. Prices come from `market_prices` (the source the market uses now:
 * on chain once the contract's market is live, else the simulation), fills left out.
 */
/** The gas fee the market charges now, read where its prices come from; null when it can't be read. */
async function liveFeeBps(db: Db, onChain: boolean): Promise<number | null> {
  try {
    if (onChain) return (await readChainMarket())?.params.feeBps ?? null;
    return (await readSim(db)).book.params.feeBps;
  } catch (error) {
    console.error(`[social] couldn't read the market's fee: ${(error as Error).message}`);
    return null;
  }
}

/** "5% of every trade burns", or without a number when the fee couldn't be read. */
export const feeBurnText = (feeBps: number | null): string => (feeBps === null ? "a gas fee on every trade burns" : `${feeBps / 100}% of every trade burns`);

export async function marketMoves({ db, now, feeBps }: GenContext): Promise<DraftPlan[]> {
  const [latest] = await db.select({ onChain: marketPrices.onChain }).from(marketPrices).orderBy(desc(marketPrices.at)).limit(1);
  if (!latest) return [];
  const since = new Date(now.getTime() - DAY_MS);
  const window = await db
    .select()
    .from(marketPrices)
    .where(and(eq(marketPrices.onChain, latest.onChain), gte(marketPrices.at, since), lte(marketPrices.at, now), sql`${marketPrices.kind} <> 'fill'`))
    .orderBy(asc(marketPrices.at));
  const opening = await db
    .selectDistinctOn([marketPrices.item])
    .from(marketPrices)
    .where(and(eq(marketPrices.onChain, latest.onChain), lt(marketPrices.at, since), sql`${marketPrices.kind} <> 'fill'`))
    .orderBy(marketPrices.item, desc(marketPrices.at));
  const before = new Map(opening.map((r) => [r.item, r]));
  const fee = feeBurnText(feeBps !== undefined ? feeBps : await liveFeeBps(db, latest.onChain));
  const day = utcDay(now);
  const plans: DraftPlan[] = [];
  for (const item of [...new Set(window.map((r) => r.item))]) {
    if (!(item in ITEMS)) continue;
    const mine = window.filter((r) => r.item === item);
    const first = before.get(item) ?? mine[0]!;
    const last = mine[mine.length - 1]!;
    if (first.id === last.id || first.priceMilli <= 0) continue;
    const change = (last.priceMilli - first.priceMilli) / first.priceMilli;
    if (Math.abs(change) <= MARKET_MOVE) continue;
    const name = ITEMS[item as ItemId].name;
    const row = (label: string, r: typeof first): DraftSource => ({
      label,
      value: `${formatPrice(r.priceMilli)} Bits (${r.kind}, ${r.at.toISOString()}${r.onChain ? "" : ", simulated market"})`,
      href: r.txHash ? txUrl(r.txHash) : null,
    });
    plans.push({
      kind: "market_move",
      sourceEvent: `market_move:${item}:${day}`,
      mediaUrl: `/api/social/card/market?item=${encodeURIComponent(item)}&at=${now.toISOString()}`,
      sources: [row("Price 24h ago", first), row("Price now", last), { label: "Change", value: `${Math.round(change * 100)}% over ${mine.length} rows`, href: null }],
      compose: () => `${name} at Gwei’s stall: ${formatPrice(first.priceMilli)} → ${formatPrice(last.priceMilli)} Bits today. Players move the prices; ${fee}.`,
    });
  }
  return plans;
}

/* ------------------------------------------------------------------ The Daily Rug */

/** The edition The Daily Rug wrote about a run's night, from the player's save. */
export async function editionForRun(db: Db, runId: string): Promise<{ edition: Edition; heroName: string | null; night: number; playerId: string } | null> {
  const [row] = await db
    .select({ night: runs.night, playerId: runs.playerId, state: saves.state })
    .from(runs)
    .innerJoin(saves, eq(saves.playerId, runs.playerId))
    .where(and(eq(runs.id, runId), eq(runs.status, "verified")))
    .limit(1);
  if (!row) return null;
  const save = row.state as Save;
  const edition = save.editions?.find((e) => e.night === row.night);
  return edition ? { edition, heroName: save.hero?.name ?? null, night: row.night, playerId: row.playerId } : null;
}

/** The front page Bearson wrote for last night's #1 (the board that closed at 00:00 UTC). */
export async function dailyRug({ db, now }: GenContext): Promise<DraftPlan[]> {
  const day = utcDay(new Date(now.getTime() - DAY_MS));
  const [top] = await topEntries(db, "tonight", day, 1);
  if (!top?.runId) return [];
  const found = await editionForRun(db, top.runId);
  if (!found) return [];
  const runId = top.runId;
  return [
    {
      kind: "daily_rug",
      sourceEvent: `daily_rug:${day}`,
      mediaUrl: `/api/social/card/rug?run=${runId}`,
      sources: [
        { label: "Edition", value: `Night ${found.night}, ${found.heroName ?? top.handle}’s patrol`, href: `/r/${runId}` },
        { label: "Board", value: `#1 on Tonight, ${day}`, href: null },
      ],
      compose: () => `THE DAILY RUG: “${found.edition.headline}” by J. Jonah Bearson.\n${runLink(runId)}`,
    },
  ];
}

/* ------------------------------------------------------------------ dev log */

const repoOf = (url: string) => /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null;

/** "feat(social): share buttons" → "share buttons". */
const subject = (title: string) => title.replace(/^\w+(?:\([^)]*\))?!?:\s*/, "").trim();

/**
 * The last merged pull requests on main, from the public GitHub API without a token.
 * Skipped (no draft) if the repo isn't public or GitHub doesn't answer within 3 seconds.
 */
export async function devLog({ devLog: enabled, fetch: fetchImpl = fetch, repo }: GenContext): Promise<DraftPlan[]> {
  const name = repo === undefined ? repoOf(REPO_URL) : repo;
  if (!enabled || !name) return [];
  let commits: { sha: string; commit: { message: string } }[];
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${name}/commits?sha=main&per_page=30`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "wgp-social-queue" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    commits = (await res.json()) as typeof commits;
  } catch {
    return [];
  }
  const merged = commits
    .map((c) => {
      const [head = "", , ...rest] = c.commit.message.split("\n");
      const pr = /^Merge pull request #(\d+) from /.exec(head);
      const title = subject(rest.join(" ").trim());
      return pr && title ? { sha: c.sha, pr: Number(pr[1]), title } : null;
    })
    .filter((m): m is { sha: string; pr: number; title: string } => !!m)
    .slice(0, 3);
  if (merged.length === 0) return [];
  return [
    {
      kind: "dev_log",
      sourceEvent: `dev_log:${merged[0]!.sha}`,
      mediaUrl: null,
      sources: merged.map((m) => ({ label: `PR #${m.pr}`, value: m.title, href: `https://github.com/${name}/pull/${m.pr}` })),
      compose: () => `Dev log 🛠️ just shipped:\n${merged.map((m) => `- ${m.title}`).join("\n")}\nPlay it → ${SITE_HOST}`,
    },
  ];
}

export const GENERATORS = { tonightTop3, newLeaders, seasonPosts, marketMoves, dailyRug, devLog } as const;
