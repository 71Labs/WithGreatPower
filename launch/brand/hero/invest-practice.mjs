/**
 * The practice market and "invest in a merchant", played in a real headless Chrome against
 * a local server (PGlite, the simulated market, dev sign-in), once on a phone (375×812,
 * touch) and once on a desktop (1440×900):
 *
 *   # seed two dev players with Bits and a bag of Crumbs (server stopped), then serve
 *   SEED_ME=invest-phone,invest-desk SEED_ME_CRUMBS=200 PGLITE_DIR=<dir> \
 *     pnpm --filter wgp exec tsx src/server/market/seed-dev.ts
 *   ALLOW_DEV_AUTH=1 PGLITE_DIR=<dir> SIM_MARKET_INVEST_LOCK_MS=5000 \
 *     pnpm --filter wgp exec next dev -p 4630 -H 127.0.0.1
 *
 *   node launch/brand/hero/invest-practice.mjs [--base http://127.0.0.1:4630] [--port 9931]
 *        [--out <dir>] [--only phone|desk]
 *
 * Each pass, from an empty browser profile:
 *
 *  1. a fresh guest presses Play now on the landing page and is in their first night;
 *  2. the night plays on autopilot to its results;
 *  3. the results offer the practice market, and its link opens it;
 *  4. the guest buys and sells in the practice market (labelled practice, never on NEAR);
 *  5. "Why this price?" opens, on screen;
 *  6. Gwei is driven broke on one item: on the desktop by selling a bag of Crumbs into her
 *     through the sell sheet until her till is empty (the guest's save is given 100 Crumbs
 *     first, as a guest who had played many nights would hold); on the phone with the
 *     practice market's own "Empty Gwei's … till" button;
 *  7. her shop for that item shows closed, with the reason, and "Why this price?" says so;
 *  8. the guest invests (the risks are on the sheet before the button), and the shop reopens;
 *  9. another trade pays the investor a share of its fee;
 * 10. the stake unlocks and is withdrawn;
 * 11. the dev player signs in and does the same on the server's simulated market: sells a
 *     till dry, invests, earns a fee share, withdraws, with the server's own numbers checked;
 * 12. /lab/economy's showcase run, "Drain Gwei, then invest in her", renders.
 *
 * Along the way it checks that the practice market never changes the saved game and never
 * posts to the server, that nothing is under the nav or off the side of the screen, and at
 * the end that the console is clean. Checks are printed; exits 1 on a failure.
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
const BASE = opt("base", "http://127.0.0.1:4630");
const PORT = Number(opt("port", "9931"));
const OUT = resolve(opt("out", join(HERE, "game-shots/invest-practice")));
const ONLY = opt("only", null);
const NIGHT_MS = Number(opt("night-ms", String(9 * 60_000)));
mkdirSync(OUT, { recursive: true });

const PASSES = [
  { id: "phone", width: 375, height: 812, mobile: true, handle: "invest-phone", drainBy: "crowd" },
  { id: "desk", width: 1440, height: 900, mobile: false, handle: "invest-desk", drainBy: "selling" },
].filter((p) => !ONLY || p.id === ONLY);

const LABEL = "Practice market: not on NEAR. Sign in to trade for real.";
const RISKS = [/waits when the till is empty/i, /first come, first served/i, /sell loot into a till you funded and take the Bits/i, /only come back when someone buys that stock/i];

const failures = [];
const report = {};
const allErrors = [];

const HELPERS = `
  window.T = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
  window.visible = (el) => !!el && el.getClientRects().length > 0;
  window.byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => visible(el) && T(el).toLowerCase().includes(text.toLowerCase()));
  window.pageText = () => T(document.body);
  window.sheet = () => document.querySelector("dialog[open]");
  window.card = (name) => [...document.querySelectorAll("li")].find((li) => T(li.querySelector("h3")) === name);
  window.cardButton = (name, re) => [...(card(name)?.querySelectorAll("button") ?? [])].find((b) => re.test(T(b)));
  window.sheetButton = (re) => [...(sheet()?.querySelectorAll("button") ?? [])].find((b) => re.test(T(b)));
  window.toasts = () => [...document.querySelectorAll('[role="status"], [role="alert"]')].map(T).filter(Boolean);
  // Headings are set in capitals by CSS, and innerText reads them that way: match without case.
  window.section = (re) => { const r = new RegExp(re.source, "i"); return [...document.querySelectorAll("section")].find((s) => r.test(s.getAttribute("aria-label") ?? "") || r.test(T(s.querySelector("h2")))); };
  window.practice = () => { try { return JSON.parse(localStorage.getItem("wgp:practice:v1")); } catch { return null; } };
  window.saved = () => { try { return JSON.parse(localStorage.getItem("wgp:save:v1")); } catch { return null; } };
`;

async function pass(vp) {
  const chrome = await launch({ port: PORT, profile: join(tmpdir(), `wgp-invest-practice-${PORT}-${vp.id}`) });
  const { send, evaluate, logs, on } = chrome;
  const steps = {};
  const notes = {};
  let step = "setup";
  const check = (ok, what, detail) => {
    console.log(`${ok ? "ok  " : "FAIL"} [${vp.id} · ${step}] ${what}${detail !== undefined ? ` · ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    steps[step] = (steps[step] ?? true) && !!ok;
    if (!ok) failures.push(`[${vp.id} · ${step}] ${what}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  const responses = [];
  const requests = [];
  on("Network.responseReceived", (p) => responses.push({ url: p.response.url, status: p.response.status }));
  on("Network.requestWillBeSent", (p) => requests.push({ url: p.request.url, method: p.request.method }));
  await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.mobile ? 2 : 1, mobile: vp.mobile });
  if (vp.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  const ev = (expr) => evaluate(`(() => { ${HELPERS} const v = (${expr}); return v instanceof Node ? true : v; })()`);
  async function go(path) {
    await send("Page.navigate", { url: BASE + path });
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      if (await evaluate(`document.readyState === "complete" && !!document.querySelector("h1, canvas, main")`).catch(() => false)) break;
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
    writeFileSync(join(OUT, `${vp.id}-${name}.png`), Buffer.from(data, "base64"));
    console.log(`shot ${vp.id}-${name}.png`);
  }
  /** A click with the mouse on the desktop, a tap with a finger on the phone. */
  async function click(expr, what = expr) {
    const p = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!p) throw new Error(`Nothing to click: ${what}`);
    await sleep(200);
    // Scrolling may have settled since: read the point again.
    const q = (await ev(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)) ?? p;
    if (vp.mobile) {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: q.x, y: q.y }] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: q.x, y: q.y, button: "none" });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: q.x, y: q.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: q.x, y: q.y, button: "left", clickCount: 1 });
    }
    await sleep(350);
  }
  /** Types a number into a field the way React hears it. */
  const type = (expr, value) =>
    ev(`(() => { const el = ${expr}; if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  /**
   * Each named element, scrolled to the middle: it has a size, sits inside the viewport's
   * width, is the thing on top at its own centre (so not under the nav, the dock, a sheet
   * or a neighbour), and the page has no sideways scroll.
   */
  async function layout(name, parts) {
    for (const [label, expr] of Object.entries(parts)) {
      const m = await ev(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: "center", inline: "nearest" }); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 40)); const bar = document.querySelector("[data-wgp-topbar]")?.getBoundingClientRect(); const dock = document.querySelector("[data-wgp-dock]")?.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), y: Math.round(r.top), vw: innerWidth, vh: innerHeight, onTop: !!top && (el.contains(top) || top === el || top.contains(el)), by: top ? top.tagName + "." + String(top.className).slice(0, 60) : null, sideways: document.documentElement.scrollWidth - innerWidth, barBottom: bar && bar.height ? Math.round(bar.bottom) : null, dockTop: dock && dock.height ? Math.round(dock.top) : null }; })()`);
      const ok = !!m && m.w > 0 && m.h > 0 && m.left >= -1 && m.right <= m.vw + 1 && m.onTop && m.sideways <= 1;
      check(ok, `${name}: ${label} is on screen, inside the width, not covered, no sideways scroll`, ok ? `${m.w}×${m.h} at x ${m.left}` : m);
    }
  }
  const post = (path, body) =>
    evaluate(`fetch(${JSON.stringify(path)}, { method: "POST", headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
  const get = (path) => evaluate(`fetch(${JSON.stringify(path)}, { cache: "no-store" }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
  const num = (s) => Number(String(s ?? "").replace(/[^\d.-]/g, ""));
  const practiceBits = () => ev(`num0(T(document.querySelector('section[aria-labelledby="vendor-name"]')).match(/Your practice Bits ([\\d,]+)/)?.[1])`.replace("num0", "((s) => Number(String(s ?? '').replace(/[^\\d]/g, '')))"));
  const toast = (re, ms = 12_000) => waitFor(`toasts().find((t) => ${re}.test(t))`, `a toast matching ${re}`, ms).catch(() => null);
  /** The most of an item Gwei's till can pay for right now, from a pool: floor(y·n / (x + n)) ≤ till. */
  const mostSellable = (pool, cap = 20) => {
    for (let n = cap; n >= 1; n--) {
      const payout = Math.floor(((pool.virtualBits + pool.bits) * n) / (pool.virtualItems + pool.stock + n));
      if (payout > 0 && payout <= pool.bits) return n;
    }
    return 0;
  };
  /** Opens an item's trade sheet on a side, sets the amount and confirms. Returns the confirm button's label. */
  async function trade(name, side, amount) {
    await click(`cardButton(${JSON.stringify(name)}, /^${side}/)`, `${side} on ${name}`);
    await waitFor(`sheet() && /${side} ${name}/.test(T(sheet()))`, `the ${side} sheet for ${name}`);
    await sleep(300);
    if (amount !== 1) await type(`sheet().querySelector('input[type="number"]')`, amount);
    await sleep(300);
    const label = await ev(`T(sheetButton(/^(Buy|Sell) [\\d,]+ for/))`);
    await click(`sheetButton(/^(Buy|Sell) [\\d,]+ for/)`, `confirm ${side}`);
    await waitFor(`!sheet()`, `the ${side} to land`, 20_000);
    return label;
  }
  /** The investing flow shared by the practice market and the simulated one. `stakeOf` reads the stake where the truth is. */
  async function investFlow(tag, name, { amount, lockMs, stakeOf, bitsOf, toastPrefix }) {
    /* -- closed, with the reason -- */
    step = `${tag} closed`;
    const closed = await waitFor(`(() => { const c = card(${JSON.stringify(name)}); return c && /Closed for buying/.test(T(c)) && T(c); })()`, `${name}'s card to show closed`, 15_000).catch(() => null);
    check(!!closed && /Broke: her till is [\d,]+ Bits? short of buying one\./.test(closed ?? ""), "the shop shows closed for buying, with the reason", closed?.slice(-200));
    check(await ev(`cardButton(${JSON.stringify(name)}, /^Sell/)?.disabled === true`), "its Sell button is off");
    await click(`cardButton(${JSON.stringify(name)}, /Why this price/)`, "Why this price?");
    const why = await waitFor(`(() => { const t = card(${JSON.stringify(name)})?.querySelector('[role="tooltip"]'); return t && getComputedStyle(t).visibility === "visible" && T(t); })()`, "Gwei's reasoning", 8_000).catch(() => null);
    check(/I’m closed for buying these: my till is [\d,]+ Bits? short of paying for one\. Besides buying from me, investing in this till reopens me, at the same price\./.test(why ?? ""), "“Why this price?” says she is closed, why, and that investing reopens her", why?.slice(-170));
    await layout(`${tag} closed`, { "the closed card": `card(${JSON.stringify(name)})`, "her reasoning": `card(${JSON.stringify(name)})?.querySelector('[role="tooltip"]')` });
    await shot(`${tag}-1-closed-with-reason`, `card(${JSON.stringify(name)})`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);

    /* -- invest: the risks first -- */
    step = `${tag} invest`;
    const priceBefore = await ev(`T(card(${JSON.stringify(name)})).match(/([\\d.,]+) Bits/)?.[1]`);
    const bitsBefore = await bitsOf();
    if (vp.mobile) {
      await click(`cardButton(${JSON.stringify(name)}, /^Invest in Gwei/)`, "Invest in Gwei");
    } else {
      // The other way in: the trade sheet's sell side says she can't pay, and offers to invest instead.
      await click(`cardButton(${JSON.stringify(name)}, /^Buy/)`, `Buy on ${name}`);
      await waitFor(`sheet() && /Buy ${name}/.test(T(sheet()))`, "the trade sheet");
      await click(`sheetButton(/^Sell to Gwei$/)`, "Sell to Gwei");
      const shortcut = await waitFor(`sheetButton(/^Invest in Gwei instead$/) && T(sheet())`, "the invest shortcut", 8_000).catch(() => null);
      check(/can’t pay for one/.test(shortcut ?? "") && /Invest in Gwei instead/.test(shortcut ?? ""), "the sell sheet on a broke item offers “Invest in Gwei instead”", shortcut?.slice(-200));
      await shot(`${tag}-1b-sell-sheet-invest-instead`, `sheetButton(/^Invest in Gwei instead$/)`);
      await click(`sheetButton(/^Invest in Gwei instead$/)`, "Invest in Gwei instead");
    }
    await waitFor(`sheet() && /Invest in Gwei: ${name}/.test(T(sheet()))`, "the invest sheet");
    await sleep(400);
    const sheetText = await ev(`T(sheet())`);
    check(/What you risk/.test(sheetText) && RISKS.every((r) => r.test(sheetText)), "the sheet states what the player risks, before the button", sheetText.match(/What you risk.*?buy it\./)?.[0]?.slice(0, 220));
    check(/Closed for buying/.test(sheetText) && /The price doesn’t move/.test(sheetText), "it shows the shop closed and says the price doesn’t move");
    await type(`sheet().querySelector('input[type="number"]')`, amount);
    await sleep(300);
    const investLabel = await ev(`T(sheetButton(/^Invest [\\d,]+ Bits? in Gwei$/))`);
    check(investLabel === `Invest ${amount} Bits in Gwei`, "the button repeats what it does", investLabel);
    await layout(`${tag} invest sheet`, { "the risks": `[...sheet().querySelectorAll("section")].find((s) => /What you risk/.test(T(s)))`, "the invest button": `sheetButton(/^Invest [\\d,]+ Bits? in Gwei$/)` });
    await shot(`${tag}-2-invest-sheet-risks`, `[...sheet().querySelectorAll("section")].find((s) => /What you risk/.test(T(s)))`);
    await click(`sheetButton(/^Invest [\\d,]+ Bits? in Gwei$/)`, "the invest button");
    await waitFor(`!sheet()`, "the investment to land", 20_000);
    const invested = await toast(`/${toastPrefix}Invested\\./`);
    check(!!invested, "a toast says it is invested", invested);
    const reopened = await waitFor(`(() => { const c = card(${JSON.stringify(name)}); return c && !/Closed for buying/.test(T(c)) && T(c); })()`, "the shop to reopen", 15_000).catch(() => null);
    check(!!reopened && new RegExp(`Your stake: ${amount} Bits`).test(reopened ?? ""), "the shop reopens, and the card shows the stake", reopened?.slice(-160));
    check(await ev(`cardButton(${JSON.stringify(name)}, /^Sell/)?.disabled === false`), "its Sell button is back on");
    const priceAfter = await ev(`T(card(${JSON.stringify(name)})).match(/([\\d.,]+) Bits/)?.[1]`);
    check(priceBefore === priceAfter, "investing moved no price", { before: priceBefore, after: priceAfter });
    const stake0 = await stakeOf();
    const bitsAfter = await bitsOf();
    notes[`${tag}Invest`] = { item: name, amount, bitsBefore, bitsAfter, stake: stake0 };
    check(stake0?.bits === amount && bitsBefore - bitsAfter === amount, "the stake is on the books and the Bits left the wallet, to the Bit", notes[`${tag}Invest`]);
    const panel = `section(/Your stakes in Gwei/)`;
    check(await ev(`!!${panel} && /${amount} Bits in her ${name} till/.test(T(${panel})) && /locked for/.test(T(${panel}))`), "“Your stakes in Gwei” shows the stake and its lock", await ev(`T(${panel})`));
    await layout(`${tag} stakes`, { "the stakes panel": panel, "the reopened card": `card(${JSON.stringify(name)})` });
    await shot(`${tag}-3-reopened-with-stake`, `card(${JSON.stringify(name)})`);

    /* -- a trade pays a fee share -- */
    step = `${tag} fee share`;
    let earned = 0;
    for (let i = 0; i < 6 && earned < 1; i++) {
      await trade(name, "Buy", 20);
      await sleep(500);
      earned = (await stakeOf())?.earned ?? 0;
    }
    notes[`${tag}Earned`] = earned;
    check(earned >= 1, "buying that item pays the investor a share of the fee", `${earned} Bits earned`);
    check(await ev(`new RegExp("[1-9][\\\\d,]* earned from fees").test(T(${panel}))`), "the stakes panel shows the earnings", await ev(`T(${panel})`));
    await shot(`${tag}-4-fee-share`, panel);

    /* -- withdraw -- */
    step = `${tag} withdraw`;
    await sleep(lockMs + 1_500);
    await waitFor(`/unlocked/.test(T(${panel}))`, "the stake to unlock", lockMs + 20_000);
    const beforeOut = await bitsOf();
    const stakeBefore = await stakeOf();
    await click(`[...${panel}.querySelectorAll("button")].find((b) => /Withdraw or claim/.test(T(b)))`, "Withdraw or claim");
    await waitFor(`sheet() && sheetButton(/^Withdraw [\\d,]+ Bits?$/)`, "the withdraw sheet");
    await sleep(400);
    const outLabel = await ev(`T(sheetButton(/^Withdraw [\\d,]+ Bits?$/))`);
    check(outLabel === `Withdraw ${amount} Bits`, "the sheet opens on the whole stake", outLabel);
    await shot(`${tag}-5-withdraw-sheet`);
    await click(`sheetButton(/^Withdraw [\\d,]+ Bits?$/)`, "the withdraw button");
    await waitFor(`!sheet()`, "the withdrawal to land", 20_000);
    check(!!(await toast(`/${toastPrefix}Withdrawn\\./`)), "a toast says it is withdrawn");
    await sleep(600);
    const afterOut = await bitsOf();
    const stakeGone = await stakeOf();
    notes[`${tag}Withdraw`] = { before: beforeOut, after: afterOut, earned: stakeBefore?.earned };
    check(!stakeGone && afterOut - beforeOut === amount + (stakeBefore?.earned ?? 0), "the stake is back, with what it earned, to the Bit", notes[`${tag}Withdraw`]);
    check(await ev(`!${panel}`), "the stakes panel is gone");
    await shot(`${tag}-6-withdrawn`, `card(${JSON.stringify(name)})`);
  }

  try {
    /* ---------- 1. a fresh guest presses Play now ---------- */
    step = "1 play now";
    await go("/");
    const playNow = `[...document.querySelectorAll("a")].find((a) => visible(a) && /^Play now$/i.test(T(a)))`;
    check(await ev(`!!${playNow}`), "the landing page has a Play now link");
    await shot("01-landing");
    await click(playNow, "Play now");
    await waitFor(`location.pathname === "/play/patrol"`, "the first night (the quick start)", 60_000);
    await waitFor(`!!saved()?.hero`, "the quick-start hero", 20_000);
    notes.hero = await ev(`saved().hero.name`);
    check(true, "one tap makes a hero and opens the first night, with no account", notes.hero);

    /* ---------- 2. the night, on autopilot ---------- */
    step = "2 night";
    const t0 = Date.now();
    await go("/play/patrol?autopilot=1");
    let ended = null;
    while (Date.now() - t0 < NIGHT_MS && !ended) {
      ended = await ev(`/Unranked score/i.test(pageText()) ? pageText().slice(0, 4000) : null`).catch(() => null);
      if (!ended) await sleep(1500);
    }
    if (!ended) throw new Error("the guest night never reached its results");
    notes.night = { seconds: Math.round((Date.now() - t0) / 1000) };
    check(true, "the autopilot night ends on its results", `${notes.night.seconds} s`);
    await sleep(1500);

    /* ---------- 3. the results offer the practice market ---------- */
    step = "3 results prompt";
    const offer = await waitFor(`(() => { const t = pageText(); return /As a guest you can trade in the practice market now: same rules, practice Bits, not on NEAR\\./.test(t); })()`, "the results' practice-market line", 30_000).catch(() => null);
    check(!!offer, "the results say a guest can trade in the practice market, not on NEAR");
    const link = `([...document.querySelectorAll('section[aria-label="Try it in the practice market"] a, section[aria-label="Try it in the practice market"] button')][0] ?? [...document.querySelectorAll("a")].find((a) => /^Try the practice market$/.test(T(a))))`;
    await waitFor(`!!${link}`, "the results' way into the practice market", 30_000);
    notes.resultsLink = await ev(`T(${link})`);
    await layout("results", { "the way into the practice market": link });
    await shot("02-results-practice-prompt", link);
    await click(link, "the practice market link");
    await waitFor(`location.pathname === "/play/market"`, "the market", 40_000);
    await waitFor(`!!section(/^Practice market$/) && !!card("Crumbs")`, "the practice market", 40_000);
    // A night that suggests a trade links straight to it: the sheet opens prefilled, in practice. Make that trade.
    const prefilled = /item=/.test((await ev(`location.search`)) ?? "") || (await waitFor(`!!sheet()`, "a prefilled sheet", 4_000).catch(() => false));
    if (prefilled) {
      await waitFor(`!!sheet() && !!sheetButton(/^(Buy|Sell) [\\d,]+ for/)`, "the prefilled trade sheet", 15_000);
      await sleep(400);
      notes.prefilled = await ev(`T(sheet()).slice(0, 60) + " … " + T(sheetButton(/^(Buy|Sell) [\\d,]+ for/))`);
      check(/Practice market · not on NEAR/i.test(notes.prefilled), "the night's suggested trade opens prefilled, labelled practice", notes.prefilled);
      await shot("02b-prefilled-practice-sheet");
      await click(`sheetButton(/^(Buy|Sell) [\\d,]+ for/)`, "the prefilled trade");
      await waitFor(`!sheet()`, "the prefilled trade to land", 20_000);
      check(!!(await toast(`/^Practice: (Bought|Sold)\\./`)), "the suggested trade is made in the practice market");
      await sleep(400);
    }

    /* ---------- 4. the practice market: labelled, and it trades ---------- */
    step = "4 practice trade";
    await waitFor(`!!section(/^Practice market$/) && !!card("Crumbs")`, "the practice market", 40_000);
    const banner = await ev(`T(section(/^Practice market$/))`);
    check(banner.includes(LABEL), "the banner says it, word for word", banner.slice(0, 80));
    check(/Your practice Bits/.test(await ev(`pageText()`)), "the wallet is labelled practice Bits");
    const stall = await ev(`(() => { const v = document.querySelector('section[aria-labelledby="vendor-name"]'); return { text: T(v), buttons: [...v.querySelectorAll("button")].map(T) }; })()`);
    check(/Buy, sell and invest below with practice Bits\. Nothing here is on NEAR\./.test(stall.text) && stall.buttons.includes("Sign in to trade for real") && !stall.buttons.includes("Sign in to trade"), "the vendor panel leads with practice trading; signing in is the second offer", stall.buttons);
    const lines = await ev(`[...document.querySelectorAll("li")].filter((li) => li.querySelector("h3")).map((li) => { const g = li.querySelector('[role=img]'); return { quiet: /No trades in 24 h|No price history yet/.test(g?.textContent ?? ""), path: g?.querySelector("path:last-of-type")?.getAttribute("d") ?? null }; })`);
    check(lines.length === 8 && lines.every((l) => l.quiet || (l.path && !/[LCQ]/.test(l.path))) && lines.some((l) => l.path), "practice cards draw real step lines (the live market's last day), or say nothing traded", `${lines.filter((l) => l.path).length} drawn, ${lines.filter((l) => l.quiet).length} quiet`);
    check(await ev(`!/Simulated until the contract/.test(pageText()) && !/On NEAR (mainnet|testnet)/.test(pageText())`), "nothing on the page claims to be the real market");
    const seeded = await ev(`practice() && { from: practice().seededFrom, pools: practice().book.pools.length, lock: practice().book.params.invest.lockMs }`);
    notes.practice = seeded;
    check(seeded?.pools === 8 && seeded.lock === 30000, "it is seeded from the live market's pools, with the practice lock", seeded);
    await layout("practice market", { "the practice banner": `section(/^Practice market$/)`, "an item's card": `card("Crumbs")`, "its Invest button": `cardButton("Crumbs", /^Invest in Gwei/)` });
    await shot("03-practice-market");
    const saveBefore = await ev(`JSON.stringify(saved())`);
    const marketPostsBefore = requests.filter((r) => r.method === "POST" && /\/api\/(market|relay|actions|migrate)/.test(r.url)).length;

    const bits0 = await practiceBits();
    await click(`cardButton("Fee bomb", /^Buy/)`, "Buy on Fee bomb");
    await waitFor(`sheet() && /Buy Fee bomb/.test(T(sheet()))`, "the buy sheet");
    await sleep(400);
    const buySheet = await ev(`T(sheet())`);
    check(/Practice market · not on NEAR/i.test(buySheet) && !/Sign in to trade/.test(buySheet), "the buy sheet is labelled practice and doesn’t ask for sign-in", buySheet.slice(0, 60));
    check(/Gas fee \(2%\)/.test(buySheet) && /Burned\. Nobody gets it\./.test(buySheet) && /At most/.test(buySheet), "it shows the burned gas fee and the slippage limit");
    await shot("04-practice-buy-sheet");
    const buyLabel = await ev(`T(sheetButton(/^Buy [\\d,]+ for/))`);
    await click(`sheetButton(/^Buy [\\d,]+ for/)`, "confirm the buy");
    await waitFor(`!sheet()`, "the buy to land", 20_000);
    check(!!(await toast(`/^Practice: Bought\\./`)), "a toast says “Practice: Bought.”");
    const bits1 = await practiceBits();
    notes.buy = { label: buyLabel, before: bits0, after: bits1 };
    check(bits0 - bits1 === num(/for ([\d,]+) Bits?/.exec(buyLabel)?.[1]), "the practice wallet paid exactly the quote on the button", notes.buy);
    const sellLabel = await trade("Fee bomb", "Sell", 1);
    check(!!(await toast(`/^Practice: Sold\\./`)), "a toast says “Practice: Sold.”");
    const bits2 = await practiceBits();
    notes.sell = { label: sellLabel, after: bits2 };
    check(bits2 - bits1 === num(/for ([\d,]+) Bits?/.exec(sellLabel)?.[1]) && bits2 < bits0, "selling it back pays the quote, and the round trip costs Bits (the fee is burned)", notes.sell);
    check((await ev(`practice().book.burned`)) > 0, "the practice book has burned the fees", await ev(`practice().book.burned`));

    /* ---------- 5. why this price ---------- */
    step = "5 why this price";
    await click(`cardButton("Fee bomb", /Why this price/)`, "Why this price?");
    const reasoning = await waitFor(`(() => { const t = card("Fee bomb")?.querySelector('[role="tooltip"]'); return t && getComputedStyle(t).visibility === "visible" && T(t); })()`, "Gwei's reasoning", 8_000).catch(() => null);
    check(/Gwei says/i.test(reasoning ?? "") && /My till for these holds/.test(reasoning ?? ""), "Gwei explains the price from her stock and till", reasoning?.slice(0, 160));
    await layout("why this price", { "her reasoning": `card("Fee bomb")?.querySelector('[role="tooltip"]')` });
    await shot("05-why-this-price", `card("Fee bomb")`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);

    /* ---------- 6. drive Gwei broke on one item ---------- */
    step = "6 go broke";
    let brokeItem;
    if (vp.drainBy === "selling") {
      // A guest with a big bag: 100 Crumbs in the saved game, as many nights would leave.
      await ev(`(() => { const s = saved(); s.inventory = { ...s.inventory, crumbs: 100 }; localStorage.setItem("wgp:save:v1", JSON.stringify(s)); return true; })()`);
      await go("/play/market");
      await waitFor(`!!card("Crumbs") && /You have 100/.test(T(card("Crumbs")))`, "the 100 Crumbs in the practice wallet", 30_000);
      brokeItem = "Crumbs";
      let sold = 0;
      for (let i = 0; i < 12; i++) {
        const pool = await ev(`practice().book.pools.find((p) => p.item === "crumbs")`);
        const n = mostSellable(pool);
        if (n === 0) break;
        await trade("Crumbs", "Sell", n);
        sold += n;
        await sleep(400);
      }
      notes.drain = { by: "selling through the sheet", sold, till: await ev(`practice().book.pools.find((p) => p.item === "crumbs").bits`) };
      // How many it takes depends on the till the practice market opened with (the live market's at that moment).
      check(sold >= 1 && notes.drain.till < 5, "selling Crumbs into her empties her till for them", notes.drain);
    } else {
      const button = `[...section(/^Practice market$/).querySelectorAll("button")].find((b) => /^Empty Gwei’s .+ till$/.test(T(b)))`;
      const label = await ev(`T(${button})`);
      brokeItem = /^Empty Gwei’s (.+) till$/.exec(label)?.[1];
      await click(button, label);
      const said = await toast(`/^Practice: a crowd sold Gwei [\\d,]+ /`);
      notes.drain = { by: label, toast: said };
      check(!!said && !!brokeItem, "a crowd of practice sellers empties one till", said);
    }
    const saveMid = await ev(`JSON.stringify(saved())`);

    /* ---------- 7–10. closed → invest → reopened → fee share → withdraw, in practice ---------- */
    const practiceItem = async () => ev(`practice().book.pools.find((p) => ${JSON.stringify(brokeItem)} === ({ crumbs: "Crumbs", "fee-bomb": "Fee bomb", "chain-link": "Chain link", "sybil-goo": "Sybil goo", "sesame-seed": "Sesame seed", "press-pass": "Press pass", "goblin-glider": "Goblin glider", "spare-arm": "Spare arm" })[p.item])?.item`);
    const itemId = await practiceItem();
    notes.brokeItem = { name: brokeItem, id: itemId };
    await investFlow("practice", brokeItem, {
      amount: 100,
      lockMs: 30_000,
      toastPrefix: "^Practice: ",
      bitsOf: practiceBits,
      stakeOf: async () => {
        const s = await ev(`(() => { const p = practice(); const st = p.book.investors?.["you.practice"]?.stakes.find((s) => s.item === ${JSON.stringify(itemId)}); return st ? { bits: st.bits, debt: st.debt } : null; })()`);
        if (!s) return null;
        const earned = num((await ev(`T(section(/Your stakes in Gwei/))`))?.match(/([\d,]+) earned from fees/)?.[1] ?? "0");
        return { bits: s.bits, earned };
      },
    });

    step = "practice stays practice";
    const npc = await ev(`T(section(/Other traders/))`);
    check(/Sandwich Man/.test(npc ?? "") && /\bNPC\b/.test(npc ?? "") && /\bPractice\b/.test(npc ?? ""), "Sandwich Man is on the practice market, labelled NPC and Practice", npc?.slice(0, 200));
    await layout("practice NPC", { "the Other traders strip": `section(/Other traders/)` });
    await shot("practice-7-sandwich-man", `section(/Other traders/)`);
    const quest = await ev(`T(section(/market quest/i))`);
    check(/Practice trades earn no XP\. Sign in, and one real trade a day does it\./.test(quest ?? ""), "the quest strip says practice trades earn no XP", quest);
    const saveAfter = await ev(`JSON.stringify(saved())`);
    check(saveAfter === saveMid && (vp.drainBy === "selling" || saveAfter === saveBefore), "no practice trade, stake or withdrawal changed the saved game", { bytes: saveAfter.length });
    const marketPosts = requests.filter((r) => r.method === "POST" && /\/api\/(market|relay|actions|migrate)/.test(r.url)).length - marketPostsBefore;
    check(marketPosts === 0, "the practice market never posted a trade, a stake or a save to the server", marketPosts);

    /* ---------- 11. signed in: the server's simulated market ---------- */
    step = "11 sign in";
    const signIn = await post("/api/auth/dev", { handle: vp.handle });
    check(signIn.status === 201 || signIn.status === 200, `dev sign-in as ${vp.handle}`, signIn.status);
    await go("/play/market");
    await waitFor(`!!card("Crumbs")`, "the market, signed in", 40_000);
    if (await ev(`!!byText("aside button", "Skip the tour")`)) await click(`byText("aside button", "Skip the tour")`);
    const live = (await get("/api/market")).body;
    notes.server = { onChain: live.onChain, invest: live.params.invest, contract: live.contract };
    check(live.onChain === false && live.params.invest?.open === true && live.params.invest.lockMs === 5000, "the simulated market takes investors on contract v3’s rules (a 5 s lock for this run)", notes.server);
    check(await ev(`!section(/^Practice market$/) && /Simulated until the contract/.test(pageText())`), "signed in, the screen shows the simulated market, not practice");
    const me = async () => (await get("/api/market/me")).body;
    const m0 = await me();
    check(m0.items.crumbs >= 150 && m0.bits >= 300, "the dev player has Bits and a bag of Crumbs, by the server’s count", { bits: m0.bits, crumbs: m0.items.crumbs });
    // Sell her Crumbs till dry through the sheet.
    let sold = 0;
    for (let i = 0; i < 14; i++) {
      const pool = (await get("/api/market")).body.items.find((x) => x.item === "crumbs").pool;
      const n = Math.min(mostSellable(pool), (await me()).items.crumbs ?? 0);
      if (n === 0) break;
      await trade("Crumbs", "Sell", n);
      sold += n;
      await sleep(500);
    }
    const shop = (await get("/api/market")).body.shops.find((s) => s.item === "crumbs");
    notes.serverDrain = { sold, shop };
    check(shop.closed.includes("broke") && shop.buying === false, "the server says her Crumbs shop is closed: broke", notes.serverDrain);
    await go("/play/market");
    await waitFor(`!!card("Crumbs")`, "the market again", 40_000);
    await investFlow("server", "Crumbs", {
      amount: 100,
      lockMs: 5_000,
      toastPrefix: "^",
      bitsOf: async () => (await me()).bits,
      stakeOf: async () => {
        const s = (await me()).investor.stakes.find((x) => x.item === "crumbs");
        return s ? { bits: s.bits, earned: s.earned } : null;
      },
    });
    step = "11 server books";
    const rows = (await get("/api/market")).body.shops.find((s) => s.item === "crumbs");
    check(rows.invested === 0 && rows.closed.length === 0, "after the withdrawal the server’s books show no stake left and the shop open", rows);
    // A signed-in player can step into practice and back.
    await click(`[...document.querySelectorAll("button")].find((b) => /^Open the practice market$/.test(T(b)))`, "Open the practice market");
    await waitFor(`!!section(/^Practice market$/)`, "the practice banner, signed in", 15_000);
    check((await ev(`T(section(/^Practice market$/))`)).includes(LABEL), "a signed-in player can open the practice market, labelled the same");
    await shot("server-7-practice-toggle");
    await click(`[...section(/^Practice market$/).querySelectorAll("button")].find((b) => /^Go back to the real market$/.test(T(b)))`, "Go back to the real market");
    await waitFor(`!section(/^Practice market$/)`, "the real market again", 15_000);

    /* ---------- 12. the lab's showcase ---------- */
    step = "12 lab showcase";
    await go("/lab/economy");
    await waitFor(`[...document.querySelectorAll("button")].find((b) => /^Drain Gwei, then invest in her$/.test(T(b)))`, "the showcase button", 60_000);
    check(await ev(`!!([...document.querySelectorAll("button")].find((b) => T(b) === "Drain Gwei"))`), "it sits next to Drain Gwei");
    await click(`[...document.querySelectorAll("button")].find((b) => /^Drain Gwei, then invest in her$/.test(T(b)))`, "Drain Gwei, then invest in her");
    await click(`[...document.querySelectorAll("button")].find((b) => T(b) === "Instant")`, "Instant");
    await click(`[...document.querySelectorAll("button")].find((b) => /^Run 30 days$/.test(T(b)))`, "Run 30 days");
    await waitFor(`/30 \\/ 30/.test(pageText())`, "the run to finish", 60_000);
    await sleep(600);
    const lab = await ev(`(() => { const p = [...document.querySelectorAll("section")].find((s) => /Gwei goes broke, an investor reopens her/.test(T(s.querySelector("h2")))); const stat = (label) => { const d = [...(p?.querySelectorAll("dt") ?? [])].find((x) => T(x) === label); return d ? T(d.nextElementSibling) : null; }; return { panel: !!p, closedMarks: document.querySelectorAll("[data-closed-day]").length, fundedMarks: document.querySelectorAll("[data-funded-day]").length, closedDays: stat("Shop-days closed"), reopened: stat("Reopened by investors"), invested: stat("Invested"), earned: stat("Earned from fees"), staked: stat("Still in her tills") }; })()`);
    notes.lab = lab;
    check(lab.panel && lab.closedMarks > 0 && lab.fundedMarks > 0, "the charts mark the days a shop ended closed and the days an investor funded it", lab);
    check(num(lab.closedDays) === 11 && num(lab.reopened) === 11 && num(lab.invested) === 1195 && num(lab.earned) === 133 && num(lab.staked) === 1130, "the panel counts what docs/INVESTING.md quotes for seed 2026", lab);
    await layout("lab", { "the investors' panel": `[...document.querySelectorAll("section")].find((s) => /Gwei goes broke, an investor reopens her/.test(T(s.querySelector("h2"))))`, "a chart's shop row": `document.querySelector("[data-shop-row]")` });
    await shot("12-lab-invest-showcase", `[...document.querySelectorAll("section")].find((s) => /Gwei goes broke, an investor reopens her/.test(T(s.querySelector("h2"))))`);
    await shot("12-lab-charts", `document.querySelector("[data-closed-day]")?.closest("li")`);
  } catch (error) {
    failures.push(`[${vp.id} · ${step}] driver: ${error.message}`);
    steps[step] = false;
    console.error(error);
    await shot("zz-failure").catch(() => {});
  }

  step = "console";
  const errors = logs.filter((l) => /^(error|exception)/i.test(l));
  console.log(`\n[${vp.id}] console: ${logs.length} messages, ${errors.length} errors`);
  for (const e of errors) console.log(`  ${e.slice(0, 400)}`);
  check(errors.length === 0, "no console errors");
  const failed = responses.filter((r) => r.status >= 500);
  check(failed.length === 0, "no 5xx responses", failed.slice(0, 5));
  allErrors.push(...errors.map((e) => `${vp.id}: ${e}`));
  report[vp.id] = { viewport: `${vp.width}×${vp.height}${vp.mobile ? " touch" : ""}`, steps, notes };
  await chrome.close();
}

for (const vp of PASSES) await pass(vp);

console.log(`\nsteps ${JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.steps])), null, 2)}`);
writeFileSync(join(OUT, "run.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), report, failures, consoleErrors: allErrors }, null, 2));
if (failures.length) {
  console.error(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall checks passed");
