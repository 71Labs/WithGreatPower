//! Our NEP-245 multi-token core. Method names, arguments and return types mirror
//! `defuse_nep245::{MultiTokenCore, MultiTokenResolver, MultiTokenEnumeration}`, so the
//! contract is readable by NEAR Intents and anything else that speaks NEP-245.
//!
//! Game rules on top of the standard:
//! - Every transfer needs exactly 1 yoctoNEAR (a full-access key), so a session key
//!   cannot move assets.
//! - `hero:*` and `trophy:*` are soulbound.
//! - The suit a hero is wearing can't leave the account; equip another one first.
//! - Approvals are not supported (`approval` must be null).
//! - The contract's own balance includes the market's holdings (the vendor's stock and
//!   till, escrowed listings), so balances agree with the transfer events.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken};

use crate::{MtEvent, MtTransferEvent, TokenId, Wgp, WgpExt};

/// Tokens in one batch call.
pub const MAX_BATCH: usize = 32;
/// Largest `mt_on_transfer` answer read back in `mt_resolve_transfer`.
const MAX_RESOLVE_RESULT: usize = 64 * 1024;
const GAS_FOR_MT_ON_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FOR_RESOLVE_BASE: Gas = Gas::from_tgas(5);
const GAS_FOR_RESOLVE_PER_TOKEN: Gas = Gas::from_tgas(1);

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub token_id: TokenId,
    /// Set for one-of-a-kind tokens (heroes, season trophies); null for fungible ones.
    pub owner_id: Option<AccountId>,
}

pub(crate) enum Kind<'a> {
    Hero(&'a str),
    /// `trophy:<season>:<rank>` (one owner) or `trophy:badge:<id>` (`season` is "badge").
    Trophy {
        season: &'a str,
        rank: Option<usize>,
    },
    Suit,
    Item,
}

pub(crate) fn kind(token_id: &str) -> Option<Kind<'_>> {
    let (prefix, rest) = token_id.split_once(':')?;
    match prefix {
        "hero" => Some(Kind::Hero(rest)),
        "suit" => Some(Kind::Suit),
        "item" => Some(Kind::Item),
        "trophy" => {
            let (season, tail) = rest.split_once(':')?;
            let rank = if season == "badge" {
                None
            } else {
                Some(tail.parse().ok()?)
            };
            Some(Kind::Trophy { season, rank })
        }
        _ => None,
    }
}

#[near]
impl Wgp {
    // ---------- MultiTokenCore: calls ----------

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), ERR_APPROVALS);
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, &[token_id], &[amount], memo);
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        assert_no_approvals(&approvals);
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, &token_ids, &amounts, memo);
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), ERR_APPROVALS);
        self.internal_transfer_call(receiver_id, vec![token_id], vec![amount], memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) {
        near_sdk::assert_one_yocto();
        assert_no_approvals(&approvals);
        self.internal_transfer_call(receiver_id, token_ids, amounts, memo, msg)
    }

    // ---------- MultiTokenResolver ----------

    /// Moves back whatever the receiver did not use, and returns the amounts it kept.
    /// A failed or malformed `mt_on_transfer` refunds everything the receiver still has.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
    ) -> Vec<U128> {
        assert_no_approvals(&approvals);
        require!(
            !token_ids.is_empty()
                && previous_owner_ids.len() == token_ids.len()
                && amounts.len() == token_ids.len(),
            "Invalid resolve arguments"
        );
        let mut refunds = env::promise_result_checked(0, MAX_RESOLVE_RESULT)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<U128>>(&bytes).ok())
            .filter(|r| r.len() == amounts.len())
            .unwrap_or_else(|| amounts.clone());

        let mut used = amounts.clone();
        let mut events = Vec::new();
        for i in 0..token_ids.len() {
            let token_id = &token_ids[i];
            let Some(mut receiver) = self.players.get(&receiver_id).cloned() else {
                break;
            };
            let mut available = receiver.balance(token_id);
            // The receiver may have equipped a suit it received; that one stays.
            if receiver
                .hero
                .as_ref()
                .is_some_and(|h| crate::suit_token(&h.suit) == *token_id)
            {
                available = available.saturating_sub(1);
            }
            let refund = refunds[i].0.min(amounts[i].0).min(available);
            refunds[i] = U128(refund);
            if refund == 0 {
                continue;
            }
            receiver.debit(token_id, refund);
            self.players.insert(receiver_id.clone(), receiver);
            let previous = &previous_owner_ids[i];
            let mut owner = self.players.get(previous).cloned().unwrap_or_default();
            owner.credit(token_id, refund, false);
            self.players.insert(previous.clone(), owner);
            used[i] = U128(amounts[i].0 - refund);
            events.push(MtTransferEvent {
                authorized_id: None,
                old_owner_id: receiver_id.clone(),
                new_owner_id: previous.clone(),
                token_ids: vec![token_id.clone()],
                amounts: vec![U128(refund)],
                memo: Some("refund".to_string()),
            });
        }
        if !events.is_empty() {
            MtEvent::MtTransfer(events).emit();
        }
        used
    }

    // ---------- MultiTokenCore: views ----------

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.balance_of(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids
            .iter()
            .map(|t| U128(self.balance_of(&account_id, t)))
            .collect()
    }

    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        self.supply_of(&token_id).map(U128)
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids
            .iter()
            .map(|t| self.supply_of(t).map(U128))
            .collect()
    }

    pub fn mt_token(&self, token_ids: Vec<TokenId>) -> Vec<Option<Token>> {
        token_ids
            .into_iter()
            .map(|token_id| {
                self.supply_of(&token_id)?;
                let owner_id = self.single_owner(&token_id);
                Some(Token { token_id, owner_id })
            })
            .collect()
    }

    // ---------- MultiTokenEnumeration ----------

    pub fn mt_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u32>,
    ) -> Vec<Token> {
        let Some(view) = self.get_player(account_id.clone()) else {
            return vec![];
        };
        let from = from_index.map(|i| i.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(100).min(100) as usize;
        view.tokens
            .into_iter()
            .skip(from)
            .take(limit)
            .map(|(token_id, _)| {
                let owner_id = self.single_owner(&token_id).filter(|o| *o == account_id);
                Token { token_id, owner_id }
            })
            .collect()
    }

    // ---------- Internal ----------

    pub(crate) fn balance_of(&self, account: &AccountId, token_id: &str) -> u128 {
        if let Some(Kind::Hero(owner)) = kind(token_id) {
            let has_hero = owner == account.as_str()
                && self.players.get(account).is_some_and(|p| p.hero.is_some());
            return u128::from(has_hero);
        }
        let own = self
            .players
            .get(account)
            .map(|p| p.balance(token_id))
            .unwrap_or(0);
        // The vendor's stock and till and escrowed listings are held by this contract.
        if *account == env::current_account_id() {
            return own + self.market_holdings(token_id);
        }
        own
    }

    fn supply_of(&self, token_id: &str) -> Option<u128> {
        match kind(token_id)? {
            Kind::Hero(owner) => {
                let owner: AccountId = owner.parse().ok()?;
                self.players.get(&owner)?.hero.as_ref().map(|_| 1)
            }
            _ => self.supply.get(token_id).copied(),
        }
    }

    /// The one owner of a hero or season trophy; None for fungible tokens.
    fn single_owner(&self, token_id: &str) -> Option<AccountId> {
        match kind(token_id)? {
            Kind::Hero(owner) => owner.parse().ok(),
            Kind::Trophy {
                season,
                rank: Some(rank),
            } => self
                .seasons
                .get(season)?
                .top10
                .get(rank.checked_sub(1)?)
                .cloned(),
            _ => None,
        }
    }

    pub(crate) fn internal_transfer(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        token_ids: &[TokenId],
        amounts: &[U128],
        memo: Option<String>,
    ) {
        require!(!self.paused, "The game is paused");
        require!(
            !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
            "Transfer 1 to 32 tokens at a time"
        );
        require!(
            token_ids.len() == amounts.len(),
            "token_ids and amounts differ in length"
        );
        require!(
            sender != receiver,
            "Sender and receiver are the same account"
        );
        require!(
            memo.as_ref().is_none_or(|m| m.len() <= 256),
            "Memo is too long"
        );

        let mut from = self
            .players
            .get(sender)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_NO_TOKENS));
        let mut to = self.players.get(receiver).cloned().unwrap_or_default();
        for (token_id, amount) in token_ids.iter().zip(amounts) {
            require!(amount.0 > 0, "Amounts must be positive");
            match kind(token_id) {
                Some(Kind::Hero(_)) | Some(Kind::Trophy { .. }) => {
                    env::panic_str("Heroes and trophies are soulbound")
                }
                Some(Kind::Suit) | Some(Kind::Item) => {}
                None => env::panic_str(&format!("Unknown token: {token_id}")),
            }
            from.debit(token_id, amount.0);
            if let Some(hero) = &from.hero {
                if crate::suit_token(&hero.suit) == *token_id && from.balance(token_id) == 0 {
                    env::panic_str("Equip another suit before transferring this one");
                }
            }
            to.credit(token_id, amount.0, true);
        }
        self.players.insert(sender.clone(), from);
        self.players.insert(receiver.clone(), to);

        MtEvent::MtTransfer(vec![MtTransferEvent {
            authorized_id: None,
            old_owner_id: sender.clone(),
            new_owner_id: receiver.clone(),
            token_ids: token_ids.to_vec(),
            amounts: amounts.to_vec(),
            memo,
        }])
        .emit();
    }

    fn internal_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        memo: Option<String>,
        msg: String,
    ) {
        let sender = env::predecessor_account_id();
        let resolve_gas = GAS_FOR_RESOLVE_BASE
            .saturating_add(GAS_FOR_RESOLVE_PER_TOKEN.saturating_mul(token_ids.len() as u64));
        let needed = resolve_gas
            .saturating_add(GAS_FOR_MT_ON_TRANSFER)
            .saturating_add(Gas::from_tgas(5));
        require!(
            env::prepaid_gas().saturating_sub(env::used_gas()) >= needed,
            "Attach more gas for mt_transfer_call"
        );

        self.internal_transfer(&sender, &receiver_id, &token_ids, &amounts, memo);
        let previous_owner_ids = vec![sender.clone(); token_ids.len()];

        // `receiver.mt_on_transfer(...)`, then `self.mt_resolve_transfer(...)`, whose result
        // is this call's result (NEP-245's `PromiseOrValue<Vec<U128>>`). Built from `env`'s
        // low-level promise calls, not `Promise`/`ext_contract`: see `Wgp::upgrade`.
        let on_transfer_args = serde_json::to_vec(&serde_json::json!({
            "sender_id": sender,
            "previous_owner_ids": previous_owner_ids,
            "token_ids": token_ids,
            "amounts": amounts,
            "msg": msg,
        }))
        .unwrap_or_else(|_| env::panic_str("Couldn't encode mt_on_transfer"));
        let resolve_args = serde_json::to_vec(&serde_json::json!({
            "previous_owner_ids": previous_owner_ids,
            "receiver_id": receiver_id,
            "token_ids": token_ids,
            "amounts": amounts,
            "approvals": null,
        }))
        .unwrap_or_else(|_| env::panic_str("Couldn't encode mt_resolve_transfer"));

        let on_transfer = env::promise_batch_create(&receiver_id);
        env::promise_batch_action_function_call_weight(
            on_transfer,
            "mt_on_transfer",
            &on_transfer_args,
            NearToken::from_yoctonear(0),
            GAS_FOR_MT_ON_TRANSFER,
            GasWeight(1),
        );
        let resolve = env::promise_batch_then(on_transfer, &env::current_account_id());
        env::promise_batch_action_function_call_weight(
            resolve,
            "mt_resolve_transfer",
            &resolve_args,
            NearToken::from_yoctonear(0),
            resolve_gas,
            GasWeight(0),
        );
        env::promise_return(resolve);
    }
}

const ERR_APPROVALS: &str = "Approvals are not supported";
const ERR_NO_TOKENS: &str = "The sender holds no tokens";

fn assert_no_approvals(approvals: &Option<Vec<Option<(AccountId, u64)>>>) {
    require!(
        approvals
            .as_ref()
            .is_none_or(|a| a.iter().all(Option::is_none)),
        ERR_APPROVALS
    );
}
