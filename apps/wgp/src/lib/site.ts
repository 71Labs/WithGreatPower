/** Where "Play now" goes. */
export const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_URL ?? "/play";

/** The public repository, linked from the footer and the closing call to action. */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/71Labs/WithGreatPower";

/** The landing page's sections, in page order. */
export const NAV = [
  { href: "#night", label: "How it plays" },
  { href: "#cast", label: "Cast" },
  { href: "#ranked", label: "Leaderboards" },
  { href: "#market", label: "Market" },
  { href: "#near", label: "NEAR" },
] as const;
