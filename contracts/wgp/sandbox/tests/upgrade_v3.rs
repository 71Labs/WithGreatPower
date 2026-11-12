//! The v2 → v3 upgrade on a real runtime, starting from the wasm that is live on mainnet.
//!
//! Deploys the v2 wasm, plays it (heroes, rewards, a craft, trades, listings, a season),
//! calls the v2 contract's own `upgrade` with the v3 wasm as input, and checks that every
//! v2 view answers what it did, that the v3 methods work on the migrated state through a
//! session key, and that a second upgrade and a rollback attempt are both harmless.
//!
//! Needs both wasms:
//!
//!   node ../../scripts/near/fetch-deployed-wasm.mjs game.wgpnear.near \
//!     contracts/wgp/target/near/wgp-v2.wasm 68F7NhEjUtKweyLU7WNvT183apacLQegfB1DXUoQ2hjJ
//!   (cd contracts/wgp && cargo near build non-reproducible-wasm --locked)
//!   (cd contracts/wgp/sandbox && cargo test --test upgrade_v3 -- --nocapture)
//!
//! `WGP_V2_WASM` overrides the v2 path. Without a v2 wasm the test says so and passes.

use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const V3_WASM: &str = "../target/near/wgp.wasm";
const V2_WASM: &str = "../target/near/wgp-v2.wasm";
const DIGEST: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const ROOT: &str = "2222222222222222222222222222222222222222222222222222222222222222";
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

fn tgas(o: &ExecutionFinalResult) -> f64 {
    o.total_gas_burnt.as_gas() as f64 / 1e12
}

fn ok(what: &str, o: ExecutionFinalResult) -> ExecutionFinalResult {
    assert!(o.is_success(), "{what} failed: {o:?}");
    println!("GAS {what} {:.2} Tgas", tgas(&o));
    o
}

/// A call that must succeed and whose result nobody reads.
fn pass(what: &str, o: ExecutionFinalResult) {
    let _ = ok(what, o);
}

/// The panic message of a failed call.
fn refused(o: ExecutionFinalResult) -> String {
    assert!(o.is_failure(), "expected a failure: {o:?}");
    format!("{:?}", o.failures())
}

async fn view(game: &Contract, method: &str, args: Value) -> anyhow::Result<Value> {
    Ok(game.view(method).args_json(args).await?.json()?)
}

/// What scripts/near/market-args.ts sends today (v2 shape: no investing fields), with the
/// default curves for three items.
fn v2_market_args() -> Value {
    json!({
        "params": {
            "open": true, "fee_bps": 200, "floor_bps": 5000, "ceiling_bps": 40000,
            "max_amount": 20, "max_open_listings": 3, "max_listings": 300,
            "daily_trades": 40, "daily_listings": 10, "daily_fills": 10,
            "daily_fill_bits": "3000", "craft_bits": "0"
        },
        "pools": [
            {"item": "crumbs", "virtual_bits": "480", "virtual_items": "40", "seed_bits": "480", "seed_stock": "40"},
            {"item": "sybil-goo", "virtual_bits": "800", "virtual_items": "20", "seed_bits": "800", "seed_stock": "20"},
            {"item": "goblin-glider", "virtual_bits": "1200", "virtual_items": "8", "seed_bits": "1200", "seed_stock": "8"}
        ]
    })
}

/// Everything a v2 client reads, for the accounts and tokens the test touches.
async fn snapshot(game: &Contract, accounts: &[&Account]) -> anyhow::Result<Value> {
    let tokens = json!([
        "item:bits",
        "item:crumbs",
        "item:sybil-goo",
        "item:goblin-glider",
        "suit:classic",
        "suit:stealth",
        "trophy:badge:day-one",
        "trophy:s0:1",
        "trophy:s0:2",
        format!("hero:{}", accounts[0].id()),
        format!("hero:{}", accounts[1].id())
    ]);
    let mut players = Vec::new();
    for a in accounts.iter().map(|a| a.id().to_string()) {
        players.push(json!({
            "player": view(game, "get_player", json!({"account_id": a})).await?,
            "balances": view(game, "mt_batch_balance_of", json!({"account_id": a, "token_ids": tokens})).await?,
            "nonce": view(game, "reward_nonce", json!({"account_id": a})).await?,
            "owned": view(game, "mt_tokens_for_owner", json!({"account_id": a})).await?,
            "market": view(game, "market_account", json!({"account_id": a})).await?,
        }));
    }
    // The vendor's own balances (v3 also lists them in mt_tokens_for_owner; v2 listed none).
    players.push(
        view(
            game,
            "mt_batch_balance_of",
            json!({"account_id": game.id(), "token_ids": tokens}),
        )
        .await?,
    );
    let state = view(game, "market_state", json!({})).await?;
    // The v2 fields of each pool and of the rules; v3 only adds fields beside them.
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
    let params: Vec<Value> = [
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
    Ok(json!({
        "config": view(game, "get_config", json!({})).await?,
        "players": players,
        "supply": view(game, "mt_batch_supply", json!({"token_ids": tokens})).await?,
        "tokens": view(game, "mt_token", json!({"token_ids": tokens})).await?,
        "season": view(game, "get_season", json!({"season_id": "s0"})).await?,
        "pools": pools,
        "params": params,
        "prices": state["prices_milli"],
        "listing_count": state["listings"],
        "listings": view(game, "market_listings", json!({})).await?,
        "quote": view(game, "market_quote", json!({"item": "crumbs", "amount": 3})).await?,
    }))
}

async fn session_key(
    owner: &Account,
    game: &Contract,
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
) -> anyhow::Result<Account> {
    let key = SecretKey::from_random(KeyType::ED25519);
    owner
        .batch(owner.id())
        .add_key(
            key.public_key(),
            AccessKey::function_call_access(game.id(), &[], Some(NearToken::from_millinear(250))),
        )
        .transact()
        .await?
        .into_result()?;
    Ok(Account::from_secret_key(owner.id().clone(), key, worker))
}

#[tokio::test]
async fn upgrade_from_the_live_v2_wasm_keeps_everything_and_adds_v3() -> anyhow::Result<()> {
    let v2_path = std::env::var("WGP_V2_WASM").unwrap_or_else(|_| V2_WASM.to_string());
    let Ok(v2) = std::fs::read(&v2_path) else {
        println!(
            "No v2 wasm at {v2_path}; skipping the v2 → v3 upgrade test (see this file's header)"
        );
        return Ok(());
    };
    let v3 = std::fs::read(V3_WASM)?;
    println!(
        "WASM v2 {} bytes, v3 {} bytes (+{})",
        v2.len(),
        v3.len(),
        v3.len() - v2.len()
    );

    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let mut made = Vec::new();
    for (name, near) in [
        ("owner", 20),
        ("operator", 10),
        ("alice", 10),
        ("bob", 10),
        ("carol", 10),
        ("game", 30),
    ] {
        made.push(
            root.create_subaccount(name)
                .initial_balance(NearToken::from_near(near))
                .transact()
                .await?
                .into_result()?,
        );
    }
    let [owner, operator, alice, bob, carol, game] = <[_; 6]>::try_from(made).unwrap();

    // ---- v2, as deployed on mainnet ----
    let game = game.deploy(&v2).await?.into_result()?;
    game.call("new")
        .args_json(json!({
            "owner_id": owner.id(), "operators": [operator.id()], "items": ITEMS,
            "suits": [
                {"id": "classic", "starter": true, "min_level": 1, "recipe": []},
                {"id": "stealth", "starter": false, "min_level": 2, "recipe": [{"item": "sybil-goo", "amount": 3}]}
            ],
            "starter_unlock_level": 2
        }))
        .transact()
        .await?
        .into_result()?;
    let none = game.view("mt_tokens").args_json(json!({})).await;
    assert!(none.is_err(), "v2 has no mt_tokens");
    assert!(
        game.view("mt_metadata_contract").await.is_err(),
        "v2 has no metadata"
    );

    owner
        .call(game.id(), "set_market_params")
        .args_json(v2_market_args())
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let alice_key = session_key(&alice, &game, &worker).await?;
    let bob_key = session_key(&bob, &game, &worker).await?;
    for (who, name) in [(&alice_key, "Peter"), (&bob_key, "Miles")] {
        who.call(game.id(), "register_hero")
            .args_json(json!({"name": name, "suit": "classic"}))
            .transact()
            .await?
            .into_result()?;
    }
    operator
        .call(game.id(), "mint_rewards")
        .args_json(json!({"batch": [
            {"account_id": alice.id(), "nonce": 1, "level": 4, "badges": ["day-one"], "digest": DIGEST,
             "items": [{"item": "bits", "amount": 900}, {"item": "sybil-goo", "amount": 5}, {"item": "crumbs", "amount": 12}]},
            {"account_id": bob.id(), "nonce": 1, "level": 2, "digest": DIGEST,
             "items": [{"item": "bits", "amount": 600}, {"item": "crumbs", "amount": 6}]},
            {"account_id": carol.id(), "nonce": 1, "digest": DIGEST, "items": [{"item": "crumbs", "amount": 400}]}
        ]}))
        .transact()
        .await?
        .into_result()?;
    for (who, method, args) in [
        (&alice_key, "craft_suit", json!({"suit": "stealth"})),
        (
            &alice_key,
            "market_buy",
            json!({"item": "goblin-glider", "amount": 1, "max_bits": "1000"}),
        ),
        (
            &alice_key,
            "market_sell",
            json!({"item": "crumbs", "amount": 4, "min_bits": "1"}),
        ),
        (
            &alice_key,
            "list_item",
            json!({"item": "crumbs", "amount": 3, "price_bits": "40"}),
        ),
        (
            &bob_key,
            "list_item",
            json!({"item": "crumbs", "amount": 2, "price_bits": "30"}),
        ),
        (
            &bob_key,
            "list_item",
            json!({"item": "crumbs", "amount": 1, "price_bits": "14"}),
        ),
        (&alice_key, "buy_listing", json!({"listing_id": 3})),
    ] {
        let o = who
            .call(game.id(), method)
            .args_json(args)
            .transact()
            .await?;
        assert!(o.is_success(), "v2 {method}: {o:?}");
    }
    operator
        .call(game.id(), "record_season")
        .args_json(json!({"season_id": "s0", "root": ROOT, "top10": [bob.id(), alice.id()], "digest": DIGEST}))
        .transact()
        .await?
        .into_result()?;

    let people = [&alice, &bob, &carol];
    let before = snapshot(&game, &people).await?;
    assert_eq!(before["listing_count"], json!(2));
    let bytes_v2 = game.view_account().await?.storage_usage;

    // ---- The upgrade: the v2 contract's own `upgrade`, the v3 wasm as its input ----
    let stranger = alice
        .call(game.id(), "upgrade")
        .args(v3.clone())
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(refused(stranger).contains("Only the owner"));
    let upgrade = ok(
        "upgrade v2 -> v3 (deploy + migrate)",
        owner
            .call(game.id(), "upgrade")
            .args(v3.clone())
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?,
    );
    assert!(upgrade.failures().is_empty(), "{:?}", upgrade.failures());
    let bytes_v3 = game.view_account().await?.storage_usage;
    println!(
        "STORAGE v2 {bytes_v2} bytes -> v3 {bytes_v3} bytes: +{} bytes = {:.4} NEAR locked",
        bytes_v3 - bytes_v2,
        (bytes_v3 - bytes_v2) as f64 / 100_000.0
    );

    // Every v2 view answers exactly what it did.
    let after = snapshot(&game, &people).await?;
    assert_eq!(
        after, before,
        "the upgrade changed something a v2 client reads"
    );
    let version = view(&game, "get_version", json!({})).await?;
    assert_eq!(version["state"], 3);
    println!("version: {version}");

    // New in v3 and at their defaults.
    let state = view(&game, "market_state", json!({})).await?;
    assert_eq!(
        state["params"]["craft_bits"], "0",
        "the live crafting cost carries over"
    );
    assert_eq!(state["params"]["invest_open"], true);
    assert_eq!(state["params"]["invest_fee_bps"], 5000);
    for p in state["pools"].as_array().unwrap() {
        assert_eq!(
            (p["invested"].as_str(), p["rewards"].as_str()),
            (Some("0"), Some("0"))
        );
    }

    // ---- Metadata and enumeration on the migrated state ----
    let meta = view(&game, "mt_metadata_contract", json!({})).await?;
    assert_eq!(
        meta,
        json!({"spec": "mt-1.0.0", "name": "With Great Power"})
    );
    let hero = format!("hero:{}", alice.id());
    let all = view(
        &game,
        "mt_metadata_token_all",
        json!({"token_ids": [hero, "suit:stealth", "item:crumbs", "item:bits", "trophy:badge:day-one", "trophy:s0:1", "item:nope"]}),
    )
    .await?;
    let titles: Vec<&str> = all
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["token"]["title"].as_str().unwrap_or("-"))
        .collect();
    assert_eq!(
        titles,
        [
            "Peter",
            "Stealth suit",
            "Crumbs",
            "Bits",
            "Day one badge",
            "Season s0: rank 1",
            "-"
        ]
    );
    assert_eq!(
        all[2]["token"]["media"],
        "https://www.wgponnear.fun/tokens/item/crumbs.png"
    );
    assert_eq!(all[0]["base"]["id"], "hero");
    println!("hero metadata: {}", all[0]);
    let bases = view(&game, "mt_tokens_base_metadata_all", json!({})).await?;
    assert_eq!(bases.as_array().unwrap().len(), 6);

    // Tokens from before v3 aren't indexed yet; the operator indexes them.
    assert_eq!(view(&game, "mt_tokens", json!({})).await?, json!([]));
    let old_tokens = json!([
        format!("hero:{}", alice.id()),
        format!("hero:{}", bob.id()),
        "item:bits",
        "item:crumbs",
        "item:sybil-goo",
        "item:goblin-glider",
        "suit:classic",
        "suit:stealth",
        "trophy:badge:day-one",
        "trophy:s0:1",
        "trophy:s0:2",
        "item:nope"
    ]);
    let indexed = ok(
        "index_tokens(12)",
        operator
            .call(game.id(), "index_tokens")
            .args_json(json!({"token_ids": old_tokens}))
            .transact()
            .await?,
    );
    assert_eq!(indexed.json::<u32>()?, 11);
    let listed = view(&game, "mt_tokens", json!({"from_index": "0", "limit": 100})).await?;
    assert_eq!(listed.as_array().unwrap().len(), 11);
    assert_eq!(
        view(&game, "mt_tokens", json!({"from_index": "9", "limit": 5}))
            .await?
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(view(&game, "mt_tokens_count", json!({})).await?, "11");
    let trophy = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["token_id"] == "trophy:s0:1")
        .unwrap();
    assert_eq!(trophy["owner_id"], bob.id().to_string());

    // A new reward after the upgrade: v2-shaped arguments, and the index keeps itself.
    pass(
        "mint_rewards(1) on v3",
        operator
            .call(game.id(), "mint_rewards")
            .args_json(
                json!({"batch": [{"account_id": carol.id(), "nonce": 2, "digest": DIGEST,
                "items": [{"item": "press-pass", "amount": 1}, {"item": "bits", "amount": 100}]}]}),
            )
            .transact()
            .await?,
    );
    assert_eq!(view(&game, "mt_tokens_count", json!({})).await?, "12");

    // ---- v2 methods on v3, through the same session keys ----
    pass(
        "market_buy on v3",
        alice_key
            .call(game.id(), "market_buy")
            .args_json(json!({"item": "crumbs", "amount": 2, "max_bits": "100"}))
            .transact()
            .await?,
    );
    pass(
        "cancel_listing on v3 (listed under v2)",
        bob_key
            .call(game.id(), "cancel_listing")
            .args_json(json!({"listing_id": 2}))
            .transact()
            .await?,
    );
    let listing = ok(
        "list_item on v3",
        bob_key
            .call(game.id(), "list_item")
            .args_json(json!({"item": "crumbs", "amount": 1, "price_bits": "14"}))
            .transact()
            .await?,
    );
    assert_eq!(listing.json::<Value>()?["id"], 4, "listing ids carry on");
    pass(
        "buy_listing on v3 (listed under v2)",
        bob_key
            .call(game.id(), "buy_listing")
            .args_json(json!({"listing_id": 1}))
            .transact()
            .await?,
    );

    // ---- Investing, with a session key and no deposit ----
    let carol_key = session_key(&carol, &game, &worker).await?;
    // Carol sells crumbs until the crumbs till can't pay for one more: the shop is broke.
    let mut sold = 0;
    loop {
        let quote = view(
            &game,
            "market_quote",
            json!({"item": "crumbs", "amount": 20}),
        )
        .await?;
        if quote["sell"].is_null() {
            break;
        }
        carol_key
            .call(game.id(), "market_sell")
            .args_json(json!({"item": "crumbs", "amount": 20, "min_bits": "0"}))
            .transact()
            .await?
            .into_result()?;
        sold += 20;
    }
    let mut last = None;
    while view(
        &game,
        "market_quote",
        json!({"item": "crumbs", "amount": 1}),
    )
    .await?["sell"]
        .is_string()
        && sold < 400
    {
        last = Some(
            carol_key
                .call(game.id(), "market_sell")
                .args_json(json!({"item": "crumbs", "amount": 1, "min_bits": "0"}))
                .transact()
                .await?,
        );
        sold += 1;
    }
    let shops = view(&game, "market_shops", json!({})).await?;
    println!("crumbs shop after {sold} sold: {}", shops[0]);
    assert_eq!(shops[0]["closed"], json!(["broke"]));
    assert_eq!(shops[0]["buying"], false);
    assert_eq!(shops[1]["closed"], json!([]));
    let logs = last
        .expect("the till ran dry on a single sale")
        .logs()
        .join("\n");
    assert!(
        logs.contains(r#""event":"market_shop""#)
            && logs.contains(r#""closed":["broke"],"cause":"sell""#),
        "{logs}"
    );
    let nope = carol_key
        .call(game.id(), "market_sell")
        .args_json(json!({"item": "crumbs", "amount": 1, "min_bits": "0"}))
        .transact()
        .await?;
    assert!(refused(nope).contains("The vendor's till holds only"));

    // Alice invests through her session key: the shop reopens and no price moves.
    let price = view(
        &game,
        "market_quote",
        json!({"item": "crumbs", "amount": 5}),
    )
    .await?;
    let invest = ok(
        "market_invest",
        alice_key
            .call(game.id(), "market_invest")
            .args_json(json!({"item": "crumbs", "bits": "300"}))
            .transact()
            .await?,
    );
    let logs = invest.logs().join("\n");
    assert!(logs.contains(r#""memo":"invest""#) && logs.contains(r#""event":"market_invest""#));
    assert!(logs.contains(r#""closed":[],"cause":"invest""#), "{logs}");
    let receipt: Value = invest.json()?;
    assert_eq!(
        (receipt["bits"].as_str(), receipt["stake"].as_str()),
        (Some("300"), Some("300"))
    );
    let now = view(
        &game,
        "market_quote",
        json!({"item": "crumbs", "amount": 5}),
    )
    .await?;
    for k in ["price_milli", "buy", "floor", "ceiling"] {
        assert_eq!(now[k], price[k], "investing moved {k}");
    }
    assert!(
        price["sell"].is_null() && now["sell"].is_string(),
        "the till can pay again"
    );
    let shops = view(&game, "market_shops", json!({})).await?;
    assert_eq!(shops[0]["closed"], json!([]));
    assert_eq!(shops[0]["invested"], "300");

    // A deposit is refused, as on every market method.
    let paid = alice
        .call(game.id(), "market_invest")
        .args_json(json!({"item": "crumbs", "bits": "10"}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(paid.is_failure());

    // Trades pay the investor half the fee; the stake is locked for an hour.
    for _ in 0..2 {
        pass(
            "market_sell with an investor",
            carol_key
                .call(game.id(), "market_sell")
                .args_json(json!({"item": "crumbs", "amount": 20, "min_bits": "0"}))
                .transact()
                .await?,
        );
        pass(
            "market_buy with an investor",
            bob_key
                .call(game.id(), "market_buy")
                .args_json(json!({"item": "crumbs", "amount": 20, "max_bits": "500"}))
                .transact()
                .await?,
        );
    }
    let investor = view(&game, "market_investor", json!({"account_id": alice.id()})).await?;
    println!("alice as an investor: {investor}");
    let earned: u128 = investor["stakes"][0]["earned"].as_str().unwrap().parse()?;
    assert!(earned > 0);
    assert_eq!(investor["stakes"][0]["withdrawable"], "0");
    let early = alice_key
        .call(game.id(), "market_withdraw")
        .args_json(json!({"item": "crumbs", "bits": "300"}))
        .transact()
        .await?;
    assert!(refused(early).contains("Your stake unlocks in about"));
    let bits_before: u128 = view(&game, "bits_of", json!({"account_id": alice.id()}))
        .await?
        .as_str()
        .unwrap()
        .parse()?;
    pass(
        "market_claim",
        alice_key
            .call(game.id(), "market_claim")
            .args_json(json!({"item": "crumbs"}))
            .transact()
            .await?,
    );

    // The stolen-key case on a real runtime: the key can stake, but it can't send Bits or
    // the stake anywhere, and the stake comes back to its owner.
    let steal = alice_key
        .call(game.id(), "mt_transfer")
        .args_json(json!({"receiver_id": carol.id(), "token_id": "item:bits", "amount": "1"}))
        .transact()
        .await?;
    assert!(steal.is_failure());
    // The owner shortens the lock (v3 rules; the pools aren't touched) and alice withdraws.
    let mut rules = state["params"].clone();
    rules["invest_lock_ms"] = json!(0);
    pass(
        "set_market_params (v3 rules)",
        owner
            .call(game.id(), "set_market_params")
            .args_json(json!({"params": rules, "pools": []}))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?,
    );
    let out = ok(
        "market_withdraw",
        alice_key
            .call(game.id(), "market_withdraw")
            .args_json(json!({"item": "crumbs", "bits": "300"}))
            .transact()
            .await?,
    );
    let out: Value = out.json()?;
    assert_eq!(out["stake"], "0");
    let bits_after: u128 = view(&game, "bits_of", json!({"account_id": alice.id()}))
        .await?
        .as_str()
        .unwrap()
        .parse()?;
    assert_eq!(
        bits_after,
        bits_before + earned + 300 + out["earned"].as_str().unwrap().parse::<u128>()?
    );

    // ---- Owner metadata table, owner events ----
    let set = ok(
        "set_token_metadata(2 rows)",
        owner
            .call(game.id(), "set_token_metadata")
            .args_json(json!({"name": null, "base_uri": null, "entries": [
                ["item:crumbs", {"title": "Crumbs", "description": "Left behind by Sandwich Man. Always."}],
                ["bits", {"media": "bits.png", "media_hash": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="}]
            ]}))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?,
    );
    assert!(set.logs().join("\n").contains(r#""event":"admin""#));
    let m = view(
        &game,
        "mt_metadata_token_by_token_id",
        json!({"token_ids": ["item:crumbs", "item:bits"]}),
    )
    .await?;
    assert_eq!(m[0]["description"], "Left behind by Sandwich Man. Always.");
    assert_eq!(
        m[1]["media_hash"],
        "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    );

    // ---- Upgrading again (v3 → v3) changes nothing ----
    let before_again = snapshot(&game, &people).await?;
    let stakes = view(&game, "market_shops", json!({})).await?;
    let again = ok(
        "upgrade v3 -> v3 (migrate again)",
        owner
            .call(game.id(), "upgrade")
            .args(v3.clone())
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?,
    );
    assert!(again.failures().is_empty());
    assert_eq!(snapshot(&game, &people).await?, before_again);
    assert_eq!(view(&game, "market_shops", json!({})).await?, stakes);
    assert_eq!(view(&game, "mt_tokens_count", json!({})).await?, "12");

    // ---- A rollback to the v2 wasm is refused whole: v3 stays, nothing is lost ----
    let back = owner
        .call(game.id(), "upgrade")
        .args(v2.clone())
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    println!(
        "rollback to the v2 wasm: {}",
        if back.is_success() {
            "went through"
        } else {
            "refused"
        }
    );
    assert!(refused(back).contains("no known layout"));
    assert_eq!(view(&game, "get_version", json!({})).await?["state"], 3);
    assert_eq!(snapshot(&game, &people).await?, before_again);

    let storage = view(&game, "get_storage", json!({})).await?;
    println!("storage: {storage}");
    Ok(())
}
