/**
 * The shape of GET /api/market/npc and the browser's fetcher for it: Sandwich Man as the
 * market screen's "Other traders" strip shows him (src/server/npc/view.ts builds it).
 */
import type { NpcEventKind } from "./npc-book";
import type { NpcStatus } from "./npc-rules";

/** His status line while he is switched off on this market. It says nothing about why: not his account, not its balance. */
export const NPC_OFF_LINE = "Sandwich Man is switched off right now. He still trades in the practice market and in the economy lab’s simulation.";

export interface NpcTraderView {
  id: "sandwich-man";
  name: string;
  /** "on-chain": his own NEAR account. "simulated": the simulated market, no tokens move. "practice": a guest's practice market in their browser. "off": not configured. */
  mode: "on-chain" | "simulated" | "practice" | "off";
  accountId: string | null;
  /** His account on NearBlocks, when on chain. */
  explorerUrl: string | null;
  status: NpcStatus | "off";
  /** What he says about it. */
  statusLine: string;
  bits: number | null;
  /** In his wallet. */
  items: { item: string; name: string; amount: number }[];
  /** His open listings (in the contract's escrow). */
  listings: { id: number; item: string; name: string; amount: number; price: number }[];
  /** Actions he may still take today, and Bits he may still spend. */
  actionsLeft: number;
  budgetLeft: number;
  /**
   * Newest first. `brain` is who picked the move (the LLM's model id, e.g. "kimi-k3", or "rules"); null on lines no brain decided (a sale, the seed) and older ones.
   * `verified`: for a move an LLM picked, whether its answer's signature checked out (NEAR AI Cloud only); null where there was nothing to check.
   */
  log: { at: string; kind: NpcEventKind; text: string; reason: string; txHash: string | null; txUrl: string | null; brain?: string | null; verified?: boolean | null }[];
  /**
   * Who picks his moves (src/lib/market/npc-brain.ts). "llm": the model (`model`; NEAR AI
   * Cloud's when NEARAI_API_KEY is set, else Kimi K3) picks among the legal moves his rules
   * allow, or passes, and the rules pick when it can't answer. "rules": the rules alone (no
   * LLM key, or not on chain).
   * Absent in the practice market, which runs on the rules.
   */
  brain?: {
    mode: "llm" | "rules";
    /** The model id when mode is "llm". */
    model: string | null;
    /** Where the LLM runs when mode is "llm": "near-ai" (NEAR AI Cloud, NEARAI_API_KEY) or "moonshot" (Kimi, LLM_API_KEY). */
    provider?: "near-ai" | "moonshot" | null;
    maxCallsPerDay: number;
    callsLeft: number;
    /** The last turn that had a move to pick, on chain: who picked (a model id or "rules"), what, and why the rules did if they did. */
    last: { at: string; by: string; pick: string; text: string | null; reason: string; fallback: string | null; options: number } | null;
    /**
     * The newest LLM answer he acted on and what was checked: `verified` is true only when a
     * NEAR AI Cloud signature covered that exact request and response and its signer matched
     * the model's attestation report; otherwise false with a short `reason`. Null before any.
     */
    lastVerification?: {
      at: string;
      provider: string;
      model: string;
      chatId: string | null;
      signingAddress: string | null;
      signatureKind: string | null;
      verified: boolean;
      reason: string | null;
    } | null;
  };
  /** The public key his on-chain calls are signed with (public, not a secret); null off chain. */
  signerKey?: string | null;
  /** His rules in plain English (src/lib/market/npc-rules.ts). */
  rules: readonly string[];
  rulesUrl: string;
  /** The one-off seed he started with. */
  seedBits: number;
  /** The server's clock when this was built (ISO), for "5 min ago". */
  now: string;
}

/** Null when it couldn't be read; the strip then keeps what it had. */
export async function getNpcTrader(signal?: AbortSignal): Promise<NpcTraderView | null> {
  try {
    const res = await fetch("/api/market/npc", { credentials: "same-origin", cache: "no-store", signal });
    return res.ok ? ((await res.json()) as NpcTraderView) : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}
