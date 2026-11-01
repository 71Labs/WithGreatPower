import type { Metadata } from "next";

import { PatrolGame } from "@/sim/ui/patrol-game";

export const metadata: Metadata = { title: "Patrol" };

/** The real-time swing sim, full screen over the app shell. */
export default function PatrolPage() {
  return <PatrolGame />;
}
