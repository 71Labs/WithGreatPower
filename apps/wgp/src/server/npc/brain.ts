/**
 * The server's half of Sandwich Man's brain (src/lib/market/npc-brain.ts): one call to
 * Anthropic's Messages API a turn, with his legal moves, and the rules' first move
 * whenever that call can't give a usable answer.
 *
 * - Key: ANTHROPIC_API_KEY. Unset, the LLM is never called and the rules pick every move.
 *   The key is read only here and handed to the SDK; it is never logged or returned.
 * - Cost, bounded by construction: at most NPC_BRAIN.maxCallsPerDay calls a UTC day
 *   (counted in his state, src/server/npc/store.ts), one per turn, no retries, an 8 s
 *   timeout, a short structured answer.
 * - Nothing the model says is trusted: `acceptPick` keeps its move only if it is one of
 *   the moves it was shown, and only the reason's words reach his ledger.
 * - Logs name what failed (a timeout, an HTTP status), never the prompt or the key.
 */
import Anthropic from "@anthropic-ai/sdk";

import { acceptPick, BRAIN_SYSTEM, brainPrompt, NPC_BRAIN, PICK_SCHEMA, type BrainFallback, type BrainInput, type NpcBrain } from "@/lib/market/npc-brain";
import type { NpcAction } from "@/lib/market/npc-rules";

/** The one SDK call the brain makes; tests swap in a fake. */
export type BrainCreate = (body: Anthropic.MessageCreateParamsNonStreaming, options: { timeout: number; maxRetries: number; signal: AbortSignal }) => Promise<Anthropic.Message>;

/** The API key, or null when the LLM is off. Never throws, never logs. */
export function npcBrainKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

/** Which brain picks his on-chain moves with this environment. The simulated market always runs on the rules. */
export function npcBrainMode(onChain: boolean, env: Record<string, string | undefined> = process.env): NpcBrain {
  return onChain && npcBrainKey(env) !== null ? "claude" : "rules";
}

/** The real call, or null without a key. */
export function anthropicCreate(env: Record<string, string | undefined> = process.env): BrainCreate | null {
  const apiKey = npcBrainKey(env);
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: NPC_BRAIN.timeoutMs });
  return (body, options) => client.messages.create(body, options);
}

export interface NpcChoice {
  /** The move to send, or null to pass (only the LLM passes; the rules always take their first move). */
  action: NpcAction | null;
  by: NpcBrain;
  reason: string;
  /** Set when the rules picked because the LLM couldn't. */
  fallback: BrainFallback | null;
  /** Whether an LLM call was made (it counts against the day's calls whatever it answered). */
  called: boolean;
}

const rulesPick = (options: NpcAction[], fallback: BrainFallback, called: boolean): NpcChoice => ({ action: options[0] ?? null, by: "rules", reason: options[0]?.reason ?? "", fallback, called });

function failureOf(error: unknown, timedOut: boolean): BrainFallback {
  if (timedOut || error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  return "error";
}

/**
 * Picks this turn's move from `input.options` (his legal moves, best first). The LLM picks
 * when `create` is given and `callsLeft` > 0; otherwise, or when its answer is unusable,
 * the rules' first move. Never throws.
 */
export async function chooseMove(input: BrainInput, opts: { create: BrainCreate | null; callsLeft: number; timeoutMs?: number }): Promise<NpcChoice> {
  const { options } = input;
  if (options.length === 0) return { action: null, by: "rules", reason: "", fallback: null, called: false };
  if (!opts.create) return rulesPick(options, "no_key", false);
  if (opts.callsLeft <= 0) return rulesPick(options, "cap", false);

  const timeoutMs = opts.timeoutMs ?? NPC_BRAIN.timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    const message = await Promise.race([
      opts.create(
        {
          model: NPC_BRAIN.model,
          max_tokens: NPC_BRAIN.maxTokens,
          system: BRAIN_SYSTEM,
          messages: [{ role: "user", content: brainPrompt(input) }],
          output_config: { effort: "low", format: { type: "json_schema", schema: PICK_SCHEMA } },
        },
        { timeout: timeoutMs, maxRetries: 0, signal: controller.signal },
      ),
      deadline,
    ]);
    if (message.stop_reason === "refusal") return rulesPick(options, "refusal", true);
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const answer = acceptPick(options, text);
    if (!answer.ok) {
      console.error(`[npc] brain: unusable answer (stop_reason ${message.stop_reason}); the rules pick`);
      return rulesPick(options, "invalid", true);
    }
    return { action: answer.action, by: "claude", reason: answer.reason, fallback: null, called: true };
  } catch (error) {
    const fallback = failureOf(error, timedOut);
    const status = error instanceof Anthropic.APIError && error.status ? ` ${error.status}` : "";
    console.error(`[npc] brain: ${fallback}${status}; the rules pick`);
    return rulesPick(options, fallback, true);
  } finally {
    clearTimeout(timer);
  }
}
