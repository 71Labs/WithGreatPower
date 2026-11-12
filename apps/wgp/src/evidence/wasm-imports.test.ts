/**
 * scripts/near/check-wasm-imports.mjs is the guard the README's "Safe upgrades" row names: it
 * must refuse a contract wasm that imports a host function mainnet doesn't have, and pass one
 * that doesn't. This runs the real script on two tiny hand-assembled wasm modules.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ROOT } from "./repo";

const SCRIPT = path.join(ROOT, "scripts/near/check-wasm-imports.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "wgp-wasm-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const str = (s: string) => [s.length, ...Buffer.from(s, "ascii")];
const section = (id: number, body: number[]) => [id, body.length, ...body];

/** A valid wasm module that only imports the named `env` functions, each of type () -> (). */
function wasmImporting(names: string[]): Uint8Array<ArrayBuffer> {
  const types = section(1, [1, 0x60, 0, 0]);
  const imports = section(2, [names.length, ...names.flatMap((n) => [...str("env"), ...str(n), 0x00, 0])]);
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...types, ...imports]);
}

function check(names: string[]) {
  const file = path.join(dir, `${names.join("-") || "empty"}.wasm`);
  writeFileSync(file, wasmImporting(names));
  const res = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("check-wasm-imports", () => {
  it("builds modules WebAssembly itself accepts, with the imports asked for", () => {
    const names = WebAssembly.Module.imports(new WebAssembly.Module(wasmImporting(["promise_create", "storage_write"]))).map((i) => `${i.module}.${i.name}`);
    expect(names).toEqual(["env.promise_create", "env.storage_write"]);
  });

  it("passes a wasm that imports only host functions mainnet has", () => {
    const res = check(["promise_create", "promise_batch_action_function_call", "storage_write"]);
    expect(res.status).toBe(0);
    expect(res.out).toContain("wasm imports OK (3 host functions");
  });

  it.each(["promise_batch_action_use_global_contract", "promise_batch_action_state_init", "promise_batch_action_add_gas_key_with_function_call"])("refuses a wasm that imports %s, and names it", (name) => {
    const res = check(["promise_create", name]);
    expect(res.status).toBe(1);
    expect(res.out).toContain(`env.${name}`);
  });

  it("needs a file to check", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(res.status).toBe(2);
  });
});
