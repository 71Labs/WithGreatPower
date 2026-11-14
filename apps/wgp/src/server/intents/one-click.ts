/**
 * NEAR Intents' 1Click API, for the Gas tank (/gas). Signed-in players never pay gas: the
 * relayer pays for their meta-transactions (src/server/near/relay.ts), and when its balance
 * falls under RELAYER_MIN_BALANCE_NEAR the relay routes answer 503 `relayer_empty`. Here
 * anyone can refill it from another chain: 1Click quotes a swap from a curated token into
 * NEAR, hands out a one-time deposit address, and delivers the NEAR to the relayer.
 *
 * The rules that make this safe to expose:
 * - The recipient is always the relayer account, read on the server from RELAYER_ACCOUNT_ID.
 *   Nothing a caller sends can change it, and a quote whose echoed request names anyone
 *   else is refused.
 * - Only the curated origin assets below, and only between $1 and $50 worth at the token's
 *   live price, so nobody sends a large amount by mistake.
 * - Quotes are dry unless the caller asks for a deposit address. A dry quote moves nothing.
 * - Refunds go back on the origin chain, to the address the sender gives.
 *
 * 1Click without a JWT charges 0.2%; ONE_CLICK_JWT, when set, is sent as a bearer token.
 * Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api
 */
import { z } from "zod";

import { isAccountId } from "@/lib/near/policy";
import { badRequest, HttpError, notFound } from "@/server/http";

export const ONE_CLICK_URL = "https://1click.chaindefuser.com";
/** NEAR on NEAR. 1Click delivers it to a NEAR account as the wrap.near token (wNEAR). */
export const DESTINATION_ASSET = "nep141:wrap.near";
/** 1% in basis points. */
export const SLIPPAGE_BPS = 100;
/** How long a deposit address stays open: refunds start after this if the swap hasn't run. */
export const QUOTE_DEADLINE_MS = 60 * 60_000;
export const TOKENS_TTL_MS = 5 * 60_000;
export const TIMEOUT_MS = 10_000;
/** The input's bounds in US dollars at the token's current price. */
export const MIN_USD = 1;
export const MAX_USD = 50;
/** The fee 1Click takes without a JWT, in basis points (shown on the page). */
export const NO_JWT_FEE_BPS = 20;

export interface OriginAsset {
  assetId: string;
  symbol: string;
  chainName: string;
  /** Used until /v0/tokens answers; the live value wins. */
  decimals: number;
  /** What a refund address looks like on this chain, for the form's hint. */
  refundHint: string;
}

const EVM = "An address starting 0x";
const SOL = "A Solana address";

/** The tokens the Gas tank accepts. Everything else is refused before 1Click is asked. */
export const ORIGIN_ASSETS: readonly OriginAsset[] = [
  { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", symbol: "USDC", chainName: "Ethereum", decimals: 6, refundHint: EVM },
  { assetId: "nep141:eth.omft.near", symbol: "ETH", chainName: "Ethereum", decimals: 18, refundHint: EVM },
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", chainName: "Base", decimals: 6, refundHint: EVM },
  { assetId: "nep141:base.omft.near", symbol: "ETH", chainName: "Base", decimals: 18, refundHint: EVM },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", chainName: "Arbitrum", decimals: 6, refundHint: EVM },
  { assetId: "nep141:arb.omft.near", symbol: "ETH", chainName: "Arbitrum", decimals: 18, refundHint: EVM },
  { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", symbol: "USDC", chainName: "Solana", decimals: 6, refundHint: SOL },
  { assetId: "nep141:sol.omft.near", symbol: "SOL", chainName: "Solana", decimals: 9, refundHint: SOL },
  { assetId: "nep141:btc.omft.near", symbol: "BTC", chainName: "Bitcoin", decimals: 8, refundHint: "A Bitcoin address" },
];

const BY_ID = new Map(ORIGIN_ASSETS.map((a) => [a.assetId, a]));

export function originAsset(assetId: string): OriginAsset | null {
  return BY_ID.get(assetId) ?? null;
}

/* ------------------------------------------------------------------ configuration */

type Env = Record<string, string | undefined>;

export interface GasTankConfig {
  /** The relayer account: the only recipient a quote can name. */
  recipient: string;
  jwt: string | null;
}

/**
 * The relayer account and the optional JWT, or null when this server can't take refills:
 * no RELAYER_ACCOUNT_ID, or not on mainnet (1Click only delivers on mainnet). Reads only
 * the account id, never the relayer's keys.
 */
export function gasTankConfig(env: Env = process.env): GasTankConfig | null {
  const recipient = env.RELAYER_ACCOUNT_ID?.trim() ?? "";
  if (!recipient || !isAccountId(recipient)) return null;
  if (env.NEAR_NETWORK?.trim() !== "mainnet") return null;
  return { recipient, jwt: env.ONE_CLICK_JWT?.trim() || null };
}

export const notConfigured = () => new HttpError(503, "intents_not_configured", "The gas tank isn’t set up on this server.");

export function requireGasTank(env: Env = process.env): GasTankConfig {
  const config = gasTankConfig(env);
  if (!config) throw notConfigured();
  return config;
}

/* ------------------------------------------------------------------ transport */

export interface OneClickDeps {
  fetch?: typeof fetch;
  now?: number;
  timeoutMs?: number;
  jwt?: string | null;
}

const unavailable = () => new HttpError(502, "intents_unavailable", "NEAR Intents didn’t answer. Try again in a moment.");

/** 1Click's own words, trimmed and stripped of control characters, so they can be shown as they are. */
export function cleanMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const clean = message.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, 240) : null;
}

/**
 * One call to 1Click. A 4xx with a message (an invalid refund address, an amount too small
 * to route) comes back as a 422 carrying 1Click's message; a timeout, a 5xx, a refused JWT
 * or a rate limit is a 502 that says to try again.
 */
async function call(path: string, init: { method: "GET" | "POST"; body?: unknown }, deps: OneClickDeps = {}): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (deps.jwt) headers.authorization = `Bearer ${deps.jwt}`;
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${ONE_CLICK_URL}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw unavailable();
  }
  const text = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = cleanMessage((body as { message?: unknown } | null)?.message);
    if (res.status === 404) throw notFound(message ?? "NEAR Intents doesn’t know that deposit address.");
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 429 && message) {
      throw new HttpError(422, "intents_refused", message);
    }
    console.error(`[intents] 1Click ${init.method} ${path.split("?")[0]} answered ${res.status}`);
    throw unavailable();
  }
  return body;
}

/* ------------------------------------------------------------------ tokens */

const tokenSchema = z.object({
  assetId: z.string(),
  decimals: z.number().int().min(0).max(30),
  blockchain: z.string().optional(),
  symbol: z.string().optional(),
  price: z.coerce.number().optional(),
  priceUpdatedAt: z.string().optional(),
});

export interface LiveToken {
  decimals: number;
  /** US dollars per whole token; null when 1Click has none. */
  price: number | null;
  priceUpdatedAt: string | null;
}

let tokenCache: { at: number; byId: Map<string, LiveToken> } | null = null;

export function resetOneClickCache(): void {
  tokenCache = null;
}

/** GET /v0/tokens, kept for five minutes. Only the curated assets are kept. */
export async function liveTokens(deps: OneClickDeps = {}): Promise<Map<string, LiveToken>> {
  const now = deps.now ?? Date.now();
  if (tokenCache && now - tokenCache.at < TOKENS_TTL_MS) return tokenCache.byId;
  const body = await call("/v0/tokens", { method: "GET" }, deps);
  if (!Array.isArray(body)) throw unavailable();
  const byId = new Map<string, LiveToken>();
  for (const raw of body) {
    const parsed = tokenSchema.safeParse(raw);
    if (!parsed.success || !BY_ID.has(parsed.data.assetId)) continue;
    const price = parsed.data.price;
    byId.set(parsed.data.assetId, {
      decimals: parsed.data.decimals,
      price: price !== undefined && Number.isFinite(price) && price > 0 ? price : null,
      priceUpdatedAt: parsed.data.priceUpdatedAt ?? null,
    });
  }
  tokenCache = { at: now, byId };
  return byId;
}

export interface GasToken extends OriginAsset {
  price: number | null;
  priceUpdatedAt: string | null;
  /** The bounds in this token's units at its current price, or null without a price. */
  min: string | null;
  max: string | null;
}

/** Shortest decimal string for a token amount, rounded up for a minimum and down for a maximum. */
export function tokenAmount(usd: number, price: number, decimals: number, round: "up" | "down"): string {
  const places = Math.min(decimals, 8);
  const scale = 10 ** places;
  const raw = (usd / price) * scale;
  const units = round === "up" ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9);
  return (units / scale).toFixed(places).replace(/\.?0+$/, "");
}

/** The curated list with live decimals and prices. */
export async function gasTokens(deps: OneClickDeps = {}): Promise<GasToken[]> {
  const live = await liveTokens(deps);
  return ORIGIN_ASSETS.map((asset) => {
    const token = live.get(asset.assetId);
    const decimals = token?.decimals ?? asset.decimals;
    const price = token?.price ?? null;
    return {
      ...asset,
      decimals,
      price,
      priceUpdatedAt: token?.priceUpdatedAt ?? null,
      min: price ? tokenAmount(MIN_USD, price, decimals, "up") : null,
      max: price ? tokenAmount(MAX_USD, price, decimals, "down") : null,
    };
  });
}

/* ------------------------------------------------------------------ quotes */

/** Letters, digits and `._:-`: every address format the curated chains use, and nothing that could smuggle anything else. */
export const SAFE_ADDRESS_RE = /^[A-Za-z0-9._:-]+$/;

export const quoteInput = z.object({
  assetId: z.string().refine((id) => BY_ID.has(id), "Pick one of the listed tokens."),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,30})?$/, "Enter an amount, like 2.5."),
  refundTo: z
    .string()
    .trim()
    .min(1, "Enter a refund address on the chain you’re sending from.")
    .max(128, "That refund address is too long.")
    .regex(SAFE_ADDRESS_RE, "A refund address has only letters, digits and . _ : -"),
  dry: z.boolean().default(true),
});

export type QuoteInput = z.infer<typeof quoteInput>;

/** "2.5" with 6 decimals → 2500000n. Refuses more decimal places than the token has. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw badRequest("Enter an amount, like 2.5.");
  const [, whole, fraction = ""] = match;
  const trimmed = fraction.replace(/0+$/, "");
  if (trimmed.length > decimals) throw badRequest(`That has more decimal places than the token allows (${decimals}).`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(trimmed.padEnd(decimals, "0") || "0");
}

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
}

/**
 * The body for POST /v0/quote. The recipient comes from the server's config, never from
 * the caller; the destination, slippage, deposit and refund types are fixed.
 */
export function buildQuoteRequest(args: { originAsset: string; amount: bigint; refundTo: string; dry: boolean; recipient: string; now: number }): QuoteRequest {
  if (!BY_ID.has(args.originAsset)) throw badRequest("Pick one of the listed tokens.");
  if (!isAccountId(args.recipient)) throw notConfigured();
  return {
    dry: args.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: args.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: DESTINATION_ASSET,
    amount: args.amount.toString(),
    refundTo: args.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: args.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(args.now + QUOTE_DEADLINE_MS).toISOString(),
  };
}

/** Refuses an amount worth under $1 or over $50 at the token's current price. */
export function checkBounds(amount: string, token: { symbol: string; price: number | null; decimals: number }): void {
  if (!token.price) throw new HttpError(503, "intents_no_price", `NEAR Intents has no price for ${token.symbol} right now. Try another token.`);
  const usd = Number(amount) * token.price;
  if (!(usd >= MIN_USD)) {
    throw badRequest(`Send at least $${MIN_USD} worth: ${tokenAmount(MIN_USD, token.price, token.decimals, "up")} ${token.symbol} or more.`, { field: "amount" });
  }
  if (usd > MAX_USD) {
    throw badRequest(`The gas tank takes at most $${MAX_USD} worth at a time: ${tokenAmount(MAX_USD, token.price, token.decimals, "down")} ${token.symbol} or less.`, { field: "amount" });
  }
}

const quoteResponseSchema = z.object({
  quote: z.object({
    amountIn: z.string(),
    amountInFormatted: z.string(),
    amountInUsd: z.string().optional(),
    amountOut: z.string(),
    amountOutFormatted: z.string(),
    amountOutUsd: z.string().optional(),
    minAmountOut: z.string(),
    timeEstimate: z.number().optional(),
    depositAddress: z.string().optional(),
    depositMemo: z.string().optional(),
    deadline: z.string().optional(),
    timeWhenInactive: z.string().optional(),
  }),
  quoteRequest: z.object({ recipient: z.string().optional(), destinationAsset: z.string().optional() }).optional(),
});

export interface GasQuote {
  dry: boolean;
  assetId: string;
  symbol: string;
  chainName: string;
  recipient: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string | null;
  /** NEAR, in yocto, and as 1Click formats it. */
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string | null;
  minAmountOut: string;
  /** Seconds after the deposit confirms. */
  timeEstimate: number | null;
  /** Only on a real quote. */
  depositAddress: string | null;
  depositMemo: string | null;
  deadline: string | null;
}

/**
 * Validated input → a 1Click quote. Dry unless `input.dry` is false. Throws HttpErrors with
 * the reason in words: unknown token, out of bounds, 1Click's own refusal.
 */
export async function quoteRefill(input: QuoteInput, config: GasTankConfig, deps: OneClickDeps = {}): Promise<GasQuote> {
  const asset = originAsset(input.assetId);
  if (!asset) throw badRequest("Pick one of the listed tokens.");
  const live = (await liveTokens(deps)).get(asset.assetId);
  const token = { symbol: asset.symbol, decimals: live?.decimals ?? asset.decimals, price: live?.price ?? null };
  const amount = toBaseUnits(input.amount, token.decimals);
  if (amount <= 0n) throw badRequest("Enter an amount above zero.", { field: "amount" });
  checkBounds(input.amount, token);
  const request = buildQuoteRequest({ originAsset: asset.assetId, amount, refundTo: input.refundTo, dry: input.dry, recipient: config.recipient, now: deps.now ?? Date.now() });
  const body = await call("/v0/quote", { method: "POST", body: request }, { ...deps, jwt: deps.jwt ?? config.jwt });
  const parsed = quoteResponseSchema.safeParse(body);
  if (!parsed.success) throw unavailable();
  const { quote, quoteRequest } = parsed.data;
  // 1Click echoes the request it quoted. Anything but our relayer and NEAR is refused.
  if ((quoteRequest?.recipient && quoteRequest.recipient !== config.recipient) || (quoteRequest?.destinationAsset && quoteRequest.destinationAsset !== DESTINATION_ASSET)) {
    console.error("[intents] 1Click quoted a different recipient or asset; refused");
    throw unavailable();
  }
  if (!input.dry && !quote.depositAddress) throw unavailable();
  return {
    dry: input.dry,
    assetId: asset.assetId,
    symbol: asset.symbol,
    chainName: asset.chainName,
    recipient: config.recipient,
    amountIn: quote.amountIn,
    amountInFormatted: quote.amountInFormatted,
    amountInUsd: quote.amountInUsd ?? null,
    amountOut: quote.amountOut,
    amountOutFormatted: quote.amountOutFormatted,
    amountOutUsd: quote.amountOutUsd ?? null,
    minAmountOut: quote.minAmountOut,
    timeEstimate: quote.timeEstimate ?? null,
    depositAddress: input.dry ? null : (quote.depositAddress ?? null),
    depositMemo: input.dry ? null : (quote.depositMemo ?? null),
    deadline: input.dry ? null : (quote.deadline ?? request.deadline),
  };
}

/* ------------------------------------------------------------------ status */

export const SWAP_STATUSES = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

export type StatusTone = "waiting" | "done" | "refunded" | "failed" | "warning";

export interface StatusView {
  status: string;
  label: string;
  tone: StatusTone;
  /** Nothing more will happen: stop polling. */
  final: boolean;
}

const VIEWS: Record<SwapStatus, Omit<StatusView, "status">> = {
  PENDING_DEPOSIT: { label: "Waiting for your deposit", tone: "waiting", final: false },
  KNOWN_DEPOSIT_TX: { label: "Deposit seen, waiting for it to confirm", tone: "waiting", final: false },
  PROCESSING: { label: "Swapping into NEAR", tone: "waiting", final: false },
  SUCCESS: { label: "Landed in the gas tank", tone: "done", final: true },
  INCOMPLETE_DEPOSIT: { label: "Less than quoted arrived; it will be refunded", tone: "warning", final: false },
  REFUNDED: { label: "Refunded to your refund address", tone: "refunded", final: true },
  FAILED: { label: "The swap failed", tone: "failed", final: true },
};

export function statusView(status: string): StatusView {
  const view = (VIEWS as Record<string, Omit<StatusView, "status">>)[status];
  return view ? { status, ...view } : { status, label: "Checking with NEAR Intents", tone: "waiting", final: false };
}

const txSchema = z.object({ hash: z.string(), explorerUrl: z.string().optional() });

const statusResponseSchema = z.object({
  status: z.string(),
  updatedAt: z.string().optional(),
  swapDetails: z
    .object({
      amountOutFormatted: z.string().nullish(),
      refundedAmountFormatted: z.string().nullish(),
      nearTxHashes: z.array(txSchema).optional(),
      destinationChainTxHashes: z.array(txSchema).optional(),
    })
    .optional(),
});

export interface RefillStatus extends StatusView {
  updatedAt: string | null;
  amountOutFormatted: string | null;
  refundedAmountFormatted: string | null;
  /** Explorer links for the delivery on NEAR, when 1Click has them. */
  txs: { hash: string; url: string | null }[];
}

export const depositAddressSchema = z
  .string()
  .trim()
  .min(8, "That isn’t a deposit address.")
  .max(128, "That isn’t a deposit address.")
  .regex(SAFE_ADDRESS_RE, "That isn’t a deposit address.");

const safeUrl = (url: string | undefined) => (url && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null);

/** GET /v0/status for a deposit address. */
export async function refillStatus(depositAddress: string, depositMemo: string | null, deps: OneClickDeps = {}): Promise<RefillStatus> {
  const query = new URLSearchParams({ depositAddress });
  if (depositMemo) query.set("depositMemo", depositMemo);
  const body = await call(`/v0/status?${query}`, { method: "GET" }, deps);
  const parsed = statusResponseSchema.safeParse(body);
  if (!parsed.success) throw unavailable();
  const { status, updatedAt, swapDetails } = parsed.data;
  const txs = [...(swapDetails?.destinationChainTxHashes ?? []), ...(swapDetails?.nearTxHashes ?? [])];
  const seen = new Set<string>();
  return {
    ...statusView(status),
    updatedAt: updatedAt ?? null,
    amountOutFormatted: swapDetails?.amountOutFormatted ?? null,
    refundedAmountFormatted: swapDetails?.refundedAmountFormatted ?? null,
    txs: txs
      .filter((tx) => (seen.has(tx.hash) ? false : (seen.add(tx.hash), true)))
      .slice(0, 4)
      .map((tx) => ({ hash: tx.hash, url: safeUrl(tx.explorerUrl) })),
  };
}
