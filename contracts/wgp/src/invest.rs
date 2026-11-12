//! Investing in the vendor (v3): players fund a merchant's till and earn from its trades.
//!
//! Each pool's curve has `y = virtual_bits + bits` Bits on it. Only `bits` is real: the
//! vendor pays sellers from it, and when it can't pay for one item that pool is **broke**
//! and buys nothing. `virtual_bits` is the part of the curve nobody has funded.
//!
//! `market_invest(item, bits)` funds it. The investor's Bits go into the till and the same
//! amount comes off `virtual_bits`, so `y`, the spot price and every quote are exactly what
//! they were. That is the whole safety argument:
//!
//! - Investing and withdrawing never move a price, so they can't be the two halves of a
//!   sandwich, and a round trip returns exactly the Bits that went in.
//! - A stake is a claim on its own principal, not a share of the till. Nobody's trade or
//!   investment changes what another investor is owed.
//! - A pool takes at most `virtual_bits - 1` Bits: once the curve is fully funded the till
//!   can pay for any sale, so there is nothing left to fund.
//! - Withdrawing takes real Bits out, so it needs them in the till. A till that players
//!   emptied by selling to the vendor pays investors back as others buy that stock. Until
//!   then the stake waits. That is the risk an investor takes, and the only one.
//!
//! In return investors share `invest_fee_bps` of the gas fee on each of that pool's vendor
//! trades, pro rata by stake, instead of it being burned. Earnings sit apart from the till
//! (`Pool::rewards`) and can always be claimed.
//!
//! A stake is a ledger entry, not a token: it can't be transferred, so nothing can move it
//! off the account. Every method takes no deposit (a session key can call it); a per-call
//! range, a daily count, a daily Bits cap and a lock after each top-up bound what a leaked
//! key could do, and all it could ever do is park the player's Bits in a stake the player
//! still owns.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::market::{
    burn_fee, closed_reasons, spot_milli, till_short, today, transfer_memo, Pool, BITS_TOKEN,
};
use crate::{MtEvent, StakeData, Wgp, WgpEvent, WgpExt};

/// Scale of `Pool::fee_acc` (earnings per invested Bit).
pub(crate) const ACC: u128 = 1_000_000_000_000;
const ERR_DAILY: &str = "Daily market limit reached; it resets at midnight UTC";

/// One account's stake in one pool.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Stake {
    pub item: String,
    /// Principal: Bits this account has in the pool's till.
    pub bits: u128,
    /// Earnings already settled: `ceil(bits · fee_acc / ACC)` at the last change.
    pub debt: u128,
    /// The last top-up; the stake can be withdrawn `invest_lock_ms` after it.
    pub since_ms: u64,
}

/// Per investor: today's counters and one stake per pool at most (so at most 32).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Investor {
    /// Days since the Unix epoch (UTC) the counters belong to.
    pub day: u32,
    pub invests: u32,
    pub invest_bits: u128,
    pub stakes: Vec<Stake>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeView {
    pub item: String,
    pub bits: U128,
    /// Fee earnings ready to claim.
    pub earned: U128,
    pub unlocks_at_ms: u64,
    /// What `market_withdraw` would pay back right now: 0 while locked, and never more
    /// than the till holds.
    pub withdrawable: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct InvestorView {
    pub stakes: Vec<StakeView>,
    pub invests_left: u32,
    pub invest_bits_left: U128,
}

/// What an invest, withdraw or claim did.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeReceipt {
    pub item: String,
    /// Bits invested or withdrawn by this call (0 for a claim).
    pub bits: U128,
    /// Fee earnings paid to the caller by this call.
    pub earned: U128,
    /// The caller's stake in the pool afterwards.
    pub stake: U128,
    pub unlocks_at_ms: u64,
    pub pool: Pool,
}

/// One merchant's stall: whether it can trade, and what investing in it looks like.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Shop {
    pub item: String,
    /// Spot price × 1000.
    pub price_milli: U128,
    /// Why it can't trade right now; empty when it buys and sells. "paused" and
    /// "market-closed" stop everything; "broke" means the till can't pay for one item, so
    /// the vendor buys nothing until someone invests or buys from it; "sold-out" means it
    /// has nothing to sell.
    pub closed: Vec<String>,
    /// The vendor buys this item from players right now.
    pub buying: bool,
    /// The vendor sells this item to players right now.
    pub selling: bool,
    /// Bits in the till, and how many more it needs to buy one item (0 when it can).
    pub till: U128,
    pub needs: U128,
    /// Investors' Bits in the till, and how many more the pool can take.
    pub invested: U128,
    pub invest_room: U128,
    /// Fee earnings waiting for this pool's investors.
    pub rewards: U128,
}

/// `bits · acc / ACC`, rounded down (or up), saturating instead of overflowing.
fn share(bits: u128, acc: u128, up: bool) -> u128 {
    match bits.checked_mul(acc) {
        Some(v) if up => v.div_ceil(ACC),
        Some(v) => v / ACC,
        None => u128::MAX / ACC,
    }
}

/// Fee earnings a stake can claim from its pool.
fn earned(stake: &Stake, pool: &Pool) -> u128 {
    share(stake.bits, pool.fee_acc.0, false)
        .saturating_sub(stake.debt)
        .min(pool.rewards.0)
}

/// Bits a pool can still take from investors: the curve's unfunded part, less one.
pub fn invest_room(p: &Pool) -> u128 {
    p.virtual_bits.0.saturating_sub(1)
}

#[near]
impl Wgp {
    // ---------- Investors (session key) ----------

    /// Put `bits` of the caller's Bits into `item`'s till. They earn a share of the pool's
    /// gas fees from now on and come back with `market_withdraw`.
    pub fn market_invest(&mut self, item: String, bits: U128) -> StakeReceipt {
        self.assert_trading_open();
        let params = self.market.params.clone();
        require!(
            params.invest_open,
            "The vendor isn't taking investors right now"
        );
        let i = self.pool_index(&item);
        let amount = bits.0;
        require!(
            amount >= params.min_invest.0 && amount <= params.max_invest.0,
            format!(
                "Invest {} to {} Bits at a time",
                params.min_invest.0, params.max_invest.0
            )
        );
        let account = env::predecessor_account_id();
        let mut investor = self.investor_today(&account);
        investor.invests += 1;
        investor.invest_bits = investor.invest_bits.saturating_add(amount);
        require!(
            investor.invests <= params.daily_invests
                && investor.invest_bits <= params.daily_invest_bits.0,
            ERR_DAILY
        );
        let room = invest_room(&self.market.pools[i]);
        require!(
            amount <= room,
            format!("The vendor can take only {room} more Bits for {item}")
        );
        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        require!(
            player.balance(BITS_TOKEN) >= amount,
            format!("Needs {amount} Bits")
        );

        let before = closed_reasons(&self.market.pools[i]);
        let s = match investor.stakes.iter().position(|s| s.item == item) {
            Some(s) => s,
            None => {
                investor.stakes.push(Stake {
                    item: item.clone(),
                    ..Default::default()
                });
                investor.stakes.len() - 1
            }
        };
        let pool = &mut self.market.pools[i];
        let stake = &mut investor.stakes[s];
        let paid = earned(stake, pool);
        pool.rewards.0 -= paid;
        // Real Bits in, the same number of virtual Bits out: `y` doesn't move.
        pool.bits.0 += amount;
        pool.virtual_bits.0 -= amount;
        pool.invested.0 += amount;
        stake.bits += amount;
        stake.debt = share(stake.bits, pool.fee_acc.0, true);
        stake.since_ms = env::block_timestamp_ms();
        let receipt = self.receipt(i, stake, amount, paid);

        player.debit(BITS_TOKEN, amount);
        if paid > 0 {
            player.credit(BITS_TOKEN, paid, false);
        }
        self.players.insert(account.clone(), player);
        self.market.investors.insert(account.clone(), investor);

        self.stake_events(&account, &receipt, "invest");
        self.shop_changed(i, &before, "invest");
        receipt
    }

    /// Take `bits` of the caller's stake in `item` back out of the till, with any fee
    /// earnings. Needs the lock to have passed and the till to hold that many Bits. Works
    /// while trading is closed too.
    pub fn market_withdraw(&mut self, item: String, bits: U128) -> StakeReceipt {
        self.assert_live();
        let i = self.pool_index(&item);
        let account = env::predecessor_account_id();
        let mut investor = self
            .market
            .investors
            .get(&account)
            .cloned()
            .unwrap_or_default();
        let s = investor
            .stakes
            .iter()
            .position(|s| s.item == item)
            .unwrap_or_else(|| env::panic_str(&format!("You have no stake in {item}")));
        let amount = bits.0;
        let lock_ms = self.market.params.invest_lock_ms;
        let before = closed_reasons(&self.market.pools[i]);
        let pool = &mut self.market.pools[i];
        let stake = &mut investor.stakes[s];
        require!(
            amount >= 1 && amount <= stake.bits,
            format!("You have {} Bits staked in {item}", stake.bits)
        );
        let unlocks = stake.since_ms.saturating_add(lock_ms);
        let now = env::block_timestamp_ms();
        require!(
            now >= unlocks,
            format!(
                "Your stake unlocks in about {} minutes",
                unlocks.saturating_sub(now).div_ceil(60_000)
            )
        );
        require!(
            amount <= pool.bits.0,
            format!(
                "The till can pay back only {} Bits right now; it refills as players buy {item}",
                pool.bits.0
            )
        );
        let paid = earned(stake, pool);
        pool.rewards.0 -= paid;
        // Real Bits out, the same number of virtual Bits back: `y` doesn't move.
        pool.bits.0 -= amount;
        pool.virtual_bits.0 += amount;
        pool.invested.0 -= amount;
        stake.bits -= amount;
        stake.debt = share(stake.bits, pool.fee_acc.0, true);
        // With the last investor gone, what rounding left behind is burned like any fee.
        let dust = if pool.invested.0 == 0 {
            pool.fee_carry = 0;
            std::mem::take(&mut pool.rewards.0)
        } else {
            0
        };
        let receipt = self.receipt(i, stake, amount, paid);
        if stake.bits == 0 {
            investor.stakes.remove(s);
        }

        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        player.credit(BITS_TOKEN, amount + paid, false);
        self.players.insert(account.clone(), player);
        self.market.investors.insert(account.clone(), investor);
        if dust > 0 {
            self.sub_supply(BITS_TOKEN, dust);
            burn_fee(&env::current_account_id(), dust).emit();
        }

        self.stake_events(&account, &receipt, "withdraw");
        self.shop_changed(i, &before, "withdraw");
        receipt
    }

    /// Pay the caller the fee earnings of their stake in `item`. The stake stays.
    pub fn market_claim(&mut self, item: String) -> StakeReceipt {
        self.assert_live();
        let i = self.pool_index(&item);
        let account = env::predecessor_account_id();
        let mut investor = self
            .market
            .investors
            .get(&account)
            .cloned()
            .unwrap_or_default();
        let s = investor
            .stakes
            .iter()
            .position(|s| s.item == item)
            .unwrap_or_else(|| env::panic_str(&format!("You have no stake in {item}")));
        let pool = &mut self.market.pools[i];
        let stake = &mut investor.stakes[s];
        let paid = earned(stake, pool);
        require!(paid > 0, "Nothing earned yet");
        pool.rewards.0 -= paid;
        stake.debt += paid;
        let receipt = self.receipt(i, stake, 0, paid);

        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        player.credit(BITS_TOKEN, paid, false);
        self.players.insert(account.clone(), player);
        self.market.investors.insert(account.clone(), investor);
        self.stake_events(&account, &receipt, "claim");
        receipt
    }

    // ---------- Views ----------

    /// Every merchant's stall: open or closed and why, its till, and its investors' Bits.
    pub fn market_shops(&self) -> Vec<Shop> {
        let mut global = Vec::new();
        if self.paused {
            global.push("paused".to_string());
        }
        if !self.market.params.open {
            global.push("market-closed".to_string());
        }
        self.market
            .pools
            .iter()
            .map(|p| {
                let own = closed_reasons(p);
                let mut closed = global.clone();
                closed.extend(own.iter().map(|r| r.to_string()));
                Shop {
                    item: p.item.clone(),
                    price_milli: U128(spot_milli(p)),
                    buying: global.is_empty() && !own.contains(&"broke"),
                    selling: global.is_empty() && !own.contains(&"sold-out"),
                    closed,
                    till: p.bits,
                    needs: U128(till_short(p)),
                    invested: p.invested,
                    invest_room: U128(invest_room(p)),
                    rewards: p.rewards,
                }
            })
            .collect()
    }

    /// An account's stakes, what each has earned and can withdraw, and what it may still
    /// invest today.
    pub fn market_investor(&self, account_id: AccountId) -> InvestorView {
        let p = &self.market.params;
        let investor = self.investor_today(&account_id);
        let now = env::block_timestamp_ms();
        let stakes = investor
            .stakes
            .iter()
            .filter_map(|s| {
                let pool = self.market.pools.iter().find(|p| p.item == s.item)?;
                let unlocks_at_ms = s.since_ms.saturating_add(p.invest_lock_ms);
                let withdrawable = if now >= unlocks_at_ms {
                    s.bits.min(pool.bits.0)
                } else {
                    0
                };
                Some(StakeView {
                    item: s.item.clone(),
                    bits: U128(s.bits),
                    earned: U128(earned(s, pool)),
                    unlocks_at_ms,
                    withdrawable: U128(withdrawable),
                })
            })
            .collect();
        InvestorView {
            stakes,
            invests_left: p.daily_invests.saturating_sub(investor.invests),
            invest_bits_left: U128(p.daily_invest_bits.0.saturating_sub(investor.invest_bits)),
        }
    }
}

impl Wgp {
    fn investor_today(&self, account: &AccountId) -> Investor {
        let mut investor = self
            .market
            .investors
            .get(account)
            .cloned()
            .unwrap_or_default();
        let day = today();
        if investor.day != day {
            investor.day = day;
            investor.invests = 0;
            investor.invest_bits = 0;
        }
        investor
    }

    fn receipt(&self, i: usize, stake: &Stake, bits: u128, paid: u128) -> StakeReceipt {
        StakeReceipt {
            item: stake.item.clone(),
            bits: U128(bits),
            earned: U128(paid),
            stake: U128(stake.bits),
            unlocks_at_ms: stake
                .since_ms
                .saturating_add(self.market.params.invest_lock_ms),
            pool: self.market.pools[i].clone(),
        }
    }

    /// The NEP-245 transfers (Bits to the vendor's till or back, earnings out) and the
    /// game's own event for an invest, withdraw or claim.
    fn stake_events(&self, account: &AccountId, r: &StakeReceipt, what: &str) {
        let vendor = env::current_account_id();
        let mut moves = Vec::new();
        if r.bits.0 > 0 {
            let (from, to) = if what == "invest" {
                (account, &vendor)
            } else {
                (&vendor, account)
            };
            moves.push(transfer_memo(
                from,
                to,
                BITS_TOKEN.to_string(),
                r.bits.0,
                what,
            ));
        }
        if r.earned.0 > 0 {
            moves.push(transfer_memo(
                &vendor,
                account,
                BITS_TOKEN.to_string(),
                r.earned.0,
                "earnings",
            ));
        }
        if !moves.is_empty() {
            MtEvent::MtTransfer(moves).emit();
        }
        let data = vec![StakeData {
            account_id: account.clone(),
            item: r.item.clone(),
            bits: r.bits,
            earned: r.earned,
            stake: r.stake,
            invested: r.pool.invested,
        }];
        match what {
            "invest" => WgpEvent::MarketInvest(data),
            "withdraw" => WgpEvent::MarketWithdraw(data),
            _ => WgpEvent::MarketClaim(data),
        }
        .emit();
    }
}
