"use client";

/**
 * The parts of "Invite friends" you act on: your link with "Copy link" and "Share on X",
 * the "Got an invite code?" late claim, and the sign-in prompt guests get instead of a
 * link. "Share on X" is X's composer with the post filled in; nothing posts on its own.
 */
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";

import { ON_PAPER, StickerButton, StickerEyebrow, StickerPanel } from "@/components/game/kit";
import { Check, CircleAlert, Copy, Link2 as LinkIcon, LogIn, UserCheck } from "@/components/icons";
import { ShareOnX } from "@/components/social/share-on-x";
import { showToast } from "@/game/store";
import { claimInvite } from "@/lib/referrals/api";
import { inviteShareText } from "@/lib/referrals/code";
import { checkClaimInput, claimProblem } from "@/lib/referrals/view";

/* ------------------------------------------------------------------ copy */

/** Puts `text` on the clipboard. False when the browser refuses (no permission, an insecure page). */
export async function copyText(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The icon swap on "Copy link": the leaving icon shrinks, blurs and fades as the new one grows in. */
const SWAP = "absolute inset-0 motion-safe:transition-[opacity,scale,filter] motion-safe:duration-200 motion-safe:ease-out";

function CopyLinkButton({ link, fieldRef }: { link: string; fieldRef: RefObject<HTMLInputElement | null> }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    if (await copyText(link)) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2400);
      showToast("Link copied. Send it to a friend.", "success");
      return;
    }
    fieldRef.current?.focus();
    fieldRef.current?.select();
    showToast("Couldn’t copy. The link is selected, so copy it from the field.", "error");
  }

  return (
    <StickerButton variant="hero" onClick={() => void copy()} className="w-full sm:w-auto">
      <span aria-hidden className="relative size-5">
        <Copy className={`${SWAP} size-5 ${copied ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-[0px]"}`} strokeWidth={2.25} />
        <Check className={`${SWAP} size-5 ${copied ? "scale-100 opacity-100 blur-[0px]" : "scale-[0.25] opacity-0 blur-[4px]"}`} strokeWidth={3} />
      </span>
      {copied ? "Copied" : "Copy link"}
    </StickerButton>
  );
}

/** Your link in a field (tap to select), "Copy link" and "Share on X". */
export function InviteLinkCard({ link, code }: { link: string; code: string }) {
  const ids = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  return (
    <StickerPanel as="section" aria-labelledby={`${ids}-title`} className={`flex flex-col gap-4 p-4 sm:p-5 ${ON_PAPER}`}>
      <StickerEyebrow as="h2" id={`${ids}-title`}>
        Share your link
      </StickerEyebrow>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-link`} className="text-[14px] font-semibold leading-5 text-game-ink">
          Your invite link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--vs-focus)]">
            <LinkIcon aria-hidden className="size-4 shrink-0 text-game-muted" strokeWidth={2.25} />
            <input
              ref={fieldRef}
              id={`${ids}-link`}
              type="url"
              inputMode="url"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              aria-describedby={`${ids}-code`}
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-game-ink outline-none"
            />
          </div>
          <CopyLinkButton link={link} fieldRef={fieldRef} />
        </div>
        <p id={`${ids}-code`} className="text-[13px] leading-5 text-game-muted [text-wrap:pretty]">
          Your code is <span className="font-mono font-semibold tracking-[0.08em] text-game-ink">{code}</span>. A friend who already signed up can add it on their own Invite friends page, in their first 48 hours.
        </p>
      </div>
      <ShareOnX text={inviteShareText(link)} variant="ink" className="w-full sm:w-auto sm:self-start" />
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ the late claim */

export type ClaimOutcome = { ok: true; referredBy: string } | { ok: false; message: string };

/** One submit of "Got an invite code?": checked here first, then sent. A refusal's message goes under the field. */
export async function submitClaim(raw: string, send: typeof claimInvite = claimInvite): Promise<ClaimOutcome> {
  const input = checkClaimInput(raw);
  if (!input.ok) return { ok: false, message: input.message };
  const res = await send(input.code);
  if (res.ok) return { ok: true, referredBy: res.data.referredBy };
  return { ok: false, message: claimProblem(res) };
}

/** "Got an invite code?": for a player who signed up without the link, in their first 48 hours. */
export function ClaimForm({ onClaimed }: { onClaimed: (referredBy: string) => void }) {
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const outcome = await submitClaim(value);
    setBusy(false);
    if (outcome.ok) {
      setValue("");
      setError(null);
      onClaimed(outcome.referredBy);
      return;
    }
    setError(outcome.message);
    inputRef.current?.focus();
  }

  return (
    <StickerPanel as="section" aria-labelledby={`${ids}-title`} className={`flex flex-col gap-3 p-4 sm:p-5 ${ON_PAPER}`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${ids}-title`} className="text-[18px] font-bold leading-6 tracking-[-0.01em] text-game-ink">
          Got an invite code?
        </h2>
        <p className="text-[14px] leading-5 text-game-muted [text-wrap:pretty]">Signed up without your friend’s link? Add their code and you count for their crew.</p>
      </div>
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-code`} className="text-[14px] font-semibold leading-5 text-game-ink">
          Invite code
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            id={`${ids}-code`}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            placeholder="K7Q2M9X"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-help`}
            className="h-12 min-w-0 flex-1 rounded-[14px] border-2 border-game-ink bg-game-paper px-3 font-mono text-[16px] font-semibold uppercase tracking-[0.12em] text-game-ink placeholder:text-game-muted/60"
          />
          <StickerButton type="submit" variant="ink" aria-busy={busy || undefined} className="w-full sm:w-auto">
            {busy ? "Adding…" : "Add invite code"}
          </StickerButton>
        </div>
        <p id={`${ids}-help`} className={`flex items-start gap-1.5 text-[13px] leading-5 ${error ? "font-medium text-game-ink" : "text-game-muted"}`}>
          {error ? <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-game-hero" strokeWidth={2.25} /> : null}
          <span className="[text-wrap:pretty]">{error ?? "7 letters and numbers. Pasting the whole link works too."}</span>
        </p>
      </form>
    </StickerPanel>
  );
}

/** Shown in place of the claim form once you're in someone's crew. */
export function CrewNote({ referrer }: { referrer: string }) {
  return (
    <StickerPanel as="section" aria-labelledby="crew-note-title" className={`flex items-start gap-3 p-4 sm:p-5 ${ON_PAPER}`}>
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-game-ink">
        <UserCheck className="size-5" strokeWidth={2.25} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id="crew-note-title" className="text-[16px] font-bold leading-5 text-game-ink [overflow-wrap:anywhere]">
          You’re in {referrer}’s crew
        </h2>
        <p className="text-[13px] leading-5 text-game-muted [text-wrap:pretty]">Add your X in your account and play a night, and you count toward their 3.</p>
      </div>
    </StickerPanel>
  );
}

/* ------------------------------------------------------------------ guests */

/** A link needs an account: guests are asked to sign in first. */
export function SignInCard() {
  return (
    <StickerPanel as="section" aria-labelledby="invite-sign-in-title" className={`flex flex-col gap-3 p-4 sm:p-5 ${ON_PAPER}`}>
      <StickerEyebrow as="span">Your invite link</StickerEyebrow>
      <h2 id="invite-sign-in-title" className="text-[20px] font-bold leading-6 tracking-[-0.01em] text-game-ink">
        Sign in to get your link
      </h2>
      <p className="text-[14px] leading-5 text-game-muted [text-wrap:pretty]">
        Your link is tied to your account, so the friends who join through it count for you. Google works; no wallet or crypto needed.
      </p>
      <StickerButton variant="hero" size="lg" onClick={() => window.dispatchEvent(new Event("wgp:sign-in"))} className="w-full sm:w-auto sm:self-start" aria-haspopup="dialog">
        <LogIn aria-hidden className="size-5" strokeWidth={2.25} />
        Sign in
      </StickerButton>
    </StickerPanel>
  );
}
