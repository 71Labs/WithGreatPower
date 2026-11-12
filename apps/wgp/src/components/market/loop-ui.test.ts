/**
 * The market loop's UI states, rendered to markup: the trade prompt card, the Suit lab's
 * buy and list lines, the quest strip, Tonight's market tile, the coach, and the trade
 * sheet when it opens prefilled or behind a gate (signed out, quick play off).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ItemId } from "@wgp/game-core/types";

import type { MarketItemView, MarketMe, MarketView } from "@/lib/market/api";
import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import { afterBuy, buyCost, buyQuote, sellQuote, spotMilli, type Pool } from "@/lib/market/math";
import { marketPulse, nextTrade, suitGaps, type Holdings } from "@/lib/market/prompts";
import { MARKET_QUEST_XP, type MarketQuestView } from "@/lib/market/quest";

import { CoachCard, coachSteps } from "./coach";
import { MarketTileView, pulseLine } from "./market-tile";
import { QuestStrip, resetsIn } from "./quest-strip";
import { TradeSheet } from "./sheets";
import { PartOffers, SpareOffers, TradePromptCard } from "./trade-prompt";

const NAMES: Partial<Record<string, string>> = { "chain-link": "Chain link", "spare-arm": "Doc’s spare arm", crumbs: "Crumbs", "goblin-glider": "Goblin glider", "fee-bomb": "Fee bomb" };

function view(change: (pool: Pool) => Pool = (p) => p): MarketView {
  const params = DEFAULT_PARAMS;
  const items = seededPools().map((seed): MarketItemView => {
    const pool = change(seed);
    return {
      item: pool.item as ItemId,
      name: NAMES[pool.item] ?? pool.item,
      rarity: "common",
      priceMilli: spotMilli(pool),
      buyOne: buyQuote(pool, 1, params.feeBps)?.total ?? null,
      sellOne: sellQuote(pool, 1, params.feeBps)?.net ?? null,
      spark: [spotMilli(pool), spotMilli(pool)],
      change24h: null,
      trades24h: 0,
      pool,
    };
  });
  return { onChain: false, network: null, contractId: null, vendor: null, params, items, listings: 0, till: 0, updatedAt: "2026-11-12T12:00:00.000Z" };
}

const STARTERS = ["classic", "midnight", "mint", "snow"] as const;
const hero = (inventory: Holdings["inventory"], suits: Holdings["suits"] = [...STARTERS, "stealth", "glider"]): Holdings => ({ inventory, suits, level: 5 });
const me = (over: Partial<MarketMe> = {}): MarketMe => ({ onChain: false, accountId: "alice.near", bits: 200, items: {}, tradesLeft: 40, listingsLeft: 10, fillsLeft: 10, fillBitsLeft: 3000, open: [], pendingBits: 0, ...over });
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const quest = (done: boolean): MarketQuestView => ({ day: "2026-11-12", done, xp: MARKET_QUEST_XP, resetsAt: "2026-11-13T00:00:00.000Z" });
const NOON = Date.parse("2026-11-12T12:00:00Z");
const noop = () => {};

describe("the trade prompt card", () => {
  it("says what's missing and links into the market with the trade prefilled", () => {
    const m = view();
    const cost = buyQuote(m.items.find((i) => i.item === "chain-link")!.pool, 1, m.params.feeBps)!.total;
    const prompt = nextTrade(hero({ "spare-arm": 1, "chain-link": 2 }), m, 500)!;
    const out = html(createElement(TradePromptCard, { prompt }));
    expect(text(out)).toContain("Your next trade");
    expect(text(out)).toContain("The Octo rig suit is only missing Chain link ×1");
    expect(text(out)).toContain(`Buy it from Gwei · ${cost} Bits`);
    expect(out).toContain('href="/play/market?item=chain-link&amp;side=buy&amp;amount=1"');
    expect(out).not.toContain("<button");
  });

  it("offers to sell spare loot, towards the suit it would pay for", () => {
    const m = view();
    const prompt = nextTrade(hero({ "spare-arm": 1, "chain-link": 2, crumbs: 7 }), m, 3)!;
    const out = html(createElement(TradePromptCard, { prompt }));
    expect(text(out)).toContain("Spare Crumbs ×3: more than the suits you’re missing need");
    expect(text(out)).toMatch(/Sell them to Gwei · \+\d+ Bits/);
    expect(text(out)).toContain("That goes towards the Octo rig suit’s last part");
    expect(out).toContain('href="/play/market?item=crumbs&amp;side=sell&amp;amount=3"');
  });

  it("is a button on the market itself, which opens the sheet in place", () => {
    const prompt = nextTrade(hero({ "spare-arm": 1, "chain-link": 2 }), view(), 500)!;
    const out = html(createElement(TradePromptCard, { prompt, onAct: noop }));
    expect(out).toContain("<button");
    expect(out).not.toContain("href=");
  });

  it("says how many Bits are missing when the part is out of reach", () => {
    const prompt = nextTrade(hero({ "spare-arm": 1, "chain-link": 2 }), view(), 3)!;
    expect(text(html(createElement(TradePromptCard, { prompt })))).toMatch(/You need \d+ Bits more\. A verified night pays Bits\./);
  });
});

describe("the Suit lab's lines", () => {
  it("a buy button per missing part, at Gwei's price for the whole shortfall", () => {
    const m = view();
    const gap = suitGaps(hero({}, STARTERS)).find((g) => g.suit === "glider")!;
    const out = html(createElement(PartOffers, { gap, market: m }));
    const glider = buyQuote(m.items.find((i) => i.item === "goblin-glider")!.pool, 1, m.params.feeBps)!.total;
    const bombs = buyQuote(m.items.find((i) => i.item === "fee-bomb")!.pool, 2, m.params.feeBps)!.total;
    expect(text(out)).toContain(`Goblin glider ×1 short. Gwei has one in stock. Buy from Gwei · ${glider} Bits`);
    expect(text(out)).toContain(`Fee bomb ×2 short. Gwei has them in stock. Buy from Gwei · ${bombs} Bits`);
    expect(out).toContain('href="/play/market?item=goblin-glider&amp;side=buy&amp;amount=1"');
    expect(out).toContain('href="/play/market?item=fee-bomb&amp;side=buy&amp;amount=2"');
  });

  it("a part Gwei can't sell says why, in words, and points at the market", () => {
    const m = view((p) => (p.item === "goblin-glider" ? { ...p, stock: 0 } : p));
    const gap = suitGaps(hero({ "fee-bomb": 2 }, STARTERS)).find((g) => g.suit === "glider")!;
    const out = html(createElement(PartOffers, { gap, market: m }));
    expect(text(out)).toContain("Goblin glider ×1 short. Gwei has none left to sell. Sell her one and she’s back in stock. A player may have listed one.");
    expect(text(out)).toContain("See the market");
    expect(text(out)).not.toContain("Buy from Gwei");
    expect(out).not.toMatch(/\sdisabled=""/);
  });

  it("nothing to buy when only the level is short", () => {
    const gap = { suit: "octo" as const, name: "Octo rig", missing: [], minLevel: 3, levelShort: true };
    expect(html(createElement(PartOffers, { gap, market: view() }))).toBe("");
  });

  it("lists spare loot with a link that opens the listing sheet on it", () => {
    const out = html(createElement(SpareOffers, { holdings: hero({ crumbs: 7, "press-pass": 1 }) }));
    expect(text(out)).toContain("Spare loot: Crumbs ×3, Press pass ×1. More than the suits you’re missing need.");
    expect(text(out)).toContain("List your spares");
    expect(out).toContain('href="/play/market?item=crumbs&amp;side=list"');
    expect(html(createElement(SpareOffers, { holdings: hero({ crumbs: 4 }) }))).toBe("");
  });
});

describe("the quest strip", () => {
  it("open, signed in: what to do and what it's worth", () => {
    const out = text(html(createElement(QuestStrip, { quest: quest(false), signedIn: true, now: NOON })));
    expect(out).toContain("Today’s market quest");
    expect(out).toContain("Make a trade with Gwei, or buy a player’s listing");
    expect(out).toContain("One trade today does it. Once a day.");
    expect(out).toContain(`+${MARKET_QUEST_XP} XP`);
    expect(out).not.toContain("done");
  });

  it("done: a tick, the word, the XP earned and when the next one starts", () => {
    const markup = html(createElement(QuestStrip, { quest: quest(true), signedIn: true, now: NOON }));
    const out = text(markup);
    expect(out).toContain("Today’s market quest · done");
    expect(out).toContain(`You got +${MARKET_QUEST_XP} XP. A new one starts at midnight UTC, in 12 hours.`);
    expect(out).toContain("earned");
    expect(markup).toContain('role="status"');
  });

  it("a guest is told to sign in, never shown as done", () => {
    const out = text(html(createElement(QuestStrip, { quest: null, signedIn: false, now: NOON })));
    expect(out).toContain("Sign in to take it. One trade a day does it.");
    expect(out).not.toContain("done");
  });

  it("counts the hours to midnight UTC", () => {
    expect(resetsIn(quest(true), Date.parse("2026-11-12T23:10:00Z"))).toBe("A new one starts at midnight UTC, in 1 hour.");
    expect(resetsIn(quest(true), Date.parse("2026-11-13T00:00:01Z"))).toBe("A new one starts at midnight UTC.");
  });
});

describe("Tonight's market tile", () => {
  const bought = (pool: Pool) => afterBuy(pool, 1, buyCost(pool, 1)!);

  it("carries one line from a real pool, in Gwei's words, with her stock", () => {
    const m = view((p) => (p.item === "spare-arm" ? bought(p) : p));
    const pulse = marketPulse(m)!;
    expect(pulseLine(pulse).line).toMatch(/^Doc’s spare arm: “Up \d+% since I opened\./);
    expect(pulseLine(pulse).meta).toMatch(/^\d+ Bits · 7 left$/);
    const out = html(createElement(MarketTileView, { pulse, quest: quest(false), signedIn: true }));
    expect(out).toContain('href="/play/market"');
    expect(text(out)).toContain("Mempool Market");
    expect(text(out)).toContain(`Quest +${MARKET_QUEST_XP} XP`);
    expect(text(out)).toContain("7 left");
  });

  it("shows the quest as done, and no quest chip for a guest", () => {
    const pulse = marketPulse(view())!;
    expect(text(html(createElement(MarketTileView, { pulse, quest: quest(true), signedIn: true })))).toContain("Quest done");
    expect(text(html(createElement(MarketTileView, { pulse, quest: null, signedIn: false })))).not.toContain("Quest");
  });

  it("says sold out and closed in words", () => {
    const sold = marketPulse(view((p) => (p.item === "spare-arm" ? { ...p, stock: 0 } : p)), "spare-arm")!;
    expect(pulseLine(sold).meta).toContain("none left");
    expect(pulseLine({ ...sold, state: "closed" }).meta).toBe("Closed for now");
  });

  it("still points at the stall before the market answers", () => {
    const out = html(createElement(MarketTileView, { pulse: null, quest: null, signedIn: false }));
    expect(text(out)).toContain("Gwei Stacy’s prices move with every trade");
    expect(out).toContain('href="/play/market"');
  });
});

describe("the first-visit coach", () => {
  it("is three steps: your Bits, Gwei's price, buy or sell", () => {
    const steps = coachSteps(161);
    expect(steps.map((s) => s.target)).toEqual(["bits", "price", "trade"]);
    expect(steps[0]!.text).toContain("You have 161 Bits.");
    expect(coachSteps(1)[0]!.text).toContain("You have 1 Bit.");
    expect(coachSteps(null)[0]!.text).toContain("Your Bits show here.");
    expect(steps[1]!.text).toContain("“Why this price?”");
    expect(steps[2]!.text).toContain(`+${MARKET_QUEST_XP} XP`);
  });

  it("every step but the last can be skipped, and uses one word to go on", () => {
    const steps = coachSteps(161);
    const first = text(html(createElement(CoachCard, { step: steps[0]!, index: 0, count: 3, onNext: noop, onSkip: noop })));
    expect(first).toContain("Market tour · step 1 of 3");
    expect(first).toContain("Skip the tour");
    expect(first).toContain("Next");
    const second = text(html(createElement(CoachCard, { step: steps[1]!, index: 1, count: 3, onNext: noop, onSkip: noop })));
    expect(second).toContain("Next");
    const last = text(html(createElement(CoachCard, { step: steps[2]!, index: 2, count: 3, onNext: noop, onSkip: noop })));
    expect(last).toContain("Market tour · step 3 of 3");
    expect(last).toContain("Start trading");
    expect(last).not.toContain("Skip the tour");
    expect(last).not.toContain("Next");
  });
});

describe("the trade sheet", () => {
  const m = view();
  const link = m.items.find((i) => i.item === "chain-link")!;
  const sheet = (props: Partial<Parameters<typeof TradeSheet>[0]>) =>
    html(createElement(TradeSheet, { item: link, side: "buy", view: m, me: me(), onSide: noop, onClose: noop, onTrade: async () => ({ ok: true as const, snapshot: null }), ...props }));

  it("opens on a prompt's amount, with the quote for all of it on the button", () => {
    const cost = buyQuote(link.pool, 3, m.params.feeBps)!.total;
    const out = sheet({ initialAmount: 3 });
    expect(out).toContain('value="3"');
    expect(text(out)).toContain(`Buy 3 for ${cost} Bits`);
  });

  it("clamps a prefill to what one trade allows", () => {
    expect(sheet({ initialAmount: 500 })).toContain(`value="${m.params.maxAmount}"`);
    expect(sheet({ initialAmount: 0 })).toContain('value="1"');
  });

  it("a guest sees the price, why they can't trade yet, and the one button that fixes it", () => {
    const out = sheet({ me: null, gate: { label: "Sign in to trade", text: "Trading needs an account. Your guest nights would have paid about 42 Bits; signed in, every verified night pays Bits you can spend here.", onAct: noop } });
    const words = text(out);
    expect(words).toContain("Your guest nights would have paid about 42 Bits");
    expect(words).toContain("Sign in to trade");
    expect(words).toContain("You pay");
    // The trade button gives way to the gate's: nothing dead to tap.
    expect(words).not.toMatch(/Buy 1 for \d+ Bits/);
  });

  it("a wallet player without quick play gets that step in one sentence, on the button", () => {
    const out = text(sheet({ gate: { label: "Enable quick play", text: "Trades on NEAR are signed by a game-only key, so there’s no popup each time. One approval adds it, and it can never move your tokens.", onAct: noop } }));
    expect(out).toContain("One approval adds it, and it can never move your tokens.");
    expect(out).toContain("Enable quick play");
  });
});
