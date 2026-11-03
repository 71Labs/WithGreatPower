"use client";

/**
 * The handle input with its account suffix (`<handle>.<parent>`), shared by the new
 * Google player's handle step and "Claim your name". Checks run on submit
 * (`handleProblem`); the error shows under the field and is announced with it.
 */
import type { RefObject } from "react";

import { CircleAlert } from "@/components/icons";
import { HANDLE_RE, RESERVED_HANDLES } from "@/lib/near/policy";

/** What's wrong with a handle, in words, or null. Pure. */
export function handleProblem(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  if (!h) return "Pick a handle.";
  if (!HANDLE_RE.test(h)) return "Use 2–32 of a–z, 0–9, - and _, starting and ending with a letter or digit.";
  if (RESERVED_HANDLES.has(h)) return "That handle is reserved. Pick another.";
  return null;
}

export function HandleField({
  id,
  value,
  onChange,
  error,
  parentId,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  /** The account parent, e.g. "wgpnear.near". */
  parentId: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-input`} className="text-[14px] font-semibold leading-5">
        Handle
      </label>
      <div className="flex min-h-12 items-center rounded-[14px] border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--vs-focus)]">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          className="h-11 min-w-0 flex-1 rounded-l-[12px] bg-transparent pl-3.5 text-[16px] font-semibold text-game-ink outline-none"
        />
        <span aria-hidden className="shrink-0 pr-3.5 font-mono text-[14px] text-game-muted">
          .{parentId}
        </span>
      </div>
      <p id={`${id}-help`} className={`flex items-start gap-1.5 text-[13px] leading-5 ${error ? "text-game-ink" : "text-game-muted"}`}>
        {error ? <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-game-hero" strokeWidth={2} /> : null}
        <span>
          {error ?? "2–32 characters: a–z, 0–9, - and _."} Your account will be{" "}
          <span className="font-mono [overflow-wrap:anywhere]">{(value.trim().toLowerCase() || "handle") + "." + parentId}</span>.
        </span>
      </p>
    </div>
  );
}
