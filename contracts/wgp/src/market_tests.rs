//! Unit tests for the Mempool Market: the curve (monotonic, no free round trips), slippage
//! bounds, the burned fee, escrow, the listing floor and ceiling, daily caps, pagination,
//! session-key calls with no deposit, the craft sink, Bits rewards, storage per account,
//! the v1 → v2 migration, and the vectors shared with the TypeScript mirror.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, Gas, NearToken};

use crate::market::*;
use crate::tests::*;
use crate::{RewardStatus, Wgp};

const DAY_NS: u64 = 86_400_000_000_000;

fn carol() -> AccountId {
    "carol.wgp.testnet".parse().unwrap()
}

/// `who` calling with `deposit` on UTC day `day` (since the epoch).
fn on_day(who: AccountId, deposit: u128, day: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract())
        .predecessor_account_id(who)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(day * DAY_NS + 1_000)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
}

fn pool_cfg(item: &str, vb: u128, vi: u128, sb: u128, ss: u128) -> PoolConfig {
    PoolConfig {
        item: item.into(),
        virtual_bits: U128(vb),
        virtual_items: U128(vi),
        seed_bits: U128(sb),
        seed_stock: U128(ss),
    }
}

/// The default curves by rarity, as in apps/wgp/src/lib/market/config.ts: commons at
/// 12 Bits, uncommons at 40, rares at 150.
fn default_pools() -> Vec<PoolConfig> {
    vec![
        pool_cfg("crumbs", 480, 40, 480, 40),
        pool_cfg("fee-bomb", 480, 40, 480, 40),
        pool_cfg("sybil-goo", 800, 20, 800, 20),
        pool_cfg("goblin-glider", 1200, 8, 1200, 8),
    ]
}

fn open_market(params: MarketParams) -> Wgp {
    let mut c = setup();
    as_(owner(), 1);
    c.set_market_params(params, default_pools());
    c
}

fn market() -> Wgp {
    open_market(MarketParams::default())
}

/// Mints Bits and items to `who` as one reward.
fn fund(c: &mut Wgp, who: AccountId, bits: u32, items: Vec<(&str, u32)>) {
    let nonce = c.reward_nonce(who.clone()) + 1;
    let mut list = if bits > 0 {
        vec![ing("bits", bits)]
    } else {
        vec![]
    };
    list.extend(items.into_iter().map(|(i, n)| ing(i, n)));
    assert_eq!(
        mint(c, reward(who, nonce, list, None)),
        RewardStatus::Applied
    );
}

fn pool(c: &Wgp, item: &str) -> Pool {
    c.market_state()
        .pools
        .into_iter()
        .find(|p| p.item == item)
        .unwrap()
}

fn panics(f: impl FnOnce()) -> String {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    match r {
        Ok(_) => panic!("expected a panic"),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default(),
    }
}

// ---------- The curve ----------

fn p(vb: u128, vi: u128, bits: u128, stock: u128) -> Pool {
    Pool {
        item: "x".into(),
        virtual_bits: U128(vb),
        virtual_items: U128(vi),
        bits: U128(bits),
        stock: U128(stock),
        escrow: U128(0),
    }
}

#[test]
fn buying_raises_the_price_and_selling_lowers_it() {
    for start in [
        p(480, 40, 480, 40),
        p(800, 20, 800, 20),
        p(1200, 8, 1200, 8),
        p(3, 1, 0, 5),
    ] {
        let mut q = start.clone();
        let mut last = spot_milli(&q);
        while let Some(cost) = buy_cost(&q, 1) {
            apply_buy(&mut q, 1, cost);
            let now = spot_milli(&q);
            assert!(now > last, "a buy must raise the price: {last} -> {now}");
            last = now;
        }
        let mut q = start.clone();
        let mut last = spot_milli(&q);
        for _ in 0..40 {
            let payout = sell_payout(&q, 1);
            if payout == 0 || payout > q.bits.0 {
                break;
            }
            apply_sell(&mut q, 1, payout);
            let now = spot_milli(&q);
            assert!(now < last, "a sell must lower the price: {last} -> {now}");
            last = now;
        }
    }
}

#[test]
fn bigger_orders_cost_more_per_item() {
    let q = p(480, 40, 480, 40);
    let mut last_total = 0;
    let mut last_marginal = 0;
    for n in 1..=40 {
        let total = buy_cost(&q, n).unwrap();
        assert!(total > last_total);
        let marginal = total - last_total;
        assert!(
            marginal + 1 >= last_marginal,
            "marginal cost never falls (n={n})"
        );
        last_total = total;
        last_marginal = marginal;
        // Selling more pays less per item (up to a Bit of rounding).
        if n > 1 {
            let per = |k: u128| sell_payout(&q, k) as f64 / k as f64;
            assert!(per(n) <= per(n - 1) + 1.0, "n={n}");
        }
    }
    assert_eq!(buy_cost(&q, 41), None, "the vendor sells only its stock");
    assert_eq!(buy_cost(&q, 0), None);
}

#[test]
fn a_round_trip_never_profits() {
    for start in [
        p(480, 40, 480, 40),
        p(800, 20, 800, 20),
        p(1200, 8, 1200, 8),
        p(7, 3, 2, 9),
    ] {
        for n in 1..=start.stock.0 {
            let mut q = start.clone();
            let cost = buy_cost(&q, n).unwrap();
            apply_buy(&mut q, n, cost);
            let back = sell_payout(&q, n);
            assert!(back <= cost, "buy {n} for {cost}, sell back for {back}");
            for bps in [0, 200] {
                assert!(back - fee_of(back, bps).min(back) <= cost + fee_of(cost, bps));
            }
        }
    }
}

#[test]
fn the_fee_rounds_up() {
    assert_eq!(fee_of(0, 200), 0);
    assert_eq!(fee_of(1, 200), 1);
    assert_eq!(fee_of(50, 200), 1);
    assert_eq!(fee_of(51, 200), 2);
    assert_eq!(fee_of(1000, 200), 20);
    assert_eq!(fee_of(1000, 0), 0);
}

/// The cases apps/wgp/src/lib/market/math.test.ts checks too: same inputs, same outputs.
#[test]
fn the_shared_vectors_match() {
    let v: Value = serde_json::from_str(include_str!("../market-vectors.json")).unwrap();
    let n = |v: &Value| v.as_str().unwrap().parse::<u128>().unwrap();
    let pool_of = |v: &Value| {
        p(
            n(&v["virtual_bits"]),
            n(&v["virtual_items"]),
            n(&v["bits"]),
            n(&v["stock"]),
        )
    };
    let cases = v["cases"].as_array().unwrap();
    assert!(cases.len() >= 20);
    for case in cases {
        let q = pool_of(&case["pool"]);
        let amount = case["amount"].as_u64().unwrap() as u128;
        let fee = case["fee_bps"].as_u64().unwrap() as u32;
        assert_eq!(spot_milli(&q), n(&case["spot_milli"]), "{case}");
        let cost = buy_cost(&q, amount);
        assert_eq!(
            cost.map(|c| c.to_string()),
            case["buy_cost"].as_str().map(String::from),
            "{case}"
        );
        if let Some(c) = cost {
            assert_eq!(fee_of(c, fee), n(&case["buy_fee"]), "{case}");
        }
        let payout = sell_payout(&q, amount);
        assert_eq!(payout, n(&case["sell_payout"]), "{case}");
        assert_eq!(fee_of(payout, fee), n(&case["sell_fee"]), "{case}");
        let (lo, hi) = listing_bounds(
            &q,
            amount,
            case["floor_bps"].as_u64().unwrap() as u32,
            case["ceiling_bps"].as_u64().unwrap() as u32,
        );
        assert_eq!((lo, hi), (n(&case["floor"]), n(&case["ceiling"])), "{case}");
    }
    let sequences = v["sequences"].as_array().unwrap();
    assert!(!sequences.is_empty());
    for seq in sequences {
        let mut q = pool_of(&seq["pool"]);
        let fee = seq["fee_bps"].as_u64().unwrap() as u32;
        for step in seq["steps"].as_array().unwrap() {
            let amount = step["amount"].as_u64().unwrap() as u128;
            let (bits, fee_paid) = if step["side"] == "buy" {
                let c = buy_cost(&q, amount).unwrap();
                apply_buy(&mut q, amount, c);
                (c + fee_of(c, fee), fee_of(c, fee))
            } else {
                let pay = sell_payout(&q, amount);
                apply_sell(&mut q, amount, pay);
                (pay - fee_of(pay, fee), fee_of(pay, fee))
            };
            assert_eq!(bits, n(&step["bits"]), "{step}");
            assert_eq!(fee_paid, n(&step["fee"]), "{step}");
            assert_eq!(q.bits.0, n(&step["after"]["bits"]), "{step}");
            assert_eq!(q.stock.0, n(&step["after"]["stock"]), "{step}");
            assert_eq!(spot_milli(&q), n(&step["spot_milli"]), "{step}");
        }
    }
}

/// Regenerates market-vectors.json from this implementation:
/// `cargo test print_market_vectors -- --ignored --nocapture > /tmp/v.txt`.
#[test]
#[ignore]
fn print_market_vectors() {
    let pool_json = |q: &Pool| json!({"virtual_bits": q.virtual_bits, "virtual_items": q.virtual_items, "bits": q.bits, "stock": q.stock});
    let pools = [
        p(480, 40, 480, 40),
        p(800, 20, 800, 20),
        p(1200, 8, 1200, 8),
        p(3, 1, 0, 5),
        p(1_000_000, 997, 12_345, 3),
    ];
    let mut cases = Vec::new();
    for q in &pools {
        for amount in [1u128, 2, 3, 5, 8, 13, 20] {
            for (fee, floor, ceiling) in [
                (200u32, 5_000u32, 40_000u32),
                (0, 10_000, 10_000),
                (1_000, 2_500, 15_000),
            ] {
                let cost = buy_cost(q, amount);
                let payout = sell_payout(q, amount);
                let (lo, hi) = listing_bounds(q, amount, floor, ceiling);
                cases.push(json!({
                    "pool": pool_json(q), "amount": amount as u64, "fee_bps": fee, "floor_bps": floor, "ceiling_bps": ceiling,
                    "spot_milli": spot_milli(q).to_string(),
                    "buy_cost": cost.map(|c| c.to_string()),
                    "buy_fee": cost.map(|c| fee_of(c, fee).to_string()).unwrap_or_else(|| "0".into()),
                    "sell_payout": payout.to_string(), "sell_fee": fee_of(payout, fee).to_string(),
                    "floor": lo.to_string(), "ceiling": hi.to_string(),
                }));
            }
        }
    }
    let mut sequences = Vec::new();
    let mut seed: u64 = 0x5eed;
    for start in &pools[..3] {
        let fee = 200;
        let mut q = start.clone();
        let mut steps = Vec::new();
        while steps.len() < 40 {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let amount = ((seed >> 33) % 6 + 1) as u128;
            let buy = (seed >> 13).is_multiple_of(2);
            let (bits, f) = if buy {
                let Some(c) = buy_cost(&q, amount) else {
                    continue;
                };
                apply_buy(&mut q, amount, c);
                (c + fee_of(c, fee), fee_of(c, fee))
            } else {
                let pay = sell_payout(&q, amount);
                if pay == 0 || pay > q.bits.0 {
                    continue;
                }
                apply_sell(&mut q, amount, pay);
                (pay - fee_of(pay, fee), fee_of(pay, fee))
            };
            steps.push(json!({
                "side": if buy { "buy" } else { "sell" }, "amount": amount as u64,
                "bits": bits.to_string(), "fee": f.to_string(),
                "after": {"bits": q.bits, "stock": q.stock}, "spot_milli": spot_milli(&q).to_string(),
            }));
        }
        sequences.push(json!({"pool": pool_json(start), "fee_bps": fee, "steps": steps}));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "about": "Mempool Market curve cases. contracts/wgp/src/market_tests.rs and apps/wgp/src/lib/market/math.test.ts both check these; regenerate with `cargo test print_market_vectors -- --ignored --nocapture`.",
            "cases": cases,
            "sequences": sequences,
        }))
        .unwrap()
    );
}

// ---------- Setup ----------

#[test]
fn seeding_a_pool_mints_to_the_vendor() {
    let c = market();
    let crumbs = pool(&c, "crumbs");
    assert_eq!((crumbs.stock, crumbs.bits), (U128(40), U128(480)));
    assert_eq!(bal(&c, contract(), "item:crumbs"), 40);
    // The vendor's till across every pool.
    assert_eq!(bal(&c, contract(), "item:bits"), 480 + 480 + 800 + 1200);
    assert_eq!(c.mt_supply("item:bits".into()), Some(U128(2960)));
    let state = c.market_state();
    assert_eq!(state.vendor, contract());
    assert_eq!(state.prices_milli[0], U128(12_000));
    assert_eq!(state.prices_milli[3], U128(150_000));
}

#[test]
fn updating_a_pool_keeps_its_holdings() {
    let mut c = market();
    as_(owner(), 1);
    c.set_market_params(
        MarketParams::default(),
        vec![pool_cfg("crumbs", 960, 40, 9_999, 9_999)],
    );
    let crumbs = pool(&c, "crumbs");
    assert_eq!(
        (crumbs.virtual_bits, crumbs.stock, crumbs.bits),
        (U128(960), U128(40), U128(480))
    );
    assert_eq!(
        c.mt_supply("item:crumbs".into()),
        Some(U128(40)),
        "no second seed"
    );
    assert_eq!(c.market_state().pools.len(), 4, "pools are never dropped");
}

#[test]
fn market_params_need_the_owner_and_one_yocto() {
    for (who, deposit) in [(alice(), 1), (owner(), 0)] {
        let mut c = setup();
        as_(who, deposit);
        panics(|| c.set_market_params(MarketParams::default(), default_pools()));
        assert!(c.market_state().pools.is_empty());
    }
    let bad: Vec<(MarketParams, Vec<PoolConfig>)> = vec![
        (
            MarketParams {
                fee_bps: 1_001,
                ..Default::default()
            },
            vec![],
        ),
        (
            MarketParams {
                floor_bps: 50_000,
                ..Default::default()
            },
            vec![],
        ),
        (
            MarketParams {
                max_amount: 0,
                ..Default::default()
            },
            vec![],
        ),
        (MarketParams::default(), vec![pool_cfg("gold", 1, 1, 0, 0)]),
        (MarketParams::default(), vec![pool_cfg("bits", 1, 1, 0, 0)]),
        (
            MarketParams::default(),
            vec![pool_cfg("crumbs", 0, 1, 0, 0)],
        ),
        (
            MarketParams::default(),
            vec![
                pool_cfg("crumbs", 1, 1, 0, 0),
                pool_cfg("crumbs", 1, 1, 0, 0),
            ],
        ),
    ];
    for (params, pools) in bad {
        let mut c = setup();
        as_(owner(), 1);
        panics(|| c.set_market_params(params, pools));
    }
}

// ---------- Vendor trades ----------

#[test]
fn a_buy_moves_bits_and_items_and_burns_the_fee() {
    let mut c = market();
    fund(&mut c, alice(), 100, vec![]);
    let before = pool(&c, "crumbs");
    as_(alice(), 0);
    let t = c.market_buy("crumbs".into(), 3, U128(39));
    // ceil(960 * 3 / 77) = 38, fee ceil(0.76) = 1.
    assert_eq!((t.bits, t.fee), (U128(39), U128(1)));
    assert_eq!(bal(&c, alice(), "item:bits"), 61);
    assert_eq!(bal(&c, alice(), "item:crumbs"), 3);
    let after = pool(&c, "crumbs");
    assert_eq!(after.stock.0, before.stock.0 - 3);
    assert_eq!(after.bits.0, before.bits.0 + 38);
    assert_eq!(t.pool, after);
    // The fee left the supply; the cost moved to the vendor.
    assert_eq!(c.mt_supply("item:bits".into()), Some(U128(2960 + 100 - 1)));
    assert_eq!(
        events(),
        vec![
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_transfer","data":[{"old_owner_id":"alice.wgp.testnet","new_owner_id":"game.wgp.testnet","token_ids":["item:bits"],"amounts":["38"],"memo":"market"},{"old_owner_id":"game.wgp.testnet","new_owner_id":"alice.wgp.testnet","token_ids":["item:crumbs"],"amounts":["3"],"memo":"market"}]}"#,
            r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_burn","data":[{"owner_id":"alice.wgp.testnet","token_ids":["item:bits"],"amounts":["1"],"memo":"gas-fee"}]}"#,
            r#"EVENT_JSON:{"standard":"wgp","version":"1.0.0","event":"market_trade","data":[{"account_id":"alice.wgp.testnet","side":"buy","item":"crumbs","amount":3,"bits":"39","fee":"1","price_milli":"12961"}]}"#,
        ]
    );
}

#[test]
fn prices_follow_the_players() {
    let mut c = market();
    fund(&mut c, alice(), 1_000, vec![("crumbs", 20)]);
    let p0 = spot_milli(&pool(&c, "crumbs"));
    as_(alice(), 0);
    c.market_buy("crumbs".into(), 10, U128(1_000));
    let p1 = spot_milli(&pool(&c, "crumbs"));
    assert!(p1 > p0, "buying raised the price: {p0} -> {p1}");
    as_(alice(), 0);
    let t = c.market_sell("crumbs".into(), 20, U128(0));
    let p2 = spot_milli(&pool(&c, "crumbs"));
    assert!(p2 < p1 && p2 < p0, "selling lowered it: {p1} -> {p2}");
    assert_eq!(t.pool.stock, U128(50));
    // The till paid the payout; the player got it less the fee.
    assert_eq!(bal(&c, alice(), "item:crumbs"), 10);
}

#[test]
fn slippage_limits_are_enforced() {
    let mut c = market();
    fund(&mut c, alice(), 500, vec![("crumbs", 5)]);
    as_(alice(), 0);
    let msg = panics(|| {
        c.market_buy("crumbs".into(), 3, U128(38));
    });
    assert!(
        msg.contains("That costs 39 Bits now, over your limit of 38"),
        "{msg}"
    );
    let q = pool(&c, "crumbs");
    let pay = sell_payout(&q, 5);
    let net = pay - fee_of(pay, 200);
    as_(alice(), 0);
    let msg = panics(|| {
        c.market_sell("crumbs".into(), 5, U128(net + 1));
    });
    assert!(msg.contains("under your limit"), "{msg}");
    as_(alice(), 0);
    let t = c.market_sell("crumbs".into(), 5, U128(net));
    assert_eq!(t.bits, U128(net));
    assert_eq!(bal(&c, alice(), "item:bits"), 500 + net);
}

#[test]
fn the_vendor_sells_only_its_stock_and_pays_only_from_its_till() {
    let mut c = open_market(MarketParams {
        max_amount: 1_000,
        ..Default::default()
    });
    fund(&mut c, alice(), 1_000, vec![("goblin-glider", 500)]);
    as_(alice(), 0);
    let msg = panics(|| {
        c.market_buy("goblin-glider".into(), 9, U128(1_000_000));
    });
    assert!(msg.contains("The vendor has only 8 goblin-glider"), "{msg}");
    as_(alice(), 0);
    let msg = panics(|| {
        c.market_sell("goblin-glider".into(), 500, U128(0));
    });
    assert!(msg.contains("till holds only 1200 Bits"), "{msg}");
}

#[test]
fn trades_need_bits_items_a_pool_and_an_open_market() {
    let mut c = market();
    fund(&mut c, alice(), 5, vec![]);
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_buy("crumbs".into(), 1, U128(100));
    })
    .contains("Needs 14 Bits"));
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_sell("crumbs".into(), 1, U128(0));
    })
    .contains("Not enough item:crumbs"));
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_buy("press-pass".into(), 1, U128(100));
    })
    .contains("doesn't trade press-pass"));
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_buy("crumbs".into(), 21, U128(1_000));
    })
    .contains("Trade 1 to 20"));

    let mut closed = open_market(MarketParams {
        open: false,
        ..Default::default()
    });
    fund(&mut closed, alice(), 100, vec![]);
    as_(alice(), 0);
    assert!(panics(|| {
        closed.market_buy("crumbs".into(), 1, U128(100));
    })
    .contains("The market is closed"));

    as_(owner(), 1);
    c.set_paused(true);
    as_(alice(), 0);
    assert!(panics(|| {
        c.market_buy("crumbs".into(), 1, U128(100));
    })
    .contains("paused"));
}

// ---------- Session keys and the 1-yocto rule ----------

#[test]
fn market_calls_work_with_no_deposit() {
    // A session key can't attach a deposit; every market method works without one.
    let mut c = market();
    fund(&mut c, alice(), 500, vec![("crumbs", 6)]);
    as_(alice(), 0);
    c.market_buy("crumbs".into(), 1, U128(100));
    as_(alice(), 0);
    c.market_sell("crumbs".into(), 1, U128(0));
    as_(alice(), 0);
    let l = c.list_item("crumbs".into(), 2, U128(20));
    as_(alice(), 0);
    c.cancel_listing(l.id);
    as_(alice(), 0);
    let l = c.list_item("crumbs".into(), 2, U128(20));
    fund(&mut c, bob(), 100, vec![]);
    as_(bob(), 0);
    c.buy_listing(l.id);
    assert_eq!(bal(&c, bob(), "item:crumbs"), 2);
    // None of them is payable: the generated wasm entry points refuse a deposit, which
    // only shows on a real runtime (sandbox.rs checks it).
}

#[test]
fn moving_bits_still_needs_one_yocto() {
    let mut c = market();
    fund(&mut c, alice(), 100, vec![]);
    as_(alice(), 0);
    panics(|| c.mt_transfer(bob(), "item:bits".into(), U128(10), None, None));
    assert_eq!(bal(&c, alice(), "item:bits"), 100);
    as_(alice(), 1);
    c.mt_transfer(bob(), "item:bits".into(), U128(10), None, None);
    assert_eq!(bal(&c, bob(), "item:bits"), 10);
}

// ---------- Listings ----------

#[test]
fn escrow_round_trip() {
    let mut c = market();
    fund(&mut c, alice(), 0, vec![("crumbs", 5)]);
    as_(alice(), 0);
    let l = c.list_item("crumbs".into(), 4, U128(40));
    assert_eq!(bal(&c, alice(), "item:crumbs"), 1);
    assert_eq!(
        bal(&c, contract(), "item:crumbs"),
        40 + 4,
        "stock plus escrow"
    );
    assert_eq!(pool(&c, "crumbs").escrow, U128(4));
    assert_eq!(c.market_listing(l.id), Some(l.clone()));
    assert_eq!(c.market_account(alice()).open, vec![l.id]);

    // Cancel: the items come back.
    as_(alice(), 0);
    c.cancel_listing(l.id);
    assert_eq!(bal(&c, alice(), "item:crumbs"), 5);
    assert_eq!(pool(&c, "crumbs").escrow, U128(0));
    assert!(c.market_listing(l.id).is_none());
    assert!(c.market_account(alice()).open.is_empty());

    // Fill: Bits to the seller less the fee, items to the buyer.
    as_(alice(), 0);
    let l = c.list_item("crumbs".into(), 4, U128(40));
    fund(&mut c, bob(), 50, vec![]);
    let supply = c.mt_supply("item:bits".into()).unwrap().0;
    as_(bob(), 0);
    c.buy_listing(l.id);
    assert_eq!(bal(&c, bob(), "item:crumbs"), 4);
    assert_eq!(bal(&c, bob(), "item:bits"), 10);
    assert_eq!(bal(&c, alice(), "item:bits"), 40 - 1);
    assert_eq!(c.mt_supply("item:bits".into()), Some(U128(supply - 1)));
    assert_eq!(pool(&c, "crumbs").escrow, U128(0));
    assert!(c.market_account(alice()).open.is_empty());
    let fill = events().pop().unwrap();
    assert!(
        fill.contains(r#""event":"market_fill""#) && fill.contains(r#""fee":"1""#),
        "{fill}"
    );
}

#[test]
fn listings_are_guarded() {
    let mut c = market();
    fund(&mut c, alice(), 100, vec![("crumbs", 10)]);
    // Spot is 12 Bits: a lot of 2 lists between 12 (50%) and 96 (400%).
    let q = c.market_quote("crumbs".into(), 2);
    assert_eq!((q.floor, q.ceiling), (U128(12), U128(96)));
    for (price, ok) in [(11, false), (12, true), (96, true), (97, false)] {
        as_(alice(), 0);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.list_item("crumbs".into(), 2, U128(price))
        }));
        assert_eq!(r.is_ok(), ok, "price {price}");
        if let Ok(l) = r {
            as_(alice(), 0);
            c.cancel_listing(l.id);
        }
    }
    as_(alice(), 0);
    let l = c.list_item("crumbs".into(), 2, U128(20));
    as_(alice(), 0);
    assert!(panics(|| {
        c.buy_listing(l.id);
    })
    .contains("your own listing"));
    as_(bob(), 0);
    assert!(panics(|| {
        c.cancel_listing(l.id);
    })
    .contains("Only the seller"));
    as_(bob(), 0);
    assert!(panics(|| {
        c.buy_listing(l.id);
    })
    .contains("Needs 20 Bits"));
    as_(bob(), 0);
    assert!(panics(|| {
        c.buy_listing(999);
    })
    .contains("listing is gone"));
}

#[test]
fn open_listings_are_capped_per_account_and_overall() {
    let mut c = open_market(MarketParams {
        max_listings: 4,
        ..Default::default()
    });
    fund(&mut c, alice(), 0, vec![("crumbs", 10)]);
    fund(&mut c, bob(), 0, vec![("crumbs", 10)]);
    for _ in 0..3 {
        as_(alice(), 0);
        c.list_item("crumbs".into(), 1, U128(10));
    }
    as_(alice(), 0);
    assert!(panics(|| {
        c.list_item("crumbs".into(), 1, U128(10));
    })
    .contains("3 listings open"));
    as_(bob(), 0);
    c.list_item("crumbs".into(), 1, U128(10));
    as_(bob(), 0);
    assert!(panics(|| {
        c.list_item("crumbs".into(), 1, U128(10));
    })
    .contains("market is full"));
}

#[test]
fn daily_caps_reset_at_midnight_utc() {
    let params = MarketParams {
        daily_trades: 2,
        daily_listings: 2,
        daily_fills: 2,
        daily_fill_bits: U128(50),
        max_open_listings: 10,
        ..Default::default()
    };
    let mut c = open_market(params);
    fund(&mut c, alice(), 1_000, vec![("crumbs", 10)]);
    fund(&mut c, bob(), 1_000, vec![("crumbs", 10)]);

    // Vendor trades: 2 a day.
    for _ in 0..2 {
        on_day(alice(), 0, 20_000);
        c.market_buy("crumbs".into(), 1, U128(100));
    }
    on_day(alice(), 0, 20_000);
    assert!(panics(|| {
        c.market_sell("crumbs".into(), 1, U128(0));
    })
    .contains("Daily market limit"));
    assert_eq!(c.market_account(alice()).trades_left, 0);

    // Listings: 2 a day.
    let mut ids = Vec::new();
    for _ in 0..2 {
        on_day(bob(), 0, 20_000);
        ids.push(c.list_item("crumbs".into(), 1, U128(20)).id);
    }
    on_day(bob(), 0, 20_000);
    panics(|| {
        c.list_item("crumbs".into(), 1, U128(20));
    });

    // Fills: Bits per day cap (50): two 20-Bit fills fit, a third would pass 2 anyway.
    on_day(alice(), 0, 20_000);
    c.buy_listing(ids[0]);
    on_day(bob(), 0, 20_000);
    ids.push({
        on_day(carol(), 0, 20_000);
        fund(&mut c, carol(), 0, vec![("crumbs", 5)]);
        on_day(carol(), 0, 20_000);
        c.list_item("crumbs".into(), 2, U128(40)).id
    });
    on_day(alice(), 0, 20_000);
    assert!(
        panics(|| {
            c.buy_listing(ids[2]);
        })
        .contains("Daily market limit"),
        "20 + 40 Bits is over the 50 a day"
    );
    on_day(alice(), 0, 20_000);
    c.buy_listing(ids[1]);

    // The next UTC day starts fresh.
    on_day(alice(), 0, 20_001);
    let view = c.market_account(alice());
    assert_eq!(
        (view.trades_left, view.fills_left, view.fill_bits_left),
        (2, 2, U128(50))
    );
    on_day(alice(), 0, 20_001);
    c.market_sell("crumbs".into(), 1, U128(0));
    on_day(alice(), 0, 20_001);
    c.buy_listing(ids[2]);
}

#[test]
fn listings_page() {
    let mut c = open_market(MarketParams {
        daily_listings: 50,
        max_open_listings: 10,
        ..Default::default()
    });
    let sellers: Vec<AccountId> = (0..4)
        .map(|i| format!("s{i}.wgp.testnet").parse().unwrap())
        .collect();
    for s in &sellers {
        fund(&mut c, s.clone(), 0, vec![("crumbs", 10)]);
        for _ in 0..3 {
            as_(s.clone(), 0);
            c.list_item("crumbs".into(), 1, U128(10));
        }
    }
    assert_eq!(c.market_state().listings, 12);
    let mut seen = Vec::new();
    let mut from = 0;
    loop {
        let page = c.market_listings(Some(from), Some(5));
        if page.is_empty() {
            break;
        }
        assert!(page.len() <= 5);
        from += page.len() as u32;
        seen.extend(page.into_iter().map(|l| l.id));
    }
    seen.sort();
    assert_eq!(seen, (1..=12).collect::<Vec<u64>>());
    assert_eq!(
        c.market_listings(None, Some(500)).len(),
        12,
        "pages are capped at 50"
    );
    // Closing one keeps the rest reachable.
    as_(sellers[0].clone(), 0);
    c.cancel_listing(2);
    assert_eq!(c.market_listings(Some(0), Some(50)).len(), 11);
}

#[test]
fn cancelling_works_while_trading_is_closed() {
    let mut c = market();
    fund(&mut c, alice(), 0, vec![("crumbs", 3)]);
    as_(alice(), 0);
    let l = c.list_item("crumbs".into(), 3, U128(30));
    as_(owner(), 1);
    c.set_market_params(
        MarketParams {
            open: false,
            ..Default::default()
        },
        vec![],
    );
    fund(&mut c, bob(), 100, vec![]);
    as_(bob(), 0);
    assert!(panics(|| {
        c.buy_listing(l.id);
    })
    .contains("closed"));
    as_(alice(), 0);
    c.cancel_listing(l.id);
    assert_eq!(bal(&c, alice(), "item:crumbs"), 3);
}

// ---------- Bits as rewards and the craft sink ----------

#[test]
fn bits_are_minted_as_rewards() {
    let mut c = setup();
    as_(operator(), 0);
    let s = c.mint_rewards(vec![reward(
        alice(),
        1,
        vec![ing("bits", 73), ing("crumbs", 2)],
        None,
    )]);
    assert_eq!(s, vec![RewardStatus::Applied]);
    assert_eq!(c.bits_of(alice()), U128(73));
    assert_eq!(c.market_account(alice()).bits, U128(73));
    assert_eq!(c.mt_supply("item:bits".into()), Some(U128(73)));
}

#[test]
fn bits_are_not_an_item() {
    let (mut items, suits) = rules();
    items.push("bits".into());
    as_(owner(), 0);
    let r = std::panic::catch_unwind(move || Wgp::new(owner(), vec![], items, suits, 2));
    assert!(r.is_err());
}

#[test]
fn crafting_can_burn_bits() {
    let mut c = open_market(MarketParams {
        craft_bits: U128(25),
        ..Default::default()
    });
    with_hero(&mut c, alice());
    mint(
        &mut c,
        reward(
            alice(),
            1,
            vec![ing("sybil-goo", 3), ing("bits", 10)],
            Some(2),
        ),
    );
    as_(alice(), 0);
    assert!(panics(|| c.craft_suit("stealth".into())).contains("Needs bits x15"));
    fund(&mut c, alice(), 15, vec![]);
    let supply = c.mt_supply("item:bits".into()).unwrap().0;
    as_(alice(), 0);
    c.craft_suit("stealth".into());
    assert_eq!(bal(&c, alice(), "item:bits"), 0);
    assert_eq!(c.mt_supply("item:bits".into()), Some(U128(supply - 25)));
    assert!(
        events()[0].contains(r#""token_ids":["item:sybil-goo","item:bits"],"amounts":["3","25"]"#)
    );
    // Starter suits stay free.
    as_(alice(), 0);
    c.craft_suit("snow".into());
}

// ---------- Storage and migration ----------

#[test]
fn a_trader_costs_little_storage() {
    let mut c = open_market(MarketParams {
        daily_listings: 50,
        ..Default::default()
    });
    let who: AccountId = format!("{}.wgp.testnet", "t".repeat(52)).parse().unwrap();
    fund(&mut c, who.clone(), 1_000, vec![("crumbs", 20)]);
    c.players.flush();
    c.market.listings.flush();
    c.market.accounts.flush();
    let before = near_sdk::env::storage_usage();
    as_(who.clone(), 0);
    c.market_buy("fee-bomb".into(), 1, U128(1_000));
    for _ in 0..3 {
        as_(who.clone(), 0);
        c.list_item("crumbs".into(), 1, U128(10));
    }
    c.players.flush();
    c.market.listings.flush();
    c.market.accounts.flush();
    let used = near_sdk::env::storage_usage() - before;
    println!("TRADER_WITH_3_LISTINGS_STORAGE_BYTES={used}");
    assert!(used < 1_200, "used {used} bytes");
}

#[test]
fn a_v1_state_migrates_to_v2() {
    use crate::migrate::{upgrade_state, WgpV1};
    // A v1 contract with a player, written in the v1 layout.
    let mut v1 = setup();
    with_hero(&mut v1, alice());
    mint(&mut v1, reward(alice(), 1, vec![ing("crumbs", 2)], Some(2)));
    v1.players.flush();
    v1.supply.flush();
    let old = WgpV1 {
        owner_id: v1.owner_id.clone(),
        operators: std::mem::replace(
            &mut v1.operators,
            near_sdk::store::IterableSet::new(b"x".to_vec()),
        ),
        paused: false,
        items: v1.items.clone(),
        suits: v1.suits.clone(),
        starter_unlock_level: 2,
        players: std::mem::replace(
            &mut v1.players,
            near_sdk::store::LookupMap::new(b"y".to_vec()),
        ),
        supply: std::mem::replace(
            &mut v1.supply,
            near_sdk::store::LookupMap::new(b"z".to_vec()),
        ),
        seasons: std::mem::replace(
            &mut v1.seasons,
            near_sdk::store::LookupMap::new(b"w".to_vec()),
        ),
    };
    let bytes = near_sdk::borsh::to_vec(&old).unwrap();
    let c = upgrade_state(&bytes);
    assert_eq!(bal(&c, alice(), "item:crumbs"), 2);
    assert_eq!(c.get_player(alice()).unwrap().hero.unwrap().name, "Peter");
    assert!(c.market_state().pools.is_empty());
    assert_eq!(c.market_state().params, MarketParams::default());
    // Running it again on a v2 state changes nothing.
    let again = upgrade_state(&near_sdk::borsh::to_vec(&c).unwrap());
    assert_eq!(again.market.next_listing_id, 1);
    assert!(std::panic::catch_unwind(|| upgrade_state(&[1, 2, 3])).is_err());
}
