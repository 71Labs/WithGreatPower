/**
 * The server's half of Sandwich Man's brain (src/lib/market/npc-brain.ts): one call to an
 * OpenAI-compatible chat completions endpoint a turn (Moonshot's Kimi K3 by default), with
 * his legal moves, and the rules' first move whenever that call can't give a usable answer.
 *
 * - Environment: LLM_API_KEY (the secret; unset, the LLM is never called and the rules
 *   pick every move), LLM_MODEL (default kimi-k3), LLM_BASE_URL (default
 *   https://api.moonshot.ai/v1). The key is read only here and sent only as the request's
 *   bearer token; it is never logged or returned.
 * - Cost, bounded by construction: at most NPC_BRAIN.maxCallsPerDay calls a UTC day
 *   (counted in his state, src/server/npc/store.ts), one per turn, no retries, a 20 s
 *   timeout, at most NPC_BRAIN.maxTokens tokens out.
 * - Nothing the model says is trusted: `acceptPick` keeps its move only if it is one of
 *   the moves it was shown, and only the reason's words reach his ledger. The model's
 *   `reasoning_content` is never read, logged or shown.
 * - Logs name what failed (a timeout, an HTTP status), never the prompt, the answer or the key.
 * - Plain fetch, no SDK. Tests pass their own `fetch`.
 */
import { acceptPick, BRAIN_SYSTEM, brainPrompt, NPC_BRAIN, RULES_BRAIN, type BrainFallback, type BrainInput, type NpcBrain } from "@/lib/market/npc-brain";
import type { NpcAction } from "@/lib/market/npc-rules";

type Env = Record<string, string | undefined>;

export interface BrainConfig {
  apiKey: string;
  model: string;
  /** The chat completions URL. */
  url: string;
}

/** The fetch the brain uses; tests pass a fake. */
export type BrainFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

/** The LLM's settings, or null when it is off (no key, or a base URL that isn't https). Never throws, never logs. */
export function npcBrainConfig(env: Env = process.env): BrainConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.LLM_MODEL?.trim();
  const base = (env.LLM_BASE_URL?.trim() || NPC_BRAIN.defaultBaseUrl).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${base}/chat/completions`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return { apiKey, model: model && MODEL_ID.test(model) ? model : NPC_BRAIN.defaultModel, url: url.toString() };
}

/** Who picks his on-chain moves with this environment: "llm" with a key, else "rules". The simulated market always runs on the rules. */
export function npcBrainMode(onChain: boolean, env: Env = process.env): { mode: "llm" | "rules"; model: string | null } {
  const config = onChain ? npcBrainConfig(env) : null;
  return config ? { mode: "llm", model: config.model } : { mode: "rules", model: null };
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
}

const rulesPick = (options: NpcAction[], fallback: BrainFallback, called: boolean): NpcChoice => ({ action: options[0] ?? null, by: RULES_BRAIN, reason: options[0]?.reason ?? "", fallback, called });

/** The one part of a chat completion the brain reads: the first choice's content, if the model finished. */
function contentOf(body: unknown): string | null {
  const choice = (body as { choices?: { finish_reason?: unknown; message?: { content?: unknown } }[] } | null)?.choices?.[0];
  if (!choice || choice.finish_reason !== "stop") return null;
  return typeof choice.message?.content === "string" ? choice.message.content : null;
}

/**
 * Picks this turn's move from `input.options` (his legal moves, best first). The LLM picks
 * when `config` is given and `callsLeft` > 0; otherwise, or when its answer is unusable,
 * the rules' first move. Never throws.
 */
export async function chooseMove(
  input: BrainInput,
  opts: {
    config: BrainConfig | null;
    callsLeft: number;
    fetch?: BrainFetch;
    timeoutMs?: number;
    /** Runs (and is awaited) just before the request goes out, so the call is counted even if the function dies mid-call. */
    onCall?: () => Promise<void>;
  },
): Promise<NpcChoice> {
  const { options } = input;
  if (options.length === 0) return { action: null, by: RULES_BRAIN, reason: "", fallback: null, called: false };
  const { config } = opts;
  if (!config) return rulesPick(options, "no_key", false);
  if (opts.callsLeft <= 0) return rulesPick(options, "cap", false);

  const send: BrainFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await opts.onCall?.();
    timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? NPC_BRAIN.timeoutMs);
    const res = await send(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        max_tokens: NPC_BRAIN.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: BRAIN_SYSTEM },
          { role: "user", content: brainPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[npc] brain: HTTP ${res.status}; the rules pick`);
      return rulesPick(options, "error", true);
    }
    const text = contentOf(await res.json());
    const answer = text === null ? ({ ok: false } as const) : acceptPick(options, text);
    if (!answer.ok) {
      console.error("[npc] brain: unusable answer (cut off, not JSON or not a listed move); the rules pick");
      return rulesPick(options, "invalid", true);
    }
    return { action: answer.action, by: config.model, reason: answer.reason, fallback: null, called: true };
  } catch {
    const fallback: BrainFallback = controller.signal.aborted ? "timeout" : "error";
    console.error(`[npc] brain: ${fallback}; the rules pick`);
    return rulesPick(options, fallback, true);
  } finally {
    clearTimeout(timer);
  }
}
