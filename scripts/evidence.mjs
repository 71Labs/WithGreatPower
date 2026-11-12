#!/usr/bin/env node
/**
 * Checks that every claim in the README and docs still has the proof it names.
 *
 * One source, docs/evidence.json, pairs each claim with the code that implements it, the tests
 * that prove it and (for claims about mainnet or the live site) a read-only check. This script
 * reads that file and:
 *
 *   1. checks each claim's quote still appears in its document, each code pointer's anchor text
 *      still appears exactly once in its file, and each named test is still in its file;
 *   2. runs the tests, once per package (the app, game-core, the contract), and maps every
 *      result back to the claims that cite it;
 *   3. checks the test counts the README quotes against what just ran;
 *   4. with --chain, runs the read-only checks against NEAR mainnet and the live site;
 *   5. prints one PASS, FAIL or SKIP line per claim and exits 1 if any claim fails.
 *
 * No dependencies, no environment variables, and no network unless --chain is given.
 *
 *   pnpm evidence                    # steps 1, 2, 3 and 5
 *   pnpm evidence --chain            # and step 4
 *   pnpm evidence --check            # step 1 only, plus: docs/EVIDENCE.md is up to date
 *   pnpm evidence --write            # regenerate docs/EVIDENCE.md from docs/evidence.json
 *   pnpm evidence --only <id>[,<id>] # only these claims (runs only the test files they cite)
 *   pnpm evidence --json             # one JSON object instead of the table
 *
 * Exit code: 0 when no claim fails, 1 when one does, 2 for bad arguments or a broken
 * evidence.json. A SKIP is never a failure and always says why (no cargo, offline, not asked
 * for with --chain).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EVIDENCE_JSON = "docs/evidence.json";
export const EVIDENCE_MD = "docs/EVIDENCE.md";

export const STATUSES = ["proven by test", "proven on chain", "live check", "simulation only", "built, off on mainnet", "owner action needed"];

/** Where each package's tests run from, and how one test is run by hand. */
export const PACKAGES = {
  app: { dir: "apps/wgp", label: "app", filter: "wgp" },
  core: { dir: "packages/game-core", label: "game-core", filter: "@wgp/game-core" },
  contract: { dir: "contracts/wgp", label: "contract" },
};

const CHAIN_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------------------------
// Loading and static checks
// ---------------------------------------------------------------------------------------------

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

export function loadEvidence() {
  const data = JSON.parse(read(EVIDENCE_JSON));
  const problems = [];
  const ids = new Set();
  const sections = new Set(data.sections.map((s) => s.id));
  for (const c of data.claims) {
    const at = `claim ${c.id ?? "(no id)"}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id ?? "")) problems.push(`${at}: id must be lowercase words joined by hyphens`);
    if (ids.has(c.id)) problems.push(`${at}: duplicate id`);
    ids.add(c.id);
    if (!sections.has(c.section)) problems.push(`${at}: unknown section ${c.section}`);
    if (!STATUSES.includes(c.status)) problems.push(`${at}: unknown status "${c.status}"`);
    if (!c.source || !c.quote) problems.push(`${at}: needs a source document and a quote from it`);
    for (const t of c.tests ?? []) {
      if (!PACKAGES[t.pkg]) problems.push(`${at}: unknown test package ${t.pkg}`);
      if (/[|`]/.test(t.name)) problems.push(`${at}: test name "${t.name}" has a character the table can't carry`);
    }
    for (const id of c.chain ?? []) if (!data.checks?.[id]) problems.push(`${at}: unknown chain check ${id}`);
    const tests = (c.tests ?? []).length;
    const chain = (c.chain ?? []).length;
    if (c.status === "proven by test" && !tests) problems.push(`${at}: "proven by test" needs a test`);
    if (c.status === "simulation only" && !tests) problems.push(`${at}: "simulation only" needs a test of the simulation`);
    if (c.status === "built, off on mainnet" && !tests) problems.push(`${at}: "built, off on mainnet" needs a test of what is built`);
    if ((c.status === "proven on chain" || c.status === "live check") && !chain) problems.push(`${at}: "${c.status}" needs a chain or site check`);
    if (!tests && !chain && !(c.code ?? []).length) problems.push(`${at}: has no evidence at all`);
  }
  if (problems.length) {
    const err = new Error(`docs/evidence.json is broken:\n  ${problems.join("\n  ")}`);
    err.code = "BAD_EVIDENCE";
    throw err;
  }
  return data;
}

const fileCache = new Map();
function fileText(rel) {
  if (!fileCache.has(rel)) fileCache.set(rel, existsSync(path.join(ROOT, rel)) ? read(rel) : null);
  return fileCache.get(rel);
}

/** Markdown with its emphasis marks, link targets and line breaks flattened, to find a quote in. */
export const plain = (s) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ");

/** The 1-based line an anchor sits on, or why it can't be found. An anchor must match once. */
export function resolveAnchor(rel, anchor) {
  const text = fileText(rel);
  if (text === null) return { error: `${rel} doesn't exist` };
  if (!anchor) return { line: null };
  const first = text.indexOf(anchor);
  if (first < 0) return { error: `${rel}: anchor not found: ${JSON.stringify(anchor)}` };
  if (text.indexOf(anchor, first + 1) >= 0) return { error: `${rel}: anchor matches more than one place: ${JSON.stringify(anchor)}` };
  return { line: text.slice(0, first).split("\n").length };
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a test's file still declares it. Rust: `fn name(`. Vitest: it("name" or test("name". */
export function testDeclared(t) {
  const text = fileText(t.file);
  if (text === null) return `${t.file} doesn't exist`;
  const literal = t.nameInSource ?? t.name;
  if (t.pkg === "contract") {
    return new RegExp(`#\\[test\\]\\s*(?:#\\[[^\\]]*\\]\\s*)*fn ${reEscape(literal)}\\(`).test(text) ? null : `${t.file}: no #[test] fn ${literal}`;
  }
  const re = new RegExp(`\\b(?:it|test)(?:\\.each\\([^)]*\\))?\\(\\s*(["'\`])${reEscape(literal)}\\1`);
  return re.test(text) ? null : `${t.file}: no test named ${JSON.stringify(literal)}`;
}

/** Step 1 for one claim: a list of what no longer matches. */
export function staticProblems(claim) {
  const out = [];
  const doc = fileText(claim.source);
  if (doc === null) out.push(`${claim.source} doesn't exist`);
  else if (!plain(doc).includes(plain(claim.quote))) out.push(`${claim.source} no longer says: ${JSON.stringify(claim.quote)}`);
  for (const c of claim.code ?? []) {
    const r = resolveAnchor(c.path, c.anchor);
    if (r.error) out.push(r.error);
  }
  for (const t of claim.tests ?? []) {
    const p = testDeclared(t);
    if (p) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Running the tests
// ---------------------------------------------------------------------------------------------

function run(cmd, args, cwd, timeoutMs = 20 * 60_000) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
}

const hasCommand = (cmd) => run(cmd, ["--version"], ROOT, 30_000).status === 0;

/**
 * One vitest invocation for a package. `files` (package-relative) narrows it; null runs the
 * whole suite. Returns { results: Map<"file::title", status[]>, passed, failed, error }.
 */
function runVitest(pkg, files) {
  const dir = path.join(ROOT, PACKAGES[pkg].dir);
  if (!existsSync(path.join(dir, "node_modules"))) return { error: `${PACKAGES[pkg].dir}/node_modules is missing: run pnpm install --frozen-lockfile first` };
  const tmp = mkdtempSync(path.join(tmpdir(), "wgp-evidence-"));
  const outFile = path.join(tmp, "result.json");
  try {
    const res = run("pnpm", ["exec", "vitest", "run", ...(files ?? []), "--reporter=json", `--outputFile=${outFile}`], dir);
    if (!existsSync(outFile)) return { error: `vitest wrote no report (exit ${res.status}): ${(res.stderr || res.stdout || "").trim().split("\n").slice(-5).join(" / ")}` };
    const report = JSON.parse(readFileSync(outFile, "utf8"));
    const results = new Map();
    const failures = [];
    for (const file of report.testResults) {
      const rel = path.relative(ROOT, file.name).split(path.sep).join("/");
      for (const a of file.assertionResults) {
        const key = `${rel}::${a.title}`;
        const message = (a.failureMessages ?? []).join("\n").split("\n")[0] ?? "";
        if (!results.has(key)) results.set(key, []);
        results.get(key).push({ status: a.status, message });
        if (a.status === "failed") failures.push(`${rel}: “${a.title}”${message ? `: ${message}` : ""}`);
      }
    }
    return { results, failures, passed: report.numPassedTests, failed: report.numFailedTests, whole: files === null };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** One `cargo test --locked` for the contract. Results are keyed "file::fn". */
function runCargo() {
  const dir = path.join(ROOT, PACKAGES.contract.dir);
  const res = run("cargo", ["test", "--locked"], dir, 30 * 60_000);
  const text = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const results = new Map();
  const failures = [];
  let passed = 0;
  let failed = 0;
  for (const m of text.matchAll(/^test (\w+)::(\w+)(?: - should panic)? \.\.\. (ok|FAILED|ignored)/gm)) {
    const key = `contracts/wgp/src/${m[1]}.rs::${m[2]}`;
    results.set(key, [{ status: m[3] === "ok" ? "passed" : m[3] === "FAILED" ? "failed" : "skipped", message: "" }]);
    if (m[3] === "ok") passed++;
    if (m[3] === "FAILED") {
      failed++;
      failures.push(`contracts/wgp/src/${m[1]}.rs: ${m[2]}`);
    }
  }
  if (!results.size) return { error: `cargo test printed no results (exit ${res.status}): ${text.trim().split("\n").slice(-4).join(" / ")}` };
  return { results, failures, passed, failed, whole: true };
}

// ---------------------------------------------------------------------------------------------
// Read-only chain and site checks (--chain)
// ---------------------------------------------------------------------------------------------

class Offline extends Error {}

async function fetchJson(url, init = {}) {
  let res;
  // One retry: a public endpoint that times out once usually answers the second time.
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(CHAIN_TIMEOUT_MS) });
      break;
    } catch (e) {
      if (attempt < 2) continue;
      throw new Offline(`${new URL(url).host} can't be reached (${e.name === "TimeoutError" ? "timed out" : e.cause?.code ?? e.message})`);
    }
  }
  if (res.status === 429 || res.status >= 500) throw new Offline(`${new URL(url).host} answered HTTP ${res.status}`);
  return res;
}

async function rpc(urls, method, params) {
  let last;
  for (const url of urls) {
    try {
      const res = await fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return await res.json();
    } catch (e) {
      if (!(e instanceof Offline)) throw e;
      last = e;
    }
  }
  throw last;
}

/** `a.b.0`, `a.*.b` (maps over an array) and a trailing `.length`. */
export function pick(value, pathStr) {
  if (!pathStr) return value;
  let cur = [value];
  let mapped = false;
  for (const part of pathStr.split(".")) {
    if (part === "*") {
      cur = cur.flatMap((v) => (Array.isArray(v) ? v : []));
      mapped = true;
    } else cur = cur.map((v) => (v == null ? undefined : part === "length" && (Array.isArray(v) || typeof v === "string") ? v.length : v[part]));
  }
  return mapped ? cur : cur[0];
}

/** One expectation against a value. Returns null when it holds, else what was wrong. */
export function expectProblem(value, e) {
  const got = pick(value, e.path);
  const show = (v) => {
    const s = JSON.stringify(v);
    return s === undefined ? "undefined" : s.length > 160 ? `${s.slice(0, 160)}…` : s;
  };
  const where = e.path || "the answer";
  const num = (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
  switch (e.op) {
    case "eq":
      return JSON.stringify(got) === JSON.stringify(e.value) ? null : `${where} is ${show(got)}, expected ${show(e.value)}`;
    case "ne":
      return JSON.stringify(got) !== JSON.stringify(e.value) ? null : `${where} is still ${show(got)}`;
    case "gte":
      return typeof num(got) === "number" && num(got) >= e.value ? null : `${where} is ${show(got)}, expected at least ${e.value}`;
    case "includes":
      return (Array.isArray(got) || typeof got === "string") && got.includes(e.value) ? null : `${where} doesn't include ${show(e.value)}: ${show(got)}`;
    case "anyMatch": {
      const re = new RegExp(e.value);
      const list = Array.isArray(got) ? got : [got];
      return list.some((v) => typeof v === "string" && re.test(v)) ? null : `nothing in ${where} matches /${e.value}/: ${show(got)}`;
    }
    case "type":
      return (Array.isArray(got) ? "array" : got === null ? "null" : typeof got) === e.value ? null : `${where} is ${show(got)}, expected a ${e.value}`;
    default:
      return `unknown op ${e.op}`;
  }
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");

/** Runs one check. Resolves to { ok: true } | { ok: false, why } | { skip: why }. */
async function runChainCheck(check, meta) {
  try {
    let value;
    if (check.kind === "view") {
      const j = await rpc(meta.rpc, "query", { request_type: "call_function", finality: "final", account_id: check.contract ?? meta.contract, method_name: check.method, args_base64: b64(check.args ?? {}) });
      const failure = j.result?.error ?? j.error?.data ?? j.error?.message;
      if (check.absent) {
        // The claim is that the deployed contract has no such method.
        if (j.result?.result) return { ok: false, why: `${check.method} now answers on ${check.contract ?? meta.contract}. ${check.whenFails ?? "The claim is out of date."}` };
        return /MethodNotFound/.test(String(failure)) ? { ok: true } : { ok: false, why: `${check.method}: expected MethodNotFound, got ${String(failure).slice(0, 200)}` };
      }
      if (!j.result?.result) return { ok: false, why: `${check.method}: ${String(failure ?? JSON.stringify(j)).slice(0, 200)}` };
      value = JSON.parse(Buffer.from(j.result.result).toString("utf8"));
    } else if (check.kind === "account") {
      const j = await rpc(meta.rpc, "query", { request_type: "view_account", finality: "final", account_id: check.account });
      const missing = j.error?.cause?.name === "UNKNOWN_ACCOUNT";
      if (!j.result && !missing) return { ok: false, why: `view_account: ${j.error?.data ?? JSON.stringify(j).slice(0, 200)}` };
      value = { exists: !missing, ...(j.result ?? {}) };
    } else if (check.kind === "tx") {
      const j = await rpc(meta.archivalRpc, "tx", { tx_hash: check.hash, sender_account_id: check.sender, wait_until: "FINAL" });
      if (!j.result) return { ok: false, why: `tx ${check.hash}: ${j.error?.data ?? j.error?.message ?? "no result"}` };
      const actions = j.result.transaction.actions.flatMap((a) => (a.Delegate ? a.Delegate.delegate_action.actions : [a]));
      const delegate = j.result.transaction.actions.find((a) => a.Delegate)?.Delegate.delegate_action;
      value = {
        signer: j.result.transaction.signer_id,
        receiver: delegate?.receiver_id ?? j.result.transaction.receiver_id,
        sender: delegate?.sender_id ?? j.result.transaction.signer_id,
        relayed: !!delegate,
        actions: actions.map((a) => (typeof a === "string" ? a : a.FunctionCall ? a.FunctionCall.method_name : Object.keys(a)[0])),
        deposits: actions.map((a) => a.FunctionCall?.deposit).filter((d) => d !== undefined),
        succeeded: j.result.status?.SuccessValue !== undefined && j.result.receipts_outcome.every((o) => !o.outcome.status?.Failure),
        logs: j.result.receipts_outcome.flatMap((o) => o.outcome.logs),
      };
    } else if (check.kind === "http") {
      const res = await fetchJson(check.url, { headers: { accept: check.text ? "text/html" : "application/json" } });
      if (res.status !== (check.status ?? 200)) return { ok: false, why: `${check.url} answered HTTP ${res.status}` };
      value = check.text ? { text: await res.text() } : await res.json();
    } else if (check.kind === "git") {
      // Local, no network: is `first` an ancestor of `then`, and did `first` add `adds`?
      const git = (...args) => run("git", args, ROOT, 30_000);
      if (git("rev-parse", "--is-inside-work-tree").status !== 0) return { skip: "this isn't a git checkout, so commit history can't be read" };
      if (git("cat-file", "-e", `${check.first}^{commit}`).status !== 0 || git("cat-file", "-e", `${check.then}^{commit}`).status !== 0) return { skip: `commits ${check.first} and ${check.then} aren't in this clone (a shallow clone has no history)` };
      const added = git("show", "--diff-filter=A", "--name-only", "--format=", check.first).stdout.split("\n");
      value = { ancestor: git("merge-base", "--is-ancestor", check.first, check.then).status === 0, added };
    } else if (check.kind === "command") {
      const res = run(check.command[0], check.command.slice(1), ROOT, check.timeoutMs ?? 180_000);
      const text = `${res.stdout ?? ""}${res.stderr ?? ""}`;
      if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT/.test(text)) return { skip: `${check.command.join(" ")} couldn't reach the network` };
      value = { exit: res.status, lines: text.split("\n") };
      if (check.json) {
        try {
          value.json = JSON.parse(res.stdout);
        } catch {
          return { ok: false, why: `${check.command.join(" ")} didn't print JSON (exit ${res.status})` };
        }
        if (check.skipUnless && !pick(value, check.skipUnless)) return { skip: `${check.command.join(" ")} couldn't read all of its source: ${(value.json.notes ?? []).join("; ") || "no data"}` };
      }
    } else return { ok: false, why: `unknown check kind ${check.kind}` };
    const problems = (check.expect ?? []).map((e) => expectProblem(value, e)).filter(Boolean);
    return problems.length ? { ok: false, why: `${problems.join("; ")}${check.whenFails ? `. ${check.whenFails}` : ""}` } : { ok: true };
  } catch (e) {
    if (e instanceof Offline) return { skip: e.message };
    return { ok: false, why: e.message };
  }
}

// ---------------------------------------------------------------------------------------------
// docs/EVIDENCE.md
// ---------------------------------------------------------------------------------------------

const shellQuote = (s) => (/'/.test(s) ? `"${s.replace(/(["\\$`])/g, "\\$1")}"` : `'${s}'`);
/** vitest's -t is a regular expression; these are the characters that would change its meaning. */
const forVitest = (name) => name.replace(/[()[\]{}+*?^$\\]/g, "\\$&");

export function runCommand(t) {
  if (t.pkg === "contract") return `(cd contracts/wgp && cargo test --locked ${t.name})`;
  const pkg = PACKAGES[t.pkg];
  return `pnpm --filter ${pkg.filter} exec vitest run ${path.posix.relative(pkg.dir, t.file)} -t ${shellQuote(forVitest(t.name))}`;
}

function curlFor(check, meta) {
  const rpcCall = (url, method, params) => `curl -s ${url} -H 'content-type: application/json' -d '${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}'`;
  if (check.kind === "view") {
    return `${rpcCall(meta.rpc[0], "query", { request_type: "call_function", finality: "final", account_id: check.contract ?? meta.contract, method_name: check.method, args_base64: b64(check.args ?? {}) })} \\\n  | jq -r '.result.result | implode' | jq .`;
  }
  if (check.kind === "account") return `${rpcCall(meta.rpc[0], "query", { request_type: "view_account", finality: "final", account_id: check.account })} | jq '.result // .error.cause'`;
  if (check.kind === "tx") {
    return `${rpcCall(meta.archivalRpc[0], "tx", { tx_hash: check.hash, sender_account_id: check.sender, wait_until: "FINAL" })} \\\n  | jq '{signer: .result.transaction.signer_id, status: .result.status, actions: .result.transaction.actions, logs: [.result.receipts_outcome[].outcome.logs[]]}'`;
  }
  if (check.kind === "http") return check.text ? `curl -s -o /dev/null -w '%{http_code}\\n' '${check.url}'` : `curl -s '${check.url}' | jq .`;
  if (check.kind === "command") return check.command.join(" ");
  if (check.kind === "git") return `git merge-base --is-ancestor ${check.first} ${check.then} && echo "${check.first} came first"\ngit show --diff-filter=A --name-only --format='%h %ad' ${check.first}`;
  return "";
}

const describeExpect = (e) => {
  const where = e.path ? `\`${e.path}\`` : "the answer";
  const v = `\`${JSON.stringify(e.value)}\``;
  return { eq: `${where} is ${v}`, ne: `${where} is not ${v}`, gte: `${where} is at least ${v}`, includes: `${where} includes ${v}`, anyMatch: `something in ${where} matches \`/${e.value}/\``, type: `${where} is a ${e.value}` }[e.op];
};

const cell = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderMarkdown(data) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, data.claims.filter((c) => c.status === s).length]));
  const out = [];
  out.push("# Evidence");
  out.push("");
  out.push("<!-- Generated by `pnpm evidence --write` from docs/evidence.json. Don't edit this file: edit the JSON and regenerate. -->");
  out.push("");
  out.push(
    `Every claim the README and the docs make, paired with the code that does it, the test that proves it and one command that runs that proof. ${data.claims.length} claims. The source is [evidence.json](evidence.json); [\`scripts/evidence.mjs\`](../scripts/evidence.mjs) checks all of it.`,
  );
  out.push("");
  out.push("```bash");
  out.push("pnpm install --frozen-lockfile");
  out.push("pnpm evidence            # every claim's code pointers and tests: no network, no keys, no env");
  out.push("pnpm evidence --chain    # also the read-only checks against NEAR mainnet and the live site");
  out.push("pnpm evidence --only track-pricing-file,track-merchant-broke   # just these claims");
  out.push("pnpm evidence --json     # the same result as one JSON object");
  out.push("```");
  out.push("");
  out.push("**What a line means.** `PASS`: the claim's quote is still in its document, each code pointer still matches its file, each named test is still in its file and passed just now, and (with `--chain`) each read-only check answered as expected. `FAIL`: one of those didn't hold; the line says which. `SKIP`: the proof couldn't run here, and the line says why (no `cargo`, offline, or a claim that rests on the chain run without `--chain`). A claim proven by tests passes on its tests; if it also has a chain check, that runs with `--chain`. The script exits 1 on any `FAIL`.");
  out.push("");
  out.push("**What a status means.** A status says how far the proof reaches, and it is set by hand to the weakest true reading.");
  out.push("");
  out.push("| Status | Meaning | Claims |");
  out.push("|---|---|---|");
  const meaning = {
    "proven by test": "A test in this repo runs the real code path and asserts the claim. Runs offline.",
    "proven on chain": "A read-only call to NEAR mainnet shows it: contract state, or a transaction that happened. Needs `--chain`.",
    "live check": "A read-only request to the live site (or a third-party index of the chain) shows it. Needs `--chain`.",
    "simulation only": "True in the simulated market or the economy lab, and tested there. Not something mainnet does.",
    "built, off on mainnet": "The code and its tests are here, and it is switched off or not yet triggered on mainnet.",
    "owner action needed": "Only the owner can make it true (a transaction, a setting or a deploy). The pointer shows what is ready.",
  };
  for (const s of STATUSES) out.push(`| \`${s}\` | ${meaning[s]} | ${counts[s]} |`);
  out.push("");
  out.push("Line numbers below are computed from a short piece of text in each file (the anchor in evidence.json). If the code moves, `pnpm evidence --check` fails until this file is regenerated; if the text is gone, the claim fails.");
  out.push("");
  for (const section of data.sections) {
    const claims = data.claims.filter((c) => c.section === section.id);
    if (!claims.length) continue;
    out.push(`## ${section.title}`);
    out.push("");
    if (section.about) {
      out.push(section.about);
      out.push("");
    }
    out.push("| Claim | Code | Test | Run | Status |");
    out.push("|---|---|---|---|---|");
    for (const c of claims) {
      const depth = "../";
      const src = c.source === "README.md" ? "README" : c.source.replace(/^docs\//, "");
      const code = (c.code ?? []).map((p) => {
        const { line } = resolveAnchor(p.path, p.anchor);
        const label = line ? `${p.path}:${line}` : p.path;
        return `[\`${label}\`](${depth}${p.path}${line ? `#L${line}` : ""})${p.what ? ` ${p.what}` : ""}`;
      });
      const tests = (c.tests ?? []).map((t) => `\`${t.file}\`: “${t.name}”`);
      const runs = (c.tests ?? []).map((t) => `\`${runCommand(t)}\``);
      if ((c.chain ?? []).length) runs.push(`\`pnpm evidence --chain --only ${c.id}\` (${c.chain.map((id) => `[${id}](#check-${id})`).join(", ")})`);
      const claimCell = `<a id="${c.id}"></a>${c.quote}<br><sub>${src} · \`${c.id}\`</sub>${c.note ? `<br><sub>${c.note}</sub>` : ""}`;
      out.push(`| ${cell(claimCell)} | ${cell(code.join("<br>") || "n/a")} | ${cell(tests.join("<br>") || "n/a")} | ${cell(runs.join("<br>") || "n/a")} | \`${c.status}\` |`);
    }
    out.push("");
  }
  out.push("## Read-only checks");
  out.push("");
  out.push("What `--chain` runs. Each is a view call, a lookup of a transaction that already happened, or a GET. None sends a transaction or needs a key. The command under each is the same request by hand. Numbers are checked as lower bounds: the live count must be at least the one the document quotes. A check on something that is off or missing today (an account that doesn't exist, a method the deployed contract lacks) fails the day that changes, which is the signal to update the claim.");
  out.push("");
  for (const [id, check] of Object.entries(data.checks ?? {})) {
    const used = data.claims.filter((c) => (c.chain ?? []).includes(id)).map((c) => `[\`${c.id}\`](#${c.id})`);
    out.push(`### <a id="check-${id}"></a>${id}`);
    out.push("");
    out.push(`${check.about} Used by ${used.join(", ") || "no claim"}.`);
    out.push("");
    out.push("```bash");
    out.push(curlFor(check, data.meta));
    out.push("```");
    out.push("");
    out.push("Expected:");
    out.push("");
    if (check.kind === "tx") out.push("- (fields as the script reads them: `signer`, `sender` and `receiver` of the call, `relayed`, `actions`, `deposits`, `succeeded`, `logs`)");
    if (check.kind === "command") out.push(`- (\`exit\` is the exit code, \`lines\` the output${check.json ? ", `json` the JSON it prints" : ""})`);
    if (check.kind === "view" && check.absent) out.push(`- the call fails with \`MethodNotFound\`: ${check.contract ?? data.meta.contract} has no \`${check.method}\``);
    if (check.kind === "account") out.push("- (`exists` is false when the RPC answers `UNKNOWN_ACCOUNT`)");
    if (check.kind === "git") out.push("- (`ancestor`: the first commit is in the second one's history; `added`: the files the first commit added)");
    if (check.kind === "http" && check.text) out.push("- (`text` is the page's HTML)");
    for (const e of check.expect ?? []) out.push(`- ${describeExpect(e)}`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { chain: false, check: false, write: false, json: false, only: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--chain") o.chain = true;
    else if (a === "--check") o.check = true;
    else if (a === "--write") o.write = true;
    else if (a === "--json") o.json = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--only") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("--only needs one or more claim ids, comma-separated");
      o.only = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--") continue;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const HELP = `Usage: pnpm evidence [--chain] [--only <id>[,<id>]] [--json]
       pnpm evidence --check | --write

  (no flags)   check every claim's pointers, run every test, print PASS/FAIL/SKIP per claim
  --chain      also run the read-only checks against NEAR mainnet and the live site
  --only ids   only these claims, and only the test files they cite
  --json       print one JSON object
  --check      pointers only (no tests), and fail if docs/EVIDENCE.md is out of date
  --write      regenerate docs/EVIDENCE.md from docs/evidence.json
`;

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${HELP}`);
    return 2;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  let data;
  try {
    data = loadEvidence();
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const log = opts.json ? () => {} : (s) => console.log(s);

  if (opts.write) {
    const broken = data.claims.flatMap((c) => staticProblems(c).map((p) => `${c.id}: ${p}`));
    if (broken.length) {
      console.error(`Not written: fix these first.\n  ${broken.join("\n  ")}`);
      return 1;
    }
    writeFileSync(path.join(ROOT, EVIDENCE_MD), renderMarkdown(data));
    log(`Wrote ${EVIDENCE_MD}: ${data.claims.length} claims.`);
    return 0;
  }

  let claims = data.claims;
  if (opts.only) {
    const unknown = opts.only.filter((id) => !data.claims.some((c) => c.id === id));
    if (unknown.length) {
      console.error(`No such claim: ${unknown.join(", ")}`);
      return 2;
    }
    claims = data.claims.filter((c) => opts.only.includes(c.id));
  }

  /** id -> { fails: string[], skips: string[] } */
  const verdict = new Map(claims.map((c) => [c.id, { fails: staticProblems(c), skips: [] }]));
  const notices = [];
  const totals = {};
  /** Claims that passed on their tests while an extra chain check went unrun. */
  const unrun = new Set();

  // The generated markdown must match, whenever the whole file is in play.
  let markdownStale = false;
  if (!opts.only) {
    const anyBroken = [...verdict.values()].some((v) => v.fails.length);
    if (!anyBroken) {
      const current = fileText(EVIDENCE_MD);
      markdownStale = current !== renderMarkdown(data);
    }
  }

  if (!opts.check) {
    // Tests, one invocation per package.
    for (const pkg of Object.keys(PACKAGES)) {
      const cited = claims.flatMap((c) => (c.tests ?? []).filter((t) => t.pkg === pkg).map((t) => ({ claim: c, t })));
      const counted = claims.flatMap((c) => (c.counts ?? []).filter((n) => n.pkg === pkg).map((n) => ({ claim: c, n })));
      if (!cited.length && !counted.length) continue;
      let outcome;
      if (pkg === "contract") {
        if (!hasCommand("cargo")) {
          const why = "cargo isn't installed, so the contract's tests didn't run (install Rust with rustup to run them)";
          notices.push(`SKIPPED contract tests: ${why}.`);
          for (const { claim } of [...cited, ...counted]) verdict.get(claim.id).skips.push(why);
          continue;
        }
        log("Running the contract's tests (cargo test --locked)…");
        outcome = runCargo();
      } else {
        const whole = !opts.only;
        const files = whole ? null : [...new Set(cited.map(({ t }) => path.posix.relative(PACKAGES[pkg].dir, t.file)))];
        log(`Running ${PACKAGES[pkg].label}'s tests (${whole ? "the whole suite" : `${files.length} file${files.length === 1 ? "" : "s"}`})…`);
        outcome = runVitest(pkg, files);
      }
      if (outcome.error) {
        for (const { claim } of [...cited, ...counted]) verdict.get(claim.id).fails.push(`${PACKAGES[pkg].label}: ${outcome.error}`);
        continue;
      }
      totals[pkg] = { passed: outcome.passed, failed: outcome.failed, whole: outcome.whole, failures: outcome.failures };
      for (const { claim, t } of cited) {
        const hits = outcome.results.get(`${t.file}::${t.name}`);
        const v = verdict.get(claim.id);
        if (!hits) v.fails.push(`${t.file}: “${t.name}” didn't run`);
        else for (const h of hits) if (h.status !== "passed") v.fails.push(`${t.file}: “${t.name}” ${h.status}${h.message ? `: ${h.message}` : ""}`);
      }
      for (const { claim, n } of counted) {
        const v = verdict.get(claim.id);
        if (!outcome.whole) {
          v.skips.push(`the ${PACKAGES[pkg].label} test count is only checked when the whole suite runs (without --only)`);
          continue;
        }
        const m = new RegExp(n.pattern).exec(read(claim.source));
        const quoted = m ? Number(m[1].replace(/,/g, "")) : NaN;
        if (quoted !== outcome.passed) v.fails.push(`${claim.source} says ${m ? m[1] : "nothing"} ${PACKAGES[pkg].label} tests pass; ${outcome.passed} passed just now`);
        for (const f of outcome.failures) v.fails.push(`failed: ${f}`);
      }
    }

    // Read-only chain and site checks.
    const isLocal = (id) => data.checks[id].kind === "git";
    const wanted = [...new Set(claims.flatMap((c) => c.chain ?? []))].filter((id) => opts.chain || isLocal(id));
    if (!opts.chain) {
      // A claim that rests on the chain or the live site can't pass without them. A claim proven
      // by tests passes on its tests; its chain check is extra and is noted, not counted.
      for (const c of claims) {
        if (!(c.chain ?? []).some((id) => !isLocal(id))) continue;
        if (c.status === "proven on chain" || c.status === "live check") verdict.get(c.id).skips.push("its proof is a chain or site check, which wasn't run (add --chain)");
        else unrun.add(c.id);
      }
    }
    if (wanted.length) {
      if (opts.chain) log(`Running ${wanted.filter((id) => !isLocal(id)).length} read-only checks against NEAR mainnet and the live site…`);
      const results = new Map();
      // A few at a time: public endpoints rate-limit bursts.
      const queue = [...wanted];
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let id = queue.shift(); id; id = queue.shift()) results.set(id, await runChainCheck(data.checks[id], data.meta));
        }),
      );
      for (const c of claims) {
        for (const id of c.chain ?? []) {
          const r = results.get(id);
          if (!r) continue;
          const v = verdict.get(c.id);
          if (r.skip) v.skips.push(`${id}: ${r.skip}`);
          else if (!r.ok) v.fails.push(`${id}: ${r.why}`);
        }
      }
      const skipped = [...results].filter(([, r]) => r.skip);
      for (const [id, r] of skipped) notices.push(`SKIPPED check ${id}: ${r.skip}.`);
    }
  }

  // The table.
  const rows = claims.map((c) => {
    const v = verdict.get(c.id);
    const result = v.fails.length ? "FAIL" : v.skips.length ? "SKIP" : "PASS";
    return { id: c.id, section: c.section, status: c.status, result, reasons: v.fails.length ? v.fails : [...new Set(v.skips)], chainCheckRun: (c.chain ?? []).length ? !unrun.has(c.id) && result !== "SKIP" : null, claim: c.quote, source: c.source };
  });
  const tally = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of rows) tally[r.result]++;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  const failed = tally.FAIL > 0 || markdownStale;

  if (opts.json) {
    console.log(JSON.stringify({ ok: !failed, mode: opts.check ? "check" : opts.chain ? "tests+chain" : "tests", claims: rows.length, tally, byStatus, tests: totals, markdownUpToDate: opts.only ? null : !markdownStale, notices, results: rows }, null, 2));
    return failed ? 1 : 0;
  }

  const width = Math.max(...rows.map((r) => r.id.length));
  const statusWidth = Math.max(...rows.map((r) => r.status.length));
  log("");
  for (const section of data.sections) {
    const mine = rows.filter((r) => r.section === section.id);
    if (!mine.length) continue;
    log(section.title);
    for (const r of mine) {
      const claim = r.claim.length > 78 ? `${r.claim.slice(0, 77)}…` : r.claim;
      log(`  ${r.result}  ${r.id.padEnd(width)}  ${r.status.padEnd(statusWidth)}  ${claim}`);
      if (r.result !== "PASS") for (const why of r.reasons) log(`        ${r.result === "FAIL" ? "✗" : "·"} ${why}`);
    }
  }
  log("");
  for (const n of notices) log(n);
  for (const [pkg, t] of Object.entries(totals)) {
    log(`${PACKAGES[pkg].label}: ${t.passed} passed, ${t.failed} failed${t.whole ? "" : " (cited files only)"}`);
    for (const f of t.failures) log(`  failed: ${f}`);
  }
  if (markdownStale) log(`FAIL  ${EVIDENCE_MD} is out of date with ${EVIDENCE_JSON}: run pnpm evidence --write and commit it.`);
  log(`${rows.length} claims: ${tally.PASS} PASS, ${tally.FAIL} FAIL, ${tally.SKIP} SKIP${opts.check ? " (pointers only; tests not run)" : ""}.`);
  if (unrun.size) log(`${unrun.size} of the PASS lines also have a chain or site check that wasn't run: add --chain.`);
  log(`By status: ${STATUSES.filter((s) => byStatus[s]).map((s) => `${byStatus[s]} ${s}`).join(" · ")}.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
