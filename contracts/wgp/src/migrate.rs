//! State layouts and the upgrade between them. `upgrade` deploys new code and calls
//! `migrate`, which reads the raw state and rebuilds it in the current layout.
//!
//! - v1: heroes, rewards, crafting and seasons (deployed Nov 2026).
//! - v2: v1 plus `market` (the Mempool Market), appended last, so a v1 state is a prefix
//!   of a v2 one and only the new field needs a value.
//!
//! Collections keep their storage prefixes, so nothing but the root entry is rewritten.

use near_sdk::borsh::BorshDeserialize;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, near, AccountId};

use crate::{Market, Player, Season, SuitRule, TokenId, Wgp};

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

/// The current state from raw state bytes in either layout. Borsh refuses trailing or
/// missing bytes, so a v2 state never parses as v1 and a v1 state never parses as v2.
pub(crate) fn upgrade_state(bytes: &[u8]) -> Wgp {
    if let Ok(current) = Wgp::try_from_slice(bytes) {
        return current;
    }
    let v1 = WgpV1::try_from_slice(bytes)
        .unwrap_or_else(|_| env::panic_str("The contract state is in no known layout"));
    Wgp {
        owner_id: v1.owner_id,
        operators: v1.operators,
        paused: v1.paused,
        items: v1.items,
        suits: v1.suits,
        starter_unlock_level: v1.starter_unlock_level,
        players: v1.players,
        supply: v1.supply,
        seasons: v1.seasons,
        market: Market::new(),
    }
}
