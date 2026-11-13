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
  /** Newest first. */
  log: { at: string; kind: NpcEventKind; text: string; reason: string; txHash: string | null; txUrl: string | null }[];
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
