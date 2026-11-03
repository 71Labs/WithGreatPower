/**
 * End-to-end on testnet or mainnet (ARCHITECTURE.md, Verification): sign-up → hero → run
 * → verify → mint → craft → board, plus the relayer abuse suite. Runs the app's own
 * server code (factory, relay checks and mirror, the run verifier, the outbox and its
 * mint worker, the boards) against the deployed contract. NEAR_NETWORK picks the network.
 *
 *   cd apps/wgp
 *   pnpm exec tsx --env-file=.env.local ../../scripts/near/e2e-chain.ts            # asks before spending
 *   pnpm exec tsx --env-file=.env.local ../../scripts/near/e2e-chain.ts --yes --onchain-abuse
 *
 * Needs NEAR_NETWORK, WGP_CONTRACT_ID, FACTORY_*, RELAYER_*, OPERATOR_* (see .env.example).
 * Creates one throwaway account e2e-<time>.<FACTORY_ACCOUNT_ID>; its full-access key lives
 * only in memory for this run. Amounts are tiny: a zero-balance account (FACTORY_INITIAL_BALANCE,
 * default 0), relayer gas for five calls, operator gas for two mint batches.
 *
 * The database is a fresh in-memory PGlite with the app's migrations, never DATABASE_URL:
 * the throwaway player, its run and its mints exist only for this process.
 *
 * Steps: 1 sign-up (factory path, no Google); 2 register_hero via session key + relayer,
 * mirrored into the database; 3 abuse suite (validator; with --onchain-abuse also the
 * protocol refusing a session-key deposit); 4 a bot-played night, submitted and verified
 * by the server's replay; 5 the mint worker sends the run's reward and a crafting kit, and
 * a resend is a duplicate; 6 craft and 7 equip via relayer, mirrored into the save; 8 the
 * verified score on Tonight's and All-time boards.
 */
import { createInterface } from "node:readline/promises";

import { chooseErrand, needsErrand, runHash, runLog, startRun as startClientRun, stepRun } from "../../packages/game-core/src/replay";
import { botFrame, newBotMemory } from "../../packages/game-core/src/sim3d";
import { decodeSignedDelegate } from "../../apps/wgp/src/lib/near/delegate-codec";
import { DELEGATE_TTL_BLOCKS, TGAS } from "../../apps/wgp/src/lib/near/policy";
import { accessKeyNonce, finalBlockHeight, viewFunction } from "../../apps/wgp/src/lib/near/rpc";
import { applyAction } from "../../apps/wgp/src/server/db/actions";
import { createTestDb, setDb, type Db } from "../../apps/wgp/src/server/db/client";
import { ALLTIME_PERIOD, topEntries } from "../../apps/wgp/src/server/db/leaderboard";
import { enqueueRewardMint } from "../../apps/wgp/src/server/db/outbox";
import { ensureSave, findOrCreatePlayer } from "../../apps/wgp/src/server/db/players";
import { startRun, submitRun } from "../../apps/wgp/src/server/db/runs";
import type { Player } from "../../apps/wgp/src/server/db/schema";
import { utcDay } from "../../apps/wgp/src/server/rate-limit";
import { chainEnv, factoryEnv, operatorEnv, relayerEnv } from "../../apps/wgp/src/server/near/env";
import { createPlayerAccount } from "../../apps/wgp/src/server/near/factory";
import { heroOnChain, queueHeroRegistration } from "../../apps/wgp/src/server/near/heroes";
import { drainRewards } from "../../apps/wgp/src/server/near/mint-worker";
import { guardGameCall, mirrorGameCall, parseCallArgs, type Mirrored } from "../../apps/wgp/src/server/near/mirror";
import { rewardNonce, sendRewards } from "../../apps/wgp/src/server/near/operator";
import { relayerHasFunds, submitSignedDelegate, validateGameDelegate, type RelayContext } from "../../apps/wgp/src/server/near/relay";
import { provider } from "../../apps/wgp/src/server/near/rpc";
import { addSessionKey, relayLookup } from "../../apps/wgp/src/server/near/session-keys";
import { actions, buildDelegateAction, encodeSignedDelegate, KeyPair, KeyPairSigner, type Action } from "../../apps/wgp/src/server/near/sdk";

type Outcome = "pass" | "fail" | "skip";
const results: { step: string; outcome: Outcome; detail?: string }[] = [];

function record(step: string, outcome: Outcome, detail?: string) {
  results.push({ step, outcome, detail });
  const mark = { pass: "PASS", fail: "FAIL", skip: "SKIP" }[outcome];
  console.log(`${mark}  ${step}${detail ? `  (${detail})` : ""}`);
}

async function check(step: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    record(step, "pass", (await fn()) ?? undefined);
    return true;
  } catch (error) {
    record(step, "fail", (error as Error).message.slice(0, 300));
    return false;
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
  const tla = chain.network === "mainnet" ? "near" : "testnet";
  const digest = (n: number) => n.toString(16).padStart(64, "0");
  const balance = (tokenId: string) => viewFunction<string>(rpc, chain.contractId, "mt_balance_of", { account_id: accountId, token_id: tokenId }).then(Number);

  // ---------- 0. Preflight
  await check("0 preflight: contract config, operator, relayer funds", async () => {
    const config = await viewFunction<{ operators: string[]; paused: boolean; suits: { id: string }[] }>(rpc, chain.contractId, "get_config");
    assert(!config.paused, "the contract is paused");
    assert(config.operators.includes(operator.accountId), `${operator.accountId} is not an operator`);
    assert(await relayerHasFunds(), `${relayer.accountId} is below RELAYER_MIN_BALANCE_NEAR`);
    return `${chain.network}, ${config.suits.length} suits, operator ok`;
  });

  const handle = `e2e-${Date.now().toString(36)}`;
  const accountId = `${handle}.${factory.accountId}`;
  if (!args.has("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This creates ${accountId} on ${chain.network} and spends relayer and operator gas. Type "go" to continue: `);
    rl.close();
    if (answer.trim() !== "go") return console.log("Aborted.");
  }

  // The server's own database code, on a throwaway in-memory database.
  const db: Db = await createTestDb();
  setDb(db);

  const userKey = KeyPair.fromRandom("ed25519");
  const sessionKey = KeyPair.fromRandom("ed25519");
  const sessionPk = sessionKey.getPublicKey().toString();
  // Filled in by the steps (a holder, so TypeScript doesn't narrow them to their start values).
  const got: { player: Player | null; verified: { score: number; day: string } | null } = { player: null, verified: null };

  // The relay context the route builds, from the database.
  const ctx = async (): Promise<RelayContext> => ({
    contractId: chain.contractId,
    blockHeight: await finalBlockHeight(rpc),
    ...(await relayLookup(db, accountId, sessionPk)),
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

  /** What POST /api/relay/meta does for a game call: validate, guard, submit, mirror. */
  async function relayGame(method: string, a: Record<string, unknown>): Promise<{ txHash: string; gasBurnt: bigint; mirrored: Mirrored | null }> {
    const player = got.player;
    assert(player, "no player");
    const s = await signed([actions.functionCall(method, a, 30n * TGAS, 0n)]);
    const verdict = validateGameDelegate(s, await ctx());
    assert(verdict.ok, `relayer refused: ${!verdict.ok && verdict.code}`);
    await guardGameCall(db, player.id, verdict.methodName);
    const r = await submitSignedDelegate(s);
    const action = s.delegate.actions[0];
    const mirrored = await mirrorGameCall(db, {
      player,
      method,
      args: action?.kind === "FunctionCall" ? parseCallArgs(action.args) : null,
      ok: r.ok,
      txHash: r.txHash,
      error: r.error,
    });
    assert(r.ok, `call failed: ${r.error}`);
    return { txHash: r.txHash, gasBurnt: r.gasBurnt, mirrored };
  }

  // ---------- 1. Sign-up
  await check("1 sign-up: one tx creates the account with the user key and a game-only session key", async () => {
    const r = await createPlayerAccount({ handle, userPublicKey: userKey.getPublicKey().toString(), sessionPublicKey: sessionPk });
    const keys = await rpc.viewAccessKeyList({ accountId, finalityQuery: { finality: "optimistic" } });
    const session = keys.keys.find((k) => k.public_key === sessionPk);
    assert(session && typeof session.access_key.permission === "object", "session key missing or not function-call");
    // What POST /api/auth/near-auth records for a new player.
    const player = await findOrCreatePlayer(db, { nearAccountId: accountId, authKind: "near_auth", authSub: `e2e:${handle}`, handle });
    await addSessionKey(db, { playerId: player.id, publicKey: sessionPk, addTx: r.txHash });
    got.player = player;
    return `${accountId} in ${r.txHash}`;
  });
  const me = got.player;
  if (!me) return summary();

  // ---------- 2. Hero
  await check("2 register_hero via session key + relayer (no popup, no gas for the player), mirrored in the database", async () => {
    const created = await applyAction(db, { playerId: me.id, action: { type: "create-hero", name: "E2E Peter", suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] }, rev: 0 });
    assert(created.applied, "create-hero refused");
    const queued = await queueHeroRegistration(db, me, created.save);
    assert(queued.status === "queued" && queued.args, `hero op ${queued.status}`);
    const r = await relayGame("register_hero", { ...queued.args });
    const onChain = await viewFunction<{ hero: { suit: string } | null }>(rpc, chain.contractId, "get_player", { account_id: accountId });
    assert(onChain.hero?.suit === queued.args.suit, "no hero on chain");
    const mirror = await heroOnChain(db, me.id);
    assert(mirror.status === "registered" && mirror.txHash === r.txHash, `mirror says ${mirror.status}`);
    return `${r.txHash}, ${(Number(r.gasBurnt) / 1e12).toFixed(2)} Tgas`;
  });

  // ---------- 3. Abuse suite
  await check("3 relayer abuse suite: wrong receiver, deposit, two actions, unknown sender, expired, transfer", async () => {
    const call = actions.functionCall("craft_suit", { suit: "stealth" }, 10n * TGAS, 0n);
    const cases: [string, Awaited<ReturnType<typeof signed>>, Partial<RelayContext>][] = [
      ["wrong receiver", await signed([call], { receiverId: `intents.${tla}` }), {}],
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
      assert((await balance("suit:classic")) === 1, "the suit left the account");
      return r.error?.slice(0, 120);
    });
  } else {
    record("3b protocol-level deposit refusal", "skip", "pass --onchain-abuse (spends relayer gas)");
  }

  // ---------- 4. Run → verify (the server's replay, as in apps/wgp/scripts/prod-ranked-check.ts)
  await check("4 bot-played night, submitted, verified by the server's replay", async () => {
    const issuedAt = new Date();
    const started = await startRun(db, { playerId: me.id, now: issuedAt });
    const { save } = await ensureSave(db, me.id);
    const run = startClientRun(save, started.seed);
    assert(!run.error, `client run: ${run.error}`);
    const mem = newBotMemory();
    while (!run.over && !run.error && run.sim.tick < 54_000) {
      if (needsErrand(run)) chooseErrand(run, 0);
      else stepRun(run, botFrame(run.sim, mem));
    }
    // Submit as if the night's game time had passed on the wall clock.
    const submittedAt = new Date(issuedAt.getTime() + Math.ceil(run.sim.tick / 60) * 1000 + 5000);
    const result = await submitRun(db, { playerId: me.id, runId: started.runId, log: runLog(run), clientHash: runHash(run), now: submittedAt });
    assert(result.status === "verified", `run ${result.status}${result.status === "rejected" ? `: ${result.reason}` : ""}`);
    got.verified = { score: result.score, day: utcDay(issuedAt) };
    return `score ${result.score} in ${run.sim.tick} ticks`;
  });

  // ---------- 5. Mint (the outbox and GET /api/cron/mint's worker)
  await check("5 the mint worker sends the run's reward and a crafting kit; a resend is a duplicate", async () => {
    const before = await rewardNonce(accountId);
    const goo = await balance("item:sybil-goo");
    // The kit Stealth needs (3 Sybil goo, level 2), queued like any reward.
    const kit = await db.transaction((tx) =>
      enqueueRewardMint(tx, {
        kind: "mint_reward",
        dedupeKey: `mint_reward:e2e-kit-${handle}`,
        playerId: me.id,
        payload: { accountId, items: [{ tokenId: "item:sybil-goo", amount: 3 }], level: 2, digest: digest(Date.now()) },
      }),
    );
    const report = await drainRewards(db);
    assert(report.failed === 0 && report.dead === 0 && report.outOfOrder === 0, `worker: ${JSON.stringify(report)}`);
    assert(report.applied === report.claimed && report.claimed >= 1, `applied ${report.applied} of ${report.claimed}`);
    const after = await rewardNonce(accountId);
    assert(after === before + report.applied && after === kit.nonce, `reward_nonce ${before} → ${after}, kit nonce ${kit.nonce}`);
    assert((await balance("item:sybil-goo")) >= goo + 3, "the kit's goo didn't land");
    // A lost answer means a resend with the same nonce: the contract must say duplicate.
    const [again] = await sendRewards([{ key: "resend", accountId, nonce: kit.nonce, items: [{ item: "sybil-goo", amount: 3 }], level: 2, digest: digest(1) }]);
    assert(again?.status === "duplicate", `resend: ${again?.status} ${again?.error ?? ""}`);
    return `${report.applied} applied (run mint ${report.claimed > 1 ? "and kit" : "skipped: no loot"}), nonce ${after}, ${report.txHashes.join(", ")}`;
  });

  // ---------- 6–7. Craft and equip
  await check("6 craft_suit(stealth) via session key + relayer burns 3 goo; the save mirrors it", async () => {
    const goo = await balance("item:sybil-goo");
    const r = await relayGame("craft_suit", { suit: "stealth" });
    const [left, suit] = await viewFunction<string[]>(rpc, chain.contractId, "mt_batch_balance_of", { account_id: accountId, token_ids: ["item:sybil-goo", "suit:stealth"] });
    assert(Number(left) === goo - 3 && suit === "1", `goo ${goo} → ${left}, suit ${suit}`);
    const save = (await ensureSave(db, me.id)).save;
    assert(r.mirrored && save.suits.includes("stealth") && save.hero?.suit === "stealth", "the save didn't mirror the craft");
    return r.txHash;
  });
  await check("7 equip_suit(classic) via session key + relayer; the save mirrors it", async () => {
    await relayGame("equip_suit", { suit: "classic" });
    const onChain = await viewFunction<{ hero: { suit: string } }>(rpc, chain.contractId, "get_player", { account_id: accountId });
    assert(onChain.hero.suit === "classic", `wearing ${onChain.hero.suit} on chain`);
    const save = (await ensureSave(db, me.id)).save;
    assert(save.hero?.suit === "classic", `wearing ${save.hero?.suit} in the save`);
  });

  // ---------- 8. Board
  const night = got.verified;
  if (!night) {
    record("8 verified score on the boards", "skip", "needs step 4");
  } else {
    await check("8 verified score on Tonight's and All-time boards", async () => {
      const tonight = (await topEntries(db, "tonight", night.day)).find((r) => r.playerId === me.id);
      const alltime = (await topEntries(db, "alltime", ALLTIME_PERIOD)).find((r) => r.playerId === me.id);
      assert(tonight?.score === night.score, `tonight shows ${tonight?.score ?? "nothing"}, expected ${night.score}`);
      assert(alltime?.score === night.score, `all-time shows ${alltime?.score ?? "nothing"}`);
      assert(tonight.nearAccountId === accountId, `board row for ${tonight.nearAccountId}`);
      return `#${tonight.rank} tonight with ${tonight.score}`;
    });
  }

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
