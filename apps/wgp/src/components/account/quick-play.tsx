"use client";

/**
 * Quick play in the account sheet: whether this browser can put the hero, crafting and
 * suit changes on NEAR without a popup each time, and the one approval that turns it on.
 *
 * - Wallet players: the wallet adds a function-call key, limited to the game contract
 *   with no deposit allowed (lib/near/wallet.tsx), and the server records it.
 * - Google players on a new device: NEAR Auth (a popup) or, for players who signed in
 *   through Privy, their Privy NEAR key (no popup) signs the same key; our relayer adds it.
 *
 * The state (on, off, pending) comes from src/game/chain.ts. The account sheet loads this
 * module only when it opens for a signed-in player, so near-connect never weighs on the
 * game's own pages. Wallet popups draw over the page, so the sheet steps aside first.
 */
import { useEffect, useState, type ReactNode } from "react";

import { StickerButton } from "@/components/game/kit";
import { Check, CircleAlert, CircleDashed, ExternalLink, Hourglass, Zap, type Icon } from "@/components/icons";
import { ensureHeroOnChain, refreshChain, setEnabling, useChain, type ChainView } from "@/game/chain";
import { showToast } from "@/game/store";
import type { Me } from "@/lib/api/client";
import { EXPLORER_URL } from "@/lib/near/config";
import { QUICK_PLAY_LABEL, type QuickPlay } from "@/lib/near/quick-play";
import { WalletProvider, recordWalletSessionKey, useWallet } from "@/lib/near/wallet";

import { quickPlayProblem, type SignInProblem } from "./errors";
import { closeAccountSheet, openAccountSheet } from "./sheet-state";

const CHIP: Record<QuickPlay["state"], { icon: Icon; className: string }> = {
  on: { icon: Check, className: "bg-game-ink text-game-paper" },
  pending: { icon: Hourglass, className: "bg-game-gold text-game-ink" },
  off: { icon: CircleDashed, className: "bg-game-paper text-game-ink" },
  unavailable: { icon: CircleDashed, className: "bg-game-paper text-game-muted" },
};

function StateChip({ state }: { state: QuickPlay["state"] }) {
  const { icon: StateIcon, className } = CHIP[state];
  return (
    <span className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[12px] font-bold uppercase tracking-[0.04em] ${className}`}>
      <StateIcon aria-hidden className="size-3.5" strokeWidth={2.75} />
      {QUICK_PLAY_LABEL[state]}
    </span>
  );
}

function Shell({ state, children }: { state: QuickPlay["state"] | null; children: ReactNode }) {
  return (
    // 26px corners around 12px padding: concentric with the 14px buttons inside.
    <section aria-labelledby="quick-play-title" className="flex flex-col gap-3 rounded-[26px] border-2 border-game-ink bg-game-paper-2 p-3 [&>p]:px-1">
      <div className="flex items-center justify-between gap-3 pl-1">
        <h3 id="quick-play-title" className="flex items-center gap-1.5 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          <Zap aria-hidden className="size-4" strokeWidth={2} />
          Quick play
        </h3>
        {state ? <StateChip state={state} /> : null}
      </div>
      {children}
    </section>
  );
}

const Text = ({ children }: { children: ReactNode }) => <p className="text-[14px] leading-5 text-game-ink [text-wrap:pretty]">{children}</p>;

function Problem({ problem }: { problem: SignInProblem | null }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {problem ? (
        <p className="flex items-start gap-2 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 py-2 text-[13px] leading-5 text-game-ink">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-game-hero" strokeWidth={2} />
          <span className="[text-wrap:pretty]">{problem.text}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Where the hero stands on chain, once quick play is on. */
function HeroLine({ chain }: { chain: ChainView }) {
  const hero = chain.status?.hero;
  if (!hero || hero.status === "none") return null;
  if (hero.status === "queued") return <p className="text-[13px] leading-5 text-game-muted">Your hero goes on NEAR with your next change.</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-[13px] leading-5 text-game-muted">
      <span>Your hero is on NEAR.</span>
      {hero.txHash ? (
        <a
          href={`${EXPLORER_URL}/txns/${encodeURIComponent(hero.txHash)}`}
          target="_blank"
          rel="noreferrer"
          className="-my-2.5 inline-flex min-h-11 items-center gap-1 rounded-full px-1 font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
        >
          View the transaction
          <ExternalLink aria-hidden className="size-3.5" strokeWidth={2} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </p>
  );
}

/** What "Enable quick play" does, for whichever sign-in the player used. */
function useEnable(me: Me, setProblem: (p: SignInProblem | null) => void) {
  const [busy, setBusy] = useState(false);

  async function run(steps: () => Promise<void>, stepAside: boolean) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setEnabling(true);
    if (stepAside) closeAccountSheet();
    try {
      await steps();
      setEnabling(false);
      await refreshChain(me.player);
      showToast("Quick play is on. Your hero, crafting and suit changes now go on NEAR.", "success");
      void ensureHeroOnChain();
    } catch (error) {
      setEnabling(false);
      void refreshChain(me.player);
      setProblem(quickPlayProblem(error));
      if (stepAside) openAccountSheet();
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

function WalletActions({ me, pendingKey, setProblem }: { me: Me; pendingKey: string | null; setProblem: (p: SignInProblem | null) => void }) {
  const wallet = useWallet();
  const { busy, run } = useEnable(me, setProblem);
  const enable = () => run(async () => void (await wallet.enableQuickPlay(me.player.nearAccountId)), true);
  const finish = (key: string) => run(() => recordWalletSessionKey(key), false);

  if (pendingKey && !busy) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <StickerButton variant="hero" className="w-full sm:flex-1" onClick={() => void finish(pendingKey)}>
          <Zap aria-hidden className="size-5" strokeWidth={2} />
          Finish setup
        </StickerButton>
        <StickerButton className="w-full sm:flex-1" aria-disabled={!wallet.ready || undefined} onClick={() => wallet.ready && void enable()}>
          Start over
        </StickerButton>
      </div>
    );
  }
  return (
    <StickerButton
      variant="hero"
      className="w-full"
      aria-disabled={!wallet.ready || busy || undefined}
      aria-busy={busy || undefined}
      onClick={() => wallet.ready && !busy && void enable()}
    >
      <Zap aria-hidden className="size-5" strokeWidth={2} />
      {busy ? "Waiting for your wallet…" : wallet.ready ? "Enable quick play" : "Loading wallet…"}
    </StickerButton>
  );
}

function GoogleActions({ me, setProblem }: { me: Me; setProblem: (p: SignInProblem | null) => void }) {
  const { busy, run } = useEnable(me, setProblem);
  const enable = () =>
    run(async () => {
      const { addSessionKeyWithNearAuth } = await import("@/lib/near/near-auth");
      await addSessionKeyWithNearAuth(me.player.nearAccountId);
    }, false);
  return (
    <StickerButton variant="hero" className="w-full" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => !busy && void enable()}>
      <Zap aria-hidden className="size-5" strokeWidth={2} />
      {busy ? "Waiting for Google…" : "Enable quick play"}
    </StickerButton>
  );
}

function PrivyActions({ me, setProblem }: { me: Me; setProblem: (p: SignInProblem | null) => void }) {
  const { busy, run } = useEnable(me, setProblem);
  const enable = () =>
    run(async () => {
      const { addSessionKeyWithPrivy } = await import("@/lib/privy/sign-in");
      await addSessionKeyWithPrivy(me.player.nearAccountId);
    }, false);
  return (
    <StickerButton variant="hero" className="w-full" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => !busy && void enable()}>
      <Zap aria-hidden className="size-5" strokeWidth={2} />
      {busy ? "Adding the key…" : "Enable quick play"}
    </StickerButton>
  );
}

export default function QuickPlaySection({ me }: { me: Me }) {
  const chain = useChain();
  const [problem, setProblem] = useState<SignInProblem | null>(null);

  useEffect(() => {
    void refreshChain(me.player);
  }, [me.player]);

  const mine = chain.owner?.id === me.player.id;
  if (!mine || !chain.loaded) {
    return (
      <Shell state={null}>
        <p role="status" className="text-[14px] leading-5 text-game-muted">
          Checking quick play…
        </p>
      </Shell>
    );
  }

  const qp = chain.quickPlay;
  if (qp.state === "unavailable") {
    // Test players have no account on NEAR, and unclaimed ones see "Claim your name" instead.
    if (qp.reason === "test-account" || qp.reason === "unclaimed") return null;
    return (
      <Shell state="unavailable">
        <Text>This server isn’t connected to NEAR yet, so suit changes are saved here but not put on chain.</Text>
      </Shell>
    );
  }

  if (qp.state === "on") {
    return (
      <Shell state="on">
        <Text>Your hero, crafting, suit changes and market trades go on NEAR with no popups. The game pays the gas.</Text>
        <HeroLine chain={chain} />
      </Shell>
    );
  }

  const wallet = me.player.authKind === "wallet";
  const privy = me.player.authKind === "privy";
  const pendingKey = qp.state === "pending" && !chain.enabling ? qp.publicKey : null;
  return (
    <Shell state={qp.state}>
      <Text>
        {pendingKey
          ? "The key is on your account. Finish setup to start using it; no new approval needed."
          : `Crafting and suit changes are saved, not yet on chain, and the market needs quick play to trade. ${privy ? "Turning it on adds" : `One ${wallet ? "wallet" : "Google"} approval adds`} a key for this browser that can only play this game: it can’t move your tokens or NEAR.`}
      </Text>
      {wallet ? (
        <WalletProvider>
          <WalletActions me={me} pendingKey={pendingKey} setProblem={setProblem} />
        </WalletProvider>
      ) : privy ? (
        <PrivyActions me={me} setProblem={setProblem} />
      ) : (
        <GoogleActions me={me} setProblem={setProblem} />
      )}
      <Problem problem={problem} />
    </Shell>
  );
}
