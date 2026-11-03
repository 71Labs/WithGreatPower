#!/usr/bin/env bash
# Mainnet setup for With Great Power: the game's accounts, the contract and the server keys.
# It spends real NEAR from PAYER and signs with the owner's key, so the owner runs it in their
# own terminal and confirms each spending step.
#
#   scripts/near/setup-mainnet.sh                 # pays from the generated payer
#   PAYER=you.near scripts/near/setup-mainnet.sh  # or from your own wallet in near-cli
#
# Easiest: run scripts/near/keys-mainnet.ts first. It generates every key (including a payer,
# an implicit account), and you just send ~12.5 NEAR to the payer's 64-hex id. Accounts are then
# created with those keys. Otherwise PAYER can be any funded account whose key near-cli has,
# e.g. after `near account import-account using-web-wallet network-config mainnet`; set
# PAYER_SIGN to how near-cli holds its key (sign-with-keychain, sign-with-legacy-keychain or
# sign-with-ledger).
#
# 1. Creates wgpnear.near funded by PAYER (FUND_PARENT, default 12 NEAR), then game., relayer.
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
CREDS="$HOME/.near-credentials/mainnet"
GENERATED_PAYER="$(cat "$CREDS/wgpnear-payer.id" 2>/dev/null || true)"
PAYER="${PAYER:-$GENERATED_PAYER}"
[[ -n "$PAYER" ]] || { echo "Set PAYER, or run scripts/near/keys-mainnet.ts first" >&2; exit 1; }
if [[ -f "$CREDS/$PAYER.json" ]]; then
  PAYER_SIGN="${PAYER_SIGN:-sign-with-legacy-keychain}"
else
  PAYER_SIGN="${PAYER_SIGN:-sign-with-keychain}"
fi
PARENT=wgpnear.near
CONTRACT=game.wgpnear.near
RELAYER=relayer.wgpnear.near
OPERATOR=operator.wgpnear.near
# NEAR storage costs 1 NEAR per 100 KB. The contract's code (~360 KB with the market: ~3.6 NEAR) and
# the player state it sponsors (~0.005 NEAR a player) live on game.; the relayer pays players'
# gas (~0.001–0.003 NEAR an action); the operator pays for reward batches; the parent keeps
# ~2 NEAR to create player accounts. Each amount can be overridden.
FUND_PARENT="${FUND_PARENT:-12 NEAR}"
FUND_CONTRACT="${FUND_CONTRACT:-5.5 NEAR}"
FUND_RELAYER="${FUND_RELAYER:-3 NEAR}"
FUND_OPERATOR="${FUND_OPERATOR:-1.5 NEAR}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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
# How to give a new account its key: the one keys-mainnet.ts generated, else a fresh pair
# saved to near-cli's key files.
key_args() {
  if [[ -f "$CREDS/$1.json" ]]; then
    echo "use-manually-provided-public-key $(jq -r '.public_key' "$CREDS/$1.json")"
  else
    echo "autogenerate-new-keypair save-to-legacy-keychain"
  fi
}
key_of() { # account → its private key from near-cli's key files
  local f="$CREDS/$1.json"
  [[ -f "$f" ]] || f="$(ls "$CREDS/$1"/*.json 2>/dev/null | head -1)"
  [[ -n "$f" && -f "$f" ]] || { echo "No saved key for $1 in $CREDS" >&2; exit 1; }
  jq -r '.private_key' "$f"
}

exists "$PAYER" || { echo "$PAYER doesn't exist on mainnet yet: send it ~12.5 NEAR first, then re-run." >&2; exit 1; }
echo "Payer $PAYER has $(balance_near "$PAYER") NEAR."

echo
echo "== 1. Accounts"
if exists "$PARENT"; then
  echo "$PARENT exists ($(balance_near "$PARENT") NEAR)"
else
  confirm "Create $PARENT, paid by $PAYER with $FUND_PARENT (real NEAR)?"
  # shellcheck disable=SC2046 # key_args is two words on purpose
  near account create-account fund-myself "$PARENT" "$FUND_PARENT" \
    $(key_args "$PARENT") sign-as "$PAYER" \
    network-config "$NETWORK" "$PAYER_SIGN" send
  wait_for "$PARENT"
fi

create_sub() { # account amount
  if exists "$1"; then
    echo "$1 exists ($(balance_near "$1") NEAR)"
    return
  fi
  # shellcheck disable=SC2046 # key_args is two words on purpose
  near account create-account fund-myself "$1" "$2" \
    $(key_args "$1") sign-as "$PARENT" \
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
