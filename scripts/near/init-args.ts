/**
 * Prints the game contract's `new` arguments, built from game-core's ITEMS and SUITS so
 * the chain's recipes and levels always match the game's.
 *
 *   pnpm --filter wgp exec tsx ../../scripts/near/init-args.ts <owner_id> [operator_id ...]
 *   pnpm --filter wgp exec tsx ../../scripts/near/init-args.ts --rules   # set_rules args only
 */
import { ITEMS, STARTER_UNLOCK_LEVEL, SUITS } from "../../packages/game-core/src/rules/data";

export function contractRules() {
  return {
    items: Object.keys(ITEMS),
    suits: Object.values(SUITS).map((s) => ({
      id: s.id,
      starter: s.starter,
      min_level: s.minLevel,
      recipe: Object.entries(s.recipe).map(([item, amount]) => ({ item, amount })),
    })),
    starter_unlock_level: STARTER_UNLOCK_LEVEL,
  };
}

const args = process.argv.slice(2);
if (args[0] === "--rules") {
  console.log(JSON.stringify(contractRules()));
} else {
  const [owner, ...operators] = args;
  if (!owner) {
    console.error("usage: init-args.ts <owner_id> [operator_id ...] | --rules");
    process.exit(1);
  }
  console.log(JSON.stringify({ owner_id: owner, operators, ...contractRules() }));
}
