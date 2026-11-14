"use client";

/**
 * The Gas tank's refill form (/gas): pick a token, type an amount and a refund address, and
 * a dry quote from NEAR Intents' 1Click API says how much NEAR would reach the relayer.
 * "Get deposit address" asks for a real quote: a one-time address to send to from your own
 * wallet, then the status is polled until the swap lands, is refunded or fails.
 *
 * The page never chooses the recipient: the server fixes it (src/server/intents/one-click.ts).
 * Nothing here signs or sends anything.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { StickerButton, StickerEyebrow, stickerButtonClass } from "@/components/game/kit";
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Hourglass, Undo2, X } from "@/components/icons";

import { nearblocksAccount, textLink } from "./links";

interface Token {
  assetId: string;
  symbol: string;
  chainName: string;
  decimals: number;
  price: number | null;
  min: string | null;
  max: string | null;
  refundHint: string;
}

interface Quote {
  dry: boolean;
  recipient: string;
  assetId: string;
  symbol: string;
  chainName: string;
  amountInFormatted: string;
  amountInUsd: string | null;
  amountOutFormatted: string;
  amountOutUsd: string | null;
  timeEstimate: number | null;
  depositAddress: string | null;
  depositMemo: string | null;
  deadline: string | null;
}

interface Status {
  status: string;
  label: string;
  tone: "waiting" | "done" | "refunded" | "failed" | "warning";
  final: boolean;
  amountOutFormatted: string | null;
  refundedAmountFormatted: string | null;
  txs: { hash: string; url: string | null }[];
}

interface Problem {
  message: string;
  field: string | null;
}

const DEFAULT_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const AMOUNT_RE = /^\d{1,12}(\.\d{1,30})?$/;
const ADDRESS_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const POLL_MS = 5_000;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** "0.645712345" → "0.6457". */
function near(formatted: string): string {
  const [whole, fraction = ""] = formatted.split(".");
  const short = fraction.slice(0, 4).replace(/0+$/, "");
  return short ? `${whole}.${short}` : whole!;
}

async function readProblem(res: Response): Promise<Problem> {
  const body = (await res.json().catch(() => null)) as { message?: string; field?: string | null } | null;
  if (res.status === 429) return { message: "That’s a lot of quotes at once. Wait a moment, then try again.", field: null };
  return { message: body?.message ?? "NEAR Intents didn’t answer. Try again in a moment.", field: body?.field ?? null };
}

const inputBox =
  "flex min-h-12 items-center rounded-[14px] border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--vs-focus)] has-[[aria-invalid=true]]:border-game-hero";
const inputText = "h-12 w-full min-w-0 bg-transparent px-3.5 text-[16px] font-semibold text-game-ink outline-none placeholder:font-medium placeholder:text-game-muted";

export function RefillForm() {
  const id = useId();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [tokensProblem, setTokensProblem] = useState<string | null>(null);
  const [assetId, setAssetId] = useState(DEFAULT_ASSET);
  const [amount, setAmount] = useState("5");
  const [refundTo, setRefundTo] = useState("");
  const [preview, setPreview] = useState<{ key: string; quote: Quote | null; problem: Problem | null } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deposit, setDeposit] = useState<Quote | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const refundRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/intents/tokens", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) {
          setTokensProblem((await readProblem(res)).message);
          return;
        }
        setTokens(((await res.json()) as { tokens: Token[] }).tokens);
      } catch {
        if (!controller.signal.aborted) setTokensProblem("Couldn’t reach the server. Check your connection and reload.");
      }
    })();
    return () => controller.abort();
  }, []);

  const token = tokens?.find((t) => t.assetId === assetId) ?? null;
  const trimmedAmount = amount.trim();
  const trimmedRefund = refundTo.trim();
  // A dry quote is asked for once the inputs could be valid; a stale answer is never shown.
  const quoteKey = token && AMOUNT_RE.test(trimmedAmount) && Number(trimmedAmount) > 0 && ADDRESS_RE.test(trimmedRefund) ? `${assetId}|${trimmedAmount}|${trimmedRefund}` : null;

  useEffect(() => {
    if (!quoteKey || deposit) return;
    const controller = new AbortController();
    const [asset, value, refund] = quoteKey.split("|");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/intents/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetId: asset, amount: value, refundTo: refund, dry: true }),
          signal: controller.signal,
        });
        if (res.ok) setPreview({ key: quoteKey, quote: (await res.json()) as Quote, problem: null });
        else setPreview({ key: quoteKey, quote: null, problem: await readProblem(res) });
      } catch {
        if (!controller.signal.aborted) setPreview({ key: quoteKey, quote: null, problem: { message: "Couldn’t reach the server for a quote.", field: null } });
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [quoteKey, deposit]);

  const current = preview && preview.key === quoteKey ? preview : null;
  const fieldProblem = problem ?? (current?.problem?.field ? current.problem : null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!AMOUNT_RE.test(trimmedAmount) || Number(trimmedAmount) <= 0) {
      setProblem({ message: "Enter an amount, like 2.5.", field: "amount" });
      amountRef.current?.focus();
      return;
    }
    if (!ADDRESS_RE.test(trimmedRefund)) {
      setProblem({ message: trimmedRefund ? "A refund address has only letters, digits and . _ : -" : "Enter a refund address on the chain you’re sending from.", field: "refundTo" });
      refundRef.current?.focus();
      return;
    }
    setProblem(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/intents/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId, amount: trimmedAmount, refundTo: trimmedRefund, dry: false }),
      });
      if (!res.ok) {
        const p = await readProblem(res);
        setProblem(p);
        if (p.field === "amount") amountRef.current?.focus();
        else if (p.field === "refundTo" || /refund/i.test(p.message)) refundRef.current?.focus();
        return;
      }
      setDeposit((await res.json()) as Quote);
    } catch {
      setProblem({ message: "Couldn’t reach the server. Check your connection and try again.", field: null });
    } finally {
      setSubmitting(false);
    }
  }

  if (deposit) return <DepositPanel quote={deposit} onDone={() => setDeposit(null)} />;

  const amountError = fieldProblem?.field === "amount" ? fieldProblem.message : null;
  const refundError = fieldProblem?.field === "refundTo" || (fieldProblem && /refundTo/i.test(fieldProblem.message)) ? fieldProblem.message : null;
  const formError = problem && !amountError && !refundError ? problem.message : null;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" aria-describedby="gas-terms">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-token`} className="text-[14px] font-semibold leading-5 text-game-ink">
            Token
          </label>
          <div className={`${inputBox} relative`}>
            <select
              id={`${id}-token`}
              value={assetId}
              onChange={(e) => {
                setAssetId(e.target.value);
                setProblem(null);
              }}
              className={`${inputText} cursor-pointer appearance-none pe-10`}
            >
              {["Ethereum", "Base", "Arbitrum", "Solana", "Bitcoin"].map((chain) => (
                <optgroup key={chain} label={chain}>
                  {(tokens ?? FALLBACK).filter((t) => t.chainName === chain).map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} on {t.chainName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute end-3 size-5 text-game-ink" strokeWidth={2.25} />
          </div>
          <p className="text-[13px] leading-[18px] text-game-muted">
            {token?.price ? (
              <>
                1 {token.symbol} ≈ <span className="num">{usd.format(token.price)}</span>
              </>
            ) : tokensProblem ? (
              <span role="alert">{tokensProblem}</span>
            ) : tokens ? (
              "No price for this token right now."
            ) : (
              "Reading prices…"
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-amount`} className="text-[14px] font-semibold leading-5 text-game-ink">
            Amount{token ? ` in ${token.symbol}` : ""}
          </label>
          <div className={inputBox}>
            <input
              ref={amountRef}
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (problem?.field === "amount") setProblem(null);
              }}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={`${id}-amount-hint`}
              className={`${inputText} num`}
            />
            {token ? <span className="pe-3.5 text-[14px] font-semibold text-game-muted">{token.symbol}</span> : null}
          </div>
          <p id={`${id}-amount-hint`} className={`text-[13px] leading-[18px] ${amountError ? "font-semibold text-game-hero-press" : "text-game-muted"}`}>
            {amountError ?? (token?.min && token.max ? `Between ${token.min} and ${token.max} ${token.symbol}: $1 to $50 worth.` : "Between $1 and $50 worth.")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-refund`} className="text-[14px] font-semibold leading-5 text-game-ink">
          Refund address{token ? ` on ${token.chainName}` : ""}
        </label>
        <div className={inputBox}>
          <input
            ref={refundRef}
            id={`${id}-refund`}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={128}
            placeholder={token?.refundHint ?? "Your address on the chain you send from"}
            value={refundTo}
            onChange={(e) => {
              setRefundTo(e.target.value);
              if (problem?.field === "refundTo" || (problem && /refund/i.test(problem.message))) setProblem(null);
            }}
            aria-invalid={refundError ? true : undefined}
            aria-describedby={`${id}-refund-hint`}
            className={`${inputText} font-mono text-[14px]`}
          />
        </div>
        <p id={`${id}-refund-hint`} className={`text-[13px] leading-[18px] ${refundError ? "font-semibold text-game-hero-press" : "text-game-muted"}`}>
          {refundError ?? "Yours, on the chain you send from. If the swap fails, NEAR Intents sends the funds back here."}
        </p>
      </div>

      <QuotePreview quote={current?.quote ?? null} problem={current?.problem && !current.problem.field && !/refundTo/i.test(current.problem.message) ? current.problem : null} waiting={Boolean(quoteKey) && !current} ready={Boolean(quoteKey)} />

      {formError ? (
        <p role="alert" className="flex items-start gap-2 text-[14px] font-semibold leading-5 text-game-hero-press">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
          {formError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <button type="submit" aria-disabled={submitting || undefined} className={stickerButtonClass("hero", "md", "w-full sm:w-auto sm:self-start")}>
          {submitting ? "Getting a deposit address…" : "Get deposit address"}
        </button>
        <p className="text-[13px] leading-[18px] text-game-muted">Nothing moves until you send funds from your own wallet.</p>
      </div>
    </form>
  );
}

function QuotePreview({ quote, problem, waiting, ready }: { quote: Quote | null; problem: Problem | null; waiting: boolean; ready: boolean }) {
  return (
    <div role="status" className="flex min-h-[84px] flex-col justify-center gap-1 rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper-2 px-4 py-3">
      <StickerEyebrow as="span">Quote</StickerEyebrow>
      {problem ? (
        <p className="text-[15px] font-semibold leading-[22px] text-game-hero-press">{problem.message}</p>
      ) : quote ? (
        <>
          <p className="text-[18px] font-semibold leading-6 text-game-ink">
            ≈ <span className="num">{near(quote.amountOutFormatted)}</span> NEAR reaches the gas tank
          </p>
          <p className="text-[13px] leading-[18px] text-game-muted">
            For <span className="num">{quote.amountInFormatted}</span> {quote.symbol}
            {quote.amountInUsd ? <> ({usd.format(Number(quote.amountInUsd))})</> : null}
            {quote.timeEstimate ? (
              <>
                , about <span className="num">{quote.timeEstimate}</span> s after your deposit confirms
              </>
            ) : null}
            . A live estimate; nothing has moved.
          </p>
        </>
      ) : (
        <p className="text-[15px] leading-[22px] text-game-muted">{waiting ? "Asking NEAR Intents…" : ready ? "Asking NEAR Intents…" : "Enter an amount and a refund address to see how much NEAR reaches the tank."}</p>
      )}
    </div>
  );
}

const TONE_ICON = { waiting: Hourglass, done: Check, refunded: Undo2, failed: X, warning: AlertTriangle } as const;

function DepositPanel({ quote, onDone }: { quote: Quote; onDone: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [copied, setCopied] = useState(false);
  const [lost, setLost] = useState(false);
  const address = quote.depositAddress ?? "";
  const final = status?.final ?? false;

  useEffect(() => {
    if (!address || final) return;
    let stopped = false;
    const check = async () => {
      try {
        const query = new URLSearchParams({ depositAddress: address });
        if (quote.depositMemo) query.set("depositMemo", quote.depositMemo);
        const res = await fetch(`/api/intents/status?${query}`, { cache: "no-store" });
        if (stopped) return;
        if (res.ok) {
          setStatus((await res.json()) as Status);
          setLost(false);
        } else if (res.status !== 404) setLost(true);
      } catch {
        if (!stopped) setLost(true);
      }
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [address, final, quote.depositMemo]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const tone = status?.tone ?? "waiting";
  const Icon = TONE_ICON[tone];
  const deadline = quote.deadline ? new Date(quote.deadline) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="text-[15px] leading-[22px] text-game-ink">
          Send exactly{" "}
          <span className="num whitespace-nowrap font-semibold">
            {quote.amountInFormatted} {quote.symbol}
          </span>{" "}
          on <span className="font-semibold">{quote.chainName}</span> from your own wallet to this address:
        </p>
        <div className="flex flex-col gap-2 rounded-[14px] border-2 border-game-ink bg-game-paper-2 p-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all font-mono text-[14px] font-semibold leading-5 text-game-ink">{address}</code>
          <StickerButton size="sm" onClick={copy} className="self-start sm:self-auto">
            {copied ? <Check aria-hidden className="size-4" strokeWidth={2.5} /> : <Copy aria-hidden className="size-4" strokeWidth={2.25} />}
            {copied ? "Copied" : "Copy address"}
          </StickerButton>
        </div>
        {quote.depositMemo ? (
          <p className="text-[14px] font-semibold leading-5 text-game-ink">
            Include this memo, or the deposit can’t be matched: <code className="font-mono [overflow-wrap:anywhere]">{quote.depositMemo}</code>
          </p>
        ) : null}
        <p className="text-[13px] leading-[18px] text-game-muted">
          Only {quote.symbol} on {quote.chainName}. Less than quoted is refunded to your refund address.
          {deadline ? (
            <>
              {" "}
              Send before{" "}
              <time dateTime={quote.deadline!} className="num font-semibold text-game-ink">
                {clock.format(deadline)} UTC
              </time>
              : a swap that hasn’t run by then is refunded. Don’t reuse this address for another refill.
            </>
          ) : null}
        </p>
      </div>

      <div role="status" className="flex flex-col gap-1.5 rounded-[14px] border-2 border-game-ink bg-game-paper px-3.5 py-3">
        <p className="flex items-center gap-2.5 text-[16px] font-semibold leading-6 text-game-ink">
          <Icon aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
          {status?.label ?? "Waiting for your deposit"}
        </p>
        <p className="text-[13px] leading-[18px] text-game-muted">
          {final
            ? status?.status === "SUCCESS"
              ? `${status.amountOutFormatted ? `${near(status.amountOutFormatted)} NEAR` : "The NEAR"} reached the relayer. Thank you: that’s gas for players.`
              : status?.status === "REFUNDED"
                ? `${status.refundedAmountFormatted ? `${status.refundedAmountFormatted} ${quote.symbol}` : "Your funds"} went back to your refund address.`
                : "Nothing reached the tank. Anything you sent is refunded to your refund address."
            : lost
              ? "Can’t reach NEAR Intents right now; still trying."
              : `Expected about ${near(quote.amountOutFormatted)} NEAR. Checking every ${POLL_MS / 1000} seconds.`}
        </p>
        {status?.txs.length ? (
          <ul className="flex flex-col gap-0.5">
            {status.txs.map((tx) =>
              tx.url ? (
                <li key={tx.hash}>
                  <a href={tx.url} className={`${textLink} inline-flex items-center gap-1 font-mono text-[12px] [overflow-wrap:anywhere]`}>
                    {tx.hash.slice(0, 10)}…
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <a href={nearblocksAccount(quote.recipient)} className={`${textLink} inline-flex items-center gap-1 text-[14px]`}>
          See the relayer on NearBlocks
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
        <StickerButton size="sm" onClick={onDone} className="sm:ms-auto">
          {final ? "Start a new refill" : "Start over"}
        </StickerButton>
      </div>
    </div>
  );
}

/** Before /v0/tokens answers, the form still lists the curated tokens (no prices). */
const FALLBACK: Token[] = [
  ["nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", "USDC", "Ethereum"],
  ["nep141:eth.omft.near", "ETH", "Ethereum"],
  [DEFAULT_ASSET, "USDC", "Base"],
  ["nep141:base.omft.near", "ETH", "Base"],
  ["nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", "USDC", "Arbitrum"],
  ["nep141:arb.omft.near", "ETH", "Arbitrum"],
  ["nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "USDC", "Solana"],
  ["nep141:sol.omft.near", "SOL", "Solana"],
  ["nep141:btc.omft.near", "BTC", "Bitcoin"],
].map(([assetId, symbol, chainName]) => ({ assetId: assetId!, symbol: symbol!, chainName: chainName!, decimals: 0, price: null, min: null, max: null, refundHint: "" }));
