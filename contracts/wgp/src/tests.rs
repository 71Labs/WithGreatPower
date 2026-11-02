//! Unit tests: heroes, rewards, crafting, the 1-yocto rule, soulbound tokens, operator
//! auth, seasons, pause, NEP-245 transfers and the exact event JSON.

use near_sdk::json_types::U128;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, Gas, NearToken, PromiseResult};

use crate::{Ingredient, RewardMint, RewardStatus, SuitRule, Token, Wgp, MAX_KINDS};

const DIGEST: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const ROOT: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn owner() -> AccountId {
    "wgp.testnet".parse().unwrap()
}
fn operator() -> AccountId {
    "operator.wgp.testnet".parse().unwrap()
}
fn alice() -> AccountId {
    "alice.wgp.testnet".parse().unwrap()
}
fn bob() -> AccountId {
    "bob.wgp.testnet".parse().unwrap()
}
fn contract() -> AccountId {
    "game.wgp.testnet".parse().unwrap()
}

fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300));
    b
}

fn as_(predecessor: AccountId, deposit: u128) {
    testing_env!(ctx(predecessor, deposit).build());
}

fn ing(item: &str, amount: u32) -> Ingredient {
    Ingredient {
        item: item.into(),
        amount,
    }
}

fn suit(id: &str, starter: bool, min_level: u32, recipe: Vec<Ingredient>) -> SuitRule {
    SuitRule {
        id: id.into(),
        starter,
        min_level,
        recipe,
    }
}

/// The items and suits from game-core's `ITEMS` and `SUITS`.
fn rules() -> (Vec<String>, Vec<SuitRule>) {
    let items = [
        "fee-bomb",
        "goblin-glider",
        "crumbs",
        "sesame-seed",
        "chain-link",
        "spare-arm",
        "sybil-goo",
        "press-pass",
    ]
    .map(String::from)
    .to_vec();
    let suits = vec![
        suit("classic", true, 1, vec![]),
        suit("midnight", true, 1, vec![]),
        suit("mint", true, 1, vec![]),
        suit("snow", true, 1, vec![]),
        suit("stealth", false, 2, vec![ing("sybil-goo", 3)]),
        suit(
            "glider",
            false,
            2,
            vec![ing("goblin-glider", 1), ing("fee-bomb", 2)],
        ),
        suit(
            "octo",
            false,
            3,
            vec![ing("spare-arm", 1), ing("chain-link", 3)],
        ),
        suit(
            "sesame",
            false,
            2,
            vec![ing("crumbs", 4), ing("sesame-seed", 1)],
        ),
    ];
    (items, suits)
}

fn setup() -> Wgp {
    // testing_env! carries storage forward; each contract here starts empty.
    near_sdk::mock::with_mocked_blockchain(|b| {
        b.take_storage();
    });
    as_(owner(), 0);
    let (items, suits) = rules();
    Wgp::new(owner(), vec![operator()], items, suits, 2)
}

fn with_hero(c: &mut Wgp, who: AccountId) {
    as_(who, 0);
    c.register_hero("Peter".into(), "classic".into());
}

fn reward(who: AccountId, nonce: u64, items: Vec<Ingredient>, level: Option<u32>) -> RewardMint {
    RewardMint {
        account_id: who,
        nonce,
        items,
        level,
        badges: vec![],
        digest: DIGEST.into(),
    }
}

fn mint(c: &mut Wgp, r: RewardMint) -> RewardStatus {
    as_(operator(), 0);
    c.mint_rewards(vec![r]).remove(0)
}

fn bal(c: &Wgp, who: AccountId, token: &str) -> u128 {
    c.mt_balance_of(who, token.into()).0
}

/// A contract call to try, for tables of cases that must all panic.
type Call = Box<dyn Fn(&mut Wgp)>;

fn events() -> Vec<String> {
    get_logs()
        .into_iter()
        .filter(|l| l.starts_with("EVENT_JSON:"))
        .collect()
}

// ---------- Heroes ----------

#[test]
fn register_hero_mints_the_hero_and_starter_suit() {
    let mut c = setup();
    as_(alice(), 0);
    let hero = c.register_hero("  Peter  ".into(), "midnight".into());
    assert_eq!(hero.name, "Peter");
    assert_eq!(hero.suit, "midnight");
    assert_eq!(bal(&c, alice(), "hero:alice.wgp.testnet"), 1);
    assert_eq!(bal(&c, alice(), "suit:midnight"), 1);
    assert_eq!(c.mt_supply("hero:alice.wgp.testnet".into()), Some(U128(1)));
    assert_eq!(c.mt_supply("hero:bob.wgp.testnet".into()), None);
    assert_eq!(c.get_player(alice()).unwrap().level, 1);
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[{"owner_id":"alice.wgp.testnet","token_ids":["hero:alice.wgp.testnet","suit:midnight"],"amounts":["1","1"]}]}"#,
            r#"EVENT_JSON:{"standard":"wgp","version":"1.0.0","event":"register_hero","data":[{"account_id":"alice.wgp.testnet","name":"Peter","suit":"midnight"}]}"#,
        ]
    );
}

#[test]
#[should_panic(expected = "already has a hero")]
fn one_hero_per_account() {
    let mut c = setup();
    with_hero(&mut c, alice());
    as_(alice(), 0);
    c.register_hero("Again".into(), "mint".into());
}

#[test]
#[should_panic(expected = "Pick a starter suit")]
fn heroes_start_in_a_starter_suit() {
    let mut c = setup();
    as_(alice(), 0);
    c.register_hero("Peter".into(), "octo".into());
}

#[test]
#[should_panic(expected = "Unknown suit")]
fn unknown_suits_are_rejected() {
    let mut c = setup();
    as_(alice(), 0);
    c.register_hero("Peter".into(), "spandex".into());
}

#[test]
fn hero_names_are_checked() {
    for bad in [
        "",
        "   ",
        "a name that is far too long for a hero",
        "tab\tname",
    ] {
        let mut c = setup();
        as_(alice(), 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.register_hero(bad.into(), "classic".into());
        }));
        assert!(r.is_err(), "{bad:?} should be rejected");
    }
}

#[test]
fn a_hero_costs_little_storage() {
    let mut c = setup();
    c.players.flush();
    let before = near_sdk::env::storage_usage();
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(
            alice(),
            1,
            vec![ing("sybil-goo", 3), ing("crumbs", 2)],
            Some(2),
        ),
    );
    c.players.flush();
    c.supply.flush();
    let used = near_sdk::env::storage_usage() - before;
    println!("HERO_PLUS_REWARD_STORAGE_BYTES={used}");
    // Architecture budget: about 1 KB per player.
    assert!(used < 1024, "used {used} bytes");
}

// ---------- Rewards ----------

#[test]
fn rewards_apply_once_per_nonce() {
    let mut c = setup();
    with_hero(&mut c, alice());
    let r1 = reward(alice(), 1, vec![ing("sybil-goo", 2)], Some(2));
    assert_eq!(mint(&mut c, r1.clone()), RewardStatus::Applied);
    // The outbox retries the same batch: nothing is minted twice.
    assert_eq!(mint(&mut c, r1), RewardStatus::Duplicate);
    assert_eq!(bal(&c, alice(), "item:sybil-goo"), 2);
    // A gap (nonce 3 before 2) waits.
    assert_eq!(
        mint(&mut c, reward(alice(), 3, vec![ing("sybil-goo", 1)], None)),
        RewardStatus::OutOfOrder
    );
    assert_eq!(bal(&c, alice(), "item:sybil-goo"), 2);
    assert_eq!(
        mint(&mut c, reward(alice(), 2, vec![ing("sybil-goo", 1)], None)),
        RewardStatus::Applied
    );
    assert_eq!(
        mint(&mut c, reward(alice(), 3, vec![ing("sybil-goo", 1)], None)),
        RewardStatus::Applied
    );
    assert_eq!(bal(&c, alice(), "item:sybil-goo"), 4);
    assert_eq!(c.reward_nonce(alice()), 3);
    assert_eq!(c.mt_supply("item:sybil-goo".into()), Some(U128(4)));
}

#[test]
fn a_batch_reports_each_entry() {
    let mut c = setup();
    as_(operator(), 0);
    let statuses = c.mint_rewards(vec![
        reward(alice(), 1, vec![ing("crumbs", 1)], None),
        reward(alice(), 1, vec![ing("crumbs", 1)], None),
        reward(bob(), 2, vec![ing("crumbs", 1)], None),
        reward(alice(), 2, vec![], Some(3)),
    ]);
    assert_eq!(
        statuses,
        vec![
            RewardStatus::Applied,
            RewardStatus::Duplicate,
            RewardStatus::OutOfOrder,
            RewardStatus::Applied
        ]
    );
    assert_eq!(bal(&c, alice(), "item:crumbs"), 1);
    assert_eq!(bal(&c, bob(), "item:crumbs"), 0);
    assert_eq!(c.get_player(alice()).unwrap().level, 3);
}

#[test]
fn the_digest_is_logged_not_stored() {
    let mut c = setup();
    with_hero(&mut c, alice());
    let mut r = reward(alice(), 1, vec![ing("fee-bomb", 2)], Some(2));
    r.digest = "ab".repeat(32);
    mint(&mut c, r);
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[{"owner_id":"alice.wgp.testnet","token_ids":["item:fee-bomb"],"amounts":["2"],"memo":"reward:1"}]}"#.to_string(),
            format!(r#"EVENT_JSON:{{"standard":"wgp","version":"1.0.0","event":"reward","data":[{{"account_id":"alice.wgp.testnet","nonce":1,"level":2,"digest":"{}"}}]}}"#, "ab".repeat(32)),
        ]
    );
    // Nothing in state holds it.
    let raw: Vec<u8> = near_sdk::borsh::to_vec(&c.players.get(&alice()).unwrap().clone()).unwrap();
    assert!(
        !raw.windows(2).any(|w| w == [0xab, 0xab])
            && !String::from_utf8_lossy(&raw).contains("abab")
    );
}

#[test]
fn levels_never_go_down() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(&mut c, reward(alice(), 1, vec![], Some(4)));
    mint(&mut c, reward(alice(), 2, vec![], Some(2)));
    assert_eq!(c.get_player(alice()).unwrap().level, 4);
}

#[test]
fn badges_are_minted_once() {
    let mut c = setup();
    let mut r = reward(alice(), 1, vec![], None);
    r.badges = vec!["day-one".into()];
    mint(&mut c, r.clone());
    r.nonce = 2;
    mint(&mut c, r);
    assert_eq!(bal(&c, alice(), "trophy:badge:day-one"), 1);
}

#[test]
#[should_panic(expected = "Only an operator")]
fn only_operators_mint() {
    let mut c = setup();
    as_(alice(), 0);
    c.mint_rewards(vec![reward(alice(), 1, vec![ing("crumbs", 99)], None)]);
}

#[test]
fn malformed_batches_apply_nothing() {
    let cases: Vec<Box<dyn Fn() -> Vec<RewardMint>>> = vec![
        Box::new(Vec::new),
        Box::new(|| {
            vec![
                reward(alice(), 1, vec![ing("crumbs", 1)], None),
                reward(bob(), 1, vec![ing("gold", 1)], None),
            ]
        }),
        Box::new(|| vec![reward(alice(), 1, vec![ing("crumbs", 0)], None)]),
        Box::new(|| vec![reward(alice(), 0, vec![ing("crumbs", 1)], None)]),
        Box::new(|| {
            let mut r = reward(alice(), 1, vec![ing("crumbs", 1)], None);
            r.digest = "not-hex".into();
            vec![r]
        }),
        Box::new(|| (1..=21).map(|n| reward(alice(), n, vec![], None)).collect()),
    ];
    for batch in cases {
        let mut c = setup();
        as_(operator(), 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.mint_rewards(batch())));
        assert!(r.is_err());
        assert_eq!(bal(&c, alice(), "item:crumbs"), 0);
        assert_eq!(c.reward_nonce(alice()), 0);
    }
}

#[test]
fn a_full_account_waits() {
    let mut c = setup();
    as_(owner(), 1);
    let items: Vec<String> = (0..32).map(|i| format!("i{i}")).collect();
    c.set_rules(items.clone(), vec![suit("classic", true, 1, vec![])], 2);
    let mut nonce = 0;
    for chunk in items.chunks(8) {
        nonce += 1;
        mint(
            &mut c,
            reward(
                alice(),
                nonce,
                chunk.iter().map(|i| ing(i, 1)).collect(),
                None,
            ),
        );
    }
    // 32 kinds held. Fill to 64 with badges (2 per reward).
    for n in 0..16 {
        nonce += 1;
        let mut r = reward(alice(), nonce, vec![], None);
        r.badges = (0..2).map(|b| format!("b{n}-{b}")).collect();
        assert_eq!(mint(&mut c, r), RewardStatus::Applied);
    }
    assert_eq!(c.get_player(alice()).unwrap().tokens.len(), MAX_KINDS);
    let mut r = reward(alice(), nonce + 1, vec![], None);
    r.badges = vec!["one-more".into()];
    assert_eq!(mint(&mut c, r), RewardStatus::Full);
    // More of a kind already held still fits.
    assert_eq!(
        mint(&mut c, reward(alice(), nonce + 1, vec![ing("i0", 5)], None)),
        RewardStatus::Applied
    );
}

#[test]
fn a_full_batch_fits_the_log_limit() {
    let mut c = setup();
    let (items, _) = rules();
    let batch: Vec<RewardMint> = (0..crate::MAX_REWARD_BATCH)
        .map(|i| {
            // The longest account ids NEAR allows: 64 characters.
            let account: AccountId = format!("{i:0>2}{}.wgp.testnet", "x".repeat(50))
                .parse()
                .unwrap();
            assert_eq!(account.len(), 64);
            let mut r = reward(
                account,
                1,
                items.iter().map(|it| ing(it, 1000)).collect(),
                Some(1000),
            );
            r.badges = vec!["a".repeat(32), "b".repeat(32)];
            r
        })
        .collect();
    as_(operator(), 0);
    let statuses = c.mint_rewards(batch);
    assert!(statuses.iter().all(|s| *s == RewardStatus::Applied));
    let total: usize = get_logs().iter().map(String::len).sum();
    println!("WORST_CASE_BATCH_LOG_BYTES={total}");
    assert!(total < 16 * 1024, "{total} bytes of logs");
}

// ---------- Crafting ----------

#[test]
#[should_panic(expected = "Reach level 2")]
fn crafting_checks_the_level() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(&mut c, reward(alice(), 1, vec![ing("sybil-goo", 3)], None));
    as_(alice(), 0);
    c.craft_suit("stealth".into());
}

#[test]
#[should_panic(expected = "Needs goblin-glider x1, fee-bomb x1")]
fn crafting_checks_the_recipe() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(alice(), 1, vec![ing("fee-bomb", 1)], Some(2)),
    );
    as_(alice(), 0);
    c.craft_suit("glider".into());
}

#[test]
fn crafting_burns_the_recipe_and_equips_the_suit() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(
            alice(),
            1,
            vec![ing("goblin-glider", 1), ing("fee-bomb", 3)],
            Some(2),
        ),
    );
    as_(alice(), 0);
    c.craft_suit("glider".into());
    assert_eq!(bal(&c, alice(), "suit:glider"), 1);
    assert_eq!(bal(&c, alice(), "item:goblin-glider"), 0);
    assert_eq!(bal(&c, alice(), "item:fee-bomb"), 1);
    assert_eq!(c.mt_supply("item:goblin-glider".into()), None);
    assert_eq!(c.mt_supply("item:fee-bomb".into()), Some(U128(1)));
    assert_eq!(c.get_player(alice()).unwrap().hero.unwrap().suit, "glider");
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_burn","data":[{"owner_id":"alice.wgp.testnet","token_ids":["item:goblin-glider","item:fee-bomb"],"amounts":["1","2"],"memo":"craft:glider"}]}"#,
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[{"owner_id":"alice.wgp.testnet","token_ids":["suit:glider"],"amounts":["1"],"memo":"craft:glider"}]}"#,
            r#"EVENT_JSON:{"standard":"wgp","version":"1.0.0","event":"craft_suit","data":[{"account_id":"alice.wgp.testnet","suit":"glider"}]}"#,
        ]
    );
}

#[test]
#[should_panic(expected = "already own this suit")]
fn a_suit_is_crafted_once() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(alice(), 1, vec![ing("sybil-goo", 6)], Some(2)),
    );
    as_(alice(), 0);
    c.craft_suit("stealth".into());
    as_(alice(), 0);
    c.craft_suit("stealth".into());
}

#[test]
fn other_starter_suits_unlock_at_the_starter_level() {
    let mut c = setup();
    with_hero(&mut c, alice());
    as_(alice(), 0);
    let early =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.craft_suit("snow".into())));
    assert!(early.is_err());
    mint(&mut c, reward(alice(), 1, vec![], Some(2)));
    as_(alice(), 0);
    c.craft_suit("snow".into());
    assert_eq!(bal(&c, alice(), "suit:snow"), 1);
}

#[test]
#[should_panic(expected = "Register a hero first")]
fn crafting_needs_a_hero() {
    let mut c = setup();
    mint(
        &mut c,
        reward(alice(), 1, vec![ing("sybil-goo", 3)], Some(2)),
    );
    as_(alice(), 0);
    c.craft_suit("stealth".into());
}

#[test]
fn equipping_needs_the_suit() {
    let mut c = setup();
    with_hero(&mut c, alice());
    as_(alice(), 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.equip_suit("midnight".into())
    }));
    assert!(r.is_err());
    mint(&mut c, reward(alice(), 1, vec![], Some(2)));
    as_(alice(), 0);
    c.craft_suit("midnight".into());
    as_(alice(), 0);
    c.equip_suit("classic".into());
    assert_eq!(c.get_player(alice()).unwrap().hero.unwrap().suit, "classic");
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"wgp","version":"1.0.0","event":"equip_suit","data":[{"account_id":"alice.wgp.testnet","suit":"classic"}]}"#
        ]
    );
}

// ---------- Transfers ----------

fn alice_with_crumbs(c: &mut Wgp, n: u32) {
    with_hero(c, alice());
    mint(c, reward(alice(), 1, vec![ing("crumbs", n)], Some(2)));
}

#[test]
fn transfers_need_exactly_one_yocto() {
    for deposit in [0u128, 2, 1_000_000] {
        let mut c = setup();
        alice_with_crumbs(&mut c, 4);
        as_(alice(), deposit);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.mt_transfer(bob(), "item:crumbs".into(), U128(1), None, None)
        }));
        assert!(r.is_err(), "deposit {deposit} must be refused");
    }
    let mut c = setup();
    alice_with_crumbs(&mut c, 4);
    as_(alice(), 1);
    c.mt_transfer(
        bob(),
        "item:crumbs".into(),
        U128(3),
        None,
        Some("gift".into()),
    );
    assert_eq!(bal(&c, alice(), "item:crumbs"), 1);
    assert_eq!(bal(&c, bob(), "item:crumbs"), 3);
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_transfer","data":[{"old_owner_id":"alice.wgp.testnet","new_owner_id":"bob.wgp.testnet","token_ids":["item:crumbs"],"amounts":["3"],"memo":"gift"}]}"#
        ]
    );
}

#[test]
fn every_transfer_method_needs_one_yocto() {
    let calls: Vec<Call> = vec![
        Box::new(|c| {
            c.mt_batch_transfer(bob(), vec!["item:crumbs".into()], vec![U128(1)], None, None)
        }),
        Box::new(|c| {
            let _ = c.mt_transfer_call(bob(), "item:crumbs".into(), U128(1), None, None, "".into());
        }),
        Box::new(|c| {
            let _ = c.mt_batch_transfer_call(
                bob(),
                vec!["item:crumbs".into()],
                vec![U128(1)],
                None,
                None,
                "".into(),
            );
        }),
    ];
    for call in calls {
        let mut c = setup();
        alice_with_crumbs(&mut c, 4);
        as_(alice(), 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| call(&mut c)));
        assert!(r.is_err());
        assert_eq!(bal(&c, alice(), "item:crumbs"), 4);
    }
}

#[test]
fn heroes_and_trophies_are_soulbound() {
    let mut c = setup();
    with_hero(&mut c, alice());
    as_(operator(), 0);
    c.record_season("s1".into(), ROOT.into(), vec![alice()], DIGEST.into());
    let mut badge = reward(alice(), 1, vec![], None);
    badge.badges = vec!["day-one".into()];
    mint(&mut c, badge);
    for token in [
        "hero:alice.wgp.testnet",
        "trophy:s1:1",
        "trophy:badge:day-one",
    ] {
        as_(alice(), 1);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.mt_transfer(bob(), token.into(), U128(1), None, None)
        }));
        assert!(r.is_err(), "{token} moved");
        assert_eq!(bal(&c, alice(), token), 1);
    }
}

#[test]
#[should_panic(expected = "Equip another suit")]
fn the_equipped_suit_stays() {
    let mut c = setup();
    with_hero(&mut c, alice());
    as_(alice(), 1);
    c.mt_transfer(bob(), "suit:classic".into(), U128(1), None, None);
}

#[test]
fn an_unequipped_suit_can_be_traded() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(alice(), 1, vec![ing("sybil-goo", 3)], Some(2)),
    );
    as_(alice(), 0);
    c.craft_suit("stealth".into());
    as_(alice(), 1);
    c.mt_transfer(bob(), "suit:classic".into(), U128(1), None, None);
    assert_eq!(bal(&c, bob(), "suit:classic"), 1);
}

#[test]
#[should_panic(expected = "Approvals are not supported")]
fn approvals_are_refused() {
    let mut c = setup();
    alice_with_crumbs(&mut c, 4);
    as_(alice(), 1);
    c.mt_transfer(bob(), "item:crumbs".into(), U128(1), Some((bob(), 1)), None);
}

#[test]
#[should_panic(expected = "Not enough item:crumbs")]
fn you_cannot_send_what_you_do_not_have() {
    let mut c = setup();
    alice_with_crumbs(&mut c, 1);
    as_(alice(), 1);
    c.mt_transfer(bob(), "item:crumbs".into(), U128(2), None, None);
}

fn resolve(c: &mut Wgp, result: PromiseResult, amounts: Vec<u128>) -> Vec<U128> {
    testing_env!(
        ctx(contract(), 0).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    let n = amounts.len();
    c.mt_resolve_transfer(
        vec![alice(); n],
        bob(),
        vec!["item:crumbs".into(); n],
        amounts.into_iter().map(U128).collect(),
        None,
    )
}

#[test]
fn transfer_call_refunds_what_the_receiver_returns() {
    let mut c = setup();
    alice_with_crumbs(&mut c, 5);
    as_(alice(), 1);
    let _ = c.mt_transfer_call(
        bob(),
        "item:crumbs".into(),
        U128(4),
        None,
        None,
        "deposit".into(),
    );
    assert_eq!(bal(&c, bob(), "item:crumbs"), 4);
    // The receiver keeps 3 and returns 1.
    let used = resolve(
        &mut c,
        PromiseResult::Successful(br#"["1"]"#.to_vec()),
        vec![4],
    );
    assert_eq!(used, vec![U128(3)]);
    assert_eq!(bal(&c, alice(), "item:crumbs"), 2);
    assert_eq!(bal(&c, bob(), "item:crumbs"), 3);
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_transfer","data":[{"old_owner_id":"bob.wgp.testnet","new_owner_id":"alice.wgp.testnet","token_ids":["item:crumbs"],"amounts":["1"],"memo":"refund"}]}"#
        ]
    );
}

#[test]
fn a_failed_receiver_refunds_everything() {
    for result in [
        PromiseResult::Failed,
        PromiseResult::Successful(b"garbage".to_vec()),
    ] {
        let mut c = setup();
        alice_with_crumbs(&mut c, 5);
        as_(alice(), 1);
        let _ = c.mt_transfer_call(bob(), "item:crumbs".into(), U128(4), None, None, "".into());
        let used = resolve(&mut c, result, vec![4]);
        assert_eq!(used, vec![U128(0)]);
        assert_eq!(bal(&c, alice(), "item:crumbs"), 5);
        assert_eq!(bal(&c, bob(), "item:crumbs"), 0);
    }
}

#[test]
fn a_refund_never_exceeds_what_was_sent() {
    let mut c = setup();
    alice_with_crumbs(&mut c, 5);
    as_(alice(), 1);
    let _ = c.mt_transfer_call(bob(), "item:crumbs".into(), U128(2), None, None, "".into());
    let used = resolve(
        &mut c,
        PromiseResult::Successful(br#"["999"]"#.to_vec()),
        vec![2],
    );
    assert_eq!(used, vec![U128(0)]);
    assert_eq!(bal(&c, alice(), "item:crumbs"), 5);
}

#[test]
fn transfer_call_schedules_the_receiver_then_the_resolver() {
    let mut c = setup();
    alice_with_crumbs(&mut c, 5);
    as_(alice(), 1);
    let _ = c.mt_transfer_call(
        bob(),
        "item:crumbs".into(),
        U128(1),
        None,
        None,
        "hi".into(),
    );
    let receipts = near_sdk::test_utils::get_created_receipts();
    let methods: Vec<String> = receipts
        .iter()
        .flat_map(|r| r.actions.iter())
        .filter_map(|a| match a {
            near_sdk::mock::MockAction::FunctionCallWeight { method_name, .. } => {
                Some(String::from_utf8(method_name.clone()).unwrap())
            }
            _ => None,
        })
        .collect();
    assert_eq!(methods, vec!["mt_on_transfer", "mt_resolve_transfer"]);
}

// ---------- Views ----------

#[test]
fn token_views() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(&mut c, reward(alice(), 1, vec![ing("crumbs", 2)], Some(2)));
    as_(operator(), 0);
    c.record_season(
        "s1".into(),
        ROOT.into(),
        vec![bob(), alice()],
        DIGEST.into(),
    );

    assert_eq!(
        c.mt_token(vec![
            "hero:alice.wgp.testnet".into(),
            "trophy:s1:2".into(),
            "item:crumbs".into(),
            "item:gold".into()
        ]),
        vec![
            Some(Token {
                token_id: "hero:alice.wgp.testnet".into(),
                owner_id: Some(alice())
            }),
            Some(Token {
                token_id: "trophy:s1:2".into(),
                owner_id: Some(alice())
            }),
            Some(Token {
                token_id: "item:crumbs".into(),
                owner_id: None
            }),
            None,
        ]
    );
    assert_eq!(
        c.mt_batch_balance_of(
            alice(),
            vec![
                "suit:classic".into(),
                "item:crumbs".into(),
                "hero:bob.wgp.testnet".into()
            ]
        ),
        vec![U128(1), U128(2), U128(0)]
    );
    let ids: Vec<String> = c
        .mt_tokens_for_owner(alice(), None, None)
        .into_iter()
        .map(|t| t.token_id)
        .collect();
    assert_eq!(
        ids,
        vec![
            "hero:alice.wgp.testnet",
            "suit:classic",
            "item:crumbs",
            "trophy:s1:2"
        ]
    );
    assert_eq!(
        c.mt_tokens_for_owner(alice(), Some(U128(1)), Some(2)).len(),
        2
    );
    assert_eq!(
        c.mt_batch_supply(vec!["trophy:s1:1".into(), "trophy:s1:3".into()]),
        vec![Some(U128(1)), None]
    );
}

// ---------- Seasons ----------

#[test]
fn a_season_is_recorded_once_with_trophies() {
    let mut c = setup();
    as_(operator(), 0);
    c.record_season(
        "s1".into(),
        ROOT.into(),
        vec![alice(), bob()],
        DIGEST.into(),
    );
    assert_eq!(bal(&c, alice(), "trophy:s1:1"), 1);
    assert_eq!(bal(&c, bob(), "trophy:s1:2"), 1);
    let s = c.get_season("s1".into()).unwrap();
    assert_eq!(s.root, ROOT);
    assert_eq!(s.top10, vec![alice(), bob()]);
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[{"owner_id":"alice.wgp.testnet","token_ids":["trophy:s1:1"],"amounts":["1"],"memo":"season:s1"},{"owner_id":"bob.wgp.testnet","token_ids":["trophy:s1:2"],"amounts":["1"],"memo":"season:s1"}]}"#.to_string(),
            format!(r#"EVENT_JSON:{{"standard":"wgp","version":"1.0.0","event":"season","data":[{{"season_id":"s1","root":"{ROOT}","digest":"{DIGEST}","top10":["alice.wgp.testnet","bob.wgp.testnet"]}}]}}"#),
        ]
    );
}

#[test]
#[should_panic(expected = "Season s1 is already recorded")]
fn seasons_are_immutable() {
    let mut c = setup();
    as_(operator(), 0);
    c.record_season("s1".into(), ROOT.into(), vec![alice()], DIGEST.into());
    as_(operator(), 0);
    c.record_season("s1".into(), DIGEST.into(), vec![bob()], ROOT.into());
}

#[test]
#[should_panic(expected = "Only an operator")]
fn only_operators_record_seasons() {
    let mut c = setup();
    as_(alice(), 0);
    c.record_season("s1".into(), ROOT.into(), vec![alice()], DIGEST.into());
}

#[test]
fn season_input_is_checked() {
    let bad: Vec<(&str, &str, Vec<AccountId>)> = vec![
        ("S1", ROOT, vec![alice()]),
        ("s1", "abc", vec![alice()]),
        ("s1", ROOT, vec![]),
        ("s1", ROOT, vec![alice(), alice()]),
        (
            "s1",
            ROOT,
            (0..11)
                .map(|i| format!("p{i}.testnet").parse().unwrap())
                .collect(),
        ),
    ];
    for (id, root, top) in bad {
        let mut c = setup();
        as_(operator(), 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.record_season(id.into(), root.into(), top.clone(), DIGEST.into())
        }));
        assert!(r.is_err(), "{id} {root} {top:?}");
        assert!(c.get_season(id.into()).is_none());
    }
}

// ---------- Admin ----------

#[test]
fn pause_stops_play_mints_and_transfers() {
    let mut c = setup();
    alice_with_crumbs(&mut c, 4);
    as_(owner(), 1);
    c.set_paused(true);
    let calls: Vec<(AccountId, u128, Call)> = vec![
        (
            bob(),
            0,
            Box::new(|c| {
                c.register_hero("Bob".into(), "classic".into());
            }),
        ),
        (alice(), 0, Box::new(|c| c.craft_suit("snow".into()))),
        (alice(), 0, Box::new(|c| c.equip_suit("classic".into()))),
        (
            alice(),
            1,
            Box::new(|c| c.mt_transfer(bob(), "item:crumbs".into(), U128(1), None, None)),
        ),
        (
            operator(),
            0,
            Box::new(|c| {
                c.mint_rewards(vec![reward(alice(), 2, vec![], None)]);
            }),
        ),
        (
            operator(),
            0,
            Box::new(|c| c.record_season("s1".into(), ROOT.into(), vec![alice()], DIGEST.into())),
        ),
    ];
    for (who, deposit, call) in calls {
        as_(who, deposit);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| call(&mut c)));
        assert!(r.is_err());
    }
    as_(owner(), 1);
    c.set_paused(false);
    as_(alice(), 1);
    c.mt_transfer(bob(), "item:crumbs".into(), U128(1), None, None);
    assert!(!c.get_config().paused);
}

#[test]
fn admin_needs_the_owner_and_one_yocto() {
    let calls: Vec<(AccountId, u128)> = vec![(alice(), 1), (operator(), 1), (owner(), 0)];
    for (who, deposit) in calls {
        let mut c = setup();
        as_(who.clone(), deposit);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.set_paused(true)));
        assert!(r.is_err(), "{who} with {deposit}");
        as_(who.clone(), deposit);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.add_operator(alice())));
        assert!(r.is_err());
        as_(who, deposit);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = c.upgrade();
        }));
        assert!(r.is_err());
    }
}

#[test]
fn operators_can_be_rotated() {
    let mut c = setup();
    as_(owner(), 1);
    c.add_operator(bob());
    as_(owner(), 1);
    c.remove_operator(operator());
    assert!(c.is_operator(bob()));
    assert!(!c.is_operator(operator()));
    as_(operator(), 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.mint_rewards(vec![reward(alice(), 1, vec![], None)]);
    }));
    assert!(r.is_err());
    as_(bob(), 0);
    assert_eq!(
        c.mint_rewards(vec![reward(alice(), 1, vec![], None)]),
        vec![RewardStatus::Applied]
    );
}

#[test]
fn init_rejects_bad_rules() {
    let (items, suits) = rules();
    let mut bad_recipe = suits.clone();
    bad_recipe[4].recipe = vec![ing("unobtainium", 1)];
    let mut starter_with_recipe = suits.clone();
    starter_with_recipe[0].recipe = vec![ing("crumbs", 1)];
    let mut duplicate = suits.clone();
    duplicate.push(suits[0].clone());
    for s in [bad_recipe, starter_with_recipe, duplicate] {
        as_(owner(), 0);
        let items = items.clone();
        let r = std::panic::catch_unwind(move || Wgp::new(owner(), vec![], items, s, 2));
        assert!(r.is_err());
    }
}
