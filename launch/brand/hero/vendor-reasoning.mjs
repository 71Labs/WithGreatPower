/**
 * Gwei's "Why this price?" reasoning, checked in a real headless Chrome against a local
 * server (`ALLOW_DEV_AUTH=1 PGLITE_DIR=… next dev -p 4110 -H 127.0.0.1`, simulated market):
 *
 *   node launch/brand/hero/vendor-reasoning.mjs [--base http://127.0.0.1:4110] [--port 9511]
 *        [--out <dir>] [--handle gap-hero]
 *
 * The dev player needs Bits to buy with (about 2,500 for the sold-out run). It signs in,
 * buys one Goblin glider through the trade sheet, buys the rest so Gwei sells out, then
 * checks the popover by mouse, keyboard and touch, the chips and the disabled buttons'
 * printed reasons, and the economy lab's reasoning after an instant 21-day run.
 * Shots land in <out>; the checks and the console are printed, and it exits 1 on a failure.
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
const BASE = opt("base", "http://127.0.0.1:4110");
const PORT = Number(opt("port", "9511"));
const OUT = resolve(opt("out", join(HERE, "game-shots/vendor-reasoning")));
const HANDLE = opt("handle", "gap-hero");
mkdirSync(OUT, { recursive: true });

const chrome = await launch({ port: PORT });
const { send, evaluate, logs } = chrome;
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

await send("Page.enable");
await send("Runtime.enable");

async function viewport(width, height, mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
}
async function go(path) {
  await send("Page.navigate", { url: BASE + path });
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    if (await evaluate(`document.readyState === "complete" && !!document.querySelector("h1")`).catch(() => false)) break;
  }
  await sleep(800);
}
async function waitFor(expr, what, ms = 30_000) {
  for (let t = 0; t < ms; t += 200) {
    if (await evaluate(`!!(${expr})`).catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
async function shot(name, { full = false } = {}) {
  let clip;
  if (full) {
    const { cssContentSize: s } = await send("Page.getLayoutMetrics");
    clip = { x: 0, y: 0, width: s.width, height: s.height, scale: 1 };
  }
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, clip });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`shot ${name}.png`);
}
/** The centre of an element found by `expr`, scrolled into view first. */
async function centre(expr) {
  return evaluate(`(() => { const el = ${expr}; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
}
const card = (name) => `[...document.querySelectorAll("li")].find((li) => li.querySelector("h3")?.textContent === ${JSON.stringify(name)})`;
const whyButton = (name) => `[...${card(name)}.querySelectorAll("button")].find((b) => b.textContent.startsWith("Why this price?"))`;
const cardButton = (name, label) => `[...${card(name)}.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))`;
const tooltip = `document.querySelector('[role="tooltip"]')`;
const tooltipText = () => evaluate(`${tooltip}?.innerText ?? null`);
async function mouse(type, { x, y }, more = {}) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, ...more });
}
async function click(expr) {
  const p = await centre(expr);
  await mouse("mouseMoved", p);
  await mouse("mousePressed", p);
  await mouse("mouseReleased", p);
  await sleep(250);
}
async function key(k, code = k) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: k === "Escape" ? 27 : k === "Tab" ? 9 : 13, ...(k === "Enter" ? { text: "\r" } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code });
  await sleep(250);
}
const api = (path, body) =>
  evaluate(`fetch(${JSON.stringify(path)}, { method: "POST", headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);

try {
  /* ---------- sign in ---------- */
  await viewport(1440, 900);
  await go("/play/market");
  const signIn = await api("/api/auth/dev", { handle: HANDLE });
  check(signIn.status === 201, `dev sign-in as ${HANDLE}`);
  await go("/play/market");
  await waitFor(card("Goblin glider"), "the stall");

  /* ---------- at opening: the popover, by mouse ---------- */
  check((await evaluate(`${tooltip} === null`)) === true, "no popover until asked");
  await mouse("mouseMoved", await centre(whyButton("Crumbs")));
  await sleep(300);
  check(/Opening price: 12\.0 Bits/.test((await tooltipText()) ?? ""), "hover opens it: the opening price");
  check((await evaluate(`${whyButton("Crumbs")}.getAttribute("aria-expanded")`)) === "true", "aria-expanded is true while open");
  check((await evaluate(`${whyButton("Crumbs")}.getAttribute("aria-describedby") === ${tooltip}.id`)) === true, "the button is described by the popover");
  await key("Escape");
  check((await tooltipText()) === null, "Escape closes a hover-opened popover");
  await mouse("mouseMoved", { x: 5, y: 5 });

  /* ---------- buy one rare through the sheet ---------- */
  await click(cardButton("Goblin glider", "Buy"));
  await waitFor(`!!document.querySelector("dialog[open]")`, "the trade sheet");
  await sleep(500);
  check(/Opening price: 150 Bits/.test(await evaluate(`document.querySelector("dialog[open]").innerText`)), "the trade sheet shows Gwei's headline");
  await shot("03-sheet-opening-1440");
  await click(`[...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.startsWith("Buy 1 for"))`);
  await waitFor(`!document.querySelector("dialog[open]")`, "the buy to land");
  await waitFor(`/Stock 7/.test(${card("Goblin glider")}.innerText)`, "stock 7");

  /* ---------- low stock: the popover, pinned by a click ---------- */
  await click(whyButton("Goblin glider"));
  const low = (await tooltipText()) ?? "";
  console.log(low);
  check(/Running low: 7 left of 8, so I’m asking 14% more than when I opened\./.test(low), "low stock: 7 left of 8, 14% more");
  check(/1 trade with me in the last 24 hours/.test(low), "it counts the one real trade");
  await mouse("mouseMoved", { x: 5, y: 5 });
  await sleep(250);
  check((await tooltipText()) !== null, "a clicked popover stays when the mouse leaves");
  await sleep(5000); // the "Bought" toast clears
  await evaluate(`window.scrollTo(0, 330)`);
  await sleep(300);
  await shot("01-market-low-stock-popover-1440");
  await click(whyButton("Goblin glider"));
  check((await tooltipText()) === null, "a second click closes it");

  /* ---------- keyboard ---------- */
  await evaluate(`(() => { const all = [...document.querySelectorAll("button, a[href], input")]; const i = all.indexOf(${whyButton("Goblin glider")}); all[i - 1].focus(); })()`);
  await key("Tab");
  check((await evaluate(`document.activeElement === ${whyButton("Goblin glider")}`)) === true, "Tab reaches the button");
  check(/Running low/.test((await tooltipText()) ?? ""), "keyboard focus opens it");
  check((await evaluate(`getComputedStyle(document.activeElement).outlineStyle !== "none"`)) === true, "the focused button has a visible outline");
  await key("Escape");
  check((await tooltipText()) === null, "Escape closes it");
  await key("Enter");
  check(/Running low/.test((await tooltipText()) ?? ""), "Enter opens it again");
  await key("Tab");
  check((await tooltipText()) === null, "tabbing away closes it");

  /* ---------- sold out ---------- */
  const rest = await api("/api/market/trade", { action: "buy", item: "goblin-glider", amount: 7, maxBits: 1_000_000 });
  check(rest.status === 200, `bought the last 7 (${rest.status}${rest.body?.message ? `: ${rest.body.message}` : ""})`);
  await go("/play/market");
  await waitFor(card("Goblin glider"), "the stall");
  const sold = await evaluate(`${card("Goblin glider")}.innerText`);
  check(/Sold out/.test(sold), "a Sold out chip");
  check((await evaluate(`!!${card("Goblin glider")}.querySelector("p span svg")`)) === true, "the chip has an icon");
  check((await evaluate(`${cardButton("Goblin glider", "Buy")}.disabled`)) === true, "Buy is disabled");
  check(/Gwei has none left to sell\. Sell her one and she’s back in stock\./.test(sold), "and says why in visible text");
  check((await evaluate(`document.getElementById(${cardButton("Goblin glider", "Buy")}.getAttribute("aria-describedby"))?.textContent`))?.startsWith("Gwei has none left"), "Buy is described by that text");
  await click(whyButton("Goblin glider"));
  const out = (await tooltipText()) ?? "";
  console.log(out);
  check(/Sold out\. I can’t sell what I don’t hold\./.test(out) && /I opened with 8 and have none left/.test(out), "the sold-out reasoning");
  await evaluate(`window.scrollTo(0, 330)`);
  await sleep(300);
  await shot("02-market-sold-out-popover-1440");
  await key("Escape");
  await click(cardButton("Goblin glider", "Sell"));
  await waitFor(`!!document.querySelector("dialog[open]")`, "the trade sheet");
  await click(`[...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === "Buy from Gwei")`);
  await sleep(400);
  const sheet = await evaluate(`document.querySelector("dialog[open]").innerText`);
  check(/Sold out\. I can’t sell what I don’t hold\./.test(sheet) && /Gwei has none left to sell/.test(sheet), "the sheet's buy side explains the sold-out state");
  check((await evaluate(`[...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.startsWith("Buy 1")).disabled`)) === true, "and its Buy button is off");
  await shot("04-sheet-sold-out-1440");
  await key("Escape");
  await sleep(400);

  /* ---------- a phone: tap ---------- */
  await viewport(375, 812, true);
  await go("/play/market");
  await waitFor(card("Goblin glider"), "the stall");
  const tap = async (expr) => {
    const p = await centre(expr);
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(350);
  };
  await tap(whyButton("Goblin glider"));
  check(/Sold out/.test((await tooltipText()) ?? ""), "a tap opens it on a phone");
  const fit = await evaluate(`(() => { const r = ${tooltip}.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`);
  check(fit === true, "the popover fits a 375px screen, with no sideways scroll");
  check((await evaluate(`${whyButton("Goblin glider")}.getBoundingClientRect().height >= 44`)) === true, "the button is 44px tall for touch");
  await shot("05-market-sold-out-popover-375");
  await tap(`document.querySelector("h1")`);
  check((await tooltipText()) === null, "a tap elsewhere closes it");
  await tap(whyButton("Fee bomb"));
  const fitLeft = await evaluate(`(() => { const r = ${tooltip}.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`);
  check(fitLeft === true, "the left column's popover fits too");
  await shot("06-market-opening-popover-375");
  await tap(whyButton("Fee bomb"));
  check((await tooltipText()) === null, "a second tap closes it");
  await evaluate(`(() => { ${card("Goblin glider")}.scrollIntoView({ block: "start" }); scrollBy(0, -90); })()`);
  await sleep(400);
  await shot("07-market-sold-out-375");

  /* ---------- the economy lab ---------- */
  const lab = async (width, height, mobile, name) => {
    await viewport(width, height, mobile);
    await go("/lab/economy");
    await waitFor(`[...document.querySelectorAll("li h3")].length === 8`, "the lab");
    const day0 = await evaluate(`[...document.querySelectorAll("main li:has(h3)")].map((li) => li.innerText).join("\\n")`);
    if (!mobile) check((day0.match(/Opening price/g) ?? []).length === 8, "day 0: every item at its opening price");
    await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Instant").click()`);
    await sleep(200);
    await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Run 21 days")).click()`);
    await waitFor(`/21 \\/ 21/.test(document.querySelector("dl").innerText)`, "day 21");
    await sleep(500);
    const day21 = await evaluate(`[...document.querySelectorAll("main li:has(h3)")].map((li) => li.innerText).join("\\n---\\n")`);
    if (!mobile) {
      console.log(day21);
      check((day21.match(/Gwei says/gi) ?? []).length === 8, "day 21: reasoning on all eight items");
      check(!/Opening price/.test(day21) || day21 !== day0, "the reasoning changed over the run");
      check(/in the last 24 hours/.test(day21), "it reads the day's price change");
    }
    await evaluate(`window.scrollTo(0, 0)`);
    await shot(name, { full: true });
  };
  await lab(1440, 900, false, "08-lab-day-21-1440");
  await lab(375, 812, true, "09-lab-day-21-375");
} catch (error) {
  failures.push(String(error?.stack ?? error));
  console.log(await evaluate(`location.href + "\\n" + document.body.innerText.slice(0, 600)`).catch(() => ""));
  await shot("zz-failure").catch(() => {});
  console.error(error);
}

// React's dev-only hints and HMR chatter aren't the app's errors.
const noise = /Download the React DevTools|\[HMR\]|\[Fast Refresh\]/;
const bad = logs.filter((l) => /^(error|exception|warning)/.test(l) && !noise.test(l));
console.log(`console: ${logs.length} lines, ${bad.length} errors or warnings`);
for (const l of bad) console.log(`  ${l}`);
if (bad.length) failures.push(`${bad.length} console errors or warnings`);
await chrome.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
