//! Added by an independent review of v3: the two operator calls that must keep working
//! (`mint_rewards` with a full batch, `record_season` with ten players), on a contract
//! that was just upgraded from the live v2 wasm, with the gas the server attaches to them
//! (100 Tgas, apps/wgp/src/server/near/operator.ts).
//!
//! The first batch after the upgrade is the dearest there will be: every hero and item
//! in it predates the token index and joins it in that call. The other tests measured a
//! full batch only on a fresh v3 deploy, for players with no heroes.
//!
//! Needs the wasms upgrade_v3.rs needs (see its header). The second test runs on a copy
//! of mainnet's contract with its real balance and is skipped unless
//! WGP_MAINNET_REHEARSAL=1; it only reads from mainnet.

use std::collections::HashMap;

use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{AccountId, Contract};
use serde_json::{json, Value};

const V3_WASM: &str = "../target/near/wgp.wasm";
const V2_WASM: &str = "../target/near/wgp-v2.wasm";
const DIGEST: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const ROOT: &str = "2222222222222222222222222222222222222222222222222222222222222222";
/// What the server attaches to `mint_rewards` and `record_season`.
const OPERATOR_TGAS: u64 = 100;
/// A margin under it: an operator call burning more than this needs a look.
const MAX_TGAS: f64 = 30.0;

fn tgas(o: &ExecutionFinalResult) -> f64 {
    o.total_gas_burnt.as_gas() as f64 / 1e12
}

fn ok(what: &str, o: ExecutionFinalResult) -> f64 {
    assert!(
        o.is_success() && o.failures().is_empty(),
        "{what} failed: {o:?}"
    );
    println!("GAS {what} {:.2} Tgas", tgas(&o));
    tgas(&o)
}

async fn view(game: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(game.view(method).args_json(args).await?.json()?)
}

async fn bytes(game: &Contract) -> anyhow::Result<u64> {
    Ok(game.view_account().await?.storage_usage)
}

/// The rules and curves `game.wgpnear.near` runs (get_config and market_state, Nov 12).
fn mainnet_rules(owner: &AccountId, operator: &AccountId) -> Value {
    json!({
        "owner_id": owner, "operators": [operator],
        "items": ["fee-bomb", "goblin-glider", "crumbs", "sesame-seed", "chain-link", "spare-arm", "sybil-goo", "press-pass"],
        "suits": [
            {"id": "classic", "starter": true, "min_level": 1, "recipe": []},
            {"id": "midnight", "starter": true, "min_level": 1, "recipe": []},
            {"id": "mint", "starter": true, "min_level": 1, "recipe": []},
            {"id": "snow", "starter": true, "min_level": 1, "recipe": []},
            {"id": "stealth", "starter": false, "min_level": 2, "recipe": [{"item": "sybil-goo", "amount": 3}]},
            {"id": "glider", "starter": false, "min_level": 2, "recipe": [{"item": "goblin-glider", "amount": 1}, {"item": "fee-bomb", "amount": 2}]},
            {"id": "octo", "starter": false, "min_level": 3, "recipe": [{"item": "spare-arm", "amount": 1}, {"item": "chain-link", "amount": 3}]},
            {"id": "sesame", "starter": false, "min_level": 2, "recipe": [{"item": "crumbs", "amount": 4}, {"item": "sesame-seed", "amount": 1}]}
        ],
        "starter_unlock_level": 2
    })
}

fn mainnet_market() -> Value {
    let pool = |item: &str, bits: u32, items: u32| {
        json!({"item": item, "virtual_bits": bits.to_string(), "virtual_items": items.to_string(),
               "seed_bits": bits.to_string(), "seed_stock": items.to_string()})
    };
    json!({
        "params": {
            "open": true, "fee_bps": 200, "floor_bps": 5000, "ceiling_bps": 40000,
            "max_amount": 20, "max_open_listings": 3, "max_listings": 300,
            "daily_trades": 40, "daily_listings": 10, "daily_fills": 10,
            "daily_fill_bits": "3000", "craft_bits": "0"
        },
        "pools": [
            pool("fee-bomb", 480, 40), pool("goblin-glider", 1200, 8), pool("crumbs", 480, 40),
            pool("sesame-seed", 800, 20), pool("chain-link", 480, 40), pool("spare-arm", 1200, 8),
            pool("sybil-goo", 800, 20), pool("press-pass", 800, 20)
        ]
    })
}

fn batch(players: &[AccountId], nonce: u64) -> Value {
    let rewards: Vec<Value> = players
        .iter()
        .map(|p| {
            json!({"account_id": p, "nonce": nonce, "level": 3, "badges": ["day-one"], "digest": DIGEST,
                   "items": [{"item": "bits", "amount": 120}, {"item": "crumbs", "amount": 2}, {"item": "sybil-goo", "amount": 1}]})
        })
        .collect();
    json!({ "batch": rewards })
}

#[tokio::test]
async fn the_season_and_a_full_batch_right_after_the_upgrade() -> anyhow::Result<()> {
    let Ok(v2) = std::fs::read(std::env::var("WGP_V2_WASM").unwrap_or_else(|_| V2_WASM.into()))
    else {
        println!("No v2 wasm; skipping (see upgrade_v3.rs)");
        return Ok(());
    };
    let v3 = std::fs::read(V3_WASM)?;
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let sub = |name: &str, near: u128| {
        let root = root.clone();
        let name = name.to_string();
        async move {
            root.create_subaccount(&name)
                .initial_balance(NearToken::from_near(near))
                .transact()
                .await?
                .into_result()
                .map_err(anyhow::Error::from)
        }
    };
    let owner = sub("owner", 20).await?;
    let operator = sub("operator", 20).await?;
    let game = sub("game", 12).await?;
    let mut players = Vec::new();
    for i in 0..20 {
        players.push(sub(&format!("player{i:02}"), 2).await?);
    }
    let ids: Vec<AccountId> = players.iter().map(|p| p.id().clone()).collect();
    let top10 = &ids[..10];

    // ---- v2, as live: 20 heroes with loot, Bits and a badge, and a recorded season ----
    let game = game.deploy(&v2).await?.into_result()?;
    game.call("new")
        .args_json(mainnet_rules(owner.id(), operator.id()))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(game.id(), "set_market_params")
        .args_json(mainnet_market())
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let hero_v2 = bytes(&game).await?;
    for p in &players {
        p.call(game.id(), "register_hero")
            .args_json(json!({"name": "Peter", "suit": "classic"}))
            .transact()
            .await?
            .into_result()?;
    }
    let hero_v2 = (bytes(&game).await? - hero_v2) / players.len() as u64;
    let call = |method: &'static str, args: Value| {
        operator
            .call(game.id(), method)
            .args_json(args)
            .gas(Gas::from_tgas(OPERATOR_TGAS))
            .transact()
    };
    ok(
        "v2 mint_rewards(20), first",
        call("mint_rewards", batch(&ids, 1)).await?,
    );
    let v2_mint = ok(
        "v2 mint_rewards(20), steady",
        call("mint_rewards", batch(&ids, 2)).await?,
    );
    let v2_season = ok(
        "v2 record_season(10)",
        call(
            "record_season",
            json!({"season_id": "s0", "root": ROOT, "top10": top10, "digest": DIGEST}),
        )
        .await?,
    );

    // ---- The upgrade ----
    // With too little gas for the deploy and the migration it fails whole: still v2.
    let state: HashMap<Vec<u8>, Vec<u8>> = worker.view_state(game.id()).await?;
    let short = owner
        .call(game.id(), "upgrade")
        .args(v3.clone())
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?;
    assert!(short.is_failure(), "60 Tgas can't carry the upgrade");
    assert_eq!(worker.view_state(game.id()).await?, state);
    assert!(game.view("get_version").await.is_err(), "still v2");
    ok(
        "upgrade v2 -> v3",
        owner
            .call(game.id(), "upgrade")
            .args(v3)
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?,
    );
    assert_eq!(view(&game, "mt_tokens_count", json!({})).await?, "0");
    // What a new hero costs the contract in storage, which anyone can make it pay.
    let mut hero_v3 = Vec::new();
    for name in ["newcomer", "another"] {
        let newcomer = sub(name, 2).await?;
        let before = bytes(&game).await?;
        newcomer
            .call(game.id(), "register_hero")
            .args_json(json!({"name": "Peter", "suit": "classic"}))
            .transact()
            .await?
            .into_result()?;
        hero_v3.push(bytes(&game).await? - before);
    }
    println!(
        "STORAGE register_hero: {hero_v2} bytes on v2; on v3 {} bytes (also indexes suit:classic), then {} bytes",
        hero_v3[0], hero_v3[1]
    );
    assert_eq!(view(&game, "mt_tokens_count", json!({})).await?, "3");

    // ---- The first full batch on v3: 20 heroes and 3 items join the index in it ----
    let b0 = bytes(&game).await?;
    let first = ok(
        "v3 mint_rewards(20), first after the upgrade",
        call("mint_rewards", batch(&ids, 3)).await?,
    );
    let b1 = bytes(&game).await?;
    let steady = ok(
        "v3 mint_rewards(20), steady",
        call("mint_rewards", batch(&ids, 4)).await?,
    );
    let b2 = bytes(&game).await?;
    println!(
        "STORAGE first v3 batch +{} bytes (the index), the next +{} bytes; v2 steady batch {v2_mint:.2} Tgas",
        b1 - b0,
        b2 - b1
    );
    assert!(first < MAX_TGAS && steady < MAX_TGAS, "{first} {steady}");
    assert_eq!(b2, b1, "a batch for indexed players adds no storage");
    // 20 heroes, Bits, crumbs and sybil-goo; the two newcomers' heroes and suit:classic.
    assert_eq!(view(&game, "mt_tokens_count", json!({})).await?, "26");
    for p in &ids {
        assert_eq!(
            view(&game, "reward_nonce", json!({"account_id": p})).await?,
            4
        );
        assert_eq!(
            view(
                &game,
                "mt_balance_of",
                json!({"account_id": p, "token_id": "item:bits"})
            )
            .await?,
            "480"
        );
    }

    // ---- The season on v3 ----
    let season = ok(
        "v3 record_season(10)",
        call(
            "record_season",
            json!({"season_id": "s1", "root": ROOT, "top10": top10, "digest": DIGEST}),
        )
        .await?,
    );
    let b3 = bytes(&game).await?;
    println!(
        "STORAGE v3 record_season(10) +{} bytes = {:.4} NEAR; v2 took {v2_season:.2} Tgas",
        b3 - b2,
        (b3 - b2) as f64 / 1e5
    );
    assert!(season < MAX_TGAS, "{season}");
    let recorded = view(&game, "get_season", json!({"season_id": "s1"})).await?;
    assert_eq!(recorded["top10"], json!(top10));
    let trophies: Vec<String> = (1..=10).map(|r| format!("trophy:s1:{r}")).collect();
    let owners = view(&game, "mt_token", json!({"token_ids": trophies})).await?;
    for (i, t) in owners.as_array().unwrap().iter().enumerate() {
        assert_eq!(t["owner_id"], json!(top10[i]));
    }
    assert_eq!(view(&game, "mt_tokens_count", json!({})).await?, "36");
    // A second season can't be recorded over it, as in v2.
    let again = call(
        "record_season",
        json!({"season_id": "s1", "root": ROOT, "top10": top10, "digest": DIGEST}),
    )
    .await?;
    assert!(format!("{:?}", again.failures()).contains("already recorded"));

    // ---- What the season needs from the account's balance ----
    // The contract pays for storage. With less free balance than the season's bytes cost,
    // the call fails whole; this is why the top-up must leave headroom past the upgrade.
    let storage = view(&game, "get_storage", json!({})).await?;
    let available: u128 = storage["available"].as_str().unwrap().parse()?;
    let keep = NearToken::from_millinear(5).as_yoctonear();
    game.as_account()
        .transfer_near(root.id(), NearToken::from_yoctonear(available - keep))
        .await?
        .into_result()?;
    let short = call(
        "record_season",
        json!({"season_id": "s2", "root": ROOT, "top10": top10, "digest": DIGEST}),
    )
    .await?;
    assert!(
        short.is_failure(),
        "a season the account can't store must fail"
    );
    let why = format!("{:?}", short.failures());
    println!(
        "record_season with 0.005 NEAR free: {}",
        &why[..why.len().min(300)]
    );
    assert_eq!(
        view(&game, "get_season", json!({"season_id": "s2"})).await?,
        Value::Null
    );
    root.transfer_near(game.id(), NearToken::from_millinear(200))
        .await?
        .into_result()?;
    ok(
        "v3 record_season(10) after a top-up",
        call(
            "record_season",
            json!({"season_id": "s2", "root": ROOT, "top10": top10, "digest": DIGEST}),
        )
        .await?,
    );
    Ok(())
}

/// The same two calls on a copy of mainnet's contract and state, holding what the real
/// account holds: the upgrade must fail whole without a top-up, go through with 2 NEAR,
/// and leave the operator able to record a season and mint a full batch.
#[tokio::test]
async fn the_season_on_a_copy_of_mainnet_with_its_real_balance() -> anyhow::Result<()> {
    if std::env::var("WGP_MAINNET_REHEARSAL").is_err() {
        println!("WGP_MAINNET_REHEARSAL not set; skipping");
        return Ok(());
    }
    let game_id: AccountId = std::env::var("WGP_CONTRACT")
        .unwrap_or_else(|_| "game.wgpnear.near".into())
        .parse()?;
    let rpc =
        std::env::var("NEAR_RPC_URL").unwrap_or_else(|_| "https://rpc.mainnet.fastnear.com".into());
    let mainnet = near_workspaces::mainnet().rpc_addr(&rpc).await?;
    let worker = near_workspaces::sandbox().await?;
    let real = mainnet.view_account(&game_id).await?;
    println!(
        "{game_id} on mainnet: {:.4} NEAR, {} bytes, {:.4} NEAR free",
        real.balance.as_yoctonear() as f64 / 1e24,
        real.storage_usage,
        real.balance.as_yoctonear() as f64 / 1e24 - real.storage_usage as f64 / 1e5
    );
    let game = worker
        .import_contract(&game_id, &mainnet)
        .with_data()
        .initial_balance(real.balance)
        .transact()
        .await?;
    let config = view(&game, "get_config", json!({})).await?;
    let owner_id: AccountId = config["owner_id"].as_str().unwrap().parse()?;
    let operator_id: AccountId = config["operators"][0].as_str().unwrap().parse()?;
    let owner = worker
        .import_contract(&owner_id, &mainnet)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?;
    let operator = worker
        .import_contract(&operator_id, &mainnet)
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?;
    let v3 = std::fs::read(V3_WASM)?;
    let upgrade = || {
        owner
            .as_account()
            .call(game.id(), "upgrade")
            .args(v3.clone())
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
    };

    // ---- Without the top-up: refused whole ----
    let before: HashMap<Vec<u8>, Vec<u8>> = worker.view_state(&game_id).await?;
    let short = upgrade().await?;
    assert!(
        short.is_failure(),
        "the real balance can't pay for v3's code"
    );
    let after: HashMap<Vec<u8>, Vec<u8>> = worker.view_state(&game_id).await?;
    assert_eq!(after, before, "a refused upgrade changes no state");
    assert!(game.view("get_version").await.is_err(), "still v2");

    // ---- With 2 NEAR ----
    worker
        .root_account()?
        .transfer_near(&game_id, NearToken::from_near(2))
        .await?
        .into_result()?;
    ok("upgrade on the copy after 2 NEAR", upgrade().await?);
    let storage = view(&game, "get_storage", json!({})).await?;
    println!("get_storage after the upgrade: {storage}");

    // Real players (the open listings' sellers) and new ones, ten in all.
    let listings = view(&game, "market_listings", json!({})).await?;
    let mut people: Vec<String> = listings
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["seller"].as_str().unwrap().to_string())
        .collect();
    people.sort();
    people.dedup();
    people.truncate(10);
    let real_players = people.len();
    for i in 0..20 - real_players {
        people.push(format!("review-player-{i:02}.near"));
    }
    let call = |method: &'static str, args: Value| {
        operator
            .as_account()
            .call(game.id(), method)
            .args_json(args)
            .gas(Gas::from_tgas(OPERATOR_TGAS))
            .transact()
    };
    let b0 = bytes(&game).await?;
    let season = ok(
        "record_season(10) on the copy",
        call(
            "record_season",
            json!({"season_id": "review-1", "root": ROOT, "top10": &people[..10], "digest": DIGEST}),
        )
        .await?,
    );
    let b1 = bytes(&game).await?;
    let mut rewards = Vec::new();
    for p in &people {
        let nonce = view(&game, "reward_nonce", json!({"account_id": p}))
            .await?
            .as_u64()
            .unwrap();
        rewards.push(json!({"account_id": p, "nonce": nonce + 1, "level": 3, "digest": DIGEST,
            "items": [{"item": "bits", "amount": 120}, {"item": "crumbs", "amount": 2}, {"item": "sybil-goo", "amount": 1}]}));
    }
    let mint = call("mint_rewards", json!({ "batch": rewards })).await?;
    let statuses: Value = mint.clone().json()?;
    let mint = ok("mint_rewards(20) on the copy", mint);
    let b2 = bytes(&game).await?;
    println!(
        "{real_players} real players in the batch; statuses {statuses}; season +{} bytes, batch +{} bytes",
        b1 - b0,
        b2 - b1
    );
    assert!(season < MAX_TGAS && mint < MAX_TGAS);
    assert!(statuses
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s == "applied" || s == "full"));
    let recorded = view(&game, "get_season", json!({"season_id": "review-1"})).await?;
    assert_eq!(recorded["top10"], json!(&people[..10]));
    println!(
        "get_storage after the season and a batch: {}",
        view(&game, "get_storage", json!({})).await?
    );
    Ok(())
}
