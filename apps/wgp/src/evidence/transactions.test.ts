/**
 * `pnpm txs` (scripts/transactions.mjs), run on small recorded fixtures with no network: how
 * the contract's receipts are grouped by method, how a relayed call is attributed, which
 * accounts are labelled the author's, the team's or the NPC's, that failures are listed, which
 * milestones are found, that the output does not depend on the order rows arrive in, and how
 * NearBlocks' pages and rate limits are handled. docs/TRANSACTIONS.md is this output on mainnet.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOT } from "./repo";

interface Call {
  hash: string;
  method: string;
  caller: string;
  signer: string | null;
  relayed: boolean;
  ok: boolean;
}
interface MethodGroup {
  method: string;
  calls: number;
  failed: number;
  relayed: number;
  by: Record<string, number>;
}
interface Milestone {
  hash: string;
  label: string;
  ok: boolean;
}
interface Ledger {
  complete: boolean;
  calls: Call[];
  byMethod: MethodGroup[];
  perAccount: { account: string; label: string; rows: { hash: string; status: string }[]; failed: number }[];
  transactions: number;
  failedTransactions: number;
  milestones: Milestone[];
  days: { day: string; transactions: number }[];
}
interface Capture {
  fetchedAt: string;
  contract?: string;
  accounts: Record<string, { txns: unknown[]; receipts?: unknown[]; complete: boolean; pages: number; note?: string }>;
}
interface FakeResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}
interface Script {
  LEDGER_ACCOUNTS: string[];
  METHOD_NOTES: Record<string, string>;
  COMMAND: string;
  labelOf(account: string): string;
  buildLedger(capture: Capture): Ledger;
  renderMarkdown(capture: Capture): string;
  readList(
    url: string,
    opts: { fetch: (url: string) => Promise<FakeResponse>; sleep: (ms: number) => Promise<void>; waits?: number[]; patience?: number[]; perPage?: number; gapMs?: number },
  ): Promise<{ rows: unknown[]; pages: number; complete: boolean; note?: string }>;
}
const script = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts/transactions.mjs")).href)) as Script;

const GAME = "game.wgpnear.near";
const OWNER = "wgpnear.near";
const RELAYER = "relayer.wgpnear.near";
const OPERATOR = "operator.wgpnear.near";
const NPC = "sandwich.wgpnear.near";
const ns = (iso: string) => `${BigInt(Date.parse(iso)) * 1_000_000n}`;
const fc = (method: string, args: unknown = {}, deposit = 0) => ({ action: "FUNCTION_CALL", method, deposit, args: JSON.stringify(args) });
const act = (action: string, deposit = 0) => ({ action, method: null, deposit, args: null });

/** A receipt as NearBlocks' /account/<id>/txns lists it. */
const receipt = (id: string, hash: string, from: string, iso: string, actions: unknown[], ok = true, to = GAME) => ({
  receipt_id: id,
  predecessor_account_id: from,
  receiver_account_id: to,
  transaction_hash: hash,
  block_timestamp: ns(iso),
  actions,
  outcomes: { status: ok },
});
/** A transaction as NearBlocks' /account/<id>/txns-only lists it. */
const txn = (hash: string, signer: string, receiver: string, iso: string, actions: unknown[], ok = true) => ({
  transaction_hash: hash,
  signer_account_id: signer,
  receiver_account_id: receiver,
  block_timestamp: ns(iso),
  actions,
  outcomes: { status: ok },
});
const relayed = (hash: string, player: string, iso: string, method: string, args: unknown = {}) => txn(hash, RELAYER, player, iso, [act("DELEGATE_ACTION"), fc(method, args)]);

const ITEMS = ["fee-bomb", "goblin-glider", "crumbs", "sesame-seed", "chain-link", "spare-arm", "sybil-goo", "press-pass", "gas-receipt", "finality-flag", "evidence-bag", "seed-phrase"];
const SUITS = ["classic", "midnight", "mint", "snow", "stealth", "glider", "octo", "sesame", "notary", "finality"].map((id) => ({ id }));
const POOLS = ["gas-receipt", "finality-flag", "evidence-bag", "seed-phrase"].map((item) => ({ item }));

const T = {
  create: txn("H01create", OWNER, GAME, "2026-11-04T10:00:00Z", [act("CREATE_ACCOUNT"), act("TRANSFER", 5e24), act("ADD_KEY")]),
  deploy: txn("H02deploy", OWNER, GAME, "2026-11-04T10:05:00Z", [act("DEPLOY_CONTRACT"), fc("new")]),
  authorHero: txn("H03author", "sele.wgpnear.near", GAME, "2026-11-04T11:00:00Z", [fc("register_hero", { name: "Sele", suit: "classic" })]),
  playerAcct: txn("H03bcreate", OWNER, "alice.wgpnear.near", "2026-11-04T11:30:00Z", [act("CREATE_ACCOUNT"), act("ADD_KEY")]),
  playerHero: relayed("H04hero", "alice.wgpnear.near", "2026-11-04T12:00:00Z", "register_hero", { name: "Alice", suit: "mint" }),
  buyFailed: relayed("H05fail", "bob.near", "2026-11-05T13:00:00Z", "market_buy", { item: "crumbs", amount: 1, max_bits: "20" }),
  buyOk: relayed("H06buy", "bob.near", "2026-11-05T13:30:00Z", "market_buy", { item: "crumbs", amount: 1, max_bits: "20" }),
  topUp: txn("H06btopup", "sele71.near", RELAYER, "2026-11-06T08:00:00Z", [act("TRANSFER", 1e24)]),
  npcCreate: txn("H06cnpc", OWNER, NPC, "2026-11-13T07:03:00Z", [act("CREATE_ACCOUNT"), act("TRANSFER", 3e23), act("ADD_KEY")]),
  seed: txn("H07seed", OPERATOR, GAME, "2026-11-13T07:12:00Z", [fc("mint_rewards", { batch: [{ account_id: NPC, bits: "300" }] })]),
  npcBuy: txn("H08npc", NPC, GAME, "2026-11-13T07:15:00Z", [fc("market_buy", { item: "sybil-goo", amount: 2, max_bits: "80" })]),
  upgrade: txn("H09upgrade", OWNER, GAME, "2026-11-14T09:00:00Z", [fc("upgrade")]),
  season: txn("H10season", OPERATOR, GAME, "2026-11-15T01:26:00Z", [fc("record_season", { season_id: "s1", root: "ab", top10: ["alice.wgpnear.near", "bob.near"], digest: "cd" })]),
  rules: txn("H11rules", OWNER, GAME, "2026-11-15T02:00:00Z", [fc("set_rules", { items: ITEMS, suits: SUITS, starter_unlock_level: 2 })]),
  params: txn("H12params", OWNER, GAME, "2026-11-15T02:01:00Z", [fc("set_market_params", { params: { fee_bps: 500, craft_bits: "250", open: true }, pools: POOLS })]),
};

const RECEIPTS = [
  receipt("r01", "H01create", OWNER, "2026-11-04T10:00:00Z", T.create.actions),
  receipt("r02", "H02deploy", OWNER, "2026-11-04T10:05:00Z", T.deploy.actions),
  receipt("r03", "H03author", "sele.wgpnear.near", "2026-11-04T11:00:00Z", T.authorHero.actions),
  // A relayed call reaches the contract with the player, not the relayer, as its predecessor.
  receipt("r04", "H04hero", "alice.wgpnear.near", "2026-11-04T12:00:01Z", [fc("register_hero", { name: "Alice", suit: "mint" })]),
  receipt("r05", "H05fail", "bob.near", "2026-11-05T13:00:01Z", [fc("market_buy", { item: "crumbs", amount: 1, max_bits: "20" })], false),
  receipt("r06", "H06buy", "bob.near", "2026-11-05T13:30:01Z", [fc("market_buy", { item: "crumbs", amount: 1, max_bits: "20" })]),
  receipt("r07", "H07seed", OPERATOR, "2026-11-13T07:12:00Z", T.seed.actions),
  receipt("r08", "H08npc", NPC, "2026-11-13T07:15:00Z", T.npcBuy.actions),
  receipt("r09", "H09upgrade", OWNER, "2026-11-14T09:00:00Z", T.upgrade.actions),
  receipt("r09b", "H09upgrade", GAME, "2026-11-14T09:00:01Z", [act("DEPLOY_CONTRACT"), fc("migrate")]),
  receipt("r10", "H10season", OPERATOR, "2026-11-15T01:26:00Z", T.season.actions),
  receipt("r11", "H11rules", OWNER, "2026-11-15T02:00:00Z", T.rules.actions),
  receipt("r12", "H12params", OWNER, "2026-11-15T02:01:00Z", T.params.actions),
];

function capture(shuffle = false): Capture {
  const order = <X>(xs: X[]): X[] => (shuffle ? [...xs].reverse().concat(xs.slice(0, 2)) : xs);
  const list = (txns: unknown[], receipts?: unknown[]) => ({ txns: order(txns), ...(receipts ? { receipts: order(receipts) } : {}), complete: true, pages: 1 });
  return {
    fetchedAt: "2026-11-15T03:00:00Z",
    contract: GAME,
    accounts: {
      [GAME]: list([T.create, T.deploy, T.authorHero, T.seed, T.npcBuy, T.upgrade, T.season, T.rules, T.params], RECEIPTS),
      [OWNER]: list([T.create, T.deploy, T.playerAcct, T.npcCreate, T.upgrade, T.rules, T.params]),
      [RELAYER]: list([T.playerHero, T.buyFailed, T.buyOk, T.topUp]),
      [OPERATOR]: list([T.seed, T.season]),
      [NPC]: list([T.npcCreate, T.npcBuy]),
    },
  };
}

const response = (status: number, body: unknown): FakeResponse => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe("pnpm txs, on recorded fixtures", () => {
  it("groups the contract's receipts by method in a fixed order, one row per call, deploys on their own line", async () => {
    const s = await script();
    const L = s.buildLedger(capture());
    expect(L.byMethod.map((m) => [m.method, m.calls])).toEqual([
      ["register_hero", 2],
      ["market_buy", 3],
      ["mint_rewards", 1],
      ["record_season", 1],
      ["deploy_contract", 2],
      ["upgrade", 1],
      ["set_rules", 1],
      ["set_market_params", 1],
      ["(create_account + transfer + add_key)", 1],
    ]);
    expect(L.calls).toHaveLength(RECEIPTS.length);
    // Each list's transactions plus the relayed ones, each once, though lists overlap.
    expect(L.transactions).toBe(Object.keys(T).length);
    expect(s.LEDGER_ACCOUNTS).toEqual([GAME, OWNER, RELAYER, OPERATOR, NPC]);
  });

  it("attributes a relayed call to the player who signed it and names the relayer that sent it", async () => {
    const s = await script();
    const L = s.buildLedger(capture());
    const hero = L.calls.find((c) => c.hash === "H04hero")!;
    expect(hero).toMatchObject({ caller: "alice.wgpnear.near", signer: RELAYER, relayed: true });
    const own = L.calls.find((c) => c.hash === "H08npc")!;
    expect(own).toMatchObject({ caller: NPC, signer: NPC, relayed: false });
    const md = s.renderMarkdown(capture());
    expect(md).toContain("| 2 | 2026-11-04 12:00:01 | `alice.wgpnear.near` | `relayer.wgpnear.near` (team), relayed | ok | [`H04hero…`](https://nearblocks.io/txns/H04hero) |");
    expect(md).toContain("| 3 | 2026-11-13 07:15:00 | `sandwich.wgpnear.near` (NPC) | itself | ok |");
    // In the relayer's own table the same transaction names the player it was relayed for.
    expect(md).toContain("| relayed `register_hero` for `alice.wgpnear.near` | `relayer.wgpnear.near` (team) | `alice.wgpnear.near` |");
    expect(md).toContain(s.METHOD_NOTES.relayed);
  });

  it("labels the author's, the team's and the NPC's accounts and keeps them out of the player columns", async () => {
    const s = await script();
    expect(["sele.wgpnear.near", "sele71.near"].map(s.labelOf)).toEqual(["author", "author"]);
    expect([OWNER, OPERATOR, RELAYER].map(s.labelOf)).toEqual(["team", "team", "team"]);
    expect([s.labelOf(NPC), s.labelOf(GAME), s.labelOf("alice.wgpnear.near")]).toEqual(["NPC", "contract", "player"]);
    const L = s.buildLedger(capture());
    const by = (m: string) => L.byMethod.find((g) => g.method === m)!.by;
    expect(by("register_hero")).toMatchObject({ player: 1, author: 1 });
    expect(by("market_buy")).toMatchObject({ player: 2, NPC: 1 });
    const md = s.renderMarkdown(capture());
    expect(md).toContain("| 1 | 2026-11-04 11:00:00 | `sele.wgpnear.near` (author) | itself | ok |");
    expect(md).toContain("| Game-method calls by players (not author, team or NPC) | 3 from 2 accounts |");
    expect(md).toContain("transfer in from `sele71.near` (author)");
    expect(md).toContain(s.METHOD_NOTES.labels);
  });

  it("lists failed receipts and counts them, never drops them", async () => {
    const s = await script();
    const L = s.buildLedger(capture());
    expect(L.byMethod.find((g) => g.method === "market_buy")!.failed).toBe(1);
    expect(L.failedTransactions).toBe(1);
    // The relayed transaction went through; the call inside it failed, and the relayer's table says so.
    const relayer = L.perAccount.find((a) => a.account === RELAYER)!;
    expect(relayer.rows.find((r) => r.hash === "H05fail")!.status).toBe("failed in contract");
    expect(relayer.failed).toBe(1);
    const md = s.renderMarkdown(capture());
    expect(md).toContain("| 1 | 2026-11-05 13:00:01 | `bob.near` | `relayer.wgpnear.near` (team), relayed | **failed** | [`H05fail…`](https://nearblocks.io/txns/H05fail) |");
    expect(md).toContain("| **failed in contract** | [`H05fail…`]");
    expect(md).toContain(s.METHOD_NOTES.failures);
  });

  it("finds the milestones from what the rows did: deploys, first player hero and relayed trade, Sandwich Man, the season record and the owner's calls", async () => {
    const s = await script();
    const found = Object.fromEntries(s.buildLedger(capture()).milestones.map((m) => [m.label, m.hash]));
    expect(found).toEqual({
      "`game.wgpnear.near` is created": "H01create",
      "Contract code deployed (deploy_contract + new)": "H02deploy",
      "First hero registered (any account)": "H03author",
      // The author's hero came first; the first player's is the relayed one after it.
      "First player's hero (not the author's, the team's or the NPC's)": "H04hero",
      "First relayed call (signed by the player, sent by `relayer.wgpnear.near`)": "H04hero",
      // The first relayed buy failed; the first that went through is the milestone.
      "First relayed market trade": "H06buy",
      "First market call by a player": "H06buy",
      "Sandwich Man's account `sandwich.wgpnear.near` is created": "H06cnpc",
      "Sandwich Man's one-off seed (`mint_rewards` to him)": "H07seed",
      "Sandwich Man's first trade": "H08npc",
      "The owner's `upgrade` call": "H09upgrade",
      "Contract code upgraded, deploy 2 (deploy_contract + migrate)": "H09upgrade",
      "`record_season` for s1: root and digest written, 2 trophies minted (trophy:s1:1 to alice.wgpnear.near, trophy:s1:2 to bob.near)": "H10season",
      "`set_rules`: 12 items, 10 suits": "H11rules",
      "`set_market_params`: fee 5% (fee_bps 500), craft 250 Bits, 4 pools (gas-receipt, finality-flag, evidence-bag, seed-phrase)": "H12params",
    });
    const md = s.renderMarkdown(capture());
    expect(md).toContain("[`H10season`](https://nearblocks.io/txns/H10season)");
  });

  it("renders the same bytes whatever order the rows arrive in, duplicates included", async () => {
    const s = await script();
    const once = s.renderMarkdown(capture());
    expect(s.renderMarkdown(capture())).toBe(once);
    expect(s.renderMarkdown(capture(true))).toBe(once);
    // Oldest first, everywhere: the day table and the contract's first group.
    expect(s.buildLedger(capture(true)).days.map((d) => d.day)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });

  it("states its source, its generation time and the command at the top", async () => {
    const s = await script();
    const md = s.renderMarkdown(capture());
    const top = md.split("## Summary")[0]!;
    expect(top).toContain("Generated 2026-11-15T03:00:00Z (UTC) by `pnpm txs`");
    expect(top).toContain("The NearBlocks API (https://api.nearblocks.io/v1), read-only and with no key");
    expect(top).toContain(s.METHOD_NOTES.generated);
    expect(top).not.toContain("**Partial.**");
  });

  it("reads every page by NearBlocks' cursor and waits out a rate limit", async () => {
    const s = await script();
    const urls: string[] = [];
    const waited: number[] = [];
    const answers = [
      response(200, { cursor: "c1", txns: [{ transaction_hash: "a" }, { transaction_hash: "b" }] }),
      response(429, {}),
      // NearBlocks has also answered a rate limit with a message and no rows.
      response(200, { message: "You have exceeded your API request limit." }),
      response(200, { cursor: "c2", txns: [{ transaction_hash: "c" }] }),
    ];
    const fetch = async (url: string) => {
      urls.push(url);
      return answers.shift()!;
    };
    const got = await s.readList("https://api.nearblocks.io/v1/account/x/txns-only", { fetch, sleep: async (ms) => void waited.push(ms), waits: [], patience: [1, 2], perPage: 2, gapMs: 0 });
    expect(got).toMatchObject({ pages: 2, complete: true });
    expect(got.rows).toHaveLength(3);
    expect(urls[0]).toBe("https://api.nearblocks.io/v1/account/x/txns-only?per_page=2");
    expect(urls.slice(1)).toEqual(Array(3).fill("https://api.nearblocks.io/v1/account/x/txns-only?per_page=2&cursor=c1"));
    expect(waited).toEqual([0, 1000, 2000]);
  });

  it("keeps what it read when a list can't be finished, and says so at the top", async () => {
    const s = await script();
    let n = 0;
    const fetch = async () => (n++ === 0 ? response(200, { cursor: "c1", txns: [{ transaction_hash: "a" }, { transaction_hash: "b" }] }) : response(429, {}));
    const got = await s.readList("https://api.nearblocks.io/v1/account/x/txns-only", { fetch, sleep: async () => {}, waits: [], patience: [1], perPage: 2, gapMs: 0 });
    expect(got).toMatchObject({ pages: 1, complete: false });
    expect(got.rows).toHaveLength(2);
    expect(got.note).toContain("page 2 of /account/x/txns-only could not be read");
    const partial = capture();
    partial.accounts[OPERATOR] = { ...partial.accounts[OPERATOR]!, complete: false, note: got.note };
    const md = s.renderMarkdown(partial);
    expect(s.buildLedger(partial).complete).toBe(false);
    expect(md.split("## Summary")[0]).toContain("**Partial.** Not every list could be read to the end");
  });

  it("--offline renders a saved capture without the network, the same bytes as the function", async () => {
    const s = await script();
    const dir = mkdtempSync(path.join(tmpdir(), "wgp-txs-"));
    try {
      const file = path.join(dir, "capture.json");
      writeFileSync(file, JSON.stringify(capture()));
      const res = spawnSync(process.execPath, [path.join(ROOT, "scripts/transactions.mjs"), "--offline", file, "--stdout"], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stdout).toBe(s.renderMarkdown(capture()));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
