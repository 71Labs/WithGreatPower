import type { Metadata } from "next";

import { InviteFriends } from "@/components/referrals/invite-friends";

export const metadata: Metadata = {
  title: "Invite friends",
  description: "Invite 3 friends to With Great Power. When they add their X and play a night, you earn the Recruiter badge and 300 XP.",
};

export default function InvitePage() {
  return <InviteFriends />;
}
