/** Shared by the /gas page's server view and its client form. */
export const textLink =
  "inline-block rounded-[4px] py-0.5 font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 [text-decoration-skip-ink:auto] [text-underline-position:from-font] pointer-fine:hover:decoration-game-ink";

export function nearblocksAccount(accountId: string): string {
  return `https://nearblocks.io/address/${accountId}`;
}
