/**
 * The gas tank's level for /gas: the relayer's available NEAR (what relayerHasFunds checks
 * against RELAYER_MIN_BALANCE_NEAR), plus any wNEAR it holds. 1Click delivers NEAR as the
 * wrap.near token, so a refill shows up as wNEAR until the owner unwraps it:
 *
 *   near contract call-function as-transaction wrap.near near_withdraw json-args '{"amount":"<yocto>"}' \
 *     prepaid-gas '10.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as relayer.wgpnear.near network-config mainnet sign-with-legacy-keychain send
 *
 * View calls only: nothing here signs or reads a key. Cached for 30 seconds.
 */
import { Account } from "near-api-js";

import { viewFunction } from "@/lib/near/rpc";
import { provider } from "@/server/near/rpc";

import { gasTankConfig } from "./one-click";

export const WRAP_CONTRACT = "wrap.near";

type Env = Record<string, string | undefined>;

export interface GasTank {
  accountId: string;
  /** Available NEAR in yocto: the balance the relay's cut-off is checked against. */
  availableYocto: string;
  /** wNEAR on wrap.near in yocto, or null when the read failed. */
  wrappedYocto: string | null;
  /** RELAYER_MIN_BALANCE_NEAR in yocto. */
  minYocto: string;
  /** Available ≥ the cut-off: players' gas is paid. */
  ok: boolean;
  at: string;
}

/** RELAYER_MIN_BALANCE_NEAR in yocto, parsed the way relayerEnv() parses it (default 1 NEAR). */
export function minBalanceYocto(env: Env = process.env): bigint {
  const near = Number(env.RELAYER_MIN_BALANCE_NEAR ?? "1");
  const safe = Number.isFinite(near) && near >= 0 ? near : 1;
  return BigInt(Math.round(safe * 1000)) * 10n ** 21n;
}

export interface TankReads {
  available: (accountId: string) => Promise<bigint>;
  wrapped: (accountId: string) => Promise<bigint>;
}

const chainReads: TankReads = {
  available: async (accountId) => BigInt((await new Account(accountId, provider()).getState()).balance.available),
  wrapped: async (accountId) => BigInt(await viewFunction<string>(provider(), WRAP_CONTRACT, "ft_balance_of", { account_id: accountId })),
};

let cached: { at: number; key: string; tank: GasTank } | null = null;

export function resetTankCache(): void {
  cached = null;
}

/** The relayer's level, or null when the gas tank isn't configured on this server. */
export async function readGasTank(env: Env = process.env, reads: TankReads = chainReads, now = Date.now()): Promise<GasTank | null> {
  const config = gasTankConfig(env);
  if (!config) return null;
  const key = config.recipient;
  if (cached && cached.key === key && now - cached.at < 30_000) return cached.tank;
  const [available, wrapped] = await Promise.all([reads.available(key), reads.wrapped(key).catch(() => null)]);
  const min = minBalanceYocto(env);
  const tank: GasTank = {
    accountId: key,
    availableYocto: available.toString(),
    wrappedYocto: wrapped === null ? null : wrapped.toString(),
    minYocto: min.toString(),
    ok: available >= min,
    at: new Date(now).toISOString(),
  };
  cached = { at: now, key, tank };
  return tank;
}

/** Yocto → NEAR with up to `places` decimals, for display. */
export function formatNear(yocto: string | bigint, places = 3): string {
  const value = BigInt(yocto);
  const whole = value / 10n ** 24n;
  const fraction = (value % 10n ** 24n).toString().padStart(24, "0").slice(0, places).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
