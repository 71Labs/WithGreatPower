import type { Metadata } from "next";

import { CityLab } from "./city-lab";

export const metadata: Metadata = { title: "City lab", robots: { index: false } };

/** The 3D city test bench: full screen, client only. */
export default function CityLabPage() {
  return <CityLab />;
}
