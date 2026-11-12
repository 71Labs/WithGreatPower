#!/usr/bin/env node
/**
 * Prints `set_market_params` arguments that change one or more of the market's rules and
 * nothing else: it reads the rules the contract has now (a read-only view call) and
 * applies the flags. Pools aren't touched (`"pools": []`).
 *
 *   node scripts/near/market-rules.mjs game.wgpnear.near --invest-open true
 *   node scripts/near/market-rules.mjs game.wgpnear.near --craft-bits 50
 *   node scripts/near/market-rules.mjs game.wgpnear.near --invest-open false --invest-lock-ms 0
 *
 * Flags: --open, --invest-open (true|false); --craft-bits, --min-invest, --max-invest,
 * --daily-invest-bits (Bits); --fee-bps, --invest-fee-bps, --daily-invests,
 * --invest-lock-ms (numbers). The owner sends the output with 1 yoctoNEAR:
 *
 *   near contract call-function as-transaction game.wgpnear.near set_market_params \
 *     json-args "$(node scripts/near/market-rules.mjs game.wgpnear.near --invest-open true)" \
 *     prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as wgpnear.near \
 *     network-config mainnet sign-with-legacy-keychain send
 *
 * NEAR_RPC_URL picks the RPC (default: mainnet for *.near, testnet for *.testnet).
 */
const BOOLS = ["open", "invest_open"];
const BITS = ["craft_bits", "min_invest", "max_invest", "daily_invest_bits"];
const NUMBERS = ["fee_bps", "invest_fee_bps", "daily_invests", "invest_lock_ms"];

const [contract, ...flags] = process.argv.slice(2);
if (!contract || flags.length === 0 || flags.length % 2 !== 0) {
  console.error("usage: market-rules.mjs <contract_id> --<rule> <value> [--<rule> <value> ...]");
  process.exit(2);
}

const rpc = process.env.NEAR_RPC_URL ?? (contract.endsWith(".testnet") ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com");
const res = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "query",
    params: { request_type: "call_function", finality: "final", account_id: contract, method_name: "market_state", args_base64: Buffer.from("{}").toString("base64") },
  }),
});
const body = await res.json();
if (!res.ok || body.error || !body.result?.result) {
  console.error(`Couldn't read ${contract}'s market_state from ${rpc}: ${JSON.stringify(body.error ?? body.result ?? body).slice(0, 300)}`);
  process.exit(1);
}
const params = JSON.parse(Buffer.from(body.result.result).toString("utf8")).params;

for (let i = 0; i < flags.length; i += 2) {
  const key = flags[i].replace(/^--/, "").replaceAll("-", "_");
  const value = flags[i + 1];
  if (!(key in params)) {
    console.error(`${contract} has no rule "${key}"${key.includes("invest") ? " (it isn't on v3 yet?)" : ""}. Rules: ${Object.keys(params).join(", ")}`);
    process.exit(1);
  }
  if (BOOLS.includes(key) && (value === "true" || value === "false")) params[key] = value === "true";
  else if (BITS.includes(key) && /^\d+$/.test(value)) params[key] = value;
  else if (NUMBERS.includes(key) && /^\d+$/.test(value)) params[key] = Number(value);
  else {
    console.error(`Can't set ${flags[i]} to "${value}" with this script.`);
    process.exit(1);
  }
}
console.log(JSON.stringify({ params, pools: [] }));
