# Investing in a merchant

Gwei Stacy, the Mempool Market's vendor, pays sellers only from the Bits in her till for that item. When a till can't pay for even one, her shop for that item is **broke**: closed for buying. The track's sentence is "a merchant that goes broke stops trading until someone invests in it". This page says how investing works in With Great Power, the maths, what an investor risks, and exactly where it runs today.

## What is live where

| Where | Stops when broke | Invest to reopen |
|---|---|---|
| **Mainnet** (`game.wgpnear.near`, contract v2) | **Yes.** The contract refuses a sale her till can't pay. The market shows the shop closed, with the reason. | **No.** v2 has no invest call. She reopens only when someone buys that item from her. The market says so: "Investing in a merchant is built into contract v3, which isn't live yet. Try it in the practice market." |
| **Contract v3** (branch `review/contract-v3`; [CONTRACT-V3-REVIEW.md](CONTRACT-V3-REVIEW.md)) | Yes, and it says so in a view (`market_shops`) and an event (`market_shop`) | **Built, reviewed, not deployed.** `market_invest`, `market_withdraw`, `market_claim`. Upgrading is the owner's call; after an upgrade investing arrives switched off until the owner opens it. |
| **Practice market** (any guest, in the browser) | Yes | **Yes.** The same rules, with practice Bits. Not on NEAR; nothing in it can become real. |
| **Simulated market** (a local checkout with no chain configured) | Yes | **Yes**, server-side: `POST /api/market/invest`, on the player's own Bits. |
| **`/lab/economy`** (the bot fast-forward) | Yes | **Yes**, as a showcase run: **Drain Gwei, then invest in her**. Off by default. |

The app decides which of these it is showing by asking the contract: `get_version` (v2 has no such method, and "method not found" is read as v2), remembered for five minutes. Only for v3 does the market it shows carry investing rules, and only then is an investing call ever built. The relayer asks the same question again before it relays one. Nothing sends `market_invest` to a v2 contract.

## How it works

Each item has a pool: Gwei's stock of it, her till for it, and two fixed "virtual" amounts that give the price curve its depth.

```
x = virtual items + stock        items on the curve
y = virtual Bits  + till         Bits on the curve
price = y / x
```

Only the till is real. `virtual Bits` is the part of the curve nobody has funded.

**Investing `n` Bits moves them into the till and takes the same `n` off the virtual Bits.** So `y` is unchanged, and with it the price and every quote. Investing changes what she can pay, never what she charges. Withdrawing does the reverse.

- **A stake is a claim on its own principal**, 1 Bit for 1 Bit. It is not a share of the till. Nobody else's trade or investment changes what a stake is owed.
- **A pool takes at most `virtual Bits − 1`.** With the live curves that is 479 Bits for a common item, 799 for an uncommon, 1,199 for a rare.
- **Investors earn a share of the gas fee.** Every trade with Gwei pays a 2% fee. With no investors in that item's pool, all of it is burned. With investors, half of it (`invest_fee_bps`, 5000) goes to them, split by stake, and the rest is burned. Whole Bits only; the fraction carries to the next trade. Earnings sit apart from the till and can be claimed at any time.
- **A stake is locked for an hour after each top-up** (30 seconds in the practice market, so you can try the whole thing in one sitting).
- **Caps:** 10 to 500 Bits per investment, 6 investments and 1,000 Bits per account per UTC day.
- **Closed reasons:** `broke` (the till can't pay for one item), `sold-out` (no stock), and for the whole market `paused` and `market-closed`.

The rules are one file, [`apps/wgp/src/lib/market/invest.ts`](../apps/wgp/src/lib/market/invest.ts). It mirrors [the v3 contract's investing module](https://github.com/71Labs/WithGreatPower/blob/review/contract-v3/contracts/wgp/src/invest.rs) line for line: the same integers, the same rounding, the same order of checks and the same words when it refuses.

## What you risk

The app prints these on the invest sheet, above the button, every time.

- **Your stake waits when the till is empty.** You can only withdraw Bits the till holds.
- **Withdrawals are first come, first served.** If the till holds less than all investors put in, whoever withdraws first is paid first.
- **Other players can sell loot into a till you funded and take the Bits.** They only come back when someone buys that stock, and nothing makes anyone buy it.

That last one is the real cost. An investment is what lets Gwei buy loot she otherwise couldn't; whoever sells into the funded till is paid from it. The contract keeps the books exactly (a stake is never written off), but with loot minted every night, a stake in a crowded item may wait a long time. The fast-forward shows it: in the showcase run below, investors put in 1,195 Bits over 30 days, earned 133 in fees, and at the end 1,130 of those Bits were still in her tills.

Two smaller ones, from the contract's own notes: an investor who arrives just before a large trade takes a share of that trade's fee from earlier investors (the lock and the daily caps bound it); and the owner can change the fee share and the lock, and can send stakes home, but can't take one.

## Try it

**As a guest, in the practice market** (no account):

1. Open `/play/market` signed out. The gold banner says **Practice market: not on NEAR. Sign in to trade for real.** You have 300 practice Bits, plus what your guest nights would have paid, and a copy of your loot.
2. Press **Empty Gwei's … till**. A crowd of practice sellers sells her that item, at her own prices, until her till can't pay for another. Its card now says **Closed for buying**, and **Why this price?** says why and what reopens her.
3. Press **Invest in Gwei** on that card. Read **What you risk**, then invest. The shop reopens at the same price.
4. Buy some of that item. **Your stakes in Gwei** shows the fee share coming in.
5. After 30 seconds, press **Withdraw or claim**.

Sandwich Man trades in the practice market too, by his own rules, labelled **NPC** and **Practice**. (On mainnet he trades from his own NEAR account, by the same rules: [npc-trader.md](npc-trader.md).)

**Signed in, on a local checkout** (the simulated market): the same buttons, without the banner; the server holds the book and checks every move. The lock is an hour, as in the contract; `SIM_MARKET_INVEST_LOCK_MS=5000` shortens it for local play (ignored in production).

**In the fast-forward:** open `/lab/economy`, press **Drain Gwei, then invest in her**, choose **Instant** and **Run 30 days**. Each chart's "shop" row marks the days that item's shop ended closed (a block) and the days an investor funded its till (a triangle). With seed 2026, her shops end 11 item-days closed, against 70 in the same run without investors.

## Practice gains can't become real

The practice market is a guest's own copy of the market in their browser. It exists so that someone who won't sign in can still do the track's core action. Nothing in it can turn into a token or a server save:

- **It never writes the game's save.** Practice items are the guest's saved loot plus a per-item delta kept in the practice market's own storage (`wgp:practice:v1`). A practice purchase can't be crafted with or imported, and a practice sale costs the guest none of their real loot.
- **Its code has no way out.** `practice.ts` is pure (no storage, no network). Its hook reads the save and the live prices and writes one thing, the practice key. Neither calls the server or signs anything. `practice.test.ts` checks this against the source.
- **The import on first sign-in reads the save only**, and rebuilds even that field by field under its caps: level 3, three of an item, ten items in all, no Bits. `migrate-save.test.ts` pastes a whole practice market (50,000 practice Bits, 900 practice crumbs, a stake) into a save and imports it: the server keeps the capped loot the import always allowed, mints no Bits, and the player's market wallet holds no Bits and no stake.

So the most a guest can bring across is what a guest could always bring: ten items. Practice adds nothing to it.

## Where the code is

| What | Where |
|---|---|
| The rules (stakes, fee share, lock, caps, the virtual-reserve swap, closed reasons, the risk copy) | `apps/wgp/src/lib/market/invest.ts` |
| Buys and sells booking the investors' share; `marketInvest`, `marketWithdraw`, `marketClaim` | `apps/wgp/src/lib/market/engine.ts` |
| Vectors printed by the v3 Rust, and the test that replays them (1,020 steps) | `apps/wgp/src/lib/market/invest-vectors.json`, `invest.test.ts` |
| Regenerating the vectors | `node apps/wgp/scripts/invest-vectors/generate.mjs` (needs cargo; it exports the v3 branch's contract into a temporary directory, runs one test there and deletes it) |
| The practice market | `apps/wgp/src/lib/market/practice.ts`, `apps/wgp/src/components/market/use-practice.ts` |
| The simulated market's investing, and its API route | `apps/wgp/src/server/market/sim.ts` (`simStake`), `apps/wgp/src/app/api/market/invest/route.ts` |
| Reading the contract's version and v3's views; the relayer's gate | `apps/wgp/src/server/market/chain.ts`, `relay.ts`; `apps/wgp/src/lib/near/policy.ts` (`INVEST_METHODS`) |
| The screen | `apps/wgp/src/components/market/invest.tsx`; Gwei's lines in `apps/wgp/src/lib/market/reasoning-shop.ts` |
| Investor bots and the showcase run | `apps/wgp/src/lib/market/bots.ts` (`LAB_INVESTORS`), `balance.ts` (`INVEST_SHOWCASE`) |
| The contract itself (not on this branch) | [the investing module](https://github.com/71Labs/WithGreatPower/blob/review/contract-v3/contracts/wgp/src/invest.rs) and [the v3 write-up](https://github.com/71Labs/WithGreatPower/blob/review/contract-v3/docs/CONTRACT-V3.md), both on the branch review/contract-v3 |

## Check it

```bash
pnpm --filter wgp exec vitest run src/lib/market/invest.test.ts      # the mirror against the Rust's vectors, and its properties
pnpm --filter wgp exec vitest run src/lib/market/practice.test.ts    # the practice market, and that nothing in it can become real
pnpm --filter wgp exec vitest run src/server/market/invest.test.ts   # the simulated market, and a fake chain speaking v2 and v3
pnpm --filter wgp exec vitest run src/server/market/invest-routes.test.ts # the routes: v2 refuses an investing call before anything is sent; v3 relays it
pnpm --filter wgp exec vitest run src/components/market/invest-ui.test.ts  # the screen: the risks before the button; no investing offered on v2
pnpm --filter wgp exec vitest run src/server/db/migrate-save.test.ts # the import keeps nothing of a practice market
pnpm --filter wgp exec vitest run src/lib/market/balance.test.ts     # the showcase run, and that investors are off by default
```
