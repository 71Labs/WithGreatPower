import type { Metadata } from "next";

import { PatrolScreen } from "@/components/patrol/patrol-screen";

export const metadata: Metadata = { title: "Classic patrol" };

/** Classic mode: the original turn-based patrol, for anyone who'd rather not swing. */
export default function ClassicPatrolPage() {
  return <PatrolScreen />;
}
