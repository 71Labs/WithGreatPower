"use client";

/**
 * The account sheet. Signed out, it offers Google, an existing NEAR wallet, and in local
 * development a test player; a new Google player then picks a handle. Signed in, it shows
 * who you are on NEAR, quick play (./quick-play.tsx) or, for a Google player still on
 * their key's address, "Claim your name" (./claim-name.tsx), an optional X handle with the
 * opt-in to be tagged (./x-handle.tsx), today's ranked runs and Sign out.
 *
 * Google goes through Privy (a full-page redirect to Google and back; src/lib/privy) or
 * NEAR Auth (a popup; src/lib/near/near-auth.ts), per NEXT_PUBLIC_GOOGLE_SIGN_IN
 * (src/lib/privy/config.ts). Neither SDK is in this module: each loads when needed.
 *
 * Opened by the account chip, by openAccountSheet() and by the `wgp:sign-in` event.
 */
import { Suspense, lazy, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { CircleAlert, ExternalLink, Google, LogOut, TestTube, Wallet } from "@/components/icons";
import { StickerButton, StickerMeter, stickerButtonClass } from "@/components/game/kit";
import { GameSheet } from "@/components/game/ui";
import { refreshAccount, showToast, useAccount, useGame } from "@/game/store";
import { devSignIn, devSignInAvailable, signOut, type Me } from "@/lib/api/client";
import { EXPLORER_URL, NETWORK, PLAYER_PARENT_ID } from "@/lib/near/config";
import { isUnclaimed } from "@/lib/near/policy";
import { clearPrivyFailure, endOAuthReturn, getPrivyState, requestPrivy, signOutOfPrivy, usePrivyReturning } from "@/lib/privy/bridge";
import { GOOGLE_SIGN_IN, PRIVY_APP_ID } from "@/lib/privy/config";

import { googleProblem, walletProblem, type SignInProblem } from "./errors";
import { HandleField, handleProblem } from "./handle-field";
import { closeAccountSheet, openAccountSheet, useAccountSheetOpen } from "./sheet-state";
import { XHandleSection } from "./x-handle";

const WalletSignIn = lazy(() => import("./wallet-sign-in"));
/** Quick play pulls in near-connect for wallet players: load it only once a signed-in sheet opens. */
const QuickPlaySection = lazy(() => import("./quick-play"));
/** Only unclaimed Google players see it. */
const ClaimNameSection = lazy(() => import("./claim-name"));

/** The NEAR Auth client is heavy (Auth0, near-api-js): load it only when the sheet opens. */
const nearAuth = () => import("@/lib/near/near-auth");
/** Privy sign-in steps (near-api-js for the session key); Privy itself loads through the bridge. */
const privySignIn = () => import("@/lib/privy/sign-in");

type Busy = null | "google" | "wallet" | "dev" | "handle" | "sign-out";
type Google = { state: "loading" } | { state: "ready" } | { state: "unavailable"; text: string };

const AUTH_LABEL: Record<string, string> = {
  near_auth: "Google, through NEAR Auth",
  privy: "Google",
  wallet: "NEAR wallet",
  dev: "Test sign-in (this computer only)",
};

/** Privy needs no warm-up to be tapped, and without an app id it can't work at all: say so up front. */
const initialGoogle = (): Google =>
  GOOGLE_SIGN_IN === "near-auth" ? { state: "loading" } : PRIVY_APP_ID ? { state: "ready" } : { state: "unavailable", text: "Google sign-in isn’t set up on this server yet." };

/** Shown under the controls after something failed. Polite: it answers what the player just did. */
function Problem({ problem, className = "" }: { problem: SignInProblem | null; className?: string }) {
  // Always in the page (so screen readers hear it fill), and takes no room while empty:
  // `className` cancels the parent's gap, e.g. "empty:-mt-4".
  return (
    <div role="status" aria-live="polite" className={className}>
      {problem ? (
        <p className="flex items-start gap-2 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3 text-[14px] leading-5 text-game-ink">
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-game-hero" strokeWidth={2} />
          <span className="[text-wrap:pretty]">{problem.text}</span>
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-3">
      <dt className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{label}</dt>
      <dd className="text-[15px] font-semibold leading-5 text-game-ink">{children}</dd>
    </div>
  );
}

const sectionFallback = (text: string) => (
  <p role="status" className="rounded-[26px] border-2 border-game-ink bg-game-paper-2 px-4 py-3 text-[14px] leading-5 text-game-muted">
    {text}
  </p>
);

function SignedIn({ me, problem }: { me: Me; problem: SignInProblem | null }) {
  const { used, limit } = me.runsToday;
  const left = Math.max(0, limit - used);
  const dev = me.player.authKind === "dev";
  const unclaimed = isUnclaimed(me.player);
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2">
        <Row label={unclaimed ? "Your key’s address" : "NEAR account"}>
          <span className="block font-mono text-[14px] leading-5 [overflow-wrap:anywhere]">{me.player.nearAccountId}</span>
          {dev ? (
            <span className="mt-1 block text-[13px] font-medium leading-5 text-game-muted">A test account: it isn’t on NEAR, so nothing is minted to it.</span>
          ) : unclaimed ? (
            <span className="mt-1 block text-[13px] font-medium leading-5 text-game-muted">Your Google sign-in holds this key. It goes on NEAR when you claim your name.</span>
          ) : (
            <a
              href={`${EXPLORER_URL}/address/${encodeURIComponent(me.player.nearAccountId)}`}
              target="_blank"
              rel="noreferrer"
              className="-ml-1 mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[14px] font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
            >
              {NETWORK === "mainnet" ? "View on NEAR explorer" : "View on NEAR testnet explorer"}
              <ExternalLink aria-hidden className="size-4" strokeWidth={2} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </Row>
        <Row label="Signed in with">{AUTH_LABEL[me.player.authKind] ?? me.player.authKind}</Row>
      </dl>
      {dev ? null : unclaimed ? (
        <Suspense fallback={sectionFallback("Checking your name…")}>
          <ClaimNameSection me={me} />
        </Suspense>
      ) : (
        <Suspense fallback={sectionFallback("Checking quick play…")}>
          <QuickPlaySection me={me} />
        </Suspense>
      )}
      <XHandleSection me={me} />
      <div className="flex flex-col gap-1.5">
        <StickerMeter label="Ranked runs today" value={used} max={limit} fill="bg-game-gold" />
        <p className="text-[13px] leading-5 text-game-muted">
          <span className="num">{left}</span> left today. The count starts again at midnight UTC.
        </p>
      </div>
      <Problem problem={problem} className="empty:-mt-4" />
    </div>
  );
}

export function AccountSheet() {
  const open = useAccountSheetOpen();
  const account = useAccount();
  const { save } = useGame();
  const ids = useId();
  const returning = usePrivyReturning();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<"options" | "handle">("options");
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [google, setGoogle] = useState<Google>(initialGoogle);
  const [devOn, setDevOn] = useState(false);
  const [devHandle, setDevHandle] = useState("dev-hero");
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  /** The handle step's account parent: the server's, when it said (Privy), else the public config's. */
  const [parentId, setParentId] = useState(PLAYER_PARENT_ID);
  /** Privy: on the way to Google's page (else, while busy, finishing after it). */
  const [leaving, setLeaving] = useState(false);
  const handleRef = useRef<HTMLInputElement>(null);

  // Render the body (and load its SDKs) only once someone opens the sheet.
  if (open && !mounted) setMounted(true);

  const guest = account.status === "guest";
  const me = account.status === "signed-in" ? account.me : null;
  const privyPlayer = me?.player.authKind === "privy";

  // Opening as a guest: warm up Google (Privy's SDK, or NEAR Auth's SDK and a sign-in
  // nonce so its popup opens straight from the tap) and ask whether dev sign-in is on.
  // Signed in: refresh today's numbers; a Privy player gets Privy loaded for quick play
  // and sign-out.
  useEffect(() => {
    if (!open) return;
    if (account.status === "signed-in") {
      if (privyPlayer) requestPrivy();
      void refreshAccount();
      return;
    }
    if (account.status !== "guest") return;
    let live = true;
    if (GOOGLE_SIGN_IN === "privy") {
      // Load the SDK while the player reads; a problem loading it surfaces on the tap.
      if (PRIVY_APP_ID) requestPrivy();
    } else {
      nearAuth()
        .then((m) => m.prepareNearAuthSignIn())
        .then(
          () => live && setGoogle({ state: "ready" }),
          (error: unknown) => {
            if (!live) return;
            const p = googleProblem(error);
            // Only a missing setup rules Google out; anything else may pass on a retry.
            setGoogle(p.googleUnavailable ? { state: "unavailable", text: p.text } : { state: "ready" });
          },
        );
    }
    if (process.env.NODE_ENV !== "production") {
      const ctrl = new AbortController();
      devSignInAvailable(ctrl.signal)
        .then((res) => live && setDevOn(res.ok))
        .catch(() => {});
      return () => {
        live = false;
        ctrl.abort();
      };
    }
    return () => {
      live = false;
    };
  }, [open, account.status, privyPlayer]);

  function reset() {
    setStep("options");
    setLeaving(false);
    setBusy(null);
    setProblem(null);
    setHandleError(null);
  }

  // However the sheet closes. A sign-in still under way carries on, and reopens the
  // sheet if it fails, so its reason is never lost.
  function close() {
    closeAccountSheet();
    if (busy === null) reset();
  }

  async function signedIn(note?: string) {
    const next = await refreshAccount();
    reset();
    closeAccountSheet();
    if (next.status === "signed-in") showToast(`Signed in as ${next.me.player.handle}.${note ? ` ${note}` : ""}`, "success");
    else showToast("Signed in, but the server didn’t remember it. Try again.", "error");
  }

  /** A failed Google step: say why, and offer the options again. */
  function googleFailed(error: unknown) {
    const p = googleProblem(error);
    if (p.googleUnavailable) setGoogle({ state: "unavailable", text: p.text });
    setStep("options");
    setProblem(p);
    setLeaving(false);
    setBusy(null);
    openAccountSheet();
    if (GOOGLE_SIGN_IN === "near-auth") {
      // A spent nonce: fetch the next one now, so the retry's popup isn't blocked.
      void nearAuth()
        .then((m) => m.prepareNearAuthSignIn())
        .catch(() => {});
    }
  }

  function askForHandle(suggested: string | undefined, parent: string | undefined) {
    setHandle(suggested ?? "");
    setParentId(parent ?? PLAYER_PARENT_ID);
    setStep("handle");
    setLeaving(false);
    setBusy(null);
    openAccountSheet();
    requestAnimationFrame(() => handleRef.current?.focus());
  }

  /** Privy, back from Google (or already logged in to Privy): the NEAR wallet, then our server. */
  async function finishPrivy() {
    const m = await privySignIn();
    const outcome = await m.finishPrivySignIn();
    if (outcome.status === "needs-handle") return askForHandle(outcome.suggestedHandle, outcome.parentId);
    await signedIn(
      outcome.unclaimed && outcome.created
        ? "Your hero is saved to your Google sign-in; claim your NEAR name from your account once names open."
        : outcome.linked
          ? "Your hero came with you."
          : undefined,
    );
  }

  // Google came back through Privy: finish signing in, with the sheet showing progress.
  useEffect(() => {
    // The live flag, not this render's: a re-run effect (Strict Mode) must not finish twice.
    if (!returning || !getPrivyState().returning) return;
    endOAuthReturn();
    void (async () => {
      setBusy("google");
      setProblem(null);
      openAccountSheet();
      try {
        await finishPrivy();
      } catch (error) {
        googleFailed(error);
      }
    })();
    // finishPrivy and googleFailed only read setters and module constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returning]);

  async function continueWithGoogle() {
    if (busy || google.state === "unavailable") return;
    setBusy("google");
    setProblem(null);
    try {
      if (GOOGLE_SIGN_IN === "privy") {
        clearPrivyFailure();
        setLeaving(true);
        const m = await privySignIn();
        // Leaving for Google: the busy label stays up until the page goes.
        if ((await m.startPrivyGoogle()) === "redirecting") return;
        setLeaving(false);
        await finishPrivy();
        return;
      }
      const m = await nearAuth();
      const outcome = await m.nearAuthSignIn();
      if (outcome.status === "needs-handle") return askForHandle(outcome.suggestedHandle, undefined);
      await signedIn();
    } catch (error) {
      googleFailed(error);
    }
  }

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const local = handleProblem(handle);
    setHandleError(local);
    if (local) {
      handleRef.current?.focus();
      return;
    }
    setBusy("handle");
    setProblem(null);
    const chosen = handle.trim().toLowerCase();
    try {
      if (GOOGLE_SIGN_IN === "privy") {
        const outcome = await (await privySignIn()).finishPrivySignIn({ handle: chosen });
        if (outcome.status === "needs-handle") throw new Error("The server still needs a handle");
      } else {
        const outcome = await (await nearAuth()).nearAuthSignIn({ handle: chosen });
        if (outcome.status === "needs-handle") throw new Error("The server still needs a handle");
      }
      await signedIn();
    } catch (error) {
      const p = googleProblem(error);
      setBusy(null);
      openAccountSheet();
      if (p.handle) {
        setHandleError(p.text);
        handleRef.current?.focus();
      } else {
        // The login itself has to start over (an expired nonce or token, a closed server).
        setStep("options");
        setProblem(p);
      }
    }
  }

  async function playAsTestPlayer(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("dev");
    setProblem(null);
    const res = await devSignIn(devHandle.trim().toLowerCase() || undefined);
    if (res.ok) return signedIn();
    setBusy(null);
    openAccountSheet();
    setProblem({ text: res.status === 404 ? "Test sign-in is off. Start the server with ALLOW_DEV_AUTH=1." : (res.message ?? "Test sign-in didn’t work. Try again.") });
  }

  async function signOutNow() {
    if (busy) return;
    setBusy("sign-out");
    setProblem(null);
    const res = await signOut();
    if (!res.ok) {
      setBusy(null);
      openAccountSheet();
      setProblem({ text: res.status === 0 ? "Couldn’t reach the server, so you’re still signed in. Try again." : "Couldn’t sign out. Try again." });
      return;
    }
    // Out of Privy too, so the next Google sign-in asks Google again.
    await signOutOfPrivy({ load: privyPlayer });
    await refreshAccount();
    reset();
    closeAccountSheet();
    showToast("Signed out. You’re back on the hero saved in this browser.");
  }

  const googleOut = google.state === "unavailable";
  const googleLabel = busy !== "google" ? "Continue with Google" : GOOGLE_SIGN_IN === "near-auth" ? "Waiting for Google…" : leaving ? "Opening Google…" : "Finishing sign-in…";

  let title: ReactNode = "Sign in";
  let description: ReactNode = "Save your hero to a NEAR account and get on the leaderboard.";
  let footer: ReactNode;
  let body: ReactNode = null;

  if (me) {
    title = me.player.handle;
    description = undefined;
    footer = (
      <StickerButton onClick={() => void signOutNow()} aria-busy={busy === "sign-out" || undefined}>
        <LogOut aria-hidden className="size-5" strokeWidth={2} />
        {busy === "sign-out" ? "Signing out…" : "Sign out"}
      </StickerButton>
    );
    body = <SignedIn me={me} problem={problem} />;
  } else if (step === "handle") {
    title = "Pick your handle";
    description = "It becomes your NEAR account’s name, so choose one you like. It can’t be changed later.";
    footer = (
      <>
        <StickerButton onClick={() => busy === null && reset()} aria-disabled={busy !== null || undefined} className="sm:order-first">
          Back
        </StickerButton>
        <StickerButton variant="hero" type="submit" form={`${ids}-handle`} aria-busy={busy === "handle" || undefined}>
          {busy === "handle" ? "Creating your account…" : "Create my account"}
        </StickerButton>
      </>
    );
    body = (
      <form id={`${ids}-handle`} onSubmit={(e) => void createAccount(e)} noValidate className="flex flex-col gap-2">
        <HandleField
          id={`${ids}-handle`}
          value={handle}
          onChange={(next) => {
            setHandle(next);
            if (handleError) setHandleError(null);
          }}
          error={handleError}
          parentId={parentId}
          inputRef={handleRef}
        />
        <Problem problem={problem} className="empty:-mt-2" />
      </form>
    );
  } else if (guest) {
    const heroName = save?.hero?.name;
    description = heroName ? `Save ${heroName} to a NEAR account and get on the leaderboard.` : description;
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <StickerButton
            variant={googleOut ? "paper" : "hero"}
            size="lg"
            className="w-full"
            disabled={googleOut}
            aria-disabled={(busy !== null && busy !== "google") || undefined}
            aria-busy={busy === "google" || undefined}
            data-autofocus=""
            onClick={() => void continueWithGoogle()}
          >
            <Google aria-hidden className="size-5" strokeWidth={2} />
            {googleLabel}
          </StickerButton>
          {googleOut ? <p className="-mt-1 text-center text-[13px] leading-5 text-game-muted">{google.text} Use a NEAR wallet instead.</p> : null}
          <Suspense
            fallback={
              <span className={stickerButtonClass("paper", "lg", "w-full opacity-50")} aria-hidden>
                <Wallet className="size-5" strokeWidth={2} />
                Loading wallets…
              </span>
            }
          >
            {mounted ? (
              <WalletSignIn
                variant={googleOut ? "hero" : "paper"}
                busy={busy !== null}
                onStart={() => {
                  setBusy("wallet");
                  setProblem(null);
                  closeAccountSheet();
                }}
                onDone={() => void signedIn()}
                onError={(error) => {
                  setBusy(null);
                  setProblem(walletProblem(error));
                  openAccountSheet();
                }}
              />
            ) : null}
          </Suspense>
        </div>
        <Problem problem={problem} className="empty:-mt-4" />
        <p className="text-[13px] leading-5 text-game-muted [text-wrap:pretty]">
          Google makes a NEAR account for you; no wallet or crypto needed. Your hero in this browser stays put, and the first time you sign in you can bring it along.
        </p>
        {devOn ? (
          <form onSubmit={(e) => void playAsTestPlayer(e)} className="flex flex-col gap-2 border-t-2 border-dashed border-game-ink/30 pt-4">
            <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
              <TestTube aria-hidden className="size-4" strokeWidth={2} />
              Local development
            </p>
            <label htmlFor={`${ids}-dev`} className="text-[14px] font-semibold leading-5">
              Test handle
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id={`${ids}-dev`}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={31}
                value={devHandle}
                onChange={(e) => setDevHandle(e.target.value)}
                className="h-11 w-full min-w-0 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 text-[16px] font-semibold text-game-ink sm:w-auto sm:flex-1"
              />
              <StickerButton type="submit" size="sm" aria-disabled={(busy !== null && busy !== "dev") || undefined} aria-busy={busy === "dev" || undefined}>
                {busy === "dev" ? "Signing in…" : "Play as a test player"}
              </StickerButton>
            </div>
          </form>
        ) : null}
      </div>
    );
  } else {
    body = (
      <p role="status" className="text-[14px] text-game-muted">
        Checking who’s signed in…
      </p>
    );
  }

  return (
    <GameSheet open={open} onClose={close} eyebrow="Account" title={title} description={description} footer={footer}>
      {mounted ? body : null}
    </GameSheet>
  );
}
