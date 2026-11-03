/**
 * Sets up a local NEAR sandbox the way scripts/near/setup-mainnet.sh set up mainnet, so the
 * app can run its whole economy loop against the real contract without spending anything:
 *
 *   wgp.test.near            the parent: contract owner and account factory (wgpnear.near)
 *   game.wgp.test.near       the game contract, initialised with game-core's rules and the
 *                            Mempool Market opened with scripts/near/market-args.ts' pools
 *   relayer.wgp.test.near    pays players' gas (4 keys)
 *   operator.wgp.test.near   mints verified rewards
 *
 * Every key is generated here, for this sandbox only, and written to OUT_ENV (keep it
 * outside the repo) as the environment for a local `next dev` and scripts/near/e2e-sandbox.ts.
 * The sandbox's own root key comes from its home directory (validator_key.json); the e2e
 * script uses it to make each run's wallet player.
 *
 *   near-sandbox --home $HOME_DIR init && near-sandbox --home $HOME_DIR run --rpc-addr 127.0.0.1:3710
 *   cd apps/wgp && SANDBOX_HOME=$HOME_DIR OUT_ENV=/tmp/wgp-sandbox.env pnpm exec tsx ../../scripts/near/sandbox-up.ts
 *
 * SANDBOX_RPC defaults to http://127.0.0.1:3710. It refuses any other host than localhost.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { setMarketParamsArgs } from "../../apps/wgp/src/lib/market/config";
import { Account, actions, JsonRpcProvider, KeyPair, KeyPairSigner, PublicKey } from "../../apps/wgp/src/server/near/sdk";
import { ITEMS, STARTER_UNLOCK_LEVEL, SUITS } from "../../packages/game-core/src/rules/data";

/** The contract's `new` rules, as scripts/near/init-args.ts prints them for mainnet. */
const contractRules = () => ({
  items: Object.keys(ITEMS),
  suits: Object.values(SUITS).map((s) => ({ id: s.id, starter: s.starter, min_level: s.minLevel, recipe: Object.entries(s.recipe).map(([item, amount]) => ({ item, amount })) })),
  starter_unlock_level: STARTER_UNLOCK_LEVEL,
});

const RPC = process.env.SANDBOX_RPC ?? "http://127.0.0.1:3710";
const HOME = process.env.SANDBOX_HOME;
const OUT = process.env.OUT_ENV;
const ROOT = path.resolve(__dirname, "../..");
const WASM = process.env.WGP_WASM ?? path.join(ROOT, "contracts/wgp/target/near/wgp.wasm");

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(RPC)) fail(`SANDBOX_RPC must be a local sandbox, not ${RPC}`);
if (!HOME) fail("Set SANDBOX_HOME to the sandbox's home directory");
if (!OUT) fail("Set OUT_ENV to where the generated environment should go (outside the repo)");
if (path.resolve(OUT).startsWith(ROOT + path.sep)) fail("OUT_ENV must be outside the repo: it holds keys");

const provider = new JsonRpcProvider({ url: RPC });
const validator = JSON.parse(readFileSync(path.join(HOME, "validator_key.json"), "utf8")) as { account_id: string; secret_key?: string; private_key?: string };
const rootId = validator.account_id;
const root = new Account(rootId, provider, KeyPairSigner.fromSecretKey((validator.secret_key ?? validator.private_key) as `ed25519:${string}`));

const parentId = `wgp.${rootId}`;
const ids = { parent: parentId, game: `game.${parentId}`, relayer: `relayer.${parentId}`, operator: `operator.${parentId}` };

const newKey = () => KeyPair.fromRandom("ed25519");
const keys = { parent: newKey(), game: newKey(), relayer: [newKey(), newKey(), newKey(), newKey()], operator: newKey() };

async function send(from: Account, receiverId: string, acts: ReturnType<typeof actions.transfer>[]) {
  const outcome = await from.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "EXECUTED_OPTIMISTIC", throwOnFailure: true });
  return outcome.transaction_outcome.id;
}

async function create(from: Account, accountId: string, near: bigint, fullKeys: KeyPair[], extra: ReturnType<typeof actions.transfer>[] = []) {
  await send(from, accountId, [
    actions.createAccount(),
    actions.transfer(near * NEAR),
    ...fullKeys.map((k) => actions.addFullAccessKey(PublicKey.fromString(k.getPublicKey().toString()))),
    ...extra,
  ]);
  console.log(`created ${accountId} (${near} NEAR)`);
}

async function main() {
  const wasm = new Uint8Array(readFileSync(WASM));
  await create(root, ids.parent, 200n, [keys.parent]);
  const parent = new Account(ids.parent, provider, new KeyPairSigner(keys.parent));
  await create(parent, ids.game, 30n, [keys.game], [
    actions.deployContract(wasm),
    actions.functionCall("new", { owner_id: ids.parent, operators: [ids.operator], ...contractRules() }, 100n * TGAS, 0n),
  ]);
  await create(parent, ids.relayer, 30n, keys.relayer);
  await create(parent, ids.operator, 20n, [keys.operator]);

  const tx = await send(parent, ids.game, [actions.functionCall("set_market_params", setMarketParamsArgs(), 100n * TGAS, 1n)]);
  console.log(`opened the Mempool Market (${tx})`);

  const config = await provider.callFunction({ contractId: ids.game, method: "get_config", args: {} });
  const market = (await provider.callFunction({ contractId: ids.game, method: "market_state", args: {} })) as { pools: unknown[]; params: unknown };
  console.log(`get_config: ${JSON.stringify(config).slice(0, 200)}…`);
  console.log(`market_state: ${market.pools.length} pools, params ${JSON.stringify(market.params)}`);

  const rpc = RPC.replace("localhost", "127.0.0.1");
  const secret = () => randomBytes(24).toString("base64url");
  const env: Record<string, string> = {
    NEAR_NETWORK: "testnet",
    NEAR_RPC_URLS: rpc,
    WGP_CONTRACT_ID: ids.game,
    FACTORY_ACCOUNT_ID: ids.parent,
    FACTORY_PRIVATE_KEY: keys.parent.toString(),
    RELAYER_ACCOUNT_ID: ids.relayer,
    RELAYER_PRIVATE_KEYS: keys.relayer.map((k) => k.toString()).join(","),
    RELAYER_MIN_BALANCE_NEAR: "1",
    OPERATOR_ACCOUNT_ID: ids.operator,
    OPERATOR_PRIVATE_KEY: keys.operator.toString(),
    NEXT_PUBLIC_NEAR_NETWORK: "testnet",
    NEXT_PUBLIC_WGP_CONTRACT_ID: ids.game,
    NEXT_PUBLIC_WGP_PARENT_ACCOUNT_ID: ids.parent,
    NEXT_PUBLIC_NEAR_RPC_URLS: rpc,
    AUTH_SECRET: secret(),
    SEED_SECRET: secret(),
    CRON_SECRET: secret(),
    // For scripts/near/e2e-sandbox.ts, which makes a fresh wallet player each run.
    E2E_ROOT_ACCOUNT_ID: rootId,
    E2E_ROOT_PRIVATE_KEY: (validator.secret_key ?? validator.private_key)!,
  };
  writeFileSync(OUT!, `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
  console.log(`wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
