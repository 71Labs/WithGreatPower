import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NearAuthLab } from "./near-auth-lab";

export const metadata: Metadata = { title: "NEAR Auth lab", robots: { index: false } };

/**
 * Spike S1: NEAR Auth on testnet with the shared dev client. Client only. Hidden in
 * production, where it would only confuse visitors, unless ALLOW_NEAR_AUTH_LAB=1.
 */
export default function NearAuthLabPage() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_NEAR_AUTH_LAB !== "1") notFound();
  return <NearAuthLab />;
}
