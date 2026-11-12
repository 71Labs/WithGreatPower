//! A rehearsal of the v3 upgrade on a copy of the real thing.
//!
//! Copies `game.wgpnear.near` from mainnet into a local sandbox, code and state, with
//! read-only RPC queries (nothing is sent to mainnet and no real key is involved: the
//! sandbox gives its copies of the accounts new keys). Then, in the sandbox:
//!
//! 1. the owner's copy calls `upgrade` with the v3 wasm;
//! 2. every storage entry but the root must be byte-identical, and every v2 view must
//!    answer what it did;
//! 3. the v3 views answer on the real state, and a real seller's copy trades;
//! 4. (with the rollback build) the rollback puts the original root back, byte for byte.
//!
//! It needs the network, so it only runs when asked:
//!
//!   WGP_MAINNET_REHEARSAL=1 cargo test --test mainnet_rehearsal -- --nocapture
//!
//! `WGP_CONTRACT` (default game.wgpnear.near) and `NEAR_RPC_URL` can point it elsewhere.

use std::collections::HashMap;

use near_workspaces::types::NearToken;
use near_workspaces::{AccountId, Contract};
use serde_json::{json, Value};

const V3_WASM: &str = "../target/near/wgp.wasm";
const ROLLBACK_WASM: &str = "../target/near/wgp-v2-rollback.wasm";

async fn view(game: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(game.view(method).args_json(args).await?.json()?)
}

/// What a v2 client reads, for the given accounts.
async fn snapshot(game: &Contract, accounts: &[AccountId]) -> anyhow::Result<Value> {
    let state = view(game, "market_state", json!({})).await?;
    let pools: Vec<Value> = state["pools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            json!([
                p["item"],
                p["virtual_bits"],
                p["virtual_items"],
                p["bits"],
                p["stock"],
                p["escrow"]
            ])
        })
        .collect();
    let rules: Vec<Value> = [
        "open",
        "fee_bps",
        "floor_bps",
        "ceiling_bps",
        "max_amount",
        "max_open_listings",
        "max_listings",
        "daily_trades",
        "daily_listings",
        "daily_fills",
        "daily_fill_bits",
        "craft_bits",
    ]
    .iter()
    .map(|k| state["params"][k].clone())
    .collect();
    let mut tokens = vec!["item:bits".to_string()];
    tokens.extend(
        pools
            .iter()
            .map(|p| format!("item:{}", p[0].as_str().unwrap())),
    );
    let mut players = Vec::new();
    for a in accounts {
        players.push(json!({
            "player": view(game, "get_player", json!({"account_id": a})).await?,
            "market": view(game, "market_account", json!({"account_id": a})).await?,
            "balances": view(game, "mt_batch_balance_of", json!({"account_id": a, "token_ids": tokens})).await?,
        }));
    }
    Ok(json!({
        "config": view(game, "get_config", json!({})).await?,
        "pools": pools,
        "rules": rules,
        "prices": state["prices_milli"],
        "listing_count": state["listings"],
        "listings": view(game, "market_listings", json!({})).await?,
        "supply": view(game, "mt_batch_supply", json!({"token_ids": tokens})).await?,
        "vendor": view(game, "mt_batch_balance_of", json!({"account_id": game.id(), "token_ids": tokens})).await?,
        "players": players,
    }))
}

#[tokio::test]
async fn the_upgrade_on_a_copy_of_mainnet() -> anyhow::Result<()> {
    if std::env::var("WGP_MAINNET_REHEARSAL").is_err() {
        println!("WGP_MAINNET_REHEARSAL not set; skipping the rehearsal on a copy of mainnet");
        return Ok(());
    }
    let game_id: AccountId = std::env::var("WGP_CONTRACT")
        .unwrap_or_else(|_| "game.wgpnear.near".into())
        .parse()?;
    let rpc =
        std::env::var("NEAR_RPC_URL").unwrap_or_else(|_| "https://rpc.mainnet.fastnear.com".into());
    let mainnet = near_workspaces::mainnet().rpc_addr(&rpc).await?;
    let worker = near_workspaces::sandbox().await?;

    // The contract: code and every storage entry, as of now.
    let game = worker
        .import_contract(&game_id, &mainnet)
        .with_data()
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?;
    let before_state: HashMap<Vec<u8>, Vec<u8>> = worker.view_state(&game_id).await?;
    let config = view(&game, "get_config", json!({})).await?;
    let owner_id: AccountId = config["owner_id"].as_str().unwrap().parse()?;
    println!(
        "copied {game_id}: {} storage entries, {} bytes of state, owner {owner_id}",
        before_state.len(),
        before_state
            .iter()
            .map(|(k, v)| k.len() + v.len())
            .sum::<usize>()
    );
    // The owner and a few real players, as sandbox accounts with sandbox keys.
    let owner = worker
        .import_contract(&owner_id, &mainnet)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?;
    let listings = view(&game, "market_listings", json!({})).await?;
    let mut people: Vec<AccountId> = listings
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["seller"].as_str().unwrap().parse().unwrap())
        .collect();
    people.sort();
    people.dedup();
    people.push(owner_id.clone());
    println!("players checked: {people:?}");
    let before = snapshot(&game, &people).await?;

    // ---- 1. Upgrade ----
    let v3 = std::fs::read(V3_WASM)?;
    let upgrade = owner
        .as_account()
        .call(game.id(), "upgrade")
        .args(v3.clone())
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(
        upgrade.is_success() && upgrade.failures().is_empty(),
        "{upgrade:?}"
    );
    println!(
        "GAS upgrade + migrate on the copy: {:.2} Tgas",
        upgrade.total_gas_burnt.as_gas() as f64 / 1e12
    );

    // ---- 2. Nothing but the root moved ----
    let after_state: HashMap<Vec<u8>, Vec<u8>> = worker.view_state(&game_id).await?;
    assert_eq!(
        after_state.len(),
        before_state.len(),
        "no entry added or removed"
    );
    let changed: Vec<String> = before_state
        .iter()
        .filter(|(k, v)| after_state.get(*k) != Some(v))
        .map(|(k, _)| String::from_utf8_lossy(k).into_owned())
        .collect();
    assert_eq!(changed, ["STATE"], "only the root entry may change");
    println!(
        "root entry: {} -> {} bytes; the other {} entries are byte-identical",
        before_state[b"STATE".as_slice()].len(),
        after_state[b"STATE".as_slice()].len(),
        before_state.len() - 1
    );
    assert_eq!(snapshot(&game, &people).await?, before, "a v2 view changed");

    // ---- 3. v3 on the real state ----
    let version = view(&game, "get_version", json!({})).await?;
    assert_eq!(version["state"], 3);
    let state = view(&game, "market_state", json!({})).await?;
    assert_eq!(state["params"]["invest_open"], false);
    assert_eq!(state["params"]["craft_bits"], before["rules"][11]);
    let shops = view(&game, "market_shops", json!({})).await?;
    for s in shops.as_array().unwrap() {
        println!(
            "  shop {}: closed {} till {} room {}",
            s["item"], s["closed"], s["till"], s["invest_room"]
        );
    }
    let seller = people[0].clone();
    let meta = view(
        &game,
        "mt_metadata_token_all",
        json!({"token_ids": [format!("hero:{seller}"), "item:bits", "item:fee-bomb", "suit:classic"]}),
    )
    .await?;
    println!("a real hero's metadata: {}", meta[0]["token"]);
    assert!(meta
        .as_array()
        .unwrap()
        .iter()
        .all(|m| m["token"]["media"].is_string()));
    assert_eq!(view(&game, "mt_tokens", json!({})).await?, json!([]));

    // A real seller's copy cancels its listing and trades, with no deposit.
    let listing = listings
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["seller"] == seller.as_str())
        .unwrap();
    let player = worker
        .import_contract(&seller, &mainnet)
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?;
    let cancel = player
        .as_account()
        .call(game.id(), "cancel_listing")
        .args_json(json!({"listing_id": listing["id"]}))
        .transact()
        .await?;
    assert!(cancel.is_success(), "{cancel:?}");
    let sell = player
        .as_account()
        .call(game.id(), "market_sell")
        .args_json(json!({"item": listing["item"], "amount": 1, "min_bits": "0"}))
        .transact()
        .await?;
    assert!(sell.is_success(), "{sell:?}");
    println!(
        "{seller}'s copy cancelled listing {} and sold 1 {}",
        listing["id"], listing["item"]
    );

    // ---- 4. The rollback puts the original root back ----
    let Ok(rollback) = std::fs::read(ROLLBACK_WASM) else {
        println!("No rollback wasm; skipping the rollback");
        return Ok(());
    };
    // A second copy, so the root can be compared without the trades above.
    let worker2 = near_workspaces::sandbox().await?;
    let game2 = worker2
        .import_contract(&game_id, &mainnet)
        .with_data()
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?;
    let owner2 = worker2
        .import_contract(&owner_id, &mainnet)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?;
    let original: HashMap<Vec<u8>, Vec<u8>> = worker2.view_state(&game_id).await?;
    for wasm in [v3, rollback] {
        let o = owner2
            .as_account()
            .call(game2.id(), "upgrade")
            .args(wasm)
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?;
        assert!(o.is_success() && o.failures().is_empty(), "{o:?}");
    }
    let mut restored: HashMap<Vec<u8>, Vec<u8>> = worker2.view_state(&game_id).await?;
    let tail = restored.remove(b"V3TAIL".as_slice());
    assert!(tail.is_some(), "the rollback sets the v3 roots aside");
    assert_eq!(
        restored, original,
        "v2 -> v3 -> rollback must give back the original state, byte for byte"
    );
    println!(
        "v2 -> v3 -> rollback: all {} entries byte-identical to the original",
        original.len()
    );
    assert!(game2.view("get_version").await.is_err());
    Ok(())
}
