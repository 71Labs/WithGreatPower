/**
 * Prints the game contract's `set_market_params` arguments: the Mempool Market's default
 * rules and one pool per game item, from apps/wgp/src/lib/market/config.ts (the same
 * curves the simulated market and /lab/economy start from). The owner calls it once
 * after deploying or upgrading to open the market; it needs 1 yoctoNEAR:
 *
 *   ARGS=$(pnpm --filter wgp exec tsx ../../scripts/near/market-args.ts)
 *   near contract call-function as-transaction game.wgpnear.near set_market_params \
 *     json-args "$ARGS" prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' \
 *     sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
 *
 * `--craft-bits N` also turns on the crafting sink (N Bits burned per crafted suit) and
 * `--fee-bps N` sets the gas fee (at most 1000). `--proposed` starts from the settings
 * docs/ECONOMY.md proposes (`PROPOSED_PARAMS`: 250 Bits a suit, a 10% fee).
 * Calling it again later updates the rules and curves; seeds are only minted to new pools.
 */
import { DEFAULT_PARAMS, PROPOSED_PARAMS, setMarketParamsArgs } from "../../apps/wgp/src/lib/market/config";

const args = process.argv.slice(2);
const option = (name: string, fallback: number) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
const base = args.includes("--proposed") ? PROPOSED_PARAMS : DEFAULT_PARAMS;
const craftBits = option("--craft-bits", base.craftBits);
const feeBps = option("--fee-bps", base.feeBps);
if (!Number.isInteger(craftBits) || craftBits < 0 || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1_000) {
  console.error("usage: market-args.ts [--proposed] [--craft-bits N] [--fee-bps 0..1000]");
  process.exit(1);
}
console.log(JSON.stringify(setMarketParamsArgs({ ...DEFAULT_PARAMS, craftBits, feeBps })));
