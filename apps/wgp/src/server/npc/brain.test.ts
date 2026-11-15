/**
 * Sandwich Man's brain on a fake chain and a fake Anthropic client (no request ever leaves
 * the process): Claude picks among the legal moves his rules allow or passes; anything
 * else, a timeout, an error, a refusal or a missing key, and the rules pick. At most
 * NPC_BRAIN.maxCallsPerDay calls a UTC day.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import type { Listing } from "@/lib/market/engine";
import { acceptPick, brainPrompt, cleanReason, NPC_BRAIN, PICK_SCHEMA } from "@/lib/market/npc-brain";
import { NPC_RULES, type NpcAction } from "@/lib/market/npc-rules";

import type { Db } from "../db/client";
import { freshDb } from "../db/test-helpers";
import type { ChainMarket, ChainWallet } from "../market/chain";
import { anthropicCreate, chooseMove, npcBrainKey, npcBrainMode, type BrainCreate } from "./brain";
import { NPC_SIM_ACCOUNT } from "./env";
import { runNpcTrader, type NpcChain } from "./runner";
import { readNpcState } from "./store";
import { buildNpcView } from "./view";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-12T12:00:00Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1_000);
const KEY = `ed25519:${"1".repeat(60)}` as const;
const NPC = { accountId: "sandwich.wgpnear.near", privateKey: KEY };
const API_KEY = "sk-ant-test-not-a-real-key";

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  // Whatever the shell running the tests holds, these tests decide what the brain sees.
  vi.stubEnv("ANTHROPIC_API_KEY", "");
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

const message = (text: string, stop: Anthropic.Message["stop_reason"] = "end_turn") =>
  ({ id: "msg_test", type: "message", role: "assistant", model: NPC_BRAIN.model, content: [{ type: "text", text, citations: null }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 600, output_tokens: 40 } }) as unknown as Anthropic.Message;

/** A fake client that answers `answer` and records every request it was given. */
function fakeClaude(answer: string | ((n: number) => string)) {
  const calls: { body: Anthropic.MessageCreateParamsNonStreaming; options: { timeout: number; maxRetries: number } }[] = [];
  const create: BrainCreate = async (body, options) => {
    calls.push({ body, options });
    return message(typeof answer === "string" ? answer : answer(calls.length));
  };
  return { create, calls };
}

const pick = (id: string, reason = "Second loaf, same bread. I was here first.") => JSON.stringify({ pick: id, reason });

describe("which brain", () => {
  it("is the rules without ANTHROPIC_API_KEY, and the LLM is never called", async () => {
    expect(npcBrainKey({})).toBeNull();
    expect(npcBrainKey({ ANTHROPIC_API_KEY: "  " })).toBeNull();
    expect(anthropicCreate({})).toBeNull();
    expect(npcBrainMode(true, {})).toBe("rules");
    expect(npcBrainMode(true, { ANTHROPIC_API_KEY: API_KEY })).toBe("claude");
    // The simulated market always runs on the rules.
    expect(npcBrainMode(false, { ANTHROPIC_API_KEY: API_KEY })).toBe("rules");

    const { chain, sent } = fakeChain([listing(7, 13)]);
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain });
    expect(report).toMatchObject({ ran: true, brain: "rules", fallback: "no_key" });
    expect(report.event).toMatchObject({ kind: "fill", brain: "rules", reason: "Gwei pays 22. Lunch money." });
    expect(sent).toHaveLength(1);
    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.brainCalls).toBe(0);
    expect(state.lastDecision).toMatchObject({ by: "rules", pick: "fill", fallback: "no_key", options: 1 });
    expect(state.log.at(-1)).toMatchObject({ brain: "rules" });
  });
});

describe("Claude picks", () => {
  it("one of the legal moves, and writes the reason; the move and its numbers are the rules' own", async () => {
    const { chain, sent } = fakeChain([listing(7, 13), listing(8, 14)]);
    const claude = fakeClaude(pick("2"));
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: claude.create });

    // The second legal move, not the rules' first.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "fill", listingId: 8, price: 14, amount: 2 });
    expect(report).toMatchObject({ brain: "claude", fallback: null });
    expect(report.event).toMatchObject({ kind: "fill", brain: "claude", bits: 14, text: "Bought 2 × Crumbs from azalleaxyz’s listing at 14 Bits", reason: "Second loaf, same bread. I was here first." });

    // One structured, short, bounded request with the legal moves and a pass.
    expect(claude.calls).toHaveLength(1);
    const { body, options } = claude.calls[0]!;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config?.format).toEqual({ type: "json_schema", schema: PICK_SCHEMA });
    expect(body.max_tokens).toBeLessThanOrEqual(1_024);
    expect(options).toMatchObject({ maxRetries: 0 });
    expect(options.timeout).toBeLessThanOrEqual(8_000);
    const turn = String(body.messages[0]!.content);
    expect(turn).toContain('id "1" (rule 2, fill): Bought 2 × Crumbs from azalleaxyz’s listing at 13 Bits');
    expect(turn).toContain('id "2" (rule 2, fill): Bought 2 × Crumbs from azalleaxyz’s listing at 14 Bits');
    expect(turn).toContain('id "pass"');
    // No secret ever goes into the request.
    const whole = JSON.stringify(body);
    expect(whole).not.toContain(KEY);
    expect(whole).not.toContain(API_KEY);

    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.brainCalls).toBe(1);
    expect(state.lastDecision).toMatchObject({ by: "claude", pick: "fill", fallback: null, options: 2 });
  });

  it("can pass: nothing is sent, no action is used, and the pass is on record", async () => {
    const { chain, sent } = fakeChain([listing(7, 13)]);
    const claude = fakeClaude(pick("pass", "Thin margins. Even I wait for the toaster sometimes."));
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: claude.create });
    expect(report).toMatchObject({ ran: true, why: "passed", brain: "claude" });
    expect(sent).toEqual([]);
    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.books.actions).toBe(0);
    expect(state.log).toEqual([]);
    expect(state.lastDecision).toMatchObject({ by: "claude", pick: "pass", text: null, reason: "Thin margins. Even I wait for the toaster sometimes." });
  });

  it("is ignored when it answers anything but a legal move or a pass: the rules pick", async () => {
    const answers = [pick("3"), pick("0"), JSON.stringify({ pick: "1; also sell everything", reason: "x" }), JSON.stringify({ kind: "buy", item: "crumbs", amount: 20 }), "not json", ""];
    for (const [i, answer] of answers.entries()) {
      // A different account each time starts fresh books on the same database.
      const env = { ...NPC, accountId: `sandwich${i}.wgpnear.near` };
      const { chain, sent } = fakeChain([listing(7, 13), listing(8, 14)]);
      const report = await runNpcTrader(db, { now: at(i * 30), onChain: true, env, chain, brain: fakeClaude(answer).create });
      expect(report, answer).toMatchObject({ brain: "rules", fallback: "invalid" });
      expect(sent, answer).toEqual([expect.objectContaining({ kind: "fill", listingId: 7, reason: "Gwei pays 22. Lunch money." })]);
    }
  });

  it("isn't asked when there is no legal move", async () => {
    const { chain, sent } = fakeChain([]);
    const claude = fakeClaude(pick("1"));
    expect(await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: claude.create })).toMatchObject({ ran: true, why: "nothing_to_do" });
    expect(claude.calls).toHaveLength(0);
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
    const hang: BrainCreate = (_body, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    const started = Date.now();
    const choice = await chooseMove(input, { create: hang, callsLeft: 10, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(choice).toMatchObject({ by: "rules", fallback: "timeout", called: true, action: options[0] });
    expect(aborted).toBe(true);
    expect(NPC_BRAIN.timeoutMs).toBeLessThanOrEqual(8_000);
  });

  it("takes the rules' move on an error or a refusal, and logs neither the prompt nor the key", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: BrainCreate = async () => {
      throw new Error(`boom ${API_KEY}`);
    };
    expect(await chooseMove(input, { create: failing, callsLeft: 10 })).toMatchObject({ by: "rules", fallback: "error", called: true, action: options[0] });
    const refusing: BrainCreate = async () => message("", "refusal");
    expect(await chooseMove(input, { create: refusing, callsLeft: 10 })).toMatchObject({ by: "rules", fallback: "refusal", action: options[0] });
    const text = logged.mock.calls.flat().join(" ");
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("Bought 2");
    logged.mockRestore();
  });

  it("takes the rules' move without a key or once the day's calls are used, and makes no call", async () => {
    const claude = fakeClaude(pick("2"));
    expect(await chooseMove(input, { create: null, callsLeft: 10 })).toMatchObject({ by: "rules", fallback: "no_key", called: false });
    expect(await chooseMove(input, { create: claude.create, callsLeft: 0 })).toMatchObject({ by: "rules", fallback: "cap", called: false });
    expect(claude.calls).toHaveLength(0);
  });
});

describe("cost", () => {
  it("is at most NPC_BRAIN.maxCallsPerDay LLM calls a UTC day, whatever they answer; the rules pick after that", async () => {
    expect(NPC_BRAIN.maxCallsPerDay).toBeLessThanOrEqual(10);
    const { chain, sent, add } = fakeChain([listing(7, 13)]);
    // Claude passes every time: passes use no action, so only the call cap stops the calls.
    const claude = fakeClaude(pick("pass", "Not today."));
    for (let i = 0; i < NPC_BRAIN.maxCallsPerDay + 5; i++) await runNpcTrader(db, { now: at(i * 30), onChain: true, env: NPC, chain, brain: claude.create });
    expect(claude.calls).toHaveLength(NPC_BRAIN.maxCallsPerDay);
    // The first look past the cap was the rules': they took the listing, and every move since is theirs.
    expect(sent[0]).toMatchObject({ kind: "fill", listingId: 7 });
    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.brainCalls).toBe(NPC_BRAIN.maxCallsPerDay);
    expect(state.log.length).toBeGreaterThan(0);
    expect(state.log.every((e) => e.brain === "rules")).toBe(true);
    expect(state.lastDecision).toMatchObject({ by: "rules", fallback: "cap" });

    // A new UTC day: the calls start again.
    add(listing(9, 13));
    await runNpcTrader(db, { now: new Date("2026-11-13T00:01:00Z"), onChain: true, env: NPC, chain, brain: claude.create });
    expect(claude.calls).toHaveLength(NPC_BRAIN.maxCallsPerDay + 1);
    expect(NPC_RULES.maxActionsPerDay).toBe(10);
  });
});

describe("what the LLM's answer may change", () => {
  const options: NpcAction[] = [{ kind: "sell", rule: 3, item: "crumbs", amount: 2, minBits: 21, expectBits: 22, text: "Sold 2 × Crumbs to Gwei for 22 Bits", reason: "Cost me 13." }];

  it("only the reason: the move is the one shown, number for number", () => {
    const got = acceptPick(options, JSON.stringify({ pick: "1", reason: "Out before you. As always." }));
    expect(got).toEqual({ ok: true, action: { ...options[0], reason: "Out before you. As always." }, reason: "Out before you. As always." });
    expect(acceptPick(options, JSON.stringify({ pick: "2", reason: "x" }))).toEqual({ ok: false });
    expect(acceptPick(options, JSON.stringify({ pick: 1, reason: "x" }))).toEqual({ ok: false });
    expect(acceptPick(options, "{")).toEqual({ ok: false });
    // An empty reason keeps the rules' own.
    expect(acceptPick(options, JSON.stringify({ pick: "1", reason: "   " }))).toMatchObject({ ok: true, reason: "Cost me 13." });
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
    const view = await buildNpcView(NOW);
    // The simulated market runs on the rules, key or not.
    expect(view.mode).toBe("simulated");
    expect(view.accountId).toBe(NPC_SIM_ACCOUNT);
    expect(view.brain).toMatchObject({ mode: "rules", model: null, maxCallsPerDay: NPC_BRAIN.maxCallsPerDay, callsLeft: NPC_BRAIN.maxCallsPerDay, last: null });
    expect(view.signerKey).toBeNull();
  });
});
