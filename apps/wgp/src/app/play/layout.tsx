import type { Metadata } from "next";
import type { ReactNode } from "react";

import { GameShell } from "@/components/game/shell";

export const metadata: Metadata = {
  title: { default: "Play", template: "%s · With Great Power" },
  robots: { index: false },
};

export default function PlayLayout({ children }: { children: ReactNode }) {
  return <GameShell>{children}</GameShell>;
}
