/**
 * The Postgres schema (Neon in production, PGlite locally and in tests). The server is
 * authoritative for score and progression; the chain is authoritative for owned tokens,
 * mirrored here in `items_mirror`. Migrations are generated into apps/wgp/drizzle with
 * `drizzle-kit generate`; never edit a generated migration by hand.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
/**
 * "daily" and "trial" (migration 0007): the Daily Run's board (period: the UTC day) and the time
 * trials' (period: the course id). Neither feeds Tonight, Season or All time.
 */
export const boardKind = pgEnum("board_kind", ["tonight", "season", "alltime", "daily", "trial"]);
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
    /**
     * The player's X handle, without the @ (1–15 of A–Z, a–z, 0–9 and _). Self-reported and
     * unverified: nothing proves the account is theirs (src/server/social/players.ts).
     */
    xHandle: text("x_handle"),
    /** Opt-in to being tagged on X when they place on a board. Off by default; drafts use the in-game handle otherwise. */
    xTagOk: boolean("x_tag_ok").notNull().default(false),
    /**
     * The player's invite code (migration 0008): 7 of Crockford base32, uppercase, set the
     * first time they open their invite page (src/server/db/referrals.ts). Null until then.
     */
    referralCode: text("referral_code"),
    /** Who invited this player: set once, by the sign-in that created them carrying a code, or by a late claim. */
    referredBy: uuid("referred_by").references((): AnyPgColumn => players.id, { onDelete: "set null" }),
    referredAt: at("referred_at"),
  },
  (t) => [
    uniqueIndex("players_near_account_id_key").on(t.nearAccountId),
    uniqueIndex("players_auth_sub_key").on(t.authSub),
    index("players_email_idx").on(t.email),
    uniqueIndex("players_referral_code_key").on(t.referralCode),
    // A referrer's friends.
    index("players_referred_by_idx").on(t.referredBy).where(sql`referred_by IS NOT NULL`),
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
    /**
     * Competitive runs (migration 0007): the Daily Run's UTC day ("daily"), a time trial's course
     * id, or "duel" for a ranked night raced again ("trial"). Null for patrol nights and cases.
     */
    course: text("course"),
    /** The verified run this one raced as a ghost (a duel's, or a Daily or trial raced against someone), if any. */
    ghostRunId: uuid("ghost_run_id").references((): AnyPgColumn => runs.id, { onDelete: "set null" }),
  },
  (t) => [
    index("runs_player_status_idx").on(t.playerId, t.status),
    // Rivals: the ghosts a player has raced, newest first.
    index("runs_player_ghost_idx").on(t.playerId, t.ghostRunId).where(sql`ghost_run_id IS NOT NULL`),
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

/**
 * Seasons, seeded by migration. The background pass (src/server/db/season-close.ts) moves
 * one from scheduled to live when it starts and closes it, once, after it ends: the final
 * standings are frozen here with their Merkle root, and `record_season` is queued in the
 * outbox. Sending it (src/server/near/season-record.ts) sets `recorded`.
 */
export const seasons = pgTable("seasons", {
  /** "s1", "s2", … */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  startsAt: at("starts_at").notNull(),
  endsAt: at("ends_at").notNull(),
  status: seasonStatus("status").notNull().default("scheduled"),
  /** Merkle root of the final standings (src/server/near/season.ts), set at the close. */
  root: text("root"),
  /** The top 10 account ids, best first: who `record_season` gives `trophy:<season>:<rank>`. */
  top10: jsonb("top10"),
  /** sha256 of the published results file (GET /api/seasons/<id>/results). */
  digest: text("digest"),
  recordTx: text("record_tx"),
  recordedAt: at("recorded_at"),
  /** When the background pass froze the standings. */
  closedAt: at("closed_at"),
  /** The final standings, frozen at the close: the Season board's rows, best first (`SeasonStanding[]`). */
  standings: jsonb("standings"),
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

/* ------------------------------------------------------------------ social */

export const socialDraftStatus = pgEnum("social_draft_status", ["pending", "approved", "rejected", "posted", "expired"]);

/**
 * Drafted X posts waiting for the owner (src/server/social). Nothing here is ever posted
 * by the server: an admin approves a draft, opens it as an X intent link and posts it from
 * their own browser, then marks it posted. `source_event` names the fact a draft is about
 * ("tonight_top3:2026-11-04"), unique, so generating twice never drafts twice.
 */
export const socialDrafts = pgTable(
  "social_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "tonight_top3", "new_leader", "season_countdown", … (src/server/social/drafts.ts). */
    kind: text("kind").notNull(),
    /** The text as generated, from real data only. */
    text: text("text").notNull(),
    /** The admin's edit, if any; what gets posted when set. */
    editedText: text("edited_text"),
    /** The card image to attach, a path on this site. */
    mediaUrl: text("media_url"),
    /** A post this one replies to, if any. */
    replyTo: text("reply_to"),
    /** Every @mention and #hashtag in the text, at most three. */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    sourceEvent: text("source_event").notNull(),
    /** Where each number came from: `DraftSource[]` (run ids, tx links, price rows). */
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    status: socialDraftStatus("status").notNull().default("pending"),
    createdAt: at("created_at").notNull().defaultNow(),
    /** 24 hours after creation; a pending or approved draft past it is expired. */
    expiresAt: at("expires_at").notNull(),
    /** The admin's NEAR account that approved or rejected it. */
    decidedBy: text("decided_by"),
    decidedAt: at("decided_at"),
    postedAt: at("posted_at"),
  },
  (t) => [uniqueIndex("social_drafts_source_event_key").on(t.sourceEvent), index("social_drafts_created_idx").on(t.createdAt)],
);

/** Who did what to a draft, and when: one row per edit, approval, rejection or post. */
export const socialDraftLog = pgTable(
  "social_draft_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => socialDrafts.id, { onDelete: "cascade" }),
    at: at("at").notNull().defaultNow(),
    /** The admin's NEAR account id. */
    actor: text("actor").notNull(),
    /** "edit", "approve", "reject" or "posted". */
    action: text("action").notNull(),
    /** The status before and after, and the text when it changed. */
    detail: jsonb("detail"),
  },
  (t) => [index("social_draft_log_draft_idx").on(t.draftId, t.at)],
);

/* ------------------------------------------------------------------ referrals */

/**
 * The "Invite 3 friends" reward (src/server/db/referrals.ts): one row per player, ever, written
 * in the transaction that adds the XP to their save and queues the Recruiter badge. The primary
 * key is what makes the grant idempotent.
 */
export const referralRewards = pgTable("referral_rewards", {
  playerId: uuid("player_id")
    .primaryKey()
    .references(() => players.id, { onDelete: "cascade" }),
  /** Qualified friends it took (3). */
  goal: integer("goal").notNull(),
  /** The qualified friends' player ids when it was granted. */
  friends: jsonb("friends").notNull(),
  /** XP added to the save. */
  xp: integer("xp").notNull(),
  grantedAt: at("granted_at").notNull().defaultNow(),
});

export type Player = typeof players.$inferSelect;
export type SocialDraft = typeof socialDrafts.$inferSelect;
export type SocialDraftStatus = (typeof socialDraftStatus.enumValues)[number];
export type Run = typeof runs.$inferSelect;
export type ChainOp = typeof chainOps.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type Board = (typeof boardKind.enumValues)[number];
