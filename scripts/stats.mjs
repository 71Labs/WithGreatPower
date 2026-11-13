#!/usr/bin/env node
/**
 * The game's public numbers, from two places that don't depend on each other:
 *
 *   1. GET <base>/api/stats: what the game's own database counts (matches, players, City
 *      outings, referrals, reward mints). Aggregates only.
 *   2. The NearBlocks API: every receipt the game contract has received on NEAR. Function calls
 *      are tallied by method and kept apart from receipts that carry none (transfers, refunds,
 *      the account's creation); then how many player accounts called a game method, how many
 *      did so once, and how concentrated the market's calls are. Nothing from (1) is used here.
 *
 * No dependencies and no keys: Node 18+ (global fetch).
 *
 *   node scripts/stats.mjs                              # the live game and mainnet
 *   node scripts/stats.mjs --base http://127.0.0.1:3000 # another deployment
 *   node scripts/stats.mjs --chain-only                 # skip (1)
 *   node scripts/stats.mjs --site-only                  # skip (2)
 *   node scripts/stats.mjs --json                       # one JSON object instead of tables
 *
 * Exit code: 1 when the site can't be read (unless --chain-only), 2 for bad arguments. A
 * NearBlocks outage is a note, not a failure: the site numbers still print. A rate limit is
 * waited out (up to three retries a page) before it becomes one.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE = "https://www.wgponnear.fun";
const DEFAULT_CONTRACT = "game.wgpnear.near";
const NEARBLOCKS_API = "https://api.nearblocks.io/v1";
/** The game's own senders: the operator mints rewards, the relayer pays gas for players' trades. */
const OWN_ACCOUNTS = ["operator.wgpnear.near", "relayer.wgpnear.near"];
/**
 * Sandwich Man, the NPC trader (docs/npc-trader.md). His calls are real market calls, but he
 * is never a player: they are counted on their own line and he is left out of the accounts.
 */
const NPC_ACCOUNTS = ["sandwich.wgpnear.near"];
/** The methods players call from their own accounts (signed by their session key, relayed). */
/** The author's own player account. It plays like any other and is counted as one; the tally says whether it is among them. */
const AUTHOR_ACCOUNTS = ["sele.wgpnear.near"];
const PLAYER_METHODS = ["register_hero", "craft_suit", "equip_suit", "market_buy", "market_sell", "list_item", "buy_listing", "cancel_listing"];
/** The market's five, a subset of the player methods. */
const MARKET_METHODS = ["market_buy", "market_sell", "list_item", "buy_listing", "cancel_listing"];
const PER_PAGE = 25;
const PAGE_GAP_MS = 1000;
/** A stop for a runaway loop: 25,000 receipts. Past it the tally says it is partial. */
const MAX_PAGES = 1000;
/** Seconds to wait before each retry of a rate-limited page. */
const RATE_LIMIT_WAITS_S = [15, 30, 60];

const HELP = `Usage: node scripts/stats.mjs [--base <url>] [--contract <account>] [--chain-only | --site-only] [--json]

  --base <url>          the game to read /api/stats from (default ${DEFAULT_BASE})
  --contract <account>  the contract to tally on NearBlocks (default: the one the site names, else ${DEFAULT_CONTRACT})
  --chain-only          only the NearBlocks tally
  --site-only           only /api/stats
  --json                print one JSON object
`;

function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, contract: null, chainOnly: false, siteOnly: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--base") out.base = value();
    else if (arg.startsWith("--base=")) out.base = arg.slice(7);
    else if (arg === "--contract") out.contract = value();
    else if (arg.startsWith("--contract=")) out.contract = arg.slice(11);
    else if (arg === "--chain-only") out.chainOnly = true;
    else if (arg === "--site-only") out.siteOnly = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (out.chainOnly && out.siteOnly) throw new Error("Pick one of --chain-only and --site-only");
  out.base = out.base.replace(/\/+$/, "");
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const whole = new Intl.NumberFormat("en-US");
const fmt = (value) => (typeof value === "number" ? whole.format(value) : String(value ?? "n/a"));

async function getJson(url, timeoutMs = 20_000) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "wgp-stats-script" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after")) || 0;
    throw error;
  }
  return response.json();
}

/** getJson that waits out a rate limit (HTTP 429): three more tries, 15, 30 and 60 s apart, or as long as the server asks. */
async function getJsonPatiently(url, onWait = () => {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJson(url);
    } catch (error) {
      const wait = RATE_LIMIT_WAITS_S[attempt];
      if (error.status !== 429 || wait === undefined) throw error;
      const seconds = Math.min(90, Math.max(wait, error.retryAfter));
      onWait(seconds);
      await sleep(seconds * 1000);
    }
  }
}

const reason = (error) => (error?.name === "TimeoutError" ? "timed out" : (error?.cause?.code ?? error?.message ?? String(error)));

/** Rows of [label, value] as an aligned table under a heading. */
function table(title, rows) {
  const left = Math.max(...rows.map(([label]) => label.length));
  const right = Math.max(...rows.map(([, value]) => fmt(value).length));
  const lines = rows.map(([label, value]) => `  ${label.padEnd(left)}  ${fmt(value).padStart(right)}`);
  return `${title}\n${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ 1. the site */

function printSite(base, s) {
  const runs = s.runs;
  console.log(`With Great Power, by the numbers\n  source  ${base}/api/stats\n  as of   ${s.at}\n  since   ${s.since ?? "no matches yet"}\n`);
  console.log(
    table("Matches", [
      ["started", runs.started],
      ["verified by replay", runs.verified],
      ["refused by replay", runs.rejected],
      ["never handed in", runs.unfinished],
      ["hours of verified play", runs.hoursVerified.toFixed(1)],
      ...(runs.season ? [[`season ${runs.season.id}: started`, runs.season.started], [`season ${runs.season.id}: verified`, runs.season.verified]] : []),
      ["today (UTC): started", runs.today.started],
      ["today (UTC): verified", runs.today.verified],
    ]),
  );
  const modes = Object.entries(runs.byMode);
  const width = Math.max(4, ...modes.map(([mode]) => mode.length));
  console.log(`Matches by mode\n  ${"mode".padEnd(width)}  ${"started".padStart(8)}  ${"verified".padStart(8)}`);
  for (const [mode, c] of modes) console.log(`  ${mode.padEnd(width)}  ${fmt(c.started).padStart(8)}  ${fmt(c.verified).padStart(8)}`);
  console.log("");
  console.log(table("Players (signed in, not banned)", [["signed up", s.players.total], ["started a match", s.players.played], ["have a verified match", s.players.withVerifiedRun]]));
  console.log(table("The City", [["outings", s.city.outings], ["players who went out", s.city.players], ["tasks finished", s.city.tasksDone]]));
  console.log(table("Invites", [["friends invited", s.referrals.invited], ["friends who count", s.referrals.qualified], ["recruiter badges", s.referrals.rewards]]));
  console.log(
    table("Chain, as the game's outbox sees it", [
      ["network", s.chain.network ?? "not connected"],
      ["contract", s.chain.contractId ?? "not connected"],
      ["reward mints queued", s.chain.rewardMints.queued],
      ["reward mints sent", s.chain.rewardMints.sent],
    ]),
  );
}

/* ------------------------------------------------------------------ 2. the chain */

/**
 * Counts NearBlocks' rows for the contract. Pure: `add` takes one row, `snapshot` answers the
 * tally so far, and nothing here touches the network (the tests run it on a fixture).
 *
 * A row is a receipt the contract received, not a call. Most carry one function call; a few
 * carry none (a transfer, a refund from `system`, the account's creation) and a deploy carries
 * the code and its `new` together. So the tally keeps three things apart:
 *
 *   receipts        every row
 *   functionCalls   the FUNCTION_CALL actions in them, also by method (`byMethod`)
 *   otherReceipts   rows with no function call at all (`otherActions` counts every action
 *                   that isn't a function call, a deploy's included)
 *
 * and, for people: `players` says how many accounts called a game method themselves, how many
 * of them did so exactly once, whether the author's account is among them, and how
 * concentrated the market's calls are. The NPC trader is never one of them.
 */
export function createTally(contract) {
  const methods = new Map();
  const others = new Map();
  /** account -> { calls, market }: the player methods an account called itself. */
  const players = new Map();
  const seen = new Set();
  let receipts = 0;
  let functionCalls = 0;
  let otherReceipts = 0;
  let failed = 0;
  let failedFunctionCalls = 0;
  let npcCalls = 0;
  const sorted = (map) => Object.fromEntries([...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return {
    /** Adds one row. Answers false for a row already counted (a page can shift while new calls land). */
    add(txn) {
      const id = txn.receipt_id ?? txn.id ?? `${txn.transaction_hash}:${txn.predecessor_account_id}`;
      if (seen.has(id)) return false;
      seen.add(id);
      receipts += 1;
      const actions = txn.actions ?? [];
      const called = actions.filter((a) => a.method);
      const failedHere = txn.outcomes?.status === false;
      if (failedHere) failed += 1;
      if (called.length === 0) otherReceipts += 1;
      functionCalls += called.length;
      if (failedHere) failedFunctionCalls += called.length;
      for (const action of actions) {
        if (action.method) methods.set(action.method, (methods.get(action.method) ?? 0) + 1);
        else {
          const kind = String(action.action ?? "unknown").toLowerCase();
          others.set(kind, (others.get(kind) ?? 0) + 1);
        }
      }
      // A player account is one that called a game method itself: not the deploy, the setup or a
      // transfer, which the owner and the setup payer send.
      const sender = txn.predecessor_account_id;
      const played = called.filter((a) => PLAYER_METHODS.includes(a.method));
      if (NPC_ACCOUNTS.includes(sender)) npcCalls += 1;
      else if (played.length && sender && sender !== contract && !OWN_ACCOUNTS.includes(sender)) {
        const p = players.get(sender) ?? { calls: 0, market: 0 };
        p.calls += played.length;
        p.market += played.filter((a) => MARKET_METHODS.includes(a.method)).length;
        players.set(sender, p);
      }
      return true;
    },
    get receipts() {
      return receipts;
    },
    snapshot(complete, pages = 0) {
      const each = [...players.values()];
      const traders = each.filter((p) => p.market > 0).sort((a, b) => b.market - a.market);
      const authors = AUTHOR_ACCOUNTS.filter((a) => players.has(a));
      return {
        contract,
        complete,
        pages,
        receipts,
        functionCalls,
        failedFunctionCalls,
        otherReceipts,
        failed,
        byMethod: sorted(methods),
        otherActions: sorted(others),
        playerAccounts: players.size,
        players: {
          accounts: players.size,
          // The author's account plays like any other and is counted; this says so.
          authorAccounts: authors,
          withOneCall: each.filter((p) => p.calls === 1).length,
          calls: each.reduce((n, p) => n + p.calls, 0),
          marketAccounts: traders.length,
          marketCalls: traders.reduce((n, p) => n + p.market, 0),
          // The market's calls by its two busiest accounts.
          marketCallsTopTwo: traders.slice(0, 2).reduce((n, p) => n + p.market, 0),
          marketCallsByAuthor: authors.reduce((n, a) => n + players.get(a).market, 0),
        },
        npcCalls,
      };
    },
  };
}

/** The tally of a list of rows (a fixture, or pages already read). */
export function tallyRows(rows, contract = DEFAULT_CONTRACT) {
  const tally = createTally(contract);
  for (const row of rows) tally.add(row);
  return tally.snapshot(true);
}

/**
 * Every receipt the contract received, page by page until one comes back empty. Throws on
 * the first page it can't read; `partial` on the error carries what was counted before it.
 */
async function tallyChain(contract, onPage = () => {}, onWait = () => {}) {
  const tally = createTally(contract);
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAGE_GAP_MS);
    let body;
    try {
      body = await getJsonPatiently(`${NEARBLOCKS_API}/account/${encodeURIComponent(contract)}/txns?per_page=${PER_PAGE}&page=${page}`, onWait);
    } catch (error) {
      error.partial = tally.snapshot(false, pages);
      throw error;
    }
    const txns = Array.isArray(body?.txns) ? body.txns : [];
    if (txns.length === 0) return tally.snapshot(true, pages);
    pages = page;
    for (const txn of txns) tally.add(txn);
    onPage(page, tally.receipts);
  }
  return tally.snapshot(false, pages);
}

function printChain(t) {
  const explorer = `https://nearblocks.io/address/${t.contract}`;
  console.log(`On chain, counted from NearBlocks${t.complete ? "" : " (partial: stopped early)"}\n  contract  ${t.contract}\n  explorer  ${explorer}\n`);
  console.log(
    table("What the contract received", [
      ["function calls", t.functionCalls],
      ["  of them failed", t.failedFunctionCalls],
      ["receipts with no function call (transfers, refunds, the account's creation)", t.otherReceipts],
      ["receipts in all, as NearBlocks lists them", t.receipts],
      ["  of them failed", t.failed],
      ["pages read", t.pages],
    ]),
  );
  const rows = Object.entries(t.byMethod);
  if (rows.length) console.log(table("Function calls by method", rows));
  const others = Object.entries(t.otherActions);
  if (others.length) console.log(table("Actions that aren't function calls", others));
  const p = t.players;
  console.log(
    table("Player accounts that called a game method themselves", [
      ["accounts", p.accounts],
      [`  of them the author's own (${p.authorAccounts.join(", ") || "none"})`, p.authorAccounts.length],
      ["  that made exactly one call", p.withOneCall],
      ["their calls in all", p.calls],
      ["accounts that made a market call", p.marketAccounts],
      ["market calls by players", p.marketCalls],
      ["  of them by the two busiest accounts", p.marketCallsTopTwo],
      ["  of them by the author's account", p.marketCallsByAuthor],
    ]),
  );
  if (t.npcCalls > 0) console.log(table("Calls by the NPC trader (not a player; included in the methods above)", [["calls", t.npcCalls]]));
}

/* ------------------------------------------------------------------ main */

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

  const result = { site: null, chain: null, notes: [] };
  let code = 0;

  if (!args.chainOnly) {
    const url = `${args.base}/api/stats`;
    try {
      result.site = await getJson(url);
      if (!result.site?.runs || !result.site?.players) throw new Error("not the /api/stats shape");
      if (!args.json) printSite(args.base, result.site);
    } catch (error) {
      result.site = null;
      const why = error.status === 404 ? "HTTP 404: this deployment has no /api/stats yet" : reason(error);
      console.error(`Could not read ${url} (${why}).`);
      result.notes.push(`site: ${why}`);
      code = 1;
    }
  }

  if (!args.siteOnly) {
    const contract = args.contract ?? result.site?.chain?.contractId ?? DEFAULT_CONTRACT;
    if (!args.contract && result.site && !result.site.chain?.contractId && !args.json) {
      console.log(`Note: ${args.base} is not connected to a contract; tallying ${DEFAULT_CONTRACT} on mainnet.\n`);
    }
    const progress = args.json || !process.stderr.isTTY ? () => {} : (page, calls) => process.stderr.write(`\r  reading NearBlocks: page ${page}, ${calls} receipts`);
    try {
      const waiting = args.json ? () => {} : (seconds) => console.error(`${process.stderr.isTTY ? "\r\x1b[K" : ""}  NearBlocks is rate limiting; waiting ${seconds} s…`);
      result.chain = await tallyChain(contract, progress, waiting);
      if (process.stderr.isTTY && !args.json) process.stderr.write("\r\x1b[K");
      if (!args.json) printChain(result.chain);
    } catch (error) {
      if (process.stderr.isTTY && !args.json) process.stderr.write("\r\x1b[K");
      const why = error.status === 429 ? "HTTP 429: NearBlocks is rate limiting this address" : reason(error);
      const note = `NearBlocks could not be read (${why}), so the on-chain tally is ${error.partial?.receipts ? "partial" : "missing"}. Try again in a minute, or open https://nearblocks.io/address/${contract}.`;
      result.notes.push(note);
      result.chain = error.partial?.receipts ? error.partial : null;
      if (!args.json) {
        if (result.chain) printChain(result.chain);
        console.log(`Note: ${note}`);
      }
    }
  }

  if (args.json) console.log(JSON.stringify(result, null, 2));
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
