/**
 * Every relative link and every file path the README and the docs name must exist. A reader (or
 * an agent checking the submission) who follows one lands on a real file.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, TOP_DOCS, allDocs, anchorsOf, exists, read, withoutFences } from "./repo";

/** Where a path written in prose may be relative to, tried in order. */
const BASES = ["", "apps/wgp", "apps/wgp/src", "packages/game-core", "packages/game-core/src", "contracts/wgp", "contracts/wgp/src", "docs"];

/**
 * Paths the docs name on purpose that aren't in a fresh clone: files a command creates, the
 * owner's own files, and build output. Each needs its reason.
 */
const V3_BRANCH = "contract v3's file, on the branch review/contract-v3 and deliberately not on main (docs/CONTRACT-V3-REVIEW.md names it)";
const NOT_IN_A_CLONE: Record<string, string> = {
  "docs/CONTRACT-V3.md": V3_BRANCH,
  "src/meta.rs": V3_BRANCH,
  "src/invest.rs": V3_BRANCH,
  "CONTRACT-V3.md": V3_BRANCH,
  "v3_tests.rs": V3_BRANCH,
  "v3_tests/review.rs": V3_BRANCH,
  "upgrade_v3.rs": V3_BRANCH,
  "review_v3.rs": V3_BRANCH,
  "mainnet_rehearsal.rs": V3_BRANCH,
  "src/v3_tests/review.rs": V3_BRANCH,
  "sandbox/tests/review_v3.rs": V3_BRANCH,
  "sandbox/tests/mainnet_rehearsal.rs": V3_BRANCH,
  "contracts/wgp/rollback/build.sh": V3_BRANCH,
  // docs/ARCHITECTURE.md is the Nov 2 plan. It names files of the author's earlier game, blastoff,
  // that code was ported from, and one file the plan itself moved.
  "packages/game-core/src/input.ts": "blastoff's file (another repository), named as the source of the input log",
  "session/quality.ts": "blastoff's file, named as the source of the quality tiers",
  "gpu.ts": "blastoff's file, named as the source of the GPU check",
  "camera-fx.ts": "blastoff's file, named as the source of the camera effects",
  "src/content/cast.ts": "moved into packages/game-core/src/rules/cast.ts by the plan's first milestone",
  "apps/wgp/.env.local": "created by the README's own setup step; never committed",
  "apps/wgp/.data/pglite": "PGlite's folder, created on the first local run",
  "contracts/wgp/target/near/wgp.wasm": "build output of cargo near build",
  ".env.local": "the developer's own settings; never committed",
};

const FILE_EXT = /\.(ts|tsx|mts|mjs|js|rs|md|json|sh|toml|ya?ml|css|sql|jpe?g|png|svg|py|glb|bin|snap|lock|example)$/;
const ROOT_DIRS = /^(apps|packages|contracts|scripts|docs|launch|\.github)\//;

/** Every file in the source trees: paths for the ones docs name in part ("anim/clip-layer.ts"), basenames for the ones named alone ("market.rs"). */
const FILES: string[] = [];
const BASENAMES = (() => {
  const names = new Set<string>();
  const skip = new Set(["node_modules", ".next", "target", ".git", ".data", "audio", "game-shots"]);
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(ROOT, rel))) {
      if (skip.has(name)) continue;
      const child = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(ROOT, child)).isDirectory()) walk(child);
      else {
        names.add(name);
        FILES.push(`/${child}`);
      }
    }
  };
  for (const dir of ["apps/wgp", "packages/game-core", "contracts/wgp", "scripts", "docs", ".github", "launch/brand/hero"]) walk(dir);
  return names;
})();

/** A code span that is meant as a path to a file in this repository. */
function pathIn(span: string): string | null {
  if (/[\s<>*{}…$=,;()"'|]/.test(span) || span.includes("://") || span.startsWith("~") || span.startsWith("/") || span.startsWith("@") || span.startsWith("--")) return null;
  // `file.ts#symbol`, `file.ts:12` and a trailing slash are still that file or folder.
  const clean = span.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "").replace(/\/$/, "");
  if (!clean.includes("/")) return FILE_EXT.test(clean) && !/^\.[a-z]+$/.test(clean) ? clean : null;
  if (ROOT_DIRS.test(clean)) return clean;
  return FILE_EXT.test(clean) ? clean : null;
}

function resolves(p: string, docDir: string): boolean {
  if (p in NOT_IN_A_CLONE) return true;
  if (!p.includes("/")) return BASENAMES.has(p) || exists(p);
  if ([docDir, ...BASES].some((base) => exists(path.posix.join(base, p)))) return true;
  // A path given from somewhere inside a source tree: some file must end with it.
  return FILES.some((f) => f.endsWith(`/${p}`) || f.includes(`/${p}/`));
}

describe("links and paths in the README and docs", () => {
  it.each(allDocs())("%s: every relative link resolves, and so does its #anchor", (doc) => {
    const md = withoutFences(read(doc));
    const dir = path.posix.dirname(doc) === "." ? "" : path.posix.dirname(doc);
    const broken: string[] = [];
    for (const m of md.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1]!;
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, anchor] = target.split("#") as [string, string | undefined];
      const rel = file === "" ? doc : path.posix.normalize(path.posix.join(dir, decodeURIComponent(file)));
      if (!exists(rel)) {
        broken.push(`${target} (no file ${rel})`);
        continue;
      }
      // A line anchor (#L12) is checked by `pnpm evidence`; a heading anchor is checked here.
      if (anchor && rel.endsWith(".md") && !/^L\d+/.test(anchor) && !anchorsOf(read(rel)).has(anchor)) broken.push(`${target} (no anchor #${anchor} in ${rel})`);
    }
    expect(broken, `${doc} has broken links`).toEqual([]);
  });

  it.each(TOP_DOCS)("%s: every file path it names exists", (doc) => {
    const md = withoutFences(read(doc));
    const dir = path.posix.dirname(doc) === "." ? "" : path.posix.dirname(doc);
    const missing = new Set<string>();
    for (const m of md.matchAll(/`([^`\n]+)`/g)) {
      const p = pathIn(m[1]!);
      if (p && !resolves(p, dir)) missing.add(m[1]!);
    }
    expect([...missing], `${doc} names files that don't exist`).toEqual([]);
  });

  it("every screenshot the README shows is in the repository", () => {
    const shown = [...read("README.md").matchAll(/!\[[^\]]*\]\((docs\/screenshots\/[^)]+)\)/g)].map((m) => m[1]!);
    expect(shown.length).toBeGreaterThan(0);
    for (const file of shown) expect(exists(file), file).toBe(true);
  });

  it("the allowlist of paths that aren't in a clone stays honest: none of them is committed", () => {
    for (const p of Object.keys(NOT_IN_A_CLONE)) expect(exists(p), `${p} exists now: take it off the allowlist`).toBe(false);
  });

  it("recognises paths and leaves commands, URLs and placeholders alone", () => {
    expect(pathIn("apps/wgp/src/lib/market/math.ts")).toBe("apps/wgp/src/lib/market/math.ts");
    expect(pathIn("contracts/wgp/src/market.rs#buy_cost")).toBe("contracts/wgp/src/market.rs");
    expect(pathIn("docs/chapters/")).toBe("docs/chapters");
    expect(pathIn("market.rs")).toBe("market.rs");
    expect(pathIn("pnpm verify")).toBeNull();
    expect(pathIn("/play/market")).toBeNull();
    expect(pathIn("trophy:badge:case-00N")).toBeNull();
    expect(pathIn("test/golden/trial-<course>.{bin,json}")).toBeNull();
    expect(pathIn("game.wgpnear.near")).toBeNull();
  });
});
