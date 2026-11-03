/**
 * Who a verified Privy login is, and what to make for them. The route
 * (src/app/api/auth/privy) verifies the token and passes the identity Privy returned;
 * this decides, given the account factory (or null while it's closed):
 *
 * - a known player (`authSub` = the Privy user id) is signed in;
 * - a player who signed up with another Google service (NEAR Auth) under the same
 *   verified email is signed in too, so switching services never makes a second hero;
 * - a new player, factory open: `needs-handle`, then `<handle>.<parent>` is created with
 *   their Privy NEAR key (full access) and this browser's session key (game only);
 * - a new player, factory closed: they play now on their key's implicit account id and
 *   claim `<handle>.<parent>` later (`claimName`).
 */
import { isUnclaimed } from "@/lib/near/policy";
import type { Db } from "@/server/db/client";
import { movePlayerAccount } from "@/server/db/move-account";
import { findOrCreatePlayer, findPlayerForLogin, rememberEmail } from "@/server/db/players";
import type { Player } from "@/server/db/schema";
import { HttpError, badRequest, conflict } from "@/server/http";
import { HandleError, normalizeHandle, playerAccountId, suggestHandle, type AccountKeys } from "@/server/near/factory";
import { addSessionKey, liveSessionKeys } from "@/server/near/session-keys";

import { PrivyAuthError, type PrivyIdentity } from "./privy";

/** The account factory, as sign-up needs it. The route passes null while it's closed. */
export interface AccountFactory {
  /** Player accounts are `<handle>.<parentId>`. */
  parentId: string;
  /** null when the account doesn't exist; else which of the keys it holds. Read-only. */
  inspect(accountId: string, keys: { userPublicKey: string; sessionPublicKey?: string }): Promise<AccountKeys | null>;
  /** One transaction: `<handle>.<parent>` with the user's key (full access) and the session key (game only). */
  create(input: { handle: string; userPublicKey: string; sessionPublicKey: string }): Promise<{ accountId: string; txHash: string }>;
}

export type PrivySignIn =
  | { kind: "needs-handle"; suggestedHandle?: string; parentId: string }
  | {
      kind: "signed-in";
      player: Player;
      /** This sign-in made the player. */
      created: boolean;
      /** The account-creation transaction, when one was sent. */
      txHash: string | null;
      /** This browser's session key can play now. */
      sessionKeyLive: boolean;
      /** Found by verified email: the player signed up with another Google service. */
      linked: boolean;
    };

/** What an unclaimed player is called until they claim a name: the start of their key. */
export const unclaimedHandle = (implicitAccountId: string) => `hero-${implicitAccountId.slice(0, 6)}`;

const assertNotBanned = (player: Player) => {
  if (player.bannedAt) throw new HttpError(403, "banned", "This account is suspended");
};

/**
 * `<handle>.<parent>` for the user: created, or, when it already exists holding the
 * user's own key, adopted (a retry after an earlier attempt landed on chain but not in
 * our database). Held by anyone else, it's taken.
 */
async function createOrAdopt(
  factory: AccountFactory,
  input: { handle: string; userPublicKey: string; sessionPublicKey: string },
): Promise<{ accountId: string; txHash: string | null; sessionKeyLive: boolean }> {
  const accountId = playerAccountId(input.handle, factory.parentId);
  const adopt = async () => {
    const keys = await factory.inspect(accountId, { userPublicKey: input.userPublicKey, sessionPublicKey: input.sessionPublicKey });
    if (!keys) return null;
    if (!keys.userKey) throw new HandleError("handle_taken", "That handle is taken");
    return { accountId, txHash: null, sessionKeyLive: keys.sessionKey };
  };
  const existing = await adopt();
  if (existing) return existing;
  try {
    const created = await factory.create(input);
    return { accountId: created.accountId, txHash: created.txHash, sessionKeyLive: true };
  } catch (error) {
    if (error instanceof HandleError && error.code === "handle_taken") {
      const raced = await adopt();
      if (raced) return raced;
    }
    throw error;
  }
}

/** Asked only when a new player needs an account; null while the factory isn't live. */
export type FactoryLookup = () => Promise<AccountFactory | null>;

export async function privySignIn(
  db: Db,
  input: { identity: PrivyIdentity; handle?: string; sessionPublicKey?: string },
  deps: { factory: FactoryLookup },
): Promise<PrivySignIn> {
  const { identity } = input;

  const found = await findPlayerForLogin(db, { authSub: identity.userId, email: identity.email });
  if (found) {
    assertNotBanned(found.player);
    const player = await rememberEmail(db, found.player, identity.email);
    const live = input.sessionPublicKey ? (await liveSessionKeys(db, player.id)).includes(input.sessionPublicKey) : false;
    return { kind: "signed-in", player, created: false, txHash: null, sessionKeyLive: live, linked: found.linked };
  }

  // A new player: their Privy NEAR wallet is the key their account will hold.
  if (!identity.near) throw new PrivyAuthError("near_wallet_missing", "Make your NEAR wallet in Privy first, then sign in again");
  const near = identity.near;
  const factory = await deps.factory();

  if (!factory) {
    // The factory isn't live yet: play now on the key's implicit account, claim a name later.
    const handle = input.handle ? normalizeHandle(input.handle) : unclaimedHandle(near.implicitAccountId);
    const player = await findOrCreatePlayer(db, { nearAccountId: near.implicitAccountId, authKind: "privy", authSub: identity.userId, handle, email: identity.email });
    assertNotBanned(player);
    return { kind: "signed-in", player, created: player.authSub === identity.userId, txHash: null, sessionKeyLive: false, linked: false };
  }

  if (!input.handle) return { kind: "needs-handle", suggestedHandle: suggestHandle(identity.email ?? undefined), parentId: factory.parentId };
  if (!input.sessionPublicKey) throw badRequest("sessionPublicKey is required to create an account");
  const handle = normalizeHandle(input.handle);
  const made = await createOrAdopt(factory, { handle, userPublicKey: near.publicKey, sessionPublicKey: input.sessionPublicKey });
  const player = await findOrCreatePlayer(db, { nearAccountId: made.accountId, authKind: "privy", authSub: identity.userId, handle, email: identity.email });
  assertNotBanned(player);
  if (made.sessionKeyLive) await addSessionKey(db, { playerId: player.id, publicKey: input.sessionPublicKey, addTx: made.txHash });
  return { kind: "signed-in", player, created: true, txHash: made.txHash, sessionKeyLive: made.sessionKeyLive, linked: false };
}

/* ------------------------------------------------------------------ claiming a name */

export interface ClaimInfo {
  /** This player is on an implicit account and can claim a name. */
  unclaimed: boolean;
  /** The factory is live: a claim can go through now. */
  open: boolean;
  parentId: string | null;
  /** A handle to offer (their own pick, or one from their email). */
  suggestedHandle?: string;
}

/** What the account sheet shows an unclaimed player. Pure. */
export function claimInfo(player: Pick<Player, "authKind" | "nearAccountId" | "handle" | "email">, factory: { parentId: string } | null): ClaimInfo {
  const unclaimed = isUnclaimed(player);
  if (!unclaimed) return { unclaimed: false, open: false, parentId: factory?.parentId ?? null };
  const own = player.handle !== unclaimedHandle(player.nearAccountId) ? player.handle : undefined;
  const suggestedHandle = own ?? suggestHandle(player.email ?? undefined);
  return { unclaimed, open: factory !== null, parentId: factory?.parentId ?? null, ...(suggestedHandle ? { suggestedHandle } : {}) };
}

/**
 * Moves an unclaimed player onto `<handle>.<parent>`: the factory creates it with the
 * player's Privy NEAR key (read from Privy again, and it must be the key their implicit
 * account is) and this browser's session key, then the player's rows follow
 * (src/server/db/move-account.ts). Their save, rank and held rewards come along.
 */
export async function claimName(
  db: Db,
  input: { player: Player; identity: PrivyIdentity; handle: string; sessionPublicKey: string; now?: Date },
  deps: { factory: FactoryLookup },
): Promise<{ player: Player; accountId: string; txHash: string | null; sessionKeyLive: boolean }> {
  const { player, identity } = input;
  assertNotBanned(player);
  if (!isUnclaimed(player)) throw conflict("already_claimed", "Your account already has its name");
  if (player.authSub !== identity.userId) throw conflict("wallet_mismatch", "That Google login isn't this player's");
  if (identity.near?.implicitAccountId !== player.nearAccountId) throw conflict("wallet_mismatch", "Your Privy NEAR wallet isn't the key this account was made with");
  const factory = await deps.factory();
  if (!factory) throw new HttpError(503, "names_closed", "Names aren’t open yet. Your hero is saved; claim your name once they open.");

  const handle = normalizeHandle(input.handle);
  const made = await createOrAdopt(factory, { handle, userPublicKey: identity.near.publicKey, sessionPublicKey: input.sessionPublicKey });
  const moved = await movePlayerAccount(db, { playerId: player.id, from: player.nearAccountId, to: made.accountId, handle, now: input.now });
  if (made.sessionKeyLive) await addSessionKey(db, { playerId: moved.id, publicKey: input.sessionPublicKey, addTx: made.txHash });
  return { player: moved, accountId: made.accountId, txHash: made.txHash, sessionKeyLive: made.sessionKeyLive };
}
