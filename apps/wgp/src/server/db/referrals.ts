/**
 * Referrals and the "Invite 3 friends" reward (docs/referrals.md).
 *
 * - Codes: every player can have one invite code, 7 of Crockford base32 (no I, L, O or U),
 *   made the first time they open their invite page. A typed code is read case-insensitively,
 *   with Crockford's look-alikes taken as digits (I and L as 1, O as 0).
 * - Linking: `players.referred_by` is set once, ever: by the sign-in that created the player
 *   (src/server/auth/referral.ts), or by a late claim in their first 48 hours.
 * - Counting: a friend counts ("qualified") once they added an X handle (a new one: not the
 *   referrer's own, and two friends with the same handle count once) and have at least one
 *   verified run, any mode, with neither of them banned.
 * - The reward: at 3 qualified friends, once ever, one transaction inserts `referral_rewards`,
 *   adds 300 XP to the referrer's save (bumping `rev`, as every server save change does) and
 *   queues the soulbound Recruiter badge (`trophy:badge:recruiter`) through `mint_rewards`.
 *   The table's primary key and the outbox key `badge:recruiter:<playerId>` make it once.
 *
 * A grant waits while the referrer has a run in flight: that run replays from the save it
 * started with and is written back only if the save hasn't moved, so adding XP under it would
 * void the run (actions.ts and mirror.ts refuse save changes then for the same reason). It also
 * waits for a hero to put the XP on. Every trigger re-evaluates (src/server/background.ts), and
 * so does the referrer opening their invite page, so a held grant goes through on the next one.
 *
 * The game never pays money: any payout to referrers is the owner's, by hand, from the admin
 * list (`adminReferrals`). The referrer sees their friends' game handles only, never a friend's
 * X handle or NEAR account.
 */
import { randomBytes } from "node:crypto";

import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { HP_PER_LEVEL, POWERS, XP_TO_NEXT } from "@wgp/game-core/data";
import type { Hero, Save } from "@wgp/game-core/types";

import { SITE_URL } from "@/lib/site";
import { HttpError, conflict, unauthorized } from "@/server/http";

import type { Db } from "./client";
import { enqueueRewardMint, sha256Hex } from "./outbox";
import { ensureSave, getPlayer } from "./players";
import { SUBMIT_GRACE_MS } from "./runs";
import { chainOps, players, referralRewards, runs, saves, type Player } from "./schema";

/** Qualified friends it takes. */
export const REFERRAL_GOAL = 3;
/** XP the reward adds to the referrer's save. */
export const REFERRAL_XP = 300;
/** The badge id `mint_rewards` takes; minted as `trophy:badge:recruiter`. */
export const RECRUITER_BADGE = "recruiter";
export const RECRUITER_TOKEN_ID = `trophy:badge:${RECRUITER_BADGE}`;
/** How long after sign-up a player may still add who invited them. */
export const CLAIM_WINDOW_MS = 48 * 60 * 60_000;
/** Admin review: qualified friends of one referrer who signed up this close together. */
export const CLOSE_SIGNUPS_MS = 10 * 60_000;
/** The most friends GET /api/referrals lists. */
export const INVITED_LIST_MAX = 100;

/** The outbox key of a player's Recruiter badge: one per player, ever. */
export const recruiterBadgeKey = (playerId: string) => `badge:${RECRUITER_BADGE}:${playerId}`;

/* ------------------------------------------------------------------ codes */

/** Crockford's base32: digits and letters without I, L, O and U. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 7;
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{7}$/;

/** A fresh random code. 256 is a multiple of 32, so each byte's low 5 bits are uniform. */
export function newReferralCode(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i]! & 31];
  return code;
}

/**
 * A code as typed or linked, the way it's stored: trimmed, uppercased, spaces and dashes
 * dropped, and Crockford's look-alikes read as the digits they stand for (I and L as 1, O as
 * 0). Null for anything that can't be a code. Pure.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  const code = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return CODE_RE.test(code) ? code : null;
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** The player's invite code, made (once) on first ask. A clash with another player's code just draws again. */
export async function ensureReferralCode(db: Db, playerId: string, random?: (size: number) => Uint8Array): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const [row] = await db.select({ code: players.referralCode }).from(players).where(eq(players.id, playerId)).limit(1);
    if (!row) throw new Error(`No player ${playerId}`);
    if (row.code) return row.code;
    try {
      const [set] = await db
        .update(players)
        .set({ referralCode: newReferralCode(random) })
        .where(and(eq(players.id, playerId), isNull(players.referralCode)))
        .returning({ code: players.referralCode });
      if (set?.code) return set.code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error(`Couldn't give ${playerId} an invite code`);
}

/** Whose code this is (banned players included; callers decide), or null. */
export async function playerByCode(db: Db, raw: unknown): Promise<Player | null> {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  const [row] = await db.select().from(players).where(eq(players.referralCode, code)).limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ linking */

export type AttachOutcome =
  | { attached: true; referrerId: string }
  | { attached: false; reason: "not_new" | "bad_code" | "banned" | "self" | "cycle" | "already" };

/**
 * Links a player to whoever owns `code`, but only when the sign-in that calls this created the
 * player (`created`): an existing player is never re-attached. Also refused for an unknown
 * code, a banned referrer, the player's own code and a referrer the player invited.
 */
export async function attachReferral(db: Db, input: { playerId: string; code: unknown; created: boolean; now?: Date }): Promise<AttachOutcome> {
  if (!input.created) return { attached: false, reason: "not_new" };
  const referrer = await playerByCode(db, input.code);
  if (!referrer) return { attached: false, reason: "bad_code" };
  if (referrer.bannedAt) return { attached: false, reason: "banned" };
  if (referrer.id === input.playerId) return { attached: false, reason: "self" };
  if (referrer.referredBy === input.playerId) return { attached: false, reason: "cycle" };
  const rows = await db
    .update(players)
    .set({ referredBy: referrer.id, referredAt: input.now ?? new Date() })
    .where(and(eq(players.id, input.playerId), isNull(players.referredBy)))
    .returning({ id: players.id });
  return rows.length > 0 ? { attached: true, referrerId: referrer.id } : { attached: false, reason: "already" };
}

const refused = (code: "bad_code" | "self" | "too_late" | "cycle", message: string) => new HttpError(422, code, message);
const alreadyReferred = () => conflict("already_referred", "You’re already in a friend’s crew.");

/**
 * A late claim: a player who signed up without the link names who invited them. Allowed once,
 * in the first 48 hours, never with their own code, and never back to someone they invited.
 * Throws 409 already_referred or 422 too_late | bad_code | self | cycle.
 */
export async function claimReferral(db: Db, input: { playerId: string; code: unknown; now?: Date }): Promise<{ referrerId: string; handle: string }> {
  const now = input.now ?? new Date();
  const player = await getPlayer(db, input.playerId);
  if (!player) throw unauthorized();
  if (player.referredBy) throw alreadyReferred();
  if (now.getTime() - player.createdAt.getTime() > CLAIM_WINDOW_MS) throw refused("too_late", "Invite codes can only be added in your first 48 hours.");
  const referrer = await playerByCode(db, input.code);
  if (!referrer || referrer.bannedAt) throw refused("bad_code", "That invite code doesn’t match anyone. Check it and try again.");
  if (referrer.id === player.id) throw refused("self", "That’s your own code. Send it to a friend instead.");

  // Both rows locked in id order, so two players claiming each other's codes at once can't both win.
  return db.transaction(async (tx) => {
    const rows = new Map<string, { referredBy: string | null }>();
    for (const id of [player.id, referrer.id].sort()) {
      const [row] = await tx.select({ referredBy: players.referredBy }).from(players).where(eq(players.id, id)).for("update");
      if (row) rows.set(id, row);
    }
    if (rows.get(player.id)?.referredBy) throw alreadyReferred();
    if (rows.get(referrer.id)?.referredBy === player.id) throw refused("cycle", "You invited them, so they can’t be your inviter too.");
    await tx.update(players).set({ referredBy: referrer.id, referredAt: now }).where(eq(players.id, player.id));
    return { referrerId: referrer.id, handle: referrer.handle };
  });
}

/* ------------------------------------------------------------------ counting */

/** An X handle as handles are compared: trimmed, lowercased, without a leading @. Null when empty. Pure. */
export function normalizedX(handle: string | null | undefined): string | null {
  const h = (handle ?? "").trim().replace(/^@+/, "").toLowerCase();
  return h || null;
}

/** A referred player, as counting needs them. */
export interface FriendRow {
  id: string;
  handle: string;
  xHandle: string | null;
  nearAccountId: string;
  bannedAt: Date | null;
  createdAt: Date;
  referredAt: Date | null;
  /** Their verified runs, any mode. */
  verifiedRuns: number;
}

/** Why a friend doesn't count (yet), or null when they do. */
export type NotCounted = "referrer_banned" | "banned" | "no_x" | "no_run" | "own_x" | "same_x";

export interface ScoredFriend extends FriendRow {
  /** X handle added. */
  x: boolean;
  /** At least one verified run. */
  played: boolean;
  qualified: boolean;
  why: NotCounted | null;
}

const joinedAt = (f: Pick<FriendRow, "referredAt" | "createdAt">) => (f.referredAt ?? f.createdAt).getTime();

/**
 * Which of a referrer's friends count, in the order they joined. A friend counts with an X
 * handle and a verified run, neither of them banned; a handle equal to the referrer's own
 * doesn't count, and two friends with the same handle count once (whoever joined first). Pure.
 */
export function scoreFriends(referrer: Pick<Player, "xHandle" | "bannedAt">, friends: FriendRow[]): { friends: ScoredFriend[]; qualified: string[] } {
  const own = normalizedX(referrer.xHandle);
  const seen = new Set<string>();
  const ordered = [...friends].sort((a, b) => joinedAt(a) - joinedAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const scored = ordered.map((f): ScoredFriend => {
    const handle = normalizedX(f.xHandle);
    const x = handle !== null;
    const played = f.verifiedRuns > 0;
    const why: NotCounted | null = referrer.bannedAt
      ? "referrer_banned"
      : f.bannedAt
        ? "banned"
        : !handle
          ? "no_x"
          : !played
            ? "no_run"
            : handle === own
              ? "own_x"
              : seen.has(handle)
                ? "same_x"
                : null;
    if (!why) seen.add(handle!);
    return { ...f, x, played, qualified: !why, why };
  });
  return { friends: scored, qualified: scored.filter((f) => f.qualified).map((f) => f.id) };
}

// Spelled with table names: in a one-table select, drizzle writes a bare column name, which inside
// this subquery would bind to `runs`.
const verifiedRuns = sql<number>`(select count(*) from ${runs} where ${runs}."player_id" = ${players}."id" and ${runs}."status" = 'verified')`.mapWith(Number);

/** The players these referrers invited, with their verified run counts. */
async function friendRows(db: Db, referrerIds: string[]): Promise<(FriendRow & { referredBy: string })[]> {
  if (referrerIds.length === 0) return [];
  const rows = await db
    .select({
      id: players.id,
      handle: players.handle,
      xHandle: players.xHandle,
      nearAccountId: players.nearAccountId,
      bannedAt: players.bannedAt,
      createdAt: players.createdAt,
      referredAt: players.referredAt,
      referredBy: players.referredBy,
      verifiedRuns,
    })
    .from(players)
    .where(referrerIds.length === 1 ? eq(players.referredBy, referrerIds[0]!) : inArray(players.referredBy, referrerIds))
    .orderBy(asc(players.referredAt), asc(players.id));
  return rows.map((r) => ({ ...r, referredBy: r.referredBy! }));
}

/** A referrer's friends, scored. */
export async function friendsOf(db: Db, referrer: Pick<Player, "id" | "xHandle" | "bannedAt">) {
  return scoreFriends(referrer, await friendRows(db, [referrer.id]));
}

/* ------------------------------------------------------------------ the reward */

/** XP on the hero, levelling up as a night, a case clear or an outing does (game-core's rule). Pure. */
export function addXp(hero: Hero, xp: number): Hero {
  let h: Hero = { ...hero, xp: hero.xp + xp };
  const owned = Object.keys(h.powers).length;
  const total = Object.keys(POWERS).length;
  while (h.xp >= XP_TO_NEXT(h.level)) {
    h = { ...h, xp: h.xp - XP_TO_NEXT(h.level), level: h.level + 1, maxHp: h.maxHp + HP_PER_LEVEL };
    if (owned + h.pendingPicks < total) h = { ...h, pendingPicks: h.pendingPicks + 1 };
  }
  return h;
}

export type GrantOutcome =
  /** `granted`: this call granted it (false: it had been granted before). */
  | { state: "granted"; granted: boolean; rev?: number }
  /** Held back: a run in flight (its save mustn't move) or no hero to put the XP on. */
  | { state: "deferred"; granted: false; reason: "run_active" | "no_hero" };

/**
 * Grants the reward, once ever: the `referral_rewards` row, the XP in the save (rev + 1) and the
 * badge in the outbox, in one transaction. The save row is locked first, so concurrent grants
 * for one referrer line up, and the insert's ON CONFLICT DO NOTHING decides who adds the XP.
 */
export async function grantRecruiter(db: Db, referrer: Pick<Player, "id" | "nearAccountId">, friendIds: string[], now = new Date()): Promise<GrantOutcome> {
  return db.transaction(async (tx): Promise<GrantOutcome> => {
    await ensureSave(tx, referrer.id);
    const [row] = await tx.select({ state: saves.state, rev: saves.rev }).from(saves).where(eq(saves.playerId, referrer.id)).for("update");
    const [done] = await tx.select({ playerId: referralRewards.playerId }).from(referralRewards).where(eq(referralRewards.playerId, referrer.id)).limit(1);
    if (done) return { state: "granted", granted: false };
    const save = row!.state as Save;
    if (!save.hero) return { state: "deferred", granted: false, reason: "no_hero" };
    const [inFlight] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.playerId, referrer.id), eq(runs.status, "issued"), gt(runs.expiresAt, new Date(now.getTime() - SUBMIT_GRACE_MS))))
      .limit(1);
    if (inFlight) return { state: "deferred", granted: false, reason: "run_active" };

    const won = await tx
      .insert(referralRewards)
      .values({ playerId: referrer.id, goal: REFERRAL_GOAL, friends: friendIds, xp: REFERRAL_XP, grantedAt: now })
      .onConflictDoNothing({ target: referralRewards.playerId })
      .returning({ playerId: referralRewards.playerId });
    if (won.length === 0) return { state: "granted", granted: false };

    const hero = addXp(save.hero, REFERRAL_XP);
    const [written] = await tx
      .update(saves)
      .set({ state: { ...save, hero } satisfies Save, rev: row!.rev + 1, updatedAt: now })
      .where(and(eq(saves.playerId, referrer.id), eq(saves.rev, row!.rev)))
      .returning({ rev: saves.rev });
    if (!written) throw new Error(`The save of ${referrer.id} moved under its lock`);

    const digest = sha256Hex(["wgp-referral-v1", referrer.id, ...[...friendIds].sort()].join("|"));
    await enqueueRewardMint(
      tx,
      {
        kind: "mint_reward",
        dedupeKey: recruiterBadgeKey(referrer.id),
        playerId: referrer.id,
        payload: { playerId: referrer.id, accountId: referrer.nearAccountId, items: [], badges: [RECRUITER_BADGE], ...(hero.level > save.hero.level ? { level: hero.level } : {}), digest },
      },
      now,
    );
    return { state: "granted", granted: true, rev: written.rev };
  });
}

export type Evaluation = (GrantOutcome | { state: "locked"; granted: false }) & { qualified: number };

/** Counts a referrer's friends and grants the reward when they reach the goal. Idempotent. */
export async function evaluateReferrer(db: Db, referrerId: string, now = new Date()): Promise<Evaluation> {
  const [done] = await db.select({ friends: referralRewards.friends }).from(referralRewards).where(eq(referralRewards.playerId, referrerId)).limit(1);
  if (done) return { state: "granted", granted: false, qualified: (done.friends as string[]).length };
  const referrer = await getPlayer(db, referrerId);
  if (!referrer || referrer.bannedAt) return { state: "locked", granted: false, qualified: 0 };
  const { qualified } = await friendsOf(db, referrer);
  if (qualified.length < REFERRAL_GOAL) return { state: "locked", granted: false, qualified: qualified.length };
  return { ...(await grantRecruiter(db, referrer, qualified, now)), qualified: qualified.length };
}

/**
 * What the background triggers run (src/server/background.ts): `friend` did something that may
 * make them count (a verified run, an X handle), so their referrer is evaluated; `referrer` is
 * evaluated as is (named by a claim, or their own run just ended and may free a held grant).
 * Returns whether anything was granted.
 */
export async function evaluateReferrals(db: Db, input: { friend?: string; referrer?: string }, now = new Date()): Promise<boolean> {
  const ids = new Set<string>();
  if (input.referrer) ids.add(input.referrer);
  if (input.friend) {
    const [row] = await db.select({ referredBy: players.referredBy }).from(players).where(eq(players.id, input.friend)).limit(1);
    if (row?.referredBy) ids.add(row.referredBy);
  }
  let granted = false;
  for (const id of ids) granted = (await evaluateReferrer(db, id, now)).granted || granted;
  return granted;
}

/* ------------------------------------------------------------------ views */

/** locked: not earned. queued: earned (XP added), the badge waits in the outbox. minted: the badge is on chain (`tx`). granted: earned, no badge row (not expected). */
export type RewardState = "locked" | "granted" | "queued" | "minted";

export interface RewardView {
  state: RewardState;
  xp: number;
  badge: typeof RECRUITER_BADGE;
  /** The badge mint's transaction, once minted. */
  tx: string | null;
  grantedAt: string | null;
}

async function rewardView(db: Db, playerId: string): Promise<RewardView> {
  const [row] = await db.select({ grantedAt: referralRewards.grantedAt, xp: referralRewards.xp }).from(referralRewards).where(eq(referralRewards.playerId, playerId)).limit(1);
  if (!row) return { state: "locked", xp: REFERRAL_XP, badge: RECRUITER_BADGE, tx: null, grantedAt: null };
  const [op] = await db.select({ status: chainOps.status, txHash: chainOps.txHash }).from(chainOps).where(eq(chainOps.dedupeKey, recruiterBadgeKey(playerId))).limit(1);
  const state: RewardState = !op ? "granted" : op.status === "sent" ? "minted" : "queued";
  return { state, xp: row.xp, badge: RECRUITER_BADGE, tx: state === "minted" ? (op?.txHash ?? null) : null, grantedAt: row.grantedAt.toISOString() };
}

/** One invited friend, as the referrer sees them: their game handle only. */
export interface InvitedFriend {
  handle: string;
  joinedAt: string;
  x: boolean;
  played: boolean;
  qualified: boolean;
}

/** GET /api/referrals. */
export interface ReferralView {
  code: string;
  link: string;
  goal: number;
  /** Qualified friends now (may pass the goal). */
  qualified: number;
  invited: InvitedFriend[];
  reward: Omit<RewardView, "grantedAt">;
  /** The game handle of whoever invited this player, or null. */
  referredBy: string | null;
  /** A late claim is open: no inviter yet, and the account is under 48 hours old. */
  canClaim: boolean;
  /**
   * This player's own steps as their inviter's friend (the friend side's Tonight checklist), by
   * the same rules that count them: X added, a verified run, and whether they count. Null
   * without an inviter.
   */
  self: FriendSelf | null;
}

/** A referred player's own progress toward their inviter's 3. */
export interface FriendSelf {
  x: boolean;
  played: boolean;
  qualified: boolean;
}

/** The invite link for a code on a site (an origin, no trailing slash). */
export const inviteLink = (origin: string, code: string) => `${origin.replace(/\/+$/, "")}/invite/${code}`;

const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * The site an invite link points at: the request's origin, so local and preview builds link to
 * themselves, else NEXT_PUBLIC_SITE_URL. The Host header (as the platform forwards it) wins over
 * the request URL, which Next's dev server spells "localhost" whatever the browser used. Only the
 * caller ever sees the link, so a forged Host only fools its sender. Pure.
 */
export function inviteOrigin(request: Pick<Request, "url" | "headers">): string {
  let url: URL | null = null;
  try {
    url = new URL(request.url);
  } catch {
    // Not a URL: the headers or the site's.
  }
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0]!.trim();
  const proto = (request.headers.get("x-forwarded-proto") ?? url?.protocol.replace(/:$/, "") ?? "").split(",")[0]!.trim();
  if (HOST_RE.test(host) && (proto === "https" || proto === "http")) return `${proto}://${host.toLowerCase()}`;
  if (url && (url.protocol === "https:" || url.protocol === "http:")) return url.origin;
  return SITE_URL;
}

/**
 * The signed-in player's invite page: their code (made now if they had none), link, friends and
 * reward. Reaching the goal grants the reward here too, so a grant held back earlier goes
 * through when the referrer looks. `granted`: this read granted it.
 */
export async function referralView(db: Db, playerId: string, opts: { origin: string; now?: Date }): Promise<{ view: ReferralView; granted: boolean }> {
  const now = opts.now ?? new Date();
  const player = await getPlayer(db, playerId);
  if (!player) throw unauthorized();
  const code = await ensureReferralCode(db, playerId);
  const { friends, qualified } = await friendsOf(db, player);
  let granted = false;
  let reward = await rewardView(db, playerId);
  if (reward.state === "locked" && qualified.length >= REFERRAL_GOAL && !player.bannedAt) {
    const out = await grantRecruiter(db, player, qualified, now);
    granted = out.granted;
    if (out.state === "granted") reward = await rewardView(db, playerId);
  }
  const inviter = player.referredBy ? await getPlayer(db, player.referredBy) : null;
  // Scored among the inviter's friends, so a shared or the inviter's own X handle reads as it counts.
  const mine = inviter ? (await friendsOf(db, inviter)).friends.find((f) => f.id === playerId) : undefined;
  return {
    granted,
    view: {
      code,
      link: inviteLink(opts.origin, code),
      goal: REFERRAL_GOAL,
      qualified: qualified.length,
      invited: friends.slice(0, INVITED_LIST_MAX).map((f) => ({ handle: f.handle, joinedAt: new Date(joinedAt(f)).toISOString(), x: f.x, played: f.played, qualified: f.qualified })),
      reward: { state: reward.state, xp: reward.xp, badge: reward.badge, tx: reward.tx },
      referredBy: inviter?.handle ?? null,
      canClaim: !player.referredBy && !player.bannedAt && now.getTime() - player.createdAt.getTime() <= CLAIM_WINDOW_MS,
      self: mine ? { x: mine.x, played: mine.played, qualified: mine.qualified } : null,
    },
  };
}

/** GET /api/invite/:code. Banned referrers' codes are invalid. */
export interface InviteView {
  valid: boolean;
  referrer: { handle: string; heroName: string | null; suit: string | null } | null;
}

export async function inviteView(db: Db, raw: unknown): Promise<InviteView> {
  const referrer = await playerByCode(db, raw);
  if (!referrer || referrer.bannedAt) return { valid: false, referrer: null };
  // A public read: look at the save, never create one.
  const [row] = await db.select({ state: saves.state }).from(saves).where(eq(saves.playerId, referrer.id)).limit(1);
  const hero = (row?.state as Save | undefined)?.hero ?? null;
  return { valid: true, referrer: { handle: referrer.handle, heroName: hero?.name ?? null, suit: hero?.suit ?? null } };
}

/* ------------------------------------------------------------------ admin */

/**
 * What the owner should look at before paying anyone:
 * - close_signups: this friend signed up within 10 minutes of another qualified friend of the same referrer;
 * - shared_x: another player has this friend's X handle too;
 * - one_run: this friend has exactly one verified run.
 */
export type ReviewFlag = "close_signups" | "shared_x" | "one_run";

export interface AdminFriend {
  playerId: string;
  handle: string;
  xHandle: string | null;
  nearAccountId: string;
  verifiedRuns: number;
  joinedAt: string;
  createdAt: string;
  flags: ReviewFlag[];
}

export interface AdminReferrer {
  playerId: string;
  handle: string;
  nearAccountId: string;
  xHandle: string | null;
  banned: boolean;
  qualified: number;
  /** Their qualified friends, in the order they joined. */
  friends: AdminFriend[];
  reward: RewardView;
  /** Every flag on any of their friends. */
  flags: ReviewFlag[];
}

/** Review flags for one referrer's qualified friends. `sharedX`: normalized handles more than one player holds. Pure. */
export function reviewFlags(friends: Pick<FriendRow, "id" | "createdAt" | "xHandle" | "verifiedRuns">[], sharedX: Set<string>): Map<string, ReviewFlag[]> {
  const out = new Map<string, ReviewFlag[]>();
  for (const f of friends) {
    const flags: ReviewFlag[] = [];
    if (friends.some((o) => o.id !== f.id && Math.abs(o.createdAt.getTime() - f.createdAt.getTime()) < CLOSE_SIGNUPS_MS)) flags.push("close_signups");
    const x = normalizedX(f.xHandle);
    if (x && sharedX.has(x)) flags.push("shared_x");
    if (f.verifiedRuns === 1) flags.push("one_run");
    out.set(f.id, flags);
  }
  return out;
}

/** Referrers with at least one qualified friend, most qualified first, for /admin/referrals and its CSV. */
export async function adminReferrals(db: Db): Promise<AdminReferrer[]> {
  const referred = await db
    .selectDistinct({ referrer: players.referredBy })
    .from(players)
    .where(isNotNull(players.referredBy));
  const ids = referred.map((r) => r.referrer!).filter(Boolean);
  if (ids.length === 0) return [];
  const [referrers, friends, shared] = await Promise.all([
    db.select().from(players).where(inArray(players.id, ids)),
    friendRows(db, ids),
    db
      .select({ x: sql<string>`lower(${players.xHandle})` })
      .from(players)
      .where(isNotNull(players.xHandle))
      .groupBy(sql`lower(${players.xHandle})`)
      .having(sql`count(*) > 1`),
  ]);
  const sharedX = new Set(shared.map((s) => s.x));
  const out: AdminReferrer[] = [];
  for (const r of referrers) {
    const scored = scoreFriends(r, friends.filter((f) => f.referredBy === r.id));
    const counted = scored.friends.filter((f) => f.qualified);
    if (counted.length === 0) continue;
    const flags = reviewFlags(counted, sharedX);
    const rows: AdminFriend[] = counted.map((f) => ({
      playerId: f.id,
      handle: f.handle,
      xHandle: f.xHandle,
      nearAccountId: f.nearAccountId,
      verifiedRuns: f.verifiedRuns,
      joinedAt: new Date(joinedAt(f)).toISOString(),
      createdAt: f.createdAt.toISOString(),
      flags: flags.get(f.id) ?? [],
    }));
    out.push({
      playerId: r.id,
      handle: r.handle,
      nearAccountId: r.nearAccountId,
      xHandle: r.xHandle,
      banned: !!r.bannedAt,
      qualified: counted.length,
      friends: rows,
      reward: await rewardView(db, r.id),
      flags: [...new Set(rows.flatMap((f) => f.flags))],
    });
  }
  return out.sort(
    (a, b) =>
      b.qualified - a.qualified ||
      (a.reward.grantedAt ?? "￿").localeCompare(b.reward.grantedAt ?? "￿") ||
      a.handle.localeCompare(b.handle),
  );
}

/** A CSV cell: quoted when needed, and never read as a formula by a spreadsheet. Pure. */
function cell(value: string | number | boolean | null): string {
  let s = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "referrer_handle",
  "referrer_near_account",
  "referrer_x",
  "qualified",
  "reward_state",
  "reward_granted_at",
  "badge_tx",
  "friend_handle",
  "friend_x",
  "friend_near_account",
  "friend_verified_runs",
  "friend_joined_at",
  "friend_flags",
] as const;

/** One row per qualified friend, the referrer's columns repeated, for the owner's payout sheet. Pure. */
export function referralsCsv(rows: AdminReferrer[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    for (const f of r.friends) {
      lines.push(
        [
          r.handle,
          r.nearAccountId,
          r.xHandle,
          r.qualified,
          r.reward.state,
          r.reward.grantedAt,
          r.reward.tx,
          f.handle,
          f.xHandle,
          f.nearAccountId,
          f.verifiedRuns,
          f.joinedAt,
          f.flags.join(" "),
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}
