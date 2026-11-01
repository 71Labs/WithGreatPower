/** Where "Play now" goes. */
export const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_URL ?? "/play";

/** Public repository, shown in the footer when set. */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";

export const NAV = [
  { href: "#cast", label: "Cast" },
  { href: "#powers", label: "Powers" },
  { href: "#how", label: "How it works" },
  { href: "#rug", label: "The Daily Rug" },
] as const;
