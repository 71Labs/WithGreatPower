/* eslint-disable @next/next/no-img-element -- local brand SVGs, already optimised */
import type { ReactNode } from "react";

/**
 * The real marks of what WGP is built on, from each project's own brand assets:
 * NEAR (simple-icons), NEAR Intents (intents.near.org), Base (base/brand-kit) and
 * Arbitrum (Offchain Labs docs).
 */
function Mark({ src, darkSrc, alt, className }: { src: string; darkSrc?: string; alt: string; className: string }) {
  if (!darkSrc) return <img src={src} alt={alt} className={className} />;
  return (
    <picture>
      <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />
      <img src={src} alt={alt} className={className} />
    </picture>
  );
}

/** `wide` cells take half the tablet row (the last two), the rest a third. */
function Cell({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <li
      className={`flex h-20 items-center justify-center gap-2.5 bg-canvas px-4 lg:col-span-1 lg:h-24 ${wide ? "sm:col-span-3" : "sm:col-span-2"} ${className}`}
    >
      {children}
    </li>
  );
}

const name = "text-[15px] font-medium leading-5 tracking-[-0.02em] text-ink-strong whitespace-nowrap";

export function BuiltOn() {
  return (
    <div className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-6 lg:grid-cols-[auto_repeat(5,1fr)]">
      <h2
        id="built-on"
        className="col-span-2 flex h-14 items-center bg-canvas px-5 text-[13px] font-normal leading-5 text-ink-subtle sm:col-span-6 lg:col-span-1 lg:h-24 lg:pr-8"
      >
        Built on
      </h2>
      <ul className="contents">
        <Cell>
          <img src="/logos/near.svg" alt="NEAR" className="size-6 dark:invert" />
          <span className={name}>Protocol</span>
        </Cell>
        <Cell>
          <Mark src="/logos/near-intents-light-bg.svg" darkSrc="/logos/near-intents.svg" alt="NEAR Intents" className="h-[17px] w-auto" />
        </Cell>
        <Cell>
          <img src="/logos/near.svg" alt="NEAR" className="size-6 dark:invert" />
          <span className={name}>Chain Signatures</span>
        </Cell>
        <Cell wide>
          <Mark src="/logos/base.svg" darkSrc="/logos/base-white.svg" alt="Base" className="h-[22px] w-auto" />
        </Cell>
        <Cell wide className="max-sm:col-span-2">
          <img src="/logos/arbitrum.svg" alt="" className="size-7" />
          <span className={name}>Arbitrum</span>
        </Cell>
      </ul>
    </div>
  );
}
