/**
 * A market trade that didn't go through, in words a player can act on. Pure; used by the
 * market screen for both markets. The inputs are what the server answered:
 *
 * - the relayer (/api/relay/meta): its own refusals (400/401/403/409/429/503) and, when the
 *   contract refused, 422 call_failed with the raw outcome ("…Smart contract panicked: …");
 * - the simulated market (/api/market/trade): 422 with the contract's own words.
 *
 * Players never see a raw outcome, an account id or a nonce. A failure that leaves it
 * unclear whether the trade landed (the connection dropped after it was sent, a server
 * error) says so, so nobody pays twice by trying again blind.
 */
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

export interface MarketProblem {
  /** "quick_play": the session key is missing or refused; the screen offers to turn it on. */
  code: string;
  text: string;
  /** The trade may have landed: the screen reloads the wallet before anyone tries again. */
  unsure?: boolean;
}

/** The contract's words from a relayed failure ("Smart contract panicked: …"), or null. */
export function panicText(message: string | undefined): string | null {
  const m = /panicked: ([^"\\]+)/.exec(message ?? "");
  return m ? m[1]!.trim() : null;
}

const itemName = (id: string) => (id in ITEMS ? ITEMS[id as ItemId].name : "that item");
const bits = (n: string) => `${Number(n).toLocaleString("en-US")} Bits`;

/** The contract's (and the sim's) refusals, rephrased. Unknown words fall back to a generic line. */
export function refusalText(said: string): string {
  let m: RegExpExecArray | null;
  if ((m = /That costs (\d+) Bits now, over your limit/i.exec(said))) {
    return `The price moved before your trade went through: that’s ${bits(m[1]!)} now. Nothing was spent. Check the new price and try again.`;
  }
  if ((m = /That pays (\d+) Bits now, under your limit/i.exec(said))) {
    return `The price moved before your sale went through: it pays ${bits(m[1]!)} now. Nothing was sold. Check the new price and try again.`;
  }
  if ((m = /^Needs (\d+) Bits$/i.exec(said))) return `You need ${bits(m[1]!)} for that, and you have fewer. Nothing was spent.`;
  if ((m = /Not enough item:([a-z0-9-]+)/i.exec(said))) {
    return m[1] === "bits"
      ? "You don’t have enough Bits for that yet. Bits from a night arrive within a minute or two."
      : `You don’t have that many ${itemName(m[1]!)} yet. Loot from a night arrives within a minute or two.`;
  }
  if ((m = /The vendor has only (\d+)/i.exec(said))) return `Gwei has only ${Number(m[1]).toLocaleString("en-US")} left. Try fewer.`;
  if ((m = /The vendor's till holds only (\d+) Bits/i.exec(said))) return `Gwei’s till holds only ${bits(m[1]!)} right now. Try selling fewer.`;
  if (/worth less than a Bit/i.test(said)) return "That’s worth less than a Bit right now, so Gwei won’t buy it.";
  if ((m = /Price it between (\d+) and (\d+) Bits/i.exec(said))) {
    return `Gwei’s price moved: price this lot between ${Number(m[1]).toLocaleString("en-US")} and ${bits(m[2]!)}.`;
  }
  if ((m = /You can have (\d+) listings open/i.exec(said))) return `You can have ${m[1]} listings up at once. Take one down first.`;
  if (/Daily market limit/i.test(said)) return "That’s today’s market limit. It resets at midnight UTC.";
  if (/That listing is gone/i.test(said)) return "Someone bought that lot first, or it was taken down.";
  if (/your own listing/i.test(said)) return "That’s your own listing. Take it down from the Listings tab instead.";
  if (/Only the seller/i.test(said)) return "Only the seller can take that listing down.";
  if (/market is full/i.test(said)) return "The listings board is full right now. Try again later.";
  if (/market is closed/i.test(said)) return "Gwei’s stall is closed for now. You can still take your listings down.";
  if (/paused/i.test(said)) return "The market is paused for a moment. Try again shortly.";
  if ((m = /Trade 1 to (\d+) at a time/i.exec(said))) return `You can trade 1 to ${m[1]} at a time.`;
  if (/maximum number of token kinds/i.test(said)) return "Your pockets are full: you hold every kind of thing an account can. Sell or use something first.";
  if (/doesn't trade/i.test(said)) return "Gwei doesn’t trade that item.";
  return "The market couldn’t do that, and nothing was spent. Try again.";
}

/** Any failed trade, from either market. `status` 0 means the request never got an answer. */
export function marketProblem(status: number, code: string, message?: string): MarketProblem {
  if (status === 0) return { code: "network", unsure: true, text: "We lost the connection, so we can’t tell if that went through. Your wallet is reloading: check it before you try again." };
  if (code === "run_active") return { code, text: "Finish or abandon your patrol first, then trade." };
  // The simulated market answering after the contract's market opened.
  if (code === "on_chain") return { code, text: "The market just moved to NEAR. The page is reloading the new prices; try again in a moment." };
  if (code === "unknown_key" || code === "revoked_key" || code === "wrong_account" || code === "unknown_sender" || code === "bad_signature") {
    return { code: "quick_play", text: "Quick play needs turning on again on this device before you can trade." };
  }
  if (code === "banned") return { code, text: "This account is suspended, so it can’t trade." };
  if (status === 401) return { code: "signed_out", text: "You were signed out. Sign in again to trade." };
  if (code === "budget_exhausted" && status === 429) return { code, text: "That’s all the market moves for today. It resets at midnight UTC." };
  if (status === 429) return { code, text: "That’s a lot of trades at once. Wait a moment, then try again." };
  if (code === "expired" || code === "too_far_ahead") return { code, text: "That took too long to send. Try again." };
  if (status === 503 || code === "relayer_empty" || code === "near_not_configured" || code === "market_unavailable") {
    return { code, text: "The market can’t take trades right now. Your Bits and items are safe; try again in a few minutes." };
  }
  if (status >= 500) return { code, unsure: true, text: "Something went wrong on our side, so we can’t tell if that went through. Your wallet is reloading: check it before you try again." };
  if (status === 422 || code === "call_failed") {
    const said = panicText(message) ?? (code === "call_failed" ? null : message);
    if (said) return { code, text: refusalText(said) };
    // A refusal from NEAR itself rather than the game (the key changed, the request was stale).
    if (/AccessKey/i.test(message ?? "")) return { code: "quick_play", text: "Quick play needs turning on again on this device before you can trade." };
    return { code, text: "That didn’t go through, and nothing was spent. Try again." };
  }
  return { code, text: "That didn’t go through, and nothing was spent. Try again." };
}
