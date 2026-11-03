import { Geist_Mono, Inter } from "next/font/google";

/**
 * UI text falls back to Inter where Neue Montreal isn't deployed (globals.css). Not preloaded:
 * where it is deployed (production), Neue Montreal is preloaded instead (font-preload.tsx) and
 * Inter is only the stand-in while it loads; elsewhere Inter comes with the stylesheet.
 */
export const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap", preload: false });

/** Addresses, hashes and amounts in tables: never above the fold, so not preloaded. */
export const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap", preload: false });

export const fontVariables = `${inter.variable} ${geistMono.variable}`;

/** Whether this build ships the licensed Neue Montreal files (next.config.ts checks public/fonts). */
export const neueMontreal = process.env.WGP_NEUE_MONTREAL === "1";
