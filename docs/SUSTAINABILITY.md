# Sustainability

What it costs to run With Great Power, who a player has to trust today, and how both change after the hackathon. Figures are from NEAR mainnet on Nov 13, 2026 (07:23 UTC) and can be re-read with the commands in the README.

## What it costs to run

| Cost | Today | Who pays |
|---|---|---|
| Contract storage | 375 KB of code and state on `game.wgpnear.near`, which NEAR holds 3.75 NEAR against (returned if the state is deleted) | The contract account |
| Reward mints | One `mint_rewards` call covers up to 20 verified nights. 168 calls as of Nov 13, 2026 (re-run `pnpm stats`). | `operator.wgpnear.near` |
| Player actions | Each relayed call (a trade, a craft, an equip) is one meta-transaction, a fraction of a cent of gas | `relayer.wgpnear.near`, within a daily gas budget. The team funds it, and so can anyone: the Gas tank (`/gas`) refills it from Ethereum, Base, Arbitrum, Solana or Bitcoin through NEAR Intents' 1Click API ($1 to $50 at a time, 0.2% fee to 1Click, a donation that returns nothing) |
| The NPC trader | Sandwich Man signs and pays for his own market calls; they are not relayed. A call burns about 3 Tgas (his first trade burned 0.00031 NEAR), and his rules cap him at 10 actions a day, so at most about 0.003 NEAR a day. His one-off seed mint cost the operator 0.0003 NEAR. | `sandwich.wgpnear.near`, from the 0.3 NEAR the owner created it with on Nov 13, 2026 |
| New player accounts | `<name>.wgpnear.near` is created with no balance; with two keys and no contract it fits NEAR's zero-balance allowance | `wgpnear.near` |
| Hosting | Vercel and Neon Postgres; the game's 3D runs in the player's browser | The team |
| Sign-in | Privy's embedded wallets for Google players | The team |

When the relayer's available balance falls under `RELAYER_MIN_BALANCE_NEAR` (1 NEAR by default), the relay answers 503 and signed-in trades pause; players are pointed at `/gas`. 1Click delivers NEAR as wNEAR (`wrap.near`), so after a refill the owner unwraps it into the relayer's balance:

```bash
near contract call-function as-transaction wrap.near near_withdraw json-args '{"amount":"<yocto from ft_balance_of>"}' \
  prepaid-gas '10.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as relayer.wgpnear.near network-config mainnet sign-with-legacy-keychain send
```

Gas is the only cost that grows with play, and the limits on it are in code: batched mints, a per-player cap of 20 ranked nights a day, daily caps on trades and listings in the contract, and the relayer's daily gas budget.

**Runway:** the five accounts hold about 7.7 NEAR, about 4.0 of it spendable. At current traffic that lasts months. The first thing to run short is the contract's storage balance, which grows with each new player and token kind; it's the one balance to top up. On Nov 13, 2026 the owner topped it up with 1 NEAR from the relayer's account ([`FH2tpfkz…`](https://nearblocks.io/txns/FH2tpfkzDkY8MtEX6fWCmMc7E7RRndGA8nibM1ZYEjuB)), which left the contract about 1.75 NEAR free.

| Account | Holds (NEAR) | Free to spend (NEAR) |
|---|---|---|
| `game.wgpnear.near` (the contract) | 5.49 | 1.75, after the 3.75 held against storage |
| `relayer.wgpnear.near` | 0.97 | 0.97 |
| `operator.wgpnear.near` | 0.54 | 0.54 |
| `wgpnear.near` (the owner; creates player accounts) | 0.41 | 0.41 |
| `sandwich.wgpnear.near` (the NPC trader) | 0.30 | 0.30 |

## Who a player has to trust

| Trust | Today | Why it's bounded |
|---|---|---|
| The server decides which runs verify | Yes | Every verified run's seed, start save and input log are public. Anyone can replay one (`pnpm verify`) and catch a score the server shouldn't have accepted. |
| The operator key mints rewards | Yes | In the contract, the operator role can only call `mint_rewards` and `record_season`. Each mint carries the run's digest, and a per-account nonce means a replayed batch mints nothing. |
| The owner can upgrade the contract and change market settings | Yes, and its key is a hot key | `upgrade` and `set_market_params` are owner-only and visible on chain. The owner account, `wgpnear.near`, has one key, a full-access key, and today that key is in the production server's environment (`FACTORY_PRIVATE_KEY`), because the same account is the factory that creates player accounts. Whoever gets the server's secrets gets the owner's powers. |
| The session key in the browser | Limited | It can only call the game contract and can't attach a deposit, so it can't transfer any token or call an owner method. A stolen one could still trade as the player: buy from and sell to Gwei, list items, buy listings, craft and equip. So a thief can't take tokens directly but could trade them badly, for example to an accomplice's listing. Listing bounds (50–400% of the vendor's price) and the contract's caps (20 items a call, 3 open listings, and per day 40 vendor trades, 10 listings and 10 fills worth 3,000 Bits) limit that loss. The relayer carries the key's calls only for its signed-in player. |
| A player's tokens | No trust in us to hold them | They are balances under the player's own NEAR account in the game contract. Only the player's full-access key can transfer them; the session key can trade them within the caps above. |

## What changes after the hackathon

In order:

1. **Owner key to cold storage, then a timelock.** Today the owner key lives in the production environment, not in cold storage. After judging, the owner calls `set_owner` to hand `game.wgpnear.near` to a cold account whose key is on no server, and `wgpnear.near` stays the factory only. Then upgrades go behind a delay, so players can see a change before it lands. The evidence check `contract-config` asserts `owner_id` is `wgpnear.near` today and changes with that call.
2. **Run digests on chain.** Mints already carry each run's digest. Recording a daily Merkle root of verified runs, as seasons do for their final board, lets anyone prove a reward maps to a public replay.
3. **Independent verifiers.** The replay verifier is a pure function in `packages/game-core`. Anyone can run it; the next step is a second, independently run verifier whose agreement is required before a season is recorded.
4. **Fees that pay for the game.** Today the 2% trade fee is burned. A split, part burned and part to the contract's storage balance, would let trading pay for the state it creates.
5. **Seasons as the content loop.** Season 1 ends Nov 15, 00:00 UTC; at its close the board is recorded on chain with soulbound trophies for the top 10 (built and tested; the record first runs on mainnet when Season 1 closes, and is then `get_season("s1")`). Each new season can ship a ruleset, a case file and a suit set without touching earlier seasons' records, because every mode's rules are versioned and old replays stay verifiable from their git tags.

## What keeps players coming back

- **Daily reasons:** a Daily Run that's the same city for everyone, three tries, and a board that resets.
- **Something to build toward:** suits need specific loot from specific villains, and the vendor's prices depend on what everyone else farmed.
- **Other players:** ghosts of real verified runs to race, listings to buy, and invites that count only when the friend actually plays.
- **New content without new trust:** case files and City tasks are added as their own rulesets, verified by the same replay.
