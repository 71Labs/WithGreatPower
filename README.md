# With Great Power (WGP)

With Great Power is set in a city that runs on "mainnet", where the villains are a market's oldest tricks given faces: Sandwich Man front-runs every queue, Gas Goblin spikes the fees, Doc Octochain tolls the bridges and the Sybil votes as thousands of himself. The city's shop is the Mempool Market, and it lives inside a NEAR contract: Gwei Stacy, the vendor, holds her stock and her till on chain and prices each item on a curve that moves with every trade, while Sandwich Man trades against players from a NEAR account of his own. You play the hero who keeps that market honest, in a 3D web-swinging game you play free in a browser: swing through the city at night, catch the villains, run errands, and sell what you win to Gwei or to other players. **Every ranked score is replayed and verified by the server** before it counts, and anyone can re-run that replay with one command. Everything you earn is a NEP-245 token in one contract on NEAR mainnet, and after a Google sign-in there are no wallet popups, seed phrases or gas prompts: a game-only key in your browser signs your game actions and the game's relayer pays the gas. When that gas runs low, anyone can refill it from Ethereum, Base, Arbitrum, Solana or Bitcoin through NEAR Intents, at [wgponnear.fun/gas](https://www.wgponnear.fun/gas).

[![The hero swinging between rooftops at night](docs/screenshots/swing.jpg)](https://www.wgponnear.fun/play)

**Play:** https://www.wgponnear.fun/play (free, no install). A first visit puts you straight into a night as a guest; sign in to be ranked and to earn on NEAR.

| Where it runs | What | Evidence |
|---|---|---|
| **Live on NEAR mainnet** | The contract [`game.wgpnear.near`](https://nearblocks.io/address/game.wgpnear.near) holds every hero, item, suit, badge and Bit as a NEP-245 token: the standard's core, without its metadata extension. | [`track-nep245`](docs/EVIDENCE.md#track-nep245) |
| **Live on NEAR mainnet** | Gwei Stacy, a vendor inside the contract, prices each item on a curve that moves with every trade. | [`judge-3`](docs/EVIDENCE.md#judge-3) |
| **Live on NEAR mainnet** | Player accounts call the contract themselves. How many, and how few accounts make most of the calls, is under [By the numbers](#by-the-numbers). | [`judge-2`](docs/EVIDENCE.md#judge-2) |
| **Live on NEAR mainnet** | Sandwich Man, an NPC trader, trades from his own account, `sandwich.wgpnear.near`. His fixed rules list the moves the market would accept; an LLM, Kimi K3 (Moonshot), picks one or passes, and the rules pick whenever it can't (no API key on the server, a timeout, an error). Which brain is live is `brain.mode` in `/api/market/npc`. | [`track-agent-npc`](docs/EVIDENCE.md#track-agent-npc) |
| **Live on NEAR mainnet** | Season 1's final board is recorded in the contract. `record_season` landed on Nov 15, 2026 at 01:26 UTC, with the board's Merkle root, the results file's sha256 and a soulbound `trophy:s1:<rank>` for each of the top 10. | [`intro-season-record`](docs/EVIDENCE.md#intro-season-record) |
| **Live, first refill pending** | The Gas tank at [`/gas`](https://www.wgponnear.fun/gas): anyone can refill `relayer.wgpnear.near`, the account that pays players' gas, from Ethereum, Base, Arbitrum, Solana or Bitcoin through NEAR Intents' 1Click API. Live quotes work today; no real refill has landed on chain yet. | [`track-intents`](docs/EVIDENCE.md#track-intents) |
| **Practice only** | Signed out, `/play/market` is a practice market in your browser, not on NEAR. Investing in the vendor runs only there and in a local checkout. | [`track-invest-practice`](docs/EVIDENCE.md#track-invest-practice) |
| **Simulation only** | `/lab/economy` fast-forwards bot players on the same pricing code. Nothing in it is on chain. | [`track-fast-forward`](docs/EVIDENCE.md#track-fast-forward) |
| **Built, not deployed** | Contract v3 (metadata, enumeration and investing in the vendor) is on the branch `review/contract-v3`, reviewed by a second AI agent that did not write it; not an audit. | [`track-nep245-v3`](docs/EVIDENCE.md#track-nep245-v3) |

Each row links its entry in [docs/EVIDENCE.md](docs/EVIDENCE.md), which names the test or the read-only mainnet check behind it. `pnpm install --frozen-lockfile && pnpm evidence --chain` runs them all and prints one PASS, FAIL or SKIP line per claim. What the evidence does not show (a bot can rank, seeds can be re-rolled, the owner key is a hot key, and Season 1 is a small playtest with airdrops), is under [Limits](#limits-and-whats-next) and [By the numbers](#by-the-numbers). Everything that is not proven or not live is listed in one place under [What is not proven, or not live](#what-is-not-proven-or-not-live).

**Dated disclosure.** The submission deadline was 2026-11-14 23:59 UTC. Some of what this README describes was merged, deployed or switched on after it, on Nov 15: the Bits taper, the 5% fee and 250-Bit crafting cost, Gwei's new stock and wanted list, Sandwich Man's LLM brain, the traction and cost reports, and the owner's two on-chain calls. [Changed after the deadline](#changed-after-the-deadline-nov-15-2026) lists each change with its date, commit and transaction.

| | |
|---|---|
| **Contract** | [`game.wgpnear.near`](https://nearblocks.io/address/game.wgpnear.near) on NEAR mainnet |
| **Accounts** | `wgpnear.near` (owner and account factory) · `operator.wgpnear.near` (reward mints, season records) · `relayer.wgpnear.near` (pays players' gas) · `sandwich.wgpnear.near` (the NPC trader) |
| **Live numbers** | https://www.wgponnear.fun/stats, or `GET /api/stats` |
| **Every transaction** | [docs/TRANSACTIONS.md](docs/TRANSACTIONS.md), a ledger generated from NearBlocks by `pnpm txs`; the key ones are under [Proven on mainnet](#proven-on-mainnet) |
| **Track** | NEAR HACKATHON, Nov 1–14, 2026: Games With Real Economies (`games`) |
| **Deadline** | 2026-11-14 23:59 UTC. Judging Nov 16–18 |
| **License** | MIT ([LICENSE](LICENSE)) |

**Contents:** [Track fit](#how-it-meets-the-track) · [5-minute check](#for-judges-5-minute-check) · [Numbers](#by-the-numbers) · [Screenshots](#screenshots) · [World](#the-world) · [Game loop](#the-game-loop) · [Economy](#the-economy-loop) · [Economy in depth](#the-economy-in-depth) · [Ways to play](#ways-to-play) · [Try it](#try-it-do-x-see-y) · [NEAR](#what-near-does-here) · [NEAR in depth](#the-near-integration-in-depth) · [Transactions](#proven-on-mainnet) · [Verification](#how-verification-works) · [Evidence](#evidence) · [Not proven](#what-is-not-proven-or-not-live) · [Run locally](#run-it-locally) · [Layout](#layout) · [Limits](#limits-and-whats-next) · [After the deadline](#changed-after-the-deadline-nov-15-2026) · [Disclosures](#built-during-the-hackathon)

## How it meets the track

The track's prompt (["Games With Real Economies"](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md)) lists what to build. Each line below says where it is in WGP and how to check it.

| The track asks for | In WGP | Check |
|---|---|---|
| Judged on the game loop, not the token | A real-time 3D action game: swing, fight, climb, race. 8 ways to play; all are built, and one of them, Duels, has no verified run yet. Duels had no verified run as of Nov 13 or Nov 15; `/api/stats` has the count now. | Play a guest night at `/play` (check 1). The order things were written in: a 2D real-time prototype of the night came first (Nov 1, commit `699457d`). The plan for the 3D game, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), was committed on Nov 2 (`94c8d19`), three minutes before the first 3D simulation code (`143b12e`). [docs/GAME-LOOP.md](docs/GAME-LOOP.md) was written on Nov 12 and documents the loop as built; it was not a design written before the code. [Evidence](docs/EVIDENCE.md#track-game-loop) |
| Bonus if players never notice the chain | Google sign-in, a game-only session key, a relayer that pays gas. No popup after sign-in. | [Try it](#try-it-do-x-see-y), steps 2, 3 and 5. [Evidence](docs/EVIDENCE.md#track-chain-unnoticed) |
| Items are NEP-245 multi tokens, one contract for every item type | Heroes, suits, loot, Bits, badges and trophies are all token ids in `game.wgpnear.near`. The deployed contract (v2) has NEP-245's core: transfers and batch transfers, balance and supply views, `mt_tokens_for_owner` and the standard's events. It has no metadata extension, no global enumeration (`mt_tokens`) and no approvals. v3 adds metadata, enumeration and merchant investing. It is built, reviewed by a second AI agent that did not write it (not an audit) and rehearsed on a copy of mainnet state, and it is not deployed. Its source is on the branch `review/contract-v3`, not on `main`; the review's findings, test counts and commits are in [docs/CONTRACT-V3-REVIEW.md](docs/CONTRACT-V3-REVIEW.md). | Check 4 (command B). [Evidence](docs/EVIDENCE.md#track-nep245) |
| Social or email login, no seed phrases, popups or gas prompts in the loop | Google through Privy; NEAR wallets also work with one signed message | Step 2. [Evidence](docs/EVIDENCE.md#track-social-login) |
| NEAR Intents (on the track's "lean on" list) | **The Gas tank refills the relayer from 5 chains through NEAR Intents' 1Click API.** Signed-in players never pay gas: `relayer.wgpnear.near` pays it, and when its balance falls under the cut-off, signed-in trades pause. At https://www.wgponnear.fun/gas anyone can refill it with USDC or ETH on Ethereum, Base or Arbitrum, USDC or SOL on Solana, or BTC: a live dry quote, then a one-time deposit address and the swap's status until the NEAR lands. The recipient is always the relayer, fixed on the server; only the curated tokens and $1 to $50 a time are accepted, and a failed swap is refunded on the origin chain. The game's own economy (items and Bits) still lives in one contract and doesn't use Intents. | Tests pin the fixed recipient, the curated tokens, the bounds and 1Click's errors ([`apps/wgp/src/server/intents/one-click.ts`](apps/wgp/src/server/intents/one-click.ts)). The dry quote is a live check against the site. A real refill is owner action needed until one lands on chain. [Evidence](docs/EVIDENCE.md#track-intents) |
| NPCs with wallets | Two, of different kinds. **Live on mainnet:** Gwei Stacy, the vendor. Her stock and her till are NEP-245 balances on chain, held by the contract's own account, `game.wgpnear.near`: she has no account or key of her own. **Live on mainnet since Nov 13, 2026:** Sandwich Man, a trader with a NEAR account of his own, [`sandwich.wgpnear.near`](https://nearblocks.io/address/sandwich.wgpnear.near), which holds his Bits and items and signs his trades (next row). Gwei is rule-based. Sandwich Man's moves are picked by an LLM among the moves his rules allow, or by the rules alone (next row). | Gwei: check 3 (command A) shows each pool's `stock` and `bits`. Sandwich Man: his account and transactions under [Proven on mainnet](#proven-on-mainnet), and [docs/npc-trader.md](docs/npc-trader.md). [Evidence](docs/EVIDENCE.md#track-npc-wallets) |
| Agent NPCs | Sandwich Man, the arbitrageur. **Live on mainnet since Nov 13, 2026: he trades from his own account, [`sandwich.wgpnear.near`](https://nearblocks.io/address/sandwich.wgpnear.near).** **An LLM picks his move; his rules fence it in.** Each turn his fixed rules in one file, [`apps/wgp/src/lib/market/npc-rules.ts`](apps/wgp/src/lib/market/npc-rules.ts), list every move the market would accept inside his caps (flip a cheap listing, buy a dip, undercut Gwei, cash out, clear stock when broke), plus "pass". Kimi K3 (`kimi-k3`, Moonshot's API) picks one and writes his reason in character; the server takes the pick only if it is one of those moves, and the move and its numbers stay the rules' own. With no `LLM_API_KEY` on the server, after a 20-second timeout, on an error or a cut-off answer, or once his 10 LLM calls of the day are used, the rules' first move is taken instead. Each logged move records which brain picked it (`kimi-k3` or `rules`), and `/api/market/npc` reports `brain.mode` (`llm` or `rules`) and the model; `LLM_API_KEY` is set in production (since Nov 15, 2026), so the live mode is `llm`. He uses only the market calls players use, signs them with his own key and pays his own gas. His first trade on chain was a `market_buy` of 2 Sybil goo from Gwei for 72 Bits ([`AcmNAmHr…`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf)); the market page shows each move with his reason and its transaction. He takes a turn only after real activity (a player's trade or listing, or someone opening the market, at most once every 5 minutes), one action a turn and at most 10 a day. Disclosed: he starts from a one-off seed of 300 Bits minted by the operator, is always labelled NPC, is never counted as a player (`pnpm stats` counts his calls apart from players') and his trades complete nobody's market quest. He also trades in the practice market (in a visitor's browser), the simulated market (a local checkout) and `/lab/economy`. | `curl -s https://www.wgponnear.fun/api/market/npc \| jq '{mode, accountId, bits, brain, log}'`; his transactions under [Proven on mainnet](#proven-on-mainnet); [docs/npc-trader.md](docs/npc-trader.md); `/lab/economy`, **Load a run where he goes broke** (seed 270: he closes shop three times and reopens). [Evidence](docs/EVIDENCE.md#track-agent-npc) |
| Merchant sets prices from stock and demand | A constant-product curve per item: buying raises the price, selling lowers it | [`contracts/wgp/src/market.rs`](contracts/wgp/src/market.rs). [Evidence](docs/EVIDENCE.md#track-merchant-prices) |
| Pricing rules in one readable file | [`apps/wgp/src/lib/market/math.ts`](apps/wgp/src/lib/market/math.ts) mirrors the contract's maths with the same integers and rounding; both test against the same vectors | Read the file's first 15 lines. [Evidence](docs/EVIDENCE.md#track-pricing-file) |
| A merchant's reasoning appears in a tooltip | **Why this price?** on every item in the market: Gwei explains the price from her real stock and till | `/play/market`, press **Why this price?** [Evidence](docs/EVIDENCE.md#track-reasoning-tooltip) |
| A merchant that goes broke stops trading until someone invests in it | **Stops when broke: live on mainnet.** Gwei sells only what she holds and pays only from her till, item by item. With an empty till for an item she stops buying it until a player buys from her; sold out, she stops selling it until a player sells to her. Her shop for that item shows closed, with the reason. **Invest to reopen: practice market and lab only, not on mainnet (v3 is not deployed).** The deployed contract (v2) has no way to invest in her to reopen; investing is in v3, which is not deployed. On mainnet the market says so on a closed shop and sends no investing call. v3's calls are `market_invest`, `market_withdraw` and `market_claim`; the relayer has them on its allow-list and refuses them until the live contract is v3. **Where investing runs today:** the app runs v3's investing rules in the practice market (any guest, in the browser, practice Bits, not on NEAR) and in the simulated market (a local checkout, server-side). There a player funds a broke till, the shop reopens at the same price, they earn half that item's gas fees and can withdraw, and the sheet states what they risk before they confirm. Sandwich Man closes shop under 60 Bits and reopens at 120 by selling what he holds; that is proven in tests and the lab, not yet by a mainnet transaction, and `/api/market/npc` says whether his shop is closed right now. | The rules: `contracts/wgp/src/market.rs` (`buy_cost`, `sell_payout`) and [`apps/wgp/src/lib/market/invest.ts`](apps/wgp/src/lib/market/invest.ts), tested against vectors the v3 Rust printed; her words: `apps/wgp/src/lib/market/reasoning.ts`. Practice: `/play/market` signed out, **Empty Gwei's … till**, then **Invest in Gwei**. Fast-forward: `/lab/economy`, **Drain Gwei, then invest in her**, run 30 days; **Drain Gwei** alone counts the item-days she ended sold out and unable to buy. For him, **Load a run where he goes broke**. What is live where, the maths and the risks: [docs/INVESTING.md](docs/INVESTING.md). [Evidence](docs/EVIDENCE.md#track-merchant-broke) |
| Player-owned markets | Players list items for each other; the contract holds them in escrow | `list_item` and `buy_listing` transactions (command D). [Evidence](docs/EVIDENCE.md#track-player-markets) |
| Economies that evolve without a dev patch | Prices are contract state and move with every trade. No deploy, no cron job. | Command A: prices have moved off their starting values. [Evidence](docs/EVIDENCE.md#track-no-dev-patch) |
| A fast-forward mode | `/lab/economy` runs 60 bot players for 21 days on the same pricing code | Check 7. [Evidence](docs/EVIDENCE.md#track-fast-forward) |

## For judges: 5-minute check

Every check is read-only: no sign-in, no wallet, no transaction. Commands A–E need `curl` and `jq`. F and G need git, Node ≥ 22 and pnpm 10 (`corepack enable`).

Coding agents: [AGENTS.md](AGENTS.md) lists every command with what it should print and how long it takes.

| # | Claim | Do | See | Proof |
|---|---|---|---|---|
| 1 | The game runs in a browser, no install | Open https://www.wgponnear.fun/play, or press **Play now** on the home page. A first visit puts you straight into a night as a ready-made hero, The Node; there is no form first. | A 3D night of four stops (two fights, two errands). It ends on a card saying **Banked. Get some sleep.** with an **Unranked score**. Guest nights stay in your browser and are never ranked. | [Evidence](docs/EVIDENCE.md#judge-1) |
| 2 | The contract is live and used by players | Run command D | Calls from player accounts (`register_hero`, `craft_suit`, `equip_suit`, `market_buy`, `market_sell`, `list_item`, `buy_listing`) and `mint_rewards` from `operator.wgpnear.near`. Calls from `sandwich.wgpnear.near` are the NPC trader's, not a player's. | [Evidence](docs/EVIDENCE.md#judge-2) |
| 3 | The market lives in the contract | Run command A | `{"open":true,"fee_bps":500,"pools":12,"prices_milli":[…]}`. Prices are in thousandths of a Bit. Several have moved off their starting values because players traded. | [Evidence](docs/EVIDENCE.md#judge-3) |
| 4 | Players hold their items on chain | Run command B | A player's NEP-245 tokens: `hero:…`, `item:bits`, loot such as `item:fee-bomb`, a crafted `suit:…`, and soulbound badges such as `trophy:badge:daily-podium` | [Evidence](docs/EVIDENCE.md#judge-4) |
| 5 | The game reads the market from the chain | Run command C | `{"onChain":true,"network":"mainnet","contractId":"game.wgpnear.near",…}` | [Evidence](docs/EVIDENCE.md#judge-5) |
| 6 | Ranked scores are reproducible | Run command F | One `OK` line per run, then `5/5 runs reproduced from https://www.wgponnear.fun.` | [Evidence](docs/EVIDENCE.md#judge-6) |
| 7 | A simulation fast-forwards the economy (not mainnet) | Open https://www.wgponnear.fun/lab/economy, choose **Instant** and press **Run 21 days** | **Day 21 / 21**, the counters (Bits in play, Gwei's till, Bits burned, suits crafted, trades), a price chart per item and Gwei's reasoning for each price. Bot players, not real ones; prices moving on mainnet is check 3. | [Evidence](docs/EVIDENCE.md#judge-7) |
| 8 | The simulation is deterministic | Open https://www.wgponnear.fun/lab/determinism | **✓ All 4 replays match Node**: your browser replays four recorded nights and gets the same state hashes as Node | [Evidence](docs/EVIDENCE.md#judge-8) |
| 9 | The numbers in this README are real | Run command G (30 seconds to two minutes, depending on NearBlocks rate limits), or open https://www.wgponnear.fun/stats | The live counts from the game's database, then the contract's function calls counted by method from NearBlocks, apart from its other receipts | [Evidence](docs/EVIDENCE.md#judge-9) |

```bash
# A. The contract's market (NEAR JSON-RPC, read-only)
curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"game.wgpnear.near","method_name":"market_state","args_base64":"e30="}}' \
  | jq -r '.result.result | implode' | jq -c '{open: .params.open, fee_bps: .params.fee_bps, pools: (.pools | length), prices_milli}'

# B. A player's tokens. 9a_z53.wgpnear.near is a Google player whose account the game's factory created.
#    (Not the author's account, which is sele.wgpnear.near. Any account from command D works here.)
curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"game.wgpnear.near\",\"method_name\":\"get_player\",\"args_base64\":\"$(printf '%s' '{"account_id":"9a_z53.wgpnear.near"}' | base64)\"}}" \
  | jq -r '.result.result | implode' | jq -c '{level, reward_nonce, tokens}'
# → {"level":21,"reward_nonce":45,"tokens":[["hero:9a_z53.wgpnear.near","1"],["suit:mint","1"],["item:bits","4839"],["item:fee-bomb","27"],["suit:stealth","1"],["trophy:badge:daily-podium","1"],…]}  (as of Nov 13; it changes as they play)

# C. The live game's view of the market
curl -s https://www.wgponnear.fun/api/market | jq -c '{onChain, network, contractId, till}'

# D. The contract's latest transactions (NearBlocks API)
curl -s 'https://api.nearblocks.io/v1/account/game.wgpnear.near/txns?per_page=25' \
  | jq -r '.txns[] | "\(.transaction_hash)  \(.predecessor_account_id)  \([.actions[]? | .method // .action] | join(","))"'

# E. One relayed session-key trade's events: mt_transfer, mt_burn of the fee, market_trade.
#    A market_buy by the player azalleaxyz.wgpnear.near on Nov 12. An archival NEAR RPC is used because regular nodes drop older transactions.
curl -s https://archival-rpc.mainnet.fastnear.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tx","params":{"tx_hash":"GJXrKe2oNjbTvxG2HyMt4DeTBXNPxGVRBbXsUrzv2TPJ","sender_account_id":"relayer.wgpnear.near","wait_until":"FINAL"}}' \
  | jq -r '.result.receipts_outcome[].outcome.logs[]'

# F. Replay the All-time top 5 yourself (downloads each run's seed, start save and input log)
git clone https://github.com/71Labs/WithGreatPower && cd WithGreatPower
pnpm install --frozen-lockfile
pnpm verify

# G. The live numbers, and the contract's transactions counted from NearBlocks
pnpm stats            # site only: curl -s https://www.wgponnear.fun/api/stats | jq   ·   chain only: pnpm stats --chain-only

# H. Season 1's record in the contract (NEAR JSON-RPC, read-only)
curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"game.wgpnear.near\",\"method_name\":\"get_season\",\"args_base64\":\"$(printf '%s' '{"season_id":"s1"}' | base64)\"}}" \
  | jq -r '.result.result | implode' | jq -c '{root, digest, places: (.top10 | length), first: .top10[0], recorded_at: (.recorded_at_ms / 1000 | floor | todate)}'
# → {"root":"4c05a3abda23a81157318f7abb1e7ac3fc04d67c0577b7410510a8cc07d830a4","digest":"2db948d93d702c7469e53ad1c063bff1f57e03284a779584b0dc6de3c981bdbc","places":10,"first":"azalleaxyz.wgpnear.near","recorded_at":"2026-11-15T01:26:36Z"}

# I. The published results file hashes to the digest the contract stores
curl -s https://www.wgponnear.fun/api/seasons/s1/results | shasum -a 256
# → 2db948d93d702c7469e53ad1c063bff1f57e03284a779584b0dc6de3c981bdbc  -
```

What A, C and D printed on Nov 15, 2026 (A and D move with every trade; C's `till` is Gwei's Bits across her pools):

```
A  {"open":true,"fee_bps":500,"pools":12,"prices_milli":["11180","40000","12012","15656","12974","40032","19068","52257","12000","40000","12000","124000"]}
C  {"onChain":true,"network":"mainnet","contractId":"game.wgpnear.near","till":3710}
D  <hash>  operator.wgpnear.near  mint_rewards        (most rows: reward mints for verified nights)
   <hash>  9a_z53.wgpnear.near    market_sell         (a player's own account; relayed calls show the player, not the relayer)
   <hash>  sandwich.wgpnear.near  market_buy          (the NPC trader, signed by his own key)
```

Command F printed this from a fresh clone on Nov 12. The board moves, so your five runs may differ; each line must still say `OK`:

```
OK    46ffe6cf azalleaxyz: score 15995 vs 15995, ticks 4237 vs 4237, hash 183a3432 vs 183a3432
OK    ec0e4777 9a_z53: score 12890 vs 12890, ticks 3645 vs 3645, hash ad9435eb vs ad9435eb
OK    a255f138 ambactamwkwk: score 7880 vs 7880, ticks 4795 vs 4795, hash 2636c9bd vs 2636c9bd
OK    8f9855e7 nasibabalili7: score 7590 vs 7590, ticks 3290 vs 3290, hash e4341dda vs e4341dda
OK    10864077 hossinshabani1389: score 7235 vs 7235, ticks 5608 vs 5608, hash 666c4d9f vs 666c4d9f
5/5 runs reproduced from https://www.wgponnear.fun.
```

A `SKIP` line marks a run played under an older ruleset. To replay one, check out the tag the note names (`git checkout ruleset-v3` or `ruleset-v2`, then `pnpm install --frozen-lockfile`) and pass the full run id from `GET /api/leaderboard?board=alltime`: `pnpm verify <runId>`.

### The five-minute path, in order

| Minute | Do | Expect |
|---|---|---|
| 0–1 | Open https://www.wgponnear.fun/play and swing for a minute | A 3D night starts with no form, no wallet and no popup |
| 1–2 | Run commands A, C, H and I above | A: `"fee_bps":500` and `"pools":12`. C: `"onChain":true`. H: a root, a digest and 10 places. I: the same digest H printed |
| 2–4 | `git clone https://github.com/71Labs/WithGreatPower && cd WithGreatPower && pnpm install --frozen-lockfile && pnpm verify` | `5/5 runs reproduced from https://www.wgponnear.fun.` |
| 4–5 | `pnpm evidence --chain --only judge-3,judge-4,proven-buy,proven-record-season,proven-new-market-params,track-agent-npc` | One `PASS` line per id, then `6 claims: 6 PASS, 0 FAIL, 0 SKIP.` A rate-limited endpoint prints `SKIP` with the reason, never `FAIL` |
| Later | `pnpm evidence --chain` (4–6 minutes) | Every claim: the summary line is in the [coverage block](#evidence) |

## By the numbers

**Season 1 (Nov 5–14) is a playtest season, and play in it was incentivised.** During it the team offered players daily airdrops, sent by hand through Uprail, outside the game (the game itself never pays and its copy promises no money). Read the counts below as a small, incentivised playtest, not organic demand.

Day by day, the same chain data shows who came back and how concentrated the calls are: [docs/TRACTION.md](docs/TRACTION.md) has the tables by UTC day, with retention and the relayer outage marked, and the author's accounts and Sandwich Man left out. `pnpm traction` re-runs it.

Real players, counted two ways. The first is the public chain, which anyone can recount. The second is the game's own database, served by a public endpoint: those figures can be re-read but not checked independently. The chain counts are as of Nov 13, 2026, 11:56 UTC and the game's as of Nov 13, 2026, 11:54 UTC. Both only grow; `pnpm stats` prints the current ones. The player accounts include the author's own, `sele.wgpnear.near`, and most of the activity comes from a few accounts: the first table gives the split, and `pnpm stats` derives every figure in it. The author also plays from a NEAR wallet account, `sele71.near` (9th on the All-time board on Nov 14). It has never called a game method itself, only received reward mints, so it is in the game's counts and not in the chain's player count. `pnpm evidence --chain` reads the numbers from the two tables below and fails if a live count is below one of them. [Evidence](docs/EVIDENCE.md#by-the-numbers)

Both tables are dated Nov 13, inside the build window, and kept as they were. The same count taken on Nov 15, after the deadline, is under [Calls by method](#calls-by-method-as-of-nov-15-2026).

**On NEAR mainnet** (counted from NearBlocks; re-run `pnpm stats`, 30 seconds to two minutes, depending on NearBlocks rate limits):

| | |
|---|---|
| Function calls to `game.wgpnear.near` | 242 (1 of them failed) |
| Other receipts NearBlocks lists for the contract's account (transfers, refunds, its creation; not calls) | 4 (1 of them failed) |
| Player accounts that called a game method themselves (the author's `sele.wgpnear.near` is one; Sandwich Man is not) | 18 |
| Of those accounts, the ones that made more than one call | 6, so 12 made exactly one |
| Market calls by players, and the accounts that made them | 27 calls from 4 accounts: 21 from the two busiest, 1 from the author's |
| `mint_rewards` (verified nights' loot, Bits and badges; one is Sandwich Man's seed) | 169 |
| `register_hero` | 19 |
| `craft_suit` / `equip_suit` | 16 / 7 |
| Market: `market_buy`, `market_sell`, `list_item`, `buy_listing` | 11, 5, 7, 4 |
| Of those, calls by Sandwich Man, the NPC trader (counted apart; not a player) | 1, a `market_buy` |

**In the game** (database-only figures, from [`/api/stats`](https://www.wgponnear.fun/api/stats)):

| | |
|---|---|
| Matches started / finished and verified | 270 / 240 |
| Runs rejected by the verifier | 0 |
| Free-roam City outings | 298, with 19 side tasks finished |
| Heroes: signed-in players who have started a match (`players.played`, the count the landing page shows) | 26 (24 have a verified match; 27 have signed up, `players.total`) |
| Verified play time | 6.4 hours |
| Verified matches by mode | Ranked nights 136 · Daily Run 64 · Case files 25 · Time trials 15 · Duels 0 |
| Reward mints queued / sent to the contract | 178 / 178 |
| Invites | 8 friends invited, 4 count, 1 Recruiter badge earned |

## Screenshots

| | |
|---|---|
| ![The hero swinging between rooftops at night](docs/screenshots/swing.jpg)<br>**Swing** across a comic-book city, then land and fight. | ![Doc Octochain boss fight on the bridge](docs/screenshots/boss-fight.jpg)<br>**Boss fights**: Doc Octochain holds the bridge. |
| ![Tonight, the game's hub](docs/screenshots/tonight.jpg)<br>**Tonight**: the hub for nights, cases, races, the City and invites. | ![The free-roam City](docs/screenshots/city.jpg)<br>**The City**: free roam with climbing, wall-runs, traffic and six side tasks. |
| ![Night results showing Verified and Ranked with the server's score](docs/screenshots/verified-run.jpg)<br>**Verified · Ranked**: the server replays the night before it counts. | ![Season leaderboard on the live site](docs/screenshots/leaderboard.jpg)<br>**Leaderboards**: Tonight, Season and All time. |
| ![Mempool Market with the NPC vendor's prices](docs/screenshots/market.jpg)<br>**Mempool Market**: an NPC vendor whose prices move with every trade. | ![Economy lab after 21 simulated days, with price charts](docs/screenshots/economy.jpg)<br>**Economy lab**: 21 days of bot trading on the real pricing code. |
| ![Case files](docs/screenshots/cases.jpg)<br>**Case files**: three story chapters, each with a soulbound badge. | ![Compete: the Daily Run, time trials and duels](docs/screenshots/compete.jpg)<br>**Compete**: the Daily Run, time trials and ghost duels. |
| ![Sign-in sheet with Google and NEAR wallet options](docs/screenshots/sign-in.jpg)<br>**Sign in** with Google or a NEAR wallet. | ![The hero, a MakeHuman body with motion capture](docs/screenshots/cast.jpg)<br>**Real bodies**: MakeHuman characters with motion capture. |

## The world

The city runs on "mainnet", and its villains are a market's oldest tricks given faces: Sandwich Man cuts into every queue from the front and the back, Gas Goblin spikes the fees, Doc Octochain tolls the bridges, and the Sybil votes as thousands of himself. The season's thief, the Right-Clicker, right-click-saves people into flat copies. Gwei Stacy, the vendor, counts everything in gwei. The hero's job is to keep the city's market honest. The canon is in [docs/story/bible.md](docs/story/bible.md).

## The problem

Web3 games make players fight wallets before villains: seed phrases, a popup for every action, gas prompts mid-game. Their leaderboards trust whatever score the browser sends, and their economies are a token chart with a game attached.

WGP is built the other way round:
- **The game comes first.** It's a full 3D action game you can finish a night of as a guest, with no account.
- **The chain stays out of the loop.** A player signs in once. After that a game-only key signs their game actions and our relayer pays the gas.
- **Scores are reproducible, not claimed.** The server replays each ranked night's inputs through the same deterministic simulation the browser ran, and ranks only what reproduces. Anyone can re-run that check.
- **The economy is play.** Loot comes from the villains you beat, suits need specific loot, and the vendor's prices are set by what players buy and sell. Suits are cosmetic: a suit changes how the hero looks, not how they fight.

## The game loop

The full design is in [docs/GAME-LOOP.md](docs/GAME-LOOP.md). In short:

| Every | The player | The economy |
|---|---|---|
| **Few seconds** | Swings, lands, climbs, dodges, punches, fires a power | Gold Bits tokens and boost rings on the route |
| **1 to 2 minutes** | Finishes a night of four stops; the server replays and ranks it | Loot and Bits are minted to their NEAR account in the background |
| **Session** | Plays a few nights, trades with Gwei, lists items, crafts a suit, climbs the boards | Prices move with each trade, a gas fee on each trade is burned (5% today), recipes burn loot |

A night is short, and the figure is measured, not planned: the three recorded nights in this repository that clear all four stops replay in 63, 67 and 81 seconds of game time, and on the live site verified play time divided by verified runs (all modes together) is about a minute and a half. `pnpm evidence --chain` fails if that live figure leaves the range of 45 seconds to 3 minutes.

## The economy loop

[Evidence](docs/EVIDENCE.md#the-economy-loop) for each step.

1. **Earn.** Each verified night mints loot from the villains you caught, plus Bits: `floor(score / 100) + 5`, +25 on a level-up, +1 for each gold Bits token you swing through (up to 25), and at most 1,000 a night. A hero who already holds over 150 Bits gets less, down to the 5 for showing up at 400: a taper on the payout that changes no score.
2. **Trade.** Gwei Stacy, an NPC vendor whose stock and till the contract holds, prices each item on a constant-product curve. Buying raises her price and selling lowers it. Players can also list items for each other, at 50–400% of her price.
3. **Burn.** A "gas fee" on every trade is burned: the contract's `fee_bps`, 5% today. Crafting a suit (`/play/suits`) burns the loot in its recipe, and the contract's `craft_bits` on top (250 today). The app reads both live: when the owner changes them, the market's quotes and the Suit lab's "Costs N Bits" follow without a deploy.
4. **Nobody sets prices.** A price is wherever supply and demand leave the curve. Gwei explains each one (**Why this price?**), sells only what she holds and pays only from her till.

**Gwei's wanted list: the market decides what you hunt.** Each UTC day Gwei posts up to three items she is short on: sold out, down to 75% of her opening stock, or priced at least 25% above where she opened. The first request of the day works the list out from her pools and stores it with the snapshot it came from, so the day's list doesn't change. A verified night that brings in a wanted item gets a multiplier on that item's drop (×2, or ×3 when she is sold out), capped per night and per player per day by rarity; the score, the replay and the Bits are unchanged. Tonight (`/play`) shows the list and the night's results show the bonus; selling her the extra refills her stock and brings the price back down. The rules are in [`apps/wgp/src/lib/market/wanted.ts`](apps/wgp/src/lib/market/wanted.ts).

The curve, in [`apps/wgp/src/lib/market/math.ts`](apps/wgp/src/lib/market/math.ts) and [`contracts/wgp/src/market.rs`](contracts/wgp/src/market.rs):

```
x = virtual_items + stock        y = virtual_bits + bits        spot price = y / x Bits
buy n:   ceil(y·n / (x − n))     only from her stock
sell n:  floor(y·n / (x + n))    only from her till
fee:     ceil(bits · 500 / 10000), burned
```

A round trip never profits, because a buy rounds up and a sell rounds down.

## The economy in depth

The currency is `item:bits`. Loot, suits, heroes, badges and trophies are other token ids in the same contract (listed under [The contract's tokens](#the-contracts-tokens-nep-245)). Every Bit on chain was minted by one of three calls, and leaves only by being burned in one of two. [docs/ECONOMY.md](docs/ECONOMY.md) is the full balance report; this section is the map.

| Flow | On chain | Size today | Live since |
|---|---|---|---|
| **Faucet:** a verified night's Bits | `mint_rewards` from `operator.wgpnear.near`, one entry per verified night | `floor(score / 100) + 5`, bonuses, at most 1,000 a night, tapered by the Bits the hero holds | Flat since launch; taper since Nov 15 |
| **Seed:** Gwei's tills | `set_market_params` mints each new pool's `seed_bits` and `seed_stock` to `game.wgpnear.near` once | 6,240 Bits for the eight launch pools (Nov 3); 780 Bits and 28 items for the four new ones (Nov 15) | Nov 3, Nov 15 |
| **Seed:** Sandwich Man | One `mint_rewards` of 300 Bits, digest `sha256("npc-seed:sandwich.wgpnear.near:v1")` | 300 Bits, once | Nov 13 |
| **Sink:** the gas fee | `mt_burn` inside `market_buy`, `market_sell` and `buy_listing` | `fee_bps` 500: 5% of each trade's or fill's Bits, rounded up | 2% from Nov 3; 5% since Nov 15 |
| **Sink:** crafting | `craft_suit` burns the recipe's items and `craft_bits` Bits | 250 Bits per recipe suit; each hero crafts each recipe suit once | Free from Nov 3; 250 since Nov 15 |
| **Neither:** Gwei Stacy | Her stock and till are the contract account's own balances | Trading with her moves Bits between her till and players; it creates none | Nov 3 |

### The faucet and its taper

A verified night's Bits are `floor(score / 100) + 5`, +25 on a level-up and +1 per gold Bits token collected (up to 25), capped at 1,000. Since Nov 15 the server pays that through `nightPay` in [`apps/wgp/src/lib/market/rewards.ts`](apps/wgp/src/lib/market/rewards.ts), which reads the hero's Bits at submit time (the contract's `bits_of`, plus reward mints that haven't landed yet):

| Bits the hero holds | What the night pays | Example: a 100-Bit night |
|---|---|---|
| Up to 150 | All of it | 100 |
| Between 150 and 400 | 5, plus the rest of the night scaled down in a straight line | 52 at 275 held |
| 400 or more | The 5 for showing up | 5 |

The taper reads only the verified result and the balance, so no score, replay, board or ruleset changes, and the verifier never sees it. When the balance can't be read (RPC down, no answer in 2.5 seconds) the whole night is paid. The results screen says when a night was tapered, from what and why. What it doesn't stop: a player who spreads Bits over several accounts, each of which still needs its own verified nights under the 20-a-day cap.

### The sinks

- **The gas fee.** `fee_bps` is contract state, set by the owner with `set_market_params`; the contract caps it at 10%. The owner raised it from 200 (2%) to 500 (5%) on Nov 15 ([`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK)). A buy pays `ceil(bits · 500 / 10000)` on top; a sell or a listing fill has it taken off. Each trade logs an `mt_burn` of `item:bits` with the memo `gas-fee` and a `market_trade` or `market_fill` event (command E prints one).
- **Crafting.** `craft_suit` checks the hero's level, burns each item in the recipe and, since the same Nov 15 call, 250 Bits. There are six recipe suits: Stealth, Glider, Octo rig and Sesame from launch, and Notary and Finality from Nov 15. Starter suits stay free. A hero crafts each recipe suit once, so crafting can burn at most 1,500 Bits per hero, ever.
- **What the app does with both.** It reads `fee_bps` and `craft_bits` from `market_state` on every quote and in the Suit lab, so the owner's call changed prices and costs without a deploy. A player short of 250 Bits sees the reason and is told how to earn them; the relayer refuses a `craft_suit` the player can't pay before spending gas.

### What the lab measured, and what it doesn't prove

`/lab/economy` runs 60 bot heroes for 21 days through the same market code, tested against the contract's vectors, on one seed (2026) with Sandwich Man trading. [docs/ECONOMY.md](docs/ECONOMY.md) has the means over 8 seeds and over 60 and 180 days.

| Settings | Bits earned | Bits burned | Burned ÷ earned |
|---|---|---|---|
| Old: 2% fee, free crafting, no taper (mainnet from Nov 3 to Nov 15) | 99,022 | 2,847 | about 3% |
| Now: 5% fee, 250 Bits a suit, the taper (mainnet since Nov 15) | 58,859 | 26,454 | about 45% |

What these numbers are not:

- **Not players.** The bots follow fixed rules: one night a day, a fixed mix of crafters, dumpers, flippers and hoarders, and they don't trade less when the fee rises. The model crafts 1.5 suits per hero; mainnet's players had crafted 0.33 each when it was measured. If that holds, the real burn share will be well under 45%.
- **Not parity.** More than half of a season's Bits still stay in the supply, and a hero who has crafted every suit burns nothing more by crafting. A lasting sink needs more recipes or a recurring cost the deployed contract doesn't have.
- **Not the new stock.** The lab's default run has no new-stock pools, so its bots craft only the four launch recipe suits; Notary and Finality are not in these numbers.
- **Not mainnet history.** Nothing in the lab is on chain. Mainnet's own supply is readable: the sum of `mt_supply("item:bits")` is the seeded tills plus everything minted less everything burned.

### Gwei's wanted list and her new stock

Gwei's wanted list (above, under [The economy loop](#the-economy-loop)) turns her shortages into what a night is worth hunting: `GET /api/market/wanted` returns the day's list, frozen with the snapshot it was worked out from. On Nov 15 it held one item, the press pass, flagged `low-stock` (15 left of 20) with a ×2 drop multiplier.

Her new stock, opened on Nov 15, is four items that never drop on patrol, because Season 1's ruleset is frozen. The server awards them from verified results and mints them through the same `mint_rewards` path:

| Item | Rarity | Earned by | Burned by |
|---|---|---|---|
| Gas receipt | common | Any verified Daily Run, once a UTC day | Notary (with 3 evidence bags), level 2 |
| Finality flag | uncommon | A verified Daily Run with no fight lost, once a UTC day | Finality (with 1 torn seed phrase), level 3 |
| Evidence bag | common | A verified case clear, once a UTC day | Notary |
| Torn seed phrase | rare | A top-three finish on a settled Daily, once per day placed | Finality |

The owner registered the four items and two suits with `set_rules` ([`GzMYer3o…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY)) and opened their pools in the same `set_market_params` that set the fee ([`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK)), which minted 10 gas receipts, 6 finality flags, 10 evidence bags, 2 torn seed phrases and 780 Bits to Gwei. The calls' arguments are in [`docs/economy/new-stock-calls.json`](docs/economy/new-stock-calls.json); the rules are in [`apps/wgp/src/lib/market/new-stock.ts`](apps/wgp/src/lib/market/new-stock.ts).

### Sandwich Man, the trader with a brain

Each turn, his rules ([`apps/wgp/src/lib/market/npc-rules.ts`](apps/wgp/src/lib/market/npc-rules.ts)) list every move the market would accept within his caps, best first: take down a stale listing, flip a cheap player listing, cash out to Gwei above cost, undercut Gwei, buy a dip, or sell stock while broke. An LLM picks one of those moves or passes; the server keeps the pick only if it is one of the listed moves, so the move, its amounts and its price limit are always the rules' own. Which model, and when he takes a turn, are in the Agent NPCs row of [How it meets the track](#how-it-meets-the-track). His money caps: 10 actions a UTC day, at most 35% of the day's opening Bits spent, at most 150% of an item's opening price paid, closed under 60 Bits and reopened at 120. `/api/market/npc` shows his wallet, his log of moves with their transactions and which brain picked each. [docs/npc-trader.md](docs/npc-trader.md) has every rule, the risks and how each is bounded.

### Player listings

`list_item` moves the items from the seller's balance into the contract's escrow and records a price, which must sit within 50–400% of Gwei's spot price for that item. `buy_listing` sends the Bits, less the burned fee, from the buyer to the seller and the items from escrow to the buyer; `cancel_listing` returns them. A seller can't buy their own listing. Each account has at most 3 open listings, 10 new listings and 10 fills worth 3,000 Bits a UTC day; the contract holds at most 300 open listings in all. Listings are views anyone can page through: `market_listings` and `market_listing`.

### Investing in a broke vendor: v3 only, not deployed

The track asks for a merchant that stops when broke until someone invests. The stopping is live on mainnet; the investing is not. It is contract v3 (`market_invest`, `market_withdraw`, `market_claim`), built on the branch `review/contract-v3` and reviewed by a second AI agent that did not write it; not an audit. Today its rules run only in the signed-out practice market (in the browser, practice Bits) and in `/lab/economy`. [docs/INVESTING.md](docs/INVESTING.md) has the maths and the risks; [docs/CONTRACT-V3-REVIEW.md](docs/CONTRACT-V3-REVIEW.md) the review.

### What it costs to run (`pnpm costs`)

Measured from mainnet history on Nov 14, 2026 at 21:40 UTC ([docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md#measured-costs-re-run-pnpm-costs)), with NEAR at $2.94:

| | |
|---|---|
| Gas per relayed player action | median 0.000341 NEAR (about $0.001), 70 actions, none failed |
| Gas per `mint_rewards` batch | median 0.000347 NEAR; 195 batches carrying 205 rewards |
| A new player account | 0.00714 NEAR of gas, no deposit (it fits NEAR's zero-balance allowance) |
| Cost per player so far | 0.0119 NEAR (about $0.035): 60% of it the account |
| Runway at the 7-day average | relayer about 240 days, operator about 92 days; the factory can create 55 more accounts |
| What a $2 Gas tank refill buys | about 1,892 relayed actions, after 1Click's 0.2% fee |

Caveats, from the same page: these are 11 days of a small, incentivised playtest, not a forecast; the window includes the 37-hour relayer outage, so the 7-day averages understate demand; hosting and sign-in are paid off chain and not counted; and the game has no revenue.

### Who plays it (`pnpm traction`)

[docs/TRACTION.md](docs/TRACTION.md) counts player calls by UTC day from the public chain, with the author's accounts, Sandwich Man and the team's accounts left out. As of Nov 14, 2026, 21:34 UTC: 17 player accounts had sent a call; 13 of them on one day only; 4 came back on a later day and made 53 of the 67 player calls; the busiest account made 22 of them and the busiest three made 50. Three accounts made all of the players' market calls. Every day counted falls inside Season 1's airdrop window, so none of it shows demand without incentives, and an account is not a person.

## Ways to play

Every mode's runs are replayed by the server. The right-hand column is what each puts on NEAR. In a fresh browser, start at https://www.wgponnear.fun/play: it makes you a guest hero first. The paths in brackets open a mode once you have one (after step 1 of [Try it](#try-it-do-x-see-y), in the same browser). [Evidence](docs/EVIDENCE.md#ways-to-play)

| Mode | What it is | On NEAR |
|---|---|---|
| **Ranked nights** (`/play/patrol`) | Patrol the city: two villain fights and two errands | `item:bits` and loot for each verified night |
| **Daily Run** (`/play/compete`) | The same city for everyone, new each UTC day, 3 tries | `trophy:badge:daily-podium` for the day's top 3, `daily-winner` for first |
| **Time trials** | Five courses with medal times | Nothing: verified boards only |
| **Duels** | Race the ghost of any player's verified run. Built and tested; no player has a verified duel yet. The count of verified duels is `runs.byMode.duel` in `/api/stats`; it was 0 on Nov 13. It was still 0 on Nov 15. | Nothing: ghosts are real replays |
| **Case files** (`/play/cases`) | Three story chapters: Missing: Mary Jpeg, The Sybil Vote, Fee Strike | `trophy:badge:case-00N` on your first verified clear |
| **The City** (`/play/city`) | Free roam: run, sprint, climb, wall-run, swing, dodge traffic, six side tasks | Nothing: XP, saved with your hero |
| **Invite 3 friends** (`/play/invite`) | Friends who add their X and play a verified night count | `trophy:badge:recruiter` |
| **Season 1** (Nov 5–14) | Nightly bests add up on the Season board | At the close: the final board's root and digest, recorded once, and `trophy:s1:1…10` for the top 10. Season 1 ended Nov 15, 00:00 UTC (the end of Nov 14); the record landed at 01:26 UTC and is `get_season("s1")` on the contract, and the results file is `/api/seasons/s1/results` (commands H and I). |

Design docs: [chapters](docs/chapters/) · [the story bible](docs/story/bible.md) · [competitive modes](docs/compete.md) · [referrals](docs/referrals.md).

## Try it: do X, see Y

All steps work on the live site, with no install.

1. **Play a night as a guest.**
   - **Do:** open https://www.wgponnear.fun and press **Play now**, or open https://www.wgponnear.fun/play. A first visit goes straight into a night with a ready-made hero, The Node, in the Classic suit with three starter powers; there is no form first. For every night after that, press **Swing out** on Tonight (`/play`). **Make it yours**, also on Tonight, renames the hero and picks a starter suit. A signed-in player with no hero yet chooses a name, a suit and three powers first (`/play/bitten`, **Get bitten**).
   - **Controls:**
     - WASD or the arrow keys run relative to the camera. Let go and the hero stops.
     - Space or the mouse shoots a web toward where you're steering. Hold it to swing and chain webs; let go to fly.
     - 1–4 fire powers, G calls Gwei, M opens the city map, and Esc or P pauses (How to play is in the pause menu). Click into the game for mouse look.
     - On touch: the left stick steers, a finger anywhere else looks around, and the right side webs.
   - **See:** a 3D night of four stops. Gold Bits tokens and boost rings line each route. The night ends on **Banked. Get some sleep.**, with an **Unranked score**, stop-by-stop results and your loot.
   - **Classic mode:** the **Classic mode** link under **Swing out** opens `/play/classic`, which plays the same night turn by turn: the same four stops, from the same seed. It's unranked.
2. **Sign in with Google or a NEAR wallet.**
   - **Do:** open the **Sign in** chip at the top of any game screen, then choose one:
     - **Continue with Google:** Privy logs you in with Google and gives you a NEAR key, with no seed phrase or extension. A new player picks a name, and the game's factory account `wgpnear.near` creates `<name>.wgpnear.near` holding that key plus a game-only session key.
     - **Use a NEAR wallet:** pick a wallet and sign one message (NEP-413). It's not a transaction and costs no gas.
   - **See:** the chip shows your handle. Your save now lives on the server.
3. **Play a ranked night.**
   - **Do:** finish a night while signed in.
   - **See:**
     - the results show **Verified** and **Ranked**, **Score, from the server**, your rank on Tonight's board and **You earned N Bits**;
     - the night's loot and Bits are minted to your NEAR account in the background, with nothing for you to sign. They show up in `get_player` (command B) and on NearBlocks as `mint_rewards` from `operator.wgpnear.near`;
     - https://www.wgponnear.fun/play/leaderboard lists you on the Tonight, Season and All-time boards.
4. **Verify any ranked run yourself.**
   ```bash
   pnpm install --frozen-lockfile
   pnpm verify                    # the All-time top 5
   pnpm verify <runId>            # one run: the full id from GET /api/leaderboard
   pnpm verify --board tonight    # Tonight's board (also --top N, --base <url>)
   ```
   - **See:** `OK <run> <player>: score … vs …, ticks … vs …, hash … vs …` for each run and `N/N runs reproduced`. The script downloads the run's seed, start save and input log from `GET /api/runs/<id>/replay` and replays it locally with `@wgp/game-core`. It exits non-zero if any run doesn't reproduce.
5. **Trade in the Mempool Market.**
   - **Do:** open https://www.wgponnear.fun/play/market.
   - **See, signed out (a guest): the practice market.** It runs in your browser and is not on NEAR.
     - a gold banner, **Practice market: not on NEAR. Sign in to trade for real.**, **Your practice Bits** (300 to start), prices that started from the live market's, and a link, **See the real market on NEAR mainnet: game.wgpnear.near**;
     - on every item, **Why this price?** (Gwei's reasoning, from the practice copy of her stock and till), **Buy**, **Sell** and **Invest in Gwei**. All four work for a guest, with practice Bits;
     - **Empty Gwei's … till** stages a broke shop. **Invest in Gwei** reopens it, and **Withdraw or claim** takes the stake out again 30 seconds later;
     - nothing here is a transaction, changes your saved hero or can be minted.
   - **See, signed in: the real market.**
     - **On NEAR mainnet · game.wgpnear.near**, Gwei's till, and each item's price, 24-hour change, stock and how many you hold;
     - **Why this price?** on any item: Gwei's reasoning from her real stock and till;
     - **Buy** and **Sell** move the price along the curve, and you can list items for other players. There is no investing here until contract v3;
     - each trade is a `market_buy`, `market_sell`, `list_item` or `buy_listing` call from your own account. It's signed by your session key, sent by `relayer.wgpnear.near` as a NEP-366 meta-transaction, and attaches no deposit. Google players get the session key at sign-up; wallet players press **Enable quick play** once.
   - **Is it on chain?** `GET /api/market` says `onChain: true` when the contract's market is live, as it is in production. Without NEAR settings (a local checkout), the same engine runs in simulation and says `onChain: false`.
6. **Watch the economy move.**
   - **Do:** open https://www.wgponnear.fun/lab/economy, choose a speed (1×, 4×, 16× or Instant) and press **Run 21 days**.
   - **See:** 60 bot players patrol, buy, sell, list and craft for 21 days on the same pricing code, with mainnet's settings (5% gas fee, crafting burns 250 Bits, nights tapered by the Bits a hero holds) and the contract's rule that a hero crafts each suit once. The page shows Bits earned against Bits burned, each item's price and Gwei's stock by day, her reasoning, and the Bits in play, burned and crafted. The same seed always gives the same run.
   - **The inflation, and the fix:** the default run earns 58,859 Bits and burns 26,454 of them, about 45%. Tick **Run the old settings** (2% gas fee, crafting burns no Bits, no taper) and run again: 99,022 earned and 2,847 burned, about 3%. [docs/ECONOMY.md](docs/ECONOMY.md) has the measurements, the owner's command and what stays unfixed.
   - **Gwei's limits:** press **Drain Gwei** and run 30 days. A crowd of hoarders and dumpers leaves her sold out of rares and unable to buy the rest, and the page counts the item-days.
7. **Roam the City.**
   - **Do:** after step 1, in the same browser, open the **City** tab or https://www.wgponnear.fun/play/city (it needs a hero). Shift sprints, F webs while held, Q zips, E talks or interacts, M opens the map.
   - **See:** a free-roam city where walls are climbable, barriers and cars are solid (a car at speed knocks you down), and six people have tasks, such as racing Sandwich Man over the roofs with Gwei's order, or unplugging Doc Octochain's relays from the city's highest points.
8. **Open a case file, race the Daily, invite a friend.**
   - **Do:** after step 1, in the same browser: `/play/cases`, `/play/compete`, `/play/invite`.
   - **See:** three story chapters with their own rules and bosses; today's Daily Run with other players' ghosts; your invite link and its 0/3 progress (signed in).
9. **Check it on NEAR.**
   - **Do:** open https://nearblocks.io/address/game.wgpnear.near.
   - **See:** the contract's NEP-245 `mt_mint`, `mt_transfer` and `mt_burn` events, and calls from player accounts.
10. **Look into the gas tank (read-only).**
   - **Do:** open https://www.wgponnear.fun/gas, pick a token, type an amount and your own address on that chain as the refund address (1Click refuses burn addresses). Stop before **Get deposit address**.
   - **See:** the relayer's available NEAR against its cut-off, and a live dry quote from NEAR Intents: "≈ X NEAR reaches the gas tank". A dry quote moves no funds.

## What NEAR does here

[Evidence](docs/EVIDENCE.md#what-near-does-here) for each row of the table below.

```mermaid
flowchart LR
  subgraph Browser
    G[3D game<br/>React Three Fiber]
    S[game-core sim<br/>records inputs]
    K[Session key<br/>function-call only]
  end
  subgraph Server["Server (Next.js on Vercel)"]
    V[Replay verifier]
    O[Reward outbox]
    R[Relayer checks]
  end
  subgraph NEAR["NEAR mainnet"]
    C[game.wgpnear.near<br/>NEP-245 tokens]
    M[Mempool Market<br/>price curves]
    T[Seasons<br/>root + trophies]
    W[relayer.wgpnear.near<br/>the gas tank]
  end
  subgraph Chains["Other chains"]
    X[USDC · ETH · SOL · BTC<br/>Ethereum, Base, Arbitrum,<br/>Solana, Bitcoin]
  end
  S -- input log --> V
  V -- verified run --> O
  O -- mint_rewards<br/>operator key --> C
  K -- NEP-366 delegate --> R
  R -- relayed call<br/>relayer pays gas --> M
  V -- season close --> T
  X -- NEAR Intents 1Click<br/>swapped to NEAR --> W
  W -. pays the gas .-> R
```

| Piece | How |
|---|---|
| **Player accounts** | A wallet player is their own NEAR account. A Google player gets a NEAR key from Privy's embedded wallet, and the game's factory account (`wgpnear.near`) creates `<name>.wgpnear.near` holding that key and a function-call session key for `game.wgpnear.near` only. |
| **Items, suits, trophies and Bits** | NEP-245 multi-tokens in one contract, `game.wgpnear.near` (`contracts/wgp`): the standard's core transfers, balance views, `mt_tokens_for_owner` and events. The deployed v2 has no metadata extension, no `mt_tokens` enumeration and no approvals; v3 adds the first two and is not deployed. Heroes and trophies are soulbound. Transfers need 1 yoctoNEAR and a function-call key can't attach a deposit, so a game key can't transfer a token out of a player's account. It can still trade with it, within the market's caps (see the Mempool Market row). |
| **Rewards** | Each verified night queues a reward mint in the same database transaction. The operator account sends `mint_rewards` in batches of up to 20, each with a per-account nonce, so a retry never mints twice. Mints are sent in the background of player requests, and nothing is scheduled: `vercel.json` has no `crons` entry and no workflow runs on a schedule. Three bearer-protected routes, `/api/cron/mint`, `/api/cron/sweep` and `/api/cron/market-snapshot`, are manual fallbacks for the owner; in this repository only the local sandbox end-to-end script calls one. |
| **The Mempool Market** | An in-contract NPC vendor with a curve per item, player listings held in escrow, and a 5% fee that's burned. **What a stolen game key could do.** It is a function-call key for `game.wgpnear.near` only, and it can't attach a deposit. So it can call the game's deposit-free methods as the player: buy from and sell to Gwei, list the player's items, buy and cancel listings, craft and equip. It can't transfer a token, call an owner or operator method, or call any other contract. A thief therefore can't send a player's tokens to themselves, but could trade them badly, for example list an item at the lowest allowed price for an accomplice to buy. The contract's guards bound that: listing prices within 50–400% of the vendor's, at most 20 items a call, 3 open listings, and per day 40 vendor trades, 10 listings and 10 fills worth 3,000 Bits. The relayer carries a key's calls only for the signed-in player it belongs to, while the server holds that key as live. Used directly instead, the key pays gas from the account's own NEAR, up to a 0.05 NEAR allowance, and a factory-made account starts with none. |
| **No popups in play** | After sign-in, players hold a game-only function-call key. Our relayer submits their signed actions as NEP-366 meta-transactions and pays the gas. `/api/relay/meta` accepts exactly one function call to an allowlisted method, with zero deposit, at most 30 Tgas and within budgets. |
| **Sign-in** | NEAR wallets go through near-connect with a NEP-413 signed message. Google goes through Privy: the server verifies Privy's access token and reads the player's verified email and NEAR key from Privy's API. |
| **Seasons** | The first player request after a season's end, plus 50 minutes for runs in flight, closes it once. The final standings are frozen with their Merkle root, and `record_season` (root, results digest, top 10) is queued. The contract stores it for good and mints a soulbound `trophy:<season>:<rank>` to each of the top 10. The results file, with every leaf's proof, is at `/api/seasons/<id>/results`. |
| **Gas tank (NEAR Intents)** | `/gas` asks NEAR Intents' 1Click API for a quote that turns a deposit on Ethereum, Base, Arbitrum, Solana or Bitcoin into NEAR delivered to `relayer.wgpnear.near`, the account that pays players' gas. The server sets the recipient: a recipient sent by the browser is ignored, and a quote that names anyone else is refused. It takes only 9 listed tokens worth $1–$50, quotes dry until the giver asks for a deposit address, rate-limits deposit addresses per IP, and polls 1Click for the status. 1Click takes a 0.2% fee. Deliveries arrive as wNEAR on `wrap.near`, where the relayer is registered; the owner unwraps them into its balance with one call ([docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md)). Code: `apps/wgp/src/server/intents/one-click.ts`. |
| **Safe upgrades** | near-sdk's `Promise` links host functions mainnet doesn't have yet, which failed our first deploy. `upgrade` uses low-level `env::promise_*` calls, and `scripts/near/check-wasm-imports.mjs` refuses a wasm that imports them. |

## The NEAR integration in depth

Everything below is in one contract, [`contracts/wgp`](contracts/wgp), deployed to `game.wgpnear.near` on Nov 3, 2026 at 17:10 UTC ([`8nyXGMNu…`](https://nearblocks.io/txns/8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR)), an hour after a first attempt failed ([`3h6JxxeZ…`](https://nearblocks.io/txns/3h6JxxeZofE6rqZEx5WV8XjqLJWnGZeKjcuX6j7GFLJd), the host-function problem under [Safe upgrades](#safe-upgrades)). No `upgrade` has been called since, and no file under `contracts/` changed after the deadline. Five accounts take part, each with one job:

| Account | Job | Keys |
|---|---|---|
| `game.wgpnear.near` | The contract: tokens, market, seasons. Also Gwei's wallet: her stock and till are its own balances | 1 full-access key, on the owner's machine (see [Limits](#limits-and-whats-next)) |
| `wgpnear.near` | The contract's owner (settings, rules, upgrades) and the factory that creates `<name>.wgpnear.near` | 1 full-access key, in the production server's environment |
| `operator.wgpnear.near` | The only operator: sends `mint_rewards` and `record_season` | In the server's environment |
| `relayer.wgpnear.near` | Pays the gas of players' meta-transactions; the Gas tank refills it | In the server's environment |
| `sandwich.wgpnear.near` | Sandwich Man, an ordinary account that trades | His own key, in the server's environment; its permission is under [Limits](#limits-and-whats-next) |

[docs/KEYS.md](docs/KEYS.md) lists the public keys, who holds each and the owner's commands to move to cold storage.

### The contract's tokens (NEP-245)

One contract holds every token kind. The deployed v2 implements NEP-245's core: `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call` and `mt_batch_transfer_call` (with `mt_resolve_transfer`), the views `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`, `mt_token` and `mt_tokens_for_owner`, and the standard's `mt_mint`, `mt_transfer` and `mt_burn` events. It has no metadata extension, no `mt_tokens` enumeration and no approvals (`approval` must be null).

| Token id | What it is | Minted by | Can it move? |
|---|---|---|---|
| `hero:<account>` | The player's hero, one per account | `register_hero` | No: soulbound |
| `suit:<id>` | A suit the hero owns: 4 starters, 6 recipe suits | `register_hero` (the starter picked), `craft_suit` | Yes, except the suit being worn |
| `item:bits` | Bits, the market's currency | `mint_rewards`; `set_market_params` for Gwei's till | Yes |
| `item:<id>` | Loot: 12 kinds, 8 from patrol and 4 from the Daily Run and cases | `mint_rewards`; `set_market_params` for Gwei's stock | Yes |
| `trophy:badge:<id>` | One-off badges: Daily podium and winner, case clears, Recruiter | `mint_rewards` | No: soulbound |
| `trophy:<season>:<rank>` | A season's top 10 | `record_season` | No: soulbound |

A transfer needs exactly 1 yoctoNEAR attached, which a function-call key can't attach, so only the player's full-access key moves their tokens. Besides the standard's events, the contract logs its own (`standard: "wgp"`): `register_hero`, `craft_suit`, `equip_suit`, `reward` (with each run's digest), `season`, `market_trade`, `market_list`, `market_fill` and `market_cancel`. Game views: `get_player` (hero, level, reward nonce, every token held; command B), `get_config`, `reward_nonce`, `get_season`, `is_operator`.

### The market inside the contract

[`contracts/wgp/src/market.rs`](contracts/wgp/src/market.rs) is a constant-product pool per item, with Gwei's stock and till as the real reserves and a virtual depth on each side so a pool never prices at zero or infinity:

```
x = virtual_items + stock        y = virtual_bits + bits        spot = y / x
buy n:   cost = ceil(y·n / (x − n)) + fee        refused if n > stock
sell n:  pay  = floor(y·n / (x + n)) − fee       refused if pay > bits (her till)
```

| Piece | What it does | Bound |
|---|---|---|
| Pools | One per item, `virtual_bits`/`virtual_items` 480/40 (common, 12 Bits to start), 800/20 (uncommon, 40) or 1200/8 (rare, 150) | At most 32 pools; 12 today |
| `market_buy`, `market_sell` | Trade with Gwei. Each takes a slippage bound (`max_bits`, `min_bits`) that the contract enforces | 20 items a call; 40 vendor trades per account a UTC day |
| The fee | `fee_bps` of every trade's and fill's Bits is burned (`mt_burn`, memo `gas-fee`) | At most 1000 (10%); 500 today |
| `list_item`, `buy_listing`, `cancel_listing` | Player-to-player sales; the items wait in the contract's escrow | Price within 50–400% of Gwei's spot; 3 open and 10 new listings, 10 fills worth 3,000 Bits per account a day; 300 open in all |
| Stops when broke | Gwei sells only what she holds and pays only from her till, item by item, so a sold-out or broke pool refuses that side until a player trades the other way | Live on mainnet; reopening by investing is v3, not deployed |
| Settings | `set_market_params` (owner, 1 yoctoNEAR): the parameters above, new pools and their one-time seed | A pool's seed is minted only when the pool is new. For a pool that exists, the call can change its virtual reserves, and so its price: the owner can reprice an item. The Nov 15 call passed the reserves already on chain, so no price moved |
| Views | `market_state` (command A), `market_quote`, `market_listings`, `market_listing`, `market_account`, `bits_of` | |

The app's [`apps/wgp/src/lib/market/math.ts`](apps/wgp/src/lib/market/math.ts) repeats this maths with the same integers and rounding, and both are tested against the same vectors, so the price the market shows is the price the contract charges.

### Player accounts and session keys

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant P as Privy (Google)
  participant S as Server
  participant F as wgpnear.near (factory)
  participant N as NEAR mainnet
  B->>P: Continue with Google
  P-->>B: access token, embedded NEAR key
  B->>B: makes a session key (stays in this browser)
  B->>S: sign-up: handle, access token, session public key
  S->>P: verify the token, read the player's email and NEAR key
  S->>F: create <name>.wgpnear.near
  F->>N: one transaction: create account, the Privy key (full access), the session key (function call, game.wgpnear.near only, 0.05 NEAR allowance)
  N-->>S: account created
  S-->>B: signed in; quick play on
```

- **Google players** get an account in one factory transaction ([`DFF1SsPj…`](https://nearblocks.io/txns/DFF1SsPjKPto6Kxa3TfpdX2pSMNC9GftnbJuz9PRWcV8) is one). The account starts with no NEAR: with two keys and no contract it fits NEAR's zero-balance allowance, and the relayer pays its gas from then on. The full-access key is the player's (Privy's embedded wallet), not the server's.
- **Wallet players** (near-connect, NEP-413 signed message to sign in) keep their own account. **Enable quick play** asks their wallet once to add the same kind of session key.
- **The session key** may call any method on `game.wgpnear.near` and nothing else, and can't attach a deposit. The server records which public key belongs to which signed-in player, and the relayer refuses a key it doesn't hold as live for that player.

### Gasless calls: NEP-366 meta-transactions through the relayer

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (session key)
  participant R as /api/relay/meta
  participant L as relayer.wgpnear.near
  participant C as game.wgpnear.near
  B->>B: build a DelegateAction: one FunctionCall, 0 deposit, ≤ 30 Tgas
  B->>R: the signed delegate
  R->>R: checks: signature, key is live for this player, sender is the player, receiver is the game contract, method on the allow-list, deposit 0, gas ≤ 30 Tgas, not expired, rate limits, daily budgets, relayer above its cut-off
  R->>L: wrap it in a transaction the relayer signs and pays for
  L->>C: the player's call runs as the player
  C-->>R: outcome and events
  R-->>B: txHash, result
```

- **What it accepts.** Exactly one function call to `game.wgpnear.near`, to one of `register_hero`, `craft_suit`, `equip_suit`, `market_buy`, `market_sell`, `list_item`, `buy_listing` or `cancel_listing`, with zero deposit and at most 30 Tgas. v3's `market_invest`, `market_withdraw` and `market_claim` are on the list and refused until the live contract is v3. Everything else is refused before any gas is spent.
- **Budgets.** Per account 30 relayed calls a minute and 400 a UTC day, per IP 60 a minute, and a global gas budget per UTC day (`RELAYER_DAILY_TGAS`, 200,000 Tgas by default) kept in Postgres so several server instances can't overshoot it. A call over a player's cap gives its gas reservation straight back, so retries can't drain the shared budget.
- **The circuit breaker.** When the relayer's available balance is under `RELAYER_MIN_BALANCE_NEAR` (1 NEAR), the relay answers 503 and the game points players at `/gas`. The balance is read at most once a minute.
- **The outage it caused.** On Nov 13 at 07:00 UTC the team moved 1 NEAR from the relayer to the contract's storage balance ([`FH2tpfkz…`](https://nearblocks.io/txns/FH2tpfkzDkY8MtEX6fWCmMc7E7RRndGA8nibM1ZYEjuB)), which left the relayer under its own cut-off. For about 37 hours every relayed action was refused: no hero registrations, crafts, equips or trades by players. Reward mints kept landing, because the operator pays for those. It ended on Nov 14 at 20:21 UTC, when the owner sent 0.5 NEAR from `game.wgpnear.near` to the relayer ([`GU8GVkK3…`](https://nearblocks.io/txns/GU8GVkK3a2mDkypzEz1cAVnHihVQLKQBUJKQ9oeyYs2d)) and registered the relayer on `wrap.near` for Gas tank deliveries ([`DWFUoozv…`](https://nearblocks.io/txns/DWFUoozvVD7ZLDwxCvrQusKd13mXFVSR9g5qCrx4gvAr)). Both were signed with the contract account's full-access key.
- **Sandwich Man is not relayed.** He signs with his own key and pays his own gas, about 0.0003 NEAR a call.

### The reward outbox: verified run to `mint_rewards`

```mermaid
flowchart LR
  A[Browser: input log] -->|POST /api/runs/id/submit| V[Replay verifier<br/>same game-core sim]
  V -->|hash matches| T[(One DB transaction:<br/>run saved + reward queued<br/>nonce = last + 1)]
  T --> W[Mint worker<br/>after a player request]
  W -->|mint_rewards, up to 20 entries<br/>signed by operator.wgpnear.near| C[game.wgpnear.near]
  C -->|per entry: Applied, Duplicate,<br/>OutOfOrder or Full| W
  C -.->|mt_mint + reward event<br/>with the run's digest| E[NearBlocks]
```

- **Idempotent by nonce.** Each player has an on-chain `reward_nonce`. An entry applies only when its nonce is exactly the next one: a resent batch answers `Duplicate` for what already landed and mints nothing twice; a gap answers `OutOfOrder`. The worker reads the statuses and marks each entry sent or retries it.
- **What an entry carries.** Up to 9 item kinds (up to 1,000 each), up to 2 badges, an optional level, and the sha256 of the verified run, which the `reward` event logs and the contract never stores. An account holds at most 64 token kinds; an entry that would go over answers `Full`.
- **No schedule.** The worker runs in the background of player requests (`after()`), and nothing is scheduled. Three bearer-protected routes are manual fallbacks for the owner.
- **Trust.** The operator can call only `mint_rewards` and `record_season`. It can't transfer, burn or change settings. It can still mint what the server tells it to, so the mint trusts the server's verifier; the replay of every rewarded run is public for that reason.

### Seasons on chain

At a season's end plus 50 minutes for runs in flight, the first player request freezes the board. The server builds a Merkle tree over the final standings (one leaf per player: rank, account, score), writes the results file with every leaf's proof, and queues `record_season(season_id, root, top10, digest)`, where `digest` is the sha256 of that results file. The contract refuses a second record for the same id, stores the record for good and mints `trophy:<season>:<rank>` to each of the top 10.

Season 1 ran Nov 5–14 and was recorded on Nov 15, 2026 at 01:26:36 UTC by the operator ([`AxLWpz5m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX)), with no manual step:

| | |
|---|---|
| `root` | `4c05a3abda23a81157318f7abb1e7ac3fc04d67c0577b7410510a8cc07d830a4` |
| `digest` (sha256 of `/api/seasons/s1/results`) | `2db948d93d702c7469e53ad1c063bff1f57e03284a779584b0dc6de3c981bdbc` |
| Players in the results file | 15 |
| `top10`, in rank order | `azalleaxyz.wgpnear.near`, `9a_z53.wgpnear.near`, `hossinshabani1389.wgpnear.near`, `nasibabalili7.wgpnear.near`, `rezau641.wgpnear.near`, `cybwithflourish.near`, `ambactamwkwk.near`, `zhw_zx.tg`, `fulaj.near`, `tmt027.wgpnear.near` |
| Trophies | One `mt_mint` event in the same transaction: `trophy:s1:1` to `trophy:s1:10`, memo `season:s1` |

The results file's 15 leaves, each with its Merkle proof against the root, are the final board. Season points are the sum of each player's nightly bests:

| Rank | Account | Season points |
|---|---|---|
| 1 | `azalleaxyz.wgpnear.near` | 126,840 |
| 2 | `9a_z53.wgpnear.near` | 99,830 |
| 3 | `hossinshabani1389.wgpnear.near` | 42,680 |
| 4 | `nasibabalili7.wgpnear.near` | 29,820 |
| 5 | `rezau641.wgpnear.near` | 19,325 |
| 6 | `cybwithflourish.near` | 10,245 |
| 7 | `ambactamwkwk.near` | 7,880 |
| 8 | `zhw_zx.tg` | 7,020 |
| 9 | `fulaj.near` | 6,075 |
| 10 | `tmt027.wgpnear.near` | 5,115 |
| 11–15 | five more accounts | 4,865 down to 3,305 |

The board is as concentrated as the chain activity: the top two hold about 60% of the season's points.

Commands H and I re-read it. None of the 15 is one of the author's accounts. Season 1's airdrops (see [By the numbers](#by-the-numbers)) were paid outside the game and are not part of this record.

### The Gas tank: NEAR Intents' 1Click API

`/gas` turns a deposit on another chain into NEAR for `relayer.wgpnear.near`, through NEAR Intents' 1Click API ([`apps/wgp/src/server/intents/one-click.ts`](apps/wgp/src/server/intents/one-click.ts)):

1. The giver picks one of 9 curated tokens (USDC or ETH on Ethereum, Base or Arbitrum, USDC or SOL on Solana, BTC) and an amount worth $1 to $50.
2. The server asks 1Click for a **dry** quote. The recipient is the server's `RELAYER_ACCOUNT_ID`: a recipient sent by the browser is ignored, and a quote that names anyone else is refused. Nothing moves.
3. Only on **Get deposit address** does the server ask for a real quote, with the giver's own refund address on the origin chain (rate-limited per IP), and 1Click returns a one-time deposit address.
4. The page polls 1Click for the swap's status. A failed swap is refunded on the origin chain; a successful one delivers wNEAR on `wrap.near`, where the relayer has been registered since Nov 14, and the owner unwraps it with one `near_withdraw` call.

The page and its dry quotes are live. As of Nov 15, 2026, 17:00 UTC, no real refill had landed on chain; the status table's "Live, first refill pending" row is the current word. The game's items and Bits don't use Intents: they live in the one contract.

### Safe upgrades

`upgrade` (owner only, 1 yoctoNEAR, the new wasm as the call's input) deploys and then calls `migrate` with 50 Tgas, using low-level `env::promise_*` calls instead of near-sdk's `Promise`, which links host functions mainnet doesn't have yet and failed the first deploy. `scripts/near/check-wasm-imports.mjs` refuses a wasm that imports any of them, and tests hold it to each. `upgrade` is tested in the sandbox (v1 to v2, and v2 to v3 on a copy of mainnet state); it has not run on mainnet.

### NEAR Auth: built, waiting on NEAR

A second Google sign-in path through NEAR Auth (FastAuth, MPC keys) is built: `apps/wgp/src/lib/near/near-auth.ts`, `/api/auth/near-auth`, `/api/relay/fast-auth` and a test bench at `/lab/near-auth`. NEAR issued its mainnet client on Nov 14, but the client's allowed callback URLs don't include the site, so `login.auth.near.org` answers "Callback URL mismatch". It stays off until NEAR adds the site; then it needs one setting and a deploy. Google sign-in works today through Privy.

### Who can do what, today

What each key or role can do on mainnet, and what bounds it. [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md) has the plan to shrink each of these.

| Holder | Can | Can't | Bounded by |
|---|---|---|---|
| A player's full-access key (Privy's embedded wallet, or their own wallet) | Everything their account can do, including `mt_transfer` of their tokens | Touch anyone else's tokens or the contract's settings | Ordinary NEAR account rules |
| A player's session key (in their browser) | Call `game.wgpnear.near` as the player: register, craft, equip, trade with Gwei, list, buy and cancel listings | Attach a deposit, so no transfer; call an owner or operator method; call any other contract | Listing bounds and daily caps; the relayer carries it only for its signed-in player; 0.05 NEAR allowance if used directly |
| The relayer (`relayer.wgpnear.near`, key on the server) | Pay for and submit players' signed delegate actions | Change what the player signed; act as a player without their session key's signature | The allow-list, zero deposit, 30 Tgas, budgets, the 1 NEAR circuit breaker |
| The operator (`operator.wgpnear.near`, key on the server) | `mint_rewards` and `record_season` | Transfer, burn, change settings or upgrade | Per-account nonces (a batch can't mint twice); a season id records once; it mints whatever the server's verifier queues |
| The server | Decide which runs verify, queue mints, hold the session-key table, run Sandwich Man | Forge a player's signature | Every verified run's replay is public; anyone can re-run it (`pnpm verify`) |
| The owner (`wgpnear.near`, key on the server) | `set_market_params` (including repricing a pool), `set_rules`, `set_paused`, operators, `set_owner`, `upgrade`; create player accounts | Move a player's tokens through the contract's methods | Only visibility on chain: no timelock yet. The key is hot, in the production environment |
| The contract account's own key (`game.wgpnear.near`, on the owner's machine) | Deploy any code directly, move the contract account's NEAR | | Nothing yet: to be deleted after judging, leaving `upgrade` as the only way to change code |
| Sandwich Man's key (on the server) | What its permission allows (under [Limits](#limits-and-whats-next)); the server sends only his five market calls | Mint, change settings or touch another account's tokens | His rules' caps and the contract's caps; he holds about 0.3 NEAR and a few hundred Bits |

### Status on mainnet (checked Nov 15, 2026)

| | |
|---|---|
| **Used by players on mainnet** (transactions below) | The contract and its market (12 pools, 5% fee); reward mints, Bits and badges included; player accounts created by the factory with session keys; `register_hero`, `craft_suit` and `equip_suit`; `market_buy`, `market_sell`, `list_item` and `buy_listing`, all signed by session keys and relayed (NEP-366) |
| **NPC trader on mainnet** (since Nov 13, 2026) | Sandwich Man trades from his own account, `sandwich.wgpnear.near`, and is never counted as a player. An LLM (Kimi K3) picks among the moves his fixed rules allow when the server has its API key; without it, the rules pick. The owner created the account with 0.3 NEAR and the operator seeded it once with 300 Bits; his first trade landed the same day (transactions below). |
| **Season 1's record: recorded on mainnet** (Nov 15, 2026, 01:26 UTC) | `record_season` and its trophies, sent by the operator with no manual step ([`AxLWpz5m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX)). Season 1 ended Nov 15, 00:00 UTC; the first player request after 00:50 UTC froze the board and queued the record. **Now that it has landed,** `get_season("s1")` holds the root, the digest and the top 10, each of those ten accounts holds `trophy:s1:<rank>`, and the sha256 of `/api/seasons/s1/results` is that digest. **Before the record landed,** `get_season("s1")` answered `null`, no `trophy:s1:*` existed, and `/api/seasons/s1/results` was a 404 until the freeze. `pnpm evidence --chain` checks the recorded state in full: root, digest, board and every trophy against the results file. |
| **Live off chain** | The game and all its modes, runs verified by replay, the boards, Google sign-in (Privy), NEAR wallet sign-in (NEP-413), referrals, classic mode and the soundtrack |
| **Simulation only** | `/lab/economy`, which fast-forwards bot players on the same pricing code |
| **Built, not deployed** | Contract v3: NEP-245 metadata and enumeration, and investing in the merchant. Branch `review/contract-v3`; its review (by a second AI agent that did not write it; not an audit) is summarised in [docs/CONTRACT-V3-REVIEW.md](docs/CONTRACT-V3-REVIEW.md). |
| **Waiting on approval** | NEAR Auth as a second Google sign-in path (its mainnet client). NEAR issued the mainnet client on Nov 14, but its allowed callback URLs don't include the site yet: `login.auth.near.org` answers "Callback URL mismatch" for every address of wgponnear.fun. The flow is built (`apps/wgp/src/lib/near/near-auth.ts`, `/api/auth/near-auth`, `/api/relay/fast-auth` and the test bench at `/lab/near-auth`) and stays off until NEAR adds the site; then it needs one setting, `NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID`, and a deploy. |
| **Live on NEAR mainnet** (since Nov 15, 2026, after the deadline) | Gwei's new stock: four items earned from the Daily Run and from cases (gas receipt, finality flag, evidence bag, torn seed phrase) and two suits that burn them (Notary, Finality). The owner registered them with `set_rules` and opened their pools with `set_market_params` (the arguments are in `docs/economy/new-stock-calls.json`), so the market has 12 pools. The server awards an item only while its pool exists on chain, because `mint_rewards` refuses an item the contract doesn't know |
| **Owner calls on mainnet** (Nov 15, 2026, 08:27 UTC, after the deadline) | `set_rules` registered the four new items and two suits ([`GzMYer3o…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY)); 23 seconds later `set_market_params` set `fee_bps` from 200 to 500 and `craft_bits` from 0 to 250, and opened the four new pools ([`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK)). Both were signed by `wgpnear.near`, whose key is in the production server's environment. |
| **Live, first refill pending** | The Gas tank's first real refill through NEAR Intents: the page and its dry quotes are live, and no real refill has landed on chain yet |

### Proven on mainnet

`pnpm evidence --chain` looks up each of these transactions and checks what it did. The player transactions are from five different players' accounts, named in each row. None is from the author's own account, `sele.wgpnear.near`. [Evidence](docs/EVIDENCE.md#proven-on-mainnet)

| What | Transaction |
|---|---|
| Deploy and `new` (code hash `68F7NhEjUtKweyLU7WNvT183apacLQegfB1DXUoQ2hjJ`, owner `wgpnear.near`, operator `operator.wgpnear.near`) | [`8nyXGMNu…`](https://nearblocks.io/txns/8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR) |
| `set_market_params`: opens the market and mints Gwei's stock and till | [`FdQxVNyz…`](https://nearblocks.io/txns/FdQxVNyziV7ioNWPAfL9yAWJ8u2wDN3kRKpEX4JSVcCR) |
| The factory creates a Google player's account, `9a_z53.wgpnear.near`, with their Privy key and a session key | [`DFF1SsPj…`](https://nearblocks.io/txns/DFF1SsPjKPto6Kxa3TfpdX2pSMNC9GftnbJuz9PRWcV8) |
| `mint_rewards` from the operator (one of 169 as of Nov 13) | [`CsnUWQDW…`](https://nearblocks.io/txns/CsnUWQDWSXGwNaapB9iFGH3idEqzQWGbWmrH7pbJegZh) |
| A wallet player's `register_hero` (`cybwithflourish.near`) | [`7dnP8eU7…`](https://nearblocks.io/txns/7dnP8eU7W8b9LdQeZztnttzai5uUc7gHAea4hEeoXnnq) |
| A player's `craft_suit` of the Stealth suit, burning the 3 Sybil goo in its recipe (`9a_z53.wgpnear.near`) | [`3ttQYUBr…`](https://nearblocks.io/txns/3ttQYUBrA8CbKu1s7VuvNA8QAxMMfHsTJGHrKi4AZqjc) |
| A player's `equip_suit` (`nasibabalili7.wgpnear.near`) | [`C2WwQsHy…`](https://nearblocks.io/txns/C2WwQsHyHNBZLrkN1JaVDGZuuf9aYaBJGqvyMSLvRvRp) |
| A `market_buy` from Gwei, with the fee burned (`9a_z53.wgpnear.near`; command E is another, by `azalleaxyz.wgpnear.near`) | [`ASmRJdKZ…`](https://nearblocks.io/txns/ASmRJdKZy3fMPAPNNogcABL4Wdr7CiPPasAxRjXr5xRq) |
| A `market_sell` to Gwei (`azalleaxyz.wgpnear.near`) | [`GDATLg4Q…`](https://nearblocks.io/txns/GDATLg4Qr2cqQZ9S5uaRwZJTup4Y54P7uPyzJzFGaqXE) |
| A player `list_item`, escrowed in the contract (`hossinshabani1389.wgpnear.near`) | [`GhK2jtPK…`](https://nearblocks.io/txns/GhK2jtPKtNpHgjcn93eYRiFjF72mcMcFzbfHqYbnM9tx) |
| A `buy_listing` of another player's listing: a player-to-player trade (`9a_z53.wgpnear.near`) | [`Heu9ZTQv…`](https://nearblocks.io/txns/Heu9ZTQvWmriDngtPQ37defMDZMJSecgBNpdAuLnMdu9) |
| Sandwich Man's account, `sandwich.wgpnear.near`: created by `wgpnear.near` with 0.3 NEAR and one full-access key (Nov 13) | [`Hx32N4dy…`](https://nearblocks.io/txns/Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm) |
| His one-off seed: a `mint_rewards` of 300 Bits from the operator, with the digest `sha256("npc-seed:sandwich.wgpnear.near:v1")` | [`Hjvobzmd…`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7) |
| His first trade: a `market_buy` of 2 Sybil goo from Gwei for 72 Bits, 2 of them the burned fee, signed by his own key and not relayed | [`AcmNAmHr…`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf) |
| The 1 NEAR the team moved from the relayer to the contract's storage balance (Nov 13, 07:00 UTC), which put the relayer under its 1 NEAR cut-off and started the outage | [`FH2tpfkz…`](https://nearblocks.io/txns/FH2tpfkzDkY8MtEX6fWCmMc7E7RRndGA8nibM1ZYEjuB) |
| The 0.5 NEAR sent from `game.wgpnear.near` to the relayer with the contract account's full-access key (Nov 14, 20:21 UTC), which ended the outage | [`GU8GVkK3…`](https://nearblocks.io/txns/GU8GVkK3a2mDkypzEz1cAVnHihVQLKQBUJKQ9oeyYs2d) |
| `game.wgpnear.near` registers the relayer on `wrap.near`, so Gas tank deliveries (wNEAR) can land (Nov 14, 20:21 UTC) | [`DWFUoozv…`](https://nearblocks.io/txns/DWFUoozvVD7ZLDwxCvrQusKd13mXFVSR9g5qCrx4gvAr) |
| `record_season` for Season 1, from the operator: the root, the digest, the top 10 and `trophy:s1:1` to `trophy:s1:10` in one `mt_mint` (Nov 15, 01:26 UTC) | [`AxLWpz5m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX) |
| The owner's `set_rules`: 12 items and 10 suits, Notary and Finality among them (Nov 15, 08:27 UTC, after the deadline) | [`GzMYer3o…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY) |
| The owner's `set_market_params`: `fee_bps` 500, `craft_bits` 250, and four new pools seeded with 28 items and 780 Bits (Nov 15, 08:27 UTC, after the deadline) | [`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK) |
| A Sandwich Man `market_buy` whose line in the live endpoint's log says it was picked by his LLM brain (`"brain":"kimi-k3"` on Nov 15): 2 Sybil goo for 37 Bits, 2 of them the burned fee (Nov 15, 13:39 UTC, after the deadline). Which brain picked a move is the server's record, not something the chain can show | [`6cjd1ffr…`](https://nearblocks.io/txns/6cjd1ffrZUXqoafzBydwQAZmjdBAKfna9B3PNMFtZuAN) |

**From this source to the deployed code.** The code hash above is the base58 form of the deployed wasm's sha256, `4c25745400717004ab5c18521bf6454a21c6f093d6deff353f8784dcd15df84d`. Building `contracts/wgp` from `main` with `cargo near build non-reproducible-wasm --locked` gives that sha256 on the author's machine. On another machine it gives a different one, because the wasm embeds the builder's absolute cargo registry paths; a reproducible (container) build is not set up. So the link from this source to the deployed code rests on the author's build, and the contract's tests prove the source, not the bytes on chain.

### Every contract method and its key transaction

Each change method of `game.wgpnear.near`, who may call it, and one transaction where it ran on mainnet. "Not called" comes from the method counts below: NearBlocks lists no call to it.

| Method | Who may call it | Deposit | Key transaction, or why there is none |
|---|---|---|---|
| `new` | Once, at deploy | none | [`8nyXGMNu…`](https://nearblocks.io/txns/8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR) (Nov 3); the first attempt, [`3h6JxxeZ…`](https://nearblocks.io/txns/3h6JxxeZofE6rqZEx5WV8XjqLJWnGZeKjcuX6j7GFLJd), failed |
| `register_hero` | Any account, once; relayed for players | none | [`7dnP8eU7…`](https://nearblocks.io/txns/7dnP8eU7W8b9LdQeZztnttzai5uUc7gHAea4hEeoXnnq), a wallet player's, relayed |
| `craft_suit` | A hero at the recipe's level, holding the recipe and `craft_bits` | none | [`3ttQYUBr…`](https://nearblocks.io/txns/3ttQYUBrA8CbKu1s7VuvNA8QAxMMfHsTJGHrKi4AZqjc) (Stealth, burning 3 Sybil goo, before the 250-Bit cost) |
| `equip_suit` | A hero, for a suit they own | none | [`C2WwQsHy…`](https://nearblocks.io/txns/C2WwQsHyHNBZLrkN1JaVDGZuuf9aYaBJGqvyMSLvRvRp) |
| `market_buy` | Any account holding the Bits; slippage bound `max_bits` | none | [`ASmRJdKZ…`](https://nearblocks.io/txns/ASmRJdKZy3fMPAPNNogcABL4Wdr7CiPPasAxRjXr5xRq); relayed, with its events: [`GJXrKe2o…`](https://nearblocks.io/txns/GJXrKe2oNjbTvxG2HyMt4DeTBXNPxGVRBbXsUrzv2TPJ) (command E); by Sandwich Man: [`AcmNAmHr…`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf) |
| `market_sell` | Any account holding the item; slippage bound `min_bits` | none | [`GDATLg4Q…`](https://nearblocks.io/txns/GDATLg4Qr2cqQZ9S5uaRwZJTup4Y54P7uPyzJzFGaqXE) |
| `list_item` | Any account holding the item, within the bounds | none | [`GhK2jtPK…`](https://nearblocks.io/txns/GhK2jtPKtNpHgjcn93eYRiFjF72mcMcFzbfHqYbnM9tx) |
| `buy_listing` | Any account but the seller | none | [`Heu9ZTQv…`](https://nearblocks.io/txns/Heu9ZTQvWmriDngtPQ37defMDZMJSecgBNpdAuLnMdu9) |
| `cancel_listing` | The seller | none | [`J8rLL9GW…`](https://nearblocks.io/txns/J8rLL9GWab9AeB1DTNy8fC7GCa9NbpyXXpKWKeXAKF8t), relayed: 2 Sybil goo back from escrow (Nov 12) |
| `mint_rewards` | Operators only | none | [`CsnUWQDW…`](https://nearblocks.io/txns/CsnUWQDWSXGwNaapB9iFGH3idEqzQWGbWmrH7pbJegZh); Sandwich Man's seed: [`Hjvobzmd…`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7) |
| `record_season` | Operators only, once per season id | none | [`AxLWpz5m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX) (Season 1) |
| `set_market_params` | The owner | 1 yoctoNEAR | [`FdQxVNyz…`](https://nearblocks.io/txns/FdQxVNyziV7ioNWPAfL9yAWJ8u2wDN3kRKpEX4JSVcCR) (opened the market, Nov 3); [`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK) (5% fee, 250-Bit crafting, four pools; Nov 15, after the deadline) |
| `set_rules` | The owner | 1 yoctoNEAR | [`GzMYer3o…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY) (Nov 15, after the deadline); the launch rules were set by `new` |
| `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`, `mt_batch_transfer_call` | A full-access key of the owner of the tokens | exactly 1 yoctoNEAR | Not called: no player has moved a token to another account directly. Tokens have changed hands only through the market, whose `mt_transfer` events are in its transactions |
| `set_paused`, `add_operator`, `remove_operator`, `set_owner` | The owner | 1 yoctoNEAR | Not called: the contract has never been paused, and its owner and only operator are the ones `new` set |
| `upgrade` | The owner, with the new wasm as input | 1 yoctoNEAR | Not called: the code on chain is the Nov 3 deploy |

### Calls by method (as of Nov 15, 2026)

Every function call NearBlocks lists for `game.wgpnear.near`, counted by `node scripts/stats.mjs --chain-only` on Nov 15, 2026 at 17:19 UTC, after the deadline. The [By the numbers](#by-the-numbers) tables are the same count taken on Nov 13, inside the window. Both only grow.

| Method | Sent by | Calls by Nov 15, 17:19 UTC |
|---|---|---|
| All function calls (`pnpm stats` counts one of them as failed) | | **329** |
| `mint_rewards` (verified nights' loot, Bits and badges, and Sandwich Man's seed) | `operator.wgpnear.near` | **235** |
| `register_hero` | players | **19** |
| `craft_suit` | players | **17** |
| `equip_suit` | players | **7** |
| `market_buy` | players, and Sandwich Man | **17**, of them Sandwich Man's: **3** |
| `market_sell` | players | **15** |
| `list_item` | players | **7** |
| `buy_listing` | players | **4** |
| `cancel_listing` | players | **1** |
| `record_season` | `operator.wgpnear.near` | **1** |
| `set_market_params` | `wgpnear.near`, the owner: Nov 3 and Nov 15 | **2** |
| `set_rules` | `wgpnear.near`, the owner: Nov 15 | **1** |
| `new` | `game.wgpnear.near`, with each deploy on Nov 3 (the first failed) | **2** |
| `storage_deposit` | `game.wgpnear.near`, to `wrap.near` on Nov 14 (listed because the contract's account sent it) | **1** |
| Player accounts that called a method themselves (the author's `sele.wgpnear.near` among them; Sandwich Man not) | | **18**, of which **8** made more than one call |
| Players' market calls, and the accounts that made them | | **41** from **5** accounts; **30** from the two busiest |

**The full ledger.** [docs/TRANSACTIONS.md](docs/TRANSACTIONS.md) is the generated list of the game's mainnet transactions, beyond the key ones above: every transaction of the five accounts, with the contract's receipts by method, sender and outcome. `pnpm txs` (scripts/transactions.mjs) rebuilds it from NearBlocks; like `pnpm stats` and `pnpm costs` it reads only and sends nothing. Its run of 2026-11-15 17:22:35 UTC read every account's list to the end and found 368 distinct transactions across the five accounts, 3 of them failed, and 336 receipts on the contract, 84 of them relayed. Its counts of failures differ from `pnpm stats`' because it reads each receipt's own outcome. Firsts it lists:

| First | Transaction |
|---|---|
| The contract account's creation (Nov 3, 15:50 UTC) | [`8tRgGW8G…`](https://nearblocks.io/txns/8tRgGW8GPwS6EJwaDGaZ4mfyGTkXwJWXCq46UF1u9g8v) |
| A relayed call, and a trade: the author's own `market_buy` (Nov 3) | [`GxuFQYCX…`](https://nearblocks.io/txns/GxuFQYCX7DzCFRXenpQuhfxz1hUekf9t2FapLjCUeMXn) |
| A player's hero: `azalleaxyz.wgpnear.near` (Nov 6) | [`6H2hdWkb…`](https://nearblocks.io/txns/6H2hdWkb3jKEX22dM33AMnpLJ6ei8C8KFqG9MbpH2BtY) |
| A relayed trade by a player other than the author | [`GXsZ5kk4…`](https://nearblocks.io/txns/GXsZ5kk4jz5LcdcLs5CWEvxKxew1AexHH41gtDouNpw2) |

### Read the chain yourself

More read-only calls, each with what it printed on Nov 15, 2026. `view` is a shell helper for NEAR's JSON-RPC; paste it first.

```bash
view() { curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64)\"}}" \
  | jq -r '.result.result | implode'; }

# Who runs the contract: one owner, one operator, not paused, 12 items, 10 suits
view game.wgpnear.near get_config '{}' | jq -c '{owner_id, operators, paused, items: (.items | length), suits: (.suits | length)}'
# → {"owner_id":"wgpnear.near","operators":["operator.wgpnear.near"],"paused":false,"items":12,"suits":10}

# Every Bit in existence: seeded tills + minted − burned
view game.wgpnear.near mt_supply '{"token_id":"item:bits"}'
# → "27424"

# Season 1's winner holds the trophy (trophies are soulbound)
view game.wgpnear.near mt_balance_of '{"account_id":"azalleaxyz.wgpnear.near","token_id":"trophy:s1:1"}'
# → "1"

# Sandwich Man's market account: his Bits and what the contract's daily caps leave him today
view game.wgpnear.near market_account '{"account_id":"sandwich.wgpnear.near"}'
# → {"bits":"152","trades_left":38,"listings_left":10,"fills_left":10,"fill_bits_left":"3000","open":[]}

# Gas tank deliveries waiting to be unwrapped (wNEAR held by the relayer): none on Nov 15, when no refill had landed
view wrap.near ft_balance_of '{"account_id":"relayer.wgpnear.near"}'
# → "0"

# The relayer's balance, against its 1 NEAR cut-off
curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"relayer.wgpnear.near"}}' \
  | jq -r '.result.amount' | awk '{ printf "%.4f NEAR\n", $1 / 1e24 }'
# → 1.4689 NEAR

# The keys on the three accounts the team holds (public keys and permissions only)
for a in wgpnear.near game.wgpnear.near sandwich.wgpnear.near; do
  curl -s https://rpc.mainnet.near.org -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$a\"}}" \
    | jq -c --arg a "$a" '{account: $a, keys: [.result.keys[] | .access_key.permission]}'
done
# → on Nov 15, 2026: each account had one key, "FullAccess"
```

## How verification works

[Evidence](docs/EVIDENCE.md#how-verification-works) for each step.

1. **One simulation.** `packages/game-core` is a deterministic simulation: a 60 Hz fixed step, trig-free maths (polynomial sin, cos and atan2 in `packages/game-core/src/sim3d/dmath.ts`), and integer HP and score. The browser and the server share it. A test scans it for sources of non-determinism.
2. **Recording.** The browser records only inputs: a stick direction, a magnitude, web held, and one-shot powers. They're run-length encoded, usually 1–5 KB a night; the server refuses a log over 64 KB.
3. **Starting a run.** `POST /api/runs/start` issues a server-signed seed. A player has at most one active run and 20 ranked runs a day.
4. **Verifying.** `POST /api/runs/<id>/submit` replays the log from that seed and the server's copy of the save. It checks the ruleset, at least 20 seconds of game time, game time within wall-clock time plus 5 seconds, and that the browser's final state hash matches. Then it ranks the server's score, not the client's.
5. **Rulesets are pinned.** Season 1 plays on ruleset 4. Each mode has its own ruleset tag (cases, trials, the City), so a log from one mode never replays as another. Recorded golden runs must replay byte-identical before a change ships.
6. **Anyone can re-check.** Every verified run's replay is public at `GET /api/runs/<id>/replay` (`seed`, `startSave`, `log`, `score`, `ticks`, `hash`).

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Evidence

[docs/EVIDENCE.md](docs/EVIDENCE.md) lists the claims in this README and in `docs/` that a script can check. Each is quoted word for word and paired with the code that does it and with what checks it: a test in this repository, a read-only call to NEAR mainnet or the live site, or both. The list is generated from [docs/evidence.json](docs/evidence.json). It does not cover every sentence. Design intent, the story and the chapters' prose have no rows; the problem statement, the disclosures and the credits have rows only where there is something to check (a file, a version, a commit).

```bash
pnpm install --frozen-lockfile
pnpm evidence            # every row's pointers and tests: no network, no keys, no environment variables
pnpm evidence --chain    # also the read-only checks against NEAR mainnet and the live site
```

It prints one line per claim, then one summary line. `PASS` is mechanical and means no more than this: the claim's words are still in the document, each code pointer's anchor text is still in its file, and each cited test ran and passed just now (with `--chain`, each read-only check also answered as expected). Whether a test is a good proof of its sentence is for a reader to judge; each row names its test. `SKIP` names what couldn't run here and why: offline, that is every row whose proof is on chain or on the live site. Any `FAIL` exits 1.

**Reading one row.** Take `proven-record-season` in [docs/EVIDENCE.md](docs/EVIDENCE.md#proven-record-season). It quotes this README's words, points at the code (`record_season` in `contracts/wgp/src/lib.rs`), and names two chain checks: `tx-record-season` looks the transaction up on an archival RPC and asserts its signer, receiver, method, success, the logged `mt_mint` of `trophy:s1:1` to `trophy:s1:10` and the `season` event's root and digest; `season-s1` reads `get_season("s1")`, hashes the results file and reads each trophy balance. `pnpm evidence --chain --only proven-record-season` runs exactly that, and each row in docs/EVIDENCE.md prints the shell command for each of its tests and checks.

Each claim carries a status that says how far its proof reaches. `proven by test`, `pinned by test`, `simulation only` and `built, off on mainnet` rows always cite a test. A `proven by test` row cites at least one test that runs the code; a `pinned by test` row's tests only compare the document's words with source text, a constant or a config file, so they catch drift and do not show the code works. `proven on chain` and `live check` rows rest on a read-only check, and cite a test as well where there is one. `checked in git` rows rest on this clone's own commit history. `owner action needed` rows point at what is ready. Each of them also checks that it is not live (a method the deployed contract lacks, a branch that is not merged, a setting or balance still at its old value), except NEAR Auth, whose approval is outside this repository, and the Gas tank's first refill, which anyone could make by sending wNEAR to the relayer; neither has a check.

<!-- evidence:coverage:start (generated by `pnpm evidence --write`; edit scripts/evidence.mjs, not this block) -->
| | |
|---|---|
| Claims with a row | 252, quoted from this README and 13 files under `docs/` |
| By status | 126 `proven by test` · 8 `pinned by test` · 60 `proven on chain` · 20 `live check` · 6 `checked in git` · 24 `simulation only` · 8 `owner action needed` |
| Rows that cite a test | 215 of 252 (425 different tests). All 158 rows with the status `proven by test`, `pinned by test`, `simulation only`, `built, off on mainnet` have one; a guard test fails otherwise. |
| Rows with a read-only chain or site check | 123 of 252 (58 different checks) |
| Rows with neither (a code pointer only) | 0 |
| Code pointers | 375, each anchored to a piece of text that appears once in its file |
| `pnpm evidence` prints | `252 claims: 172 PASS, 0 FAIL, 80 SKIP.` The 80 SKIP rows are the `proven on chain` and `live check` rows, whose proof needs `--chain`. In a clone without the branch `review/contract-v3`, the rows that check it are SKIP as well. Without Rust installed, the 41 rows that cite a contract test are SKIP too. |
| `pnpm evidence --chain` prints | `252 claims: 252 PASS, 0 FAIL, 0 SKIP.` when every endpoint answers. A rate-limited endpoint is retried, then its rows are SKIP (never FAIL), with the line `N rows skipped: rate limited, re-run.` |
<!-- evidence:coverage:end -->

## What is not proven, or not live

One list, so nothing has to be dug for. Each item names where its detail is.

**Built, not live on mainnet**

| What | State | Detail |
|---|---|---|
| Investing in a broke vendor (`market_invest`, `market_withdraw`, `market_claim`) | Contract v3, on the branch `review/contract-v3`, not deployed. Runs only in the signed-out practice market and `/lab/economy` | [docs/INVESTING.md](docs/INVESTING.md) |
| NEP-245 metadata and `mt_tokens` enumeration | Contract v3, not deployed. The deployed v2 has neither, and no approvals | [docs/CONTRACT-V3-REVIEW.md](docs/CONTRACT-V3-REVIEW.md) |
| v3's review | By a second AI agent that did not write the code, in one day; not an audit | [docs/CONTRACT-V3-REVIEW.md](docs/CONTRACT-V3-REVIEW.md) |
| `upgrade` | Tested in the sandbox, including v2 to v3 on a copy of mainnet state; never run on mainnet | [Safe upgrades](#safe-upgrades) |
| NEAR Auth as a second Google sign-in | Built; NEAR's mainnet client doesn't allow the site's callback URLs yet | [NEAR Auth](#near-auth-built-waiting-on-near) |
| Sandwich Man closing shop when broke | Proven in tests and the lab; it has not happened on mainnet | [docs/npc-trader.md](docs/npc-trader.md) |

**Waiting on the owner or on someone else**

| What | State | Detail |
|---|---|---|
| The Gas tank's first real refill | The page and its dry quotes are live; as of Nov 15, 2026 no refill had landed on chain | [The Gas tank](#the-gas-tank-near-intents-1click-api) |
| The owner key in cold storage | `wgpnear.near`'s only key is in the production server's environment; `set_owner` to a cold account is planned after judging | [docs/KEYS.md](docs/KEYS.md) |
| Deleting the contract account's full-access key | Planned after judging; until then whoever holds it can deploy any code to `game.wgpnear.near` | [docs/KEYS.md](docs/KEYS.md) |
| A reproducible build of the wasm | Only the author's machine reproduces the deployed sha256 | [Proven on mainnet](#proven-on-mainnet) |

**Live, but not proof of what it might look like**

| What | Why it isn't more |
|---|---|
| Ranked scores | Replay proves a score came from legal inputs, not that a human played it. A bot can rank, and a player can re-roll seeds within the 20-a-day cap |
| Reward mints | The contract trusts the operator, and the operator trusts the server's verifier. Every rewarded run's replay is public, so a wrong one can be caught, not prevented |
| Traction | A small playtest with daily airdrops paid outside the game; 17 player accounts other than the author's, most calls from a few of them; an account is not a person |
| The lab's economy numbers | Bots on fixed rules, not players; the four launch recipe suits only |
| Market activity | Few trades, from few accounts. Within the window, players last traded on Nov 12, and relayed actions were down from Nov 13 07:00 to Nov 14 20:21 UTC because of the team's own transfer |
| An LLM picking Sandwich Man's moves | Switched on after the deadline. Which brain picked a move is recorded by the server; the chain shows only the trade |
| The game's own counts (`/api/stats`) | Served by the game's database: they can be re-read, not checked independently |
| The deployed bytes | The contract's tests prove this source; the link to the bytes on chain rests on the author's build |

## Run it locally

**You need:** Node ≥ 22 (CI uses 24), pnpm 10.19 (`corepack enable` picks the version in `package.json`), and Rust through [rustup](https://rustup.rs) for the contract tests. No database, keys or accounts.

```bash
pnpm install --frozen-lockfile
echo "ALLOW_DEV_AUTH=1" > apps/wgp/.env.local    # turns on the local test sign-in; nothing else is needed
pnpm dev                                         # http://localhost:3000/play  (another port: PORT=3680 pnpm dev)
```

- **Database:** local dev uses PGlite (Postgres in a folder, `apps/wgp/.data/pglite`) and applies the migrations itself.
- **Signing in locally:** in the sign-in sheet, **Play as a test player** gives you a test account. Make a hero, finish a night, and you'll see **Verified · Ranked** from your own server. Check it with `pnpm verify --base http://localhost:3000 --board tonight`.
- **What stays off locally:** with no NEAR keys the market runs in simulation (`onChain: false`) and nothing is sent on chain. Google and wallet sign-in need the Privy and NEAR settings in `apps/wgp/.env.example`.

| Command | What it does | Expect |
|---|---|---|
| `pnpm test` | Unit and integration tests: the simulation and its golden replays, the server, verifier, market, relayer abuse cases, reward outbox, season close and referrals. The app's tests run on in-memory PGlite and make no network request: a guard fails any test that tries. | game-core 284 passed, app 1,799 passed |
| `pnpm typecheck` / `pnpm lint` | TypeScript across the workspace, and ESLint for the app | Exit 0, no errors |
| `pnpm build` | The production build of the app; needs no environment variables | The route list |
| `pnpm verify` | Replays the live All-time top 5 | `5/5 runs reproduced` |
| `pnpm stats` | Prints the live game numbers and counts the contract's transactions (30 seconds to two minutes, depending on NearBlocks rate limits) | A table |
| `pnpm costs` | Measures what the game costs to run from mainnet history: gas per relayed action and per mint, daily spend, runway, what a Gas tank refill buys and cost per player. Read-only; one to ten minutes, depending on NearBlocks rate limits | A table, dated in UTC ([Measured costs](docs/SUSTAINABILITY.md#measured-costs-re-run-pnpm-costs)) |
| `pnpm evidence` | Checks each row of [docs/EVIDENCE.md](docs/EVIDENCE.md) against its code and tests; `--chain` adds the read-only mainnet and site checks | One `PASS`, `SKIP` or `FAIL` line per claim, then a summary line, exit 0. Offline, the rows whose proof is on chain are `SKIP`. The exact summary line for each command is in [Evidence](#evidence). |
| `cd contracts/wgp && cargo test --locked` | Contract unit tests | `test result: ok. 68 passed` |
| `cd contracts/wgp && cargo near build non-reproducible-wasm && cd sandbox && cargo test -- --test-threads=1` | Sandbox tests of the real wasm with near-workspaces (5 tests in two files); needs [cargo-near](https://github.com/near/cargo-near) 0.22. `pnpm evidence` does not run them; CI's `sandbox` job does. | `test result: ok` for each file |
| `scripts/near/setup-mainnet.sh` | Owner only: creates the mainnet accounts, deploys the contract and opens the market. Spends real NEAR. | |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, the build, the contract's unit tests, its sandbox tests and `pnpm evidence` on every push to `main`, with no secrets.

## Layout

```
packages/game-core/    deterministic simulation, input log, replay verifier, scoring (TypeScript)
apps/wgp/              Next.js 16 app: 3D client (React Three Fiber), API routes, Drizzle (Neon / PGlite), NEAR wiring
contracts/wgp/         NEAR contract (near-sdk 5.30): NEP-245 core, rewards, crafting, Mempool Market, seasons
contracts/wgp/sandbox  near-workspaces tests of the built wasm
scripts/               verify-run.ts, stats.mjs, evidence.mjs, mainnet setup and chain end-to-end tests (near/), a load test (load/)
docs/                  evidence for every claim, the game loop, architecture, chapters, story, competitive modes, referrals, screenshots
launch/brand/hero/     Blender pipeline for the characters, and the headless-browser playtest drivers (run from the repo root; they use launch/lib/cdp.mjs)
```

| Start here | |
|---|---|
| The contract | [`contracts/wgp/src/lib.rs`](contracts/wgp/src/lib.rs) (rewards, crafting, seasons), [`market.rs`](contracts/wgp/src/market.rs), [`mt.rs`](contracts/wgp/src/mt.rs) (NEP-245) |
| Pricing rules | [`apps/wgp/src/lib/market/math.ts`](apps/wgp/src/lib/market/math.ts) |
| The verifier | [`packages/game-core/src/replay.ts`](packages/game-core/src/replay.ts), [`apps/wgp/src/server/db/runs.ts`](apps/wgp/src/server/db/runs.ts) |
| The relayer's checks | [`apps/wgp/src/server/near/relay.ts`](apps/wgp/src/server/near/relay.ts) |
| The mint worker | [`apps/wgp/src/server/near/mint-worker.ts`](apps/wgp/src/server/near/mint-worker.ts) |

**Pages:** `/` (landing), `/play` (Tonight), `/play/patrol` (the 3D night), `/play/city`, `/play/cases`, `/play/compete`, `/play/market`, `/play/suits`, `/play/hero`, `/play/album`, `/play/rug` (The Daily Rug, the in-game paper), `/play/leaderboard`, `/play/invite`, `/play/classic`, `/stats`. Labs: `/lab/economy`, `/lab/determinism`.

## Limits and what's next

- **Bots and re-rolled seeds:** replay verification proves a score came from legal inputs, not that a human played it. The bot that ships in this repository (`packages/game-core/src/sim3d/bot.ts`) scores 8,245, 8,350 and 8,870 on the three recorded nights it clears (`packages/game-core/test/golden/hashes.json`); on Nov 14, only two players had an All-time best above the lowest of those. A bot-played night passes the server's verifier like any other. A player can also abandon a ranked night and start again on a new seed, and the seed decides the night's stops. The server refuses a night handed in faster than real time and caps ranked nights at 20 a day per player; within that cap, nothing stops a bot or a player re-rolling seeds. Season 1's airdrops (see [By the numbers](#by-the-numbers)) are reviewed by hand before they are sent.
- **The owner key is a hot server key:** the contract's owner, `wgpnear.near`, has one key, a full-access key, and that key is in the production server's environment, because the same account is the factory that creates player accounts (`FACTORY_PRIVATE_KEY`, set by `scripts/near/setup-mainnet.sh`). Whoever gets that key can upgrade the contract, change its market settings or hand over its ownership. The plan is `set_owner` to a cold account after judging, then a delay on upgrades ([docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md)).
- **The contract account has a full-access key too:** `game.wgpnear.near` has one full-access key, held by the owner on their own machine; it is not in the server's environment. Whoever holds it can deploy any code to the contract directly, without going through `upgrade`, so until it is removed, players' tokens are only as safe as that key. It was last used on Nov 14 to send 0.5 NEAR to the relayer and register the relayer on wrap.near. The plan is to delete it after judging, leaving the owner's `upgrade` method as the only way to change the code.
- **Currency:** more Bits are still earned than burned. In the lab's default run, on mainnet's settings, 58,859 are earned and 26,454 burned, about 45% (99,022 and 2,847 on the old settings). A verified night pays less to a hero who already holds Bits: the whole night up to 150 held, falling to the 5 for showing up at 400. The sinks are the trade fee (5%) and crafting, which burns 250 Bits a suit on top of the recipe. Parity is out of reach with the deployed contract: its only Bits sinks are the fee and six recipe suits per hero, each crafted once (four until Nov 15; the lab's numbers model those four), and a hero who never spends keeps what the taper let them earn. [docs/ECONOMY.md](docs/ECONOMY.md) has the measurements.
- **Trust:** the operator key mints rewards and the server decides which runs verify. Anyone can re-run a run's replay, but the mint itself trusts our server. The contract's owner can upgrade it. Sandwich Man's key is a full-access key of his own account: the server only ever sends his five market calls, and a function-call key is the planned swap ([docs/npc-trader.md](docs/npc-trader.md#limits)).
- **Scale:** 26 heroes as of Nov 13. The relayer and operator are single accounts with daily budgets.
- **Market depth:** most on-chain activity is rewards and crafting; trades are still few, from a few accounts (the market row under [By the numbers](#by-the-numbers)). As of Nov 14, 02:00 UTC, the last player market call was on Nov 12 at 18:42 UTC, and Sandwich Man had traded once. Part of that silence is ours: from Nov 13, 07:00 UTC to Nov 14, 20:21 UTC the relayer sat under its 1 NEAR cut-off, after we moved 1 NEAR out of it to the contract, so signed-in trades and other relayed actions were refused. That outage is why the Gas tank exists.
- **Build reproducibility:** only the author's machine reproduces the deployed wasm's hash from this source ([Proven on mainnet](#proven-on-mainnet) has the hash and why).
- **The plan:** costs, who players have to trust today and how that shrinks are in [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md). Running costs measured from mainnet history (gas per player action, runway, what a Gas tank refill buys, cost per player) are under [Measured costs](docs/SUSTAINABILITY.md#measured-costs-re-run-pnpm-costs); `pnpm costs` re-reads them.
- **Next:** ranked nights get the City's movement (sprint, climbing) now that Season 1 is closed, since ranked rules are frozen while a season runs; Season 2, measured with the same `pnpm traction` and without airdrops; NEAR Auth as a second sign-in, once NEAR adds the site to its mainnet client; the owner's key steps in [docs/KEYS.md](docs/KEYS.md).

## Changed after the deadline (Nov 15, 2026)

The submission deadline was 2026-11-14 23:59 UTC. The hackathon's rules judge the integration built in the build window (Q-002 in [HACKATHON.md](https://nearhackathon.com/HACKATHON.md)), so everything merged, deployed or sent on chain after the deadline is listed here, apart from the rest. All times are UTC.

**The line.** The last commit on `main` before the deadline is `401d5eb`, the merge of [pull request #73](https://github.com/71Labs/WithGreatPower/pull/73) on Nov 14 at 21:49. It is tagged `hackathon-submission`, the name Q-003 suggests, and the full diff since is [hackathon-submission...main](https://github.com/71Labs/WithGreatPower/compare/hackathon-submission...main). Everything after it on `main` came in one merge, `e55d3b5` ([pull request #77](https://github.com/71Labs/WithGreatPower/pull/77)), on Nov 15 at 08:52: `git diff --stat 401d5eb e55d3b5` reports 97 files changed, 7,013 insertions and 804 deletions. No file under `contracts/` changed. In `packages/game-core` only the item and suit tables gained the four items and two suits (14 lines); the ruleset and the golden replays did not change. The README as it stood at the deadline is `git show hackathon-submission:README.md`.

| When (UTC) | What changed | Proof |
|---|---|---|
| Nov 15, 01:26 | **Season 1's record ran by itself, as designed.** The first player request after 00:50 froze the board and the operator sent `record_season` with the ten trophies. No code or setting was changed for it | [`AxLWpz5m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX) |
| Nov 15, 07:43–08:52 | **The commits of pull request #77 were written**, from `a4079a1` (the wanted list) to `8d2bb73` | `git log --format='%h %aI %s' e2495cb..e55d3b5` |
| Nov 15, 08:27 | **The owner's `set_rules`:** the four new items and the Notary and Finality suits | [`GzMYer3o…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY) |
| Nov 15, 08:27 | **The owner's `set_market_params`:** the gas fee from 2% to 5% (`fee_bps` 200 → 500), crafting from free to 250 Bits (`craft_bits` 0 → 250), and the four new pools with their seed | [`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK) |
| Nov 15, 08:52 | **Pull request #77 merged** (`e55d3b5`) and deployed to production; the live site's first stored wanted list is stamped 08:54:19 | `curl -s https://www.wgponnear.fun/api/market/wanted \| jq .at` on Nov 15 |
| Nov 15, 08:52 | **Pull request #76 reached `main` inside the same merge**: the traction report (`pnpm traction`, [docs/TRACTION.md](docs/TRACTION.md)) and the measured costs (`pnpm costs`, [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md)). Its commits, `87d8b74` to `e2495cb`, were written on Nov 14 between 21:38 and 21:47, before the deadline, but were merged after it. GitHub marks #74, #75 and #76 merged at 08:52 | [pull request #76](https://github.com/71Labs/WithGreatPower/pull/76) |
| Nov 15 | **`LLM_API_KEY` set in production**, so from then on an LLM (Kimi K3, that day) picked Sandwich Man's moves among his rules' moves. His first two LLM-picked trades landed at 13:39 | [`6cjd1ffr…`](https://nearblocks.io/txns/6cjd1ffrZUXqoafzBydwQAZmjdBAKfna9B3PNMFtZuAN) |
| Nov 15 | **This README** was rewritten to describe all of the above | `git log -- README.md` |

What pull request #77 contains, part by part:

| Part | Before the deadline | After |
|---|---|---|
| The Bits faucet | Every verified night paid in full | `nightPay` tapers a night by the Bits the hero holds: full up to 150, down to 5 at 400 (server code; live with the deploy) |
| The gas fee | 2%, burned | 5%, burned (the owner's `set_market_params`; the app reads it live) |
| Crafting | Free in Bits; the recipe's items burned | 250 Bits burned on top (same call); the Suit lab shows and checks the cost |
| Gwei's stock | 8 items, 8 pools, 4 recipe suits | 12 items, 12 pools, 6 recipe suits; the four new items are awarded for Daily Runs and case clears |
| Gwei's wanted list | Did not exist | Up to three items a day she is short on; verified nights that bring them get extra drops of those items |
| Sandwich Man's brain | His rules alone (live on mainnet since Nov 13) | Kimi K3 picks among the rules' moves or passes; the rules decide on any failure. An earlier commit in the same pull request (`ac0a285`) used Claude; it was replaced by Kimi K3 before the merge |
| The landing page | | Opens on the city's motto and the villains who are its economy |
| Docs and evidence | | [docs/ECONOMY.md](docs/ECONOMY.md) remeasured, [docs/KEYS.md](docs/KEYS.md) added, new evidence rows for all of the above |

Built inside the window, and unchanged by any of this: the contract and its market, the session keys and the relayer, the reward outbox, the season close and record code, the replay verifier and every game mode, the Gas tank, and Sandwich Man's account and rules.

## Built during the hackathon

- **New code, written during NEAR HACKATHON.** The repository's first commit is 2026-11-01 and every commit since is from the build window, which opened with the announcement on 2026-10-19 (Q-001). This repository is the whole submission, so there's no pre-hackathon diff to separate (Q-003).
- **One submission.** This is the team's only project in the hackathon (Q-015).
- **Adapted from the author's own earlier projects** (Q-005 baseline):
  - from the game *blastoff*: the fixed-step loop and input-log approach, the quality tiers, GPU check and FPS probe (`apps/wgp/src/game3d/scene/quality.ts`), WebGL context-loss recovery (`apps/wgp/src/game3d/scene/context-recovery.ts`), the camera springs (`apps/wgp/src/game3d/scene/camera/springs.ts`) and the API route helpers (`apps/wgp/src/server/http.ts`);
  - from *Vessel*, an earlier project of the author's (built Oct 30, after the announcement): the landing page's design tokens and frame (`apps/wgp/src/app/globals.css`), the shader canvas and the near-connect wallet wrapper (`apps/wgp/src/lib/near/wallet.tsx`).
- **Scaffold:** the app began as a standard Next.js 16 scaffold. No game, Web3 or UI template was used.

The hackathon's rules ([HACKATHON.md](https://nearhackathon.com/HACKATHON.md)) and where this repository meets each:

| Rule | Where |
|---|---|
| Built in the window (Q-001) | First commit 2026-11-01; the last commit before the deadline is `401d5eb`, tagged `hackathon-submission` |
| Judged on what was built in the window (Q-002) | Everything after the deadline is listed under [Changed after the deadline](#changed-after-the-deadline-nov-15-2026) |
| A new repository, or a separated diff (Q-003) | The whole repository is the submission; the tag `hackathon-submission` marks the deadline, and [hackathon-submission...main](https://github.com/71Labs/WithGreatPower/compare/hackathon-submission...main) is everything after it |
| Libraries, templates and AI-written code disclosed (Q-005) | This section and [Credits and disclosure](#credits-and-disclosure) |
| Its own contract on NEAR, fitting the track (Q-011) | `contracts/wgp`, deployed as `game.wgpnear.near` |
| A hosted demo (Q-012) | https://www.wgponnear.fun, kept up through judging |
| A license (Q-014) | [LICENSE](LICENSE), MIT |
| One submission per person (Q-015) | This is the team's only project |

## Credits and disclosure

- **AI-written code:** Claude Code (Anthropic) wrote much of this repository's code, tests, art-pipeline scripts, docs and copy under the team's direction. The team set the design and the rules, reviewed the changes, and playtested every build. No commit carries a Co-Authored-By trailer or a "Generated with Claude Code" line, so this paragraph is the disclosure.
- **AI-generated audio:** the soundtrack, sound effects and character voices were generated with ElevenLabs on the owner's paid plan (`apps/wgp/public/audio/CREDITS.md`).
- **Main libraries:**
  - App: Next.js 16 (with the React Compiler), React 19, three.js 0.187, React Three Fiber 9 and drei 10, Drizzle ORM and drizzle-kit, Neon serverless and PGlite, zod 4, Tailwind CSS 4 and Hugeicons.
  - NEAR and sign-in: near-api-js 7, @hot-labs/near-connect, Privy (`@privy-io/react-auth`, `@privy-io/node`) and the @fast-auth-near (NEAR Auth) SDKs.
  - Tests and tools: Vitest and tsx.
  - Contract: near-sdk-rs 5.30, cargo-near 0.22 and near-workspaces 0.24.
- **Services:** Vercel (hosting), Neon (Postgres), Privy (Google login and embedded NEAR keys), and the FastNEAR and NEAR public RPC endpoints.
- **Partner:** player airdrops during Season 1 are sent by the team through Uprail, outside the game; the game itself never sends money.
- **3D characters:** bodies were made with [MakeHuman](http://www.makehumancommunity.org/) through MPFB in Blender (CC0 assets; the GPL tool isn't shipped). Motion capture is from [Quaternius' Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) (CC0). See `apps/wgp/public/models/LICENSES.md`.
- **Fonts:** Neue Montreal (Pangram Pangram) is licensed and served in production but isn't in this repository; without it the site falls back to Inter. Production is deployed with `scripts/deploy-prod.sh`, which adds the font files; pushes to `main` don't deploy by themselves (`apps/wgp/vercel.json`). Inter, Manrope and Geist Mono are from Google Fonts (OFL).
- **NEAR wordmark:** from NEAR's brand files.
- **Parody:** the characters are parody designs made for this game. With Great Power isn't affiliated with, endorsed by or sponsored by any comic book publisher or film studio.
