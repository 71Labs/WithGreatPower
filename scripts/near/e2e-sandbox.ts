/**
 * The Mempool Market's whole loop against the real contract on a local sandbox, through a
 * running app server (HTTP only, as a browser would) plus RPC views to check the chain:
 *
 *   verified night → reward mint (Bits) lands → buy → sell → slippage refusal → list →
 *   a second player buys the listing → cancel → craft → equip, plus the guards: a stolen
 *   session key can't move tokens, a delegate can't be replayed, double-submits don't
 *   double-spend, the listing cap holds, and a round trip never profits.
 *
 * After every step the chain (mt_balance_of, market_state, get_player) and the app's view
 * (/api/market, /api/market/me, /api/market/listings, /api/me, /api/chain/status) must agree.
 *
 * Two players: Alice brings her own wallet (alice-<t>.test.near; NEP-413 sign-in, then "Enable
 * quick play" adds a game-only key with her full-access key, as a wallet would), and Bob gets
 * bob-<t>.wgp.test.near from the account factory with a session key (what a Google player gets).
 *
 *   1. scripts/near/sandbox-up.ts  (accounts, contract, market; writes the env file)
 *   2. a local server on that env:   next dev -p 3700 (apps/wgp, env from the file)
 *   3. cd apps/wgp && pnpm exec tsx --env-file=$ENV ../../scripts/near/e2e-sandbox.ts
 *
 * E2E_BASE_URL defaults to http://127.0.0.1:3700. Refuses any RPC that isn't localhost.
 */
import { chooseErrand, needsErrand, runHash, runLog, startRun as startClientRun, stepRun } from "../../packages/game-core/src/replay";
import { botFrame, newBotMemory } from "../../packages/game-core/src/sim3d";
import type { Save } from "../../packages/game-core/src/rules/types";
import type { ListingView, MarketMe, MarketSnapshot, MarketView, SimTradeRequest } from "../../apps/wgp/src/lib/market/api";
import { chainCall } from "../../apps/wgp/src/lib/market/chain-calls";
import { buyQuote, lessSlippage, listingBounds, sellQuote, withSlippage } from "../../apps/wgp/src/lib/market/math";
import { DELEGATE_TTL_BLOCKS, SESSION_KEY_ALLOWANCE, TGAS } from "../../apps/wgp/src/lib/near/policy";
import { accessKeyNonce, finalBlockHeight, viewFunction } from "../../apps/wgp/src/lib/near/rpc";
import { chainEnv } from "../../apps/wgp/src/server/near/env";
import { createPlayerAccount } from "../../apps/wgp/src/server/near/factory";
import { provider } from "../../apps/wgp/src/server/near/rpc";
import { Account, actions, buildDelegateAction, encodeSignedDelegate, KeyPair, KeyPairSigner, type Action } from "../../apps/wgp/src/server/near/sdk";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3700";
/** The UI's slippage limit (components/market/sheets.tsx). */
const SLIPPAGE_BPS = 300;

type Outcome = "pass" | "fail";
const results: { step: string; outcome: Outcome; detail?: string }[] = [];
const numbers: Record<string, unknown> = {};

async function check(step: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = (await fn()) ?? undefined;
    results.push({ step, outcome: "pass", detail });
    console.log(`PASS  ${step}${detail ? `  (${detail})` : ""}`);
    return true;
  } catch (error) {
    const detail = (error as Error).message.slice(0, 600);
    results.push({ step, outcome: "fail", detail });
    console.log(`FAIL  ${step}  (${detail})`);
    return false;
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, { tries = 40, every = 1500, nudge }: { tries?: number; every?: number; nudge?: () => Promise<unknown> } = {}): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    if (nudge) await nudge();
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* ------------------------------------------------------------------ a player over HTTP */

interface HttpReply<T> {
  status: number;
  body: T & { error?: string; message?: string };
}

class Player {
  cookie = "";
  readonly device = `e2e${Math.random().toString(36).slice(2, 12)}`;
  readonly session = KeyPair.fromRandom("ed25519");
  constructor(
    readonly name: string,
    readonly accountId: string,
    readonly fullKey: KeyPair,
  ) {}

  async http<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<HttpReply<T>> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        "x-wgp-device": this.device,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(";")[0]!;
      if (pair.endsWith("=")) continue;
      this.cookie = pair;
    }
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: "not_json", message: text.slice(0, 200) };
    }
    return { status: res.status, body: parsed as HttpReply<T>["body"] };
  }

  /** NEP-413 sign-in, as near-connect does for a wallet. */
  async signIn(): Promise<void> {
    const nonce = await this.http<{ nonce: string; message: string; recipient: string; token: string }>("POST", "/api/auth/wallet", { action: "nonce", accountId: this.accountId });
    assert(nonce.status === 200, `nonce ${nonce.status} ${JSON.stringify(nonce.body)}`);
    const signer = new KeyPairSigner(this.fullKey);
    const signed = await signer.signNep413Message(this.accountId, { message: nonce.body.message, recipient: nonce.body.recipient, nonce: new Uint8Array(Buffer.from(nonce.body.nonce, "base64")) });
    const verify = await this.http("POST", "/api/auth/wallet", {
      action: "verify",
      accountId: this.accountId,
      publicKey: signed.publicKey.toString(),
      signature: Buffer.from(signed.signature).toString("base64"),
      token: nonce.body.token,
    });
    assert(verify.status === 200 && this.cookie, `verify ${verify.status} ${JSON.stringify(verify.body)}`);
  }

  me() {
    return this.http<{ signedIn: boolean; player: { id: string }; save: Save; rev: number }>("GET", "/api/me");
  }

  wallet() {
    return this.http<MarketMe>("GET", "/api/market/me");
  }

  /** A NEP-366 delegate signed with this device's session key, base64 for /api/relay/meta. */
  async delegate(acts: Action[]): Promise<string> {
    const rpc = provider();
    const pk = this.session.getPublicKey();
    const nonce = ((await accessKeyNonce(rpc, this.accountId, pk.toString())) ?? 0n) + 1n;
    const height = await finalBlockHeight(rpc);
    const d = buildDelegateAction({ senderId: this.accountId, receiverId: chainEnv().contractId, actions: acts, nonce, maxBlockHeight: height + DELEGATE_TTL_BLOCKS, publicKey: pk });
    const { signedDelegate } = await new KeyPairSigner(this.session).signDelegateAction(d);
    return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
  }

  relayRaw(signedDelegate: string) {
    return this.http<{ ok?: boolean; txHash?: string; result?: unknown; save?: Save; rev?: number; market?: MarketSnapshot }>("POST", "/api/relay/meta", { kind: "game", signedDelegate });
  }

  /** One game call through the relayer, exactly as the browser's callGame sends it. */
  async relay(method: string, args: Record<string, unknown>, deposit = 0n) {
    return this.relayRaw(await this.delegate([actions.functionCall(method, args, 30n * TGAS, deposit)]));
  }

  async trade(req: SimTradeRequest) {
    const { method, args } = chainCall(req);
    return this.relay(method, args);
  }

  /** A bot plays tonight's patrol; the server replays and verifies it. Returns the Bits it earned. */
  async night(): Promise<{ score: number; bits: number; runId: string }> {
    const before = await this.me();
    if (before.body.save.nightDone) {
      const slept = await this.http("POST", "/api/actions", { action: { type: "sleep" }, rev: before.body.rev });
      assert(slept.status === 200, `sleep ${slept.status} ${JSON.stringify(slept.body)}`);
    }
    const started = await this.http<{ runId: string; seed: number }>("POST", "/api/runs/start", {});
    assert(started.status === 201, `start ${started.status} ${JSON.stringify(started.body)}`);
    const startedAt = Date.now();
    const { save } = (await this.me()).body;
    const run = startClientRun(save, started.body.seed);
    assert(!run.error, `client run: ${run.error}`);
    const mem = newBotMemory();
    while (!run.over && !run.error && run.sim.tick < 54_000) {
      if (needsErrand(run)) chooseErrand(run, 0);
      else stepRun(run, botFrame(run.sim, mem));
    }
    // The server refuses a night that ran faster than real time (60 s of slack): wait it out.
    const wait = (run.sim.tick / 60 - 50) * 1000 - (Date.now() - startedAt);
    if (wait > 0) await sleep(wait);
    const submitted = await this.http<{ status: string; score: number; bits: number; reason?: string }>("POST", `/api/runs/${started.body.runId}/submit`, {
      log: Buffer.from(runLog(run)).toString("base64"),
      clientHash: runHash(run),
    });
    assert(submitted.body.status === "verified", `run ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 300)}`);
    return { score: submitted.body.score, bits: submitted.body.bits, runId: started.body.runId };
  }
}

/* ------------------------------------------------------------------ chain views */

const contract = () => chainEnv().contractId;
const view = <T>(method: string, args: Record<string, unknown> = {}) => viewFunction<T>(provider(), contract(), method, args);
const bitsOf = (accountId: string) => view<string>("bits_of", { account_id: accountId }).then(Number);
const balanceOf = (accountId: string, token: string) => view<string>("mt_balance_of", { account_id: accountId, token_id: token }).then(Number);
const marketState = () => view<{ pools: { item: string; bits: string; stock: string; escrow: string }[]; prices_milli: string[]; listings: number }>("market_state");
const pool = async (item: string) => {
  const s = await marketState();
  const i = s.pools.findIndex((p) => p.item === item);
  const p = s.pools[i]!;
  return { bits: Number(p.bits), stock: Number(p.stock), escrow: Number(p.escrow), priceMilli: Number(s.prices_milli[i]) };
};
const playerView = (accountId: string) => view<{ hero: { name: string; suit: string } | null; level: number; reward_nonce: number; tokens: [string, string][] } | null>("get_player", { account_id: accountId });

/** The app's market view must match the contract's pools. */
function poolMatches(view: MarketView, item: string, chain: { stock: number; bits: number; priceMilli: number }): string | null {
  const row = view.items.find((i) => i.item === item);
  if (!row) return `no ${item}`;
  if (row.pool.stock === chain.stock && row.pool.bits === chain.bits && row.priceMilli === chain.priceMilli) return null;
  return `${item} stock ${row.pool.stock}/${chain.stock} till ${row.pool.bits}/${chain.bits} price ${row.priceMilli}/${chain.priceMilli}`;
}

/** Reads of the shared, cached /api/market that still showed the market from before a trade. */
let staleReads = 0;

/**
 * GET /api/market must match the contract's pools. It is shared and cached for about 10 s,
 * so a read right after a trade may lag; it must catch up within a couple of seconds (the
 * trader's own screen doesn't wait for it: the trade's answer carries the market, below).
 */
async function marketAgrees(p: Player, item: string): Promise<MarketView> {
  let last = "";
  for (let i = 0; i < 8; i++) {
    const [m, chain] = await Promise.all([p.http<MarketView>("GET", "/api/market"), pool(item)]);
    assert(m.status === 200 && m.body.onChain, `market ${m.status} onChain=${m.body.onChain}`);
    const problem = poolMatches(m.body, item, chain);
    if (!problem) return m.body;
    last = problem;
    staleReads += 1;
    await sleep(250);
  }
  throw new Error(`/api/market never caught up: ${last}`);
}

/** The market a trade's answer carried (what the trader's screen shows next) must be the chain's, now. */
async function snapshotAgrees(p: Player, reply: { body: { market?: MarketSnapshot } }, item: string): Promise<MarketSnapshot> {
  const snap = reply.body.market;
  assert(snap, "the trade's answer carried no market");
  const [chain, bits, held] = await Promise.all([pool(item), bitsOf(p.accountId), balanceOf(p.accountId, `item:${item}`)]);
  const problem = poolMatches(snap.view, item, chain);
  assert(!problem, `the trade's answer: ${problem}`);
  assert(snap.me.bits === bits, `the trade's answer: Bits ${snap.me.bits}, chain ${bits}`);
  const shown = snap.me.items[item as keyof MarketMe["items"]] ?? 0;
  assert(shown === held, `the trade's answer: ${item} ${shown}, chain ${held}`);
  return snap;
}

/** The app's wallet and save must match the chain for `items`. */
async function walletAgrees(p: Player, items: string[]): Promise<MarketMe> {
  const [w, me, bits] = await Promise.all([p.wallet(), p.me(), bitsOf(p.accountId)]);
  assert(w.status === 200, `market/me ${w.status} ${JSON.stringify(w.body)}`);
  assert(w.body.bits === bits, `market/me bits ${w.body.bits}, chain ${bits}`);
  for (const item of items) {
    const chain = await balanceOf(p.accountId, `item:${item}`);
    const wallet = w.body.items[item as keyof MarketMe["items"]] ?? 0;
    const save = me.body.save.inventory[item as keyof Save["inventory"]] ?? 0;
    assert(wallet === chain, `market/me ${item} ${wallet}, chain ${chain}`);
    assert(save === chain, `the save's ${item} is ${save}, chain ${chain}`);
  }
  return w.body;
}

/* ------------------------------------------------------------------ the run */

async function main() {
  const { rpcUrls, contractId } = chainEnv();
  if (!rpcUrls.every((u) => /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(u))) throw new Error(`Refusing to run against ${rpcUrls.join(", ")}: sandbox only`);
  // Alice's wallet: a fresh account each run, made with the sandbox's root key.
  const rootId = process.env.E2E_ROOT_ACCOUNT_ID!;
  const root = new Account(rootId, provider(), KeyPairSigner.fromSecretKey(process.env.E2E_ROOT_PRIVATE_KEY as `ed25519:${string}`));
  const aliceId = `alice-${Date.now().toString(36)}.${rootId}`;
  const aliceKey = KeyPair.fromRandom("ed25519");
  await root.signAndSendTransaction({
    receiverId: aliceId,
    actions: [actions.createAccount(), actions.transfer(10n ** 25n), actions.addFullAccessKey(aliceKey.getPublicKey())],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: true,
  });
  const alice = new Player("alice", aliceId, aliceKey);
  const bobHandle = `bob-${Date.now().toString(36)}`;
  const bobUser = KeyPair.fromRandom("ed25519");
  const bob = new Player("bob", `${bobHandle}.${process.env.FACTORY_ACCOUNT_ID}`, bobUser);

  await check("0 the app reads the contract's market (onChain: true) and it matches market_state", async () => {
    const m = await marketAgrees(alice, "crumbs");
    assert(m.contractId === contractId && m.items.length === 8, `contract ${m.contractId}, ${m.items.length} items`);
    return `${m.items.length} pools, till ${m.till} Bits, fee ${m.params.feeBps} bps`;
  });

  // ---------- Alice: a wallet player
  await check("1 Alice signs in with her wallet (NEP-413) and imports her local hero (level 3, 3 Sybil goo, 3 crumbs)", async () => {
    await alice.signIn();
    const local: Save = {
      version: 1,
      // A guest save as the browser keeps it; the server rebuilds and caps it (migrate-save.ts).
      hero: { name: "Alice", suit: "classic", level: 3, xp: 0 } as unknown as Save["hero"],
      night: 3,
      patrol: null,
      nightDone: false,
      inventory: { "sybil-goo": 3, crumbs: 3 },
      suits: ["classic"],
      album: {},
      editions: [],
      reputation: 0,
      stats: {} as Save["stats"],
    };
    const r = await alice.http<{ save: Save; items: unknown }>("POST", "/api/migrate", { save: local });
    assert(r.status === 200, `migrate ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return `imported level ${r.body.save.hero?.level}, items ${JSON.stringify(r.body.save.inventory)}`;
  });

  await check("2 Enable quick play: her wallet adds a game-only key (no deposit possible) and the server records it", async () => {
    const wallet = new Account(aliceId, provider(), new KeyPairSigner(alice.fullKey));
    await wallet.addFunctionCallAccessKey({ publicKey: alice.session.getPublicKey(), contractId, methodNames: [], allowance: SESSION_KEY_ALLOWANCE });
    const r = await alice.http("POST", "/api/auth/wallet", { action: "session-key", publicKey: alice.session.getPublicKey().toString() });
    assert(r.status === 200, `session-key ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check("3 the hero registers on chain through the relayer (register_hero, session key, no popup)", async () => {
    const status = await alice.http<{ hero: { status: string; args: { name: string; suit: string } | null } }>("GET", "/api/chain/status");
    assert(status.body.hero.status === "queued" && status.body.hero.args, `hero ${JSON.stringify(status.body.hero)}`);
    const r = await alice.relay("register_hero", status.body.hero.args);
    assert(r.status === 200, `register_hero ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const onChain = await playerView(aliceId);
    assert(onChain?.hero?.name === "Alice", `get_player ${JSON.stringify(onChain)}`);
    const after = await alice.http<{ hero: { status: string } }>("GET", "/api/chain/status");
    assert(after.body.hero.status === "registered", `mirror says ${after.body.hero.status}`);
  });

  await check("4 the import's reward mint lands (operator, in the background): level 3, 3 goo, 3 crumbs", async () => {
    const landed = await until(
      "the import mint",
      async () => {
        const p = await playerView(aliceId);
        return p && p.reward_nonce >= 1 ? p : null;
      },
      { nudge: () => alice.http("GET", "/api/chain/status") },
    );
    assert(landed.level >= 3, `level ${landed.level}`);
    const [goo, crumbs] = await Promise.all([balanceOf(aliceId, "item:sybil-goo"), balanceOf(aliceId, "item:crumbs")]);
    assert(goo === 3 && crumbs === 3, `goo ${goo}, crumbs ${crumbs}`);
    await walletAgrees(alice, ["sybil-goo", "crumbs"]);
    return `reward_nonce ${landed.reward_nonce}, tokens ${JSON.stringify(landed.tokens)}`;
  });

  const earned: { score: number; bits: number }[] = [];
  await check("5 verified nights: \"You earned N Bits\" is what lands on chain", async () => {
    let expected = await bitsOf(aliceId);
    const pending: number[] = [];
    for (let i = 0; i < 3; i++) {
      const night = await alice.night();
      earned.push(night);
      expected += night.bits;
      const target = expected;
      // The market screen polls /api/market/me: until the mint lands it shows the Bits as on the
      // way, and the poll itself sends the mint out (no cron).
      const w = await alice.wallet();
      pending.push(w.body.pendingBits);
      assert(w.body.bits + w.body.pendingBits === target, `market/me ${w.body.bits} + ${w.body.pendingBits} on the way, expected ${target}`);
      await until(`${night.bits} Bits from night ${i + 1}`, async () => (await bitsOf(aliceId)) === target, { nudge: () => alice.wallet() });
    }
    assert((await alice.wallet()).body.pendingBits === 0, "Bits still shown on the way after landing");
    numbers.pendingRightAfterNight = pending;
    const w = await walletAgrees(alice, ["crumbs"]);
    numbers.nights = earned;
    return `${earned.map((e) => `score ${e.score} → ${e.bits} Bits`).join(", ")}; wallet ${w.bits} Bits`;
  });

  // ---------- The vendor
  await check("6 buy 2 crumbs from the vendor: Bits down by the quote, stock down, price up; the app agrees", async () => {
    const m = await marketAgrees(alice, "crumbs");
    const item = m.items.find((i) => i.item === "crumbs")!;
    const q = buyQuote(item.pool, 2, m.params.feeBps)!;
    const [bits0, crumbs0, pool0] = await Promise.all([bitsOf(aliceId), balanceOf(aliceId, "item:crumbs"), pool("crumbs")]);
    const r = await alice.trade({ action: "buy", item: "crumbs", amount: 2, maxBits: withSlippage(q.total, SLIPPAGE_BPS) });
    assert(r.status === 200, `buy ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    const [bits1, crumbs1, pool1] = await Promise.all([bitsOf(aliceId), balanceOf(aliceId, "item:crumbs"), pool("crumbs")]);
    assert(bits0 - bits1 === q.total, `paid ${bits0 - bits1}, quoted ${q.total}`);
    assert(crumbs1 - crumbs0 === 2 && pool0.stock - pool1.stock === 2, `crumbs ${crumbs0}→${crumbs1}, stock ${pool0.stock}→${pool1.stock}`);
    assert(pool1.priceMilli > pool0.priceMilli && pool1.bits - pool0.bits === q.cost, `price ${pool0.priceMilli}→${pool1.priceMilli}, till +${pool1.bits - pool0.bits} (cost ${q.cost})`);
    await snapshotAgrees(alice, r, "crumbs");
    await marketAgrees(alice, "crumbs");
    await walletAgrees(alice, ["crumbs"]);
    numbers.buy = { amount: 2, total: q.total, cost: q.cost, fee: q.fee, priceMilli: [pool0.priceMilli, pool1.priceMilli] };
    return `paid ${q.total} (fee ${q.fee} burned), price ${pool0.priceMilli}→${pool1.priceMilli} milli-Bits`;
  });

  await check("7 sell 1 crumb: Bits up by the quote after the fee, price down; a round trip never profits", async () => {
    const m = await marketAgrees(alice, "crumbs");
    const item = m.items.find((i) => i.item === "crumbs")!;
    const q = sellQuote(item.pool, 1, m.params.feeBps)!;
    const [bits0, pool0] = await Promise.all([bitsOf(aliceId), pool("crumbs")]);
    const r = await alice.trade({ action: "sell", item: "crumbs", amount: 1, minBits: lessSlippage(q.net, SLIPPAGE_BPS) });
    assert(r.status === 200, `sell ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    const [bits1, pool1] = await Promise.all([bitsOf(aliceId), pool("crumbs")]);
    assert(bits1 - bits0 === q.net && pool1.priceMilli < pool0.priceMilli, `got ${bits1 - bits0} (quoted ${q.net}), price ${pool0.priceMilli}→${pool1.priceMilli}`);
    // Buy one back right away: it must cost more than the sale paid.
    const again = buyQuote(pool1Of(m, pool1), 1, m.params.feeBps)!;
    assert(again.total > q.net, `buy back ${again.total} ≤ sold ${q.net}`);
    await snapshotAgrees(alice, r, "crumbs");
    await marketAgrees(alice, "crumbs");
    await walletAgrees(alice, ["crumbs"]);
    numbers.sell = { amount: 1, net: q.net, fee: q.fee, buyBack: again.total };
    return `got ${q.net} (fee ${q.fee}); buying it back would cost ${again.total}`;
  });

  await check("8 slippage: a buy whose limit is under the price refuses on chain and moves nothing", async () => {
    const m = await marketAgrees(alice, "crumbs");
    const item = m.items.find((i) => i.item === "crumbs")!;
    const q = buyQuote(item.pool, 1, m.params.feeBps)!;
    const [bits0, pool0] = await Promise.all([bitsOf(aliceId), pool("crumbs")]);
    const r = await alice.trade({ action: "buy", item: "crumbs", amount: 1, maxBits: q.total - 1 });
    assert(r.status === 422, `expected 422, got ${r.status}`);
    const [bits1, pool1] = await Promise.all([bitsOf(aliceId), pool("crumbs")]);
    assert(bits1 === bits0 && pool1.stock === pool0.stock, "something moved");
    // The refusal carries the market too, so the sheet shows the price that refused it.
    await snapshotAgrees(alice, r, "crumbs");
    numbers.slippageMessage = r.body.message;
    return `422 ${r.body.error}: ${String(r.body.message).slice(0, 160)}`;
  });

  let listingId = 0;
  let listingPrice = 0;
  await check("9 list 1 crumb at the vendor's price: escrowed on chain, gone from the save, shown in /api/market/listings", async () => {
    const m = await marketAgrees(alice, "crumbs");
    const item = m.items.find((i) => i.item === "crumbs")!;
    const [floor, ceiling] = listingBounds(item.pool, 1, m.params.floorBps, m.params.ceilingBps);
    listingPrice = Math.max(floor, Math.round(item.priceMilli / 1000));
    const pool0 = await pool("crumbs");
    const r = await alice.trade({ action: "list", item: "crumbs", amount: 1, price: listingPrice });
    assert(r.status === 200, `list ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    listingId = (r.body.result as { id: number }).id;
    const pool1 = await pool("crumbs");
    assert(pool1.escrow - pool0.escrow === 1, `escrow ${pool0.escrow}→${pool1.escrow}`);
    const snap = await snapshotAgrees(alice, r, "crumbs");
    assert(snap.listings.some((l) => l.id === listingId) && snap.me.open.includes(listingId), "the trade's answer doesn't show the new listing");
    const listings = await until("the listing in /api/market/listings", async () => {
      const l = await alice.http<{ listings: ListingView[] }>("GET", "/api/market/listings");
      return l.body.listings.some((x) => x.id === listingId && x.seller === aliceId && x.price === listingPrice) ? l : null;
    }, { tries: 8, every: 250 });
    assert(listings.status === 200, "listings");
    const w = await walletAgrees(alice, ["crumbs"]);
    assert(w.open.includes(listingId), `market/me open ${JSON.stringify(w.open)}`);
    return `listing #${listingId} at ${listingPrice} Bits (range ${floor}–${ceiling})`;
  });

  // ---------- Bob: a factory account, like a Google player's
  await check("10 Bob gets an account from the factory with a session key, signs in, makes a hero and plays a night", async () => {
    const made = await createPlayerAccount({ handle: bobHandle, userPublicKey: bobUser.getPublicKey().toString(), sessionPublicKey: bob.session.getPublicKey().toString() });
    await bob.signIn();
    const key = await bob.http("POST", "/api/auth/wallet", { action: "session-key", publicKey: bob.session.getPublicKey().toString() });
    assert(key.status === 200, `session-key ${key.status} ${JSON.stringify(key.body)}`);
    const me = await bob.me();
    const hero = await bob.http("POST", "/api/actions", { action: { type: "create-hero", name: "Bob", suit: "midnight", powers: ["web-sling", "web-shield", "node-sense"] }, rev: me.body.rev });
    assert(hero.status === 200, `create-hero ${hero.status} ${JSON.stringify(hero.body).slice(0, 300)}`);
    const status = await bob.http<{ hero: { args: { name: string; suit: string } | null } }>("GET", "/api/chain/status");
    const reg = await bob.relay("register_hero", status.body.hero.args!);
    assert(reg.status === 200, `register_hero ${reg.status} ${JSON.stringify(reg.body).slice(0, 300)}`);
    let bits = 0;
    while ((await bitsOf(bob.accountId)) < listingPrice) {
      const night = await bob.night();
      bits += night.bits;
      const target = bits;
      await until("Bob's Bits", async () => (await bitsOf(bob.accountId)) === target, { nudge: () => bob.http("GET", "/api/chain/status") });
    }
    return `${bob.accountId} (${made.txHash}), ${bits} Bits`;
  });

  await check("11 Bob buys Alice's listing: Bob pays the price, Alice gets it less the fee, the crumb moves; both views agree", async () => {
    const [aliceBits0, bobBits0, bobCrumbs0, pool0] = await Promise.all([bitsOf(aliceId), bitsOf(bob.accountId), balanceOf(bob.accountId, "item:crumbs"), pool("crumbs")]);
    const m = (await bob.http<MarketView>("GET", "/api/market")).body;
    const fee = Math.ceil((listingPrice * m.params.feeBps) / 10_000);
    const r = await bob.trade({ action: "fill", listingId });
    assert(r.status === 200, `buy_listing ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    const [aliceBits1, bobBits1, bobCrumbs1, pool1] = await Promise.all([bitsOf(aliceId), bitsOf(bob.accountId), balanceOf(bob.accountId, "item:crumbs"), pool("crumbs")]);
    assert(bobBits0 - bobBits1 === listingPrice, `Bob paid ${bobBits0 - bobBits1}`);
    assert(aliceBits1 - aliceBits0 === listingPrice - fee, `Alice got ${aliceBits1 - aliceBits0}, expected ${listingPrice - fee}`);
    assert(bobCrumbs1 - bobCrumbs0 === 1 && pool0.escrow - pool1.escrow === 1, `Bob crumbs ${bobCrumbs0}→${bobCrumbs1}, escrow ${pool0.escrow}→${pool1.escrow}`);
    const snap = await snapshotAgrees(bob, r, "crumbs");
    assert(!snap.listings.some((l) => l.id === listingId), "the trade's answer still shows the bought listing");
    await until("the listing gone from /api/market/listings", async () => {
      const l = await bob.http<{ listings: ListingView[] }>("GET", "/api/market/listings");
      return !l.body.listings.some((x) => x.id === listingId);
    }, { tries: 8, every: 250 });
    await walletAgrees(bob, ["crumbs"]);
    await walletAgrees(alice, ["crumbs"]);
    numbers.fill = { price: listingPrice, fee, sellerGot: listingPrice - fee };
    return `Bob paid ${listingPrice}, Alice got ${listingPrice - fee} (fee ${fee} burned)`;
  });

  await check("12 Bob can't buy a listing that's gone; replaying his signed delegate does nothing", async () => {
    const signed = await bob.delegate([actions.functionCall("buy_listing", { listing_id: listingId }, 30n * TGAS, 0n)]);
    const r = await bob.relayRaw(signed);
    assert(r.status === 422, `gone listing ${r.status}`);
    numbers.goneMessage = r.body.message;
    return `422: ${String(r.body.message).slice(0, 120)}`;
  });

  await check("13 list then cancel: the crumb comes back on chain and in the save", async () => {
    const m = await marketAgrees(alice, "crumbs");
    const item = m.items.find((i) => i.item === "crumbs")!;
    const [floor] = listingBounds(item.pool, 1, m.params.floorBps, m.params.ceilingBps);
    const crumbs0 = await balanceOf(aliceId, "item:crumbs");
    const list = await alice.trade({ action: "list", item: "crumbs", amount: 1, price: floor });
    assert(list.status === 200, `list ${list.status} ${JSON.stringify(list.body).slice(0, 300)}`);
    const id = (list.body.result as { id: number }).id;
    await walletAgrees(alice, ["crumbs"]);
    const cancel = await alice.trade({ action: "cancel", listingId: id });
    assert(cancel.status === 200, `cancel ${cancel.status} ${JSON.stringify(cancel.body).slice(0, 300)}`);
    assert((await balanceOf(aliceId, "item:crumbs")) === crumbs0, "the crumb didn't come back");
    await walletAgrees(alice, ["crumbs"]);
    const again = await alice.trade({ action: "cancel", listingId: id });
    assert(again.status === 422, `second cancel ${again.status}`);
    return `listing #${id} cancelled; a second cancel says: ${String(again.body.message).slice(0, 100)}`;
  });

  await check("14 double-submit: the same signed buy posted twice at once spends once", async () => {
    const m = await marketAgrees(alice, "crumbs");
    const q = buyQuote(m.items.find((i) => i.item === "crumbs")!.pool, 1, m.params.feeBps)!;
    const { method, args } = chainCall({ action: "buy", item: "crumbs", amount: 1, maxBits: withSlippage(q.total, SLIPPAGE_BPS) });
    const signed = await alice.delegate([actions.functionCall(method, args, 30n * TGAS, 0n)]);
    const [bits0, crumbs0] = await Promise.all([bitsOf(aliceId), balanceOf(aliceId, "item:crumbs")]);
    const replies = await Promise.all([alice.relayRaw(signed), alice.relayRaw(signed)]);
    const [bits1, crumbs1] = await Promise.all([bitsOf(aliceId), balanceOf(aliceId, "item:crumbs")]);
    const ok = replies.filter((r) => r.status === 200).length;
    assert(ok === 1, `${ok} of 2 succeeded: ${replies.map((r) => r.status).join(", ")}`);
    assert(bits0 - bits1 === q.total && crumbs1 - crumbs0 === 1, `paid ${bits0 - bits1}, crumbs +${crumbs1 - crumbs0}`);
    await walletAgrees(alice, ["crumbs"]);
    const late = await alice.relayRaw(signed);
    assert(late.status !== 200, `a replay later succeeded`);
    return `statuses ${replies.map((r) => r.status).join(" + ")}, replay ${late.status}`;
  });

  await check("15 the listing cap: a fourth open listing is refused", async () => {
    const m = await marketAgrees(alice, "crumbs");
    const item = m.items.find((i) => i.item === "crumbs")!;
    const [floor] = listingBounds(item.pool, 1, m.params.floorBps, m.params.ceilingBps);
    const have = await balanceOf(aliceId, "item:crumbs");
    assert(have >= 4, `only ${have} crumbs`);
    const ids: number[] = [];
    for (let i = 0; i < m.params.maxOpenListings; i++) {
      const r = await alice.trade({ action: "list", item: "crumbs", amount: 1, price: floor });
      assert(r.status === 200, `list ${i + 1}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      ids.push((r.body.result as { id: number }).id);
    }
    const over = await alice.trade({ action: "list", item: "crumbs", amount: 1, price: floor });
    assert(over.status === 422, `fourth listing ${over.status}`);
    numbers.capMessage = over.body.message;
    for (const id of ids) assert((await alice.trade({ action: "cancel", listingId: id })).status === 200, `cancel ${id}`);
    await walletAgrees(alice, ["crumbs"]);
    return `422: ${String(over.body.message).slice(0, 120)}`;
  });

  // ---------- Suits
  await check("16 craft Stealth: 3 goo burned on chain, the suit minted and worn; the save mirrors it", async () => {
    const goo0 = await balanceOf(aliceId, "item:sybil-goo");
    const r = await alice.relay("craft_suit", { suit: "stealth" });
    assert(r.status === 200, `craft ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const [goo, suit, p] = await Promise.all([balanceOf(aliceId, "item:sybil-goo"), balanceOf(aliceId, "suit:stealth"), playerView(aliceId)]);
    assert(goo === goo0 - 3 && suit === 1 && p?.hero?.suit === "stealth", `goo ${goo0}→${goo}, suit ${suit}, wearing ${p?.hero?.suit}`);
    const me = await alice.me();
    assert(me.body.save.suits.includes("stealth") && me.body.save.hero?.suit === "stealth", `save suits ${me.body.save.suits}, wearing ${me.body.save.hero?.suit}`);
    assert((me.body.save.inventory["sybil-goo"] ?? 0) === goo, `the save has ${me.body.save.inventory["sybil-goo"]} goo, chain ${goo}`);
    numbers.craft = { goo: [goo0, goo] };
    const status = await alice.http<{ onChain: { suits: string[] } }>("GET", "/api/chain/status");
    assert(status.body.onChain?.suits.includes("stealth"), "chain status doesn't show stealth");
  });

  await check("17 equip Classic: worn on chain and in the save", async () => {
    const r = await alice.relay("equip_suit", { suit: "classic" });
    assert(r.status === 200, `equip ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const p = await playerView(aliceId);
    const me = await alice.me();
    assert(p?.hero?.suit === "classic" && me.body.save.hero?.suit === "classic", `chain ${p?.hero?.suit}, save ${me.body.save.hero?.suit}`);
  });

  // ---------- A stolen session key
  await check("18 a stolen session key can't move tokens: the relayer refuses, and so does the protocol", async () => {
    const before = await bitsOf(aliceId);
    const withYocto = await alice.relay("mt_transfer", { receiver_id: bob.accountId, token_id: "item:bits", amount: "1" }, 1n);
    const noYocto = await alice.relay("mt_transfer", { receiver_id: bob.accountId, token_id: "item:bits", amount: "1" });
    assert(withYocto.status === 400 && noYocto.status === 400, `relayer answered ${withYocto.status} / ${noYocto.status}`);
    // Straight to the chain, signed by the session key: a function-call key can't attach the yocto.
    const thief = new Account(aliceId, provider(), new KeyPairSigner(alice.session));
    const direct = await thief
      .signAndSendTransaction({ receiverId: contractId, actions: [actions.functionCall("mt_transfer", { receiver_id: bob.accountId, token_id: "item:bits", amount: "1" }, 30n * TGAS, 1n)], waitUntil: "EXECUTED_OPTIMISTIC", throwOnFailure: true })
      .then(() => "landed")
      .catch((e: Error) => e.message);
    assert(direct !== "landed", "a session key moved Bits");
    assert((await bitsOf(aliceId)) === before, "Bits moved");
    return `relayer ${withYocto.body.error} / ${noYocto.body.error}; protocol: ${direct.slice(0, 100)}`;
  });

  await check("19 price history: the app records trades from the chain (trades today, a moving sparkline)", async () => {
    const m = (await alice.http<MarketView>("GET", "/api/market")).body;
    const crumbs = m.items.find((i) => i.item === "crumbs")!;
    assert(crumbs.trades24h >= 4, `trades24h ${crumbs.trades24h}`);
    assert(new Set(crumbs.spark).size > 1, `flat sparkline ${JSON.stringify(crumbs.spark)}`);
    numbers.history = { trades24h: crumbs.trades24h, spark: crumbs.spark, change24h: crumbs.change24h };
    return `${crumbs.trades24h} trades, spark ${crumbs.spark.join(" ")}`;
  });

  const final = {
    alice: { bits: await bitsOf(aliceId), player: await playerView(aliceId), market: (await alice.wallet()).body },
    bob: { bits: await bitsOf(bob.accountId), player: await playerView(bob.accountId) },
    crumbs: await pool("crumbs"),
  };
  numbers.final = final;
  numbers.staleSharedReads = staleReads;
  const failed = results.filter((r) => r.outcome === "fail").length;
  console.log(`\n${JSON.stringify({ contract: contractId, rpc: rpcUrls, results, numbers }, null, 2)}`);
  process.exitCode = failed ? 1 : 0;
}

/** The pool from market_state as the app's Pool shape, for a quote. */
function pool1Of(m: MarketView, p: { bits: number; stock: number }) {
  const base = m.items.find((i) => i.item === "crumbs")!.pool;
  return { ...base, bits: p.bits, stock: p.stock };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
