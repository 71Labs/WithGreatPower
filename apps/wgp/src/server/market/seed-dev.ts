/**
 * Gives a local PGlite database a day of Mempool Market history, so /play/market, The
 * Daily Rug and their charts have something to show before anyone has traded:
 *
 *   PGLITE_DIR=.data/pglite pnpm --filter wgp exec tsx src/server/market/seed-dev.ts
 *
 * Stop `next dev` first (PGlite is single-process). It makes a few traders with Bits and
 * loot, plays a day of simulated trades through the market's own rules (back-dated
 * across the last 24 hours, with hourly snapshots) and leaves two listings open.
 * `SEED_ME=<handle>` also funds that dev sign-in player (600 Bits and the same loot), and
 * `SEED_ME_LEVEL=<n>` starts their hero at that level, so recipes that need a level can be
 * crafted. `SEED_QUIET=1` seeds a slow day instead (a handful of trades, most items with one
 * or none), which is what a young market's cards and sparklines really look like. Never runs
 * against DATABASE_URL.
 */
import { newSave, reduce } from "@wgp/game-core/engine";
import type { ItemId, Save } from "@wgp/game-core/types";

import { MarketError } from "@/lib/market/engine";
import { rng } from "@/lib/market/bots";

import { openPglite, type Db } from "../db/client";
import { enqueueRewardMint } from "../db/outbox";
import { ensureSave, findOrCreatePlayer, writeSave } from "../db/players";
import { recordSnapshots } from "./history";
import { readSim, simAct, type SimAction } from "./sim";

const HOUR = 3_600_000;
const TRADERS = ["miles", "gwen", "ned", "felicia", "harry", "betty"];
const LOOT: Partial<Record<ItemId, number>> = { crumbs: 14, "fee-bomb": 12, "chain-link": 10, "sybil-goo": 6, "sesame-seed": 3, "press-pass": 2, "goblin-glider": 1 };

async function trader(db: Db, nearAccountId: string, handle: string, authKind: "near_auth" | "dev", bits: number, level?: number) {
  const p = await findOrCreatePlayer(db, { nearAccountId, authKind, authSub: `${authKind}:${handle}`, handle });
  const { save, rev } = await ensureSave(db, p.id);
  const hero: Save = save.hero ? save : reduce(newSave(), { type: "create-hero", name: handle[0]!.toUpperCase() + handle.slice(1), suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
  const levelled: Save = level && hero.hero && level > hero.hero.level ? { ...hero, hero: { ...hero.hero, level } } : hero;
  await writeSave(db, p.id, { ...levelled, inventory: { ...levelled.inventory, ...LOOT } }, rev);
  await db.transaction((tx) =>
    enqueueRewardMint(tx, {
      kind: "mint_reward",
      dedupeKey: `mint_reward:seed-market:${handle}`,
      playerId: p.id,
      payload: { accountId: nearAccountId, items: [{ tokenId: "item:bits", amount: bits }], digest: "0".repeat(64) },
    }),
  );
  return { playerId: p.id, accountId: nearAccountId };
}

async function main() {
  if (process.env.DATABASE_URL) throw new Error("This seed only writes PGlite; unset DATABASE_URL");
  const dir = process.env.PGLITE_DIR;
  if (!dir) throw new Error("Set PGLITE_DIR");
  const db = await openPglite(dir);
  const rand = rng(Number(process.env.SEED ?? 11));
  const now = Date.now();
  const traders = [];
  for (const h of TRADERS) traders.push(await trader(db, `${h}.wgp.testnet`, h, "near_auth", 900));
  if (process.env.SEED_ME) traders.push(await trader(db, `${process.env.SEED_ME}.dev.wgp.testnet`, process.env.SEED_ME, "dev", 600, Number(process.env.SEED_ME_LEVEL) || undefined));

  // A day of trading, one hour at a time. Each item leans one way (the chance a trade is
  // a buy): crafters want gliders and goo, everyone dumps crumbs.
  const lean: [ItemId, number][] = [
    ["goblin-glider", 0.7],
    ["crumbs", 0.3],
    ["fee-bomb", 0.4],
    ["sybil-goo", 0.62],
    ["chain-link", 0.55],
    ["sesame-seed", 0.5],
    ["press-pass", 0.45],
  ];
  /** The chance an item trades in a given hour. */
  const busy = process.env.SEED_QUIET ? 0.05 : 0.55;
  let trades = 0;
  for (let h = 23; h >= 1; h--) {
    const at = new Date(now - h * HOUR);
    await recordSnapshots(db, false, (await readSim(db)).book.pools, at);
    for (const [item, buyOdds] of lean) {
      if (rand() > busy) continue;
      const t = traders[Math.floor(rand() * TRADERS.length)]!;
      const act: SimAction = rand() < buyOdds ? { action: "buy", item, amount: 1, maxBits: 10_000 } : { action: "sell", item, amount: 1, minBits: 0 };
      try {
        await simAct(db, { ...t, act, now: new Date(at.getTime() + 60_000) });
        trades += 1;
      } catch (error) {
        if (!(error instanceof MarketError)) throw error;
      }
    }
  }
  for (const [i, item] of (["crumbs", "chain-link"] as ItemId[]).entries()) {
    const t = traders[i]!;
    const pool = (await readSim(db)).book.pools.find((p) => p.item === item)!;
    const unit = Math.ceil(((pool.virtualBits + pool.bits) / (pool.virtualItems + pool.stock)) * (i ? 0.9 : 1.15));
    await simAct(db, { ...t, act: { action: "list", item, amount: 2, price: unit * 2 }, now: new Date(now - HOUR / 2) });
  }
  console.log(`seeded ${traders.length} traders and ${trades} trades`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
