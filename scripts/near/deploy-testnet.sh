#!/usr/bin/env bash
# Build contracts/wgp and deploy it to TESTNET, initialised with game-core's recipes.
#
#   ./scripts/near/deploy-testnet.sh                 # first deploy: deploy + new(...)
#   MODE=upgrade ./scripts/near/deploy-testnet.sh    # later: owner calls upgrade(wasm) + migrate
#
# Defaults (override with env):
#   CONTRACT_ID=game.wgp.testnet     the game contract (needs ~3.5 NEAR: 2.8 for the code,
#                                    the rest for sponsored player storage, ~0.005 NEAR each)
#   OWNER_ID=wgp.testnet             admin: pause, operators, rules, upgrade
#   OPERATOR_ID=operator.wgp.testnet mints rewards and records seasons
#
# Before the first run (the owner does this; this script creates, funds and deletes nothing):
#   near account create-account sponsor-by-faucet-service wgp.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
#   near account create-account fund-myself game.wgp.testnet '4 NEAR' autogenerate-new-keypair save-to-keychain sign-as wgp.testnet network-config testnet sign-with-keychain send
#   (and relayer.wgp.testnet, operator.wgp.testnet the same way; see the Chain report)
#
# Needs cargo-near 0.22, near-cli-rs, jq and pnpm, with CONTRACT_ID's key and OWNER_ID's
# key (the owner upgrades and opens the Mempool Market) in your keychain.
# KEYCHAIN=legacy signs with the key files in
# ~/.near-credentials instead (as scripts/near/setup-testnet.sh saves them), and
# CONFIRM=<contract id> answers the confirmation prompt up front.
set -euo pipefail

NETWORK=testnet
MODE="${MODE:-deploy}"
CONTRACT_ID="${CONTRACT_ID:-game.wgp.testnet}"
OWNER_ID="${OWNER_ID:-wgp.testnet}"
OPERATOR_ID="${OPERATOR_ID:-operator.wgp.testnet}"
case "${KEYCHAIN:-}" in
  legacy) SIGN=sign-with-legacy-keychain ;;
  *) SIGN=sign-with-keychain ;;
esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WASM="$ROOT/contracts/wgp/target/near/wgp.wasm"

case "$CONTRACT_ID" in
  *.near) echo "This script is testnet only; $CONTRACT_ID looks like a mainnet account." >&2; exit 1 ;;
esac
case "$MODE" in
  deploy | upgrade) ;;
  *) echo "MODE must be deploy or upgrade" >&2; exit 1 ;;
esac
for tool in cargo near jq pnpm; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done

echo "Building the contract (cargo near build, non-reproducible for testnet)…"
(cd "$ROOT/contracts/wgp" && cargo near build non-reproducible-wasm)
SIZE=$(wc -c <"$WASM" | tr -d ' ')
SHA=$(shasum -a 256 "$WASM" | cut -d' ' -f1)

INIT_ARGS=$(cd "$ROOT/apps/wgp" && pnpm exec tsx ../../scripts/near/init-args.ts "$OWNER_ID" "$OPERATOR_ID")
echo "$INIT_ARGS" | jq -e '.suits | length > 0' >/dev/null

echo
echo "  network     $NETWORK"
echo "  mode        $MODE"
echo "  contract    $CONTRACT_ID"
echo "  owner       $OWNER_ID"
echo "  operator    $OPERATOR_ID"
echo "  wasm        $WASM ($SIZE bytes, sha256 $SHA)"
echo "  suits       $(echo "$INIT_ARGS" | jq -r '[.suits[].id] | join(", ")')"
echo
if [[ -z "${CONFIRM:-}" ]]; then read -r -p "Type the contract id to continue: " CONFIRM; fi
[[ "$CONFIRM" == "$CONTRACT_ID" ]] || { echo "Aborted."; exit 1; }

if [[ "$MODE" == "deploy" ]]; then
  near contract deploy "$CONTRACT_ID" use-file "$WASM" \
    with-init-call new json-args "$INIT_ARGS" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" "$SIGN" send
else
  # The owner calls upgrade with the raw wasm as input (1 yoctoNEAR, owner only); the
  # contract deploys it to itself and runs migrate.
  near contract call-function as-transaction "$CONTRACT_ID" upgrade file-args "$WASM" \
    prepaid-gas '300.0 Tgas' attached-deposit '1 yoctoNEAR' \
    sign-as "$OWNER_ID" network-config "$NETWORK" "$SIGN" send
fi

echo
echo "Checking get_config…"
near contract call-function as-read-only "$CONTRACT_ID" get_config json-args '{}' network-config "$NETWORK" now

# The Mempool Market opens (or takes the current curves) with set_market_params. Seeds
# are minted to the vendor only for pools that are new, so re-running it is safe.
echo
echo "Opening the Mempool Market…"
MARKET_ARGS=$(cd "$ROOT/apps/wgp" && pnpm exec tsx ../../scripts/near/market-args.ts)
near contract call-function as-transaction "$CONTRACT_ID" set_market_params json-args "$MARKET_ARGS" \
  prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as "$OWNER_ID" network-config "$NETWORK" "$SIGN" send
near contract call-function as-read-only "$CONTRACT_ID" market_state json-args '{}' network-config "$NETWORK" now

cat <<EOF

Done. Server env (Vercel / apps/wgp/.env.local):
  NEAR_NETWORK=$NETWORK
  WGP_CONTRACT_ID=$CONTRACT_ID
  NEXT_PUBLIC_NEAR_NETWORK=$NETWORK
  NEXT_PUBLIC_WGP_CONTRACT_ID=$CONTRACT_ID
EOF
