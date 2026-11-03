import type { Metadata } from "next";

import { FontPreload } from "./font-preload";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "With Great Power — a friendly neighborhood parody on NEAR", template: "%s · With Great Power" },
  description:
    "With Great Power (WGP) is a 3D web-swinging superhero parody game on NEAR. Swing across a comic-book city at night, stop four parody villains, and climb leaderboards where every ranked night is replayed on the server.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={fontVariables}>
      <head>
        {/* The two weights every page sets above the fold: body text, and the semibold labels and buttons. */}
        <FontPreload weight="Regular" />
        <FontPreload weight="Bold" />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-[80] rounded-control bg-inverse px-4 py-2 text-on-inverse focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
