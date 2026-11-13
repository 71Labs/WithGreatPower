import type { Metadata, Viewport } from "next";

import { SHARE_DESCRIPTION, SITE_DESCRIPTION } from "@/components/landing/copy";
import { SITE_URL } from "@/lib/site";

import { FontPreload } from "./font-preload";
import { fontVariables } from "./fonts";
import "./globals.css";

const TITLE = "With Great Power — a friendly neighborhood parody on NEAR";
const SHARE_TITLE = "With Great Power: free 3D web-swinging in your browser";

/**
 * Every page shares as a large card: the image is src/app/opengraph-image.jpg (1200×630, a
 * frame of real play), which Next links for each route that doesn't bring its own (a run's
 * page and an invite do). A page that sets its own `openGraph` or `twitter` replaces these.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · With Great Power" },
  description: SITE_DESCRIPTION,
  applicationName: "With Great Power",
  openGraph: { type: "website", siteName: "With Great Power", title: SHARE_TITLE, description: SHARE_DESCRIPTION },
  twitter: { card: "summary_large_image", site: "@wgponnear", title: SHARE_TITLE, description: SHARE_DESCRIPTION },
  appleWebApp: { capable: true, title: "WGP", statusBarStyle: "black-translucent" },
};

/** The browser's bars take the page's colour: the website’s page colour in each theme; the game’s own pages set the night sky. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0d" },
  ],
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
