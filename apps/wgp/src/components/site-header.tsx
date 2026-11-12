"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type Ref } from "react";
import { Menu, X } from "@/components/icons";

import { NAV, START_URL } from "@/lib/site";
import { COLUMN } from "./frame";
import { StickerLink } from "./game/kit";

/** A small web: four spokes and two rings, the WGP mark. */
export function WebMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1" />
      <path d="M12 6.5 15.9 8.1 17.5 12 15.9 15.9 12 17.5 8.1 15.9 6.5 12 8.1 8.1Z" strokeLinejoin="round" />
    </svg>
  );
}

type LinksProps = { variant: "bar" | "sheet"; onNavigate?: () => void; firstRef?: Ref<HTMLAnchorElement> };

function NavLinks({ variant, onNavigate, firstRef }: LinksProps) {
  return (
    <ul
      className={
        variant === "bar"
          ? "flex items-center gap-0.5 rounded-full bg-canvas p-1 shadow-[var(--shadow-chip)]"
          : "flex flex-col"
      }
    >
      {NAV.map((item, i) => (
        <li key={item.href}>
          <a
            ref={i === 0 ? firstRef : undefined}
            href={item.href}
            onClick={onNavigate}
            className={
              variant === "bar"
                ? "inline-flex h-9 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-medium tracking-[-0.01em] text-ink-subtle hover:bg-surface hover:text-ink-strong pointer-coarse:h-11"
                : "flex h-12 items-center border-b border-hairline text-[17px] leading-6 text-ink"
            }
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // The menu only exists below 768px; close it if the window grows past that.
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-canvas px-4 text-[14px] font-medium text-ink-strong shadow-[var(--shadow-chip)] hover:bg-surface motion-safe:transition-[scale] motion-safe:duration-200 motion-safe:ease-out motion-safe:active:scale-[0.97]"
      >
        <span className="grid size-4 place-items-center">
          <Menu
            aria-hidden
            className={`col-start-1 row-start-1 size-4 motion-safe:transition-[opacity,scale,filter] motion-safe:duration-200 motion-safe:ease-out ${open ? "scale-25 opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-[0px]"}`}
          />
          <X
            aria-hidden
            className={`col-start-1 row-start-1 size-4 motion-safe:transition-[opacity,scale,filter] motion-safe:duration-200 motion-safe:ease-out ${open ? "scale-100 opacity-100 blur-[0px]" : "scale-25 opacity-0 blur-[4px]"}`}
          />
        </span>
        Menu
      </button>
      <div
        id="mobile-menu"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-hairline bg-page shadow-[var(--shadow-overlay)]"
      >
        <nav aria-label="Main" className="flex max-h-[calc(100dvh-4rem)] flex-col gap-8 overflow-y-auto px-4 pb-6 pt-2">
          <NavLinks variant="sheet" onNavigate={close} firstRef={firstLinkRef} />
          <StickerLink href={START_URL} variant="hero" size="md" className="w-full" onClick={close}>
            Play now
          </StickerLink>
        </nav>
      </div>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 bg-page/80 backdrop-blur-xl backdrop-saturate-150">
      <div className={`relative ${COLUMN}`}>
        <div className="flex h-[72px] items-center justify-between gap-4 px-4 sm:px-10 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <Link href="/" className="flex min-h-11 items-center gap-2.5 justify-self-start" aria-label="With Great Power home">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-[10px] bg-[image:var(--tile-solid)] text-on-tile shadow-[var(--shadow-tile)]"
            >
              <WebMark className="size-[18px]" />
            </span>
            <span className="font-display text-[19px] font-medium leading-none tracking-[-0.035em] text-ink-strong">
              <span className="whitespace-nowrap max-sm:hidden md:max-lg:hidden">With Great Power</span>
              <span className="sm:max-md:hidden lg:hidden">WGP</span>
            </span>
          </Link>
          <nav aria-label="Main" className="hidden justify-self-center md:block">
            <NavLinks variant="bar" />
          </nav>
          <div className="hidden justify-self-end md:block">
            <StickerLink href={START_URL} variant="paper" size="sm">
              Play now
            </StickerLink>
          </div>
          {/* Phones: the way in stays in reach while the page scrolls. */}
          <div className="flex items-center gap-2 md:hidden">
            <StickerLink href={START_URL} variant="paper" size="sm">
              Play now
            </StickerLink>
            <MobileMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
