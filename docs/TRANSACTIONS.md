# Every transaction of the game's accounts on NEAR mainnet

Generated 2026-11-15T17:22:35Z (UTC) by `pnpm txs` (scripts/transactions.mjs). This file is generated: edit scripts/transactions.mjs, not this file, and run `pnpm txs` to bring it up to date.

**Source.** The NearBlocks API (https://api.nearblocks.io/v1), read-only and with no key: every page of `/account/<id>/txns-only` (the transactions each account below signed or received) for `game.wgpnear.near`, `wgpnear.near`, `relayer.wgpnear.near`, `operator.wgpnear.near`, `sandwich.wgpnear.near`, and every page of `/account/game.wgpnear.near/txns` (the receipts the contract received). Each hash links to its page on nearblocks.io. Times are UTC, from the block that included the transaction; a receipt's row carries its transaction's time.

**How rows are attributed.** A relayed call (a NEP-366 meta-transaction) is listed under the player whose key signed the delegate action, which is the receipt's predecessor and the account `pnpm stats` counts, and the relayer that signed and paid for the outer transaction is named beside it in the Sent by column. Accounts carry the labels `pnpm stats` and `pnpm traction` give them: author (sele.wgpnear.near, sele71.near), team (wgpnear.near, operator.wgpnear.near, relayer.wgpnear.near), NPC (sandwich.wgpnear.near, Sandwich Man) and contract (game.wgpnear.near). Every other account is a player, so the player columns never include the author's or the team's calls.

**Failures.** Failed transactions and failed receipts are listed with the rest and marked failed; none is left out of a table or a count. A relayed transaction can succeed as a transaction while the contract call inside it fails; such a row says "failed in contract".

## Summary

| | |
|---|---|
| Distinct transactions | 368 (3 failed) |
| Receipts `game.wgpnear.near` received or sent (rows in its table) | 336 (4 failed) |
| Game-method calls by players (not author, team or NPC) | 82 from 17 accounts |
| Relayed calls (NEP-366, sent by `relayer.wgpnear.near`) | 84 |
| First transaction | 2026-11-03 15:50:27 [`8tRgGW8GPwS6EJwaDGaZ4mfyGTkXwJWXCq46UF1u9g8v`](https://nearblocks.io/txns/8tRgGW8GPwS6EJwaDGaZ4mfyGTkXwJWXCq46UF1u9g8v) |
| Last transaction | 2026-11-15 16:46:25 [`52Bwnm4H6MoPfbDGD62RNPQkozs9NpyNGZRnHSLLkxfc`](https://nearblocks.io/txns/52Bwnm4H6MoPfbDGD62RNPQkozs9NpyNGZRnHSLLkxfc) |

### Per account

| Account | Label | Transactions | Failed | First (UTC) | Last (UTC) | Read to the end |
|---|---|--:|--:|---|---|---|
| [`game.wgpnear.near`](#gamewgpnearnear) | contract | 248 | 1 | 2026-11-03 15:50:27 | 2026-11-15 16:30:16 | yes (3 pages) |
| [`wgpnear.near`](#wgpnearnear) | team | 39 | 0 | 2026-11-03 15:50:27 | 2026-11-15 08:27:51 | yes (1 page) |
| [`relayer.wgpnear.near`](#relayerwgpnearnear) | team | 88 | 2 | 2026-11-03 15:50:41 | 2026-11-15 16:46:25 | yes (1 page) |
| [`operator.wgpnear.near`](#operatorwgpnearnear) | team | 238 | 0 | 2026-11-03 15:50:55 | 2026-11-15 16:30:16 | yes (3 pages) |
| [`sandwich.wgpnear.near`](#sandwichwgpnearnear) | NPC | 4 | 0 | 2026-11-13 07:03:12 | 2026-11-15 13:39:45 | yes (1 page) |

"Transactions" are those the account signed or received (NearBlocks' `txns-only`). The contract's relayed calls are transactions to the player's account, so they are counted under `relayer.wgpnear.near` and appear in the contract's table by their receipts.

### Per method of the contract

| Method | Calls | Failed | Relayed | Callers | Player | Author | Team | NPC | Contract | System |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| [`register_hero`](#register_hero) | 19 | 1 | 19 | 18 | 18 | 1 | 0 | 0 | 0 | 0 |
| [`craft_suit`](#craft_suit) | 17 | 0 | 17 | 5 | 17 | 0 | 0 | 0 | 0 | 0 |
| [`equip_suit`](#equip_suit) | 7 | 0 | 7 | 3 | 7 | 0 | 0 | 0 | 0 | 0 |
| [`market_buy`](#market_buy) | 17 | 0 | 14 | 5 | 13 | 1 | 0 | 3 | 0 | 0 |
| [`market_sell`](#market_sell) | 15 | 0 | 15 | 3 | 15 | 0 | 0 | 0 | 0 | 0 |
| [`list_item`](#list_item) | 7 | 0 | 7 | 3 | 7 | 0 | 0 | 0 | 0 | 0 |
| [`buy_listing`](#buy_listing) | 4 | 1 | 4 | 1 | 4 | 0 | 0 | 0 | 0 | 0 |
| [`cancel_listing`](#cancel_listing) | 1 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| [`mint_rewards`](#mint_rewards) | 235 | 0 | 0 | 1 | 0 | 0 | 235 | 0 | 0 | 0 |
| [`record_season`](#record_season) | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| [`deploy_contract`](#deploy_contract) | 2 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 0 |
| [`set_rules`](#set_rules) | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| [`set_market_params`](#set_market_params) | 2 | 0 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 |
| [`storage_deposit`](#storage_deposit) | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| [`(create_account + transfer + add_key)`](#create_account--transfer--add_key) | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| [`(transfer)`](#transfer) | 6 | 1 | 0 | 3 | 0 | 0 | 1 | 0 | 1 | 4 |
| **All** | **336** | **4** | **84** | | **82** | **2** | **241** | **3** | **4** | **4** |

One row per function call (a receipt with two calls is two rows); a receipt with no function call (the account's creation, a transfer) is one row under its actions in brackets; a deploy is one row under `deploy_contract` with the call that came with it. The label columns count calls by the caller's label; System is `system`, the protocol account that sends gas refunds.

### Per UTC day

| Day | Transactions | Failed | Contract receipts | Player calls |
|---|--:|--:|--:|--:|
| 2026-11-03 | 11 | 1 | 10 | 0 |
| 2026-11-04 | 1 | 0 | 1 | 0 |
| 2026-11-06 | 60 | 1 | 56 | 23 |
| 2026-11-07 | 58 | 0 | 46 | 7 |
| 2026-11-08 | 47 | 1 | 42 | 11 |
| 2026-11-09 | 30 | 0 | 24 | 4 |
| 2026-11-10 | 25 | 0 | 25 | 5 |
| 2026-11-11 | 5 | 0 | 5 | 0 |
| 2026-11-12 | 32 | 0 | 31 | 17 |
| 2026-11-13 | 10 | 0 | 8 | 0 |
| 2026-11-14 | 30 | 0 | 30 | 0 |
| 2026-11-15 | 59 | 0 | 58 | 15 |

Days with no transaction are left out. "Player calls" are the game methods (`register_hero`, `craft_suit`, `equip_suit`, `market_buy`, `market_sell`, `list_item`, `buy_listing`, `cancel_listing`) called by player accounts.

## Milestones

Found in the rows below by what they did, not typed in by hand.

| UTC time | What | By | Result | Transaction |
|---|---|---|---|---|
| 2026-11-03 15:50:27 | `game.wgpnear.near` is created | `wgpnear.near` (team) | ok | [`8tRgGW8GPwS6EJwaDGaZ4mfyGTkXwJWXCq46UF1u9g8v`](https://nearblocks.io/txns/8tRgGW8GPwS6EJwaDGaZ4mfyGTkXwJWXCq46UF1u9g8v) |
| 2026-11-03 16:03:02 | Code deployed to the contract, deploy 1 of 2 (deploy_contract + new) | `game.wgpnear.near` (contract) | **failed** | [`3h6JxxeZofE6rqZEx5WV8XjqLJWnGZeKjcuX6j7GFLJd`](https://nearblocks.io/txns/3h6JxxeZofE6rqZEx5WV8XjqLJWnGZeKjcuX6j7GFLJd) |
| 2026-11-03 17:10:05 | Code deployed to the contract, deploy 2 of 2 (deploy_contract + new) | `game.wgpnear.near` (contract) | ok | [`8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR`](https://nearblocks.io/txns/8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR) |
| 2026-11-03 17:10:16 | `set_market_params`: fee 2% (fee_bps 200), craft 0 Bits, 8 pools (fee-bomb, goblin-glider, crumbs, sesame-seed, chain-link, spare-arm, sybil-goo, press-pass) | `wgpnear.near` (team) | ok | [`FdQxVNyziV7ioNWPAfL9yAWJ8u2wDN3kRKpEX4JSVcCR`](https://nearblocks.io/txns/FdQxVNyziV7ioNWPAfL9yAWJ8u2wDN3kRKpEX4JSVcCR) |
| 2026-11-03 18:33:28 | First relayed call (signed by the player, sent by `relayer.wgpnear.near`) | `sele.wgpnear.near` (author), sent by `relayer.wgpnear.near` (team) | ok | [`GxuFQYCX7DzCFRXenpQuhfxz1hUekf9t2FapLjCUeMXn`](https://nearblocks.io/txns/GxuFQYCX7DzCFRXenpQuhfxz1hUekf9t2FapLjCUeMXn) |
| 2026-11-03 18:33:28 | First relayed market trade | `sele.wgpnear.near` (author), sent by `relayer.wgpnear.near` (team) | ok | [`GxuFQYCX7DzCFRXenpQuhfxz1hUekf9t2FapLjCUeMXn`](https://nearblocks.io/txns/GxuFQYCX7DzCFRXenpQuhfxz1hUekf9t2FapLjCUeMXn) |
| 2026-11-06 07:53:57 | First hero registered (any account) | `azalleaxyz.wgpnear.near`, sent by `relayer.wgpnear.near` (team) | ok | [`6H2hdWkb3jKEX22dM33AMnpLJ6ei8C8KFqG9MbpH2BtY`](https://nearblocks.io/txns/6H2hdWkb3jKEX22dM33AMnpLJ6ei8C8KFqG9MbpH2BtY) |
| 2026-11-06 07:53:57 | First player's hero (not the author's, the team's or the NPC's) | `azalleaxyz.wgpnear.near`, sent by `relayer.wgpnear.near` (team) | ok | [`6H2hdWkb3jKEX22dM33AMnpLJ6ei8C8KFqG9MbpH2BtY`](https://nearblocks.io/txns/6H2hdWkb3jKEX22dM33AMnpLJ6ei8C8KFqG9MbpH2BtY) |
| 2026-11-06 08:35:00 | First relayed market trade by a player (not the author's, the team's or the NPC's) | `azalleaxyz.wgpnear.near`, sent by `relayer.wgpnear.near` (team) | ok | [`GXsZ5kk4jz5LcdcLs5CWEvxKxew1AexHH41gtDouNpw2`](https://nearblocks.io/txns/GXsZ5kk4jz5LcdcLs5CWEvxKxew1AexHH41gtDouNpw2) |
| 2026-11-13 07:03:12 | Sandwich Man's account `sandwich.wgpnear.near` is created | `wgpnear.near` (team) | ok | [`Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm`](https://nearblocks.io/txns/Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm) |
| 2026-11-13 07:12:14 | Sandwich Man's one-off seed (`mint_rewards` to him) | `operator.wgpnear.near` (team) | ok | [`HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7) |
| 2026-11-13 07:15:07 | Sandwich Man's first trade | `sandwich.wgpnear.near` (NPC) | ok | [`AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf) |
| 2026-11-15 01:26:36 | `record_season` for s1: root and digest written, 10 trophies minted (trophy:s1:1 to azalleaxyz.wgpnear.near, trophy:s1:2 to 9a_z53.wgpnear.near, trophy:s1:3 to hossinshabani1389.wgpnear.near, trophy:s1:4 to nasibabalili7.wgpnear.near, trophy:s1:5 to rezau641.wgpnear.near, trophy:s1:6 to cybwithflourish.near, trophy:s1:7 to ambactamwkwk.near, trophy:s1:8 to zhw_zx.tg, trophy:s1:9 to fulaj.near, trophy:s1:10 to tmt027.wgpnear.near) | `operator.wgpnear.near` (team) | ok | [`AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX) |
| 2026-11-15 08:27:28 | `set_rules`: 12 items, 10 suits | `wgpnear.near` (team) | ok | [`GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY) |
| 2026-11-15 08:27:51 | `set_market_params`: fee 5% (fee_bps 500), craft 250 Bits, 12 pools, 4 of them new (gas-receipt, finality-flag, evidence-bag, seed-phrase) | `wgpnear.near` (team) | ok | [`BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK) |

## `game.wgpnear.near`

Every receipt the contract received or sent, grouped by method, oldest first. Caller is the receipt's predecessor; Sent by is the transaction's signer when it is another account (the relayer for a relayed call).

### `register_hero`

19 calls, 1 failed, 19 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-06 07:53:57 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6H2hdWkb…`](https://nearblocks.io/txns/6H2hdWkb3jKEX22dM33AMnpLJ6ei8C8KFqG9MbpH2BtY) |
| 2 | 2026-11-06 08:32:59 | `danielgreat438.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`BWAFmGyg…`](https://nearblocks.io/txns/BWAFmGygHCLdu7ZMzc3pfvQKcRdb732yyL42zdWmCwrz) |
| 3 | 2026-11-06 10:49:04 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`2xZZRYKE…`](https://nearblocks.io/txns/2xZZRYKEnXgAD6TGQzGSLhDeE4FfYj6LerYB8wuakmnB) |
| 4 | 2026-11-06 17:59:54 | `tmt027.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`2q2Ecrt5…`](https://nearblocks.io/txns/2q2Ecrt5wKw6E9HoBMqSTC6rLVhBuB9GaT4HoJD1zMPW) |
| 5 | 2026-11-06 17:59:58 | `tmt027.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | **failed** | [`7sJSe7Xq…`](https://nearblocks.io/txns/7sJSe7XqTWvKfk58NS5eWvqTinnzENr85M5a7g8RTyFq) |
| 6 | 2026-11-07 06:39:45 | `sele.wgpnear.near` (author) | `relayer.wgpnear.near` (team), relayed | ok | [`4gZgoayL…`](https://nearblocks.io/txns/4gZgoayLbxP2whPgEK5FWi62JZZMUuRZmsgu7D5BgATM) |
| 7 | 2026-11-07 12:16:24 | `eminence.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`5DhqdLnz…`](https://nearblocks.io/txns/5DhqdLnzjmR2db8RANHoTBboV3xXmpczhAj1vKHsaPWv) |
| 8 | 2026-11-07 14:28:46 | `unrealami.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`9DV4hmtA…`](https://nearblocks.io/txns/9DV4hmtAgeqEgZcafjoyLkozfUQo6paFySev7Uw8Vwf2) |
| 9 | 2026-11-07 16:45:06 | `tiamiyufuhad07.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`7aTFPKHr…`](https://nearblocks.io/txns/7aTFPKHrjLtWzdS5R8LjJrHuetPYH874EHjWnB6u7LAZ) |
| 10 | 2026-11-07 19:00:40 | `miracleigbinoghene.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`5ZRBSMUa…`](https://nearblocks.io/txns/5ZRBSMUa6fBQpiczCp9Giai8RcZDRw7mAVdcwLioR5RR) |
| 11 | 2026-11-08 01:55:00 | `nsymm073.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6pL8jqaW…`](https://nearblocks.io/txns/6pL8jqaWM7Y9T9y29VTmZEXgHzpNaFxpoHc9jtxrKTWk) |
| 12 | 2026-11-08 06:23:21 | `nasibabalili7.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6TYcVCHt…`](https://nearblocks.io/txns/6TYcVCHtBJsNwd7U74VT4zfsCktpB81v4Q5fR3YtbmJy) |
| 13 | 2026-11-08 09:13:31 | `alirezam2300.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`9yHZsqSz…`](https://nearblocks.io/txns/9yHZsqSzs1tMqZqDxz27SgrSMbxECcacHZ2B4CGY12oX) |
| 14 | 2026-11-08 09:57:36 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`HqcboLRR…`](https://nearblocks.io/txns/HqcboLRRPkvM5czQzZPZYR8pVxGK3ZT1yK4N9C4MBUnQ) |
| 15 | 2026-11-08 14:37:23 | `mohsenmanm.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`4rW2i7Mn…`](https://nearblocks.io/txns/4rW2i7Mnk3AN6CGtziRFRAwimzjq55wqkGiANgkohLnG) |
| 16 | 2026-11-09 09:27:21 | `dominic_jovinic.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`3Hq4wWZs…`](https://nearblocks.io/txns/3Hq4wWZsVZ3JfzwDkPgDtxuP7vcvdsQaxwb2FiR2v33B) |
| 17 | 2026-11-09 14:26:47 | `jamesutibeabassi.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`Ag3kHD7x…`](https://nearblocks.io/txns/Ag3kHD7xyx8WZJkUCT7XzrFeSv4KWaKZZgGrbdn8hmhH) |
| 18 | 2026-11-10 17:35:03 | `cybwithflourish.near` | `relayer.wgpnear.near` (team), relayed | ok | [`7dnP8eU7…`](https://nearblocks.io/txns/7dnP8eU7W8b9LdQeZztnttzai5uUc7gHAea4hEeoXnnq) |
| 19 | 2026-11-12 19:06:02 | `rezau641.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`E7wemry8…`](https://nearblocks.io/txns/E7wemry8AhLZyVgDaMrJHYJ7tBpWx5BBeSfs3gqmazJU) |

### `craft_suit`

17 calls, 0 failed, 17 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-06 08:29:47 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`HLpan7DQ…`](https://nearblocks.io/txns/HLpan7DQxbGW5cd4W7Gret6ULKTZA8hBvnvX63ywTacg) |
| 2 | 2026-11-06 08:29:51 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`HiDVcMPF…`](https://nearblocks.io/txns/HiDVcMPFdybazmLvPs7wGTckxPRy3TXjuaQbyNRWYJJ5) |
| 3 | 2026-11-06 08:29:54 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`CNhZ5nDH…`](https://nearblocks.io/txns/CNhZ5nDHjEkkjXdySU8y8bTVeHgPhcsV8ewQoY1y5Diq) |
| 4 | 2026-11-06 08:29:57 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`9vMrQz51…`](https://nearblocks.io/txns/9vMrQz51GUu4QNcVFnrt3bxvGReDEht7x4cGBHW81BLe) |
| 5 | 2026-11-06 08:30:00 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`er8xveXX…`](https://nearblocks.io/txns/er8xveXX29D7Rt56h29kUkYtoX7QUiQSBS3LNzcyvPS) |
| 6 | 2026-11-06 08:44:36 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`DsDXXhgD…`](https://nearblocks.io/txns/DsDXXhgDpdYyypBWXaQ3jPDT2wmNnvX4bdPvGGicEwwG) |
| 7 | 2026-11-06 08:44:39 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`2fh7hjMH…`](https://nearblocks.io/txns/2fh7hjMHVGC7hrQGHJvRjaKDhGz2MuFxtzdGymrgs3Nw) |
| 8 | 2026-11-06 10:53:32 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`82C29gRb…`](https://nearblocks.io/txns/82C29gRbcCPoNpWJ6vHMkfWJeUGKxyiGvbmXdSJfirjg) |
| 9 | 2026-11-06 12:31:14 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`AkEeFXFD…`](https://nearblocks.io/txns/AkEeFXFD2iq2nCoqrV336htAULzQigKCZNCS4K1J68nw) |
| 10 | 2026-11-06 12:31:22 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`EhZd1XpF…`](https://nearblocks.io/txns/EhZd1XpFVkY9Uhfta5ZJqHQu85N6WAvB7nE55nAiF9ti) |
| 11 | 2026-11-06 12:31:25 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`DU7d4WXx…`](https://nearblocks.io/txns/DU7d4WXx7pNxJKm1PYmhev5b6HMzghPnDugHW6mfTjdm) |
| 12 | 2026-11-06 12:31:29 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`23dzqYCu…`](https://nearblocks.io/txns/23dzqYCuEg5RNZjyKYFWGGDyWgoWuHsy7q4BDfKJaN2s) |
| 13 | 2026-11-06 17:13:40 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`7fYmhfbF…`](https://nearblocks.io/txns/7fYmhfbFb3Ssm5jMZn2Rc8nH6dDREaJKK8Z3VcJDYxeG) |
| 14 | 2026-11-08 18:05:19 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`CwG99bb9…`](https://nearblocks.io/txns/CwG99bb9fA55F59rt1sj8rjGF92MPmq6BM5k7Gv9kNsx) |
| 15 | 2026-11-09 10:16:09 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`3ttQYUBr…`](https://nearblocks.io/txns/3ttQYUBrA8CbKu1s7VuvNA8QAxMMfHsTJGHrKi4AZqjc) |
| 16 | 2026-11-10 08:43:05 | `nasibabalili7.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`AfRNvujJ…`](https://nearblocks.io/txns/AfRNvujJ43dmk9Rj9LzzCZUxWqU4UnkvozaqWqtN2eq2) |
| 17 | 2026-11-15 03:30:39 | `rezau641.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`FteSZSEP…`](https://nearblocks.io/txns/FteSZSEPaGfy8NM4M7h3khKcib9rF7ApqkzsyWAPWqFP) |

### `equip_suit`

7 calls, 0 failed, 7 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-06 08:30:05 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`3deMuBXT…`](https://nearblocks.io/txns/3deMuBXTex491aaRTopWUdA19hFAZE43DB8rhwg2SPeJ) |
| 2 | 2026-11-06 08:44:42 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`EJtZ86Uk…`](https://nearblocks.io/txns/EJtZ86Uk6jtmK2GFknuzbfcphLJw36UkqdGzfY73FLxw) |
| 3 | 2026-11-07 02:50:53 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`hptQiXTN…`](https://nearblocks.io/txns/hptQiXTNCVXWZ6nZUd9a8yNbjthKq4tagc3x3eLLGGP) |
| 4 | 2026-11-07 14:01:56 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`3zxEHo8w…`](https://nearblocks.io/txns/3zxEHo8wkGU87SZSLWkGT1RzB11ybZRbLighxeQbJhz9) |
| 5 | 2026-11-08 04:00:48 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`2Y4D7eXS…`](https://nearblocks.io/txns/2Y4D7eXS1L861WEjiAFDaFiQLdUzSbgfnjPgnZEaTpq3) |
| 6 | 2026-11-10 06:25:33 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`AhF5uosx…`](https://nearblocks.io/txns/AhF5uosxzTMnA7aJwooW7wxhoTqTNN8ipNteT2vUhXo9) |
| 7 | 2026-11-10 08:42:57 | `nasibabalili7.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`C2WwQsHy…`](https://nearblocks.io/txns/C2WwQsHyHNBZLrkN1JaVDGZuuf9aYaBJGqvyMSLvRvRp) |

### `market_buy`

17 calls, 0 failed, 14 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-03 18:33:28 | `sele.wgpnear.near` (author) | `relayer.wgpnear.near` (team), relayed | ok | [`GxuFQYCX…`](https://nearblocks.io/txns/GxuFQYCX7DzCFRXenpQuhfxz1hUekf9t2FapLjCUeMXn) |
| 2 | 2026-11-06 17:13:28 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`ASmRJdKZ…`](https://nearblocks.io/txns/ASmRJdKZy3fMPAPNNogcABL4Wdr7CiPPasAxRjXr5xRq) |
| 3 | 2026-11-12 14:59:28 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`4tBL1YK2…`](https://nearblocks.io/txns/4tBL1YK27sMPZEK6z33HimtvD7KPgKFFosFDYs8JJUVc) |
| 4 | 2026-11-12 15:00:21 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`7V9mmXbU…`](https://nearblocks.io/txns/7V9mmXbUn4yQfUtovDjci1jmbtjR5su9WCCxdqaa7iVx) |
| 5 | 2026-11-12 15:00:29 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`DX1FNcZw…`](https://nearblocks.io/txns/DX1FNcZwjb2H8JPRhqtebdEYnBhCXjdDoPbc9hbxUe4K) |
| 6 | 2026-11-12 15:00:36 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`C5nPx4Xp…`](https://nearblocks.io/txns/C5nPx4XpFAgge5iTL2Pg14RxDj3ZvaudRJYCPv5mAwdv) |
| 7 | 2026-11-12 15:00:47 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`8Tx7pmyQ…`](https://nearblocks.io/txns/8Tx7pmyQR7jXmdrx3p1egxdDBQ8vJBmYDxeQQQK6M7ty) |
| 8 | 2026-11-12 15:00:53 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`8WpJnj7j…`](https://nearblocks.io/txns/8WpJnj7j7poENPLZJUoS3bjVtDwdi7HHKGSz7Zys7HL3) |
| 9 | 2026-11-12 15:01:01 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`EFTMLUca…`](https://nearblocks.io/txns/EFTMLUcaeKzxLYwLW6EhVG76cAHBoxdVYa2Lf4DPK2Yi) |
| 10 | 2026-11-12 15:01:06 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`GJXrKe2o…`](https://nearblocks.io/txns/GJXrKe2oNjbTvxG2HyMt4DeTBXNPxGVRBbXsUrzv2TPJ) |
| 11 | 2026-11-13 07:15:07 | `sandwich.wgpnear.near` (NPC) | itself | ok | [`AcmNAmHr…`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf) |
| 12 | 2026-11-15 12:40:02 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`J5ybxqLa…`](https://nearblocks.io/txns/J5ybxqLaHtWXERaMDYDR7CMLnZad3aDEe1GUL6kUEaaB) |
| 13 | 2026-11-15 13:39:16 | `sandwich.wgpnear.near` (NPC) | itself | ok | [`6cjd1ffr…`](https://nearblocks.io/txns/6cjd1ffrZUXqoafzBydwQAZmjdBAKfna9B3PNMFtZuAN) |
| 14 | 2026-11-15 13:39:45 | `sandwich.wgpnear.near` (NPC) | itself | ok | [`JBeyLRzB…`](https://nearblocks.io/txns/JBeyLRzBiimh6mZuugN7YQTYQQMjdCMfCL9EQJWe3kfj) |
| 15 | 2026-11-15 16:45:30 | `cybwithflourish.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6iDy6SPJ…`](https://nearblocks.io/txns/6iDy6SPJaaZbbY47vtkDHuwJnKVPMEuETC5XEPWpVfDv) |
| 16 | 2026-11-15 16:46:06 | `cybwithflourish.near` | `relayer.wgpnear.near` (team), relayed | ok | [`76MMVwv6…`](https://nearblocks.io/txns/76MMVwv6w62qkZ9pYbFyhDcb4a6UyhZ74NXNaW74Wssc) |
| 17 | 2026-11-15 16:46:25 | `cybwithflourish.near` | `relayer.wgpnear.near` (team), relayed | ok | [`52Bwnm4H…`](https://nearblocks.io/txns/52Bwnm4H6MoPfbDGD62RNPQkozs9NpyNGZRnHSLLkxfc) |

### `market_sell`

15 calls, 0 failed, 15 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-08 12:38:17 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`GDATLg4Q…`](https://nearblocks.io/txns/GDATLg4Qr2cqQZ9S5uaRwZJTup4Y54P7uPyzJzFGaqXE) |
| 2 | 2026-11-12 16:53:10 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`41dHyQwo…`](https://nearblocks.io/txns/41dHyQwomopU57rLYFMssLNwkwqz1T4bpPrdMY1TtoZ7) |
| 3 | 2026-11-12 16:53:34 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`FA7Asacc…`](https://nearblocks.io/txns/FA7AsaccSbfUDtqvCrdcEvKT3XBctFDjf54tjkxnZsQZ) |
| 4 | 2026-11-12 18:42:32 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`5k6eyTUA…`](https://nearblocks.io/txns/5k6eyTUADgzJiPK19QSKCpkbkYXFXNPdHzSr1wHvYz8E) |
| 5 | 2026-11-12 18:42:49 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`DzcRdRKx…`](https://nearblocks.io/txns/DzcRdRKx1zfbnwn7HF8S55f9Hm19CNRn1FeQrTyVQA4p) |
| 6 | 2026-11-15 11:40:59 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`FMs6FpRF…`](https://nearblocks.io/txns/FMs6FpRFwYaqX6PuZFFxkUq1t8mrSTMCaVbEZNBqhxF7) |
| 7 | 2026-11-15 11:43:55 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`GpTvi7hd…`](https://nearblocks.io/txns/GpTvi7hdmpWqvqAikqB4J93UkVxQmwnefvxiGST4R3CQ) |
| 8 | 2026-11-15 12:43:10 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`F33R4mHj…`](https://nearblocks.io/txns/F33R4mHjUgaxrsGsNpnbaw6AHxM8xVyk8hSCfkUS3LHw) |
| 9 | 2026-11-15 12:43:36 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`FHngULVU…`](https://nearblocks.io/txns/FHngULVUb2xyNabNJojvAMQjFUFkkTZmxfxzXotXdgCa) |
| 10 | 2026-11-15 13:39:05 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`E2DgnkgA…`](https://nearblocks.io/txns/E2DgnkgAT8hvSZSHTHUep8fVRSoQZN67WRN5adevPCxH) |
| 11 | 2026-11-15 13:39:28 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`B1eoz5Ep…`](https://nearblocks.io/txns/B1eoz5Eph5mbJQUfkY53j5oJ6gdJirE1EDnn5e7E1KmR) |
| 12 | 2026-11-15 14:57:16 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`39VmKQAS…`](https://nearblocks.io/txns/39VmKQASfdeuGdvyrFk6ktxowcKxRYNs2CLuX7DwCyap) |
| 13 | 2026-11-15 14:57:23 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`2LVsdSeM…`](https://nearblocks.io/txns/2LVsdSeMmBjr3Aue4uYYFUQw1ZSxJeZRhrENwUiWLFEQ) |
| 14 | 2026-11-15 14:58:47 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`56vwXBYV…`](https://nearblocks.io/txns/56vwXBYVHB4dud4JeXSzRVZN4sX442Y2SAD4E9yrfsDH) |
| 15 | 2026-11-15 14:59:06 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6cLKUTwb…`](https://nearblocks.io/txns/6cLKUTwb28WbH2dJcrQQ5m3359Ri9kBuzkghwroyqBxq) |

### `list_item`

7 calls, 0 failed, 7 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-06 08:35:00 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`GXsZ5kk4…`](https://nearblocks.io/txns/GXsZ5kk4jz5LcdcLs5CWEvxKxew1AexHH41gtDouNpw2) |
| 2 | 2026-11-06 08:35:30 | `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`Cp6ukdoG…`](https://nearblocks.io/txns/Cp6ukdoGwcmPS6JxyTBeBpjg5UtKiutwnYyBf54YuMnE) |
| 3 | 2026-11-07 02:11:02 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`8tK8yxJc…`](https://nearblocks.io/txns/8tK8yxJciaq75EEP8eTxyB62CtEvo33Ve1c8tFAjHWQh) |
| 4 | 2026-11-09 09:59:44 | `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`GhK2jtPK…`](https://nearblocks.io/txns/GhK2jtPKtNpHgjcn93eYRiFjF72mcMcFzbfHqYbnM9tx) |
| 5 | 2026-11-12 15:32:42 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6aLadFrH…`](https://nearblocks.io/txns/6aLadFrHXtwygHGqxKNEwzmGS1JKnAhcvxUGcDDUTNon) |
| 6 | 2026-11-12 15:33:01 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6qhAmeDs…`](https://nearblocks.io/txns/6qhAmeDsgcci2qUY4g9tMF78JYnsxCo88tLifhdcHJMC) |
| 7 | 2026-11-12 15:33:50 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6hkmVeAL…`](https://nearblocks.io/txns/6hkmVeALiC1iBRidQj8db9V5Q2tP2iBMPpGrTMumMZJB) |

### `buy_listing`

4 calls, 1 failed, 4 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-08 10:39:21 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`E5RtQwdA…`](https://nearblocks.io/txns/E5RtQwdAC1wGcGxGBGvEZiyfVv6pnuiCjDWEN6wHM9g6) |
| 2 | 2026-11-08 10:39:28 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`6QuTjsxe…`](https://nearblocks.io/txns/6QuTjsxeeGV2SWX7QA1dVWLTEjcHr58VDwtTThFkJRQ1) |
| 3 | 2026-11-08 10:39:44 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | **failed** | [`DPeoAQfq…`](https://nearblocks.io/txns/DPeoAQfqikZvFqUvTYe82NQBUf8MYifMh6UEwLahyfZq) |
| 4 | 2026-11-10 17:50:34 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`Heu9ZTQv…`](https://nearblocks.io/txns/Heu9ZTQvWmriDngtPQ37defMDZMJSecgBNpdAuLnMdu9) |

### `cancel_listing`

1 call, 0 failed, 1 relayed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-12 15:33:41 | `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`J8rLL9GW…`](https://nearblocks.io/txns/J8rLL9GWab9AeB1DTNy8fC7GCa9NbpyXXpKWKeXAKF8t) |

### `mint_rewards`

235 calls, 0 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-03 18:28:34 | `operator.wgpnear.near` (team) | itself | ok | [`5ohT4xpU…`](https://nearblocks.io/txns/5ohT4xpUzrVFW15d9Hk8Qy9XTZJTE5zKXCeSxJbXrMxZ) |
| 2 | 2026-11-03 18:31:56 | `operator.wgpnear.near` (team) | itself | ok | [`Bi8HjZda…`](https://nearblocks.io/txns/Bi8HjZdajH5pH4k8a9TZd37UA2DFgft9hxog2xxtVfYM) |
| 3 | 2026-11-03 19:05:44 | `operator.wgpnear.near` (team) | itself | ok | [`HfefuFXc…`](https://nearblocks.io/txns/HfefuFXcJsvGs3Nrj5x3N7SgBEdyW9kt4ZP9dpkjQNUh) |
| 4 | 2026-11-04 08:10:02 | `operator.wgpnear.near` (team) | itself | ok | [`5WNTruWV…`](https://nearblocks.io/txns/5WNTruWVsG2SBxQgznzcEc1dMiFJ7pvxxEc5mcmdeLtr) |
| 5 | 2026-11-06 07:57:06 | `operator.wgpnear.near` (team) | itself | ok | [`A7KxAF8N…`](https://nearblocks.io/txns/A7KxAF8NP9EkSB9oa3z8ywzdHaXCfUiSBGEFtw1c1Gzv) |
| 6 | 2026-11-06 08:06:10 | `operator.wgpnear.near` (team) | itself | ok | [`3ytoyjBL…`](https://nearblocks.io/txns/3ytoyjBL6zx9UVGMgFoPDMbAqABroiMKiXKyVWsEXcrD) |
| 7 | 2026-11-06 08:09:26 | `operator.wgpnear.near` (team) | itself | ok | [`13kqBHoP…`](https://nearblocks.io/txns/13kqBHoPpe7obCj5kfWRdCEowgaQie5q8fLXKVyNQoqH) |
| 8 | 2026-11-06 08:12:45 | `operator.wgpnear.near` (team) | itself | ok | [`4qn2Ja8D…`](https://nearblocks.io/txns/4qn2Ja8Dx5UmDPTg8Hs3c7PstaT7m4CxRaUkEqgJX2mZ) |
| 9 | 2026-11-06 08:17:14 | `operator.wgpnear.near` (team) | itself | ok | [`78f743vN…`](https://nearblocks.io/txns/78f743vNy1MADtwKQnf4TueEGwzpRAKwPcmGrBsfwT8k) |
| 10 | 2026-11-06 08:20:46 | `operator.wgpnear.near` (team) | itself | ok | [`Cv5hfZzk…`](https://nearblocks.io/txns/Cv5hfZzkJoTFGH7aepiKaCSiZQQ2TunG7KXbhAvoAvDb) |
| 11 | 2026-11-06 08:23:16 | `operator.wgpnear.near` (team) | itself | ok | [`CrHbGvUf…`](https://nearblocks.io/txns/CrHbGvUfbKfdWFivM3fcSuDoZjLPRRmmTsLRcpuDeyRC) |
| 12 | 2026-11-06 08:33:02 | `operator.wgpnear.near` (team) | itself | ok | [`J2dJRmTu…`](https://nearblocks.io/txns/J2dJRmTuWmqcZEs8W4rz6Y5WL2k3d5ULqwK5UZDVUeRB) |
| 13 | 2026-11-06 08:33:44 | `operator.wgpnear.near` (team) | itself | ok | [`BwdTRNan…`](https://nearblocks.io/txns/BwdTRNan9hokczEWgsAKfBZ4owtojEUv4gZnF3skm3hj) |
| 14 | 2026-11-06 08:38:22 | `operator.wgpnear.near` (team) | itself | ok | [`4fHSak8H…`](https://nearblocks.io/txns/4fHSak8HTaA31R4Xu3KPSyYeU2XeV4W16LGk491vn3bK) |
| 15 | 2026-11-06 08:41:18 | `operator.wgpnear.near` (team) | itself | ok | [`ZPHZVmZw…`](https://nearblocks.io/txns/ZPHZVmZwigkhK81pbDfAEs4UcmrwRDrtDTwziSyat8B) |
| 16 | 2026-11-06 08:43:30 | `operator.wgpnear.near` (team) | itself | ok | [`CDDgZFtM…`](https://nearblocks.io/txns/CDDgZFtMvCd13Qok8wsd7vrXgeiG14pGegtPaJspVEeH) |
| 17 | 2026-11-06 08:46:19 | `operator.wgpnear.near` (team) | itself | ok | [`GA3djGqz…`](https://nearblocks.io/txns/GA3djGqzNnRDvrMcWtUQXXd4a7zcUYvZmmb43omSJgc8) |
| 18 | 2026-11-06 08:49:21 | `operator.wgpnear.near` (team) | itself | ok | [`GC1r7X7t…`](https://nearblocks.io/txns/GC1r7X7tYUwi7CwjKvZxszEn6S4z7nt3FLxuRmQPP9xY) |
| 19 | 2026-11-06 08:51:41 | `operator.wgpnear.near` (team) | itself | ok | [`rpWTVA73…`](https://nearblocks.io/txns/rpWTVA73xYynymofDDXAs2yDyqvwk6yjUXZDDt8SMLM) |
| 20 | 2026-11-06 08:54:12 | `operator.wgpnear.near` (team) | itself | ok | [`BPM56JUj…`](https://nearblocks.io/txns/BPM56JUjHz3jwCHLzDftm5MBXBwGxoRseMDmXr6fLVXA) |
| 21 | 2026-11-06 08:57:16 | `operator.wgpnear.near` (team) | itself | ok | [`8SNw1jU4…`](https://nearblocks.io/txns/8SNw1jU4QwXH2ci3kjJkVpFet31p1WgTquo1YES2mvBn) |
| 22 | 2026-11-06 09:01:08 | `operator.wgpnear.near` (team) | itself | ok | [`8yeBapaq…`](https://nearblocks.io/txns/8yeBapaqV2hW8hkxuouZcsyT1divTY6FhhLspyUn7XaL) |
| 23 | 2026-11-06 09:09:23 | `operator.wgpnear.near` (team) | itself | ok | [`9U6RTpP5…`](https://nearblocks.io/txns/9U6RTpP5gSxRXcHGTJBiXKcpLXjoNpUWLASUSMZxHCtZ) |
| 24 | 2026-11-06 09:12:32 | `operator.wgpnear.near` (team) | itself | ok | [`5hWjPgVX…`](https://nearblocks.io/txns/5hWjPgVXDcW1gFXf2qqjTBR8ejASa4Vj7BugBeKu5FxR) |
| 25 | 2026-11-06 09:27:51 | `operator.wgpnear.near` (team) | itself | ok | [`pzaTDvWh…`](https://nearblocks.io/txns/pzaTDvWhjQN6FauU4by116JceYxtE55NAJmh9h6a5qv) |
| 26 | 2026-11-06 09:31:43 | `operator.wgpnear.near` (team) | itself | ok | [`6PqUiBeb…`](https://nearblocks.io/txns/6PqUiBebXqe6nPVhRBXZfz9VQStwpsFHaoY8PsH4j7M2) |
| 27 | 2026-11-06 10:52:21 | `operator.wgpnear.near` (team) | itself | ok | [`8QNeUpSt…`](https://nearblocks.io/txns/8QNeUpStueFRrvVeQGinYPx8WcGS6x84Y6Ky2hVFPwZd) |
| 28 | 2026-11-06 11:06:37 | `operator.wgpnear.near` (team) | itself | ok | [`Bxbn3vEq…`](https://nearblocks.io/txns/Bxbn3vEq9HUfajinohXNWghdeTmwq14NEGXprcdNbzMj) |
| 29 | 2026-11-06 11:13:05 | `operator.wgpnear.near` (team) | itself | ok | [`J8wEb1By…`](https://nearblocks.io/txns/J8wEb1Byy9NwUnnk7N2WnpBRsk357gTmKCddgyTheB1T) |
| 30 | 2026-11-06 11:16:51 | `operator.wgpnear.near` (team) | itself | ok | [`7P1ujBdy…`](https://nearblocks.io/txns/7P1ujBdyZpaJrg6jvGbS7G547Wv8yVM31kSsFqHuSMUU) |
| 31 | 2026-11-06 11:23:24 | `operator.wgpnear.near` (team) | itself | ok | [`4Yvcq6zA…`](https://nearblocks.io/txns/4Yvcq6zA8uQvR2NohaT9UsM1ox846cvm41CjhtGtRkJy) |
| 32 | 2026-11-06 11:28:32 | `operator.wgpnear.near` (team) | itself | ok | [`GpSv5FiW…`](https://nearblocks.io/txns/GpSv5FiWt9vhsqqA63bxTUP3Kno63bW4U8yzHk1xcf7p) |
| 33 | 2026-11-06 12:29:40 | `operator.wgpnear.near` (team) | itself | ok | [`5HeSYm2F…`](https://nearblocks.io/txns/5HeSYm2FMaYji23nvCurBJgouSDwJBiCBVb5bsqWZhh6) |
| 34 | 2026-11-06 17:01:56 | `operator.wgpnear.near` (team) | itself | ok | [`ASeSVsKa…`](https://nearblocks.io/txns/ASeSVsKaPQdT5SRNtGEg2eAUHAYNq99f4EMr9N9STzhK) |
| 35 | 2026-11-06 17:05:27 | `operator.wgpnear.near` (team) | itself | ok | [`8dQSkduB…`](https://nearblocks.io/txns/8dQSkduBA6K6B5JB7o5TgQ3CkZbn1NEs6Udgcqy61R8D) |
| 36 | 2026-11-06 17:12:06 | `operator.wgpnear.near` (team) | itself | ok | [`81rKZq7Y…`](https://nearblocks.io/txns/81rKZq7YfutLWdQn3PkdVzGghRSJt4Eu1DdqxNVauABS) |
| 37 | 2026-11-06 18:02:28 | `operator.wgpnear.near` (team) | itself | ok | [`4T3wdiGt…`](https://nearblocks.io/txns/4T3wdiGtr5VtqSC2t3KN4akzvrKK96hcUcGjvnbCgxDt) |
| 38 | 2026-11-07 02:07:20 | `operator.wgpnear.near` (team) | itself | ok | [`5Yi675Hn…`](https://nearblocks.io/txns/5Yi675Hn1gDoLfBUJAc8df2cnzpXAAMnFtdNqSAntjW) |
| 39 | 2026-11-07 02:09:37 | `operator.wgpnear.near` (team) | itself | ok | [`8QdUX3h2…`](https://nearblocks.io/txns/8QdUX3h2FGwTWpSMc5s5hw94DVSTmyP6Kut2ZGZhkrFH) |
| 40 | 2026-11-07 02:33:08 | `operator.wgpnear.near` (team) | itself | ok | [`7hbGnKHi…`](https://nearblocks.io/txns/7hbGnKHic9xBjGZ1XdBAi4vKCmp47d5nqgEQjRQwtz4T) |
| 41 | 2026-11-07 02:46:05 | `operator.wgpnear.near` (team) | itself | ok | [`F9QBGKJi…`](https://nearblocks.io/txns/F9QBGKJiG4oUWJwQKFjw9UCDVPVhKPHkoxv4MEm2DfuW) |
| 42 | 2026-11-07 02:53:34 | `operator.wgpnear.near` (team) | itself | ok | [`2qRDZWbz…`](https://nearblocks.io/txns/2qRDZWbzhrRt7N5aHWFb7UDXQn5skzCAagWMmWe6TGB7) |
| 43 | 2026-11-07 02:57:36 | `operator.wgpnear.near` (team) | itself | ok | [`8CQPArYs…`](https://nearblocks.io/txns/8CQPArYsYrzMSjEr33iYnGCZdDconn6oRVYhD7AW2S5z) |
| 44 | 2026-11-07 04:09:33 | `operator.wgpnear.near` (team) | itself | ok | [`29LNTz5E…`](https://nearblocks.io/txns/29LNTz5E72CSsSas4Rt9ZBchRvhtFuwPXfkD76LZMcyg) |
| 45 | 2026-11-07 04:12:45 | `operator.wgpnear.near` (team) | itself | ok | [`BVGujBxc…`](https://nearblocks.io/txns/BVGujBxcAfYHPfyR3S9Szwg6UGT3VnSKrTE7hUCYy5Yn) |
| 46 | 2026-11-07 04:15:53 | `operator.wgpnear.near` (team) | itself | ok | [`51twy1as…`](https://nearblocks.io/txns/51twy1as1oen4vADzA7K37aKffnMSmPmcB9Fz19NqSZC) |
| 47 | 2026-11-07 04:19:22 | `operator.wgpnear.near` (team) | itself | ok | [`9KUBxVko…`](https://nearblocks.io/txns/9KUBxVkoHh2FnCVsVrokim84FJ9zwYCS9AwiQ9bNB1bp) |
| 48 | 2026-11-07 05:45:31 | `operator.wgpnear.near` (team) | itself | ok | [`EiG1SLpj…`](https://nearblocks.io/txns/EiG1SLpjdhbPPnF4jvTqHwX4oG8vkkTkZEpujgaGD26X) |
| 49 | 2026-11-07 05:57:27 | `operator.wgpnear.near` (team) | itself | ok | [`HYggio6R…`](https://nearblocks.io/txns/HYggio6RS2292dDPsSAsrH1MJMjcb4sP8aJSBYx9qpo4) |
| 50 | 2026-11-07 05:59:38 | `operator.wgpnear.near` (team) | itself | ok | [`CeWwrNvG…`](https://nearblocks.io/txns/CeWwrNvGYQinuuYcyhh4LYz7zE5cdFmtPTyYYoeCU8qy) |
| 51 | 2026-11-07 06:02:05 | `operator.wgpnear.near` (team) | itself | ok | [`CTpP5gjM…`](https://nearblocks.io/txns/CTpP5gjM5AU9pEiZPWrcC1Ti6nEBcLNVWvPiZbH6sxUq) |
| 52 | 2026-11-07 06:05:17 | `operator.wgpnear.near` (team) | itself | ok | [`J2eDVUps…`](https://nearblocks.io/txns/J2eDVUpsb4kB9DMQt2v1RPLhfzkmx3w3zYrgrEZbfg2k) |
| 53 | 2026-11-07 06:07:20 | `operator.wgpnear.near` (team) | itself | ok | [`HAWbwAZV…`](https://nearblocks.io/txns/HAWbwAZV78nq1GRabbswsV8uQGfMzdan9Cc8abHsev3P) |
| 54 | 2026-11-07 06:09:55 | `operator.wgpnear.near` (team) | itself | ok | [`EdeoD9qT…`](https://nearblocks.io/txns/EdeoD9qT2mtjjUoE33ET5L3ranMxLgeJuF5qmDXQLFmp) |
| 55 | 2026-11-07 06:12:10 | `operator.wgpnear.near` (team) | itself | ok | [`GDJmjVBn…`](https://nearblocks.io/txns/GDJmjVBn5v12Ftth1fBuGse8gSycHjrk5tz2ARzTEMqJ) |
| 56 | 2026-11-07 06:14:14 | `operator.wgpnear.near` (team) | itself | ok | [`DUPXA6vj…`](https://nearblocks.io/txns/DUPXA6vj66e4cuB4XfJaymxu6hZdCQceZqH73v2iwp5q) |
| 57 | 2026-11-07 06:16:30 | `operator.wgpnear.near` (team) | itself | ok | [`6EppKeE2…`](https://nearblocks.io/txns/6EppKeE2gER2NoFARTPz4pMNpkKfQ73o5eEcjn2i7Zn6) |
| 58 | 2026-11-07 06:18:31 | `operator.wgpnear.near` (team) | itself | ok | [`8YmuAdvu…`](https://nearblocks.io/txns/8YmuAdvupVWvRTtymQct5b4hMoEMEtuiC8UsLJgaqVQf) |
| 59 | 2026-11-07 07:00:44 | `operator.wgpnear.near` (team) | itself | ok | [`5DJpoY2F…`](https://nearblocks.io/txns/5DJpoY2Fgz2Lz6YWiZyRHABeY6cTnPCNG54NMg5c8nep) |
| 60 | 2026-11-07 12:13:03 | `operator.wgpnear.near` (team) | itself | ok | [`EwSioPYK…`](https://nearblocks.io/txns/EwSioPYKkALLh21pjkeFG9s62dhGaj5ABJ1xdmPUWdi3) |
| 61 | 2026-11-07 12:15:31 | `operator.wgpnear.near` (team) | itself | ok | [`4N83vNBV…`](https://nearblocks.io/txns/4N83vNBVZ9vS81VztQB6jRWqQJi51ordGe3XygZaKZ8o) |
| 62 | 2026-11-07 12:16:21 | `operator.wgpnear.near` (team) | itself | ok | [`5Dg2uq7E…`](https://nearblocks.io/txns/5Dg2uq7Eih5dZx5zrCDYeqwGFED8rckYfp7GqQbYnkLc) |
| 63 | 2026-11-07 12:19:00 | `operator.wgpnear.near` (team) | itself | ok | [`CEpkAmmi…`](https://nearblocks.io/txns/CEpkAmmicz6AkvzsVsukqLBrLUsgaarYPmDNMpw51jjJ) |
| 64 | 2026-11-07 12:30:03 | `operator.wgpnear.near` (team) | itself | ok | [`69xjtyUa…`](https://nearblocks.io/txns/69xjtyUaqofjkwuQHscZyXsttNBjKjDRYWQYwTn3DGpv) |
| 65 | 2026-11-07 12:39:53 | `operator.wgpnear.near` (team) | itself | ok | [`AUpqXyGT…`](https://nearblocks.io/txns/AUpqXyGTrmese13n9vYBuSRaUT8YTSGfcGDK5iTj1UM4) |
| 66 | 2026-11-07 12:43:16 | `operator.wgpnear.near` (team) | itself | ok | [`BWwnjzGS…`](https://nearblocks.io/txns/BWwnjzGSauViCigfMVVm3ctBoyYUb1prPGfWPQVEyPaK) |
| 67 | 2026-11-07 13:32:58 | `operator.wgpnear.near` (team) | itself | ok | [`HL9fbkHg…`](https://nearblocks.io/txns/HL9fbkHgE7k8kG4B1U3bDE4x4MNPcj9Q2P4B7fkb9SUS) |
| 68 | 2026-11-07 14:04:20 | `operator.wgpnear.near` (team) | itself | ok | [`FMtd8UXY…`](https://nearblocks.io/txns/FMtd8UXYXJSvEwfa9dbzRVEwYCkFcywNasLDr8t6SmVA) |
| 69 | 2026-11-07 14:07:23 | `operator.wgpnear.near` (team) | itself | ok | [`3pn9oJsR…`](https://nearblocks.io/txns/3pn9oJsRvEBpt9scfgXnL4tuqokhLD9eAos9y9BFRap9) |
| 70 | 2026-11-07 14:08:46 | `operator.wgpnear.near` (team) | itself | ok | [`H1DJeMKv…`](https://nearblocks.io/txns/H1DJeMKvw5tLAzo3HgEBJhkPrD1XQZpx4PpGcRZxd77N) |
| 71 | 2026-11-07 14:28:50 | `operator.wgpnear.near` (team) | itself | ok | [`A4xv6zr3…`](https://nearblocks.io/txns/A4xv6zr3PfNkgSxX9mLv9PAB5GAuR8eCAfPfVejv2wHc) |
| 72 | 2026-11-07 15:49:03 | `operator.wgpnear.near` (team) | itself | ok | [`7VuNrBSR…`](https://nearblocks.io/txns/7VuNrBSRzmJo8nEjGWDKK1frmuvhRgvhgrL5xkxvttDL) |
| 73 | 2026-11-07 16:58:02 | `operator.wgpnear.near` (team) | itself | ok | [`EjWgwnDx…`](https://nearblocks.io/txns/EjWgwnDxvXk1CoM7GQAqd4CqZ8YzSG8W9EPuhSSs7535) |
| 74 | 2026-11-07 17:03:40 | `operator.wgpnear.near` (team) | itself | ok | [`Bc4Xujw3…`](https://nearblocks.io/txns/Bc4Xujw3RLKYaAiFkNv1CowmMi54oudDUYujZhtmtpGd) |
| 75 | 2026-11-07 19:09:04 | `operator.wgpnear.near` (team) | itself | ok | [`DKaRft11…`](https://nearblocks.io/txns/DKaRft11er7kXNq6RmGSfnuY3su2XhH8w2xCfnHKfdDh) |
| 76 | 2026-11-08 01:53:28 | `operator.wgpnear.near` (team) | itself | ok | [`7hWMW7wL…`](https://nearblocks.io/txns/7hWMW7wLd8VFLmRgjvcYRiM1HXBy25gpVbKDKJ8WtZo7) |
| 77 | 2026-11-08 01:55:03 | `operator.wgpnear.near` (team) | itself | ok | [`D4cKTMff…`](https://nearblocks.io/txns/D4cKTMffKuVQkUV6v6UrubjWm21GQ9BQFGchtvfGgsdD) |
| 78 | 2026-11-08 03:23:53 | `operator.wgpnear.near` (team) | itself | ok | [`2RMJLtvW…`](https://nearblocks.io/txns/2RMJLtvW2qwwaKkSi3GR37rsUag4pQePv7EFRjfvtTvK) |
| 79 | 2026-11-08 03:26:33 | `operator.wgpnear.near` (team) | itself | ok | [`J4dhL4rL…`](https://nearblocks.io/txns/J4dhL4rL4Arw86pvRCaFzLpaHFWdpKEdxe7rZhxBW5tf) |
| 80 | 2026-11-08 03:28:53 | `operator.wgpnear.near` (team) | itself | ok | [`B7EhCqCA…`](https://nearblocks.io/txns/B7EhCqCAJpMD6NZVAyStuiNSH476VkFdmpeydgvq7hwE) |
| 81 | 2026-11-08 04:00:00 | `operator.wgpnear.near` (team) | itself | ok | [`4S611NA5…`](https://nearblocks.io/txns/4S611NA5G23j28bSS1zMSveTRmKW6UkKhaDMWZNLX9pE) |
| 82 | 2026-11-08 05:01:15 | `operator.wgpnear.near` (team) | itself | ok | [`HJLjPCYA…`](https://nearblocks.io/txns/HJLjPCYApL4J1k4NrNRqPLMi9BC8BJrvTtWb9UTmFjoZ) |
| 83 | 2026-11-08 05:04:08 | `operator.wgpnear.near` (team) | itself | ok | [`3Ahegh4n…`](https://nearblocks.io/txns/3Ahegh4ncGEc4J3EQobVpQeVeTBKZHRin68zMMfNboH6) |
| 84 | 2026-11-08 05:06:42 | `operator.wgpnear.near` (team) | itself | ok | [`9SXhZrED…`](https://nearblocks.io/txns/9SXhZrEDThAS5vUVEAut6XLWz9YGJU3jrgHyQV4A6jwo) |
| 85 | 2026-11-08 05:16:31 | `operator.wgpnear.near` (team) | itself | ok | [`Gi3DRr8F…`](https://nearblocks.io/txns/Gi3DRr8FAVdNezyf6fWSZMLTafKGKGU9Qfmhb9fBDvap) |
| 86 | 2026-11-08 05:18:40 | `operator.wgpnear.near` (team) | itself | ok | [`GAk4T4Y4…`](https://nearblocks.io/txns/GAk4T4Y4pi2AU8rZesNrGfHbepeEiJSNvHo6q7AoQKnf) |
| 87 | 2026-11-08 05:21:27 | `operator.wgpnear.near` (team) | itself | ok | [`2r4TNPgc…`](https://nearblocks.io/txns/2r4TNPgcu5SyUm4PwKCbM5b9Q7x6iHCC5usnEStnGhf4) |
| 88 | 2026-11-08 05:25:03 | `operator.wgpnear.near` (team) | itself | ok | [`3mgsM9LX…`](https://nearblocks.io/txns/3mgsM9LXQ5fkMES5fqUwzG7pS5wKMEciajdBte2dwekE) |
| 89 | 2026-11-08 05:27:28 | `operator.wgpnear.near` (team) | itself | ok | [`2wtpBd6L…`](https://nearblocks.io/txns/2wtpBd6L3vA8nbjHGwozDJ4Y6RbvfBkBjvAfexXoeeBw) |
| 90 | 2026-11-08 05:44:28 | `operator.wgpnear.near` (team) | itself | ok | [`695hZM8P…`](https://nearblocks.io/txns/695hZM8PjuRdG13fxXc1tGAuFCyxyPTanJmAtAcUmZ6Z) |
| 91 | 2026-11-08 05:46:45 | `operator.wgpnear.near` (team) | itself | ok | [`6LBB5A2W…`](https://nearblocks.io/txns/6LBB5A2WGQ1tzcJUhX1arxjJL4sAzyqa8QZtxdsXTGuX) |
| 92 | 2026-11-08 06:23:20 | `operator.wgpnear.near` (team) | itself | ok | [`7hUezgH7…`](https://nearblocks.io/txns/7hUezgH7g76QnEBSwinK7w4scE1XPfqd6e8DTJ86mUiw) |
| 93 | 2026-11-08 09:13:33 | `operator.wgpnear.near` (team) | itself | ok | [`9Svrd5VA…`](https://nearblocks.io/txns/9Svrd5VAtA1dThgVa1RDw55496nHXxBafwBs6kR6qkVj) |
| 94 | 2026-11-08 10:35:56 | `operator.wgpnear.near` (team) | itself | ok | [`8tvqCCRV…`](https://nearblocks.io/txns/8tvqCCRVMo7TA4hKMFgJzF3nGhnrVPGyCBtvkQCW9ofe) |
| 95 | 2026-11-08 10:38:19 | `operator.wgpnear.near` (team) | itself | ok | [`BaLABeSd…`](https://nearblocks.io/txns/BaLABeSdiTrV5bh59j1Gnpk8rkcp5txdgjbCxgtysSPy) |
| 96 | 2026-11-08 10:52:56 | `operator.wgpnear.near` (team) | itself | ok | [`6Gz7ioTt…`](https://nearblocks.io/txns/6Gz7ioTtgUZWygJRM6A5zjVuo74DraDqWZyaVFasYL4) |
| 97 | 2026-11-08 12:41:36 | `operator.wgpnear.near` (team) | itself | ok | [`7FKhyRw2…`](https://nearblocks.io/txns/7FKhyRw28E9hdjyMLm2YscvAiXqQnPHeVv2LBHsnYQ33) |
| 98 | 2026-11-08 14:40:16 | `operator.wgpnear.near` (team) | itself | ok | [`AwWvR6Zs…`](https://nearblocks.io/txns/AwWvR6ZsWKaEb4acDr75somgqHeEcUDwsjs6rwPqV9ZT) |
| 99 | 2026-11-08 15:16:48 | `operator.wgpnear.near` (team) | itself | ok | [`EhaAdGah…`](https://nearblocks.io/txns/EhaAdGahipemevWw2kZ1MnZ58yoCZP8WoPQKyXF3E374) |
| 100 | 2026-11-08 15:20:30 | `operator.wgpnear.near` (team) | itself | ok | [`5tZdAyif…`](https://nearblocks.io/txns/5tZdAyifqBYWwkvvhCFAsuvHtJ5746B8AHVdxV7KrbJ5) |
| 101 | 2026-11-08 15:27:23 | `operator.wgpnear.near` (team) | itself | ok | [`CWtDu6FB…`](https://nearblocks.io/txns/CWtDu6FBr2txLtoCLQrbrx23dJbq1TsCuDxFensZjtTw) |
| 102 | 2026-11-08 15:37:20 | `operator.wgpnear.near` (team) | itself | ok | [`Fz5zamt4…`](https://nearblocks.io/txns/Fz5zamt4VUut82D4qPy7Phh2U5ZwkMb3HtxzK3UL1sEz) |
| 103 | 2026-11-08 15:37:49 | `operator.wgpnear.near` (team) | itself | ok | [`8bxxRnmN…`](https://nearblocks.io/txns/8bxxRnmNp2HRYDBqLEPD69EA8b5aLJdvNCZcYSUxJY1i) |
| 104 | 2026-11-08 15:41:35 | `operator.wgpnear.near` (team) | itself | ok | [`HA76wce1…`](https://nearblocks.io/txns/HA76wce1kwAXZ71SE64j75LBJhiCtctuVbkXcu6r2aYk) |
| 105 | 2026-11-08 17:53:49 | `operator.wgpnear.near` (team) | itself | ok | [`8B5pTjDN…`](https://nearblocks.io/txns/8B5pTjDNbTpaBUvMqNHjN83hKAMjdjuNik8j1r71kCLU) |
| 106 | 2026-11-08 17:53:49 | `operator.wgpnear.near` (team) | itself | ok | [`BJFUURto…`](https://nearblocks.io/txns/BJFUURtoRbSkiBrtJC8hqcX9ox8dtebPyjpNLGcyzJqo) |
| 107 | 2026-11-09 01:37:43 | `operator.wgpnear.near` (team) | itself | ok | [`HVrCzc5E…`](https://nearblocks.io/txns/HVrCzc5EZgMq5deVxTcMCJgRC5HCpnT7BQ3UWTfWHqH8) |
| 108 | 2026-11-09 06:14:45 | `operator.wgpnear.near` (team) | itself | ok | [`4eDKbVLV…`](https://nearblocks.io/txns/4eDKbVLVR6wqCXSAFcP6WU4Cjo6zGSwxpANnDRwg47WR) |
| 109 | 2026-11-09 06:18:15 | `operator.wgpnear.near` (team) | itself | ok | [`Fd1yZF8Y…`](https://nearblocks.io/txns/Fd1yZF8Yj21ZyEHZk7VtJAcWC5pKTMSZkHY2mqtnc6V8) |
| 110 | 2026-11-09 06:22:31 | `operator.wgpnear.near` (team) | itself | ok | [`6wVTQdLP…`](https://nearblocks.io/txns/6wVTQdLPX16yKhWFCsrUsJgv58BprJVKmzXDwwndXBwV) |
| 111 | 2026-11-09 07:13:32 | `operator.wgpnear.near` (team) | itself | ok | [`66hMFERT…`](https://nearblocks.io/txns/66hMFERTJyAt5j7zPJb5fnsrZhavDQPh6vuQxSvJWdrV) |
| 112 | 2026-11-09 07:20:15 | `operator.wgpnear.near` (team) | itself | ok | [`6DgK4zu8…`](https://nearblocks.io/txns/6DgK4zu8yvpjtj6iSuxQTmGsLmadZNDbX8bkYnLcdLpm) |
| 113 | 2026-11-09 07:23:01 | `operator.wgpnear.near` (team) | itself | ok | [`EaU9Vyqj…`](https://nearblocks.io/txns/EaU9VyqjDusfFimPdx5yFsfHDX8YALaJBPpDCkJrkLsC) |
| 114 | 2026-11-09 07:25:29 | `operator.wgpnear.near` (team) | itself | ok | [`9HH7Ck2U…`](https://nearblocks.io/txns/9HH7Ck2UTSvJ9oEDRrmthDq28xiDuCvDyRZuHPr6CPPt) |
| 115 | 2026-11-09 07:28:00 | `operator.wgpnear.near` (team) | itself | ok | [`6J835mx3…`](https://nearblocks.io/txns/6J835mx3nRUxxNKQpMJNv5HWR9Jkk5Y76SxPbV1iGLhZ) |
| 116 | 2026-11-09 07:31:31 | `operator.wgpnear.near` (team) | itself | ok | [`39db5vaB…`](https://nearblocks.io/txns/39db5vaBA5qtZcgxjAwQzTNQvtKmaCwMCox2HSjcZSe1) |
| 117 | 2026-11-09 07:35:49 | `operator.wgpnear.near` (team) | itself | ok | [`3n8vkExL…`](https://nearblocks.io/txns/3n8vkExLW3nWNcpcmgknLg9TEc2izsUXPsrnAJh5eSAQ) |
| 118 | 2026-11-09 08:41:31 | `operator.wgpnear.near` (team) | itself | ok | [`EbfebH9k…`](https://nearblocks.io/txns/EbfebH9k9UDU1xSRymCVkEWUfoZdqiv4ki5pAfLBQBmn) |
| 119 | 2026-11-09 08:44:28 | `operator.wgpnear.near` (team) | itself | ok | [`Fbtwg1dV…`](https://nearblocks.io/txns/Fbtwg1dVGvF2HXmwZqNrXu9JYCnWJffDjc3nvrVDezaL) |
| 120 | 2026-11-09 08:51:53 | `operator.wgpnear.near` (team) | itself | ok | [`F26kE7v1…`](https://nearblocks.io/txns/F26kE7v1FEPf6d9x8xtqxdAJgbXpCfuzDjWJ3Ut3LoRb) |
| 121 | 2026-11-09 08:54:28 | `operator.wgpnear.near` (team) | itself | ok | [`2ZaVhSC1…`](https://nearblocks.io/txns/2ZaVhSC1oDzMTnDeWcvMUbt3cEeg6n39bb4K7DLLxber) |
| 122 | 2026-11-09 09:34:56 | `operator.wgpnear.near` (team) | itself | ok | [`7rGBhEdc…`](https://nearblocks.io/txns/7rGBhEdcmmh8mPhNBVUudBNu33uxqCybdAvWhFUJyzRz) |
| 123 | 2026-11-09 09:37:12 | `operator.wgpnear.near` (team) | itself | ok | [`C1gSmZbC…`](https://nearblocks.io/txns/C1gSmZbCsMLYLuvui2tKdXADJ7n5BDxaspTzMHHobBZe) |
| 124 | 2026-11-09 15:03:22 | `operator.wgpnear.near` (team) | itself | ok | [`2PPy28tK…`](https://nearblocks.io/txns/2PPy28tKLaj2CM1iojM8A15wBrXxwVu1AEDri2dY4Qcb) |
| 125 | 2026-11-09 15:09:16 | `operator.wgpnear.near` (team) | itself | ok | [`GNTmMREm…`](https://nearblocks.io/txns/GNTmMREmtxdfeKUrveym37yHBKfpWStDpzdmkhDf8QGU) |
| 126 | 2026-11-09 18:52:12 | `operator.wgpnear.near` (team) | itself | ok | [`9TNusmoV…`](https://nearblocks.io/txns/9TNusmoVg3VGfF7hz1XRkPfa5q8bW3AWJDjFhjJyPdzR) |
| 127 | 2026-11-10 03:46:32 | `operator.wgpnear.near` (team) | itself | ok | [`85jcoRWH…`](https://nearblocks.io/txns/85jcoRWH518be7RG6d8kKSkqPTMtS9SQr9yukfsrw3A7) |
| 128 | 2026-11-10 03:48:12 | `operator.wgpnear.near` (team) | itself | ok | [`D7wCuJCD…`](https://nearblocks.io/txns/D7wCuJCDFU6ZLiUDwRSCbgrn5fuUm5sZ9fJmBgSfwpMc) |
| 129 | 2026-11-10 03:56:53 | `operator.wgpnear.near` (team) | itself | ok | [`QJzZHvVD…`](https://nearblocks.io/txns/QJzZHvVDkw3wKY9LCRpy4UZKHjJDJL6xCXgFPqTRgyt) |
| 130 | 2026-11-10 06:27:13 | `operator.wgpnear.near` (team) | itself | ok | [`hop6HLEe…`](https://nearblocks.io/txns/hop6HLEeyH86mxcLpeE4RwFRw7ogVUDa8kqAQCGiejv) |
| 131 | 2026-11-10 06:28:54 | `operator.wgpnear.near` (team) | itself | ok | [`GPpKSEQL…`](https://nearblocks.io/txns/GPpKSEQLLcJScsjry2vTsfKQMqHAGkpmfzrLhjzVeVrc) |
| 132 | 2026-11-10 08:45:18 | `operator.wgpnear.near` (team) | itself | ok | [`Hg3gnegb…`](https://nearblocks.io/txns/Hg3gnegb57a8sX7EU16BMpfyoW6iLpP5KkNN69ftoxwK) |
| 133 | 2026-11-10 08:51:20 | `operator.wgpnear.near` (team) | itself | ok | [`5zyQD47i…`](https://nearblocks.io/txns/5zyQD47ifARTHgksEMZaxqPpMn7Szv7zsUpxdqLXh6N6) |
| 134 | 2026-11-10 09:29:25 | `operator.wgpnear.near` (team) | itself | ok | [`7EtnwgDg…`](https://nearblocks.io/txns/7EtnwgDgqwuHAveiHJ8mzNEcamisqb6P1PtdZVpTPSDB) |
| 135 | 2026-11-10 09:49:34 | `operator.wgpnear.near` (team) | itself | ok | [`Bt4XJQyi…`](https://nearblocks.io/txns/Bt4XJQyijm5xfnt4AiqMSxqHQa6L6FHRxscJGSvPYDeW) |
| 136 | 2026-11-10 10:06:03 | `operator.wgpnear.near` (team) | itself | ok | [`7Ahkpk8A…`](https://nearblocks.io/txns/7Ahkpk8ALEnuTxAADLS71oDEMMK26SGXw6RLnasiuGFu) |
| 137 | 2026-11-10 10:40:46 | `operator.wgpnear.near` (team) | itself | ok | [`H8GU3wn3…`](https://nearblocks.io/txns/H8GU3wn3uqHJcZ82GeeqJS723HhSQyNcYskhRSX9gCd9) |
| 138 | 2026-11-10 13:03:24 | `operator.wgpnear.near` (team) | itself | ok | [`Fyfky6TE…`](https://nearblocks.io/txns/Fyfky6TE4chz1ZqzYEGgqGdqz6wd9RbtoKCG3JnuuLVe) |
| 139 | 2026-11-10 17:04:39 | `operator.wgpnear.near` (team) | itself | ok | [`2AevVAvm…`](https://nearblocks.io/txns/2AevVAvm1vwnqxWzTvEYpFccUtMKKtG8LNE1H2oPRsaj) |
| 140 | 2026-11-10 17:09:11 | `operator.wgpnear.near` (team) | itself | ok | [`DxKiu4cW…`](https://nearblocks.io/txns/DxKiu4cW9ViuNsrsMFz9K49C5f1mWRxyBHrrGUrmwU8y) |
| 141 | 2026-11-10 17:12:32 | `operator.wgpnear.near` (team) | itself | ok | [`3HQL8MuV…`](https://nearblocks.io/txns/3HQL8MuVgFfTqknASZwRZ5iL5Jj8Q1JGFETiGBsBvECC) |
| 142 | 2026-11-10 17:34:11 | `operator.wgpnear.near` (team) | itself | ok | [`5jEKxMMB…`](https://nearblocks.io/txns/5jEKxMMBAozmRBnwQVpWubkGc9d96DnCSKUD3CJQh78z) |
| 143 | 2026-11-10 17:34:25 | `operator.wgpnear.near` (team) | itself | ok | [`9aKKqKvZ…`](https://nearblocks.io/txns/9aKKqKvZNc1Uqas7DpwmTnkGWQR2qPGXV7HwGrSYgEjr) |
| 144 | 2026-11-10 17:36:34 | `operator.wgpnear.near` (team) | itself | ok | [`6GZ3G6rM…`](https://nearblocks.io/txns/6GZ3G6rM1H6CUA1NFzczVmCUo98aDr8fK8x3es7z5Zfw) |
| 145 | 2026-11-10 17:46:11 | `operator.wgpnear.near` (team) | itself | ok | [`C2BGyYeE…`](https://nearblocks.io/txns/C2BGyYeEZ8ea1dH3wFYvhP96S4ek36FciJ3uACuP2xW5) |
| 146 | 2026-11-10 17:48:16 | `operator.wgpnear.near` (team) | itself | ok | [`512ib5LG…`](https://nearblocks.io/txns/512ib5LGUQ9FrDsDgvqNp7uQ1c6H232ni5EQByVd41hY) |
| 147 | 2026-11-11 04:19:33 | `operator.wgpnear.near` (team) | itself | ok | [`2v9SoDqj…`](https://nearblocks.io/txns/2v9SoDqj5Ge8ftKUff5siAPSBkCBvXAbPFD14A8rkQHr) |
| 148 | 2026-11-11 04:23:40 | `operator.wgpnear.near` (team) | itself | ok | [`8pgczb4C…`](https://nearblocks.io/txns/8pgczb4CLvWWbcFC4Y9vwCmzNw49kdbw5Y5EocsfU6D7) |
| 149 | 2026-11-11 08:51:13 | `operator.wgpnear.near` (team) | itself | ok | [`FMUGBjNp…`](https://nearblocks.io/txns/FMUGBjNpND6YpDpY6WQnx4fXdXgvrNaeBW4eT5jqe886) |
| 150 | 2026-11-11 08:55:00 | `operator.wgpnear.near` (team) | itself | ok | [`3v3aYYA2…`](https://nearblocks.io/txns/3v3aYYA2mQp3CoM6s7jf68yDGCpkseaq2WqUEaNKrejt) |
| 151 | 2026-11-11 12:16:33 | `operator.wgpnear.near` (team) | itself | ok | [`BLqhTbhp…`](https://nearblocks.io/txns/BLqhTbhpusLGGE46PjMZzMFSBw6JvU4A11Tq2kKnvGAs) |
| 152 | 2026-11-12 02:50:03 | `operator.wgpnear.near` (team) | itself | ok | [`79oc6DKW…`](https://nearblocks.io/txns/79oc6DKWdnY4xcga37kqYoZ4jXPKAqjwUb1tFrmqvhB1) |
| 153 | 2026-11-12 03:41:17 | `operator.wgpnear.near` (team) | itself | ok | [`8UEpbpc3…`](https://nearblocks.io/txns/8UEpbpc3doff1BgDFcsXWc4rcfhfFHWPVzAWGAAaxmVG) |
| 154 | 2026-11-12 03:43:15 | `operator.wgpnear.near` (team) | itself | ok | [`21DSqhEb…`](https://nearblocks.io/txns/21DSqhEbtws8qasXY5xNHrSpXt7HxdfCBEKQTLXALtkP) |
| 155 | 2026-11-12 03:46:16 | `operator.wgpnear.near` (team) | itself | ok | [`4u8oZaMY…`](https://nearblocks.io/txns/4u8oZaMYHCPan2yLSyUAVPtjxJ2DFUo8Z3DeWXQh4TKp) |
| 156 | 2026-11-12 03:49:55 | `operator.wgpnear.near` (team) | itself | ok | [`DSgLui5e…`](https://nearblocks.io/txns/DSgLui5eB8bqyY9nqjuiuzAHNzowoW6NaGPpWt5h7U2P) |
| 157 | 2026-11-12 10:10:54 | `operator.wgpnear.near` (team) | itself | ok | [`CsnUWQDW…`](https://nearblocks.io/txns/CsnUWQDWSXGwNaapB9iFGH3idEqzQWGbWmrH7pbJegZh) |
| 158 | 2026-11-12 15:32:01 | `operator.wgpnear.near` (team) | itself | ok | [`6X5vqZSU…`](https://nearblocks.io/txns/6X5vqZSUamfR2nMWAiBzoeVVtZ1uUgHvT7zKVB9P1B3W) |
| 159 | 2026-11-12 15:36:03 | `operator.wgpnear.near` (team) | itself | ok | [`6fc2KRSz…`](https://nearblocks.io/txns/6fc2KRSzHFeDHZmdUgpmgdq7XNC976vRsvSXD4qmbRq1) |
| 160 | 2026-11-12 15:38:03 | `operator.wgpnear.near` (team) | itself | ok | [`4SefGvFC…`](https://nearblocks.io/txns/4SefGvFC6RiPTMjTAGe1WXEaCZ8RuQz3BUXehb7MBRq9) |
| 161 | 2026-11-12 17:51:19 | `operator.wgpnear.near` (team) | itself | ok | [`6M4kjpjG…`](https://nearblocks.io/txns/6M4kjpjG29dmG9JcU7vW6Sn5UFUHNgWbRAoiac4m9qGQ) |
| 162 | 2026-11-12 19:06:00 | `operator.wgpnear.near` (team) | itself | ok | [`DTi2853L…`](https://nearblocks.io/txns/DTi2853LuSENBmf8ssvvFWSrA7mKZsfuV9NisKNT8bh5) |
| 163 | 2026-11-12 19:10:47 | `operator.wgpnear.near` (team) | itself | ok | [`7oH3DHuq…`](https://nearblocks.io/txns/7oH3DHuqvANqiLEeRyXEG99xzjrXC6Qxsd9Wsi8L7yJZ) |
| 164 | 2026-11-12 19:13:52 | `operator.wgpnear.near` (team) | itself | ok | [`38qtiSA1…`](https://nearblocks.io/txns/38qtiSA1y22smSH1ssYcaNrrS4YULninTdGN1XnXtG6p) |
| 165 | 2026-11-12 19:32:55 | `operator.wgpnear.near` (team) | itself | ok | [`3jYbvHMP…`](https://nearblocks.io/txns/3jYbvHMPBynGmDad5d5yUcgtKDPiXV8Q9QsgGEbc6RiH) |
| 166 | 2026-11-13 02:24:45 | `operator.wgpnear.near` (team) | itself | ok | [`G6q7TjPy…`](https://nearblocks.io/txns/G6q7TjPybZFDYDd9TqL6tM58Qq12gMtYdnpJQBMdS6uB) |
| 167 | 2026-11-13 02:26:49 | `operator.wgpnear.near` (team) | itself | ok | [`9BvxGqQs…`](https://nearblocks.io/txns/9BvxGqQs83B5P46Q1kSeh4gRkDztkZQJ5rKTbW88iBTb) |
| 168 | 2026-11-13 07:12:14 | `operator.wgpnear.near` (team) | itself | ok | [`Hjvobzmd…`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7) |
| 169 | 2026-11-13 10:09:07 | `operator.wgpnear.near` (team) | itself | ok | [`A2BgLh2i…`](https://nearblocks.io/txns/A2BgLh2izhG6enXXFsKtLoqUfqcZ25aifQmnL4gaPP96) |
| 170 | 2026-11-13 13:20:47 | `operator.wgpnear.near` (team) | itself | ok | [`A2tvgXj9…`](https://nearblocks.io/txns/A2tvgXj9SrBaocKZTmmv4QUfoF68eESFssDU8S5X9DzP) |
| 171 | 2026-11-13 16:59:40 | `operator.wgpnear.near` (team) | itself | ok | [`DgobJvHt…`](https://nearblocks.io/txns/DgobJvHtERrGqeeJXUfJoMkvLBqKJdWUNtKQzy1SFBiz) |
| 172 | 2026-11-14 03:24:29 | `operator.wgpnear.near` (team) | itself | ok | [`9phRZg4z…`](https://nearblocks.io/txns/9phRZg4zd2va6LTDho3Bdnt8f3xyEGHn4d7t4DacdFto) |
| 173 | 2026-11-14 03:27:11 | `operator.wgpnear.near` (team) | itself | ok | [`AGgUC57c…`](https://nearblocks.io/txns/AGgUC57cpaHTEN2145Se1CyNS4RGPBtXMBtpLxogfpr5) |
| 174 | 2026-11-14 10:01:25 | `operator.wgpnear.near` (team) | itself | ok | [`5HZsCYEd…`](https://nearblocks.io/txns/5HZsCYEdhcYetvy66sbEizfyajeXDjEvc68QeXQAfYJp) |
| 175 | 2026-11-14 10:06:34 | `operator.wgpnear.near` (team) | itself | ok | [`8st4zrhu…`](https://nearblocks.io/txns/8st4zrhupRJoifwMmkrTQ9ZEmZokw3cjzXegDrS5HHot) |
| 176 | 2026-11-14 13:55:44 | `operator.wgpnear.near` (team) | itself | ok | [`EEJTddfm…`](https://nearblocks.io/txns/EEJTddfmwJPaMAXFhsxh1KgyRMDuYUcHcgyGKhKyhicj) |
| 177 | 2026-11-14 16:07:55 | `operator.wgpnear.near` (team) | itself | ok | [`4gLQ5xBS…`](https://nearblocks.io/txns/4gLQ5xBSNdRtxQGPikHeKPVrA1Zh9YS9rxkS7EukG6ZY) |
| 178 | 2026-11-14 17:07:15 | `operator.wgpnear.near` (team) | itself | ok | [`HbzA6aAu…`](https://nearblocks.io/txns/HbzA6aAuorUfZUvmKuEuTyke3csFnZx3EtKnnnM45GGw) |
| 179 | 2026-11-14 17:42:03 | `operator.wgpnear.near` (team) | itself | ok | [`9atvd3pR…`](https://nearblocks.io/txns/9atvd3pRvmj7z3E7S1bWZt4fNga4yaDdDJ9g9EjfYadT) |
| 180 | 2026-11-14 17:44:29 | `operator.wgpnear.near` (team) | itself | ok | [`DMbmKMSQ…`](https://nearblocks.io/txns/DMbmKMSQtJAPJi8SperYJyYbtNofppyMsEEZVNRF6xEd) |
| 181 | 2026-11-14 19:20:03 | `operator.wgpnear.near` (team) | itself | ok | [`6s1zKJLr…`](https://nearblocks.io/txns/6s1zKJLrMFETHE4nK1q7WKSHHNxqjLRJBHR9nDiuL2Fy) |
| 182 | 2026-11-14 19:22:56 | `operator.wgpnear.near` (team) | itself | ok | [`BtVsGkkF…`](https://nearblocks.io/txns/BtVsGkkF2GmYaZVSrtMm5wFQvvn6jzr8j1BJnS72MGeK) |
| 183 | 2026-11-14 19:26:11 | `operator.wgpnear.near` (team) | itself | ok | [`2KUoJpsF…`](https://nearblocks.io/txns/2KUoJpsF8GR9qsysWeWXRytY3i2MRQAm8hvrReknFFG6) |
| 184 | 2026-11-14 19:26:45 | `operator.wgpnear.near` (team) | itself | ok | [`5bVWoiVi…`](https://nearblocks.io/txns/5bVWoiViYMfrKUjQm5DkEf9gRRjm7HEjTPGPs4C1tz3q) |
| 185 | 2026-11-14 19:34:43 | `operator.wgpnear.near` (team) | itself | ok | [`8TN8Sfac…`](https://nearblocks.io/txns/8TN8SfachqKaWBYJ2tX2vMrWUzdzRveZky2kQzayHokG) |
| 186 | 2026-11-14 19:43:28 | `operator.wgpnear.near` (team) | itself | ok | [`4Hr64t1i…`](https://nearblocks.io/txns/4Hr64t1iS7civqKK12LKYaMv1i8gqvYMKBapKS5X739s) |
| 187 | 2026-11-14 19:45:08 | `operator.wgpnear.near` (team) | itself | ok | [`1yKeccmk…`](https://nearblocks.io/txns/1yKeccmkfJgDUhYinDWvMkxEgFhLr4fAw6DVMB6wZhS) |
| 188 | 2026-11-14 19:52:44 | `operator.wgpnear.near` (team) | itself | ok | [`32xU7xge…`](https://nearblocks.io/txns/32xU7xgeMqmt1Nwr8CHnt9TKbZZfAWMLirJmx8CWtW9f) |
| 189 | 2026-11-14 20:20:14 | `operator.wgpnear.near` (team) | itself | ok | [`GivCC93Z…`](https://nearblocks.io/txns/GivCC93ZNigeEsN24efmSf2wKsiHm7pBi4xCDne7LUmv) |
| 190 | 2026-11-14 20:24:12 | `operator.wgpnear.near` (team) | itself | ok | [`GYETxoKZ…`](https://nearblocks.io/txns/GYETxoKZ9HZN2z9DEXpxexcbFYQ9e4cKmENBqo3mteve) |
| 191 | 2026-11-14 20:29:08 | `operator.wgpnear.near` (team) | itself | ok | [`AbCAqx7o…`](https://nearblocks.io/txns/AbCAqx7o4NAMWpxQ2UMm34BG58RuoJSCQQR6YRsMv1aQ) |
| 192 | 2026-11-14 20:35:18 | `operator.wgpnear.near` (team) | itself | ok | [`J4WAuVWc…`](https://nearblocks.io/txns/J4WAuVWcdN8FSGSewbcnoU4bZZdB1cjXh1pxBVrP7hMJ) |
| 193 | 2026-11-14 20:37:23 | `operator.wgpnear.near` (team) | itself | ok | [`2GUfvKvs…`](https://nearblocks.io/txns/2GUfvKvsHHN9wvCfFtT7omETw4hFVeCZRCS3C7dPdUoc) |
| 194 | 2026-11-14 20:39:09 | `operator.wgpnear.near` (team) | itself | ok | [`DT7V2Gjm…`](https://nearblocks.io/txns/DT7V2Gjmu3TLKkpBz3EiYckypfTgDTCGYWhsDfR8ZHEx) |
| 195 | 2026-11-14 20:41:48 | `operator.wgpnear.near` (team) | itself | ok | [`9Sds6isY…`](https://nearblocks.io/txns/9Sds6isYFxvMjMkv2fWyjMKRcrTqEkqHFX7sTCVxbbyP) |
| 196 | 2026-11-14 23:55:18 | `operator.wgpnear.near` (team) | itself | ok | [`H7H1t9iS…`](https://nearblocks.io/txns/H7H1t9iS9McWQGDGSFXfsR1wwrQmEYj9Ndjc7cWJpmhx) |
| 197 | 2026-11-14 23:58:09 | `operator.wgpnear.near` (team) | itself | ok | [`9CYXBMyt…`](https://nearblocks.io/txns/9CYXBMytKPe88NMPKEJsnWvDjgq1DLUrcU6N6NNpU4wM) |
| 198 | 2026-11-15 00:00:48 | `operator.wgpnear.near` (team) | itself | ok | [`7M4KzKm2…`](https://nearblocks.io/txns/7M4KzKm2fLLVjq2qBmmTvHdc15KUyDTGDcG36WqAkgkB) |
| 199 | 2026-11-15 00:30:57 | `operator.wgpnear.near` (team) | itself | ok | [`51pSAhou…`](https://nearblocks.io/txns/51pSAhouEMKz7erAxyRNisz14rDVpUH683hi2BMKo4oe) |
| 200 | 2026-11-15 00:41:29 | `operator.wgpnear.near` (team) | itself | ok | [`wuus8WpR…`](https://nearblocks.io/txns/wuus8WpRkJHWFQay2FSyqBtRHAaX7MWH81oAQN94YV4) |
| 201 | 2026-11-15 01:26:37 | `operator.wgpnear.near` (team) | itself | ok | [`GUQw6oi5…`](https://nearblocks.io/txns/GUQw6oi5gQuvibCXptqQnCPr1q2htzoQCJvpi3mciEpJ) |
| 202 | 2026-11-15 03:29:12 | `operator.wgpnear.near` (team) | itself | ok | [`FMDvvsDp…`](https://nearblocks.io/txns/FMDvvsDpbXrfdBWWwsQVri4bZP68rjj9tWA59oGr1oks) |
| 203 | 2026-11-15 03:32:26 | `operator.wgpnear.near` (team) | itself | ok | [`ufwL5fsn…`](https://nearblocks.io/txns/ufwL5fsnf1MbFSrteroCkmBw8BP8SzJbumTdP1KPLiS) |
| 204 | 2026-11-15 04:54:26 | `operator.wgpnear.near` (team) | itself | ok | [`Yu77NVmb…`](https://nearblocks.io/txns/Yu77NVmbtZsZGJ66tYTZCjq3BbgEEJnmWesgBNDrGTR) |
| 205 | 2026-11-15 06:08:12 | `operator.wgpnear.near` (team) | itself | ok | [`5guSMHVa…`](https://nearblocks.io/txns/5guSMHVaA3PiiMphWicup6tN4LfoZbQdgDHzKMYkNy94) |
| 206 | 2026-11-15 06:11:44 | `operator.wgpnear.near` (team) | itself | ok | [`C1BL7kgh…`](https://nearblocks.io/txns/C1BL7kghudGua5ujAnFyJfb4wdeLQDa1RV1k7gmtuHau) |
| 207 | 2026-11-15 06:15:05 | `operator.wgpnear.near` (team) | itself | ok | [`5ik9mniR…`](https://nearblocks.io/txns/5ik9mniRotHFe79jxjJirFi5YmDnx9FioYSCf3sHgSXy) |
| 208 | 2026-11-15 06:18:31 | `operator.wgpnear.near` (team) | itself | ok | [`C3wXgQhk…`](https://nearblocks.io/txns/C3wXgQhkXFKmN1as7x6TvJ34Wypz6NzToBRV7ChTd3Sn) |
| 209 | 2026-11-15 06:22:51 | `operator.wgpnear.near` (team) | itself | ok | [`3doBhfNh…`](https://nearblocks.io/txns/3doBhfNhmdDV6ZJ3B8JBP3EZiVVLxJhg2NZdKEtRmsBY) |
| 210 | 2026-11-15 06:25:48 | `operator.wgpnear.near` (team) | itself | ok | [`EujZGj5A…`](https://nearblocks.io/txns/EujZGj5ATLWpyZdRSoVBBRf1QF4V1FGXkXxHU8GYgwPz) |
| 211 | 2026-11-15 08:44:55 | `operator.wgpnear.near` (team) | itself | ok | [`Gk8osacV…`](https://nearblocks.io/txns/Gk8osacVy8LJAvWndAu2NAAxq7dxmPsDfHtW52bLuPKo) |
| 212 | 2026-11-15 09:00:49 | `operator.wgpnear.near` (team) | itself | ok | [`GpGJhBsQ…`](https://nearblocks.io/txns/GpGJhBsQqwbUZmE3oAEiCXpm19jP9A5AVWgHyTYsm246) |
| 213 | 2026-11-15 09:06:57 | `operator.wgpnear.near` (team) | itself | ok | [`GbxZAiRW…`](https://nearblocks.io/txns/GbxZAiRWMdd6wGr6qgzJnxGnptbNayjtVe3QXZX5TYXn) |
| 214 | 2026-11-15 11:03:49 | `operator.wgpnear.near` (team) | itself | ok | [`HPd149nP…`](https://nearblocks.io/txns/HPd149nPQPRG6NqVMHZUMnJ9BzamCZGUr26Nt5iMrwMa) |
| 215 | 2026-11-15 11:06:19 | `operator.wgpnear.near` (team) | itself | ok | [`BYeU8rQ3…`](https://nearblocks.io/txns/BYeU8rQ3jE8mu3mCNkmipMHiQYxwn4RocueqdDZdJTLV) |
| 216 | 2026-11-15 11:38:59 | `operator.wgpnear.near` (team) | itself | ok | [`8JwQWc1Q…`](https://nearblocks.io/txns/8JwQWc1QAZHKNZqyft9oiTf91kPzi9tPFbpmiJ4Hqhun) |
| 217 | 2026-11-15 11:43:36 | `operator.wgpnear.near` (team) | itself | ok | [`9hgByNhh…`](https://nearblocks.io/txns/9hgByNhhEd5dTgE2NFJ8AUJCSodHPNhmWeowkXv7hBAP) |
| 218 | 2026-11-15 12:42:47 | `operator.wgpnear.near` (team) | itself | ok | [`AChadWGz…`](https://nearblocks.io/txns/AChadWGzBwBbtUnZSaX27hGk4NmSaJACDWFncrgbTUKv) |
| 219 | 2026-11-15 12:47:29 | `operator.wgpnear.near` (team) | itself | ok | [`J2KYsawn…`](https://nearblocks.io/txns/J2KYsawnnL2frmezXxFbAKCJQW5vkmZEpJBKzsU4Dncb) |
| 220 | 2026-11-15 13:10:46 | `operator.wgpnear.near` (team) | itself | ok | [`HrVTjn2W…`](https://nearblocks.io/txns/HrVTjn2Wi8vLKD9qU7RfTSN5iGZU4Vi8GBSUJr5bx9fA) |
| 221 | 2026-11-15 13:16:52 | `operator.wgpnear.near` (team) | itself | ok | [`98hmCmno…`](https://nearblocks.io/txns/98hmCmnoGkfp4rbhaccn9mU9xfJELWP2zaVNTovkrw73) |
| 222 | 2026-11-15 13:20:54 | `operator.wgpnear.near` (team) | itself | ok | [`HEoP4YoX…`](https://nearblocks.io/txns/HEoP4YoXKjSuDiYMNWaA2Nzt5yqBpqNErxV4wpwWssXn) |
| 223 | 2026-11-15 13:22:52 | `operator.wgpnear.near` (team) | itself | ok | [`H82FpVGT…`](https://nearblocks.io/txns/H82FpVGT5czfs6NSaZYFXx7SUhPiZj24ANTqg8K2JPR) |
| 224 | 2026-11-15 13:24:28 | `operator.wgpnear.near` (team) | itself | ok | [`6yG6oiSN…`](https://nearblocks.io/txns/6yG6oiSNTQFqunXMVAGeoJxCdu9hfagy1ikyBmFpo7Gz) |
| 225 | 2026-11-15 13:27:15 | `operator.wgpnear.near` (team) | itself | ok | [`F9Zg9DMU…`](https://nearblocks.io/txns/F9Zg9DMUsvPLz8d1sehKaRyfKzpoVLjUC2L6YbYkC5Td) |
| 226 | 2026-11-15 13:31:56 | `operator.wgpnear.near` (team) | itself | ok | [`GQFg67kJ…`](https://nearblocks.io/txns/GQFg67kJfEV5HD8eJemjrgY9hg1zKMT1BeLFD5z7TugX) |
| 227 | 2026-11-15 13:34:58 | `operator.wgpnear.near` (team) | itself | ok | [`14TtrXCC…`](https://nearblocks.io/txns/14TtrXCCtvwazNcAyTStZnxjk8sA2ynzboT32W9bXxcm) |
| 228 | 2026-11-15 13:41:05 | `operator.wgpnear.near` (team) | itself | ok | [`BCe7gkC3…`](https://nearblocks.io/txns/BCe7gkC3t5ZLAD4WbDTUmopJwbFgCdbPNVyGZ9DPbEuV) |
| 229 | 2026-11-15 13:44:13 | `operator.wgpnear.near` (team) | itself | ok | [`7L6whyzB…`](https://nearblocks.io/txns/7L6whyzBCM88herdChKrGRPRWW9HLW3LNrGQwBEvT2Rh) |
| 230 | 2026-11-15 13:46:54 | `operator.wgpnear.near` (team) | itself | ok | [`5bWNvRNT…`](https://nearblocks.io/txns/5bWNvRNTdWJiXx6WdqFg4FQMHhWmuzauzHkTN8WSio2T) |
| 231 | 2026-11-15 13:49:42 | `operator.wgpnear.near` (team) | itself | ok | [`GDfpPJZr…`](https://nearblocks.io/txns/GDfpPJZrNfeMC3oe5sCBdf3tVuSpWTfobBHN7Vfruqi3) |
| 232 | 2026-11-15 13:52:29 | `operator.wgpnear.near` (team) | itself | ok | [`3EfMbRG6…`](https://nearblocks.io/txns/3EfMbRG6TT2LgUuMoDx976v72iehGGv6xXNRsaBZ671x) |
| 233 | 2026-11-15 13:57:03 | `operator.wgpnear.near` (team) | itself | ok | [`DhfxogiH…`](https://nearblocks.io/txns/DhfxogiHHwUqbXy87oC9BRhJH7dv9e9yVc1Dx7Tn7i4V) |
| 234 | 2026-11-15 13:59:16 | `operator.wgpnear.near` (team) | itself | ok | [`55tsGErV…`](https://nearblocks.io/txns/55tsGErV2vQyER1mfYp9MJYcmkhCXe4acRLL5jHcw3td) |
| 235 | 2026-11-15 16:30:16 | `operator.wgpnear.near` (team) | itself | ok | [`65cM4wmv…`](https://nearblocks.io/txns/65cM4wmvkmX4CnNN2myRA7zxJSTPFneu4dkQRaoMqR24) |

### `record_season`

1 call, 0 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-15 01:26:36 | `operator.wgpnear.near` (team) | itself | ok | [`AxLWpz5m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX) |

### `deploy_contract`

2 calls, 1 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-03 16:03:02 | `game.wgpnear.near` (contract), with deploy_contract + new | itself | **failed** | [`3h6JxxeZ…`](https://nearblocks.io/txns/3h6JxxeZofE6rqZEx5WV8XjqLJWnGZeKjcuX6j7GFLJd) |
| 2 | 2026-11-03 17:10:05 | `game.wgpnear.near` (contract), with deploy_contract + new | itself | ok | [`8nyXGMNu…`](https://nearblocks.io/txns/8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR) |

### `set_rules`

1 call, 0 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-15 08:27:28 | `wgpnear.near` (team) | itself | ok | [`GzMYer3o…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY) |

### `set_market_params`

2 calls, 0 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-03 17:10:16 | `wgpnear.near` (team) | itself | ok | [`FdQxVNyz…`](https://nearblocks.io/txns/FdQxVNyziV7ioNWPAfL9yAWJ8u2wDN3kRKpEX4JSVcCR) |
| 2 | 2026-11-15 08:27:51 | `wgpnear.near` (team) | itself | ok | [`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK) |

### `storage_deposit`

1 call, 0 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-14 20:21:42 | `game.wgpnear.near` (contract) to `wrap.near` | itself | ok | [`DWFUoozv…`](https://nearblocks.io/txns/DWFUoozvVD7ZLDwxCvrQusKd13mXFVSR9g5qCrx4gvAr) |

### (create_account + transfer + add_key)

1 call, 0 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-03 15:50:27 | `wgpnear.near` (team) | itself | ok | [`8tRgGW8G…`](https://nearblocks.io/txns/8tRgGW8GPwS6EJwaDGaZ4mfyGTkXwJWXCq46UF1u9g8v) |

### (transfer)

6 calls, 1 failed.

| # | UTC time | Caller | Sent by | Result | Transaction |
|--:|---|---|---|---|---|
| 1 | 2026-11-03 16:03:02 | `system` (system) | `game.wgpnear.near` (contract) | **failed** | [`3h6JxxeZ…`](https://nearblocks.io/txns/3h6JxxeZofE6rqZEx5WV8XjqLJWnGZeKjcuX6j7GFLJd) |
| 2 | 2026-11-03 17:10:05 | `system` (system) | `game.wgpnear.near` (contract) | ok | [`8nyXGMNu…`](https://nearblocks.io/txns/8nyXGMNuFmQkvwJyC9PZv1JVM54Go45QZ69HXXppC1JR) |
| 3 | 2026-11-13 07:00:50 | `relayer.wgpnear.near` (team) | itself | ok | [`FH2tpfkz…`](https://nearblocks.io/txns/FH2tpfkzDkY8MtEX6fWCmMc7E7RRndGA8nibM1ZYEjuB) |
| 4 | 2026-11-14 20:21:23 | `system` (system) | `game.wgpnear.near` (contract) | ok | [`GU8GVkK3…`](https://nearblocks.io/txns/GU8GVkK3a2mDkypzEz1cAVnHihVQLKQBUJKQ9oeyYs2d) |
| 5 | 2026-11-14 20:21:23 | `game.wgpnear.near` (contract) to `relayer.wgpnear.near` (team) | itself | ok | [`GU8GVkK3…`](https://nearblocks.io/txns/GU8GVkK3a2mDkypzEz1cAVnHihVQLKQBUJKQ9oeyYs2d) |
| 6 | 2026-11-14 20:21:42 | `system` (system) | `game.wgpnear.near` (contract) | ok | [`DWFUoozv…`](https://nearblocks.io/txns/DWFUoozvVD7ZLDwxCvrQusKd13mXFVSR9g5qCrx4gvAr) |

## `wgpnear.near`

The owner and factory account (team): it created the contract's, the relayer's, the operator's and Sandwich Man's accounts and players' `*.wgpnear.near` accounts, and it sends the owner's calls to the contract. (The contract's code was deployed by a transaction `game.wgpnear.near` signed itself; see `deploy_contract` above.) Every transaction it signed or received, oldest first: 39, 0 failed.

| # | UTC time | What | Signer | Receiver | NEAR | Result | Transaction |
|--:|---|---|---|---|---|---|---|
| 1 | 2026-11-03 15:50:27 | creates `game.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `game.wgpnear.near` (contract) | 4.5 | ok | [`8tRgGW8G…`](https://nearblocks.io/txns/8tRgGW8GPwS6EJwaDGaZ4mfyGTkXwJWXCq46UF1u9g8v) |
| 2 | 2026-11-03 15:50:41 | creates `relayer.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `relayer.wgpnear.near` (team) | 2 | ok | [`Fs8zLtbG…`](https://nearblocks.io/txns/Fs8zLtbGUfCAyAG4FRvN1wgjZPf3tKXxR9jB9dihrbAi) |
| 3 | 2026-11-03 15:50:55 | creates `operator.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `operator.wgpnear.near` (team) | 1 | ok | [`FVjmHDbD…`](https://nearblocks.io/txns/FVjmHDbDra1YqaNWAQ1z6CsjcJ61Cue6AX21aYujAj6w) |
| 4 | 2026-11-03 17:10:16 | `set_market_params` on `game.wgpnear.near` | `wgpnear.near` (team) | `game.wgpnear.near` (contract) | <0.0001 | ok | [`FdQxVNyz…`](https://nearblocks.io/txns/FdQxVNyziV7ioNWPAfL9yAWJ8u2wDN3kRKpEX4JSVcCR) |
| 5 | 2026-11-03 18:31:54 | creates `sele.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `sele.wgpnear.near` (author) |  | ok | [`CY6esX2A…`](https://nearblocks.io/txns/CY6esX2ALc9qoDqSVBkuHP29ovDSZpH32C7cLaYL48iT) |
| 6 | 2026-11-06 07:53:28 | creates `azalleaxyz.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`4XCiuHZ9…`](https://nearblocks.io/txns/4XCiuHZ9YB6ZBjVyb9FQNrJr6F4pTgDwrCqPtrXS46XT) |
| 7 | 2026-11-06 08:32:51 | creates `danielgreat438.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `danielgreat438.wgpnear.near` |  | ok | [`7AURffx2…`](https://nearblocks.io/txns/7AURffx2FAPgEdRCq3PjLr3AmYqPgkLEy4BqRPK7meoF) |
| 8 | 2026-11-06 10:46:56 | creates `9a_z53.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`DFF1SsPj…`](https://nearblocks.io/txns/DFF1SsPjKPto6Kxa3TfpdX2pSMNC9GftnbJuz9PRWcV8) |
| 9 | 2026-11-06 17:58:37 | creates `tmt027.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `tmt027.wgpnear.near` |  | ok | [`4LdXTau4…`](https://nearblocks.io/txns/4LdXTau4s4nq9q2oNWsaRVP7nmiBzegqDjVCg72nvCVh) |
| 10 | 2026-11-07 04:11:21 | `storage_deposit` on `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | `wgpnear.near` (team) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | 0.0125 | ok | [`3bFLwZ3j…`](https://nearblocks.io/txns/3bFLwZ3jNcRpTfKJF1tuWD1zbSgv9fX7SoPRDDUKn2xt) |
| 11 | 2026-11-07 04:11:26 | `storage_deposit` on `wrap.near` | `wgpnear.near` (team) | `wrap.near` | 0.0013 | ok | [`FVQ2yifJ…`](https://nearblocks.io/txns/FVQ2yifJi83mCCEBPTNjgkhgSsUVekkAQA8qQbMQ2SiR) |
| 12 | 2026-11-07 04:11:28 | `storage_deposit` on `nearly-993927.nearlytrade.near` | `wgpnear.near` (team) | `nearly-993927.nearlytrade.near` | 0.0013 | ok | [`Epj3QSdP…`](https://nearblocks.io/txns/Epj3QSdP8iCPK9h6wk5f6Mc2WZnr7j7BD4BadkvF92gQ) |
| 13 | 2026-11-07 04:11:31 | `tokens_storage_deposit` on `aggregatedex.near` | `wgpnear.near` (team) | `aggregatedex.near` | 0.015 | ok | [`3qrwpzH8…`](https://nearblocks.io/txns/3qrwpzH8CwLuCxRXrTWqx3GDpKU8mnVYYozvb3djxEvi) |
| 14 | 2026-11-07 04:11:34 | `storage_deposit`, `near_deposit` on `wrap.near` | `wgpnear.near` (team) | `wrap.near` | 1.5012 | ok | [`MYKN9SJK…`](https://nearblocks.io/txns/MYKN9SJKyedVE3nKcrEToA2LH5kDkip5ttwcxkQTAz3) |
| 15 | 2026-11-07 04:11:37 | `ft_transfer_call` on `wrap.near` | `wgpnear.near` (team) | `wrap.near` | <0.0001 | ok | [`6ZWKnfJt…`](https://nearblocks.io/txns/6ZWKnfJtYgtufTNs2BPQGypC2coQP2rVX7fzbYFg2XRr) |
| 16 | 2026-11-07 04:12:21 | `ft_transfer` on `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | `wgpnear.near` (team) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | <0.0001 | ok | [`FKfoD8ZL…`](https://nearblocks.io/txns/FKfoD8ZLqFpuE7fsGhEKv9A3aQT3QxSz1CLYM72WyjsV) |
| 17 | 2026-11-07 12:16:09 | creates `eminence.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `eminence.wgpnear.near` |  | ok | [`Pgreu5fz…`](https://nearblocks.io/txns/Pgreu5fz5gwzueDTx8C32XCwGzA1Y4Vvu2YFEdMJTPr) |
| 18 | 2026-11-07 14:28:35 | creates `unrealami.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `unrealami.wgpnear.near` |  | ok | [`F392ZZ1L…`](https://nearblocks.io/txns/F392ZZ1LusyKAFwfVGQf2P3MimYRJg5eJ7mEnmpaYFjd) |
| 19 | 2026-11-07 16:44:35 | creates `tiamiyufuhad07.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `tiamiyufuhad07.wgpnear.near` |  | ok | [`9Ussy2Xg…`](https://nearblocks.io/txns/9Ussy2XgJYzkw9tFEThs8fYtq2XVhgCrB2dunebHzjY4) |
| 20 | 2026-11-07 18:59:45 | creates `miracleigbinoghene.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `miracleigbinoghene.wgpnear.near` |  | ok | [`ZXAae5BP…`](https://nearblocks.io/txns/ZXAae5BPFqFicxJY9gVrzhEnRi6vMJkuN2otskgGagc) |
| 21 | 2026-11-08 01:54:43 | creates `nsymm073.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `nsymm073.wgpnear.near` |  | ok | [`5Y1pVvBG…`](https://nearblocks.io/txns/5Y1pVvBGNP59mQMWbnQMoBT58aHY3vbz6VwTA3PRFfPF) |
| 22 | 2026-11-08 06:23:11 | creates `nasibabalili7.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `nasibabalili7.wgpnear.near` |  | ok | [`HJrp7yHy…`](https://nearblocks.io/txns/HJrp7yHyHx4a5eFGUvFs9EgJDcPAjWFaw9uAsy3k7UUS) |
| 23 | 2026-11-08 09:13:23 | creates `alirezam2300.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `alirezam2300.wgpnear.near` |  | ok | [`G9ADH3aJ…`](https://nearblocks.io/txns/G9ADH3aJH91duR9uD6oWCVrgSeXZV4EQ3uSLTpBLbuSw) |
| 24 | 2026-11-08 09:56:32 | creates `hossinshabani1389.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`EHnrghPZ…`](https://nearblocks.io/txns/EHnrghPZja5vYUEDj12wC71veskJUS7eCE2hDVZrSbWP) |
| 25 | 2026-11-08 14:36:51 | creates `mohsenmanm.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `mohsenmanm.wgpnear.near` |  | ok | [`2D8sGh2w…`](https://nearblocks.io/txns/2D8sGh2wHQNxPG9mKiNA9RURAr1GaRyKWe4viFHbrCyv) |
| 26 | 2026-11-09 09:24:43 | creates `dominic_jovinic.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `dominic_jovinic.wgpnear.near` |  | ok | [`8JM3aFHK…`](https://nearblocks.io/txns/8JM3aFHKerdBFd3FKupjQ1Wd9ZZnAhJfeREvgKRbbEdq) |
| 27 | 2026-11-09 14:26:22 | creates `jamesutibeabassi.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `jamesutibeabassi.wgpnear.near` |  | ok | [`A3gtEEdp…`](https://nearblocks.io/txns/A3gtEEdpGMcuJP7q5BndwAFtUbccuqh3JFpHHzxSgAU6) |
| 28 | 2026-11-09 17:07:40 | `tokens_storage_deposit` on `aggregatedex.near` | `wgpnear.near` (team) | `aggregatedex.near` | 0.005 | ok | [`H5CDVy14…`](https://nearblocks.io/txns/H5CDVy14avALFsqqWKhQuBmEz6DTy5e3hX2oqRD7fmPQ) |
| 29 | 2026-11-09 17:07:43 | `near_deposit` on `wrap.near` | `wgpnear.near` (team) | `wrap.near` | 0.8 | ok | [`4TAUzDnG…`](https://nearblocks.io/txns/4TAUzDnGQvHM8TDpg1kbX4XcQBNoW2qPmCPTtmZ5KFEw) |
| 30 | 2026-11-09 17:07:46 | `ft_transfer_call` on `wrap.near` | `wgpnear.near` (team) | `wrap.near` | <0.0001 | ok | [`4LdDbudz…`](https://nearblocks.io/txns/4LdDbudzCfFy7oNq4qL13SA5AHaAwSmhotH85DfpwVev) |
| 31 | 2026-11-09 17:09:29 | `ft_transfer` on `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | `wgpnear.near` (team) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | <0.0001 | ok | [`BTcpHBi1…`](https://nearblocks.io/txns/BTcpHBi1E45pPVuNWe8t9sKbNMdC5qNdtArJkvk4v9Lk) |
| 32 | 2026-11-12 19:04:50 | creates `rezau641.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `rezau641.wgpnear.near` |  | ok | [`By97XD1i…`](https://nearblocks.io/txns/By97XD1i2oYdwX9ELK4HkCMtEDpw6bj6vBSK3b1jmB8E) |
| 33 | 2026-11-13 07:01:05 | transfer in from `operator.wgpnear.near` (team) | `operator.wgpnear.near` (team) | `wgpnear.near` (team) | 0.4 | ok | [`62fPSQ4h…`](https://nearblocks.io/txns/62fPSQ4hi4MEgzVpfKXgnkXQPQAaF6VPRpSWaMBZ29bN) |
| 34 | 2026-11-13 07:03:12 | creates `sandwich.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `sandwich.wgpnear.near` (NPC) | 0.3 | ok | [`Hx32N4dy…`](https://nearblocks.io/txns/Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm) |
| 35 | 2026-11-14 06:31:03 | creates `ruru.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `ruru.wgpnear.near` |  | ok | [`9ue5cYCV…`](https://nearblocks.io/txns/9ue5cYCVv2S5gRMGPzWCpzbSBAVaireen1NHMhTTvhXg) |
| 36 | 2026-11-14 19:03:45 | creates `m200ff.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `m200ff.wgpnear.near` |  | ok | [`6eq9Yt2t…`](https://nearblocks.io/txns/6eq9Yt2tWHCGMsnhhevD6NcLybFvhaGcghHq7RyZ6xac) |
| 37 | 2026-11-15 06:51:23 | `ft_transfer` on `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | `wgpnear.near` (team) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | <0.0001 | ok | [`EKkXmH9V…`](https://nearblocks.io/txns/EKkXmH9VRfpFRYruRUgU5f4uKwsZEptjQiyxcV7Br8iT) |
| 38 | 2026-11-15 08:27:28 | `set_rules` on `game.wgpnear.near` | `wgpnear.near` (team) | `game.wgpnear.near` (contract) | <0.0001 | ok | [`GzMYer3o…`](https://nearblocks.io/txns/GzMYer3o5CoxzaUmHGRn3K7nweHLWLxoCVj61Wo51EXY) |
| 39 | 2026-11-15 08:27:51 | `set_market_params` on `game.wgpnear.near` | `wgpnear.near` (team) | `game.wgpnear.near` (contract) | <0.0001 | ok | [`BskDQS99…`](https://nearblocks.io/txns/BskDQS99TNYaxZqmhEHD5WA8B2R8HqcEW69fkXkhJuoK) |

## `relayer.wgpnear.near`

The relayer (team): it signs and pays for players' relayed calls (NEP-366) and receives the top-ups that keep it running. Every transaction it signed or received, oldest first: 88, 2 failed.

| # | UTC time | What | Signer | Receiver | NEAR | Result | Transaction |
|--:|---|---|---|---|---|---|---|
| 1 | 2026-11-03 15:50:41 | creates `relayer.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `relayer.wgpnear.near` (team) | 2 | ok | [`Fs8zLtbG…`](https://nearblocks.io/txns/Fs8zLtbGUfCAyAG4FRvN1wgjZPf3tKXxR9jB9dihrbAi) |
| 2 | 2026-11-03 18:33:28 | relayed `market_buy` for `sele.wgpnear.near` (author) | `relayer.wgpnear.near` (team) | `sele.wgpnear.near` (author) |  | ok | [`GxuFQYCX…`](https://nearblocks.io/txns/GxuFQYCX7DzCFRXenpQuhfxz1hUekf9t2FapLjCUeMXn) |
| 3 | 2026-11-06 07:53:57 | relayed `register_hero` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`6H2hdWkb…`](https://nearblocks.io/txns/6H2hdWkb3jKEX22dM33AMnpLJ6ei8C8KFqG9MbpH2BtY) |
| 4 | 2026-11-06 08:29:47 | relayed `craft_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`HLpan7DQ…`](https://nearblocks.io/txns/HLpan7DQxbGW5cd4W7Gret6ULKTZA8hBvnvX63ywTacg) |
| 5 | 2026-11-06 08:29:51 | relayed `craft_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`HiDVcMPF…`](https://nearblocks.io/txns/HiDVcMPFdybazmLvPs7wGTckxPRy3TXjuaQbyNRWYJJ5) |
| 6 | 2026-11-06 08:29:54 | relayed `craft_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`CNhZ5nDH…`](https://nearblocks.io/txns/CNhZ5nDHjEkkjXdySU8y8bTVeHgPhcsV8ewQoY1y5Diq) |
| 7 | 2026-11-06 08:29:57 | relayed `craft_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`9vMrQz51…`](https://nearblocks.io/txns/9vMrQz51GUu4QNcVFnrt3bxvGReDEht7x4cGBHW81BLe) |
| 8 | 2026-11-06 08:30:00 | relayed `craft_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`er8xveXX…`](https://nearblocks.io/txns/er8xveXX29D7Rt56h29kUkYtoX7QUiQSBS3LNzcyvPS) |
| 9 | 2026-11-06 08:30:05 | relayed `equip_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`3deMuBXT…`](https://nearblocks.io/txns/3deMuBXTex491aaRTopWUdA19hFAZE43DB8rhwg2SPeJ) |
| 10 | 2026-11-06 08:32:59 | relayed `register_hero` for `danielgreat438.wgpnear.near` | `relayer.wgpnear.near` (team) | `danielgreat438.wgpnear.near` |  | ok | [`BWAFmGyg…`](https://nearblocks.io/txns/BWAFmGygHCLdu7ZMzc3pfvQKcRdb732yyL42zdWmCwrz) |
| 11 | 2026-11-06 08:35:00 | relayed `list_item` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`GXsZ5kk4…`](https://nearblocks.io/txns/GXsZ5kk4jz5LcdcLs5CWEvxKxew1AexHH41gtDouNpw2) |
| 12 | 2026-11-06 08:35:30 | relayed `list_item` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`Cp6ukdoG…`](https://nearblocks.io/txns/Cp6ukdoGwcmPS6JxyTBeBpjg5UtKiutwnYyBf54YuMnE) |
| 13 | 2026-11-06 08:44:36 | relayed `craft_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`DsDXXhgD…`](https://nearblocks.io/txns/DsDXXhgDpdYyypBWXaQ3jPDT2wmNnvX4bdPvGGicEwwG) |
| 14 | 2026-11-06 08:44:39 | relayed `craft_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`2fh7hjMH…`](https://nearblocks.io/txns/2fh7hjMHVGC7hrQGHJvRjaKDhGz2MuFxtzdGymrgs3Nw) |
| 15 | 2026-11-06 08:44:42 | relayed `equip_suit` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`EJtZ86Uk…`](https://nearblocks.io/txns/EJtZ86Uk6jtmK2GFknuzbfcphLJw36UkqdGzfY73FLxw) |
| 16 | 2026-11-06 10:49:04 | relayed `register_hero` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`2xZZRYKE…`](https://nearblocks.io/txns/2xZZRYKEnXgAD6TGQzGSLhDeE4FfYj6LerYB8wuakmnB) |
| 17 | 2026-11-06 10:53:32 | relayed `craft_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`82C29gRb…`](https://nearblocks.io/txns/82C29gRbcCPoNpWJ6vHMkfWJeUGKxyiGvbmXdSJfirjg) |
| 18 | 2026-11-06 12:31:14 | relayed `craft_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`AkEeFXFD…`](https://nearblocks.io/txns/AkEeFXFD2iq2nCoqrV336htAULzQigKCZNCS4K1J68nw) |
| 19 | 2026-11-06 12:31:22 | relayed `craft_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`EhZd1XpF…`](https://nearblocks.io/txns/EhZd1XpFVkY9Uhfta5ZJqHQu85N6WAvB7nE55nAiF9ti) |
| 20 | 2026-11-06 12:31:25 | relayed `craft_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`DU7d4WXx…`](https://nearblocks.io/txns/DU7d4WXx7pNxJKm1PYmhev5b6HMzghPnDugHW6mfTjdm) |
| 21 | 2026-11-06 12:31:29 | relayed `craft_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`23dzqYCu…`](https://nearblocks.io/txns/23dzqYCuEg5RNZjyKYFWGGDyWgoWuHsy7q4BDfKJaN2s) |
| 22 | 2026-11-06 17:13:28 | relayed `market_buy` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`ASmRJdKZ…`](https://nearblocks.io/txns/ASmRJdKZy3fMPAPNNogcABL4Wdr7CiPPasAxRjXr5xRq) |
| 23 | 2026-11-06 17:13:40 | relayed `craft_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`7fYmhfbF…`](https://nearblocks.io/txns/7fYmhfbFb3Ssm5jMZn2Rc8nH6dDREaJKK8Z3VcJDYxeG) |
| 24 | 2026-11-06 17:59:54 | relayed `register_hero` for `tmt027.wgpnear.near` | `relayer.wgpnear.near` (team) | `tmt027.wgpnear.near` |  | ok | [`2q2Ecrt5…`](https://nearblocks.io/txns/2q2Ecrt5wKw6E9HoBMqSTC6rLVhBuB9GaT4HoJD1zMPW) |
| 25 | 2026-11-06 17:59:58 | relayed `register_hero` for `tmt027.wgpnear.near` | `relayer.wgpnear.near` (team) | `tmt027.wgpnear.near` |  | **failed in contract** | [`7sJSe7Xq…`](https://nearblocks.io/txns/7sJSe7XqTWvKfk58NS5eWvqTinnzENr85M5a7g8RTyFq) |
| 26 | 2026-11-07 02:11:02 | relayed `list_item` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`8tK8yxJc…`](https://nearblocks.io/txns/8tK8yxJciaq75EEP8eTxyB62CtEvo33Ve1c8tFAjHWQh) |
| 27 | 2026-11-07 02:50:53 | relayed `equip_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`hptQiXTN…`](https://nearblocks.io/txns/hptQiXTNCVXWZ6nZUd9a8yNbjthKq4tagc3x3eLLGGP) |
| 28 | 2026-11-07 06:39:41 | relayed add_key for `sele.wgpnear.near` (author) | `relayer.wgpnear.near` (team) | `sele.wgpnear.near` (author) |  | ok | [`AQyswGva…`](https://nearblocks.io/txns/AQyswGvau7g6j765SPRXQdyzBodd2JHuB9kpH1Euogby) |
| 29 | 2026-11-07 06:39:45 | relayed `register_hero` for `sele.wgpnear.near` (author) | `relayer.wgpnear.near` (team) | `sele.wgpnear.near` (author) |  | ok | [`4gZgoayL…`](https://nearblocks.io/txns/4gZgoayLbxP2whPgEK5FWi62JZZMUuRZmsgu7D5BgATM) |
| 30 | 2026-11-07 12:16:24 | relayed `register_hero` for `eminence.wgpnear.near` | `relayer.wgpnear.near` (team) | `eminence.wgpnear.near` |  | ok | [`5DhqdLnz…`](https://nearblocks.io/txns/5DhqdLnzjmR2db8RANHoTBboV3xXmpczhAj1vKHsaPWv) |
| 31 | 2026-11-07 14:01:56 | relayed `equip_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`3zxEHo8w…`](https://nearblocks.io/txns/3zxEHo8wkGU87SZSLWkGT1RzB11ybZRbLighxeQbJhz9) |
| 32 | 2026-11-07 14:28:46 | relayed `register_hero` for `unrealami.wgpnear.near` | `relayer.wgpnear.near` (team) | `unrealami.wgpnear.near` |  | ok | [`9DV4hmtA…`](https://nearblocks.io/txns/9DV4hmtAgeqEgZcafjoyLkozfUQo6paFySev7Uw8Vwf2) |
| 33 | 2026-11-07 16:45:06 | relayed `register_hero` for `tiamiyufuhad07.wgpnear.near` | `relayer.wgpnear.near` (team) | `tiamiyufuhad07.wgpnear.near` |  | ok | [`7aTFPKHr…`](https://nearblocks.io/txns/7aTFPKHrjLtWzdS5R8LjJrHuetPYH874EHjWnB6u7LAZ) |
| 34 | 2026-11-07 19:00:40 | relayed `register_hero` for `miracleigbinoghene.wgpnear.near` | `relayer.wgpnear.near` (team) | `miracleigbinoghene.wgpnear.near` |  | ok | [`5ZRBSMUa…`](https://nearblocks.io/txns/5ZRBSMUa6fBQpiczCp9Giai8RcZDRw7mAVdcwLioR5RR) |
| 35 | 2026-11-08 01:55:00 | relayed `register_hero` for `nsymm073.wgpnear.near` | `relayer.wgpnear.near` (team) | `nsymm073.wgpnear.near` |  | ok | [`6pL8jqaW…`](https://nearblocks.io/txns/6pL8jqaWM7Y9T9y29VTmZEXgHzpNaFxpoHc9jtxrKTWk) |
| 36 | 2026-11-08 04:00:48 | relayed `equip_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`2Y4D7eXS…`](https://nearblocks.io/txns/2Y4D7eXS1L861WEjiAFDaFiQLdUzSbgfnjPgnZEaTpq3) |
| 37 | 2026-11-08 06:23:21 | relayed `register_hero` for `nasibabalili7.wgpnear.near` | `relayer.wgpnear.near` (team) | `nasibabalili7.wgpnear.near` |  | ok | [`6TYcVCHt…`](https://nearblocks.io/txns/6TYcVCHtBJsNwd7U74VT4zfsCktpB81v4Q5fR3YtbmJy) |
| 38 | 2026-11-08 09:13:31 | relayed `register_hero` for `alirezam2300.wgpnear.near` | `relayer.wgpnear.near` (team) | `alirezam2300.wgpnear.near` |  | ok | [`9yHZsqSz…`](https://nearblocks.io/txns/9yHZsqSzs1tMqZqDxz27SgrSMbxECcacHZ2B4CGY12oX) |
| 39 | 2026-11-08 09:57:36 | relayed `register_hero` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`HqcboLRR…`](https://nearblocks.io/txns/HqcboLRRPkvM5czQzZPZYR8pVxGK3ZT1yK4N9C4MBUnQ) |
| 40 | 2026-11-08 10:39:21 | relayed `buy_listing` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`E5RtQwdA…`](https://nearblocks.io/txns/E5RtQwdAC1wGcGxGBGvEZiyfVv6pnuiCjDWEN6wHM9g6) |
| 41 | 2026-11-08 10:39:28 | relayed `buy_listing` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`6QuTjsxe…`](https://nearblocks.io/txns/6QuTjsxeeGV2SWX7QA1dVWLTEjcHr58VDwtTThFkJRQ1) |
| 42 | 2026-11-08 10:39:44 | relayed `buy_listing` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | **failed in contract** | [`DPeoAQfq…`](https://nearblocks.io/txns/DPeoAQfqikZvFqUvTYe82NQBUf8MYifMh6UEwLahyfZq) |
| 43 | 2026-11-08 12:38:17 | relayed `market_sell` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`GDATLg4Q…`](https://nearblocks.io/txns/GDATLg4Qr2cqQZ9S5uaRwZJTup4Y54P7uPyzJzFGaqXE) |
| 44 | 2026-11-08 14:37:23 | relayed `register_hero` for `mohsenmanm.wgpnear.near` | `relayer.wgpnear.near` (team) | `mohsenmanm.wgpnear.near` |  | ok | [`4rW2i7Mn…`](https://nearblocks.io/txns/4rW2i7Mnk3AN6CGtziRFRAwimzjq55wqkGiANgkohLnG) |
| 45 | 2026-11-08 18:05:19 | relayed `craft_suit` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`CwG99bb9…`](https://nearblocks.io/txns/CwG99bb9fA55F59rt1sj8rjGF92MPmq6BM5k7Gv9kNsx) |
| 46 | 2026-11-09 09:27:21 | relayed `register_hero` for `dominic_jovinic.wgpnear.near` | `relayer.wgpnear.near` (team) | `dominic_jovinic.wgpnear.near` |  | ok | [`3Hq4wWZs…`](https://nearblocks.io/txns/3Hq4wWZsVZ3JfzwDkPgDtxuP7vcvdsQaxwb2FiR2v33B) |
| 47 | 2026-11-09 09:59:44 | relayed `list_item` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`GhK2jtPK…`](https://nearblocks.io/txns/GhK2jtPKtNpHgjcn93eYRiFjF72mcMcFzbfHqYbnM9tx) |
| 48 | 2026-11-09 10:16:09 | relayed `craft_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`3ttQYUBr…`](https://nearblocks.io/txns/3ttQYUBrA8CbKu1s7VuvNA8QAxMMfHsTJGHrKi4AZqjc) |
| 49 | 2026-11-09 14:26:47 | relayed `register_hero` for `jamesutibeabassi.wgpnear.near` | `relayer.wgpnear.near` (team) | `jamesutibeabassi.wgpnear.near` |  | ok | [`Ag3kHD7x…`](https://nearblocks.io/txns/Ag3kHD7xyx8WZJkUCT7XzrFeSv4KWaKZZgGrbdn8hmhH) |
| 50 | 2026-11-10 06:25:33 | relayed `equip_suit` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`AhF5uosx…`](https://nearblocks.io/txns/AhF5uosxzTMnA7aJwooW7wxhoTqTNN8ipNteT2vUhXo9) |
| 51 | 2026-11-10 08:42:57 | relayed `equip_suit` for `nasibabalili7.wgpnear.near` | `relayer.wgpnear.near` (team) | `nasibabalili7.wgpnear.near` |  | ok | [`C2WwQsHy…`](https://nearblocks.io/txns/C2WwQsHyHNBZLrkN1JaVDGZuuf9aYaBJGqvyMSLvRvRp) |
| 52 | 2026-11-10 08:43:05 | relayed `craft_suit` for `nasibabalili7.wgpnear.near` | `relayer.wgpnear.near` (team) | `nasibabalili7.wgpnear.near` |  | ok | [`AfRNvujJ…`](https://nearblocks.io/txns/AfRNvujJ43dmk9Rj9LzzCZUxWqU4UnkvozaqWqtN2eq2) |
| 53 | 2026-11-10 17:35:03 | relayed `register_hero` for `cybwithflourish.near` | `relayer.wgpnear.near` (team) | `cybwithflourish.near` |  | ok | [`7dnP8eU7…`](https://nearblocks.io/txns/7dnP8eU7W8b9LdQeZztnttzai5uUc7gHAea4hEeoXnnq) |
| 54 | 2026-11-10 17:50:34 | relayed `buy_listing` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`Heu9ZTQv…`](https://nearblocks.io/txns/Heu9ZTQvWmriDngtPQ37defMDZMJSecgBNpdAuLnMdu9) |
| 55 | 2026-11-12 14:59:28 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`4tBL1YK2…`](https://nearblocks.io/txns/4tBL1YK27sMPZEK6z33HimtvD7KPgKFFosFDYs8JJUVc) |
| 56 | 2026-11-12 15:00:21 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`7V9mmXbU…`](https://nearblocks.io/txns/7V9mmXbUn4yQfUtovDjci1jmbtjR5su9WCCxdqaa7iVx) |
| 57 | 2026-11-12 15:00:29 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`DX1FNcZw…`](https://nearblocks.io/txns/DX1FNcZwjb2H8JPRhqtebdEYnBhCXjdDoPbc9hbxUe4K) |
| 58 | 2026-11-12 15:00:36 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`C5nPx4Xp…`](https://nearblocks.io/txns/C5nPx4XpFAgge5iTL2Pg14RxDj3ZvaudRJYCPv5mAwdv) |
| 59 | 2026-11-12 15:00:47 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`8Tx7pmyQ…`](https://nearblocks.io/txns/8Tx7pmyQR7jXmdrx3p1egxdDBQ8vJBmYDxeQQQK6M7ty) |
| 60 | 2026-11-12 15:00:53 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`8WpJnj7j…`](https://nearblocks.io/txns/8WpJnj7j7poENPLZJUoS3bjVtDwdi7HHKGSz7Zys7HL3) |
| 61 | 2026-11-12 15:01:01 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`EFTMLUca…`](https://nearblocks.io/txns/EFTMLUcaeKzxLYwLW6EhVG76cAHBoxdVYa2Lf4DPK2Yi) |
| 62 | 2026-11-12 15:01:06 | relayed `market_buy` for `azalleaxyz.wgpnear.near` | `relayer.wgpnear.near` (team) | `azalleaxyz.wgpnear.near` |  | ok | [`GJXrKe2o…`](https://nearblocks.io/txns/GJXrKe2oNjbTvxG2HyMt4DeTBXNPxGVRBbXsUrzv2TPJ) |
| 63 | 2026-11-12 15:32:42 | relayed `list_item` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`6aLadFrH…`](https://nearblocks.io/txns/6aLadFrHXtwygHGqxKNEwzmGS1JKnAhcvxUGcDDUTNon) |
| 64 | 2026-11-12 15:33:01 | relayed `list_item` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`6qhAmeDs…`](https://nearblocks.io/txns/6qhAmeDsgcci2qUY4g9tMF78JYnsxCo88tLifhdcHJMC) |
| 65 | 2026-11-12 15:33:41 | relayed `cancel_listing` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`J8rLL9GW…`](https://nearblocks.io/txns/J8rLL9GWab9AeB1DTNy8fC7GCa9NbpyXXpKWKeXAKF8t) |
| 66 | 2026-11-12 15:33:50 | relayed `list_item` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`6hkmVeAL…`](https://nearblocks.io/txns/6hkmVeALiC1iBRidQj8db9V5Q2tP2iBMPpGrTMumMZJB) |
| 67 | 2026-11-12 16:53:10 | relayed `market_sell` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`41dHyQwo…`](https://nearblocks.io/txns/41dHyQwomopU57rLYFMssLNwkwqz1T4bpPrdMY1TtoZ7) |
| 68 | 2026-11-12 16:53:34 | relayed `market_sell` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`FA7Asacc…`](https://nearblocks.io/txns/FA7AsaccSbfUDtqvCrdcEvKT3XBctFDjf54tjkxnZsQZ) |
| 69 | 2026-11-12 18:42:32 | relayed `market_sell` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`5k6eyTUA…`](https://nearblocks.io/txns/5k6eyTUADgzJiPK19QSKCpkbkYXFXNPdHzSr1wHvYz8E) |
| 70 | 2026-11-12 18:42:49 | relayed `market_sell` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`DzcRdRKx…`](https://nearblocks.io/txns/DzcRdRKx1zfbnwn7HF8S55f9Hm19CNRn1FeQrTyVQA4p) |
| 71 | 2026-11-12 19:06:02 | relayed `register_hero` for `rezau641.wgpnear.near` | `relayer.wgpnear.near` (team) | `rezau641.wgpnear.near` |  | ok | [`E7wemry8…`](https://nearblocks.io/txns/E7wemry8AhLZyVgDaMrJHYJ7tBpWx5BBeSfs3gqmazJU) |
| 72 | 2026-11-13 07:00:50 | transfer out to `game.wgpnear.near` (contract) | `relayer.wgpnear.near` (team) | `game.wgpnear.near` (contract) | 1 | ok | [`FH2tpfkz…`](https://nearblocks.io/txns/FH2tpfkzDkY8MtEX6fWCmMc7E7RRndGA8nibM1ZYEjuB) |
| 73 | 2026-11-14 20:21:23 | transfer in from `game.wgpnear.near` (contract) | `game.wgpnear.near` (contract) | `relayer.wgpnear.near` (team) | 0.5 | ok | [`GU8GVkK3…`](https://nearblocks.io/txns/GU8GVkK3a2mDkypzEz1cAVnHihVQLKQBUJKQ9oeyYs2d) |
| 74 | 2026-11-15 03:30:39 | relayed `craft_suit` for `rezau641.wgpnear.near` | `relayer.wgpnear.near` (team) | `rezau641.wgpnear.near` |  | ok | [`FteSZSEP…`](https://nearblocks.io/txns/FteSZSEPaGfy8NM4M7h3khKcib9rF7ApqkzsyWAPWqFP) |
| 75 | 2026-11-15 11:40:59 | relayed `market_sell` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`FMs6FpRF…`](https://nearblocks.io/txns/FMs6FpRFwYaqX6PuZFFxkUq1t8mrSTMCaVbEZNBqhxF7) |
| 76 | 2026-11-15 11:43:55 | relayed `market_sell` for `hossinshabani1389.wgpnear.near` | `relayer.wgpnear.near` (team) | `hossinshabani1389.wgpnear.near` |  | ok | [`GpTvi7hd…`](https://nearblocks.io/txns/GpTvi7hdmpWqvqAikqB4J93UkVxQmwnefvxiGST4R3CQ) |
| 77 | 2026-11-15 12:40:02 | relayed `market_buy` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`J5ybxqLa…`](https://nearblocks.io/txns/J5ybxqLaHtWXERaMDYDR7CMLnZad3aDEe1GUL6kUEaaB) |
| 78 | 2026-11-15 12:43:10 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`F33R4mHj…`](https://nearblocks.io/txns/F33R4mHjUgaxrsGsNpnbaw6AHxM8xVyk8hSCfkUS3LHw) |
| 79 | 2026-11-15 12:43:36 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`FHngULVU…`](https://nearblocks.io/txns/FHngULVUb2xyNabNJojvAMQjFUFkkTZmxfxzXotXdgCa) |
| 80 | 2026-11-15 13:39:05 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`E2DgnkgA…`](https://nearblocks.io/txns/E2DgnkgAT8hvSZSHTHUep8fVRSoQZN67WRN5adevPCxH) |
| 81 | 2026-11-15 13:39:28 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`B1eoz5Ep…`](https://nearblocks.io/txns/B1eoz5Eph5mbJQUfkY53j5oJ6gdJirE1EDnn5e7E1KmR) |
| 82 | 2026-11-15 14:57:16 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`39VmKQAS…`](https://nearblocks.io/txns/39VmKQASfdeuGdvyrFk6ktxowcKxRYNs2CLuX7DwCyap) |
| 83 | 2026-11-15 14:57:23 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`2LVsdSeM…`](https://nearblocks.io/txns/2LVsdSeMmBjr3Aue4uYYFUQw1ZSxJeZRhrENwUiWLFEQ) |
| 84 | 2026-11-15 14:58:47 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`56vwXBYV…`](https://nearblocks.io/txns/56vwXBYVHB4dud4JeXSzRVZN4sX442Y2SAD4E9yrfsDH) |
| 85 | 2026-11-15 14:59:06 | relayed `market_sell` for `9a_z53.wgpnear.near` | `relayer.wgpnear.near` (team) | `9a_z53.wgpnear.near` |  | ok | [`6cLKUTwb…`](https://nearblocks.io/txns/6cLKUTwb28WbH2dJcrQQ5m3359Ri9kBuzkghwroyqBxq) |
| 86 | 2026-11-15 16:45:30 | relayed `market_buy` for `cybwithflourish.near` | `relayer.wgpnear.near` (team) | `cybwithflourish.near` |  | ok | [`6iDy6SPJ…`](https://nearblocks.io/txns/6iDy6SPJaaZbbY47vtkDHuwJnKVPMEuETC5XEPWpVfDv) |
| 87 | 2026-11-15 16:46:06 | relayed `market_buy` for `cybwithflourish.near` | `relayer.wgpnear.near` (team) | `cybwithflourish.near` |  | ok | [`76MMVwv6…`](https://nearblocks.io/txns/76MMVwv6w62qkZ9pYbFyhDcb4a6UyhZ74NXNaW74Wssc) |
| 88 | 2026-11-15 16:46:25 | relayed `market_buy` for `cybwithflourish.near` | `relayer.wgpnear.near` (team) | `cybwithflourish.near` |  | ok | [`52Bwnm4H…`](https://nearblocks.io/txns/52Bwnm4H6MoPfbDGD62RNPQkozs9NpyNGZRnHSLLkxfc) |

## `operator.wgpnear.near`

The operator (team): it mints verified nights' rewards (`mint_rewards`) and records seasons (`record_season`). Every transaction it signed or received, oldest first: 238, 0 failed.

| # | UTC time | What | Signer | Receiver | NEAR | Result | Transaction |
|--:|---|---|---|---|---|---|---|
| 1 | 2026-11-03 15:50:55 | creates `operator.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `operator.wgpnear.near` (team) | 1 | ok | [`FVjmHDbD…`](https://nearblocks.io/txns/FVjmHDbDra1YqaNWAQ1z6CsjcJ61Cue6AX21aYujAj6w) |
| 2 | 2026-11-03 18:28:34 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5ohT4xpU…`](https://nearblocks.io/txns/5ohT4xpUzrVFW15d9Hk8Qy9XTZJTE5zKXCeSxJbXrMxZ) |
| 3 | 2026-11-03 18:31:56 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Bi8HjZda…`](https://nearblocks.io/txns/Bi8HjZdajH5pH4k8a9TZd37UA2DFgft9hxog2xxtVfYM) |
| 4 | 2026-11-03 19:05:44 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HfefuFXc…`](https://nearblocks.io/txns/HfefuFXcJsvGs3Nrj5x3N7SgBEdyW9kt4ZP9dpkjQNUh) |
| 5 | 2026-11-04 08:10:02 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5WNTruWV…`](https://nearblocks.io/txns/5WNTruWVsG2SBxQgznzcEc1dMiFJ7pvxxEc5mcmdeLtr) |
| 6 | 2026-11-06 07:57:06 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`A7KxAF8N…`](https://nearblocks.io/txns/A7KxAF8NP9EkSB9oa3z8ywzdHaXCfUiSBGEFtw1c1Gzv) |
| 7 | 2026-11-06 08:06:10 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3ytoyjBL…`](https://nearblocks.io/txns/3ytoyjBL6zx9UVGMgFoPDMbAqABroiMKiXKyVWsEXcrD) |
| 8 | 2026-11-06 08:09:26 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`13kqBHoP…`](https://nearblocks.io/txns/13kqBHoPpe7obCj5kfWRdCEowgaQie5q8fLXKVyNQoqH) |
| 9 | 2026-11-06 08:12:45 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4qn2Ja8D…`](https://nearblocks.io/txns/4qn2Ja8Dx5UmDPTg8Hs3c7PstaT7m4CxRaUkEqgJX2mZ) |
| 10 | 2026-11-06 08:17:14 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`78f743vN…`](https://nearblocks.io/txns/78f743vNy1MADtwKQnf4TueEGwzpRAKwPcmGrBsfwT8k) |
| 11 | 2026-11-06 08:20:46 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Cv5hfZzk…`](https://nearblocks.io/txns/Cv5hfZzkJoTFGH7aepiKaCSiZQQ2TunG7KXbhAvoAvDb) |
| 12 | 2026-11-06 08:23:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`CrHbGvUf…`](https://nearblocks.io/txns/CrHbGvUfbKfdWFivM3fcSuDoZjLPRRmmTsLRcpuDeyRC) |
| 13 | 2026-11-06 08:33:02 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`J2dJRmTu…`](https://nearblocks.io/txns/J2dJRmTuWmqcZEs8W4rz6Y5WL2k3d5ULqwK5UZDVUeRB) |
| 14 | 2026-11-06 08:33:44 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BwdTRNan…`](https://nearblocks.io/txns/BwdTRNan9hokczEWgsAKfBZ4owtojEUv4gZnF3skm3hj) |
| 15 | 2026-11-06 08:38:22 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4fHSak8H…`](https://nearblocks.io/txns/4fHSak8HTaA31R4Xu3KPSyYeU2XeV4W16LGk491vn3bK) |
| 16 | 2026-11-06 08:41:18 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`ZPHZVmZw…`](https://nearblocks.io/txns/ZPHZVmZwigkhK81pbDfAEs4UcmrwRDrtDTwziSyat8B) |
| 17 | 2026-11-06 08:43:30 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`CDDgZFtM…`](https://nearblocks.io/txns/CDDgZFtMvCd13Qok8wsd7vrXgeiG14pGegtPaJspVEeH) |
| 18 | 2026-11-06 08:46:19 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GA3djGqz…`](https://nearblocks.io/txns/GA3djGqzNnRDvrMcWtUQXXd4a7zcUYvZmmb43omSJgc8) |
| 19 | 2026-11-06 08:49:21 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GC1r7X7t…`](https://nearblocks.io/txns/GC1r7X7tYUwi7CwjKvZxszEn6S4z7nt3FLxuRmQPP9xY) |
| 20 | 2026-11-06 08:51:41 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`rpWTVA73…`](https://nearblocks.io/txns/rpWTVA73xYynymofDDXAs2yDyqvwk6yjUXZDDt8SMLM) |
| 21 | 2026-11-06 08:54:12 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BPM56JUj…`](https://nearblocks.io/txns/BPM56JUjHz3jwCHLzDftm5MBXBwGxoRseMDmXr6fLVXA) |
| 22 | 2026-11-06 08:57:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8SNw1jU4…`](https://nearblocks.io/txns/8SNw1jU4QwXH2ci3kjJkVpFet31p1WgTquo1YES2mvBn) |
| 23 | 2026-11-06 09:01:08 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8yeBapaq…`](https://nearblocks.io/txns/8yeBapaqV2hW8hkxuouZcsyT1divTY6FhhLspyUn7XaL) |
| 24 | 2026-11-06 09:09:23 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9U6RTpP5…`](https://nearblocks.io/txns/9U6RTpP5gSxRXcHGTJBiXKcpLXjoNpUWLASUSMZxHCtZ) |
| 25 | 2026-11-06 09:12:32 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5hWjPgVX…`](https://nearblocks.io/txns/5hWjPgVXDcW1gFXf2qqjTBR8ejASa4Vj7BugBeKu5FxR) |
| 26 | 2026-11-06 09:27:51 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`pzaTDvWh…`](https://nearblocks.io/txns/pzaTDvWhjQN6FauU4by116JceYxtE55NAJmh9h6a5qv) |
| 27 | 2026-11-06 09:31:43 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6PqUiBeb…`](https://nearblocks.io/txns/6PqUiBebXqe6nPVhRBXZfz9VQStwpsFHaoY8PsH4j7M2) |
| 28 | 2026-11-06 10:52:21 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8QNeUpSt…`](https://nearblocks.io/txns/8QNeUpStueFRrvVeQGinYPx8WcGS6x84Y6Ky2hVFPwZd) |
| 29 | 2026-11-06 11:06:37 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Bxbn3vEq…`](https://nearblocks.io/txns/Bxbn3vEq9HUfajinohXNWghdeTmwq14NEGXprcdNbzMj) |
| 30 | 2026-11-06 11:13:05 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`J8wEb1By…`](https://nearblocks.io/txns/J8wEb1Byy9NwUnnk7N2WnpBRsk357gTmKCddgyTheB1T) |
| 31 | 2026-11-06 11:16:51 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7P1ujBdy…`](https://nearblocks.io/txns/7P1ujBdyZpaJrg6jvGbS7G547Wv8yVM31kSsFqHuSMUU) |
| 32 | 2026-11-06 11:23:24 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4Yvcq6zA…`](https://nearblocks.io/txns/4Yvcq6zA8uQvR2NohaT9UsM1ox846cvm41CjhtGtRkJy) |
| 33 | 2026-11-06 11:28:32 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GpSv5FiW…`](https://nearblocks.io/txns/GpSv5FiWt9vhsqqA63bxTUP3Kno63bW4U8yzHk1xcf7p) |
| 34 | 2026-11-06 12:29:40 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5HeSYm2F…`](https://nearblocks.io/txns/5HeSYm2FMaYji23nvCurBJgouSDwJBiCBVb5bsqWZhh6) |
| 35 | 2026-11-06 17:01:56 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`ASeSVsKa…`](https://nearblocks.io/txns/ASeSVsKaPQdT5SRNtGEg2eAUHAYNq99f4EMr9N9STzhK) |
| 36 | 2026-11-06 17:05:27 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8dQSkduB…`](https://nearblocks.io/txns/8dQSkduBA6K6B5JB7o5TgQ3CkZbn1NEs6Udgcqy61R8D) |
| 37 | 2026-11-06 17:12:06 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`81rKZq7Y…`](https://nearblocks.io/txns/81rKZq7YfutLWdQn3PkdVzGghRSJt4Eu1DdqxNVauABS) |
| 38 | 2026-11-06 18:02:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4T3wdiGt…`](https://nearblocks.io/txns/4T3wdiGtr5VtqSC2t3KN4akzvrKK96hcUcGjvnbCgxDt) |
| 39 | 2026-11-07 02:07:20 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5Yi675Hn…`](https://nearblocks.io/txns/5Yi675Hn1gDoLfBUJAc8df2cnzpXAAMnFtdNqSAntjW) |
| 40 | 2026-11-07 02:09:37 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8QdUX3h2…`](https://nearblocks.io/txns/8QdUX3h2FGwTWpSMc5s5hw94DVSTmyP6Kut2ZGZhkrFH) |
| 41 | 2026-11-07 02:33:08 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7hbGnKHi…`](https://nearblocks.io/txns/7hbGnKHic9xBjGZ1XdBAi4vKCmp47d5nqgEQjRQwtz4T) |
| 42 | 2026-11-07 02:46:05 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`F9QBGKJi…`](https://nearblocks.io/txns/F9QBGKJiG4oUWJwQKFjw9UCDVPVhKPHkoxv4MEm2DfuW) |
| 43 | 2026-11-07 02:53:34 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2qRDZWbz…`](https://nearblocks.io/txns/2qRDZWbzhrRt7N5aHWFb7UDXQn5skzCAagWMmWe6TGB7) |
| 44 | 2026-11-07 02:57:36 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8CQPArYs…`](https://nearblocks.io/txns/8CQPArYsYrzMSjEr33iYnGCZdDconn6oRVYhD7AW2S5z) |
| 45 | 2026-11-07 04:09:33 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`29LNTz5E…`](https://nearblocks.io/txns/29LNTz5E72CSsSas4Rt9ZBchRvhtFuwPXfkD76LZMcyg) |
| 46 | 2026-11-07 04:12:45 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BVGujBxc…`](https://nearblocks.io/txns/BVGujBxcAfYHPfyR3S9Szwg6UGT3VnSKrTE7hUCYy5Yn) |
| 47 | 2026-11-07 04:15:53 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`51twy1as…`](https://nearblocks.io/txns/51twy1as1oen4vADzA7K37aKffnMSmPmcB9Fz19NqSZC) |
| 48 | 2026-11-07 04:19:22 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9KUBxVko…`](https://nearblocks.io/txns/9KUBxVkoHh2FnCVsVrokim84FJ9zwYCS9AwiQ9bNB1bp) |
| 49 | 2026-11-07 05:45:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EiG1SLpj…`](https://nearblocks.io/txns/EiG1SLpjdhbPPnF4jvTqHwX4oG8vkkTkZEpujgaGD26X) |
| 50 | 2026-11-07 05:57:27 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HYggio6R…`](https://nearblocks.io/txns/HYggio6RS2292dDPsSAsrH1MJMjcb4sP8aJSBYx9qpo4) |
| 51 | 2026-11-07 05:59:38 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`CeWwrNvG…`](https://nearblocks.io/txns/CeWwrNvGYQinuuYcyhh4LYz7zE5cdFmtPTyYYoeCU8qy) |
| 52 | 2026-11-07 06:02:05 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`CTpP5gjM…`](https://nearblocks.io/txns/CTpP5gjM5AU9pEiZPWrcC1Ti6nEBcLNVWvPiZbH6sxUq) |
| 53 | 2026-11-07 06:05:17 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`J2eDVUps…`](https://nearblocks.io/txns/J2eDVUpsb4kB9DMQt2v1RPLhfzkmx3w3zYrgrEZbfg2k) |
| 54 | 2026-11-07 06:07:20 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HAWbwAZV…`](https://nearblocks.io/txns/HAWbwAZV78nq1GRabbswsV8uQGfMzdan9Cc8abHsev3P) |
| 55 | 2026-11-07 06:09:55 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EdeoD9qT…`](https://nearblocks.io/txns/EdeoD9qT2mtjjUoE33ET5L3ranMxLgeJuF5qmDXQLFmp) |
| 56 | 2026-11-07 06:12:10 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GDJmjVBn…`](https://nearblocks.io/txns/GDJmjVBn5v12Ftth1fBuGse8gSycHjrk5tz2ARzTEMqJ) |
| 57 | 2026-11-07 06:14:14 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DUPXA6vj…`](https://nearblocks.io/txns/DUPXA6vj66e4cuB4XfJaymxu6hZdCQceZqH73v2iwp5q) |
| 58 | 2026-11-07 06:16:30 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6EppKeE2…`](https://nearblocks.io/txns/6EppKeE2gER2NoFARTPz4pMNpkKfQ73o5eEcjn2i7Zn6) |
| 59 | 2026-11-07 06:18:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8YmuAdvu…`](https://nearblocks.io/txns/8YmuAdvupVWvRTtymQct5b4hMoEMEtuiC8UsLJgaqVQf) |
| 60 | 2026-11-07 07:00:44 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5DJpoY2F…`](https://nearblocks.io/txns/5DJpoY2Fgz2Lz6YWiZyRHABeY6cTnPCNG54NMg5c8nep) |
| 61 | 2026-11-07 12:13:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EwSioPYK…`](https://nearblocks.io/txns/EwSioPYKkALLh21pjkeFG9s62dhGaj5ABJ1xdmPUWdi3) |
| 62 | 2026-11-07 12:15:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4N83vNBV…`](https://nearblocks.io/txns/4N83vNBVZ9vS81VztQB6jRWqQJi51ordGe3XygZaKZ8o) |
| 63 | 2026-11-07 12:16:21 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5Dg2uq7E…`](https://nearblocks.io/txns/5Dg2uq7Eih5dZx5zrCDYeqwGFED8rckYfp7GqQbYnkLc) |
| 64 | 2026-11-07 12:19:00 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`CEpkAmmi…`](https://nearblocks.io/txns/CEpkAmmicz6AkvzsVsukqLBrLUsgaarYPmDNMpw51jjJ) |
| 65 | 2026-11-07 12:30:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`69xjtyUa…`](https://nearblocks.io/txns/69xjtyUaqofjkwuQHscZyXsttNBjKjDRYWQYwTn3DGpv) |
| 66 | 2026-11-07 12:39:53 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`AUpqXyGT…`](https://nearblocks.io/txns/AUpqXyGTrmese13n9vYBuSRaUT8YTSGfcGDK5iTj1UM4) |
| 67 | 2026-11-07 12:43:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BWwnjzGS…`](https://nearblocks.io/txns/BWwnjzGSauViCigfMVVm3ctBoyYUb1prPGfWPQVEyPaK) |
| 68 | 2026-11-07 13:32:58 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HL9fbkHg…`](https://nearblocks.io/txns/HL9fbkHgE7k8kG4B1U3bDE4x4MNPcj9Q2P4B7fkb9SUS) |
| 69 | 2026-11-07 14:04:20 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`FMtd8UXY…`](https://nearblocks.io/txns/FMtd8UXYXJSvEwfa9dbzRVEwYCkFcywNasLDr8t6SmVA) |
| 70 | 2026-11-07 14:07:23 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3pn9oJsR…`](https://nearblocks.io/txns/3pn9oJsRvEBpt9scfgXnL4tuqokhLD9eAos9y9BFRap9) |
| 71 | 2026-11-07 14:08:46 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`H1DJeMKv…`](https://nearblocks.io/txns/H1DJeMKvw5tLAzo3HgEBJhkPrD1XQZpx4PpGcRZxd77N) |
| 72 | 2026-11-07 14:28:50 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`A4xv6zr3…`](https://nearblocks.io/txns/A4xv6zr3PfNkgSxX9mLv9PAB5GAuR8eCAfPfVejv2wHc) |
| 73 | 2026-11-07 15:49:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7VuNrBSR…`](https://nearblocks.io/txns/7VuNrBSRzmJo8nEjGWDKK1frmuvhRgvhgrL5xkxvttDL) |
| 74 | 2026-11-07 16:58:02 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EjWgwnDx…`](https://nearblocks.io/txns/EjWgwnDxvXk1CoM7GQAqd4CqZ8YzSG8W9EPuhSSs7535) |
| 75 | 2026-11-07 17:03:40 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Bc4Xujw3…`](https://nearblocks.io/txns/Bc4Xujw3RLKYaAiFkNv1CowmMi54oudDUYujZhtmtpGd) |
| 76 | 2026-11-07 19:09:04 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DKaRft11…`](https://nearblocks.io/txns/DKaRft11er7kXNq6RmGSfnuY3su2XhH8w2xCfnHKfdDh) |
| 77 | 2026-11-08 01:53:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7hWMW7wL…`](https://nearblocks.io/txns/7hWMW7wLd8VFLmRgjvcYRiM1HXBy25gpVbKDKJ8WtZo7) |
| 78 | 2026-11-08 01:55:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`D4cKTMff…`](https://nearblocks.io/txns/D4cKTMffKuVQkUV6v6UrubjWm21GQ9BQFGchtvfGgsdD) |
| 79 | 2026-11-08 03:23:53 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2RMJLtvW…`](https://nearblocks.io/txns/2RMJLtvW2qwwaKkSi3GR37rsUag4pQePv7EFRjfvtTvK) |
| 80 | 2026-11-08 03:26:33 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`J4dhL4rL…`](https://nearblocks.io/txns/J4dhL4rL4Arw86pvRCaFzLpaHFWdpKEdxe7rZhxBW5tf) |
| 81 | 2026-11-08 03:28:53 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`B7EhCqCA…`](https://nearblocks.io/txns/B7EhCqCAJpMD6NZVAyStuiNSH476VkFdmpeydgvq7hwE) |
| 82 | 2026-11-08 04:00:00 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4S611NA5…`](https://nearblocks.io/txns/4S611NA5G23j28bSS1zMSveTRmKW6UkKhaDMWZNLX9pE) |
| 83 | 2026-11-08 05:01:15 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HJLjPCYA…`](https://nearblocks.io/txns/HJLjPCYApL4J1k4NrNRqPLMi9BC8BJrvTtWb9UTmFjoZ) |
| 84 | 2026-11-08 05:04:08 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3Ahegh4n…`](https://nearblocks.io/txns/3Ahegh4ncGEc4J3EQobVpQeVeTBKZHRin68zMMfNboH6) |
| 85 | 2026-11-08 05:06:42 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9SXhZrED…`](https://nearblocks.io/txns/9SXhZrEDThAS5vUVEAut6XLWz9YGJU3jrgHyQV4A6jwo) |
| 86 | 2026-11-08 05:16:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Gi3DRr8F…`](https://nearblocks.io/txns/Gi3DRr8FAVdNezyf6fWSZMLTafKGKGU9Qfmhb9fBDvap) |
| 87 | 2026-11-08 05:18:40 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GAk4T4Y4…`](https://nearblocks.io/txns/GAk4T4Y4pi2AU8rZesNrGfHbepeEiJSNvHo6q7AoQKnf) |
| 88 | 2026-11-08 05:21:27 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2r4TNPgc…`](https://nearblocks.io/txns/2r4TNPgcu5SyUm4PwKCbM5b9Q7x6iHCC5usnEStnGhf4) |
| 89 | 2026-11-08 05:25:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3mgsM9LX…`](https://nearblocks.io/txns/3mgsM9LXQ5fkMES5fqUwzG7pS5wKMEciajdBte2dwekE) |
| 90 | 2026-11-08 05:27:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2wtpBd6L…`](https://nearblocks.io/txns/2wtpBd6L3vA8nbjHGwozDJ4Y6RbvfBkBjvAfexXoeeBw) |
| 91 | 2026-11-08 05:44:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`695hZM8P…`](https://nearblocks.io/txns/695hZM8PjuRdG13fxXc1tGAuFCyxyPTanJmAtAcUmZ6Z) |
| 92 | 2026-11-08 05:46:45 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6LBB5A2W…`](https://nearblocks.io/txns/6LBB5A2WGQ1tzcJUhX1arxjJL4sAzyqa8QZtxdsXTGuX) |
| 93 | 2026-11-08 06:23:20 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7hUezgH7…`](https://nearblocks.io/txns/7hUezgH7g76QnEBSwinK7w4scE1XPfqd6e8DTJ86mUiw) |
| 94 | 2026-11-08 09:13:33 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9Svrd5VA…`](https://nearblocks.io/txns/9Svrd5VAtA1dThgVa1RDw55496nHXxBafwBs6kR6qkVj) |
| 95 | 2026-11-08 10:35:56 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8tvqCCRV…`](https://nearblocks.io/txns/8tvqCCRVMo7TA4hKMFgJzF3nGhnrVPGyCBtvkQCW9ofe) |
| 96 | 2026-11-08 10:38:19 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BaLABeSd…`](https://nearblocks.io/txns/BaLABeSdiTrV5bh59j1Gnpk8rkcp5txdgjbCxgtysSPy) |
| 97 | 2026-11-08 10:52:56 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6Gz7ioTt…`](https://nearblocks.io/txns/6Gz7ioTtgUZWygJRM6A5zjVuo74DraDqWZyaVFasYL4) |
| 98 | 2026-11-08 12:41:36 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7FKhyRw2…`](https://nearblocks.io/txns/7FKhyRw28E9hdjyMLm2YscvAiXqQnPHeVv2LBHsnYQ33) |
| 99 | 2026-11-08 14:40:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`AwWvR6Zs…`](https://nearblocks.io/txns/AwWvR6ZsWKaEb4acDr75somgqHeEcUDwsjs6rwPqV9ZT) |
| 100 | 2026-11-08 15:16:48 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EhaAdGah…`](https://nearblocks.io/txns/EhaAdGahipemevWw2kZ1MnZ58yoCZP8WoPQKyXF3E374) |
| 101 | 2026-11-08 15:20:30 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5tZdAyif…`](https://nearblocks.io/txns/5tZdAyifqBYWwkvvhCFAsuvHtJ5746B8AHVdxV7KrbJ5) |
| 102 | 2026-11-08 15:27:23 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`CWtDu6FB…`](https://nearblocks.io/txns/CWtDu6FBr2txLtoCLQrbrx23dJbq1TsCuDxFensZjtTw) |
| 103 | 2026-11-08 15:37:20 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Fz5zamt4…`](https://nearblocks.io/txns/Fz5zamt4VUut82D4qPy7Phh2U5ZwkMb3HtxzK3UL1sEz) |
| 104 | 2026-11-08 15:37:49 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8bxxRnmN…`](https://nearblocks.io/txns/8bxxRnmNp2HRYDBqLEPD69EA8b5aLJdvNCZcYSUxJY1i) |
| 105 | 2026-11-08 15:41:35 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HA76wce1…`](https://nearblocks.io/txns/HA76wce1kwAXZ71SE64j75LBJhiCtctuVbkXcu6r2aYk) |
| 106 | 2026-11-08 17:53:49 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8B5pTjDN…`](https://nearblocks.io/txns/8B5pTjDNbTpaBUvMqNHjN83hKAMjdjuNik8j1r71kCLU) |
| 107 | 2026-11-08 17:53:49 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BJFUURto…`](https://nearblocks.io/txns/BJFUURtoRbSkiBrtJC8hqcX9ox8dtebPyjpNLGcyzJqo) |
| 108 | 2026-11-09 01:37:43 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HVrCzc5E…`](https://nearblocks.io/txns/HVrCzc5EZgMq5deVxTcMCJgRC5HCpnT7BQ3UWTfWHqH8) |
| 109 | 2026-11-09 06:14:45 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4eDKbVLV…`](https://nearblocks.io/txns/4eDKbVLVR6wqCXSAFcP6WU4Cjo6zGSwxpANnDRwg47WR) |
| 110 | 2026-11-09 06:18:15 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Fd1yZF8Y…`](https://nearblocks.io/txns/Fd1yZF8Yj21ZyEHZk7VtJAcWC5pKTMSZkHY2mqtnc6V8) |
| 111 | 2026-11-09 06:22:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6wVTQdLP…`](https://nearblocks.io/txns/6wVTQdLPX16yKhWFCsrUsJgv58BprJVKmzXDwwndXBwV) |
| 112 | 2026-11-09 07:13:32 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`66hMFERT…`](https://nearblocks.io/txns/66hMFERTJyAt5j7zPJb5fnsrZhavDQPh6vuQxSvJWdrV) |
| 113 | 2026-11-09 07:20:15 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6DgK4zu8…`](https://nearblocks.io/txns/6DgK4zu8yvpjtj6iSuxQTmGsLmadZNDbX8bkYnLcdLpm) |
| 114 | 2026-11-09 07:23:01 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EaU9Vyqj…`](https://nearblocks.io/txns/EaU9VyqjDusfFimPdx5yFsfHDX8YALaJBPpDCkJrkLsC) |
| 115 | 2026-11-09 07:25:29 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9HH7Ck2U…`](https://nearblocks.io/txns/9HH7Ck2UTSvJ9oEDRrmthDq28xiDuCvDyRZuHPr6CPPt) |
| 116 | 2026-11-09 07:28:00 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6J835mx3…`](https://nearblocks.io/txns/6J835mx3nRUxxNKQpMJNv5HWR9Jkk5Y76SxPbV1iGLhZ) |
| 117 | 2026-11-09 07:31:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`39db5vaB…`](https://nearblocks.io/txns/39db5vaBA5qtZcgxjAwQzTNQvtKmaCwMCox2HSjcZSe1) |
| 118 | 2026-11-09 07:35:49 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3n8vkExL…`](https://nearblocks.io/txns/3n8vkExLW3nWNcpcmgknLg9TEc2izsUXPsrnAJh5eSAQ) |
| 119 | 2026-11-09 08:41:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EbfebH9k…`](https://nearblocks.io/txns/EbfebH9k9UDU1xSRymCVkEWUfoZdqiv4ki5pAfLBQBmn) |
| 120 | 2026-11-09 08:44:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Fbtwg1dV…`](https://nearblocks.io/txns/Fbtwg1dVGvF2HXmwZqNrXu9JYCnWJffDjc3nvrVDezaL) |
| 121 | 2026-11-09 08:51:53 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`F26kE7v1…`](https://nearblocks.io/txns/F26kE7v1FEPf6d9x8xtqxdAJgbXpCfuzDjWJ3Ut3LoRb) |
| 122 | 2026-11-09 08:54:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2ZaVhSC1…`](https://nearblocks.io/txns/2ZaVhSC1oDzMTnDeWcvMUbt3cEeg6n39bb4K7DLLxber) |
| 123 | 2026-11-09 09:34:56 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7rGBhEdc…`](https://nearblocks.io/txns/7rGBhEdcmmh8mPhNBVUudBNu33uxqCybdAvWhFUJyzRz) |
| 124 | 2026-11-09 09:37:12 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`C1gSmZbC…`](https://nearblocks.io/txns/C1gSmZbCsMLYLuvui2tKdXADJ7n5BDxaspTzMHHobBZe) |
| 125 | 2026-11-09 15:03:22 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2PPy28tK…`](https://nearblocks.io/txns/2PPy28tKLaj2CM1iojM8A15wBrXxwVu1AEDri2dY4Qcb) |
| 126 | 2026-11-09 15:09:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GNTmMREm…`](https://nearblocks.io/txns/GNTmMREmtxdfeKUrveym37yHBKfpWStDpzdmkhDf8QGU) |
| 127 | 2026-11-09 18:52:12 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9TNusmoV…`](https://nearblocks.io/txns/9TNusmoVg3VGfF7hz1XRkPfa5q8bW3AWJDjFhjJyPdzR) |
| 128 | 2026-11-10 03:46:32 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`85jcoRWH…`](https://nearblocks.io/txns/85jcoRWH518be7RG6d8kKSkqPTMtS9SQr9yukfsrw3A7) |
| 129 | 2026-11-10 03:48:12 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`D7wCuJCD…`](https://nearblocks.io/txns/D7wCuJCDFU6ZLiUDwRSCbgrn5fuUm5sZ9fJmBgSfwpMc) |
| 130 | 2026-11-10 03:56:53 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`QJzZHvVD…`](https://nearblocks.io/txns/QJzZHvVDkw3wKY9LCRpy4UZKHjJDJL6xCXgFPqTRgyt) |
| 131 | 2026-11-10 06:27:13 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`hop6HLEe…`](https://nearblocks.io/txns/hop6HLEeyH86mxcLpeE4RwFRw7ogVUDa8kqAQCGiejv) |
| 132 | 2026-11-10 06:28:54 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GPpKSEQL…`](https://nearblocks.io/txns/GPpKSEQLLcJScsjry2vTsfKQMqHAGkpmfzrLhjzVeVrc) |
| 133 | 2026-11-10 08:45:18 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Hg3gnegb…`](https://nearblocks.io/txns/Hg3gnegb57a8sX7EU16BMpfyoW6iLpP5KkNN69ftoxwK) |
| 134 | 2026-11-10 08:51:20 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5zyQD47i…`](https://nearblocks.io/txns/5zyQD47ifARTHgksEMZaxqPpMn7Szv7zsUpxdqLXh6N6) |
| 135 | 2026-11-10 09:29:25 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7EtnwgDg…`](https://nearblocks.io/txns/7EtnwgDgqwuHAveiHJ8mzNEcamisqb6P1PtdZVpTPSDB) |
| 136 | 2026-11-10 09:49:34 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Bt4XJQyi…`](https://nearblocks.io/txns/Bt4XJQyijm5xfnt4AiqMSxqHQa6L6FHRxscJGSvPYDeW) |
| 137 | 2026-11-10 10:06:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7Ahkpk8A…`](https://nearblocks.io/txns/7Ahkpk8ALEnuTxAADLS71oDEMMK26SGXw6RLnasiuGFu) |
| 138 | 2026-11-10 10:40:46 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`H8GU3wn3…`](https://nearblocks.io/txns/H8GU3wn3uqHJcZ82GeeqJS723HhSQyNcYskhRSX9gCd9) |
| 139 | 2026-11-10 13:03:24 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Fyfky6TE…`](https://nearblocks.io/txns/Fyfky6TE4chz1ZqzYEGgqGdqz6wd9RbtoKCG3JnuuLVe) |
| 140 | 2026-11-10 17:04:39 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2AevVAvm…`](https://nearblocks.io/txns/2AevVAvm1vwnqxWzTvEYpFccUtMKKtG8LNE1H2oPRsaj) |
| 141 | 2026-11-10 17:09:11 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DxKiu4cW…`](https://nearblocks.io/txns/DxKiu4cW9ViuNsrsMFz9K49C5f1mWRxyBHrrGUrmwU8y) |
| 142 | 2026-11-10 17:12:32 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3HQL8MuV…`](https://nearblocks.io/txns/3HQL8MuVgFfTqknASZwRZ5iL5Jj8Q1JGFETiGBsBvECC) |
| 143 | 2026-11-10 17:34:11 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5jEKxMMB…`](https://nearblocks.io/txns/5jEKxMMBAozmRBnwQVpWubkGc9d96DnCSKUD3CJQh78z) |
| 144 | 2026-11-10 17:34:25 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9aKKqKvZ…`](https://nearblocks.io/txns/9aKKqKvZNc1Uqas7DpwmTnkGWQR2qPGXV7HwGrSYgEjr) |
| 145 | 2026-11-10 17:36:34 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6GZ3G6rM…`](https://nearblocks.io/txns/6GZ3G6rM1H6CUA1NFzczVmCUo98aDr8fK8x3es7z5Zfw) |
| 146 | 2026-11-10 17:46:11 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`C2BGyYeE…`](https://nearblocks.io/txns/C2BGyYeEZ8ea1dH3wFYvhP96S4ek36FciJ3uACuP2xW5) |
| 147 | 2026-11-10 17:48:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`512ib5LG…`](https://nearblocks.io/txns/512ib5LGUQ9FrDsDgvqNp7uQ1c6H232ni5EQByVd41hY) |
| 148 | 2026-11-11 04:19:33 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2v9SoDqj…`](https://nearblocks.io/txns/2v9SoDqj5Ge8ftKUff5siAPSBkCBvXAbPFD14A8rkQHr) |
| 149 | 2026-11-11 04:23:40 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8pgczb4C…`](https://nearblocks.io/txns/8pgczb4CLvWWbcFC4Y9vwCmzNw49kdbw5Y5EocsfU6D7) |
| 150 | 2026-11-11 08:51:13 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`FMUGBjNp…`](https://nearblocks.io/txns/FMUGBjNpND6YpDpY6WQnx4fXdXgvrNaeBW4eT5jqe886) |
| 151 | 2026-11-11 08:55:00 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3v3aYYA2…`](https://nearblocks.io/txns/3v3aYYA2mQp3CoM6s7jf68yDGCpkseaq2WqUEaNKrejt) |
| 152 | 2026-11-11 12:16:33 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BLqhTbhp…`](https://nearblocks.io/txns/BLqhTbhpusLGGE46PjMZzMFSBw6JvU4A11Tq2kKnvGAs) |
| 153 | 2026-11-12 02:50:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`79oc6DKW…`](https://nearblocks.io/txns/79oc6DKWdnY4xcga37kqYoZ4jXPKAqjwUb1tFrmqvhB1) |
| 154 | 2026-11-12 03:41:17 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8UEpbpc3…`](https://nearblocks.io/txns/8UEpbpc3doff1BgDFcsXWc4rcfhfFHWPVzAWGAAaxmVG) |
| 155 | 2026-11-12 03:43:15 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`21DSqhEb…`](https://nearblocks.io/txns/21DSqhEbtws8qasXY5xNHrSpXt7HxdfCBEKQTLXALtkP) |
| 156 | 2026-11-12 03:46:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4u8oZaMY…`](https://nearblocks.io/txns/4u8oZaMYHCPan2yLSyUAVPtjxJ2DFUo8Z3DeWXQh4TKp) |
| 157 | 2026-11-12 03:49:55 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DSgLui5e…`](https://nearblocks.io/txns/DSgLui5eB8bqyY9nqjuiuzAHNzowoW6NaGPpWt5h7U2P) |
| 158 | 2026-11-12 10:10:54 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`CsnUWQDW…`](https://nearblocks.io/txns/CsnUWQDWSXGwNaapB9iFGH3idEqzQWGbWmrH7pbJegZh) |
| 159 | 2026-11-12 15:32:01 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6X5vqZSU…`](https://nearblocks.io/txns/6X5vqZSUamfR2nMWAiBzoeVVtZ1uUgHvT7zKVB9P1B3W) |
| 160 | 2026-11-12 15:36:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6fc2KRSz…`](https://nearblocks.io/txns/6fc2KRSzHFeDHZmdUgpmgdq7XNC976vRsvSXD4qmbRq1) |
| 161 | 2026-11-12 15:38:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4SefGvFC…`](https://nearblocks.io/txns/4SefGvFC6RiPTMjTAGe1WXEaCZ8RuQz3BUXehb7MBRq9) |
| 162 | 2026-11-12 17:51:19 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6M4kjpjG…`](https://nearblocks.io/txns/6M4kjpjG29dmG9JcU7vW6Sn5UFUHNgWbRAoiac4m9qGQ) |
| 163 | 2026-11-12 19:06:00 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DTi2853L…`](https://nearblocks.io/txns/DTi2853LuSENBmf8ssvvFWSrA7mKZsfuV9NisKNT8bh5) |
| 164 | 2026-11-12 19:10:47 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7oH3DHuq…`](https://nearblocks.io/txns/7oH3DHuqvANqiLEeRyXEG99xzjrXC6Qxsd9Wsi8L7yJZ) |
| 165 | 2026-11-12 19:13:52 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`38qtiSA1…`](https://nearblocks.io/txns/38qtiSA1y22smSH1ssYcaNrrS4YULninTdGN1XnXtG6p) |
| 166 | 2026-11-12 19:32:55 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3jYbvHMP…`](https://nearblocks.io/txns/3jYbvHMPBynGmDad5d5yUcgtKDPiXV8Q9QsgGEbc6RiH) |
| 167 | 2026-11-13 02:24:45 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`G6q7TjPy…`](https://nearblocks.io/txns/G6q7TjPybZFDYDd9TqL6tM58Qq12gMtYdnpJQBMdS6uB) |
| 168 | 2026-11-13 02:26:49 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9BvxGqQs…`](https://nearblocks.io/txns/9BvxGqQs83B5P46Q1kSeh4gRkDztkZQJ5rKTbW88iBTb) |
| 169 | 2026-11-13 07:01:05 | transfer out to `wgpnear.near` (team) | `operator.wgpnear.near` (team) | `wgpnear.near` (team) | 0.4 | ok | [`62fPSQ4h…`](https://nearblocks.io/txns/62fPSQ4hi4MEgzVpfKXgnkXQPQAaF6VPRpSWaMBZ29bN) |
| 170 | 2026-11-13 07:12:14 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Hjvobzmd…`](https://nearblocks.io/txns/HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7) |
| 171 | 2026-11-13 10:09:07 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`A2BgLh2i…`](https://nearblocks.io/txns/A2BgLh2izhG6enXXFsKtLoqUfqcZ25aifQmnL4gaPP96) |
| 172 | 2026-11-13 13:20:47 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`A2tvgXj9…`](https://nearblocks.io/txns/A2tvgXj9SrBaocKZTmmv4QUfoF68eESFssDU8S5X9DzP) |
| 173 | 2026-11-13 16:59:40 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DgobJvHt…`](https://nearblocks.io/txns/DgobJvHtERrGqeeJXUfJoMkvLBqKJdWUNtKQzy1SFBiz) |
| 174 | 2026-11-14 03:24:29 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9phRZg4z…`](https://nearblocks.io/txns/9phRZg4zd2va6LTDho3Bdnt8f3xyEGHn4d7t4DacdFto) |
| 175 | 2026-11-14 03:27:11 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`AGgUC57c…`](https://nearblocks.io/txns/AGgUC57cpaHTEN2145Se1CyNS4RGPBtXMBtpLxogfpr5) |
| 176 | 2026-11-14 10:01:25 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5HZsCYEd…`](https://nearblocks.io/txns/5HZsCYEdhcYetvy66sbEizfyajeXDjEvc68QeXQAfYJp) |
| 177 | 2026-11-14 10:06:34 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8st4zrhu…`](https://nearblocks.io/txns/8st4zrhupRJoifwMmkrTQ9ZEmZokw3cjzXegDrS5HHot) |
| 178 | 2026-11-14 13:55:44 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EEJTddfm…`](https://nearblocks.io/txns/EEJTddfmwJPaMAXFhsxh1KgyRMDuYUcHcgyGKhKyhicj) |
| 179 | 2026-11-14 16:07:55 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4gLQ5xBS…`](https://nearblocks.io/txns/4gLQ5xBSNdRtxQGPikHeKPVrA1Zh9YS9rxkS7EukG6ZY) |
| 180 | 2026-11-14 17:07:15 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HbzA6aAu…`](https://nearblocks.io/txns/HbzA6aAuorUfZUvmKuEuTyke3csFnZx3EtKnnnM45GGw) |
| 181 | 2026-11-14 17:42:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9atvd3pR…`](https://nearblocks.io/txns/9atvd3pRvmj7z3E7S1bWZt4fNga4yaDdDJ9g9EjfYadT) |
| 182 | 2026-11-14 17:44:29 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DMbmKMSQ…`](https://nearblocks.io/txns/DMbmKMSQtJAPJi8SperYJyYbtNofppyMsEEZVNRF6xEd) |
| 183 | 2026-11-14 19:20:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6s1zKJLr…`](https://nearblocks.io/txns/6s1zKJLrMFETHE4nK1q7WKSHHNxqjLRJBHR9nDiuL2Fy) |
| 184 | 2026-11-14 19:22:56 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BtVsGkkF…`](https://nearblocks.io/txns/BtVsGkkF2GmYaZVSrtMm5wFQvvn6jzr8j1BJnS72MGeK) |
| 185 | 2026-11-14 19:26:11 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2KUoJpsF…`](https://nearblocks.io/txns/2KUoJpsF8GR9qsysWeWXRytY3i2MRQAm8hvrReknFFG6) |
| 186 | 2026-11-14 19:26:45 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5bVWoiVi…`](https://nearblocks.io/txns/5bVWoiViYMfrKUjQm5DkEf9gRRjm7HEjTPGPs4C1tz3q) |
| 187 | 2026-11-14 19:34:43 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8TN8Sfac…`](https://nearblocks.io/txns/8TN8SfachqKaWBYJ2tX2vMrWUzdzRveZky2kQzayHokG) |
| 188 | 2026-11-14 19:43:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`4Hr64t1i…`](https://nearblocks.io/txns/4Hr64t1iS7civqKK12LKYaMv1i8gqvYMKBapKS5X739s) |
| 189 | 2026-11-14 19:45:08 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`1yKeccmk…`](https://nearblocks.io/txns/1yKeccmkfJgDUhYinDWvMkxEgFhLr4fAw6DVMB6wZhS) |
| 190 | 2026-11-14 19:52:44 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`32xU7xge…`](https://nearblocks.io/txns/32xU7xgeMqmt1Nwr8CHnt9TKbZZfAWMLirJmx8CWtW9f) |
| 191 | 2026-11-14 20:20:14 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GivCC93Z…`](https://nearblocks.io/txns/GivCC93ZNigeEsN24efmSf2wKsiHm7pBi4xCDne7LUmv) |
| 192 | 2026-11-14 20:24:12 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GYETxoKZ…`](https://nearblocks.io/txns/GYETxoKZ9HZN2z9DEXpxexcbFYQ9e4cKmENBqo3mteve) |
| 193 | 2026-11-14 20:29:08 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`AbCAqx7o…`](https://nearblocks.io/txns/AbCAqx7o4NAMWpxQ2UMm34BG58RuoJSCQQR6YRsMv1aQ) |
| 194 | 2026-11-14 20:35:18 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`J4WAuVWc…`](https://nearblocks.io/txns/J4WAuVWcdN8FSGSewbcnoU4bZZdB1cjXh1pxBVrP7hMJ) |
| 195 | 2026-11-14 20:37:23 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`2GUfvKvs…`](https://nearblocks.io/txns/2GUfvKvsHHN9wvCfFtT7omETw4hFVeCZRCS3C7dPdUoc) |
| 196 | 2026-11-14 20:39:09 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DT7V2Gjm…`](https://nearblocks.io/txns/DT7V2Gjmu3TLKkpBz3EiYckypfTgDTCGYWhsDfR8ZHEx) |
| 197 | 2026-11-14 20:41:48 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9Sds6isY…`](https://nearblocks.io/txns/9Sds6isYFxvMjMkv2fWyjMKRcrTqEkqHFX7sTCVxbbyP) |
| 198 | 2026-11-14 23:55:18 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`H7H1t9iS…`](https://nearblocks.io/txns/H7H1t9iS9McWQGDGSFXfsR1wwrQmEYj9Ndjc7cWJpmhx) |
| 199 | 2026-11-14 23:58:09 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9CYXBMyt…`](https://nearblocks.io/txns/9CYXBMytKPe88NMPKEJsnWvDjgq1DLUrcU6N6NNpU4wM) |
| 200 | 2026-11-15 00:00:48 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7M4KzKm2…`](https://nearblocks.io/txns/7M4KzKm2fLLVjq2qBmmTvHdc15KUyDTGDcG36WqAkgkB) |
| 201 | 2026-11-15 00:30:57 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`51pSAhou…`](https://nearblocks.io/txns/51pSAhouEMKz7erAxyRNisz14rDVpUH683hi2BMKo4oe) |
| 202 | 2026-11-15 00:41:29 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`wuus8WpR…`](https://nearblocks.io/txns/wuus8WpRkJHWFQay2FSyqBtRHAaX7MWH81oAQN94YV4) |
| 203 | 2026-11-15 01:26:36 | `record_season` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`AxLWpz5m…`](https://nearblocks.io/txns/AxLWpz5m6mAkpem3WoXyLuUqZ29K3Pudx4Q5To1YD5ZX) |
| 204 | 2026-11-15 01:26:37 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GUQw6oi5…`](https://nearblocks.io/txns/GUQw6oi5gQuvibCXptqQnCPr1q2htzoQCJvpi3mciEpJ) |
| 205 | 2026-11-15 03:29:12 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`FMDvvsDp…`](https://nearblocks.io/txns/FMDvvsDpbXrfdBWWwsQVri4bZP68rjj9tWA59oGr1oks) |
| 206 | 2026-11-15 03:32:26 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`ufwL5fsn…`](https://nearblocks.io/txns/ufwL5fsnf1MbFSrteroCkmBw8BP8SzJbumTdP1KPLiS) |
| 207 | 2026-11-15 04:54:26 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Yu77NVmb…`](https://nearblocks.io/txns/Yu77NVmbtZsZGJ66tYTZCjq3BbgEEJnmWesgBNDrGTR) |
| 208 | 2026-11-15 06:08:12 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5guSMHVa…`](https://nearblocks.io/txns/5guSMHVaA3PiiMphWicup6tN4LfoZbQdgDHzKMYkNy94) |
| 209 | 2026-11-15 06:11:44 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`C1BL7kgh…`](https://nearblocks.io/txns/C1BL7kghudGua5ujAnFyJfb4wdeLQDa1RV1k7gmtuHau) |
| 210 | 2026-11-15 06:15:05 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5ik9mniR…`](https://nearblocks.io/txns/5ik9mniRotHFe79jxjJirFi5YmDnx9FioYSCf3sHgSXy) |
| 211 | 2026-11-15 06:18:31 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`C3wXgQhk…`](https://nearblocks.io/txns/C3wXgQhkXFKmN1as7x6TvJ34Wypz6NzToBRV7ChTd3Sn) |
| 212 | 2026-11-15 06:22:51 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3doBhfNh…`](https://nearblocks.io/txns/3doBhfNhmdDV6ZJ3B8JBP3EZiVVLxJhg2NZdKEtRmsBY) |
| 213 | 2026-11-15 06:25:48 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`EujZGj5A…`](https://nearblocks.io/txns/EujZGj5ATLWpyZdRSoVBBRf1QF4V1FGXkXxHU8GYgwPz) |
| 214 | 2026-11-15 08:44:55 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`Gk8osacV…`](https://nearblocks.io/txns/Gk8osacVy8LJAvWndAu2NAAxq7dxmPsDfHtW52bLuPKo) |
| 215 | 2026-11-15 09:00:49 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GpGJhBsQ…`](https://nearblocks.io/txns/GpGJhBsQqwbUZmE3oAEiCXpm19jP9A5AVWgHyTYsm246) |
| 216 | 2026-11-15 09:06:57 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GbxZAiRW…`](https://nearblocks.io/txns/GbxZAiRWMdd6wGr6qgzJnxGnptbNayjtVe3QXZX5TYXn) |
| 217 | 2026-11-15 11:03:49 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HPd149nP…`](https://nearblocks.io/txns/HPd149nPQPRG6NqVMHZUMnJ9BzamCZGUr26Nt5iMrwMa) |
| 218 | 2026-11-15 11:06:19 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BYeU8rQ3…`](https://nearblocks.io/txns/BYeU8rQ3jE8mu3mCNkmipMHiQYxwn4RocueqdDZdJTLV) |
| 219 | 2026-11-15 11:38:59 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`8JwQWc1Q…`](https://nearblocks.io/txns/8JwQWc1QAZHKNZqyft9oiTf91kPzi9tPFbpmiJ4Hqhun) |
| 220 | 2026-11-15 11:43:36 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`9hgByNhh…`](https://nearblocks.io/txns/9hgByNhhEd5dTgE2NFJ8AUJCSodHPNhmWeowkXv7hBAP) |
| 221 | 2026-11-15 12:42:47 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`AChadWGz…`](https://nearblocks.io/txns/AChadWGzBwBbtUnZSaX27hGk4NmSaJACDWFncrgbTUKv) |
| 222 | 2026-11-15 12:47:29 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`J2KYsawn…`](https://nearblocks.io/txns/J2KYsawnnL2frmezXxFbAKCJQW5vkmZEpJBKzsU4Dncb) |
| 223 | 2026-11-15 13:10:46 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HrVTjn2W…`](https://nearblocks.io/txns/HrVTjn2Wi8vLKD9qU7RfTSN5iGZU4Vi8GBSUJr5bx9fA) |
| 224 | 2026-11-15 13:16:52 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`98hmCmno…`](https://nearblocks.io/txns/98hmCmnoGkfp4rbhaccn9mU9xfJELWP2zaVNTovkrw73) |
| 225 | 2026-11-15 13:20:54 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`HEoP4YoX…`](https://nearblocks.io/txns/HEoP4YoXKjSuDiYMNWaA2Nzt5yqBpqNErxV4wpwWssXn) |
| 226 | 2026-11-15 13:22:52 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`H82FpVGT…`](https://nearblocks.io/txns/H82FpVGT5czfs6NSaZYFXx7SUhPiZj24ANTqg8K2JPR) |
| 227 | 2026-11-15 13:24:28 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`6yG6oiSN…`](https://nearblocks.io/txns/6yG6oiSNTQFqunXMVAGeoJxCdu9hfagy1ikyBmFpo7Gz) |
| 228 | 2026-11-15 13:27:15 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`F9Zg9DMU…`](https://nearblocks.io/txns/F9Zg9DMUsvPLz8d1sehKaRyfKzpoVLjUC2L6YbYkC5Td) |
| 229 | 2026-11-15 13:31:56 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GQFg67kJ…`](https://nearblocks.io/txns/GQFg67kJfEV5HD8eJemjrgY9hg1zKMT1BeLFD5z7TugX) |
| 230 | 2026-11-15 13:34:58 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`14TtrXCC…`](https://nearblocks.io/txns/14TtrXCCtvwazNcAyTStZnxjk8sA2ynzboT32W9bXxcm) |
| 231 | 2026-11-15 13:41:05 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`BCe7gkC3…`](https://nearblocks.io/txns/BCe7gkC3t5ZLAD4WbDTUmopJwbFgCdbPNVyGZ9DPbEuV) |
| 232 | 2026-11-15 13:44:13 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`7L6whyzB…`](https://nearblocks.io/txns/7L6whyzBCM88herdChKrGRPRWW9HLW3LNrGQwBEvT2Rh) |
| 233 | 2026-11-15 13:46:54 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`5bWNvRNT…`](https://nearblocks.io/txns/5bWNvRNTdWJiXx6WdqFg4FQMHhWmuzauzHkTN8WSio2T) |
| 234 | 2026-11-15 13:49:42 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`GDfpPJZr…`](https://nearblocks.io/txns/GDfpPJZrNfeMC3oe5sCBdf3tVuSpWTfobBHN7Vfruqi3) |
| 235 | 2026-11-15 13:52:29 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`3EfMbRG6…`](https://nearblocks.io/txns/3EfMbRG6TT2LgUuMoDx976v72iehGGv6xXNRsaBZ671x) |
| 236 | 2026-11-15 13:57:03 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`DhfxogiH…`](https://nearblocks.io/txns/DhfxogiHHwUqbXy87oC9BRhJH7dv9e9yVc1Dx7Tn7i4V) |
| 237 | 2026-11-15 13:59:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`55tsGErV…`](https://nearblocks.io/txns/55tsGErV2vQyER1mfYp9MJYcmkhCXe4acRLL5jHcw3td) |
| 238 | 2026-11-15 16:30:16 | `mint_rewards` on `game.wgpnear.near` | `operator.wgpnear.near` (team) | `game.wgpnear.near` (contract) |  | ok | [`65cM4wmv…`](https://nearblocks.io/txns/65cM4wmvkmX4CnNN2myRA7zxJSTPFneu4dkQRaoMqR24) |

## `sandwich.wgpnear.near`

Sandwich Man, the NPC trader: his own key signs his market calls. He is never counted as a player. Every transaction it signed or received, oldest first: 4, 0 failed.

| # | UTC time | What | Signer | Receiver | NEAR | Result | Transaction |
|--:|---|---|---|---|---|---|---|
| 1 | 2026-11-13 07:03:12 | creates `sandwich.wgpnear.near` (create_account + transfer + add_key) | `wgpnear.near` (team) | `sandwich.wgpnear.near` (NPC) | 0.3 | ok | [`Hx32N4dy…`](https://nearblocks.io/txns/Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm) |
| 2 | 2026-11-13 07:15:07 | `market_buy` on `game.wgpnear.near` | `sandwich.wgpnear.near` (NPC) | `game.wgpnear.near` (contract) |  | ok | [`AcmNAmHr…`](https://nearblocks.io/txns/AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf) |
| 3 | 2026-11-15 13:39:16 | `market_buy` on `game.wgpnear.near` | `sandwich.wgpnear.near` (NPC) | `game.wgpnear.near` (contract) |  | ok | [`6cjd1ffr…`](https://nearblocks.io/txns/6cjd1ffrZUXqoafzBydwQAZmjdBAKfna9B3PNMFtZuAN) |
| 4 | 2026-11-15 13:39:45 | `market_buy` on `game.wgpnear.near` | `sandwich.wgpnear.near` (NPC) | `game.wgpnear.near` (contract) |  | ok | [`JBeyLRzB…`](https://nearblocks.io/txns/JBeyLRzBiimh6mZuugN7YQTYQQMjdCMfCL9EQJWe3kfj) |
