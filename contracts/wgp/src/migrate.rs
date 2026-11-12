//! State layouts and the upgrade between them. `upgrade` deploys new code and calls
//! `migrate`, which reads the raw state and rebuilds it in the current layout.
//!
//! - v1: heroes, rewards, crafting and seasons (deployed Nov 2026).
//! - v2: v1 plus `market` (the Mempool Market), appended last.
//! - v3: a layout tag first, the market's investing fields (new rules in `MarketParams`,
//!   four fields per `Pool`, the investors map), the token index and the metadata table.
//!
//! Collections keep their storage prefixes and the new ones get new prefixes, so nothing
//! but the root entry is rewritten: no player, listing or season entry is touched.
//!
//! Which layout is it? A v3 state starts with `LAYOUT_V3`; v1 and v2 start with the owner
//! id's length, which is at most 64, so the first four bytes settle it. Between v1 and v2
//! Borsh refuses trailing or missing bytes, so each parses only as itself.

use near_sdk::borsh::BorshDeserialize;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, near, AccountId};

use crate::{
    Listing, Market, MarketAccount, MarketParams, Meta, Player, Pool, Season, StorageKey, SuitRule,
    TokenId, Wgp, LAYOUT_V3,
};

/// The v1 root state, field for field.
#[near(serializers = [borsh])]
pub(crate) struct WgpV1 {
    pub owner_id: AccountId,
    pub operators: IterableSet<AccountId>,
    pub paused: bool,
    pub items: Vec<String>,
    pub suits: Vec<SuitRule>,
    pub starter_unlock_level: u32,
    pub players: LookupMap<AccountId, Player>,
    pub supply: LookupMap<TokenId, u128>,
    pub seasons: LookupMap<String, Season>,
}

/// The v2 market rules, field for field.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub(crate) struct MarketParamsV2 {
    pub open: bool,
    pub fee_bps: u32,
    pub floor_bps: u32,
    pub ceiling_bps: u32,
    pub max_amount: u32,
    pub max_open_listings: u32,
    pub max_listings: u32,
    pub daily_trades: u32,
    pub daily_listings: u32,
    pub daily_fills: u32,
    pub daily_fill_bits: U128,
    pub craft_bits: U128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub(crate) struct PoolV2 {
    pub item: String,
    pub virtual_bits: U128,
    pub virtual_items: U128,
    pub bits: U128,
    pub stock: U128,
    pub escrow: U128,
}

#[near(serializers = [borsh])]
pub(crate) struct MarketV2 {
    pub params: MarketParamsV2,
    pub pools: Vec<PoolV2>,
    pub listings: IterableMap<u64, Listing>,
    pub next_listing_id: u64,
    pub accounts: LookupMap<AccountId, MarketAccount>,
}

/// The v2 root state, field for field: what `game.wgpnear.near` holds before v3.
#[near(serializers = [borsh])]
pub(crate) struct WgpV2 {
    pub owner_id: AccountId,
    pub operators: IterableSet<AccountId>,
    pub paused: bool,
    pub items: Vec<String>,
    pub suits: Vec<SuitRule>,
    pub starter_unlock_level: u32,
    pub players: LookupMap<AccountId, Player>,
    pub supply: LookupMap<TokenId, u128>,
    pub seasons: LookupMap<String, Season>,
    pub market: MarketV2,
}

/// The live rules carry over exactly, `craft_bits` included: an upgrade changes no price
/// and no cost. The investing rules are new and start at their defaults.
fn params_v3(p: MarketParamsV2) -> MarketParams {
    MarketParams {
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
        ..MarketParams::default()
    }
}

fn pool_v3(p: PoolV2) -> Pool {
    Pool {
        item: p.item,
        virtual_bits: p.virtual_bits,
        virtual_items: p.virtual_items,
        bits: p.bits,
        stock: p.stock,
        escrow: p.escrow,
        invested: U128(0),
        rewards: U128(0),
        fee_acc: U128(0),
        fee_carry: 0,
    }
}

fn market_v3(m: MarketV2) -> Market {
    Market {
        params: params_v3(m.params),
        pools: m.pools.into_iter().map(pool_v3).collect(),
        listings: m.listings,
        next_listing_id: m.next_listing_id,
        accounts: m.accounts,
        investors: LookupMap::new(StorageKey::Investors),
    }
}

/// The current state from raw state bytes in any layout.
pub(crate) fn upgrade_state(bytes: &[u8]) -> Wgp {
    if bytes.len() >= 4 && bytes[..4] == LAYOUT_V3.to_le_bytes() {
        return Wgp::try_from_slice(bytes)
            .unwrap_or_else(|_| env::panic_str("The v3 contract state doesn't parse"));
    }
    let (v1, market) = if let Ok(v2) = WgpV2::try_from_slice(bytes) {
        (
            WgpV1 {
                owner_id: v2.owner_id,
                operators: v2.operators,
                paused: v2.paused,
                items: v2.items,
                suits: v2.suits,
                starter_unlock_level: v2.starter_unlock_level,
                players: v2.players,
                supply: v2.supply,
                seasons: v2.seasons,
            },
            market_v3(v2.market),
        )
    } else {
        let v1 = WgpV1::try_from_slice(bytes)
            .unwrap_or_else(|_| env::panic_str("The contract state is in no known layout"));
        (v1, Market::new())
    };
    Wgp {
        layout: LAYOUT_V3,
        owner_id: v1.owner_id,
        operators: v1.operators,
        paused: v1.paused,
        items: v1.items,
        suits: v1.suits,
        starter_unlock_level: v1.starter_unlock_level,
        players: v1.players,
        supply: v1.supply,
        seasons: v1.seasons,
        market,
        tokens: IterableSet::new(StorageKey::Tokens),
        meta: Meta::new(),
    }
}
