//! Unit tests for v3: NEP-245 metadata and enumeration, investing in the vendor (prices
//! don't move, round trips and sandwiches gain nothing, other investors and the vendor
//! lose nothing, session-key bounds, a stolen key can't drain), broke shops, the fee
//! split, the crafting cost, owner events, and the v1/v2 → v3 state migration.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, Gas, NearToken};

use crate::invest::invest_room;
use crate::market::*;
use crate::market_tests::*;
use crate::tests::*;
use crate::{RewardMint, TokenMeta, Wgp, LAYOUT_V3};

const HOUR_MS: u64 = 3_600_000;
const ROOT: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn mallory() -> AccountId {
    "mallory.wgp.testnet".parse().unwrap()
}

/// `who` calling with no deposit at `ms` since the epoch.
fn at(who: AccountId, ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract())
        .predecessor_account_id(who)
        .attached_deposit(NearToken::from_yoctonear(0))
        .block_timestamp(ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
}

/// A market whose stakes unlock at once and whose daily caps are out of the way.
fn loose() -> MarketParams {
    MarketParams {
        invest_lock_ms: 0,
        daily_trades: 100_000,
        daily_invests: 100_000,
        daily_invest_bits: U128(1_000_000_000),
        max_invest: U128(1_000_000),
        min_invest: U128(1),
        ..Default::default()
    }
}

fn supply(c: &Wgp) -> u128 {
    c.mt_supply(BITS_TOKEN.into()).map(|n| n.0).unwrap_or(0)
}

fn stake_of(c: &Wgp, who: AccountId, item: &str) -> u128 {
    c.market_investor(who)
        .stakes
        .into_iter()
        .find(|s| s.item == item)
        .map(|s| s.bits.0)
        .unwrap_or(0)
}

fn earned_of(c: &Wgp, who: AccountId, item: &str) -> u128 {
    c.market_investor(who)
        .stakes
        .into_iter()
        .find(|s| s.item == item)
        .map(|s| s.earned.0)
        .unwrap_or(0)
}

fn shop(c: &Wgp, item: &str) -> crate::Shop {
    c.market_shops()
        .into_iter()
        .find(|s| s.item == item)
        .unwrap()
}

/// Mints `n` of `item` to `who`, a reward (at most 1,000) at a time.
fn stock_up(c: &mut Wgp, who: AccountId, item: &str, n: u32) {
    let mut left = n;
    while left > 0 {
        let lot = left.min(1_000);
        fund(c, who.clone(), 0, vec![(item, lot)]);
        left -= lot;
    }
}

/// Buys `item` back from the vendor, 20 at a time, until its till holds `till` Bits.
fn refill(c: &mut Wgp, who: AccountId, item: &str, till: u128, ms: u64) {
    for _ in 0..100 {
        let p = pool(c, item);
        if p.bits.0 >= till {
            return;
        }
        at(who.clone(), ms);
        c.market_buy(item.into(), p.stock.0.min(20) as u32, U128(1_000_000));
    }
    panic!("the till never refilled");
}

/// Sells `item` to the vendor one at a time until its till can't pay for another.
fn drain(c: &mut Wgp, who: AccountId, item: &str) {
    for _ in 0..400 {
        if c.market_quote(item.into(), 1).sell.is_none() {
            return;
        }
        as_(who.clone(), 0);
        c.market_sell(item.into(), 1, U128(0));
    }
    panic!("the till never ran dry");
}

/// Bits exist only where the books say: players, tills and investors' unclaimed earnings.
fn assert_books(c: &Wgp, players: &[AccountId]) {
    let held: u128 = players.iter().map(|a| bal(c, a.clone(), BITS_TOKEN)).sum();
    let pools = c.market_state().pools;
    let tills: u128 = pools.iter().map(|p| p.bits.0 + p.rewards.0).sum();
    assert_eq!(supply(c), held + tills, "Bits supply = players + vendor");
    assert_eq!(bal(c, contract(), BITS_TOKEN), tills);
    for p in &pools {
        let staked: u128 = players
            .iter()
            .map(|a| stake_of(c, a.clone(), &p.item))
            .sum();
        assert_eq!(staked, p.invested.0, "{}: stakes = invested", p.item);
        let owed: u128 = players
            .iter()
            .map(|a| earned_of(c, a.clone(), &p.item))
            .sum();
        assert!(owed <= p.rewards.0, "{}: earnings are covered", p.item);
        assert!(p.bits.0 >= p.invested.0 || p.stock.0 > 0);
        assert!(p.virtual_bits.0 >= 1);
    }
}

// ---------- NEP-245 metadata ----------

#[test]
fn the_contract_names_its_metadata_spec() {
    let c = setup();
    let m = c.mt_metadata_contract();
    assert_eq!(
        serde_json::to_value(&m).unwrap(),
        json!({"spec": "mt-1.0.0", "name": "With Great Power"})
    );
}

/// A game with one of every token kind.
fn one_of_each() -> Wgp {
    let mut c = market();
    with_hero(&mut c, alice());
    as_(operator(), 0);
    c.mint_rewards(vec![RewardMint {
        account_id: alice(),
        nonce: 1,
        items: vec![ing("fee-bomb", 2), ing("bits", 40)],
        level: Some(3),
        badges: vec!["day-one".into()],
        digest: DIGEST.into(),
    }]);
    as_(operator(), 0);
    c.record_season(
        "s1".into(),
        ROOT.into(),
        vec![alice(), bob()],
        DIGEST.into(),
    );
    c
}

#[test]
fn every_token_kind_has_metadata() {
    let c = one_of_each();
    let ids: Vec<String> = [
        "hero:alice.wgp.testnet",
        "suit:classic",
        "suit:octo",
        "item:fee-bomb",
        "item:bits",
        "trophy:badge:day-one",
        "trophy:s1:1",
        "trophy:s1:2",
    ]
    .map(String::from)
    .to_vec();
    let all = c.mt_metadata_token_all(ids.clone());
    let got: Vec<(String, String, String)> = all
        .iter()
        .map(|m| {
            let m = m.as_ref().unwrap();
            (
                m.base.id.clone(),
                m.token.title.clone().unwrap(),
                m.token.media.clone().unwrap(),
            )
        })
        .collect();
    let base = "https://www.wgponnear.fun/tokens";
    let want = [
        ("hero", "Peter", "hero.png"),
        ("suit", "Classic suit", "suit/classic.png"),
        // In the rules, never minted: metadata is there before the first craft.
        ("suit", "Octo suit", "suit/octo.png"),
        ("item", "Fee bomb", "item/fee-bomb.png"),
        ("bits", "Bits", "bits.png"),
        ("badge", "Day one badge", "badge/day-one.png"),
        ("trophy", "Season s1: rank 1", "trophy/1.png"),
        ("trophy", "Season s1: rank 2", "trophy/2.png"),
    ];
    for (g, w) in got.iter().zip(want) {
        assert_eq!(g.0, w.0);
        assert_eq!(g.1, w.1);
        assert_eq!(g.2, format!("{base}/{}", w.2));
    }
    for m in all.iter().flatten() {
        assert!(m.token.description.as_ref().is_some_and(|d| d.len() > 20));
        assert_eq!(m.base.decimals.as_deref(), Some("0"));
        assert_eq!(m.base.base_uri.as_deref(), Some(base));
    }
    let hero = all[0].as_ref().unwrap();
    assert!(hero.token.description.as_ref().unwrap().contains("level 3"));
    assert_eq!(
        hero.token.extra.as_deref(),
        Some(r#"{"kind":"hero","soulbound":true,"level":3,"suit":"classic"}"#)
    );
    assert!(hero.token.issued_at.is_some());

    // The two narrower views agree with the combined one.
    let tokens = c.mt_metadata_token_by_token_id(ids.clone());
    let bases = c.mt_metadata_base_by_token_id(ids);
    for ((a, t), b) in all.iter().zip(&tokens).zip(&bases) {
        assert_eq!(a.as_ref().map(|a| &a.token), t.as_ref());
        assert_eq!(a.as_ref().map(|a| &a.base), b.as_ref());
    }
}

#[test]
fn tokens_that_dont_exist_have_no_metadata() {
    let c = one_of_each();
    let ids: Vec<String> = [
        "hero:bob.wgp.testnet",
        "suit:cape",
        "item:kryptonite",
        "trophy:badge:never",
        "trophy:s1:3",
        "trophy:s1:0",
        "trophy:s9:1",
        "nonsense",
        "",
    ]
    .map(String::from)
    .to_vec();
    assert!(c
        .mt_metadata_token_all(ids.clone())
        .iter()
        .all(Option::is_none));
    assert!(c
        .mt_metadata_token_by_token_id(ids.clone())
        .iter()
        .all(Option::is_none));
    assert!(c
        .mt_metadata_base_by_token_id(ids)
        .iter()
        .all(Option::is_none));
}

#[test]
fn base_metadata_is_one_per_kind() {
    let c = setup();
    let all = c.mt_tokens_base_metadata_all(None, None);
    let ids: Vec<&str> = all.iter().map(|b| b.id.as_str()).collect();
    assert_eq!(ids, ["hero", "suit", "item", "bits", "badge", "trophy"]);
    assert_eq!(all[3].symbol.as_deref(), Some("BITS"));
    let page = c.mt_tokens_base_metadata_all(Some(U128(4)), Some(5));
    assert_eq!(page.len(), 2);
    assert!(c
        .mt_tokens_base_metadata_all(Some(U128(99)), None)
        .is_empty());
    // Both names of the lookup by base id.
    let ask = vec!["bits".to_string(), "cape".to_string()];
    let a = c.mt_metadata_base_by_metadata_id(ask.clone());
    assert_eq!(a, c.mt_metadata_base_by_metadata_base_id(ask));
    assert_eq!(a[0].as_ref().unwrap().name, "Bits");
    assert!(a[1].is_none());
}

#[test]
fn the_owner_table_overrides_the_defaults() {
    let mut c = one_of_each();
    as_(owner(), 1);
    c.set_token_metadata(
        Some("WGP".into()),
        Some("https://cdn.example/t".into()),
        vec![
            (
                "item:fee-bomb".into(),
                Some(TokenMeta {
                    title: Some("Fee bomb".into()),
                    description: Some("Defused. Mostly.".into()),
                    media: None,
                    media_hash: None,
                }),
            ),
            (
                "badge".into(),
                Some(TokenMeta {
                    media: Some("https://img.example/badge.png".into()),
                    media_hash: Some("aGFzaA==".into()),
                    ..Default::default()
                }),
            ),
        ],
    );
    assert!(events()
        .last()
        .unwrap()
        .contains(r#""action":"set_token_metadata""#));
    assert_eq!(c.mt_metadata_contract().name, "WGP");
    let m = c.mt_metadata_token_by_token_id(vec![
        "item:fee-bomb".into(),
        "trophy:badge:day-one".into(),
        "item:bits".into(),
    ]);
    let bomb = m[0].as_ref().unwrap();
    assert_eq!(bomb.description.as_deref(), Some("Defused. Mostly."));
    assert_eq!(
        bomb.media.as_deref(),
        Some("https://cdn.example/t/item/fee-bomb.png")
    );
    // A row for a whole kind, with an absolute URL and its hash.
    let badge = m[1].as_ref().unwrap();
    assert_eq!(badge.title.as_deref(), Some("Day one badge"));
    assert_eq!(
        badge.media.as_deref(),
        Some("https://img.example/badge.png")
    );
    assert_eq!(badge.media_hash.as_deref(), Some("aGFzaA=="));
    assert_eq!(
        m[2].as_ref().unwrap().media.as_deref(),
        Some("https://cdn.example/t/bits.png")
    );
    assert!(c.get_token_metadata_row("badge".into()).is_some());

    // Null removes a row.
    as_(owner(), 1);
    c.set_token_metadata(None, None, vec![("badge".into(), None)]);
    assert!(c.get_token_metadata_row("badge".into()).is_none());
    assert_eq!(c.mt_metadata_contract().name, "WGP");
}

#[test]
fn the_metadata_table_is_guarded() {
    let row = || {
        Some(TokenMeta {
            title: Some("T".into()),
            ..Default::default()
        })
    };
    let mut c = setup();
    as_(alice(), 1);
    assert!(panics(|| c.set_token_metadata(None, None, vec![])).contains("Only the owner"));
    as_(owner(), 0);
    assert!(panics(|| c.set_token_metadata(None, None, vec![])).contains("yoctoNEAR"));
    as_(owner(), 1);
    assert!(
        panics(|| c.set_token_metadata(None, None, vec![("cape".into(), row())]))
            .contains("Not a token id or a base id")
    );
    as_(owner(), 1);
    assert!(
        panics(|| c.set_token_metadata(None, Some("http://x.example".into()), vec![]))
            .contains("https")
    );
    as_(owner(), 1);
    let long = Some(TokenMeta {
        title: Some("x".repeat(65)),
        ..Default::default()
    });
    assert!(
        panics(|| c.set_token_metadata(None, None, vec![("hero".into(), long)]))
            .contains("1 to 64 bytes")
    );
    as_(owner(), 1);
    let many = (0..51).map(|_| ("hero".to_string(), row())).collect();
    assert!(panics(|| c.set_token_metadata(None, None, many)).contains("At most 50"));
}

// ---------- NEP-245 enumeration ----------

#[test]
fn mt_tokens_lists_every_token_and_pages() {
    let mut c = one_of_each();
    with_hero(&mut c, bob());
    let ids = |c: &Wgp, from: u128, limit: Option<u32>| -> Vec<String> {
        c.mt_tokens(Some(U128(from)), limit)
            .into_iter()
            .map(|t| t.token_id)
            .collect()
    };
    let all = ids(&c, 0, None);
    for id in [
        "hero:alice.wgp.testnet",
        "hero:bob.wgp.testnet",
        "suit:classic",
        "item:fee-bomb",
        "item:bits",
        "item:crumbs",
        "trophy:badge:day-one",
        "trophy:s1:1",
        "trophy:s1:2",
    ] {
        assert!(
            all.contains(&id.to_string()),
            "{id} is missing from {all:?}"
        );
    }
    assert_eq!(c.mt_tokens_count().0 as usize, all.len());
    let mut unique = all.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), all.len());

    // One-of-a-kind tokens carry their owner.
    let tokens = c.mt_tokens(None, None);
    let owner_of = |id: &str| {
        tokens
            .iter()
            .find(|t| t.token_id == id)
            .unwrap()
            .owner_id
            .clone()
    };
    assert_eq!(owner_of("hero:bob.wgp.testnet"), Some(bob()));
    assert_eq!(owner_of("trophy:s1:2"), Some(bob()));
    assert_eq!(owner_of("item:bits"), None);

    // Pages cover the list exactly once.
    let mut paged = Vec::new();
    for from in (0..all.len()).step_by(4) {
        let page = ids(&c, from as u128, Some(4));
        assert!(page.len() <= 4);
        paged.extend(page);
    }
    assert_eq!(paged, all);
    assert!(ids(&c, all.len() as u128, None).is_empty());
    assert!(ids(&c, u128::MAX, Some(u32::MAX)).is_empty());
}

#[test]
fn a_token_burned_to_nothing_leaves_the_list() {
    let mut c = setup();
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(alice(), 1, vec![ing("sybil-goo", 3)], Some(2)),
    );
    let listed = |c: &Wgp, id: &str| c.mt_tokens(None, None).iter().any(|t| t.token_id == id);
    assert!(listed(&c, "item:sybil-goo"));
    assert!(!listed(&c, "suit:stealth"));
    as_(alice(), 0);
    c.craft_suit("stealth".into());
    assert!(!listed(&c, "item:sybil-goo"));
    assert!(listed(&c, "suit:stealth"));
}

#[test]
fn index_tokens_brings_in_tokens_from_before_v3() {
    let mut c = one_of_each();
    with_hero(&mut c, bob());
    let before: Vec<String> = c
        .mt_tokens(None, None)
        .into_iter()
        .map(|t| t.token_id)
        .collect();
    // A state from before v3 has tokens and no index.
    c.tokens.clear();
    assert!(c.mt_tokens(None, None).is_empty());

    as_(alice(), 0);
    assert!(panics(|| {
        c.index_tokens(vec!["item:bits".into()]);
    })
    .contains("Only an operator or the owner"));
    as_(operator(), 0);
    assert!(panics(|| {
        c.index_tokens(vec![]);
    })
    .contains("1 to 100"));

    let mut ask = before.clone();
    ask.push("item:kryptonite".into());
    ask.push("hero:carol.wgp.testnet".into());
    as_(operator(), 0);
    assert_eq!(c.index_tokens(ask.clone()), before.len() as u32);
    let mut after: Vec<String> = c
        .mt_tokens(None, None)
        .into_iter()
        .map(|t| t.token_id)
        .collect();
    let mut want = before.clone();
    after.sort();
    want.sort();
    assert_eq!(after, want);
    // Asking again changes nothing; the owner may ask too.
    as_(owner(), 0);
    assert_eq!(c.index_tokens(ask), 0);
}

#[test]
fn old_tokens_join_the_index_on_their_next_mint() {
    let mut c = one_of_each();
    c.tokens.clear();
    mint(&mut c, reward(alice(), 2, vec![ing("fee-bomb", 1)], None));
    let ids: Vec<String> = c
        .mt_tokens(None, None)
        .into_iter()
        .map(|t| t.token_id)
        .collect();
    assert_eq!(ids, ["item:fee-bomb", "hero:alice.wgp.testnet"]);
}

#[test]
fn the_vendor_lists_what_it_holds() {
    let mut c = market();
    fund(&mut c, alice(), 0, vec![("press-pass", 1)]);
    as_(alice(), 1);
    c.mt_transfer(contract(), "item:press-pass".into(), U128(1), None, None);
    let ids: Vec<String> = c
        .mt_tokens_for_owner(contract(), None, None)
        .into_iter()
        .map(|t| t.token_id)
        .collect();
    assert_eq!(
        ids,
        [
            "item:press-pass",
            "item:bits",
            "item:crumbs",
            "item:fee-bomb",
            "item:sybil-goo",
            "item:goblin-glider"
        ]
    );
    for id in &ids {
        assert!(bal(&c, contract(), id) > 0);
    }
    assert_eq!(
        c.mt_tokens_for_owner(contract(), Some(U128(4)), Some(1))
            .len(),
        1
    );
}

// ---------- Investing: prices don't move ----------

#[test]
fn investing_funds_the_till_and_moves_no_price() {
    let mut c = market();
    fund(&mut c, alice(), 500, vec![]);
    let before = pool(&c, "crumbs");
    let quotes = |c: &Wgp| -> Vec<crate::Quote> {
        [1, 5, 20]
            .iter()
            .map(|n| c.market_quote("crumbs".into(), *n))
            .collect()
    };
    let q0 = quotes(&c);
    let total = supply(&c);

    as_(alice(), 0);
    let r = c.market_invest("crumbs".into(), U128(300));
    let logs = events();
    assert_eq!(
        logs,
        [
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_transfer","data":[{"old_owner_id":"alice.wgp.testnet","new_owner_id":"game.wgp.testnet","token_ids":["item:bits"],"amounts":["300"],"memo":"invest"}]}"#,
            r#"EVENT_JSON:{"standard":"wgp","version":"1.0.0","event":"market_invest","data":[{"account_id":"alice.wgp.testnet","item":"crumbs","bits":"300","earned":"0","stake":"300","invested":"300"}]}"#,
        ]
    );
    assert_eq!((r.bits.0, r.earned.0, r.stake.0), (300, 0, 300));
    assert_eq!(r.unlocks_at_ms, HOUR_MS);

    let after = pool(&c, "crumbs");
    assert_eq!(r.pool, after);
    assert_eq!(after.bits.0, before.bits.0 + 300);
    assert_eq!(after.virtual_bits.0, before.virtual_bits.0 - 300);
    assert_eq!(after.invested.0, 300);
    assert_eq!(reserves(&after), reserves(&before));
    assert_eq!(spot_milli(&after), spot_milli(&before));
    // Every buy quote and listing bound is what it was. So is every sell quote the till
    // could already pay.
    let q1 = quotes(&c);
    for (a, b) in q0.iter().zip(&q1) {
        assert_eq!(
            (a.buy, a.floor, a.ceiling, a.price_milli),
            (b.buy, b.floor, b.ceiling, b.price_milli)
        );
        assert_eq!(a.sell, b.sell);
    }
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 200);
    assert_eq!(
        bal(&c, contract(), BITS_TOKEN),
        480 + 480 + 800 + 1200 + 300
    );
    assert_eq!(supply(&c), total);
    assert_eq!(stake_of(&c, alice(), "crumbs"), 300);
    assert_books(&c, &[alice()]);
}

#[test]
fn an_invest_withdraw_round_trip_returns_exactly_what_went_in() {
    let mut c = open_market(loose());
    fund(&mut c, alice(), 500, vec![]);
    let before = pool(&c, "sybil-goo");
    let total = supply(&c);
    for amount in [1u128, 7, 250, 500] {
        as_(alice(), 0);
        c.market_invest("sybil-goo".into(), U128(amount));
        as_(alice(), 0);
        let r = c.market_withdraw("sybil-goo".into(), U128(amount));
        assert_eq!((r.bits.0, r.earned.0, r.stake.0), (amount, 0, 0));
        assert_eq!(pool(&c, "sybil-goo"), before);
        assert_eq!(bal(&c, alice(), BITS_TOKEN), 500);
        assert_eq!(supply(&c), total);
        assert!(c.market_investor(alice()).stakes.is_empty());
    }
    // In two halves, too.
    as_(alice(), 0);
    c.market_invest("sybil-goo".into(), U128(400));
    as_(alice(), 0);
    c.market_withdraw("sybil-goo".into(), U128(150));
    as_(alice(), 0);
    c.market_withdraw("sybil-goo".into(), U128(250));
    assert_eq!(pool(&c, "sybil-goo"), before);
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 500);
}

/// The victim's sale, with or without someone investing just before it and withdrawing
/// just after: (what the victim got, what the attacker ended with, the pool).
fn sandwiched(attack: bool) -> (u128, u128, Pool) {
    let mut c = open_market(loose());
    fund(&mut c, mallory(), 400, vec![]);
    fund(&mut c, bob(), 0, vec![("crumbs", 10)]);
    if attack {
        as_(mallory(), 0);
        c.market_invest("crumbs".into(), U128(400));
    }
    as_(bob(), 0);
    let got = c.market_sell("crumbs".into(), 10, U128(0)).bits.0;
    if attack {
        as_(mallory(), 0);
        c.market_withdraw("crumbs".into(), U128(400));
    }
    assert_books(&c, &[mallory(), bob()]);
    (got, bal(&c, mallory(), BITS_TOKEN), pool(&c, "crumbs"))
}

#[test]
fn a_sandwich_around_a_trade_gains_nothing_from_it() {
    let (plain_got, plain_mallory, plain_pool) = sandwiched(false);
    let (got, mallory_ends, after) = sandwiched(true);
    // The victim is paid to the Bit what they would have been.
    assert_eq!(got, plain_got);
    // The vendor ends exactly where it would have: same till, stock and curve.
    assert!(after.fee_acc.0 > 0);
    assert_eq!(
        Pool {
            fee_acc: U128(0),
            ..after
        },
        plain_pool
    );
    // The attacker's whole gain is the investors' share of that one trade's fee, which
    // would otherwise have been burned. Nobody paid it but the burn.
    let payout = sell_payout(&open_market(loose()).market_state().pools[0], 10);
    let fee = fee_of(payout, 200);
    assert_eq!(plain_mallory, 400);
    assert!(
        mallory_ends - 400 <= fee / 2,
        "gained {}",
        mallory_ends - 400
    );
}

#[test]
fn a_sandwich_cant_even_take_the_fee_share_while_the_lock_holds() {
    let mut c = market();
    fund(&mut c, mallory(), 400, vec![]);
    fund(&mut c, bob(), 0, vec![("crumbs", 10)]);
    at(mallory(), 1_000);
    c.market_invest("crumbs".into(), U128(400));
    at(bob(), 1_000);
    c.market_sell("crumbs".into(), 10, U128(0));
    at(mallory(), 1_000);
    assert!(panics(|| {
        c.market_withdraw("crumbs".into(), U128(400));
    })
    .contains("Your stake unlocks in about 60 minutes"));
    at(mallory(), 1_000 + HOUR_MS - 1);
    assert!(panics(|| {
        c.market_withdraw("crumbs".into(), U128(400));
    })
    .contains("unlocks in about 1 minutes"));
    at(mallory(), 1_000 + HOUR_MS);
    c.market_withdraw("crumbs".into(), U128(400));
    // A top-up starts the lock again for the whole stake.
    at(mallory(), 2 * HOUR_MS);
    c.market_invest("crumbs".into(), U128(100));
    at(mallory(), 3 * HOUR_MS - 1);
    c.market_invest("crumbs".into(), U128(100));
    at(mallory(), 3 * HOUR_MS);
    assert!(panics(|| {
        c.market_withdraw("crumbs".into(), U128(100));
    })
    .contains("unlocks"));
}

// ---------- Investing: nobody else pays ----------

#[test]
fn another_investor_coming_and_going_takes_nothing_from_a_stake() {
    let mut c = open_market(loose());
    fund(&mut c, alice(), 300, vec![]);
    stock_up(&mut c, mallory(), "bits", 2_000);
    fund(&mut c, mallory(), 0, vec![("crumbs", 60)]);
    stock_up(&mut c, bob(), "bits", 2_000);
    fund(&mut c, bob(), 0, vec![("crumbs", 20)]);
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(300));
    // Some trading: alice earns.
    as_(bob(), 0);
    c.market_sell("crumbs".into(), 20, U128(0));
    let earned = earned_of(&c, alice(), "crumbs");
    assert!(earned > 0);

    // Mallory invests, withdraws, invests again, trades against the pool, withdraws.
    for _ in 0..5 {
        as_(mallory(), 0);
        c.market_invest("crumbs".into(), U128(170));
        assert_eq!(earned_of(&c, alice(), "crumbs"), earned);
        as_(mallory(), 0);
        c.market_withdraw("crumbs".into(), U128(170));
        assert_eq!(earned_of(&c, alice(), "crumbs"), earned);
        assert_eq!(stake_of(&c, alice(), "crumbs"), 300);
    }
    as_(mallory(), 0);
    c.market_invest("crumbs".into(), U128(170));
    as_(mallory(), 0);
    c.market_sell("crumbs".into(), 20, U128(0));
    as_(mallory(), 0);
    c.market_buy("crumbs".into(), 20, U128(10_000));
    as_(mallory(), 0);
    c.market_withdraw("crumbs".into(), U128(170));
    // Alice's principal is whole and her earnings only ever grew.
    assert_eq!(stake_of(&c, alice(), "crumbs"), 300);
    assert!(earned_of(&c, alice(), "crumbs") >= earned);
    // Mallory's own round trip through the vendor lost Bits, as every round trip does,
    // and her investing made back less than the fees she paid.
    assert!(bal(&c, mallory(), BITS_TOKEN) < 2_000);
    let owed = earned_of(&c, alice(), "crumbs");
    as_(alice(), 0);
    let r = c.market_withdraw("crumbs".into(), U128(300));
    assert_eq!((r.bits.0, r.earned.0), (300, owed));
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 300 + owed);
    assert_books(&c, &[alice(), bob(), mallory()]);
}

#[test]
fn a_stake_waits_for_the_till_and_is_never_lost() {
    let mut c = open_market(loose());
    fund(&mut c, alice(), 300, vec![]);
    fund(&mut c, carol(), 0, vec![("crumbs", 400)]);
    stock_up(&mut c, bob(), "bits", 5_000);
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(300));
    // Players sell to the vendor until its till is dry: alice's Bits paid for that stock.
    drain(&mut c, carol(), "crumbs");
    let till = pool(&c, "crumbs").bits.0;
    assert!(till < 300);
    let view = c.market_investor(alice());
    assert_eq!(view.stakes[0].bits.0, 300);
    assert_eq!(view.stakes[0].withdrawable.0, till);
    as_(alice(), 0);
    assert_eq!(
        panics(|| {
            c.market_withdraw("crumbs".into(), U128(300));
        }),
        format!(
            "The till can pay back only {till} Bits right now; it refills as players buy crumbs"
        )
    );
    // What the till does hold, she can take, with the fees she earned while it emptied.
    assert!(till > 0);
    as_(alice(), 0);
    let first = c.market_withdraw("crumbs".into(), U128(till));
    assert!(first.earned.0 > 0);
    // As players buy the stock back, the till refills and the rest comes out.
    let rest = 300 - till;
    refill(&mut c, bob(), "crumbs", rest, 0);
    let owed = earned_of(&c, alice(), "crumbs");
    as_(alice(), 0);
    c.market_withdraw("crumbs".into(), U128(rest));
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 300 + first.earned.0 + owed);
    assert_books(&c, &[alice(), bob(), carol()]);
}

#[test]
fn a_fully_funded_shop_can_pay_for_any_sale() {
    let mut c = open_market(loose());
    fund(&mut c, alice(), 1_000, vec![]);
    for n in 1..=5 {
        fund(&mut c, carol(), 0, vec![("crumbs", 1_000)]);
        assert_eq!(c.reward_nonce(carol()), n);
    }
    let room = invest_room(&pool(&c, "crumbs"));
    assert_eq!(room, 479);
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_invest("crumbs".into(), U128(480));
    })
    .contains("The vendor can take only 479 more Bits for crumbs"));
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(479));
    assert_eq!(pool(&c, "crumbs").virtual_bits.0, 1);
    assert_eq!(shop(&c, "crumbs").invest_room.0, 0);
    // 5,000 crumbs dumped on it: the price falls and falls, and it pays every time.
    for _ in 0..250 {
        if c.market_quote("crumbs".into(), 20).sell.is_none() {
            // Only because 20 are worth less than a Bit, never because the till is short.
            assert_eq!(sell_payout(&pool(&c, "crumbs"), 20), 0);
            break;
        }
        as_(carol(), 0);
        c.market_sell("crumbs".into(), 20, U128(0));
        assert_eq!(till_short(&pool(&c, "crumbs")), 0);
    }
    assert!(shop(&c, "crumbs").buying);
    assert_books(&c, &[alice(), carol()]);
}

// ---------- Broke shops ----------

#[test]
fn a_broke_shop_is_closed_for_buying_until_someone_invests() {
    let mut c = open_market(loose());
    fund(&mut c, carol(), 0, vec![("crumbs", 400)]);
    fund(&mut c, alice(), 500, vec![]);
    let s = shop(&c, "crumbs");
    assert!(s.closed.is_empty() && s.buying && s.selling);
    assert_eq!(
        (s.till.0, s.needs.0, s.invested.0, s.invest_room.0),
        (480, 0, 0, 479)
    );

    drain(&mut c, carol(), "crumbs");
    // The sale that emptied the till said so.
    let p = pool(&c, "crumbs");
    let needs = sell_payout(&p, 1) - p.bits.0;
    assert_eq!(
        events().last().unwrap(),
        &format!(
            r#"EVENT_JSON:{{"standard":"wgp","version":"1.0.0","event":"market_shop","data":[{{"item":"crumbs","closed":["broke"],"cause":"sell","till":"{}","needs":"{needs}"}}]}}"#,
            p.bits.0
        )
    );
    let s = shop(&c, "crumbs");
    assert_eq!(s.closed, ["broke"]);
    assert!(!s.buying && s.selling);
    assert_eq!(s.needs.0, needs);
    assert!(c.market_quote("crumbs".into(), 1).sell.is_none());
    as_(carol(), 0);
    assert!(panics(|| {
        c.market_sell("crumbs".into(), 1, U128(0));
    })
    .contains("The vendor's till holds only"));
    // The other stalls are still open.
    assert!(shop(&c, "fee-bomb").closed.is_empty());

    // An investor reopens it, and the event says who did what.
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(200));
    let logs = events();
    assert_eq!(
        logs.last().unwrap(),
        &format!(
            r#"EVENT_JSON:{{"standard":"wgp","version":"1.0.0","event":"market_shop","data":[{{"item":"crumbs","closed":[],"cause":"invest","till":"{}","needs":"0"}}]}}"#,
            p.bits.0 + 200
        )
    );
    assert!(shop(&c, "crumbs").buying);
    as_(carol(), 0);
    c.market_sell("crumbs".into(), 1, U128(0));
}

#[test]
fn a_broke_shop_reopens_when_someone_buys_from_it() {
    let mut c = open_market(loose());
    fund(&mut c, carol(), 0, vec![("crumbs", 400)]);
    fund(&mut c, bob(), 500, vec![]);
    drain(&mut c, carol(), "crumbs");
    assert_eq!(shop(&c, "crumbs").closed, ["broke"]);
    as_(bob(), 0);
    c.market_buy("crumbs".into(), 5, U128(500));
    assert!(events()
        .last()
        .unwrap()
        .contains(r#""event":"market_shop","data":[{"item":"crumbs","closed":[],"cause":"buy""#));
    assert!(shop(&c, "crumbs").buying);
}

#[test]
fn withdrawing_the_tills_last_bits_closes_the_shop_and_says_so() {
    let mut c = open_market(loose());
    fund(&mut c, carol(), 0, vec![("crumbs", 400)]);
    fund(&mut c, alice(), 500, vec![]);
    drain(&mut c, carol(), "crumbs");
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(100));
    as_(alice(), 0);
    c.market_withdraw("crumbs".into(), U128(100));
    assert!(events()
        .last()
        .unwrap()
        .contains(r#""closed":["broke"],"cause":"withdraw""#));
    assert!(!shop(&c, "crumbs").buying);
}

#[test]
fn a_sold_out_or_stopped_stall_says_why() {
    let mut c = open_market(loose());
    stock_up(&mut c, bob(), "bits", 6_000);
    for _ in 0..2 {
        as_(bob(), 0);
        c.market_buy("goblin-glider".into(), 4, U128(1_000_000));
    }
    assert!(events()
        .last()
        .unwrap()
        .contains(r#""closed":["sold-out"],"cause":"buy""#));
    let s = shop(&c, "goblin-glider");
    assert_eq!(s.closed, ["sold-out"]);
    assert!(s.buying && !s.selling);

    as_(owner(), 1);
    c.set_market(
        MarketParams {
            open: false,
            ..loose()
        },
        vec![],
    );
    assert_eq!(shop(&c, "crumbs").closed, ["market-closed"]);
    as_(owner(), 1);
    c.set_paused(true);
    let s = shop(&c, "goblin-glider");
    assert_eq!(s.closed, ["paused", "market-closed", "sold-out"]);
    assert!(!s.buying && !s.selling);
}

// ---------- The fee split ----------

#[test]
fn investors_share_the_fee_and_the_rest_still_burns() {
    let mut c = open_market(loose());
    fund(&mut c, alice(), 300, vec![]);
    fund(&mut c, carol(), 100, vec![]);
    stock_up(&mut c, bob(), "bits", 5_000);
    fund(&mut c, bob(), 0, vec![("sybil-goo", 20)]);
    as_(alice(), 0);
    c.market_invest("sybil-goo".into(), U128(300));
    as_(carol(), 0);
    c.market_invest("sybil-goo".into(), U128(100));

    let mut fees = 0;
    let mut burned = 0;
    for i in 0..12 {
        let before = supply(&c);
        as_(bob(), 0);
        let t = if i % 2 == 0 {
            c.market_buy("sybil-goo".into(), 1 + i % 3, U128(100_000))
        } else {
            c.market_sell("sybil-goo".into(), 1 + i % 3, U128(0))
        };
        fees += t.fee.0;
        burned += before - supply(&c);
        // The burn event carries what was really burned.
        let logs = events();
        let burn = logs.iter().find(|l| l.contains("mt_burn"));
        let cut = t.fee.0 - (before - supply(&c));
        match burn {
            Some(l) => assert!(l.contains(&format!(
                r#""amounts":["{}"],"memo":"gas-fee""#,
                t.fee.0 - cut
            ))),
            None => assert_eq!(cut, t.fee.0),
        }
        assert_books(&c, &[alice(), bob(), carol()]);
    }
    // Half of the fees went to investors (whole Bits; under one Bit is still carried).
    let p = pool(&c, "sybil-goo");
    assert_eq!(p.rewards.0, fees / 2);
    assert_eq!(burned, fees - fees / 2);
    assert_eq!((fees * 5_000 % 10_000) as u32, p.fee_carry);
    // 3 : 1, as they staked, each rounded down.
    let (a, k) = (
        earned_of(&c, alice(), "sybil-goo"),
        earned_of(&c, carol(), "sybil-goo"),
    );
    assert!(a + k <= p.rewards.0 && a + k + 2 > p.rewards.0);
    assert!(a >= 3 * k && a <= 3 * (k + 1));

    // A claim pays it out and leaves the stake.
    as_(alice(), 0);
    let r = c.market_claim("sybil-goo".into());
    assert_eq!((r.bits.0, r.earned.0, r.stake.0), (0, a, 300));
    let logs = events();
    assert!(logs[0].contains(&format!(
        r#""old_owner_id":"game.wgp.testnet","new_owner_id":"alice.wgp.testnet","token_ids":["item:bits"],"amounts":["{a}"],"memo":"earnings""#
    )));
    assert!(logs[1].contains(&format!(
        r#""event":"market_claim","data":[{{"account_id":"alice.wgp.testnet","item":"sybil-goo","bits":"0","earned":"{a}","stake":"300","invested":"400"}}]"#
    )));
    assert_eq!(bal(&c, alice(), BITS_TOKEN), a);
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_claim("sybil-goo".into());
    })
    .contains("Nothing earned yet"));
    as_(bob(), 0);
    assert!(panics(|| {
        c.market_claim("sybil-goo".into());
    })
    .contains("You have no stake in sybil-goo"));

    // When the last investor leaves, what rounding left over is burned.
    as_(alice(), 0);
    c.market_withdraw("sybil-goo".into(), U128(300));
    let before = supply(&c);
    as_(carol(), 0);
    let r = c.market_withdraw("sybil-goo".into(), U128(100));
    assert_eq!(r.earned.0, k);
    let p = pool(&c, "sybil-goo");
    assert_eq!((p.invested.0, p.rewards.0, p.fee_carry), (0, 0, 0));
    assert_eq!(before - supply(&c), fees / 2 - a - k);
    assert_books(&c, &[alice(), bob(), carol()]);
}

#[test]
fn a_pool_with_no_investors_burns_the_whole_fee_as_before() {
    let mut c = open_market(loose());
    fund(&mut c, bob(), 1_000, vec![]);
    let before = supply(&c);
    as_(bob(), 0);
    let t = c.market_buy("crumbs".into(), 3, U128(1_000));
    assert_eq!(before - supply(&c), t.fee.0);
    let p = pool(&c, "crumbs");
    assert_eq!((p.rewards.0, p.fee_acc.0, p.fee_carry), (0, 0, 0));
    // And listings always burn all of theirs.
    fund(&mut c, alice(), 300, vec![("crumbs", 2)]);
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(300));
    as_(alice(), 0);
    let l = c.list_item("crumbs".into(), 2, U128(30));
    let before = supply(&c);
    as_(bob(), 0);
    c.buy_listing(l.id);
    assert_eq!(before - supply(&c), 1);
    assert_eq!(pool(&c, "crumbs").rewards.0, 0);
}

#[test]
fn the_fee_share_can_be_none_or_all() {
    for (bps, share) in [(0u32, 0u128), (10_000, 1)] {
        let mut c = open_market(MarketParams {
            invest_fee_bps: bps,
            ..loose()
        });
        fund(&mut c, alice(), 300, vec![]);
        fund(&mut c, bob(), 1_000, vec![]);
        as_(alice(), 0);
        c.market_invest("crumbs".into(), U128(300));
        let before = supply(&c);
        as_(bob(), 0);
        let t = c.market_buy("crumbs".into(), 10, U128(1_000));
        assert_eq!(pool(&c, "crumbs").rewards.0, t.fee.0 * share);
        assert_eq!(before - supply(&c), t.fee.0 * (1 - share));
        assert_eq!(events().iter().any(|l| l.contains("mt_burn")), share == 0);
        assert_books(&c, &[alice(), bob()]);
    }
}

// ---------- Limits and the session key ----------

#[test]
fn investing_is_bounded_per_call_and_per_day() {
    let mut c = market();
    for n in 1..=3 {
        fund(&mut c, alice(), 1_000, vec![]);
        assert_eq!(c.reward_nonce(alice()), n);
    }
    let v = c.market_investor(alice());
    assert_eq!((v.invests_left, v.invest_bits_left.0), (6, 1_000));
    let day = 20_000u64;
    on_day(alice(), 0, day);
    assert!(panics(|| {
        c.market_invest("crumbs".into(), U128(9));
    })
    .contains("Invest 10 to 500 Bits at a time"));
    on_day(alice(), 0, day);
    assert!(panics(|| {
        c.market_invest("goblin-glider".into(), U128(501));
    })
    .contains("Invest 10 to 500 Bits at a time"));
    // 1,000 Bits a day at most, however it is split.
    on_day(alice(), 0, day);
    c.market_invest("goblin-glider".into(), U128(500));
    on_day(alice(), 0, day);
    c.market_invest("sybil-goo".into(), U128(450));
    on_day(alice(), 0, day);
    assert!(panics(|| {
        c.market_invest("crumbs".into(), U128(51));
    })
    .contains("Daily market limit reached"));
    on_day(alice(), 0, day);
    c.market_invest("crumbs".into(), U128(50));
    let v = c.market_investor(alice());
    assert_eq!((v.invests_left, v.invest_bits_left.0), (3, 0));
    // The next day starts again.
    on_day(alice(), 0, day + 1);
    let v = c.market_investor(alice());
    assert_eq!((v.invests_left, v.invest_bits_left.0), (6, 1_000));
    for _ in 0..6 {
        on_day(alice(), 0, day + 1);
        c.market_invest("crumbs".into(), U128(10));
    }
    // Six calls a day at most.
    on_day(alice(), 0, day + 1);
    assert!(panics(|| {
        c.market_invest("crumbs".into(), U128(10));
    })
    .contains("Daily market limit reached"));
    // Withdrawing isn't capped: a stake can always come home.
    for _ in 0..10 {
        on_day(alice(), 0, day + 2);
        c.market_withdraw("crumbs".into(), U128(1));
    }
    assert_books(&c, &[alice()]);
}

#[test]
fn investing_needs_bits_a_pool_and_an_open_market() {
    let mut c = market();
    fund(&mut c, alice(), 100, vec![]);
    as_(alice(), 0);
    assert_eq!(
        panics(|| {
            c.market_invest("crumbs".into(), U128(101));
        }),
        "Needs 101 Bits"
    );
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_invest("press-pass".into(), U128(50));
    })
    .contains("The market doesn't trade press-pass"));
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_withdraw("crumbs".into(), U128(1));
    })
    .contains("You have no stake in crumbs"));
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(60));
    at(alice(), 2 * HOUR_MS);
    assert!(panics(|| {
        c.market_withdraw("crumbs".into(), U128(61));
    })
    .contains("You have 60 Bits staked in crumbs"));
    at(alice(), 2 * HOUR_MS);
    assert!(panics(|| {
        c.market_withdraw("crumbs".into(), U128(0));
    })
    .contains("You have 60 Bits staked in crumbs"));

    // New investments can be switched off on their own; stakes still come out.
    as_(owner(), 1);
    c.set_market(
        MarketParams {
            invest_open: false,
            ..Default::default()
        },
        vec![],
    );
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_invest("crumbs".into(), U128(20));
    })
    .contains("The vendor isn't taking investors right now"));
    at(alice(), 2 * HOUR_MS);
    c.market_withdraw("crumbs".into(), U128(10));

    // A closed market takes no investments and still pays stakes back.
    as_(owner(), 1);
    c.set_market(
        MarketParams {
            open: false,
            ..Default::default()
        },
        vec![],
    );
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_invest("crumbs".into(), U128(20));
    })
    .contains("The market is closed"));
    at(alice(), 2 * HOUR_MS);
    c.market_withdraw("crumbs".into(), U128(10));

    // A paused game stops both.
    as_(owner(), 1);
    c.set_paused(true);
    at(alice(), 2 * HOUR_MS);
    assert!(panics(|| {
        c.market_withdraw("crumbs".into(), U128(10));
    })
    .contains("paused"));
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_claim("crumbs".into());
    })
    .contains("paused"));
}

#[test]
fn invest_calls_take_no_deposit_so_a_session_key_can_make_them() {
    let mut c = open_market(loose());
    fund(&mut c, alice(), 100, vec![]);
    fund(&mut c, bob(), 1_000, vec![]);
    // A function-call key can't attach a deposit; none is asked for.
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(100));
    as_(bob(), 0);
    c.market_buy("crumbs".into(), 20, U128(1_000));
    as_(alice(), 0);
    c.market_claim("crumbs".into());
    as_(alice(), 0);
    c.market_withdraw("crumbs".into(), U128(100));
}

#[test]
fn a_stolen_session_key_cant_drain_a_player_by_investing() {
    // The default rules, investing limits included; only the trade count is lifted so the
    // accomplice can sell without waiting days.
    let mut c = open_market(MarketParams {
        daily_trades: 100_000,
        ..Default::default()
    });
    for n in 1..=3 {
        fund(&mut c, alice(), 1_000, vec![]);
        assert_eq!(c.reward_nonce(alice()), n);
    }
    fund(
        &mut c,
        mallory(),
        0,
        vec![("crumbs", 400), ("fee-bomb", 400)],
    );
    fund(&mut c, bob(), 1_000, vec![]);
    fund(&mut c, bob(), 1_000, vec![]);
    let day = 20_000u64;
    let noon = day * 86_400_000 + 12 * HOUR_MS;

    // The thief holds alice's session key: every call below is "alice" with no deposit.
    // All it can do with her 3,000 Bits is stake them, and at most 1,000 of them a day.
    at(alice(), noon);
    c.market_invest("crumbs".into(), U128(479));
    at(alice(), noon);
    c.market_invest("fee-bomb".into(), U128(479));
    at(alice(), noon);
    assert!(panics(|| {
        c.market_invest("sybil-goo".into(), U128(43));
    })
    .contains("Daily market limit reached"));
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 3_000 - 958);
    // The stake is hers and stays hers: it isn't a token, so nothing can send it away,
    // and Bits still need the one yoctoNEAR a session key can't attach.
    assert_eq!(
        stake_of(&c, alice(), "crumbs") + stake_of(&c, alice(), "fee-bomb"),
        958
    );
    assert!(c
        .mt_tokens_for_owner(alice(), None, None)
        .iter()
        .all(|t| t.token_id == BITS_TOKEN));
    at(alice(), noon);
    assert!(panics(|| {
        c.mt_transfer(mallory(), BITS_TOKEN.into(), U128(1), None, None);
    })
    .contains("yoctoNEAR"));

    // The accomplice dumps items on the tills alice's Bits just filled. That is a sale at
    // the curve's falling price, the same one any funded till would have paid.
    let mallory_items_worth: u128 = ["crumbs", "fee-bomb"]
        .iter()
        .map(|i| spot_milli(&pool(&c, i)) * 400 / 1000)
        .sum();
    at(mallory(), noon);
    drain(&mut c, mallory(), "crumbs");
    at(mallory(), noon);
    drain(&mut c, mallory(), "fee-bomb");
    assert!(bal(&c, mallory(), BITS_TOKEN) < mallory_items_worth);
    // Alice's claim hasn't moved by a Bit; it is only waiting on the tills.
    assert_eq!(
        stake_of(&c, alice(), "crumbs") + stake_of(&c, alice(), "fee-bomb"),
        958
    );
    let earned = earned_of(&c, alice(), "crumbs") + earned_of(&c, alice(), "fee-bomb");
    assert!(earned > 0);

    // Players buy the stock back; alice (with her own key or the session key) takes
    // everything out and has more Bits than she started with.
    for item in ["crumbs", "fee-bomb"] {
        refill(&mut c, bob(), item, 479, noon + HOUR_MS);
        at(alice(), noon + HOUR_MS);
        c.market_withdraw(item.into(), U128(479));
    }
    assert!(bal(&c, alice(), BITS_TOKEN) >= 3_000 + earned);
    assert!(c.market_investor(alice()).stakes.is_empty());
    assert_books(&c, &[alice(), bob(), mallory()]);
}

#[test]
fn an_investor_costs_little_storage() {
    let mut c = open_market(loose());
    let who: AccountId = format!("{}.wgp.testnet", "i".repeat(52)).parse().unwrap();
    fund(&mut c, who.clone(), 1_000, vec![]);
    c.players.flush();
    c.market.investors.flush();
    let before = near_sdk::env::storage_usage();
    for item in ["crumbs", "fee-bomb", "sybil-goo", "goblin-glider"] {
        as_(who.clone(), 0);
        c.market_invest(item.into(), U128(100));
    }
    c.players.flush();
    c.market.investors.flush();
    let used = near_sdk::env::storage_usage() - before;
    println!("INVESTOR_WITH_4_STAKES_STORAGE_BYTES={used}");
    assert!(used < 500, "used {used} bytes");
}

// ---------- Everything at once ----------

/// A small deterministic generator, so a failure replays.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n
    }
}

#[test]
fn the_books_balance_through_random_trading_and_investing() {
    let mut c = open_market(loose());
    let who = [alice(), bob(), carol(), mallory()];
    let items = ["crumbs", "fee-bomb", "sybil-goo", "goblin-glider"];
    for a in &who {
        fund(
            &mut c,
            a.clone(),
            1_000,
            vec![
                ("crumbs", 60),
                ("fee-bomb", 60),
                ("sybil-goo", 30),
                ("goblin-glider", 10),
            ],
        );
    }
    // What the owner set: virtual_bits + invested never leaves it.
    let base: Vec<u128> = c
        .market_state()
        .pools
        .iter()
        .map(|p| p.virtual_bits.0)
        .collect();
    let mut rng = Lcg(71);
    let mut done = [0u32; 5];
    for step in 0..3_000 {
        let a = who[rng.next(4) as usize].clone();
        let item = items[rng.next(4) as usize];
        let before = pool(&c, item);
        let k = |p: &Pool| {
            let (x, y) = reserves(p);
            x * y
        };
        let bits = bal(&c, a.clone(), BITS_TOKEN);
        match rng.next(5) {
            0 => {
                let n = 1 + rng.next(6) as u32;
                let Some(cost) = c.market_quote(item.into(), n).buy else {
                    continue;
                };
                if cost.0 > bits {
                    continue;
                }
                as_(a.clone(), 0);
                c.market_buy(item.into(), n, cost);
                assert!(
                    k(&pool(&c, item)) >= k(&before),
                    "step {step}: a buy lowered k"
                );
                done[0] += 1;
            }
            1 => {
                let n = 1 + rng.next(6) as u32;
                let Some(pays) = c.market_quote(item.into(), n).sell else {
                    continue;
                };
                if bal(&c, a.clone(), &format!("item:{item}")) < n as u128 {
                    continue;
                }
                as_(a.clone(), 0);
                c.market_sell(item.into(), n, pays);
                assert!(
                    k(&pool(&c, item)) >= k(&before),
                    "step {step}: a sell lowered k"
                );
                done[1] += 1;
            }
            2 => {
                let amount = (1 + rng.next(300) as u128)
                    .min(bits)
                    .min(invest_room(&before));
                if amount == 0 {
                    continue;
                }
                as_(a.clone(), 0);
                c.market_invest(item.into(), U128(amount));
                let after = pool(&c, item);
                assert_eq!(
                    reserves(&after),
                    reserves(&before),
                    "step {step}: investing moved the curve"
                );
                assert_eq!(after.stock, before.stock);
                done[2] += 1;
            }
            3 => {
                let can = c
                    .market_investor(a.clone())
                    .stakes
                    .into_iter()
                    .find(|s| s.item == item)
                    .map(|s| s.withdrawable.0)
                    .unwrap_or(0);
                if can == 0 {
                    continue;
                }
                let amount = 1 + rng.next(can as u64) as u128;
                let held = bits + stake_of(&c, a.clone(), item);
                as_(a.clone(), 0);
                let r = c.market_withdraw(item.into(), U128(amount));
                let after = pool(&c, item);
                assert_eq!(
                    reserves(&after),
                    reserves(&before),
                    "step {step}: withdrawing moved the curve"
                );
                // Principal comes back one for one; only earnings are added.
                assert_eq!(
                    bal(&c, a.clone(), BITS_TOKEN) + stake_of(&c, a.clone(), item),
                    held + r.earned.0
                );
                done[3] += 1;
            }
            _ => {
                if earned_of(&c, a.clone(), item) == 0 {
                    continue;
                }
                as_(a.clone(), 0);
                c.market_claim(item.into());
                assert_eq!(pool(&c, item).bits, before.bits);
                done[4] += 1;
            }
        }
        assert_books(&c, &who);
        for (p, b) in c.market_state().pools.iter().zip(&base) {
            assert_eq!(
                p.virtual_bits.0 + p.invested.0,
                *b,
                "step {step}: {}",
                p.item
            );
        }
    }
    println!("RANDOM_OPS buy/sell/invest/withdraw/claim = {done:?}");
    assert!(done.iter().all(|n| *n > 50), "{done:?}");
}

// ---------- Owner settings ----------

#[test]
fn retuning_a_pool_keeps_investors_bits_in_the_till() {
    let mut c = open_market(loose());
    fund(&mut c, alice(), 300, vec![]);
    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(300));
    // The owner doubles the curve's virtual Bits: 960 on the books, 300 of them funded.
    as_(owner(), 1);
    c.set_market(loose(), vec![pool_cfg("crumbs", 960, 40, 0, 0)]);
    let p = pool(&c, "crumbs");
    assert_eq!((p.virtual_bits.0, p.invested.0, p.bits.0), (660, 300, 780));
    as_(alice(), 0);
    c.market_withdraw("crumbs".into(), U128(300));
    let p = pool(&c, "crumbs");
    assert_eq!((p.virtual_bits.0, p.invested.0, p.bits.0), (960, 0, 480));

    as_(alice(), 0);
    c.market_invest("crumbs".into(), U128(300));
    as_(owner(), 1);
    assert!(
        panics(|| c.set_market(loose(), vec![pool_cfg("crumbs", 300, 40, 0, 0)]))
            .contains("crumbs: virtual_bits must stay above the 300 Bits invested")
    );
}

#[test]
fn the_invest_rules_are_validated() {
    let mut c = setup();
    let bad: Vec<(MarketParams, &str)> = vec![
        (
            MarketParams {
                invest_fee_bps: 10_001,
                ..Default::default()
            },
            "invest_fee_bps is at most 10000",
        ),
        (
            MarketParams {
                min_invest: U128(0),
                ..Default::default()
            },
            "1 <= min_invest <= max_invest",
        ),
        (
            MarketParams {
                min_invest: U128(600),
                ..Default::default()
            },
            "1 <= min_invest <= max_invest",
        ),
        (
            MarketParams {
                invest_lock_ms: 31 * 86_400_000,
                ..Default::default()
            },
            "invest_lock_ms is at most 30 days",
        ),
    ];
    for (params, why) in bad {
        as_(owner(), 1);
        assert!(panics(|| c.set_market(params, vec![])).contains(why));
    }
}

#[test]
fn v2_market_arguments_still_work_and_leave_investing_alone() {
    // What scripts/near/market-args.ts sends today: no investing fields.
    let v2_args = json!({
        "open": true, "fee_bps": 150, "floor_bps": 5000, "ceiling_bps": 40000,
        "max_amount": 20, "max_open_listings": 3, "max_listings": 300,
        "daily_trades": 40, "daily_listings": 10, "daily_fills": 10,
        "daily_fill_bits": "3000", "craft_bits": "0"
    });
    let mut m = market();
    // The owner has set investing up their own way...
    as_(owner(), 1);
    m.set_market(
        MarketParams {
            invest_open: false,
            invest_fee_bps: 2_500,
            invest_lock_ms: 60_000,
            ..Default::default()
        },
        vec![],
    );
    // ...and the old arguments change the old rules and nothing else.
    as_(owner(), 1);
    m.set_market_params(serde_json::from_value(v2_args.clone()).unwrap(), vec![]);
    assert_eq!(
        m.market_state().params,
        MarketParams {
            fee_bps: 150,
            craft_bits: U128(0),
            invest_open: false,
            invest_fee_bps: 2_500,
            invest_lock_ms: 60_000,
            ..Default::default()
        }
    );
    // One investing rule on its own; and what market_state answers can be sent back whole.
    let mut open = v2_args;
    open["invest_open"] = json!(true);
    as_(owner(), 1);
    m.set_market_params(serde_json::from_value(open).unwrap(), vec![]);
    let p = m.market_state().params;
    assert!(p.invest_open);
    assert_eq!((p.invest_fee_bps, p.invest_lock_ms), (2_500, 60_000));
    let mut whole = serde_json::to_value(&p).unwrap();
    whole["max_invest"] = json!("250");
    as_(owner(), 1);
    m.set_market_params(serde_json::from_value(whole).unwrap(), vec![]);
    assert_eq!(
        m.market_state().params,
        MarketParams {
            max_invest: U128(250),
            ..p
        }
    );
    // A v2 rule left out is still an error, as it was.
    assert!(serde_json::from_value::<crate::MarketRules>(json!({"open": true})).is_err());

    // And a v2 reader finds every field it knew in what v3 answers.
    let c = market();
    let state = serde_json::to_value(c.market_state()).unwrap();
    for key in [
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
    ] {
        assert!(state["params"].get(key).is_some(), "{key}");
    }
    for key in [
        "item",
        "virtual_bits",
        "virtual_items",
        "bits",
        "stock",
        "escrow",
    ] {
        assert!(state["pools"][0].get(key).is_some(), "{key}");
    }
    for key in [
        "vendor",
        "params",
        "pools",
        "prices_milli",
        "listings",
        "day",
    ] {
        assert!(state.get(key).is_some(), "{key}");
    }
}

#[test]
fn crafting_costs_bits_by_default() {
    assert_eq!(MarketParams::default().craft_bits.0, DEFAULT_CRAFT_BITS);
    const { assert!(DEFAULT_CRAFT_BITS > 0) };
    // A fresh contract, nothing set by the owner.
    near_sdk::mock::with_mocked_blockchain(|b| {
        b.take_storage();
    });
    as_(owner(), 0);
    let (items, suits) = rules();
    let mut c = Wgp::new(owner(), vec![operator()], items, suits, 2);
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(
            alice(),
            1,
            vec![ing("sybil-goo", 3), ing("bits", 60)],
            Some(2),
        ),
    );
    let before = supply(&c);
    as_(alice(), 0);
    c.craft_suit("stealth".into());
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 60 - DEFAULT_CRAFT_BITS);
    assert_eq!(supply(&c), before - DEFAULT_CRAFT_BITS);
    // Starter suits have no recipe and stay free.
    as_(alice(), 0);
    c.craft_suit("snow".into());
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 60 - DEFAULT_CRAFT_BITS);
}

#[test]
fn owner_actions_are_logged() {
    let mut c = setup();
    let last = || events().last().cloned().unwrap_or_default();
    as_(owner(), 1);
    c.set_paused(true);
    assert_eq!(
        last(),
        r#"EVENT_JSON:{"standard":"wgp","version":"1.0.0","event":"admin","data":[{"action":"pause","by":"wgp.testnet"}]}"#
    );
    as_(owner(), 1);
    c.set_paused(false);
    assert!(last().contains(r#""action":"unpause""#));
    as_(owner(), 1);
    c.add_operator(bob());
    assert!(last()
        .contains(r#""action":"add_operator","by":"wgp.testnet","account_id":"bob.wgp.testnet""#));
    as_(owner(), 1);
    c.remove_operator(bob());
    assert!(last().contains(r#""action":"remove_operator""#));
    let (items, suits) = rules();
    as_(owner(), 1);
    c.set_rules(items, suits, 2);
    assert!(last().contains(r#""action":"set_rules""#));
    as_(owner(), 1);
    c.set_market(MarketParams::default(), vec![]);
    assert!(last().contains(r#""action":"set_market_params""#));
    as_(owner(), 1);
    c.set_owner(alice());
    assert!(last()
        .contains(r#""action":"set_owner","by":"wgp.testnet","account_id":"alice.wgp.testnet""#));
}

#[test]
fn the_version_and_storage_views_answer() {
    let c = one_of_each();
    let v = c.get_version();
    assert_eq!(v.state, 3);
    assert_eq!(v.contract, env!("CARGO_PKG_VERSION"));
    assert!(v.standards.contains(&"nep245".to_string()));
    let s = c.get_storage();
    assert_eq!(s.locked.0, s.bytes as u128 * 10u128.pow(19));
    assert_eq!(s.available.0, s.balance.0.saturating_sub(s.locked.0));
    assert_eq!(s.tokens as u128, c.mt_tokens_count().0);
}

// ---------- Migration ----------

/// The state of `c` as the v2 code wrote it: the v2 root layout, every collection entry
/// where v2 left it, no token index.
fn as_v2_state(mut c: Wgp) -> Vec<u8> {
    c.tokens.clear();
    c.tokens.flush();
    to_v2_layout(c)
}

/// The owner turns investing on with the rules as they stand, as after an upgrade.
fn open_investing(c: &mut Wgp) {
    let params = MarketParams {
        invest_open: true,
        ..c.market_state().params
    };
    on_day(owner(), 1, 20_000);
    c.set_market(params, vec![]);
}

/// The root of `c` rewritten in the v2 layout; collection entries stay where they are.
fn to_v2_layout(mut c: Wgp) -> Vec<u8> {
    use crate::migrate::{MarketParamsV2, MarketV2, PoolV2, WgpV2};
    use near_sdk::store::{IterableMap, IterableSet, LookupMap};
    let p = c.market.params.clone();
    let old = WgpV2 {
        owner_id: c.owner_id.clone(),
        operators: std::mem::replace(&mut c.operators, IterableSet::new(b"x1".to_vec())),
        paused: c.paused,
        items: c.items.clone(),
        suits: c.suits.clone(),
        starter_unlock_level: c.starter_unlock_level,
        players: std::mem::replace(&mut c.players, LookupMap::new(b"x2".to_vec())),
        supply: std::mem::replace(&mut c.supply, LookupMap::new(b"x3".to_vec())),
        seasons: std::mem::replace(&mut c.seasons, LookupMap::new(b"x4".to_vec())),
        market: MarketV2 {
            params: MarketParamsV2 {
                open: p.open,
                fee_bps: p.fee_bps,
                floor_bps: p.floor_bps,
                ceiling_bps: p.ceiling_bps,
                max_amount: p.max_amount,
                max_open_listings: p.max_open_listings,
                max_listings: p.max_listings,
                daily_trades: p.daily_trades,
                daily_listings: p.daily_listings,
                daily_fills: p.daily_fills,
                daily_fill_bits: p.daily_fill_bits,
                craft_bits: p.craft_bits,
            },
            pools: c
                .market
                .pools
                .iter()
                .map(|p| {
                    assert_eq!(p.invested.0 + p.rewards.0, 0, "v2 had no investors");
                    PoolV2 {
                        item: p.item.clone(),
                        virtual_bits: p.virtual_bits,
                        virtual_items: p.virtual_items,
                        bits: p.bits,
                        stock: p.stock,
                        escrow: p.escrow,
                    }
                })
                .collect(),
            listings: std::mem::replace(&mut c.market.listings, IterableMap::new(b"x5".to_vec())),
            next_listing_id: c.market.next_listing_id,
            accounts: std::mem::replace(&mut c.market.accounts, LookupMap::new(b"x6".to_vec())),
        },
    };
    let bytes = near_sdk::borsh::to_vec(&old).unwrap();
    // Dropping `old` writes its entries to storage under the v2 prefixes.
    bytes
}

/// A v2 game in full swing: heroes, loot, a crafted suit, the market with trades behind
/// it, open listings, daily counters, a badge and a recorded season.
fn busy_v2() -> Wgp {
    let mut c = open_market(MarketParams {
        craft_bits: U128(0),
        daily_trades: 7,
        ..Default::default()
    });
    with_hero(&mut c, alice());
    with_hero(&mut c, bob());
    as_(operator(), 0);
    c.mint_rewards(vec![
        RewardMint {
            account_id: alice(),
            nonce: 1,
            items: vec![ing("sybil-goo", 5), ing("crumbs", 9), ing("bits", 700)],
            level: Some(4),
            badges: vec!["day-one".into()],
            digest: DIGEST.into(),
        },
        reward(
            bob(),
            1,
            vec![ing("bits", 400), ing("fee-bomb", 6)],
            Some(2),
        ),
        reward(carol(), 1, vec![ing("bits", 50)], None),
    ]);
    on_day(alice(), 0, 20_000);
    c.craft_suit("stealth".into());
    on_day(alice(), 0, 20_000);
    c.market_buy("goblin-glider".into(), 1, U128(1_000));
    on_day(alice(), 0, 20_000);
    c.market_sell("crumbs".into(), 4, U128(0));
    on_day(alice(), 0, 20_000);
    c.list_item("crumbs".into(), 3, U128(40));
    on_day(bob(), 0, 20_000);
    c.list_item("fee-bomb".into(), 2, U128(30));
    on_day(bob(), 0, 20_000);
    c.list_item("fee-bomb".into(), 1, U128(14));
    on_day(alice(), 0, 20_000);
    c.buy_listing(3);
    on_day(operator(), 0, 20_000);
    c.record_season(
        "s0".into(),
        ROOT.into(),
        vec![bob(), alice()],
        DIGEST.into(),
    );
    c
}

/// Everything a v2 reader can see, as JSON.
fn snapshot(c: &Wgp) -> serde_json::Value {
    let tokens = [
        "item:bits",
        "item:crumbs",
        "item:fee-bomb",
        "item:sybil-goo",
        "item:goblin-glider",
        "suit:classic",
        "suit:stealth",
        "trophy:badge:day-one",
        "trophy:s0:1",
        "trophy:s0:2",
        "hero:alice.wgp.testnet",
        "hero:bob.wgp.testnet",
    ]
    .map(String::from)
    .to_vec();
    let accounts = [alice(), bob(), carol(), contract()];
    let pools: Vec<serde_json::Value> = c
        .market_state()
        .pools
        .iter()
        .map(|p| {
            json!([
                p.item,
                p.virtual_bits,
                p.virtual_items,
                p.bits,
                p.stock,
                p.escrow
            ])
        })
        .collect();
    let p = c.market_state().params;
    json!({
        "config": serde_json::to_value(c.get_config()).unwrap(),
        "players": accounts.iter().map(|a| serde_json::to_value(c.get_player(a.clone())).unwrap()).collect::<Vec<_>>(),
        "balances": accounts.iter().map(|a| c.mt_batch_balance_of(a.clone(), tokens.clone())).collect::<Vec<_>>(),
        "supply": c.mt_batch_supply(tokens.clone()),
        "owners": c.mt_token(tokens),
        "season": c.get_season("s0".into()),
        "pools": pools,
        "prices": c.market_state().prices_milli,
        "params": [p.open as u32, p.fee_bps, p.floor_bps, p.ceiling_bps, p.max_amount, p.max_open_listings, p.max_listings, p.daily_trades, p.daily_listings, p.daily_fills],
        "param_bits": [p.daily_fill_bits, p.craft_bits],
        "listings": c.market_listings(None, None),
        "listing_count": c.market_state().listings,
        "market_accounts": accounts.iter().map(|a| {
            let m = c.market_account(a.clone());
            json!([m.bits, m.trades_left, m.listings_left, m.fills_left, m.fill_bits_left, m.open])
        }).collect::<Vec<_>>(),
        "quote": serde_json::to_value(c.market_quote("crumbs".into(), 3)).unwrap(),
    })
}

#[test]
fn a_v2_state_migrates_to_v3_with_everything_in_place() {
    use crate::migrate::upgrade_state;
    let v2 = busy_v2();
    on_day(alice(), 0, 20_000);
    let before = snapshot(&v2);
    assert_eq!(before["listing_count"], json!(2));
    assert_eq!(
        before["market_accounts"][0][1],
        json!(5),
        "alice traded twice of 7"
    );
    let bytes = as_v2_state(v2);
    assert_ne!(bytes[..4], LAYOUT_V3.to_le_bytes());

    on_day(alice(), 0, 20_000);
    let mut c = upgrade_state(&bytes);
    on_day(alice(), 0, 20_000);
    assert_eq!(snapshot(&c), before);

    // What's new starts empty or at its default, and investing starts switched off:
    // nothing a player can do changes until the owner opens it.
    let d = MarketParams {
        invest_open: false,
        ..Default::default()
    };
    let p = c.market_state().params;
    assert_eq!(p.craft_bits.0, 0, "the live crafting cost carries over");
    on_day(alice(), 0, 20_000);
    assert!(panics(|| {
        c.market_invest("crumbs".into(), U128(100));
    })
    .contains("The vendor isn't taking investors right now"));
    assert_eq!(
        (
            p.invest_open,
            p.invest_fee_bps,
            p.min_invest,
            p.max_invest,
            p.daily_invests,
            p.daily_invest_bits,
            p.invest_lock_ms
        ),
        (
            d.invest_open,
            d.invest_fee_bps,
            d.min_invest,
            d.max_invest,
            d.daily_invests,
            d.daily_invest_bits,
            d.invest_lock_ms
        )
    );
    for pool in c.market_state().pools {
        assert_eq!(
            (
                pool.invested.0,
                pool.rewards.0,
                pool.fee_acc.0,
                pool.fee_carry
            ),
            (0, 0, 0, 0)
        );
    }
    assert!(c.market_investor(alice()).stakes.is_empty());
    assert_eq!(c.get_version().state, 3);
    assert!(c.mt_tokens(None, None).is_empty());
    assert_eq!(c.mt_metadata_contract().name, "With Great Power");
    assert_eq!(
        c.mt_metadata_token_by_token_id(vec!["hero:alice.wgp.testnet".into()])[0]
            .as_ref()
            .unwrap()
            .title
            .as_deref(),
        Some("Peter")
    );

    // The migrated contract carries on: listings fill and cancel, ids continue, the new
    // methods work on the old pools, and old tokens join the index.
    on_day(bob(), 0, 20_000);
    assert_eq!(c.cancel_listing(2).id, 2);
    on_day(bob(), 0, 20_000);
    assert_eq!(c.list_item("fee-bomb".into(), 1, U128(14)).id, 4);
    on_day(carol(), 0, 20_000);
    c.buy_listing(1);
    open_investing(&mut c);
    on_day(alice(), 0, 20_000);
    c.market_invest("crumbs".into(), U128(100));
    on_day(bob(), 0, 20_000);
    c.market_buy("crumbs".into(), 2, U128(100));
    on_day(alice(), 0, 20_001);
    c.market_withdraw("crumbs".into(), U128(100));
    on_day(operator(), 0, 20_001);
    assert_eq!(
        c.index_tokens(vec!["hero:alice.wgp.testnet".into(), "trophy:s0:1".into()]),
        2
    );
    assert_eq!(c.mt_tokens_count().0, 2);
}

#[test]
fn migrate_runs_from_stored_state_and_twice_is_harmless() {
    let v2 = busy_v2();
    on_day(alice(), 0, 20_000);
    let before = snapshot(&v2);
    let bytes = as_v2_state(v2);
    // `upgrade` calls `migrate` as the contract itself, with the old state in storage.
    on_day(contract(), 0, 20_000);
    near_sdk::env::storage_write(b"STATE", &bytes);
    let c = Wgp::migrate();
    assert_eq!(snapshot(&c), before);
    let v3 = near_sdk::borsh::to_vec(&c).unwrap();
    assert_eq!(v3[..4], LAYOUT_V3.to_le_bytes());
    drop(c);

    on_day(contract(), 0, 20_000);
    near_sdk::env::storage_write(b"STATE", &v3);
    let mut again = Wgp::migrate();
    assert_eq!(near_sdk::borsh::to_vec(&again).unwrap(), v3);
    assert_eq!(snapshot(&again), before);

    // Also with v3 state in it: stakes, the index and a metadata row survive a re-run.
    open_investing(&mut again);
    on_day(alice(), 0, 20_000);
    again.market_invest("crumbs".into(), U128(100));
    on_day(operator(), 0, 20_000);
    again.index_tokens(vec!["hero:bob.wgp.testnet".into()]);
    on_day(owner(), 1, 20_000);
    again.set_token_metadata(
        None,
        None,
        vec![(
            "bits".into(),
            Some(TokenMeta {
                title: Some("Bits!".into()),
                ..Default::default()
            }),
        )],
    );
    let with_v3 = near_sdk::borsh::to_vec(&again).unwrap();
    let tokens = again.mt_tokens(None, None);
    drop(again);
    on_day(contract(), 0, 20_000);
    near_sdk::env::storage_write(b"STATE", &with_v3);
    let third = Wgp::migrate();
    assert_eq!(near_sdk::borsh::to_vec(&third).unwrap(), with_v3);
    assert_eq!(stake_of(&third, alice(), "crumbs"), 100);
    assert_eq!(third.mt_tokens(None, None), tokens);
    assert_eq!(
        third.mt_metadata_token_by_token_id(vec!["item:bits".into()])[0]
            .as_ref()
            .unwrap()
            .title
            .as_deref(),
        Some("Bits!")
    );
}

#[test]
fn a_v1_state_migrates_straight_to_v3() {
    use crate::migrate::{upgrade_state, WgpV1};
    use near_sdk::store::{IterableSet, LookupMap};
    let mut v1 = setup();
    with_hero(&mut v1, alice());
    mint(&mut v1, reward(alice(), 1, vec![ing("crumbs", 2)], Some(2)));
    v1.tokens.clear();
    v1.tokens.flush();
    v1.players.flush();
    v1.supply.flush();
    let old = WgpV1 {
        owner_id: v1.owner_id.clone(),
        operators: std::mem::replace(&mut v1.operators, IterableSet::new(b"x".to_vec())),
        paused: false,
        items: v1.items.clone(),
        suits: v1.suits.clone(),
        starter_unlock_level: 2,
        players: std::mem::replace(&mut v1.players, LookupMap::new(b"y".to_vec())),
        supply: std::mem::replace(&mut v1.supply, LookupMap::new(b"z".to_vec())),
        seasons: std::mem::replace(&mut v1.seasons, LookupMap::new(b"w".to_vec())),
    };
    let bytes = near_sdk::borsh::to_vec(&old).unwrap();
    let c = upgrade_state(&bytes);
    assert_eq!(bal(&c, alice(), "item:crumbs"), 2);
    assert!(c.market_state().pools.is_empty());
    assert_eq!(c.market_state().params, MarketParams::default());
    assert_eq!(c.get_version().state, 3);
}

#[test]
fn upgrading_again_after_a_rollback_brings_the_index_and_metadata_back() {
    use crate::migrate::{upgrade_state, V3_TAIL_KEY};
    // A v3 contract with an index and a metadata row...
    let mut c = busy_v2();
    on_day(owner(), 1, 20_000);
    c.set_token_metadata(
        Some("WGP".into()),
        None,
        vec![(
            "bits".into(),
            Some(TokenMeta {
                title: Some("Bits!".into()),
                ..Default::default()
            }),
        )],
    );
    let tokens = c.mt_tokens(None, None);
    assert!(tokens.len() > 8);
    on_day(alice(), 0, 20_000);
    let before = snapshot(&c);
    // ...rolled back as contracts/wgp/rollback does it: the root in the v2 layout, the
    // index and metadata roots set aside under V3TAIL, their entries left in storage.
    c.tokens.flush();
    c.meta.table.flush();
    let mut tail = near_sdk::borsh::to_vec(&c.tokens).unwrap();
    tail.extend(near_sdk::borsh::to_vec(&c.meta).unwrap());
    let v2 = to_v2_layout(c);
    on_day(contract(), 0, 20_000);
    near_sdk::env::storage_write(V3_TAIL_KEY, &tail);

    let again = upgrade_state(&v2);
    assert!(!near_sdk::env::storage_has_key(V3_TAIL_KEY));
    assert_eq!(again.mt_tokens(None, None), tokens);
    assert_eq!(again.mt_metadata_contract().name, "WGP");
    assert_eq!(
        again.mt_metadata_token_by_token_id(vec!["item:bits".into()])[0]
            .as_ref()
            .unwrap()
            .title
            .as_deref(),
        Some("Bits!")
    );
    on_day(alice(), 0, 20_000);
    assert_eq!(snapshot(&again), before);

    // Rubbish left there stops the upgrade instead of being guessed at.
    let v2 = as_v2_state(again);
    on_day(contract(), 0, 20_000);
    near_sdk::env::storage_write(V3_TAIL_KEY, &[1, 2, 3]);
    assert!(panics(|| {
        upgrade_state(&v2);
    })
    .contains("set aside doesn't parse"));
}

#[test]
fn the_owner_can_send_stakes_home() {
    let mut c = market();
    fund(&mut c, alice(), 300, vec![]);
    fund(&mut c, bob(), 300, vec![]);
    fund(&mut c, carol(), 0, vec![("crumbs", 20)]);
    at(alice(), 1_000);
    c.market_invest("crumbs".into(), U128(200));
    at(bob(), 1_000);
    c.market_invest("crumbs".into(), U128(100));
    at(carol(), 1_000);
    c.market_sell("crumbs".into(), 20, U128(0));
    let owed = earned_of(&c, alice(), "crumbs");

    at(alice(), 1_000);
    assert!(panics(|| {
        c.market_refund("crumbs".into(), vec![alice()]);
    })
    .contains("yoctoNEAR"));
    as_(alice(), 1);
    assert!(panics(|| {
        c.market_refund("crumbs".into(), vec![alice()]);
    })
    .contains("Only the owner"));
    as_(owner(), 1);
    assert!(panics(|| {
        c.market_refund("crumbs".into(), vec![]);
    })
    .contains("1 to 20"));

    // Still inside the lock: the owner's refund goes through anyway, to the investors.
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract())
        .predecessor_account_id(owner())
        .attached_deposit(NearToken::from_yoctonear(1))
        .block_timestamp(2_000 * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
    let out = c.market_refund("crumbs".into(), vec![alice(), carol(), bob()]);
    assert_eq!(out.len(), 2, "carol has no stake and is skipped");
    assert_eq!(
        (out[0].bits.0, out[0].earned.0, out[0].stake.0),
        (200, owed, 0)
    );
    assert_eq!(bal(&c, alice(), BITS_TOKEN), 300 + owed);
    assert!(bal(&c, bob(), BITS_TOKEN) >= 300);
    assert_eq!(bal(&c, owner(), BITS_TOKEN), 0);
    let p = pool(&c, "crumbs");
    assert_eq!((p.invested.0, p.rewards.0, p.virtual_bits.0), (0, 0, 480));
    assert!(events()
        .last()
        .unwrap()
        .contains(r#""action":"market_refund""#));
    assert_books(&c, &[alice(), bob(), carol()]);
}

#[test]
fn a_state_in_no_known_layout_is_refused() {
    use crate::migrate::upgrade_state;
    as_(contract(), 0);
    for bytes in [vec![], vec![1, 2, 3], vec![7; 200]] {
        assert!(panics(|| {
            upgrade_state(&bytes);
        })
        .contains("no known layout"));
    }
    // The v3 tag with rubbish after it is refused too, not guessed at.
    let mut bytes = LAYOUT_V3.to_le_bytes().to_vec();
    bytes.extend([9; 40]);
    assert!(panics(|| {
        upgrade_state(&bytes);
    })
    .contains("v3 contract state doesn't parse"));
    // And a v2 state cut short or with bytes added.
    let v2 = as_v2_state(busy_v2());
    as_(contract(), 0);
    assert!(panics(|| {
        upgrade_state(&v2[..v2.len() - 1]);
    })
    .contains("no known layout"));
    let mut longer = v2.clone();
    longer.push(0);
    assert!(panics(|| {
        upgrade_state(&longer);
    })
    .contains("no known layout"));
}

/// `token-metadata-args.json` is what `scripts/near/token-metadata.mjs` prints: the owner's
/// `set_token_metadata` arguments. It must parse, fit one call and name every token.
#[test]
fn the_shipped_metadata_table_applies() {
    #[derive(near_sdk::serde::Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    struct Args {
        name: Option<String>,
        base_uri: Option<String>,
        entries: Vec<(String, Option<TokenMeta>)>,
    }
    let args: Args = serde_json::from_str(include_str!("../token-metadata-args.json")).unwrap();
    let mut c = one_of_each();
    mint(
        &mut c,
        RewardMint {
            account_id: alice(),
            nonce: 2,
            items: vec![],
            level: None,
            badges: vec!["brand-new".into()],
            digest: DIGEST.into(),
        },
    );
    c.meta.table.flush();
    let before = near_sdk::env::storage_usage();
    as_(owner(), 1);
    c.set_token_metadata(args.name, args.base_uri, args.entries);
    c.meta.table.flush();
    println!(
        "METADATA_TABLE_STORAGE_BYTES={}",
        near_sdk::env::storage_usage() - before
    );

    let (items, suits) = rules();
    let mut ids: Vec<String> = items.iter().map(|i| format!("item:{i}")).collect();
    ids.extend(suits.iter().map(|s| format!("suit:{}", s.id)));
    ids.extend(
        [
            "item:bits",
            "hero:alice.wgp.testnet",
            "trophy:badge:day-one",
        ]
        .map(String::from),
    );
    let base = "https://www.wgponnear.fun/tokens/";
    for (id, m) in ids.iter().zip(c.mt_metadata_token_by_token_id(ids.clone())) {
        let m = m.unwrap_or_else(|| panic!("{id} has no metadata"));
        assert!(m.media.as_ref().unwrap().starts_with(base), "{id}");
        assert_eq!(m.media_hash.as_ref().map(String::len), Some(44), "{id}");
        assert!(m.title.is_some() && m.description.is_some(), "{id}");
    }
    let m = c.mt_metadata_token_by_token_id(vec![
        "item:fee-bomb".into(),
        "hero:alice.wgp.testnet".into(),
        "trophy:badge:brand-new".into(),
        "trophy:s1:1".into(),
    ]);
    let bomb = m[0].as_ref().unwrap();
    assert_eq!(bomb.title.as_deref(), Some("Fee bomb"));
    assert!(bomb
        .description
        .as_ref()
        .unwrap()
        .starts_with("Defused. Mostly."));
    // The hero keeps its own name; a badge with no picture yet shows the shared one.
    assert_eq!(m[1].as_ref().unwrap().title.as_deref(), Some("Peter"));
    let badge = m[2].as_ref().unwrap();
    assert_eq!(badge.title.as_deref(), Some("Brand new badge"));
    assert_eq!(
        badge.media.as_deref(),
        Some("https://www.wgponnear.fun/tokens/badge.png")
    );
    assert_eq!(
        m[3].as_ref().unwrap().media.as_deref(),
        Some("https://www.wgponnear.fun/tokens/trophy/1.png")
    );
}
