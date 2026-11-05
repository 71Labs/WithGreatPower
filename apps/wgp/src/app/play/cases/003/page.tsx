import type { Metadata } from "next";

import { FeeStrikeIntro } from "@/components/cases/fee-strike/case-intro";

export const metadata: Metadata = {
  title: "Case file 003: Fee Strike",
  description: "Every fee in the Mempool Market is up 400% and Aunt Mainnet’s oven has gone dark. Somebody is holding the fee meter.",
};

/** The case's intro comic, then "Start the case". */
export default function FeeStrikeIntroPage() {
  return <FeeStrikeIntro />;
}
