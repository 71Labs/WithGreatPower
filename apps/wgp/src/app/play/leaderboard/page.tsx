import type { Metadata } from "next";

import { LeaderboardScreen } from "@/components/leaderboard/leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Tonight’s best patrols, the season standings and the all-time records, every score replayed and verified.",
};

export default function LeaderboardPage() {
  return <LeaderboardScreen />;
}
