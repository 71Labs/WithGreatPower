import type { Metadata } from "next";

import { CrowdLab } from "./crowd-lab";

export const metadata: Metadata = { title: "Crowd lab", robots: { index: false } };

/** The city's people beside the cast: full screen, client only. */
export default function CrowdLabPage() {
  return <CrowdLab />;
}
