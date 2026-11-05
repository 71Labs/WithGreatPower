import type { Metadata } from "next";

import { CaseLab } from "./case-lab";

export const metadata: Metadata = { title: "Case file 001 lab", robots: { index: false } };

/** Case file 001’s 3D bench (fixture chapter frames): full screen, client only. */
export default function CaseLabPage() {
  return <CaseLab />;
}
