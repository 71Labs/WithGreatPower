import type { Metadata } from "next";

import { CastLab } from "./cast-lab";

export const metadata: Metadata = { title: "Cast lab", robots: { index: false } };

/** The 3D cast test bench: full screen, client only. */
export default function CastLabPage() {
  return <CastLab />;
}
