"use client";

/**
 * Keeps the invite this landing showed in localStorage (`wgp:ref`, and the inviter's
 * handle for the welcome toast), the fallback the sign-in requests send if the
 * `wgp_ref` cookie is lost. Renders nothing.
 */
import { useEffect } from "react";

import { rememberInvite } from "@/lib/referrals/ref";

export function RememberInvite({ code, referrer }: { code: string; referrer: string | null }) {
  useEffect(() => rememberInvite(code, referrer), [code, referrer]);
  return null;
}
