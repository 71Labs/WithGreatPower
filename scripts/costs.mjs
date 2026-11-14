#!/usr/bin/env node
/**
 * What With Great Power costs to run, measured from NEAR mainnet history. Read-only: it never
 * signs or sends anything.
 *
 *   node scripts/costs.mjs            # a table, with the time it was measured (UTC)
 *   node scripts/costs.mjs --json     # one JSON object
 *
 * Measured: every transaction the relayer, the operator and the factory signed, from NearBlocks
 * (gas burnt and attached deposits, as NearBlocks reports them), the four accounts' balances and
 * storage from the NEAR RPC, and the NEAR price from NEAR Intents' 1Click token list.
 * Derived: per-action and per-player averages, daily spend, runway and what a Gas tank refill
 * buys. The math is the pure functions exported below, tested on fixtures in
 * apps/wgp/src/evidence/costs.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchJson } from "./evidence.mjs";

const NEARBLOCKS_API = "https://api.nearblocks.io/v1";
const RPC_URLS = ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"];
const TOKENS_API = "https://1click.chaindefuser.com/v0/tokens";
const NEAR_ASSET = "nep141:wrap.near";

export const ACCOUNTS = {
  relayer: "relayer.wgpnear.near",
  operator: "operator.wgpnear.near",
  factory: "wgpnear.near",
  contract: "game.wgpnear.near",
};
/** The team's own sub-accounts: created by the factory too, but not players. */
const TEAM_ACCOUNTS = new Set([...Object.values(ACCOUNTS), "sandwich.wgpnear.near"]);

const YOCTO = 1e24;
/** NEAR's storage price: 10^19 yoctoNEAR a byte, 1 NEAR per 100 KB. */
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 7;
/** The relay answers 503 under this available balance (RELAYER_MIN_BALANCE_NEAR's default). */
export const RELAYER_CUTOFF_NEAR = 1;
/** Gas tank refills to price, in USD. */
export const REFILLS_USD = [1, 2, 5];
/** 1Click's fee on a Gas tank refill without a JWT (apps/wgp/src/server/intents/one-click.ts). */
export const ONE_CLICK_FEE = 0.002;

const PER_PAGE = 25;
const PAGE_GAP_MS = 1000;
const MAX_PAGES = 400;
/** NearBlocks' free tier allows a few calls a minute: wait longer than the RPC's retries do. */
const NEARBLOCKS_WAITS_S = [15, 30, 60];

const HELP = `Usage: node scripts/costs.mjs [--json] [--cache <dir>]

  --json         print one JSON object
  --cache <dir>  keep NearBlocks' raw pages in <dir> and reuse them (for development)
`;

// ---------- pure math (tested in apps/wgp/src/evidence/costs.test.ts) ----------

export const toNear = (yocto) => Number(yocto ?? 0) / YOCTO;

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * One entry per transaction `signer` signed, from NearBlocks' rows for that account (which also
 * list receipts it received, such as gas refunds). Its first receipt is the one whose predecessor
 * is the signer. `pick` keeps only the transactions that matter. The cost is the transaction's
 * whole fee (every receipt's burnt gas, NearBlocks' `outcomes_agg.transaction_fee`) plus any
 * NEAR it attached.
 */
export function signedTxns(rows, signer, pick = () => true) {
  const seen = new Map();
  for (const r of rows) {
    if (r.predecessor_account_id !== signer || seen.has(r.transaction_hash) || !pick(r)) continue;
    const feeNear = toNear(r.outcomes_agg?.transaction_fee);
    const depositNear = toNear(r.actions_agg?.deposit);
    seen.set(r.transaction_hash, {
      hash: r.transaction_hash,
      at: Number(BigInt(r.block_timestamp) / 1_000_000n),
      receiver: r.receiver_account_id,
      method: (r.actions ?? []).find((a) => a.action === "FUNCTION_CALL")?.method ?? null,
      args: (r.actions ?? []).find((a) => a.action === "FUNCTION_CALL")?.args ?? null,
      ok: r.outcomes?.status !== false,
      feeNear,
      depositNear,
      costNear: feeNear + depositNear,
    });
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

const hasAction = (r, kind) => (r.actions ?? []).some((a) => a.action === kind);
/** A player action the relayer paid for: a NEP-366 meta-transaction. */
export const isRelayed = (r) => hasAction(r, "DELEGATE_ACTION");
export const isMint = (r) => r.receiver_account_id === ACCOUNTS.contract && (r.actions ?? []).some((a) => a.method === "mint_rewards");
/** A new `<name>.wgpnear.near` player account (not one of the team's own). */
export const isPlayerAccount = (r) => hasAction(r, "CREATE_ACCOUNT") && r.receiver_account_id.endsWith(`.${ACCOUNTS.factory}`) && !TEAM_ACCOUNTS.has(r.receiver_account_id);

/** How many verified runs a `mint_rewards` call carried (its `batch`), or null when the args can't be read. */
export function batchSize(args) {
  if (args == null) return null;
  try {
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    return Array.isArray(parsed?.batch) ? parsed.batch.length : null;
  } catch {
    return null;
  }
}

/** Spend in rolling 24-hour buckets ending at `now`, oldest first; the average is over all `days`, idle ones included. */
export function dailySpend(txns, now, days = WINDOW_DAYS) {
  const start = now - days * DAY_MS;
  const buckets = Array.from({ length: days }, (_, i) => ({ from: new Date(start + i * DAY_MS).toISOString(), near: 0, count: 0 }));
  for (const t of txns) {
    const i = Math.floor((t.at - start) / DAY_MS);
    if (i < 0 || i >= days) continue;
    buckets[i].near += t.costNear;
    buckets[i].count += 1;
  }
  const totalNear = buckets.reduce((a, b) => a + b.near, 0);
  return { days, buckets, totalNear, count: buckets.reduce((a, b) => a + b.count, 0), perDayNear: totalNear / days, busiestDayNear: Math.max(0, ...buckets.map((b) => b.near)) };
}

/** Days until `spendableNear` runs out at `perDayNear`; null when nothing is being spent. */
export function runwayDays(spendableNear, perDayNear) {
  if (!(perDayNear > 0)) return null;
  return Math.max(0, spendableNear) / perDayNear;
}

/** What NEAR's RPC (and near-api-js) calls available: the balance less what storage holds. */
export function availableNear(view) {
  const amount = BigInt(view.amount);
  const locked = BigInt(view.locked ?? "0");
  const storage = BigInt(view.storage_usage) * STORAGE_YOCTO_PER_BYTE;
  return toNear(amount + locked - (storage > locked ? storage : locked));
}

/** Bytes an account stores, the NEAR held against them, and how many more bytes its free balance covers. */
export function storageOf(view) {
  const bytes = Number(view.storage_usage);
  const free = availableNear(view);
  return { bytes, lockedNear: toNear(BigInt(view.storage_usage) * STORAGE_YOCTO_PER_BYTE), freeNear: free, headroomBytes: Math.max(0, Math.floor((free * YOCTO) / Number(STORAGE_YOCTO_PER_BYTE))) };
}

/** What a Gas tank refill of `usd` buys in relayed actions, after 1Click's fee. */
export function refillBuys(usd, nearUsd, nearPerAction, feeRate = ONE_CLICK_FEE) {
  if (!(nearUsd > 0) || !(nearPerAction > 0)) return { usd, near: null, actions: null };
  const near = (usd * (1 - feeRate)) / nearUsd;
  return { usd, near, actions: Math.floor(near / nearPerAction) };
}

/** One player's share: their account, their relayed actions and their minted runs. */
export function costPerPlayer({ accountNear, actionsPerPlayer, nearPerAction, runsPerPlayer, nearPerRun }) {
  const parts = { accountNear: accountNear ?? 0, actionsNear: (actionsPerPlayer ?? 0) * (nearPerAction ?? 0), mintsNear: (runsPerPlayer ?? 0) * (nearPerRun ?? 0) };
  return { ...parts, totalNear: parts.accountNear + parts.actionsNear + parts.mintsNear };
}

/**
 * Every measured and derived figure, from NearBlocks rows for the three signers, RPC
 * `view_account` results for the four accounts and the NEAR price. Pure: the same inputs
 * give the same report.
 */
export function measure({ rows, views, nearUsd, now, relayerWrappedNear = null }) {
  const relayed = signedTxns(rows.relayer ?? [], ACCOUNTS.relayer, isRelayed);
  const mints = signedTxns(rows.operator ?? [], ACCOUNTS.operator, isMint);
  const created = signedTxns(rows.factory ?? [], ACCOUNTS.factory, isPlayerAccount);

  const actionCosts = relayed.map((t) => t.costNear);
  const relayWindow = dailySpend(relayed, now);
  const relayerFree = availableNear(views.relayer);
  const nearPerAction = mean(actionCosts);

  const sizes = mints.map((t) => batchSize(t.args));
  const runsMinted = sizes.every((s) => s != null) ? sizes.reduce((a, b) => a + b, 0) : null;
  const mintSpend = mints.reduce((a, t) => a + t.costNear, 0);
  const nearPerRun = runsMinted ? mintSpend / runsMinted : null;
  const mintWindow = dailySpend(mints, now);
  const operatorFree = availableNear(views.operator);

  const accountCosts = created.map((t) => t.costNear);
  const nearPerAccount = mean(accountCosts);
  const factoryFree = availableNear(views.factory);

  const players = created.length;
  const perPlayer = costPerPlayer({
    accountNear: nearPerAccount,
    actionsPerPlayer: players ? relayed.length / players : 0,
    nearPerAction,
    runsPerPlayer: players && runsMinted != null ? runsMinted / players : 0,
    nearPerRun,
  });
  const usd = (near) => (near == null || !(nearUsd > 0) ? null : near * nearUsd);

  return {
    measuredAt: new Date(now).toISOString(),
    nearUsd: nearUsd ?? null,
    relayer: {
      account: ACCOUNTS.relayer,
      actions: relayed.length,
      failedActions: relayed.filter((t) => !t.ok).length,
      gasBurntNearMedian: median(actionCosts),
      nearPerActionMean: nearPerAction,
      totalNear: actionCosts.reduce((a, b) => a + b, 0),
      firstAt: relayed[0] ? new Date(relayed[0].at).toISOString() : null,
      window: relayWindow,
      availableNear: relayerFree,
      cutoffNear: RELAYER_CUTOFF_NEAR,
      wrappedNear: relayerWrappedNear,
      runwayDays: runwayDays(relayerFree - RELAYER_CUTOFF_NEAR, relayWindow.perDayNear),
      runwayDaysAtBusiestDay: runwayDays(relayerFree - RELAYER_CUTOFF_NEAR, relayWindow.busiestDayNear),
      refills: REFILLS_USD.map((d) => refillBuys(d, nearUsd, nearPerAction)),
    },
    operator: {
      account: ACCOUNTS.operator,
      batches: mints.length,
      runsMinted,
      nearPerBatchMedian: median(mints.map((t) => t.costNear)),
      nearPerBatchMean: mean(mints.map((t) => t.costNear)),
      nearPerRun,
      totalNear: mintSpend,
      window: mintWindow,
      availableNear: operatorFree,
      runwayDays: runwayDays(operatorFree, mintWindow.perDayNear),
    },
    factory: {
      account: ACCOUNTS.factory,
      playerAccounts: players,
      nearPerAccountMean: nearPerAccount,
      nearPerAccountMedian: median(accountCosts),
      depositNearTotal: created.reduce((a, t) => a + t.depositNear, 0),
      availableNear: factoryFree,
      moreAccounts: nearPerAccount > 0 ? Math.floor(Math.max(0, factoryFree) / nearPerAccount) : null,
    },
    contract: { account: ACCOUNTS.contract, ...storageOf(views.contract) },
    perPlayer: { players, actionsPerPlayer: players ? relayed.length / players : null, runsPerPlayer: players && runsMinted != null ? runsMinted / players : null, ...perPlayer, totalUsd: usd(perPlayer.totalNear) },
  };
}

// ---------- network (read-only) ----------

function parseArgs(argv) {
  const out = { json: false, cache: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--cache") out.cache = argv[++i];
    else if (arg.startsWith("--cache=")) out.cache = arg.slice(8);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (out.cache === undefined) throw new Error("--cache needs a directory");
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function nearblocks(url, cache) {
  const file = cache && path.join(cache, `${url.replace(/[^a-z0-9]+/gi, "_")}.json`);
  if (file && fs.existsSync(file)) return { body: JSON.parse(fs.readFileSync(file, "utf8")), cached: true };
  const res = await fetchJson(url, { headers: { accept: "application/json", "user-agent": "wgp-costs-script" } }, { waits: NEARBLOCKS_WAITS_S });
  if (!res.ok) throw new Error(`NearBlocks answered HTTP ${res.status} for ${url}`);
  const body = await res.json();
  if (file) {
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(body));
  }
  return { body, cached: false };
}

/** Every row NearBlocks lists for an account, page by page until one comes back empty. */
async function allRows(account, cache, onPage) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { body, cached } = await nearblocks(`${NEARBLOCKS_API}/account/${encodeURIComponent(account)}/txns?per_page=${PER_PAGE}&page=${page}`, cache);
    const txns = body.txns ?? [];
    if (txns.length === 0) return rows;
    rows.push(...txns);
    onPage(account, page, rows.length);
    if (!cached) await sleep(PAGE_GAP_MS);
  }
  throw new Error(`${account} has more than ${MAX_PAGES} pages on NearBlocks; raise MAX_PAGES`);
}

async function viewAccount(account) {
  let last;
  for (const url of RPC_URLS) {
    try {
      const res = await fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: account } }) });
      const j = await res.json();
      if (j.result) return j.result;
      last = new Error(`${new URL(url).host}: ${JSON.stringify(j.error ?? j)}`);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** The relayer's wNEAR: Gas tank refills land as wNEAR and count only once the owner unwraps them. */
async function wrappedNear(account) {
  const args = Buffer.from(JSON.stringify({ account_id: account })).toString("base64");
  for (const url of RPC_URLS) {
    try {
      const res = await fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "wrap.near", method_name: "ft_balance_of", args_base64: args } }) });
      const j = await res.json();
      if (j.result?.result) return toNear(JSON.parse(Buffer.from(j.result.result).toString("utf8")));
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

async function nearPrice() {
  const res = await fetchJson(TOKENS_API, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const tokens = await res.json();
  const near = (Array.isArray(tokens) ? tokens : []).find((t) => t.assetId === NEAR_ASSET);
  return near?.price > 0 ? Number(near.price) : null;
}

// ---------- output ----------

const n = (x, digits = 4) => (x == null ? "n/a" : Number(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const whole = (x) => (x == null ? "n/a" : Math.round(x).toLocaleString("en-US"));
const days = (x) => (x == null ? "n/a (nothing spent in the window)" : `${n(x, 1)} days`);
const usdOf = (near, price) => (near == null || price == null ? "" : ` ($${n(near * price, near * price < 0.1 ? 4 : 2)})`);

function table(title, rows) {
  const left = Math.max(...rows.map(([label]) => label.length));
  return [`${title}`, ...rows.map(([label, value]) => `  ${label.padEnd(left)}  ${value}`), ""].join("\n");
}

export function render(r) {
  const p = r.nearUsd;
  const when = r.measuredAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const out = [`With Great Power: running costs, measured ${when}`, `NEAR price: ${p == null ? "n/a (1Click token list unreachable; USD figures left out)" : `$${n(p, 3)} (1Click, ${NEAR_ASSET})`}`, ""];
  out.push(
    table(`Relayer (${r.relayer.account}) pays gas for players' NEP-366 meta-transactions`, [
      ["measured: relayed player actions", `${whole(r.relayer.actions)} (${r.relayer.failedActions} failed), since ${r.relayer.firstAt?.slice(0, 10) ?? "n/a"}`],
      ["measured: NEAR per action, median", `${n(r.relayer.gasBurntNearMedian, 6)}${usdOf(r.relayer.gasBurntNearMedian, p)}`],
      ["measured: NEAR per action, mean", `${n(r.relayer.nearPerActionMean, 6)}${usdOf(r.relayer.nearPerActionMean, p)}`],
      ["measured: spent on relayed actions, all time", `${n(r.relayer.totalNear)}${usdOf(r.relayer.totalNear, p)}`],
      [`measured: spent in the last ${r.relayer.window.days} days`, `${n(r.relayer.window.totalNear)} over ${r.relayer.window.count} actions`],
      ["measured: available balance (less storage)", `${n(r.relayer.availableNear)}, relay stops at ${r.relayer.cutoffNear}`],
      ["measured: wNEAR from refills, not yet unwrapped", r.relayer.wrappedNear == null ? "n/a" : `${n(r.relayer.wrappedNear)} (not counted in runway)`],
      ["derived: average spend per day (7-day window)", n(r.relayer.window.perDayNear, 5)],
      ["derived: runway to the cut-off, 7-day average", days(r.relayer.runwayDays)],
      ["derived: runway to the cut-off, busiest day", days(r.relayer.runwayDaysAtBusiestDay)],
      ...r.relayer.refills.map((f) => [`estimate: a $${f.usd} Gas tank refill buys`, f.actions == null ? "n/a" : `${whole(f.actions)} relayed actions (${n(f.near, 3)} NEAR after 1Click's 0.2%)`]),
    ]),
  );
  out.push(
    table(`Operator (${r.operator.account}) sends mint_rewards batches`, [
      ["measured: mint_rewards batches", whole(r.operator.batches)],
      ["measured: verified runs minted", whole(r.operator.runsMinted)],
      ["measured: NEAR per batch, median / mean", `${n(r.operator.nearPerBatchMedian, 6)} / ${n(r.operator.nearPerBatchMean, 6)}`],
      ["derived: NEAR per minted run", `${n(r.operator.nearPerRun, 6)}${usdOf(r.operator.nearPerRun, p)}`],
      ["measured: spent on mints, all time", `${n(r.operator.totalNear)}${usdOf(r.operator.totalNear, p)}`],
      [`measured: spent in the last ${r.operator.window.days} days`, `${n(r.operator.window.totalNear)} over ${r.operator.window.count} batches`],
      ["measured: available balance", n(r.operator.availableNear)],
      ["derived: average spend per day (7-day window)", n(r.operator.window.perDayNear, 5)],
      ["derived: runway, 7-day average", days(r.operator.runwayDays)],
    ]),
  );
  out.push(
    table(`Factory (${r.factory.account}) creates <name>.wgpnear.near player accounts`, [
      ["measured: player accounts created", whole(r.factory.playerAccounts)],
      ["measured: NEAR per account (deposit + gas), mean", `${n(r.factory.nearPerAccountMean, 6)}${usdOf(r.factory.nearPerAccountMean, p)}`],
      ["measured: deposits attached, total", n(r.factory.depositNearTotal)],
      ["measured: available balance", n(r.factory.availableNear)],
      ["derived: more accounts it can create", whole(r.factory.moreAccounts)],
    ]),
  );
  out.push(
    table(`Contract storage (${r.contract.account})`, [
      ["measured: bytes stored", whole(r.contract.bytes)],
      ["measured: NEAR held for storage", n(r.contract.lockedNear)],
      ["measured: free balance", n(r.contract.freeNear)],
      ["derived: headroom, more bytes it can store", whole(r.contract.headroomBytes)],
    ]),
  );
  out.push(
    table("Cost per player (derived; an estimate: the average over every player account)", [
      ["player accounts", whole(r.perPlayer.players)],
      ["relayed actions per player", n(r.perPlayer.actionsPerPlayer, 2)],
      ["minted runs per player", n(r.perPlayer.runsPerPlayer, 2)],
      ["account creation", n(r.perPlayer.accountNear, 6)],
      ["relayed actions", n(r.perPlayer.actionsNear, 6)],
      ["mints", n(r.perPlayer.mintsNear, 6)],
      ["total per player", `${n(r.perPlayer.totalNear, 6)} NEAR${usdOf(r.perPlayer.totalNear, p)}`],
    ]),
  );
  out.push("Runway uses the last 7 days, idle hours included. Gas is what NearBlocks reports burnt; hosting and sign-in costs are off chain and not counted.");
  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void process.stdout.write(HELP);
  const progress = args.json || !process.stderr.isTTY ? () => {} : (account, page, count) => process.stderr.write(`\r  reading NearBlocks: ${account}, page ${page}, ${count} rows   `);
  const rows = {};
  for (const role of ["relayer", "operator", "factory"]) rows[role] = await allRows(ACCOUNTS[role], args.cache, progress);
  if (!args.json && process.stderr.isTTY) process.stderr.write("\r\x1b[K");
  const views = {};
  for (const role of Object.keys(ACCOUNTS)) views[role] = await viewAccount(ACCOUNTS[role]);
  const nearUsd = await nearPrice().catch(() => null);
  const relayerWrappedNear = await wrappedNear(ACCOUNTS.relayer);
  const report = measure({ rows, views, nearUsd, now: Date.now(), relayerWrappedNear });
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`costs: ${error?.message ?? error}\n`);
    process.exit(1);
  });
}
