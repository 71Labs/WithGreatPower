import type { Metadata } from "next";

import { Bitten } from "@/components/hero/bitten";

export const metadata: Metadata = {
  title: "Get bitten",
  description: "A radioactive validator bites you. Name your hero, pick a suit and choose three powers.",
};

export default function BittenPage() {
  return <Bitten />;
}
