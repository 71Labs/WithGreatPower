"use client";

/**
 * The friend-side welcome toast, "You joined {handle}’s crew.":
 * - arriving from an invite (/play?invited=1, where the accept route sends you): once,
 *   then the parameter comes off the address. A guest hears the inviter's handle the
 *   landing saw and is asked to sign in so it counts; a signed-in player hears whose crew
 *   GET /api/referrals says they're in (an existing account isn't added to a crew by a
 *   link, so it's pointed at "Got an invite code?" instead, while that's open).
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
import { crewWelcomeText } from "@/lib/referrals/view";

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
  /** The arrival toast has gone out. */
  const done = useRef(false);
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
    if (!arrived || done.current || status !== "guest") return;
    done.current = true;
    showToast(crewWelcomeText(storedReferrer(), true), "success");
  }, [arrived, status]);

  const view = referrals.status === "ready" ? referrals.view : null;
  useEffect(() => {
    if (!me || !view) return;
    const key = WELCOMED(me.player.id);
    const fromInvite = arrived && !done.current;
    if (fromInvite) done.current = true;
    const fresh = !welcomed(key);
    markWelcomed(key);
    if (view.referredBy) {
      if (fromInvite || (fresh && Date.now() - Date.parse(me.player.createdAt) < NEW_ACCOUNT_MS)) showToast(crewWelcomeText(view.referredBy, false), "success");
    } else if (fromInvite && view.canClaim) {
      const by = storedReferrer();
      showToast(`You already have an account, so add ${by ? `${by}’s` : "your friend’s"} invite code under Invite friends to join their crew.`, "info");
    }
  }, [me, view, arrived]);

  return null;
}
