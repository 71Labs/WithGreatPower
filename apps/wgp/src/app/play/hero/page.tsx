import type { Metadata } from "next";

import { HeroSheet } from "@/components/hero/hero-sheet";

export const metadata: Metadata = {
  title: "Hero sheet",
  description: "Your hero’s level, responsibility, reputation, powers and patrol loadout.",
};

export default function HeroPage() {
  return <HeroSheet />;
}
