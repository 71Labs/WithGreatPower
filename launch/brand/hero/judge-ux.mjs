/**
 * The cold judge's defects (Nov 12), checked in a real headless Chrome against a local
 * server, with a screenshot of each:
 *
 *   ALLOW_DEV_AUTH=1 PGLITE_DIR=… next dev -p 4620 -H 127.0.0.1      (simulated market)
 *   node launch/brand/hero/judge-ux.mjs [--base http://127.0.0.1:4620] [--port 9921]
 *        [--out <dir>] [--label after]
 *
 * Seed the database first with a slow day and a two-hero board, as the judge saw them:
 *   SEED_QUIET=1 PGLITE_DIR=… pnpm --filter wgp exec tsx src/server/market/seed-dev.ts
 *   SEED_PLAYERS=2 PGLITE_DIR=… pnpm --filter wgp exec tsx src/server/db/seed-dev.ts
 *
 * It plays the judge's guest (Captain Finality, level 2, 93/160 XP, a power to pick) and
 * checks: Gwei's words against her numbers on every card, plurals, sparklines that differ
 * and say when nothing traded, both popovers clear of the dock, Sandwich Man's honest
 * "off" (the API answer is swapped for the one production gives while he has no account),
 * the lab heading's contrast, 44px targets and the hero chip on a phone, power cards in
 * seconds, the two name lines agreeing, a first visit to /play reaching the city, and the
 * short board's open place. Prints each check, writes <out>/<label>/*.png and report.json,
 * and exits 1 on a failure. Needs launch/lib/cdp.mjs; from a worktree without it,
 * WGP_LAUNCH=<a checkout's launch/>.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCH = process.env.WGP_LAUNCH ?? join(HERE, "..", "..");
const { launch, sleep } = await import(pathToFileURL(join(LAUNCH, "lib", "cdp.mjs")).href);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const BASE = opt("base", "http://127.0.0.1:4620");
const PORT = Number(opt("port", "9921"));
const LABEL = opt("label", "after");
const OUT = join(resolve(opt("out", join(HERE, "game-shots/judge-ux"))), LABEL);
mkdirSync(OUT, { recursive: true });

/** The judge's guest, as their screenshots show it. */
const SAVE = {
  version: 1,
  hero: {
    name: "Captain Finality",
    level: 2,
    xp: 93,
    maxHp: 106,
    responsibility: 14,
    powers: { "web-sling": { mastery: 3 }, "web-shield": { mastery: 1 }, "node-sense": { mastery: 1 } },
    loadout: ["web-sling", "web-shield", "node-sense"],
    suit: "classic",
    pendingPicks: 1,
    createdNight: 1,
  },
  night: 1,
  patrol: null,
  nightDone: true,
  inventory: { "sybil-goo": 1, crumbs: 3 },
  suits: ["classic"],
  album: {},
  editions: [],
  reputation: 14,
  stats: { villainsCaught: 2, errands: 2, knockouts: 0, perfectSwings: 3, nights: 1 },
};

/** What GET /api/market/npc answers in production while Sandwich Man has no account. */
const NPC_OFF = (rules, rulesUrl, seedBits) => ({
  id: "sandwich-man",
  name: "Sandwich Man",
  mode: "off",
  accountId: null,
  explorerUrl: null,
  status: "off",
  statusLine: "Practice only. His NEAR account isn’t funded yet, so he trades in the practice market and the economy lab’s simulation.",
  bits: null,
  items: [],
  listings: [],
  actionsLeft: 0,
  budgetLeft: 0,
  log: [],
  rules,
  rulesUrl,
  seedBits,
  now: new Date().toISOString(),
});

const chrome = await launch({ port: PORT, profile: `/private/tmp/claude-501/wgp-judge-ux-${PORT}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { send, evaluate, logs } = chrome;
const results = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  (${detail})` : ""}`);
  results.push({ ok: !!ok, what, detail });
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");

let saveScript = null;
async function useSave(save) {
  if (saveScript) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: saveScript });
  saveScript = null;
  if (save) {
    const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(JSON.stringify(save))}); } catch {}` });
    saveScript = r.identifier;
  }
}
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "nextjs-portal { display: none !important; }"; document.head.appendChild(st); });`,
});

const SIZES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  phone: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
  /** 375 wide with a mouse: what a narrowed desktop window (and the judge's tool) reports. */
  narrow: { width: 375, height: 812, deviceScaleFactor: 2, mobile: false },
};
async function viewport(name) {
  const v = SIZES[name];
  await send("Emulation.setDeviceMetricsOverride", v);
  await send("Emulation.setTouchEmulationEnabled", { enabled: v.mobile, maxTouchPoints: 5 });
}
async function waitFor(expr, what, ms = 40_000) {
  for (let t = 0; t < ms; t += 200) {
    if (await evaluate(`!!(${expr})`).catch(() => false)) return true;
    await sleep(200);
  }
  check(false, `timed out waiting for ${what}`);
  return false;
}
async function go(path, ready = `document.querySelector("h1")`) {
  await send("Page.navigate", { url: BASE + path });
  await sleep(600);
  await waitFor(`document.readyState === "complete" && (${ready})`, `${path} to load`);
  await sleep(900);
}
async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
}
const overflow = () => evaluate(`document.documentElement.scrollWidth - innerWidth`);
const clickText = (selector, text) =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.replace(/\\s+/g, " ").includes(${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);

try {
  /* ---------------------------------------------------------------- 10: a first visit */
  await viewport("phone");
  await useSave(null);
  await send("Page.navigate", { url: `${BASE}/play` });
  const t0 = Date.now();
  const reached = await waitFor(`location.pathname === "/play/patrol" && !!document.querySelector('canvas[data-engine^="three"]')`, "a first visit to /play to reach the city", 60_000);
  check(reached, "10 · a first visit to /play lands in the first night, with no form in the way", `${Date.now() - t0} ms in dev mode, ended on ${await evaluate("location.pathname")}`);
  check((await evaluate(`localStorage.getItem("wgp:quick-hero:v1")`)) === "1", "10 · the ready hero is marked as the quick start's, so Tonight offers “Make it yours”");
  await sleep(2500);
  await shot("10-first-visit-play-phone");
  // A deep link with no hero: the screen asked for, with the ready hero, not a redirect.
  await evaluate(`localStorage.clear()`);
  await go("/play/market", `document.querySelector("h1, h2")`);
  await waitFor(`[...document.querySelectorAll("h3")].length >= 8`, "the market's cards on a first visit");
  check((await evaluate("location.pathname")) === "/play/market", "10 · a first visit to a deep link (/play/market) stays there and shows the market");
  await evaluate(`localStorage.clear()`);
  await go("/play/suits", `document.querySelector("h1")`);
  await waitFor(`/Suit lab/.test(document.body.innerText) && !/Suiting up/.test(document.body.innerText)`, "the suit lab on a first visit");
  check((await evaluate("location.pathname")) === "/play/suits" && (await evaluate(`JSON.parse(localStorage.getItem("wgp:save:v1") || "{}").hero?.name`)) === "The Node", "10 · a first visit to a screen that needs a hero (/play/suits) gets the ready hero in place, no redirect", await evaluate("location.pathname"));

  /* ---------------------------------------------------------------- 9: names */
  await evaluate(`localStorage.clear()`);
  await go("/play/bitten");
  const intro = await evaluate(`document.body.innerText`);
  check(/You can name your hero once, from Tonight\./.test(intro) && !/rename your hero after/.test(intro), "9 · the intro says a skipped hero can be named once, from Tonight");
  await shot("09-bitten-intro-phone");
  await clickText("button", "Get bitten");
  await waitFor(`document.querySelector("input")`, "the name step");
  await sleep(500);
  const nameStep = await evaluate(`document.body.innerText`);
  check(/The name you choose here is final/.test(nameStep) && !/can’t change it later/.test(nameStep), "9 · the name step says the name chosen here is final");
  await shot("09-bitten-name-phone");

  /* ---------------------------------------------------------------- 7: the hero chip on a phone */
  await evaluate(`localStorage.clear()`);
  await useSave(SAVE);
  await go("/play");
  const chip = await evaluate(`(() => {
    const a = document.querySelector('a[href="/play/hero"]');
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    const spans = [...a.querySelectorAll("span")].filter((s) => s.children.length === 0 || s.classList.contains("num"));
    const level = a.querySelector(".num");
    const name = a.querySelector(".truncate");
    const badge = [...a.querySelectorAll("span")].find((s) => /^\\+\\d+$/.test(s.textContent.trim()) && !s.classList.contains("sr-only"));
    const bar = a.parentElement.parentElement;
    const others = [...bar.querySelectorAll("a, button")].filter((e) => e !== a && e.getBoundingClientRect().width > 0).map(r);
    return { chip: r(a), level: r(level), levelText: level.innerText.replace(/\\s+/g, " ").trim(), levelClipped: level.scrollWidth > level.clientWidth + 1, name: r(name), nameText: name.textContent, nameCut: name.scrollWidth > name.clientWidth + 1, title: a.getAttribute("title"), badge: badge ? r(badge) : null, others };
  })()`);
  const inside = (inner, outer) => inner.l >= outer.l - 0.5 && inner.r <= outer.r + 0.5;
  const overlaps = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  check(inside(chip.level, chip.chip) && !chip.levelClipped && /93\/160/.test(chip.levelText), "7 · the chip's level and XP are whole inside the chip at 375px", `“${chip.levelText}”`);
  check(!chip.badge || (!overlaps(chip.badge, chip.level) && !overlaps(chip.badge, chip.name)), "7 · the +1 badge sits clear of the name and the XP");
  check(chip.others.every((o) => !overlaps(o, chip.chip)), "7 · the chip doesn't run under the buttons beside it");
  check(!chip.nameCut || (chip.title ?? "").includes(chip.nameText), "7 · a shortened name keeps its full text on the chip", chip.nameCut ? `shortened; title “${chip.title}”` : "shown whole");
  check((await overflow()) <= 0, "7 · no sideways overflow on Tonight at 375px");
  await shot("07-hero-chip-phone");

  /* ---------------------------------------------------------------- 1, 2, 3: the market's cards */
  await viewport("desktop");
  await go("/play/market", `[...document.querySelectorAll("h3")].length >= 8`);
  const cards = await evaluate(`[...document.querySelectorAll("li")].filter((li) => li.querySelector("h3") && /Why this price/.test(li.textContent)).map((li) => {
    const text = li.innerText.replace(/\\s+/g, " ");
    const spark = li.querySelector('[role=img]');
    return { name: li.querySelector("h3").textContent, stock: Number(/Stock ([\\d,]+)/.exec(text)?.[1].replace(/,/g, "")), trades: /(\\d+ trades? in 24 h)/.exec(text)?.[1] ?? null, wallet: /You have [\\d,]+/.test(text), chips: [...li.querySelectorAll("p > span.rounded-full")].map((s) => s.textContent.trim()), path: spark?.querySelector("path:last-of-type")?.getAttribute("d") ?? null, quiet: /No trades in 24 h|No price history yet/.test(spark?.textContent ?? ""), label: spark?.getAttribute("aria-label") };
  })`);
  check(cards.length === 8, "the market shows its eight cards", cards.map((c) => `${c.name} ${c.stock}`).join(", "));
  // A guest's market is the practice market now, where a card shows their practice wallet ("You have N") in that line's place.
  check(cards.every((c) => (c.trades ? !/^1 trades/.test(c.trades) : c.wallet)) && !/\b1 trades\b/.test(await evaluate("document.body.innerText")), "2 · no card says “1 trades”", cards.map((c) => c.trades ?? (c.wallet ? "wallet line" : "nothing")).join(" | "));
  const drawn = cards.filter((c) => c.path);
  check(cards.some((c) => c.quiet) && cards.filter((c) => c.quiet).every((c) => !c.trades || /0 trades/.test(c.trades)), "3 · a card with no trades says “No trades in 24 h” instead of drawing a shape", `${cards.filter((c) => c.quiet).length} quiet`);
  check(drawn.length > 0 && drawn.every((c) => !/[LCQ]/.test(c.path) && /H/.test(c.path)), "3 · every drawn sparkline is a step line (horizontal and vertical moves only)", `${drawn.length} drawn`);
  check(new Set(drawn.map((c) => c.path)).size === drawn.length, "3 · no two sparklines are the same shape", drawn.map((c) => c.path).join("  "));
  // Each card's reasoning: open the popover and hold its words to the card's own stock.
  const OPENED = { "Fee bomb": 40, "Goblin glider": 8, Crumbs: 40, "Golden sesame seed": 20, "Chain link": 40, "Doc’s spare arm": 8, "Sybil goo": 20, "Press pass": 20 };
  let wordsOk = true;
  const said = [];
  for (const c of cards) {
    await evaluate(`(() => { const li = [...document.querySelectorAll("li")].find((li) => li.querySelector("h3")?.textContent === ${JSON.stringify(c.name)}); const b = [...li.querySelectorAll("button")].find((b) => /Why this price/.test(b.textContent)); b.scrollIntoView({ block: "center" }); b.click(); })()`);
    await sleep(250);
    const tip = await evaluate(`document.querySelector('[role=tooltip]')?.innerText.replace(/\\s+/g, " ") ?? ""`);
    const opened = OPENED[c.name];
    const low = c.stock * 2 <= opened;
    const nearly = c.stock * 5 <= opened;
    const ok = tip.includes(String(c.stock)) && /Running low:/.test(tip) === (low && !nearly && c.stock > 0) && /Nearly out:/.test(tip) === (nearly && c.stock > 0) && /Sell me one and I’ll pay \d/.test(tip) && !/\b1 trades\b/.test(tip);
    if (!ok) wordsOk = false;
    said.push(`${c.name} (${c.stock} of ${opened}): ${tip.slice(10, 150)}`);
    if (c.name === "Fee bomb") await shot("01-why-this-price-desktop");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  check(wordsOk, "1 · every card: “Running low” only at or under half her opening stock, “Nearly out” at a fifth, her count and what she pays always printed", said.join("\n      "));
  await evaluate("window.scrollTo(0, 0)");
  await sleep(300);
  await shot("03-market-sparklines-desktop");

  /* ---------------------------------------------------------------- 4: “How he trades” clear of the dock */
  const placed = async (label) => {
    await evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((b) => /How he trades/.test(b.textContent)); b.scrollIntoView({ block: "end" }); window.scrollBy(0, -40); })()`);
    await sleep(400);
    await clickText("button", "How he trades");
    await sleep(500);
    const p = await evaluate(`(() => {
      const pop = document.querySelector('[role=group][aria-label$="rules"]');
      const panel = pop.firstElementChild.getBoundingClientRect();
      const dock = document.querySelector("[data-wgp-dock]")?.getBoundingClientRect();
      const moves = [...document.querySelectorAll("h3")].find((h) => /His latest moves/.test(h.textContent))?.parentElement.getBoundingClientRect();
      const link = pop.querySelector("a").getBoundingClientRect();
      return { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right, dockTop: dock && dock.height > 0 ? dock.top : innerHeight, vw: innerWidth, movesTop: moves?.top ?? null, movesLeft: moves?.left ?? null, movesRight: moves?.right ?? null, movesBottom: moves?.bottom ?? null, linkBottom: link.bottom, scrolls: pop.firstElementChild.scrollHeight > pop.firstElementChild.clientHeight + 1 };
    })()`);
    check(p.bottom <= p.dockTop + 0.5 && p.top >= 0 && p.left >= 0 && p.right <= p.vw, `4 · “How he trades” is whole on screen and clear of the dock (${label})`, `popover ${Math.round(p.top)}–${Math.round(p.bottom)}, dock at ${Math.round(p.dockTop)}${p.scrolls ? ", scrolls inside" : ""}`);
    return p;
  };
  await placed("desktop, simulated market");
  await shot("04-how-he-trades-desktop");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await viewport("phone");
  await go("/play/market", `[...document.querySelectorAll("button")].some((b) => /How he trades/.test(b.textContent))`);
  await placed("phone");
  await shot("04-how-he-trades-phone");
  const whyHeights = await evaluate(`[...document.querySelectorAll("button")].filter((b) => /Why this price|How he trades/.test(b.textContent)).map((b) => Math.round(b.getBoundingClientRect().height))`);
  check(whyHeights.length >= 9 && whyHeights.every((h) => h >= 44), "7 · “Why this price?” and “How he trades” are 44px tall on a phone", whyHeights.join(", "));
  check((await overflow()) <= 0, "no sideways overflow on the market at 375px");
  await viewport("narrow");
  await go("/play/market", `[...document.querySelectorAll("button")].some((b) => /Why this price/.test(b.textContent))`);
  const narrowHeights = await evaluate(`[...document.querySelectorAll("button")].filter((b) => /Why this price|How he trades/.test(b.textContent)).map((b) => Math.round(b.getBoundingClientRect().height))`);
  check(narrowHeights.every((h) => h >= 44), "7 · and 44px at 375px wide without a touch screen (how the judge measured 32px)", narrowHeights.join(", "));

  /* ---------------------------------------------------------------- 5: Sandwich Man, off */
  const npc = await evaluate(`fetch("/api/market/npc").then((r) => r.json())`);
  const offBody = JSON.stringify(NPC_OFF(npc.rules, npc.rulesUrl, npc.seedBits));
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/market/npc*", requestStage: "Request" }] });
  const unhook = chrome.on("Fetch.requestPaused", (p) => {
    send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(offBody).toString("base64") }).catch(() => {});
  });
  // A guest's market is the practice market, where he does trade. His "off" notice is on the real market, which a signed-in player sees.
  const signedIn = await evaluate(`fetch("/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: "judge-off" }) }).then((r) => r.status)`);
  check(signedIn === 200 || signedIn === 201, "5 · signed in as a dev player to see the real market", signedIn);
  // The offer to bring the guest's hero along would sit over the strip: this run isn't about it.
  await evaluate(`fetch("/api/me").then((r) => r.json()).then((me) => localStorage.setItem("wgp:migrate-declined:" + me.player.id, "1"))`);
  await viewport("desktop");
  await go("/play/market", `[...document.querySelectorAll("h2")].some((h) => /Other traders/.test(h.textContent))`);
  await evaluate(`[...document.querySelectorAll("h2")].find((h) => /Other traders/.test(h.textContent)).scrollIntoView({ block: "center" })`);
  await sleep(500);
  const practiceHref = await evaluate(`[...document.querySelectorAll("section")].find((s) => /Other traders/.test(s.textContent))?.querySelector('a[href^="/play/market"]')?.getAttribute("href") ?? null`);
  check(practiceHref === "/play/market?practice=1", "5 · off: it also links to the practice market, where he does trade", practiceHref);
  const off = await evaluate(`(() => { const s = [...document.querySelectorAll("section")].find((s) => /Other traders/.test(s.textContent)); return { text: s.innerText.replace(/\\s+/g, " "), href: s.querySelector('a[href^="/lab/economy"]')?.getAttribute("href") ?? null }; })()`);
  check(/Practice only/.test(off.text) && /his NEAR account isn’t funded/.test(off.text) && off.href === "/lab/economy#lab-npc", "5 · off: “Practice only”, why, and a link to his run in the economy lab", off.text.slice(0, 220));
  check(!/own wallet|\bOff\b|His latest moves|Wallet/.test(off.text), "5 · off: no wallet claimed, no “Off” chip, no empty “latest moves”");
  await shot("05-sandwich-man-practice-only-desktop");
  await placed("desktop, practice only");
  await shot("05-how-he-trades-practice-only-desktop");
  await viewport("phone");
  await go("/play/market", `[...document.querySelectorAll("h2")].some((h) => /Other traders/.test(h.textContent))`);
  await evaluate(`[...document.querySelectorAll("h2")].find((h) => /Other traders/.test(h.textContent)).scrollIntoView({ block: "center" })`);
  await sleep(500);
  await shot("05-sandwich-man-practice-only-phone");
  check((await overflow()) <= 0, "5 · off: no sideways overflow at 375px");
  unhook();
  await send("Fetch.disable");
  // Back to a guest for the rest.
  await send("Network.clearBrowserCookies");
  await evaluate(`localStorage.removeItem("wgp:signed-in:v1")`);

  /* ---------------------------------------------------------------- 8: power cards */
  await viewport("desktop");
  await go("/play/hero");
  await clickText("[role=tab]", "Powers");
  await waitFor(`/Recharge/.test(document.body.innerText)`, "the power cards");
  const powers = await evaluate(`document.querySelector("[role=tabpanel]").innerText.replace(/\\s+/g, " ")`);
  check(/Recharge [\d.]+ s\b/.test(powers) && !/Cooldown|\bturns?\b/i.test(powers), "8 · power cards print a recharge in seconds and never mention turns", (powers.match(/Recharge [\d.]+ s/g) ?? []).join(", "));
  await shot("08-power-cards-desktop");
  await clickText("[role=tab]", "Loadout");
  await sleep(600);
  const loadout = await evaluate(`document.querySelector("[role=tabpanel]").innerText.replace(/\\s+/g, " ")`);
  check(/[\d.]+ s recharge/.test(loadout) && !/-turn cooldown|\bturns?\b/i.test(loadout), "8 · the loadout says “3.5 s recharge”, not “1-turn cooldown”", (loadout.match(/[\d.]+ s recharge/g) ?? []).join(", "));
  await shot("08-loadout-desktop");

  /* ---------------------------------------------------------------- 11: the short board */
  await viewport("phone");
  await go("/play/leaderboard", `document.querySelector("ol[aria-label='Heroes by rank'], [role=tabpanel] p")`);
  await waitFor(`/This place is open/.test(document.body.innerText)`, "the board's open place");
  const board = await evaluate(`(() => { const panel = document.querySelector("[role=tabpanel]"); return { rows: panel.querySelectorAll("ol > li").length, text: panel.innerText.replace(/\\s+/g, " "), timer: panel.querySelector("[role=timer]")?.textContent ?? null }; })()`);
  check(board.rows === 2 && /This place is open/.test(board.text) && /8 of tonight’s top 10 places are open/.test(board.text) && /^\d\d:\d\d:\d\d$/.test(board.timer ?? ""), "11 · a 2-hero board shows the open place, “8 of tonight’s top 10 places are open” and the reset countdown, and still exactly 2 rows", `${board.rows} rows; resets in ${board.timer}`);
  check(/Sign in to claim it/.test(board.text), "11 · a guest is offered the sign-in that claims it");
  check((await overflow()) <= 0, "11 · no sideways overflow at 375px");
  await shot("11-short-board-phone");
  await viewport("desktop");
  await go("/play/leaderboard", `/This place is open/.test(document.body.innerText)`);
  await shot("11-short-board-desktop");

  /* ---------------------------------------------------------------- 6: the lab */
  await go("/lab/economy");
  const head = await evaluate(`(() => { const h = document.getElementById("lab-npc"); if (!h) return null; h.scrollIntoView({ block: "center" }); const c = getComputedStyle(h).color; let p = h, bg = "rgba(0, 0, 0, 0)"; while (p && /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; } return { color: c, bg, text: h.innerText }; })()`);
  const rgb = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = (c) => {
    const [r, g, b] = rgb(c).map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = head ? (Math.max(lum(head.color), lum(head.bg)) + 0.05) / (Math.min(lum(head.color), lum(head.bg)) + 0.05) : 0;
  check(ratio >= 4.5, "6 · the lab's “Sandwich Man” heading reads on its paper", head ? `${head.color} on ${head.bg}: ${ratio.toFixed(2)}:1` : "heading not found");
  const labText = await evaluate(`document.body.innerText`);
  check(!/his own wallet/.test(labText) && /his own simulated Bits/.test(labText), "5 · the lab says his Bits are simulated, not a wallet");
  await sleep(400);
  await shot("06-lab-sandwich-man-heading-desktop");
  await viewport("narrow");
  await go("/lab/economy");
  const speeds = await evaluate(`[...document.querySelectorAll("[role=group] button[aria-pressed]")].map((b) => Math.round(b.getBoundingClientRect().height))`);
  check(speeds.length >= 3 && speeds.every((h) => h >= 44), "7 · the lab's speed buttons are 44px tall at 375px", speeds.join(", "));
  check((await overflow()) <= 0, "no sideways overflow on the lab at 375px");
  await shot("07-lab-speed-buttons-phone");

  const errors = logs.filter((l) => /^(error|exception)/.test(l) && !/favicon|Download the React DevTools|\[Fast Refresh\]/.test(l));
  check(errors.length === 0, "no console errors", errors.slice(0, 3).join(" | ").slice(0, 400));
} catch (error) {
  check(false, `the run threw: ${error.message}`);
} finally {
  await chrome.close();
}
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Shots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
