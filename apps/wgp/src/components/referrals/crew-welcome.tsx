"use client";

/**
 * The friend-side welcome toast, "You joined {handle}’s crew.":
 * - arriving from an invite (/play?invited=1, where the accept route sends you): the
 *   parameter comes off the address. A guest hears the inviter's handle the landing saw and
 *   is asked to sign in so it counts. Signed in (straight away, or after that guest toast),
 *   they hear whose crew GET /api/referrals says they're in; an existing account isn't added
 *   to a crew by a link, so it's pointed at "Got an invite code?" instead, while that's open
 *   (src/lib/referrals/view.ts crewArrivalToast).
 * - signed in with an inviter (`referredBy`): once per player in this browser, while the
 *   account is new. It loads the referrals once per player and browser, then remembers.
 *
 * Mounted once with the account sheet (AccountCenter), on every /play screen, so the
 * welcome survives a first visit that's sent straight on to /play/bitten.
 */
import { useEffect, useRef, useState } from "react";

import { showToast, useAccount } from "@/game/store";
import { storedReferrer } from "@/lib/referrals/ref";
import { useReferrals } from "@/lib/referrals/store";
import { crewArrivalToast, crewWelcomeText } from "@/lib/referrals/view";

const WELCOMED = (playerId: string) => `wgp:crew-welcome:${playerId}`;
/** Older accounts get no welcome: they've long known whose crew they're in. */
const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;

function welcomed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
}

function markWelcomed(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {}
}

export function CrewWelcome() {
  const account = useAccount();
  const me = account.me;
  // Read once in the browser, before any redirect moves on (the server's render says no; this draws nothing).
  const [arrived] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("invited") === "1");
  // The inviter the landing saw, read now: a sign-in forgets the stored invite before the referrals load.
  const [inviter] = useState(() => (typeof window !== "undefined" ? storedReferrer() : null));
  /** The guest's arrival toast has gone out. */
  const toldGuest = useRef(false);
  /** The signed-in outcome of the arrival has been told (joined, or an existing account). */
  const settled = useRef(false);
  const playerKey = me ? WELCOMED(me.player.id) : null;
  const referrals = useReferrals({ load: playerKey !== null && (arrived || !welcomed(playerKey)) });

  useEffect(() => {
    if (!arrived) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("invited")) return;
    url.searchParams.delete("invited");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [arrived]);

  const status = account.status;
  useEffect(() => {
    if (!arrived || toldGuest.current || status !== "guest") return;
    toldGuest.current = true;
    showToast(crewWelcomeText(inviter, true), "success");
  }, [arrived, status, inviter]);

  const view = referrals.status === "ready" ? referrals.view : null;
  useEffect(() => {
    if (!me || !view) return;
    const key = WELCOMED(me.player.id);
    const fromInvite = arrived && !settled.current;
    settled.current = true;
    const fresh = !welcomed(key);
    markWelcomed(key);
    const toast = crewArrivalToast({
      referredBy: view.referredBy,
      canClaim: view.canClaim,
      fromInvite,
      fresh,
      newAccount: Date.now() - Date.parse(me.player.createdAt) < NEW_ACCOUNT_MS,
      inviter,
    });
    if (toast) showToast(toast.text, toast.tone);
  }, [me, view, arrived, inviter]);

  return null;
}
