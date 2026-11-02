/**
 * Server-side NEAR configuration. Every key comes from the environment (Vercel env,
 * never the repo). Each getter checks only what its feature needs and throws
 * NearConfigError naming the missing variables, so a route without its keys fails
 * closed with a 503 instead of half-working.
 *
 * Variables (see .env.example):
 *   NEAR_NETWORK                testnet | mainnet
 *   WGP_CONTRACT_ID             the game contract, e.g. game.wgp.testnet
 *   NEAR_RPC_URLS               optional, comma separated, tried in order
 *   FACTORY_ACCOUNT_ID          parent of player accounts, e.g. wgp.testnet
 *   FACTORY_PRIVATE_KEY         ed25519:… full-access key of FACTORY_ACCOUNT_ID
 *   FACTORY_INITIAL_BALANCE     optional, yoctoNEAR sent to each new account (default 0)
 *   RELAYER_ACCOUNT_ID          pays gas for meta-transactions, e.g. relayer.wgp.testnet
 *   RELAYER_PRIVATE_KEYS        comma-separated ed25519:… keys of RELAYER_ACCOUNT_ID (4–8)
 *   RELAYER_DAILY_TGAS          optional, gas the relayer may burn per UTC day (default 200000)
 *   RELAYER_MIN_BALANCE_NEAR    optional, refuse to relay below this balance (default 1)
 *   OPERATOR_ACCOUNT_ID         may call mint_rewards and record_season
 *   OPERATOR_PRIVATE_KEY        ed25519:… key of OPERATOR_ACCOUNT_ID
 *   NEAR_AUTH_CLIENT_ID         optional, defaults to NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID / the testnet dev client
 */
import { z } from "zod";

import { NEAR_AUTH as PUBLIC_NEAR_AUTH, type NearNetwork } from "../../lib/near/config";
import { isAccountId } from "../../lib/near/policy";

export class NearConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`NEAR is not configured: set ${missing.join(", ")}`);
    this.name = "NearConfigError";
  }
}

type Env = Record<string, string | undefined>;

const accountId = z.string().refine(isAccountId, "not a NEAR account id");
const secretKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,100}$/, "must be ed25519:<base58>");

function need(env: Env, names: string[]): void {
  const missing = names.filter((n) => !env[n]?.trim());
  if (missing.length) throw new NearConfigError(missing);
}

function parse<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new NearConfigError([`${name} (${r.error.issues[0]?.message ?? "invalid"})`]);
  return r.data;
}

const DEFAULT_RPC: Record<NearNetwork, string[]> = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
};

export interface ChainEnv {
  network: NearNetwork;
  contractId: string;
  rpcUrls: string[];
}

export function chainEnv(env: Env = process.env): ChainEnv {
  need(env, ["NEAR_NETWORK", "WGP_CONTRACT_ID"]);
  const network = parse(z.enum(["testnet", "mainnet"]), env.NEAR_NETWORK, "NEAR_NETWORK");
  const contractId = parse(accountId, env.WGP_CONTRACT_ID, "WGP_CONTRACT_ID");
  const rpcUrls = env.NEAR_RPC_URLS?.trim()
    ? env.NEAR_RPC_URLS.split(",").map((u) => parse(z.url(), u.trim(), "NEAR_RPC_URLS"))
    : DEFAULT_RPC[network];
  return { network, contractId, rpcUrls };
}

export interface KeyedAccountEnv {
  accountId: string;
  privateKey: `ed25519:${string}`;
}

export interface FactoryEnv extends KeyedAccountEnv {
  initialBalance: bigint;
}

export function factoryEnv(env: Env = process.env): FactoryEnv {
  need(env, ["FACTORY_ACCOUNT_ID", "FACTORY_PRIVATE_KEY"]);
  const balance = env.FACTORY_INITIAL_BALANCE?.trim() || "0";
  return {
    accountId: parse(accountId, env.FACTORY_ACCOUNT_ID, "FACTORY_ACCOUNT_ID"),
    privateKey: parse(secretKey, env.FACTORY_PRIVATE_KEY?.trim(), "FACTORY_PRIVATE_KEY") as `ed25519:${string}`,
    initialBalance: BigInt(parse(z.string().regex(/^\d{1,30}$/), balance, "FACTORY_INITIAL_BALANCE")),
  };
}

export interface RelayerEnv {
  accountId: string;
  privateKeys: `ed25519:${string}`[];
  dailyTgas: number;
  minBalanceYocto: bigint;
}

export function relayerEnv(env: Env = process.env): RelayerEnv {
  need(env, ["RELAYER_ACCOUNT_ID", "RELAYER_PRIVATE_KEYS"]);
  const keys = (env.RELAYER_PRIVATE_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k, i) => parse(secretKey, k, `RELAYER_PRIVATE_KEYS[${i}]`) as `ed25519:${string}`);
  if (keys.length === 0) throw new NearConfigError(["RELAYER_PRIVATE_KEYS"]);
  const minNear = Number(env.RELAYER_MIN_BALANCE_NEAR ?? "1");
  return {
    accountId: parse(accountId, env.RELAYER_ACCOUNT_ID, "RELAYER_ACCOUNT_ID"),
    privateKeys: keys,
    dailyTgas: parse(z.coerce.number().int().positive(), env.RELAYER_DAILY_TGAS ?? "200000", "RELAYER_DAILY_TGAS"),
    minBalanceYocto: BigInt(Math.round(parse(z.number().nonnegative(), minNear, "RELAYER_MIN_BALANCE_NEAR") * 1000)) * 10n ** 21n,
  };
}

export function operatorEnv(env: Env = process.env): KeyedAccountEnv {
  need(env, ["OPERATOR_ACCOUNT_ID", "OPERATOR_PRIVATE_KEY"]);
  return {
    accountId: parse(accountId, env.OPERATOR_ACCOUNT_ID, "OPERATOR_ACCOUNT_ID"),
    privateKey: parse(secretKey, env.OPERATOR_PRIVATE_KEY?.trim(), "OPERATOR_PRIVATE_KEY") as `ed25519:${string}`,
  };
}

export interface NearAuthEnv {
  fastAuthContractId: string;
  mpcContractId: string;
  domain: string;
  /** The Auth0 issuer, exactly as it appears in `iss`. */
  issuer: string;
  clientId: string;
  signingAudience: string;
  guardId: string;
}

/** NEAR Auth settings. Network-specific defaults match the public config. */
export function nearAuthEnv(env: Env = process.env): NearAuthEnv {
  const network = chainEnv(env).network;
  const domain = env.NEXT_PUBLIC_NEAR_AUTH_DOMAIN ?? (network === "mainnet" ? "login.auth.near.org" : "login.testnet.fast-auth.com");
  const clientId = env.NEAR_AUTH_CLIENT_ID ?? env.NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID ?? (network === "testnet" ? PUBLIC_NEAR_AUTH.clientId : "");
  if (!clientId) throw new NearConfigError(["NEAR_AUTH_CLIENT_ID"]);
  return {
    fastAuthContractId: env.NEXT_PUBLIC_NEAR_AUTH_CONTRACT_ID ?? (network === "mainnet" ? "fast-auth.near" : "fast-auth.testnet"),
    mpcContractId: network === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet",
    domain,
    issuer: `https://${domain}/`,
    clientId,
    signingAudience: network === "mainnet" ? "auth0.jwt.fast-auth.near" : "auth0.jwt.fast-auth.testnet",
    guardId: `jwt#https://${domain}/`,
  };
}
