import type { Metadata } from "next";

import { NearAuthLab } from "./near-auth-lab";

export const metadata: Metadata = { title: "NEAR Auth lab", robots: { index: false } };

/** Spike S1: NEAR Auth on testnet with the shared dev client. Client only. */
export default function NearAuthLabPage() {
  return <NearAuthLab />;
}
