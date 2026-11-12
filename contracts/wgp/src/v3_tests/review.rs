//! Tests added by an independent review of v3: the paths the first test file left
//! untried. A fuzz with a shadow model of who is owed what (hostile settings, 1-Bit
//! stakes, retunes and refunds mid-run), the log limits of a full refund batch, every new
//! entry point on a freshly migrated state, and migration of randomly generated v2 states.

use std::collections::HashMap;

use super::*;
use crate::migrate::upgrade_state;
use crate::{MarketRules, MAX_REFUNDS};

/// A 64-character (implicit) account id: the longest there is.
fn long_id(i: usize) -> AccountId {
    format!("{:064x}", 0xabc0_0000usize + i).parse().unwrap()
}

/// The owner calling with 1 yoctoNEAR at `ms`.
fn owner_at(ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract())
        .predecessor_account_id(owner())
        .attached_deposit(NearToken::from_yoctonear(1))
        .block_timestamp(ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
}

// ---------- Logs ----------

/// NEAR allows a receipt 100 logs and 16,384 bytes of them. A refund logs per investor, so
/// the largest batch with the longest ids and earnings for everyone must stay inside both.
#[test]
fn a_full_refund_batch_of_the_longest_account_ids_fits_in_the_logs() {
    let mut c = open_market(loose());
    let who: Vec<AccountId> = (0..MAX_REFUNDS).map(long_id).collect();
    for a in &who {
        fund(&mut c, a.clone(), 60, vec![]);
        at(a.clone(), 1_000);
        c.market_invest("goblin-glider".into(), U128(50));
    }
    for _ in 0..4 {
        fund(&mut c, carol(), 1_000, vec![]);
    }
    for _ in 0..12 {
        at(carol(), 2_000);
        c.market_buy("goblin-glider".into(), 1, U128(1_000_000));
        at(carol(), 2_000);
        c.market_sell("goblin-glider".into(), 1, U128(0));
    }
    assert!(
        who.iter()
            .all(|a| earned_of(&c, a.clone(), "goblin-glider") > 0),
        "every investor has earnings to be paid"
    );

    owner_at(3_000);
    let out = c.market_refund("goblin-glider".into(), who.clone());
    assert_eq!(out.len(), MAX_REFUNDS);
    let logs = near_sdk::test_utils::get_logs();
    let bytes: usize = logs.iter().map(String::len).sum();
    println!("REFUND_20_LOGS count={} bytes={bytes}", logs.len());
    assert!(logs.len() <= 100, "{} logs", logs.len());
    assert!(bytes <= 16_384, "{bytes} bytes of logs");
    let p = pool(&c, "goblin-glider");
    assert_eq!((p.invested.0, p.rewards.0), (0, 0));
    let mut everyone = who;
    everyone.push(carol());
    assert_books(&c, &everyone);
}

// ---------- Who is owed what ----------

const S: u128 = 1_000_000_000_000_000_000;

/// What each (account, pool) is exactly owed (× `S`), has been paid, and how many times
/// its stake was settled (each settlement may round up to two Bits away from the investor).
#[derive(Default)]
struct Ledger {
    exact: HashMap<(usize, usize), u128>,
    paid: HashMap<(usize, usize), u128>,
    settled: HashMap<(usize, usize), u128>,
    cuts: u128,
    paid_out: u128,
    dust: u128,
}

/// Random buys, sells, invests, withdrawals (down to a 1-Bit stake), claims, owner refunds
/// and owner retunes (the fee, the investors' share from none to all, the curve), checked
/// after every step against an independent ledger:
///
/// - nobody is ever paid, or shown as owed, more than their exact pro-rata share of the
///   fees their pool took while they were staked (no theft from other investors);
/// - nobody is short of it by more than rounding: under two Bits per invest or withdrawal
///   (what was earned is rounded down, what is settled is rounded up; the difference
///   stays in `rewards` and burns when the pool's last investor leaves);
/// - every Bit of the investors' cut is paid out, still held as `rewards`, or burned as
///   dust when a pool's last investor leaves; and the supply moves by exactly the burn.
fn owed_exactly(seed: u64, steps: usize) -> [u32; 7] {
    let mut c = open_market(loose());
    let who = [alice(), bob(), carol(), mallory(), long_id(1)];
    let items = ["crumbs", "fee-bomb", "sybil-goo", "goblin-glider"];
    for a in &who {
        fund(
            &mut c,
            a.clone(),
            1_000,
            vec![
                ("crumbs", 80),
                ("fee-bomb", 80),
                ("sybil-goo", 40),
                ("goblin-glider", 15),
            ],
        );
    }
    let mut rng = Lcg(seed);
    let mut l = Ledger::default();
    let mut done = [0u32; 7];
    let stakes = |c: &Wgp, item: &str| -> Vec<u128> {
        who.iter().map(|a| stake_of(c, a.clone(), item)).collect()
    };

    for step in 0..steps {
        let now = 10_000 + step as u64 * 1_000;
        let ai = rng.next(who.len() as u64) as usize;
        let a = who[ai].clone();
        let pi = rng.next(4) as usize;
        let item = items[pi];
        let before = pool(&c, item);
        let supply_before = supply(&c);
        let bits = bal(&c, a.clone(), BITS_TOKEN);
        let staked = stakes(&c, item);
        if step % 150 == 149 {
            fund(&mut c, a.clone(), 400, vec![(item, 10)]);
            continue;
        }
        match rng.next(9) {
            // A trade: whatever joins `rewards` is the cut, shared by stake.
            op @ (0..=2) => {
                let n = 1 + rng.next(8) as u32;
                let q = c.market_quote(item.into(), n);
                let trade = if op == 0 {
                    let Some(cost) = q.buy else { continue };
                    if cost.0 > bits {
                        continue;
                    }
                    at(a.clone(), now);
                    c.market_buy(item.into(), n, cost)
                } else {
                    let Some(pays) = q.sell else { continue };
                    if bal(&c, a.clone(), &format!("item:{item}")) < n as u128 {
                        continue;
                    }
                    at(a.clone(), now);
                    c.market_sell(item.into(), n, pays)
                };
                let after = pool(&c, item);
                let cut = after.rewards.0 - before.rewards.0;
                assert!(cut <= trade.fee.0, "step {step}: cut over the fee");
                assert!(
                    before.invested.0 > 0 || cut == 0,
                    "step {step}: a cut with no investors"
                );
                assert_eq!(
                    supply_before - supply(&c),
                    trade.fee.0 - cut,
                    "step {step}: the burn is the fee less the cut"
                );
                if cut > 0 {
                    for (i, s) in staked.iter().enumerate() {
                        *l.exact.entry((i, pi)).or_default() += cut * s * S / before.invested.0;
                    }
                    l.cuts += cut;
                }
                done[0] += 1;
            }
            3 | 4 => {
                let amount = (1 + rng.next(120) as u128)
                    .min(bits)
                    .min(invest_room(&before));
                if amount == 0 {
                    continue;
                }
                at(a.clone(), now);
                let r = c.market_invest(item.into(), U128(amount));
                assert_eq!(reserves(&pool(&c, item)), reserves(&before));
                assert_eq!(bal(&c, a.clone(), BITS_TOKEN), bits - amount + r.earned.0);
                *l.paid.entry((ai, pi)).or_default() += r.earned.0;
                *l.settled.entry((ai, pi)).or_default() += 1;
                l.paid_out += r.earned.0;
                assert_eq!(supply(&c), supply_before);
                done[1] += 1;
            }
            5 | 6 => {
                let mine = staked[ai];
                let can = mine.min(before.bits.0);
                if can == 0 {
                    continue;
                }
                // Often everything but one Bit, or everything: the edges of the accounting.
                let amount = match rng.next(4) {
                    0 => can,
                    1 => (mine - 1).clamp(1, can),
                    _ => 1 + rng.next(can as u64) as u128,
                };
                at(a.clone(), now);
                let r = c.market_withdraw(item.into(), U128(amount));
                let after = pool(&c, item);
                assert_eq!(reserves(&after), reserves(&before));
                assert_eq!(bal(&c, a.clone(), BITS_TOKEN), bits + amount + r.earned.0);
                *l.paid.entry((ai, pi)).or_default() += r.earned.0;
                *l.settled.entry((ai, pi)).or_default() += 1;
                l.paid_out += r.earned.0;
                let dust = supply_before - supply(&c);
                assert!(
                    dust == 0 || after.invested.0 == 0,
                    "step {step}: dust burned with investors still in"
                );
                assert_eq!(before.rewards.0, after.rewards.0 + r.earned.0 + dust);
                l.dust += dust;
                done[2] += 1;
            }
            7 => {
                if earned_of(&c, a.clone(), item) == 0 {
                    at(a.clone(), now);
                    if staked[ai] > 0 {
                        assert!(panics(|| {
                            c.market_claim(item.into());
                        })
                        .contains("Nothing earned yet"));
                    }
                    continue;
                }
                at(a.clone(), now);
                let r = c.market_claim(item.into());
                assert_eq!(pool(&c, item).bits, before.bits);
                assert_eq!(bal(&c, a.clone(), BITS_TOKEN), bits + r.earned.0);
                *l.paid.entry((ai, pi)).or_default() += r.earned.0;
                *l.settled.entry((ai, pi)).or_default() += 1;
                l.paid_out += r.earned.0;
                assert_eq!(supply(&c), supply_before);
                done[3] += 1;
            }
            _ => match rng.next(6) {
                // The owner sends a few stakes home, if the till can pay them all.
                0 => {
                    let picked: Vec<usize> = (0..who.len()).filter(|_| rng.next(2) == 0).collect();
                    let total: u128 = picked.iter().map(|i| staked[*i]).sum();
                    if picked.is_empty() || total > before.bits.0 {
                        continue;
                    }
                    owner_at(now);
                    let out = c.market_refund(
                        item.into(),
                        picked.iter().map(|i| who[*i].clone()).collect(),
                    );
                    let mut receipts = out.iter();
                    for i in picked {
                        if staked[i] == 0 {
                            continue;
                        }
                        let r = receipts.next().unwrap();
                        assert_eq!(r.bits.0, staked[i], "step {step}: a refund is whole");
                        *l.paid.entry((i, pi)).or_default() += r.earned.0;
                        *l.settled.entry((i, pi)).or_default() += 1;
                        l.paid_out += r.earned.0;
                    }
                    assert!(receipts.next().is_none());
                    l.dust += supply_before - supply(&c);
                    done[4] += 1;
                }
                // The owner retunes the rules: any fee, any share of it for investors.
                1 | 2 => {
                    let params = MarketParams {
                        fee_bps: [0, 1, 200, 999, 1_000][rng.next(5) as usize],
                        invest_fee_bps: [0, 1, 3_333, 5_000, 9_999, 10_000][rng.next(6) as usize],
                        ..c.market_state().params
                    };
                    owner_at(now);
                    c.set_market(params, vec![]);
                    done[5] += 1;
                }
                // The owner retunes this pool's curve around what is invested.
                _ => {
                    let vb = before.invested.0 + 1 + rng.next(1_500) as u128;
                    let vi = 1 + rng.next(60) as u128;
                    owner_at(now);
                    c.set_market(c.market_state().params, vec![pool_cfg(item, vb, vi, 0, 0)]);
                    let after = pool(&c, item);
                    assert_eq!(after.virtual_bits.0 + after.invested.0, vb);
                    assert_eq!(
                        (after.bits, after.invested, after.rewards),
                        (before.bits, before.invested, before.rewards)
                    );
                    done[6] += 1;
                }
            },
        }

        assert_books(&c, &who);
        for (pi, item) in items.iter().enumerate() {
            for (ai, a) in who.iter().enumerate() {
                let got =
                    l.paid.get(&(ai, pi)).copied().unwrap_or(0) + earned_of(&c, a.clone(), item);
                let exact = l.exact.get(&(ai, pi)).copied().unwrap_or(0);
                let settled = l.settled.get(&(ai, pi)).copied().unwrap_or(0);
                assert!(
                    got * S <= exact + S - 1,
                    "step {step} seed {seed}: {a} took {got} Bits of {item}'s fees, owed {exact}/1e18"
                );
                assert!(
                    (got + 2 * settled + 1) * S >= exact,
                    "step {step} seed {seed}: {a} is short on {item}: {got} of {exact}/1e18 after {settled} settlements"
                );
            }
        }
        let held: u128 = c.market_state().pools.iter().map(|p| p.rewards.0).sum();
        assert_eq!(
            l.cuts,
            l.paid_out + held + l.dust,
            "step {step}: every Bit of the cut is paid, held or burned"
        );
    }
    done
}

#[test]
fn nobody_is_paid_more_than_their_share_of_the_fees() {
    let mut total = [0u32; 7];
    for seed in [1, 7, 71, 2026, 99_991] {
        let done = owed_exactly(seed, 2_000);
        for (t, d) in total.iter_mut().zip(done) {
            *t += d;
        }
    }
    println!("REVIEW_FUZZ trade/invest/withdraw/claim/refund/rules/curve = {total:?}");
    assert!(total.iter().all(|n| *n > 40), "{total:?}");
}

// ---------- Straight after the upgrade ----------

/// On a state that just came from v2, with nothing set by the owner: every new entry point
/// that could move Bits is refused or does nothing, whoever calls it, and a v2 trade does
/// exactly what it did (the whole fee burns, no investing field moves).
#[test]
fn nothing_new_moves_bits_on_a_freshly_migrated_state() {
    let mut c = upgrade_state(&as_v2_state(busy_v2()));
    let people = [alice(), bob(), carol(), operator(), owner(), mallory()];
    assert!(!c.market_state().params.invest_open);
    let pools_before = c.market_state().pools;
    let supply_before = supply(&c);
    let held: Vec<u128> = people
        .iter()
        .map(|a| bal(&c, a.clone(), BITS_TOKEN))
        .collect();
    assert!(held[0] >= 10, "alice has Bits to try investing with");

    for a in &people {
        for item in ["crumbs", "fee-bomb", "goblin-glider"] {
            on_day(a.clone(), 0, 20_001);
            assert!(panics(|| {
                c.market_invest(item.into(), U128(10));
            })
            .contains("isn't taking investors"));
            on_day(a.clone(), 0, 20_001);
            assert!(panics(|| {
                c.market_withdraw(item.into(), U128(1));
            })
            .contains("no stake"));
            on_day(a.clone(), 0, 20_001);
            assert!(panics(|| {
                c.market_claim(item.into());
            })
            .contains("no stake"));
            // Not the owner (or the owner without the yoctoNEAR): no refund either.
            on_day(a.clone(), 0, 20_001);
            assert!(panics(|| {
                c.market_refund(item.into(), people.to_vec());
            })
            .contains("yoctoNEAR"));
            if *a != owner() {
                on_day(a.clone(), 1, 20_001);
                assert!(panics(|| {
                    c.market_refund(item.into(), people.to_vec());
                })
                .contains("Only the owner"));
            }
        }
        // Nobody but the owner can open investing, in the v3 shape or any other.
        if *a != owner() {
            let rules: MarketRules = serde_json::from_value(json!({
                "open": true, "fee_bps": 200, "floor_bps": 5000, "ceiling_bps": 40000,
                "max_amount": 20, "max_open_listings": 3, "max_listings": 300,
                "daily_trades": 40, "daily_listings": 10, "daily_fills": 10,
                "daily_fill_bits": "3000", "craft_bits": "0", "invest_open": true
            }))
            .unwrap();
            on_day(a.clone(), 1, 20_001);
            assert!(panics(|| {
                c.set_market_params(rules, vec![]);
            })
            .contains("Only the owner"));
        }
    }
    // The owner's refund finds nobody; the owner's v2-shaped rules (with or without an
    // explicit null) leave investing closed.
    on_day(owner(), 1, 20_001);
    assert!(c.market_refund("crumbs".into(), people.to_vec()).is_empty());
    for extra in [
        json!({}),
        json!({"invest_open": null, "invest_fee_bps": null}),
    ] {
        let mut args = json!({
            "open": true, "fee_bps": 200, "floor_bps": 5000, "ceiling_bps": 40000,
            "max_amount": 20, "max_open_listings": 3, "max_listings": 300,
            "daily_trades": 40, "daily_listings": 10, "daily_fills": 10,
            "daily_fill_bits": "3000", "craft_bits": "0"
        });
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        on_day(owner(), 1, 20_001);
        c.set_market_params(serde_json::from_value(args).unwrap(), vec![]);
        assert!(!c.market_state().params.invest_open);
    }

    assert_eq!(c.market_state().pools, pools_before);
    assert_eq!(supply(&c), supply_before);
    for (a, h) in people.iter().zip(&held) {
        assert_eq!(bal(&c, a.clone(), BITS_TOKEN), *h);
    }

    // v2 trades: the whole fee burns, as it did.
    for (side, n) in [("buy", 2u32), ("sell", 1), ("buy", 1), ("sell", 2)] {
        let s0 = supply(&c);
        on_day(alice(), 0, 20_001);
        let t = if side == "buy" {
            c.market_buy("crumbs".into(), n, U128(1_000_000))
        } else {
            c.market_sell("crumbs".into(), n, U128(0))
        };
        assert!(t.fee.0 > 0);
        assert_eq!(s0 - supply(&c), t.fee.0, "the whole fee burns");
    }
    for p in c.market_state().pools {
        assert_eq!(
            (p.invested.0, p.rewards.0, p.fee_acc.0, p.fee_carry),
            (0, 0, 0, 0),
            "{}",
            p.item
        );
    }
}

// ---------- Migrating whatever v2 state there is ----------

/// v2 states built by random play (rewards, crafts, trades, listings filled and cancelled,
/// seasons, counters on different days) each migrate with every v2 view unchanged, arrive
/// with investing off, and migrate again to the same bytes.
#[test]
fn random_v2_states_migrate_with_every_view_unchanged() {
    for seed in [3u64, 17, 404, 8_080] {
        let mut c = busy_v2();
        let mut rng = Lcg(seed);
        let who = [alice(), bob(), carol()];
        let items = ["crumbs", "fee-bomb", "sybil-goo", "goblin-glider"];
        let mut seasons = 0;
        for step in 0..400u64 {
            let day = 20_000 + step / 60;
            let a = who[rng.next(3) as usize].clone();
            let item = items[rng.next(4) as usize];
            let n = 1 + rng.next(4) as u32;
            let call: Box<dyn FnOnce(&mut Wgp)> = match rng.next(8) {
                0 => Box::new(move |c| {
                    c.market_buy(item.into(), n, U128(1_000_000));
                }),
                1 => Box::new(move |c| {
                    c.market_sell(item.into(), n, U128(0));
                }),
                2 => {
                    let q = c.market_quote(item.into(), n);
                    Box::new(move |c| {
                        c.list_item(item.into(), n, q.floor);
                    })
                }
                3 => {
                    let id = 1 + rng.next(c.market.next_listing_id);
                    Box::new(move |c| {
                        c.buy_listing(id);
                    })
                }
                4 => {
                    let id = 1 + rng.next(c.market.next_listing_id);
                    Box::new(move |c| {
                        c.cancel_listing(id);
                    })
                }
                5 => {
                    let suit = ["stealth", "midnight", "classic"][rng.next(3) as usize];
                    Box::new(move |c| c.craft_suit(suit.into()))
                }
                6 if seasons < 3 && rng.next(20) == 0 => {
                    seasons += 1;
                    let id = format!("r{seasons}");
                    on_day(operator(), 0, day);
                    c.record_season(id, ROOT.into(), who.to_vec(), DIGEST.into());
                    continue;
                }
                _ => {
                    let nonce = c.reward_nonce(a.clone()) + 1;
                    let r = reward(
                        a.clone(),
                        nonce,
                        vec![ing("bits", 300), ing(item, 5)],
                        Some(1 + rng.next(9) as u32),
                    );
                    on_day(operator(), 0, day);
                    c.mint_rewards(vec![r]);
                    continue;
                }
            };
            // Refusals (a cap, an empty till, somebody else's listing) leave no trace.
            on_day(a, 0, day);
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| call(&mut c)));
        }
        on_day(alice(), 0, 20_007);
        let before = snapshot(&c);
        let listed = c.market_state().listings;
        let next = c.market.next_listing_id;

        let v2 = as_v2_state(c);
        on_day(contract(), 0, 20_007);
        let c = upgrade_state(&v2);
        assert_eq!(snapshot(&c), before, "seed {seed}: a v2 view changed");
        assert_eq!(c.market_state().listings, listed);
        assert_eq!(c.market.next_listing_id, next);
        let p = c.market_state().params;
        assert!(!p.invest_open, "seed {seed}: investing arrives off");
        assert_eq!(c.mt_tokens_count().0, 0);
        assert!(c.market_state().pools.iter().all(|p| p.invested.0
            + p.rewards.0
            + p.fee_acc.0
            + p.fee_carry as u128
            == 0));

        let v3 = near_sdk::borsh::to_vec(&c).unwrap();
        assert_eq!(v3[..4], LAYOUT_V3.to_le_bytes());
        let again = upgrade_state(&v3);
        assert_eq!(near_sdk::borsh::to_vec(&again).unwrap(), v3);
        assert_eq!(snapshot(&again), before);
    }
}
