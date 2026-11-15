#!/usr/bin/env node
/**
 * Every mainnet transaction of the game's accounts, as one dated Markdown ledger
 * (docs/TRANSACTIONS.md). Read-only, no keys, no dependencies (Node 18+).
 *
 *   pnpm txs                                   # read NearBlocks, write docs/TRANSACTIONS.md
 *   node scripts/transactions.mjs --save <f>   # also keep NearBlocks' raw answers in <f>
 *   node scripts/transactions.mjs --offline <f># render from a saved capture, no network
 *   node scripts/transactions.mjs --stdout     # print instead of writing the file
 *
 * What is read, all pages of each (newest first, by NearBlocks' cursor):
 *
 *   /v1/account/<id>/txns-only     the transactions each ledger account signed or received
 *   /v1/account/<contract>/txns    the receipts the game contract received or sent
 *
 * The contract's receipts carry the method, the caller (the receipt's predecessor) and the
 * receipt's own result; the transaction lists carry who signed each transaction. A relayed
 * call (NEP-366) is a transaction the relayer signs whose receiver is the player and whose
 * first action is DELEGATE_ACTION: its receipt reaches the contract with the player as the
 * predecessor, the same account `pnpm stats` counts, and the ledger names the relayer beside it.
 *
 * Everything below `collect` is pure: the same capture renders the same bytes (the
 * generation time is the capture's own `fetchedAt`). apps/wgp/src/evidence/transactions.test.ts
 * runs it on small recorded fixtures with no network.
 *
 * Exit code: 1 when a list could not be read to the end (the partial ledger is still written
 * and its header says what is missing), 2 for bad arguments.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchJson } from "./evidence.mjs";
import { DEFAULT_CONTRACT, MARKET_METHODS, NEARBLOCKS_API, NPC_ACCOUNTS, OWN_ACCOUNTS, PLAYER_METHODS } from "./stats.mjs";
import { EXCLUDED_AUTHOR_ACCOUNTS, TEAM_ACCOUNTS } from "./traction.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = "docs/TRANSACTIONS.md";
export const COMMAND = "pnpm txs";
export const OWNER_ACCOUNT = "wgpnear.near";
export const RELAYER = OWN_ACCOUNTS.find((a) => a.startsWith("relayer.")) ?? "relayer.wgpnear.near";
/** The accounts whose transactions the ledger lists, in the order their sections appear. */
export const LEDGER_ACCOUNTS = [DEFAULT_CONTRACT, OWNER_ACCOUNT, RELAYER, ...OWN_ACCOUNTS.filter((a) => a !== RELAYER), ...NPC_ACCOUNTS];
export const PER_PAGE = 100;
const PAGE_GAP_MS = 2500;
/** A stop for a runaway loop: 100,000 rows per list. Past it the list is marked partial. */
const MAX_PAGES = 1000;
/** Extra waits (seconds) for a page NearBlocks keeps refusing, after fetchJson's own three retries. */
const PATIENCE_S = [20, 45, 90, 120, 180];

/** The order the contract's methods are grouped in: players' calls, then the operator's, then the owner's. Any other method follows, A to Z. */
export const METHOD_ORDER = [
  ...PLAYER_METHODS,
  "mint_rewards",
  "record_season",
  "new",
  "deploy_contract",
  "upgrade",
  "migrate",
  "set_rules",
  "set_market_params",
  "set_paused",
  "add_operator",
  "remove_operator",
  "set_owner",
];

/** The sentences the ledger states about its own method. Tests and docs/evidence.json quote them. */
export const METHOD_NOTES = {
  relayed:
    "A relayed call (a NEP-366 meta-transaction) is listed under the player whose key signed the delegate action, which is the receipt's predecessor and the account `pnpm stats` counts, and the relayer that signed and paid for the outer transaction is named beside it in the Sent by column.",
  failures: "Failed transactions and failed receipts are listed with the rest and marked failed; none is left out of a table or a count.",
  labels:
    "Accounts carry the labels `pnpm stats` and `pnpm traction` give them: author (sele.wgpnear.near, sele71.near), team (wgpnear.near, operator.wgpnear.near, relayer.wgpnear.near), NPC (sandwich.wgpnear.near, Sandwich Man) and contract (game.wgpnear.near). Every other account is a player, so the player columns never include the author's or the team's calls.",
  generated: "This file is generated: edit scripts/transactions.mjs, not this file, and run `pnpm txs` to bring it up to date.",
};

/* ------------------------------------------------------------------ pure: labels and rows */

/** What an account is to the game: author, team, NPC, contract, system (gas refunds) or player. */
export function labelOf(account, contract = DEFAULT_CONTRACT) {
  if (!account) return "unknown";
  if (account === contract) return "contract";
  if (EXCLUDED_AUTHOR_ACCOUNTS.includes(account)) return "author";
  if (NPC_ACCOUNTS.includes(account)) return "NPC";
  if (TEAM_ACCOUNTS.includes(account)) return "team";
  if (account === "system") return "system";
  return "player";
}

const nsOf = (row) => String(row.block_timestamp ?? row.receipt_block?.block_timestamp ?? "0");
const cmpNs = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A NearBlocks nanosecond timestamp as `YYYY-MM-DD HH:MM:SS` (UTC). */
export function utcTime(ns) {
  return new Date(Number(BigInt(String(ns)) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 19);
}

const parseArgs = (args) => {
  if (!args) return null;
  try {
    return typeof args === "string" ? JSON.parse(args) : args;
  } catch {
    return null;
  }
};

/** One transaction from a `txns-only` row. A relayed one keeps its inner actions and names its player. */
export function normalizeTxn(row) {
  const all = row.actions ?? [];
  const relayed = all.some((a) => a.action === "DELEGATE_ACTION");
  const actions = all.filter((a) => a.action !== "DELEGATE_ACTION").map((a) => ({ kind: String(a.action ?? "UNKNOWN"), method: a.method ?? null, deposit: a.deposit ?? 0, args: a.args ?? null }));
  return {
    hash: row.transaction_hash,
    ns: nsOf(row),
    signer: row.signer_account_id ?? null,
    receiver: row.receiver_account_id ?? null,
    relayed,
    // For a meta-transaction the outer receiver is the delegate action's sender: the player.
    player: relayed ? (row.receiver_account_id ?? null) : null,
    actions,
    ok: row.outcomes?.status === false ? false : row.outcomes?.status === true ? true : null,
  };
}

/**
 * The ledger's model from a capture. Pure.
 *
 * capture = { fetchedAt, contract, accounts: { [id]: { txns: [...], receipts?: [...], complete, pages, note? } } }
 */
export function buildLedger(capture) {
  const contract = capture.contract ?? DEFAULT_CONTRACT;
  const accounts = capture.accounts ?? {};
  const ledgerAccounts = LEDGER_ACCOUNTS.map((a) => (a === DEFAULT_CONTRACT ? contract : a));

  // Every transaction any list names, by hash. Lists overlap (an operator's mint is in the
  // operator's list and the contract's); the first copy wins and the rest only add membership.
  const txns = new Map();
  const membership = new Map();
  for (const account of ledgerAccounts) {
    for (const row of accounts[account]?.txns ?? []) {
      if (!row?.transaction_hash) continue;
      if (!txns.has(row.transaction_hash)) txns.set(row.transaction_hash, normalizeTxn(row));
      (membership.get(row.transaction_hash) ?? membership.set(row.transaction_hash, new Set()).get(row.transaction_hash)).add(account);
    }
  }

  // The contract's receipts: one row per function call, one per receipt that carries none.
  const seen = new Set();
  const calls = [];
  for (const r of accounts[contract]?.receipts ?? []) {
    const id = r.receipt_id ?? r.id ?? `${r.transaction_hash}:${r.predecessor_account_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const acts = r.actions ?? [];
    const kinds = acts.map((a) => String(a.action ?? "UNKNOWN"));
    const deploy = kinds.includes("DEPLOY_CONTRACT");
    const fcs = acts.filter((a) => a.method);
    const tx = txns.get(r.transaction_hash) ?? null;
    const base = {
      receiptId: id,
      hash: r.transaction_hash,
      ns: nsOf(r),
      caller: r.predecessor_account_id ?? null,
      receiver: r.receiver_account_id ?? null,
      ok: r.outcomes?.status === false || r.receipt_outcome?.status === false ? false : true,
      signer: tx?.signer ?? null,
      relayed: tx?.relayed ?? false,
      incoming: (r.receiver_account_id ?? contract) === contract,
    };
    if (deploy) calls.push({ ...base, method: "deploy_contract", detail: kinds.map((k, i) => (acts[i].method ? acts[i].method : k.toLowerCase())).join(" + "), args: null, index: 0 });
    else if (fcs.length) fcs.forEach((a, index) => calls.push({ ...base, method: a.method, detail: null, args: parseArgs(a.args), index }));
    else calls.push({ ...base, method: `(${kinds.map((k) => k.toLowerCase()).join(" + ") || "no actions"})`, detail: null, args: null, index: 0 });
    if (!membership.has(r.transaction_hash)) membership.set(r.transaction_hash, new Set());
    membership.get(r.transaction_hash).add(contract);
  }
  calls.sort((a, b) => cmpNs(a.ns, b.ns) || cmpStr(a.hash, b.hash) || cmpStr(a.receiptId, b.receiptId) || a.index - b.index);

  const failedInContract = new Set(calls.filter((c) => !c.ok).map((c) => c.hash));
  const rank = (m) => {
    const i = METHOD_ORDER.indexOf(m);
    return i < 0 ? METHOD_ORDER.length + (m.startsWith("(") ? 1 : 0) : i;
  };
  const methods = [...new Set(calls.map((c) => c.method))].sort((a, b) => rank(a) - rank(b) || cmpStr(a, b));
  const byMethod = methods.map((method) => {
    const rows = calls.filter((c) => c.method === method);
    const by = { player: 0, author: 0, team: 0, NPC: 0, contract: 0, system: 0 };
    for (const c of rows) {
      const l = labelOf(c.caller, contract);
      by[l in by ? l : "system"] += 1;
    }
    return { method, rows, calls: rows.length, failed: rows.filter((c) => !c.ok).length, relayed: rows.filter((c) => c.relayed).length, callers: new Set(rows.map((c) => c.caller)).size, by };
  });

  // Each ledger account's own transactions, oldest first.
  const perAccount = ledgerAccounts.map((account) => {
    const list = accounts[account];
    const hashes = [...new Set((list?.txns ?? []).map((r) => r.transaction_hash).filter(Boolean))];
    const rows = hashes.map((h) => txns.get(h)).sort((a, b) => cmpNs(a.ns, b.ns) || cmpStr(a.hash, b.hash));
    const status = (t) => (t.ok === false ? "failed" : failedInContract.has(t.hash) ? "failed in contract" : "ok");
    return {
      account,
      label: labelOf(account, contract),
      read: !!list,
      complete: list?.complete ?? false,
      pages: list?.pages ?? 0,
      note: list?.note ?? null,
      receipts: account === contract ? calls.length : null,
      rows: rows.map((t) => ({ ...t, status: status(t) })),
      failed: rows.filter((t) => status(t) !== "ok").length,
      first: rows[0] ?? null,
      last: rows.at(-1) ?? null,
    };
  });

  // Every distinct transaction: from the lists, and those only the contract's receipts name.
  const all = new Map();
  for (const t of txns.values()) all.set(t.hash, { hash: t.hash, ns: t.ns, ok: t.ok !== false && !failedInContract.has(t.hash) });
  for (const c of calls) if (!all.has(c.hash)) all.set(c.hash, { hash: c.hash, ns: c.ns, ok: !failedInContract.has(c.hash) });
  const everything = [...all.values()].sort((a, b) => cmpNs(a.ns, b.ns) || cmpStr(a.hash, b.hash));

  const days = new Map();
  for (const t of everything) {
    const day = utcTime(t.ns).slice(0, 10);
    const d = days.get(day) ?? days.set(day, { day, transactions: 0, failed: 0, contractCalls: 0, playerCalls: 0 }).get(day);
    d.transactions += 1;
    if (!t.ok) d.failed += 1;
  }
  for (const c of calls) {
    const d = days.get(utcTime(c.ns).slice(0, 10));
    d.contractCalls += 1;
    if (labelOf(c.caller, contract) === "player" && PLAYER_METHODS.includes(c.method)) d.playerCalls += 1;
  }

  return {
    contract,
    fetchedAt: capture.fetchedAt,
    complete: ledgerAccounts.every((a) => accounts[a]?.complete) && accounts[contract]?.receiptsComplete !== false,
    notes: ledgerAccounts.map((a) => accounts[a]?.note).filter(Boolean),
    calls,
    byMethod,
    perAccount,
    transactions: everything.length,
    failedTransactions: everything.filter((t) => !t.ok).length,
    first: everything[0] ?? null,
    last: everything.at(-1) ?? null,
    days: [...days.values()].sort((a, b) => cmpStr(a.day, b.day)),
    milestones: milestones({ contract, calls, txns: [...txns.values()].sort((a, b) => cmpNs(a.ns, b.ns) || cmpStr(a.hash, b.hash)) }),
  };
}

/**
 * The rows worth finding without reading the whole ledger, each found from the data (no hash
 * is written into this script): the contract's creation and every deploy, the first player's
 * hero, the first relayed call and trade, Sandwich Man's creation, seed and first trade,
 * every season record with its trophies, and every owner call. Pure.
 */
export function milestones({ contract, calls, txns }) {
  const out = [];
  const add = (c, label) => c && out.push({ ns: c.ns, hash: c.hash, label, ok: c.ok !== false, by: c.caller ?? c.signer ?? null, signer: c.signer ?? null });
  const firstOk = (pred) => calls.find((c) => c.ok && c.incoming && pred(c));
  add(
    calls.find((c) => c.method.includes("create_account")),
    `\`${contract}\` is created`,
  );
  const deploys = calls.filter((c) => c.method === "deploy_contract");
  deploys.forEach((c, i) => add(c, `Code deployed to the contract, deploy ${i + 1} of ${deploys.length} (${c.detail})`));
  for (const c of calls.filter((x) => x.method === "upgrade")) add(c, "The owner's `upgrade` call");
  add(firstOk((c) => c.method === "register_hero"), "First hero registered (any account)");
  add(firstOk((c) => c.method === "register_hero" && labelOf(c.caller, contract) === "player"), "First player's hero (not the author's, the team's or the NPC's)");
  add(firstOk((c) => c.relayed), `First relayed call (signed by the player, sent by \`${RELAYER}\`)`);
  add(firstOk((c) => c.relayed && MARKET_METHODS.includes(c.method)), "First relayed market trade");
  add(firstOk((c) => c.relayed && MARKET_METHODS.includes(c.method) && labelOf(c.caller, contract) === "player"), "First relayed market trade by a player (not the author's, the team's or the NPC's)");
  for (const npc of NPC_ACCOUNTS) {
    const created = txns.find((t) => t.receiver === npc && t.actions.some((a) => a.kind === "CREATE_ACCOUNT"));
    if (created) add({ ...created, caller: created.signer, ok: created.ok !== false }, `Sandwich Man's account \`${npc}\` is created`);
    add(
      firstOk((c) => c.method === "mint_rewards" && (c.args?.batch ?? []).some((e) => e?.account_id === npc)),
      "Sandwich Man's one-off seed (`mint_rewards` to him)",
    );
    add(firstOk((c) => c.caller === npc && MARKET_METHODS.includes(c.method)), "Sandwich Man's first trade");
  }
  for (const c of calls.filter((x) => x.method === "record_season")) {
    const id = c.args?.season_id ?? "?";
    const top = Array.isArray(c.args?.top10) ? c.args.top10 : [];
    const trophies = top.map((a, i) => `trophy:${id}:${i + 1} to ${a}`).join(", ");
    add(c, `\`record_season\` for ${id}: root and digest written, ${top.length} troph${top.length === 1 ? "y" : "ies"} minted${trophies ? ` (${trophies})` : ""}`);
  }
  for (const c of calls.filter((x) => x.method === "set_rules")) {
    const items = Array.isArray(c.args?.items) ? c.args.items.length : "?";
    const suits = Array.isArray(c.args?.suits) ? c.args.suits.length : "?";
    add(c, `\`set_rules\`: ${items} items, ${suits} suits`);
  }
  // Which pools each call configures for the first time, against the calls before it that went through.
  const pooled = new Set();
  let earlier = false;
  for (const c of calls.filter((x) => x.method === "set_market_params")) {
    const p = c.args?.params ?? {};
    const pools = Array.isArray(c.args?.pools) ? c.args.pools : [];
    const fee = typeof p.fee_bps === "number" ? `fee ${p.fee_bps / 100}% (fee_bps ${p.fee_bps})` : "fee ?";
    const craft = p.craft_bits !== undefined ? `, craft ${p.craft_bits} Bits` : "";
    const named = pools.map((x) => x?.item).filter(Boolean);
    const fresh = named.filter((item) => !pooled.has(item));
    const which = !earlier ? (named.length ? ` (${named.join(", ")})` : "") : `, ${fresh.length} of them new${fresh.length ? ` (${fresh.join(", ")})` : ""}`;
    add(c, `\`set_market_params\`: ${fee}${craft}, ${pools.length} pool${pools.length === 1 ? "" : "s"}${which}`);
    if (c.ok) {
      named.forEach((item) => pooled.add(item));
      earlier = true;
    }
  }
  for (const c of calls.filter((x) => ["set_paused", "add_operator", "remove_operator", "set_owner"].includes(x.method))) {
    const arg = c.args ? Object.values(c.args).map((v) => JSON.stringify(v)).join(", ") : "";
    add(c, `\`${c.method}\`(${arg})`);
  }
  return out.sort((a, b) => cmpNs(a.ns, b.ns) || cmpStr(a.hash, b.hash) || cmpStr(a.label, b.label));
}

/* ------------------------------------------------------------------ pure: Markdown */

const link = (hash, full = false) => `[\`${full ? hash : `${hash.slice(0, 8)}…`}\`](https://nearblocks.io/txns/${hash})`;
const who = (account, contract) => {
  if (!account) return "not listed";
  const l = labelOf(account, contract);
  return l === "player" ? `\`${account}\`` : `\`${account}\` (${l})`;
};
const okText = (ok) => (ok === false ? "**failed**" : "ok");
const near = (yocto) => {
  const n = Number(yocto) / 1e24;
  if (!n) return "";
  return n >= 0.0001 ? n.toFixed(4).replace(/\.?0+$/, "") : "<0.0001";
};
const esc = (s) => String(s).replace(/\|/g, "\\|");

/** What a transaction did, in a few words, from one account's side. */
export function describeTxn(t, account) {
  const fcs = t.actions.filter((a) => a.method);
  const kinds = [...new Set(t.actions.map((a) => a.kind.toLowerCase()))];
  if (t.relayed) return `relayed ${fcs.map((a) => `\`${a.method}\``).join(", ") || kinds.join(" + ")} for ${who(t.player)}`;
  if (t.actions.some((a) => a.kind === "CREATE_ACCOUNT")) return `creates \`${t.receiver}\` (${kinds.join(" + ")})`;
  if (t.actions.some((a) => a.kind === "DEPLOY_CONTRACT")) return `deploys code to \`${t.receiver}\` (${t.actions.map((a) => a.method ?? a.kind.toLowerCase()).join(" + ")})`;
  if (kinds.length === 1 && kinds[0] === "transfer") return t.receiver === account ? `transfer in from ${who(t.signer)}` : `transfer out to ${who(t.receiver)}`;
  if (fcs.length) return `${fcs.map((a) => `\`${a.method}\``).join(", ")} on \`${t.receiver}\``;
  return kinds.join(" + ") || "no actions";
}

const header = (cells) => `| ${cells.join(" | ")} |\n|${cells.map((c) => (/^(#|Calls|Failed|Relayed|Callers|Transactions|Player|Author|Team|NPC|Contract|System|Receipts|Pages)/.test(c) ? "--:" : "---")).join("|")}|`;

export function renderMarkdown(capture) {
  const L = buildLedger(capture);
  const c = L.contract;
  const out = [];
  out.push("# Every transaction of the game's accounts on NEAR mainnet\n");
  out.push(`Generated ${L.fetchedAt} (UTC) by \`${COMMAND}\` (scripts/transactions.mjs). ${METHOD_NOTES.generated}\n`);
  out.push(
    `**Source.** The NearBlocks API (https://api.nearblocks.io/v1), read-only and with no key: every page of \`/account/<id>/txns-only\` (the transactions each account below signed or received) for ${LEDGER_ACCOUNTS.map((a) => `\`${a === DEFAULT_CONTRACT ? c : a}\``).join(", ")}, and every page of \`/account/${c}/txns\` (the receipts the contract received). Each hash links to its page on nearblocks.io. Times are UTC, from the block that included the transaction; a receipt's row carries its transaction's time.\n`,
  );
  if (!L.complete) out.push(`**Partial.** Not every list could be read to the end when this was generated: ${L.notes.join("; ") || "see the per-account table"}. The rows below are what was read.\n`);
  out.push(`**How rows are attributed.** ${METHOD_NOTES.relayed} ${METHOD_NOTES.labels}\n`);
  out.push(`**Failures.** ${METHOD_NOTES.failures} A relayed transaction can succeed as a transaction while the contract call inside it fails; such a row says \"failed in contract\".\n`);

  out.push("## Summary\n");
  const playerCalls = L.calls.filter((x) => labelOf(x.caller, c) === "player" && PLAYER_METHODS.includes(x.method));
  out.push("| | |\n|---|---|");
  out.push(`| Distinct transactions | ${L.transactions} (${L.failedTransactions} failed) |`);
  out.push(`| Receipts \`${c}\` received or sent (rows in its table) | ${L.calls.length} (${L.calls.filter((x) => !x.ok).length} failed) |`);
  out.push(`| Game-method calls by players (not author, team or NPC) | ${playerCalls.length} from ${new Set(playerCalls.map((x) => x.caller)).size} accounts |`);
  out.push(`| Relayed calls (NEP-366, sent by \`${RELAYER}\`) | ${L.calls.filter((x) => x.relayed).length} |`);
  if (L.first) out.push(`| First transaction | ${utcTime(L.first.ns)} ${link(L.first.hash, true)} |`);
  if (L.last) out.push(`| Last transaction | ${utcTime(L.last.ns)} ${link(L.last.hash, true)} |`);
  out.push("");

  out.push("### Per account\n");
  out.push(header(["Account", "Label", "Transactions", "Failed", "First (UTC)", "Last (UTC)", "Read to the end"]));
  for (const a of L.perAccount) {
    out.push(`| [\`${a.account}\`](#${slugFor(a.account)}) | ${a.label} | ${a.rows.length} | ${a.failed} | ${a.first ? utcTime(a.first.ns) : ""} | ${a.last ? utcTime(a.last.ns) : ""} | ${a.read ? (a.complete ? `yes (${a.pages} page${a.pages === 1 ? "" : "s"})` : `no: ${esc(a.note ?? "stopped early")}`) : "not read"} |`);
  }
  out.push(`\n"Transactions" are those the account signed or received (NearBlocks' \`txns-only\`). The contract's relayed calls are transactions to the player's account, so they are counted under \`${RELAYER}\` and appear in the contract's table by their receipts.\n`);

  out.push("### Per method of the contract\n");
  out.push(header(["Method", "Calls", "Failed", "Relayed", "Callers", "Player", "Author", "Team", "NPC", "Contract", "System"]));
  for (const m of L.byMethod) out.push(`| [\`${m.method}\`](#${slugFor(m.method)}) | ${m.calls} | ${m.failed} | ${m.relayed} | ${m.callers} | ${m.by.player} | ${m.by.author} | ${m.by.team} | ${m.by.NPC} | ${m.by.contract} | ${m.by.system} |`);
  out.push(`| **All** | **${L.calls.length}** | **${L.calls.filter((x) => !x.ok).length}** | **${L.calls.filter((x) => x.relayed).length}** | | **${L.byMethod.reduce((n, m) => n + m.by.player, 0)}** | **${L.byMethod.reduce((n, m) => n + m.by.author, 0)}** | **${L.byMethod.reduce((n, m) => n + m.by.team, 0)}** | **${L.byMethod.reduce((n, m) => n + m.by.NPC, 0)}** | **${L.byMethod.reduce((n, m) => n + m.by.contract, 0)}** | **${L.byMethod.reduce((n, m) => n + m.by.system, 0)}** |`);
  out.push(`\nOne row per function call (a receipt with two calls is two rows); a receipt with no function call (the account's creation, a transfer) is one row under its actions in brackets; a deploy is one row under \`deploy_contract\` with the call that came with it. The label columns count calls by the caller's label; System is \`system\`, the protocol account that sends gas refunds.\n`);

  out.push("### Per UTC day\n");
  out.push(header(["Day", "Transactions", "Failed", "Contract receipts", "Player calls"]));
  for (const d of L.days) out.push(`| ${d.day} | ${d.transactions} | ${d.failed} | ${d.contractCalls} | ${d.playerCalls} |`);
  out.push(`\nDays with no transaction are left out. "Player calls" are the game methods (${PLAYER_METHODS.map((m) => `\`${m}\``).join(", ")}) called by player accounts.\n`);

  out.push("## Milestones\n");
  out.push("Found in the rows below by what they did, not typed in by hand.\n");
  out.push(header(["UTC time", "What", "By", "Result", "Transaction"]));
  for (const m of L.milestones) out.push(`| ${utcTime(m.ns)} | ${esc(m.label)} | ${who(m.by, c)}${m.signer && m.signer !== m.by ? `, sent by ${who(m.signer, c)}` : ""} | ${okText(m.ok)} | ${link(m.hash, true)} |`);
  out.push("");

  out.push(`## \`${c}\`\n`);
  out.push(`Every receipt the contract received or sent, grouped by method, oldest first. Caller is the receipt's predecessor; Sent by is the transaction's signer when it is another account (the relayer for a relayed call).\n`);
  for (const m of L.byMethod) {
    out.push(`### ${m.method.startsWith("(") ? m.method : `\`${m.method}\``}\n`);
    out.push(`${m.calls} call${m.calls === 1 ? "" : "s"}, ${m.failed} failed${m.relayed ? `, ${m.relayed} relayed` : ""}.\n`);
    out.push(header(["#", "UTC time", "Caller", "Sent by", "Result", "Transaction"]));
    m.rows.forEach((r, i) => {
      const sentBy = r.signer === null ? "not in the lists read" : r.signer === r.caller ? "itself" : `${who(r.signer, c)}${r.relayed ? ", relayed" : ""}`;
      const extra = r.detail ? `, with ${r.detail}` : !r.incoming ? ` to ${who(r.receiver, c)}` : "";
      out.push(`| ${i + 1} | ${utcTime(r.ns)} | ${who(r.caller, c)}${extra} | ${sentBy} | ${okText(r.ok)} | ${link(r.hash)} |`);
    });
    out.push("");
  }

  for (const a of L.perAccount.filter((x) => x.account !== c)) {
    out.push(`## \`${a.account}\`\n`);
    out.push(`${ACCOUNT_ABOUT[a.account] ?? `Label: ${a.label}.`} Every transaction it signed or received, oldest first: ${a.rows.length}, ${a.failed} failed.\n`);
    if (!a.read) {
      out.push("Not read.\n");
      continue;
    }
    out.push(header(["#", "UTC time", "What", "Signer", "Receiver", "NEAR", "Result", "Transaction"]));
    a.rows.forEach((t, i) => {
      const deposit = near(t.actions.reduce((n, x) => n + Number(x.deposit || 0), 0));
      out.push(`| ${i + 1} | ${utcTime(t.ns)} | ${describeTxn(t, a.account)} | ${who(t.signer, c)} | ${who(t.receiver, c)} | ${deposit} | ${t.status === "ok" ? "ok" : `**${t.status}**`} | ${link(t.hash)} |`);
    });
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

const ACCOUNT_ABOUT = {
  "wgpnear.near": "The owner and factory account (team): it created the contract's, the relayer's, the operator's and Sandwich Man's accounts and players' `*.wgpnear.near` accounts, and it sends the owner's calls to the contract. (The contract's code was deployed by a transaction `game.wgpnear.near` signed itself; see `deploy_contract` above.)",
  "relayer.wgpnear.near": "The relayer (team): it signs and pays for players' relayed calls (NEP-366) and receives the top-ups that keep it running.",
  "operator.wgpnear.near": "The operator (team): it mints verified nights' rewards (`mint_rewards`) and records seasons (`record_season`).",
  "sandwich.wgpnear.near": "Sandwich Man, the NPC trader: his own key signs his market calls. He is never counted as a player.",
};

/** GitHub's heading anchor for a heading that is one code span (an account or a method). */
export function slugFor(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/* ------------------------------------------------------------------ io */

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One NearBlocks list, every page, by cursor. `opts.fetch` and `opts.sleep` are for the tests.
 * A rate limit or a server error is retried (fetchJson's three quick retries, then PATIENCE_S);
 * what still fails ends the list early and says why, keeping the rows already read.
 */
export async function readList(url, opts = {}) {
  const pause = opts.sleep ?? sleepMs;
  const patience = opts.patience ?? PATIENCE_S;
  const gap = opts.gapMs ?? PAGE_GAP_MS;
  const rows = [];
  let cursor = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await pause(gap);
    const pageUrl = `${url}${url.includes("?") ? "&" : "?"}per_page=${opts.perPage ?? PER_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    let body;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchJson(pageUrl, { headers: { accept: "application/json", "user-agent": "wgp-transactions-script" } }, { fetch: opts.fetch, sleep: opts.sleep, waits: opts.waits });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} from ${new URL(pageUrl).host}`), { status: res.status });
        body = await res.json();
        // NearBlocks has answered a rate limit with a message and no rows.
        if (!Array.isArray(body?.txns) && /limit/i.test(String(body?.message ?? ""))) throw Object.assign(new Error(`rate limited: ${body.message}`), { rateLimited: true });
        break;
      } catch (error) {
        const wait = patience[attempt];
        if (!(error.rateLimited || /HTTP 5\d\d|can't be reached|timed out/.test(error.message)) || wait === undefined) return { rows, pages: page - 1, complete: false, note: `page ${page} of ${url.replace(NEARBLOCKS_API, "")} could not be read (${error.message})` };
        opts.onWait?.(wait);
        await pause(wait * 1000);
      }
    }
    const txns = Array.isArray(body?.txns) ? body.txns : [];
    rows.push(...txns);
    opts.onPage?.(page, rows.length);
    cursor = body?.cursor ?? null;
    if (!txns.length || !cursor || txns.length < (opts.perPage ?? PER_PAGE)) return { rows, pages: page, complete: true };
  }
  return { rows, pages: MAX_PAGES, complete: false, note: `stopped after ${MAX_PAGES} pages` };
}

/** Reads every list the ledger needs. Returns a capture `buildLedger` and `renderMarkdown` take. */
export async function collect(opts = {}) {
  const contract = opts.contract ?? DEFAULT_CONTRACT;
  const accounts = {};
  const say = opts.log ?? (() => {});
  for (const account of LEDGER_ACCOUNTS.map((a) => (a === DEFAULT_CONTRACT ? contract : a))) {
    say(`  ${account}: transactions…`);
    const t = await readList(`${NEARBLOCKS_API}/account/${encodeURIComponent(account)}/txns-only`, opts);
    accounts[account] = { txns: t.rows, pages: t.pages, complete: t.complete, ...(t.note ? { note: t.note } : {}) };
    if (account === contract) {
      say(`  ${account}: receipts…`);
      const r = await readList(`${NEARBLOCKS_API}/account/${encodeURIComponent(account)}/txns`, opts);
      accounts[account].receipts = r.rows;
      accounts[account].receiptPages = r.pages;
      accounts[account].receiptsComplete = r.complete;
      if (!r.complete) accounts[account].note = [accounts[account].note, `receipts: ${r.note}`].filter(Boolean).join("; ");
      if (!r.complete) accounts[account].complete = false;
    }
  }
  return { fetchedAt: (opts.now ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z"), source: NEARBLOCKS_API, contract, accounts };
}

/* ------------------------------------------------------------------ main */

const HELP = `Usage: node scripts/transactions.mjs [--offline <capture.json>] [--save <capture.json>] [--out <file>] [--stdout]

  --offline <file>  render from a saved capture (no network)
  --save <file>     keep NearBlocks' raw answers, to render again with --offline
  --out <file>      where to write (default ${OUT})
  --stdout          print the Markdown instead of writing it
`;

function parseCli(argv) {
  const out = { offline: null, save: null, out: OUT, stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--offline") out.offline = value();
    else if (arg === "--save") out.save = value();
    else if (arg === "--out") out.out = value();
    else if (arg === "--stdout") out.stdout = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  let capture;
  if (args.offline) capture = JSON.parse(fs.readFileSync(path.resolve(args.offline), "utf8"));
  else {
    console.error(`Reading NearBlocks (${NEARBLOCKS_API}), read-only…`);
    capture = await collect({
      log: (line) => console.error(line),
      onWait: (s) => console.error(`    NearBlocks is refusing; waiting ${s} s…`),
      onPage: (page, n) => console.error(`    page ${page}: ${n} rows`),
    });
    if (args.save) fs.writeFileSync(path.resolve(args.save), `${JSON.stringify(capture)}\n`);
  }
  const md = renderMarkdown(capture);
  if (args.stdout) process.stdout.write(md);
  else {
    fs.writeFileSync(path.resolve(ROOT, args.out), md);
    console.error(`Wrote ${args.out} (${md.length} bytes).`);
  }
  return buildLedger(capture).complete ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
