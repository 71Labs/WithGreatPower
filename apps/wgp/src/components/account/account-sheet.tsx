"use client";

/**
 * The account sheet. Signed out, it offers Google (NEAR Auth, Plan A), an existing NEAR
 * wallet, and in local development a test player; a new Google player then picks a
 * handle. Signed in, it shows who you are on NEAR, quick play (./quick-play.tsx), today's
 * ranked runs and Sign out.
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
import { HANDLE_RE, RESERVED_HANDLES } from "@/lib/near/policy";

import { googleProblem, walletProblem, type SignInProblem } from "./errors";
import { closeAccountSheet, openAccountSheet, useAccountSheetOpen } from "./sheet-state";

const WalletSignIn = lazy(() => import("./wallet-sign-in"));
/** Quick play pulls in near-connect for wallet players: load it only once a signed-in sheet opens. */
const QuickPlaySection = lazy(() => import("./quick-play"));

/** The NEAR Auth client is heavy (Auth0, near-api-js): load it only when the sheet opens. */
const nearAuth = () => import("@/lib/near/near-auth");

type Busy = null | "google" | "wallet" | "dev" | "handle" | "sign-out";
type Google = { state: "loading" } | { state: "ready" } | { state: "unavailable"; text: string };

const AUTH_LABEL: Record<string, string> = { near_auth: "Google, through NEAR Auth", wallet: "NEAR wallet", dev: "Test sign-in (this computer only)" };

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

function SignedIn({ me, problem }: { me: Me; problem: SignInProblem | null }) {
  const { used, limit } = me.runsToday;
  const left = Math.max(0, limit - used);
  const dev = me.player.authKind === "dev";
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2">
        <Row label="NEAR account">
          <span className="block font-mono text-[14px] leading-5 [overflow-wrap:anywhere]">{me.player.nearAccountId}</span>
          {dev ? (
            <span className="mt-1 block text-[13px] font-medium leading-5 text-game-muted">A test account: it isn’t on NEAR, so nothing is minted to it.</span>
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
      {dev ? null : (
        <Suspense
          fallback={
            <p role="status" className="rounded-[26px] border-2 border-game-ink bg-game-paper-2 px-4 py-3 text-[14px] leading-5 text-game-muted">
              Checking quick play…
            </p>
          }
        >
          <QuickPlaySection me={me} />
        </Suspense>
      )}
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

function handleProblem(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  if (!h) return "Pick a handle.";
  if (!HANDLE_RE.test(h)) return "Use 2–32 of a–z, 0–9, - and _, starting and ending with a letter or digit.";
  if (RESERVED_HANDLES.has(h)) return "That handle is reserved. Pick another.";
  return null;
}

export function AccountSheet() {
  const open = useAccountSheetOpen();
  const account = useAccount();
  const { save } = useGame();
  const ids = useId();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<"options" | "handle">("options");
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [google, setGoogle] = useState<Google>({ state: "loading" });
  const [devOn, setDevOn] = useState(false);
  const [devHandle, setDevHandle] = useState("dev-hero");
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const handleRef = useRef<HTMLInputElement>(null);

  // Render the body (and load its SDKs) only once someone opens the sheet.
  if (open && !mounted) setMounted(true);

  const guest = account.status === "guest";
  const me = account.status === "signed-in" ? account.me : null;

  // Opening as a guest: warm up Google (SDK + a sign-in nonce, so the popup opens straight
  // from the tap) and ask whether dev sign-in is on. Signed in: refresh today's numbers.
  useEffect(() => {
    if (!open) return;
    if (account.status === "signed-in") {
      void refreshAccount();
      return;
    }
    if (account.status !== "guest") return;
    let live = true;
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
  }, [open, account.status]);

  function reset() {
    setStep("options");
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

  async function signedIn() {
    const next = await refreshAccount();
    reset();
    closeAccountSheet();
    if (next.status === "signed-in") showToast(`Signed in as ${next.me.player.handle}.`, "success");
    else showToast("Signed in, but the server didn’t remember it. Try again.", "error");
  }

  async function continueWithGoogle() {
    if (busy || google.state === "unavailable") return;
    setBusy("google");
    setProblem(null);
    try {
      const m = await nearAuth();
      const outcome = await m.nearAuthSignIn();
      if (outcome.status === "needs-handle") {
        setHandle(outcome.suggestedHandle ?? "");
        setStep("handle");
        setBusy(null);
        openAccountSheet();
        requestAnimationFrame(() => handleRef.current?.focus());
        return;
      }
      await signedIn();
    } catch (error) {
      const p = googleProblem(error);
      if (p.googleUnavailable) setGoogle({ state: "unavailable", text: p.text });
      setProblem(p);
      setBusy(null);
      openAccountSheet();
      // A spent nonce: fetch the next one now, so the retry's popup isn't blocked.
      void nearAuth()
        .then((m) => m.prepareNearAuthSignIn())
        .catch(() => {});
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
    try {
      const m = await nearAuth();
      const outcome = await m.nearAuthSignIn({ handle: handle.trim().toLowerCase() });
      if (outcome.status === "needs-handle") throw new Error("The server still needs a handle");
      await signedIn();
    } catch (error) {
      const p = googleProblem(error);
      setBusy(null);
      openAccountSheet();
      if (p.handle) {
        setHandleError(p.text);
        handleRef.current?.focus();
      } else {
        // The login itself has to start over (an expired nonce, a closed server).
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
    await refreshAccount();
    reset();
    closeAccountSheet();
    showToast("Signed out. You’re back on the hero saved in this browser.");
  }

  const googleOut = google.state === "unavailable";

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
        <label htmlFor={`${ids}-handle-input`} className="text-[14px] font-semibold leading-5">
          Handle
        </label>
        <div className="flex min-h-12 items-center rounded-[14px] border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--vs-focus)]">
          <input
            ref={handleRef}
            id={`${ids}-handle-input`}
            type="text"
            inputMode="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              if (handleError) setHandleError(null);
            }}
            aria-invalid={handleError ? true : undefined}
            aria-describedby={`${ids}-handle-help`}
            className="h-11 min-w-0 flex-1 rounded-l-[12px] bg-transparent pl-3.5 text-[16px] font-semibold text-game-ink outline-none"
          />
          <span aria-hidden className="shrink-0 pr-3.5 font-mono text-[14px] text-game-muted">
            .{PLAYER_PARENT_ID}
          </span>
        </div>
        <p id={`${ids}-handle-help`} className={`flex items-start gap-1.5 text-[13px] leading-5 ${handleError ? "text-game-ink" : "text-game-muted"}`}>
          {handleError ? <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-game-hero" strokeWidth={2} /> : null}
          <span>
            {handleError ?? "2–32 characters: a–z, 0–9, - and _."} Your account will be{" "}
            <span className="font-mono [overflow-wrap:anywhere]">
              {(handle.trim().toLowerCase() || "handle") + "." + PLAYER_PARENT_ID}
            </span>
            .
          </span>
        </p>
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
            {busy === "google" ? "Waiting for Google…" : "Continue with Google"}
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
