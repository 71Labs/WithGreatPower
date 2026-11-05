import type { Metadata } from "next";

import { CaseFiles } from "@/components/cases/case-files";

export const metadata: Metadata = {
  title: "Case files",
  description: "Bearson’s open cases: special nights from The Daily Rug, starting with case file 001, “Missing: Mary Jpeg”.",
};

export default function CasesPage() {
  return <CaseFiles />;
}
