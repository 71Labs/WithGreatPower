/**
 * Claims about what this repository does NOT do, or has built but not switched on. Each is
 * checked against the source that would have to change for the claim to stop being true.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, evidence, plainDoc, read } from "./repo";

/** Every `pub fn` in a Rust file, by name. */
const pubFns = (file: string) => [...read(file).matchAll(/^\s*pub fn (\w+)/gm)].map((m) => m[1]!);

describe("the deployed contract's NEP-245 surface (contracts/wgp, v2)", () => {
  const mt = pubFns("contracts/wgp/src/mt.rs").filter((name) => name.startsWith("mt_"));

  it("has the core transfers, the balance and supply views and mt_tokens_for_owner, and nothing else", () => {
    expect(mt.sort()).toEqual(
      ["mt_balance_of", "mt_batch_balance_of", "mt_batch_supply", "mt_batch_transfer", "mt_batch_transfer_call", "mt_resolve_transfer", "mt_supply", "mt_token", "mt_tokens_for_owner", "mt_transfer", "mt_transfer_call"].sort(),
    );
  });

  it("has no metadata extension, no global enumeration and no approval methods anywhere in the contract", () => {
    const all = ["lib.rs", "mt.rs", "market.rs", "events.rs", "migrate.rs"].flatMap((f) => pubFns(`contracts/wgp/src/${f}`));
    expect(all.filter((name) => /^mt_metadata|^mt_tokens$|^mt_approve|^mt_revoke|^mt_is_approved/.test(name))).toEqual([]);
  });

  it("has no way to invest in the merchant: the market's calls are trades, listings and the owner's settings", () => {
    const market = pubFns("contracts/wgp/src/market.rs").filter((name) => !["new", "reserves", "spot_milli", "buy_cost", "sell_payout", "fee_of", "listing_bounds", "apply_buy", "apply_sell"].includes(name));
    expect(market.sort()).toEqual(["bits_of", "buy_listing", "cancel_listing", "list_item", "market_account", "market_buy", "market_listing", "market_listings", "market_quote", "market_sell", "market_state", "set_market_params"].sort());
    expect(market.some((name) => /invest/.test(name))).toBe(false);
  });

  it("says so in the README, and names v3 as built and not deployed", () => {
    const readme = read("README.md");
    expect(readme).toContain("It has no metadata extension, no global enumeration (`mt_tokens`) and no approvals.");
    expect(readme).toContain("and it is not deployed. Its source is on the branch `review/contract-v3`, not on `main`; the review's findings, test counts and commits are in [docs/CONTRACT-V3-REVIEW.md](docs/CONTRACT-V3-REVIEW.md).");
    expect(readme).toContain("The deployed contract (v2) has no way to invest in her to reopen; investing is in v3, which is not deployed.");
  });
});

describe("NEAR Intents: only the Gas tank, only to the relayer", () => {
  /** Every source file under a directory (tests and generated files left out), as repository paths. */
  const sources = (rel: string): string[] =>
    readdirSync(path.join(ROOT, rel)).flatMap((name) => {
      const child = `${rel}/${name}`;
      if (["node_modules", ".next", "target", ".data"].includes(name)) return [];
      if (statSync(path.join(ROOT, child)).isDirectory()) return sources(child);
      return /\.(ts|tsx|mjs|js|rs|sh|json)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [child] : [];
    });

  it("only the Gas tank's client talks to 1Click, the contract names no Intents code, and the README says so", () => {
    const files = ["apps/wgp/src", "packages/game-core/src", "contracts/wgp/src", "scripts"].flatMap(sources);
    expect(files.length).toBeGreaterThan(100);
    // Code only: comments may compare (events.rs says its events copy intents.near's fields), and the
    // relayer's tests use intents.near as a foreign receiver it must refuse. Neither is a use.
    const code = (f: string) => read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l)).join("\n");
    const naming = files.filter((f) => /intents\.near|near-intents|chaindefuser|\bdefuse(?:[_-]|\b)/i.test(code(f)));
    // pnpm costs reads 1Click's public token list for NEAR's price, the one a refill is priced at; it asks for no quote or deposit address.
    expect(naming, "only the Gas tank's 1Click client may name NEAR Intents in code").toEqual(["apps/wgp/src/server/intents/one-click.ts", "scripts/costs.mjs"]);
    expect(code("scripts/costs.mjs").match(/https:\/\/1click\.chaindefuser\.com\S*/g)).toEqual(['https://1click.chaindefuser.com/v0/tokens";']);
    expect(read("contracts/wgp/src/events.rs")).toContain("`MtEvent` mirrors `defuse_nep245::MtEvent` field for field");
    for (const pkg of ["apps/wgp/package.json", "packages/game-core/package.json", "package.json"]) expect(read(pkg), pkg).not.toMatch(/intents|defuse/i);
    const row = plainDoc("README.md").split("\n").find((l) => l.startsWith("| NEAR Intents"));
    expect(row).toContain("The Gas tank refills the relayer from 5 chains through NEAR Intents' 1Click API.");
    expect(row).toContain("A real refill is owner action needed until one lands on chain.");
  });

  it("the Gas tank's quotes always name the relayer from the server's settings", () => {
    const client = read("apps/wgp/src/server/intents/one-click.ts");
    expect(client).toContain("recipient: args.recipient,");
    expect(client).toContain('const recipient = env.RELAYER_ACCOUNT_ID?.trim() ?? "";');
    expect(read("apps/wgp/src/app/api/intents/quote/route.ts")).toContain("return json(await quoteRefill(parsed.data, config));");
  });
});

describe("no cron jobs", () => {
  it("vercel.json schedules nothing", () => {
    const config = JSON.parse(read("apps/wgp/vercel.json")) as Record<string, unknown>;
    expect(config).not.toHaveProperty("crons");
  });

  it("no workflow in .github runs on a schedule", () => {
    expect(read(".github/workflows/ci.yml")).not.toMatch(/^\s*schedule:/m);
  });
});

describe("pushes to main don't deploy", () => {
  it("vercel.json turns git deployments off for main, so a push to main deploys nothing", () => {
    const config = JSON.parse(read("apps/wgp/vercel.json")) as { git?: { deploymentEnabled?: Record<string, boolean> | boolean } };
    const enabled = config.git?.deploymentEnabled;
    expect(typeof enabled).toBe("object");
    expect((enabled as Record<string, boolean>).main).toBe(false);
    // There is one vercel.json, the app's: no second file at the root could turn it back on.
    expect(() => read("vercel.json")).toThrow();
    // Production goes out through the script the README names.
    expect(read("scripts/deploy-prod.sh")).toMatch(/vercel\b[^\n]*--prod/);
    expect(read("README.md")).toContain("pushes to `main` don't deploy by themselves (`apps/wgp/vercel.json`)");
  });
});

describe("the faucet taper is written and not wired in", () => {
  it("the ranked submit path pays nightBits, and never calls taperedNightBits", () => {
    const runs = read("apps/wgp/src/server/db/runs.ts");
    expect(runs).toMatch(/const bits = nightBits\(/);
    expect(runs).not.toContain("taperedNightBits");
    expect(read("apps/wgp/src/lib/market/rewards.ts")).toContain("export function taperedNightBits(");
  });
});

/**
 * Sandwich Man has traded on mainnet since Nov 13, 2026, because the owner set his account and
 * key in production. The repository still turns nothing on by itself, and the chain checks
 * now expect him there.
 */
describe("Sandwich Man runs only where the owner turned him on", () => {
  it("the chain checks expect him on mainnet: his account with its function-call key, the live site on chain, and his calls as a lower bound", () => {
    type Check = { kind: string; account?: string; keys?: boolean; expect: { path: string; op: string; value?: unknown; doc?: string }[] };
    const checks = evidence().checks as unknown as Record<string, Check>;
    const expects = (id: string) => checks[id]!.expect.map((e) => `${e.path} ${e.op} ${JSON.stringify(e.value)}`);

    expect(checks["sandwich-account"]).toMatchObject({ kind: "account", account: "sandwich.wgpnear.near", keys: true });
    expect(expects("sandwich-account")).toEqual(expect.arrayContaining(["exists eq true", "keys.length eq 1"]));
    // His one key is a function-call key for the game contract (docs/KEYS.md), not a full-access key.
    expect(expects("sandwich-key")).toEqual(expect.arrayContaining(["fullAccessKeys.length eq 0", "functionCallKeys.length eq 1", 'functionCallKeys.0.receiver_id eq "game.wgpnear.near"']));
    expect(expects("site-npc")).toEqual(expect.arrayContaining(['mode eq "on-chain"', 'accountId eq "sandwich.wgpnear.near"', "log.length gte 1"]));
    // A lower bound, never zero: the tally must find at least the one call the README cites.
    const npcCalls = checks["chain-tally"]!.expect.find((e) => e.path === "json.chain.npcCalls");
    expect(npcCalls?.op).toBe("gte");
    // The bound is the README's own count of his calls, read from its table.
    const quoted = new RegExp(npcCalls!.doc!).exec(read("README.md"))?.[1];
    expect(Number(quoted)).toBeGreaterThanOrEqual(1);
    // No claim is left saying he is built and off.
    const off = evidence().claims.filter((c) => c.status === "built, off on mainnet").map((c) => c.id);
    expect(off.filter((id) => id.includes("npc"))).toEqual([]);
  });

  it("nothing in the repository sets his account or key: .env.example names both commented out, the key empty", () => {
    const lines = read("apps/wgp/.env.example").split("\n");
    const account = lines.filter((l) => l.includes("NPC_TRADER_ACCOUNT_ID="));
    const key = lines.filter((l) => l.includes("NPC_TRADER_PRIVATE_KEY="));
    expect(account).toEqual(["# NPC_TRADER_ACCOUNT_ID=sandwich.wgpnear.near"]);
    expect(key).toEqual(["# NPC_TRADER_PRIVATE_KEY="]);
  });

  it("the stats script names his account as the NPC's (stats-tally.test.ts runs the count itself)", () => {
    expect(read("scripts/stats.mjs")).toContain('const NPC_ACCOUNTS = ["sandwich.wgpnear.near"];');
  });
});
