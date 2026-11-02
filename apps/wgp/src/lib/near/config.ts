/**
 * Public NEAR configuration, safe for the browser. Everything that differs between
 * testnet and mainnet comes from NEXT_PUBLIC_* variables (see .env.example). Server
 * secrets live in src/server/near/env.ts.
 */

export type NearNetwork = "testnet" | "mainnet";

export const NETWORK: NearNetwork = process.env.NEXT_PUBLIC_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

const TLA = NETWORK === "mainnet" ? "near" : "testnet";

/** The game contract (contracts/wgp). Session keys may only call this account. */
export const GAME_CONTRACT_ID = process.env.NEXT_PUBLIC_WGP_CONTRACT_ID ?? `game.wgp.${TLA}`;

/** Player accounts are `<handle>.<parent>`. */
export const PLAYER_PARENT_ID = process.env.NEXT_PUBLIC_WGP_PARENT_ACCOUNT_ID ?? `wgp.${TLA}`;

/** JSON-RPC endpoints, tried in order. FastNEAR first, the public RPC as a fallback. */
export const RPC_URLS: string[] = (
  process.env.NEXT_PUBLIC_NEAR_RPC_URLS ??
  (NETWORK === "mainnet"
    ? "https://rpc.mainnet.fastnear.com,https://rpc.mainnet.near.org"
    : "https://rpc.testnet.fastnear.com,https://rpc.testnet.near.org")
)
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

export const EXPLORER_URL = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

/**
 * NEAR Auth (Google sign-in through Auth0 and the MPC network). On testnet the shared
 * dev client works out of the box. `fast-auth.testnet` is the contract whose guard
 * accepts the shared client's tokens: its router maps `https://login.testnet.fast-auth.com/`
 * to `auth0.jwt.fast-auth.testnet`, the signing audience. `fast-auth-beta-001.testnet`
 * (named on the React SDK page) has no guard for that issuer (checked over RPC, Nov 2).
 */
export const NEAR_AUTH = {
  fastAuthContractId: process.env.NEXT_PUBLIC_NEAR_AUTH_CONTRACT_ID ?? (NETWORK === "mainnet" ? "fast-auth.near" : "fast-auth.testnet"),
  mpcContractId: NETWORK === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet",
  domain: process.env.NEXT_PUBLIC_NEAR_AUTH_DOMAIN ?? (NETWORK === "mainnet" ? "login.auth.near.org" : "login.testnet.fast-auth.com"),
  signingAudience: NETWORK === "mainnet" ? "auth0.jwt.fast-auth.near" : "auth0.jwt.fast-auth.testnet",
  /** Mainnet needs our own approved client id; there is no shared one. */
  clientId: process.env.NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID ?? (NETWORK === "testnet" ? "np8paqIpMWmNbzT4xAvOOapZBjsOpptl" : ""),
  /** MPC domain 1 is Ed25519, the key type NEAR accounts use. */
  ed25519DomainId: 1,
} as const;

/** The MPC derivation path NEAR Auth signs with: `{guard_id}#{sub}`. */
export function nearAuthPath(sub: string, domain: string = NEAR_AUTH.domain): string {
  return `jwt#https://${domain}/#${sub}`;
}

/** The guard id NEAR Auth's `sign` expects for our Auth0 tenant. */
export function nearAuthGuardId(domain: string = NEAR_AUTH.domain): string {
  return `jwt#https://${domain}/`;
}
