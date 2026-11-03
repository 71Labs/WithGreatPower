/**
 * Sends a closed season's `record_season` (queued by src/server/db/season-close.ts) with
 * the operator key. The call records the root, digest and top 10 once, forever, and mints
 * `trophy:<season>:<rank>` to each of the top 10. Runs inside the mint job
 * (src/server/background.ts), so only when the operator can send at all.
 *
 * Per queued row, oldest first:
 * 1. Claim it (pending → sending), so two workers never send it twice.
 * 2. Read `get_season`. No contract to read (not deployed yet, or an older one): hand the
 *    row back, held, and look again in HOLD_MS. The season is already on chain (recorded
 *    by hand with scripts/near/record-season.ts, or a send whose answer was lost): done if
 *    the root matches ours, set aside for an operator if it doesn't.
 * 3. Re-key the standings: a player who claimed a NEAR name after the close
 *    (src/server/db/move-account.ts) gets their trophy on the new account, so the leaves,
 *    root, digest and top 10 are rebuilt from the players' current accounts. Nothing is on
 *    chain yet, so the published root may still change.
 * 4. Send. Success stores the tx hash on the row and the season and marks it recorded; a
 *    failure backs off, and the sweep requeues it (dead after OUTBOX_MAX_ATTEMPTS).
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { AccountDoesNotExistError, ContractCodeDoesNotExistError, ContractMethodNotFoundError } from "near-api-js/rpc-errors";

import { isAccountId } from "@/lib/near/policy";
import { viewFunction } from "@/lib/near/rpc";
import type { Db } from "@/server/db/client";
import { claimChainOp, rewardRetryMs } from "@/server/db/outbox";
import { RECORD_SEASON_KIND, TROPHY_PLACES, seasonLeaves, type SeasonStanding } from "@/server/db/season-close";
import { chainOps, players, seasons, type ChainOp } from "@/server/db/schema";

import { chainEnv, NearConfigError } from "./env";
import { recordSeason, type SeasonRecord } from "./operator";
import { provider } from "./rpc";
import { commitSeason } from "./season";

/** The contract's `get_season` answer. */
export interface OnChainSeason {
  root: string;
  top10: string[];
  digest: string;
  recorded_at_ms: number;
}

export type ReadSeason = (seasonId: string) => Promise<OnChainSeason | null>;
export type SendRecord = (record: SeasonRecord) => Promise<{ txHash: string }>;

/** How long a held record waits before the contract is asked again. */
export const HOLD_MS = 5 * 60_000;
/** The error a held row carries, which the season view reads as "queued until the contract is live". */
export const HELD_ERROR = "held: the game contract isn't live yet";

/** True when the error means there is no game contract to call (not configured, not deployed, too old). */
export function isContractMissing(error: unknown): boolean {
  if (
    error instanceof NearConfigError ||
    error instanceof AccountDoesNotExistError ||
    error instanceof ContractCodeDoesNotExistError ||
    error instanceof ContractMethodNotFoundError
  ) {
    return true;
  }
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /does not exist|doesn't exist|MethodNotFound|CodeDoesNotExist|method .* not found/i.test(text);
}

/** Reads a season from the game contract: null if it isn't recorded, throws if there's no contract. */
export const readSeasonOnChain: ReadSeason = (seasonId) =>
  viewFunction<OnChainSeason | null>(provider(), chainEnv().contractId, "get_season", { season_id: seasonId });

const HEX32 = /^[0-9a-f]{64}$/;
const SEASON_ID = /^[a-z0-9-]{1,16}$/;

/** Throws on anything `record_season` would refuse, so a doomed call is never paid for. */
export function checkRecord(r: SeasonRecord): void {
  if (!SEASON_ID.test(r.seasonId)) throw new Error(`Season id ${r.seasonId} isn't 1-16 of a-z, 0-9 and -`);
  if (!HEX32.test(r.root) || !HEX32.test(r.digest)) throw new Error("root and digest must be 64 lowercase hex characters");
  if (r.top10.length < 1 || r.top10.length > TROPHY_PLACES) throw new Error(`top10 holds 1 to ${TROPHY_PLACES} accounts`);
  if (new Set(r.top10).size !== r.top10.length) throw new Error("An account appears twice in top10");
  for (const a of r.top10) if (!isAccountId(a)) throw new Error(`${a} isn't a NEAR account id`);
}

export interface SeasonRecordReport {
  /** Rows claimed this pass. */
  claimed: number;
  /** Handed back because the contract isn't live yet. */
  held: number;
  /** Season ids recorded by this pass, with their tx hashes. */
  recorded: { seasonId: string; txHash: string }[];
  /** Season ids found already on chain with our root, and settled. */
  alreadyOnChain: string[];
  failed: number;
  /** Set aside for an operator: malformed, nothing to record, or a different root on chain. */
  dead: number;
}

async function holdOp(db: Db, id: string, now: Date): Promise<void> {
  await db
    .update(chainOps)
    .set({ status: "pending", attempts: sql`${chainOps.attempts} - 1`, error: HELD_ERROR, nextAttemptAt: new Date(now.getTime() + HOLD_MS), updatedAt: now })
    .where(and(eq(chainOps.id, id), eq(chainOps.status, "sending")));
}

async function buryOp(db: Db, id: string, error: string, now: Date): Promise<void> {
  await db
    .update(chainOps)
    .set({ status: "dead", error: error.slice(0, 500), updatedAt: now })
    .where(and(eq(chainOps.id, id), eq(chainOps.status, "sending")));
}

async function failOp(db: Db, op: ChainOp, error: unknown, now: Date): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(chainOps)
    .set({ status: "failed", error: message.slice(0, 500), nextAttemptAt: new Date(now.getTime() + rewardRetryMs(op.attempts + 1)), updatedAt: now })
    .where(and(eq(chainOps.id, op.id), eq(chainOps.status, "sending")));
}

/** Marks the row sent and the season recorded, in one transaction. `txHash` is null when we didn't send it. */
async function settleRecorded(db: Db, op: ChainOp, record: SeasonRecord, txHash: string | null, recordedAt: Date, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(chainOps)
      .set({ status: "sent", txHash, error: null, payload: { ...record }, updatedAt: now })
      .where(and(eq(chainOps.id, op.id), eq(chainOps.status, "sending")));
    await tx.update(seasons).set({ status: "recorded", recordTx: txHash, recordedAt }).where(eq(seasons.id, record.seasonId));
  });
}

/**
 * The record to send, from the season row, with every standing re-keyed to its player's
 * current account (see the file comment). Updates the row and the outbox payload when
 * anything moved. Null when the season has nothing to record.
 */
export async function currentRecord(db: Db, seasonId: string, now = new Date()): Promise<SeasonRecord | null> {
  return db.transaction(async (tx) => {
    const [season] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for("update");
    const standings = (season?.standings ?? []) as SeasonStanding[];
    if (!season || standings.length === 0 || !season.root || !season.digest) return null;

    const ids = standings.map((s) => s.playerId);
    const current = await tx.select({ id: players.id, accountId: players.nearAccountId, handle: players.handle }).from(players).where(inArray(players.id, ids));
    const byId = new Map(current.map((p) => [p.id, p]));
    let moved = false;
    const rekeyed = standings.map((s) => {
      const p = byId.get(s.playerId);
      if (!p || p.accountId === s.nearAccountId) return s;
      moved = true;
      return { ...s, nearAccountId: p.accountId, handle: p.handle };
    });
    if (!moved) return { seasonId, root: season.root, digest: season.digest, top10: (season.top10 ?? []) as string[] };

    const c = commitSeason(seasonId, seasonLeaves(rekeyed));
    await tx.update(seasons).set({ standings: rekeyed, root: c.root, digest: c.digest, top10: c.top10 }).where(eq(seasons.id, seasonId));
    await tx
      .update(chainOps)
      .set({ payload: { seasonId, root: c.root, digest: c.digest, top10: c.top10 }, updatedAt: now })
      .where(and(eq(chainOps.kind, RECORD_SEASON_KIND), sql`${chainOps.payload}->>'seasonId' = ${seasonId}`, sql`${chainOps.status} <> 'sent'`));
    return { seasonId, root: c.root, digest: c.digest, top10: c.top10 };
  });
}

/**
 * Sends every due `record_season` row (see the file comment). `read` and `send` default
 * to the contract and the operator; tests pass a fake chain.
 */
export async function sendSeasonRecords(
  db: Db,
  opts: { read?: ReadSeason; send?: SendRecord; clock?: () => Date; limit?: number } = {},
): Promise<SeasonRecordReport> {
  const read = opts.read ?? readSeasonOnChain;
  const send = opts.send ?? recordSeason;
  const clock = opts.clock ?? (() => new Date());
  const report: SeasonRecordReport = { claimed: 0, held: 0, recorded: [], alreadyOnChain: [], failed: 0, dead: 0 };

  const now = clock();
  const due = await db
    .select()
    .from(chainOps)
    .where(and(eq(chainOps.kind, RECORD_SEASON_KIND), eq(chainOps.status, "pending"), lte(chainOps.nextAttemptAt, now)))
    .orderBy(asc(chainOps.createdAt))
    .limit(opts.limit ?? 5);

  for (const op of due) {
    if (!(await claimChainOp(db, op.id, now))) continue;
    report.claimed += 1;
    const seasonId = String((op.payload as { seasonId?: unknown }).seasonId ?? "");
    try {
      let onChain: OnChainSeason | null;
      try {
        onChain = await read(seasonId);
      } catch (error) {
        if (!isContractMissing(error)) throw error;
        await holdOp(db, op.id, now);
        report.held += 1;
        continue;
      }

      if (onChain) {
        const [season] = await db.select({ root: seasons.root, digest: seasons.digest, top10: seasons.top10 }).from(seasons).where(eq(seasons.id, seasonId));
        if (season?.root && season.root === onChain.root) {
          const record = { seasonId, root: season.root, digest: season.digest ?? onChain.digest, top10: (season.top10 ?? onChain.top10) as string[] };
          await settleRecorded(db, op, record, null, new Date(onChain.recorded_at_ms), now);
          report.alreadyOnChain.push(seasonId);
        } else {
          await buryOp(db, op.id, `already recorded on chain with root ${onChain.root}, not ours (${season?.root ?? "none"})`, now);
          report.dead += 1;
        }
        continue;
      }

      const record = await currentRecord(db, seasonId, now);
      if (!record) {
        await buryOp(db, op.id, "nothing to record: the season has no standings", now);
        report.dead += 1;
        continue;
      }
      try {
        checkRecord(record);
      } catch (error) {
        await buryOp(db, op.id, `malformed: ${(error as Error).message}`, now);
        report.dead += 1;
        continue;
      }

      const { txHash } = await send(record);
      const sentAt = clock();
      await settleRecorded(db, op, record, txHash, sentAt, sentAt);
      report.recorded.push({ seasonId, txHash });
    } catch (error) {
      await failOp(db, op, error, clock());
      report.failed += 1;
    }
  }
  return report;
}
