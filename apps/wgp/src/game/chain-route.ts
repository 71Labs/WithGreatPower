/**
 * Where a signed-in player's craft and equip go, and what the relayer's answer means.
 * Pure, shared by the store (src/game/store.ts) and the chain client (./chain.ts).
 *
 * - Quick play on: craft and equip go on chain (session key → /api/relay/meta → the
 *   contract) and the server mirrors the save on success.
 * - Quick play off, or wearing a suit that only the save holds: today's /api/actions,
 *   which saves the change but doesn't put it on chain.
 * - On chain but the relayer can't take it (not configured, out of funds, the key is
 *   gone, the network failed): the same save-only path, so the game never stalls.
 * - On chain and the contract refuses (say the loot is still on its way): the change is
 *   reverted with a message that says why.
 */
import type { Action } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import { craftRefusalText } from "@/lib/market/craft";
import type { QuickPlay } from "@/lib/near/quick-play";

export type SuitAction = Extract<Action, { type: "craft-suit" | "equip-suit" }>;

export const isSuitAction = (a: Action): a is SuitAction => a.type === "craft-suit" || a.type === "equip-suit";

/** The contract method for a suit action. */
export const SUIT_METHOD = { "craft-suit": "craft_suit", "equip-suit": "equip_suit" } as const;

export interface RouteContext {
  quickPlay: QuickPlay;
  /** Suits the account holds on chain, or null when unknown. */
  onChainSuits: readonly string[] | null;
}

/** "chain" or "db" for a menu action. */
export function routeAction(action: Action, ctx: RouteContext): "chain" | "db" {
  if (!isSuitAction(action) || ctx.quickPlay.state !== "on") return "db";
  // A suit crafted before quick play lives only in the save; the chain would answer "you don't own it".
  if (action.type === "equip-suit" && ctx.onChainSuits && !ctx.onChainSuits.includes(action.suit)) return "db";
  return "chain";
}

/** What postToRelay answered, or what was thrown on the way (no key, RPC down, offline). */
export type RelayReply =
  | { ok: boolean; status: number; error?: string; message?: string; txHash?: string; save?: unknown; rev?: unknown }
  | { thrown: string };

export type RelayVerdict =
  | { kind: "ok"; txHash: string | null; save: Save | null; rev: number | null }
  /** The contract refused: revert and say why. */
  | { kind: "refused"; text: string; raw: string }
  /** The server said not now (a run in flight, rate limited, suspended): revert. */
  | { kind: "busy"; text: string; code: string }
  | { kind: "signed-out" }
  /** The relayer can't take it: fall back to saving only. `keyGone` when the key itself was refused. */
  | { kind: "unavailable"; reason: string; keyGone: boolean };

const KEY_GONE = new Set(["unknown_key", "revoked_key", "wrong_account", "unknown_sender"]);

/** Turns the contract's panic into words a player can act on. */
export function refusalText(raw: string): string {
  // The market's `craft_bits`: the contract (and the relayer's check before it) answers "Needs bits xN",
  // after any loot it is also missing ("Needs sybil-goo x1, bits x130").
  const bits = craftRefusalText(undefined, raw);
  if (bits) {
    const lootToo = /Needs (?!bits x)/i.test(raw);
    return lootToo ? `NEAR doesn’t show enough loot for that yet (rewards from a night land within a minute or two). ${bits}` : bits;
  }
  if (/Needs /i.test(raw)) return "NEAR doesn’t show enough loot for that yet. Rewards from a night land within a minute or two, so try again shortly.";
  const level = /Reach level (\d+)/i.exec(raw);
  if (level) return `NEAR still has your hero below level ${level[1]}. Your level lands with your next reward, so try again shortly.`;
  if (/Register a hero first/i.test(raw)) return "Your hero isn’t on NEAR yet. Try again in a moment.";
  if (/already own this suit/i.test(raw)) return "That suit is already yours on NEAR.";
  if (/don't own this suit/i.test(raw)) return "That suit isn’t on NEAR yet, so it can’t be worn there.";
  if (/paused/i.test(raw)) return "The game is paused on NEAR for a moment. Try again shortly.";
  return "NEAR refused that change, so nothing was spent. Try again.";
}

export function classifyRelay(reply: RelayReply): RelayVerdict {
  if ("thrown" in reply) return { kind: "unavailable", reason: reply.thrown, keyGone: /isn't on the account|No session key|isn't linked/i.test(reply.thrown) };
  if (reply.ok) {
    const stored = typeof reply.rev === "number" && typeof reply.save === "object" && reply.save !== null;
    return { kind: "ok", txHash: reply.txHash ?? null, save: stored ? (reply.save as Save) : null, rev: stored ? (reply.rev as number) : null };
  }
  const code = reply.error ?? `http_${reply.status}`;
  if (reply.status === 422) {
    const raw = reply.message ?? "";
    return { kind: "refused", text: refusalText(raw), raw };
  }
  if (reply.status === 401 && code === "unauthorized") return { kind: "signed-out" };
  if (reply.status === 409 && code === "run_active") return { kind: "busy", code, text: "Finish or abandon your patrol first, then try that again." };
  if (reply.status === 429) return { kind: "busy", code, text: "That’s a lot of changes at once. Wait a moment and try again." };
  if (code === "banned") return { kind: "busy", code, text: "This account is suspended, so changes can’t be saved." };
  return { kind: "unavailable", reason: reply.message ?? code, keyGone: KEY_GONE.has(code) };
}
