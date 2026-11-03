//! With Great Power: the game's tokens on NEAR.
//!
//! Every token is a NEP-245 multi-token:
//! - `hero:<account>`: one per player, soulbound, minted by `register_hero`.
//! - `suit:<id>`: a suit the player owns. Starter suits come with the hero; the rest are
//!   crafted from loot.
//! - `item:<id>`: loot from verified runs, minted by the operator.
//! - `item:bits`: Bits, the Mempool Market's currency, minted per verified night.
//! - `trophy:<season>:<rank>` and `trophy:badge:<id>`: soulbound awards.
//!
//! Who can do what:
//! - Players act through a function-call session key (no deposit possible): register a
//!   hero, craft and equip suits, and trade on the Mempool Market (market.rs) within
//!   daily caps. Our relayer pays their gas.
//! - Moving tokens needs exactly 1 yoctoNEAR, so only a full-access key can do it. A
//!   leaked session key can never move a player's assets.
//! - The operator (the game server) mints rewards for runs it has replayed and verified,
//!   and records each season's final board.
//! - The owner pauses, manages operators, sets suit rules and upgrades the code.
//!
//! The contract pays for storage and bounds it per account (`MAX_KINDS` token kinds, a
//! few open listings). Nothing is stored per run or per trade: digests and prices go in
//! the event log only.

mod events;
mod market;
#[cfg(test)]
mod market_tests;
mod migrate;
mod mt;
#[cfg(test)]
mod tests;

use near_sdk::json_types::U128;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

pub use events::*;
pub use market::*;
pub use mt::Token;

pub type TokenId = String;

/// Token kinds one account may hold, the hero included. Bounds sponsored storage.
pub const MAX_KINDS: usize = 64;
pub const MAX_NAME_CHARS: usize = 24;
/// A call may log at most 16 KB. 20 worst-case rewards (64-char account, 8 items plus
/// Bits, 2 badges) log about 12 KB; `tests::a_full_batch_fits_the_log_limit` checks it.
pub const MAX_REWARD_BATCH: usize = 20;
/// Every item kind plus Bits.
pub const MAX_ITEMS_PER_REWARD: usize = 9;
pub const MAX_BADGES_PER_REWARD: usize = 2;
pub const MAX_ITEM_AMOUNT: u32 = 1_000;
pub const MAX_LEVEL: u32 = 1_000;
pub const MAX_TOP: usize = 10;
pub const MAX_ID_LEN: usize = 32;

const GAS_FOR_MIGRATE: Gas = Gas::from_tgas(50);

#[derive(BorshStorageKey)]
#[near]
pub(crate) enum StorageKey {
    Operators,
    Players,
    Supply,
    Seasons,
    // Added with the market; new keys go at the end so existing prefixes never move.
    Listings,
    MarketAccounts,
}

/// One ingredient of a suit recipe.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Ingredient {
    pub item: String,
    pub amount: u32,
}

/// A suit and how to get it, from game-core's `SUITS`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SuitRule {
    pub id: String,
    /// Starter suits can be picked at sign-up; the others unlock at `starter_unlock_level`.
    pub starter: bool,
    /// Level needed to craft a non-starter suit.
    pub min_level: u32,
    pub recipe: Vec<Ingredient>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Hero {
    pub name: String,
    /// The equipped suit.
    pub suit: String,
    pub registered_at_ms: u64,
}

/// Everything stored for one account: a single storage entry, read once per call.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Player {
    pub hero: Option<Hero>,
    /// The server-verified level, synced by reward mints. Never goes down.
    pub level: u32,
    /// The last reward nonce applied. The next mint must carry `reward_nonce + 1`.
    pub reward_nonce: u64,
    /// Non-zero balances, at most `MAX_KINDS` (fewer by one once the hero exists).
    pub balances: Vec<(TokenId, u128)>,
}

impl Player {
    pub fn balance(&self, token_id: &str) -> u128 {
        self.balances
            .iter()
            .find(|(id, _)| id == token_id)
            .map(|(_, n)| *n)
            .unwrap_or(0)
    }

    pub fn kinds(&self) -> usize {
        self.balances.len() + usize::from(self.hero.is_some())
    }

    /// Adds to a balance. `capped` refuses a new kind past `MAX_KINDS`; refunds and
    /// trophies skip the cap so they can never fail half way.
    pub(crate) fn credit(&mut self, token_id: &str, amount: u128, capped: bool) {
        if let Some((_, n)) = self.balances.iter_mut().find(|(id, _)| id == token_id) {
            *n = n
                .checked_add(amount)
                .unwrap_or_else(|| env::panic_str("Balance overflow"));
            return;
        }
        if capped {
            require!(self.kinds() < MAX_KINDS, ERR_TOO_MANY_KINDS);
        }
        self.balances.push((token_id.to_string(), amount));
    }

    pub(crate) fn debit(&mut self, token_id: &str, amount: u128) {
        let i = self
            .balances
            .iter()
            .position(|(id, _)| id == token_id)
            .unwrap_or_else(|| env::panic_str(&format!("Not enough {token_id}")));
        let n = &mut self.balances[i].1;
        require!(*n >= amount, format!("Not enough {token_id}"));
        *n -= amount;
        if *n == 0 {
            self.balances.remove(i);
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Season {
    /// Merkle root (hex) of the published leaderboard leaves.
    pub root: String,
    /// The top of the board, best first. `trophy:<season>:<rank>` went to each.
    pub top10: Vec<AccountId>,
    /// Digest (hex) of the season's full results file.
    pub digest: String,
    pub recorded_at_ms: u64,
}

/// One verified run's rewards for one player.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RewardMint {
    pub account_id: AccountId,
    /// Must be the player's `reward_nonce + 1`.
    pub nonce: u64,
    #[serde(default)]
    pub items: Vec<Ingredient>,
    /// The player's verified level after this run.
    #[serde(default)]
    pub level: Option<u32>,
    /// One-off soulbound badges, minted as `trophy:badge:<id>` (e.g. "day-one").
    #[serde(default)]
    pub badges: Vec<String>,
    /// sha256 (hex) of the verified run. Logged, never stored.
    pub digest: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RewardStatus {
    Applied,
    /// This nonce was already applied: safe to mark done.
    Duplicate,
    /// An earlier nonce is missing: send that one first.
    OutOfOrder,
    /// The player holds `MAX_KINDS` kinds and this mint needs a new one.
    Full,
}

#[near(serializers = [json])]
pub struct PlayerView {
    pub hero: Option<Hero>,
    pub level: u32,
    pub reward_nonce: u64,
    /// Every token the account holds, the hero first.
    pub tokens: Vec<(TokenId, U128)>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub operators: Vec<AccountId>,
    pub paused: bool,
    pub items: Vec<String>,
    pub suits: Vec<SuitRule>,
    pub starter_unlock_level: u32,
    pub max_kinds: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Wgp {
    owner_id: AccountId,
    operators: IterableSet<AccountId>,
    paused: bool,
    items: Vec<String>,
    suits: Vec<SuitRule>,
    starter_unlock_level: u32,
    players: LookupMap<AccountId, Player>,
    /// Supply of items, suits and trophies. Hero supply is derived (one per hero).
    supply: LookupMap<TokenId, u128>,
    seasons: LookupMap<String, Season>,
    /// The Mempool Market. Appended in v2; `migrate` adds it to a v1 state.
    market: Market,
}

#[near]
impl Wgp {
    #[init]
    pub fn new(
        owner_id: AccountId,
        operators: Vec<AccountId>,
        items: Vec<String>,
        suits: Vec<SuitRule>,
        starter_unlock_level: u32,
    ) -> Self {
        validate_rules(&items, &suits, starter_unlock_level);
        let mut set = IterableSet::new(StorageKey::Operators);
        for op in operators {
            set.insert(op);
        }
        Self {
            owner_id,
            operators: set,
            paused: false,
            items,
            suits,
            starter_unlock_level,
            players: LookupMap::new(StorageKey::Players),
            supply: LookupMap::new(StorageKey::Supply),
            seasons: LookupMap::new(StorageKey::Seasons),
            market: Market::new(),
        }
    }

    // ---------- Player actions (session key) ----------

    /// Create the caller's hero with a starter suit. Mints `hero:<caller>` and the suit.
    pub fn register_hero(&mut self, name: String, suit: String) -> Hero {
        self.assert_live();
        let account = env::predecessor_account_id();
        let name = clean_name(&name);
        let rule = self.suit(&suit);
        require!(rule.starter, "Pick a starter suit");

        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        require!(player.hero.is_none(), "This account already has a hero");
        let suit_token = suit_token(&suit);
        // The hero takes a kind slot too.
        require!(
            player.kinds() + usize::from(player.balance(&suit_token) == 0) < MAX_KINDS,
            ERR_TOO_MANY_KINDS
        );

        let hero = Hero {
            name: name.clone(),
            suit: suit.clone(),
            registered_at_ms: env::block_timestamp_ms(),
        };
        player.hero = Some(hero.clone());
        player.level = player.level.max(1);
        let mut minted = vec![hero_token(&account)];
        if player.balance(&suit_token) == 0 {
            player.credit(&suit_token, 1, false);
            self.add_supply(&suit_token, 1);
            minted.push(suit_token);
        }
        self.players.insert(account.clone(), player);

        let amounts = vec![U128(1); minted.len()];
        MtEvent::MtMint(vec![MtMintEvent {
            owner_id: account.clone(),
            token_ids: minted,
            amounts,
            memo: None,
        }])
        .emit();
        WgpEvent::RegisterHero(vec![HeroData {
            account_id: account,
            name,
            suit,
        }])
        .emit();
        hero
    }

    /// Burn a suit's recipe and mint the suit, then equip it. Mirrors game-core's
    /// `craft-suit`: starter suits unlock at `starter_unlock_level` with no recipe,
    /// the rest need `min_level` and their ingredients, plus the market's `craft_bits`
    /// (burned too; 0 by default).
    pub fn craft_suit(&mut self, suit: String) {
        self.assert_live();
        let account = env::predecessor_account_id();
        let rule = self.suit(&suit).clone();
        let mut player = self.players.get(&account).cloned().unwrap_or_default();
        require!(player.hero.is_some(), ERR_NO_HERO);
        let suit_token = suit_token(&suit);
        require!(
            player.balance(&suit_token) == 0,
            "You already own this suit"
        );
        let needed = if rule.starter {
            self.starter_unlock_level
        } else {
            rule.min_level
        };
        require!(
            player.level >= needed,
            format!("Reach level {needed} to craft this suit")
        );

        let craft_bits = if rule.recipe.is_empty() {
            0
        } else {
            self.market.params.craft_bits.0
        };
        let mut burn: Vec<(TokenId, u128)> = rule
            .recipe
            .iter()
            .map(|i| (item_token(&i.item), i.amount as u128))
            .collect();
        if craft_bits > 0 {
            burn.push((BITS_TOKEN.to_string(), craft_bits));
        }
        let missing: Vec<String> = burn
            .iter()
            .filter_map(|(token, n)| {
                let have = player.balance(token);
                (have < *n).then(|| format!("{} x{}", &token[5..], n - have))
            })
            .collect();
        require!(missing.is_empty(), format!("Needs {}", missing.join(", ")));

        // Burning first frees kinds, so the suit always fits if the recipe was not empty.
        for (token, n) in &burn {
            player.debit(token, *n);
            self.sub_supply(token, *n);
        }
        player.credit(&suit_token, 1, true);
        self.add_supply(&suit_token, 1);
        if let Some(hero) = player.hero.as_mut() {
            hero.suit = suit.clone();
        }
        self.players.insert(account.clone(), player);

        if !burn.is_empty() {
            MtEvent::MtBurn(vec![MtBurnEvent {
                owner_id: account.clone(),
                authorized_id: None,
                amounts: burn.iter().map(|(_, n)| U128(*n)).collect(),
                token_ids: burn.into_iter().map(|(t, _)| t).collect(),
                memo: Some(format!("craft:{suit}")),
            }])
            .emit();
        }
        MtEvent::MtMint(vec![MtMintEvent {
            owner_id: account.clone(),
            token_ids: vec![suit_token],
            amounts: vec![U128(1)],
            memo: Some(format!("craft:{suit}")),
        }])
        .emit();
        WgpEvent::CraftSuit(vec![SuitData {
            account_id: account,
            suit,
        }])
        .emit();
    }

    /// Wear a suit the caller owns.
    pub fn equip_suit(&mut self, suit: String) {
        self.assert_live();
        let account = env::predecessor_account_id();
        self.suit(&suit);
        let player = self
            .players
            .get_mut(&account)
            .unwrap_or_else(|| env::panic_str(ERR_NO_HERO));
        require!(
            player.balance(&suit_token(&suit)) > 0,
            "You don't own this suit"
        );
        let hero = player
            .hero
            .as_mut()
            .unwrap_or_else(|| env::panic_str(ERR_NO_HERO));
        if hero.suit == suit {
            return;
        }
        hero.suit = suit.clone();
        WgpEvent::EquipSuit(vec![SuitData {
            account_id: account,
            suit,
        }])
        .emit();
    }

    // ---------- Operator ----------

    /// Mint rewards for verified runs. Each entry applies only when its nonce is the
    /// player's `reward_nonce + 1`, so retrying a batch never double-mints. Malformed
    /// input panics (nothing applied); per-entry outcomes come back in order.
    pub fn mint_rewards(&mut self, batch: Vec<RewardMint>) -> Vec<RewardStatus> {
        self.assert_live();
        self.assert_operator();
        require!(
            !batch.is_empty() && batch.len() <= MAX_REWARD_BATCH,
            "A batch holds 1 to 20 rewards"
        );
        for r in &batch {
            self.validate_reward(r);
        }

        let mut statuses = Vec::with_capacity(batch.len());
        let mut mints = Vec::new();
        let mut rewards = Vec::new();
        for r in batch {
            let mut player = self.players.get(&r.account_id).cloned().unwrap_or_default();
            if r.nonce <= player.reward_nonce {
                statuses.push(RewardStatus::Duplicate);
                continue;
            }
            if r.nonce != player.reward_nonce + 1 {
                statuses.push(RewardStatus::OutOfOrder);
                continue;
            }
            let badges: Vec<TokenId> = r
                .badges
                .iter()
                .map(|b| badge_token(b))
                .filter(|t| player.balance(t) == 0)
                .collect();
            let new_kinds = r
                .items
                .iter()
                .map(|i| item_token(&i.item))
                .chain(badges.iter().cloned())
                .filter(|t| player.balance(t) == 0)
                .collect::<std::collections::BTreeSet<_>>()
                .len();
            if player.kinds() + new_kinds > MAX_KINDS {
                statuses.push(RewardStatus::Full);
                continue;
            }

            let mut token_ids = Vec::new();
            let mut amounts = Vec::new();
            for i in &r.items {
                let token = item_token(&i.item);
                player.credit(&token, i.amount as u128, false);
                self.add_supply(&token, i.amount as u128);
                token_ids.push(token);
                amounts.push(U128(i.amount as u128));
            }
            for token in badges {
                player.credit(&token, 1, false);
                self.add_supply(&token, 1);
                token_ids.push(token);
                amounts.push(U128(1));
            }
            player.reward_nonce = r.nonce;
            if let Some(level) = r.level {
                player.level = player.level.max(level);
            }
            let level = player.level;
            self.players.insert(r.account_id.clone(), player);

            if !token_ids.is_empty() {
                mints.push(MtMintEvent {
                    owner_id: r.account_id.clone(),
                    token_ids,
                    amounts,
                    memo: Some(format!("reward:{}", r.nonce)),
                });
            }
            rewards.push(RewardData {
                account_id: r.account_id,
                nonce: r.nonce,
                level,
                digest: r.digest,
            });
            statuses.push(RewardStatus::Applied);
        }
        // One event of each kind per batch keeps the logs under NEAR's 16 KB limit.
        if !mints.is_empty() {
            MtEvent::MtMint(mints).emit();
        }
        if !rewards.is_empty() {
            WgpEvent::Reward(rewards).emit();
        }
        statuses
    }

    /// Record a season's final board once, forever, and mint its trophies.
    pub fn record_season(
        &mut self,
        season_id: String,
        root: String,
        top10: Vec<AccountId>,
        digest: String,
    ) {
        self.assert_live();
        self.assert_operator();
        require!(
            is_slug(&season_id, 16),
            "Season ids are 1-16 of a-z, 0-9 and -"
        );
        require!(is_hex32(&root), "root must be 32 bytes of lowercase hex");
        require!(
            is_hex32(&digest),
            "digest must be 32 bytes of lowercase hex"
        );
        require!(
            !top10.is_empty() && top10.len() <= MAX_TOP,
            "top10 holds 1 to 10 accounts"
        );
        let mut seen = std::collections::BTreeSet::new();
        require!(
            top10.iter().all(|a| seen.insert(a)),
            "An account appears twice in top10"
        );
        require!(
            !self.seasons.contains_key(&season_id),
            format!("Season {season_id} is already recorded")
        );

        let mut mints = Vec::with_capacity(top10.len());
        for (i, account) in top10.iter().enumerate() {
            let token = trophy_token(&season_id, i + 1);
            let mut player = self.players.get(account).cloned().unwrap_or_default();
            player.credit(&token, 1, false);
            self.players.insert(account.clone(), player);
            self.add_supply(&token, 1);
            mints.push(MtMintEvent {
                owner_id: account.clone(),
                token_ids: vec![token],
                amounts: vec![U128(1)],
                memo: Some(format!("season:{season_id}")),
            });
        }
        self.seasons.insert(
            season_id.clone(),
            Season {
                root: root.clone(),
                top10: top10.clone(),
                digest: digest.clone(),
                recorded_at_ms: env::block_timestamp_ms(),
            },
        );
        MtEvent::MtMint(mints).emit();
        WgpEvent::Season(vec![SeasonData {
            season_id,
            root,
            digest,
            top10,
        }])
        .emit();
    }

    // ---------- Owner ----------

    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    #[payable]
    pub fn add_operator(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.operators.insert(account_id);
    }

    #[payable]
    pub fn remove_operator(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.operators.remove(&account_id);
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = owner_id;
    }

    /// Replace the item list and suit rules (game balance changes). Existing balances
    /// are untouched.
    #[payable]
    pub fn set_rules(
        &mut self,
        items: Vec<String>,
        suits: Vec<SuitRule>,
        starter_unlock_level: u32,
    ) {
        self.assert_owner();
        validate_rules(&items, &suits, starter_unlock_level);
        self.items = items;
        self.suits = suits;
        self.starter_unlock_level = starter_unlock_level;
    }

    /// Deploy new code (the raw wasm is the call's input) and run `migrate`.
    #[payable]
    pub fn upgrade(&mut self) -> Promise {
        self.assert_owner();
        let code =
            env::input().unwrap_or_else(|| env::panic_str("Pass the wasm as the call input"));
        Promise::new(env::current_account_id())
            .deploy_contract(code)
            .function_call(
                "migrate".to_string(),
                vec![],
                NearToken::from_yoctonear(0),
                GAS_FOR_MIGRATE,
            )
    }

    /// Runs after `upgrade`: brings a v1 state (before the market) to v2 with an empty
    /// market, and leaves a v2 state as it is, so running it twice is harmless.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let bytes =
            env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("No state to migrate"));
        migrate::upgrade_state(&bytes)
    }

    // ---------- Views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            operators: self.operators.iter().cloned().collect(),
            paused: self.paused,
            items: self.items.clone(),
            suits: self.suits.clone(),
            starter_unlock_level: self.starter_unlock_level,
            max_kinds: MAX_KINDS as u32,
        }
    }

    pub fn get_player(&self, account_id: AccountId) -> Option<PlayerView> {
        let player = self.players.get(&account_id)?;
        let mut tokens = Vec::with_capacity(player.kinds());
        if player.hero.is_some() {
            tokens.push((hero_token(&account_id), U128(1)));
        }
        tokens.extend(player.balances.iter().map(|(id, n)| (id.clone(), U128(*n))));
        Some(PlayerView {
            hero: player.hero.clone(),
            level: player.level,
            reward_nonce: player.reward_nonce,
            tokens,
        })
    }

    pub fn reward_nonce(&self, account_id: AccountId) -> u64 {
        self.players
            .get(&account_id)
            .map(|p| p.reward_nonce)
            .unwrap_or(0)
    }

    pub fn get_season(&self, season_id: String) -> Option<Season> {
        self.seasons.get(&season_id).cloned()
    }

    pub fn is_operator(&self, account_id: AccountId) -> bool {
        self.operators.contains(&account_id)
    }

    // ---------- Internal ----------

    fn assert_live(&self) {
        require!(!self.paused, "The game is paused");
    }

    fn assert_owner(&self) {
        near_sdk::assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can do this"
        );
    }

    fn assert_operator(&self) {
        require!(
            self.operators.contains(&env::predecessor_account_id()),
            "Only an operator can do this"
        );
    }

    fn suit(&self, id: &str) -> &SuitRule {
        self.suits
            .iter()
            .find(|s| s.id == id)
            .unwrap_or_else(|| env::panic_str(&format!("Unknown suit: {id}")))
    }

    fn validate_reward(&self, r: &RewardMint) {
        require!(r.nonce >= 1, "Reward nonces start at 1");
        require!(
            r.items.len() <= MAX_ITEMS_PER_REWARD,
            "Too many items in one reward"
        );
        require!(
            r.badges.len() <= MAX_BADGES_PER_REWARD,
            "Too many badges in one reward"
        );
        require!(
            is_hex32(&r.digest),
            "digest must be 32 bytes of lowercase hex"
        );
        if let Some(level) = r.level {
            require!((1..=MAX_LEVEL).contains(&level), "Level out of range");
        }
        for i in &r.items {
            require!(
                i.item == BITS || self.items.contains(&i.item),
                format!("Unknown item: {}", i.item)
            );
            require!(
                i.amount >= 1 && i.amount <= MAX_ITEM_AMOUNT,
                "Item amounts are 1 to 1000"
            );
        }
        for b in &r.badges {
            require!(
                is_slug(b, MAX_ID_LEN),
                "Badge ids are 1-32 of a-z, 0-9 and -"
            );
        }
    }

    pub(crate) fn add_supply(&mut self, token_id: &str, amount: u128) {
        let n = self.supply.get(token_id).copied().unwrap_or(0);
        self.supply.insert(
            token_id.to_string(),
            n.checked_add(amount)
                .unwrap_or_else(|| env::panic_str("Supply overflow")),
        );
    }

    pub(crate) fn sub_supply(&mut self, token_id: &str, amount: u128) {
        let n = self
            .supply
            .get(token_id)
            .copied()
            .unwrap_or(0)
            .saturating_sub(amount);
        if n == 0 {
            self.supply.remove(token_id);
        } else {
            self.supply.insert(token_id.to_string(), n);
        }
    }
}

pub(crate) const ERR_NO_HERO: &str = "Register a hero first";
pub(crate) const ERR_TOO_MANY_KINDS: &str = "This account holds the maximum number of token kinds";

pub fn hero_token(account: &AccountId) -> TokenId {
    format!("hero:{account}")
}
pub fn suit_token(id: &str) -> TokenId {
    format!("suit:{id}")
}
pub fn item_token(id: &str) -> TokenId {
    format!("item:{id}")
}
pub fn trophy_token(season_id: &str, rank: usize) -> TokenId {
    format!("trophy:{season_id}:{rank}")
}
pub fn badge_token(id: &str) -> TokenId {
    format!("trophy:badge:{id}")
}

/// Trim, then 1 to 24 characters with no control characters.
fn clean_name(name: &str) -> String {
    let name = name.trim();
    let chars = name.chars().count();
    require!(
        (1..=MAX_NAME_CHARS).contains(&chars),
        "Hero names are 1 to 24 characters"
    );
    require!(
        !name.chars().any(char::is_control),
        "Hero names can't contain control characters"
    );
    name.to_string()
}

fn is_slug(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_hex32(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn validate_rules(items: &[String], suits: &[SuitRule], starter_unlock_level: u32) {
    require!(
        !items.is_empty() && items.len() <= 32,
        "Between 1 and 32 items"
    );
    require!(
        !suits.is_empty() && suits.len() <= 32,
        "Between 1 and 32 suits"
    );
    require!(
        (1..=MAX_LEVEL).contains(&starter_unlock_level),
        "starter_unlock_level out of range"
    );
    let mut seen = std::collections::BTreeSet::new();
    for item in items {
        require!(is_slug(item, MAX_ID_LEN), format!("Bad item id: {item}"));
        require!(item != BITS, "bits is the market's currency, not an item");
        require!(
            seen.insert(item.as_str()),
            format!("Duplicate item: {item}")
        );
    }
    let mut seen = std::collections::BTreeSet::new();
    for suit in suits {
        require!(
            is_slug(&suit.id, MAX_ID_LEN),
            format!("Bad suit id: {}", suit.id)
        );
        require!(
            seen.insert(suit.id.as_str()),
            format!("Duplicate suit: {}", suit.id)
        );
        require!(
            (1..=MAX_LEVEL).contains(&suit.min_level),
            "min_level out of range"
        );
        require!(suit.recipe.len() <= 8, "A recipe has at most 8 ingredients");
        require!(
            !suit.starter || suit.recipe.is_empty(),
            "Starter suits have no recipe"
        );
        for i in &suit.recipe {
            require!(
                items.contains(&i.item),
                format!("Suit {} needs unknown item {}", suit.id, i.item)
            );
            require!(
                i.amount >= 1 && i.amount <= MAX_ITEM_AMOUNT,
                "Recipe amounts are 1 to 1000"
            );
        }
    }
    require!(suits.iter().any(|s| s.starter), "At least one starter suit");
}
