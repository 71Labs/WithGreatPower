/**
 * A market request as the contract call a session key signs (contracts/wgp/src/market.rs).
 * Pure; shared by the market screen and scripts/near/e2e-sandbox.ts, so the end-to-end run
 * sends exactly what the browser sends. U128 amounts travel as decimal strings, u32 and
 * u64 as JSON numbers.
 */
import type { MarketMethod } from "../near/policy";
import type { SimTradeRequest } from "./api";

export function chainCall(req: SimTradeRequest): { method: MarketMethod; args: Record<string, unknown> } {
  switch (req.action) {
    case "buy":
      return { method: "market_buy", args: { item: req.item, amount: req.amount, max_bits: String(req.maxBits) } };
    case "sell":
      return { method: "market_sell", args: { item: req.item, amount: req.amount, min_bits: String(req.minBits) } };
    case "list":
      return { method: "list_item", args: { item: req.item, amount: req.amount, price_bits: String(req.price) } };
    case "fill":
      return { method: "buy_listing", args: { listing_id: req.listingId } };
    case "cancel":
      return { method: "cancel_listing", args: { listing_id: req.listingId } };
  }
}
