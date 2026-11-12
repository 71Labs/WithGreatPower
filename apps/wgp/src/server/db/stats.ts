/**
 * The game's public numbers (GET /api/stats and the /stats page): counts only. Nothing
 * here selects a handle, an account id, an email, an X handle or a run id, so nothing
 * here can leak one.
 *
 * Definitions (the same ones the owner's launch script used against production):
 * - A match is a row in `runs`. Verified: the server replayed it and it matched
 *   (`status = 'verified'`). Rejected: the replay refused it. Unfinished: issued and never
 *   handed in (`issued` or `expired`).
 * - Modes are `runs.mode`, except a duel, which is stored as a trial on the course "duel".
 * - Hours: verified ticks at 60 a second.
 * - Match counts take every run. Player counts leave out banned players.
 * - City: outings and finished tasks from each save's `city` record.
 * - Referrals: invited is every unbanned player someone invited; qualified follows
 *   `scoreFriends` (src/server/db/referrals.ts): an X handle of their own, a verified run,
 *   neither side banned, and one count per referrer and handle.
 * - Reward mints: outbox rows sent through the contract's `mint_rewards`. Queued is every
 *   one ever queued; sent is those the chain took. One call carries up to 20 of them, so
 *   the chain shows fewer `mint_rewards` calls than mints sent.
 */
import { inArray, sql } from "drizzle-orm";

import { CHAPTER_IDS } from "@wgp/game-core/chapters";
import { TASK_DONE } from "@wgp/game-core/city";
import { DUEL_COURSE } from "@wgp/game-core/compete";

import { chainEnv } from "@/server/near/env";

import { queryRows, type Db } from "./client";
import { MINT_KINDS } from "./outbox";
import { chainOps, players, referralRewards, runs, saves } from "./schema";
import { defaultSeason } from "./seasons";

/** Ticks a second (game-core's fixed step). */
const TICK_HZ = 60;

/** The modes the response always lists, in the order the page draws them. */
export const STAT_MODES = ["patrol", "daily", "trial", DUEL_COURSE, ...CHAPTER_IDS] as const;

export interface ModeCount {
  started: number;
  verified: number;
}

export interface PublicStats {
  /** When these were counted. */
  at: string;
  /** When the first match was issued; null before there is one. */
  since: string | null;
  runs: {
    started: number;
    verified: number;
    rejected: number;
    unfinished: number;
    /** Hours of verified play, to one decimal. */
    hoursVerified: number;
    /** Every mode in STAT_MODES, plus any other mode a run carries. */
    byMode: Record<string, ModeCount>;
    /** Matches issued inside the current (or latest) season; null when no season exists. */
    season: ({ id: string } & ModeCount) | null;
    /** Matches issued since 00:00 UTC. */
    today: ModeCount;
  };
  players: { total: number; played: number; withVerifiedRun: number };
  city: { outings: number; players: number; tasksDone: number };
  referrals: { invited: number; qualified: number; rewards: number };
  chain: { network: "mainnet" | "testnet" | null; contractId: string | null; rewardMints: { queued: number; sent: number } };
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A count as an int. */
const count = (filter?: ReturnType<typeof sql>) => (filter ? sql<number>`(count(*) filter (where ${filter}))::int` : sql<number>`count(*)::int`);

/** The X handle as referrals compare it: trimmed, no leading @, lowercase; null when empty. */
const xOf = (alias: string) => sql.raw(`nullif(lower(regexp_replace(trim(coalesce(${alias}.x_handle, '')), '^@+', '')), '')`);

/** The chain the server is set up for, or nulls when it isn't (local play without NEAR). */
function chainTarget(env: Record<string, string | undefined>): Pick<PublicStats["chain"], "network" | "contractId"> {
  try {
    const { network, contractId } = chainEnv(env);
    return { network, contractId };
  } catch {
    return { network: null, contractId: null };
  }
}

export async function publicStats(db: Db, options: { now?: Date; env?: Record<string, string | undefined> } = {}): Promise<PublicStats> {
  const now = options.now ?? new Date();
  const season = await defaultSeason(db, now);
  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const verified = sql`${runs.status} = 'verified'`;
  const inSeason = season
    ? sql`${runs.issuedAt} >= ${season.startsAt.toISOString()}::timestamptz and ${runs.issuedAt} < ${season.endsAt.toISOString()}::timestamptz`
    : sql`false`;
  const today = sql`${runs.issuedAt} >= ${dayStart}::timestamptz`;
  // The constant is inlined: as a parameter, the SELECT and the GROUP BY would not match.
  const duel = sql.raw(`'${DUEL_COURSE}'`);
  const mode = sql<string>`case when ${runs.course} = ${duel} then ${duel} else ${runs.mode} end`;
  const cityOutings = sql`case when jsonb_typeof(${saves.state}->'city'->'outings') = 'number' then (${saves.state}->'city'->>'outings')::int else 0 end`;
  const cityTasks = sql`case when jsonb_typeof(${saves.state}->'city'->'tasks') = 'object'
    then (select count(*) from jsonb_each_text(${saves.state}->'city'->'tasks') as t where t.value = ${String(TASK_DONE)}) else 0 end`;

  const [[totals], modes, [people], [city], [friends], [rewards], [mints]] = await Promise.all([
    db
      .select({
        started: count(),
        verified: count(verified),
        rejected: count(sql`${runs.status} = 'rejected'`),
        unfinished: count(sql`${runs.status} in ('issued', 'expired')`),
        verifiedTicks: sql<string>`coalesce(sum(${runs.ticks}) filter (where ${verified}), 0)::bigint`,
        seasonStarted: count(inSeason),
        seasonVerified: count(sql`${verified} and ${inSeason}`),
        todayStarted: count(today),
        todayVerified: count(sql`${verified} and ${today}`),
        // As text in UTC, so both drivers answer the same thing.
        first: sql<string | null>`to_char(min(${runs.issuedAt}) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(runs),
    db.select({ mode, started: count(), verified: count(verified) }).from(runs).groupBy(mode),
    // Raw SQL: the subqueries need table-qualified columns, which a one-table Drizzle select drops.
    queryRows<{ total: number; played: number; with_verified: number }>(
      db,
      sql`select count(*)::int as total,
          (count(*) filter (where exists (select 1 from runs r where r.player_id = p.id)))::int as played,
          (count(*) filter (where exists (select 1 from runs r where r.player_id = p.id and r.status = 'verified')))::int as with_verified
        from players p where p.banned_at is null`,
    ),
    db
      .select({
        outings: sql<number>`coalesce(sum(${cityOutings}), 0)::int`,
        players: count(sql`${cityOutings} > 0 and ${players.bannedAt} is null`),
        tasksDone: sql<number>`coalesce(sum(${cityTasks}), 0)::int`,
      })
      .from(saves)
      .innerJoin(players, sql`${players.id} = ${saves.playerId}`),
    // Friends (f) and who invited them (r). Qualified counts one per referrer and X handle.
    queryRows<{ invited: number; qualified: number }>(
      db,
      sql`select count(*)::int as invited,
          (count(distinct (f.referred_by, ${xOf("f")})) filter (where
            r.banned_at is null
            and ${xOf("f")} is not null
            and ${xOf("f")} is distinct from ${xOf("r")}
            and exists (select 1 from runs v where v.player_id = f.id and v.status = 'verified')
          ))::int as qualified
        from players f join players r on r.id = f.referred_by
        where f.banned_at is null`,
    ),
    db.select({ rewards: count() }).from(referralRewards),
    db
      .select({ queued: count(), sent: count(sql`${chainOps.status} = 'sent'`) })
      .from(chainOps)
      .where(inArray(chainOps.kind, [...MINT_KINDS])),
  ]);

  const byMode: Record<string, ModeCount> = Object.fromEntries(STAT_MODES.map((id) => [id, { started: 0, verified: 0 }]));
  for (const row of modes) byMode[row.mode] = { started: n(row.started), verified: n(row.verified) };

  return {
    at: now.toISOString(),
    since: totals?.first ?? null,
    runs: {
      started: n(totals?.started),
      verified: n(totals?.verified),
      rejected: n(totals?.rejected),
      unfinished: n(totals?.unfinished),
      hoursVerified: Math.round((n(totals?.verifiedTicks) / TICK_HZ / 3600) * 10) / 10,
      byMode,
      season: season ? { id: season.id, started: n(totals?.seasonStarted), verified: n(totals?.seasonVerified) } : null,
      today: { started: n(totals?.todayStarted), verified: n(totals?.todayVerified) },
    },
    players: { total: n(people?.total), played: n(people?.played), withVerifiedRun: n(people?.with_verified) },
    city: { outings: n(city?.outings), players: n(city?.players), tasksDone: n(city?.tasksDone) },
    referrals: { invited: n(friends?.invited), qualified: n(friends?.qualified), rewards: n(rewards?.rewards) },
    chain: { ...chainTarget(options.env ?? process.env), rewardMints: { queued: n(mints?.queued), sent: n(mints?.sent) } },
  };
}
