/**
 * The economy inside the loop, played in a real headless Chrome against a local server
 * running the recommended settings in the simulated market:
 *
 *   # seed (server stopped), then serve
 *   SEED_ME=econ-hero SEED_ME_LEVEL=3 PGLITE_DIR=<dir> pnpm --filter wgp exec tsx src/server/market/seed-dev.ts
 *   ALLOW_DEV_AUTH=1 PGLITE_DIR=<dir> SIM_MARKET_CRAFT_BITS=250 SIM_MARKET_FEE_BPS=500 \
 *     pnpm --filter wgp exec next dev -p 4610 -H 127.0.0.1
 *
 *   node launch/brand/hero/economy-in-loop.mjs [--base http://127.0.0.1:4610] [--port 9911]
 *        [--out <dir>] [--handle econ-hero]
 *
 * A signed-in dev player finishes an autopilot night, follows the results' trade prompt,
 * completes the trade (the market quest pays once), lists an item cheap and watches
 * Sandwich Man buy it (the "Other traders" strip shows it, and it completes nobody's
 * quest); the Suit lab prints each recipe's cost, burns 250 Bits per craft and refuses a
 * craft when the Bits are short (the button is off with the reason, and the server answers
 * the contract's words); then /lab/economy: the default run, Recommended settings, Drain
 * Gwei and Sandwich Man's panel. Checks and console errors are printed; exits 1 on a failure.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sleep } from "../../lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = opt("base", "http://127.0.0.1:4610");
const PORT = Number(opt("port", "9911"));
const OUT = resolve(opt("out", join(HERE, "game-shots/economy-in-loop")));
const HANDLE = opt("handle", "econ-hero");
const NIGHT_MS = Number(opt("night-ms", String(8 * 60_000)));
const COST = Number(opt("craft-bits", "250"));
const FEE = opt("fee", "5%");
mkdirSync(OUT, { recursive: true });

const chrome = await launch({ port: PORT, profile: join(tmpdir(), `wgp-economy-in-loop-${PORT}`) });
const { send, evaluate, logs, on } = chrome;
const failures = [];
const notes = {};
const steps = {};
let step = "setup";
const check = (ok, what, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} [${step}] ${what}${detail !== undefined ? ` · ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  steps[step] = (steps[step] ?? true) && !!ok;
  if (!ok) failures.push(`[${step}] ${what}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
const responses = [];
on("Network.responseReceived", (p) => responses.push({ url: p.response.url, status: p.response.status, requestId: p.requestId }));

const HELPERS = `
  window.T = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
  window.visible = (el) => !!el && el.getClientRects().length > 0;
  window.byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => visible(el) && T(el).toLowerCase().includes(text.toLowerCase()));
  window.pageText = () => T(document.body);
  window.sheet = () => document.querySelector("dialog[open]");
`;
const ev = (expr) => evaluate(`(() => { ${HELPERS} const v = (${expr}); return v instanceof Node ? true : v; })()`);

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
async function go(path) {
  await send("Page.navigate", { url: BASE + path });
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    if (await evaluate(`document.readyState === "complete" && !!document.querySelector("h1")`).catch(() => false)) break;
  }
  await sleep(900);
}
async function waitFor(expr, what, ms = 30_000) {
  for (let t = 0; t < ms; t += 200) {
    const v = await ev(expr).catch(() => null);
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
async function shot(name, scrollTo) {
  if (scrollTo) await ev(`(${scrollTo})?.scrollIntoView({ block: "center" })`);
  await sleep(350);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`shot ${name}.png`);
}
async function click(expr, what = expr) {
  const p = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`Nothing to click: ${what}`);
  await sleep(150);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await sleep(300);
}
const post = (path, body) =>
  evaluate(`fetch(${JSON.stringify(path)}, { method: "POST", headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const get = (path) => evaluate(`fetch(${JSON.stringify(path)}, { cache: "no-store" }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const me = async () => (await get("/api/me")).body;
const wallet = async () => (await get("/api/market/me")).body;
const heroOf = (m) => m?.save?.hero ?? null;
const priceOf = async (item) => (await get("/api/market")).body.items.find((i) => i.item === item);
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ""));

try {
  /* ---------- sign in; the market runs the recommended settings ---------- */
  await go("/play/market");
  const signIn = await post("/api/auth/dev", { handle: HANDLE });
  check(signIn.status === 201 || signIn.status === 200, `dev sign-in as ${HANDLE}`, signIn.status);
  const market0 = (await get("/api/market")).body;
  notes.market = { onChain: market0.onChain, feeBps: market0.params.feeBps, craftBits: market0.params.craftBits };
  check(market0.onChain === false && market0.params.craftBits === COST, `the simulated market charges ${COST} Bits a craft`, notes.market);
  const before = await me();
  notes.heroBefore = heroOf(before) && { level: heroOf(before).level, xp: heroOf(before).xp };
  notes.walletBefore = (await wallet()).bits;
  // The first-visit tour would sit over the stall; this run isn't about it.
  await go("/play/market");
  if (await ev(`!!byText("aside button", "Skip the tour")`)) await click(`byText("aside button", "Skip the tour")`);

  /* ---------- 1. a whole ranked night on autopilot ---------- */
  step = "1 night";
  const t0 = Date.now();
  await go("/play/patrol?autopilot=1");
  let submit = null;
  while (Date.now() - t0 < NIGHT_MS) {
    submit = responses.find((r) => /\/api\/runs\/[^/]+\/submit$/i.test(r.url));
    if (submit) break;
    const notice = await ev(`(() => { const t = pageText(); return /You’ve patrolled tonight|Can’t start tonight|No hero yet|already in flight/i.test(t) ? t.slice(0, 300) : null; })()`).catch(() => null);
    if (notice) throw new Error(`the night didn’t start: ${notice}`);
    await sleep(1000);
  }
  if (!submit) throw new Error("no run was submitted");
  let run = null;
  for (let i = 0; i < 40 && !run; i++) {
    try {
      run = JSON.parse((await send("Network.getResponseBody", { requestId: submit.requestId })).body);
    } catch {
      await sleep(250);
    }
  }
  notes.night = { seconds: Math.round((Date.now() - t0) / 1000), status: run?.status, score: run?.score, bits: run?.bits };
  check(submit.status === 200 && run?.status === "verified", "the autopilot night is submitted and verified", notes.night);
  await waitFor(`/Verified/i.test(pageText()) && /You earned/i.test(pageText())`, "the results: verified, with Bits");
  await shot("01-night-results");

  /* ---------- 2. the results prompt ---------- */
  step = "2 trade prompt";
  const promptText = await waitFor(`(() => { const s = document.querySelector('section[aria-label="Your next trade"]'); return s && T(s); })()`, "the results’ trade prompt");
  const promptHref = await ev(`document.querySelector('section[aria-label="Your next trade"] a')?.getAttribute("href")`);
  notes.resultsPrompt = { text: promptText, href: promptHref };
  check(/(Sell|Buy) (it|them) (to|from) Gwei · \+?[\d,]+ Bits?/i.test(promptText), "the results show one next trade, with Gwei’s quote", promptText);
  check(/^\/play\/market\?item=[a-z-]+&side=(buy|sell)&amount=\d+$/i.test(promptHref ?? ""), "it links into the market with item, side and amount", promptHref);
  await shot("02-results-trade-prompt", `document.querySelector('section[aria-label="Your next trade"]')`);
  const q = new URLSearchParams(promptHref.split("?")[1]);
  const item = q.get("item");
  const side = q.get("side");
  const amount = Number(q.get("amount"));
  const poolBefore = await priceOf(item);
  const heroMid = heroOf(await me());
  await click(`document.querySelector('section[aria-label="Your next trade"] a')`, "the prompt’s button");
  await waitFor(`location.pathname === "/play/market" && sheet()`, "the market’s trade sheet", 40_000);
  await sleep(700);
  const sheetText = await ev(`T(sheet())`);
  check(sheetText.includes(`${side === "sell" ? "Sell" : "Buy"} ${poolBefore.name}`) && (await ev(`Number(sheet().querySelector('input[type="number"]').value)`)) === amount, `the sheet opens prefilled (${side} ${amount} × ${poolBefore.name})`, sheetText.slice(0, 140));
  await shot("03-prefilled-trade-sheet");

  /* ---------- 3. complete the trade; the quest pays once ---------- */
  step = "3 trade + quest";
  const walletMid = await wallet();
  const confirmLabel = await ev(`T([...sheet().querySelectorAll("button")].find((b) => /^(Sell|Buy) \\d+ for/i.test(T(b))))`);
  await click(`[...sheet().querySelectorAll("button")].find((b) => /^(Sell|Buy) \\d+ for/i.test(T(b)))`, "the sheet’s confirm button");
  await waitFor(`!sheet()`, "the trade to land");
  const toast = await waitFor(`[...document.querySelectorAll('[role="status"], [role="alert"]')].map(T).find((t) => /Market quest done/i.test(t))`, "the toast with the quest", 15_000).catch(() => null);
  check(/(Sold|Bought)\. .*Market quest done: \+30 XP\./i.test(toast ?? ""), "the toast says the trade landed and the quest is done", toast);
  const poolAfter = await priceOf(item);
  const walletAfter = await wallet();
  notes.trade = { item, side, amount, confirm: confirmLabel, priceBefore: poolBefore.priceMilli / 1000, priceAfter: poolAfter.priceMilli / 1000, bitsBefore: walletMid.bits, bitsAfter: walletAfter.bits };
  check(side === "sell" ? poolAfter.priceMilli < poolBefore.priceMilli : poolAfter.priceMilli > poolBefore.priceMilli, "the price moved", notes.trade);
  check(walletAfter.bits - walletMid.bits === (side === "sell" ? 1 : -1) * num(/for ([\d,]+) Bits?/.exec(confirmLabel)?.[1]), "the wallet moved by exactly the quote on the button (fee included)", notes.trade);
  const feeLine = await ev(`pageText().match(/Prices include the [\\d.]+% gas fee/)?.[0] ?? null`);
  check(feeLine === `Prices include the ${FEE} gas fee`, `the stall quotes the live ${FEE} fee`, feeLine);
  const heroAfterTrade = heroOf(await me());
  check((heroAfterTrade.level === heroMid.level && heroAfterTrade.xp - heroMid.xp === 30) || heroAfterTrade.level > heroMid.level, "the hero has 30 more XP in the server’s save", { before: { level: heroMid.level, xp: heroMid.xp }, after: { level: heroAfterTrade.level, xp: heroAfterTrade.xp } });
  check((await get("/api/market/quest")).body.done === true, "GET /api/market/quest says done");
  await shot("04-quest-done", `document.querySelector('section[aria-label="Today’s market quest"]')`);

  /* ---------- 4. list cheap; Sandwich Man buys it ---------- */
  step = "4 Sandwich Man";
  // He looks at most once every 20 seconds; the trade above triggered a look.
  await sleep(24_000);
  const npcBefore = (await get("/api/market/npc")).body;
  const listItem = Object.entries((await wallet()).items).sort((a, b) => b[1] - a[1])[0][0];
  await go(`/play/market?item=${listItem}&side=list`);
  await waitFor(`sheet() && /List an item/i.test(T(sheet()))`, "the listing sheet");
  await sleep(500);
  const PRICE = `document.getElementById([...sheet().querySelectorAll("label")].find((l) => /Price for the lot/i.test(T(l))).htmlFor)`;
  const floor = await ev(`Number(${PRICE}.min)`);
  // Ask the floor (half of Gwei's price), typed into the price field as a player would.
  await ev(`(() => { const el = ${PRICE}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, el.min); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await sleep(300);
  const listLabel = await ev(`T([...sheet().querySelectorAll("button")].find((b) => /^List \\d+ /i.test(T(b))))`);
  const feeHint = await ev(`T(sheet()).match(/Gas fee when it sells \\(([\\d.]+%)\\)/)?.[1] ?? null`);
  check(feeHint === FEE, `the listing sheet shows the ${FEE} fee`, feeHint);
  await shot("05-list-cheap-sheet");
  const xpBeforeNpc = heroOf(await me());
  await click(`[...sheet().querySelectorAll("button")].find((b) => /^List \\d+ /i.test(T(b)))`, "List");
  await waitFor(`!sheet()`, "the listing to land");
  notes.listing = { item: listItem, floor, label: listLabel };
  check(new RegExp(`for ${floor} Bits?$`).test(listLabel), "the listing asks the floor price", listLabel);
  let npcAfter = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    npcAfter = (await get("/api/market/npc")).body;
    if ((npcAfter?.log ?? []).some((e) => new RegExp(`Bought .* from ${HANDLE}’s listing`, "i").test(e.text))) break;
  }
  const bought = (npcAfter?.log ?? []).find((e) => new RegExp(`Bought .* from ${HANDLE}’s listing`, "i").test(e.text));
  notes.npc = { before: { bits: npcBefore?.bits, moves: npcBefore?.log?.length }, after: { bits: npcAfter?.bits, moves: npcAfter?.log?.length }, bought: bought && `${bought.text}: ${bought.reason}` };
  check(!!bought, "Sandwich Man bought the cheap listing, with his reason", notes.npc.bought);
  await go("/play/market");
  const strip = await waitFor(`(() => { const s = [...document.querySelectorAll("section")].find((s) => /Other traders/i.test(T(s.querySelector("h2")))); return s && /Bought .* from ${HANDLE}’s listing/i.test(T(s)) && T(s); })()`, "the Other traders strip with his buy", 30_000).catch(() => null);
  check(!!strip && /NPC/.test(strip), "the “Other traders” strip shows the buy, and labels him NPC", strip?.slice(0, 260));
  const xpAfterNpc = heroOf(await me());
  check(xpAfterNpc.xp === xpBeforeNpc.xp && xpAfterNpc.level === xpBeforeNpc.level, "his buy adds no quest XP to the seller", { xp: xpAfterNpc.xp });
  await shot("06-sandwich-man-bought", `[...document.querySelectorAll("section")].find((s) => /Other traders/i.test(T(s.querySelector("h2"))))`);

  /* ---------- 5. the Suit lab: the cost, the burn, the refusal ---------- */
  step = "5 Suit lab";
  await go("/play/suits");
  await waitFor(`document.querySelectorAll("[data-craft-cost]").length > 0`, "the recipes’ cost chips");
  const chips = await ev(`[...document.querySelectorAll("ul > li > button")].map((b) => ({ name: T(b.querySelector("span.px-1")), cost: b.querySelector("[data-craft-cost]")?.getAttribute("data-craft-cost") ?? null, chip: T(b.querySelector("span.absolute")) }))`);
  notes.suitTiles = chips;
  const recipeSuits = ["Stealth", "Glider", "Octo rig", "Sesame"];
  check(recipeSuits.every((n) => chips.find((c) => c.name === n)?.cost === String(COST)) && chips.filter((c) => c.cost).length === 4, `the four recipe suits print ${COST} Bits; starter suits print none`, chips);
  await shot("07-suit-lab-costs");

  // Craft while the Bits last, then meet the refusal.
  let crafted = 0;
  let blocked = null;
  for (let round = 0; round < 4 && !blocked; round++) {
    const w = await wallet();
    const ready = (await ev(`[...document.querySelectorAll("ul > li > button")].map((b) => ({ name: T(b.querySelector("span.px-1")), chip: T(b.querySelector("span.absolute")) }))`)).filter((c) => recipeSuits.includes(c.name) && /Ready|Needs Bits/i.test(c.chip));
    if (ready.length === 0) break;
    const suit = ready[0];
    await click(`[...document.querySelectorAll("ul > li > button")].find((b) => T(b.querySelector("span.px-1")) === ${JSON.stringify(suit.name)})`, suit.name);
    await waitFor(`sheet() && T(sheet()).includes(${JSON.stringify(suit.name)})`, `the ${suit.name} sheet`);
    await sleep(500);
    const text = await ev(`T(sheet())`);
    const button = await ev(`(() => { const b = [...sheet().querySelectorAll("button")].find((b) => /^Craft /i.test(T(b))); return b ? { label: T(b), disabled: b.disabled, describedBy: b.getAttribute("aria-describedby") } : null; })()`);
    check(text.includes(`Costs ${COST} Bits`) && text.includes(`${w.bits.toLocaleString("en-US")} / ${COST}`), `${suit.name}: the recipe prints “Costs ${COST} Bits” beside the wallet’s ${w.bits}`, text.slice(0, 200));
    if (w.bits >= COST) {
      check(button && !button.disabled && button.label.includes(`${COST} Bits`), `${suit.name}: Craft is on and carries the price`, button);
      if (crafted === 0) await shot("08-suit-sheet-can-pay");
      await click(`[...sheet().querySelectorAll("button")].find((b) => /^Craft /i.test(T(b)))`, `Craft ${suit.name}`);
      await waitFor(`!sheet()`, "the craft");
      const notice = await waitFor(`[...document.querySelectorAll('[role="status"]')].map(T).find((t) => /burned ${COST} Bits/i.test(t))`, "the notice with the burn", 10_000).catch(() => null);
      let after = w;
      for (let i = 0; i < 20 && after.bits === w.bits; i++) {
        await sleep(300);
        after = await wallet();
      }
      const save = (await me()).save;
      check(after.bits === w.bits - COST && save.suits.some((s) => s === suit.name.toLowerCase().split(" ")[0]), `${suit.name}: crafted, and exactly ${COST} Bits burned (${w.bits} → ${after.bits})`, notice);
      if (crafted === 0) await shot("09-crafted-burned");
      crafted += 1;
      await sleep(1200);
    } else {
      blocked = { suit: suit.name, bits: w.bits, button, text };
      check(/Needs Bits/i.test(suit.chip) && /^Needs Bits/i.test(text), `${suit.name}: the tile and the sheet say “Needs Bits”`, suit.chip);
      check(button?.disabled === true && button.describedBy === "craft-blocked", `${suit.name}: Craft is off`, button);
      const reason = await ev(`T(sheet().querySelector("#craft-blocked"))`);
      check(reason === `Crafting burns ${COST} Bits and you have ${w.bits.toLocaleString("en-US")} ${w.bits === 1 ? "Bit" : "Bits"}. Sell spare loot to Gwei or finish a ranked night for the other ${(COST - w.bits).toLocaleString("en-US")}.`, "the reason is printed next to it, with the shortfall", reason);
      notes.spareOffer = await ev(`(() => { const a = byText("dialog[open] a", "List your spares"); return a ? T(a.closest("p")) + " → " + a.getAttribute("href") : null; })()`);
      await shot("10-craft-blocked-bits-short");
      // The server refuses it too, in the contract's words, and the save doesn't move.
      const id = { Stealth: "stealth", Glider: "glider", "Octo rig": "octo", Sesame: "sesame" }[suit.name];
      const m = await me();
      const res = await post("/api/actions", { action: { type: "craft-suit", suit: id }, rev: m.rev });
      const m2 = await me();
      notes.serverRefusal = res;
      check(res.status === 422 && res.body?.error === "craft_bits_short" && res.body?.message === `Needs bits x${COST - w.bits}`, "POST /api/actions refuses it: 422 craft_bits_short, “Needs bits xN”", res);
      check(m2.rev === m.rev && !m2.save.suits.includes(id) && (await wallet()).bits === w.bits, "the save and the wallet didn’t move");
    }
  }
  notes.crafted = crafted;
  check(crafted >= 1, "at least one craft burned its Bits", crafted);
  check(!!blocked, "and a craft was refused once the Bits ran short", blocked && { suit: blocked.suit, bits: blocked.bits });
  const sim = (await get("/api/market")).body;
  notes.marketAfter = { feeBps: sim.params.feeBps, craftBits: sim.params.craftBits };

  /* ---------- 6. /lab/economy ---------- */
  step = "6 lab";
  const stat = (label) => `(() => { const el = [...document.querySelectorAll("dt, p, span, div")].find((e) => e.children.length === 0 && T(e) === ${JSON.stringify(label)}); const box = el?.parentElement; return box ? T(box) : null; })()`;
  const runLab = async (label) => {
    await click(`[...document.querySelectorAll("button")].find((b) => T(b) === "Instant")`, "Instant");
    await click(`[...document.querySelectorAll("button")].find((b) => /^Run \\d+ days/i.test(T(b)))`, "Run");
    await waitFor(`/^Run \\d+ days again$/i.test(T([...document.querySelectorAll("button")].find((b) => /^Run \\d+ days/i.test(T(b)))))`, `${label} to finish`, 60_000);
    await sleep(600);
    return { day: await ev(stat("Day")), burned: await ev(stat("Bits burned")), suits: await ev(stat("Suits crafted")), limits: await ev(`pageText().match(/sold out on [\\d,]+ and unable to buy on [\\d,]+ of [\\d,]+ item-days/)?.[0] ?? null`) };
  };
  await go("/lab/economy");
  await waitFor(`[...document.querySelectorAll("button")].some((b) => /^Run 21 days/i.test(T(b)))`, "the lab");
  const def = await runLab("the default run");
  notes.labDefault = def;
  check(/21 \/ 21/.test(def.day ?? "") && /2,847/.test(def.burned ?? "") && /99,022 earned/.test(def.burned ?? ""), "default run (mainnet’s settings, seed 2026): 2,847 burned of 99,022 earned, as README and docs/ECONOMY.md say", def);
  await shot("11-lab-default-run");
  await click(`[...document.querySelectorAll("label")].find((l) => /Recommended settings/i.test(T(l)))`, "Recommended settings");
  const rec = await runLab("the recommended run");
  notes.labRecommended = rec;
  check(/28,186/.test(rec.burned ?? "") && /and crafting/.test(rec.burned ?? ""), "Recommended settings: 28,186 burned, fee and crafting", rec);
  check(/crafting burns 250 Bits/i.test(await ev(`pageText()`)) && /5% gas fee/.test(await ev(`pageText()`)), "the page states the recommended settings: 250 Bits a craft, 5% fee");
  await shot("12-lab-recommended");
  await click(`[...document.querySelectorAll("button")].find((b) => T(b) === "Drain Gwei")`, "Drain Gwei");
  const drain = await runLab("the Drain Gwei run");
  notes.labDrain = drain;
  const d = /sold out on ([\d,]+) and unable to buy on ([\d,]+) of ([\d,]+)/.exec(drain.limits ?? "");
  check(/30 \/ 30/.test(drain.day ?? "") && !!d && num(d[1]) > 0 && num(d[2]) > 0, "Drain Gwei: she ends days sold out and unable to buy, and the page counts them", drain);
  await shot("13-lab-drain-gwei", `[...document.querySelectorAll("p")].find((p) => /Gwei’s limits so far/i.test(T(p)))`);
  await click(`[...document.querySelectorAll("button")].find((b) => T(b) === "Stop draining Gwei")`, "Stop draining Gwei");
  const panel = `document.querySelector('section[aria-labelledby="lab-npc"]')`;
  check(await ev(`!!${panel} && /Sandwich Man/i.test(T(${panel})) && /NPC/.test(T(${panel}))`), "Sandwich Man’s panel renders, labelled NPC");
  await click(`[...${panel}.querySelectorAll("button")].find((b) => /Load a run where he goes broke/i.test(T(b)))`, "Load a run where he goes broke");
  await sleep(500);
  const broke = await runLab("his showcase run");
  const panelText = await ev(`T(${panel})`);
  notes.labNpc = { run: broke, panel: panelText.slice(0, 420) };
  check(/Sets seed 270/.test(panelText) && /three times/.test(panelText), "the showcase is seed 270 and says three times", panelText.slice(-220));
  const closed = await ev(`(() => { const t = T(${panel}); const m = /shaded on the (\\d+) days? he closed shop/i.exec(t); return m ? Number(m[1]) : null; })()`);
  notes.labNpc.closedDays = closed;
  check(closed === 3, "his panel shades the three days he closed shop", closed);
  await shot("14-lab-sandwich-man", panel);
} catch (error) {
  failures.push(`[${step}] driver: ${error.message}`);
  steps[step] = false;
  console.error(error);
  await shot("zz-failure").catch(() => {});
}

step = "console";
const errors = logs.filter((l) => /^(error|exception)/i.test(l));
console.log(`\nconsole: ${logs.length} messages, ${errors.length} errors`);
for (const e of errors) console.log(`  ${e.slice(0, 400)}`);
check(errors.length === 0, "no console errors");
const failed = responses.filter((r) => r.status >= 500);
check(failed.length === 0, "no 5xx responses", failed.slice(0, 5));
console.log(`\nsteps ${JSON.stringify(steps)}`);
console.log(`\nnotes ${JSON.stringify(notes, null, 2)}`);
writeFileSync(join(OUT, "run.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), steps, notes, failures, consoleErrors: errors }, null, 2));
await chrome.close();
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall checks passed");
