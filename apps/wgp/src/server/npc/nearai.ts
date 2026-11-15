/**
 * NEAR AI Cloud as Sandwich Man's brain, and the check of each answer's signature.
 *
 * NEAR AI Cloud (https://cloud-api.near.ai/v1) is OpenAI-compatible and runs its own
 * models in TEEs. What this file does, from its docs (docs.near.ai, "Response Signatures",
 * "NEAR Model Attestations", "Quote, Nonce, and Signer Bindings"):
 *
 * 1. Before a completion: GET /v1/attestation/report?model=<id>&provider=near&
 *    include_tls_fingerprint=false&signing_algo=ecdsa&nonce=<32 random bytes, hex>, with
 *    `x-no-aliasing: true` (public; no key sent). Each `model_attestations[]` candidate is
 *    kept only if it is for this model, echoes our nonce, and the report data inside its
 *    Intel TDX quote (64 bytes at offset 568 of a v4 quote) is the signing address padded
 *    to 32 bytes followed by our nonce. The gateway's report is kept the same way. The
 *    result is cached per model for ATTESTATION_TTL_MS, so it always predates the answer.
 * 2. The completion is sent with the canonical model id and `x-no-aliasing: true`; the exact
 *    request bytes and the exact response bytes are kept.
 * 3. After it: GET /v1/signature/<chat id>?model=<id>&signing_algo=ecdsa (with the key).
 *    `text` must equal "<model>:<sha256(request)>:<sha256(response)>" for a
 *    "provider_tee" signature, or "<sha256(request)>:<sha256(response)>" for "gateway";
 *    the EIP-191 signer recovered from `text` and `signature` must equal `signing_address`;
 *    and that address must match exactly one kept model candidate ("provider_tee") or the
 *    kept gateway report ("gateway").
 *
 * Not done here: verifying the TDX quote's Intel signature chain and TCB status (dcap-qvl),
 * replaying the RTMR3 event log, the MRCONFIGID check and NVIDIA GPU evidence. The signer
 * comparison therefore trusts the report's quote bytes as served over TLS by
 * cloud-api.near.ai; https://cloud.near.ai/verify runs those checks in a browser.
 *
 * A failed or unavailable check never blocks a turn; it is recorded as unverified with a
 * short reason. The API key is only ever a bearer token; nothing here logs a prompt, an
 * answer, `reasoning_content` or a key.
 */
import { createHash, randomBytes } from "node:crypto";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import type { BrainVerification } from "@/lib/market/npc-brain";

export const NEARAI = {
  defaultBaseUrl: "https://cloud-api.near.ai/v1",
  /**
   * A model NEAR AI runs in its own TEEs (providerType "vllm" in /v1/model/list), with JSON
   * mode. Its canonical id: an alias would make the gateway sign instead of the model.
   */
  defaultModel: "Qwen/Qwen3.6-35B-A3B-FP8",
  /** How long a checked attestation report is reused. A signer mismatch drops it at once. */
  attestationTtlMs: 30 * 60_000,
  /** Each of the attestation and signature requests gives up after this long. */
  requestTimeoutMs: 8_000,
  /** A signature may be recorded a moment after the answer: this many extra tries on a 404 or an "unavailable" answer. */
  signatureRetries: 2,
  signatureRetryDelayMs: 750,
} as const;

/** The fetch these calls use; tests pass a fake. */
export type NearAiFetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<Response>;

export interface NearAiSigner {
  /** Lowercase, 0x-prefixed. */
  address: string;
  algo: "ecdsa";
}

/** What a checked attestation report leaves: the signers to trust for one model. */
export interface NearAiAttestation {
  model: string;
  fetchedAt: number;
  /** Model candidates that passed the nonce and report-data checks. */
  modelSigners: NearAiSigner[];
  /** The gateway's signer, if its report passed the same checks. */
  gatewaySigner: NearAiSigner | null;
  /** Why candidates were dropped, if any were (for the record when nothing is left). */
  problem: string | null;
}

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const ADDRESS = /^0x[0-9a-f]{40}$/;

/** `value` as a lowercase 0x address, or null. */
export function normalAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const a = (value.startsWith("0x") || value.startsWith("0X") ? `0x${value.slice(2)}` : `0x${value}`).toLowerCase();
  return ADDRESS.test(a) ? a : null;
}

/** The Ethereum address of an uncompressed secp256k1 public key (65 bytes, 0x04…). */
export function addressOfPublicKey(uncompressed: Uint8Array): string {
  return `0x${hex(keccak_256(uncompressed.subarray(1)).subarray(12))}`;
}

/** keccak256("\x19Ethereum Signed Message:\n" + byte length + message): what EIP-191 personal_sign signs. */
export function eip191Hash(message: string): Uint8Array {
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const all = new Uint8Array(prefix.length + body.length);
  all.set(prefix);
  all.set(body, prefix.length);
  return keccak_256(all);
}

/** The address that signed `message` (EIP-191) with a 65-byte r‖s‖v signature in hex, or null if it can't be recovered. */
export function recoverSigner(message: string, signatureHex: string): string | null {
  const h = signatureHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{130}$/.test(h)) return null;
  const sig = Buffer.from(h, "hex");
  const v = sig[64]!;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) return null;
  try {
    // noble's "recovered" layout is the recovery byte first, then r and s.
    const recovered = new Uint8Array(65);
    recovered[0] = recovery;
    recovered.set(sig.subarray(0, 64), 1);
    const point = secp256k1.Signature.fromBytes(recovered, "recovered").recoverPublicKey(eip191Hash(message));
    return addressOfPublicKey(point.toBytes(false));
  } catch {
    return null;
  }
}

/** Offset of the 64-byte report data in an Intel TDX v4 quote: a 48-byte header, then 520 bytes of the TD report before it. */
export const TDX_REPORT_DATA_OFFSET = 568;

/** The report data of a TDX quote given in hex, or null when it is too short to hold one. */
export function quoteReportData(quoteHex: unknown): Uint8Array | null {
  if (typeof quoteHex !== "string" || !/^[0-9a-fA-F]*$/.test(quoteHex) || quoteHex.length % 2) return null;
  const q = Buffer.from(quoteHex, "hex");
  if (q.length < TDX_REPORT_DATA_OFFSET + 64) return null;
  return new Uint8Array(q.subarray(TDX_REPORT_DATA_OFFSET, TDX_REPORT_DATA_OFFSET + 64));
}

/**
 * Checks one report (a model candidate or the gateway's) against our nonce: the echoed
 * nonce, then the quote's report data, which for a NEAR-operated report without TLS
 * binding is the signing address padded to 32 bytes, then the nonce. Returns its signer or
 * the reason it was dropped.
 */
export function checkReport(report: unknown, nonceHex: string): { signer: NearAiSigner } | { problem: string } {
  const r = report as { signing_address?: unknown; signing_algo?: unknown; request_nonce?: unknown; intel_quote?: unknown } | null;
  if (!r || typeof r !== "object") return { problem: "report missing" };
  if (r.signing_algo !== "ecdsa") return { problem: "report not ecdsa" };
  const address = normalAddress(r.signing_address);
  if (!address) return { problem: "report has no signing address" };
  if (typeof r.request_nonce !== "string" || r.request_nonce.toLowerCase() !== nonceHex) return { problem: "report nonce mismatch" };
  const data = quoteReportData(r.intel_quote);
  if (!data) return { problem: "report has no quote" };
  const expected = `${address.slice(2)}${"0".repeat(24)}${nonceHex}`;
  if (hex(data) !== expected) return { problem: "quote report data doesn't bind the signer and nonce" };
  return { signer: { address, algo: "ecdsa" } };
}

/** The attestation report URL for `model` with a fresh nonce. */
export function attestationUrl(baseUrl: string, model: string, nonceHex: string): string {
  const q = new URLSearchParams({ model, provider: "near", include_tls_fingerprint: "false", signing_algo: "ecdsa", nonce: nonceHex });
  return `${baseUrl}/attestation/report?${q.toString()}`;
}

/** Runs `work` with a signal that aborts after `ms`, and gives up then even if `work` ignores the signal. */
async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("timed out"), { name: "AbortError" }));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches and checks `model`'s attestation report with a fresh nonce. Never throws; a failure is a report with no signers and a problem. */
export async function fetchAttestation(baseUrl: string, model: string, opts: { fetch: NearAiFetch; now?: number; timeoutMs?: number; nonce?: string }): Promise<NearAiAttestation> {
  const fetchedAt = opts.now ?? Date.now();
  const nonce = (opts.nonce ?? randomBytes(32).toString("hex")).toLowerCase();
  const empty = (problem: string): NearAiAttestation => ({ model, fetchedAt, modelSigners: [], gatewaySigner: null, problem });
  try {
    // The body is read inside the timeout too: a report is a few hundred kB.
    const got = await withTimeout(opts.timeoutMs ?? NEARAI.requestTimeoutMs, async (signal) => {
      const res = await opts.fetch(attestationUrl(baseUrl, model, nonce), { method: "GET", headers: { accept: "application/json", "x-no-aliasing": "true" }, signal });
      return res.ok ? { ok: true as const, body: (await res.json()) as { model_attestations?: unknown; gateway_attestation?: unknown } } : { ok: false as const, status: res.status };
    });
    if (!got.ok) return empty(`attestation HTTP ${got.status}`);
    const body = got.body;
    const candidates = Array.isArray(body.model_attestations) ? body.model_attestations : [];
    const problems: string[] = [];
    const modelSigners: NearAiSigner[] = [];
    for (const c of candidates) {
      const named = (c as { model_name?: unknown }).model_name;
      if (typeof named === "string" && named !== model) {
        problems.push("report for another model");
        continue;
      }
      const checked = checkReport(c, nonce);
      if ("signer" in checked) modelSigners.push(checked.signer);
      else problems.push(checked.problem);
    }
    if (candidates.length === 0) problems.push("no model attestation");
    const gateway = body.gateway_attestation ? checkReport(body.gateway_attestation, nonce) : null;
    return { model, fetchedAt, modelSigners, gatewaySigner: gateway && "signer" in gateway ? gateway.signer : null, problem: problems[0] ?? null };
  } catch (error) {
    return empty((error as Error)?.name === "AbortError" ? "attestation timeout" : "attestation unreachable");
  }
}

type AttestationCache = Map<string, NearAiAttestation>;
const cache: AttestationCache = ((globalThis as typeof globalThis & { __wgpNearAiAttestations?: AttestationCache }).__wgpNearAiAttestations ??= new Map());

/** The cached, checked report for `model` if it is fresh and has a signer, else a new one. */
export async function attestationFor(baseUrl: string, model: string, opts: { fetch: NearAiFetch; now?: number; timeoutMs?: number }): Promise<NearAiAttestation> {
  const now = opts.now ?? Date.now();
  const key = `${baseUrl} ${model}`;
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < NEARAI.attestationTtlMs && now >= hit.fetchedAt && (hit.modelSigners.length > 0 || hit.gatewaySigner)) return hit;
  const fresh = await fetchAttestation(baseUrl, model, opts);
  if (fresh.modelSigners.length > 0 || fresh.gatewaySigner) cache.set(key, fresh);
  else cache.delete(key);
  return fresh;
}

/** Drops the cached report for `model` (its signer didn't match an answer: the key may have rotated). */
export function forgetAttestation(baseUrl: string, model: string): void {
  cache.delete(`${baseUrl} ${model}`);
}

/** Test hook: empties the cache. */
export function clearAttestationCache(): void {
  cache.clear();
}

export interface NearAiSignature {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string | null;
}

/** Fetches the signature of completion `chatId`, retrying briefly while it isn't recorded yet. Never throws. */
export async function fetchSignature(
  baseUrl: string,
  chatId: string,
  model: string,
  apiKey: string,
  opts: { fetch: NearAiFetch; timeoutMs?: number; retries?: number; retryDelayMs?: number },
): Promise<{ ok: true; signature: NearAiSignature } | { ok: false; reason: string }> {
  const url = `${baseUrl}/signature/${encodeURIComponent(chatId)}?${new URLSearchParams({ model, signing_algo: "ecdsa" }).toString()}`;
  const retries = opts.retries ?? NEARAI.signatureRetries;
  let reason = "signature unavailable";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? NEARAI.signatureRetryDelayMs));
    try {
      const got = await withTimeout(opts.timeoutMs ?? NEARAI.requestTimeoutMs, async (signal) => {
        const res = await opts.fetch(url, { method: "GET", headers: { accept: "application/json", authorization: `Bearer ${apiKey}` }, signal });
        return res.ok ? { status: res.status, body: (await res.json()) as Partial<NearAiSignature> & { error_code?: unknown } } : { status: res.status, body: null };
      });
      if (got.status === 404) {
        reason = "signature not found";
        continue;
      }
      if (!got.body) return { ok: false, reason: `signature HTTP ${got.status}` };
      const body = got.body;
      if (body.error_code !== undefined || typeof body.text !== "string" || typeof body.signature !== "string") {
        reason = "signature unavailable";
        continue;
      }
      return { ok: true, signature: body as NearAiSignature };
    } catch (error) {
      return { ok: false, reason: (error as Error)?.name === "AbortError" ? "signature timeout" : "signature unreachable" };
    }
  }
  return { ok: false, reason };
}

/**
 * Checks a signature against the exact request and response bytes and the attestation's
 * signers, as the docs' "Response Signatures" table says. Pure.
 */
export function checkSignature(input: {
  signature: NearAiSignature;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array;
  model: string;
  attestation: NearAiAttestation;
}): { verified: true; signer: string; kind: string } | { verified: false; reason: string; signer: string | null; kind: string | null } {
  const { signature: s, attestation } = input;
  const kind = typeof s.signature_kind === "string" ? s.signature_kind : null;
  const claimed = normalAddress(s.signing_address);
  const fail = (reason: string) => ({ verified: false as const, reason, signer: claimed, kind });
  if (s.signing_algo !== "ecdsa") return fail("signature not ecdsa");
  if (!claimed) return fail("signature has no signing address");
  const hashes = `${sha256Hex(input.requestBytes)}:${sha256Hex(input.responseBytes)}`;
  if (kind === "provider_tee") {
    if (s.text !== `${input.model}:${hashes}`) return fail("signed text doesn't match this request and response");
  } else if (kind === "gateway") {
    if (s.text !== hashes) return fail("signed text doesn't match this request and response");
  } else {
    return fail(kind ? `unknown signature kind ${kind.slice(0, 20)}` : "signature kind missing");
  }
  const recovered = recoverSigner(s.text, s.signature);
  if (!recovered) return fail("signature doesn't recover");
  if (recovered !== claimed) return fail("signature not made by its signing address");
  if (kind === "provider_tee") {
    const matches = attestation.modelSigners.filter((m) => m.address === recovered);
    if (attestation.modelSigners.length === 0) return fail(attestation.problem ?? "no attested model signer");
    if (matches.length !== 1) return fail(matches.length === 0 ? "signer not in the model's attestation" : "signer matches more than one report");
  } else if (attestation.gatewaySigner?.address !== recovered) {
    return fail(attestation.gatewaySigner ? "signer isn't the attested gateway" : (attestation.problem ?? "no attested gateway signer"));
  }
  return { verified: true, signer: recovered, kind };
}

/**
 * The verification record for one NEAR AI Cloud answer: fetch its signature and check it.
 * Never throws. Drops the cached attestation when the signer isn't in it.
 */
export async function verifyNearAiAnswer(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  chatId: string | null;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array;
  attestation: NearAiAttestation | null;
  fetch: NearAiFetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}): Promise<BrainVerification> {
  const base = { provider: "near-ai" as const, model: input.model, chatId: input.chatId };
  const unverified = (reason: string, signingAddress: string | null = null, signatureKind: string | null = null): BrainVerification => ({ ...base, signingAddress, signatureKind, verified: false, reason });
  if (!input.chatId) return unverified("answer has no id");
  const got = await fetchSignature(input.baseUrl, input.chatId, input.model, input.apiKey, { fetch: input.fetch, timeoutMs: input.timeoutMs, retryDelayMs: input.retryDelayMs });
  if (!got.ok) return unverified(got.reason);
  const attestation = input.attestation ?? { model: input.model, fetchedAt: 0, modelSigners: [], gatewaySigner: null, problem: "attestation unavailable" };
  const checked = checkSignature({ signature: got.signature, requestBytes: input.requestBytes, responseBytes: input.responseBytes, model: input.model, attestation });
  if (checked.verified) return { ...base, signingAddress: checked.signer, signatureKind: checked.kind, verified: true, reason: null };
  if (/signer (not in|isn't)/.test(checked.reason)) forgetAttestation(input.baseUrl, input.model);
  return unverified(checked.reason, checked.signer, checked.kind);
}
