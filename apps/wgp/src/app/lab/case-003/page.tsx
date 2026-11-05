import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Case003Lab } from "./case-lab";

export const metadata: Metadata = { title: "Case 003 lab", robots: { index: false } };

/**
 * Case file 003's ending ("Fee Strike") with fixture outcomes, for screenshots and checks:
 * `?view=queued|minted|guest|filing|failed|rejected|open`. Development only.
 */
export default function Case003LabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Case003Lab />;
}
