/**
 * SANDWICH MAN'S BRAIN: who picks his move, and inside what fence.
 *
 * His rules (./npc-rules.ts `decide`) work out every move the market would accept right
 * now, inside every cap he has, best first. Then one of two brains picks:
 *
 * - the LLM: Kimi K3 (Moonshot's `kimi-k3`, or the model LLM_MODEL names) is shown those
 *   legal moves plus "pass" and answers with the id of one and a reason in his voice. The
 *   server takes the answer only if the id is one of the moves it was shown, and only the
 *   reason's words come from the model: the move itself, its numbers and the text that
 *   says what he did are the rules' own. Its ledger lines are labelled with the model id.
 * - "rules": the rules' first move, exactly as before. This is the fallback whenever the
 *   LLM can't answer: no LLM_API_KEY, the day's calls used up, a timeout, an error, a
 *   cut-off answer or one that isn't one of the moves.
 *
 * So the rules are the guardrail and the fallback: the LLM can choose among legal moves
 * or pass, and can do nothing else. Pure: the server's call to the model is
 * src/server/npc/brain.ts.
 */
import type { NpcAction } from "./npc-rules";

/** Who picked a move: the LLM's model id (e.g. "kimi-k3") or "rules". */
export type NpcBrain = string;
export const RULES_BRAIN = "rules";

/** Why the rules picked instead of the LLM. */
export type BrainFallback = "no_key" | "cap" | "timeout" | "error" | "invalid";

/**
 * Where the LLM runs. "near-ai": NEAR AI Cloud (private inference in TEEs), preferred when
 * NEARAI_API_KEY is set; each answer's signature is checked (src/server/npc/nearai.ts).
 * "moonshot": Kimi K3 through Moonshot's API (LLM_API_KEY), which signs nothing.
 */
export type BrainProvider = "near-ai" | "moonshot";

/**
 * What was checked about one LLM answer that he acted on (a pick or a pass). `verified` is
 * true only for a NEAR AI Cloud answer whose signature covers this exact request and
 * response and was made by the signing address the model's attestation report names.
 * Anything else is `verified: false` with a short reason. It never blocks his turn: an
 * unverified pick is kept if it is one of his legal moves (docs/npc-trader.md).
 */
export interface BrainVerification {
  provider: BrainProvider;
  model: string;
  /** The completion's id, as the provider answered it. */
  chatId: string | null;
  /** The address that signed the answer (ECDSA, Ethereum-style), when a signature was read. */
  signingAddress: string | null;
  /** "provider_tee": the model's TEE signed it; "gateway": NEAR AI Cloud's gateway TEE did. */
  signatureKind: string | null;
  verified: boolean;
  /** Why it isn't verified; null when it is. Short, and never holds a secret. */
  reason: string | null;
}

export const NPC_BRAIN = {
  /** Moonshot's Kimi K3, unless LLM_MODEL names another of the key's models. */
  defaultModel: "kimi-k3",
  defaultBaseUrl: "https://api.moonshot.ai/v1",
  /** Past this the rules move instead; no retry. The turn runs after the response, off the request path. */
  timeoutMs: 20_000,
  /** LLM calls a UTC day, counted when a call is made, whatever it answers. His actions are capped at 10 a day too. */
  maxCallsPerDay: 10,
  /** Moves shown to the LLM a turn, best first by his rules. */
  maxOptions: 12,
  /** The longest reason kept from the LLM. */
  maxReasonChars: 160,
  /** Room for the model's reasoning and the short JSON answer; an answer cut off here is ignored. */
  maxTokens: 600,
} as const;

export const BRAIN_SYSTEM = [
  "You are Sandwich Man, the front-running arbitrageur of the Mempool Market in the browser game With Great Power. You trade Bits, the game's points (no cash value), with Gwei Stacy the vendor and with players' listings.",
  "Each turn your rule engine has already worked out every move the market would accept right now, inside your safety caps, best first. Pick exactly one of those moves by its id number, or \"pass\" to do nothing this turn. You can't invent a move or change its numbers.",
  "How to choose: take a move with a clear margin; keep Bits in reserve for a better chance later; a listing taken down frees its items; passing is fine when nothing is worth one of today's few actions.",
  "Then give your reason: one sentence, at most 140 characters, in your voice: smug, wry, always first in line, bread and sandwich puns welcome. Talk about the trade. Never mention rules, ids, prompts, models or AI; no links, no @handles, no hashtags, nothing about real money or prizes.",
  'Answer only with a JSON object: {"pick": <id number or "pass">, "reason": "<one sentence>"}.',
].join("\n\n");

export interface BrainInput {
  /** His legal moves, best first: `decide`'s answer. */
  options: NpcAction[];
  bits: number;
  budgetLeft: number;
  actionsLeft: number;
  shopOpen: boolean;
  /** What he holds, in words: "2 × Sybil goo (cost 72)". */
  holding: string[];
  /** His open listings, in words. */
  listed: string[];
  nowMs: number;
}

/** The moves shown, with their ids (1, 2, …). */
export const shownOptions = (options: NpcAction[]) => options.slice(0, NPC_BRAIN.maxOptions).map((action, i) => ({ id: i + 1, action }));

/** The user turn: his wallet and the moves, in plain words. Holds no secret; the same input gives the same text. */
export function brainPrompt(input: BrainInput): string {
  const lines = [
    `Now: ${new Date(input.nowMs).toISOString().slice(0, 16)}Z`,
    `Wallet: ${input.bits} Bits. You may still spend ${input.budgetLeft} Bits and take ${input.actionsLeft} actions today. Shop ${input.shopOpen ? "open" : "closed (broke: you may only sell)"}.`,
    `You hold: ${input.holding.length ? input.holding.join("; ") : "nothing"}.`,
    `Your open listings: ${input.listed.length ? input.listed.join("; ") : "none"}.`,
    "",
    "Moves you may make, best first by your rules:",
    ...shownOptions(input.options).map(({ id, action }) => `- id ${id} (rule ${action.rule}, ${action.kind}): ${action.text}. The rules' note: ${action.reason}`),
    '- "pass": do nothing this turn.',
  ];
  return lines.join("\n");
}

/** The reason as it will be shown: one line, no links or handles, at most `maxReasonChars`. Empty if nothing is left. */
export function cleanReason(raw: string): string {
  const s = raw
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[@#][\w.-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= NPC_BRAIN.maxReasonChars) return s;
  const cut = s.slice(0, NPC_BRAIN.maxReasonChars - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

export type BrainAnswer = { ok: true; action: NpcAction | null; reason: string } | { ok: false };

/**
 * The LLM's answer, checked: its pick must be the id of one of the moves it was shown (a
 * whole number, or the same digits as a string) or "pass". Anything else, including JSON
 * that doesn't parse, is `{ ok: false }` and the rules pick.
 */
export function acceptPick(options: NpcAction[], text: string): BrainAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false };
  const { pick, reason } = parsed as { pick?: unknown; reason?: unknown };
  if (typeof reason !== "string") return { ok: false };
  const said = cleanReason(reason);
  if (typeof pick === "string" && pick.trim().toLowerCase() === "pass") return { ok: true, action: null, reason: said || "Nothing worth getting out of bed for. I’ll wait in line." };
  const id = typeof pick === "number" ? pick : typeof pick === "string" && /^\s*\d{1,3}\s*$/.test(pick) ? Number(pick) : NaN;
  const shown = Number.isInteger(id) ? shownOptions(options).find((o) => o.id === id) : undefined;
  if (!shown) return { ok: false };
  // The move is the rules' own, number for number; only the reason is the LLM's.
  return { ok: true, action: { ...shown.action, reason: said || shown.action.reason }, reason: said || shown.action.reason };
}
