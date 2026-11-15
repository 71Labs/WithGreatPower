/**
 * Every number the README and the docs quote that this repository can work out by itself must
 * equal the value in code. Nothing here keeps a second copy of a number: each expectation is
 * built from the constant, the table or the simulation that owns it, and then looked for in the
 * document's own words. (The three test counts are checked by `pnpm evidence`, which runs the
 * suites; the live counts are checked by `pnpm evidence --chain`.)
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { CHAPTER_IDS, CHAPTER_RULESET } from "@wgp/game-core/chapters";
import { TASK_IDS } from "@wgp/game-core/city";
import { DAILY_ATTEMPTS, DAILY_RULESET, TRIAL_COURSE_IDS, TRIAL_RULESET } from "@wgp/game-core/compete";
import { ITEMS, STOPS_PER_PATROL, SUITS } from "@wgp/game-core/data";
import { GOLDEN_CASES, GOLDEN_EXPECT, goldenLog, goldenSave } from "@wgp/game-core/golden";
import { replayRun } from "@wgp/game-core/replay";
import { RULESET_VERSION, SIM_HZ } from "@wgp/game-core/sim3d/constants";
import { describe, expect, it } from "vitest";

import { DRAIN, MAINNET, RECOMMENDED, RECOMMENDED_WITH_TAPER, SEASON, TAPER_ONLY, economyConfig, measured, play } from "@/lib/market/balance";
import { LAB_BROKE_SEED } from "@/lib/market/bots";
import { CURVES, DEFAULT_PARAMS, PROPOSED_PARAMS, defaultPoolConfigs } from "@/lib/market/config";
import { LAUNCH_ITEM_IDS } from "@/lib/market/new-stock";
import { NPC_RULES } from "@/lib/market/npc-rules";
import { BITS_FOR_LEVEL_UP, BITS_FOR_SHOWING_UP, BITS_PER_SCORE, MAX_NIGHT_BITS, MAX_PICKUP_BITS, NIGHT_TAPER } from "@/lib/market/rewards";
import { MARKET_METHODS, MAX_RELAY_GAS, RELAY_METHODS, TGAS } from "@/lib/near/policy";
import { TRIAL_RUNS_PER_DAY } from "@/server/db/compete";
import { REWARD_BATCH_SIZE } from "@/server/db/outbox";
import { CLAIM_WINDOW_MS, REFERRAL_GOAL, REFERRAL_XP } from "@/server/db/referrals";
import { RUNS_PER_DAY } from "@/server/db/runs";
import { CLOSE_GRACE_MS, TROPHY_PLACES } from "@/server/db/season-close";
import { VERIFY_RULES } from "@/server/verify";

import { ROOT, plainDoc, read, tableAfter } from "./repo";

const README = plainDoc("README.md");
const says = (doc: string, text: string) => expect(doc, `expected the document to say: ${text}`).toContain(text);
const fmt = (n: number) => n.toLocaleString("en-US");
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n]!;
const Word = (n: number) => word(n)[0]!.toUpperCase() + word(n).slice(1);

/** A `const NAME: T = value;` in the contract's source, as a number. */
function rustConst(file: string, name: string): number {
  const m = new RegExp(`const ${name}: \\w+ = ([\\d_]+);`).exec(read(file));
  if (!m) throw new Error(`${file} has no const ${name}`);
  return Number(m[1]!.replace(/_/g, ""));
}

/** `MarketParams::default()` in the contract, field by field. */
function rustMarketDefaults(): Record<string, number | boolean> {
  const src = read("contracts/wgp/src/market.rs");
  const body = /impl Default for MarketParams \{\s*fn default\(\) -> Self \{\s*Self \{([^}]*)\}/.exec(src)?.[1];
  if (!body) throw new Error("market.rs has no MarketParams::default()");
  const out: Record<string, number | boolean> = {};
  for (const m of body.matchAll(/(\w+): (?:U128\()?([\w_]+)\)?,/g)) out[m[1]!] = m[2] === "true" ? true : m[2] === "false" ? false : Number(m[2]!.replace(/_/g, ""));
  return out;
}

const lab = (setting: typeof MAINNET, seed = 2026) => {
  const e = play(economyConfig(setting, { ...SEASON, seed, npc: true }));
  return e.history.at(-1)!;
};

describe("the README's numbers equal the code's", () => {
  // The fee and the crafting cost the README quotes are the proposed ones (PROPOSED_PARAMS): mainnet's once the
  // owner's set_market_params lands (docs/ECONOMY.md, "The owner's command"). Everything else is the contract's default.
  it("the market: fee, pools, listing bounds and the items-per-call cap", () => {
    const feePct = PROPOSED_PARAMS.feeBps / 100;
    const pools = defaultPoolConfigs().length;
    // The pools the owner seeded at launch; Gwei's new stock opens four more once the owner calls land (src/lib/market/new-stock.ts).
    expect(pools).toBe(LAUNCH_ITEM_IDS.length);
    expect({ ...PROPOSED_PARAMS, feeBps: DEFAULT_PARAMS.feeBps, craftBits: DEFAULT_PARAMS.craftBits }).toEqual(DEFAULT_PARAMS);
    says(README, `{"open":true,"fee_bps":${PROPOSED_PARAMS.feeBps},"pools":${pools},"prices_milli":[…]}`);
    says(README, `The contract and its market (${pools} pools, ${feePct}% fee)`);
    says(README, `a gas fee on each trade is burned (${feePct}% today)`);
    says(README, `the contract's fee_bps, ${feePct}% today`);
    says(README, `fee:     ceil(bits · ${PROPOSED_PARAMS.feeBps} / 10000), burned`);
    says(README, `a ${feePct}% fee that's burned`);
    const bounds = `${DEFAULT_PARAMS.floorBps / 100}–${DEFAULT_PARAMS.ceilingBps / 100}%`;
    says(README, `at ${bounds} of her price`);
    says(README, `listing prices within ${bounds} of the vendor's`);
    says(README, `at most ${DEFAULT_PARAMS.maxAmount} items a call`);
    says(README, `the contract's craft_bits on top (${PROPOSED_PARAMS.craftBits} today)`);
  });

  it("the app's market defaults are the contract's MarketParams::default()", () => {
    expect(rustMarketDefaults()).toEqual({
      open: DEFAULT_PARAMS.open,
      fee_bps: DEFAULT_PARAMS.feeBps,
      floor_bps: DEFAULT_PARAMS.floorBps,
      ceiling_bps: DEFAULT_PARAMS.ceilingBps,
      max_amount: DEFAULT_PARAMS.maxAmount,
      max_open_listings: DEFAULT_PARAMS.maxOpenListings,
      max_listings: DEFAULT_PARAMS.maxListings,
      daily_trades: DEFAULT_PARAMS.dailyTrades,
      daily_listings: DEFAULT_PARAMS.dailyListings,
      daily_fills: DEFAULT_PARAMS.dailyFills,
      daily_fill_bits: DEFAULT_PARAMS.dailyFillBits,
      craft_bits: DEFAULT_PARAMS.craftBits,
    });
  });

  it("the Bits a night earns", () => {
    const rule = `floor(score / ${BITS_PER_SCORE}) + ${BITS_FOR_SHOWING_UP}`;
    says(README, `${rule}, +${BITS_FOR_LEVEL_UP} on a level-up, +1 for each gold Bits token you swing through (up to ${MAX_PICKUP_BITS}), and at most ${fmt(MAX_NIGHT_BITS)} a night`);
    says(README, `A hero who already holds over ${NIGHT_TAPER.fullBelow} Bits gets less, down to the ${BITS_FOR_SHOWING_UP} for showing up at ${NIGHT_TAPER.floorAt}`);
    says(plainDoc("docs/GAME-LOOP.md"), `(${rule}, +${BITS_FOR_LEVEL_UP} on a level-up, +1 per gold token up to ${MAX_PICKUP_BITS}, capped at ${fmt(MAX_NIGHT_BITS)} a night)`);
    says(plainDoc("docs/ECONOMY.md"), `${rule}, +${BITS_FOR_LEVEL_UP} on a level-up, +1 per Bits token collected (up to ${MAX_PICKUP_BITS}), at most ${fmt(MAX_NIGHT_BITS)}`);
  });

  it("the ways to play: how many, and each mode's counts", () => {
    const modes = tableAfter(read("README.md"), "## Ways to play").length;
    says(README, `${modes} ways to play`);
    says(README, `A 3D night of ${word(STOPS_PER_PATROL)} stops (two fights, two errands)`);
    says(README, `Finishes a night of ${word(STOPS_PER_PATROL)} stops`);
    says(README, `a 3D night of ${word(STOPS_PER_PATROL)} stops`);
    says(README, `new each UTC day, ${DAILY_ATTEMPTS} tries`);
    says(README, `${Word(TRIAL_COURSE_IDS.length)} courses with medal times`);
    says(README, `${Word(CHAPTER_IDS.length)} story chapters`);
    says(README, `${word(TASK_IDS.length)} side tasks`);
    says(README, `${word(TASK_IDS.length)} people have tasks`);
    says(README, `trophy:s1:1…${TROPHY_PLACES} for the top ${TROPHY_PLACES}`);
    expect(rustConst("contracts/wgp/src/lib.rs", "MAX_TOP")).toBe(TROPHY_PLACES);
    says(README, `Invite ${REFERRAL_GOAL} friends`);
  });

  it("the verifier's limits and the ruleset", () => {
    says(README, `a ${SIM_HZ} Hz fixed step`);
    says(README, `at most one active run and ${RUNS_PER_DAY} ranked runs a day`);
    says(README, `caps ranked nights at ${RUNS_PER_DAY} a day per player`);
    says(README, `at least ${VERIFY_RULES.minGameSeconds} seconds of game time, game time within wall-clock time plus ${VERIFY_RULES.wallSlackSeconds} seconds`);
    says(README, `the server refuses a log over ${VERIFY_RULES.maxLogBytes / 1024} KB`);
    says(README, `Season 1 plays on ruleset ${RULESET_VERSION}`);
    says(README, `All ${GOLDEN_CASES.length} replays match Node`);
    says(README, `replays ${word(GOLDEN_CASES.length)} recorded nights`);
  });

  it("the recorded nights' input logs are inside the size the README gives", () => {
    const dir = path.join(ROOT, "packages/game-core/test/golden");
    const nights = readdirSync(dir).filter((f) => /^night-.*\.bin$/.test(f));
    expect(nights).toHaveLength(GOLDEN_CASES.length);
    says(README, "usually 1–5 KB a night");
    for (const f of nights) expect(statSync(path.join(dir, f)).size, f).toBeLessThanOrEqual(5 * 1024);
  });

  it("rewards, the relayer and the season close", () => {
    says(README, `in batches of up to ${REWARD_BATCH_SIZE}`);
    expect(rustConst("contracts/wgp/src/lib.rs", "MAX_REWARD_BATCH")).toBe(REWARD_BATCH_SIZE);
    says(README, `at most ${MAX_RELAY_GAS / TGAS} Tgas`);
    says(README, `plus ${CLOSE_GRACE_MS / 60_000} minutes for runs in flight`);
    // "Calls from player accounts (...)" in check 2 and the status table name the relayed methods.
    for (const method of RELAY_METHODS.filter((m) => m !== "cancel_listing")) says(README, method);
    expect(MARKET_METHODS).toHaveLength(5);
  });

  it("the economy lab: its size, its settings and what its default run prints", () => {
    says(README, `runs ${SEASON.bots} bot players for ${SEASON.days} days`);
    says(README, `Run ${SEASON.days} days`);
    says(README, `${SEASON.bots} bot players patrol, buy, sell, list and craft for ${SEASON.days} days`);
    const proposal = RECOMMENDED_WITH_TAPER;
    expect(proposal).toMatchObject({ feeBps: PROPOSED_PARAMS.feeBps, craftBits: PROPOSED_PARAMS.craftBits, taper: NIGHT_TAPER });
    says(README, `with mainnet's settings (${proposal.feeBps / 100}% gas fee, crafting burns ${proposal.craftBits} Bits, nights tapered by the Bits a hero holds)`);
    expect(MAINNET).toMatchObject({ feeBps: DEFAULT_PARAMS.feeBps, craftBits: DEFAULT_PARAMS.craftBits, taper: null });
    says(README, `Tick Run the old settings (${MAINNET.feeBps / 100}% gas fee, crafting burns no Bits, no taper)`);
    says(README, `press Drain Gwei and run ${DRAIN.days} days`);

    // The run the lab opens on: seed 2026, Sandwich Man trading, the proposal (economy-lab.tsx).
    const now = lab(proposal);
    const pct = (d: { minted: number; burned: number }) => Math.round((100 * d.burned) / d.minted);
    says(README, `the default run earns ${fmt(now.minted)} Bits and burns ${fmt(now.burned)} of them, about ${pct(now)}%`);
    const before = lab(MAINNET);
    says(README, `run again: ${fmt(before.minted)} earned and ${fmt(before.burned)} burned, about ${pct(before)}%`);
    says(README, `on mainnet's settings, ${fmt(now.minted)} are earned and ${fmt(now.burned)} burned, about ${pct(now)}% (${fmt(before.minted)} and ${fmt(before.burned)} on the old settings)`);
    says(README, `the whole night up to ${NIGHT_TAPER.fullBelow} held, falling to the ${BITS_FOR_SHOWING_UP} for showing up at ${NIGHT_TAPER.floorAt}`);
    says(README, `The sinks are the trade fee (${proposal.feeBps / 100}%) and crafting, which burns ${proposal.craftBits} Bits a suit`);
  });

  it("docs/ECONOMY.md's headline rows are what the model measures", () => {
    const doc = plainDoc("docs/ECONOMY.md");
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
    const today = measured(MAINNET, SEASON, seeds);
    says(doc, `| 21 days | ${fmt(Math.round(today.minted.total))} | ${fmt(Math.round(today.burned.total))} | ${pct(today.burnShare)} |`);
    const row = (m: typeof today) => `${fmt(Math.round(m.minted.total))} | ${fmt(Math.round(m.burned.total))} | ${fmt(Math.round(m.burned.fee))} | ${fmt(Math.round(m.burned.craft))} | ${pct(m.burnShare)} |`;
    says(doc, `| 21 days, 60 heroes | Before | ${row(today)}`);
    says(doc, `| | Taper only | ${row(measured(TAPER_ONLY, SEASON, seeds))}`);
    says(doc, `| | Owner's settings | ${row(measured(RECOMMENDED, SEASON, seeds))}`);
    const proposed = measured(RECOMMENDED_WITH_TAPER, SEASON, seeds);
    says(doc, `| | Proposed | ${row(proposed)}`);
    says(doc, `It passes the band: ${pct(proposed.burnShare)} of a season's Bits burned`);
    says(doc, `| craft_bits | "${MAINNET.craftBits}" | "${RECOMMENDED.craftBits}" |`);
    says(doc, `| fee_bps | ${MAINNET.feeBps} | ${RECOMMENDED.feeBps} |`);
    says(doc, `NIGHT_TAPER = { fullBelow: ${NIGHT_TAPER.fullBelow}, floorAt: ${NIGHT_TAPER.floorAt} }`);
    // The lab's counters (seed 2026, Sandwich Man trading): the proposal it opens on, and the old settings.
    const before = lab(MAINNET);
    const now = lab(RECOMMENDED_WITH_TAPER);
    says(doc, `the old settings read ${fmt(before.minted)} earned (his ${NPC_RULES.seedBits}-Bit seed included) and ${fmt(before.burned)} burned`);
    says(doc, `the counters read ${fmt(now.minted)} earned and ${fmt(now.burned)} burned (${pct(now.burned / now.minted)}), against ${fmt(before.minted)} and ${fmt(before.burned)} before`);
    says(doc, `the gap between earned and burned falls from ${fmt(before.minted - before.burned)} Bits to ${fmt(now.minted - now.burned)}`);
  });

  it("Sandwich Man's limits, in the README and in docs/npc-trader.md", () => {
    says(README, `closes shop under ${NPC_RULES.closeBelowBits} Bits and reopens at ${NPC_RULES.reopenAtBits}`);
    says(README, `a one-off seed of ${NPC_RULES.seedBits} Bits`);
    says(README, `(seed ${LAB_BROKE_SEED}: he closes shop three times and reopens)`);
    const doc = plainDoc("docs/npc-trader.md");
    says(doc, `| Broke | Under ${NPC_RULES.closeBelowBits} Bits he buys nothing; he reopens at ${NPC_RULES.reopenAtBits} |`);
    says(doc, `| Starting Bits (the one-off seed) | ${NPC_RULES.seedBits} |`);
    // The contract's caps, which the page says apply to him as to anyone.
    const p = DEFAULT_PARAMS;
    says(doc, `${p.dailyTrades} vendor trades, ${p.dailyListings} listings, ${p.dailyFills} fills and ${fmt(p.dailyFillBits)} Bits of fills a day; ${p.maxOpenListings} open listings; ${p.maxAmount} items a call; listing prices between ${p.floorBps / 100}% and ${p.ceilingBps / 100}% of Gwei's spot price`);
    says(doc, `Gwei's tills start at ${fmt(defaultPoolConfigs().reduce((n, c) => n + c.seedBits, 0))} Bits`);
  });

  it("the other docs: competitive modes, referrals, sustainability, the game loop", () => {
    const compete = plainDoc("docs/compete.md");
    says(compete, `DAILY_RULESET = "${DAILY_RULESET}"`);
    says(compete, `TRIAL_RULESET = "${TRIAL_RULESET}"`);
    says(compete, `runs:daily ${DAILY_ATTEMPTS} a UTC day (DAILY_ATTEMPTS); runs:trial ${TRIAL_RUNS_PER_DAY} a day`);
    says(plainDoc("docs/chapters/case-001.md"), `"${CHAPTER_RULESET}"`);

    const referrals = plainDoc("docs/referrals.md");
    says(referrals, `REFERRAL_GOAL = ${REFERRAL_GOAL}`);
    says(referrals, `REFERRAL_XP = ${REFERRAL_XP}`);
    says(referrals, `${CLAIM_WINDOW_MS / 3_600_000} hours after sign-up`);

    const sustain = plainDoc("docs/SUSTAINABILITY.md");
    says(sustain, `One mint_rewards call covers up to ${REWARD_BATCH_SIZE} verified nights`);
    says(sustain, `a per-player cap of ${RUNS_PER_DAY} ranked nights a day`);
    says(sustain, `Listing bounds (${DEFAULT_PARAMS.floorBps / 100}–${DEFAULT_PARAMS.ceilingBps / 100}% of the vendor's price)`);
    says(sustain, `Today the ${PROPOSED_PARAMS.feeBps / 100}% trade fee is burned`);

    const loop = plainDoc("docs/GAME-LOOP.md");
    says(loop, `${PROPOSED_PARAMS.feeBps / 100}% of every trade's Bits is burned`);
    says(loop, `(within ${DEFAULT_PARAMS.floorBps / 100}–${DEFAULT_PARAMS.ceilingBps / 100}% of hers)`);
    says(loop, `same city for everyone, ${DAILY_ATTEMPTS} tries`);
    says(loop, `the top ${TROPHY_PLACES} get soulbound trophies`);
  });

  it("the starting prices the docs give are the curves in config.ts", () => {
    expect([CURVES.common.price, CURVES.uncommon.price, CURVES.rare.price]).toEqual([12, 40, 150]);
    const configs = defaultPoolConfigs();
    const reserves = (rarity: keyof typeof CURVES) => {
      const c = configs.find((x) => ITEMS[x.item].rarity === rarity)!;
      return `${c.virtualBits}/${c.virtualItems}`;
    };
    says(plainDoc("docs/ECONOMY.md"), `| Pool virtual reserves | ${reserves("common")}, ${reserves("uncommon")}, ${reserves("rare")} | Unchanged |`);
  });

  it("suits are cosmetic, as the README says: a suit is colours, a recipe and a level, and no stat", () => {
    says(README, "Suits are cosmetic: a suit changes how the hero looks, not how they fight.");
    for (const suit of Object.values(SUITS)) expect(Object.keys(suit).sort()).toEqual(["blurb", "colors", "id", "minLevel", "name", "recipe", "starter"]);
  });

  it("a suit changes nothing in play: each recorded night replays to the same score, ticks and hash in every suit", () => {
    for (const c of GOLDEN_CASES) {
      const want = GOLDEN_EXPECT[c.name]!;
      const save = goldenSave(c);
      for (const suit of Object.keys(SUITS)) {
        const res = replayRun({ save: { ...save, hero: { ...save.hero!, suit } }, seed: c.seed, log: goldenLog(c) });
        expect({ score: res.score, ticks: res.ticks, hash: res.hash, checkpoints: res.checkpoints }, `${c.name} in ${suit}`).toEqual({ score: want.score, ticks: want.ticks, hash: want.hash, checkpoints: want.checkpoints });
      }
    }
  });

  it("the bot's scores under Limits are the recorded nights' own, the ones the bot clears", () => {
    const file = JSON.parse(read("packages/game-core/test/golden/hashes.json")) as { ruleset: number; cases: Record<string, { ok: boolean; score: number }> };
    expect(file.ruleset).toBe(RULESET_VERSION);
    // The nights the bot plays throughout (not the knockout, where it stands still in a fight).
    const cleared = GOLDEN_CASES.filter((c) => c.policy === "bot").map((c) => file.cases[c.name]!);
    expect(cleared).toHaveLength(3);
    for (const c of cleared) expect(c.ok).toBe(true);
    const scores = cleared.map((c) => c.score).sort((a, b) => a - b).map(fmt);
    says(README, `scores ${scores[0]}, ${scores[1]} and ${scores[2]} on the ${word(cleared.length)} recorded nights it clears`);
    says(README, "replay verification proves a score came from legal inputs, not that a human played it");
  });

  it("the deployed code hash the README gives is the base58 form of the sha256 it gives", () => {
    const raw = read("README.md");
    const hash = /code hash `([1-9A-HJ-NP-Za-km-z]{43,44})`/.exec(raw)![1]!;
    const sha = /the deployed wasm's sha256, `([0-9a-f]{64})`/.exec(raw)![1]!;
    const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = BigInt(0);
    for (const ch of hash) n = n * BigInt(58) + BigInt(ALPHABET.indexOf(ch));
    expect(n.toString(16).padStart(64, "0")).toBe(sha);
    // The chain check holds the deployed account to the same code hash.
    const check = (JSON.parse(read("docs/evidence.json")) as { checks: Record<string, { expect: { path: string; value: unknown }[] }> }).checks["contract-account"]!;
    expect(check.expect.find((e) => e.path === "code_hash")!.value).toBe(hash);
  });

  it("the contract's unit-test count is the number of #[test] functions that aren't ignored", () => {
    const src = ["tests.rs", "market_tests.rs"].map((f) => read(`contracts/wgp/src/${f}`)).join("\n");
    const tests = [...src.matchAll(/#\[test\]\s*((?:#\[[^\]]*\]\s*)*)fn \w+/g)];
    const run = tests.filter((m) => !/#\[ignore/.test(m[1]!)).length;
    says(README, `test result: ok. ${run} passed`);
  });
});
