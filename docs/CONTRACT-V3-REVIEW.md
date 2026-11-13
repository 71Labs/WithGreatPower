# Contract v3: what was built, reviewed and rehearsed

Contract v3 is the next version of `contracts/wgp`. **It is not deployed, and its source is not on `main`.** `game.wgpnear.near` runs v2, and `main` holds exactly the v2 source that is deployed. v3 lives on the branch `review/contract-v3`. Upgrading is the owner's decision.

This page is a summary, on `main`, of that branch's own write-up (`docs/CONTRACT-V3.md` on the branch), so the README's claim that v3 is "built, independently reviewed and rehearsed on a copy of mainnet state" can be checked without the branch being merged. Every figure here is copied from that write-up or counted from the branch's files; nothing here was re-run for this page. To read the original:

```bash
git fetch origin review/contract-v3:review/contract-v3
git show review/contract-v3:docs/CONTRACT-V3.md
git log --oneline main..review/contract-v3
```

`pnpm evidence` checks that the branch and the commits named below exist in your clone and that the branch is not merged. In a clone without the branch it skips that check and says so.

## What v3 adds

- NEP-245's metadata extension, and the global `mt_tokens` enumeration (`src/meta.rs`, `src/mt.rs`).
- Investing in the merchant: `market_invest`, `market_withdraw`, `market_claim`, and the owner's `market_refund` (`src/invest.rs`).
- A migration from the v2 state, and a rollback build that goes back to it (`src/migrate.rs`, `rollback/`).

After an upgrade, investing arrives switched off (`invest_open` is false) and the crafting cost stays what it is on chain today (0). The owner turns each on with one call.

## The commits

Thirteen commits on Nov 12, 2026, on top of `main` at `e88271f`. The branch head is `718423d`.

| Commit | What |
|---|---|
| `e404807` | v3 state with NEP-245 metadata, token enumeration and vendor investing |
| `04d3c36` | v3 unit tests for metadata, enumeration, investing and migration |
| `fa3a59d` | Sandbox upgrade from the live v2 wasm to v3 |
| `f1bf681` | Investing starts switched off after an upgrade; `market_refund` |
| `cdb71f7` | A tested rollback build from v3 back to v2 |
| `00b2fbd` | Images and metadata for every token kind |
| `f7076e8` | v2 market arguments leave the investing rules as they are |
| `b795f7f` | `CONTRACT-V3.md`: the v3 API, investment design, costs and upgrade steps |
| `19385ec` | Rehearse the v3 upgrade on a sandbox copy of mainnet |
| `d13a8f7` | Review tests for fee shares, refund logs, a fresh migration and random v2 states |
| `7aff712` | A season and a full reward batch right after the upgrade, at the server's gas |
| `a1af2e5` | Fix: a v1 state arrives with investing off and crafting free, like a v2 one |
| `718423d` | The independent review, gas for players with heroes, storage headroom |

The last four are the review's.

## Tests on the branch

| What | Count | Where |
|---|---|---|
| Unit tests | 117: 68 from v2, 45 new, 4 from the review | `contracts/wgp/src/tests.rs`, `market_tests.rs`, `v3_tests.rs`, `v3_tests/review.rs` |
| Sandbox tests, against the built wasm | 9, in four files | `contracts/wgp/sandbox/tests/sandbox.rs` (4), `upgrade_v3.rs` (2), `review_v3.rs` (2), `mainnet_rehearsal.rs` (1) |

Two of the sandbox tests copy mainnet's contract and state with read-only queries and run only with `WGP_MAINNET_REHEARSAL=1`. The write-up records them as passing on Nov 12. They were not re-run for this page.

## The independent review (Nov 12)

A second pass by someone who did not write the code: every new line read, the tests re-run, and new tests written (`src/v3_tests/review.rs`, `sandbox/tests/review_v3.rs`).

The branch's write-up lists the findings without grading them. The severities below are the owner's reading of that list.

| Severity | Finding | State |
|---|---|---|
| None found | No way was found to lose, mint or move a player's tokens, with investing off or on. No path was found to corrupt v2 state, or to reach the investing code while `invest_open` is false: on a freshly migrated state none of the new entry points moves a Bit (`nothing_new_moves_bits_on_a_freshly_migrated_state`), and randomly generated v2 states migrate with every view unchanged (`random_v2_states_migrate_with_every_view_unchanged`). | A review of one day by one reviewer. Not an audit. |
| Low | A v1 state upgraded straight to v3 got the fresh-deploy rules: investing open, and a 50-Bit crafting cost. Mainnet is v2 and was never affected. | Fixed in `a1af2e5`: a v1 state now arrives like a v2 one. |
| Medium | Free storage balance is a precondition of every operator call, not just of the upgrade. The contract pays for storage. `record_season` needs about 0.04 NEAR free and a full reward batch up to 0.035; with less, the call fails whole, and works once the account is topped up. | Open by design. The owner checks the balance before the season's call. |
| Medium | `register_hero` is open to any account and costs the contract storage (about 0.003 NEAR each on v3, 0.0014 on v2), so the free balance can be run down from outside. | Open. The mitigation is keeping headroom on the contract account. |
| Product decision | Investing, once open, is exit liquidity for whoever holds items. Investors' Bits let the vendor buy what it otherwise couldn't. Whoever sells into a funded till is paid from it, and the investors get their Bits back only if players later buy that stock. With loot minted every night, that may be never. The contract keeps the books exactly; whether it is a fair offer is a product decision. | This is why investing stays off after an upgrade, and why the app's invest sheet states the risk before a player confirms ([INVESTING.md](INVESTING.md)). |
| Note | A session key can invest: session keys may call any method on the contract, so once investing is open a leaked key can park up to `daily_invest_bits` a day in stakes the player still owns. | Bounded by the daily cap. A nuisance, not a loss. |
| Note | Deploy only through `upgrade`. A plain deploy of the v3 wasm skips `migrate`, and every call then fails until `migrate` is called with the contract account's own key. | In the upgrade steps. |
| Note | `media` in token metadata is an absolute URL while `base_uri` is also set; a client that always joins the two would build a wrong URL. | Open. |

Not covered by the review: the app, the relayer, the scripts under `scripts/near` beyond reading them, `index_tokens` at its 100-id limit (measured at 12), and anything on mainnet itself beyond read-only views.

## Gas and storage, measured in the sandbox

| Call | Tgas burnt |
|---|---|
| `upgrade` v2 → v3 (deploy and migrate) | 64.9 |
| `mint_rewards`, a full batch of 20 rewards × 3 items, players with heroes | 15.5; 17.1 for the first batch after the upgrade (v2: 10.7) |
| `record_season`, 10 players | 9.1 to 9.8 (v2: 6.8) |
| `market_invest`, `market_withdraw`, `market_claim` | 2.8, 3.0, 2.7 |

The server attaches 100 Tgas to the two operator calls, and the relayer allows a relayed call 30 Tgas. v3's wasm is 471,553 bytes against v2's 361,935, which locks about 1.10 NEAR more for storage.

## The rehearsal on a copy of mainnet (Nov 12)

`sandbox/tests/mainnet_rehearsal.rs` copies `game.wgpnear.near`'s code and state into a local sandbox with read-only queries. Nothing is sent to mainnet and no real key is involved. In the sandbox, the owner's copy then calls `upgrade` with the v3 wasm.

- The copied state had 63 storage entries. After the upgrade, the 62 entries other than the root were byte-identical, and every v2 view answered the same.
- The v3 views answered on the real state, and a real seller's copy cancelled a listing and traded.
- v2 → v3 → rollback gave back the original state byte for byte.

The write-up calls this strong evidence, not proof: mainnet's state will have moved by the time of an upgrade, so the rehearsal has to be re-run then, and a sandbox is not mainnet's protocol version to the letter.

## Rolling back

The live v2 wasm can't be used to go back: its `migrate` refuses a v3 state. `contracts/wgp/rollback/build.sh` builds the v2 code plus a patch to `migrate.rs` that reads a v3 state and writes it back in the v2 layout. **It works only while no Bits are invested**; with stakes outstanding it refuses, so no stake is forgotten, and the stakes have to be refunded first. Once investing is open and used, the realistic way back is switching it off and fixing forward.

## What this page does not show

- That v3 works on mainnet. It has never been deployed there or on testnet.
- That the app can use all of it. The app runs v3's investing rules today only in the practice market and the simulated market ([INVESTING.md](INVESTING.md)).
- An audit.
