import type { Metadata } from "next";

import { CaseFiles } from "@/components/cases/case-files";

export const metadata: Metadata = {
  title: "Case files",
  description: "Bearson’s open cases: special nights from The Daily Rug. Case file 001, “Missing: Mary Jpeg”, and case file 002, “The Sybil Vote”.",
};

export default function CasesPage() {
  return <CaseFiles />;
}
