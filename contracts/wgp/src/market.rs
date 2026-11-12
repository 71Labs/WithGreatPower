//! The Mempool Market: the game's economy, all in NEP-245 tokens.
//!
//! - **Bits** (`item:bits`) are the currency, minted per verified night by `mint_rewards`.
//! - **The vendor** is an NPC whose stock and till live in this contract. Each tradable item
//!   has a pool on a virtual-reserve constant-product curve:
//!   `x = virtual_items + stock`, `y = virtual_bits + bits`, spot price `y / x` Bits.
//!   Buying `n` costs `ceil(y·n / (x − n))`; selling `n` pays `floor(y·n / (x + n))`. So
//!   every buy raises the price and every sell lowers it, and a round trip never profits.
//!   The vendor sells only what it holds and pays only from its till.
//! - **The gas fee**: `fee_bps` (2%) of every trade's Bits is burned, a sink.
//! - **Listings**: players escrow items here at a fixed price; a buyer pays the seller
//!   (less the fee) and takes the items. A listing's price must sit between `floor_bps`
//!   and `ceiling_bps` of the vendor's spot price, so a stolen session key can neither dump
//!   a player's items for nothing nor pay an accomplice's inflated listing in full.
//!
//! - **Investors** (invest.rs, v3): players fund a pool's till and earn a share of its gas
//!   fee. Their Bits replace the same amount of *virtual* reserve, so `y` and every price
//!   stay exactly where they were: investing changes what the vendor can pay, never what it
//!   quotes. A pool whose till can't pay for one item is "broke" until someone invests in
//!   it or buys from it (`market_shops`, the `market_shop` event).
//!
//! Every method here is callable by a session key: none takes a deposit. Per-account daily
//! caps, a cap on open listings and a per-call amount cap bound what a leaked key can do.
//! `apps/wgp/src/lib/market/math.ts` mirrors this math; `market-vectors.json` holds the
//! cases both test against.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId};

use crate::invest::Investor;
use crate::{
    item_token, AdminData, FillData, MtBurnEvent, MtEvent, MtMintEvent, MtTransferEvent, ShopData,
    StorageKey, TokenId, TradeData, Wgp, WgpEvent, WgpExt, MAX_ITEM_AMOUNT,
};

/// The currency's item id; its token is `item:bits`.
pub const BITS: &str = "bits";
pub const BITS_TOKEN: &str = "item:bits";
pub const MAX_POOLS: usize = 32;
pub const MAX_PAGE: u32 = 50;
pub(crate) const BPS: u128 = 10_000;
const DAY_MS: u64 = 86_400_000;
/// The longest `invest_lock_ms`: 30 days.
const MAX_LOCK_MS: u64 = 30 * DAY_MS;
/// Bits burned per crafted suit on a fresh deploy. A placeholder: the number to use comes
/// from `docs/ECONOMY.md` (see `docs/CONTRACT-V3.md`, "Sinks"); the owner sets it with
/// `set_market_params`.
pub const DEFAULT_CRAFT_BITS: u128 = 50;
/// Keeps `y · n · bps` far inside u128.
const MAX_RESERVE: u128 = 1_000_000_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(default)]
pub struct MarketParams {
    /// Off: no trades or new listings (open listings can still be cancelled).
    pub open: bool,
    /// The gas fee, burned, in basis points of a trade's Bits (200 = 2%).
    pub fee_bps: u32,
    /// A listing costs at least this share of the vendor's spot price (5000 = 50%).
    pub floor_bps: u32,
    /// ... and at most this share (40000 = 400%).
    pub ceiling_bps: u32,
    /// Items per vendor trade or listing.
    pub max_amount: u32,
    pub max_open_listings: u32,
    /// Open listings across everyone; bounds the storage the contract sponsors.
    pub max_listings: u32,
    /// Per account, per UTC day: vendor buys plus sells.
    pub daily_trades: u32,
    pub daily_listings: u32,
    /// Listings bought.
    pub daily_fills: u32,
    /// Bits spent on listings.
    pub daily_fill_bits: U128,
    /// Bits burned by each crafted suit with a recipe. 0 turns the sink off.
    pub craft_bits: U128,
    // ---- v3: investing in the vendor (invest.rs). Left out of the JSON: the defaults. ----
    /// Off: no new investments (stakes can still be withdrawn and earnings claimed).
    pub invest_open: bool,
    /// The investors' share of a vendor trade's gas fee, in basis points of the fee
    /// (5000 = half). The rest is burned. A pool with no investors burns it all.
    pub invest_fee_bps: u32,
    /// Bits per `market_invest` call, at least and at most.
    pub min_invest: U128,
    pub max_invest: U128,
    /// Per account, per UTC day: `market_invest` calls, and the Bits they may add.
    pub daily_invests: u32,
    pub daily_invest_bits: U128,
    /// A stake can be withdrawn this long after its last top-up.
    pub invest_lock_ms: u64,
}

impl Default for MarketParams {
    fn default() -> Self {
        Self {
            open: true,
            fee_bps: 200,
            floor_bps: 5_000,
            ceiling_bps: 40_000,
            max_amount: 20,
            max_open_listings: 3,
            max_listings: 300,
            daily_trades: 40,
            daily_listings: 10,
            daily_fills: 10,
            daily_fill_bits: U128(3_000),
            craft_bits: U128(DEFAULT_CRAFT_BITS),
            invest_open: true,
            invest_fee_bps: 5_000,
            min_invest: U128(10),
            max_invest: U128(500),
            daily_invests: 6,
            daily_invest_bits: U128(1_000),
            invest_lock_ms: 3_600_000,
        }
    }
}

/// One item's curve and the vendor's holdings of it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pool {
    pub item: String,
    pub virtual_bits: U128,
    pub virtual_items: U128,
    /// Bits in the vendor's till for this item.
    pub bits: U128,
    /// Items the vendor can sell.
    pub stock: U128,
    /// Items escrowed in players' open listings.
    pub escrow: U128,
    // ---- v3 (invest.rs) ----
    /// Investors' Bits in the till. Each one replaced a virtual Bit, so `virtual_bits`
    /// here is the owner's setting less this, and `virtual_bits + bits` never moved.
    #[serde(default)]
    pub invested: U128,
    /// Fee earnings held for this pool's investors, not yet claimed. Not part of the till.
    #[serde(default)]
    pub rewards: U128,
    /// Earnings per invested Bit so far, x 10^12.
    #[serde(default)]
    pub fee_acc: U128,
    /// The investors' share of fees not yet a whole Bit, in 1/10000 Bits.
    #[serde(default)]
    pub fee_carry: u32,
}

/// How the owner sets up a pool. Seeds are minted to the vendor once, when the pool is new.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PoolConfig {
    pub item: String,
    pub virtual_bits: U128,
    pub virtual_items: U128,
    #[serde(default)]
    pub seed_bits: U128,
    #[serde(default)]
    pub seed_stock: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub id: u64,
    pub seller: AccountId,
    pub item: String,
    pub amount: u32,
    /// Bits for the whole lot.
    pub price: U128,
    pub listed_at_ms: u64,
}

/// Per account: today's counters and open listings. One small entry per trader.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct MarketAccount {
    /// Days since the Unix epoch (UTC) the counters belong to.
    pub day: u32,
    pub trades: u32,
    pub listings: u32,
    pub fills: u32,
    pub fill_bits: u128,
    pub open: Vec<u64>,
}

#[near(serializers = [borsh])]
pub struct Market {
    pub params: MarketParams,
    pub pools: Vec<Pool>,
    pub listings: IterableMap<u64, Listing>,
    pub next_listing_id: u64,
    pub accounts: LookupMap<AccountId, MarketAccount>,
    /// Stakes and today's investing counters, per investor. Added in v3.
    pub investors: LookupMap<AccountId, Investor>,
}

impl Default for Market {
    fn default() -> Self {
        Self::new()
    }
}

impl Market {
    pub fn new() -> Self {
        Self {
            params: MarketParams::default(),
            pools: Vec::new(),
            listings: IterableMap::new(StorageKey::Listings),
            next_listing_id: 1,
            accounts: LookupMap::new(StorageKey::MarketAccounts),
            investors: LookupMap::new(StorageKey::Investors),
        }
    }
}

/// A vendor trade's receipt: `bits` is what the player paid (fee included) or received
/// (fee taken), and `pool` the curve after it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Trade {
    pub item: String,
    pub amount: u32,
    pub bits: U128,
    pub fee: U128,
    pub pool: Pool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Quote {
    pub item: String,
    pub amount: u32,
    /// Spot price × 1000 (Bits per item, three decimals).
    pub price_milli: U128,
    /// What buying `amount` costs, fee included; null when the vendor holds fewer.
    pub buy: Option<U128>,
    /// What selling `amount` pays, fee taken; null when the till can't cover it.
    pub sell: Option<U128>,
    /// The lowest and highest price a listing of `amount` may ask.
    pub floor: U128,
    pub ceiling: U128,
}

#[near(serializers = [json])]
pub struct MarketState {
    pub vendor: AccountId,
    pub params: MarketParams,
    pub pools: Vec<Pool>,
    /// Spot prices × 1000, in pool order.
    pub prices_milli: Vec<U128>,
    pub listings: u32,
    pub day: u32,
}

#[near(serializers = [json])]
pub struct MarketAccountView {
    pub bits: U128,
    pub trades_left: u32,
    pub listings_left: u32,
    pub fills_left: u32,
    pub fill_bits_left: U128,
    pub open: Vec<u64>,
}

/* ------------------------------------------------------------------ the math (pure) */

fn ceil_div(a: u128, b: u128) -> u128 {
    a.div_ceil(b)
}

/// (x, y): items and Bits on the curve.
pub fn reserves(p: &Pool) -> (u128, u128) {
    (p.virtual_items.0 + p.stock.0, p.virtual_bits.0 + p.bits.0)
}

pub fn spot_milli(p: &Pool) -> u128 {
    let (x, y) = reserves(p);
    y * 1000 / x
}

/// Bits to buy `n` before the fee, or None if the vendor holds fewer than `n`.
pub fn buy_cost(p: &Pool, n: u128) -> Option<u128> {
    if n == 0 || n > p.stock.0 {
        return None;
    }
    let (x, y) = reserves(p);
    Some(ceil_div(y * n, x - n))
}

/// Bits for selling `n` before the fee (it may exceed the till; callers check).
pub fn sell_payout(p: &Pool, n: u128) -> u128 {
    let (x, y) = reserves(p);
    y * n / (x + n)
}

/// The gas fee on `bits`, rounded up.
pub fn fee_of(bits: u128, fee_bps: u32) -> u128 {
    ceil_div(bits * fee_bps as u128, BPS)
}

/// The price range a listing of `n` may ask: [floor, ceiling] of the spot price × n.
pub fn listing_bounds(p: &Pool, n: u128, floor_bps: u32, ceiling_bps: u32) -> (u128, u128) {
    let (x, y) = reserves(p);
    let lo = ceil_div(y * n * floor_bps as u128, x * BPS).max(1);
    let hi = (y * n * ceiling_bps as u128 / (x * BPS)).max(lo);
    (lo, hi)
}

/// Applies a buy of `n` that cost `cost` to the pool.
pub fn apply_buy(p: &mut Pool, n: u128, cost: u128) {
    p.stock.0 -= n;
    p.bits.0 += cost;
}

/// Applies a sell of `n` that paid `payout` from the till.
pub fn apply_sell(p: &mut Pool, n: u128, payout: u128) {
    p.stock.0 += n;
    p.bits.0 -= payout;
}

/// Bits the till is short of to buy one item from a player; 0 when it can.
pub fn till_short(p: &Pool) -> u128 {
    sell_payout(p, 1).saturating_sub(p.bits.0)
}

/// Why the vendor can't trade this item right now, if it can't: "broke" (the till can't
/// pay for one item, so it buys nothing until someone invests or buys from it) and
/// "sold-out" (no stock, so it sells nothing until someone sells to it).
pub fn closed_reasons(p: &Pool) -> Vec<&'static str> {
    let mut out = Vec::new();
    if till_short(p) > 0 {
        out.push("broke");
    }
    if p.stock.0 == 0 {
        out.push("sold-out");
    }
    out
}

pub(crate) fn today() -> u32 {
    (env::block_timestamp_ms() / DAY_MS) as u32
}

fn transfer(from: &AccountId, to: &AccountId, token: TokenId, amount: u128) -> MtTransferEvent {
    transfer_memo(from, to, token, amount, "market")
}

pub(crate) fn transfer_memo(
    from: &AccountId,
    to: &AccountId,
    token: TokenId,
    amount: u128,
    memo: &str,
) -> MtTransferEvent {
    MtTransferEvent {
        authorized_id: None,
        old_owner_id: from.clone(),
        new_owner_id: to.clone(),
        token_ids: vec![token],
        amounts: vec![U128(amount)],
        memo: Some(memo.to_string()),
    }
}

pub(crate) fn burn_fee(owner: &AccountId, fee: u128) -> MtEvent {
    MtEvent::MtBurn(vec![MtBurnEvent {
        owner_id: owner.clone(),
        authorized_id: None,
        token_ids: vec![BITS_TOKEN.to_string()],
        amounts: vec![U128(fee)],
        memo: Some("gas-fee".to_string()),
    }])
}

#[near]
impl Wgp {
    // ---------- Vendor (session key) ----------

    /// Buy `amount` of `item` from the vendor, paying at most `max_bits` (fee included).
    pub fn market_buy(&mut self, item: String, amount: u32, max_bits: U128) -> Trade {
        let i = self.trading(&item, amount);
        let account = env::predecessor_account_id();
        let acct = self.counted(&account, |a, p| {
            a.trades += 1;
            a.trades <= p.daily_trades
        });
        let n = amount as u128;
        let pool = &self.market.pools[i];
        let cost = buy_cost(pool, n).unwrap_or_else(|| {
            env::panic_str(&format!("The vendor has only {} {item}", pool.stock.0))
        });
        let fee = fee_of(cost, self.market.params.fee_bps);
        let total = cost + fee;
        require!(
            total <= max_bits.0,
            format!(
                "That costs {total} Bits now, over your limit of {}",
                max_bits.0
            )
        );
        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        require!(
            player.balance(BITS_TOKEN) >= total,
            format!("Needs {total} Bits")
        );
        player.debit(BITS_TOKEN, total);
        player.credit(&item_token(&item), n, true);
        self.players.insert(account.clone(), player);
        let before = closed_reasons(&self.market.pools[i]);
        let cut = self.investor_cut(i, fee);
        self.sub_supply(BITS_TOKEN, fee - cut);
        apply_buy(&mut self.market.pools[i], n, cost);
        self.market.accounts.insert(account.clone(), acct);
        let trade = self.trade_events(&account, "buy", i, amount, cost, (fee, cut));
        self.shop_changed(i, &before, "buy");
        trade
    }

    /// Sell `amount` of `item` to the vendor for at least `min_bits` (after the fee).
    pub fn market_sell(&mut self, item: String, amount: u32, min_bits: U128) -> Trade {
        let i = self.trading(&item, amount);
        let account = env::predecessor_account_id();
        let acct = self.counted(&account, |a, p| {
            a.trades += 1;
            a.trades <= p.daily_trades
        });
        let n = amount as u128;
        let pool = &self.market.pools[i];
        let payout = sell_payout(pool, n);
        require!(payout > 0, "That's worth less than a Bit");
        require!(
            payout <= pool.bits.0,
            format!("The vendor's till holds only {} Bits", pool.bits.0)
        );
        let fee = fee_of(payout, self.market.params.fee_bps);
        let net = payout - fee;
        require!(
            net >= min_bits.0,
            format!(
                "That pays {net} Bits now, under your limit of {}",
                min_bits.0
            )
        );
        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        player.debit(&item_token(&item), n);
        player.credit(BITS_TOKEN, net, true);
        self.players.insert(account.clone(), player);
        let before = closed_reasons(&self.market.pools[i]);
        let cut = self.investor_cut(i, fee);
        self.sub_supply(BITS_TOKEN, fee - cut);
        apply_sell(&mut self.market.pools[i], n, payout);
        self.market.accounts.insert(account.clone(), acct);
        let trade = self.trade_events(&account, "sell", i, amount, net, (fee, cut));
        self.shop_changed(i, &before, "sell");
        trade
    }

    // ---------- Listings (session key) ----------

    /// Escrow `amount` of `item` for sale at `price_bits` for the lot.
    pub fn list_item(&mut self, item: String, amount: u32, price_bits: U128) -> Listing {
        let i = self.trading(&item, amount);
        let account = env::predecessor_account_id();
        let params = self.market.params.clone();
        require!(
            self.market.listings.len() < params.max_listings,
            "The market is full; try again later"
        );
        let mut acct = self.counted(&account, |a, p| {
            a.listings += 1;
            a.listings <= p.daily_listings
        });
        require!(
            (acct.open.len() as u32) < params.max_open_listings,
            format!("You can have {} listings open", params.max_open_listings)
        );
        let n = amount as u128;
        let (lo, hi) = listing_bounds(
            &self.market.pools[i],
            n,
            params.floor_bps,
            params.ceiling_bps,
        );
        require!(
            (lo..=hi).contains(&price_bits.0),
            format!("Price it between {lo} and {hi} Bits")
        );
        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        player.debit(&item_token(&item), n);
        self.players.insert(account.clone(), player);
        self.market.pools[i].escrow.0 += n;

        let id = self.market.next_listing_id;
        self.market.next_listing_id += 1;
        let listing = Listing {
            id,
            seller: account.clone(),
            item: item.clone(),
            amount,
            price: price_bits,
            listed_at_ms: env::block_timestamp_ms(),
        };
        self.market.listings.insert(id, listing.clone());
        acct.open.push(id);
        self.market.accounts.insert(account.clone(), acct);

        let vendor = env::current_account_id();
        MtEvent::MtTransfer(vec![transfer(&account, &vendor, item_token(&item), n)]).emit();
        WgpEvent::MarketList(vec![listing.clone()]).emit();
        listing
    }

    /// Buy a whole listing at its price. The seller gets the price less the gas fee.
    pub fn buy_listing(&mut self, listing_id: u64) -> Listing {
        self.assert_trading_open();
        let account = env::predecessor_account_id();
        let listing = self
            .market
            .listings
            .get(&listing_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("That listing is gone"));
        require!(listing.seller != account, "That's your own listing");
        let price = listing.price.0;
        let acct = self.counted(&account, |a, p| {
            a.fills += 1;
            a.fill_bits += price;
            a.fills <= p.daily_fills && a.fill_bits <= p.daily_fill_bits.0
        });
        let fee = fee_of(price, self.market.params.fee_bps);
        let n = listing.amount as u128;
        let token = item_token(&listing.item);

        let mut buyer = self.players.get(&account).cloned().unwrap_or_default();
        require!(
            buyer.balance(BITS_TOKEN) >= price,
            format!("Needs {price} Bits")
        );
        buyer.debit(BITS_TOKEN, price);
        buyer.credit(&token, n, true);
        self.players.insert(account.clone(), buyer);
        let mut seller = self
            .players
            .get(&listing.seller)
            .cloned()
            .unwrap_or_default();
        seller.credit(BITS_TOKEN, price - fee, false);
        self.players.insert(listing.seller.clone(), seller);
        self.sub_supply(BITS_TOKEN, fee);
        self.close_listing(&listing);
        self.market.accounts.insert(account.clone(), acct);

        let vendor = env::current_account_id();
        MtEvent::MtTransfer(vec![
            transfer(
                &account,
                &listing.seller,
                BITS_TOKEN.to_string(),
                price - fee,
            ),
            transfer(&vendor, &account, token, n),
        ])
        .emit();
        burn_fee(&account, fee).emit();
        WgpEvent::MarketFill(vec![FillData {
            listing_id,
            seller: listing.seller.clone(),
            buyer: account,
            item: listing.item.clone(),
            amount: listing.amount,
            price: listing.price,
            fee: U128(fee),
        }])
        .emit();
        listing
    }

    /// Take your listing down; the items come back. Works while trading is closed too.
    pub fn cancel_listing(&mut self, listing_id: u64) -> Listing {
        self.assert_live();
        let account = env::predecessor_account_id();
        let listing = self
            .market
            .listings
            .get(&listing_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("That listing is gone"));
        require!(
            listing.seller == account,
            "Only the seller can cancel a listing"
        );
        let token = item_token(&listing.item);
        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        player.credit(&token, listing.amount as u128, false);
        self.players.insert(account.clone(), player);
        self.close_listing(&listing);

        let vendor = env::current_account_id();
        MtEvent::MtTransfer(vec![transfer(
            &vendor,
            &account,
            token,
            listing.amount as u128,
        )])
        .emit();
        WgpEvent::MarketCancel(vec![listing.clone()]).emit();
        listing
    }

    // ---------- Owner ----------

    /// Set the market's rules and pools. A new pool's seeds are minted to the vendor;
    /// an existing pool keeps its holdings and takes the new virtual reserves.
    #[payable]
    pub fn set_market_params(&mut self, params: MarketParams, pools: Vec<PoolConfig>) {
        self.assert_owner();
        require!(params.fee_bps <= 1_000, "fee_bps is at most 1000 (10%)");
        require!(
            params.floor_bps <= params.ceiling_bps && params.ceiling_bps >= BPS as u32,
            "Need floor_bps <= ceiling_bps and ceiling_bps >= 10000"
        );
        require!(
            (1..=MAX_ITEM_AMOUNT).contains(&params.max_amount),
            "max_amount is 1 to 1000"
        );
        require!(
            params.max_open_listings <= 10 && params.max_listings <= 10_000,
            "At most 10 open listings each and 10000 in all"
        );
        require!(
            params.invest_fee_bps <= BPS as u32,
            "invest_fee_bps is at most 10000 (the whole fee)"
        );
        require!(
            params.min_invest.0 >= 1
                && params.min_invest.0 <= params.max_invest.0
                && params.max_invest.0 <= MAX_RESERVE,
            "Need 1 <= min_invest <= max_invest"
        );
        require!(
            params.invest_lock_ms <= MAX_LOCK_MS,
            "invest_lock_ms is at most 30 days"
        );
        require!(pools.len() <= MAX_POOLS, "At most 32 pools");
        let vendor = env::current_account_id();
        let mut minted = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for c in pools {
            require!(
                self.items.contains(&c.item),
                format!("Unknown item: {}", c.item)
            );
            require!(seen.insert(c.item.clone()), "Duplicate pool");
            for v in [
                c.virtual_bits.0,
                c.virtual_items.0,
                c.seed_bits.0,
                c.seed_stock.0,
            ] {
                require!(v <= MAX_RESERVE, "Reserve too large");
            }
            require!(
                c.virtual_bits.0 >= 1 && c.virtual_items.0 >= 1,
                "Virtual reserves start at 1"
            );
            if let Some(p) = self.market.pools.iter_mut().find(|p| p.item == c.item) {
                // Investors' Bits stand in for part of the virtual reserve; keep them in.
                require!(
                    c.virtual_bits.0 > p.invested.0,
                    format!(
                        "{}: virtual_bits must stay above the {} Bits invested",
                        c.item, p.invested.0
                    )
                );
                p.virtual_bits = U128(c.virtual_bits.0 - p.invested.0);
                p.virtual_items = c.virtual_items;
                continue;
            }
            for (token, n) in [
                (item_token(&c.item), c.seed_stock.0),
                (BITS_TOKEN.to_string(), c.seed_bits.0),
            ] {
                if n > 0 {
                    self.add_supply(&token, n);
                    minted.push((token, n));
                }
            }
            self.market.pools.push(Pool {
                item: c.item,
                virtual_bits: c.virtual_bits,
                virtual_items: c.virtual_items,
                bits: c.seed_bits,
                stock: c.seed_stock,
                escrow: U128(0),
                invested: U128(0),
                rewards: U128(0),
                fee_acc: U128(0),
                fee_carry: 0,
            });
        }
        self.market.params = params;
        self.admin("set_market_params", None);
        if !minted.is_empty() {
            MtEvent::MtMint(vec![MtMintEvent {
                owner_id: vendor,
                amounts: minted.iter().map(|(_, n)| U128(*n)).collect(),
                token_ids: minted.into_iter().map(|(t, _)| t).collect(),
                memo: Some("market-seed".to_string()),
            }])
            .emit();
        }
    }

    // ---------- Views ----------

    pub fn market_state(&self) -> MarketState {
        MarketState {
            vendor: env::current_account_id(),
            params: self.market.params.clone(),
            prices_milli: self
                .market
                .pools
                .iter()
                .map(|p| U128(spot_milli(p)))
                .collect(),
            pools: self.market.pools.clone(),
            listings: self.market.listings.len(),
            day: today(),
        }
    }

    pub fn market_quote(&self, item: String, amount: u32) -> Quote {
        let p = &self.market.pools[self.pool_index(&item)];
        let n = amount.max(1) as u128;
        let fee = self.market.params.fee_bps;
        let payout = sell_payout(p, n);
        let (floor, ceiling) = listing_bounds(
            p,
            n,
            self.market.params.floor_bps,
            self.market.params.ceiling_bps,
        );
        Quote {
            item,
            amount: n as u32,
            price_milli: U128(spot_milli(p)),
            buy: buy_cost(p, n).map(|c| U128(c + fee_of(c, fee))),
            sell: (payout > 0 && payout <= p.bits.0).then(|| U128(payout - fee_of(payout, fee))),
            floor: U128(floor),
            ceiling: U128(ceiling),
        }
    }

    /// Open listings, `limit` (at most 50) from `from_index`. Order changes as listings close.
    pub fn market_listings(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Listing> {
        self.market
            .listings
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize)
            .cloned()
            .collect()
    }

    pub fn market_listing(&self, listing_id: u64) -> Option<Listing> {
        self.market.listings.get(&listing_id).cloned()
    }

    /// An account's Bits, what it may still do today, and its open listing ids.
    pub fn market_account(&self, account_id: AccountId) -> MarketAccountView {
        let p = &self.market.params;
        let a = self.account_today(&account_id);
        MarketAccountView {
            bits: U128(self.balance_of(&account_id, BITS_TOKEN)),
            trades_left: p.daily_trades.saturating_sub(a.trades),
            listings_left: p.daily_listings.saturating_sub(a.listings),
            fills_left: p.daily_fills.saturating_sub(a.fills),
            fill_bits_left: U128(p.daily_fill_bits.0.saturating_sub(a.fill_bits)),
            open: a.open,
        }
    }

    pub fn bits_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance_of(&account_id, BITS_TOKEN))
    }
}

impl Wgp {
    /// What the contract itself holds of a token for the market: the vendor's stock or
    /// till, plus escrowed listings.
    pub(crate) fn market_holdings(&self, token_id: &str) -> u128 {
        if token_id == BITS_TOKEN {
            return self
                .market
                .pools
                .iter()
                .map(|p| p.bits.0 + p.rewards.0)
                .sum();
        }
        self.market
            .pools
            .iter()
            .find(|p| item_token(&p.item) == token_id)
            .map(|p| p.stock.0 + p.escrow.0)
            .unwrap_or(0)
    }

    pub(crate) fn pool_index(&self, item: &str) -> usize {
        self.market
            .pools
            .iter()
            .position(|p| p.item == item)
            .unwrap_or_else(|| env::panic_str(&format!("The market doesn't trade {item}")))
    }

    pub(crate) fn assert_trading_open(&self) {
        self.assert_live();
        require!(self.market.params.open, "The market is closed");
    }

    /// Checks the market is open, the item traded and the amount allowed; its pool index.
    fn trading(&self, item: &str, amount: u32) -> usize {
        self.assert_trading_open();
        require!(
            amount >= 1 && amount <= self.market.params.max_amount,
            format!("Trade 1 to {} at a time", self.market.params.max_amount)
        );
        self.pool_index(item)
    }

    fn account_today(&self, account: &AccountId) -> MarketAccount {
        let mut a = self
            .market
            .accounts
            .get(account)
            .cloned()
            .unwrap_or_default();
        let day = today();
        if a.day != day {
            a = MarketAccount {
                day,
                open: a.open,
                ..Default::default()
            };
        }
        a
    }

    /// Today's counters with one more action counted; panics if that's past a daily cap.
    fn counted(
        &self,
        account: &AccountId,
        count: impl FnOnce(&mut MarketAccount, &MarketParams) -> bool,
    ) -> MarketAccount {
        let mut a = self.account_today(account);
        require!(
            count(&mut a, &self.market.params),
            "Daily market limit reached; it resets at midnight UTC"
        );
        a
    }

    /// Takes the investors' share of a vendor trade's fee out of what would be burned and
    /// books it to the pool's investors. Whole Bits only; the fraction carries to the next
    /// trade, so many small fees still add up. 0 while the pool has no investors.
    fn investor_cut(&mut self, i: usize, fee: u128) -> u128 {
        let share = self.market.params.invest_fee_bps as u128;
        let p = &mut self.market.pools[i];
        if p.invested.0 == 0 || share == 0 {
            return 0;
        }
        let carry = p.fee_carry as u128 + fee * share;
        let cut = carry / BPS;
        p.fee_carry = (carry % BPS) as u32;
        if cut > 0 {
            p.rewards.0 += cut;
            p.fee_acc.0 = p
                .fee_acc
                .0
                .saturating_add(cut * crate::invest::ACC / p.invested.0);
        }
        cut
    }

    /// Logs `market_shop` when a pool opened or closed for buying or selling.
    pub(crate) fn shop_changed(&self, i: usize, before: &[&'static str], cause: &str) {
        let p = &self.market.pools[i];
        let now = closed_reasons(p);
        if now != before {
            WgpEvent::MarketShop(vec![ShopData {
                item: p.item.clone(),
                closed: now.into_iter().map(String::from).collect(),
                cause: cause.to_string(),
                till: p.bits,
                needs: U128(till_short(p)),
            }])
            .emit();
        }
    }

    pub(crate) fn admin(&self, action: &str, account_id: Option<AccountId>) {
        WgpEvent::Admin(vec![AdminData {
            action: action.to_string(),
            by: env::predecessor_account_id(),
            account_id,
        }])
        .emit();
    }

    /// Removes a listing from the book, the seller's open list and the pool's escrow.
    fn close_listing(&mut self, listing: &Listing) {
        self.market.listings.remove(&listing.id);
        if let Some(i) = self
            .market
            .pools
            .iter()
            .position(|p| p.item == listing.item)
        {
            let e = &mut self.market.pools[i].escrow.0;
            *e = e.saturating_sub(listing.amount as u128);
        }
        if let Some(mut a) = self.market.accounts.get(&listing.seller).cloned() {
            a.open.retain(|id| *id != listing.id);
            self.market.accounts.insert(listing.seller.clone(), a);
        }
    }

    fn trade_events(
        &self,
        account: &AccountId,
        side: &str,
        i: usize,
        amount: u32,
        bits: u128,
        (fee, cut): (u128, u128),
    ) -> Trade {
        let pool = self.market.pools[i].clone();
        let vendor = env::current_account_id();
        let item = item_token(&pool.item);
        let n = amount as u128;
        // The investors' cut of the fee isn't burned: on a buy it reaches the vendor with
        // the cost; on a sell it never leaves the vendor.
        let (moves, burner) = if side == "buy" {
            (
                vec![
                    transfer(account, &vendor, BITS_TOKEN.to_string(), bits + cut),
                    transfer(&vendor, account, item, n),
                ],
                account,
            )
        } else {
            (
                vec![
                    transfer(account, &vendor, item, n),
                    transfer(&vendor, account, BITS_TOKEN.to_string(), bits),
                ],
                &vendor,
            )
        };
        MtEvent::MtTransfer(moves).emit();
        if fee > cut {
            burn_fee(burner, fee - cut).emit();
        }
        // `bits` in the event and receipt: paid with the fee (buy) or received after it (sell).
        let paid = if side == "buy" { bits + fee } else { bits };
        WgpEvent::MarketTrade(vec![TradeData {
            account_id: account.clone(),
            side: side.to_string(),
            item: pool.item.clone(),
            amount,
            bits: U128(paid),
            fee: U128(fee),
            price_milli: U128(spot_milli(&pool)),
        }])
        .emit();
        Trade {
            item: pool.item.clone(),
            amount,
            bits: U128(paid),
            fee: U128(fee),
            pool,
        }
    }
}
