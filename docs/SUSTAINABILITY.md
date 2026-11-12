# Sustainability

What it costs to run With Great Power, who a player has to trust today, and how both change after the hackathon. Figures are from NEAR mainnet on Nov 12, 2026 and can be re-read with the commands in the README.

## What it costs to run

| Cost | Today | Who pays |
|---|---|---|
| Contract storage | 374 KB of code and state on `game.wgpnear.near`, which NEAR holds 3.74 NEAR against (returned if the state is deleted) | The contract account |
| Reward mints | One `mint_rewards` call covers up to 20 verified nights. 160 calls as of Nov 12, 2026 (re-run `pnpm stats`). | `operator.wgpnear.near` |
| Player actions | Each relayed call (a trade, a craft, an equip) is one meta-transaction, a fraction of a cent of gas | `relayer.wgpnear.near`, within a daily gas budget |
| New player accounts | `<name>.wgpnear.near` is created with no balance; with two keys and no contract it fits NEAR's zero-balance allowance | `wgpnear.near` |
| Hosting | Vercel and Neon Postgres; the game's 3D runs in the player's browser | The team |
| Sign-in | Privy's embedded wallets for Google players | The team |

Gas is the only cost that grows with play, and the limits on it are in code: batched mints, a per-player cap of 20 ranked nights a day, daily caps on trades and listings in the contract, and the relayer's daily gas budget.

**Runway:** the accounts hold about 8 NEAR, about 4.2 of it spendable. At current traffic that lasts months. The first thing to run short is the contract's storage balance, which grows with each new player and token kind; it's the one balance to top up.

## Who a player has to trust

| Trust | Today | Why it's bounded |
|---|---|---|
| The server decides which runs verify | Yes | Every verified run's seed, start save and input log are public. Anyone can replay one (`pnpm verify`) and catch a score the server shouldn't have accepted. |
| The operator key mints rewards | Yes | In the contract, the operator role can only call `mint_rewards` and `record_season`. Each mint carries the run's digest, and a per-account nonce means a replayed batch mints nothing. |
| The owner can upgrade the contract and change market settings | Yes | `upgrade` and `set_market_params` are owner-only and visible on chain. |
| The session key in the browser | Limited | It can only call the game contract, can't attach a deposit, and so can't transfer any token. Listing bounds (50–400% of the vendor's price) and daily caps limit what a stolen key could do. |
| A player's tokens | No trust needed | They sit in the player's own NEAR account. Only the player's full-access key can transfer them. |

## What changes after the hackathon

In order:

1. **Owner key to cold storage, then a timelock.** Move ownership of `game.wgpnear.near` off the build machine, then put upgrades behind a delay so players can see a change before it lands.
2. **Run digests on chain.** Mints already carry each run's digest. Recording a daily Merkle root of verified runs, as seasons do for their final board, lets anyone prove a reward maps to a public replay.
3. **Independent verifiers.** The replay verifier is a pure function in `packages/game-core`. Anyone can run it; the next step is a second, independently run verifier whose agreement is required before a season is recorded.
4. **Fees that pay for the game.** Today the 2% trade fee is burned. A split, part burned and part to the contract's storage balance, would let trading pay for the state it creates.
5. **Seasons as the content loop.** Season 1 ends Nov 14; at its close the board is recorded on chain with soulbound trophies for the top 10 (built and tested, not run on mainnet yet). Each new season can ship a ruleset, a case file and a suit set without touching earlier seasons' records, because every mode's rules are versioned and old replays stay verifiable from their git tags.

## What keeps players coming back

- **Daily reasons:** a Daily Run that's the same city for everyone, three tries, and a board that resets.
- **Something to build toward:** suits need specific loot from specific villains, and the vendor's prices depend on what everyone else farmed.
- **Other players:** ghosts of real verified runs to race, listings to buy, and invites that count only when the friend actually plays.
- **New content without new trust:** case files and City tasks are added as their own rulesets, verified by the same replay.
