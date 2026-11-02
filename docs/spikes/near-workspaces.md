# Spike S5: near-workspaces with near-sdk 5.30

**Result: works on the arm64 Mac.** Tested with near-workspaces 0.24, Rust 1.95 and the cargo-near 0.22 wasm.
- **First build:** about 50 s.
- **Each run:** about 10 s, including the sandbox download on first use.

The sandbox tests live in `contracts/wgp/sandbox/`, their own crate, so `cargo test` in `contracts/wgp` stays fast.

```sh
cd contracts/wgp && cargo near build non-reproducible-wasm
cd sandbox && cargo test -- --nocapture --test-threads=1
```

## What they cover
- **Deploy and set up:** deploy the real wasm, `new` with game-core's suits, a sub-account, and a function-call session key (game contract only, 0.05 NEAR allowance).
- **Play through the session key:** `register_hero`, operator `mint_rewards`, then `craft_suit` and `equip_suit`.
- **The 1-yocto rule:** a session-key `mt_transfer` with 1 yocto is refused before broadcast (function-call keys can't attach deposits), and one without the yocto fails in the contract. The full-access key's transfer succeeds.
- **Operator sizing:** a full 20-reward batch, and `record_season` for 10 players.

## Gas measured (total burnt per transaction)
| Call | Gas |
|---|---|
| `new` | 1.97 Tgas |
| `register_hero` | 2.23 Tgas |
| `mint_rewards`, 1 reward | 2.38 Tgas |
| `mint_rewards`, 20 rewards × 3 items | 9.10 Tgas |
| `craft_suit` | 2.52 Tgas |
| `equip_suit` | 2.00 Tgas |
| `mt_transfer` | 2.20 Tgas |
| `record_season`, 10 players | 6.30 Tgas |

## Found by the sandbox
A 50-reward batch failed: NEAR caps a call's logs at 16 KB, and it logged about 16.6 KB. Now:
- `mint_rewards` emits one aggregated `mt_mint` and one `reward` event per batch.
- A batch holds at most 20 rewards, each with at most 8 items and 2 badges.
- The worst case logs 12,250 bytes, pinned by the unit test `a_full_batch_fits_the_log_limit`.
