//! NEP-297 event logs.
//!
//! `MtEvent` mirrors `defuse_nep245::MtEvent` field for field, so NEAR Intents, indexers
//! and explorers read our mints, burns and transfers exactly as they read intents.near's.
//! `WgpEvent` carries the game's own facts (heroes, crafts, run digests, seasons), which
//! live only in logs and never in contract state.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::TokenId;

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
