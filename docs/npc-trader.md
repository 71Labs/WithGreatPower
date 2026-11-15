# Sandwich Man, the NPC trader

Sandwich Man is the Mempool Market's arbitrageur: an NPC who trades from his own NEAR account, `sandwich.wgpnear.near`. His fixed, published rules work out every move the market would accept; an LLM picks among those moves or passes, and the rules pick whenever it can't. The rules are the guardrail and the fallback: the LLM can choose a legal move or pass, and nothing else. This page says who he is, what his rules are, how his brain picks, what stops him doing harm, how to check his trades on chain, and what the owner did to switch him on.

**Status: live on NEAR mainnet since Nov 13, 2026.** The owner created `sandwich.wgpnear.near` with 0.3 NEAR, the operator seeded it once with 300 Bits, and the server was given his account id and key. The live `/api/market/npc` answers `"mode":"on-chain"` with his account id. His first trade landed at 07:15 UTC the same day: a `market_buy` of 2 Sybil goo from Gwei for 72 Bits, by rule 5 ("17% under the opening price. First in line for the dip."). `pnpm evidence --chain` checks his account, its key, his Bits, the live endpoint and the three transactions below.

| What | When (UTC, Nov 13, 2026) | Transaction |
|---|---|---|
| `wgpnear.near` creates his account with 0.3 NEAR and one full-access key | 07:03 | [`Hx32N4dy…`](https://nearblocks.io/txns/Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm) |
| The operator's `mint_rewards` of 300 Bits to him (nonce 1), the one-off seed | 07:12 | [`Hjvobzmd…`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7) |
| His first trade, signed by his own key: `market_buy` of 2 Sybil goo, 70 Bits to Gwei's till and 2 burned as the fee | 07:15 | [`AcmNAmHr…`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf) |

**Disclosure.** His 300 Bits were minted to him once by the operator, not earned in play; the mint's digest is `sha256("npc-seed:sandwich.wgpnear.near:v1")`, so it is recognisable on chain. Everything he has held since comes from trading. He is always labelled NPC, is never counted as a player, and his trades complete nobody's market quest.

Nothing in this repo creates an account, funds one or sends a transaction: the owner ran the setup at the end of this page by hand. Locally, and wherever the simulated market stands in for the contract's, he trades in the simulation, where no tokens move. With his two environment variables unset he is off, and the market says so.

## Who he is

- **Cast:** Sandwich Man, a villain from the story bible (`docs/story/bible.md`): "front-runs you; sets bread traps; works the Mempool Market". Gwei already warns players about him: "Listed. Someone will buy it, or Sandwich Man will try to." Now he really does.
- **A second kind of NPC.** Gwei Stacy, the vendor, *is* the contract: her stock and till are the contract account's balances. Sandwich Man is the opposite: an ordinary account, `sandwich.wgpnear.near`, with no role in the contract at all.
- **His wallet is his own.** His Bits and items are NEP-245 balances of his account in `game.wgpnear.near`, and he signs his own calls with his own key and pays his own gas (his calls are not relayed). In the simulated market his wallet is a row in the simulation.
- **No special powers.** The server only ever sends these five calls from his account; his key is a full-access key. The five are the market methods every player's session key can call: `market_buy`, `market_sell`, `list_item`, `buy_listing` and `cancel_listing`. So the limit is the server's, not the key's ([Limits](#limits)). He is not an operator or the owner. Every cap the contract puts on a player is on him too.
- **Always labelled.** In the game he appears only in the "Other traders" strip on `/play/market`, marked NPC, with his account id linked to NearBlocks and each move linked to its transaction. He is never shown or counted as a player (`pnpm stats` counts his calls on their own line and leaves him out of player accounts). He holds no hero, suit, badge or trophy.

## His rules

The rules are one file, [`apps/wgp/src/lib/market/npc-rules.ts`](../apps/wgp/src/lib/market/npc-rules.ts): a pure function `decide(market, wallet, listings, now)` with the rules in plain English at the top. Same inputs, same answer; no randomness, no clock but the one passed in. It lists every move that fits, best first. The rules alone take the first; with the LLM on, it picks among them or passes ([His brain](#his-brain)).

1. **Take down a stale listing.** A listing of his that has sat for 48 hours comes down.
2. **Flip a cheap listing.** He buys a player's listing when Gwei would pay him at least 10% more for the same lot right now (and at least 1 Bit more), after her gas fee. The seller is paid in full at their own asking price.
3. **Cash out to Gwei.** He sells to Gwei when she pays at least 10% more than the items cost him. The call carries that floor as its `min_bits`, so the contract refuses the sale if her price drops under it first.
4. **Undercut Gwei.** Otherwise he lists up to 2 of an item at 6% under what Gwei charges, if that is still 10% over his cost. When Gwei is sold out, he asks 25% over her spot price. One listing per item.
5. **Buy the dip.** He buys 2 of an item from Gwei when its price is under 85% of its opening price, deepest dip first.
6. **Clearance sale.** Only while broke: he sells up to 2 of whatever loses him least to Gwei at her price, until he can reopen.

Every action carries a reason in his voice, for example: "Bought 2 × Crumbs from azalleaxyz’s listing at 13 Bits: Gwei pays 22. Lunch money."

## His brain

`decide` returns every move that fits, best first, not just the first. On chain, a brain then picks one ([`apps/wgp/src/lib/market/npc-brain.ts`](../apps/wgp/src/lib/market/npc-brain.ts), with the server's call in `apps/wgp/src/server/npc/brain.ts`):

- **The LLM:** one of two providers, both OpenAI-compatible chat completions APIs, first match wins. **NEAR AI Cloud is preferred when `NEARAI_API_KEY` is set:** `NEARAI_MODEL` (default `Qwen/Qwen3.6-35B-A3B-FP8`, a model NEAR AI runs in its own TEEs) at `NEARAI_BASE_URL` (default `https://cloud-api.near.ai/v1`), with each answer's signature checked ([Verified answers](#verified-answers-near-ai-cloud)). Otherwise **Kimi K3** (`kimi-k3`), Moonshot's model, when `LLM_API_KEY` is set (`https://api.moonshot.ai/v1`; `LLM_MODEL` and `LLM_BASE_URL` can name another model or endpoint). The model is shown his wallet and up to 12 of those moves, each with an id number, plus "pass". It answers in JSON mode, `{"pick": <id or "pass">, "reason": "…"}`. The server keeps the pick only if it is the id of one of the moves it was shown, so the move, its numbers, its limit and the text that says what he did are always the rules' own; only the reason's words are the LLM's, cut to one line of at most 160 characters with links and @handles removed. The model reasons before it answers; that reasoning is never read, kept or shown. A pass sends nothing and uses none of his 10 daily actions.
- **`rules`:** the rules' first move, as before the LLM. This is what happens when neither `NEARAI_API_KEY` nor `LLM_API_KEY` is set on the server, when the call takes more than 20 seconds (no retry), on a network or HTTP error, when the answer was cut off (`finish_reason` other than `stop`) or isn't one of the moves, and once he has made 10 LLM calls in the UTC day.

Each line of his ledger records which brain picked it (`brain`: the model id, such as `kimi-k3`, or `rules`) and, for an LLM's pick, whether its answer was verified (`verified`). `/api/market/npc` reports `brain.mode` (`llm` when the server has a key and he trades on chain, otherwise `rules`), `brain.provider` (`near-ai` or `moonshot`), the model, the day's LLM calls left, the last pick with the reason the rules took over, if they did, and `brain.lastVerification` (below). **What is live depends on the key:** `LLM_API_KEY` is set in production (since Nov 15, 2026), so `brain.mode` is `llm`. A move still falls back to the rules on a timeout, an error or a pick that isn't listed, and its ledger line says `rules`. Check it:

```bash
curl -s https://www.wgponnear.fun/api/market/npc | jq '{mode, brain, log: [.log[] | {text, reason, brain}]}'
```

**Cost, bounded by construction.** At most 10 LLM calls a UTC day (counted when a call is made, whatever it answers), one per turn, no retries, about 1,000 tokens in and at most 600 out each (`max_tokens`, reasoning included): at most about 16,000 tokens a day. Nothing is called when there is no legal move. The attestation and signature reads are not LLM calls and don't count against the 10; each gives up after 8 seconds. The turn runs after the response (`after()`), so the 20-second wait never holds up a player. The simulated market, the practice market and `/lab/economy` run on the rules alone.

**Never logged:** each API key is read from the environment and sent only as the request's bearer token, to an `https` endpoint; the prompt holds his public wallet and the market's moves, no secret, and a failed call logs only what failed (a timeout, an HTTP status), never the prompt, the answer or the key.

### Verified answers (NEAR AI Cloud)

With NEAR AI Cloud, each answer he acts on (a pick or a pass) is checked against NEAR AI's own verification scheme, as its documentation describes it ("Response Signatures", "NEAR Model Attestations", "Quote, Nonce, and Signer Bindings" at docs.near.ai). The code is [`apps/wgp/src/server/npc/nearai.ts`](../apps/wgp/src/server/npc/nearai.ts).

1. **Before the call, the model's attestation report.** `GET https://cloud-api.near.ai/v1/attestation/report?model=<model>&provider=near&include_tls_fingerprint=false&signing_algo=ecdsa&nonce=<32 random bytes, hex>` with `x-no-aliasing: true` (public; no key is sent). Each `model_attestations[]` candidate is kept only if it names this model, echoes the nonce, and the 64 bytes of report data inside its Intel TDX quote are its `signing_address` padded to 32 bytes followed by the nonce. The gateway's report is kept the same way. A checked report is reused for 30 minutes and dropped at once if an answer's signer isn't in it.
2. **The call itself** names the canonical model id, with `x-no-aliasing: true` so the model's TEE, not the gateway, signs it. The exact request bytes and the exact response bytes are kept.
3. **After the call, the signature.** `GET https://cloud-api.near.ai/v1/signature/<chat id>?model=<model>&signing_algo=ecdsa` (with the key; retried twice, briefly, while it isn't recorded yet). Its `text` must be `<model>:<sha256 of the request>:<sha256 of the response>` for a `provider_tee` signature, or the two hashes alone for a `gateway` one. The EIP-191 signer recovered from `text` and `signature` must be `signing_address`, and that address must match exactly one kept model report (`provider_tee`) or the kept gateway report (`gateway`).

**Each logged move records the outcome:** provider, model, chat id, signing address, `verified: true` or `false`, and a short reason when false (for example `signature not found`, `signer not in the model's attestation`, `signed text doesn't match this request and response`). Kimi's answers are recorded as `verified: false`, `provider signs nothing`: Moonshot publishes no signatures. `brain.lastVerification` in `/api/market/npc` is the newest one.

**Policy: a check never blocks a turn.** A failed or unavailable verification never blocks his turn: the pick is kept if it is one of his legal moves, and the move is recorded as unverified with a short reason. The pick was already fenced by his rules either way; the check says whether NEAR AI's TEE is provably where the answer came from. Nothing in a verification record is secret: no key, prompt, answer or `reasoning_content` is logged or stored.

**What is not checked here.** The server does not verify the TDX quote's Intel signature chain or TCB status (`dcap-qvl`), replay the RTMR3 event log, check MRCONFIGID against the measured configuration, or send NVIDIA GPU evidence to NRAS. So the signer comparison trusts the quote bytes as served over TLS by `cloud-api.near.ai`; [cloud.near.ai/verify](https://cloud.near.ai/verify) runs those hardware checks in a browser for the same model. NEAR AI's documentation also notes that instances of a model share one signing key, so a matching signer shows the model's TEE key signed the answer, not which instance did.

**What is live:** the code is in this repository; NEAR AI answers only once the owner sets `NEARAI_API_KEY` in production, and `brain.provider` says which provider answers right now.

## Safety caps

His own limits, in `NPC_RULES` (a test fails if the file's comment and the constants drift apart):

| Limit | Value |
|---|---|
| Bits he may spend in a UTC day | 35% of what he held when the day began |
| Actions in a UTC day (a refused call counts) | 10 |
| Actions per look at the market | 1 |
| Of any one item, his listings included | 8 |
| Most he pays per item | 150% of its opening price |
| Broke | Under 60 Bits he buys nothing; he reopens at 120 |
| Buying back from Gwei what he sold her | Not within 72 hours |
| Starting Bits (the one-off seed) | 300 |

The contract's limits, which apply to him as to any account (`contracts/wgp/src/market.rs`): 40 vendor trades, 10 listings, 10 fills and 3,000 Bits of fills a day; 3 open listings; 20 items a call; listing prices between 50% and 400% of Gwei's spot price; no buying your own listing. His 10 actions a day sit inside every one of those.

### What could go wrong, and why it can't

| Risk | Why it is bounded |
|---|---|
| Wash trading or fake volume | He can't trade with himself: the contract refuses a buyer who is the seller, and he has one account. He never buys back from Gwei what he sold her within 72 hours. Each trade needs a real condition in the market (a player's cheap listing, a real dip, a real price over his cost). At most 10 actions a day. |
| He drains Gwei or moves prices | His whole wallet starts at 300 Bits and he spends at most 35% of it a day. Gwei's tills start at 6,240 Bits. His buys and sells move her curve exactly as a player's do, by a few Bits. |
| He out-competes players | His only edge is being awake. A player whose cheap listing he buys gets exactly the price they asked, sooner. His own listings are always under Gwei's price, so a player who buys from him pays less than at the stall. |
| A player games him | Possible, and bounded: someone can push Gwei's price up, list under her inflated sell-back and hope he buys. He won't pay over 150% of an item's opening price, and at worst loses that day's budget (about 105 Bits on day one). Bits have no cash value. |
| The key leaks | It is a full-access key of his account only, held by the server as an environment variable. It holds about 0.3 NEAR and his market inventory. It can't mint, can't touch the contract's settings and can't move any player's tokens. Fix: delete the env var, rotate the key. |
| The runner loops or double-sends | One look takes a lock in the database (a lease) and looks are at least 20 seconds apart. A refused call is counted against the day's 10 actions, so a failing call can cost at most 10 failed transactions a day (about 0.003 NEAR). |
| It runs when it shouldn't | On chain he is off unless both `NPC_TRADER_ACCOUNT_ID` and `NPC_TRADER_PRIVATE_KEY` are set. Removing either stops him at the next request. |
| Background cost | No cron job and no external pinger. He looks at the market only after a request: when a player's trade or listing lands, when someone opens the market (at most once every 5 minutes), or when anyone visits a busy route and his last turn started 15 minutes ago or more. Nobody visiting, nothing runs. |

## How it runs

- `apps/wgp/src/server/npc/runner.ts` is the runner. It is triggered through `after()` (`src/server/background.ts` `npcTraderSoon`) from the relayer's market hook (a player's trade or listing landed on chain), the simulated trade route and reads of `/api/market/npc`, which the market page makes when someone opens it. A read lets him look at most once every 5 minutes.
- **Visits** (`npcVisitSoon` in the same file): any request to `/api/stats`, `/api/leaderboard`, `/api/seasons`, `/api/me` or `/api/market/*` asks, after its response, for a turn that runs only if his last turn started at least 15 minutes ago. The 15 minutes are checked by his lock (`claimRun` in `src/server/npc/store.ts`, one row lock in one transaction), so visits arriving together on several servers give one turn; each server asks at most once a minute. With no visitors there is no turn; with visitors he takes at most one turn every 15 minutes, still capped at 10 actions a day. The 5-minute market trigger, the 10 LLM calls a day and every other cap are unchanged. His first mainnet trade was a rule 5 buy: Sybil goo stood 17% under its opening price.
- A look: take the lock, read the market, his wallet and the open listings, bring his books up to date, call `decide` for every legal move, let the brain pick one or pass ([His brain](#his-brain)), send that one action at most, write it to his ledger with its reason and the brain that picked it. A trade also goes into the price history (`market_prices`) under his account id, like any player's.
- His books and ledger are one JSON row in the existing `market_sim` table (`npc:chain` or `npc:sim`). **No migration.**
- `/lab/economy` runs him among the bot heroes with the same `decide`. Press **Load a run where he goes broke** to watch him close shop, clear stock and reopen.

## Verify his trades on chain

Anyone can check him without trusting the game:

```bash
# His account: every transaction he ever sent is a call to game.wgpnear.near
open https://nearblocks.io/address/sandwich.wgpnear.near

# The account itself: about 0.3 NEAR, no contract code (code_hash is all 1s)
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"sandwich.wgpnear.near"}}' | jq .result

# Its keys: one full-access key, the one the creating transaction added
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"sandwich.wgpnear.near"}}' | jq .result.keys

# His wallet in the contract: Bits, what he may still do today, his open listings
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"game.wgpnear.near\",\"method_name\":\"market_account\",\"args_base64\":\"$(printf '%s' '{"account_id":"sandwich.wgpnear.near"}' | base64)\"}}" \
  | jq -r '.result.result | implode | fromjson'

# His items (and that he holds no hero, suit, badge or trophy)
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"game.wgpnear.near\",\"method_name\":\"get_player\",\"args_base64\":\"$(printf '%s' '{"account_id":"sandwich.wgpnear.near"}' | base64)\"}}" \
  | jq -r '.result.result | implode | fromjson'

# What the game says he did, with each reason and transaction link
curl -s https://www.wgponnear.fun/api/market/npc | jq '{mode, accountId, bits, items, log}'
```

Each line of his ledger in the game links to its transaction. A transaction's events show the same thing the game says: `market_fill` (he bought a listing), `market_trade` (he traded with Gwei), `market_list` or `market_cancel`, with `mt_transfer` and the burned gas fee. To check a decision, read the rule it names in `npc-rules.ts` against the market state in the block before.

The sandbox test `contracts/wgp/sandbox/tests/npc_trader.rs` has an ordinary account do all of it against the real wasm, and checks that the contract refuses him where it refuses anyone. `pnpm evidence` does not run it (it needs cargo-near and a built wasm); CI's `sandbox` job does, and the README's sandbox command runs it by hand. It passed locally on Nov 13, 2026.

## What the owner ran (mainnet, Nov 13, 2026)

Only the owner ran these, from their own terminal with near-cli-rs (0.30) and the key files `scripts/near/setup-mainnet.sh` saved in `~/.near-credentials/mainnet/`. They are kept here as the record of what was done, and as the steps for a fresh network. Cost: **0.3 NEAR** moved into his account (still the owner's; recoverable by deleting the account) plus gas: the creating transaction burned 0.0071 NEAR and the seed mint 0.0003 NEAR.

**1. Create his account** from `wgpnear.near` with a new full-access key, funded with 0.3 NEAR. The key is saved to a file; nothing prints it. Done: [`Hx32N4dy…`](https://nearblocks.io/txns/Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm).

```bash
near account create-account fund-myself sandwich.wgpnear.near '0.3 NEAR' \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as wgpnear.near network-config mainnet sign-with-legacy-keychain send
```

Why 0.3 NEAR: the account itself needs about 0.002 NEAR of storage, and a market call burns about 3 Tgas (about 0.0003 NEAR; his first trade burned 3.3 Tgas, 0.00031 NEAR). At his cap of 10 actions a day that is at most about 0.003 NEAR a day, so 0.3 NEAR is well over two months.

**2. Storage registration: none needed.** The contract sponsors storage for every account (about 0.005 NEAR of the contract's own balance for his entry) and has no `storage_deposit`. He needs no hero either.

**3. Seed him once: 300 Bits, minted by the operator.** This is the only time Bits reach him other than by trading. The digest is `sha256("npc-seed:sandwich.wgpnear.near:v1")`, so the mint is recognisable on chain. Gas: about 3 Tgas (0.0003 NEAR) from `operator.wgpnear.near`. Done: [`Hjvobzmd…`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7), which answered `["applied"]`.

```bash
near contract call-function as-transaction game.wgpnear.near mint_rewards json-args \
  '{"batch":[{"account_id":"sandwich.wgpnear.near","nonce":1,"items":[{"item":"bits","amount":300}],"digest":"e13df65bd44f334ef3490cc7f0df0ac8f1022e904c5ee4fb2f467d7c9f23189c"}]}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  sign-as operator.wgpnear.near network-config mainnet sign-with-legacy-keychain send
```

Running it twice is harmless: the contract answers `["duplicate"]` for a nonce it already applied. He gets no items: he buys those himself.

**4. Check the seed.**

```bash
near contract call-function as-read-only game.wgpnear.near bits_of \
  json-args '{"account_id":"sandwich.wgpnear.near"}' network-config mainnet now
# → "300" right after the seed; it moves once he trades (228 after his first buy)
```

**5. Give the server his account id and key** (production environment, straight from the key file, never echoed), then redeploy.

```bash
cd apps/wgp
printf %s sandwich.wgpnear.near | vercel env add NPC_TRADER_ACCOUNT_ID production --force --yes --no-sensitive
jq -j '.private_key' ~/.near-credentials/mainnet/sandwich.wgpnear.near.json \
  | vercel env add NPC_TRADER_PRIVATE_KEY production --force --yes --sensitive
```

(If near-cli saved the key under a folder instead, the file is `~/.near-credentials/mainnet/sandwich.wgpnear.near/ed25519_*.json`.)

**6. Disclose it.** Done on Nov 13: the README's track table, its status and "Proven on mainnet" tables and its numbers say he is an NPC with a one-off 300 Bit seed, name his account and transactions, and count his calls apart from players'. His claims in `docs/evidence.json` are `proven on chain`.

**To switch him off:** remove either env var and redeploy. **To retire him:** cancel his listings, then `near account delete-account sandwich.wgpnear.near beneficiary wgpnear.near …` returns his NEAR.

## Limits

- **His key is a full-access key.** Nothing on chain stops that key sending something else from his account: a transfer of his NEAR, another contract's method, a new key. What limits him to the five market calls is the server's code (`npcCall` in `apps/wgp/src/server/npc/chain.ts`, and its test). The key can't mint, change the contract's settings or move a player's tokens, because the contract gives his account no role.
- **Planned: a function-call key.** The owner adds a key limited to `game.wgpnear.near` and the five market methods, gives the server that one and deletes the full-access key. Then the limit is the key's as well. The market calls attach no deposit, so a function-call key can sign all of them, and the server needs no change for it (`npcTransaction` in `chain.ts`, tested; the owner's commands are in [KEYS.md](KEYS.md)). Not done as of Nov 13; `pnpm evidence --chain` still expects the one full-access key and fails when that changes, which is the signal to update this page.
- **An LLM picks, inside the rules.** The LLM chooses among the moves his six fixed rules allow, or passes; it can't make a move the rules didn't list or change its numbers. It sees only his wallet and those moves, keeps no memory between turns and does not learn. Its reasons are its own words: cleaned and capped, not checked for accuracy. The prompt and his public wallet go to the provider whose key is set: NEAR AI Cloud (inference inside TEEs) or Moonshot's API.
- **Verification is partial.** A NEAR AI answer counts as verified when its signature binds the exact request and response and its signer is the address the model's attestation report binds to our nonce; the quote's Intel and NVIDIA evidence is not checked on the server ([Verified answers](#verified-answers-near-ai-cloud)).

## Tests

Each claim on this page has a row in [EVIDENCE.md](EVIDENCE.md#sandwich-man-docsnpc-tradermd).

- `apps/wgp/src/lib/market/npc-rules.test.ts`: every rule, the caps, the closed shop and reopening, the books, determinism, and 40 fast-forwards in which the market never refuses one of his actions.
- `apps/wgp/src/server/npc/brain.test.ts`: the brain with a fake LLM endpoint (a `fetch` the test passes; no request leaves the process). Kimi K3's pick among two legal moves is sent with the rules' numbers and its own reason; a pass sends nothing; an answer that isn't a legal move, a cut-off answer, a timeout, an HTTP error or a missing key falls back to the rules; at most 10 calls a UTC day; no secret in the request or the logs.
- `apps/wgp/src/server/npc/nearai.test.ts`: NEAR AI Cloud with fake endpoints and a throwaway signing key. NEAR AI is picked before Kimi and Kimi before the rules; the attestation report is kept only when its nonce and quote report data bind the signer; a signature over a different request or response, or by an address the attestation doesn't name, is unverified and the pick still stands; a missing signature or a slow attestation is unverified, never blocking; a timeout or HTTP error falls back to the rules; the EIP-191 recovery matches Ethereum's test vectors; a visit gives a turn only 15 minutes after the last one, and two visits at once act once.
- `apps/wgp/src/server/npc/npc.test.ts`: the runner on PGlite. A player lists cheap and he buys it; one action a look; rate-limited; two looks at once act once; off when unconfigured; a refusal is booked, not retried forever; the server only ever sends these five calls from his account (his key is a full-access key).
- `contracts/wgp/sandbox/tests/npc_trader.rs`: the real wasm in near-workspaces.
