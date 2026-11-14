#!/usr/bin/env node
/**
 * The game's mainnet usage day by day, so the totals `pnpm stats` prints have a shape: who
 * came back, on which days, doing what. Read-only, no keys, no dependencies (Node 18+).
 *
 *   node scripts/traction.mjs                  # tables (Markdown) for the live game and mainnet
 *   node scripts/traction.mjs --json           # one JSON object instead
 *   node scripts/traction.mjs --cache <dir>    # keep NearBlocks' raw pages in <dir> and reuse them
 *                                              # (for development: a cached page can be stale)
 *
 * Every receipt `game.wgpnear.near` received is read from NearBlocks, page by page, the same
 * way `pnpm stats` reads them. A "player call" is one of the player methods (`register_hero`,
 * `craft_suit`, `equip_suit` and the market's five) sent by an account that is not the team's:
 * the contract, the operator, the relayer, the author's own accounts and Sandwich Man, the NPC
 * trader, are all left out. (`pnpm stats` counts the author's account as a player and names
 * it; this report drops it, so the numbers here are other people's.) Calls are bucketed by UTC
 * day from the first player call. Then:
 *
 *   per day       active accounts, new accounts (their first call), calls by method
 *   retention     accounts active on 2 or more and 3 or more distinct days; median active days
 *   concentration the share of player calls from the busiest 1 and 3 accounts
 *   the site      a dated snapshot of GET <base>/api/stats (database figures, not on chain)
 *
 * Two windows that shape the numbers are marked on every day they touch: the relayer outage
 * (relayed player actions were refused) and Season 1's daily airdrops (sent by hand through
 * Uprail, outside the game). The bucketing, retention and concentration functions are pure and
 * tested on fixtures in apps/wgp/src/evidence/traction.test.ts.
 *
 * Exit code: 1 when NearBlocks can't be read to the end, 2 for bad arguments. A site outage is
 * a note: the chain tables still print.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchJson } from "./evidence.mjs";
import { AUTHOR_ACCOUNTS, DEFAULT_BASE, DEFAULT_CONTRACT, MARKET_METHODS, NEARBLOCKS_API, NPC_ACCOUNTS, OWN_ACCOUNTS, PER_PAGE, PLAYER_METHODS } from "./stats.mjs";

/** The author's accounts. `sele71.near` has never called a game method; it is listed so it never could count. */
export const EXCLUDED_AUTHOR_ACCOUNTS = [...AUTHOR_ACCOUNTS, "sele71.near"];
/** The team's accounts that send calls to the contract: the setup payer (`wgpnear.near`, which also creates players' sub-accounts), the operator and relayer. */
export const TEAM_ACCOUNTS = ["wgpnear.near", ...OWN_ACCOUNTS];

/** Windows that change what a day's numbers mean. Times are UTC. */
export const CONTEXT_WINDOWS = [
  {
    id: "airdrops",
    from: "2026-11-05T00:00:00Z",
    to: "2026-11-15T00:00:00Z",
    label: "Season 1 (Nov 5–14): players were offered daily airdrops, sent by hand through Uprail, outside the game",
  },
  {
    id: "relayer-outage",
    from: "2026-11-13T07:00:00Z",
    to: "2026-11-14T20:21:00Z",
    label: "relayer outage: the relayer sat under its 1 NEAR cut-off, so relayed player actions were refused",
  },
];

const PAGE_GAP_MS = 1200;
const MAX_PAGES = 1000;
/** Extra waits (seconds) for a page NearBlocks keeps rate limiting, after fetchJson's own retries. */
const PATIENCE_S = [20, 45, 90];

/* ------------------------------------------------------------------ pure */

/** A NearBlocks timestamp (nanoseconds, string or number) as a UTC day, `YYYY-MM-DD`. */
export function utcDay(nanos) {
  const ms = Number(BigInt(String(nanos)) / 1_000_000n);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every day from `first` to `last` inclusive, as `YYYY-MM-DD`. */
export function daysBetween(first, last) {
  const out = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * The player calls in NearBlocks rows: one `{ account, method, day, ok }` per player-method
 * call sent by an account that is not the team's, the contract, the NPC or the author's.
 * Rows are de-duplicated by receipt (a page can shift while new calls land). `excluded`
 * counts what was dropped and why, so the report can say it.
 */
export function playerCalls(rows, contract = DEFAULT_CONTRACT) {
  const seen = new Set();
  const calls = [];
  const excluded = { author: 0, npc: 0, team: 0 };
  for (const row of rows) {
    const id = row.receipt_id ?? row.id ?? `${row.transaction_hash}:${row.predecessor_account_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const sender = row.predecessor_account_id;
    const played = (row.actions ?? []).filter((a) => PLAYER_METHODS.includes(a.method));
    if (!played.length || !sender) continue;
    if (EXCLUDED_AUTHOR_ACCOUNTS.includes(sender)) excluded.author += played.length;
    else if (NPC_ACCOUNTS.includes(sender)) excluded.npc += played.length;
    else if (sender === contract || TEAM_ACCOUNTS.includes(sender)) excluded.team += played.length;
    else {
      const day = utcDay(row.block_timestamp ?? row.receipt_block?.block_timestamp);
      const ok = row.outcomes?.status !== false;
      for (const a of played) calls.push({ account: sender, method: a.method, day, ok });
    }
  }
  return { calls, excluded };
}

/**
 * The reward mints in NearBlocks rows: one `{ account, day }` per entry of a `mint_rewards`
 * batch (the operator mints a verified night's loot, Bits and badges to the player's account
 * shortly after the night is verified). The author's accounts and the NPC's seed are left out.
 * These show play that needed no relayed call, so they kept landing through the relayer outage.
 */
export function rewardMints(rows) {
  const seen = new Set();
  const mints = [];
  for (const row of rows) {
    const id = row.receipt_id ?? row.id ?? `${row.transaction_hash}:${row.predecessor_account_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (row.outcomes?.status === false || !OWN_ACCOUNTS.includes(row.predecessor_account_id)) continue;
    for (const a of row.actions ?? []) {
      if (a.method !== "mint_rewards") continue;
      let batch = [];
      try {
        batch = JSON.parse(a.args ?? "{}").batch ?? [];
      } catch {
        continue;
      }
      const day = utcDay(row.block_timestamp ?? row.receipt_block?.block_timestamp);
      for (const entry of batch) {
        const account = entry?.account_id;
        if (account && !EXCLUDED_AUTHOR_ACCOUNTS.includes(account) && !NPC_ACCOUNTS.includes(account)) mints.push({ account, day });
      }
    }
  }
  return mints;
}

/** The windows (ids) that overlap a UTC day. */
export function windowsOn(day, windows = CONTEXT_WINDOWS) {
  const start = Date.parse(`${day}T00:00:00Z`);
  const end = start + 86_400_000;
  return windows.filter((w) => Date.parse(w.from) < end && Date.parse(w.to) > start).map((w) => w.id);
}

/**
 * Calls bucketed by UTC day, from the first call's day to `until` (default: the last call's
 * day), with the empty days in between kept. Each day: active accounts, accounts whose first
 * call it was, calls in all and by method, and the context windows it touches.
 */
export function bucketByDay(calls, { until, windows = CONTEXT_WINDOWS } = {}) {
  if (!calls.length) return [];
  const sortedDays = [...new Set(calls.map((c) => c.day))].sort();
  const last = until && until > sortedDays.at(-1) ? until : sortedDays.at(-1);
  const firstSeen = new Map();
  for (const c of [...calls].sort((a, b) => a.day.localeCompare(b.day))) if (!firstSeen.has(c.account)) firstSeen.set(c.account, c.day);
  return daysBetween(sortedDays[0], last).map((day) => {
    const today = calls.filter((c) => c.day === day);
    const accounts = new Set(today.map((c) => c.account));
    const byMethod = {};
    for (const c of today) byMethod[c.method] = (byMethod[c.method] ?? 0) + 1;
    return {
      day,
      activeAccounts: accounts.size,
      newAccounts: [...accounts].filter((a) => firstSeen.get(a) === day).length,
      calls: today.length,
      marketCalls: today.filter((c) => MARKET_METHODS.includes(c.method)).length,
      byMethod,
      windows: windowsOn(day, windows),
    };
  });
}

const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** How many distinct UTC days each account was active on, and what that adds up to. */
export function retention(calls) {
  const days = new Map();
  for (const c of calls) (days.get(c.account) ?? days.set(c.account, new Set()).get(c.account)).add(c.day);
  const counts = [...days.values()].map((s) => s.size);
  const histogram = {};
  for (const n of counts) histogram[n] = (histogram[n] ?? 0) + 1;
  return {
    accounts: counts.length,
    activeOn2PlusDays: counts.filter((n) => n >= 2).length,
    activeOn3PlusDays: counts.filter((n) => n >= 3).length,
    medianActiveDays: median(counts),
    /** distinct active days -> accounts */
    histogram,
  };
}

/** The share of all calls made by the busiest 1 and 3 accounts. Shares are 0..1. */
export function concentration(calls) {
  const per = new Map();
  for (const c of calls) per.set(c.account, (per.get(c.account) ?? 0) + 1);
  const ranked = [...per.values()].sort((a, b) => b - a);
  const total = calls.length;
  const top1Calls = ranked[0] ?? 0;
  const top3Calls = ranked.slice(0, 3).reduce((n, v) => n + v, 0);
  return { calls: total, accounts: ranked.length, top1Calls, top3Calls, top1Share: total ? top1Calls / total : 0, top3Share: total ? top3Calls / total : 0 };
}

/** The whole report from NearBlocks rows. Pure. */
export function traction(rows, { contract = DEFAULT_CONTRACT, until } = {}) {
  const { calls, excluded } = playerCalls(rows, contract);
  const firstDay = calls.length ? [...calls].map((c) => c.day).sort()[0] : null;
  const allMints = rewardMints(rows);
  const mints = firstDay ? allMints.filter((m) => m.day >= firstDay) : [];
  const byMethod = {};
  for (const c of calls) byMethod[c.method] = (byMethod[c.method] ?? 0) + 1;
  return {
    contract,
    firstDay,
    calls: calls.length,
    failedCalls: calls.filter((c) => !c.ok).length,
    byMethod,
    excluded,
    days: bucketByDay(calls, { until }).map((d) => {
      const today = mints.filter((m) => m.day === d.day);
      return { ...d, rewardMints: today.length, rewardedAccounts: new Set(today.map((m) => m.account)).size };
    }),
    retention: retention(calls),
    rewards: { mints: mints.length, before: allMints.length - mints.length, retention: retention(mints) },
    concentration: concentration(calls),
    windows: CONTEXT_WINDOWS,
  };
}

/** The parts of GET /api/stats this report quotes. */
export function siteSnapshot(s) {
  return {
    at: s.at,
    signedUp: s.players?.total,
    startedAMatch: s.players?.played,
    withVerifiedRun: s.players?.withVerifiedRun,
    verifiedRuns: s.runs?.verified,
    verifiedByMode: Object.fromEntries(Object.entries(s.runs?.byMode ?? {}).map(([mode, c]) => [mode, c.verified])),
    cityOutings: s.city?.outings,
    cityPlayers: s.city?.players,
    referrals: { invited: s.referrals?.invited, qualified: s.referrals?.qualified },
  };
}

/* ------------------------------------------------------------------ io */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readPage(url, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchJson(url, { headers: { accept: "application/json", "user-agent": "wgp-traction-script" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      const body = await res.json();
      if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(body));
      return body;
    } catch (error) {
      const wait = PATIENCE_S[attempt];
      if (!error.rateLimited || wait === undefined) throw error;
      process.stderr.write(`  NearBlocks is rate limiting; waiting ${wait} s…\n`);
      await sleep(wait * 1000);
    }
  }
}

/** Every receipt the contract received, newest first, page by page until an empty one. */
async function readRows(contract, cacheDir) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const cacheFile = cacheDir ? path.join(cacheDir, `${contract}-txns-${PER_PAGE}-${page}.json`) : null;
    const cached = cacheFile && fs.existsSync(cacheFile);
    if (page > 1 && !cached) await sleep(PAGE_GAP_MS);
    const body = await readPage(`${NEARBLOCKS_API}/account/${encodeURIComponent(contract)}/txns?per_page=${PER_PAGE}&page=${page}`, cacheFile);
    const txns = Array.isArray(body?.txns) ? body.txns : [];
    if (!txns.length) return { rows, pages: page - 1 };
    rows.push(...txns);
  }
  throw new Error(`stopped after ${MAX_PAGES} pages`);
}

/* ------------------------------------------------------------------ output */

const pct = (x) => `${Math.round(x * 100)}%`;
const SHORT = { register_hero: "register", craft_suit: "craft", equip_suit: "equip", market_buy: "m_buy", market_sell: "m_sell", list_item: "list", buy_listing: "buy_list", cancel_listing: "cancel" };
const MARK = { "relayer-outage": "outage", airdrops: "airdrops" };

function markdown(r, site, siteNote, generatedAt) {
  const out = [];
  out.push(`Traction report for \`${r.contract}\`, generated ${generatedAt} (UTC). Player calls only: the team's accounts, the author's (${EXCLUDED_AUTHOR_ACCOUNTS.join(", ")}) and Sandwich Man (${NPC_ACCOUNTS.join(", ")}) are left out.\n`);
  const methods = PLAYER_METHODS.filter((m) => r.byMethod[m]);
  out.push(`### Per UTC day\n`);
  out.push(`| Day | Active accounts | New accounts | Calls | ${methods.map((m) => `\`${SHORT[m] ?? m}\``).join(" | ")} | Reward mints (accounts) | Context |`);
  out.push(`|---|--:|--:|--:|${methods.map(() => "--:").join("|")}|--:|---|`);
  for (const d of r.days) out.push(`| ${d.day} | ${d.activeAccounts} | ${d.newAccounts} | ${d.calls} | ${methods.map((m) => d.byMethod[m] ?? 0).join(" | ")} | ${d.rewardMints} (${d.rewardedAccounts}) | ${d.windows.map((w) => MARK[w] ?? w).join(", ")} |`);
  out.push(`| **All days** | **${r.retention.accounts}** distinct | | **${r.calls}** | ${methods.map((m) => `**${r.byMethod[m]}**`).join(" | ")} | **${r.rewards.mints}** (**${r.rewards.retention.accounts}**) | |`);
  out.push(`\nColumns: ${methods.map((m) => `\`${SHORT[m] ?? m}\` = \`${m}\``).join(", ")}. ${r.failedCalls} of the ${r.calls} calls failed on chain and are still counted (the account still sent them). "Reward mints (accounts)" are the \`mint_rewards\` entries the operator sent that day to players' accounts (not the author's or the NPC's), and how many accounts they went to: verified play, which needs no relayed call.${r.rewards.before ? ` ${r.rewards.before} mint${r.rewards.before === 1 ? "" : "s"} before the first player call ${r.rewards.before === 1 ? "is" : "are"} not in the table.` : ""}\n`);
  out.push(`### Retention and concentration\n`);
  out.push(`| | |\n|---|---|`);
  out.push(`| Player accounts (author's and NPC excluded) | ${r.retention.accounts} |`);
  out.push(`| Active on 2 or more distinct UTC days | ${r.retention.activeOn2PlusDays} |`);
  out.push(`| Active on 3 or more distinct UTC days | ${r.retention.activeOn3PlusDays} |`);
  out.push(`| Median active days per account | ${r.retention.medianActiveDays} |`);
  out.push(`| Accounts by active days | ${Object.entries(r.retention.histogram).map(([d, n]) => `${d} day${d === "1" ? "" : "s"}: ${n}`).join(" · ")} |`);
  out.push(`| Accounts the game rewarded (verified play), and on 2+ / 3+ distinct days | ${r.rewards.retention.accounts}, ${r.rewards.retention.activeOn2PlusDays} / ${r.rewards.retention.activeOn3PlusDays} (median ${r.rewards.retention.medianActiveDays} day${r.rewards.retention.medianActiveDays === 1 ? "" : "s"}) |`);
  out.push(`| Share of player calls from the busiest account | ${pct(r.concentration.top1Share)} (${r.concentration.top1Calls} of ${r.concentration.calls}) |`);
  out.push(`| Share of player calls from the busiest 3 accounts | ${pct(r.concentration.top3Share)} (${r.concentration.top3Calls} of ${r.concentration.calls}) |`);
  out.push(`| Left out: the author's calls / Sandwich Man's / the team's | ${r.excluded.author} / ${r.excluded.npc} / ${r.excluded.team} |`);
  out.push(`\n### Context windows (UTC)\n`);
  for (const w of r.windows) out.push(`- **${MARK[w.id] ?? w.id}**, ${w.from.replace("T", " ").replace(":00Z", "")} → ${w.to.replace("T", " ").replace(":00Z", "")}: ${w.label}.`);
  out.push(`\n### The game's own database (\`/api/stats\`, not on chain)\n`);
  if (!site) out.push(`Not read: ${siteNote}.`);
  else {
    out.push(`| | |\n|---|---|`);
    out.push(`| As of | ${site.at} |`);
    out.push(`| Signed up / started a match / have a verified match | ${site.signedUp} / ${site.startedAMatch} / ${site.withVerifiedRun} |`);
    out.push(`| Verified runs | ${site.verifiedRuns} |`);
    out.push(`| Verified runs by mode | ${Object.entries(site.verifiedByMode).map(([m, n]) => `${m} ${n}`).join(" · ")} |`);
    out.push(`| City outings (players who went out) | ${site.cityOutings} (${site.cityPlayers}) |`);
    out.push(`| Referrals: invited / count | ${site.referrals.invited} / ${site.referrals.qualified} |`);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ main */

const HELP = `Usage: node scripts/traction.mjs [--base <url>] [--contract <account>] [--cache <dir>] [--json]`;

function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, contract: DEFAULT_CONTRACT, cache: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--base") out.base = value().replace(/\/+$/, "");
    else if (arg === "--contract") out.contract = value();
    else if (arg === "--cache") out.cache = value();
    else if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.cache) fs.mkdirSync(args.cache, { recursive: true });
  const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  let site = null;
  let siteNote = null;
  try {
    const res = await fetchJson(`${args.base}/api/stats`, { headers: { accept: "application/json", "user-agent": "wgp-traction-script" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    site = siteSnapshot(await res.json());
  } catch (error) {
    siteNote = `${args.base}/api/stats could not be read (${error.message})`;
  }

  let rows;
  let pages;
  try {
    ({ rows, pages } = await readRows(args.contract, args.cache));
  } catch (error) {
    console.error(`NearBlocks could not be read to the end (${error.message}). Try again in a minute.`);
    return 1;
  }
  const report = traction(rows, { contract: args.contract, until: generatedAt.slice(0, 10) });
  if (args.json) console.log(JSON.stringify({ generatedAt, pages, receipts: rows.length, ...report, site, notes: siteNote ? [siteNote] : [] }, null, 2));
  else console.log(markdown(report, site, siteNote, generatedAt));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
