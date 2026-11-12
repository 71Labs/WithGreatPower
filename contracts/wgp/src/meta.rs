//! NEP-245 metadata (v3): `mt_metadata_contract`, the per-token and base metadata views,
//! and `mt_tokens_base_metadata_all`, as the standard's Metadata extension names them.
//!
//! Nothing is stored per token. A token's metadata is derived from its id:
//!
//! | token                       | base id  | default title           | default media               |
//! |-----------------------------|----------|-------------------------|-----------------------------|
//! | `hero:<account>`            | `hero`   | the hero's name         | `hero.png`                  |
//! | `suit:<id>`                 | `suit`   | "<Id> suit"             | `suit/<id>.png`             |
//! | `item:bits`                 | `bits`   | "Bits"                  | `bits.png`                  |
//! | `item:<id>`                 | `item`   | "<Id>"                  | `item/<id>.png`             |
//! | `trophy:badge:<id>`         | `badge`  | "<Id> badge"            | `badge/<id>.png`            |
//! | `trophy:<season>:<rank>`    | `trophy` | "Season <s>: rank <n>"  | `trophy/<1|2|3|top10>.png`  |
//!
//! Media paths hang off `base_uri` (https://www.wgponnear.fun/tokens by default). The owner
//! can override the title, description and media of any token id, or of a whole kind
//! (`hero`, `suit`, `item`, `bits`, `badge`, `trophy`), in a small table
//! (`set_token_metadata`); that table is the only metadata in storage.

use near_sdk::store::LookupMap;
use near_sdk::{near, require, AccountId};

use crate::mt::{kind, Kind};
use crate::{StorageKey, TokenId, Wgp, WgpExt};

pub const MT_SPEC: &str = "mt-1.0.0";
pub const DEFAULT_NAME: &str = "With Great Power";
pub const DEFAULT_BASE_URI: &str = "https://www.wgponnear.fun/tokens";
/// The base metadata ids, in the order `mt_tokens_base_metadata_all` lists them.
pub const BASE_IDS: [&str; 6] = ["hero", "suit", "item", "bits", "badge", "trophy"];
pub const MAX_META_ENTRIES: usize = 50;
const MAX_TITLE: usize = 64;
const MAX_TEXT: usize = 256;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MTContractMetadata {
    pub spec: String,
    pub name: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MTBaseTokenMetadata {
    pub name: String,
    pub id: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub decimals: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub copies: Option<u64>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct MTTokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MTTokenMetadataAll {
    pub base: MTBaseTokenMetadata,
    pub token: MTTokenMetadata,
}

/// One row of the owner's table: what to show instead of the derived defaults.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct TokenMeta {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// An absolute URL, or a path under `base_uri`.
    #[serde(default)]
    pub media: Option<String>,
    /// Base64 of the media file's sha256.
    #[serde(default)]
    pub media_hash: Option<String>,
}

#[near(serializers = [borsh])]
pub struct Meta {
    pub name: String,
    pub base_uri: String,
    /// Keyed by a token id or a base id.
    pub table: LookupMap<String, TokenMeta>,
}

impl Meta {
    pub fn new() -> Self {
        Self {
            name: DEFAULT_NAME.to_string(),
            base_uri: DEFAULT_BASE_URI.to_string(),
            table: LookupMap::new(StorageKey::TokenMeta),
        }
    }
}

impl Default for Meta {
    fn default() -> Self {
        Self::new()
    }
}

/// "fee-bomb" → "Fee bomb".
fn pretty(id: &str) -> String {
    let words = id.replace('-', " ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => words,
    }
}

/// A token's base metadata id.
pub(crate) fn base_id(token_id: &str) -> Option<&'static str> {
    Some(match kind(token_id)? {
        Kind::Hero(_) => "hero",
        Kind::Suit => "suit",
        Kind::Item if token_id == crate::BITS_TOKEN => "bits",
        Kind::Item => "item",
        Kind::Trophy { rank: None, .. } => "badge",
        Kind::Trophy { .. } => "trophy",
    })
}

#[near]
impl Wgp {
    // ---------- NEP-245 Metadata ----------

    pub fn mt_metadata_contract(&self) -> MTContractMetadata {
        MTContractMetadata {
            spec: MT_SPEC.to_string(),
            name: self.meta.name.clone(),
        }
    }

    /// Null for an id that names no token this game has or could mint.
    pub fn mt_metadata_token_all(
        &self,
        token_ids: Vec<TokenId>,
    ) -> Vec<Option<MTTokenMetadataAll>> {
        token_ids
            .iter()
            .map(|id| {
                let token = self.token_metadata(id)?;
                let base = self.base_metadata(base_id(id)?)?;
                Some(MTTokenMetadataAll { base, token })
            })
            .collect()
    }

    pub fn mt_metadata_token_by_token_id(
        &self,
        token_ids: Vec<TokenId>,
    ) -> Vec<Option<MTTokenMetadata>> {
        token_ids.iter().map(|id| self.token_metadata(id)).collect()
    }

    pub fn mt_metadata_base_by_token_id(
        &self,
        token_ids: Vec<TokenId>,
    ) -> Vec<Option<MTBaseTokenMetadata>> {
        token_ids
            .iter()
            .map(|id| {
                self.token_metadata(id)?;
                self.base_metadata(base_id(id)?)
            })
            .collect()
    }

    /// The standard's name for the lookup by base id.
    pub fn mt_metadata_base_by_metadata_id(
        &self,
        base_metadata_ids: Vec<String>,
    ) -> Vec<Option<MTBaseTokenMetadata>> {
        base_metadata_ids
            .iter()
            .map(|id| self.base_metadata(id))
            .collect()
    }

    /// The same lookup under the name some NEP-245 implementations use.
    pub fn mt_metadata_base_by_metadata_base_id(
        &self,
        base_metadata_ids: Vec<String>,
    ) -> Vec<Option<MTBaseTokenMetadata>> {
        self.mt_metadata_base_by_metadata_id(base_metadata_ids)
    }

    /// Every base metadata (NEP-245 Enumeration): one per kind of token.
    pub fn mt_tokens_base_metadata_all(
        &self,
        from_index: Option<near_sdk::json_types::U128>,
        limit: Option<u32>,
    ) -> Vec<MTBaseTokenMetadata> {
        BASE_IDS
            .iter()
            .skip(from_index.map(|i| i.0).unwrap_or(0).min(u32::MAX as u128) as usize)
            .take(limit.unwrap_or(u32::MAX) as usize)
            .filter_map(|id| self.base_metadata(id))
            .collect()
    }

    // ---------- Owner ----------

    /// Set the collection name, the media base URI, and rows of the metadata table. A row
    /// is `[key, meta]`: the key is a token id or a base id; a null `meta` removes the row.
    #[payable]
    pub fn set_token_metadata(
        &mut self,
        name: Option<String>,
        base_uri: Option<String>,
        entries: Vec<(String, Option<TokenMeta>)>,
    ) {
        self.assert_owner();
        if let Some(name) = name {
            require!(
                !name.is_empty() && name.len() <= MAX_TITLE,
                "name is 1 to 64 bytes"
            );
            self.meta.name = name;
        }
        if let Some(base_uri) = base_uri {
            require!(
                base_uri.starts_with("https://")
                    && base_uri.len() <= MAX_TEXT
                    && !base_uri.ends_with('/'),
                "base_uri is an https URL of at most 256 bytes with no trailing slash"
            );
            self.meta.base_uri = base_uri;
        }
        require!(
            entries.len() <= MAX_META_ENTRIES,
            "At most 50 metadata rows per call"
        );
        for (key, meta) in entries {
            require!(
                BASE_IDS.contains(&key.as_str()) || (key.len() <= 96 && kind(&key).is_some()),
                format!("Not a token id or a base id: {key}")
            );
            let Some(meta) = meta else {
                self.meta.table.remove(&key);
                continue;
            };
            for (field, max) in [
                (&meta.title, MAX_TITLE),
                (&meta.description, MAX_TEXT),
                (&meta.media, MAX_TEXT),
                (&meta.media_hash, MAX_TITLE),
            ] {
                require!(
                    field
                        .as_ref()
                        .is_none_or(|v| !v.is_empty() && v.len() <= max),
                    format!(
                        "{key}: a title or hash is 1 to 64 bytes, a description or media 1 to 256"
                    )
                );
            }
            self.meta.table.insert(key, meta);
        }
        self.admin("set_token_metadata", None);
    }

    /// The owner's row for a token id or base id, if there is one.
    pub fn get_token_metadata_row(&self, key: String) -> Option<TokenMeta> {
        self.meta.table.get(&key).cloned()
    }
}

impl Wgp {
    fn base_metadata(&self, id: &str) -> Option<MTBaseTokenMetadata> {
        let (name, symbol) = match id {
            "hero" => ("With Great Power hero", "WGPHERO"),
            "suit" => ("With Great Power suit", "WGPSUIT"),
            "item" => ("With Great Power loot", "WGPLOOT"),
            "bits" => ("Bits", "BITS"),
            "badge" => ("With Great Power badge", "WGPBADGE"),
            "trophy" => ("With Great Power season trophy", "WGPTROPHY"),
            _ => return None,
        };
        Some(MTBaseTokenMetadata {
            name: name.to_string(),
            id: id.to_string(),
            symbol: Some(symbol.to_string()),
            icon: None,
            decimals: Some("0".to_string()),
            base_uri: Some(self.meta.base_uri.clone()),
            reference: None,
            copies: None,
            reference_hash: None,
        })
    }

    /// A token's metadata: the derived defaults, then the owner's row for its kind, then
    /// the owner's row for the token itself. None for an id this game has never minted and
    /// its rules don't know.
    pub(crate) fn token_metadata(&self, token_id: &str) -> Option<MTTokenMetadata> {
        let base = base_id(token_id)?;
        let mut m = MTTokenMetadata::default();
        let (title, description, path) = match kind(token_id)? {
            Kind::Hero(owner) => {
                let account: AccountId = owner.parse().ok()?;
                let player = self.players.get(&account)?;
                let hero = player.hero.as_ref()?;
                m.issued_at = Some(hero.registered_at_ms.to_string());
                m.extra = Some(format!(
                    r#"{{"kind":"hero","soulbound":true,"level":{},"suit":"{}"}}"#,
                    player.level, hero.suit
                ));
                (
                    hero.name.clone(),
                    format!(
                        "{owner}'s hero in With Great Power: level {}, wearing the {} suit. Soulbound.",
                        player.level,
                        pretty(&hero.suit)
                    ),
                    "hero.png".to_string(),
                )
            }
            Kind::Suit => {
                let id = &token_id[5..];
                if !self.suits.iter().any(|s| s.id == id) {
                    self.supply.get(token_id)?;
                }
                (
                    format!("{} suit", pretty(id)),
                    "A suit a With Great Power hero can wear. Starter suits come with the hero; the rest are crafted from loot.".to_string(),
                    format!("suit/{id}.png"),
                )
            }
            Kind::Item if base == "bits" => (
                "Bits".to_string(),
                "The Mempool Market's currency, minted for each verified night in With Great Power.".to_string(),
                "bits.png".to_string(),
            ),
            Kind::Item => {
                let id = &token_id[5..];
                if !self.items.iter().any(|i| i == id) {
                    self.supply.get(token_id)?;
                }
                (
                    pretty(id),
                    "Loot from a verified night in With Great Power. Craft suits with it or trade it at the Mempool Market.".to_string(),
                    format!("item/{id}.png"),
                )
            }
            Kind::Trophy { rank: None, .. } => {
                self.supply.get(token_id)?;
                let id = &token_id["trophy:badge:".len()..];
                m.extra = Some(r#"{"kind":"badge","soulbound":true}"#.to_string());
                (
                    format!("{} badge", pretty(id)),
                    "A soulbound badge earned in With Great Power.".to_string(),
                    format!("badge/{id}.png"),
                )
            }
            Kind::Trophy {
                season,
                rank: Some(rank),
            } => {
                let recorded = self.seasons.get(season)?;
                if rank == 0 || rank > recorded.top10.len() {
                    return None;
                }
                m.issued_at = Some(recorded.recorded_at_ms.to_string());
                m.extra = Some(format!(
                    r#"{{"kind":"trophy","soulbound":true,"season":"{season}","rank":{rank}}}"#
                ));
                let file = if rank <= 3 {
                    rank.to_string()
                } else {
                    "top10".to_string()
                };
                (
                    format!("Season {season}: rank {rank}"),
                    format!("The soulbound trophy for finishing rank {rank} on With Great Power's season {season} board."),
                    format!("trophy/{file}.png"),
                )
            }
        };
        m.title = Some(title);
        m.description = Some(description);
        m.media = Some(path);
        for key in [base, token_id] {
            if let Some(row) = self.meta.table.get(key) {
                if row.title.is_some() {
                    m.title = row.title.clone();
                }
                if row.description.is_some() {
                    m.description = row.description.clone();
                }
                if row.media.is_some() {
                    m.media = row.media.clone();
                    m.media_hash = row.media_hash.clone();
                }
            }
        }
        m.media = m.media.map(|media| {
            if media.starts_with("https://") {
                media
            } else {
                format!("{}/{media}", self.meta.base_uri)
            }
        });
        Some(m)
    }
}
