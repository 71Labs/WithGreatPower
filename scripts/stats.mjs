#!/usr/bin/env node
/**
 * The game's public numbers, from two places that don't depend on each other:
 *
 *   1. GET <base>/api/stats: what the game's own database counts (matches, players, City
 *      outings, referrals, reward mints). Aggregates only.
 *   2. The NearBlocks API: every call the game contract has received on NEAR, tallied here by
 *      method, and how many player accounts sent one. Nothing from (1) is used for (2).
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

const DEFAULT_BASE = "https://www.wgponnear.fun";
const DEFAULT_CONTRACT = "game.wgpnear.near";
const NEARBLOCKS_API = "https://api.nearblocks.io/v1";
/** The game's own senders: the operator mints rewards, the relayer pays gas for players' trades. */
const OWN_ACCOUNTS = ["operator.wgpnear.near", "relayer.wgpnear.near"];
const PER_PAGE = 25;
const PAGE_GAP_MS = 1000;
/** A stop for a runaway loop: 25,000 calls. Past it the tally says it is partial. */
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
 * Every receipt the contract received, page by page until one comes back empty. Throws on
 * the first page it can't read; `partial` on the error carries what was counted before it.
 */
async function tallyChain(contract, onPage = () => {}, onWait = () => {}) {
  const methods = new Map();
  const senders = new Set();
  const seen = new Set();
  let calls = 0;
  let failed = 0;
  let pages = 0;
  const snapshot = (complete) => ({
    contract,
    complete,
    pages,
    calls,
    failed,
    byMethod: Object.fromEntries([...methods].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    playerAccounts: senders.size,
  });
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAGE_GAP_MS);
    let body;
    try {
      body = await getJsonPatiently(`${NEARBLOCKS_API}/account/${encodeURIComponent(contract)}/txns?per_page=${PER_PAGE}&page=${page}`, onWait);
    } catch (error) {
      error.partial = snapshot(false);
      throw error;
    }
    const txns = Array.isArray(body?.txns) ? body.txns : [];
    if (txns.length === 0) return snapshot(true);
    pages = page;
    for (const txn of txns) {
      // A page can shift while new calls land: never count one receipt twice.
      const id = txn.receipt_id ?? txn.id ?? `${txn.transaction_hash}:${txn.predecessor_account_id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      calls += 1;
      if (txn.outcomes?.status === false) failed += 1;
      for (const action of txn.actions ?? []) {
        const name = action.method ?? `(${String(action.action ?? "unknown").toLowerCase()})`;
        methods.set(name, (methods.get(name) ?? 0) + 1);
      }
      const sender = txn.predecessor_account_id;
      if (sender && sender !== contract && !OWN_ACCOUNTS.includes(sender)) senders.add(sender);
    }
    onPage(page, calls);
  }
  return snapshot(false);
}

function printChain(t) {
  const explorer = `https://nearblocks.io/address/${t.contract}`;
  console.log(`On chain, counted from NearBlocks${t.complete ? "" : " (partial: stopped early)"}\n  contract  ${t.contract}\n  explorer  ${explorer}\n`);
  console.log(table("Calls the contract received", [["calls", t.calls], ["of them failed", t.failed], ["pages read", t.pages]]));
  const rows = Object.entries(t.byMethod);
  if (rows.length) console.log(table("Actions by method", rows));
  console.log(table(`Player accounts that transacted (not ${OWN_ACCOUNTS.join(", ")} or the contract)`, [["accounts", t.playerAccounts]]));
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
    const progress = args.json || !process.stderr.isTTY ? () => {} : (page, calls) => process.stderr.write(`\r  reading NearBlocks: page ${page}, ${calls} calls`);
    try {
      const waiting = args.json ? () => {} : (seconds) => console.error(`${process.stderr.isTTY ? "\r\x1b[K" : ""}  NearBlocks is rate limiting; waiting ${seconds} s…`);
      result.chain = await tallyChain(contract, progress, waiting);
      if (process.stderr.isTTY && !args.json) process.stderr.write("\r\x1b[K");
      if (!args.json) printChain(result.chain);
    } catch (error) {
      if (process.stderr.isTTY && !args.json) process.stderr.write("\r\x1b[K");
      const why = error.status === 429 ? "HTTP 429: NearBlocks is rate limiting this address" : reason(error);
      const note = `NearBlocks could not be read (${why}), so the on-chain tally is ${error.partial?.calls ? "partial" : "missing"}. Try again in a minute, or open https://nearblocks.io/address/${contract}.`;
      result.notes.push(note);
      result.chain = error.partial?.calls ? error.partial : null;
      if (!args.json) {
        if (result.chain) printChain(result.chain);
        console.log(`Note: ${note}`);
      }
    }
  }

  if (args.json) console.log(JSON.stringify(result, null, 2));
  return code;
}

process.exitCode = await main();
