/**
 * Helpers for the tests that keep the README and docs true (docs/EVIDENCE.md). They read files
 * from the repository root, so they work from any working directory.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The repository root: four levels up from apps/wgp/src/evidence. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");
export const exists = (rel: string): boolean => existsSync(path.join(ROOT, rel));

/** A document with its emphasis marks, code ticks and link targets removed, so its words can be searched. */
export const plainDoc = (rel: string): string =>
  read(rel)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "");

/** README.md and every markdown file directly under docs/. */
export const TOP_DOCS: string[] = ["README.md", ...readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).sort().map((f) => `docs/${f}`)];

/** Every markdown file under docs/, at any depth, plus the README. */
export function allDocs(): string[] {
  const out = ["README.md"];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(ROOT, rel)).sort()) {
      const child = `${rel}/${name}`;
      if (statSync(path.join(ROOT, child)).isDirectory()) walk(child);
      else if (name.endsWith(".md")) out.push(child);
    }
  };
  walk("docs");
  return out;
}

/** GitHub's anchor for a heading: lowercased, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Markdown without its fenced code blocks (their lines are kept blank, so line numbers hold). */
export function withoutFences(md: string): string {
  let fenced = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

/** Every anchor a markdown file offers: its headings' slugs and any explicit `<a id>`. */
export function anchorsOf(md: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of withoutFences(md).split("\n")) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      // An explicit <a id> inside a heading is an anchor of its own; the rest makes the slug.
      const base = slug(h[1]!.replace(/<a\s+id="[^"]*"><\/a>/g, ""));
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]!);
  }
  return out;
}

/** The rows of the first markdown table after a heading, as arrays of trimmed cells (header and rule dropped). */
export function tableAfter(md: string, heading: string): string[][] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) throw new Error(`No heading "${heading}"`);
  const rows: string[][] = [];
  let i = start + 1;
  while (i < lines.length && !lines[i]!.startsWith("|")) {
    if (/^#{1,6}\s/.test(lines[i]!)) throw new Error(`No table under "${heading}"`);
    i++;
  }
  for (; i < lines.length && lines[i]!.startsWith("|"); i++) {
    // Split on pipes that aren't escaped.
    const cells = lines[i]!.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    rows.push(cells);
  }
  return rows.slice(2);
}

export interface EvidenceClaim {
  id: string;
  section: string;
  source: string;
  quote: string;
  status: string;
  code?: { path: string; anchor?: string }[];
  tests?: { pkg: string; file: string; name: string }[];
  chain?: string[];
  counts?: { pkg: string; pattern: string }[];
  note?: string;
}

export interface EvidenceFile {
  sections: { id: string; title: string }[];
  claims: EvidenceClaim[];
  checks: Record<string, { kind: string; about: string }>;
}

export const evidence = (): EvidenceFile => JSON.parse(read("docs/evidence.json")) as EvidenceFile;

/** scripts/evidence.mjs, loaded at run time (it is plain Node, outside the app's TypeScript). */
export interface EvidenceScript {
  STATUSES: string[];
  loadEvidence(): EvidenceFile;
  staticProblems(claim: EvidenceClaim): string[];
  renderMarkdown(data: EvidenceFile): string;
  plain(s: string): string;
}

export const evidenceScript = async (): Promise<EvidenceScript> => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts/evidence.mjs")).href)) as EvidenceScript;
