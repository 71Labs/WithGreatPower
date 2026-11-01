import type { Metadata } from "next";

import { Tonight } from "@/components/tonight/tonight";

export const metadata: Metadata = { title: "Tonight" };

export default function PlayPage() {
  return <Tonight />;
}
