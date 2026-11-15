/**
 * Measures the Bits economy and checks the recommended settings: runs the bot
 * fast-forward (src/lib/market/bots.ts) over many seeds, horizons and player counts under
 * each setting, counts every Bit minted and burned, and compares the model's assumptions
 * with what game.wgpnear.near holds right now (read-only RPC). docs/ECONOMY.md is written
 * from its output.
 *
 *   pnpm --filter wgp exec tsx scripts/economy-balance.ts            # tables + JSON
 *   ... --seeds 12          how many seeds to average (default 8, seeds 1..N)
 *   ... --offline           skip the mainnet read
 *   ... --search            also sweep craft_bits × fee × price × depth and rank them
 *   ... --drain             also run the lab's "Drain Gwei" stress run for each seed
 *   ... --npc               also measure a season and 60 days with Sandwich Man trading
 *   ... --out <file>        where the JSON goes (default docs/economy/balance.json)
 *
 * Deterministic: the same seeds give the same numbers. Only the `mainnet` block changes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import {
  ALTERNATIVES,
  BAND,
  DRAIN,
  MAINNET,
  RECOMMENDED,
  RECOMMENDED_TAPER,
  RECOMMENDED_WITH_TAPER,
  TAPER_ONLY,
  SEASON,
  SIXTY,
  economyConfig,
  measure,
  measureEconomy,
  measured,
  paramsFor,
  play,
  poolConfigsFor,
  verdict,
  type Measure,
  type Setting,
} from "../src/lib/market/balance";
import { Economy } from "../src/lib/market/bots";
import { defaultPoolConfigs, seededPools, setMarketParamsArgs } from "../src/lib/market/config";
import { buyQuote, sellQuote, spotMilli, type Pool } from "../src/lib/market/math";
import { nightBits } from "../src/lib/market/rewards";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: string) => (argv.includes(`--${name}`) ? (argv[argv.indexOf(`--${name}`) + 1] ?? fallback) : fallback);
const SEEDS = Array.from({ length: Math.max(1, Number(option("seeds", "8"))) }, (_, i) => i + 1);
const OUT = resolve(option("out", resolve(__dirname, "../../../docs/economy/balance.json")));

/* ------------------------------------------------------------------ printing */

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");

function table(title: string, head: string[], rows: (string | number)[][]) {
  const cells = [head, ...rows.map((r) => r.map(String))];
  const width = head.map((_, i) => Math.max(...cells.map((r) => r[i]!.length)));
  console.log(`\n${title}`);
  for (const [n, r] of cells.entries()) {
    console.log(r.map((c, i) => (i === 0 ? c.padEnd(width[i]!) : c.padStart(width[i]!))).join("  "));
    if (n === 0) console.log(width.map((w) => "-".repeat(w)).join("  "));
  }
}

const HEAD = ["setting", "earned", "burned", "fee", "craft", "burn/earn", "late burn/earn", "net/hero/day", "Bits/hero", "Gini", "till", "sold out", "broke", "suits", "1st suit", "price c/u/r"];
const line = (label: string, m: Measure) => [
  label,
  int(m.minted.total),
  int(m.burned.total),
  int(m.burned.fee),
  int(m.burned.craft),
  pct(m.burnShare),
  pct(m.lateBurnShare),
  m.lateNetPerHeroDay.toFixed(1),
  int(m.heldMean),
  m.gini.toFixed(2),
  int(m.till),
  pct(m.soldOut),
  pct(m.broke),
  int(m.suits),
  m.firstSuitNight === null ? "-" : `night ${m.firstSuitNight}`,
  `${m.price.common.end}/${m.price.uncommon.end}/${m.price.rare.end}`,
];

/* ------------------------------------------------------------------ 1. the accounting */

/** Every run must balance to the Bit: seeded till + minted − burned = supply, every day. */
function audit(): { runs: number; days: number } {
  let days = 0;
  let runs = 0;
  for (const setting of [MAINNET, TAPER_ONLY, RECOMMENDED, RECOMMENDED_WITH_TAPER, ...ALTERNATIVES]) {
    for (const seed of SEEDS) {
      const e = play(economyConfig(setting, { ...SEASON, seed, lifespan: seed % 2 ? undefined : 8 }));
      const till0 = e.history[0]!.till;
      for (const d of e.history) {
        if (d.supply !== till0 + d.minted - d.burned) throw new Error(`${setting.id} seed ${seed} day ${d.day}: ${d.supply} ≠ ${till0} + ${d.minted} − ${d.burned}`);
        days += 1;
      }
      runs += 1;
    }
  }
  return { runs, days };
}

/* ------------------------------------------------------------------ 2. mainnet */

const RPC = "https://rpc.mainnet.near.org";
const CONTRACT = "game.wgpnear.near";

async function view<T>(method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const body = (await res.json()) as { result?: { result?: number[] }; error?: unknown };
  if (!body.result?.result) throw new Error(`${method}: ${JSON.stringify(body.error ?? body)}`);
  return JSON.parse(Buffer.from(body.result.result).toString()) as T;
}

interface ChainPool {
  item: string;
  virtual_bits: string;
  virtual_items: string;
  bits: string;
  stock: string;
  escrow: string;
}

async function mainnet() {
  const [state, supply, stats, ...suits] = await Promise.all([
    view<{ params: Record<string, unknown>; pools: ChainPool[] }>("market_state"),
    view<string>("mt_supply", { token_id: "item:bits" }),
    fetch("https://www.wgponnear.fun/api/stats").then((r) => r.json() as Promise<{ runs: { verified: number }; players: { withVerifiedRun: number }; chain: { rewardMints: { sent: number } } }>),
    ...["stealth", "glider", "octo", "sesame"].map((s) => view<string | null>("mt_supply", { token_id: `suit:${s}` })),
  ]);
  const pools: Pool[] = state.pools.map((p) => ({ item: p.item, virtualBits: Number(p.virtual_bits), virtualItems: Number(p.virtual_items), bits: Number(p.bits), stock: Number(p.stock), escrow: Number(p.escrow) }));
  const till = pools.reduce((s, p) => s + p.bits, 0);
  const seededTill = seededPools().reduce((s, p) => s + p.bits, 0);
  const total = Number(supply);
  const players = stats.players.withVerifiedRun;
  const mints = stats.chain.rewardMints.sent;
  // supply = seeded till + minted − burned, so this difference is exact; the split isn't on chain.
  const netMinted = total - seededTill;
  return {
    at: new Date().toISOString(),
    params: state.params,
    pools,
    supply: total,
    till,
    seededTill,
    held: total - till,
    netMinted,
    rewardMints: mints,
    verifiedRuns: stats.runs.verified,
    players,
    netMintedPerRewardMint: Number((netMinted / mints).toFixed(1)),
    heldPerPlayer: Number(((total - till) / players).toFixed(0)),
    nightsPerPlayer: Number((mints / players).toFixed(1)),
    craftedSuits: suits.reduce((s, n) => s + Number(n ?? 0), 0),
    suitsPerPlayer: Number((suits.reduce((s, n) => s + Number(n ?? 0), 0) / players).toFixed(2)),
  };
}

/** What a hero pays to buy one and gets for selling one, at a fee, on the pools as they stand. */
function quotes(pools: Pool[], feeBps: number) {
  return pools.map((p) => ({ item: p.item, price: spotMilli(p) / 1000, buyOne: buyQuote(p, 1, feeBps)?.total ?? null, sellOne: sellQuote(p, 1, feeBps)?.net ?? null }));
}

/* ------------------------------------------------------------------ 3. the search */

function search() {
  const out: { setting: Setting; season: Measure; sixty: Measure; churn: Measure; ok: boolean; score: number }[] = [];
  const seeds = SEEDS.slice(0, 4);
  for (const craftBits of [0, 100, 150, 200, 250, 300, 400])
    for (const feeBps of [200, 500, 1000])
      for (const priceScale of [0.5, 1, 2])
        for (const depthScale of [1, 2]) {
          const setting: Setting = { id: `craft ${craftBits} · fee ${feeBps / 100}% · price ×${priceScale} · depth ×${depthScale}`, label: "", craftBits, feeBps, priceScale, depthScale, taper: null };
          const season = measured(setting, SEASON, seeds);
          const sixty = measured(setting, SIXTY, seeds);
          const churn = measured(setting, { days: 90, bots: 60, lifespan: 8 }, seeds);
          // Ranked by the burn share across a season, 60 days and a city with turnover.
          out.push({ setting, season, sixty, churn, ok: verdict(season, sixty).ok, score: (season.burnShare + sixty.burnShare + churn.burnShare) / 3 });
        }
  return out.sort((a, b) => Number(b.ok) - Number(a.ok) || b.score - a.score);
}

/* ------------------------------------------------------------------ 4. draining Gwei */

/** The lab's "Drain Gwei" run on mainnet's rules: how often she ends a day sold out or broke, per seed. */
function drain() {
  return SEEDS.map((seed) => {
    const m = measureEconomy("drain", play(economyConfig(MAINNET, { ...DRAIN, seed })));
    return { seed, soldOut: m.soldOut, broke: m.broke, till: m.till };
  });
}

/* ------------------------------------------------------------------ main */

async function main() {
  const json: Record<string, unknown> = { seeds: SEEDS, band: BAND };

  const audited = audit();
  console.log(`Accounting: ${audited.runs} runs, ${audited.days} days, every day balances (seeded till + minted − burned = supply).`);
  json.audit = audited;

  // The lab as it shipped: crafters re-craft forever and crafting burns 25 Bits.
  const shipped = new Economy({ days: 21, bots: 60, seed: 2026, params: { craftBits: 25 }, npc: false });
  while (!shipped.done) shipped.step();
  const lab = shipped.history.at(-1)!;
  console.log(`The lab's old default (seed 2026, crafting burns 25, suits re-crafted): ${int(lab.minted)} earned, ${int(lab.burned)} burned, ${lab.crafted} suits.`);
  json.labBefore = { minted: lab.minted, burned: lab.burned, crafted: lab.crafted };

  if (!flag("offline")) {
    try {
      const chain = await mainnet();
      json.mainnet = chain;
      const scoreMean = 2_500 + 4_500;
      table(
        `Mainnet now (${CONTRACT}, read-only) against the model`,
        ["", "mainnet", "model"],
        [
          ["Bits supply", int(chain.supply), "-"],
          ["in Gwei's till", int(chain.till), int(chain.seededTill) + " seeded"],
          ["held by players", int(chain.held), "-"],
          ["players with a verified night", chain.players, "60 heroes"],
          ["reward mints sent", chain.rewardMints, "1 per hero per day"],
          ["nights per player so far", chain.nightsPerPlayer, "1 per day, for the whole run"],
          ["Bits minted − burned, per reward mint", chain.netMintedPerRewardMint, `${nightBits({ score: scoreMean, levelledUp: false }) + 3} minted (score 2,500–11,500, 12% level-ups)`],
          ["Bits held per player", chain.heldPerPlayer, "-"],
          ["suits crafted (non-starter)", chain.craftedSuits, "-"],
          ["suits per player", chain.suitsPerPlayer, "1.5 (3 in 8 heroes craft, 4 suits each)"],
          ["craft_bits / fee_bps", `${String(chain.params.craft_bits)} / ${String(chain.params.fee_bps)}`, `${MAINNET.craftBits} / ${MAINNET.feeBps}`],
        ],
      );
      const before = quotes(chain.pools, MAINNET.feeBps);
      const after = quotes(chain.pools, RECOMMENDED.feeBps);
      table(
        `Today's quotes on mainnet's pools: fee ${MAINNET.feeBps / 100}% → ${RECOMMENDED.feeBps / 100}% (the curves don't move, so the price doesn't)`,
        ["item", "price", "buy 1 now", "buy 1 after", "sell 1 now", "sell 1 after"],
        before.map((q, i) => [(ITEMS[q.item as ItemId] as { name: string }).name, q.price.toFixed(2), q.buyOne ?? "-", after[i]!.buyOne ?? "-", q.sellOne ?? "-", after[i]!.sellOne ?? "-"]),
      );
      json.quotes = { before, after };
      const sinkNow = chain.players * 4 * RECOMMENDED.craftBits;
      console.log(`\nIf every one of the ${chain.players} players crafted all four suits at ${RECOMMENDED.craftBits} Bits: ${int(sinkNow)} Bits burned, against ${int(chain.held)} held.`);
    } catch (error) {
      console.log(`\nMainnet read failed (${error instanceof Error ? error.message : String(error)}); run again or pass --offline.`);
    }
  }

  const settings = [MAINNET, TAPER_ONLY, RECOMMENDED, RECOMMENDED_WITH_TAPER, ...ALTERNATIVES];
  const tables: Record<string, Record<string, Measure>> = {};
  const runs: [string, string, { days: number; bots: number; lifespan?: number }][] = [
    ["season", "21 days, 60 heroes (a season)", SEASON],
    ["sixty", "60 days, 60 heroes", SIXTY],
    ["halfYear", "180 days, 60 heroes, nobody quits", { days: 180, bots: 60 }],
    ["turnover8", "180 days, 60 heroes, each quits after 8 nights and a new one joins (mainnet's players average about 7)", { days: 180, bots: 60, lifespan: 8 }],
    ["turnover20", "180 days, 60 heroes, each quits after 20 nights", { days: 180, bots: 60, lifespan: 20 }],
    ["small", "21 days, 20 heroes", { days: 21, bots: 20 }],
    ["crowd", "21 days, 200 heroes", { days: 21, bots: 200 }],
  ];
  for (const [id, title, run] of runs) {
    const rows = settings.map((s) => [s, measured(s, run, SEEDS)] as const);
    tables[id] = Object.fromEntries(rows.map(([s, m]) => [s.id, m]));
    table(`${title}; mean of ${SEEDS.length} seeds`, HEAD, rows.map(([s, m]) => line(s.label, m)));
  }
  json.tables = tables;

  const causes = tables.season!;
  table(
    "Where a season's Bits come from and go (21 days, 60 heroes)",
    ["setting", "from score", "showing up", "level-ups", "not paid (taper)", "gas fee burn", "craft burn"],
    settings.map((s) => {
      const m = causes[s.id]!;
      return [s.label, int(m.minted.score), int(m.minted.showingUp), int(m.minted.levelUp), int(m.minted.withheld), int(m.burned.fee), int(m.burned.craft)];
    }),
  );

  console.log(`\nThe band: burn ${BAND.burnShare[0] * 100}–${BAND.burnShare[1] * 100}% of a season's Bits, first suit by night ${BAND.firstSuitNight}, Gwei sold out or broke on at most ${BAND.vendorDown * 100}% of item-days over 60 days.`);
  const verdicts = Object.fromEntries(settings.map((s) => [s.id, verdict(tables.season![s.id]!, tables.sixty![s.id]!)]));
  for (const s of settings) {
    const v = verdicts[s.id]!;
    console.log(`  ${v.ok ? "PASS" : "FAIL"}  ${s.label.padEnd(28)} burn share ${v.burnShare ? "ok" : "no"} · first suit ${v.firstSuit ? "ok" : "no"} · vendor ${v.vendor ? "ok" : "no"}`);
  }
  json.verdicts = verdicts;

  // One seed, so a single run can be checked by hand in the lab (seed 2026).
  const one = Object.fromEntries([MAINNET, RECOMMENDED].map((s) => [s.id, measure(s, { ...SEASON, seed: 2026 })]));
  console.log(`\nThe lab's seed 2026: mainnet today ${int(one.mainnet!.minted.total)} earned / ${int(one.mainnet!.burned.total)} burned; recommended ${int(one.recommended!.minted.total)} earned / ${int(one.recommended!.burned.total)} burned.`);
  json.lab = one;

  if (flag("search")) {
    const found = search();
    table(
      `Search: ${found.length} settings, 4 seeds each; passing ones first, then by mean burn share`,
      ["setting", "band", "season burn", "60-day burn", "turnover burn", "1st suit", "60-day sold out + broke"],
      found.slice(0, 16).map((f) => [f.setting.id, f.ok ? "PASS" : "fail", pct(f.season.burnShare), pct(f.sixty.burnShare), pct(f.churn.burnShare), f.season.firstSuitNight ?? "-", pct(f.sixty.soldOut + f.sixty.broke)]),
    );
    json.search = found.map((f) => ({ ...f.setting, ok: f.ok, score: Number(f.score.toFixed(3)), season: f.season.burnShare, sixty: f.sixty.burnShare, turnover: f.churn.burnShare, firstSuitNight: f.season.firstSuitNight, vendorDown: Number((f.sixty.soldOut + f.sixty.broke).toFixed(3)) }));
  }

  if (flag("drain")) {
    const found = drain();
    table(`Drain Gwei: ${DRAIN.days} days, ${DRAIN.bots} heroes, ${DRAIN.mix.join(" + ")}, on mainnet's rules`, ["seed", "item-days sold out", "item-days broke", "till at the end"], found.map((f) => [f.seed, pct(f.soldOut), pct(f.broke), int(f.till)]));
    json.drain = found;
  }

  if (flag("npc")) {
    // Every table above is measured without Sandwich Man (he is off on mainnet until funded). These rows turn him on.
    const rows: (string | number)[][] = [];
    const out: Record<string, Record<string, Measure>> = {};
    for (const [id, title, run] of runs.slice(0, 2)) {
      out[id] = {};
      for (const s of [MAINNET, RECOMMENDED, RECOMMENDED_WITH_TAPER]) {
        const without = tables[id]![s.id]!;
        const withNpc = measured(s, { ...run, npc: true }, SEEDS);
        out[id]![s.id] = withNpc;
        rows.push(line(`${title.split(" (")[0]} · ${s.label}`, without), line(`${title.split(" (")[0]} · ${s.label} + Sandwich Man`, withNpc));
      }
    }
    table(`With Sandwich Man trading (seeded 300 Bits once, not counted in "earned"); mean of ${SEEDS.length} seeds`, HEAD, rows);
    const v = verdict(out.season!.recommended!, out.sixty!.recommended!);
    console.log(`  ${v.ok ? "PASS" : "FAIL"}  Recommended + Sandwich Man   burn share ${v.burnShare ? "ok" : "no"} · first suit ${v.firstSuit ? "ok" : "no"} · vendor ${v.vendor ? "ok" : "no"}`);
    // What /lab/economy shows for its default seed: the lab always runs with him.
    const lab = Object.fromEntries([MAINNET, TAPER_ONLY, RECOMMENDED, RECOMMENDED_WITH_TAPER].map((s) => [s.id, measure(s, { ...SEASON, seed: 2026, npc: true })]));
    // The lab's own counters: "earned" there is everything minted, his 300-Bit seed included.
    for (const s of [MAINNET, TAPER_ONLY, RECOMMENDED, RECOMMENDED_WITH_TAPER]) {
      const last = play(economyConfig(s, { ...SEASON, seed: 2026, npc: true })).history.at(-1)!;
      console.log(`  The lab's seed 2026 with him, ${s.label}: ${int(last.minted)} earned / ${int(last.burned)} burned (${pct(last.burned / last.minted)}), ${last.crafted} suits.`);
    }
    const labDrain = measureEconomy("drain", play(economyConfig(MAINNET, { ...DRAIN, seed: 2026, npc: true })));
    // The model runs the pools the market opened with (defaultPoolConfigs), not every item in the game.
    const cells = DRAIN.days * defaultPoolConfigs().length;
    console.log(`  The lab's Drain Gwei, seed 2026 with him: ${Math.round(labDrain.soldOut * cells)} item-days sold out and ${Math.round(labDrain.broke * cells)} unable to buy, of ${cells}.`);
    json.npc = { tables: out, verdict: v, lab, labDrain: { soldOut: labDrain.soldOut, broke: labDrain.broke, itemDays: cells } };
  }

  // The owner's `set_market_params` arguments for the recommendation.
  const args = setMarketParamsArgs(paramsFor(RECOMMENDED), poolConfigsFor(RECOMMENDED));
  const unchanged = JSON.stringify(poolConfigsFor(RECOMMENDED)) === JSON.stringify(defaultPoolConfigs());
  console.log(`\nset_market_params arguments for "${RECOMMENDED.label}" (pools ${unchanged ? "identical to" : "differ from"} the seeded curves; taper ${RECOMMENDED_TAPER.fullBelow}–${RECOMMENDED_TAPER.floorAt} is a server rule, not in here):`);
  console.log(JSON.stringify(args));
  json.setMarketParamsArgs = args;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`\nWrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
