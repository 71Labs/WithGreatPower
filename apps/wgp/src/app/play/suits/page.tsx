import type { Metadata } from "next";

import { SuitLab } from "@/components/hero/suit-lab";

export const metadata: Metadata = {
  title: "Suit lab",
  description: "Stitch new suits from villain loot, and change into the ones you own.",
};

export default function SuitsPage() {
  return <SuitLab />;
}
