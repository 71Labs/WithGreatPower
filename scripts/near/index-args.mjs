#!/usr/bin/env node
/**
 * Prints `index_tokens` arguments for tokens minted before v3, so `mt_tokens` lists them.
 * v3 keeps an index of every token id with supply; tokens that already existed when the
 * contract was upgraded join it on their next mint, or right away through `index_tokens`
 * (the operator or the owner; no deposit). This reads what each account holds (read-only
 * view calls) and prints one JSON object per line, at most 100 token ids each:
 *
 *   node scripts/near/index-args.mjs game.wgpnear.near accounts.txt > index-args.jsonl
 *   while read -r ARGS; do
 *     near contract call-function as-transaction game.wgpnear.near index_tokens json-args "$ARGS" \
 *       prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as wgpnear.near \
 *       network-config mainnet sign-with-legacy-keychain send
 *   done < index-args.jsonl
 *
 * `accounts.txt` holds one player account id per line (the app's `players.near_account_id`
 * column). The vendor's own tokens and Bits are always included. Running it again is
 * harmless: ids already listed are skipped by the contract. NEAR_RPC_URL picks the RPC.
 */
import { readFileSync } from "node:fs";

const [contract, file] = process.argv.slice(2);
if (!contract || !file) {
  console.error("usage: index-args.mjs <contract_id> <accounts.txt>");
  process.exit(2);
}
const rpc = process.env.NEAR_RPC_URL ?? (contract.endsWith(".testnet") ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com");

async function view(method, args = {}) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const body = await res.json();
  if (!res.ok || body.error || !body.result?.result) throw new Error(`${method}: ${JSON.stringify(body.error ?? body.result ?? body).slice(0, 300)}`);
  return JSON.parse(Buffer.from(body.result.result).toString("utf8"));
}

const accounts = [...new Set(readFileSync(file, "utf8").split(/\s+/).filter(Boolean)), contract];
const tokens = new Set(["item:bits"]);
for (const pool of (await view("market_state")).pools) tokens.add(`item:${pool.item}`);
let players = 0;
for (const account_id of accounts) {
  const player = await view("get_player", { account_id });
  if (!player) continue;
  players += 1;
  for (const [token_id] of player.tokens) tokens.add(token_id);
}
const ids = [...tokens];
for (let i = 0; i < ids.length; i += 100) console.log(JSON.stringify({ token_ids: ids.slice(i, i + 100) }));
console.error(`  ${ids.length} token ids from ${players} of ${accounts.length} accounts, in ${Math.ceil(ids.length / 100)} call(s)`);
