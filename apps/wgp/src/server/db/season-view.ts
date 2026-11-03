/**
 * What the Season tab shows about a season (pure; board-view.ts loads the inputs): its
 * phase, when it freezes, the trophies, and once closed, the frozen board and where its
 * on-chain record stands.
 */
import type { BoardRow } from "./leaderboard";
import { TROPHY_PLACES, freezesAt, type SeasonStanding } from "./season-close";
import type { ChainOp, Season } from "./schema";

/**
 * - upcoming: before the start.
 * - live: the board moves with every verified night.
 * - closing: ended; runs started before the end can still land until the freeze.
 * - final: closed; the standings are frozen.
 */
export type SeasonPhase = "upcoming" | "live" | "closing" | "final";

/**
 * Where the on-chain record stands, after the close:
 * - empty: nobody finished a ranked night, so there's nothing to record.
 * - queued: waiting for the game contract to go live on NEAR (or for the operator key).
 * - sending: the contract is live; the next background pass sends it.
 * - recorded: on chain, trophies minted.
 * - stuck: set aside for an operator (src/server/near/season-record.ts).
 */
export type RecordState = "empty" | "queued" | "sending" | "recorded" | "stuck";

export interface SeasonRecordView {
  state: RecordState;
  root: string | null;
  digest: string | null;
  /** The `record_season` transaction, once sent by us (null if it was recorded by hand). */
  txHash: string | null;
  recordedAt: string | null;
}

export interface SeasonView {
  id: string;
  name: string;
  startsAt: string;
  /** Exclusive: the season's last moment is just before it. */
  endsAt: string;
  phase: SeasonPhase;
  /** When the standings freeze: the end, plus time for runs started before it to be submitted. */
  freezesAt: string;
  closedAt: string | null;
  /** How many top places `record_season` gives a trophy. */
  trophies: number;
  /** Whether the game contract answers on NEAR; null when that couldn't be checked. */
  contractLive: boolean | null;
  /** Null until the close. */
  record: SeasonRecordView | null;
}

export type SeasonRow = Pick<Season, "id" | "name" | "startsAt" | "endsAt" | "status" | "root" | "digest" | "recordTx" | "recordedAt" | "closedAt">;
export type RecordOp = Pick<ChainOp, "status" | "error" | "txHash">;

export function seasonPhase(s: Pick<Season, "startsAt" | "endsAt" | "status">, now: Date): SeasonPhase {
  if (s.status === "closed" || s.status === "recorded") return "final";
  if (now < s.startsAt) return "upcoming";
  if (now < s.endsAt) return "live";
  return "closing";
}

export function recordState(input: { players: number; season: Pick<Season, "status" | "recordTx">; op: RecordOp | null; contractLive: boolean | null; canSend: boolean }): RecordState {
  if (input.players === 0) return "empty";
  if (input.season.status === "recorded" || input.op?.status === "sent") return "recorded";
  if (input.op?.status === "dead") return "stuck";
  return input.contractLive === true && input.canSend ? "sending" : "queued";
}

export function seasonView(input: {
  season: SeasonRow;
  /** Players in the frozen standings (ignored before the close). */
  players: number;
  op: RecordOp | null;
  contractLive: boolean | null;
  canSend: boolean;
  now: Date;
}): SeasonView {
  const { season: s, now } = input;
  const phase = seasonPhase(s, now);
  return {
    id: s.id,
    name: s.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    phase,
    freezesAt: freezesAt(s).toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    trophies: TROPHY_PLACES,
    contractLive: input.contractLive,
    record:
      phase === "final"
        ? {
            state: recordState({ players: input.players, season: s, op: input.op, contractLive: input.contractLive, canSend: input.canSend }),
            root: s.root,
            digest: s.digest,
            txHash: s.recordTx ?? input.op?.txHash ?? null,
            recordedAt: s.recordedAt?.toISOString() ?? null,
          }
        : null,
  };
}

/** A page of the frozen standings plus the viewer's row and neighbours, shaped like a live board read. */
export function frozenBoard(
  standings: SeasonStanding[],
  viewerId: string | null,
  pageSize: number,
  radius = 2,
): { rows: BoardRow[]; total: number; me: BoardRow | null; around: BoardRow[] } {
  const at = viewerId ? standings.findIndex((r) => r.playerId === viewerId) : -1;
  return {
    rows: standings.slice(0, pageSize),
    total: standings.length,
    me: at >= 0 ? standings[at]! : null,
    around: at >= 0 ? standings.slice(Math.max(0, at - radius), at + radius + 1) : [],
  };
}
