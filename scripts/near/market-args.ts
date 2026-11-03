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
 * `--craft-bits N` also turns on the crafting sink (N Bits burned per crafted suit).
 * Calling it again later updates the rules and curves; seeds are only minted to new pools.
 */
import { DEFAULT_PARAMS, setMarketParamsArgs } from "../../apps/wgp/src/lib/market/config";

const args = process.argv.slice(2);
const i = args.indexOf("--craft-bits");
const craftBits = i >= 0 ? Number(args[i + 1]) : DEFAULT_PARAMS.craftBits;
if (!Number.isInteger(craftBits) || craftBits < 0) {
  console.error("usage: market-args.ts [--craft-bits N]");
  process.exit(1);
}
console.log(JSON.stringify(setMarketParamsArgs({ ...DEFAULT_PARAMS, craftBits })));
