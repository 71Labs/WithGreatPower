"use client";

/**
 * Existing NEAR wallets through near-connect (ported from Vessel's lib/wallet.tsx).
 *
 * - `signIn()`: the wallet signs a NEP-413 message over a server nonce; the server checks
 *   it against a full-access key on chain and sets the session cookie.
 * - `enableQuickPlay()`: once, the wallet adds a function-call key (game contract only,
 *   0.05 NEAR allowance) that lives in this browser; after that, game actions are
 *   relayed with no wallet popups. Wallets that refuse fall back to Plan C.
 * - `call()`: a normal wallet transaction, for anything that moves assets (1 yoctoNEAR).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";

import { withRef } from "../referrals/ref";

import { GAME_CONTRACT_ID, NETWORK, RPC_URLS } from "./config";
import { SESSION_KEY_ALLOWANCE, TGAS } from "./policy";
import { bindSessionKey, createSessionKey } from "./session-key";

interface CallOptions {
  /** Defaults to the game contract. */
  receiverId?: string;
  method: string;
  args?: Record<string, unknown>;
  /** In Tgas. Defaults to 30. */
  tgas?: number;
  /** In yoctoNEAR. Transfers need exactly "1". */
  deposit?: string;
}

interface WalletContextValue {
  /** The connected wallet account (not necessarily signed in to our server). */
  accountId: string | null;
  ready: boolean;
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  /** NEP-413 sign-in as `account` (default: the connected one, else pick one). Resolves once the session cookie is set. */
  signIn: (account?: string) => Promise<string>;
  /**
   * Adds a new session key for this browser to the account (one wallet approval) and has
   * the server record it. With `expectedAccountId`, refuses (code "wrong_account") when
   * the wallet is connected as someone else, before asking for anything.
   */
  enableQuickPlay: (expectedAccountId?: string) => Promise<{ publicKey: string }>;
  call: (options: CallOptions) => Promise<unknown>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** A failure with the server's (or our own) error code, for messages a player can act on. */
export class WalletError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

async function postWallet<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/auth/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) throw new WalletError(json.message ?? `Wallet sign-in failed (${res.status})`, json.error ?? `http_${res.status}`);
  return json;
}

/**
 * Has the server record a session key the wallet already added (it checks the key on
 * chain first). The chain can lag the wallet by a block or two, so a key that isn't
 * visible yet is asked about again, a few times.
 */
export async function recordWalletSessionKey(publicKey: string, tries = 4): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await postWallet({ action: "session-key", publicKey });
      return;
    } catch (error) {
      if (attempt >= tries || !(error instanceof WalletError) || error.code !== "key_not_found") throw error;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connectorRef = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The connector touches window and IndexedDB, so load it only in the browser.
      const { NearConnector } = await import("@hot-labs/near-connect");
      const connector = new NearConnector({ network: NETWORK, autoConnect: true, providers: { [NETWORK]: RPC_URLS } });
      connectorRef.current = connector;
      connector.on("wallet:signIn", (e) => setAccountId(e.accounts[0]?.accountId ?? null));
      connector.on("wallet:signOut", () => setAccountId(null));
      try {
        const { accounts } = await connector.getConnectedWallet();
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        // Not connected yet.
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connector = useCallback(() => {
    const c = connectorRef.current;
    if (!c) throw new Error("Wallet is still loading");
    return c;
  }, []);

  const connect = useCallback(async () => {
    const wallet = await connector().connect();
    const accounts = await wallet.getAccounts();
    const id = accounts[0]?.accountId ?? null;
    setAccountId(id);
    return id;
  }, [connector]);

  const disconnect = useCallback(async () => {
    await connectorRef.current?.disconnect();
    setAccountId(null);
  }, []);

  const signIn = useCallback(async (account?: string) => {
    const id = account ?? accountId ?? (await connect());
    if (!id) throw new Error("No wallet account connected");
    const challenge = await postWallet<{ nonce: string; message: string; recipient: string; token: string }>({ action: "nonce", accountId: id });
    const wallet = await connector().wallet();
    const signed = await wallet.signMessage({
      message: challenge.message,
      recipient: challenge.recipient,
      nonce: fromBase64(challenge.nonce),
      signerId: id,
      network: NETWORK,
    });
    if (signed.accountId !== id) throw new Error("The wallet signed with another account");
    // `ref`: the invite code this browser holds, in case the invite cookie was lost.
    const result = await postWallet<{ accountId: string }>(
      withRef({
        action: "verify",
        accountId: id,
        publicKey: signed.publicKey,
        signature: signed.signature,
        token: challenge.token,
      }),
    );
    return result.accountId;
  }, [accountId, connect, connector]);

  const enableQuickPlay = useCallback(async (expectedAccountId?: string) => {
    const id = accountId ?? (await connect());
    if (!id) throw new Error("No wallet account connected");
    if (expectedAccountId && id !== expectedAccountId) {
      throw new WalletError(`Your wallet is connected as ${id}, not ${expectedAccountId}`, "wrong_account");
    }
    const key = await createSessionKey();
    const wallet = await connector().wallet();
    await wallet.signAndSendTransaction({
      signerId: id,
      receiverId: id,
      actions: [
        {
          type: "AddKey",
          params: {
            publicKey: key.publicKey,
            accessKey: { permission: { receiverId: GAME_CONTRACT_ID, allowance: SESSION_KEY_ALLOWANCE.toString(), methodNames: [] } },
          },
        },
      ],
    });
    // Bound first: if recording fails, quick play shows as pending and finishing needs no new approval.
    await bindSessionKey(id);
    await recordWalletSessionKey(key.publicKey);
    return { publicKey: key.publicKey };
  }, [accountId, connect, connector]);

  const call = useCallback(
    async ({ receiverId = GAME_CONTRACT_ID, method, args = {}, tgas = 30, deposit = "0" }: CallOptions) => {
      const wallet = await connector().wallet();
      return wallet.signAndSendTransaction({
        receiverId,
        actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: (BigInt(tgas) * TGAS).toString(), deposit } }],
      });
    },
    [connector],
  );

  const value = useMemo(
    () => ({ accountId, ready, connect, disconnect, signIn, enableQuickPlay, call }),
    [accountId, ready, connect, disconnect, signIn, enableQuickPlay, call],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
