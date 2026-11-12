/** Where "Play now" goes. */
export const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_URL ?? "/play";

/**
 * Where the landing's "Play now" goes: the quick start, which puts a new visitor straight into
 * their first night and sends a returning player to Tonight (src/app/play/start). A custom
 * NEXT_PUBLIC_PLAY_URL is used as it is.
 */
export const START_URL = PLAY_URL === "/play" ? "/play/start" : PLAY_URL;

/** The public repository, linked from the footer and the closing call to action. */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/71Labs/WithGreatPower";

/** The production site, for absolute links in metadata, share posts and card images. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.wgponnear.fun").replace(/\/+$/, "");

/** The short form drafted posts use ("wgponnear.fun/r/…"): X links it without the scheme. */
export const SITE_HOST = "wgponnear.fun";

/** A verified run's public page. */
export const runPath = (runId: string) => `/r/${runId}`;

/** The landing page's sections, in page order. */
export const NAV = [
  { href: "#night", label: "How it plays" },
  { href: "#cast", label: "Cast" },
  { href: "#ranked", label: "Leaderboards" },
  { href: "#market", label: "Market" },
  { href: "#near", label: "NEAR" },
] as const;
