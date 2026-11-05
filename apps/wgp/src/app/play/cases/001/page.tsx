import type { Metadata } from "next";

import { CaseIntro } from "@/components/cases/case-intro";

export const metadata: Metadata = {
  title: "Case file 001: Missing: Mary Jpeg",
  description: "Mary Jpeg went quiet after a night in the Bridge District. Somebody right-clicked. Bearson wants the scoop.",
};

/** The case's intro comic, then "Start the case". */
export default function CaseIntroPage() {
  return <CaseIntro />;
}
