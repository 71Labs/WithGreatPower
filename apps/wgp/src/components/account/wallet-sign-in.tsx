"use client";

/**
 * "Use a NEAR wallet": near-connect plus a NEP-413 signature over a server nonce
 * (src/lib/near/wallet.tsx → POST /api/auth/wallet). The account sheet loads this module
 * only once it opens, so near-connect never weighs on the game's own pages.
 *
 * near-connect draws its wallet picker as a page overlay, which a modal sheet would
 * cover, so `onStart` runs first and the sheet steps aside.
 */
import { Wallet } from "@/components/icons";
import { StickerButton, type StickerVariant } from "@/components/game/kit";
import { WalletProvider, useWallet } from "@/lib/near/wallet";

interface Props {
  variant: StickerVariant;
  /** Another sign-in is under way. */
  busy: boolean;
  onStart: () => void;
  onDone: (accountId: string) => void;
  onError: (error: unknown) => void;
}

export default function WalletSignIn(props: Props) {
  return (
    <WalletProvider>
      <WalletButton {...props} />
    </WalletProvider>
  );
}

function WalletButton({ variant, busy, onStart, onDone, onError }: Props) {
  const wallet = useWallet();

  async function run(another: boolean) {
    if (!wallet.ready || busy) return;
    onStart();
    try {
      const account = another ? await wallet.connect() : undefined;
      if (another && !account) throw new Error("No wallet account was picked");
      onDone(await wallet.signIn(account ?? undefined));
    } catch (error) {
      onError(error);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <StickerButton variant={variant} size="lg" className="w-full" aria-disabled={!wallet.ready || busy || undefined} onClick={() => void run(false)}>
        <Wallet aria-hidden className="size-5" strokeWidth={2} />
        {wallet.ready ? "Use a NEAR wallet" : "Loading wallets…"}
      </StickerButton>
      {wallet.ready && wallet.accountId ? (
        <p className="flex flex-wrap items-center justify-center gap-x-1 text-center text-[13px] leading-5 text-game-muted">
          <span>
            Connected as <span className="font-semibold text-game-ink [overflow-wrap:anywhere]">{wallet.accountId}</span>.
          </span>
          <button
            type="button"
            onClick={() => void run(true)}
            className="inline-flex min-h-11 items-center rounded-full px-2 font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
          >
            Use another wallet
          </button>
        </p>
      ) : null}
    </div>
  );
}
