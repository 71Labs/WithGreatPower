import type { ReactNode } from "react";

import { Frame, Section } from "@/components/frame";
import { SiteHeader, WebMark } from "@/components/site-header";
import { NAV, REPO_URL } from "@/lib/site";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <Frame className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer>
        <Section inner="flex flex-col gap-8 px-4 py-12 sm:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
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
                    <a href={l.href} className="inline-flex h-10 items-center px-2 hover:text-ink-strong hover:underline">
                      {l.label}
                    </a>
                  </li>
                ))}
                {REPO_URL ? (
                  <li>
                    <a href={REPO_URL} className="inline-flex h-10 items-center px-2 hover:text-ink-strong hover:underline">
                      Source code
                    </a>
                  </li>
                ) : null}
              </ul>
            </nav>
          </div>
          <p className="max-w-[72ch] text-[12px] leading-[18px] text-ink-subtle">
            Built at NEAR HACKATHON. With Great Power is a parody. Its characters are original designs, and it is not
            affiliated with, endorsed by or sponsored by any comic book publisher or film studio. Nothing here is
            financial advice.
          </p>
        </Section>
      </footer>
    </Frame>
  );
}
