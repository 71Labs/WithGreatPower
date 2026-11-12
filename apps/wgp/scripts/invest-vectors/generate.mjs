#!/usr/bin/env node
/**
 * Regenerates apps/wgp/src/lib/market/invest-vectors.json from the contract's own Rust.
 *
 *   node apps/wgp/scripts/invest-vectors/generate.mjs [git-ref]
 *
 * The ref defaults to origin/review/contract-v3 (the reviewed v3 contract; not deployed).
 * It exports that ref's contracts/wgp into a temporary directory (`git archive`; no
 * worktree, nothing checked out here), drops ./invest_vectors.rs in as a test module,
 * runs it with cargo, writes the JSON it prints and deletes the directory. Nothing is
 * added to this branch's contracts/ and nothing is sent anywhere.
 *
 * Needs cargo and the contract's toolchain (contracts/wgp/rust-toolchain.toml). Set
 * CARGO_TARGET_DIR to reuse a build cache; by default the build lands in the temporary
 * directory and is deleted with it (about 1 GB while it runs). INVEST_VECTORS_TMP picks
 * where that directory goes.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const ref = process.argv[2] ?? "origin/review/contract-v3";
const out = resolve(here, "../../src/lib/market/invest-vectors.json");

const commit = execFileSync("git", ["rev-parse", ref], { cwd: repo, encoding: "utf8" }).trim();
const tree = mkdtempSync(join(process.env.INVEST_VECTORS_TMP ?? tmpdir(), "wgp-invest-vectors-"));
try {
  const tar = execFileSync("git", ["archive", "--format=tar", commit, "contracts/wgp"], { cwd: repo, maxBuffer: 512 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", tree], { input: tar });
  const crate = join(tree, "contracts/wgp");
  copyFileSync(join(here, "invest_vectors.rs"), join(crate, "src/v3_tests/invest_vectors.rs"));
  appendFileSync(join(crate, "src/v3_tests.rs"), "\nmod invest_vectors;\n");
  const printed = execFileSync("cargo", ["test", "--locked", "print_invest_vectors", "--", "--ignored", "--nocapture"], {
    cwd: crate,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const m = /<<<INVEST-VECTORS\n([\s\S]*?)\nINVEST-VECTORS>>>/.exec(printed);
  if (!m) throw new Error("The test printed no vectors");
  const vectors = JSON.parse(m[1]);
  vectors.source = { ref, commit };
  writeFileSync(out, `${JSON.stringify(vectors)}\n`);
  const steps = vectors.scenarios.reduce((n, s) => n + s.steps.length, 0);
  console.log(`Wrote ${out}: ${vectors.scenarios.length} scenarios, ${steps} steps, from ${ref} (${commit.slice(0, 7)})`);
} finally {
  rmSync(tree, { recursive: true, force: true });
}
