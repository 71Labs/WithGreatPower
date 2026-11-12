//! Prints the investing vectors the app's TypeScript mirror is tested against
//! (apps/wgp/src/lib/market/invest-vectors.json). This file is NOT part of the contract:
//! apps/wgp/scripts/invest-vectors/generate.mjs copies it into a temporary worktree of the
//! contract-v3 branch as `src/v3_tests/invest_vectors.rs` and runs
//! `cargo test print_invest_vectors -- --ignored --nocapture` there.
//!
//! Each scenario is a seeded random walk of invests, withdrawals, claims, buys and sells by
//! four accounts on the contract's own test market, with the clock moving between calls so
//! locks pass and UTC days roll over. Every step records what the contract answered (its
//! receipt, or the words it refused with) and the pool, the caller's Bits, the stall and
//! the caller's stakes afterwards.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::AccountId;

use super::*;

const ITEMS: [&str; 4] = ["crumbs", "fee-bomb", "sybil-goo", "goblin-glider"];

fn who(i: u64) -> AccountId {
    match i % 4 {
        0 => alice(),
        1 => bob(),
        2 => carol(),
        _ => mallory(),
    }
}

fn params_json(p: &MarketParams) -> Value {
    json!({
        "open": p.open,
        "fee_bps": p.fee_bps,
        "max_amount": p.max_amount,
        "daily_trades": p.daily_trades,
        "invest_open": p.invest_open,
        "invest_fee_bps": p.invest_fee_bps,
        "min_invest": p.min_invest,
        "max_invest": p.max_invest,
        "daily_invests": p.daily_invests,
        "daily_invest_bits": p.daily_invest_bits,
        "invest_lock_ms": p.invest_lock_ms,
    })
}

fn scenario(
    name: &str,
    params: MarketParams,
    mut seed: u64,
    steps: usize,
    bits: u32,
    items: u32,
    pace: u64,
) -> Value {
    let mut c = open_market(params.clone());
    let accounts: Vec<AccountId> = (0..4).map(who).collect();
    for a in &accounts {
        let mut left = bits;
        while left > 0 {
            let lot = left.min(1_000);
            fund(&mut c, a.clone(), lot, vec![]);
            left -= lot;
        }
        for item in ITEMS {
            stock_up(&mut c, a.clone(), item, items);
        }
    }
    let pools: Vec<Value> = ITEMS
        .iter()
        .map(|i| serde_json::to_value(pool(&c, i)).unwrap())
        .collect();
    let mut next = || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        seed >> 33
    };
    // Day 20,000 since the epoch, 09:00 UTC.
    let mut ms: u64 = 20_000 * 86_400_000 + 9 * 3_600_000;
    let mut out = Vec::new();
    while out.len() < steps {
        ms += next() % pace;
        let account = who(next());
        let item = ITEMS[(next() % 4) as usize];
        let roll = next() % 100;
        let (op, amount): (&str, u64) = if roll < 28 {
            (
                "invest",
                [5, 10, 25, 60, 150, 400, 600][(next() % 7) as usize],
            )
        } else if roll < 48 {
            ("withdraw", [1, 10, 25, 60, 150, 400][(next() % 6) as usize])
        } else if roll < 58 {
            ("claim", 0)
        } else if roll < 72 {
            ("buy", next() % 6 + 1)
        } else {
            ("sell", [1, 3, 8, 20][(next() % 4) as usize])
        };
        at(account.clone(), ms);
        let stake = |r: crate::StakeReceipt| json!({"bits": r.bits, "earned": r.earned, "stake": r.stake, "unlocks_at_ms": r.unlocks_at_ms});
        let result: Result<Value, String> = {
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match op {
                "invest" => stake(c.market_invest(item.into(), U128(amount as u128))),
                "withdraw" => stake(c.market_withdraw(item.into(), U128(amount as u128))),
                "claim" => stake(c.market_claim(item.into())),
                "buy" => {
                    let t = c.market_buy(item.into(), amount as u32, U128(1_000_000_000));
                    json!({"bits": t.bits, "fee": t.fee})
                }
                _ => {
                    let t = c.market_sell(item.into(), amount as u32, U128(0));
                    json!({"bits": t.bits, "fee": t.fee})
                }
            }));
            r.map_err(|e| {
                e.downcast_ref::<String>()
                    .cloned()
                    .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default()
            })
        };
        at(account.clone(), ms);
        let shop = c
            .market_shops()
            .into_iter()
            .find(|s| s.item == item)
            .unwrap();
        out.push(json!({
            "at_ms": ms,
            "who": account,
            "op": op,
            "item": item,
            "amount": amount,
            "ok": result.as_ref().ok(),
            "error": result.as_ref().err(),
            "pool": serde_json::to_value(pool(&c, item)).unwrap(),
            "bits": bal(&c, account.clone(), BITS_TOKEN).to_string(),
            "held": bal(&c, account.clone(), &format!("item:{item}")).to_string(),
            "shop": serde_json::to_value(shop).unwrap(),
            "investor": serde_json::to_value(c.market_investor(account.clone())).unwrap(),
            "supply": supply(&c).to_string(),
        }));
    }
    json!({
        "name": name,
        "params": params_json(&params),
        "pools": pools,
        "accounts": accounts,
        "start_bits": bits,
        "start_items": items,
        "steps": out,
    })
}

#[test]
#[ignore]
fn print_invest_vectors() {
    let defaults = MarketParams {
        craft_bits: U128(0),
        ..Default::default()
    };
    // The practice market's shape: a short lock and room to move.
    let quick = MarketParams {
        invest_lock_ms: 30_000,
        daily_trades: 100_000,
        daily_invests: 100_000,
        daily_invest_bits: U128(1_000_000_000),
        max_invest: U128(1_000_000),
        min_invest: U128(1),
        craft_bits: U128(0),
        ..Default::default()
    };
    let whole_fee = MarketParams {
        invest_fee_bps: 10_000,
        fee_bps: 700,
        invest_lock_ms: 600_000,
        daily_trades: 100_000,
        craft_bits: U128(0),
        ..Default::default()
    };
    let scenarios = vec![
        scenario("v3 default rules", defaults.clone(), 0x1a2b3c, 260, 3_000, 120, 2_400_000),
        scenario("v3 default rules, a busy hour on thin wallets", defaults, 0xb0b, 220, 150, 60, 90_000),
        scenario("short lock, loose caps", quick, 0x5eed, 320, 4_000, 200, 2_400_000),
        scenario(
            "whole fee to investors, 7% fee",
            whole_fee,
            0xfeed,
            220,
            3_000,
            150,
            2_400_000,
        ),
    ];
    println!("<<<INVEST-VECTORS");
    println!(
        "{}",
        serde_json::to_string(&json!({
            "about": "Investing vectors from contract v3 (contracts/wgp/src/invest.rs on origin/review/contract-v3). Regenerate with `node apps/wgp/scripts/invest-vectors/generate.mjs`; apps/wgp/src/lib/market/invest.test.ts replays them through the TypeScript mirror.",
            "scenarios": scenarios,
        }))
        .unwrap()
    );
    println!("INVEST-VECTORS>>>");
}
