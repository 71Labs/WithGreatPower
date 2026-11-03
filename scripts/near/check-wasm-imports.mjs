#!/usr/bin/env node
/**
 * Refuses a contract wasm that imports NEAR host functions mainnet doesn't offer yet.
 *
 *   node scripts/near/check-wasm-imports.mjs contracts/wgp/target/near/wgp.wasm
 *
 * near-sdk's `Promise` links every action the SDK knows, including ones from protocol
 * versions mainnet hasn't adopted (gas keys, universal state init). Code importing them
 * fails at deploy with "Link Error: unknown or invalid import", after the deploy fee is
 * spent. The contract uses `env`'s low-level promise calls instead; this catches a
 * regression before anything is sent.
 */
import { readFileSync } from "node:fs";

const NOT_ON_MAINNET = [/gas_key/, /state_init/, /global_contract/];

const file = process.argv[2];
if (!file) {
  console.error("Usage: check-wasm-imports.mjs <contract.wasm>");
  process.exit(2);
}
const imports = WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(file)));
const bad = imports.filter((i) => NOT_ON_MAINNET.some((re) => re.test(i.name))).map((i) => `${i.module}.${i.name}`);
if (bad.length > 0) {
  console.error(`${file} imports host functions mainnet doesn't have yet:\n  ${bad.join("\n  ")}`);
  console.error("Use env's low-level promise calls instead of near_sdk::Promise / ext_contract.");
  process.exit(1);
}
console.log(`  wasm imports OK (${imports.length} host functions, none newer than mainnet)`);
