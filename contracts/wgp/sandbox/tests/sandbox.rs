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
        .args_json(json!({"batch": [{"account_id": alice.id(), "nonce": 1, "items": [{"item": "sybil-goo", "amount": 4}], "level": 2, "digest": DIGEST}]}))
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
