import type { Metadata } from "next";

import { CaseFiles } from "@/components/cases/case-files";

export const metadata: Metadata = {
  title: "Case files",
  description: "Bearson’s open cases: special nights from The Daily Rug. Case file 001, “Missing: Mary Jpeg”, case file 002, “The Sybil Vote”, and case file 003, “Fee Strike”.",
};

export default function CasesPage() {
  return <CaseFiles />;
}
