import type { Metadata } from "next";

import { PatrolScreen } from "@/components/patrol/patrol-screen";

export const metadata: Metadata = { title: "Patrol" };

export default function PatrolPage() {
  return <PatrolScreen />;
}
