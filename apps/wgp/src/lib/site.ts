/** Where "Play now" goes. An empty NEXT_PUBLIC_PLAY_URL counts as unset. */
export const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_URL?.trim() || "/play";

/**
 * The quick start for a play URL: /play/start, which puts a new visitor straight into their
 * first night and sends a returning player to Tonight (src/app/play/start). Any spelling of
 * the game's front door gets it: "/play", "/play/", "/play?ref=x", "https://host/play". A URL
 * that points somewhere else (another path, or already the quick start) is used as it is.
 */
export function startUrl(playUrl: string): string {
  const m = /^((?:https?:)?\/\/[^/?#]+)?\/play\/?([?#].*)?$/i.exec(playUrl.trim());
  return m ? `${m[1] ?? ""}/play/start${m[2] ?? ""}` : playUrl;
}

/** Where the landing's "Play now" goes. */
export const START_URL = startUrl(PLAY_URL);

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
