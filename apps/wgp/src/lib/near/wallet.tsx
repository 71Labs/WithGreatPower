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
  /** NEP-413 sign-in. Resolves with the account once the session cookie is set. */
  signIn: () => Promise<string>;
  /** Adds this browser's session key to the account (one wallet approval). */
  enableQuickPlay: () => Promise<{ publicKey: string }>;
  call: (options: CallOptions) => Promise<unknown>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

async function postWallet<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/auth/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(json.message ?? `Wallet sign-in failed (${res.status})`);
  return json;
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

  const signIn = useCallback(async () => {
    const id = accountId ?? (await connect());
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
    const result = await postWallet<{ accountId: string }>({
      action: "verify",
      accountId: id,
      publicKey: signed.publicKey,
      signature: signed.signature,
      token: challenge.token,
    });
    return result.accountId;
  }, [accountId, connect, connector]);

  const enableQuickPlay = useCallback(async () => {
    const id = accountId ?? (await connect());
    if (!id) throw new Error("No wallet account connected");
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
    await bindSessionKey(id);
    await postWallet({ action: "session-key", publicKey: key.publicKey });
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
