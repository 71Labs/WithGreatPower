//! Spike S5: deploy the real wasm to a local sandbox, mint, craft from a sub-account
//! through a function-call key, transfer with 1 yocto, and show a session key can't.

use near_workspaces::types::{AccessKey, NearToken, SecretKey};
use serde_json::json;

const WASM: &str = "../target/near/wgp.wasm";
const DIGEST: &str = "1111111111111111111111111111111111111111111111111111111111111111";

fn gas(o: &near_workspaces::result::ExecutionFinalResult) -> f64 {
    o.total_gas_burnt.as_gas() as f64 / 1e12
}

#[tokio::test]
async fn deploy_mint_craft_transfer() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = std::fs::read(WASM)?;
    let game = worker.dev_deploy(&wasm).await?;
    let root = worker.root_account()?;
    let operator = root
        .create_subaccount("operator")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;
    let alice = root
        .create_subaccount("alice")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;
    let bob = root
        .create_subaccount("bob")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;

    let init = game
        .call("new")
        .args_json(json!({
            "owner_id": root.id(),
            "operators": [operator.id()],
            "items": ["fee-bomb", "goblin-glider", "crumbs", "sesame-seed", "chain-link", "spare-arm", "sybil-goo", "press-pass"],
            "suits": [
                {"id": "classic", "starter": true, "min_level": 1, "recipe": []},
                {"id": "stealth", "starter": false, "min_level": 2, "recipe": [{"item": "sybil-goo", "amount": 3}]}
            ],
            "starter_unlock_level": 2
        }))
        .transact()
        .await?;
    assert!(init.is_success(), "{init:?}");
    println!("GAS init {:.2} Tgas", gas(&init));

    // A session key: function-call only, game contract only, 0.05 NEAR allowance.
    let session = SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    let add = alice
        .batch(alice.id())
        .add_key(
            session.public_key(),
            AccessKey::function_call_access(game.id(), &[], Some(NearToken::from_millinear(50))),
        )
        .transact()
        .await?;
    assert!(add.is_success(), "{add:?}");
    let alice_session =
        near_workspaces::Account::from_secret_key(alice.id().clone(), session, &worker);

    let reg = alice_session
        .call(game.id(), "register_hero")
        .args_json(json!({"name": "Peter", "suit": "classic"}))
        .transact()
        .await?;
    assert!(reg.is_success(), "{reg:?}");
    println!("GAS register_hero {:.2} Tgas", gas(&reg));

    let mint = operator
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": [{"account_id": alice.id(), "nonce": 1, "items": [{"item": "sybil-goo", "amount": 4}, {"item": "bits", "amount": 60}], "level": 2, "digest": DIGEST}]}))
        .transact()
        .await?;
    assert!(mint.is_success(), "{mint:?}");
    println!("GAS mint_rewards(1) {:.2} Tgas", gas(&mint));

    let craft = alice_session
        .call(game.id(), "craft_suit")
        .args_json(json!({"suit": "stealth"}))
        .transact()
        .await?;
    assert!(craft.is_success(), "{craft:?}");
    println!("GAS craft_suit {:.2} Tgas", gas(&craft));

    let equip = alice_session
        .call(game.id(), "equip_suit")
        .args_json(json!({"suit": "classic"}))
        .transact()
        .await?;
    assert!(equip.is_success(), "{equip:?}");
    println!("GAS equip_suit {:.2} Tgas", gas(&equip));

    // The session key can't attach the yocto a transfer needs.
    let stolen = alice_session
        .call(game.id(), "mt_transfer")
        .args_json(json!({"receiver_id": bob.id(), "token_id": "item:sybil-goo", "amount": "1"}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await;
    println!(
        "session-key transfer with 1 yocto: {:?}",
        stolen
            .as_ref()
            .map(|o| o.is_success())
            .map_err(|e| e.to_string())
    );
    assert!(stolen.map(|o| o.is_failure()).unwrap_or(true));
    let no_yocto = alice_session
        .call(game.id(), "mt_transfer")
        .args_json(json!({"receiver_id": bob.id(), "token_id": "item:sybil-goo", "amount": "1"}))
        .transact()
        .await?;
    assert!(no_yocto.is_failure());

    // The full-access key can.
    let send = alice
        .call(game.id(), "mt_transfer")
        .args_json(json!({"receiver_id": bob.id(), "token_id": "item:sybil-goo", "amount": "1"}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(send.is_success(), "{send:?}");
    println!("GAS mt_transfer {:.2} Tgas", gas(&send));

    let bob_goo: serde_json::Value = game
        .view("mt_balance_of")
        .args_json(json!({"account_id": bob.id(), "token_id": "item:sybil-goo"}))
        .await?
        .json()?;
    assert_eq!(bob_goo, json!("1"));
    let player: serde_json::Value = game
        .view("get_player")
        .args_json(json!({"account_id": alice.id()}))
        .await?
        .json()?;
    println!("alice: {player}");
    assert_eq!(player["hero"]["suit"], "classic");
    Ok(())
}

/// Sizes the operator: gas for a full 20-reward batch and a 10-player season.
#[tokio::test]
async fn operator_batch_gas() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let game = worker.dev_deploy(&std::fs::read(WASM)?).await?;
    let root = worker.root_account()?;
    let operator = root
        .create_subaccount("operator")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;
    game.call("new")
        .args_json(json!({
            "owner_id": root.id(), "operators": [operator.id()],
            "items": ["fee-bomb", "goblin-glider", "crumbs", "sesame-seed", "chain-link", "spare-arm", "sybil-goo", "press-pass"],
            "suits": [{"id": "classic", "starter": true, "min_level": 1, "recipe": []}],
            "starter_unlock_level": 2
        }))
        .transact().await?.into_result()?;
    let batch: Vec<_> = (0..20)
        .map(|i| json!({"account_id": format!("player{i}.testnet"), "nonce": 1, "level": 3, "digest": DIGEST,
            "items": [{"item": "crumbs", "amount": 2}, {"item": "sybil-goo", "amount": 1}, {"item": "fee-bomb", "amount": 1}]}))
        .collect();
    let mint = operator
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": batch}))
        .max_gas()
        .transact()
        .await?;
    assert!(mint.is_success(), "{mint:?}");
    println!("GAS mint_rewards(20 x 3 items) {:.2} Tgas", gas(&mint));
    let top: Vec<String> = (0..10).map(|i| format!("player{i}.testnet")).collect();
    let season = operator
        .call(game.id(), "record_season")
        .args_json(json!({"season_id": "s1", "root": DIGEST, "top10": top, "digest": DIGEST}))
        .max_gas()
        .transact()
        .await?;
    assert!(season.is_success(), "{season:?}");
    println!("GAS record_season(10) {:.2} Tgas", gas(&season));
    Ok(())
}

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

/// Opens the market with the default commons curve for crumbs and the rare one for gliders.
fn market_args() -> serde_json::Value {
    json!({
        "params": {
            "open": true, "fee_bps": 200, "floor_bps": 5000, "ceiling_bps": 40000, "max_amount": 20,
            "max_open_listings": 3, "max_listings": 300, "daily_trades": 40, "daily_listings": 10,
            "daily_fills": 10, "daily_fill_bits": "3000", "craft_bits": "0"
        },
        "pools": [
            {"item": "crumbs", "virtual_bits": "480", "virtual_items": "40", "seed_bits": "480", "seed_stock": "40"},
            {"item": "goblin-glider", "virtual_bits": "1200", "virtual_items": "8", "seed_bits": "1200", "seed_stock": "8"}
        ]
    })
}

async fn price(game: &near_workspaces::Contract, item: &str) -> anyhow::Result<u128> {
    let state: serde_json::Value = game.view("market_state").await?.json()?;
    let i = state["pools"]
        .as_array()
        .unwrap()
        .iter()
        .position(|p| p["item"] == item)
        .unwrap();
    Ok(state["prices_milli"][i].as_str().unwrap().parse()?)
}

/// The Mempool Market on a real runtime: a session key buys and sells with no deposit and
/// the price moves each way; listings escrow, fill and cancel; a deposit is refused.
#[tokio::test]
async fn market_buy_sell_moves_the_price() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let game = worker.dev_deploy(&std::fs::read(WASM)?).await?;
    let root = worker.root_account()?;
    let mut accounts = Vec::new();
    for name in ["operator", "alice", "bob"] {
        accounts.push(
            root.create_subaccount(name)
                .initial_balance(NearToken::from_near(5))
                .transact()
                .await?
                .into_result()?,
        );
    }
    let [operator, alice, bob] = <[_; 3]>::try_from(accounts).unwrap();
    game.call("new")
        .args_json(json!({
            "owner_id": root.id(), "operators": [operator.id()], "items": ITEMS,
            "suits": [{"id": "classic", "starter": true, "min_level": 1, "recipe": []}],
            "starter_unlock_level": 2
        }))
        .transact()
        .await?
        .into_result()?;

    let open = root
        .call(game.id(), "set_market_params")
        .args_json(market_args())
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(open.is_success(), "{open:?}");
    println!("GAS set_market_params(2 pools) {:.2} Tgas", gas(&open));

    let mint = operator
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": [
            {"account_id": alice.id(), "nonce": 1, "items": [{"item": "bits", "amount": 500}, {"item": "crumbs", "amount": 10}], "digest": DIGEST},
            {"account_id": bob.id(), "nonce": 1, "items": [{"item": "bits", "amount": 300}], "digest": DIGEST}
        ]}))
        .transact()
        .await?;
    assert!(mint.is_success(), "{mint:?}");
    println!("GAS mint_rewards(2, with Bits) {:.2} Tgas", gas(&mint));

    // Alice's session key: function-call only, game contract only.
    let session = SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    alice
        .batch(alice.id())
        .add_key(
            session.public_key(),
            AccessKey::function_call_access(game.id(), &[], Some(NearToken::from_millinear(50))),
        )
        .transact()
        .await?
        .into_result()?;
    let alice_key = near_workspaces::Account::from_secret_key(alice.id().clone(), session, &worker);

    let p0 = price(&game, "crumbs").await?;
    let buy = alice_key
        .call(game.id(), "market_buy")
        .args_json(json!({"item": "crumbs", "amount": 5, "max_bits": "100"}))
        .transact()
        .await?;
    assert!(buy.is_success(), "{buy:?}");
    println!("GAS market_buy {:.2} Tgas", gas(&buy));
    let trade: serde_json::Value = buy.json()?;
    let p1 = price(&game, "crumbs").await?;
    println!(
        "crumbs price {p0} -> {p1} milli-Bits after buying 5 for {} Bits",
        trade["bits"]
    );
    assert!(p1 > p0, "buying must raise the price");

    let sell = alice_key
        .call(game.id(), "market_sell")
        .args_json(json!({"item": "crumbs", "amount": 12, "min_bits": "1"}))
        .transact()
        .await?;
    assert!(sell.is_success(), "{sell:?}");
    println!("GAS market_sell {:.2} Tgas", gas(&sell));
    let p2 = price(&game, "crumbs").await?;
    println!("crumbs price {p1} -> {p2} milli-Bits after selling 12");
    assert!(p2 < p1 && p2 < p0, "selling must lower the price");

    // Slippage: a limit under today's cost fails on chain.
    let tight = alice_key
        .call(game.id(), "market_buy")
        .args_json(json!({"item": "crumbs", "amount": 3, "max_bits": "1"}))
        .transact()
        .await?;
    assert!(tight.is_failure());

    // A deposit is refused (and a session key couldn't attach one anyway).
    let paid = alice
        .call(game.id(), "market_buy")
        .args_json(json!({"item": "crumbs", "amount": 1, "max_bits": "100"}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(paid.is_failure());

    // Bits still move only with a full-access key and 1 yocto.
    let stolen = alice_key
        .call(game.id(), "mt_transfer")
        .args_json(json!({"receiver_id": bob.id(), "token_id": "item:bits", "amount": "10"}))
        .transact()
        .await?;
    assert!(stolen.is_failure());

    // Listings: escrow, a fill by Bob, and a cancel.
    let list = alice_key
        .call(game.id(), "list_item")
        .args_json(json!({"item": "crumbs", "amount": 2, "price_bits": "30"}))
        .transact()
        .await?;
    assert!(list.is_success(), "{list:?}");
    println!("GAS list_item {:.2} Tgas", gas(&list));
    let listing: serde_json::Value = list.json()?;
    let fill = bob
        .call(game.id(), "buy_listing")
        .args_json(json!({"listing_id": listing["id"]}))
        .transact()
        .await?;
    assert!(fill.is_success(), "{fill:?}");
    println!("GAS buy_listing {:.2} Tgas", gas(&fill));
    let relist = alice_key
        .call(game.id(), "list_item")
        .args_json(json!({"item": "crumbs", "amount": 1, "price_bits": "15"}))
        .transact()
        .await?;
    let again: serde_json::Value = relist.json()?;
    let cancel = alice_key
        .call(game.id(), "cancel_listing")
        .args_json(json!({"listing_id": again["id"]}))
        .transact()
        .await?;
    assert!(cancel.is_success(), "{cancel:?}");
    println!("GAS cancel_listing {:.2} Tgas", gas(&cancel));

    let bob_crumbs: serde_json::Value = game
        .view("mt_balance_of")
        .args_json(json!({"account_id": bob.id(), "token_id": "item:crumbs"}))
        .await?
        .json()?;
    assert_eq!(bob_crumbs, json!("2"));
    let account: serde_json::Value = game
        .view("market_account")
        .args_json(json!({"account_id": alice.id()}))
        .await?
        .json()?;
    println!("alice on the market: {account}");
    let quote: serde_json::Value = game
        .view("market_quote")
        .args_json(json!({"item": "goblin-glider", "amount": 1}))
        .await?
        .json()?;
    println!("glider quote: {quote}");
    Ok(())
}

/// Upgrades a v1 contract (before the market) in place: `upgrade` deploys this wasm and
/// `migrate` adds an empty market; players keep their tokens. Needs a v1 build, e.g. of
/// main before the market: `WGP_V1_WASM=/path/to/v1/wgp.wasm cargo test` (skipped without).
#[tokio::test]
async fn upgrade_from_v1_keeps_players() -> anyhow::Result<()> {
    let Ok(v1_path) = std::env::var("WGP_V1_WASM") else {
        println!("WGP_V1_WASM not set; skipping the upgrade test");
        return Ok(());
    };
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let owner = root
        .create_subaccount("owner")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let game = root
        .create_subaccount("game")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    let game = game.deploy(&std::fs::read(v1_path)?).await?.into_result()?;
    game.call("new")
        .args_json(json!({
            "owner_id": owner.id(), "operators": [owner.id()], "items": ITEMS,
            "suits": [{"id": "classic", "starter": true, "min_level": 1, "recipe": []}],
            "starter_unlock_level": 2
        }))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": [{"account_id": "alice.test.near", "nonce": 1, "items": [{"item": "crumbs", "amount": 3}], "digest": DIGEST}]}))
        .transact()
        .await?
        .into_result()?;

    let upgrade = owner
        .call(game.id(), "upgrade")
        .args(std::fs::read(WASM)?)
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(upgrade.is_success(), "{upgrade:?}");
    println!("GAS upgrade + migrate {:.2} Tgas", gas(&upgrade));

    let crumbs: serde_json::Value = game
        .view("mt_balance_of")
        .args_json(json!({"account_id": "alice.test.near", "token_id": "item:crumbs"}))
        .await?
        .json()?;
    assert_eq!(crumbs, json!("3"));
    let state: serde_json::Value = game.view("market_state").await?.json()?;
    assert_eq!(state["pools"], json!([]));
    let open = owner
        .call(game.id(), "set_market_params")
        .args_json(market_args())
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(open.is_success(), "{open:?}");
    // Bits rewards work after the upgrade.
    owner
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": [{"account_id": "alice.test.near", "nonce": 2, "items": [{"item": "bits", "amount": 40}], "digest": DIGEST}]}))
        .transact()
        .await?
        .into_result()?;
    let bits: serde_json::Value = game
        .view("bits_of")
        .args_json(json!({"account_id": "alice.test.near"}))
        .await?
        .json()?;
    assert_eq!(bits, json!("40"));
    Ok(())
}
