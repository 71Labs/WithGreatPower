import { Geist_Mono, Inter, Manrope } from "next/font/google";

/** UI text. */
export const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

/** Display headlines: set at 500 with tight tracking. */
export const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["500", "600"], display: "swap" });

/** Addresses, hashes and amounts in tables. */
export const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const fontVariables = `${inter.variable} ${manrope.variable} ${geistMono.variable}`;
