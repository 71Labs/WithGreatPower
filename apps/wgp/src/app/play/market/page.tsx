import type { Metadata } from "next";

import { MarketScreen } from "@/components/market/market-screen";

export const metadata: Metadata = {
  title: "Mempool Market",
  description: "Spend the Bits you earn on patrol. Gwei Stacy’s prices move with every trade, and players list their own loot.",
};

export default function MarketPage() {
  return <MarketScreen />;
}
