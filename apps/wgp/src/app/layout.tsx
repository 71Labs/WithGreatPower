import type { Metadata } from "next";

import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "With Great Power — a friendly neighborhood parody on NEAR", template: "%s · With Great Power" },
  description:
    "With Great Power (WGP) is a superhero parody game on NEAR. Get bitten by a radioactive validator, pick your powers and swing across the city to stop the villains draining its treasury.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={fontVariables}>
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
