"use client";

import Link from "next/link";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Check, Copy, Clock, ShieldCheck, TriangleAlert } from "@/components/icons";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium select-none " +
  "transition-[background-color,border-color] duration-200 ease-out " +
  "motion-safe:transition-[scale,background-color,border-color] motion-safe:active:scale-[0.97] " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-[image:var(--button-solid)] text-on-inverse shadow-[var(--shadow-button)] hover:bg-[image:var(--button-solid-hover)]",
  secondary: "bg-canvas text-ink-strong shadow-[var(--shadow-chip)] hover:bg-surface",
  ghost: "text-ink hover:bg-surface-2",
};

const sizes: Record<Size, string> = {
  md: "h-10 px-4 text-[14px] leading-[16px] pointer-coarse:h-11",
  lg: "h-13 px-7 text-[16px] leading-[18px] tracking-[-0.01em]",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

type Tone = "success" | "warning" | "danger" | "neutral";

const tones: Record<Tone, string> = {
  success: "bg-success-fill text-on-success",
  warning: "bg-warning-fill text-on-warning",
  danger: "bg-danger-fill text-on-danger",
  neutral: "bg-surface-2 text-ink",
};

const toneIcons: Record<Tone, ReactNode> = {
  success: <ShieldCheck aria-hidden className="size-3.5" strokeWidth={2} />,
  warning: <Clock aria-hidden className="size-3.5" strokeWidth={2} />,
  danger: <TriangleAlert aria-hidden className="size-3.5" strokeWidth={2} />,
  neutral: null,
};

/** Status is never color alone: every badge carries an icon and a label. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-chip px-2 text-[12px] font-medium leading-4 ${tones[tone]}`}
    >
      {toneIcons[tone]}
      {children}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="relative grid size-8 shrink-0 place-items-center rounded-control text-ink-subtle hover:bg-surface-2 hover:text-ink-strong motion-safe:transition-[scale] motion-safe:duration-200 motion-safe:ease-out motion-safe:active:scale-[0.95] pointer-coarse:size-11"
    >
      <Copy
        aria-hidden
        className={`col-start-1 row-start-1 size-4 motion-safe:transition-[opacity,scale,filter] motion-safe:duration-200 motion-safe:ease-out ${copied ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-[0px]"}`}
      />
      <Check
        aria-hidden
        className={`col-start-1 row-start-1 size-4 text-on-success motion-safe:transition-[opacity,scale,filter] motion-safe:duration-200 motion-safe:ease-out ${copied ? "scale-100 opacity-100 blur-[0px]" : "scale-25 opacity-0 blur-[4px]"}`}
      />
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  id,
  ...input
}: ComponentProps<"input"> & { label: string; hint?: string; error?: string; id: string }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium leading-4 text-ink-strong">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="num h-10 rounded-control border border-control-border bg-canvas px-3 text-[15px] pointer-coarse:h-11 text-ink-strong placeholder:text-ink-subtle aria-invalid:border-on-danger"
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="text-[12px] leading-4 text-on-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12px] leading-4 text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
