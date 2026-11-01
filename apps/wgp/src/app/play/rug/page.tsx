import type { Metadata } from "next";

import { DailyRugScreen } from "@/components/rug/daily-rug";

export const metadata: Metadata = {
  title: "The Daily Rug",
  description: "Tonight’s front page, written from your last patrol, with the reader poll and tomorrow’s quest.",
};

export default function RugPage() {
  return <DailyRugScreen />;
}
