/**
 * End-to-end on testnet (ARCHITECTURE.md, Verification): sign-up → hero → run → verify →
 * mint → craft → board, plus the relayer abuse suite. Runs the app's own server code
 * (factory, relay, operator) against the deployed contract.
 *
 *   cd apps/wgp
 *   pnpm exec tsx --env-file=.env.local ../../scripts/near/e2e-chain.ts            # asks before spending
 *   pnpm exec tsx --env-file=.env.local ../../scripts/near/e2e-chain.ts --yes --onchain-abuse
 *
 * Needs NEAR_NETWORK, WGP_CONTRACT_ID, FACTORY_*, RELAYER_*, OPERATOR_* (see .env.example).
 * Creates one throwaway account e2e-<time>.<FACTORY_ACCOUNT_ID>; its full-access key lives
 * only in memory for this run.
 *
 * Implemented: 1 sign-up (factory path, no Google), 2 register_hero via session key +
 * relayer, 3 abuse suite (validator; with --onchain-abuse also the protocol refusing a
 * session-key deposit), 5 mint + idempotent resend, 6 craft and 7 equip via relayer.
 * Outlined (Backend routes): 4 a bot-played run, submit and verify; 8 the board.
 */
import { createInterface } from "node:readline/promises";

import { decodeSignedDelegate } from "../../apps/wgp/src/lib/near/delegate-codec";
import { DELEGATE_TTL_BLOCKS, TGAS } from "../../apps/wgp/src/lib/near/policy";
import { accessKeyNonce, finalBlockHeight, viewFunction } from "../../apps/wgp/src/lib/near/rpc";
import { chainEnv, factoryEnv, operatorEnv, relayerEnv } from "../../apps/wgp/src/server/near/env";
import { createPlayerAccount } from "../../apps/wgp/src/server/near/factory";
import { rewardNonce, sendRewards } from "../../apps/wgp/src/server/near/operator";
import { relayerHasFunds, submitSignedDelegate, validateGameDelegate, type RelayContext } from "../../apps/wgp/src/server/near/relay";
import { provider } from "../../apps/wgp/src/server/near/rpc";
import { actions, buildDelegateAction, encodeSignedDelegate, KeyPair, KeyPairSigner, type Action } from "../../apps/wgp/src/server/near/sdk";

type Outcome = "pass" | "fail" | "skip";
const results: { step: string; outcome: Outcome; detail?: string }[] = [];

function record(step: string, outcome: Outcome, detail?: string) {
  results.push({ step, outcome, detail });
  const mark = { pass: "PASS", fail: "FAIL", skip: "SKIP" }[outcome];
  console.log(`${mark}  ${step}${detail ? `  (${detail})` : ""}`);
}

async function check(step: string, fn: () => Promise<string | void>) {
  try {
    record(step, "pass", (await fn()) ?? undefined);
  } catch (error) {
    record(step, "fail", (error as Error).message.slice(0, 300));
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const chain = chainEnv();
  const factory = factoryEnv();
  const relayer = relayerEnv();
  const operator = operatorEnv();
  const rpc = provider();
  const digest = (n: number) => n.toString(16).padStart(64, "0");

  // ---------- 0. Preflight
  await check("0 preflight: contract config, operator, relayer funds", async () => {
    const config = await viewFunction<{ operators: string[]; paused: boolean; suits: { id: string }[] }>(rpc, chain.contractId, "get_config");
    assert(!config.paused, "the contract is paused");
    assert(config.operators.includes(operator.accountId), `${operator.accountId} is not an operator`);
    assert(await relayerHasFunds(), `${relayer.accountId} is below RELAYER_MIN_BALANCE_NEAR`);
    return `${config.suits.length} suits, operator ok`;
  });

  const handle = `e2e-${Date.now().toString(36)}`;
  const accountId = `${handle}.${factory.accountId}`;
  if (!args.has("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This creates ${accountId} on ${chain.network} and spends relayer and operator gas. Type "go" to continue: `);
    rl.close();
    if (answer.trim() !== "go") return console.log("Aborted.");
  }

  const userKey = KeyPair.fromRandom("ed25519");
  const sessionKey = KeyPair.fromRandom("ed25519");
  const sessionPk = sessionKey.getPublicKey().toString();

  // The relay context the route would build from the database, for this one player.
  const ctx = async (): Promise<RelayContext> => ({
    contractId: chain.contractId,
    blockHeight: await finalBlockHeight(rpc),
    sender: { playerId: "e2e", accountId, banned: false },
    sessionKey: { playerId: "e2e", publicKey: sessionPk, revoked: false },
    sessionAccountId: accountId,
  });

  async function signed(acts: Action[], over: { receiverId?: string; senderId?: string; ttl?: bigint } = {}) {
    const nonce = ((await accessKeyNonce(rpc, accountId, sessionPk)) ?? 0n) + 1n;
    const height = await finalBlockHeight(rpc);
    const delegate = buildDelegateAction({
      senderId: over.senderId ?? accountId,
      receiverId: over.receiverId ?? chain.contractId,
      actions: acts,
      nonce,
      maxBlockHeight: height + (over.ttl ?? DELEGATE_TTL_BLOCKS),
      publicKey: sessionKey.getPublicKey(),
    });
    const { signedDelegate } = await new KeyPairSigner(sessionKey).signDelegateAction(delegate);
    return decodeSignedDelegate(encodeSignedDelegate(signedDelegate));
  }

  async function relayGame(method: string, a: Record<string, unknown>) {
    const s = await signed([actions.functionCall(method, a, 30n * TGAS, 0n)]);
    const verdict = validateGameDelegate(s, await ctx());
    assert(verdict.ok, `relayer refused: ${!verdict.ok && verdict.code}`);
    const r = await submitSignedDelegate(s);
    assert(r.ok, `call failed: ${r.error}`);
    return r;
  }

  // ---------- 1. Sign-up
  let created = false;
  await check("1 sign-up: one tx creates the account with the user key and a game-only session key", async () => {
    const r = await createPlayerAccount({ handle, userPublicKey: userKey.getPublicKey().toString(), sessionPublicKey: sessionPk });
    const keys = await rpc.viewAccessKeyList({ accountId, finalityQuery: { finality: "optimistic" } });
    const session = keys.keys.find((k) => k.public_key === sessionPk);
    assert(session && typeof session.access_key.permission === "object", "session key missing or not function-call");
    created = true;
    return `${accountId} in ${r.txHash}`;
  });
  if (!created) return summary();

  // ---------- 2. Hero
  await check("2 register_hero via session key + relayer (no popup, no gas for the player)", async () => {
    const r = await relayGame("register_hero", { name: "E2E Peter", suit: "classic" });
    const player = await viewFunction<{ hero: { suit: string } | null }>(rpc, chain.contractId, "get_player", { account_id: accountId });
    assert(player.hero?.suit === "classic", "no hero on chain");
    return `${r.txHash}, ${(Number(r.gasBurnt) / 1e12).toFixed(2)} Tgas`;
  });

  // ---------- 3. Abuse suite
  await check("3 relayer abuse suite: wrong receiver, deposit, two actions, unknown sender, expired, transfer", async () => {
    const call = actions.functionCall("craft_suit", { suit: "stealth" }, 10n * TGAS, 0n);
    const cases: [string, Awaited<ReturnType<typeof signed>>, Partial<RelayContext>][] = [
      ["wrong receiver", await signed([call], { receiverId: "intents.testnet" }), {}],
      ["deposit", await signed([actions.functionCall("craft_suit", { suit: "stealth" }, 10n * TGAS, 1n)]), {}],
      ["two actions", await signed([call, call]), {}],
      ["unknown sender", await signed([call]), { sender: null }],
      ["expired", await signed([call], { ttl: 0n }), {}],
      ["mt_transfer", await signed([actions.functionCall("mt_transfer", { receiver_id: factory.accountId, token_id: "suit:classic", amount: "1" }, 10n * TGAS, 1n)]), {}],
    ];
    const accepted: string[] = [];
    for (const [name, s, over] of cases) if (validateGameDelegate(s, { ...(await ctx()), ...over }).ok) accepted.push(name);
    assert(accepted.length === 0, `accepted: ${accepted.join(", ")}`);
    return `${cases.length} refused`;
  });

  if (args.has("--onchain-abuse")) {
    await check("3b protocol refuses a session-key delegate that attaches 1 yocto (mt_transfer)", async () => {
      const s = await signed([actions.functionCall("mt_transfer", { receiver_id: factory.accountId, token_id: "suit:classic", amount: "1" }, 10n * TGAS, 1n)]);
      const r = await submitSignedDelegate(s).catch((e: Error) => ({ ok: false, error: e.message, txHash: "" }));
      assert(!r.ok, "a session key moved an asset");
      const bal = await viewFunction<string>(rpc, chain.contractId, "mt_balance_of", { account_id: accountId, token_id: "suit:classic" });
      assert(bal === "1", "the suit left the account");
      return r.error?.slice(0, 120);
    });
  } else {
    record("3b protocol-level deposit refusal", "skip", "pass --onchain-abuse (spends relayer gas)");
  }

  // ---------- 4. Run → verify (Backend)
  // OUTLINE: POST /api/auth/dev or near-auth for a session as this account; POST /api/runs/start;
  // play the night with game-core's bot (sim3d/bot) recording the input log; POST
  // /api/runs/:id/submit; expect status "verified" and a chain_ops "mint_reward" row with a nonce.
  record("4 bot-played run, submit, server replay verifies", "skip", "outline: needs Backend run routes on a deployed app (E2E_BASE_URL)");

  // ---------- 5. Mint
  await check("5 operator mints the run's rewards; a resend is a no-op", async () => {
    const nonce = (await rewardNonce(accountId)) + 1;
    const reward = { key: "e2e-1", accountId, nonce, items: [{ item: "sybil-goo", amount: 3 }], level: 2, digest: digest(nonce) };
    const [first] = await sendRewards([reward]);
    assert(first?.status === "applied", `first send: ${first?.status} ${first?.error ?? ""}`);
    const [again] = await sendRewards([reward]);
    assert(again?.status === "duplicate", `resend: ${again?.status}`);
    const bal = await viewFunction<string>(rpc, chain.contractId, "mt_balance_of", { account_id: accountId, token_id: "item:sybil-goo" });
    assert(bal === "3", `balance ${bal}`);
    return `nonce ${nonce}, ${first.txHash}`;
  });

  // ---------- 6–7. Craft and equip
  await check("6 craft_suit(stealth) via session key + relayer burns 3 goo", async () => {
    const r = await relayGame("craft_suit", { suit: "stealth" });
    const [goo, suit] = await viewFunction<string[]>(rpc, chain.contractId, "mt_batch_balance_of", { account_id: accountId, token_ids: ["item:sybil-goo", "suit:stealth"] });
    assert(goo === "0" && suit === "1", `goo ${goo}, suit ${suit}`);
    return r.txHash;
  });
  await check("7 equip_suit(classic) via session key + relayer", async () => {
    await relayGame("equip_suit", { suit: "classic" });
    const player = await viewFunction<{ hero: { suit: string } }>(rpc, chain.contractId, "get_player", { account_id: accountId });
    assert(player.hero.suit === "classic", `wearing ${player.hero.suit}`);
  });

  // ---------- 8. Board (Backend)
  // OUTLINE: GET /api/leaderboard?board=tonight&around=me shows the verified score from step 4.
  record("8 verified score on the board", "skip", "outline: needs step 4");

  summary();

  function summary() {
    const failed = results.filter((r) => r.outcome === "fail").length;
    console.log(`\n${JSON.stringify({ network: chain.network, contract: chain.contractId, account: accountId, results }, null, 2)}`);
    process.exitCode = failed ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
