"use client";

/**
 * Privy, mounted only when the account center asks for it (src/lib/privy/bridge.ts):
 * the provider plus a headless bridge that publishes what the account UI may call. This
 * is the only module that imports @privy-io/react-auth, and it's a lazy chunk, so no
 * page carries the SDK until someone signs in with Google or opens a Privy account.
 *
 * Privy is configured for Google only, and no Ethereum or Solana wallet is ever made:
 * each user gets one NEAR embedded wallet (ed25519, an "extended chain"), created on
 * their first sign-in. Its key owns their NEAR account; Privy signs raw hashes with it.
 */
import { useEffect, useRef } from "react";
import { PrivyProvider, useLoginWithOAuth, useLogout, usePrivy, type PrivyClientConfig, type User } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";

import { PRIVY_APP_ID } from "@/lib/privy/config";
import { PrivyBridgeError, publishPrivy, reportPrivyFailure, type PrivyNearWallet } from "@/lib/privy/bridge";
import { bytesToHex, hexToBytes } from "@/lib/privy/near-key";

const CONFIG: PrivyClientConfig = {
  loginMethods: ["google"],
  appearance: { theme: "light", accentColor: "#d62e21", landingHeader: "Sign in to With Great Power" },
  embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
};

/** The user's Privy NEAR wallet, if they have one. */
function nearWalletOf(user: User | null): PrivyNearWallet | null {
  const wallet = user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "near");
  return wallet && wallet.type === "wallet" ? { address: wallet.address } : null;
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : String(error ?? ""));

function Bridge() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const { initOAuth, state: oauth } = useLoginWithOAuth({
    onError: (error) => reportPrivyFailure(new PrivyBridgeError(messageOf(error) || "Google sign-in didn’t finish", "oauth_failed")),
  });

  // Finishing a returned login can fail without the callback (e.g. Privy unreachable): say so at once.
  const oauthFailed = oauth.status === "error";
  useEffect(() => {
    if (oauthFailed) reportPrivyFailure(new PrivyBridgeError("Google sign-in didn’t finish", "oauth_failed"));
  }, [oauthFailed]);

  // The latest user, for calls made between renders (a wallet made a moment ago).
  const userRef = useRef<User | null>(user);
  const creating = useRef<Promise<PrivyNearWallet> | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    publishPrivy({
      ready,
      authenticated,
      loginWithGoogle: () => initOAuth({ provider: "google" }),
      async ensureNearWallet() {
        const have = nearWalletOf(userRef.current);
        if (have) return have;
        creating.current ??= createWallet({ chainType: "near" })
          .then(({ wallet, user: next }) => {
            userRef.current = next;
            return { address: wallet.address };
          })
          .catch((error: unknown) => {
            // Made meanwhile (another tab): use it.
            const now = nearWalletOf(userRef.current);
            if (now) return now;
            throw new PrivyBridgeError(messageOf(error) || "Couldn’t make your NEAR wallet", "near_wallet_failed");
          })
          .finally(() => {
            creating.current = null;
          });
        return creating.current;
      },
      async accessToken() {
        const token = await getAccessToken();
        if (!token) throw new PrivyBridgeError("You’re not signed in with Google", "privy_not_signed_in");
        return token;
      },
      async signRawHash(address, hash) {
        if (hash.length !== 32) throw new PrivyBridgeError("Only 32-byte hashes are signed", "bad_hash");
        const { signature } = await signRawHash({ address, chainType: "near", hash: `0x${bytesToHex(hash)}` });
        const bytes = hexToBytes(signature);
        if (bytes.length !== 64) throw new PrivyBridgeError("Privy returned an unexpected signature", "bad_signature");
        return bytes;
      },
      logout,
    });
  }, [ready, authenticated, initOAuth, createWallet, getAccessToken, signRawHash, logout]);

  useEffect(() => () => publishPrivy(null), []);
  return null;
}

export default function PrivyHost() {
  useEffect(() => {
    if (!PRIVY_APP_ID) reportPrivyFailure(new PrivyBridgeError("Google sign-in isn’t set up here", "privy_not_configured"));
  }, []);
  if (!PRIVY_APP_ID) return null;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={CONFIG}>
      <Bridge />
    </PrivyProvider>
  );
}
