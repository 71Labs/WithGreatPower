#!/usr/bin/env bash
# One-time testnet setup so Google sign-in (NEAR Auth) works on the deployed game. The owner
# runs it; it creates accounts, deploys the contract and writes secrets to Vercel.
#
#   scripts/near/setup-testnet.sh
#
# 1. Creates wgp.testnet with the testnet faucet, then game., relayer. and operator.wgp.testnet
#    funded from it. Keys are saved as files in ~/.near-credentials/testnet/ (never the repo).
#    Accounts that already exist are left alone, so it's safe to re-run.
# 2. Builds, deploys and initialises the game contract on game.wgp.testnet (deploy-testnet.sh).
# 3. Adds the NEAR settings and the three private keys to the Vercel project's production and
#    preview environments. Keys go from the key files straight to Vercel; nothing prints them.
#
# Afterwards, redeploy production so the NEXT_PUBLIC_* settings are built in.
# Testnet only: its NEAR has no value. Needs near-cli-rs, cargo-near, jq, pnpm and a linked,
# logged-in Vercel CLI (apps/wgp/.vercel).
set -euo pipefail

NETWORK=testnet
PARENT=wgp.testnet
CONTRACT=game.wgp.testnet
RELAYER=relayer.wgp.testnet
OPERATOR=operator.wgp.testnet
# NEAR each sub-account gets from the parent: the contract's code needs ~2.8, plus player storage.
FUND_CONTRACT='3.5 NEAR'
FUND_RELAYER='1.5 NEAR'
FUND_OPERATOR='0.5 NEAR'
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CREDS="$HOME/.near-credentials/$NETWORK"

for tool in near cargo jq pnpm vercel curl; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done

rpc_account() { # account → JSON result of view_account, or nothing if it doesn't exist
  curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" |
    jq -c '.result // empty'
}
exists() { [[ -n "$(rpc_account "$1")" ]]; }
balance_near() { rpc_account "$1" | jq -r '(.amount | tonumber) / 1e24 | . * 100 | floor / 100'; }

# The private key near-cli-rs saved for an account: <id>.json, or the first file in <id>/.
key_of() {
  local f="$CREDS/$1.json"
  [[ -f "$f" ]] || f="$(ls "$CREDS/$1"/*.json 2>/dev/null | head -1)"
  [[ -n "$f" && -f "$f" ]] || { echo "No saved key for $1 in $CREDS" >&2; exit 1; }
  jq -r '.private_key' "$f"
}

echo "== 1. Accounts on $NETWORK"
if exists "$PARENT"; then
  echo "$PARENT exists"
else
  near account create-account sponsor-by-faucet-service "$PARENT" \
    autogenerate-new-keypair save-to-legacy-keychain network-config "$NETWORK" create
  for _ in $(seq 1 20); do exists "$PARENT" && break; sleep 2; done
fi
echo "$PARENT balance: $(balance_near "$PARENT") NEAR"

create_sub() { # account amount
  if exists "$1"; then
    echo "$1 exists"
    return
  fi
  near account create-account fund-myself "$1" "$2" \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$PARENT" \
    network-config "$NETWORK" sign-with-legacy-keychain send
}
create_sub "$CONTRACT" "$FUND_CONTRACT"
create_sub "$RELAYER" "$FUND_RELAYER"
create_sub "$OPERATOR" "$FUND_OPERATOR"
for a in "$CONTRACT" "$RELAYER" "$OPERATOR"; do
  for _ in $(seq 1 20); do exists "$a" && break; sleep 2; done
  echo "$a balance: $(balance_near "$a") NEAR"
done

echo
echo "== 2. Game contract"
if [[ "$(rpc_account "$CONTRACT" | jq -r '.code_hash')" == "11111111111111111111111111111111" ]]; then
  KEYCHAIN=legacy CONFIRM="$CONTRACT" CONTRACT_ID="$CONTRACT" OWNER_ID="$PARENT" OPERATOR_ID="$OPERATOR" \
    "$ROOT/scripts/near/deploy-testnet.sh"
else
  echo "$CONTRACT already has code; to upgrade it, run MODE=upgrade KEYCHAIN=legacy scripts/near/deploy-testnet.sh"
fi

echo
echo "== 3. Vercel environment (production and preview)"
cd "$ROOT/apps/wgp"
put() { # name value [sensitive]
  local name="$1" value="$2" flag="--no-sensitive"
  [[ "${3:-}" == sensitive ]] && flag="--sensitive"
  for target in production preview; do
    printf %s "$value" | vercel env add "$name" "$target" --force --yes "$flag" >/dev/null
  done
  echo "  $name"
}
put NEAR_NETWORK "$NETWORK"
put WGP_CONTRACT_ID "$CONTRACT"
put FACTORY_ACCOUNT_ID "$PARENT"
put RELAYER_ACCOUNT_ID "$RELAYER"
put OPERATOR_ACCOUNT_ID "$OPERATOR"
put RELAYER_MIN_BALANCE_NEAR 0.5
put NEXT_PUBLIC_NEAR_NETWORK "$NETWORK"
put NEXT_PUBLIC_WGP_CONTRACT_ID "$CONTRACT"
put NEXT_PUBLIC_WGP_PARENT_ACCOUNT_ID "$PARENT"
put FACTORY_PRIVATE_KEY "$(key_of "$PARENT")" sensitive
put RELAYER_PRIVATE_KEYS "$(key_of "$RELAYER")" sensitive
put OPERATOR_PRIVATE_KEY "$(key_of "$OPERATOR")" sensitive

echo
echo "Done. Redeploy production so the NEXT_PUBLIC_* settings are built in, then try"
echo "\"Continue with Google\" at https://with-great-power.vercel.app/play."
