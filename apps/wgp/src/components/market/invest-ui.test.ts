/**
 * Investing on screen, rendered to markup: an item's card when Gwei's shop is closed (where
 * investing runs, where it is paused, and on contract v2 where it doesn't exist), the
 * invest sheet with its risks ahead of its button, the player's stakes, the practice
 * market's banner and labels, and the one function that sends an investing move, which
 * must send nothing to a market that can't take it.
 */
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ItemId } from "@wgp/game-core/types";

import type { MarketItemView, MarketMe, MarketView } from "@/lib/market/api";
import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import { DEFAULT_INVEST_RULES, INVEST_RISKS, shopOf, type StakeView } from "@/lib/market/invest";
import { buyQuote, sellQuote, spotMilli, type Pool } from "@/lib/market/math";
import { PRACTICE_INVEST_RULES, PRACTICE_LABEL, practiceBase, practiceScreen, seedPractice } from "@/lib/market/practice";
import { INVEST_NOT_LIVE } from "@/lib/market/refusal";

import { investingOf, InvestSheet, PracticeBanner, ShopLine, shopFor, StakesPanel } from "./invest";
import { TraderStrip } from "./other-traders";
import { QuestStrip } from "./quest-strip";
import { TradeSheet } from "./sheets";
import { stake } from "./use-market";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};

/** A market view on `pools`, on chain or not, with or without investing rules. */
function view(over: Partial<MarketView> = {}, change: (pool: Pool) => Pool = (p) => p): MarketView {
  const params = over.params ?? DEFAULT_PARAMS;
  const items = seededPools().map((seed): MarketItemView => {
    const pool = change(seed);
    return {
      item: pool.item as ItemId,
      name: pool.item === "crumbs" ? "Crumbs" : pool.item,
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
  return { onChain: false, network: null, contractId: null, vendor: null, items, listings: 0, till: 0, updatedAt: new Date(NOW).toISOString(), ...over, params };
}

/** Crumbs with an empty till: broke. */
const broke = (p: Pool): Pool => (p.item === "crumbs" ? { ...p, bits: 0, stock: 120 } : p);
const V2 = view({ onChain: true, network: "mainnet", contractId: "game.wgpnear.near", contract: { state: 2, version: null } }, broke);
const V3 = view({ onChain: true, network: "mainnet", contractId: "game.wgpnear.near", contract: { state: 3, version: "0.3.0" }, params: { ...DEFAULT_PARAMS, invest: DEFAULT_INVEST_RULES } }, broke);
const V3_OFF = view({ ...V3, params: { ...DEFAULT_PARAMS, invest: { ...DEFAULT_INVEST_RULES, open: false } } }, broke);
const SIM = view({ params: { ...DEFAULT_PARAMS, invest: DEFAULT_INVEST_RULES } }, broke);
const crumbs = (v: MarketView) => v.items.find((i) => i.item === "crumbs")!;
const me = (over: Partial<MarketMe> = {}): MarketMe => ({ onChain: false, accountId: "alice.near", bits: 400, items: {}, tradesLeft: 40, listingsLeft: 10, fillsLeft: 10, fillBitsLeft: 3000, open: [], pendingBits: 0, investor: { stakes: [], investsLeft: 6, investBitsLeft: 1_000 }, ...over });
const myStake = (over: Partial<StakeView> = {}): StakeView => ({ item: "crumbs", bits: 100, earned: 3, unlocksAtMs: NOW + 40 * 60_000, withdrawable: 0, ...over });

const line = (v: MarketView, props: Partial<Parameters<typeof ShopLine>[0]> = {}) =>
  text(html(createElement(ShopLine, { item: crumbs(v), shop: shopFor(v, crumbs(v)), investing: investingOf(v), stake: null, inPractice: false, onInvest: noop, onPractice: noop, ...props })));

afterEach(() => vi.unstubAllGlobals());

describe("where investing stands", () => {
  it("is available on the simulated market and on contract v3, paused when v3 has it off, and not live on v2", () => {
    expect(investingOf(SIM)).toBe("available");
    expect(investingOf(V3)).toBe("available");
    expect(investingOf(V3_OFF)).toBe("paused");
    expect(investingOf(V2)).toBe("not-live");
    // Mainnet today answers no investing rules at all.
    expect(investingOf(view({ onChain: true }))).toBe("not-live");
  });

  it("reads a stall from the contract's own list when there is one, else from the pool", () => {
    expect(shopFor(SIM, crumbs(SIM))).toEqual(shopOf(crumbs(SIM).pool, true));
    const paused = { ...shopOf(crumbs(V3).pool, true), closed: ["paused" as const, "broke" as const], buying: false, selling: false };
    expect(shopFor({ ...V3, shops: [paused] }, crumbs(V3))).toBe(paused);
  });
});

describe("a closed shop on an item's card", () => {
  it("says closed for buying and why, and offers to invest, where the market takes investors", () => {
    const words = line(SIM);
    expect(words).toContain("Closed for buying");
    expect(words).toMatch(/Broke: her till is \d+ Bits? short of buying one\./);
    expect(words).toContain("Invest in Gwei");
    expect(words).not.toContain("contract v3");
  });

  it("on contract v2 says the reason and the honest sentence, points at practice, and offers no investing", () => {
    const words = line(V2);
    expect(words).toContain("Closed for buying");
    expect(words).toMatch(/Broke: her till is \d+ Bits? short of buying one\./);
    expect(words).toContain(INVEST_NOT_LIVE);
    expect(words).toContain("Open the practice market");
    expect(words).not.toContain("Invest in Gwei");
    expect(words).not.toContain("Withdraw or claim");
    // Already in the practice market, there is nowhere further to point.
    expect(line(V2, { inPractice: true })).not.toContain("Open the practice market");
  });

  it("with investing paused on v3 says so, and still lets a stake out", () => {
    const words = line(V3_OFF, { stake: myStake() });
    expect(words).toContain("Gwei isn’t taking new investors right now");
    expect(words).not.toContain("Invest in Gwei");
    expect(words).toContain("Your stake: 100 Bits · 3 earned");
    expect(words).toContain("Withdraw or claim");
  });

  it("on an open shop shows only the way to invest, and the player's stake if they have one", () => {
    const open = view({ params: SIM.params });
    const words = line(open, { stake: myStake({ earned: 0 }) });
    expect(words).not.toContain("Closed for buying");
    expect(words).toContain("Your stake: 100 Bits");
    expect(words).toContain("Invest in Gwei");
  });
});

describe("the invest sheet", () => {
  const sheet = (v: MarketView, props: Partial<Parameters<typeof InvestSheet>[0]> = {}) =>
    html(createElement(InvestSheet, { item: crumbs(v), view: v, me: me(), now: NOW, inPractice: false, onClose: noop, onStake: async () => ({ ok: true as const, snapshot: null }), ...props }));

  it("states every risk before the button that invests", () => {
    const out = text(sheet(SIM));
    const button = out.search(/Invest \d+ Bits in Gwei/);
    expect(button).toBeGreaterThan(0);
    expect(out.indexOf("What you risk")).toBeGreaterThan(0);
    expect(out.indexOf("What you risk")).toBeLessThan(button);
    for (const risk of INVEST_RISKS) {
      expect(out.indexOf(risk), risk).toBeGreaterThan(0);
      expect(out.indexOf(risk), risk).toBeLessThan(button);
    }
  });

  it("shows the shop closed, what it needs, the room left, and opens on enough to reopen her", () => {
    const shop = shopOf(crumbs(SIM).pool, true);
    const out = sheet(SIM);
    const words = text(out);
    expect(words).toContain("Closed for buying");
    expect(words).toContain(`It is ${shop.needs} Bits short of one.`);
    expect(words).toContain("Room for more 479 Bits");
    expect(words).toContain("The price doesn’t move");
    expect(words).toContain("You earn 50% of the 2% gas fee on every trade of Crumbs with her");
    expect(words).toContain("locked for 60 minutes after each top-up");
    // The amount it opens on reopens her and respects the smallest investment.
    expect(out).toContain(`value="${Math.max(DEFAULT_INVEST_RULES.min, shop.needs)}"`);
    expect(out).toMatch(/<label[^>]*for="[^"]+"[^>]*>Bits to invest<\/label>/);
    expect(out).toContain('inputMode="numeric"');
  });

  it("shows a stake with its earnings and its lock, and the withdraw side", () => {
    const words = text(sheet(SIM, { me: me({ investor: { stakes: [myStake()], investsLeft: 5, investBitsLeft: 900 } }), initialTab: "withdraw" }));
    expect(words).toContain("Your stake 100 Bits");
    expect(words).toContain("Earned from fees Yours to claim at any time. 3 Bits");
    expect(words).toContain("Unlocks in A stake unlocks 60 minutes after its last top-up. about 40 minutes");
    expect(words).toContain("Claim 3 Bits");
    // Locked: the button still names the whole stake, and pressing it says when it unlocks.
    expect(words).toContain("Withdraw 100 Bits");
    expect(words).not.toContain("What you risk");
  });

  it("in the practice market is labelled practice and names the shorter lock", () => {
    const v = view({ params: { ...DEFAULT_PARAMS, invest: PRACTICE_INVEST_RULES } }, broke);
    const words = text(sheet(v, { inPractice: true }));
    expect(words).toContain("Practice market · not on NEAR");
    expect(words).toContain("locked for 30 seconds after each top-up (an hour by default on NEAR)");
  });

  it("never opens on a market with no investing rules (contract v2)", () => {
    const words = text(sheet(V2));
    expect(words).not.toContain("Bits to invest");
    expect(words).not.toMatch(/Invest \d+ Bits in Gwei/);
  });

  it("gives way to the gate's one button when the player can't act yet", () => {
    const words = text(sheet(V3, { me: null, gate: { label: "Enable quick play", text: "One approval adds a game-only key.", onAct: noop } }));
    expect(words).toContain("Enable quick play");
    expect(words).toContain("One approval adds a game-only key.");
    expect(words).not.toMatch(/Invest \d+ Bits in Gwei/);
    // The risks are still there to read.
    expect(words).toContain("What you risk");
  });
});

describe("the player's stakes", () => {
  it("lists each stake with what it earned and whether it can come out", () => {
    const locked = text(html(createElement(StakesPanel, { view: SIM, me: me({ investor: { stakes: [myStake()], investsLeft: 5, investBitsLeft: 900 } }), now: NOW, onManage: noop })));
    expect(locked).toContain("Your stakes in Gwei");
    expect(locked).toContain("100 Bits in her Crumbs till");
    expect(locked).toContain("3 earned from fees · locked for about 40 minutes");
    const waiting = text(html(createElement(StakesPanel, { view: SIM, me: me({ investor: { stakes: [myStake({ unlocksAtMs: NOW - 1, withdrawable: 0 })], investsLeft: 5, investBitsLeft: 900 } }), now: NOW, onManage: noop })));
    expect(waiting).toContain("unlocked, waiting for her till to refill");
    const part = text(html(createElement(StakesPanel, { view: SIM, me: me({ investor: { stakes: [myStake({ unlocksAtMs: NOW - 1, withdrawable: 37 })], investsLeft: 5, investBitsLeft: 900 } }), now: NOW, onManage: noop })));
    expect(part).toContain("unlocked, 37 can come out now");
  });

  it("isn't there with no stake, or on a market that has none", () => {
    expect(html(createElement(StakesPanel, { view: SIM, me: me(), now: NOW, onManage: noop }))).toBe("");
    expect(html(createElement(StakesPanel, { view: V2, me: me({ investor: undefined }), now: NOW, onManage: noop }))).toBe("");
  });
});

describe("the practice market's labels", () => {
  it("still points a guest at the real market's contract when it is on chain", () => {
    const live = { network: "mainnet", contractId: "game.wgpnear.near", href: "https://nearblocks.io/address/game.wgpnear.near" };
    const out = html(createElement(PracticeBanner, { seededFrom: "near", signedIn: false, drainName: null, live, onDrain: noop, onReset: noop, onLeave: noop }));
    expect(out).toContain('href="https://nearblocks.io/address/game.wgpnear.near"');
    expect(text(out)).toContain("See the real market on NEAR mainnet: game.wgpnear.near");
    // Simulated, there is no contract to show.
    expect(html(createElement(PracticeBanner, { seededFrom: "simulated", signedIn: false, drainName: null, onDrain: noop, onReset: noop, onLeave: noop }))).not.toContain("See the real market");
  });

  it("carries the label word for word, where its prices came from, and its controls", () => {
    const words = text(html(createElement(PracticeBanner, { seededFrom: "near", signedIn: false, drainName: "Crumbs", onDrain: noop, onReset: noop, onLeave: noop })));
    expect(words).toContain(PRACTICE_LABEL);
    expect(words).toContain("prices started from the live market on NEAR");
    expect(words).toContain("300 practice Bits");
    expect(words).toContain("nothing here can be minted");
    expect(words).toContain("Empty Gwei’s Crumbs till");
    expect(words).toContain("Start practice over");
    // Only a signed-in player has a real market to go back to.
    expect(words).not.toContain("Go back to the real market");
    expect(text(html(createElement(PracticeBanner, { seededFrom: "simulated", signedIn: true, drainName: null, onDrain: noop, onReset: noop, onLeave: noop })))).toContain("Go back to the real market");
  });

  it("says what its own buttons did inside the banner, as a status, so no toast covers the quest strip", () => {
    const quiet = html(createElement(PracticeBanner, { seededFrom: "near", signedIn: false, drainName: "Crumbs", onDrain: noop, onReset: noop, onLeave: noop }));
    // The live region is there before anything is said, and says nothing.
    expect(quiet).toMatch(/<p role="status"[^>]*><\/p>/);
    const note = "A crowd sold Gwei 80 Crumbs. Her till for it is empty, so she is closed for buying it.";
    const said = html(createElement(PracticeBanner, { seededFrom: "near", signedIn: false, drainName: null, note, onDrain: noop, onReset: noop, onLeave: noop }));
    expect(said).toMatch(/<p role="status"[^>]*>.*A crowd sold Gwei 80 Crumbs\./);
    // The screen sends both of the banner's messages here and neither to the toast.
    const screen = readFileSync(new URL("./market-screen.tsx", import.meta.url), "utf8");
    expect(screen).toContain("note={practiceNote}");
    expect(screen).not.toMatch(/showToast\([^)]*(crowd sold|[Ss]tarted over)/);
  });

  it("says practice trades earn no XP on the quest strip", () => {
    const words = text(html(createElement(QuestStrip, { quest: null, signedIn: false, now: NOW, note: "Practice trades earn no XP. Sign in, and one real trade a day does it." })));
    expect(words).toContain("Practice trades earn no XP. Sign in, and one real trade a day does it.");
    expect(words).not.toContain("Sign in to take it");
  });

  it("labels Sandwich Man as the NPC, in practice", () => {
    const screen = practiceScreen(seedPractice(null, NOW), practiceBase(0, {}), NOW);
    const words = text(html(createElement(TraderStrip, { npc: screen.npc })));
    expect(words).toContain("Sandwich Man");
    expect(words).toMatch(/\bNPC\b/);
    expect(words).toMatch(/\bPractice\b/);
    expect(words).not.toContain("Simulated");
  });
});

describe("sending an investing move", () => {
  it("sends nothing to a market without investing rules (contract v2), and says why", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    for (const req of [
      { action: "invest", item: "crumbs", bits: 100 },
      { action: "withdraw", item: "crumbs", bits: 100 },
      { action: "claim", item: "crumbs" },
    ] as const) {
      expect(await stake(V2, req)).toEqual({ ok: false, code: "invest_unsupported", message: INVEST_NOT_LIVE, snapshot: null });
    }
    expect(fetched).not.toHaveBeenCalled();
  });

  it("posts to the simulated market's own route, and nowhere else", async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify({ action: "invest", receipt: {}, bits: 300 }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetched);
    expect(await stake(SIM, { action: "invest", item: "crumbs", bits: 100 })).toEqual({ ok: true, snapshot: null });
    expect(fetched).toHaveBeenCalledTimes(1);
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/market/invest");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ action: "invest", item: "crumbs", bits: 100 });
  });
});

describe("the trade sheet on an item Gwei can't pay for", () => {
  const sheet = (v: MarketView, props: Partial<Parameters<typeof TradeSheet>[0]> = {}) =>
    text(html(createElement(TradeSheet, { item: crumbs(v), side: "sell", view: v, me: me({ items: { crumbs: 4 } }), onSide: noop, onClose: noop, onTrade: async () => ({ ok: true as const, snapshot: null }), ...props })));

  it("offers to invest instead, where the market takes investors", () => {
    const words = sheet(SIM, { onInvest: noop });
    expect(words).toContain("Gwei’s till for these can’t pay for one");
    expect(words).toContain("Invest in Gwei instead");
    expect(words).toContain("Put Bits into her till for Crumbs and she can buy again, at the same price.");
  });

  it("offers nothing of the kind without a way to invest (contract v2), on the buy side, or on an open shop", () => {
    expect(sheet(V2)).not.toContain("Invest in Gwei instead");
    expect(sheet(SIM, { onInvest: noop, side: "buy" })).not.toContain("Invest in Gwei instead");
    expect(sheet(view({ params: SIM.params }), { onInvest: noop })).not.toContain("Invest in Gwei instead");
  });
});
