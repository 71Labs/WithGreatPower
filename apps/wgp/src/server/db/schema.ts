/**
 * The Postgres schema (Neon in production, PGlite locally and in tests). The server is
 * authoritative for score and progression; the chain is authoritative for owned tokens,
 * mirrored here in `items_mirror`. Migrations are generated into apps/wgp/drizzle with
 * `drizzle-kit generate`; never edit a generated migration by hand.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Raw bytes. PGlite hands back a Uint8Array and Neon a Buffer (also a Uint8Array). */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | string }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => {
    if (typeof value === "string") {
      // Text-format bytea ("\x0a1b…"), in case a driver skips binary parsing.
      return new Uint8Array(Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex"));
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  },
});

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/* ------------------------------------------------------------------ enums */

export const authKind = pgEnum("auth_kind", ["near_auth", "wallet", "dev", "privy"]);
export const runStatus = pgEnum("run_status", ["issued", "verified", "rejected", "expired"]);
export const boardKind = pgEnum("board_kind", ["tonight", "season", "alltime"]);
export const chainOpStatus = pgEnum("chain_op_status", ["pending", "sending", "sent", "failed", "dead"]);
export const seasonStatus = pgEnum("season_status", ["scheduled", "live", "closed", "recorded"]);

/* ------------------------------------------------------------------ accounts */

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nearAccountId: text("near_account_id").notNull(),
    authKind: authKind("auth_kind").notNull(),
    /**
     * The identity provider's subject: the Google sub (NEAR Auth), the Privy user id
     * ("did:privy:…"), "wallet:<account>" or "dev:<handle>".
     */
    authSub: text("auth_sub"),
    handle: text("handle").notNull(),
    /**
     * The player's verified email (lowercased), from Google through Privy or NEAR Auth.
     * Not unique: a sign-in with another provider finds the oldest player holding it, so
     * switching providers keeps the hero (src/server/db/players.ts, `playerByEmail`).
     */
    email: text("email"),
    createdAt: at("created_at").notNull().defaultNow(),
    bannedAt: at("banned_at"),
    /** Set once, when a guest's local save was imported. */
    migratedLocalAt: at("migrated_local_at"),
    /**
     * The reward nonce the next queued mint takes. The contract applies a mint only when
     * its nonce is exactly the account's last one + 1, so nonces are handed out here, one
     * by one, inside the transaction that queues the mint (src/server/db/outbox.ts).
     */
    nextRewardNonce: integer("next_reward_nonce").notNull().default(1),
  },
  (t) => [
    uniqueIndex("players_near_account_id_key").on(t.nearAccountId),
    uniqueIndex("players_auth_sub_key").on(t.authSub),
    index("players_email_idx").on(t.email),
  ],
);

/** Cookie sessions. Only a SHA-256 of the cookie value is stored. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    idHash: text("id_hash").primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: at("created_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
    ua: text("ua"),
    /** HMAC of the client IP, so sessions can be grouped without storing addresses. */
    ipHash: text("ip_hash"),
  },
  (t) => [index("auth_sessions_player_idx").on(t.playerId), index("auth_sessions_expires_idx").on(t.expiresAt)],
);

/**
 * Single-use, short-lived values the server hands out and later takes back once, e.g.
 * the OIDC nonce a NEAR Auth sign-in must carry. Only a SHA-256 of the value is stored.
 */
export const authNonces = pgTable(
  "auth_nonces",
  {
    idHash: text("id_hash").primaryKey(),
    /** What the value may be redeemed for ("near-auth"), so one kind never stands in for another. */
    purpose: text("purpose").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("auth_nonces_expires_idx").on(t.expiresAt)],
);

/** Function-call access keys on a player's NEAR account, limited to the game contract. Chain owns the flow. */
export const sessionKeys = pgTable(
  "session_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicKey: text("public_key").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    deviceLabel: text("device_label"),
    /** The transaction that added the key. */
    addTx: text("add_tx"),
    createdAt: at("created_at").notNull().defaultNow(),
    revokedAt: at("revoked_at"),
    lastUsedAt: at("last_used_at"),
  },
  (t) => [uniqueIndex("session_keys_public_key_key").on(t.publicKey), index("session_keys_player_idx").on(t.playerId)],
);

/* ------------------------------------------------------------------ progression */

/** The authoritative `Save` (game-core rules/types.ts), with a revision for optimistic concurrency. */
export const saves = pgTable("saves", {
  playerId: uuid("player_id")
    .primaryKey()
    .references(() => players.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull(),
  rev: integer("rev").notNull().default(0),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("patrol"),
    night: integer("night").notNull(),
    /** HMAC(SEED_SECRET, id) as a uint32. */
    seed: bigint("seed", { mode: "number" }).notNull(),
    ruleset: text("ruleset").notNull(),
    saveRevAtStart: integer("save_rev_at_start").notNull(),
    /** The save at issue time (before start-patrol), so anyone can replay the run. */
    startSave: jsonb("start_save").notNull(),
    status: runStatus("status").notNull().default("issued"),
    issuedAt: at("issued_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
    submittedAt: at("submitted_at"),
    inputLog: bytea("input_log"),
    logBytes: integer("log_bytes"),
    ticks: integer("ticks"),
    clientHash: text("client_hash"),
    verifiedScore: integer("verified_score"),
    stats: jsonb("stats"),
    checkpoints: jsonb("checkpoints"),
    /** SHA-256 over the run's inputs and result; goes into the reward mint's event log. */
    digest: text("digest"),
    rejectReason: text("reject_reason"),
    /** Slow-motion assist: verified and saved, but kept off the boards. */
    assist: boolean("assist").notNull().default(false),
  },
  (t) => [
    index("runs_player_status_idx").on(t.playerId, t.status),
    index("runs_status_expires_idx").on(t.status, t.expiresAt),
    // At most one run in flight per player, enforced by the database.
    uniqueIndex("runs_one_issued_per_player").on(t.playerId).where(sql`status = 'issued'`),
  ],
);

/**
 * One row per board, period and player. `period_key` is a UTC date (tonight), a season
 * id (season) or "all" (alltime). Ties rank by fewer ticks, then whoever got there first.
 */
export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    board: boardKind("board").notNull(),
    periodKey: text("period_key").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    bestScore: integer("best_score").notNull(),
    /** Ticks of the best run (tonight, alltime) or the sum over nightly bests (season). */
    ticks: integer("ticks").notNull().default(0),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.board, t.periodKey, t.playerId] }),
    index("leaderboard_rank_idx").on(t.board, t.periodKey, t.bestScore.desc(), t.ticks, t.updatedAt),
  ],
);

export const seasons = pgTable("seasons", {
  /** "s1", "s2", … */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  startsAt: at("starts_at").notNull(),
  endsAt: at("ends_at").notNull(),
  status: seasonStatus("status").notNull().default("scheduled"),
  /** Merkle root of the final standings, once recorded on chain. */
  root: text("root"),
  top10: jsonb("top10"),
  digest: text("digest"),
  recordTx: text("record_tx"),
  recordedAt: at("recorded_at"),
});

/* ------------------------------------------------------------------ chain */

/** What the chain says each account owns (NEP-245 balances), refreshed by Chain's indexer. */
export const itemsMirror = pgTable(
  "items_mirror",
  {
    accountId: text("account_id").notNull(),
    tokenId: text("token_id").notNull(),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    playerId: uuid("player_id").references(() => players.id, { onDelete: "set null" }),
    blockHeight: bigint("block_height", { mode: "number" }),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.tokenId] }), index("items_mirror_player_idx").on(t.playerId)],
);

/**
 * The outbox: chain work queued inside the same transaction as the state change that
 * causes it. Chain's worker claims `pending` rows; the sweep cron re-queues failures.
 */
export const chainOps = pgTable(
  "chain_ops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "mint_reward", "mint_import", … */
    kind: text("kind").notNull(),
    /** Unique per logical operation ("mint_reward:<runId>"), so a retry never queues twice. */
    dedupeKey: text("dedupe_key").notNull(),
    playerId: uuid("player_id").references(() => players.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull(),
    /**
     * Mints only: the player's reward nonce for this mint, fixed when it was queued. A
     * resend always carries the same nonce, so the contract answers "duplicate" instead
     * of minting twice.
     */
    rewardNonce: integer("reward_nonce"),
    status: chainOpStatus("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    nextAttemptAt: at("next_attempt_at").notNull().defaultNow(),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chain_ops_dedupe_key").on(t.dedupeKey),
    index("chain_ops_status_next_idx").on(t.status, t.nextAttemptAt),
    // One mint per nonce per player, enforced by the database.
    uniqueIndex("chain_ops_player_reward_nonce").on(t.playerId, t.rewardNonce).where(sql`reward_nonce IS NOT NULL`),
  ],
);

/** Durable counters for anything that costs money or CPU (ranked runs a day, mints, gas). */
export const budgetCounters = pgTable(
  "budget_counters",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    /** The window, e.g. a UTC date. */
    period: text("period").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key, t.period] })],
);

/* ------------------------------------------------------------------ the Mempool Market */

/**
 * Price history for charts, the 24 h change and The Daily Rug: one row per trade the
 * server saw (relayed on chain, or simulated) and periodic snapshots of every pool
 * (src/server/market/history.ts). Prices are the vendor's spot price × 1000 after it.
 */
export const marketPrices = pgTable(
  "market_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    item: text("item").notNull(),
    at: at("at").notNull().defaultNow(),
    /** "trade" (vendor buy or sell), "fill" (a listing bought) or "snapshot". */
    kind: text("kind").notNull(),
    /** False for the simulated market that runs before the contract is live. */
    onChain: boolean("on_chain").notNull(),
    priceMilli: bigint("price_milli", { mode: "number" }).notNull(),
    stock: integer("stock").notNull(),
    /** The vendor's till for this item. */
    till: bigint("till", { mode: "number" }).notNull(),
    side: text("side"),
    amount: integer("amount"),
    /** Bits the trade moved (paid with the fee, received after it, or a listing's price). */
    bits: bigint("bits", { mode: "number" }),
    fee: bigint("fee", { mode: "number" }),
    accountId: text("account_id"),
    txHash: text("tx_hash"),
  },
  (t) => [index("market_prices_item_at_idx").on(t.item, t.at), index("market_prices_at_idx").on(t.at)],
);

/**
 * The simulated market (src/server/market/sim.ts): the same book the contract keeps
 * (pools, listings, daily counters) plus each account's Bits moved by simulated trades.
 * One row, locked per trade. Used only until the contract's market is live.
 */
export const marketSim = pgTable("market_sim", {
  id: text("id").primaryKey(),
  state: jsonb("state").notNull(),
  rev: integer("rev").notNull().default(0),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

export type Player = typeof players.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type ChainOp = typeof chainOps.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type Board = (typeof boardKind.enumValues)[number];
