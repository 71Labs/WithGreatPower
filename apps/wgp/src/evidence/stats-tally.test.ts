/**
 * `pnpm stats`' tally of the contract's NearBlocks rows, run on a fixture. The README's
 * on-chain table is this tally's output, so what the table's rows mean is settled here:
 * function calls are counted apart from receipts that carry none, Sandwich Man is never a
 * player, the author's account is a player and is named as one, and the split of activity
 * is worked out by the script. A second test ties every number in the README's table to the
 * field `pnpm evidence --chain` compares it with.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOT, evidence, read } from "./repo";

interface Tally {
  receipts: number;
  functionCalls: number;
  failedFunctionCalls: number;
  otherReceipts: number;
  failedOtherReceipts: number;
  failed: number;
  byMethod: Record<string, number>;
  otherActions: Record<string, number>;
  playerAccounts: number;
  players: { accounts: number; authorAccounts: string[]; withOneCall: number; withMoreThanOneCall: number; calls: number; marketAccounts: number; marketCalls: number; marketCallsTopTwo: number; marketCallsByAuthor: number };
  npcCalls: number;
}
const script = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts/stats.mjs")).href)) as { tallyRows(rows: unknown[], contract?: string): Tally };

const GAME = "game.wgpnear.near";
let n = 0;
const row = (from: string, actions: { action: string; method: string | null }[], ok = true) => ({ receipt_id: `r${++n}`, predecessor_account_id: from, receiver_account_id: GAME, actions, outcomes: { status: ok } });
const call = (from: string, method: string, ok = true) => row(from, [{ action: "FUNCTION_CALL", method }], ok);
const transfer = (from: string, ok = true) => row(from, [{ action: "TRANSFER", method: null }], ok);

/** A small contract history with one of everything the real one has. */
const FIXTURE = [
  // Setup: the account's creation, a failed first deploy with its refund, the deploy that stuck, the market's opening, a top-up.
  row("wgpnear.near", [{ action: "CREATE_ACCOUNT", method: null }, { action: "TRANSFER", method: null }, { action: "ADD_KEY", method: null }]),
  row(GAME, [{ action: "DEPLOY_CONTRACT", method: null }, { action: "FUNCTION_CALL", method: "new" }], false),
  transfer("system", false),
  row(GAME, [{ action: "DEPLOY_CONTRACT", method: null }, { action: "FUNCTION_CALL", method: "new" }]),
  transfer("system"),
  call("wgpnear.near", "set_market_params"),
  transfer("relayer.wgpnear.near"),
  // The operator's mints, one of them the NPC's seed.
  call("operator.wgpnear.near", "mint_rewards"),
  call("operator.wgpnear.near", "mint_rewards"),
  call("operator.wgpnear.near", "mint_rewards"),
  // Players: one busy trader, one who crafts and trades a little, two who only registered, and the author.
  call("alice.wgpnear.near", "register_hero"),
  call("alice.wgpnear.near", "market_buy"),
  call("alice.wgpnear.near", "market_sell"),
  call("alice.wgpnear.near", "list_item"),
  call("bob.near", "register_hero"),
  call("bob.near", "craft_suit"),
  call("bob.near", "buy_listing"),
  call("carol.wgpnear.near", "register_hero"),
  call("dave.wgpnear.near", "register_hero"),
  call("sele.wgpnear.near", "register_hero"),
  call("sele.wgpnear.near", "market_buy"),
  // The NPC trader: real market calls, from an account that is not a player.
  call("sandwich.wgpnear.near", "market_buy"),
  call("sandwich.wgpnear.near", "list_item"),
];

describe("pnpm stats' tally, on a fixture", () => {
  it("counts function calls apart from receipts that carry none", async () => {
    const t = (await script()).tallyRows(FIXTURE, GAME);
    expect(t.receipts).toBe(FIXTURE.length);
    // Four rows are not calls: the creation, two refunds and the top-up.
    expect(t.otherReceipts).toBe(4);
    expect(t.functionCalls).toBe(FIXTURE.length - 4);
    expect(t.functionCalls + t.otherReceipts).toBe(t.receipts);
    // A deploy's `new` is a function call; its DEPLOY_CONTRACT action is listed with the other actions.
    expect(t.byMethod.new).toBe(2);
    expect(t.otherActions).toEqual({ transfer: 4, deploy_contract: 2, add_key: 1, create_account: 1 });
    // Two rows failed, and one of them carried a function call.
    expect(t.failed).toBe(2);
    expect(t.failedFunctionCalls).toBe(1);
    expect(t.failedOtherReceipts).toBe(1);
    // The methods add up to the function calls, and no non-call is among them.
    expect(Object.values(t.byMethod).reduce((a, b) => a + b, 0)).toBe(t.functionCalls);
    expect(Object.keys(t.byMethod).some((m) => m.startsWith("("))).toBe(false);
  });

  it("never counts Sandwich Man as a player: his calls are on their own line", async () => {
    const { tallyRows } = await script();
    const t = tallyRows(FIXTURE, GAME);
    expect(t.npcCalls).toBe(2);
    expect(t.players.accounts).toBe(5);
    expect(t.playerAccounts).toBe(5);
    // His market calls are in the methods, and in nobody's player figures.
    expect(t.byMethod.market_buy).toBe(3);
    expect(t.players.marketCalls).toBe(5);
    // Take him out and no player figure moves; leave only him and there are no players at all.
    const without = tallyRows(FIXTURE.filter((r) => r.predecessor_account_id !== "sandwich.wgpnear.near"), GAME);
    expect(without.players).toEqual(t.players);
    expect(without.npcCalls).toBe(0);
    const onlyHim = tallyRows(FIXTURE.filter((r) => r.predecessor_account_id === "sandwich.wgpnear.near"), GAME);
    expect(onlyHim.players.accounts).toBe(0);
    expect(onlyHim.npcCalls).toBe(2);
  });

  it("leaves out the game's own senders, and counts the author's account as a player and says so", async () => {
    const t = (await script()).tallyRows(FIXTURE, GAME);
    // The operator, the relayer, the owner, `system` and the contract itself are not players.
    expect(t.players.accounts).toBe(5);
    expect(t.players.authorAccounts).toEqual(["sele.wgpnear.near"]);
    expect(t.players.marketCallsByAuthor).toBe(1);
    const noAuthor = (await script()).tallyRows(FIXTURE.filter((r) => r.predecessor_account_id !== "sele.wgpnear.near"), GAME);
    expect(noAuthor.players.authorAccounts).toEqual([]);
    expect(noAuthor.players.accounts).toBe(4);
  });

  it("works out the split: who called once, and how concentrated the market is", async () => {
    const t = (await script()).tallyRows(FIXTURE, GAME);
    expect(t.players.withOneCall).toBe(2);
    expect(t.players.withMoreThanOneCall).toBe(3);
    expect(t.players.withOneCall + t.players.withMoreThanOneCall).toBe(t.players.accounts);
    expect(t.players.calls).toBe(11);
    expect(t.players.marketAccounts).toBe(3);
    expect(t.players.marketCalls).toBe(5);
    // alice made 3 of the 5 and the next busiest 1.
    expect(t.players.marketCallsTopTwo).toBe(4);
  });

  it("never counts one receipt twice", async () => {
    const t = (await script()).tallyRows([...FIXTURE, ...FIXTURE.slice(0, 5)], GAME);
    expect(t.receipts).toBe(FIXTURE.length);
  });
});

describe("the README's on-chain table is bound to that tally", () => {
  interface Expect {
    path: string;
    op: string;
    doc?: string;
    source?: string;
  }
  const expects = (evidence().checks as unknown as Record<string, { expect: Expect[] }>)["chain-tally"]!.expect;
  const readme = read("README.md");
  const table = readme.slice(readme.indexOf("**On NEAR mainnet**"), readme.indexOf("**In the game**"));

  it("every number in the table, the ones in brackets included, is read by a check on a named field of the tally", () => {
    // Each pattern the check uses, applied to the table: the digits it captures.
    const bound = new Set<number>();
    for (const e of expects.filter((x) => x.doc && (x.source ?? "README.md") === "README.md")) {
      const m = new RegExp(e.doc!, "d").exec(readme) as (RegExpExecArray & { indices: [number, number][] }) | null;
      expect(m, `${e.path}: /${e.doc}/ finds nothing in the README`).not.toBeNull();
      bound.add(m!.indices[1]![0]);
    }
    const start = readme.indexOf(table);
    const numbers = [...table.matchAll(/\| [^|\n]*\| ([^|\n]*) \|\n/g)].flatMap((rowMatch) => {
      const cellAt = start + rowMatch.index! + rowMatch[0].lastIndexOf(rowMatch[1]!);
      return [...rowMatch[1]!.matchAll(/\d[\d,]*/g)].map((d) => ({ at: cellAt + d.index!, text: d[0], row: rowMatch[0].trim() }));
    });
    expect(numbers.length).toBeGreaterThanOrEqual(15);
    // One number is arithmetic on two bound ones (the accounts that made exactly one call); the next test checks it.
    const derived = /so (\d+) made exactly one/.exec(table)!;
    const unbound = numbers.filter((x) => !bound.has(x.at) && x.text !== derived[1]);
    expect(unbound.map((x) => `${x.text} in ${x.row}`), "numbers in the table that no check reads").toEqual([]);
  });

  it("names the fields a reader would expect for the rows that changed meaning", () => {
    const pathFor = (needle: string) => expects.find((e) => e.doc?.includes(needle))?.path;
    expect(pathFor("Function calls to")).toBe("json.chain.functionCalls");
    expect(pathFor("Other receipts")).toBe("json.chain.otherReceipts");
    expect(expects.some((e) => e.path === "json.chain.failedFunctionCalls" && e.doc)).toBe(true);
    expect(expects.some((e) => e.path === "json.chain.failedOtherReceipts" && e.doc)).toBe(true);
    expect(expects.some((e) => e.path === "json.chain.players.withMoreThanOneCall" && e.doc)).toBe(true);
    expect(expects.some((e) => e.path === "json.chain.players.marketCallsTopTwo" && e.doc)).toBe(true);
    // The author's account is asserted to be among the players, as the row says.
    expect(expects.some((e) => e.path === "json.chain.players.authorAccounts" && e.op === "includes")).toBe(true);
  });

  it("the one derived figure is the arithmetic it says it is", () => {
    const accounts = Number(/Sandwich Man is not\) \| ([\d,]+)/.exec(table)![1]);
    const m = /\| (\d+), so (\d+) made exactly one \|/.exec(table)!;
    expect(Number(m[1]) + Number(m[2])).toBe(accounts);
    // And the README no longer calls NearBlocks' rows "calls".
    expect(table).not.toMatch(/\| Calls to `game\.wgpnear\.near`/);
    expect(readme).toContain("The player accounts include the author's own, `sele.wgpnear.near`");
  });
});
