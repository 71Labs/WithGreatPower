#!/usr/bin/env bash
# Mainnet setup for With Great Power: the game's accounts, the contract and the server keys.
# It spends real NEAR from PAYER and signs with the owner's key, so the owner runs it in their
# own terminal and confirms each spending step.
#
#   PAYER=you.near scripts/near/setup-mainnet.sh
#
# Before running: put PAYER's key in near-cli, e.g.
#   near account import-account using-web-wallet network-config mainnet
# (it opens your wallet in the browser to approve a key; nothing secret is typed here).
# If PAYER's key is in the key files rather than the macOS keychain, set
# PAYER_SIGN=sign-with-legacy-keychain (or sign-with-ledger for a Ledger).
#
# 1. Creates wgpnear.near funded by PAYER (FUND_PARENT, default 7.5 NEAR), then game., relayer.
#    and operator.wgpnear.near funded from it. New keys are saved as files in
#    ~/.near-credentials/mainnet/, never the repo. Accounts that exist are skipped.
# 2. Builds the contract and deploys and initialises it on game.wgpnear.near, with
#    wgpnear.near as owner and operator.wgpnear.near as operator, then opens the Mempool
#    Market (set_market_params from scripts/near/market-args.ts, 1 yoctoNEAR). (The build
#    is not reproducible: Cargo.toml's reproducible_build has no image digest yet.)
# 3. Writes the account ids and the three private keys to the Vercel project's production
#    environment, straight from the key files; nothing prints them.
#
# Optional: NEAR_AUTH_CLIENT_ID=<approved mainnet client id> [NEAR_AUTH_DOMAIN=<its Auth0
# domain>] also writes the Google sign-in settings. Afterwards, redeploy production.
set -euo pipefail

NETWORK=mainnet
PAYER="${PAYER:?Set PAYER to the funded mainnet account that pays, e.g. PAYER=you.near}"
PAYER_SIGN="${PAYER_SIGN:-sign-with-keychain}"
PARENT=wgpnear.near
CONTRACT=game.wgpnear.near
RELAYER=relayer.wgpnear.near
OPERATOR=operator.wgpnear.near
FUND_PARENT="${FUND_PARENT:-7.5 NEAR}"
# From the parent: the contract's code (with the Mempool Market, ~360 KB) needs ~3.6 NEAR of
# storage, plus sponsored player storage and open listings.
FUND_CONTRACT='4.5 NEAR'
FUND_RELAYER='2 NEAR'
FUND_OPERATOR='0.5 NEAR'
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CREDS="$HOME/.near-credentials/$NETWORK"
WASM="$ROOT/contracts/wgp/target/near/wgp.wasm"
RPC=https://rpc.mainnet.fastnear.com

for tool in near cargo jq pnpm vercel curl; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done

rpc_account() { # account → JSON result of view_account, or nothing if it doesn't exist
  curl -s "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    jq -c '.result // empty'
}
exists() { [[ -n "$(rpc_account "$1")" ]]; }
balance_near() { rpc_account "$1" | jq -r '(.amount | tonumber) / 1e24 | . * 1000 | floor / 1000'; }
wait_for() { for _ in $(seq 1 30); do exists "$1" && return; sleep 2; done; echo "$1 didn't appear" >&2; exit 1; }
confirm() { # prompt
  local answer
  read -r -p "$1 Type yes to continue: " answer
  [[ "$answer" == yes ]] || { echo "Stopped."; exit 1; }
}
key_of() { # account → its private key from near-cli's key files
  local f="$CREDS/$1.json"
  [[ -f "$f" ]] || f="$(ls "$CREDS/$1"/*.json 2>/dev/null | head -1)"
  [[ -n "$f" && -f "$f" ]] || { echo "No saved key for $1 in $CREDS" >&2; exit 1; }
  jq -r '.private_key' "$f"
}

exists "$PAYER" || { echo "$PAYER doesn't exist on mainnet" >&2; exit 1; }
echo "Payer $PAYER has $(balance_near "$PAYER") NEAR."

echo
echo "== 1. Accounts"
if exists "$PARENT"; then
  echo "$PARENT exists ($(balance_near "$PARENT") NEAR)"
else
  confirm "Create $PARENT, paid by $PAYER with $FUND_PARENT (real NEAR)?"
  near account create-account fund-myself "$PARENT" "$FUND_PARENT" \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$PAYER" \
    network-config "$NETWORK" "$PAYER_SIGN" send
  wait_for "$PARENT"
fi

create_sub() { # account amount
  if exists "$1"; then
    echo "$1 exists ($(balance_near "$1") NEAR)"
    return
  fi
  near account create-account fund-myself "$1" "$2" \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$PARENT" \
    network-config "$NETWORK" sign-with-legacy-keychain send
  wait_for "$1"
}
if ! exists "$CONTRACT" || ! exists "$RELAYER" || ! exists "$OPERATOR"; then
  confirm "Create the sub-accounts from $PARENT: $CONTRACT ($FUND_CONTRACT), $RELAYER ($FUND_RELAYER), $OPERATOR ($FUND_OPERATOR)?"
fi
create_sub "$CONTRACT" "$FUND_CONTRACT"
create_sub "$RELAYER" "$FUND_RELAYER"
create_sub "$OPERATOR" "$FUND_OPERATOR"

echo
echo "== 2. Game contract"
if [[ "$(rpc_account "$CONTRACT" | jq -r '.code_hash')" != "11111111111111111111111111111111" ]]; then
  echo "$CONTRACT already has code; leaving it alone."
else
  echo "Building the contract (cargo near build)…"
  (cd "$ROOT/contracts/wgp" && cargo near build non-reproducible-wasm --locked)
  INIT_ARGS=$(cd "$ROOT/apps/wgp" && pnpm exec tsx ../../scripts/near/init-args.ts "$PARENT" "$OPERATOR")
  echo "$INIT_ARGS" | jq -e '.suits | length > 0' >/dev/null
  echo "  wasm $(wc -c <"$WASM" | tr -d ' ') bytes, sha256 $(shasum -a 256 "$WASM" | cut -d' ' -f1)"
  echo "  owner $PARENT, operator $OPERATOR"
  confirm "Deploy and initialise the contract on $CONTRACT (mainnet)?"
  near contract deploy "$CONTRACT" use-file "$WASM" \
    with-init-call new json-args "$INIT_ARGS" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-legacy-keychain send
  near contract call-function as-read-only "$CONTRACT" get_config json-args '{}' network-config "$NETWORK" now
  MARKET_ARGS=$(cd "$ROOT/apps/wgp" && pnpm exec tsx ../../scripts/near/market-args.ts)
  echo "$MARKET_ARGS" | jq -e '.pools | length > 0' >/dev/null
  confirm "Open the Mempool Market on $CONTRACT (set_market_params, 1 yoctoNEAR from $PARENT)?"
  near contract call-function as-transaction "$CONTRACT" set_market_params json-args "$MARKET_ARGS" \
    prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' \
    sign-as "$PARENT" network-config "$NETWORK" sign-with-legacy-keychain send
fi

echo
echo "== 3. Vercel production environment"
cd "$ROOT/apps/wgp"
put() { # name value [sensitive]
  local flag="--no-sensitive"
  [[ "${3:-}" == sensitive ]] && flag="--sensitive"
  printf %s "$2" | vercel env add "$1" production --force --yes "$flag" >/dev/null
  echo "  $1"
}
put NEAR_NETWORK "$NETWORK"
put WGP_CONTRACT_ID "$CONTRACT"
put NEXT_PUBLIC_NEAR_NETWORK "$NETWORK"
put NEXT_PUBLIC_WGP_CONTRACT_ID "$CONTRACT"
put NEXT_PUBLIC_WGP_PARENT_ACCOUNT_ID "$PARENT"
put FACTORY_ACCOUNT_ID "$PARENT"
put RELAYER_ACCOUNT_ID "$RELAYER"
put OPERATOR_ACCOUNT_ID "$OPERATOR"
put RELAYER_MIN_BALANCE_NEAR 1
put FACTORY_PRIVATE_KEY "$(key_of "$PARENT")" sensitive
put RELAYER_PRIVATE_KEYS "$(key_of "$RELAYER")" sensitive
put OPERATOR_PRIVATE_KEY "$(key_of "$OPERATOR")" sensitive
if [[ -n "${NEAR_AUTH_CLIENT_ID:-}" ]]; then
  put NEAR_AUTH_CLIENT_ID "$NEAR_AUTH_CLIENT_ID"
  put NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID "$NEAR_AUTH_CLIENT_ID"
  if [[ -n "${NEAR_AUTH_DOMAIN:-}" ]]; then put NEXT_PUBLIC_NEAR_AUTH_DOMAIN "$NEAR_AUTH_DOMAIN"; fi
fi

echo
echo "Balances: $PARENT $(balance_near "$PARENT"), $CONTRACT $(balance_near "$CONTRACT"), $RELAYER $(balance_near "$RELAYER"), $OPERATOR $(balance_near "$OPERATOR") NEAR."
echo "Done. Redeploy production so the settings take effect."
