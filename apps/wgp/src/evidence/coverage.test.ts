/**
 * What the evidence layer promises about itself, held to the script that implements it
 * (scripts/evidence.mjs): which rows must cite a test, that every pointer is anchored, that
 * the README's coverage numbers and expected output are generated and not hand-copied, that
 * the live-count checks read their numbers from the README's own text, that a rate limit is
 * retried and then skipped, and that the season check asserts the right thing before the
 * season closes and after it is recorded.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { ROOT, evidence, read } from "./repo";

interface Expect {
  path: string;
  op: string;
  value?: unknown;
  doc?: string;
  source?: string;
  unresolved?: string;
}
interface Check {
  kind: string;
  expect?: Expect[];
  season?: string;
  endsAt?: string;
  ref?: string;
  commits?: string[];
}
interface Coverage {
  claims: number;
  withTests: number;
  testStatusClaims: number;
  testStatusWithTests: number;
  pointers: number;
  anchored: number;
  offlineSkip: number;
  offlinePass: number;
}
interface SeasonInput {
  id: string;
  endsAt?: string;
  now: number;
  season: null | { root?: string; digest?: string; top10?: string[]; recorded_at_ms?: number };
  results: { status: number; text: string };
  balances?: string[];
}
interface Script {
  TEST_STATUSES: string[];
  CHAIN_STATUSES: string[];
  coverage(data: unknown): Coverage;
  renderCoverage(data: unknown): string;
  withCoverage(readme: string, data: unknown): string | null;
  summaryLine(n: number, tally: { PASS: number; FAIL: number; SKIP: number }, suffix?: string): string;
  rateLimitLine(n: number): string;
  resolveExpect(e: Expect, readDoc?: (rel: string) => string): Expect;
  expectProblem(value: unknown, e: Expect): string | null;
  fetchJson(url: string, init?: object, opts?: { fetch?: (url: string) => Promise<{ status: number }>; waits?: number[]; sleep?: (ms: number) => Promise<void> }): Promise<{ status: number }>;
  seasonState(input: SeasonInput): { state: string; problems: string[] };
  isTimeout(e: unknown): boolean;
  loadEvidence(): unknown;
}

const script = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts/evidence.mjs")).href)) as Script;
const data = evidence() as ReturnType<typeof evidence> & { checks: Record<string, Check> };

describe("the evidence layer's own promises", () => {
  it("every row whose status promises a test cites one, and every code pointer is anchored", async () => {
    const s = await script();
    expect(s.TEST_STATUSES).toEqual(["proven by test", "pinned by test", "simulation only", "built, off on mainnet"]);
    const untested = data.claims.filter((c) => s.TEST_STATUSES.includes(c.status) && !(c.tests ?? []).length).map((c) => c.id);
    expect(untested, "these rows say a test proves them and cite none").toEqual([]);
    const unchecked = data.claims.filter((c) => s.CHAIN_STATUSES.includes(c.status) && !(c.chain ?? []).length).map((c) => c.id);
    expect(unchecked, "these rows say the chain or the site proves them and have no check").toEqual([]);
    const loose = data.claims.flatMap((c) => (c.code ?? []).filter((p) => !p.anchor).map((p) => `${c.id}: ${p.path}`));
    expect(loose, "these pointers name a file and no place in it").toEqual([]);
    // No row is bare: each has a test or a check, except those that only point at what is ready.
    const bare = data.claims.filter((c) => !(c.tests ?? []).length && !(c.chain ?? []).length);
    expect(bare.map((c) => c.status).filter((st) => st !== "owner action needed")).toEqual([]);
    // The script refuses a file that breaks these, so `pnpm evidence` can't pass on one.
    expect(() => s.loadEvidence()).not.toThrow();
    const c = s.coverage(data);
    expect(c.testStatusWithTests).toBe(c.testStatusClaims);
    expect(c.anchored).toBe(c.pointers);
  });

  it("the README's coverage block is what the script generates, and its summary lines are the script's", async () => {
    const s = await script();
    const readme = read("README.md");
    expect(s.withCoverage(readme, data), "run pnpm evidence --write").toBe(readme);
    const c = s.coverage(data);
    // Offline: every row that rests on the chain or the site is a SKIP, the rest PASS. With --chain: all PASS.
    expect(c.offlinePass + c.offlineSkip).toBe(c.claims);
    expect(c.offlineSkip).toBe(data.claims.filter((x) => s.CHAIN_STATUSES.includes(x.status)).length);
    expect(s.CHAIN_STATUSES).toEqual(["proven on chain", "live check"]);
    expect(readme).toContain(`\`${s.summaryLine(c.claims, { PASS: c.offlinePass, FAIL: 0, SKIP: c.offlineSkip })}\``);
    expect(readme).toContain(`\`${s.summaryLine(c.claims, { PASS: c.claims, FAIL: 0, SKIP: 0 })}\``);
    expect(readme).toContain(`${c.withTests} of ${c.claims}`);
    expect(s.summaryLine(3, { PASS: 2, FAIL: 0, SKIP: 1 })).toBe("3 claims: 2 PASS, 0 FAIL, 1 SKIP.");
    expect(s.rateLimitLine(2)).toBe("2 rows skipped: rate limited, re-run.");
    expect(readme).toContain("N rows skipped: rate limited, re-run.");
    // The README no longer promises a PASS for every claim, or a proof for every sentence.
    expect(readme).not.toMatch(/One `PASS` line per claim|Every claim in this README and in `docs\/` is paired/);
    expect(readme).toContain("It does not cover every sentence.");
    // The script prints its summary through the same function the README's block is built from.
    const source = read("scripts/evidence.mjs");
    expect(source).toContain('log(summaryLine(rows.length, tally, opts.check ? " (pointers only; tests not run)" : ""));');
    expect(source).toContain("if (rateLimitedRows) log(rateLimitLine(rateLimitedRows));");
  });

  it("the live-count checks read their numbers from the README's text, not from a second copy", async () => {
    const s = await script();
    // No lower bound anywhere in the file carries a count copied from the README by hand.
    expect((data.checks["nearblocks-count"]!.expect ?? []).filter((e) => e.op === "gte")).toEqual([]);
    for (const id of ["site-stats", "chain-tally"]) {
      const bounds = (data.checks[id]!.expect ?? []).filter((e) => e.op === "gte");
      expect(bounds.length, id).toBeGreaterThan(10);
      for (const e of bounds) {
        expect(e.value, `${id} ${e.path}: a hand-copied number`).toBeUndefined();
        const r = s.resolveExpect(e);
        expect(r.unresolved, `${id} ${e.path}`).toBeUndefined();
        expect(typeof r.value, `${id} ${e.path}`).toBe("number");
      }
    }
    // Change the README and the bound follows; drop the number and the check fails instead of passing on a stale one.
    const e: Expect = { path: "runs.verified", op: "gte", doc: "finished and verified \\| \\d+ / (\\d+)" };
    expect(s.resolveExpect(e, () => "| Matches started / finished and verified | 300 / 290 |").value).toBe(290);
    expect(s.expectProblem({ runs: { verified: 289 } }, s.resolveExpect(e, () => "| finished and verified | 300 / 290 |"))).toMatch(/expected at least 290/);
    expect(s.expectProblem({ runs: { verified: 999 } }, s.resolveExpect(e, () => "no numbers here"))).toMatch(/no longer has the number/);
  });

  it("a rate-limited endpoint is retried with a growing wait, then skipped as rate limited, never failed", async () => {
    const s = await script();
    const waited: number[] = [];
    const sleep = async (ms: number) => void waited.push(ms);
    // Two 429s, then an answer: the caller gets the answer.
    let calls = 0;
    const flaky = async () => ({ status: ++calls < 3 ? 429 : 200 });
    expect((await s.fetchJson("https://api.nearblocks.io/v1/x", {}, { fetch: flaky, waits: [1, 2, 4], sleep })).status).toBe(200);
    expect(waited).toEqual([1000, 2000]);
    // Always 429: an error the script turns into a SKIP, flagged as a rate limit.
    const never = async () => ({ status: 429 });
    const err = await s.fetchJson("https://api.nearblocks.io/v1/x", {}, { fetch: never, waits: [1, 2], sleep }).catch((e: Error & { rateLimited?: boolean }) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { rateLimited?: boolean }).rateLimited).toBe(true);
    expect((err as Error).message).toContain("rate limited the request (HTTP 429) 3 times");
    const source = read("scripts/evidence.mjs");
    expect(source).toContain("if (e instanceof Offline) return { skip: e.message, rateLimited: e.rateLimited };");
    expect(source).toContain("const failed = tally.FAIL > 0 || markdownStale || readmeStale;");
  });
});

describe("a slow endpoint is never a failed claim", () => {
  it("a request that times out, even mid-answer, is a SKIP, never a FAIL", async () => {
    const s = await script();
    // What fetch throws when AbortSignal.timeout fires while the body is still arriving.
    expect(s.isTimeout(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(true);
    expect(s.isTimeout(new DOMException("This operation was aborted", "AbortError"))).toBe(true);
    expect(s.isTimeout(new Error("expected 200, got 404"))).toBe(false);
    expect(s.isTimeout(undefined)).toBe(false);
    const source = read("scripts/evidence.mjs");
    expect(source).toContain("const err = isTimeout(e) ? new Offline(");
    expect(source).toContain("if (isTimeout(e)) return { skip: `a request timed out (${e.message})` };");
  });
});

describe("the season check asserts the right thing in each state", () => {
  const ENDS = "2026-11-15T00:00:00.000Z";
  const before = Date.parse("2026-11-13T12:00:00Z");
  const after = Date.parse("2026-11-15T02:00:00Z");
  const top10 = ["azalleaxyz.wgpnear.near", "9a_z53.wgpnear.near", "nasibabalili7.wgpnear.near"];
  const root = "ab".repeat(32);
  const file = JSON.stringify({ version: "wgp-season-v1", seasonId: "s1", root, leaves: top10.map((accountId, i) => ({ rank: i + 1, accountId, score: 9000 - i, proof: [] })) });
  const digest = createHash("sha256").update(file).digest("hex");
  const recorded = { root, digest, top10, recorded_at_ms: after };
  const notFound = { status: 404, text: '{"error":"not_found"}' };

  it("is wired to Season 1 with its end date, and every claim about the record uses it", () => {
    const check = data.checks["season-s1"]!;
    expect(check).toMatchObject({ kind: "season", season: "s1", endsAt: ENDS });
    expect(data.checks["season-not-recorded"], "the old check failed the day the season was recorded").toBeUndefined();
    const users = data.claims.filter((c) => (c.chain ?? []).includes("season-s1")).map((c) => c.id);
    expect(users).toEqual(expect.arrayContaining(["modes-season", "status-season", "arch-status"]));
  });

  it("before the close: passes on null and a 404, and fails if anything is recorded or published early", async () => {
    const { seasonState } = await script();
    expect(seasonState({ id: "s1", endsAt: ENDS, now: before, season: null, results: notFound })).toEqual({ state: "open", problems: [] });
    const early = seasonState({ id: "s1", endsAt: ENDS, now: before, season: recorded, results: { status: 200, text: file }, balances: ["1", "1", "1"] });
    expect(early.problems.join(" ")).toMatch(/recorded on chain before its end/);
    expect(seasonState({ id: "s1", endsAt: ENDS, now: before, season: null, results: { status: 200, text: file } }).problems.join(" ")).toMatch(/serves final results for s1 before its end/);
    expect(seasonState({ id: "s1", endsAt: ENDS, now: before, season: null, results: { status: 500, text: "" } }).problems).toHaveLength(1);
  });

  it("between the close and the record: passes on the frozen board with the contract still null", async () => {
    const { seasonState } = await script();
    expect(seasonState({ id: "s1", endsAt: ENDS, now: after, season: null, results: { status: 200, text: file } })).toEqual({ state: "closed", problems: [] });
    // Nobody has made a request since the end: still open, still true.
    expect(seasonState({ id: "s1", endsAt: ENDS, now: after, season: null, results: notFound })).toEqual({ state: "open", problems: [] });
    expect(seasonState({ id: "s1", endsAt: ENDS, now: after, season: null, results: { status: 200, text: "{}" } }).problems).toHaveLength(1);
  });

  it("after the record: passes only if the root, the digest, the board and every trophy match", async () => {
    const { seasonState } = await script();
    const good: SeasonInput = { id: "s1", endsAt: ENDS, now: after, season: recorded, results: { status: 200, text: file }, balances: ["1", "1", "1"] };
    expect(seasonState(good)).toEqual({ state: "recorded", problems: [] });
    const bad = (change: Partial<SeasonInput>) => seasonState({ ...good, ...change }).problems.join(" | ");
    expect(bad({ balances: ["1", "0", "1"] })).toMatch(/9a_z53\.wgpnear\.near holds 0 trophy:s1:2, expected 1/);
    expect(bad({ balances: ["1", "1"] })).toMatch(/nasibabalili7\.wgpnear\.near holds no trophy:s1:3/);
    expect(bad({ season: { ...recorded, root: "cd".repeat(32) } })).toMatch(/isn't the recorded root/);
    expect(bad({ season: { ...recorded, digest: "ef".repeat(32) } })).toMatch(/isn't the recorded digest/);
    expect(bad({ season: { ...recorded, top10: [...top10].reverse() } })).toMatch(/isn't the recorded board/);
    expect(bad({ season: { ...recorded, root: "nope" } })).toMatch(/root isn't 32 bytes of hex/);
    expect(bad({ season: { ...recorded, top10: [] } })).toMatch(/holds 0 accounts/);
    expect(bad({ results: notFound })).toMatch(/recorded on chain but \/api\/seasons\/s1\/results answered HTTP 404/);
  });

  it("the documents describe both states, so no edit is needed when the season closes", () => {
    const readme = read("README.md");
    // Season 1 closed and was recorded on Nov 15, 2026; the documents now say so, with the time and where to read it.
    expect(readme).toContain("Season 1 ended Nov 15, 00:00 UTC (the end of Nov 14); the record landed at 01:26 UTC and is `get_season(\"s1\")` on the contract, and the results file is `/api/seasons/s1/results`");
    // The end the documents give is the season's own, from the migration that creates it (ends_at is exclusive).
    expect(read("apps/wgp/drizzle/0001_seed_season_1.sql")).toContain("('s1', 'Season 1', '2026-11-05T00:00:00Z', '2026-11-15T00:00:00Z', 'scheduled')");
    // 23:59 appears only as the hackathon's submission deadline, written in full, never as Season 1's end.
    for (const doc of ["README.md", "docs/GAME-LOOP.md", "docs/ARCHITECTURE.md", "docs/SUSTAINABILITY.md"]) expect(read(doc).replaceAll("submission deadline was 2026-11-14 23:59 UTC", "").replaceAll("| **Deadline** | 2026-11-14 23:59 UTC.", ""), doc).not.toMatch(/23:59/);
    expect(readme).toContain("**Before the record landed,** `get_season(\"s1\")` answered `null`");
    expect(readme).toContain("**Now that it has landed,** `get_season(\"s1\")` holds the root, the digest and the top 10");
    expect(readme).not.toContain("first run on mainnet when Season 1 closes");
    for (const doc of ["README.md", "docs/GAME-LOOP.md", "docs/SUSTAINABILITY.md", "docs/ARCHITECTURE.md"]) {
      expect(read(doc), doc).not.toMatch(/Season 1 has not closed yet|not run on mainnet yet|never run on mainnet yet|Not run on mainnet yet/);
    }
    // Duels: the README gives a dated count and where the live one is; the check holds the live count to that figure.
    expect(readme).toMatch(/The count of verified duels is `runs\.byMode\.duel` in `\/api\/stats`; it was \d+ on Nov 13\./);
    expect(readme).not.toMatch(/no player has finished a verified duel yet|duels have no verified run yet/);
    const duels = data.checks["site-duels"]!.expect!;
    expect(duels.length).toBeGreaterThan(0);
    for (const e of duels) expect(e).toMatchObject({ path: "runs.byMode.duel.verified", op: "gte" });
    for (const e of duels) expect(e.doc, "a hand-copied number").toBeDefined();
  });
});

describe("contract v3's credentials can be checked without merging its branch", () => {
  it("the review summary is on main, names the branch's commits, and the check looks for them in git", () => {
    const doc = read("docs/CONTRACT-V3-REVIEW.md");
    const check = data.checks["v3-branch"]!;
    expect(check).toMatchObject({ kind: "git", ref: "review/contract-v3" });
    expect(check.commits!.length).toBe(13);
    for (const c of check.commits!) expect(doc, c).toContain(`\`${c.slice(0, 7)}\``);
    expect(doc).toContain("**It is not deployed, and its source is not on `main`.**");
    expect(doc).toContain("Unit tests | 117: 68 from v2, 45 new, 4 from the review");
    expect(doc).toContain("Sandbox tests, against the built wasm | 9, in four files");
    expect(doc).toContain("the 62 entries other than the root were byte-identical");
    expect(doc).toContain("17.1 for the first batch after the upgrade");
    expect(doc).toContain("Fixed in `a1af2e5`");
    expect(doc).toContain("**It works only while no Bits are invested**");
    // No contract source came to main with it: the v3 files exist only on the branch.
    for (const f of ["meta.rs", "invest.rs", "v3_tests.rs"]) expect(() => read(`contracts/wgp/src/${f}`), f).toThrow();
    // The two README rows keep a status that claims nothing is live, and no link depends on a private pull request.
    for (const id of ["track-nep245-v3", "status-v3"]) {
      const claim = data.claims.find((c) => c.id === id)!;
      expect(claim.status).toBe("owner action needed");
      expect(claim.chain).toEqual(expect.arrayContaining(["v3-branch", "no-metadata", "no-enumeration"]));
    }
    // The README's dated "Changed after the deadline" section names the public pull requests merged after the
    // deadline on purpose; nothing else in these documents may lean on a pull request.
    const withoutDeadline = (d: string) => {
      const text = read(d);
      const at = text.indexOf("\n## Changed after the deadline (Nov 15, 2026)\n");
      return at < 0 ? text : text.slice(0, at) + text.slice(text.indexOf("\n## ", at + 1));
    };
    for (const d of ["README.md", "docs/INVESTING.md", "docs/GAME-LOOP.md", "docs/ARCHITECTURE.md", "docs/CONTRACT-V3-REVIEW.md"]) expect(withoutDeadline(d), d).not.toMatch(/pull\/\d+|PR #\d+/);
  });
});
