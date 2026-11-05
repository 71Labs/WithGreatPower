import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CaseLab } from "./case-lab";

export const metadata: Metadata = { title: "Case 001 lab", robots: { index: false } };

/**
 * The case's ending with fixture outcomes, before the gameplay build can end a real case
 * night: `?view=queued|minted|guest|filing|failed|rejected|open`. Development only.
 */
export default function CaseLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CaseLab />;
}
