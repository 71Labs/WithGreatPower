"use client";

/**
 * The account sheet's X section: an optional X handle and the choice to be tagged when
 * you place on a board, off until you tick it. The handle is your word for it (nothing
 * checks the X account is yours), and every post is written and sent by a person on the
 * WGP team; nothing posts on its own. Checks run on save; the error shows under the field.
 */
import { useId, useRef, useState, type FormEvent } from "react";

import { StickerButton } from "@/components/game/kit";
import { CircleAlert, XLogo } from "@/components/icons";
import { refreshAccount, showToast } from "@/game/store";
import { removeXProfile, saveXProfile, type Me } from "@/lib/api/client";
import { X_HANDLE_MAX, normalizeXHandle } from "@/lib/social/x";

export function XHandleSection({ me }: { me: Me }) {
  const saved = me.social ?? { xHandle: null, xTagOk: false, verified: false };
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [handle, setHandle] = useState(saved.xHandle ?? "");
  const [tagOk, setTagOk] = useState(saved.xTagOk);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "remove">(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const checked = normalizeXHandle(handle);
    if (!checked.ok) {
      setError(checked.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setBusy("save");
    const res = await saveXProfile({ xHandle: checked.handle, xTagOk: tagOk });
    setBusy(null);
    if (!res.ok) {
      setError(res.status === 0 ? "Couldn’t reach the server. Try again." : (res.message ?? "Couldn’t save your handle. Try again."));
      return;
    }
    setHandle(res.data.social.xHandle ?? "");
    setTagOk(res.data.social.xTagOk);
    await refreshAccount();
    showToast(res.data.social.xTagOk ? `Saved @${res.data.social.xHandle}. We may tag you when you place.` : `Saved @${res.data.social.xHandle}. Tags stay off.`, "success");
  }

  async function remove() {
    if (busy) return;
    setBusy("remove");
    const res = await removeXProfile();
    setBusy(null);
    if (!res.ok) {
      setError(res.status === 0 ? "Couldn’t reach the server. Try again." : "Couldn’t remove your handle. Try again.");
      return;
    }
    setHandle("");
    setTagOk(false);
    setError(null);
    await refreshAccount();
    showToast("Removed your X handle. Nobody will tag you.");
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-3.5">
      <h3 id={`${ids}-title`} className="flex items-center gap-1.5 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
        <XLogo aria-hidden className="size-4" strokeWidth={2} />
        On X
      </h3>
      <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-x`} className="text-[14px] font-semibold leading-5">
            Your X handle
          </label>
          <div className="flex min-h-11 items-center rounded-[12px] border-2 border-game-ink bg-game-paper focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--vs-focus)]">
            <span aria-hidden className="pl-3 text-[16px] font-semibold text-game-muted">
              @
            </span>
            <input
              ref={inputRef}
              id={`${ids}-x`}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={X_HANDLE_MAX + 1}
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${ids}-x-help`}
              className="h-11 min-w-0 flex-1 rounded-r-[10px] bg-transparent pl-0.5 pr-3 text-[16px] font-semibold text-game-ink outline-none"
            />
          </div>
          <p id={`${ids}-x-help`} className={`flex items-start gap-1.5 text-[13px] leading-5 ${error ? "text-game-ink" : "text-game-muted"}`}>
            {error ? <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-game-hero" strokeWidth={2} /> : null}
            <span>{error ?? `Optional. Up to ${X_HANDLE_MAX} letters, numbers or _. We take your word for it: nobody checks the account is yours.`}</span>
          </p>
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={tagOk}
            onChange={(e) => setTagOk(e.target.checked)}
            aria-describedby={`${ids}-tag-help`}
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--game-ink)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold leading-5">Tag me on X when I place on a board</span>
            <span id={`${ids}-tag-help`} className="text-[13px] leading-5 text-game-muted [text-wrap:pretty]">
              Off unless you tick it. A person on the WGP team writes and sends every post; nothing posts on its own.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <StickerButton type="submit" variant="ink" size="sm" aria-busy={busy === "save" || undefined} aria-disabled={busy !== null || undefined}>
            {busy === "save" ? "Saving…" : "Save X handle"}
          </StickerButton>
          {saved.xHandle ? (
            <StickerButton size="sm" onClick={() => void remove()} aria-busy={busy === "remove" || undefined} aria-disabled={busy !== null || undefined}>
              {busy === "remove" ? "Removing…" : "Remove my handle"}
            </StickerButton>
          ) : null}
        </div>
      </form>
    </section>
  );
}
