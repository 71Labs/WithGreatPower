//! NEP-297 event logs.
//!
//! `MtEvent` mirrors `defuse_nep245::MtEvent` field for field, so NEAR Intents, indexers
//! and explorers read our mints, burns and transfers exactly as they read intents.near's.
//! `WgpEvent` carries the game's own facts (heroes, crafts, run digests, seasons, market
//! trades and listings). Run digests and trade prices live only in logs, never in state.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::{Listing, TokenId};

#[near(event_json(standard = "nep245"))]
#[derive(Debug, Clone)]
pub enum MtEvent {
    #[event_version("1.0.0")]
    MtMint(Vec<MtMintEvent>),
    #[event_version("1.0.0")]
    MtBurn(Vec<MtBurnEvent>),
    #[event_version("1.0.0")]
    MtTransfer(Vec<MtTransferEvent>),
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct MtMintEvent {
    pub owner_id: AccountId,
    pub token_ids: Vec<TokenId>,
    pub amounts: Vec<U128>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct MtBurnEvent {
    pub owner_id: AccountId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorized_id: Option<AccountId>,
    pub token_ids: Vec<TokenId>,
    pub amounts: Vec<U128>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct MtTransferEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorized_id: Option<AccountId>,
    pub old_owner_id: AccountId,
    pub new_owner_id: AccountId,
    pub token_ids: Vec<TokenId>,
    pub amounts: Vec<U128>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[near(event_json(standard = "wgp"))]
#[derive(Debug, Clone)]
pub enum WgpEvent {
    #[event_version("1.0.0")]
    RegisterHero(Vec<HeroData>),
    #[event_version("1.0.0")]
    CraftSuit(Vec<SuitData>),
    #[event_version("1.0.0")]
    EquipSuit(Vec<SuitData>),
    /// One verified run's rewards. The digest commits to the run (seed, input log and
    /// verified score) so anyone can match a mint to its replay.
    #[event_version("1.0.0")]
    Reward(Vec<RewardData>),
    #[event_version("1.0.0")]
    Season(Vec<SeasonData>),
    /// A vendor trade: `bits` paid (buy, fee included) or received (sell, after the fee).
    #[event_version("1.0.0")]
    MarketTrade(Vec<TradeData>),
    #[event_version("1.0.0")]
    MarketList(Vec<Listing>),
    #[event_version("1.0.0")]
    MarketFill(Vec<FillData>),
    #[event_version("1.0.0")]
    MarketCancel(Vec<Listing>),
    // ---- v3 ----
    /// Bits added to a pool's till by an investor.
    #[event_version("1.0.0")]
    MarketInvest(Vec<StakeData>),
    /// Bits an investor took back out of a pool's till.
    #[event_version("1.0.0")]
    MarketWithdraw(Vec<StakeData>),
    /// Fee earnings paid to an investor with no change to the stake.
    #[event_version("1.0.0")]
    MarketClaim(Vec<StakeData>),
    /// A pool opened or closed for buying or selling: `closed` lists why it can't trade
    /// now ("broke", "sold-out"); empty means open both ways.
    #[event_version("1.0.0")]
    MarketShop(Vec<ShopData>),
    /// An owner action: pause, operators, ownership, rules, market or metadata settings.
    #[event_version("1.0.0")]
    Admin(Vec<AdminData>),
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct StakeData {
    pub account_id: AccountId,
    pub item: String,
    /// Bits invested or withdrawn by this call (0 for a claim).
    pub bits: U128,
    /// Fee earnings paid out by this call.
    pub earned: U128,
    /// The account's stake in this pool afterwards.
    pub stake: U128,
    /// Every investor's Bits in this pool afterwards.
    pub invested: U128,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct ShopData {
    pub item: String,
    pub closed: Vec<String>,
    /// What changed it: "buy", "sell", "invest" or "withdraw".
    pub cause: String,
    /// Bits in the till afterwards, and how many more it needs to buy one item.
    pub till: U128,
    pub needs: U128,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct AdminData {
    pub action: String,
    pub by: AccountId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<AccountId>,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct HeroData {
    pub account_id: AccountId,
    pub name: String,
    pub suit: String,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct SuitData {
    pub account_id: AccountId,
    pub suit: String,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct RewardData {
    pub account_id: AccountId,
    pub nonce: u64,
    pub level: u32,
    pub digest: String,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct SeasonData {
    pub season_id: String,
    pub root: String,
    pub digest: String,
    pub top10: Vec<AccountId>,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct TradeData {
    pub account_id: AccountId,
    /// "buy" or "sell".
    pub side: String,
    pub item: String,
    pub amount: u32,
    pub bits: U128,
    pub fee: U128,
    /// The spot price after the trade, × 1000.
    pub price_milli: U128,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct FillData {
    pub listing_id: u64,
    pub seller: AccountId,
    pub buyer: AccountId,
    pub item: String,
    pub amount: u32,
    pub price: U128,
    pub fee: U128,
}
