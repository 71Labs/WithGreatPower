/**
 * The market inside the nightly loop, played in a real headless Chrome against a local
 * server (`ALLOW_DEV_AUTH=1 PGLITE_DIR=… next dev -p 4310 -H 127.0.0.1`, simulated market,
 * seeded with `SEED_ME=<handle> … tsx src/server/market/seed-dev.ts` so the dev player has
 * loot and Bits):
 *
 *   node launch/brand/hero/market-loop.mjs [--base http://127.0.0.1:4310] [--port 9631]
 *        [--out <dir>] [--handle loop-hero]
 *
 * A signed-in dev player: sees the first-visit coach, finishes an autopilot night, follows
 * the results prompt into a prefilled trade, completes it, sees the market quest complete
 * (XP once) and the price move; then takes the Suit lab's "Buy from Gwei" into a second
 * prefilled trade (no second quest XP). Then a guest: the gate on the trade sheet.
 * Shots at 1440 and 375 land in <out>; checks and console errors are printed; exits 1 on a failure.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sleep } from "/Users/eromonseleodigie/near-hackathon/launch/lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = opt("base", "http://127.0.0.1:4310");
const PORT = Number(opt("port", "9631"));
const OUT = resolve(opt("out", join(HERE, "game-shots/market-loop")));
const HANDLE = opt("handle", "loop-hero");
const NIGHT_MS = Number(opt("night-ms", String(8 * 60_000)));
mkdirSync(OUT, { recursive: true });

const chrome = await launch({ port: PORT, profile: `/private/tmp/claude-501/wgp-market-loop-${PORT}` });
const { send, evaluate, logs, on } = chrome;
const failures = [];
const notes = {};
const check = (ok, what, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail !== undefined ? ` · ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(what);
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
/** Evaluates in the page with the helpers; an element comes back as `true` (it can't cross by value). */
const ev = (expr) => evaluate(`(() => { ${HELPERS} const v = (${expr}); return v instanceof Node ? true : v; })()`);

let size = { width: 1440, height: 900, mobile: false };
async function viewport(width, height, mobile = false) {
  size = { width, height, mobile };
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  await sleep(500);
}
const desktop = () => viewport(1440, 900);
const phone = () => viewport(375, 812, true);
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
async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`shot ${name}.png`);
}
/** The same state at both sizes: 1440 first (where the flow runs), then a phone, then back. */
async function shots(name, { scrollTo } = {}) {
  const scroll = async () => {
    if (scrollTo) await ev(`(${scrollTo})?.scrollIntoView({ block: "center" })`);
    await sleep(350);
  };
  await scroll();
  await shot(`${name}-1440`);
  await phone();
  await scroll();
  await shot(`${name}-375`);
  await desktop();
  await scroll();
}
async function click(expr, what = expr) {
  const p = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error(`Nothing to click: ${what}`);
  await sleep(150);
  if (size.mobile) {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  }
  await sleep(300);
}
const post = (path, body) =>
  evaluate(`fetch(${JSON.stringify(path)}, { method: "POST", headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const get = (path) => evaluate(`fetch(${JSON.stringify(path)}, { cache: "no-store" }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const me = async () => (await get("/api/me")).body;
const heroOf = (m) => m?.save?.hero ?? m?.player?.save?.hero ?? null;
const priceOf = async (item) => (await get("/api/market")).body.items.find((i) => i.item === item);
const card = (name) => `[...document.querySelectorAll("li")].find((li) => li.querySelector("h3")?.textContent === ${JSON.stringify(name)})`;

try {
  /* ---------- sign in ---------- */
  await desktop();
  await go("/play/market");
  const signIn = await post("/api/auth/dev", { handle: HANDLE });
  check(signIn.status === 201, `dev sign-in as ${HANDLE}`);
  const before = await me();
  const xp0 = heroOf(before);
  notes.heroBefore = xp0 && { level: xp0.level, xp: xp0.xp };
  notes.inventoryBefore = before?.save?.inventory;

  /* ---------- first visit: the coach ---------- */
  await go("/play/market");
  await waitFor(`byText("aside", "Market tour")`, "the coach");
  const step1 = await ev(`T(byText("aside", "Market tour"))`);
  check(/step 1 of 3/i.test(step1) && /Your Bits/i.test(step1) && /You have [\d,]+ Bits\./i.test(step1), "coach step 1: your Bits, with the real number", step1);
  check(await ev(`!!document.querySelector('section[aria-labelledby="vendor-name"]')?.className.includes("ring-game-gold")`), "the Bits panel wears the coach ring");
  await shots("01-coach-step1-bits");
  await click(`byText("aside button", "Next")`);
  const step2 = await waitFor(`/step 2 of 3/i.test(T(byText("aside", "Market tour"))) && T(byText("aside", "Market tour"))`, "coach step 2");
  check(/Gwei’s price/i.test(step2) && /Why this price\?/i.test(step2), "coach step 2: Gwei’s price and “Why this price?”", step2);
  check(await ev(`document.activeElement?.tagName === "H2" && /Gwei’s price/i.test(T(document.activeElement))`), "focus moves to the step’s title");
  await shots("02-coach-step2-price", { scrollTo: `byText("aside", "Market tour")` });
  await click(`byText("aside button", "Next")`);
  const step3 = await waitFor(`/step 3 of 3/i.test(T(byText("aside", "Market tour"))) && T(byText("aside", "Market tour"))`, "coach step 3");
  check(/Buy or sell/i.test(step3) && /Start trading/i.test(step3) && !/Skip the tour/i.test(step3), "coach step 3: buy or sell, ends with “Start trading”", step3);
  await shots("03-coach-step3-trade", { scrollTo: `byText("aside", "Market tour")` });
  await click(`byText("aside button", "Start trading")`);
  await sleep(400);
  check(await ev(`!byText("aside", "Market tour")`), "the coach closes");
  await go("/play/market");
  await waitFor(card("Crumbs"), "the stall");
  check(await ev(`!byText("aside", "Market tour")`), "and stays closed on the next visit");
  const questOpen = await ev(`T(document.querySelector('section[aria-label="Today’s market quest"]'))`);
  check(/One trade today does it/i.test(questOpen) && /\+30 XP/i.test(questOpen), "the quest strip is open: +30 XP", questOpen);

  /* ---------- Tonight: the market tile ---------- */
  await go("/play");
  const tile = await waitFor(`(() => { const a = [...document.querySelectorAll('a[href="/play/market"]')].find((a) => /Mempool Market/i.test(T(a)) && /“/i.test(T(a))); return a && T(a); })()`, "Tonight’s market tile with a pool line");
  notes.tileBefore = tile;
  check(/Quest \+30 XP/i.test(tile) && /(left|none left)/i.test(tile), "Tonight’s market tile: a real pool line and the open quest", tile);
  await shots("04-tonight-market-tile", { scrollTo: `[...document.querySelectorAll('a[href="/play/market"]')].find((a) => /Mempool Market/i.test(T(a)) && /“/i.test(T(a)))` });

  /* ---------- a whole ranked night on autopilot ---------- */
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

  /* ---------- the results prompt ---------- */
  const promptText = await waitFor(`(() => { const s = document.querySelector('section[aria-label="Your next trade"]'); return s && T(s); })()`, "the results’ trade prompt");
  const promptHref = await ev(`document.querySelector('section[aria-label="Your next trade"] a')?.getAttribute("href")`);
  notes.resultsPrompt = { text: promptText, href: promptHref };
  check(/^Your next trade/i.test(promptText) && /(Sell|Buy) (it|them) (to|from) Gwei · \+?[\d,]+ Bits?/i.test(promptText), "the results show one next trade, with Gwei’s quote", promptText);
  check(/^\/play\/market\?item=[a-z-]+&side=(buy|sell)&amount=\d+$/i.test(promptHref ?? ""), "it links into the market with item, side and amount", promptHref);
  check(await ev(`!byText("a", "Spend them at the market")`), "the generic “Spend them at the market” link gives way to the prompt");
  await shots("05-results-trade-prompt", { scrollTo: `document.querySelector('section[aria-label="Your next trade"]')` });

  const q = new URLSearchParams(promptHref.split("?")[1]);
  const item = q.get("item");
  const side = q.get("side");
  const amount = Number(q.get("amount"));
  const poolBefore = await priceOf(item);
  const walletBefore = (await get("/api/market/me")).body;
  const heroMid = heroOf(await me());
  notes.heroAfterNight = heroMid && { level: heroMid.level, xp: heroMid.xp };

  /* ---------- tap 1: the prompt opens the prefilled sheet ---------- */
  let taps = 0;
  await click(`document.querySelector('section[aria-label="Your next trade"] a')`, "the prompt’s button");
  taps += 1;
  await waitFor(`location.pathname === "/play/market" && sheet()`, "the market’s trade sheet", 40_000);
  await sleep(700);
  const sheetText = await ev(`T(sheet())`);
  const sheetAmount = await ev(`Number(sheet().querySelector('input[type="number"]').value)`);
  check(new RegExp(`^.*${side === "sell" ? "Sell" : "Buy"} ${poolBefore.name}`).test(sheetText), `the sheet is on the right item and side (${side} ${poolBefore.name})`, sheetText.slice(0, 120));
  check(sheetAmount === amount, `the amount is prefilled (${amount})`, sheetAmount);
  check(await ev(`sheet().querySelector('[aria-pressed="true"]')?.textContent.includes(${JSON.stringify(side === "sell" ? "Sell to Gwei" : "Buy from Gwei")})`), "the side toggle matches");
  check(await ev(`location.search === ""`), "the address is tidied once the sheet is open", await ev(`location.href`));
  check(await ev(`!byText("aside", "Market tour")`), "no coach over a prompted trade");
  await shots("06-prefilled-trade-sheet");

  /* ---------- tap 2: confirm ---------- */
  const confirmLabel = await ev(`T([...sheet().querySelectorAll("button")].find((b) => /^(Sell|Buy) \\d+ for/i.test(T(b))))`);
  await click(`[...sheet().querySelectorAll("button")].find((b) => /^(Sell|Buy) \\d+ for/i.test(T(b)))`, "the sheet’s confirm button");
  taps += 1;
  await waitFor(`!sheet()`, "the trade to land");
  notes.tapsResultsToTrade = taps;
  check(taps === 2, "results screen to a completed trade: 2 taps", confirmLabel);
  const toast = await waitFor(`(() => { const t = [...document.querySelectorAll('[role="status"], [role="alert"]')].map(T).find((t) => /Market quest done/i.test(t)); return t; })()`, "the toast with the quest", 15_000).catch(() => null);
  check(/(Sold|Bought)\. .*Market quest done: \+30 XP\./i.test(toast ?? ""), "the toast says the trade landed and the quest is done", toast);
  const questDone = await waitFor(`(() => { const s = document.querySelector('section[aria-label="Today’s market quest"]'); return s && /done/i.test(T(s)) && T(s); })()`, "the quest strip done");
  check(/Today’s market quest · done/i.test(questDone) && /You got \+30 XP/i.test(questDone), "the quest strip shows done, with the XP", questDone);
  const poolAfter = await priceOf(item);
  const walletAfter = (await get("/api/market/me")).body;
  notes.trade1 = { item, side, amount, priceBefore: poolBefore.priceMilli / 1000, priceAfter: poolAfter.priceMilli / 1000, stockBefore: poolBefore.pool.stock, stockAfter: poolAfter.pool.stock, bitsBefore: walletBefore.bits, bitsAfter: walletAfter.bits };
  check(side === "sell" ? poolAfter.priceMilli < poolBefore.priceMilli : poolAfter.priceMilli > poolBefore.priceMilli, `the price moved (${side === "sell" ? "down" : "up"})`, notes.trade1);
  check(poolAfter.pool.stock === poolBefore.pool.stock + (side === "sell" ? amount : -amount), "Gwei’s stock moved by the amount");
  const cardText = await ev(`T(${card(poolBefore.name)})`);
  check(cardText.includes(`Stock ${poolAfter.pool.stock}`), "the card on screen shows the new stock", cardText.slice(0, 160));
  const heroAfterTrade = heroOf(await me());
  const gained = (h0, h1) => (h1.level === h0.level ? h1.xp - h0.xp : null);
  notes.heroAfterTrade = { level: heroAfterTrade.level, xp: heroAfterTrade.xp };
  check(gained(heroMid, heroAfterTrade) === 30 || heroAfterTrade.level > heroMid.level, "the hero has 30 more XP in the server’s save", { before: notes.heroAfterNight, after: notes.heroAfterTrade });
  const questApi = (await get("/api/market/quest")).body;
  check(questApi.done === true && questApi.xp === 30, "GET /api/market/quest says done", questApi);
  await sleep(600);
  await shots("07-quest-done-price-moved", { scrollTo: `document.querySelector('section[aria-label="Today’s market quest"]')` });
  await shots("08-card-after-trade", { scrollTo: card(poolBefore.name) });

  /* ---------- the Suit lab: Buy from Gwei ---------- */
  await go("/play/suits");
  await waitFor(`byText("button", "Octo rig")`, "the Suit lab");
  await click(`byText("button", "Octo rig")`);
  await waitFor(`sheet() && /Octo rig/i.test(T(sheet()))`, "the Octo rig sheet");
  const offers = await waitFor(`(() => { const s = sheet().querySelector('section[aria-label="Buy the missing parts"]'); return s && T(s); })()`, "the buy lines");
  const buyHref = await ev(`sheet().querySelector('section[aria-label="Buy the missing parts"] a')?.getAttribute("href")`);
  notes.suitOffer = { text: offers, href: buyHref };
  check(/short\. Gwei has (one|them) in stock\. Buy from Gwei · [\d,]+ Bits/i.test(offers), "a locked recipe shows what’s missing with “Buy from Gwei · N Bits”", offers);
  const spareLine = await ev(`(() => { const a = byText("dialog[open] a", "List your spares"); return a ? T(a.closest("p")) + " → " + a.getAttribute("href") : null; })()`);
  notes.spares = spareLine;
  check(spareLine === null || /Spare loot: .*List your spares → \/play\/market\?item=[a-z-]+&side=list/i.test(spareLine), "spare loot gets “List your spares”, linked to the listing sheet", spareLine);
  await shots("09-suits-buy-from-gwei", { scrollTo: `sheet().querySelector('section[aria-label="Buy the missing parts"]')` });

  const q2 = new URLSearchParams(buyHref.split("?")[1]);
  const part = q2.get("item");
  const partBefore = await priceOf(part);
  await click(`sheet().querySelector('section[aria-label="Buy the missing parts"] a')`, "Buy from Gwei");
  await waitFor(`location.pathname === "/play/market" && sheet() && /Buy /i.test(T(sheet()))`, "the prefilled buy", 40_000);
  await sleep(700);
  check((await ev(`Number(sheet().querySelector('input[type="number"]').value)`)) === Number(q2.get("amount")), "the buy is prefilled with the shortfall");
  check((await ev(`T(sheet())`)).includes(`Buy ${partBefore.name}`), `the sheet is on ${partBefore.name}`);
  await shots("10-suits-prefilled-buy");
  await click(`[...sheet().querySelectorAll("button")].find((b) => /^Buy \\d+ for/i.test(T(b)))`, "confirm the buy");
  await waitFor(`!sheet()`, "the buy to land");
  const partAfter = await priceOf(part);
  notes.trade2 = { item: part, priceBefore: partBefore.priceMilli / 1000, priceAfter: partAfter.priceMilli / 1000, stockBefore: partBefore.pool.stock, stockAfter: partAfter.pool.stock };
  check(partAfter.priceMilli > partBefore.priceMilli, "buying pushed the price up", notes.trade2);
  const after2 = await me();
  check((after2.save.inventory[part] ?? 0) >= Number(q2.get("amount")), "the part is in the save, ready to craft with", after2.save.inventory);
  const heroAfter2 = heroOf(after2);
  check(heroAfter2.level === heroAfterTrade.level && heroAfter2.xp === heroAfterTrade.xp, "a second trade the same day adds no quest XP", { xp: heroAfter2.xp });
  await sleep(4500);
  check(!/Market quest done/i.test(await ev(`pageText()`)), "and the toast doesn’t claim the quest again");

  /* ---------- Tonight again: quest done on the tile ---------- */
  await go("/play");
  const tileAfter = await waitFor(`(() => { const a = [...document.querySelectorAll('a[href="/play/market"]')].find((a) => /Mempool Market/i.test(T(a)) && /“/i.test(T(a))); return a && T(a); })()`, "Tonight’s tile again");
  notes.tileAfter = tileAfter;
  check(/Quest done/i.test(tileAfter), "Tonight’s market tile shows the quest done", tileAfter);
  await shots("11-tonight-quest-done", { scrollTo: `[...document.querySelectorAll('a[href="/play/market"]')].find((a) => /Mempool Market/i.test(T(a)) && /“/i.test(T(a)))` });

  /* ---------- a list link opens the listing sheet on its item ---------- */
  await go("/play/market?item=crumbs&side=list");
  const listSheet = await waitFor(`sheet() && /List an item/i.test(T(sheet())) && T(sheet())`, "the listing sheet").catch(() => null);
  check(!!listSheet && (await ev(`sheet().querySelector('input[type="radio"]:checked')?.value`)) === "crumbs", "a “List your spares” link opens the listing sheet on that item");
  await shots("12-list-your-spares-sheet");

  /* ---------- a guest: sees prices, and what trading needs ---------- */
  await send("Network.clearBrowserCookies");
  await go("/play/market");
  // What a guest night records (recordGuestNight): here set directly, the night itself isn't replayed.
  await evaluate(`localStorage.setItem("wgp:guest-bits:v1", JSON.stringify({ "1": 42 }))`);
  await go("/play/market");
  await waitFor(card("Crumbs"), "the stall, as a guest");
  const vendor = await ev(`T(document.querySelector('section[aria-labelledby="vendor-name"]'))`);
  check(/Your guest nights would have paid about 42/i.test(vendor) && /Sign in to trade/i.test(vendor), "a guest sees their would-be Bits and “Sign in to trade”", vendor);
  check(await ev(`!byText("aside", "Market tour")`), "no coach for a guest");
  check(/Sign in to take it/i.test(await ev(`T(document.querySelector('section[aria-label="Today’s market quest"]'))`)), "the quest tells a guest to sign in");
  check(await ev(`!!${card("Crumbs")} && [...${card("Crumbs")}.querySelectorAll("button")].some((b) => /^Buy/i.test(T(b)))`), "the cards keep their Buy and Sell buttons for a guest");
  await click(`[...${card("Crumbs")}.querySelectorAll("button")].find((b) => /^Buy/i.test(T(b)))`, "Buy, as a guest");
  await waitFor(`sheet()`, "the gated sheet");
  await sleep(500);
  const gated = await ev(`T(sheet())`);
  check(/Trading needs an account\. Your guest nights would have paid about 42 Bits/i.test(gated) && /You pay/i.test(gated), "the sheet shows the quote and says what trading needs", gated.slice(-260));
  check(await ev(`!![...sheet().querySelectorAll("button")].find((b) => T(b) === "Sign in to trade") && ![...sheet().querySelectorAll("button")].some((b) => /^Buy \\d+ for/i.test(T(b)))`), "its one button is “Sign in to trade”");
  await shots("13-guest-gate");
  await click(`[...sheet().querySelectorAll("button")].find((b) => T(b) === "Sign in to trade")`, "Sign in to trade");
  const account = await waitFor(`sheet() && /sign in|google|wallet/i.test(T(sheet())) && T(sheet()).slice(0, 80)`, "the account sheet", 15_000).catch(() => null);
  check(!!account, "which opens the sign-in sheet", account);
} catch (error) {
  failures.push(`driver: ${error.message}`);
  console.error(error);
  await shot("zz-failure").catch(() => {});
}

const errors = logs.filter((l) => /^(error|exception)/i.test(l));
console.log(`\nconsole: ${logs.length} messages, ${errors.length} errors`);
for (const e of errors) console.log(`  ${e.slice(0, 400)}`);
check(errors.length === 0, "no console errors");
console.log(`\nnotes ${JSON.stringify(notes, null, 2)}`);
writeFileSync(join(OUT, "run.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), notes, failures, consoleErrors: errors }, null, 2));
await chrome.close();
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall checks passed");
