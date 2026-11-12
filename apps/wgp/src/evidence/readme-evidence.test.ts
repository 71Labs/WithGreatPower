/**
 * The README and docs/evidence.json must agree: every row of the track table has an evidence
 * entry, every evidence link lands on one, every entry still matches the repository, and the
 * generated docs/EVIDENCE.md is current. `pnpm evidence` runs the proofs; this keeps the map
 * itself true on every `pnpm test`.
 */
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
    expect(at, "the Evidence section comes before the track table").toBeLessThan(readme.indexOf("\n## How it meets the track\n"));
    const section = readme.slice(at, readme.indexOf("\n## How it meets the track\n"));
    for (const text of ["pnpm evidence", "pnpm evidence --chain", "[docs/EVIDENCE.md](docs/EVIDENCE.md)", "`PASS` means", "Any `FAIL` exits 1"]) expect(section).toContain(text);
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
    // What is off on mainnet is labelled so, wherever it is claimed.
    for (const id of ["track-agent-npc", "npc-status"]) expect(byId.get(id)?.status, id).toBe("built, off on mainnet");
    for (const id of ["track-fast-forward", "track-npc-broke", "tryit-sim-market"]) expect(byId.get(id)?.status, id).toBe("simulation only");
    for (const id of ["modes-season", "status-season"]) expect(byId.get(id)?.note ?? byId.get(id)?.quote, id).toMatch(/null|not run|Not run/);
  });

  it("docs/EVIDENCE.md is what the script generates from docs/evidence.json", async () => {
    const { renderMarkdown, loadEvidence } = await evidenceScript();
    expect(read("docs/EVIDENCE.md") === renderMarkdown(loadEvidence()), "docs/EVIDENCE.md is out of date: run pnpm evidence --write").toBe(true);
  });
});

describe("what the docs say about themselves", () => {
  it("says plainly that GAME-LOOP.md documents the loop as built, and that the Nov 2 plan came first", () => {
    const loop = plainDoc("docs/GAME-LOOP.md");
    expect(loop).toContain("written up on Nov 12 from the live build: it documents the loop as built and does not predate the code");
    expect(loop).toContain("committed on Nov 2 (commit 94c8d19) just before the first 3D simulation code (commit 143b12e)");
    const readme = plainDoc("README.md");
    expect(readme).toContain("docs/GAME-LOOP.md was written on Nov 12 and documents the loop as built.");
    expect(readme).not.toMatch(/designed on paper first/i);
  });

  it("says in every place that Sandwich Man's mainnet account doesn't exist yet", () => {
    expect(plainDoc("README.md")).toContain("his mainnet account (sandwich.wgpnear.near) is not created yet");
    expect(plainDoc("docs/npc-trader.md")).toContain("sandwich.wgpnear.near does not exist yet");
    expect(plainDoc("docs/ARCHITECTURE.md")).toContain("the NPC trader's account is not created");
    // Nothing in the README or the docs states, in the present tense, that he has his own account.
    for (const doc of TOP_DOCS) expect(plainDoc(doc), doc).not.toMatch(/an NPC with his own (account|NEAR wallet)/);
  });

  it("dates the live counts and says they are lower bounds", () => {
    const readme = plainDoc("README.md");
    expect(readme).toContain("as of Nov 12, 2026, 17:35 UTC and only grow");
    expect(readme).toContain("pnpm evidence --chain fails if a live count is below a number here");
    expect(readme).not.toMatch(/went from \d+ on Nov/);
  });
});
