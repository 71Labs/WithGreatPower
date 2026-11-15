/**
 * Prints the two owner calls that open Gwei's new stock (apps/wgp/src/lib/market/new-stock.ts),
 * built from the contract as it stands (read-only `get_config` and `market_state`, no keys):
 *
 * - `set_rules`: every live item, suit, starter flag, level and recipe exactly as the contract
 *   has them, with the four new items and two new suits appended.
 * - the new `PoolConfig` entries for `set_market_params` (merge them into that call's `pools`;
 *   existing pools listed there only take new virtual reserves, a new pool's seeds are minted
 *   to the vendor once).
 *
 *   pnpm --filter wgp exec tsx ../../scripts/near/new-stock-args.ts [contract] [rpc]
 *
 * Order matters on chain: `set_rules` first (set_market_params refuses an unknown item).
 * docs/economy/new-stock-calls.json is this script's output on Nov 15, 2026.
 */
import {
  newPoolArgs,
  setRulesArgs,
  type LiveRules,
} from "../../apps/wgp/src/lib/market/new-stock";

const contract = process.argv[2] ?? "game.wgpnear.near";
const rpc = process.argv[3] ?? "https://rpc.mainnet.near.org";

async function view<T>(method: string): Promise<T> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "wgp",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: "e30=",
      },
    }),
  });
  const body = (await res.json()) as {
    result?: { result: number[] };
    error?: unknown;
  };
  if (!body.result) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
}

async function main() {
  const config = await view<LiveRules>("get_config");
  const market = await view<{ pools: { item: string }[] }>("market_state");
  console.log(
    JSON.stringify(
      {
        contract,
        set_rules: setRulesArgs({
          items: config.items,
          suits: config.suits,
          starter_unlock_level: config.starter_unlock_level,
        }),
        new_pools: newPoolArgs(market.pools.map((p) => p.item)),
      },
      null,
      2,
    ),
  );
}

void main();
