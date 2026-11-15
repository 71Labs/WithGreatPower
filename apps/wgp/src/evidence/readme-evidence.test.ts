/**
 * The README and docs/evidence.json must agree: every row of the track table has an evidence
 * entry, every evidence link lands on one, every entry still matches the repository, and the
 * generated docs/EVIDENCE.md is current. `pnpm evidence` runs the proofs; this keeps the map
 * itself true on every `pnpm test`.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { TOP_DOCS, anchorsOf, evidence, evidenceScript, exists, plainDoc, read, tableAfter } from "./repo";

const data = evidence();
const byId = new Map(data.claims.map((c) => [c.id, c]));
const linkId = (cell: string) => /\(docs\/EVIDENCE\.md#([a-z0-9-]+)\)/.exec(cell)?.[1];

describe("the README's evidence", () => {
  it("every row of the README's track table has an evidence entry that quotes it", async () => {
    const { plain } = await evidenceScript();
    const rows = tableAfter(read("README.md"), "## How it meets the track");
    expect(rows.length).toBeGreaterThanOrEqual(13);
    const linked: string[] = [];
    for (const [asks, inWgp, check] of rows as [string, string, string][]) {
      const id = linkId(check);
      expect(id, `the row "${asks}" has no [Evidence](docs/EVIDENCE.md#…) link`).toBeDefined();
      const claim = byId.get(id!);
      expect(claim, `the row "${asks}" links #${id}, which isn't in docs/evidence.json`).toBeDefined();
      expect(claim!.section, `#${id}`).toBe("track");
      expect(claim!.source).toBe("README.md");
      // The entry's quote is the row's own words: it is in that row, not somewhere else.
      expect(plain(`${asks} | ${inWgp} | ${check}`), `#${id} doesn't quote the row "${asks}"`).toContain(plain(claim!.quote));
      linked.push(id!);
    }
    expect(new Set(linked).size, "two rows link the same entry").toBe(linked.length);
  });

  it("every row of the 5-minute check has an evidence entry too", () => {
    const rows = tableAfter(read("README.md"), "## For judges: 5-minute check");
    expect(rows).toHaveLength(9);
    rows.forEach((row, i) => {
      expect(linkId(row[4] ?? row.join(" ")), `check ${i + 1}`).toBe(`judge-${i + 1}`);
      expect(byId.get(`judge-${i + 1}`)?.quote).toBe(row[1]);
    });
  });

  it("every transaction the README lists as proven on mainnet has a chain check for that hash", () => {
    const rows = tableAfter(read("README.md"), "### Proven on mainnet");
    expect(rows.length).toBeGreaterThanOrEqual(11);
    const checked = new Set(Object.values(data.checks as Record<string, { kind: string; hash?: string }>).filter((c) => c.kind === "tx").map((c) => c.hash));
    for (const [what, link] of rows as [string, string][]) {
      const hash = /nearblocks\.io\/txns\/(\w+)/.exec(link)?.[1];
      expect(hash, what).toBeDefined();
      expect(checked.has(hash), `${what}: no chain check looks up ${hash}`).toBe(true);
    }
  });

  it("every evidence link in the README and docs lands on an entry or a section of docs/EVIDENCE.md", () => {
    const anchors = anchorsOf(read("docs/EVIDENCE.md"));
    let links = 0;
    for (const doc of TOP_DOCS) {
      for (const m of read(doc).matchAll(/\((?:docs\/)?EVIDENCE\.md#([^)]+)\)/g)) {
        links++;
        expect(anchors.has(m[1]!), `${doc} links EVIDENCE.md#${m[1]}, which doesn't exist`).toBe(true);
      }
    }
    expect(links).toBeGreaterThan(25);
  });

  it("the README has the Evidence section: how to run it and what PASS means", () => {
    const readme = read("README.md");
    const at = readme.indexOf("\n## Evidence\n");
    expect(at).toBeGreaterThan(0);
    // It comes after the 5-minute check: the game and its checks lead, the evidence layer's own workings follow.
    expect(at, "the Evidence section comes after the 5-minute check").toBeGreaterThan(readme.indexOf("\n## For judges: 5-minute check\n"));
    const section = readme.slice(at, readme.indexOf("\n## ", at + 1));
    for (const text of ["pnpm evidence", "pnpm evidence --chain", "[docs/EVIDENCE.md](docs/EVIDENCE.md)", "`PASS` is mechanical and means no more than this", "Any `FAIL` exits 1", "It does not cover every sentence."]) expect(section).toContain(text);
    expect((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts.evidence).toBe("node scripts/evidence.mjs");
    expect(read(".github/workflows/ci.yml")).toContain("pnpm evidence --check");
  });
});

describe("docs/evidence.json", () => {
  it("loads, with a known status, a quote and some evidence on every claim", async () => {
    const { loadEvidence, STATUSES } = await evidenceScript();
    const loaded = loadEvidence();
    expect(loaded.claims.length).toBeGreaterThan(100);
    for (const c of loaded.claims) expect(STATUSES, c.id).toContain(c.status);
    // Every status the README's Evidence section names is one the script knows, and the reverse.
    for (const s of STATUSES) expect(read("README.md")).toContain(`\`${s}\``);
  });

  it("every claim's quote, code pointers and tests still match the repository", async () => {
    const { staticProblems } = await evidenceScript();
    const broken = data.claims.flatMap((c) => staticProblems(c).map((p) => `${c.id}: ${p}`));
    expect(broken).toEqual([]);
  });

  it("names only files that exist, for code and for tests", () => {
    for (const c of data.claims) {
      for (const p of c.code ?? []) expect(exists(p.path), `${c.id}: ${p.path}`).toBe(true);
      for (const t of c.tests ?? []) expect(exists(t.file), `${c.id}: ${t.file}`).toBe(true);
    }
  });

  it("is honest about reach: a claim whose only proof is on chain or on the live site doesn't say proven by test", () => {
    for (const c of data.claims) {
      if (c.status === "proven by test") expect((c.tests ?? []).length, c.id).toBeGreaterThan(0);
      if (c.status === "proven on chain" || c.status === "live check") expect((c.chain ?? []).length, c.id).toBeGreaterThan(0);
    }
    // Sandwich Man is on mainnet since Nov 13, 2026: those claims rest on his account, his Bits and his first trade, read from the chain.
    for (const id of ["track-agent-npc", "npc-status"]) {
      expect(byId.get(id)?.status, id).toBe("proven on chain");
      for (const check of ["sandwich-account", "sandwich-bits", "site-npc", "tx-npc-first-trade"]) expect(byId.get(id)?.chain, id).toContain(check);
    }
    // His closed shop has not happened on mainnet, so it stays a claim about the simulation.
    for (const id of ["track-fast-forward", "track-npc-broke", "tryit-sim-market"]) expect(byId.get(id)?.status, id).toBe("simulation only");
    // The season rows pass before and after the record: both use the check that asserts each state.
    for (const id of ["modes-season", "status-season", "status-season-after"]) expect(byId.get(id)?.chain, id).toEqual(["season-s1"]);
    // A claim about commit history rests on a git check.
    for (const c of data.claims.filter((x) => x.status === "checked in git")) expect((c.chain ?? []).some((id) => (data.checks[id] as { kind: string }).kind === "git"), c.id).toBe(true);
  });

  it("docs/EVIDENCE.md is what the script generates from docs/evidence.json", async () => {
    const { renderMarkdown, loadEvidence } = await evidenceScript();
    expect(read("docs/EVIDENCE.md") === renderMarkdown(loadEvidence()), "docs/EVIDENCE.md is out of date: run pnpm evidence --write").toBe(true);
  });
});

describe("what the docs say about themselves", () => {
  it("states the real order: the 2D prototype, then the 3D plan, then the 3D code, with GAME-LOOP.md written last", () => {
    const loop = plainDoc("docs/GAME-LOOP.md");
    expect(loop).toContain("written up on Nov 12 from the live build: it documents the loop as built and does not predate the code");
    expect(loop).toContain("a 2D real-time prototype of the night was committed first, on Nov 1 (commit 699457d)");
    expect(loop).toContain("committed on Nov 2 (commit 94c8d19), three minutes before the first 3D simulation code (commit 143b12e)");
    expect(loop).toContain("So the 3D game was planned on paper before its code, and the first playable loop was not.");
    const readme = plainDoc("README.md");
    expect(readme).toContain("a 2D real-time prototype of the night came first (Nov 1, commit 699457d)");
    expect(readme).toContain("docs/GAME-LOOP.md was written on Nov 12 and documents the loop as built; it was not a design written before the code.");
    // Neither document claims the loop was designed on paper before any code, and the check reads the commits in that order.
    for (const doc of [readme, loop]) expect(doc).not.toMatch(/designed on paper first|On paper: the plan|before the first 3D simulation code\. docs/i);
    const order = (data.checks as unknown as Record<string, { order?: string[] }>)["loop-on-paper"]!.order!;
    expect(order.map((c) => c.slice(0, 7))).toEqual(["699457d", "94c8d19", "143b12e", "0134541"]);
  });

  it("says in every place that Sandwich Man is live on mainnet from his own account, and that an LLM picks only among his rules' moves", () => {
    const readme = plainDoc("README.md");
    expect(readme).toContain("Live on mainnet since Nov 13, 2026: he trades from his own account, sandwich.wgpnear.near.");
    expect(readme).toContain("An LLM picks his move; his rules fence it in.");
    expect(readme).toContain("Kimi K3 (kimi-k3, Moonshot's API) picks one and writes his reason in character");
    expect(readme).toContain("until the owner sets LLM_API_KEY in production, the live mode is rules.");
    expect(readme).toContain("Gwei is rule-based. Sandwich Man's moves are picked by an LLM among the moves his rules allow, or by the rules alone (next row).");
    const doc = plainDoc("docs/npc-trader.md");
    expect(doc).toContain("Status: live on NEAR mainnet since Nov 13, 2026.");
    expect(doc).toContain("The rules are the guardrail and the fallback: the LLM can choose a legal move or pass, and nothing else.");
    expect(plainDoc("docs/ARCHITECTURE.md")).toContain("has traded on mainnet from his own account, sandwich.wgpnear.near, since Nov 13; an LLM picks among the moves his rules allow when the server has its LLM key (Kimi K3, Moonshot), and the rules pick otherwise");
    // Nothing still says he is rule-based only, or that no LLM is involved.
    for (const name of TOP_DOCS.filter((d) => d !== "docs/EVIDENCE.md")) {
      expect(plainDoc(name), name).not.toMatch(/He is rule-based, not an LLM|no LLM and no other AI decides|Both are rule-based, not AI agents|he is rule-based, not an AI agent|rule-based trader, not a player and not an AI agent/);
    }
    // Nothing in the README or the docs still says his account is missing or that he is off on mainnet.
    for (const name of TOP_DOCS.filter((d) => d !== "docs/EVIDENCE.md")) {
      expect(plainDoc(name), name).not.toMatch(/account \(sandwich\.wgpnear\.near\) is not created|sandwich\.wgpnear\.near does not exist|NPC trader's account is not created|whose mainnet account is not created|off on mainnet until his account/);
    }
  });

  it("discloses his seed, his label and that he is no player, with the transactions", () => {
    const readme = plainDoc("README.md");
    expect(readme).toContain("he starts from a one-off seed of 300 Bits minted by the operator, is always labelled NPC, is never counted as a player");
    const doc = plainDoc("docs/npc-trader.md");
    expect(doc).toContain("His 300 Bits were minted to him once by the operator, not earned in play");
    expect(doc).toContain("He is always labelled NPC, is never counted as a player, and his trades complete nobody's market quest.");
    // The seed's digest in the docs is the hash of the string they name, and the chain check looks for the same digest.
    const digest = createHash("sha256").update("npc-seed:sandwich.wgpnear.near:v1").digest("hex");
    expect(read("docs/npc-trader.md")).toContain(`"digest":"${digest}"`);
    expect(JSON.stringify((data.checks as Record<string, unknown>)["tx-npc-seed"])).toContain(digest);
    // His three transactions are in the README and in his own page.
    for (const hash of ["Hx32N4dymGnQXUoD1cY36w3kekY2WqKbfvLpvd84W4rm", "HjvobzmddfFdFeKoifAZP9wf1YMSEA6qkqpBRC5kFPG7", "AcmNAmHr1FDHEzW6YNMFC3ULwnMmGWnyBCyihmk6LVSf"]) {
      expect(read("README.md"), hash).toContain(`https://nearblocks.io/txns/${hash}`);
      expect(read("docs/npc-trader.md"), hash).toContain(`https://nearblocks.io/txns/${hash}`);
    }
  });

  it("dates the live counts and says they are lower bounds", () => {
    const readme = plainDoc("README.md");
    expect(readme).toContain("The chain counts are as of Nov 13, 2026, 11:56 UTC and the game's as of Nov 13, 2026, 11:54 UTC. Both only grow");
    expect(readme).toContain("pnpm evidence --chain reads the numbers from the two tables below and fails if a live count is below one of them.");
    expect(readme).not.toMatch(/went from \d+ on Nov/);
    // Season 1's incentive and both of the author's accounts are disclosed beside the counts.
    const numbers = readme.slice(readme.indexOf("\n## By the numbers\n"), readme.indexOf("On NEAR mainnet (counted from NearBlocks"));
    expect(numbers).toContain("Season 1 (Nov 5–14) is a playtest season, and play in it was incentivised.");
    expect(numbers).toContain("the team offered players daily airdrops, sent by hand through Uprail, outside the game");
    for (const account of ["sele.wgpnear.near", "sele71.near"]) expect(numbers).toContain(account);
  });
});
