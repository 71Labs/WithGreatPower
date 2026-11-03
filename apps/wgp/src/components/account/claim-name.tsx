"use client";

/**
 * "Claim your name", in the account sheet, for a Google player who signed up through
 * Privy before our account factory was live: they play on their key's implicit account
 * id, with their rewards held. Once names open (GET /api/auth/privy/claim says `open`),
 * one tap creates `<handle>.<parent>` with their Google key and this browser's session
 * key, and moves the hero, rank and held rewards onto it. Loaded only for these players.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { StickerButton } from "@/components/game/kit";
import { CircleAlert, CircleDashed, Hourglass, Tag, type Icon } from "@/components/icons";
import { refreshChain } from "@/game/chain";
import { refreshAccount, showToast } from "@/game/store";
import { getClaimInfo, type ClaimInfo, type Me } from "@/lib/api/client";
import { PLAYER_PARENT_ID } from "@/lib/near/config";

import { claimProblem, type SignInProblem } from "./errors";
import { HandleField, handleProblem } from "./handle-field";

type Load = { state: "loading" } | { state: "ready"; info: ClaimInfo } | { state: "failed" };

const CHIP: Record<"open" | "soon", { icon: Icon; label: string; className: string }> = {
  open: { icon: Tag, label: "Open", className: "bg-game-gold text-game-ink" },
  soon: { icon: Hourglass, label: "Soon", className: "bg-game-paper text-game-ink" },
};

function Shell({ chip, children }: { chip: "open" | "soon" | null; children: ReactNode }) {
  const c = chip ? CHIP[chip] : null;
  return (
    // 26px corners around 12px padding: concentric with the 14px controls inside.
    <section aria-labelledby="claim-name-title" className="flex flex-col gap-3 rounded-[26px] border-2 border-game-ink bg-game-paper-2 p-3 [&>p]:px-1">
      <div className="flex items-center justify-between gap-3 pl-1">
        <h3 id="claim-name-title" className="flex items-center gap-1.5 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          <Tag aria-hidden className="size-4" strokeWidth={2} />
          Your NEAR name
        </h3>
        {c ? (
          <span className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[12px] font-bold uppercase tracking-[0.04em] ${c.className}`}>
            <c.icon aria-hidden className="size-3.5" strokeWidth={2.75} />
            {c.label}
          </span>
        ) : null}
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

export default function ClaimNameSection({ me }: { me: Me }) {
  const ids = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const playerId = me.player.id;

  useEffect(() => {
    const ctrl = new AbortController();
    getClaimInfo(ctrl.signal)
      .then((res) => {
        if (!res.ok) return setLoad({ state: "failed" });
        setLoad({ state: "ready", info: res.data });
        setHandle((h) => h || res.data.suggestedHandle || "");
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [playerId]);

  async function claim(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const local = handleProblem(handle);
    setHandleError(local);
    if (local) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { claimPrivyName } = await import("@/lib/privy/sign-in");
      const done = await claimPrivyName(handle.trim().toLowerCase());
      const next = await refreshAccount();
      if (next.status === "signed-in") void refreshChain(next.me.player);
      showToast(`Your name is ${done.accountId}. Your hero and rewards came with you.`, "success");
    } catch (error) {
      const p = claimProblem(error);
      setBusy(false);
      if (p.handle) {
        setHandleError(p.text);
        inputRef.current?.focus();
        return;
      }
      if (p.claimed) void refreshAccount();
      if (p.closed && load.state === "ready") setLoad({ state: "ready", info: { ...load.info, open: false } });
      setProblem(p);
    }
  }

  if (load.state === "loading") {
    return (
      <Shell chip={null}>
        <p role="status" className="text-[14px] leading-5 text-game-muted">
          Checking your name…
        </p>
      </Shell>
    );
  }

  if (load.state === "failed" || !load.info.open) {
    return (
      <Shell chip="soon">
        <Text>Your hero, rank and rewards are saved to your Google sign-in. When NEAR names open here, you’ll claim yours and everything comes with it.</Text>
        {load.state === "failed" ? (
          <p className="flex items-start gap-1.5 text-[13px] leading-5 text-game-muted">
            <CircleDashed aria-hidden className="mt-px size-4 shrink-0" strokeWidth={2} />
            <span>Couldn’t check whether names are open. Open your account again in a moment.</span>
          </p>
        ) : null}
        <Problem problem={problem} />
      </Shell>
    );
  }

  const parentId = load.info.parentId ?? PLAYER_PARENT_ID;
  return (
    <Shell chip="open">
      <Text>Names are open. Pick yours: it becomes your NEAR account, and your hero, rank and the rewards you’ve earned move onto it. It can’t be changed later.</Text>
      <form onSubmit={(e) => void claim(e)} noValidate className="flex flex-col gap-3">
        <HandleField
          id={`${ids}-claim`}
          value={handle}
          onChange={(next) => {
            setHandle(next);
            if (handleError) setHandleError(null);
          }}
          error={handleError}
          parentId={parentId}
          inputRef={inputRef}
        />
        <StickerButton variant="hero" type="submit" className="w-full" aria-busy={busy || undefined}>
          <Tag aria-hidden className="size-5" strokeWidth={2} />
          {busy ? "Claiming your name…" : "Claim my name"}
        </StickerButton>
      </form>
      <Problem problem={problem} />
    </Shell>
  );
}
