"use client";

/**
 * Spike S1 bench. The owner opens /lab/near-auth on testnet and runs each step in order:
 * Google sign-in through NEAR Auth, what it resolves to, whether the server can verify
 * it, and whether NEAR Auth can sign a DelegateAction carrying AddKey(FunctionCall).
 * The results JSON at the bottom goes into docs/spikes/near-auth.md. It holds no email
 * and only a hash of the Google subject.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  actions,
  base64Decode,
  base64Encode,
  buildDelegateAction,
  encodeDelegateAction,
  KeyPair,
  keyToImplicitAddress,
  PublicKey,
  type DelegateAction,
} from "near-api-js";

import { Chip, Panel } from "@/components/frame";
import { Badge, Button, CopyButton, Field } from "@/components/ui";
import { GAME_CONTRACT_ID, NEAR_AUTH, NETWORK, RPC_URLS } from "@/lib/near/config";
import { decodeSignableDelegate } from "@/lib/near/delegate-codec";
import { getNearAuth, type NearAuth } from "@/lib/near/near-auth";
import { DELEGATE_TTL_BLOCKS, SESSION_KEY_ALLOWANCE } from "@/lib/near/policy";
import { accessKeyNonce, accountExists, finalBlockHeight, makeProvider, viewFunction } from "@/lib/near/rpc";

import { pickPlan } from "./plan";

type Mode = "popup" | "redirect";
type StepId = "login" | "resolve" | "server" | "prepare" | "approve" | "relay";

interface LabState {
  /** When a step last wrote results (ISO, seconds). */
  updatedAt?: string;
  mode?: Mode;
  login?: { ok: boolean; ms?: number; mode?: Mode; provider?: string; subHash?: string; issuer?: string; error?: string };
  resolve?: {
    ok: boolean;
    ms?: number;
    fastAuthContractId?: string;
    publicKey?: string;
    implicitAccountId?: string;
    implicitExists?: boolean;
    accountsWithKey?: string[] | null;
    namedAccount?: { id: string; hasKey: boolean } | null;
    betaContractKey?: string | null;
    error?: string;
  };
  server?: { ok: boolean; ms?: number; status?: number; idTokenAvailable?: boolean; keyMatches?: boolean; code?: string; error?: string };
  delegate?: {
    ok: boolean;
    senderId?: string;
    receiverId?: string;
    nonce?: string;
    submittable?: boolean;
    approveMs?: number;
    mode?: Mode;
    payloadMatches?: boolean;
    jwt?: { aud?: unknown; scope?: unknown; expiresIn?: number; hasFatxn?: boolean };
    error?: string;
  };
  relay?: { ok: boolean; ms?: number; txHash?: string; signatureVerifies?: boolean; code?: string; error?: string };
  pending?: { step: "login" | "approve"; startedAt: number; expected?: string; publicKey?: string };
}

const STORAGE_KEY = "wgp-lab-near-auth";
const BETA_CONTRACT = "fast-auth-beta-001.testnet";

function load(): LabState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LabState) : null;
  } catch {
    return null;
  }
}

function save(state: LabState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode: results stay on screen only.
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="))) as Record<string, unknown>;
}

/** Accounts holding a public key, from FastNEAR's key index (best effort). */
async function accountsForKey(publicKey: string): Promise<string[] | null> {
  const host = NETWORK === "mainnet" ? "https://api.fastnear.com" : "https://test.api.fastnear.com";
  try {
    const res = await fetch(`${host}/v0/public_key/${publicKey}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { account_ids?: string[] };
    return body.account_ids ?? [];
  } catch {
    return null;
  }
}

export function NearAuthLab() {
  const [state, setState] = useState<LabState>({});
  const [mode, setMode] = useState<Mode>("popup");
  const [busy, setBusy] = useState<StepId | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [named, setNamed] = useState("");
  const [auth, setAuth] = useState<NearAuth | null>(null);
  const [prepared, setPrepared] = useState<{ delegate: DelegateAction; publicKey: string } | null>(null);
  const [rpc] = useState(() => makeProvider(RPC_URLS));

  const update = (patch: Partial<LabState> | ((s: LabState) => Partial<LabState>)) =>
    setState((s) => {
      const next = { ...s, ...(typeof patch === "function" ? patch(s) : patch), updatedAt: new Date().toISOString().slice(0, 19) + "Z" };
      save(next);
      return next;
    });

  async function finishLogin(auth: NearAuth, startedAt: number, how: Mode) {
    const claims = await auth.claims();
    update({
      login: {
        ok: true,
        ms: Math.round(performance.now() - startedAt),
        mode: how,
        provider: claims.sub.split("|")[0],
        subHash: (await sha256Hex(claims.sub)).slice(0, 16),
        issuer: claims.iss,
      },
      pending: undefined,
    });
  }

  async function finishApprove(auth: NearAuth, startedAt: number, expected: string, how: Mode) {
    const req = await auth.signatureRequest();
    const want = Array.from(base64Decode(expected));
    const payloadMatches = req.signPayload.length === want.length && req.signPayload.every((b, i) => b === want[i]);
    const claims = decodeJwtClaims(req.verifyPayload);
    update((s) => ({
      delegate: {
        ...s.delegate,
        ok: true,
        approveMs: Math.round(performance.now() - startedAt),
        mode: how,
        payloadMatches,
        jwt: {
          aud: claims.aud,
          scope: claims.scope,
          expiresIn: typeof claims.exp === "number" ? claims.exp - Math.floor(Date.now() / 1000) : undefined,
          hasFatxn: Array.isArray(claims.fatxn),
        },
      },
      pending: undefined,
    }));
  }

  // Load the SDK, pick up saved results and finish a redirect if we're coming back from one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = load();
      try {
        const client = await getNearAuth();
        if (cancelled) return;
        const returned = await client.handleRedirect();
        setAuth(client);
        if (saved) {
          setState(saved);
          if (saved.mode) setMode(saved.mode);
        }
        // performance.now() restarts on reload; redirect timings use wall clock.
        const elapsed = saved?.pending ? performance.now() - (Date.now() - saved.pending.startedAt) : 0;
        if (returned && saved?.pending?.step === "login") await finishLogin(client, elapsed, "redirect");
        if (returned && saved?.pending?.step === "approve" && saved.pending.expected) {
          await finishApprove(client, elapsed, saved.pending.expected, "redirect");
        }
      } catch (e) {
        if (!cancelled) setSetupError(message(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount; the finish helpers only read what they are given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(step: StepId, fn: (auth: NearAuth) => Promise<void>, onError: (error: string) => void) {
    if (!auth) return;
    setBusy(step);
    try {
      await fn(auth);
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const login = () =>
    run(
      "login",
      async (auth) => {
        const startedAt = performance.now();
        if (mode === "redirect") {
          update({ mode, pending: { step: "login", startedAt: Date.now() } });
          await auth.login({ redirectUri: window.location.href.split("?")[0] });
          return;
        }
        await auth.login();
        await finishLogin(auth, startedAt, "popup");
      },
      (error) => update({ login: { ok: false, mode, error } }),
    );

  const resolve = () =>
    run(
      "resolve",
      async (auth) => {
        const startedAt = performance.now();
        const [publicKey, path] = await Promise.all([auth.publicKey(), auth.path()]);
        const implicitAccountId = keyToImplicitAddress(publicKey);
        const namedId = named.trim();
        const [implicitExists, accountsWithKey, betaContractKey, namedKey] = await Promise.all([
          accountExists(rpc, implicitAccountId),
          accountsForKey(publicKey),
          NETWORK === "testnet"
            ? viewFunction<string>(rpc, NEAR_AUTH.mpcContractId, "derived_public_key", { path, predecessor: BETA_CONTRACT, domain_id: 1 }).catch(() => null)
            : Promise.resolve(null),
          namedId ? accessKeyNonce(rpc, namedId, publicKey).catch(() => null) : Promise.resolve(null),
        ]);
        update({
          resolve: {
            ok: true,
            ms: Math.round(performance.now() - startedAt),
            fastAuthContractId: NEAR_AUTH.fastAuthContractId,
            publicKey,
            implicitAccountId,
            implicitExists,
            accountsWithKey,
            namedAccount: namedId ? { id: namedId, hasKey: namedKey !== null } : null,
            betaContractKey,
          },
        });
      },
      (error) => update({ resolve: { ok: false, error } }),
    );

  const checkServer = () =>
    run(
      "server",
      async (auth) => {
        const startedAt = performance.now();
        const idToken = await auth.idToken().catch(() => null);
        if (!idToken) {
          update({ server: { ok: false, idTokenAvailable: false, error: "The SDK exposed no ID token" } });
          return;
        }
        const res = await fetch("/api/auth/near-auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "verify", idToken }),
        });
        const body = (await res.json().catch(() => ({}))) as { userPublicKey?: string; error?: string; message?: string };
        const clientKey = state.resolve?.publicKey ?? (await auth.publicKey());
        update({
          server: {
            ok: res.ok,
            ms: Math.round(performance.now() - startedAt),
            status: res.status,
            idTokenAvailable: true,
            keyMatches: res.ok ? body.userPublicKey === clientKey : undefined,
            code: body.error,
            error: res.ok ? undefined : body.message,
          },
        });
      },
      (error) => update({ server: { ok: false, error } }),
    );

  const prepare = () =>
    run(
      "prepare",
      async (auth) => {
        const publicKey = state.resolve?.publicKey ?? (await auth.publicKey());
        const senderId = named.trim() || keyToImplicitAddress(publicKey);
        const sessionKey = KeyPair.fromRandom("ed25519").getPublicKey();
        const [chainNonce, height] = await Promise.all([accessKeyNonce(rpc, senderId, publicKey), finalBlockHeight(rpc)]);
        const nonce = (chainNonce ?? 0n) + 1n;
        const delegate = buildDelegateAction({
          senderId,
          receiverId: senderId,
          actions: [actions.addFunctionCallAccessKey(sessionKey, GAME_CONTRACT_ID, [], SESSION_KEY_ALLOWANCE)],
          nonce,
          maxBlockHeight: height + DELEGATE_TTL_BLOCKS,
          publicKey: PublicKey.fromString(publicKey),
        });
        setPrepared({ delegate, publicKey });
        update({ delegate: { ok: false, senderId, receiverId: senderId, nonce: nonce.toString(), submittable: chainNonce !== null }, relay: undefined });
      },
      (error) => update({ delegate: { ok: false, error } }),
    );

  // Called straight from the click, so the browser lets the popup open.
  const approve = () =>
    run(
      "approve",
      async (auth) => {
        const p = prepared;
        if (!p) throw new Error("Prepare the delegate first");
        const expected = base64Encode(encodeDelegateAction(p.delegate));
        const startedAt = performance.now();
        if (mode === "redirect") {
          update({ mode, pending: { step: "approve", startedAt: Date.now(), expected, publicKey: p.publicKey } });
          await auth.requestDelegateSignature(p.delegate, { redirectUri: window.location.href.split("?")[0] });
          return;
        }
        await auth.requestDelegateSignature(p.delegate);
        await finishApprove(auth, startedAt, expected, "popup");
      },
      (error) => update((s) => ({ delegate: { ...s.delegate, ok: false, error } })),
    );

  const relay = () =>
    run(
      "relay",
      async (auth) => {
        const startedAt = performance.now();
        const req = await auth.signatureRequest();
        const publicKey = state.resolve?.publicKey ?? (await auth.publicKey());
        const { signature, txHash } = await auth.relaySign(req);
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(req.signPayload)));
        update({
          relay: {
            ok: true,
            ms: Math.round(performance.now() - startedAt),
            txHash,
            signatureVerifies: PublicKey.fromString(publicKey).verify(hash, signature),
          },
        });
      },
      (error) => update({ relay: { ok: false, error } }),
    );

  const reset = () => {
    setPrepared(null);
    update({ login: undefined, resolve: undefined, server: undefined, delegate: undefined, relay: undefined, pending: undefined });
  };

  const pick = pickPlan(state);
  const results = {
    spike: "S1",
    ranAt: state.updatedAt ?? null,
    network: NETWORK,
    config: {
      fastAuthContractId: NEAR_AUTH.fastAuthContractId,
      mpcContractId: NEAR_AUTH.mpcContractId,
      auth0Domain: NEAR_AUTH.domain,
      signingAudience: NEAR_AUTH.signingAudience,
      sharedDevClient: NEAR_AUTH.clientId === "np8paqIpMWmNbzT4xAvOOapZBjsOpptl",
      gameContract: GAME_CONTRACT_ID,
    },
    login: state.login ?? null,
    resolve: state.resolve ?? null,
    serverVerify: state.server ?? null,
    delegateAddKey: state.delegate ?? null,
    relaySign: state.relay ?? null,
    plan: pick,
  };
  const resultsJson = JSON.stringify(results, null, 2);
  const decodedPreview = prepared ? decodeSignableDelegate(encodeDelegateAction(prepared.delegate)) : null;

  return (
    <main className="min-h-dvh bg-page px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Chip size="sm" className="self-start">
            Spike S1 · {NETWORK}
          </Chip>
          <h1 className="text-balance text-[32px] font-medium leading-[38px] tracking-[-0.02em] sm:text-[40px] sm:leading-[46px]">
            <span className="text-ink-faint">NEAR Auth lab. </span>
            <span className="text-ink-strong">What does one Google login resolve to?</span>
          </h1>
          <p className="max-w-[64ch] text-pretty text-[15px] leading-6 text-ink-subtle">
            Run the steps in order. Each one records what NEAR Auth did and how long it took; the JSON at the end goes into
            docs/spikes/near-auth.md and picks Plan A, B or C. Nothing here creates or funds an account.
          </p>
        </header>

        <Panel className="p-5 sm:p-6">
          <h2 className="eyebrow">Configuration</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Row label="NEAR Auth contract" value={NEAR_AUTH.fastAuthContractId} />
            <Row label="MPC contract" value={NEAR_AUTH.mpcContractId} />
            <Row label="Auth0 domain" value={NEAR_AUTH.domain} />
            <Row label="Client id" value={NEAR_AUTH.clientId || "not set"} />
            <Row label="Signing audience" value={NEAR_AUTH.signingAudience} />
            <Row label="Game contract" value={GAME_CONTRACT_ID} />
          </dl>
          <fieldset className="mt-5 flex flex-col gap-2">
            <legend className="text-[13px] font-medium leading-4 text-ink-strong">Auth0 window</legend>
            <div className="mt-2 inline-flex w-fit rounded-control bg-surface-2 p-1">
              {(["popup", "redirect"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex h-8 cursor-pointer items-center rounded-[6px] px-3 text-[13px] font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--vs-focus)] pointer-coarse:h-11 ${mode === m ? "bg-canvas text-ink-strong shadow-[var(--shadow-chip)]" : "text-ink-subtle"}`}
                >
                  <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                  {m === "popup" ? "Popup" : "Redirect"}
                </label>
              ))}
            </div>
          </fieldset>
          {setupError ? (
            <p role="alert" className="mt-4 rounded-control bg-danger-fill px-3 py-2 text-[13px] leading-5 text-on-danger">
              The NEAR Auth SDK didn&apos;t load: {setupError}
            </p>
          ) : null}
        </Panel>

        <ol className="flex flex-col gap-4">
          <Step n={1} title="Sign in with Google through NEAR Auth" status={status(busy === "login", state.login?.ok)}>
            <p className="text-[14px] leading-5 text-ink-subtle">Opens Auth0 for the shared testnet client. Records the time to a signed-in session.</p>
            {state.login?.ok ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                <Row label="Provider" value={state.login.provider ?? "unknown"} />
                <Row label="Subject (sha256, 16 hex)" value={state.login.subHash ?? ""} />
                <Row label="Issuer" value={state.login.issuer ?? ""} />
                <Row label="Latency" value={ms(state.login.ms)} />
              </dl>
            ) : null}
            <ErrorText text={state.login?.error} />
            <Actions>
              <Button onClick={login} disabled={!auth || busy !== null}>
                Sign in with Google
              </Button>
              <Button variant="ghost" onClick={reset} disabled={busy !== null}>
                Clear results
              </Button>
            </Actions>
          </Step>

          <Step n={2} title="Resolve the contract and account" status={status(busy === "resolve", state.resolve?.ok)}>
            <p className="text-[14px] leading-5 text-ink-subtle">
              Derives the user&apos;s key from the MPC contract, then looks for accounts holding it. NEAR Auth itself only yields a key, so the
              natural account is the implicit one unless something created a named account with it.
            </p>
            <div className="max-w-[420px]">
              <Field
                id="named-account"
                label="Named account to check (optional)"
                hint="If you already made one with this login, its key is checked and the delegate below is sent from it."
                value={named}
                onChange={(e) => setNamed(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                type="text"
                placeholder="you.testnet"
              />
            </div>
            {state.resolve?.ok ? (
              <dl className="grid gap-2">
                <Row label="Contract (predecessor)" value={state.resolve.fastAuthContractId ?? ""} />
                <Row label="Public key" value={state.resolve.publicKey ?? ""} copy />
                <Row label="Implicit account" value={`${state.resolve.implicitAccountId} (${state.resolve.implicitExists ? "exists" : "not on chain"})`} copy={state.resolve.implicitAccountId} />
                <Row
                  label="Accounts holding the key"
                  value={state.resolve.accountsWithKey === null || state.resolve.accountsWithKey === undefined ? "index unavailable" : state.resolve.accountsWithKey.join(", ") || "none"}
                />
                {state.resolve.namedAccount ? (
                  <Row label={state.resolve.namedAccount.id} value={state.resolve.namedAccount.hasKey ? "has this key" : "does not have this key"} />
                ) : null}
                {state.resolve.betaContractKey ? <Row label={`Key under ${BETA_CONTRACT}`} value={state.resolve.betaContractKey} /> : null}
                <Row label="Latency" value={ms(state.resolve.ms)} />
              </dl>
            ) : null}
            <ErrorText text={state.resolve?.error} />
            <Actions>
              <Button onClick={resolve} disabled={!state.login?.ok || busy !== null}>
                Resolve account
              </Button>
            </Actions>
          </Step>

          <Step n={3} title="Check the server can verify the login" status={status(busy === "server", state.server?.ok && state.server.keyMatches)}>
            <p className="text-[14px] leading-5 text-ink-subtle">
              Sends the Auth0 ID token to POST /api/auth/near-auth in verify mode: RS256 against the tenant&apos;s keys, then the same key
              derivation on the server. Creates nothing.
            </p>
            {state.server ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                <Row label="ID token available" value={state.server.idTokenAvailable ? "yes" : "no"} />
                <Row label="HTTP status" value={state.server.status ? String(state.server.status) : "not sent"} />
                <Row label="Server key matches SDK key" value={state.server.keyMatches === undefined ? "n/a" : state.server.keyMatches ? "yes" : "no"} />
                <Row label="Latency" value={ms(state.server.ms)} />
              </dl>
            ) : null}
            <ErrorText text={state.server?.error && `${state.server.code ? `${state.server.code}: ` : ""}${state.server.error}`} />
            <Actions>
              <Button onClick={checkServer} disabled={!state.login?.ok || busy !== null}>
                Verify on the server
              </Button>
            </Actions>
          </Step>

          <Step n={4} title="Approve a DelegateAction with AddKey(FunctionCall)" status={status(busy === "prepare" || busy === "approve", state.delegate?.ok && state.delegate.payloadMatches)}>
            <p className="text-[14px] leading-5 text-ink-subtle">
              Builds the delegate Plan A and B rely on: add a throwaway session key limited to {GAME_CONTRACT_ID} with a 0.05 NEAR allowance, then
              asks NEAR Auth to approve it. Prepare first, so the approval opens straight from your click.
            </p>
            {decodedPreview || state.delegate?.senderId ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                <Row label="Sender and receiver" value={state.delegate?.senderId ?? decodedPreview?.senderId ?? ""} />
                <Row label="Nonce" value={`${state.delegate?.nonce ?? ""}${state.delegate?.submittable === false ? " (key not on chain: sign only)" : ""}`} />
                {state.delegate?.approveMs !== undefined ? <Row label="Approval latency" value={ms(state.delegate.approveMs)} /> : null}
                {state.delegate?.payloadMatches !== undefined ? (
                  <Row label="fatxn equals our encoding" value={state.delegate.payloadMatches ? "yes" : "no"} />
                ) : null}
                {state.delegate?.jwt ? <Row label="JWT audience" value={String(state.delegate.jwt.aud ?? "")} /> : null}
                {state.delegate?.jwt?.expiresIn !== undefined ? <Row label="JWT expires in" value={`${state.delegate.jwt.expiresIn} s`} /> : null}
              </dl>
            ) : null}
            <ErrorText text={state.delegate?.error} />
            <Actions>
              <Button variant="secondary" onClick={prepare} disabled={!state.login?.ok || busy !== null}>
                Prepare delegate
              </Button>
              <Button onClick={approve} disabled={!prepared || busy !== null}>
                Approve in NEAR Auth
              </Button>
            </Actions>
          </Step>

          <Step n={5} title="Relay sign and check the MPC signature" status={status(busy === "relay", state.relay?.ok && state.relay.signatureVerifies)}>
            <p className="text-[14px] leading-5 text-ink-subtle">
              Our relayer calls sign on {NEAR_AUTH.fastAuthContractId} with the approved JWT (POST /api/relay/fast-auth), then the signature is
              checked against the derived key. Needs RELAYER_* keys, and ALLOW_NEAR_AUTH_LAB=1 when you aren&apos;t signed in to the game.
            </p>
            {state.relay ? (
              <dl className="grid gap-2 sm:grid-cols-2">
                <Row label="Signature verifies" value={state.relay.signatureVerifies === undefined ? "n/a" : state.relay.signatureVerifies ? "yes" : "no"} />
                <Row label="Latency (sign + MPC)" value={ms(state.relay.ms)} />
                {state.relay.txHash ? <Row label="sign transaction" value={state.relay.txHash} copy /> : null}
              </dl>
            ) : null}
            <ErrorText text={state.relay?.error} />
            <Actions>
              <Button onClick={relay} disabled={!state.delegate?.ok || busy !== null}>
                Relay sign
              </Button>
            </Actions>
          </Step>
        </ol>

        <Panel className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[20px] font-medium leading-6 tracking-[-0.01em] text-ink-strong">
              {pick.plan ? `Plan ${pick.plan}` : "No plan yet"}
            </h2>
            {pick.plan ? <Badge tone={pick.provisional ? "warning" : "success"}>{pick.provisional ? "Provisional" : "Confirmed"}</Badge> : null}
          </div>
          <p role="status" className="max-w-[64ch] text-pretty text-[14px] leading-5 text-ink-subtle">
            {pick.why}
          </p>
        </Panel>

        <Panel className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="eyebrow">Results JSON for docs/spikes/near-auth.md</h2>
            <CopyButton value={resultsJson} label="results JSON" />
          </div>
          <pre className="hash max-h-[420px] overflow-auto rounded-control bg-surface p-4 text-[12px] leading-[18px] text-ink">{resultsJson}</pre>
        </Panel>
      </div>
    </main>
  );
}

type Status = "idle" | "running" | "passed" | "failed";

function status(running: boolean, ok: boolean | undefined): Status {
  if (running) return "running";
  if (ok === undefined) return "idle";
  return ok ? "passed" : "failed";
}

const ms = (value?: number) => (value === undefined ? "n/a" : `${value.toLocaleString("en-US")} ms`);

function Step({ n, title, status: s, children }: { n: number; title: string; status: Status; children: ReactNode }) {
  const badge = {
    idle: <Badge>Not run</Badge>,
    running: <Badge tone="warning">Running</Badge>,
    passed: <Badge tone="success">Passed</Badge>,
    failed: <Badge tone="danger">Failed</Badge>,
  }[s];
  return (
    <li>
      <Panel className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-3 text-[17px] font-medium leading-6 tracking-[-0.01em] text-ink-strong">
            <span aria-hidden className="num grid size-7 shrink-0 place-items-center rounded-chip bg-inverse text-[13px] text-on-inverse">
              {n}
            </span>
            {title}
          </h2>
          {badge}
        </div>
        {children}
      </Panel>
    </li>
  );
}

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean | string }) {
  const copyValue = typeof copy === "string" ? copy : value;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[12px] leading-4 text-ink-subtle">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className="hash num min-w-0 text-[13px] leading-5 text-ink-strong">{value}</span>
        {copy && copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </dd>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function ErrorText({ text }: { text?: string | false }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-control bg-danger-fill px-3 py-2 text-[13px] leading-5 text-on-danger">
      {text}
    </p>
  );
}
