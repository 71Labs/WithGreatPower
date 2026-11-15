/**
 * The server's half of Sandwich Man's brain (src/lib/market/npc-brain.ts): one call to an
 * OpenAI-compatible chat completions endpoint a turn, with his legal moves, and the rules'
 * first move whenever that call can't give a usable answer.
 *
 * - Which LLM, first match wins:
 *   1. NEAR AI Cloud when NEARAI_API_KEY is set: NEARAI_MODEL (default
 *      Qwen/Qwen3.6-35B-A3B-FP8, a model NEAR AI runs in its own TEEs) at NEARAI_BASE_URL
 *      (default https://cloud-api.near.ai/v1). Each answer he acts on has its signature
 *      checked against the exact request and response bytes and the model's attestation
 *      report (./nearai.ts).
 *   2. Kimi K3 when LLM_API_KEY is set: LLM_MODEL (default kimi-k3) at LLM_BASE_URL
 *      (default https://api.moonshot.ai/v1). Moonshot signs nothing, so its answers are
 *      recorded as unverified.
 *   3. Neither: the LLM is never called and the rules pick every move.
 *   Keys are read only here and sent only as the request's bearer token; never logged or returned.
 * - Cost, bounded by construction: at most NPC_BRAIN.maxCallsPerDay completions a UTC day
 *   (counted in his state, src/server/npc/store.ts), one per turn, no retries, a 20 s
 *   timeout, at most NPC_BRAIN.maxTokens tokens out. The attestation and signature reads
 *   are not completions and have their own short timeouts.
 * - Nothing the model says is trusted: `acceptPick` keeps its move only if it is one of
 *   the moves it was shown, and only the reason's words reach his ledger. The model's
 *   `reasoning_content` is never read, logged or shown.
 * - A failed or unavailable signature check never blocks his turn: the pick is kept if it
 *   is otherwise valid and recorded with `verified: false` and a short reason.
 * - Logs name what failed (a timeout, an HTTP status), never the prompt, the answer or a key.
 * - Plain fetch, no SDK. Tests pass their own `fetch`.
 */
import { acceptPick, BRAIN_SYSTEM, brainPrompt, NPC_BRAIN, RULES_BRAIN, type BrainFallback, type BrainInput, type BrainProvider, type BrainVerification, type NpcBrain } from "@/lib/market/npc-brain";
import type { NpcAction } from "@/lib/market/npc-rules";

import { attestationFor, NEARAI, verifyNearAiAnswer, type NearAiAttestation, type NearAiFetch } from "./nearai";

type Env = Record<string, string | undefined>;

export interface BrainConfig {
  /** Where the LLM runs; "moonshot" when absent. */
  provider?: BrainProvider;
  apiKey: string;
  model: string;
  /** The chat completions URL. */
  url: string;
  /** The API's base URL (the completions URL without /chat/completions); NEAR AI's attestation and signature reads hang off it. */
  baseUrl?: string;
}

/** The fetch the completion uses; tests pass a fake. */
export type BrainFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

function providerConfig(provider: BrainProvider, apiKey: string | undefined, model: string | undefined, baseUrl: string | undefined, defaults: { model: string; baseUrl: string }): BrainConfig | null {
  const key = apiKey?.trim();
  if (!key) return null;
  const base = (baseUrl?.trim() || defaults.baseUrl).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${base}/chat/completions`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const m = model?.trim();
  return { provider, apiKey: key, model: m && MODEL_ID.test(m) ? m : defaults.model, url: url.toString(), baseUrl: base };
}

/**
 * The LLM's settings, or null when it is off. NEAR AI Cloud first (NEARAI_API_KEY), then
 * Kimi (LLM_API_KEY). A provider whose base URL isn't https is skipped. Never throws, never logs.
 */
export function npcBrainConfig(env: Env = process.env): BrainConfig | null {
  return (
    providerConfig("near-ai", env.NEARAI_API_KEY, env.NEARAI_MODEL, env.NEARAI_BASE_URL, { model: NEARAI.defaultModel, baseUrl: NEARAI.defaultBaseUrl }) ??
    providerConfig("moonshot", env.LLM_API_KEY, env.LLM_MODEL, env.LLM_BASE_URL, { model: NPC_BRAIN.defaultModel, baseUrl: NPC_BRAIN.defaultBaseUrl })
  );
}

/** Who picks his on-chain moves with this environment: "llm" with a key (and which provider), else "rules". The simulated market always runs on the rules. */
export function npcBrainMode(onChain: boolean, env: Env = process.env): { mode: "llm" | "rules"; model: string | null; provider: BrainProvider | null } {
  const config = onChain ? npcBrainConfig(env) : null;
  return config ? { mode: "llm", model: config.model, provider: config.provider ?? "moonshot" } : { mode: "rules", model: null, provider: null };
}

export interface NpcChoice {
  /** The move to send, or null to pass (only the LLM passes; the rules always take their first move). */
  action: NpcAction | null;
  /** The model id when the LLM picked, else "rules". */
  by: NpcBrain;
  reason: string;
  /** Set when the rules picked because the LLM couldn't. */
  fallback: BrainFallback | null;
  /** Whether an LLM call was made (it counts against the day's calls whatever it answered). */
  called: boolean;
  /** Which provider was asked, when one was. */
  provider: BrainProvider | null;
  /** What was checked about the LLM's answer, when he acts on it (a pick or a pass); null when the rules picked. */
  verification: BrainVerification | null;
}

const rulesPick = (options: NpcAction[], fallback: BrainFallback, called: boolean, provider: BrainProvider | null = null): NpcChoice => ({
  action: options[0] ?? null,
  by: RULES_BRAIN,
  reason: options[0]?.reason ?? "",
  fallback,
  called,
  provider,
  verification: null,
});

/** The parts of a chat completion the brain reads: its id, and the first choice's content if the model finished. */
function contentOf(body: unknown): { id: string | null; text: string | null } {
  const b = body as { id?: unknown; choices?: { finish_reason?: unknown; message?: { content?: unknown } }[] } | null;
  const id = typeof b?.id === "string" && b.id.length <= 200 ? b.id : null;
  const choice = b?.choices?.[0];
  if (!choice || choice.finish_reason !== "stop") return { id, text: null };
  return { id, text: typeof choice.message?.content === "string" ? choice.message.content : null };
}

/** The completion's body, built once: its exact bytes are what NEAR AI's signature covers. */
function requestBody(config: BrainConfig, input: BrainInput): string {
  return JSON.stringify({
    model: config.model,
    max_tokens: NPC_BRAIN.maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: BRAIN_SYSTEM },
      { role: "user", content: brainPrompt(input) },
    ],
    // NEAR AI's Qwen and GLM models reason by default; he needs one short JSON answer.
    ...(config.provider === "near-ai" ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  });
}

/**
 * Picks this turn's move from `input.options` (his legal moves, best first). The LLM picks
 * when `config` is given and `callsLeft` > 0; otherwise, or when its answer is unusable,
 * the rules' first move. A NEAR AI Cloud answer he acts on is then checked (`verification`);
 * the check never changes the pick. Never throws.
 */
export async function chooseMove(
  input: BrainInput,
  opts: {
    config: BrainConfig | null;
    callsLeft: number;
    fetch?: BrainFetch;
    /** The fetch NEAR AI's attestation and signature reads use; tests pass a fake. */
    verifyFetch?: NearAiFetch;
    timeoutMs?: number;
    /** Timeout of each attestation or signature read, and the wait between signature retries. */
    verifyTimeoutMs?: number;
    verifyRetryDelayMs?: number;
    /** Runs (and is awaited) just before the request goes out, so the call is counted even if the function dies mid-call. */
    onCall?: () => Promise<void>;
  },
): Promise<NpcChoice> {
  const { options } = input;
  if (options.length === 0) return { action: null, by: RULES_BRAIN, reason: "", fallback: null, called: false, provider: null, verification: null };
  const { config } = opts;
  if (!config) return rulesPick(options, "no_key", false);
  const provider = config.provider ?? "moonshot";
  if (opts.callsLeft <= 0) return rulesPick(options, "cap", false, provider);

  const send: BrainFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const read: NearAiFetch = opts.verifyFetch ?? ((url, init) => fetch(url, init));
  const baseUrl = config.baseUrl ?? config.url.replace(/\/chat\/completions$/, "");
  // NEAR AI: the model's attestation report comes first, so the signer it names predates the answer.
  const attestation: NearAiAttestation | null =
    provider === "near-ai" ? await attestationFor(baseUrl, config.model, { fetch: read, timeoutMs: opts.verifyTimeoutMs }).catch(() => null) : null;

  const body = requestBody(config, input);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answer: { id: string | null; responseBytes: Uint8Array; pick: ReturnType<typeof acceptPick> };
  try {
    await opts.onCall?.();
    timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? NPC_BRAIN.timeoutMs);
    const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` };
    // NEAR AI: no alias rewriting, so the model's TEE signs these exact bytes.
    if (provider === "near-ai") headers["x-no-aliasing"] = "true";
    const res = await send(config.url, { method: "POST", headers, body, signal: controller.signal });
    if (!res.ok) {
      console.error(`[npc] brain (${provider}): HTTP ${res.status}; the rules pick`);
      return rulesPick(options, "error", true, provider);
    }
    // The exact response bytes, before any parsing: NEAR AI's signature covers them.
    const responseBytes = new Uint8Array(await res.arrayBuffer());
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(new TextDecoder().decode(responseBytes));
    } catch {
      parsed = null;
    }
    const { id, text } = contentOf(parsed);
    answer = { id, responseBytes, pick: text === null ? ({ ok: false } as const) : acceptPick(options, text) };
  } catch {
    const fallback: BrainFallback = controller.signal.aborted ? "timeout" : "error";
    console.error(`[npc] brain (${provider}): ${fallback}; the rules pick`);
    return rulesPick(options, fallback, true, provider);
  } finally {
    clearTimeout(timer);
  }
  const pick = answer.pick;
  if (!pick.ok) {
    console.error(`[npc] brain (${provider}): unusable answer (cut off, not JSON or not a listed move); the rules pick`);
    return rulesPick(options, "invalid", true, provider);
  }

  const chatId = answer.id;
  const verification: BrainVerification =
    provider === "near-ai"
      ? await verifyNearAiAnswer({
          baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          chatId,
          requestBytes: new TextEncoder().encode(body),
          responseBytes: answer.responseBytes,
          attestation,
          fetch: read,
          timeoutMs: opts.verifyTimeoutMs,
          retryDelayMs: opts.verifyRetryDelayMs,
        }).catch((): BrainVerification => ({ provider, model: config.model, chatId, signingAddress: null, signatureKind: null, verified: false, reason: "verification failed" }))
      : { provider, model: config.model, chatId, signingAddress: null, signatureKind: null, verified: false, reason: "provider signs nothing" };
  if (!verification.verified && provider === "near-ai") console.error(`[npc] brain (near-ai): answer unverified (${verification.reason}); the pick stands`);
  return { action: pick.action, by: config.model, reason: pick.reason, fallback: null, called: true, provider, verification };
}
