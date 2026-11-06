import type { Metadata } from "next";

import { CompeteHub } from "@/components/compete/hub";

export const metadata: Metadata = {
  title: "Compete",
  description: "The Daily Run, five time trials and your rivals. Every run is replay-verified, so every run is a ghost you can race.",
};

export default function CompetePage() {
  return <CompeteHub />;
}
