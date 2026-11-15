/**
 * NEAR AI Cloud as Sandwich Man's brain, with fake endpoints only (the suite fails any real
 * network request): which provider is picked, the attestation report's nonce and report-data
 * checks, the signature's binding to the exact request and response bytes, the signer
 * compared with the attested address, and that a failed or missing check never blocks his
 * turn or leaks a secret. Signatures are made in the test with a throwaway secp256k1 key.
 */
import { createHash } from "node:crypto";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import type { Listing } from "@/lib/market/engine";
import type { NpcAction } from "@/lib/market/npc-rules";

import type { Db } from "../db/client";
import { freshDb } from "../db/test-helpers";
import type { ChainMarket, ChainWallet } from "../market/chain";
import { NPC_VISIT_GAP_MS } from "../background";
import { chooseMove, npcBrainConfig, npcBrainMode, type BrainConfig, type BrainFetch } from "./brain";
import {
  addressOfPublicKey,
  attestationFor,
  checkReport,
  checkSignature,
  clearAttestationCache,
  eip191Hash,
  NEARAI,
  recoverSigner,
  TDX_REPORT_DATA_OFFSET,
  type NearAiAttestation,
  type NearAiFetch,
} from "./nearai";
import { runNpcTrader, type NpcChain } from "./runner";
import { readNpcState } from "./store";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-15T12:00:00Z");
const NPC = { accountId: "sandwich.wgpnear.near", privateKey: `ed25519:${"1".repeat(60)}` as const };
const NEAR_KEY = "sk-nearai-test-not-a-real-key";
const MODEL = NEARAI.defaultModel;
const BASE = "https://cloud-api.near.ai/v1";
const NEAR: BrainConfig = { provider: "near-ai", apiKey: NEAR_KEY, model: MODEL, url: `${BASE}/chat/completions`, baseUrl: BASE };

/** Two throwaway signing keys: the model's (attested) and an impostor's. */
const MODEL_KEY = new Uint8Array(32).fill(0x11);
const OTHER_KEY = new Uint8Array(32).fill(0x22);
const addressOf = (secret: Uint8Array) => addressOfPublicKey(secp256k1.getPublicKey(secret, false));
const MODEL_ADDRESS = addressOf(MODEL_KEY);
const OTHER_ADDRESS = addressOf(OTHER_KEY);

/** An EIP-191 personal_sign signature, r‖s‖v in hex, as /v1/signature returns it. */
function personalSign(text: string, secret: Uint8Array): string {
  const rec = secp256k1.sign(eip191Hash(text), secret, { prehash: false, format: "recovered" });
  return `0x${Buffer.from(rec.subarray(1)).toString("hex")}${(27 + rec[0]!).toString(16)}`;
}

const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** A TDX v4 quote just long enough to hold report data: the address padded to 32 bytes, then the nonce. */
function quoteFor(address: string, nonceHex: string): string {
  const q = Buffer.alloc(TDX_REPORT_DATA_OFFSET + 64 + 16);
  q.writeUInt16LE(4, 0);
  Buffer.from(`${address.slice(2)}${"0".repeat(24)}${nonceHex}`, "hex").copy(q, TDX_REPORT_DATA_OFFSET);
  return q.toString("hex");
}

/** An attestation report as cloud-api.near.ai answers it, built for the nonce in the request's URL. */
function attestationResponse(url: string, opts: { address?: string; nonce?: string; model?: string } = {}): Response {
  const nonce = opts.nonce ?? new URL(url).searchParams.get("nonce")!;
  const address = opts.address ?? MODEL_ADDRESS;
  const report = { model_name: opts.model ?? MODEL, signing_address: address, signing_algo: "ecdsa", request_nonce: nonce, intel_quote: quoteFor(address, nonce), nvidia_payload: "{}", event_log: "[]" };
  return Response.json({ gateway_attestation: { ...report, model_name: undefined, signing_address: OTHER_ADDRESS, intel_quote: quoteFor(OTHER_ADDRESS, nonce) }, model_attestations: [report] });
}

const completionBody = (content: string, id = "chatcmpl-nearai-1") =>
  JSON.stringify({ id, object: "chat.completion", model: MODEL, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, reasoning_content: "SECRET-REASONING never surfaces" } }] });

/**
 * A fake NEAR AI Cloud: the completion endpoint (recording each request's exact body) and
 * the attestation and signature reads. `sign` decides what /v1/signature answers.
 */
function fakeNearAi(content: string, opts: { sign?: (req: string, res: string) => Response; attest?: (url: string) => Response | Promise<Response>; complete?: (signal: AbortSignal) => Promise<Response> } = {}) {
  const exchanges: { request: string; response: string }[] = [];
  const reads: string[] = [];
  const headers: Record<string, string>[] = [];
  const complete: BrainFetch = async (_url, init) => {
    headers.push(init.headers);
    if (opts.complete) return opts.complete(init.signal);
    const response = completionBody(content);
    exchanges.push({ request: init.body, response });
    return new Response(response, { status: 200, headers: { "content-type": "application/json" } });
  };
  const read: NearAiFetch = async (url, init) => {
    reads.push(url);
    headers.push(init.headers);
    if (url.includes("/attestation/report")) return opts.attest ? opts.attest(url) : attestationResponse(url);
    const last = exchanges.at(-1);
    if (!last) return new Response("{}", { status: 404 });
    const sign = opts.sign ?? ((req, res) => {
      const text = `${MODEL}:${sha(req)}:${sha(res)}`;
      return Response.json({ text, signature: personalSign(text, MODEL_KEY), signing_address: MODEL_ADDRESS, signing_algo: "ecdsa", signature_kind: "provider_tee" });
    });
    return sign(last.request, last.response);
  };
  return { complete, read, exchanges, reads, headers };
}

const options: NpcAction[] = [
  { kind: "sell", rule: 3, item: "crumbs", amount: 2, minBits: 21, expectBits: 22, text: "Sold 2 × Crumbs to Gwei for 22 Bits", reason: "Cost me 13." },
  { kind: "sell", rule: 3, item: "sybil_goo", amount: 1, minBits: 40, expectBits: 42, text: "Sold 1 × Sybil goo to Gwei for 42 Bits", reason: "Cost me 36." },
];
const input = { options, bits: 228, budgetLeft: 79, actionsLeft: 10, shopOpen: true, holding: [], listed: [], nowMs: NOW.getTime() };
const pick = (id: number | "pass") => JSON.stringify({ pick: id, reason: "Crust first, questions later." });
const fast = { verifyTimeoutMs: 200, verifyRetryDelayMs: 1 };

beforeEach(() => {
  clearAttestationCache();
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("NEARAI_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("which provider", () => {
  it("is NEAR AI Cloud when NEARAI_API_KEY is set, else Kimi with LLM_API_KEY, else the rules", () => {
    expect(npcBrainConfig({ NEARAI_API_KEY: NEAR_KEY, LLM_API_KEY: "sk-moonshot" })).toEqual(NEAR);
    expect(npcBrainConfig({ NEARAI_API_KEY: NEAR_KEY, NEARAI_MODEL: "z-ai/glm-5.3-flash", NEARAI_BASE_URL: "https://cloud-api.near.ai/v1/" })).toEqual({ ...NEAR, model: "z-ai/glm-5.3-flash" });
    expect(npcBrainConfig({ LLM_API_KEY: "sk-moonshot" })).toMatchObject({ provider: "moonshot", model: "kimi-k3", url: "https://api.moonshot.ai/v1/chat/completions" });
    // A NEAR AI base URL that isn't https is skipped, and Kimi answers instead.
    expect(npcBrainConfig({ NEARAI_API_KEY: NEAR_KEY, NEARAI_BASE_URL: "http://cloud-api.near.ai/v1", LLM_API_KEY: "sk-moonshot" })).toMatchObject({ provider: "moonshot" });
    expect(npcBrainConfig({ NEARAI_API_KEY: "  " })).toBeNull();
    expect(npcBrainConfig({})).toBeNull();
    expect(npcBrainMode(true, { NEARAI_API_KEY: NEAR_KEY, LLM_API_KEY: "sk-moonshot" })).toEqual({ mode: "llm", model: MODEL, provider: "near-ai" });
    expect(npcBrainMode(false, { NEARAI_API_KEY: NEAR_KEY })).toEqual({ mode: "rules", model: null, provider: null });
  });

  it("falls back to the rules without a key, on an HTTP error or on a timeout, with nothing to verify", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await chooseMove(input, { config: null, callsLeft: 10 })).toMatchObject({ by: "rules", fallback: "no_key", called: false, verification: null, action: options[0] });
    const down = fakeNearAi(pick(2), { complete: async () => new Response("{}", { status: 503 }) });
    expect(await chooseMove(input, { config: NEAR, callsLeft: 10, fetch: down.complete, verifyFetch: down.read, ...fast })).toMatchObject({ by: "rules", fallback: "error", provider: "near-ai", verification: null, action: options[0] });
    // Like fetch, the hung request rejects once its signal aborts.
    const hang = fakeNearAi(pick(2), { complete: (signal) => new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
    const started = Date.now();
    expect(await chooseMove(input, { config: NEAR, callsLeft: 10, fetch: hang.complete, verifyFetch: hang.read, timeoutMs: 50, ...fast })).toMatchObject({ by: "rules", fallback: "timeout", called: true, action: options[0] });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("a NEAR AI answer's signature", () => {
  it("is verified when it covers this exact request and response and its signer is the attested one", async () => {
    const ai = fakeNearAi(pick(2));
    const choice = await chooseMove(input, { config: NEAR, callsLeft: 10, fetch: ai.complete, verifyFetch: ai.read, ...fast });
    expect(choice).toMatchObject({ by: MODEL, provider: "near-ai", fallback: null, action: { ...options[1], reason: "Crust first, questions later." } });
    expect(choice.verification).toEqual({ provider: "near-ai", model: MODEL, chatId: "chatcmpl-nearai-1", signingAddress: MODEL_ADDRESS, signatureKind: "provider_tee", verified: true, reason: null });
    // The attestation came first, with a fresh 32-byte nonce, no alias rewriting and no key.
    const attest = new URL(ai.reads[0]!);
    expect(attest.pathname).toBe("/v1/attestation/report");
    expect(Object.fromEntries(attest.searchParams)).toMatchObject({ model: MODEL, provider: "near", include_tls_fingerprint: "false", signing_algo: "ecdsa" });
    expect(attest.searchParams.get("nonce")).toMatch(/^[0-9a-f]{64}$/);
    expect(ai.headers[0]).toEqual({ accept: "application/json", "x-no-aliasing": "true" });
    // The completion asked for the canonical model with no alias rewriting; the signature read names the chat id.
    expect(ai.headers[1]).toMatchObject({ "x-no-aliasing": "true", authorization: `Bearer ${NEAR_KEY}` });
    expect(JSON.parse(ai.exchanges[0]!.request)).toMatchObject({ model: MODEL, chat_template_kwargs: { enable_thinking: false } });
    expect(ai.reads[1]).toBe(`${BASE}/signature/chatcmpl-nearai-1?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`);
  });

  it("binds the request and the response: a different body on either side is unverified", () => {
    const req = new TextEncoder().encode('{"model":"m"}');
    const res = new TextEncoder().encode('{"id":"x"}');
    const attestation: NearAiAttestation = { model: MODEL, fetchedAt: 0, modelSigners: [{ address: MODEL_ADDRESS, algo: "ecdsa" }], gatewaySigner: null, problem: null };
    const signed = (text: string, kind = "provider_tee", secret = MODEL_KEY, claimed = MODEL_ADDRESS) => ({ text, signature: personalSign(text, secret), signing_address: claimed, signing_algo: "ecdsa", signature_kind: kind });
    const good = `${MODEL}:${sha(req)}:${sha(res)}`;
    expect(checkSignature({ signature: signed(good), requestBytes: req, responseBytes: res, model: MODEL, attestation })).toMatchObject({ verified: true, signer: MODEL_ADDRESS });
    const other = new TextEncoder().encode('{"id":"y"}');
    expect(checkSignature({ signature: signed(good), requestBytes: req, responseBytes: other, model: MODEL, attestation })).toMatchObject({ verified: false, reason: "signed text doesn't match this request and response" });
    expect(checkSignature({ signature: signed(good), requestBytes: other, responseBytes: res, model: MODEL, attestation })).toMatchObject({ verified: false });
    // The model id is part of a provider_tee text.
    expect(checkSignature({ signature: signed(`other/model:${sha(req)}:${sha(res)}`), requestBytes: req, responseBytes: res, model: MODEL, attestation })).toMatchObject({ verified: false });
    // A signature whose claimed address isn't the one that signed.
    expect(checkSignature({ signature: signed(good, "provider_tee", OTHER_KEY, MODEL_ADDRESS), requestBytes: req, responseBytes: res, model: MODEL, attestation })).toMatchObject({ verified: false, reason: "signature not made by its signing address" });
    // A gateway signature covers the hashes alone and must be the attested gateway's.
    const gw = { ...attestation, gatewaySigner: { address: OTHER_ADDRESS, algo: "ecdsa" as const } };
    expect(checkSignature({ signature: signed(`${sha(req)}:${sha(res)}`, "gateway", OTHER_KEY, OTHER_ADDRESS), requestBytes: req, responseBytes: res, model: MODEL, attestation: gw })).toMatchObject({ verified: true, kind: "gateway" });
    expect(checkSignature({ signature: { ...signed(good), signature_kind: null }, requestBytes: req, responseBytes: res, model: MODEL, attestation })).toMatchObject({ verified: false, reason: "signature kind missing" });
  });

  it("is unverified when its signer isn't the attested address, and the pick still stands", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ai = fakeNearAi(pick(2), {
      sign: (req, res) => {
        const text = `${MODEL}:${sha(req)}:${sha(res)}`;
        return Response.json({ text, signature: personalSign(text, OTHER_KEY), signing_address: OTHER_ADDRESS, signing_algo: "ecdsa", signature_kind: "provider_tee" });
      },
    });
    const choice = await chooseMove(input, { config: NEAR, callsLeft: 10, fetch: ai.complete, verifyFetch: ai.read, ...fast });
    expect(choice.action).toMatchObject({ item: "sybil_goo" });
    expect(choice.verification).toMatchObject({ verified: false, signingAddress: OTHER_ADDRESS, reason: "signer not in the model's attestation" });
    // Nothing secret in the logs: no key, no prompt, no answer, no reasoning.
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toContain("unverified");
    for (const secret of [NEAR_KEY, "SECRET-REASONING", "Crust first", "Wallet:"]) expect(logged).not.toContain(secret);
    expect(JSON.stringify(choice)).not.toContain("SECRET-REASONING");
  });

  it("is unverified, never blocking, when the signature or the attestation can't be read in time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noSig = fakeNearAi(pick("pass"), { sign: () => new Response(JSON.stringify({ error: { message: "nope", type: "not_found" } }), { status: 404 }) });
    const passed = await chooseMove(input, { config: NEAR, callsLeft: 10, fetch: noSig.complete, verifyFetch: noSig.read, ...fast });
    expect(passed).toMatchObject({ action: null, by: MODEL, verification: { verified: false, reason: "signature not found" } });
    // Retried briefly: one attestation read, then three signature reads.
    expect(noSig.reads.filter((u) => u.includes("/signature/"))).toHaveLength(1 + NEARAI.signatureRetries);

    clearAttestationCache();
    const slow = fakeNearAi(pick(1), { attest: () => new Promise<Response>(() => {}) });
    const choice = await chooseMove(input, { config: NEAR, callsLeft: 10, fetch: slow.complete, verifyFetch: slow.read, verifyTimeoutMs: 30, verifyRetryDelayMs: 1 });
    expect(choice).toMatchObject({ action: { item: "crumbs" }, verification: { verified: false, reason: "attestation timeout" } });
  });
});

describe("the attestation report", () => {
  it("is kept only when it echoes our nonce and its quote's report data binds the signer and the nonce", () => {
    const nonce = "ab".repeat(32);
    const report = { signing_address: MODEL_ADDRESS, signing_algo: "ecdsa", request_nonce: nonce, intel_quote: quoteFor(MODEL_ADDRESS, nonce) };
    expect(checkReport(report, nonce)).toEqual({ signer: { address: MODEL_ADDRESS, algo: "ecdsa" } });
    expect(checkReport({ ...report, request_nonce: "cd".repeat(32) }, nonce)).toEqual({ problem: "report nonce mismatch" });
    expect(checkReport({ ...report, intel_quote: quoteFor(OTHER_ADDRESS, nonce) }, nonce)).toEqual({ problem: "quote report data doesn't bind the signer and nonce" });
    expect(checkReport({ ...report, intel_quote: quoteFor(MODEL_ADDRESS, "cd".repeat(32)) }, nonce)).toEqual({ problem: "quote report data doesn't bind the signer and nonce" });
    expect(checkReport({ ...report, signing_algo: "ed25519" }, nonce)).toEqual({ problem: "report not ecdsa" });
    expect(checkReport({ ...report, intel_quote: "00" }, nonce)).toEqual({ problem: "report has no quote" });
  });

  it("is fetched once per model and reused until its time is up", async () => {
    const reads: string[] = [];
    const read: NearAiFetch = async (url) => {
      reads.push(url);
      return attestationResponse(url);
    };
    const t = NOW.getTime();
    expect((await attestationFor(BASE, MODEL, { fetch: read, now: t })).modelSigners).toEqual([{ address: MODEL_ADDRESS, algo: "ecdsa" }]);
    await attestationFor(BASE, MODEL, { fetch: read, now: t + NEARAI.attestationTtlMs - 1 });
    expect(reads).toHaveLength(1);
    await attestationFor(BASE, MODEL, { fetch: read, now: t + NEARAI.attestationTtlMs });
    expect(reads).toHaveLength(2);
    // A report for another model is dropped.
    clearAttestationCache();
    const wrong: NearAiFetch = async (url) => attestationResponse(url, { model: "someone/else" });
    expect(await attestationFor(BASE, MODEL, { fetch: wrong, now: t })).toMatchObject({ modelSigners: [], problem: "report for another model" });
  });
});

describe("EIP-191 recovery", () => {
  it("matches the Ethereum test vectors", () => {
    // ethers' hashMessage("Hello World").
    expect(Buffer.from(eip191Hash("Hello World")).toString("hex")).toBe("a1de988600a42c4b4ab089b619297c17d53cffae5d5120d82d8a92d0bb3b78f2");
    // The EIP-155 example key 0x4646…46 is address 0x9d8A62f656a8d1615C1294fd71e9CFb3E4855A4F.
    expect(addressOf(new Uint8Array(32).fill(0x46))).toBe("0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f");
    expect(recoverSigner("hi", personalSign("hi", MODEL_KEY))).toBe(MODEL_ADDRESS);
    expect(recoverSigner("hi!", personalSign("hi", MODEL_KEY))).not.toBe(MODEL_ADDRESS);
    expect(recoverSigner("hi", "0x1234")).toBeNull();
  });
});

describe("on chain, through the runner", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  function fakeChain() {
    const market: ChainMarket = { contractId: "game.wgpnear.near", network: "mainnet", vendor: "game.wgpnear.near", params: DEFAULT_PARAMS, pools: seededPools(), listings: 0 };
    const wallet: ChainWallet = { bits: 300, items: {}, tradesLeft: 40, listingsLeft: 10, fillsLeft: 10, fillBitsLeft: 3_000, open: [] };
    let open: Listing[] = [7, 8].map((id) => ({ id, seller: "azalleaxyz.wgpnear.near", item: "crumbs", amount: 2, price: 13, listedAtMs: NOW.getTime() - 1_000 }));
    const sent: NpcAction[] = [];
    const chain: NpcChain = {
      market: async () => market,
      listings: async () => open,
      wallet: async () => wallet,
      send: async (_env, action) => {
        sent.push(action);
        if (action.kind !== "fill") return { ok: false, error: "fake chain fills only", txHash: null };
        open = open.filter((l) => l.id !== action.listingId);
        wallet.bits -= action.price;
        const items: Record<string, number> = { ...wallet.items };
        items[action.item] = (items[action.item] ?? 0) + action.amount;
        wallet.items = items;
        return { ok: true, outcome: { bits: action.price, fee: 1 }, txHash: `Tx${action.listingId}` };
      },
    };
    return { chain, sent };
  }

  it("records the verification on his ledger line and his last decision", async () => {
    const { chain, sent } = fakeChain();
    const ai = fakeNearAi(pick(1));
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain, brain: NEAR, brainFetch: ai.complete, verifyFetch: ai.read, ...fast });
    expect(sent).toHaveLength(1);
    expect(report).toMatchObject({ ran: true, brain: MODEL });
    const state = await readNpcState(db, true, NPC.accountId);
    expect(state.log.at(-1)).toMatchObject({ brain: MODEL, verification: { provider: "near-ai", chatId: "chatcmpl-nearai-1", signingAddress: MODEL_ADDRESS, verified: true } });
    expect(state.lastDecision).toMatchObject({ provider: "near-ai", verification: { verified: true } });
    expect(state.brainCalls).toBe(1);
  });

  it("gives a visit a turn only when his last one started 15 minutes ago or more, and two visits at once act once", async () => {
    const { chain, sent } = fakeChain();
    const visit = (at: Date) => runNpcTrader(db, { now: at, onChain: true, env: NPC, chain, brain: null, minGapMs: NPC_VISIT_GAP_MS });
    expect(await visit(NOW)).toMatchObject({ ran: true });
    expect(await visit(new Date(NOW.getTime() + NPC_VISIT_GAP_MS - 1_000))).toMatchObject({ ran: false, why: "too_soon" });
    const later = new Date(NOW.getTime() + NPC_VISIT_GAP_MS);
    const both = await Promise.all([visit(later), visit(later)]);
    expect(both.filter((r) => r.ran)).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });
});
