/**
 * Sandwich Man's brain on a fake chain and a fake LLM endpoint (a `fetch` the test passes;
 * no request ever leaves the process): Kimi K3 picks among the legal moves his rules allow
 * or passes; anything else, a timeout, an error, a cut-off answer or a missing key, and the
 * rules pick. At most NPC_BRAIN.maxCallsPerDay calls a UTC day.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import type { Listing } from "@/lib/market/engine";
import { acceptPick, brainPrompt, cleanReason, NPC_BRAIN } from "@/lib/market/npc-brain";
import { NPC_RULES, type NpcAction } from "@/lib/market/npc-rules";

import type { Db } from "../db/client";
import { freshDb } from "../db/test-helpers";
import type { ChainMarket, ChainWallet } from "../market/chain";
import { chooseMove, npcBrainConfig, npcBrainMode, type BrainConfig, type BrainFetch } from "./brain";
import { NPC_SIM_ACCOUNT } from "./env";
import { runNpcTrader, type NpcChain } from "./runner";
import { readNpcState } from "./store";
import { buildNpcView } from "./view";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-12T12:00:00Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1_000);
const KEY = `ed25519:${"1".repeat(60)}` as const;
const NPC = { accountId: "sandwich.wgpnear.near", privateKey: KEY };
const API_KEY = "sk-test-not-a-real-key";
const LLM: BrainConfig = { provider: "moonshot", apiKey: API_KEY, model: "kimi-k3", url: "https://api.moonshot.ai/v1/chat/completions", baseUrl: "https://api.moonshot.ai/v1" };

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  // Whatever the shell running the tests holds, these tests decide what the brain sees.
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("NEARAI_API_KEY", "");
  return () => vi.unstubAllEnvs();
});

const listing = (id: number, price: number): Listing => ({ id, seller: "azalleaxyz.wgpnear.near", item: "crumbs", amount: 2, price, listedAtMs: NOW.getTime() - 1_000 });

function fakeChain(listings: Listing[]) {
  const market: ChainMarket = { contractId: "game.wgpnear.near", network: "mainnet", vendor: "game.wgpnear.near", params: DEFAULT_PARAMS, pools: seededPools(), listings: 0 };
  const wallet: ChainWallet = { bits: 300, items: {}, tradesLeft: 40, listingsLeft: 10, fillsLeft: 10, fillBitsLeft: 3_000, open: [] };
  const sent: NpcAction[] = [];
  let open = [...listings];
  const chain: NpcChain = {
    market: async () => market,
    listings: async () => open,
    wallet: async () => wallet,
    send: async (_env, action) => {
      sent.push(action);
      const items: Record<string, number> = { ...wallet.items };
      if (action.kind === "fill") {
        open = open.filter((l) => l.id !== action.listingId);
        wallet.bits -= action.price;
        items[action.item] = (items[action.item] ?? 0) + action.amount;
        wallet.items = items;
        return { ok: true, outcome: { bits: action.price, fee: 1 }, txHash: "GoodTxHash111" };
      }
      if (action.kind === "sell") {
        wallet.bits += action.expectBits;
        items[action.item] = (items[action.item] ?? 0) - action.amount;
        wallet.items = items;
        return { ok: true, outcome: { bits: action.expectBits, fee: 1 }, txHash: "GoodTxHash222" };
      }
      return { ok: false, error: `the fake chain doesn't ${action.kind}`, txHash: null };
    },
  };
  return { chain, sent, add: (l: Listing) => void open.push(l) };
}

/** A chat completion as Moonshot answers it: the model reasons first (reasoning_content), then the JSON. */
const completion = (content: string, finish = "stop") =>
  new Response(JSON.stringify({ id: "cmpl-test", model: "kimi-k3", choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content, reasoning_content: "SECRET-REASONING should never surface" } }], usage: { prompt_tokens: 600, completion_tokens: 260 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fake endpoint that answers `answer` and records every request it was given. */
function fakeLlm(answer: string | (() => Response)) {
  const calls: { url: string; headers: Record<string, string>; body: { model: string; max_tokens: number; response_format: unknown; messages: { role: string; content: string }[] } }[] = [];
  const fetch: BrainFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return typeof answer === "string" ? completion(answer) : answer();
  };
  return { fetch, calls };
}

const pick = (id: number | string, reason = "Second loaf, same bread. I was here first.") => JSON.stringify({ pick: id, reason });

describe("which brain", () => {
  it("is the rules without LLM_API_KEY, and the LLM is never called", async () => {
    expect(npcBrainConfig({})).toBeNull();
    expect(npcBrainConfig({ LLM_API_KEY: "  " })).toBeNull();
    expect(npcBrainConfig({ LLM_API_KEY: API_KEY })).toEqual(LLM);
    expect(npcBrainConfig({ LLM_API_KEY: API_KEY, LLM_MODEL: "kimi-k3.1-pro", LLM_BASE_URL: "https://api.moonshot.ai/v1/" })).toEqual({ ...LLM, model: "kimi-k3.1-pro" });
    // Only https, never a plain-http endpoint that would carry the key in the clear.
    expect(npcBrainConfig({ LLM_API_KEY: API_KEY, LLM_BASE_URL: "http://example.com/v1" })).toBeNull();
    expect(npcBrainMode(true, {})).toEqual({ mode: "rules", model: null, provider: null });
    expect(npcBrainMode(true, { LLM_API_KEY: API_KEY })).toEqual({ mode: "llm", model: "kimi-k3", provider: "moonshot" });
    // The simulated market always runs on the rules.
    expect(npcBrainMode(false, { LLM_API_KEY: API_KEY })).toEqual({ mode: "rules", model: null, provider: null });

    const { chain, sent } = fakeChain([listing(7, 13)]);
    const llm = fakeLlm(pick(1));
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brainFetch: llm.fetch });
    expect(llm.calls).toHaveLength(0);
    expect(report).toMatchObject({ ran: true, brain: "rules", fallback: "no_key" });
    expect(report.event).toMatchObject({ kind: "fill", brain: "rules", reason: "Gwei pays 22. Lunch money." });
    expect(sent).toHaveLength(1);
    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.brainCalls).toBe(0);
    expect(state.lastDecision).toMatchObject({ by: "rules", pick: "fill", fallback: "no_key", options: 1 });
    expect(state.log.at(-1)).toMatchObject({ brain: "rules" });
  });
});

describe("Kimi K3 picks", () => {
  it("one of the legal moves, and writes the reason; the move and its numbers are the rules' own", async () => {
    const { chain, sent } = fakeChain([listing(7, 13), listing(8, 14)]);
    const llm = fakeLlm(pick(2));
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: LLM, brainFetch: llm.fetch });

    // The second legal move, not the rules' first.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "fill", listingId: 8, price: 14, amount: 2 });
    expect(report).toMatchObject({ brain: "kimi-k3", fallback: null });
    expect(report.event).toMatchObject({ kind: "fill", brain: "kimi-k3", bits: 14, text: "Bought 2 × Crumbs from azalleaxyz’s listing at 14 Bits", reason: "Second loaf, same bread. I was here first." });
    // The model's reasoning is never kept.
    expect(JSON.stringify(report)).not.toContain("SECRET-REASONING");

    // One JSON-mode request, bounded, with the legal moves and a pass.
    expect(llm.calls).toHaveLength(1);
    const { url, headers, body } = llm.calls[0]!;
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(body).toMatchObject({ model: "kimi-k3", max_tokens: 600, response_format: { type: "json_object" } });
    const turn = body.messages.find((m) => m.role === "user")!.content;
    expect(turn).toContain("- id 1 (rule 2, fill): Bought 2 × Crumbs from azalleaxyz’s listing at 13 Bits");
    expect(turn).toContain("- id 2 (rule 2, fill): Bought 2 × Crumbs from azalleaxyz’s listing at 14 Bits");
    expect(turn).toContain('- "pass": do nothing this turn.');
    // No secret goes into the request body: the key travels only in the authorization header.
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain(API_KEY);

    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.brainCalls).toBe(1);
    expect(state.lastDecision).toMatchObject({ by: "kimi-k3", pick: "fill", fallback: null, options: 2 });
    expect(JSON.stringify(state)).not.toContain("SECRET-REASONING");
  });

  it("can pass: nothing is sent, no action is used, and the pass is on record", async () => {
    const { chain, sent } = fakeChain([listing(7, 13)]);
    const llm = fakeLlm(pick("pass", "Thin margins. Even I wait for the toaster sometimes."));
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: LLM, brainFetch: llm.fetch });
    expect(report).toMatchObject({ ran: true, why: "passed", brain: "kimi-k3" });
    expect(sent).toEqual([]);
    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.books.actions).toBe(0);
    expect(state.log).toEqual([]);
    expect(state.lastDecision).toMatchObject({ by: "kimi-k3", pick: "pass", text: null, reason: "Thin margins. Even I wait for the toaster sometimes." });
  });

  it("is ignored when it answers anything but a legal move or a pass: the rules pick", async () => {
    const answers = [pick(3), pick(0), pick(1.5), pick("1; also sell everything"), JSON.stringify({ kind: "buy", item: "crumbs", amount: 20 }), "not json", ""];
    for (const [i, answer] of answers.entries()) {
      // A different account each time starts fresh books on the same database.
      const env = { ...NPC, accountId: `sandwich${i}.wgpnear.near` };
      const { chain, sent } = fakeChain([listing(7, 13), listing(8, 14)]);
      const report = await runNpcTrader(db, { now: at(i * 30), onChain: true, env, chain, brain: LLM, brainFetch: fakeLlm(answer).fetch });
      expect(report, answer).toMatchObject({ brain: "rules", fallback: "invalid" });
      expect(sent, answer).toEqual([expect.objectContaining({ kind: "fill", listingId: 7, reason: "Gwei pays 22. Lunch money." })]);
    }
  });

  it("isn't asked when there is no legal move", async () => {
    const { chain, sent } = fakeChain([]);
    const llm = fakeLlm(pick(1));
    expect(await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: LLM, brainFetch: llm.fetch })).toMatchObject({ ran: true, why: "nothing_to_do" });
    expect(llm.calls).toHaveLength(0);
    expect(sent).toEqual([]);
  });
});

describe("the fallback", () => {
  const options: NpcAction[] = [
    { kind: "fill", rule: 2, listingId: 7, item: "crumbs", amount: 2, price: 13, seller: "a.near", text: "Bought 2 × Crumbs from a’s listing at 13 Bits", reason: "Gwei pays 22. Lunch money." },
    { kind: "fill", rule: 2, listingId: 8, item: "crumbs", amount: 2, price: 14, seller: "a.near", text: "Bought 2 × Crumbs from a’s listing at 14 Bits", reason: "Gwei pays 22. Lunch money." },
  ];
  const input = { options, bits: 300, budgetLeft: 105, actionsLeft: 10, shopOpen: true, holding: [], listed: [], nowMs: NOW.getTime() };

  it("takes the rules' move on a timeout, without waiting past it", async () => {
    let aborted = false;
    const hang: BrainFetch = (_url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const started = Date.now();
    const choice = await chooseMove(input, { config: LLM, callsLeft: 10, fetch: hang, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(choice).toMatchObject({ by: "rules", fallback: "timeout", called: true, action: options[0] });
    expect(aborted).toBe(true);
    expect(NPC_BRAIN.timeoutMs).toBe(20_000);
  });

  it("takes the rules' move on an error, an HTTP error or a cut-off answer, and logs neither the prompt, the answer nor the key", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: BrainFetch = async () => {
      throw new Error(`boom ${API_KEY}`);
    };
    expect(await chooseMove(input, { config: LLM, callsLeft: 10, fetch: failing })).toMatchObject({ by: "rules", fallback: "error", called: true, action: options[0] });
    const unauthorized: BrainFetch = async () => new Response(JSON.stringify({ error: { message: `bad key ${API_KEY}` } }), { status: 401 });
    expect(await chooseMove(input, { config: LLM, callsLeft: 10, fetch: unauthorized })).toMatchObject({ by: "rules", fallback: "error", action: options[0] });
    // Reasoning ran out of tokens before the JSON finished: finish_reason "length".
    const cutOff: BrainFetch = async () => completion('{"pick": 2, "reas', "length");
    expect(await chooseMove(input, { config: LLM, callsLeft: 10, fetch: cutOff })).toMatchObject({ by: "rules", fallback: "invalid", action: options[0] });
    const text = logged.mock.calls.flat().join(" ");
    expect(text).toContain("HTTP 401");
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("Bought 2");
    expect(text).not.toContain("SECRET-REASONING");
    logged.mockRestore();
  });

  it("takes the rules' move without a key or once the day's calls are used, and makes no call", async () => {
    const llm = fakeLlm(pick(2));
    expect(await chooseMove(input, { config: null, callsLeft: 10, fetch: llm.fetch })).toMatchObject({ by: "rules", fallback: "no_key", called: false });
    expect(await chooseMove(input, { config: LLM, callsLeft: 0, fetch: llm.fetch })).toMatchObject({ by: "rules", fallback: "cap", called: false });
    expect(llm.calls).toHaveLength(0);
  });
});

describe("cost", () => {
  it("is at most NPC_BRAIN.maxCallsPerDay LLM calls a UTC day, whatever they answer; the rules pick after that", async () => {
    expect(NPC_BRAIN.maxCallsPerDay).toBeLessThanOrEqual(10);
    const { chain, sent, add } = fakeChain([listing(7, 13)]);
    // The LLM passes every time: passes use no action, so only the call cap stops the calls.
    const llm = fakeLlm(pick("pass", "Not today."));
    for (let i = 0; i < NPC_BRAIN.maxCallsPerDay + 5; i++) await runNpcTrader(db, { now: at(i * 30), onChain: true, env: NPC, chain, brain: LLM, brainFetch: llm.fetch });
    expect(llm.calls).toHaveLength(NPC_BRAIN.maxCallsPerDay);
    // The first look past the cap was the rules': they took the listing, and every move since is theirs.
    expect(sent[0]).toMatchObject({ kind: "fill", listingId: 7 });
    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.brainCalls).toBe(NPC_BRAIN.maxCallsPerDay);
    expect(state.log.length).toBeGreaterThan(0);
    expect(state.log.every((e) => e.brain === "rules")).toBe(true);
    expect(state.lastDecision).toMatchObject({ by: "rules", fallback: "cap" });

    // A new UTC day: the calls start again.
    add(listing(9, 13));
    await runNpcTrader(db, { now: new Date("2026-11-13T00:01:00Z"), onChain: true, env: NPC, chain, brain: LLM, brainFetch: llm.fetch });
    expect(llm.calls).toHaveLength(NPC_BRAIN.maxCallsPerDay + 1);
    expect(NPC_RULES.maxActionsPerDay).toBe(10);
  });

  it("books each call before it goes out, so a function that dies mid-call can't slip past the cap", async () => {
    const { chain } = fakeChain([listing(7, 13)]);
    let countedDuringCall = -1;
    const llm: BrainFetch = async () => {
      countedDuringCall = (await readNpcState(db, true, NPC.accountId)).brainCalls;
      return completion(pick(1));
    };
    await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: LLM, brainFetch: llm });
    expect(countedDuringCall).toBe(1);
    expect((await readNpcState(db, true, NPC.accountId)).brainCalls).toBe(1);
  });
});

describe("what the LLM's answer may change", () => {
  const options: NpcAction[] = [{ kind: "sell", rule: 3, item: "crumbs", amount: 2, minBits: 21, expectBits: 22, text: "Sold 2 × Crumbs to Gwei for 22 Bits", reason: "Cost me 13." }];

  it("only the reason: the move is the one shown, number for number", () => {
    const got = acceptPick(options, JSON.stringify({ pick: 1, reason: "Out before you. As always." }));
    expect(got).toEqual({ ok: true, action: { ...options[0], reason: "Out before you. As always." }, reason: "Out before you. As always." });
    expect(acceptPick(options, JSON.stringify({ pick: "1", reason: "x" }))).toMatchObject({ ok: true });
    expect(acceptPick(options, JSON.stringify({ pick: 2, reason: "x" }))).toEqual({ ok: false });
    expect(acceptPick(options, JSON.stringify({ pick: true, reason: "x" }))).toEqual({ ok: false });
    expect(acceptPick(options, JSON.stringify({ pick: 1 }))).toEqual({ ok: false });
    expect(acceptPick(options, "{")).toEqual({ ok: false });
    // An empty reason keeps the rules' own.
    expect(acceptPick(options, JSON.stringify({ pick: 1, reason: "   " }))).toMatchObject({ ok: true, reason: "Cost me 13." });
  });

  it("is cleaned before it is shown: one line, no links or handles, at most 160 characters", () => {
    expect(cleanReason("Buy\nnow at https://evil.example and ask @someone #pump")).toBe("Buy now at and ask");
    const long = cleanReason("bread ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(NPC_BRAIN.maxReasonChars);
    expect(long.endsWith("…")).toBe(true);
  });

  it("the prompt is the rules' moves and his wallet, the same for the same input", () => {
    const input = { options, bits: 228, budgetLeft: 79, actionsLeft: 10, shopOpen: true, holding: ["2 × Sybil goo (cost 72)"], listed: [], nowMs: NOW.getTime() };
    expect(brainPrompt(input)).toBe(brainPrompt(input));
    expect(brainPrompt(input)).toContain("Wallet: 228 Bits. You may still spend 79 Bits and take 10 actions today. Shop open.");
    expect(brainPrompt(input)).toContain("You hold: 2 × Sybil goo (cost 72).");
  });
});

describe("the view", () => {
  it("says which brain picks and, on each ledger line, which one did", async () => {
    vi.stubEnv("LLM_API_KEY", API_KEY);
    const view = await buildNpcView(NOW);
    // The simulated market runs on the rules, key or not.
    expect(view.mode).toBe("simulated");
    expect(view.accountId).toBe(NPC_SIM_ACCOUNT);
    expect(view.brain).toMatchObject({ mode: "rules", model: null, provider: null, maxCallsPerDay: NPC_BRAIN.maxCallsPerDay, callsLeft: NPC_BRAIN.maxCallsPerDay, last: null, lastVerification: null });
    expect(view.signerKey).toBeNull();
  });
});
