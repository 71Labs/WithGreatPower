/**
 * Guards on the evidence layer's own honesty, added after a cold read found rows that would
 * have passed with their claim false: what each status may rest on, that a count the README
 * states is a bound the live figure is held to, that "five different players" is counted,
 * that an NPC "holding Bits" can't hold nothing, and that the wording about who reviewed
 * contract v3 and whose limit Sandwich Man's five calls are is the same everywhere.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOT, TOP_DOCS, evidence, plainDoc, read } from "./repo";

interface Expect {
  path: string;
  op: string;
  value?: unknown;
  doc?: string;
  source?: string;
}
interface Check {
  kind: string;
  about: string;
  expect?: Expect[];
  of?: string[];
  account?: string;
  url?: string;
}
interface Script {
  STATUSES: string[];
  expectProblem(value: unknown, e: Expect): string | null;
  resolveExpect(e: Expect, readDoc?: (rel: string) => string): Expect & { value?: unknown };
  distinctSenders(senders: string[]): { accounts: string[]; count: number; transactions: number };
  holdingsOf(player: unknown, account: unknown): { bits: number; items: number; listed: number; total: number };
  renderMarkdown(data: unknown): string;
}
const script = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts/evidence.mjs")).href)) as Script;
const data = evidence();
const checks = data.checks as unknown as Record<string, Check>;
const claim = (id: string) => {
  const c = data.claims.find((x) => x.id === id);
  if (!c) throw new Error(`no claim ${id}`);
  return c;
};

const E = "apps/wgp/src/evidence/";
/**
 * The cited tests that only read: they compare a document's words with source text, a constant,
 * a config file or a lockfile, and run none of the behaviour. file -> name prefixes ("*": all).
 */
const TEXT_ONLY: Record<string, string[]> = {
  [`${E}readme-flow.test.ts`]: ["every button and label", "every page the README names", "the keys the README gives", "the market step is in two labelled parts"],
  [`${E}readme-numbers.test.ts`]: ["the market: fee, pools", "the app's market defaults", "the Bits a night earns", "the ways to play: how many", "the verifier's limits", "rewards, the relayer", "Sandwich Man's limits", "the other docs:", "the starting prices", "the contract's unit-test count", "the bot's scores under Limits", "the deployed code hash", "suits are cosmetic, as the README says", "the relayer's budgets, the reward entry's limits"],
  [`${E}built-not-live.test.ts`]: ["*"],
  [`${E}claims-precise.test.ts`]: ["pnpm stats' duration", "the documents state those bounds", "names all three sources", "the three /api/cron routes", "the libraries the README credits", "every file the disclosures", "each chapter document", "ARCHITECTURE.md's route table"],
  [`${E}readme-evidence.test.ts`]: ["states the real order", "says in every place", "discloses his seed", "dates the live counts", "every row of", "every transaction the README lists", "every evidence link", "the README has the Evidence section"],
  [`${E}docs-links.test.ts`]: ["*"],
  [`${E}evidence-honesty.test.ts`]: ["says who reviewed contract v3", "says whose limit his five calls are", "the README opens with", "are the five the README counts"],
};
const textOnly = (t: { file: string; name: string }) => (TEXT_ONLY[t.file] ?? []).some((p) => p === "*" || t.name.startsWith(p));

describe("what a status may rest on", () => {
  it("a proven by test row cites a test that runs code, and a pinned by test row cites only tests that read", async () => {
    const { STATUSES } = await script();
    expect(STATUSES).toContain("pinned by test");
    const pinned = data.claims.filter((c) => c.status === "pinned by test");
    expect(pinned.length).toBeGreaterThan(0);
    for (const c of pinned) expect((c.tests ?? []).every(textOnly), `${c.id} is pinned by test but cites a test that isn't on the read-only list`).toBe(true);
    // A row that only reads text, with nothing else behind it, may not say "proven". (A row that also
    // carries the suites' own pass counts is proven by those suites running.)
    const overstated = data.claims.filter((c) => c.status === "proven by test" && (c.tests ?? []).every(textOnly) && !(c.counts ?? []).length).map((c) => c.id);
    expect(overstated, "these rows say proven by test and cite only tests that read text: mark them pinned by test").toEqual([]);
  });

  it("the two definitions say that, in EVIDENCE.md and in the README", async () => {
    const md = read("docs/EVIDENCE.md");
    expect(md).toContain("| `proven by test` | A test in this repo asserts the claim, and at least one of the cited tests runs the code that does it");
    expect(md).toContain("| `pinned by test` | Every cited test only reads:");
    expect(md).toContain("it does not show the code works");
    // The old definition promised more than every row delivered.
    expect(md).not.toContain("A test in this repo runs the real code path and asserts the claim.");
    const readme = read("README.md");
    expect(readme).toContain("a `pinned by test` row's tests only compare the document's words with source text, a constant or a config file, so they catch drift and do not show the code works");
  });

  it("every owner action needed row checks that it is not live, except the one the README names", () => {
    const rows = data.claims.filter((c) => c.status === "owner action needed");
    const without = rows.filter((c) => !(c.chain ?? []).length).map((c) => c.id);
    expect([...without].sort()).toEqual(["status-gas-refill", "status-near-auth"]);
    // Each check is a not-live check: a method the contract lacks, a branch not merged, or a setting or balance at its old value (notYet).
    for (const c of rows.filter((x) => (x.chain ?? []).length)) {
      const notLive = c.chain!.some((id) => {
        const check = checks[id]! as Check & { absent?: boolean; notYet?: boolean };
        return check.absent === true || check.notYet === true || (check.kind === "git" && (check.expect ?? []).some((e) => e.path === "merged" && e.value === false)) || id === "market-state";
      });
      expect(notLive, `${c.id} has no check that it is not live`).toBe(true);
    }
    expect(read("README.md")).toContain("Each of them also checks that it is not live (a method the deployed contract lacks, a branch that is not merged, a setting or balance still at its old value), except NEAR Auth, whose approval is outside this repository, and the Gas tank's first refill, which anyone could make by sending wNEAR to the relayer; neither has a check.");
    // The sandbox test is not something only the owner can make true: it is a test, and CI runs it.
    expect(claim("npc-sandbox").status).toBe("pinned by test");
  });
});

describe("rows that used to pass with their claim false", () => {
  it("judge-1 and judge-8: the page is client-rendered, so a test runs what it runs and the live check is reachability only, and says so", () => {
    const play = claim("judge-1");
    expect(play.tests!.map((t) => t.name)).toContain("walks a new guest from /play to the quick start, makes The Node, and opens the night");
    const lab = claim("judge-8");
    expect(lab.tests!.map((t) => t.name)).toContain("replays the page's four recorded nights to the hashes Node recorded, and the page's verdict is All 4 replays match Node");
    for (const [id, c] of [["site-play", play], ["site-lab-determinism", lab]] as const) {
      expect(checks[id]!.about).toMatch(/reachability only/i);
      expect(c.note, id).toMatch(/only shows (that )?the page is served/i);
    }
  });

  it("sandwich-bits: he must hold something, Bits or items, and the sum is worked out from the contract's answers", async () => {
    const { holdingsOf, expectProblem } = await script();
    const check = checks["sandwich-bits"]!;
    expect(check).toMatchObject({ kind: "holdings", account: "sandwich.wgpnear.near" });
    const bound = check.expect!.find((e) => e.path === "total")!;
    expect(bound).toMatchObject({ op: "gte", value: 1 });
    // As he was on Nov 13: 228 Bits and 2 Sybil goo.
    const now = holdingsOf({ tokens: [["item:bits", "228"], ["item:sybil-goo", "2"]] }, { bits: "228", open: [] });
    expect(now).toEqual({ bits: 228, items: 2, listed: 0, total: 230 });
    expect(expectProblem(now, bound)).toBeNull();
    // Spent down to nothing but stock, some of it listed: still true.
    const spent = holdingsOf({ tokens: [["item:bits", "0"], ["item:crumbs", "3"]] }, { bits: "0", open: [{ id: 4, item: "crumbs", amount: 2 }] });
    expect(spent).toEqual({ bits: 0, items: 3, listed: 2, total: 5 });
    expect(expectProblem(spent, bound)).toBeNull();
    // Holding nothing at all, which the old check ("0" is a number) accepted: now a failure.
    const empty = holdingsOf({ tokens: [["item:bits", "0"]] }, { bits: "0", open: [] });
    expect(empty.total).toBe(0);
    expect(expectProblem(empty, bound)).toMatch(/expected at least 1/);
    expect(expectProblem(holdingsOf({ hero: null, tokens: [] }, null), bound)).toMatch(/expected at least 1/);
    // A hero or a trophy is not Bits or an item.
    expect(holdingsOf({ tokens: [["hero:x.near", "1"], ["trophy:badge:recruiter", "1"]] }, { open: [] }).total).toBe(0);
  });

  it("proven-not-author: the senders are counted, must be five, and the author's account must not be one", async () => {
    const { distinctSenders, expectProblem } = await script();
    const check = checks["player-senders"]!;
    expect(claim("proven-not-author").chain).toContain("player-senders");
    expect(check.kind).toBe("senders");
    // It looks up every player transaction the README's table lists (not the operator's, the owner's or the NPC's).
    expect([...check.of!].sort()).toEqual(["tx-buy-listing", "tx-craft-suit", "tx-equip-suit", "tx-list-item", "tx-market-buy", "tx-market-sell", "tx-register-hero", "tx-relayed-buy"]);
    for (const id of check.of!) expect(checks[id]!.kind, id).toBe("tx");
    const count = check.expect!.find((e) => e.path === "count")!;
    const notAuthor = check.expect!.find((e) => e.path === "accounts" && e.op === "excludes")!;
    expect(count).toMatchObject({ op: "eq", value: 5 });
    expect(notAuthor.value).toBe("sele.wgpnear.near");
    expect(plainDoc("README.md")).toContain("The player transactions are from five different players' accounts");
    const five = distinctSenders(["a.near", "b.near", "a.near", "c.near", "d.near", "e.near", "b.near", "c.near"]);
    expect(five).toEqual({ accounts: ["a.near", "b.near", "c.near", "d.near", "e.near"], count: 5, transactions: 8 });
    expect(expectProblem(five, count)).toBeNull();
    expect(expectProblem(five, notAuthor)).toBeNull();
    // Four accounts, or the author's among them: a failure.
    expect(expectProblem(distinctSenders(["a.near", "b.near", "c.near", "d.near", "a.near"]), count)).toMatch(/expected 5/);
    expect(expectProblem(distinctSenders(["a.near", "b.near", "c.near", "d.near", "sele.wgpnear.near"]), notAuthor)).toMatch(/includes "sele\.wgpnear\.near"/);
    expect(expectProblem({ accounts: null }, notAuthor)).toMatch(/expected a list/);
  });

  it("the duel counts the README states are bounds the live count is held to, wherever they are stated", async () => {
    const { resolveExpect, expectProblem } = await script();
    const bounds = checks["site-duels"]!.expect!.filter((e) => e.path === "runs.byMode.duel.verified" && e.op === "gte");
    // The numbers table, the ways-to-play row, and the track table's sentence.
    expect(bounds.map((e) => e.doc).sort()).toEqual(["Duels ([\\d,]+) \\|", "`runs\\.byMode\\.duel` in `/api/stats`; it was ([\\d,]+) on Nov 13"].sort());
    for (const e of bounds) {
      const r = resolveExpect(e);
      expect(typeof r.value, e.doc).toBe("number");
      expect(expectProblem({ runs: { byMode: { duel: { verified: (r.value as number) - 1 } } } }, r), e.doc).toMatch(/expected at least/);
      expect(expectProblem({ runs: { byMode: { duel: { verified: r.value } } } }, r)).toBeNull();
    }
    // "Duels had no verified run as of Nov 13" is the same zero, in words: it must go when the table's number does.
    const table = Number(/Duels ([\d,]+) \|/.exec(read("README.md"))![1]);
    expect(plainDoc("README.md").includes("Duels had no verified run as of Nov 13")).toBe(table === 0);
    for (const id of ["numbers-duels", "track-game-loop", "modes-duels"]) expect(claim(id).chain, id).toContain("site-duels");
  });

  it("near-upgrades cites the tests that refuse a wasm, one per host function", () => {
    const names = claim("near-upgrades").tests!.map((t) => t.name);
    const refused = ["promise_batch_action_use_global_contract", "promise_batch_action_state_init", "promise_batch_action_add_gas_key_with_function_call"];
    for (const fn of refused) expect(names).toContain(`refuses a wasm that imports ${fn}, and names it`);
    // And each is caught by one of the script's own patterns.
    const patterns = [.../const NOT_ON_MAINNET = \[([^\]]+)\]/.exec(read("scripts/near/check-wasm-imports.mjs"))![1]!.matchAll(/\/([^/]+)\//g)].map((m) => new RegExp(m[1]!));
    expect(patterns.length).toBe(3);
    for (const fn of refused) expect(patterns.some((re) => re.test(fn)), fn).toBe(true);
  });

  it("the rows about Sandwich Man cite the tests that run his code, not a file of comments", () => {
    const agent = claim("track-agent-npc").tests!.map((t) => t.name);
    expect(agent).toContain("signs one market call with his own account and books it with its transaction");
    expect(agent.some((n) => n.includes(".env.example"))).toBe(false);
    for (const check of ["sandwich-account", "sandwich-bits", "tx-npc-first-trade", "site-npc"]) expect(claim("track-agent-npc").chain).toContain(check);
    for (const id of ["status-npc", "npc-labelled", "numbers-npc"]) {
      const names = claim(id).tests!.map((t) => t.name);
      expect(names, id).toContain("never counts Sandwich Man as a player: his calls are on their own line");
      expect(names, id).not.toContain("the stats script counts his calls apart from players'");
    }
  });

  it("the remaining rows cite what the brief asked for", () => {
    expect(claim("track-game-loop").tests!.map((t) => t.name)).toEqual(expect.arrayContaining(["every run mode the server counts belongs to exactly one way, and no way claims a mode the server doesn't have", "every way has its page and its API route in the app: all are built"]));
    expect(claim("track-game-loop").tests!.map((t) => t.name)).not.toContain("the ways to play: how many, and each mode's counts");
    expect(claim("disclosures-no-auto-deploy").tests!.map((t) => t.name)).toContain("vercel.json turns git deployments off for main, so a push to main deploys nothing");
    expect(claim("tryit-classic").tests!.map((t) => t.name)).toEqual(expect.arrayContaining(["starts tonight's patrol with the same four stops the 3D night has", "only accepts menu actions in the request body"]));
    expect(claim("tryit-classic").quote).not.toMatch(/reduced motion|WebGL/);
    const money = claim("referrals-no-money");
    expect(money.tests!.map((t) => t.name)).toEqual(expect.arrayContaining(["never promises money or prizes, in any state", "is granted at three qualified friends: 300 XP once, rev + 1, one Recruiter badge in the outbox"]));
    expect(money.quote).toContain("The game and its referral rewards never pay money and never promise it");
  });
});

describe("wording that has to be the same everywhere", () => {
  it("says who reviewed contract v3: a second AI agent that did not write it, not an audit", () => {
    const phrase = /reviewed by a second AI agent that did not write it[;,]? ?\(?not an audit/;
    expect(plainDoc("README.md")).toMatch(phrase);
    expect(plainDoc("docs/INVESTING.md")).toMatch(phrase);
    expect(plainDoc("docs/GAME-LOOP.md")).toMatch(phrase);
    const review = plainDoc("docs/CONTRACT-V3-REVIEW.md");
    expect(review).toContain("The review was done by a second AI coding agent that did not write the code, in one day.");
    expect(review).toContain("it is not an audit");
    // Nowhere do the README or the docs call it independent, or an audit, in their own voice.
    for (const doc of TOP_DOCS.filter((d) => d !== "docs/EVIDENCE.md")) {
      expect(plainDoc(doc), doc).not.toMatch(/independently reviewed|independently audited|was audited/i);
      // The only "independent review" left is the quoted title of the branch's own commit.
      expect(plainDoc(doc).replace('(the commit calls it "the independent review")', ""), doc).not.toMatch(/independent review/i);
    }
    expect(read("apps/wgp/src/app/lab/economy/invest-panel.tsx")).not.toMatch(/built and reviewed/);
  });

  it("says whose limit his five calls are: the server's, with a full-access key, and the planned swap under Limits", () => {
    const doc = plainDoc("docs/npc-trader.md");
    expect(doc).toContain("The server only ever sends these five calls from his account; his key is a full-access key.");
    expect(doc).toContain("the server only ever sends these five calls from his account (his key is a full-access key)");
    expect(doc).not.toMatch(/He can call only the five/);
    const limits = doc.slice(doc.indexOf("\n## Limits\n"), doc.indexOf("\n## Tests\n"));
    expect(limits).toContain("Planned: a function-call key.");
    expect(limits).toContain("Not done as of Nov 13");
    // The chain check agrees with the page: one key, full access.
    const account = checks["sandwich-account"]!.expect!;
    expect(account.some((e) => e.path === "fullAccessKeys" && e.op === "includes")).toBe(true);
    expect(claim("npc-no-powers").chain).toContain("sandwich-account");
    expect(plainDoc("README.md")).toContain("Sandwich Man's key is a full-access key of his own account: the server only ever sends his five market calls, and a function-call key is the planned swap");
  });

  it("the README opens with the game: a plain pitch, one screenshot, the Play link and a status table whose rows each link an evidence row", () => {
    const readme = read("README.md");
    const title = "# With Great Power (WGP)\n";
    expect(readme.startsWith(title)).toBe(true);
    const opening = readme.slice(title.length, readme.indexOf("\n## "));
    // The pitch comes first, in plain words: what it is, what is different, and no popups after Google sign-in.
    const pitch = opening.trim().split("\n\n")[0]!;
    // It opens on the world and its economy: the villains, Gwei's market inside the contract and Sandwich Man.
    expect(pitch.startsWith("With Great Power is set in a city that runs on \"mainnet\", where the villains are a market's oldest tricks given faces")).toBe(true);
    for (const words of ["The city's shop is the Mempool Market, and it lives inside a NEAR contract", "a 3D web-swinging game you play free in a browser", "**Every ranked score is replayed and verified by the server**", "anyone can re-run that replay with one command", "a NEP-245 token in one contract on NEAR mainnet", "after a Google sign-in there are no wallet popups"]) expect(pitch).toContain(words);
    expect(pitch).not.toMatch(/EVIDENCE\.md|pnpm/);
    // One screenshot that the Screenshots section also shows, then the Play link.
    const shot = /!\[[^\]]+\]\((docs\/screenshots\/[^)]+)\)/.exec(opening)?.[1];
    expect(shot).toBeDefined();
    expect(readme.slice(readme.indexOf("\n## Screenshots\n"), readme.indexOf("\n## The problem\n"))).toContain(`(${shot})`);
    expect(opening).toContain("**Play:** https://www.wgponnear.fun/play");
    // The status table keeps the old ten lines' honesty: what is live, practice, simulated or only built.
    const LABELS = ["Live on NEAR mainnet", "Practice only", "Simulation only", "Built, not deployed"];
    const rows = opening
      .split("\n")
      .filter((l) => l.startsWith("| **"))
      .map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()))
      .filter((cells) => LABELS.some((label) => cells[0] === `**${label}**`));
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(LABELS.map((label) => `**${label}**`)));
    expect(rows.filter((r) => r[0] === "**Live on NEAR mainnet**").length).toBeGreaterThanOrEqual(4);
    const ids = rows.map((r) => /^\[`([a-z0-9-]+)`\]\(docs\/EVIDENCE\.md#([a-z0-9-]+)\)$/.exec(r[2] ?? ""));
    for (const [i, m] of ids.entries()) {
      expect(m, `status row ${i + 1} doesn't end with its evidence row`).not.toBeNull();
      expect(m![1]).toBe(m![2]);
      expect(data.claims.some((c) => c.id === m![1]), `status row ${i + 1}: no row ${m![1]}`).toBe(true);
    }
    expect(new Set(ids.map((m) => m![1])).size).toBe(rows.length);
    const what = (label: string) => rows.find((r) => r[0] === `**${label}**`)![1]!;
    expect(what("Practice only")).toContain("not on NEAR");
    expect(what("Simulation only")).toContain("Nothing in it is on chain.");
    expect(what("Built, not deployed")).toMatch(/reviewed by a second AI agent that did not write it; not an audit/);
    expect(rows.find((r) => r[1]!.includes("Sandwich Man"))![1]).toContain("an LLM, Kimi K3 (Moonshot), picks one or passes, and the rules pick whenever it can't");
    // The one command, and a pointer to what isn't proven; the evidence system no longer leads.
    expect(opening).toContain("`pnpm install --frozen-lockfile && pnpm evidence --chain`");
    expect(opening).toContain("[Limits](#limits-and-whats-next)");
    expect(readme).not.toContain("\n## In one minute\n");
    expect(readme.indexOf("\n## Evidence\n")).toBeGreaterThan(readme.indexOf("\n## For judges: 5-minute check\n"));
  });
});

describe("the contract's sandbox tests", () => {
  it("are the five the README counts, the NPC trader's among them, and CI's sandbox job builds the wasm and runs them", () => {
    const dir = "contracts/wgp/sandbox/tests";
    const files = readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".rs")).sort();
    const tests = files.flatMap((f) => [...read(`${dir}/${f}`).matchAll(/#\[tokio::test\]\s*async fn (\w+)/g)].map((m) => m[1]!));
    expect(files).toEqual(["npc_trader.rs", "sandbox.rs"]);
    expect(tests).toContain("an_ordinary_account_trades_as_the_npc_does");
    expect(read("README.md")).toContain(`Sandbox tests of the real wasm with near-workspaces (${tests.length} tests in ${files.length === 2 ? "two" : files.length} files)`);
    const ci = read(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("\n  sandbox:\n"), ci.indexOf("\n  # Runs every claim's proof"));
    expect(job).toContain("cargo near build non-reproducible-wasm --locked");
    expect(job).toContain("cargo test --locked -- --test-threads=1");
    expect(job).toContain("working-directory: contracts/wgp/sandbox");
    expect(job).toContain("cargo-near-v0.22.0");
    // pnpm evidence itself does not run them, and the documents say so.
    expect(read("scripts/evidence.mjs")).not.toMatch(/sandbox["'`], \[?["'`]test/);
    expect(read("README.md")).toContain("`pnpm evidence` does not run them; CI's `sandbox` job does.");
    expect(plainDoc("docs/npc-trader.md")).toContain("pnpm evidence does not run it (it needs cargo-near and a built wasm); CI's sandbox job does");
  });
});
