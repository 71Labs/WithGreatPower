import type { Metadata } from "next";

import { Case002Intro } from "@/components/cases/case-002/intro";

export const metadata: Metadata = {
  title: "Case file 002: The Sybil Vote",
  description: "Turnout is ten thousand percent, and every extra voter is the same man. Find the real Sybil and get Uncle Gen’s vote counted.",
};

/** The case's intro comic, then "Start the case". */
export default function Case002Page() {
  return <Case002Intro />;
}
