import type { Metadata } from "next";

import { QuickStart } from "@/components/first-minute/quick-start";

export const metadata: Metadata = { title: "Swing out" };

/** One tap from the website into the first night (components/first-minute/quick-start.tsx). */
export default function StartPage() {
  return <QuickStart />;
}
