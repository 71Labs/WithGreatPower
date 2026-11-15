# Keys: what the server holds, and the owner's steps to cold storage

This page lists the keys the game's accounts have on mainnet, what the server does with the ones it holds, and the commands the owner runs, in order, to move the contract's ownership to a cold account, delete the contract account's full-access key and give Sandwich Man a function-call key instead of a full-access one. Nothing in this repository runs them: only the owner can, from their own terminal, with near-cli-rs and their key files in `~/.near-credentials/mainnet/`.

## The keys on mainnet (read Nov 15, 2026, block 224633581)

| Account | Keys | Held by |
|---|---|---|
| `wgpnear.near`, the contract's owner and the factory that creates player accounts | 1, full access: `ed25519:8ftaeLhZBrurvudEDN9oZNgoYxisjtM4EQUaehpywzD9` | The production server (`FACTORY_PRIVATE_KEY`) and the owner |
| `game.wgpnear.near`, the contract | 1, full access: `ed25519:AnyHSxwG7eD3CMAtdhwHByqLrMPVNHeZ7zAQUJtcUtE4` | The owner's machine; not the server |
| `sandwich.wgpnear.near`, the NPC trader | 1, full access: `ed25519:2JdLK77r21bBczZK5GyAjapnwAhXaTWz4CjLWFHZkiuP` | The production server (`NPC_TRADER_PRIVATE_KEY`) and the owner |

Read them yourself (public keys and permissions only):

```bash
for a in wgpnear.near game.wgpnear.near sandwich.wgpnear.near; do
  curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$a\"}}" \
    | jq --arg a "$a" '{account: $a, keys: [.result.keys[] | {public_key, permission: .access_key.permission}]}'
done
```

## What the server does with the keys it holds

- **The server never calls an owner-only method with the factory key.** The factory key signs one kind of transaction: `createPlayerAccount` in `apps/wgp/src/server/near/factory.ts`, sent to the new player's account, with four actions (create the account, a transfer of `FACTORY_INITIAL_BALANCE`, the player's full-access key, the browser's function-call session key). No other module reads `FACTORY_PRIVATE_KEY`, no app code names `set_owner`, `upgrade`, `set_paused`, `add_operator`, `remove_operator`, `set_rules` or `set_market_params`, and each of those needs 1 yoctoNEAR attached. `apps/wgp/src/evidence/owner-keys.test.ts` holds all of that to the code. So moving the contract's ownership off `wgpnear.near` changes nothing for the live site: `wgpnear.near` stays the factory.
- **Sandwich Man's key signs only his five market calls.** Each is one function call to `game.wgpnear.near` (`market_buy`, `market_sell`, `list_item`, `buy_listing`, `cancel_listing`) with no deposit attached (`npcTransaction` in `apps/wgp/src/server/npc/chain.ts`). None of the five is `#[payable]` in the contract. That is exactly what a function-call key limited to that contract and those five methods may sign, so **the server needs no change for a function-call key**: it signs with whichever key `NPC_TRADER_PRIVATE_KEY` holds. `/api/market/npc` shows the public key it signs with (`signerKey`), so anyone can see which of his keys the server has.

## The owner's commands, in the order that never breaks the live site

Before starting: this page's branch is deployed (the live `/api/market/npc` has a `signerKey` field); `COLD_OWNER_ACCOUNT` exists on mainnet and its key is one the owner holds offline (a hardware wallet or a key file kept off every server); and any owner call still wanted from `wgpnear.near` (for example a `set_market_params`) is sent first, because afterwards only `COLD_OWNER_ACCOUNT` can send it.

### 1. Sandwich Man: a function-call key, then no full-access key

His trades keep working throughout: the server switches keys only after the new key exists, and the old key goes only after the live server shows it signs with the new one.

```bash
# 1a. The file that holds his full-access key: must print ed25519:2JdLK77r21bBczZK5GyAjapnwAhXaTWz4CjLWFHZkiuP
jq -r .public_key ~/.near-credentials/mainnet/sandwich.wgpnear.near.json

# 1b. Add a function-call key: game.wgpnear.near only, his five market methods only, signed by the full-access key.
#     near-cli-rs saves it to ~/.near-credentials/mainnet/sandwich.wgpnear.near/ed25519_<public key>.json and prints no secret.
near account add-key sandwich.wgpnear.near \
  grant-function-call-access --allowance '10 NEAR' --contract-account-id game.wgpnear.near \
  --function-names 'market_buy, market_sell, list_item, buy_listing, cancel_listing' \
  autogenerate-new-keypair save-to-legacy-keychain \
  network-config mainnet sign-with-access-key-file ~/.near-credentials/mainnet/sandwich.wgpnear.near.json send

# 1c. The new key's file, and the account's keys on chain: the full-access key and the new function-call key
ls -t ~/.near-credentials/mainnet/sandwich.wgpnear.near/
NEW=~/.near-credentials/mainnet/sandwich.wgpnear.near/ed25519_<new public key>.json
jq -r .public_key "$NEW"
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"sandwich.wgpnear.near"}}' \
  | jq '.result.keys[] | {public_key, permission: .access_key.permission}'

# 1d. Give the server the new key, straight from the file and never echoed, then redeploy production
cd apps/wgp
jq -j '.private_key' "$NEW" | vercel env add NPC_TRADER_PRIVATE_KEY production --force --yes --sensitive
vercel --prod

# 1e. The live server now signs with the new key: must print the new public key
curl -s https://www.wgponnear.fun/api/market/npc | jq -r .signerKey

# 1f. Only then: delete his full-access key, signed by that key itself
near account delete-keys sandwich.wgpnear.near public-keys ed25519:2JdLK77r21bBczZK5GyAjapnwAhXaTWz4CjLWFHZkiuP \
  network-config mainnet sign-with-access-key-file ~/.near-credentials/mainnet/sandwich.wgpnear.near.json send
```

The allowance: a function-call key's allowance is charged the gas each call reserves (30 Tgas, about 0.003 NEAR), and unused gas goes back to his balance, not to the allowance. After 1f nobody can add a key to his account (that needs a full-access key), so the allowance must last: 10 NEAR covers over 3,000 calls, about 300 days at his cap of 10 actions a day. It is a ceiling, not money: he holds about 0.3 NEAR, so the most the key could ever spend is that, on the gas of those five calls. With no full-access key left his account can't be deleted either: retiring him means removing his env vars, and his remaining NEAR stays on his account.

### 2. The contract's owner: `set_owner` to the cold account

```bash
# 2a. The cold account exists and holds the key you expect (public keys and permissions only)
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"COLD_OWNER_ACCOUNT"}}' \
  | jq '.result.keys[] | {public_key, permission: .access_key.permission}'

# 2b. Hand ownership over: owner-only, 1 yoctoNEAR, signed by wgpnear.near
near contract call-function as-transaction game.wgpnear.near set_owner json-args '{"owner_id":"COLD_OWNER_ACCOUNT"}' \
  prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send

# 2c. Check: owner_id is now COLD_OWNER_ACCOUNT, operators and pause unchanged
near contract call-function as-read-only game.wgpnear.near get_config json-args '{}' network-config mainnet now
```

`set_owner` takes any account id: a typo hands the contract to an account nobody controls, and only the new owner can call `set_owner` again. Check 2a's answer before 2b. The site is unaffected: the server never calls an owner-only method, and `wgpnear.near` keeps its key to create player accounts.

### 3. The contract account: delete its full-access key

```bash
# 3a. Its keys: one full-access key, ed25519:AnyHSxwG7eD3CMAtdhwHByqLrMPVNHeZ7zAQUJtcUtE4
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"game.wgpnear.near"}}' \
  | jq '.result.keys[] | {public_key, permission: .access_key.permission}'

# 3b. Delete it, signed by that key itself
near account delete-keys game.wgpnear.near public-keys ed25519:AnyHSxwG7eD3CMAtdhwHByqLrMPVNHeZ7zAQUJtcUtE4 \
  network-config mainnet sign-with-legacy-keychain send
```

Do this last, after step 2 checks out. What it changes, on purpose: the contract's code can then change only through `upgrade`, which only `COLD_OWNER_ACCOUNT` can call (with 1 yoctoNEAR and the wasm as the call's input). `upgrade` is tested in the sandbox (v1 to v2, and v2 to v3 on a copy of mainnet state) but has not yet run on mainnet. And no NEAR can leave `game.wgpnear.near` any more (it was last moved on Nov 14, 0.5 NEAR to the relayer): the contract pays its own storage, and anyone can top it up with a plain transfer. Nothing on the server holds or uses this key, so the site is unaffected.

### If something goes wrong

- Before 1f: put the old key back in `NPC_TRADER_PRIVATE_KEY` and redeploy. After 1f the new key is the only one; if it stops working, Sandwich Man stops trading, and nothing else is affected.
- After 2b: `COLD_OWNER_ACCOUNT` can call `set_owner` again.
- After 3b: there is no undo, by design.
