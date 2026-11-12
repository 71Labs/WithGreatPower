#!/usr/bin/env node
/**
 * Downloads the wasm deployed on a NEAR account (a read-only RPC query, no transaction)
 * and checks its code hash, e.g. to test an upgrade from exactly what is live, or to keep
 * the old code at hand before upgrading.
 *
 *   node scripts/near/fetch-deployed-wasm.mjs game.wgpnear.near \
 *     contracts/wgp/target/near/wgp-v2.wasm 68F7NhEjUtKweyLU7WNvT183apacLQegfB1DXUoQ2hjJ
 *
 * The third argument (the expected code hash, as explorers show it) is optional; with it
 * a different hash is an error and nothing is written. NEAR_RPC_URL picks the RPC
 * (default: mainnet for *.near accounts, testnet for *.testnet).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 of a byte array, as NEAR prints hashes. */
export function base58(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const [account, out, expected] = process.argv.slice(2);
if (!account || !out) {
  console.error("Usage: fetch-deployed-wasm.mjs <account_id> <out.wasm> [expected_code_hash]");
  process.exit(2);
}
const rpc = process.env.NEAR_RPC_URL ?? (account.endsWith(".testnet") ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com");
const res = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_code", finality: "final", account_id: account } }),
});
const body = await res.json();
if (!res.ok || body.error || !body.result?.code_base64) {
  console.error(`Couldn't read ${account}'s code from ${rpc}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  process.exit(1);
}
const code = Buffer.from(body.result.code_base64, "base64");
const hash = base58(createHash("sha256").update(code).digest());
if (expected && hash !== expected) {
  console.error(`${account} runs ${hash}, not ${expected}. Nothing written.`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, code);
console.log(`  ${account}: ${code.length} bytes, code hash ${hash} -> ${out}`);
