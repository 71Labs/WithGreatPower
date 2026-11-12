//! Sandwich Man, the NPC trader, against the real wasm (docs/npc-trader.md): an ordinary
//! account with no role in the contract does everything his rules ask for with the same
//! five market methods players use, inside the contract's caps, and the contract refuses
//! him exactly where it would refuse anyone. Build the contract first:
//! `cargo near build non-reproducible-wasm` in contracts/wgp, then `cargo test --test npc_trader`.

use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const WASM: &str = "../target/near/wgp.wasm";
const DIGEST: &str = "1111111111111111111111111111111111111111111111111111111111111111";
/// The one-off seed (apps/wgp/src/lib/market/npc-rules.ts `NPC_RULES.seedBits`).
const SEED_BITS: u64 = 300;

const ITEMS: [&str; 8] = [
    "fee-bomb",
    "goblin-glider",
    "crumbs",
    "sesame-seed",
    "chain-link",
    "spare-arm",
    "sybil-goo",
    "press-pass",
];

fn gas(o: &near_workspaces::result::ExecutionFinalResult) -> f64 {
    o.total_gas_burnt.as_gas() as f64 / 1e12
}

async fn balance(game: &Contract, who: &Account, token: &str) -> anyhow::Result<u128> {
    let v: Value = game
        .view("mt_balance_of")
        .args_json(json!({"account_id": who.id(), "token_id": token}))
        .await?
        .json()?;
    Ok(v.as_str().unwrap().parse()?)
}

async fn quote(game: &Contract, item: &str, amount: u32) -> anyhow::Result<Value> {
    Ok(game
        .view("market_quote")
        .args_json(json!({"item": item, "amount": amount}))
        .await?
        .json()?)
}

fn num(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn an_ordinary_account_trades_as_the_npc_does() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let game = worker.dev_deploy(&std::fs::read(WASM)?).await?;
    let root = worker.root_account()?;
    let mut accounts = Vec::new();
    for name in ["operator", "alice", "sandwich"] {
        accounts.push(
            root.create_subaccount(name)
                .initial_balance(NearToken::from_near(5))
                .transact()
                .await?
                .into_result()?,
        );
    }
    let [operator, alice, npc] = <[_; 3]>::try_from(accounts).unwrap();
    game.call("new")
        .args_json(json!({
            "owner_id": root.id(), "operators": [operator.id()], "items": ITEMS,
            "suits": [{"id": "classic", "starter": true, "min_level": 1, "recipe": []}],
            "starter_unlock_level": 2
        }))
        .transact()
        .await?
        .into_result()?;
    root.call(game.id(), "set_market_params")
        .args_json(json!({
            "params": {
                "open": true, "fee_bps": 200, "floor_bps": 5000, "ceiling_bps": 40000, "max_amount": 20,
                "max_open_listings": 3, "max_listings": 300, "daily_trades": 40, "daily_listings": 10,
                "daily_fills": 10, "daily_fill_bits": "3000", "craft_bits": "0"
            },
            "pools": [
                {"item": "crumbs", "virtual_bits": "480", "virtual_items": "40", "seed_bits": "480", "seed_stock": "40"}
            ]
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    // The owner-run seed: one `mint_rewards` entry of Bits to his account (nonce 1), and a
    // player with loot. He needs no hero, no registration and no storage deposit.
    let seed = operator
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": [
            {"account_id": npc.id(), "nonce": 1, "items": [{"item": "bits", "amount": SEED_BITS}], "digest": DIGEST},
            {"account_id": alice.id(), "nonce": 1, "items": [{"item": "bits", "amount": 100}, {"item": "crumbs", "amount": 12}], "digest": DIGEST}
        ]}))
        .transact()
        .await?;
    assert!(seed.is_success(), "{seed:?}");
    println!("GAS mint_rewards(seed) {:.2} Tgas", gas(&seed));
    assert_eq!(balance(&game, &npc, "item:bits").await?, SEED_BITS as u128);

    // Rule 2: a player lists cheap; Gwei would pay him 10% more, so he buys the listing.
    let listed: Value = alice
        .call(game.id(), "list_item")
        .args_json(json!({"item": "crumbs", "amount": 2, "price_bits": "13"}))
        .transact()
        .await?
        .json()?;
    let pays = num(&quote(&game, "crumbs", 2).await?["sell"]);
    assert!(pays * 10 >= 13 * 11, "Gwei pays {pays} for a lot listed at 13");
    let fill = npc
        .call(game.id(), "buy_listing")
        .args_json(json!({"listing_id": listed["id"]}))
        .transact()
        .await?;
    assert!(fill.is_success(), "{fill:?}");
    println!("GAS npc buy_listing {:.2} Tgas", gas(&fill));
    assert_eq!(balance(&game, &npc, "item:crumbs").await?, 2);
    assert_eq!(balance(&game, &npc, "item:bits").await?, SEED_BITS as u128 - 13);
    // The seller got her asking price less the 2% gas fee, as from any buyer.
    assert_eq!(balance(&game, &alice, "item:bits").await?, 100 + 13 - 1);

    // Rule 3: he sells them to Gwei with his margin (cost 13 → at least 15) as the limit.
    let sell = npc
        .call(game.id(), "market_sell")
        .args_json(json!({"item": "crumbs", "amount": 2, "min_bits": "15"}))
        .transact()
        .await?;
    assert!(sell.is_success(), "{sell:?}");
    println!("GAS npc market_sell {:.2} Tgas", gas(&sell));
    assert_eq!(
        balance(&game, &npc, "item:bits").await?,
        SEED_BITS as u128 - 13 + pays
    );
    // …and the contract enforces that limit: a floor above what Gwei pays fails.
    let greedy = npc
        .call(game.id(), "market_sell")
        .args_json(json!({"item": "crumbs", "amount": 1, "min_bits": "500"}))
        .transact()
        .await?;
    assert!(greedy.is_failure());

    // Rule 5: players dump crumbs, the price falls under 85% of its opening 12 Bits, he buys 2.
    alice
        .call(game.id(), "market_sell")
        .args_json(json!({"item": "crumbs", "amount": 10, "min_bits": "1"}))
        .transact()
        .await?
        .into_result()?;
    let q = quote(&game, "crumbs", 2).await?;
    assert!(num(&q["price_milli"]) * 100 < 12_000 * 85, "{q}");
    let cost = num(&q["buy"]);
    let before = balance(&game, &npc, "item:bits").await?;
    let buy = npc
        .call(game.id(), "market_buy")
        .args_json(json!({"item": "crumbs", "amount": 2, "max_bits": (cost + cost.div_ceil(50)).to_string()}))
        .transact()
        .await?;
    assert!(buy.is_success(), "{buy:?}");
    println!("GAS npc market_buy {:.2} Tgas", gas(&buy));
    assert_eq!(balance(&game, &npc, "item:crumbs").await?, 2);
    assert_eq!(balance(&game, &npc, "item:bits").await?, before - cost);

    // Rule 4: he lists them under Gwei's price, inside the contract's bounds; a player buys.
    let q = quote(&game, "crumbs", 2).await?;
    let ask = num(&q["buy"]) * 94 / 100;
    assert!(ask >= num(&q["floor"]) && ask <= num(&q["ceiling"]), "{q}");
    let list = npc
        .call(game.id(), "list_item")
        .args_json(json!({"item": "crumbs", "amount": 2, "price_bits": ask.to_string()}))
        .transact()
        .await?;
    assert!(list.is_success(), "{list:?}");
    println!("GAS npc list_item {:.2} Tgas", gas(&list));
    let mine: Value = list.json()?;
    assert_eq!(balance(&game, &npc, "item:crumbs").await?, 0);

    // The contract refuses him where it refuses anyone: his own listing, a price out of
    // bounds, and anything that isn't a market method.
    let own = npc
        .call(game.id(), "buy_listing")
        .args_json(json!({"listing_id": mine["id"]}))
        .transact()
        .await?;
    assert!(own.is_failure(), "he can't buy his own listing");
    let cheap = npc
        .call(game.id(), "list_item")
        .args_json(json!({"item": "crumbs", "amount": 1, "price_bits": "1"}))
        .transact()
        .await?;
    assert!(cheap.is_failure(), "no listing under the floor");
    let mint = npc
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": [
            {"account_id": npc.id(), "nonce": 2, "items": [{"item": "bits", "amount": 1000}], "digest": DIGEST}
        ]}))
        .transact()
        .await?;
    assert!(mint.is_failure(), "he is not an operator");

    let before = balance(&game, &npc, "item:bits").await?;
    alice
        .call(game.id(), "buy_listing")
        .args_json(json!({"listing_id": mine["id"]}))
        .transact()
        .await?
        .into_result()?;
    let fee = ask.div_ceil(50);
    assert_eq!(balance(&game, &npc, "item:bits").await?, before + ask - fee);
    assert_eq!(balance(&game, &alice, "item:crumbs").await?, 2);

    // Rule 1: a listing of his comes down with cancel_listing, and the items come back.
    alice
        .call(game.id(), "list_item")
        .args_json(json!({"item": "crumbs", "amount": 2, "price_bits": "10"}))
        .transact()
        .await?
        .into_result()?;
    // (He buys it first so he has something to list: his third fill of the day.)
    let third: Value = game.view("market_listings").args_json(json!({})).await?.json()?;
    npc.call(game.id(), "buy_listing")
        .args_json(json!({"listing_id": third[0]["id"]}))
        .transact()
        .await?
        .into_result()?;
    let q = quote(&game, "crumbs", 2).await?;
    let relist: Value = npc
        .call(game.id(), "list_item")
        .args_json(json!({"item": "crumbs", "amount": 2, "price_bits": q["ceiling"]}))
        .transact()
        .await?
        .json()?;
    let cancel = npc
        .call(game.id(), "cancel_listing")
        .args_json(json!({"listing_id": relist["id"]}))
        .transact()
        .await?;
    assert!(cancel.is_success(), "{cancel:?}");
    println!("GAS npc cancel_listing {:.2} Tgas", gas(&cancel));
    assert_eq!(balance(&game, &npc, "item:crumbs").await?, 2);

    // His day, as the contract counted it: far inside every cap (40 trades, 10 listings,
    // 10 fills, 3,000 Bits of fills), and his rules stop at 10 actions.
    let account: Value = game
        .view("market_account")
        .args_json(json!({"account_id": npc.id()}))
        .await?
        .json()?;
    println!("the npc on the market: {account}");
    assert_eq!(account["trades_left"], json!(40 - 2));
    assert_eq!(account["listings_left"], json!(10 - 2));
    assert_eq!(account["fills_left"], json!(10 - 2));
    assert_eq!(account["fill_bits_left"], json!((3000 - 13 - 10).to_string()));
    assert_eq!(account["open"], json!([]));
    Ok(())
}
