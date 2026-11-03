import type { Metadata } from "next";

import { EconomyLab } from "./economy-lab";

export const metadata: Metadata = {
  title: "Economy fast-forward",
  description: "Fast-forward the Mempool Market: bot heroes trade, list and craft for N days on the market's real pricing code while you watch prices move.",
};

/** The Mempool Market fast-forward for judges: client only. */
export default function EconomyLabPage() {
  return <EconomyLab />;
}
