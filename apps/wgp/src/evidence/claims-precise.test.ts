/**
 * Claims a cold reader found false, stale or overstated on Nov 13, each now held to the code
 * or the repository that decides it: how long a night is, what a stolen game key can and
 * can't do, where Bits come from, that nothing is scheduled, and the disclosures' facts.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { CAST } from "@wgp/game-core/cast";
import { CASE_002_RULESET, CHAPTER_RULESET } from "@wgp/game-core/chapters";
import { STOPS_PER_PATROL } from "@wgp/game-core/data";
import { GOLDEN_CASES, replayGolden } from "@wgp/game-core/golden";
import { SIM_HZ } from "@wgp/game-core/sim3d/constants";
import type { Save } from "@wgp/game-core/types";
import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, defaultPoolConfigs } from "@/lib/market/config";
import { NPC_RULES } from "@/lib/market/npc-rules";
import { INVEST_METHODS, MARKET_METHODS, RELAY_METHODS, SESSION_KEY_ALLOWANCE, SESSION_KEY_METHODS } from "@/lib/near/policy";
import { VERIFY_RULES } from "@/server/verify";

import { ROOT, exists, plainDoc, read } from "./repo";

const README = plainDoc("README.md");
const LOOP = plainDoc("docs/GAME-LOOP.md");
const fmt = (n: number) => n.toLocaleString("en-US");

/** Every `pub fn` in a contract file with whether it is #[payable], and its body up to the next fn. */
function contractMethods(file: string) {
  const src = read(`contracts/wgp/src/${file}`);
  const out: { name: string; payable: boolean; body: string }[] = [];
  const re = /((?:\s*#\[[^\]]*\]\s*)*)\s*pub fn (\w+)\(/g;
  const hits = [...src.matchAll(re)];
  hits.forEach((m, i) => out.push({ name: m[2]!, payable: /#\[payable\]/.test(m[1]!), body: src.slice(m.index!, hits[i + 1]?.index ?? src.length) }));
  return out;
}

describe("how long a night is", () => {
  it("a night that clears all four stops replays in one to two minutes, and the documents say so", () => {
    const nights = GOLDEN_CASES.map((c) => {
      const r = replayGolden(c);
      expect(r.ok, c.name).toBe(true);
      const patrol = (r.save as Save).patrol;
      const cleared = (patrol?.results.length ?? 0) === STOPS_PER_PATROL && !patrol?.knockedOut;
      return { name: c.name, seconds: Math.round(r.ticks / SIM_HZ), cleared };
    });
    const cleared = nights.filter((n) => n.cleared).map((n) => n.seconds).sort((a, b) => a - b);
    expect(cleared.length).toBeGreaterThanOrEqual(3);
    for (const s of cleared) {
      expect(s).toBeGreaterThanOrEqual(60);
      expect(s).toBeLessThanOrEqual(120);
    }
    const list = `${cleared.slice(0, -1).join(", ")} and ${cleared.at(-1)} seconds of game time`;
    expect(README).toContain(`the three recorded nights in this repository that clear all four stops replay in ${list}`);
    expect(LOOP).toContain(`that clear all four stops replay in ${list}`);
    expect(README).toContain("| 1 to 2 minutes | Finishes a night of four stops; the server replays and ranks it |");
    expect(LOOP).toContain("## Every minute or two: finish a night and bank it");
    expect(LOOP).toContain("and takes one to two minutes.");
    // The verifier's floor is well under a night, so a real night is never refused as too short.
    expect(VERIFY_RULES.minGameSeconds).toBeLessThan(cleared[0]!);
    // The old figures are gone from every document.
    for (const doc of ["README.md", "docs/GAME-LOOP.md", "docs/ARCHITECTURE.md"]) expect(plainDoc(doc), doc).not.toMatch(/\| 5 minutes \||Every 5 minutes|usually takes 2 to 5 minutes|per 6-minute night|wall time \+ 60 s/);
    expect(plainDoc("docs/ARCHITECTURE.md")).toContain(`game time ≤ wall time + ${VERIFY_RULES.wallSlackSeconds} s`);
  });

  it("pnpm stats' duration is given as the range it really takes", () => {
    const raw = read("README.md");
    expect(raw.match(/30 seconds to two minutes, depending on NearBlocks rate limits/g)).toHaveLength(3);
    expect(raw).not.toMatch(/about two minutes/);
  });
});

describe("what a stolen game key can and can't do", () => {
  const all = ["lib.rs", "market.rs", "mt.rs"].flatMap(contractMethods);
  const byName = new Map(all.map((m) => [m.name, m]));

  it("can call exactly the game's deposit-free methods; transfers, owner and operator methods need a deposit or a role", () => {
    // The key the factory adds: this contract only, any method, a small gas allowance.
    expect(SESSION_KEY_METHODS).toEqual([]);
    expect(SESSION_KEY_ALLOWANCE).toBe(50_000_000_000_000_000_000_000n);
    expect(read("apps/wgp/src/server/near/factory.ts")).toContain("actions.addFunctionCallAccessKey(");

    // What it can do: every relayable v2 method exists in the contract and takes no deposit.
    const v2 = RELAY_METHODS.filter((m) => !(INVEST_METHODS as readonly string[]).includes(m));
    expect([...v2].sort()).toEqual(["buy_listing", "cancel_listing", "craft_suit", "equip_suit", "list_item", "market_buy", "market_sell", "register_hero"]);
    for (const m of v2) {
      expect(byName.get(m), m).toBeDefined();
      expect(byName.get(m)!.payable, `${m} must not need a deposit`).toBe(false);
      expect(byName.get(m)!.body, m).not.toMatch(/assert_one_yocto|assert_owner|assert_operator/);
    }
    expect(MARKET_METHODS).toEqual(["market_buy", "market_sell", "list_item", "buy_listing", "cancel_listing"]);

    // What it can't: every transfer needs exactly one yocto, which a function-call key can't attach.
    for (const m of ["mt_transfer", "mt_batch_transfer", "mt_transfer_call", "mt_batch_transfer_call"]) {
      expect(byName.get(m)!.payable, m).toBe(true);
      expect(byName.get(m)!.body, m).toContain("near_sdk::assert_one_yocto();");
      expect(RELAY_METHODS as readonly string[]).not.toContain(m);
    }
    // Owner methods assert the owner (which itself asserts one yocto); operator methods assert the operator.
    expect(read("contracts/wgp/src/lib.rs")).toMatch(/fn assert_owner\(&self\) \{\s*near_sdk::assert_one_yocto\(\);/);
    for (const m of ["set_market_params", "set_paused", "add_operator", "remove_operator", "set_owner", "set_rules", "upgrade"]) expect(byName.get(m)!.body, m).toContain("self.assert_owner();");
    for (const m of ["mint_rewards", "record_season"]) expect(byName.get(m)!.body, m).toContain("self.assert_operator();");
    // Every state-changing method is one of: relayable and deposit-free, a transfer, owner-only, operator-only, or the contract's own callback.
    const views = /^(get_|mt_balance|mt_batch_balance|mt_supply|mt_batch_supply|mt_token|market_state|market_quote|market_listing|market_account|bits_of|reward_nonce|is_operator)/;
    const helpers = ["new", "balance", "kinds", "reserves", "spot_milli", "buy_cost", "sell_payout", "fee_of", "listing_bounds", "apply_buy", "apply_sell", "hero_token", "suit_token", "item_token", "trophy_token", "badge_token"];
    const other = all.map((m) => m.name).filter((n) => !views.test(n) && !helpers.includes(n) && !(v2 as readonly string[]).includes(n) && !byName.get(n)!.payable && !/assert_operator/.test(byName.get(n)!.body));
    expect(other.sort()).toEqual(["migrate", "mt_resolve_transfer"]);
  });

  it("the documents state those bounds with the contract's own caps, and no longer say it can never move assets", () => {
    const p = DEFAULT_PARAMS;
    const caps = `listing prices within ${p.floorBps / 100}–${p.ceilingBps / 100}% of the vendor's, at most ${p.maxAmount} items a call, ${p.maxOpenListings} open listings, and per day ${p.dailyTrades} vendor trades, ${p.dailyListings} listings and ${p.dailyFills} fills worth ${fmt(p.dailyFillBits)} Bits`;
    expect(README).toContain(caps);
    expect(README).toContain("so a game key can't transfer a token out of a player's account. It can still trade with it, within the market's caps");
    expect(README).toContain("A thief therefore can't send a player's tokens to themselves, but could trade them badly");
    expect(README).toContain("up to a 0.05 NEAR allowance");
    const sustain = plainDoc("docs/SUSTAINABILITY.md");
    expect(sustain).toContain(`the contract's caps (${p.maxAmount} items a call, ${p.maxOpenListings} open listings, and per day ${p.dailyTrades} vendor trades, ${p.dailyListings} listings and ${p.dailyFills} fills worth ${fmt(p.dailyFillBits)} Bits)`);
    expect(sustain).toContain("A stolen one could still trade as the player");
    expect(LOOP).toContain("so it can't transfer a token out of the account; the relayer pays the gas.");
    expect(plainDoc("docs/ARCHITECTURE.md")).toContain("so a session key can never transfer a token. It can trade as the player");
    for (const doc of ["README.md", "docs/GAME-LOOP.md", "docs/SUSTAINABILITY.md", "docs/ARCHITECTURE.md"]) expect(plainDoc(doc), doc).not.toMatch(/can never move a player's assets|so it can't move assets|can never move assets|No trust needed/);
  });
});

describe("where Bits come from", () => {
  it("names all three sources: verified nights, the market's opening and the NPC's one-off seed", () => {
    const tills = defaultPoolConfigs().reduce((n, c) => n + c.seedBits, 0);
    expect(LOOP).toContain("Bits have entered the contract three ways, and only one of them repeats.");
    expect(LOOP).toContain(`Opening the market minted Gwei's eight tills once, ${fmt(tills)} Bits in all (set_market_params, transaction FdQxVNyz…).`);
    expect(defaultPoolConfigs()).toHaveLength(8);
    expect(LOOP).toContain(`the operator minted Sandwich Man's one-off ${NPC_RULES.seedBits}-Bit seed`);
    expect(LOOP).not.toMatch(/Bits enter only through verified nights/);
    // The only places the contract creates Bits: a reward mint and seeding a pool.
    const lib = read("contracts/wgp/src/lib.rs");
    const market = read("contracts/wgp/src/market.rs");
    // Supply grows in one helper, add_supply. Its callers are the only mints the contract has.
    const minting = (file: string) => contractMethods(file).filter((m) => m.name !== "add_supply" && /self\.add_supply\(/.test(m.body.split("\n    // ---------- ")[0]!)).map((m) => m.name).sort();
    expect(minting("lib.rs")).toEqual(["craft_suit", "mint_rewards", "record_season", "register_hero"]);
    expect(minting("market.rs")).toEqual(["set_market_params"]);
    expect(lib.match(/self\.add_supply\(/g)).toHaveLength(5);
    expect(market.match(/self\.add_supply\(/g)).toHaveLength(1);
    // Of those, a hero, a suit and a trophy are fixed token ids. Only a reward's items (mint_rewards) and a pool's seed (set_market_params) can be item:bits.
    expect(lib).toContain("self.add_supply(&suit_token, 1);");
    expect(market).toContain("(BITS_TOKEN.to_string(), c.seed_bits.0),");
    expect(lib).toMatch(/let token = trophy_token\(&season_id, i \+ 1\);/);
  });
});

describe("nothing is scheduled", () => {
  const walk = (rel: string, out: string[] = []): string[] => {
    for (const name of readdirSync(path.join(ROOT, rel))) {
      if (["node_modules", ".next", "target", ".git", ".data", ".turbo"].includes(name)) continue;
      const child = `${rel}/${name}`;
      if (statSync(path.join(ROOT, child)).isDirectory()) walk(child, out);
      else if (/\.(ts|tsx|mjs|js|sh|yml|yaml|json|toml)$/.test(name)) out.push(child);
    }
    return out;
  };

  it("the three /api/cron routes are bearer-protected manual fallbacks, and only the sandbox script calls one", () => {
    const routes = readdirSync(path.join(ROOT, "apps/wgp/src/app/api/cron")).sort();
    expect(routes).toEqual(["market-snapshot", "mint", "sweep"]);
    for (const r of routes) {
      const src = read(`apps/wgp/src/app/api/cron/${r}/route.ts`);
      expect(src, r).toContain("assertCron(request);");
      expect(src, r).toMatch(/Nothing schedules it|nothing schedules it/);
    }
    // Who requests one: any file outside the routes and their tests that builds a /api/cron URL to fetch.
    const callers = [...walk("apps/wgp/src"), ...walk("scripts"), ...walk("launch/lib"), ...walk(".github"), "apps/wgp/vercel.json", "package.json", "apps/wgp/package.json"]
      .filter((f) => !f.includes("/api/cron/") && !/\.test\.ts$/.test(f))
      .filter((f) => /fetch\([^)]*\/api\/cron\/|curl[^\n]*\/api\/cron\/|"path":\s*"\/api\/cron/.test(read(f)));
    expect(callers).toEqual(["scripts/near/e2e-sandbox.ts"]);
    // No schedule anywhere a platform would read one.
    expect(JSON.parse(read("apps/wgp/vercel.json")).crons).toBeUndefined();
    expect(exists("vercel.json")).toBe(false);
    for (const f of walk(".github")) expect(read(f), f).not.toMatch(/^\s*schedule:|cron:/m);
    // Background work goes through after(), one claimed window at a time.
    expect(read("apps/wgp/src/server/background.ts")).toMatch(/import \{[^}]*\bafter\b[^}]*\} from "next\/server"/);
    expect(README).toContain("nothing is scheduled: vercel.json has no crons entry and no workflow runs on a schedule. Three bearer-protected routes, /api/cron/mint, /api/cron/sweep and /api/cron/market-snapshot, are manual fallbacks for the owner; in this repository only the local sandbox end-to-end script calls one.");
    expect(README).not.toMatch(/there are no cron jobs/);
  });
});

describe("the disclosures, the chapters and the story", () => {
  it("the libraries the README credits are the versions the lockfiles pin", () => {
    const pkg = JSON.parse(read("apps/wgp/package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const v = (name: string) => (pkg.dependencies[name] ?? pkg.devDependencies[name] ?? "").replace(/^[\^~]/, "");
    const major = (name: string) => v(name).split(".")[0];
    expect(README).toContain(`Next.js ${major("next")} (with the React Compiler), React ${major("react")}, three.js ${v("three").split(".").slice(0, 2).join(".")}, React Three Fiber ${major("@react-three/fiber")} and drei ${major("@react-three/drei")}`);
    expect(README).toContain(`zod ${major("zod")}, Tailwind CSS ${major("tailwindcss")}`);
    expect(README).toContain(`near-api-js ${major("near-api-js")}`);
    for (const name of ["drizzle-orm", "drizzle-kit", "@neondatabase/serverless", "@electric-sql/pglite", "@hot-labs/near-connect", "@privy-io/react-auth", "@privy-io/node", "vitest", "tsx"]) expect(v(name), name).not.toBe("");
    const sdk = /near-sdk = "([\d.]+)"/.exec(read("contracts/wgp/Cargo.toml"))![1];
    const ws = /near-workspaces = "([\d.]+)"/.exec(read("contracts/wgp/sandbox/Cargo.toml"))![1];
    expect(README).toContain(`near-sdk-rs ${sdk}, cargo-near 0.22 and near-workspaces ${ws}`);
  });

  it("every file the disclosures and credits name is in the repository", () => {
    for (const f of [
      "apps/wgp/src/game3d/scene/quality.ts",
      "apps/wgp/src/game3d/scene/context-recovery.ts",
      "apps/wgp/src/game3d/scene/camera/springs.ts",
      "apps/wgp/src/server/http.ts",
      "apps/wgp/src/app/globals.css",
      "apps/wgp/src/lib/near/wallet.tsx",
      "apps/wgp/public/audio/CREDITS.md",
      "apps/wgp/public/models/LICENSES.md",
      "scripts/deploy-prod.sh",
      "apps/wgp/vercel.json",
      "LICENSE",
    ]) {
      expect(read("README.md"), f).toContain(f);
      expect(exists(f), f).toBe(true);
    }
    expect(read("LICENSE")).toMatch(/^MIT License/);
    // Pushes to main don't deploy by themselves, as the credits say.
    expect(JSON.parse(read("apps/wgp/vercel.json")).git.deploymentEnabled.main).toBe(false);
    // Suits change looks only: the problem statement's claim, held by the rules' data in readme-numbers.test.ts.
    expect(README).toContain("It's a full 3D action game you can finish a night of as a guest, with no account.");
  });

  it("each chapter document states the ruleset tag the code uses, and the story bible has a section for every cast member", () => {
    expect(plainDoc("docs/chapters/case-001.md")).toContain(`"${CHAPTER_RULESET}"`);
    expect(plainDoc("docs/chapters/case-002.md")).toContain(`CASE_002_RULESET = "${CASE_002_RULESET}"`);
    const fee = /export const FEE_STRIKE_RULESET = "([^"]+)"/.exec(read("packages/game-core/src/rules/case-003.ts"))![1];
    expect(plainDoc("docs/chapters/case-003.md")).toContain(`FEE_STRIKE_RULESET = "${fee}"`);
    expect(new Set([CHAPTER_RULESET, CASE_002_RULESET, fee]).size).toBe(3);
    const bible = read("docs/story/bible.md");
    for (const c of CAST) expect(bible, c.name).toMatch(new RegExp(`^### (The )?${c.name.replace(/^The /, "").replace(/[.]/g, "\\.")}`, "m"));
  });

  it("ARCHITECTURE.md's route table names routes that exist, and its limits are the code's", () => {
    const arch = plainDoc("docs/ARCHITECTURE.md");
    for (const [route, file] of [
      ["POST /api/runs/start", "runs/start/route.ts"],
      ["POST /api/runs/:id/submit", "runs/[id]/submit/route.ts"],
      ["GET /api/leaderboard", "leaderboard/route.ts"],
      ["GET /api/runs/:id/replay", "runs/[id]/replay/route.ts"],
      ["POST /api/actions", "actions/route.ts"],
      ["/api/me", "me/route.ts"],
      ["/api/migrate", "migrate/route.ts"],
      ["/api/cron/sweep", "cron/sweep/route.ts"],
      ["GET /api/market", "market/route.ts"],
      ["/api/market/listings", "market/listings/route.ts"],
      ["/api/market/me", "market/me/route.ts"],
      ["POST /api/market/trade", "market/trade/route.ts"],
      ["GET /api/cron/mint", "cron/mint/route.ts"],
      ["GET /api/chain/status", "chain/status/route.ts"],
      ["GET /api/seasons", "seasons/route.ts"],
      ["GET /api/seasons/:id/results", "seasons/[id]/results/route.ts"],
      ["POST /api/relay/meta", "relay/meta/route.ts"],
      ["/api/relay/fast-auth", "relay/fast-auth/route.ts"],
    ] as const) {
      expect(arch, route).toContain(route);
      expect(exists(`apps/wgp/src/app/api/${file}`), `${route}: ${file}`).toBe(true);
    }
    expect(arch).toContain(`capped at ${VERIFY_RULES.maxLogBytes / 1024} KB`);
    expect(arch).toContain(`at least ${VERIFY_RULES.minGameSeconds} s of game time`);
    const p = DEFAULT_PARAMS;
    expect(arch).toContain(`daily caps per account (${p.dailyTrades} vendor trades, ${p.dailyListings} listings, ${p.dailyFills} fills, ${fmt(p.dailyFillBits)} Bits of fills), ${p.maxOpenListings} open listings each, ${p.maxListings} overall, ${p.maxAmount} items a call`);
  });
});
