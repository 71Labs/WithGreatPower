/**
 * Gwei's new stock on a market card or sheet (src/lib/market/new-stock.ts): a "New" chip,
 * or "Not on NEAR yet" in the practice market while NEAR has no pool for it, and how the
 * item is earned. Nothing for the launch items.
 */
import { newStockItem } from "@/lib/market/new-stock";
import type { MarketItemView } from "@/lib/market/api";

const CHIP =
  "inline-flex h-5 items-center whitespace-nowrap rounded-full border-2 border-game-ink px-1.5 text-[10px] font-bold uppercase leading-none tracking-[0.04em]";

export function NewStockTag({
  item,
}: {
  item: Pick<MarketItemView, "item" | "preview">;
}) {
  if (!newStockItem(item.item)) return null;
  return item.preview ? (
    <span className={`${CHIP} border-dashed bg-game-paper-2 text-game-ink`}>
      Not on NEAR yet
    </span>
  ) : (
    <span className={`${CHIP} bg-game-gold text-game-ink`}>New</span>
  );
}

/** How a new item is earned, for the trade sheet. */
export function NewStockEarn({
  item,
}: {
  item: Pick<MarketItemView, "item" | "preview">;
}) {
  const meta = newStockItem(item.item);
  if (!meta) return null;
  return (
    <span className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
      {meta.howToEarn}
      {item.preview
        ? " A practice preview: Gwei stocks it on NEAR once the owner opens its pool."
        : null}
    </span>
  );
}
