import Link from "next/link";
import type { ReactNode } from "react";

import { FontPreload } from "@/app/font-preload";
import { Frame, Section } from "@/components/frame";
import { Github } from "@/components/icons";
import { SiteHeader, WebMark } from "@/components/site-header";
import { NAV, REPO_URL } from "@/lib/site";

import "./landing.css";

const footerLink =
  "inline-flex h-10 items-center gap-1.5 px-2 underline-offset-4 pointer-coarse:h-11 [@media(hover:hover)]:hover:text-ink-strong [@media(hover:hover)]:hover:underline";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <Frame className="flex min-h-dvh flex-col">
      {/* The landing's headlines are set at 500. */}
      <FontPreload weight="Medium" />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer>
        <Section inner="flex flex-col gap-10 px-4 py-12 sm:px-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 font-display text-[18px] font-semibold leading-6 tracking-[-0.02em] text-ink-strong">
                <WebMark className="size-4" />
                With Great Power
              </span>
              <span className="text-[13px] leading-5 text-ink-subtle">A friendly neighborhood parody, on NEAR.</span>
            </div>
            <nav aria-label="Footer">
              <ul className="-mx-2 flex flex-wrap text-[13px] text-ink-subtle">
                {NAV.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className={footerLink}>
                      {l.label}
                    </a>
                  </li>
                ))}
                <li>
                  <Link href="/stats" className={footerLink}>
                    By the numbers
                  </Link>
                </li>
                <li>
                  <a href={REPO_URL} className={footerLink}>
                    <Github aria-hidden className="size-4" />
                    Source on GitHub
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          <div className="flex flex-col gap-6 border-t border-hairline pt-8 sm:flex-row sm:items-end sm:justify-between">
            <a
              href="https://near.org"
              className="inline-flex min-h-11 items-center gap-3 self-start rounded-[8px] text-[13px] font-medium leading-5 text-ink-subtle [@media(hover:hover)]:hover:text-ink-strong"
            >
              Built on
              <picture>
                <source srcSet="/brand/near-wordmark-paper.svg" media="(prefers-color-scheme: dark)" />
                <img src="/brand/near-wordmark.svg" alt="NEAR" width={92} height={24} className="h-6 w-auto outline-none" />
              </picture>
            </a>
            <p className="max-w-[72ch] text-[12px] leading-[18px] text-ink-subtle">
              Built at NEAR HACKATHON. With Great Power is a parody. Its characters are original designs, and it is not
              affiliated with, endorsed by or sponsored by any comic book publisher or film studio. Nothing here is
              financial advice.
            </p>
          </div>
        </Section>
      </footer>
    </Frame>
  );
}
