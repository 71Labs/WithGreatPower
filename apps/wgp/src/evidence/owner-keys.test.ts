/**
 * What the server does with the keys it holds (docs/KEYS.md):
 * - the factory key (FACTORY_PRIVATE_KEY, wgpnear.near's full-access key) signs one kind
 *   of transaction only, creating a player's account, and no server code names an
 *   owner-only method, so moving the contract's ownership off wgpnear.near (set_owner)
 *   takes nothing away from the live site;
 * - Sandwich Man's calls are each one deposit-free function call to the game contract, one
 *   of the five market methods: exactly what a function-call key limited to those may
 *   sign, so his full-access key can be swapped for one without a code change.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";

import { MARKET_METHODS } from "@/lib/near/policy";
import type { NpcAction } from "@/lib/market/npc-rules";
import { createAccountActions } from "@/server/near/factory";
import { npcTransaction } from "@/server/npc/chain";
import { npcSignerKey } from "@/server/npc/env";

import { ROOT, read } from "./repo";

const OWNER_METHODS = ["set_owner", "upgrade", "set_paused", "add_operator", "remove_operator", "set_rules", "set_market_params"];

/** Every non-test TypeScript file of the app, repository-relative. */
function appSources(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(ROOT, rel)).sort()) {
      const child = `${rel}/${name}`;
      if (statSync(path.join(ROOT, child)).isDirectory()) walk(child);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !child.includes("/src/test/")) out.push(child);
    }
  };
  walk("apps/wgp/src");
  return out;
}

describe("the factory key", () => {
  it("signs only account creation, and no server code calls an owner-only method", () => {
    const files = appSources();
    expect(files.length).toBeGreaterThan(100);
    // No app code names an owner-only method as a string (comments aside), so none can call one.
    for (const file of files) {
      const src = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const m of OWNER_METHODS) expect(src, `${file} names ${m}`).not.toMatch(new RegExp(`["'\`]${m}["'\`]`));
    }
    // The factory's key is read in one module only, and that module signs with it once.
    const readers = files.filter((f) => read(f).includes("factoryEnv(") && !f.endsWith("/server/near/env.ts"));
    expect(readers).toEqual(["apps/wgp/src/server/near/factory.ts"]);
    const factory = read("apps/wgp/src/server/near/factory.ts");
    expect(factory.match(/\.privateKey/g)).toHaveLength(1);
    expect(factory).toContain("const account = keyedAccount(factory.accountId, factory.privateKey);");
    expect(factory.match(/signAndSendTransaction\(/g)).toHaveLength(1);
    expect(factory).toMatch(/receiverId: accountId,\s*actions: createAccountActions\(/);
    // Those actions create the account and add the player's two keys: no function call at all.
    const user = KeyPair.fromRandom("ed25519").getPublicKey().toString();
    const session = KeyPair.fromRandom("ed25519").getPublicKey().toString();
    expect(createAccountActions({ userPublicKey: user, sessionPublicKey: session, contractId: "game.wgpnear.near", initialBalance: 0n }).map((a) => a.enum)).toEqual(["createAccount", "transfer", "addKey", "addKey"]);
    // And every owner-only method needs one yoctoNEAR attached, which only a full-access key can do.
    expect(read("contracts/wgp/src/lib.rs")).toMatch(/fn assert_owner\(&self\) \{\s*near_sdk::assert_one_yocto\(\);/);
  });
});

describe("Sandwich Man's key", () => {
  const said = { text: "", reason: "", rule: 0 };
  const every: NpcAction[] = [
    { ...said, kind: "fill", listingId: 7, item: "crumbs", amount: 2, price: 13, seller: "a.near" },
    { ...said, kind: "buy", item: "crumbs", amount: 2, maxBits: 27, expectBits: 26 },
    { ...said, kind: "sell", item: "crumbs", amount: 2, minBits: 21, expectBits: 22 },
    { ...said, kind: "list", item: "crumbs", amount: 2, price: 24 },
    { ...said, kind: "cancel", listingId: 7, item: "crumbs", amount: 2 },
  ];

  it("can be a function-call key for the game contract and the five market methods: every call he signs is one, with no deposit", () => {
    const methods = new Set<string>();
    for (const action of every) {
      const tx = npcTransaction(action, "game.wgpnear.near");
      expect(tx.receiverId).toBe("game.wgpnear.near");
      expect(tx.actions.map((a) => a.enum)).toEqual(["functionCall"]);
      const call = tx.actions[0]!.functionCall!;
      expect(call.deposit).toBe(0n);
      methods.add(call.methodName);
    }
    expect([...methods].sort()).toEqual([...MARKET_METHODS].sort());
    // The contract takes no deposit on those five (none is #[payable]), so a function-call key can sign each.
    const market = read("contracts/wgp/src/market.rs");
    for (const m of MARKET_METHODS) {
      const at = market.indexOf(`pub fn ${m}(`);
      expect(at, m).toBeGreaterThan(0);
      expect(market.slice(market.lastIndexOf("\n\n", at), at), m).not.toContain("#[payable]");
    }
  });

  it("is shown by its public key only, so anyone can see which of his keys the server holds", () => {
    const pair = KeyPair.fromRandom("ed25519");
    const env = { NPC_TRADER_ACCOUNT_ID: "sandwich.wgpnear.near", NPC_TRADER_PRIVATE_KEY: pair.toString() };
    expect(npcSignerKey(env)).toBe(pair.getPublicKey().toString());
    expect(npcSignerKey(env)).not.toContain(pair.toString().slice("ed25519:".length));
    expect(npcSignerKey({})).toBeNull();
    expect(npcSignerKey({ NPC_TRADER_ACCOUNT_ID: "sandwich.wgpnear.near", NPC_TRADER_PRIVATE_KEY: "nope" })).toBeNull();
  });
});
