/**
 * "Invite 3 friends" end to end, through the real pages and the real server together
 * (`ALLOW_DEV_AUTH=1 next dev`, PGlite, no .env.local), over CDP in one headless Chrome:
 *
 *   node launch/brand/hero/referrals-e2e.mjs [--base http://127.0.0.1:3980] [--port 9982]
 *        [--out <dir>] [--suffix 2]
 *
 * Every player is its own browser context (a fresh profile: its own cookies and storage).
 * Everything a player does is a real click or real typing on the page; the APIs are only
 * read, from the player's own page, to check the state the screens claim.
 *
 *   0. An existing player (old-timer) signs up without a link, for the negative checks.
 *   1. The referrer (ref-hero) brings a guest hero in, opens Invite friends from Tonight's
 *      tile, copies the link: 0/3 and the reward locked.
 *   2. Three friends, each fresh: the link, "ref-hero invited you", Start playing,
 *      /play?invited=1, dev sign-in, "You joined ref-hero’s crew.", Add your X (one also hits
 *      x_taken), a whole autopilot night submitted and verified, the checklist after it.
 *      friend-1 makes their hero through onboarding; friend-2 and friend-3 bring a guest save.
 *   3. The referrer again: three rows Joined · X added · Played, 3/3, the reward earned and
 *      queued, +300 XP on the hero, the account sheet's row and Tonight's tile at 3/3.
 *   4. A friend's second sign-in, an existing player through the link, a late claim (a bad
 *      code first), a bad landing code, /admin/referrals for a non-admin.
 *   5. The landing's card image, and the console over the whole flow.
 *
 * Shots: <out>/NN-<step>-1440.png and -375.png. Writes <out>/report.md and <out>/run.json.
 * Handles are fixed (ref-hero, friend-1…3), so run it against a fresh PGlite directory, or
 * pass --suffix to make new ones.
 *
 * Then, with the server stopped (PGlite is one process at a time):
 *
 *   node launch/brand/hero/referrals-e2e.mjs --outbox <PGLITE_DIR> [--out <dir>]
 *
 * reads the database the run left behind (the Recruiter badge's outbox row, the reward row,
 * who invited whom) and appends it to <out>/report.md.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const BASE = opt("base", "http://127.0.0.1:3980");
const PORT = Number(opt("port", "9982"));
const OUT = opt("out", "/Users/eromonseleodigie/near-hackathon/launch/brand/hero/game-shots/referrals-e2e");
const PROFILE = opt("profile", `/private/tmp/claude-501/wgp-referrals-e2e-${PORT}`);
const SAVE = opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SUFFIX = opt("suffix", "");
const NIGHT_MS = Number(opt("night-ms", String(8 * 60_000)));

if (opt("outbox", null)) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/wgp");
  const { PGlite } = createRequire(join(appDir, "package.json"))("@electric-sql/pglite");
  const db = new PGlite(opt("outbox"));
  const rows = async (sql) => (await db.query(sql)).rows;
  const found = {
    badgeOps: await rows(`select kind, dedupe_key, status, payload from chain_ops where dedupe_key like 'badge:recruiter:%'`),
    rewards: await rows(`select p.handle, r.goal, jsonb_array_length(r.friends) as friends, r.xp, r.granted_at from referral_rewards r join players p on p.id = r.player_id`),
    players: await rows(`select p.handle, r.handle as referred_by, p.x_handle, (select count(*)::int from runs where runs.player_id = p.id and runs.status = 'verified') as verified_runs from players p left join players r on r.id = p.referred_by order by p.created_at`),
  };
  await db.close();
  console.log(JSON.stringify(found, null, 2));
  const md = [
    "",
    "## The database afterwards",
    "",
    `Read from PGlite once the server stopped (\`--outbox\`).`,
    "",
    `- Recruiter badge outbox rows: ${found.badgeOps.length}. ${found.badgeOps.map((o) => `\`${o.kind}\` \`${o.dedupe_key}\`, ${o.status}, badges ${JSON.stringify(o.payload.badges)}, account \`${o.payload.accountId}\`${o.payload.level ? `, level ${o.payload.level}` : ""}`).join("; ")}`,
    `- \`referral_rewards\` rows: ${found.rewards.length}. ${found.rewards.map((r) => `${r.handle}: goal ${r.goal}, ${r.friends} friends, ${r.xp} XP`).join("; ")}`,
    "",
    "| Player | Invited by | X handle | Verified runs |",
    "|---|---|---|---|",
    ...found.players.map((p) => `| ${p.handle} | ${p.referred_by ?? "none"} | ${p.x_handle ?? "none"} | ${p.verified_runs} |`),
    "",
  ];
  appendFileSync(join(opt("out", "/Users/eromonseleodigie/near-hackathon/launch/brand/hero/game-shots/referrals-e2e"), "report.md"), md.join("\n"));
  process.exit(0);
}

const h = (base) => (SUFFIX ? `${base}-${SUFFIX}` : base);
const REFERRER = h("ref-hero");
const OLD_TIMER = h("old-timer");
const LATE = h("late-1");
const FRIENDS = [1, 2, 3].map((n) => ({ n, handle: h(`friend-${n}`), x: `wgp_f${n}${SUFFIX}`, viaSave: n > 1 }));

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 375, height: 812, deviceScaleFactor: 2, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const curly = (s) => s.replace(/'/g, "’");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ the browser */

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--force-color-profile=srgb",
    "--font-render-hinting=none",
    "--use-angle=metal",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let wsUrl;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(150);
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) throw new Error("Chrome did not start");
const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", rej);
});
let seq = 0;
const pending = new Map();
const handlers = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.rej(new Error(`${p.method}: ${m.error.message} ${m.error.data ?? ""}`));
    else p.res(m.result);
  } else if (m.method) handlers.get(`${m.sessionId ?? ""}|${m.method}`)?.forEach((fn) => fn(m.params));
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`${method} timed out`));
    }, 90_000);
    pending.set(id, { res, rej, method, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const on = (sessionId, method, fn) => {
  const k = `${sessionId}|${method}`;
  if (!handlers.has(k)) handlers.set(k, new Set());
  handlers.get(k).add(fn);
};

/* ------------------------------------------------------------------ the report */

const report = { base: BASE, startedAt: new Date().toISOString(), steps: [], shots: [], errors: [], code: null, link: null };
let cur = null;

async function step(id, title, fn) {
  const s = { id, title, checks: [], ms: 0, pass: true };
  report.steps.push(s);
  cur = s;
  console.log(`\n== ${id} ${title}`);
  const t0 = Date.now();
  try {
    await fn(s);
  } catch (error) {
    s.error = String(error?.stack ?? error);
    console.log(`  ERROR ${s.error.split("\n").slice(0, 3).join(" | ")}`);
  }
  s.ms = Date.now() - t0;
  s.pass = !s.error && s.checks.every((c) => c.pass);
  console.log(`== ${id} ${s.pass ? "PASS" : "FAIL"} in ${(s.ms / 1000).toFixed(1)} s`);
}

function check(name, pass, detail) {
  cur.checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` (${JSON.stringify(detail).slice(0, 240)})`}`);
  return !!pass;
}

/* ------------------------------------------------------------------ a player */

/** In-page helpers, prepended to every evaluation. `root()` is the open sheet when there is one. */
const H = `
const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none"; };
const root = () => document.querySelector("dialog[open]") || document;
const all = (sel, scope) => [...(scope || root()).querySelectorAll(sel)].filter(visible);
const T = (el) => norm(el && el.textContent);
const byText = (sel, text, scope) => all(sel, scope).find((el) => T(el).includes(text)) || null;
const byLabel = (text, scope) => { const l = [...(scope || root()).querySelectorAll("label")].find((x) => T(x).includes(text)); return l ? (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector("input,textarea,select")) : null; };
const pageText = () => norm(document.body.innerText);
const toasts = () => { try { return JSON.parse(sessionStorage.getItem("__e2e_toasts") || "[]"); } catch { return []; } };
const getJson = (path) => fetch(path, { headers: { accept: "application/json" }, cache: "no-store" }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
`;

/** Every toast the page shows, kept in sessionStorage so it survives client navigations. */
const TOAST_WATCH = `(() => {
  if (window.__e2eToastWatch) return;
  window.__e2eToastWatch = true;
  const seen = new WeakSet();
  const push = (text) => { try { const a = JSON.parse(sessionStorage.getItem("__e2e_toasts") || "[]"); a.push({ t: Date.now(), path: location.pathname + location.search, text }); sessionStorage.setItem("__e2e_toasts", JSON.stringify(a)); } catch {} };
  const scan = () => { for (const p of document.querySelectorAll('[role="status"][aria-live="polite"] .wgp-rise > p')) { if (seen.has(p)) continue; seen.add(p); push((p.textContent || "").trim()); } };
  const start = () => { new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); scan(); };
  if (document.documentElement) start(); else document.addEventListener("readystatechange", start, { once: true });
})();`;

const players = [];

async function player(name, { save = false } = {}) {
  const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
  await send("Browser.grantPermissions", { origin: BASE, browserContextId, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const p = { name, ctx: browserContextId, targetId, sessionId, docs: [], responses: [], errors: [] };
  p.send = (method, params) => send(method, params, sessionId);
  const where = () => cur?.id ?? "-";
  on(sessionId, "Runtime.consoleAPICalled", (e) => {
    if (e.type !== "error" && e.type !== "assert") return;
    p.errors.push({ step: where(), kind: `console.${e.type}`, text: e.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 600) });
  });
  on(sessionId, "Runtime.exceptionThrown", (e) => p.errors.push({ step: where(), kind: "exception", text: String(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text).slice(0, 600) }));
  on(sessionId, "Log.entryAdded", (e) => {
    if (e.entry.level === "error") p.errors.push({ step: where(), kind: `log.${e.entry.source}`, text: `${e.entry.text} ${e.entry.url ?? ""}`.slice(0, 600) });
  });
  on(sessionId, "Network.requestWillBeSent", (e) => {
    if (e.type !== "Document") return;
    p.docs.push({
      url: e.request.url,
      from: e.redirectResponse ? { url: e.redirectResponse.url, status: e.redirectResponse.status, location: e.redirectResponse.headers?.location ?? e.redirectResponse.headers?.Location ?? null } : null,
    });
  });
  on(sessionId, "Network.responseReceived", (e) => {
    if (e.type === "Document") p.lastDoc = { url: e.response.url, status: e.response.status };
    if (e.response.url.includes("/api/")) p.responses.push({ requestId: e.requestId, url: e.response.url, status: e.response.status, method: null, at: Date.now() });
  });
  await p.send("Page.enable");
  await p.send("Runtime.enable");
  await p.send("Network.enable");
  await p.send("Log.enable");
  await p.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await p.send("Emulation.setDeviceMetricsOverride", DESKTOP);
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: TOAST_WATCH });
  if (save) {
    const json = readFileSync(SAVE, "utf8");
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (location.origin === ${JSON.stringify(BASE)} && !localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); } catch {}` });
  }
  p.eval = async (expr) => {
    const r = await p.send("Runtime.evaluate", { expression: `(async () => { ${H}; const v = await (${expr}); return v instanceof Node ? true : v; })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${expr.slice(0, 160)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  p.close = async () => {
    try {
      await send("Target.disposeBrowserContext", { browserContextId });
    } catch {}
  };
  players.push(p);
  return p;
}

/** Polls an in-page expression until it's truthy; returns its value. */
async function waitFor(p, expr, { timeout = 20_000, label = expr.slice(0, 120), interval = 200 } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      last = await p.eval(expr);
      if (last && !(typeof last === "object" && last.wait)) return last;
    } catch (error) {
      last = String(error);
    }
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)?.slice(0, 300)}`);
    await sleep(interval);
  }
}

async function goto(p, path) {
  await p.send("Page.navigate", { url: path.startsWith("http") ? path : `${BASE}${path}` });
  await waitFor(p, `document.readyState === "complete"`, { timeout: 60_000, label: `load ${path}` });
}

/** A real click at the element's middle, once it's in view and nothing covers it. `finder` is an in-page expression. */
async function click(p, finder, { timeout = 20_000, label = finder } = {}) {
  const pt = await waitFor(
    p,
    `(() => {
      const el = ${finder};
      if (!el) return { wait: "missing" };
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { wait: "zero" };
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) return { wait: "covered by " + (hit ? hit.tagName + "." + String(hit.className).slice(0, 60) : "nothing") };
      return { x, y };
    })()`,
    { timeout, label: `click ${label}` },
  );
  await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
}

/** Clicks into a field, selects what's there and types over it, key by key. */
async function type(p, finder, text) {
  await click(p, finder);
  await p.eval(`(() => { const el = ${finder}; el.focus(); if (el.select) el.select(); return true; })()`);
  for (const ch of text) {
    await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
    await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  }
}

async function press(p, key) {
  const codes = { Escape: 27, Enter: 13 };
  await p.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: codes[key], ...(key === "Enter" ? { text: "\r" } : {}) });
  await p.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: codes[key] });
}

let shotN = 0;
/** One step's shot at 1440 and at 375 wide. */
async function shot(p, slug) {
  const n = String(++shotN).padStart(2, "0");
  for (const [w, metrics] of [
    ["1440", DESKTOP],
    ["375", PHONE],
  ]) {
    if (metrics !== DESKTOP) {
      await p.send("Emulation.setDeviceMetricsOverride", metrics);
      await sleep(800);
    }
    const { data } = await p.send("Page.captureScreenshot", { format: "png" });
    const file = `${n}-${slug}-${w}.png`;
    writeFileSync(join(OUT, file), Buffer.from(data, "base64"));
    report.shots.push(file);
  }
  await p.send("Emulation.setDeviceMetricsOverride", DESKTOP);
  await sleep(500);
}

/** Dismisses the toast if one is up (its own button), so a shot shows what's under it. */
async function dismissToast(p) {
  if (!(await p.eval(`!!all('button[aria-label="Dismiss message"]', document).length`))) return;
  await click(p, `all('button[aria-label="Dismiss message"]', document)[0]`, { label: "Dismiss message" });
  await waitFor(p, `!all('button[aria-label="Dismiss message"]', document).length`, { label: "toast gone" });
}

const toastSeen = (p, text) => waitFor(p, `toasts().find((t) => t.text.includes(${JSON.stringify(text)}))`, { timeout: 15_000, label: `toast “${text}”` });
const toastExact = (p, text) => waitFor(p, `toasts().find((t) => t.text === ${JSON.stringify(text)})`, { timeout: 15_000, label: `toast “${text}”` });

/** Opens the account sheet from the top chip. */
async function openAccount(p) {
  await click(p, `[...document.querySelectorAll('button[aria-haspopup="dialog"]')].find((b) => visible(b) && /Sign in|Account:/.test(T(b)) && !b.closest("dialog"))`, { label: "account chip" });
  await waitFor(p, `document.querySelector("dialog[open]")`, { label: "account sheet" });
}

/** The account sheet's dev sign-in, as a person does it. */
async function devSignIn(p, handle) {
  await openAccount(p);
  await waitFor(p, `byLabel("Test handle")`, { label: "dev sign-in field" });
  await type(p, `byLabel("Test handle")`, handle);
  await click(p, `byText("button", "Play as a test player")`);
  await waitFor(p, `[...document.querySelectorAll('button[aria-haspopup="dialog"]')].some((b) => T(b).includes("Account: ${handle}"))`, { timeout: 30_000, label: `signed in as ${handle}` });
}

/** "Bring your hero along?" → bring it. */
async function bringHero(p) {
  await waitFor(p, `document.querySelector("dialog[open]") && pageText().includes("Bring your hero along?") && byText("button", "along")`, { timeout: 20_000, label: "the import offer" });
  await click(p, `byText("button", "along")`);
  await toastSeen(p, "is on your account now");
}

const cookie = async (p, name) => (await p.send("Network.getCookies", { urls: [BASE] })).cookies.find((c) => c.name === name) ?? null;

/** Lifetime XP: every level's bar below the hero's level, plus what's in the bar. */
const XP_TO_NEXT = (level) => 100 + (level - 1) * 60;
const lifetimeXp = (hero) => {
  let xp = hero.xp;
  for (let l = 1; l < hero.level; l++) xp += XP_TO_NEXT(l);
  return xp;
};

const me = (p) => p.eval(`getJson("/api/me")`);
const referrals = (p) => p.eval(`getJson("/api/referrals")`);

/* ------------------------------------------------------------------ the flow */

const state = { code: null, link: null, xpBefore: null, xpAfter: null, referrer: null };

await step("0", "An existing player signs up without a link (for step 4)", async () => {
  const p = await player(OLD_TIMER);
  await goto(p, "/play");
  await waitFor(p, `location.pathname === "/play/bitten"`, { label: "onboarding for a guest without a hero" });
  await devSignIn(p, OLD_TIMER);
  const r = await referrals(p);
  check("old-timer exists, with no inviter", r.status === 200 && r.body.referredBy === null, { status: r.status, referredBy: r.body?.referredBy });
  await p.close();
});

let R;
await step("1", "Referrer: sign in, open Invite friends from Tonight, copy the link", async () => {
  R = await player(REFERRER, { save: true });
  await goto(R, "/play");
  await waitFor(R, `location.pathname === "/play" && byText("a", "Invite friends")`, { timeout: 40_000, label: "Tonight with the invite tile" });
  check("guest Tonight tile asks to sign in", (await R.eval(`T(byText("a", "Invite friends"))`)).includes("Sign in to get your link"), await R.eval(`T(byText("a", "Invite friends"))`));
  await shot(R, "referrer-tonight-guest");
  await devSignIn(R, REFERRER);
  await bringHero(R);
  const tile = await waitFor(R, `(() => { const a = byText("a", "Invite friends"); const t = a && T(a); return t && t.includes("0/3") ? t : null; })()`, { label: "Invite tile at 0/3" });
  check("Tonight tile reads Invite friends · 0/3", tile.includes("0/3"), tile);
  await shot(R, "referrer-tonight-signed-in");
  const m = await me(R);
  state.xpBefore = { level: m.body.save.hero.level, xp: m.body.save.hero.xp, lifetime: lifetimeXp(m.body.save.hero) };
  check("referrer has a hero on the server", !!m.body.save.hero, state.xpBefore);

  await click(R, `byText("a", "Invite friends")`, { label: "Tonight’s invite tile" });
  await waitFor(R, `location.pathname === "/play/invite" && byLabel("Your invite link") && byLabel("Your invite link").value`, { timeout: 30_000, label: "the invite page with a link" });
  const link = await R.eval(`byLabel("Your invite link").value`);
  await click(R, `byText("button", "Copy link")`);
  await toastSeen(R, "Link copied");
  const clip = await R.eval(`navigator.clipboard.readText().catch((e) => "ERR " + e)`);
  check("Copy link puts the field’s link on the clipboard", clip === link, { clip, link });
  const escaped = BASE.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const re = new RegExp(`^${escaped}/invite/[0-9A-HJKMNP-TV-Z]{7}$`);
  check("the link is this server’s /invite/CODE", re.test(link), link);
  state.link = link;
  state.code = link.split("/").pop();
  report.code = state.code;
  report.link = link;
  const crew = await R.eval(`T(document.querySelector('[aria-label="Friends who count"]').closest("div.flex.flex-col"))`);
  check("progress reads 0/3", crew.includes("0/3") && crew.includes("0 of 3 friends count"), crew);
  const reward = await R.eval(`T(document.querySelector('section[aria-labelledby="reward-title"]'))`);
  check("reward card is locked: Recruiter badge + 300 XP, 3 to go", reward.includes("Locked") && reward.includes("300 XP") && /Recruiter/.test(reward) && reward.includes("3 more friends to go"), reward);
  check("no friends listed yet", (await R.eval(`pageText()`)).includes("Nobody yet"));
  const api = await referrals(R);
  check("GET /api/referrals agrees: 0 qualified, locked", api.body.qualified === 0 && api.body.reward.state === "locked" && api.body.code === state.code, { qualified: api.body.qualified, reward: api.body.reward, code: api.body.code });
  await shot(R, "referrer-invite-page");
});

async function friendFlow(f, takenX) {
  const p = await player(f.handle, { save: f.viaSave });
  try {
    await goto(p, state.link);
    const title = await waitFor(p, `document.getElementById("invite-title") && T(document.getElementById("invite-title"))`, { label: "landing title" });
    check(`landing says “${REFERRER} invited you”`, title.includes(`${REFERRER} invited you`), title);
    check("landing keeps the code in localStorage", (await p.eval(`localStorage.getItem("wgp:ref")`)) === state.code);
    await shot(p, `friend-${f.n}-landing`);

    await click(p, `byText("a", "Start playing")`);
    await waitFor(p, `location.pathname.startsWith("/play") && document.readyState === "complete"`, { timeout: 40_000, label: "/play after Start playing" });
    const hop = p.docs.find((d) => d.url === `${BASE}/play?invited=1`);
    check("Start playing → 302 from the accept route → /play?invited=1", hop?.from?.status === 302 && /\/api\/invite\/[^/]+\/accept$/.test(hop.from.url), hop);
    const c = await cookie(p, "wgp_ref");
    check("the wgp_ref cookie is set (HttpOnly, Lax)", c?.value === state.code && c.httpOnly && c.sameSite === "Lax", c && { value: c.value, httpOnly: c.httpOnly, sameSite: c.sameSite, expires: c.expires });
    await toastSeen(p, curly(`You joined ${REFERRER}'s crew. Sign in`));
    check("guest toast: You joined the crew, sign in so it counts", true);
    if (!f.viaSave) await waitFor(p, `location.pathname === "/play/bitten"`, { label: "onboarding (no hero yet)" });
    else await waitFor(p, `location.pathname === "/play" && byText("a", "Invite friends")`, { timeout: 30_000, label: "Tonight with the guest’s hero" });
    check("?invited=1 comes off the address", !(await p.eval(`location.search.includes("invited")`)));
    await shot(p, `friend-${f.n}-arrived`);

    await devSignIn(p, f.handle);
    if (f.viaSave) await bringHero(p);
    await toastExact(p, curly(`You joined ${REFERRER}'s crew.`)).catch(() => null);
    const ts = await p.eval(`toasts().map((t) => t.text)`);
    check(`signed-in toast “You joined ${REFERRER}’s crew.”`, ts.includes(curly(`You joined ${REFERRER}'s crew.`)), ts);
    check("the invite cookie is dropped after sign-in", !(await cookie(p, "wgp_ref")));
    check("the stored invite is forgotten after sign-in", (await p.eval(`localStorage.getItem("wgp:ref")`)) === null);
    const mine = await referrals(p);
    check(`server: referredBy ${REFERRER}`, mine.body?.referredBy === REFERRER, { referredBy: mine.body?.referredBy, canClaim: mine.body?.canClaim });

    if (!f.viaSave) {
      // The game's own onboarding, signed in: the hero is made on the server.
      await waitFor(p, `byText("button", "Get bitten")`, { label: "Get bitten" });
      await click(p, `byText("button", "Get bitten")`);
      await type(p, `byLabel("Hero name")`, `Crew ${f.n}`);
      await click(p, `byText("button", "Continue")`);
      await waitFor(p, `pageText().includes("Pick a suit.")`, { label: "the suit step" });
      await click(p, `byText("button", "Continue")`);
      await waitFor(p, `pageText().includes("three powers.")`, { label: "the powers step" });
      for (let i = 0; i < 3; i++) await click(p, `[...document.querySelectorAll('input[name="powers"]')][${i}].closest("label")`, { label: `power ${i + 1}` });
      await click(p, `byText("button", "Continue")`);
      await waitFor(p, `byText("button", "Start your first night")`, { label: "the confirm step" });
      await shot(p, `friend-${f.n}-onboarding`);
      await click(p, `byText("button", "Start your first night")`);
      await waitFor(p, `location.pathname === "/play" && byText("a", "Invite friends")`, { timeout: 30_000, label: "Tonight after onboarding" });
    }

    const list = await waitFor(p, `(() => { const s = document.querySelector('section[aria-labelledby="crew-checklist-title"]'); return s ? T(s) : null; })()`, { timeout: 20_000, label: "the crew checklist" });
    check(`Tonight checklist “Count for ${REFERRER}” with Add your X and Play a night`, list.includes(`Count for ${REFERRER}`) && list.includes("Add your X") && list.includes("Play a night"), list);
    await shot(p, `friend-${f.n}-checklist`);

    await click(p, `byText("button", "Add your X", document.querySelector('section[aria-labelledby="crew-checklist-title"]'))`, { label: "Add your X" });
    await waitFor(p, `document.querySelector("dialog[open]") && byLabel("Your X handle")`, { label: "the account sheet’s X field" });
    await sleep(400);
    check("the sheet opens with focus on the X field", await p.eval(`document.activeElement === byLabel("Your X handle")`));
    if (takenX) {
      await type(p, `byLabel("Your X handle")`, takenX);
      await click(p, `byText("button", "Save X handle")`);
      const help = await waitFor(p, `(() => { const i = byLabel("Your X handle"); const d = i && document.getElementById(i.getAttribute("aria-describedby")); const t = d && T(d); return t && t.includes("Another player") ? t : null; })()`, { label: "x_taken under the field" });
      check("a taken X handle shows the x_taken message on the field", help.includes("Another player already added that X handle"), help);
      check("the field is marked invalid and has focus back", await p.eval(`byLabel("Your X handle").getAttribute("aria-invalid") === "true" && document.activeElement === byLabel("Your X handle")`));
      const r409 = p.responses.find((r) => r.url.endsWith("/api/me/social") && r.status === 409);
      check("the server answered 409 x_taken", !!r409, r409);
      await shot(p, `friend-${f.n}-x-taken`);
    }
    await type(p, `byLabel("Your X handle")`, f.x);
    await click(p, `byText("button", "Save X handle")`);
    await toastSeen(p, `Saved @${f.x}`);
    check(`X handle saved (@${f.x})`, true);
    await shot(p, `friend-${f.n}-x-saved`);
    await press(p, "Escape");
    await waitFor(p, `!document.querySelector("dialog[open]")`, { label: "sheet closed" });
    const after = await waitFor(p, `(() => { const s = document.querySelector('section[aria-labelledby="crew-checklist-title"]'); return s ? T(s) : "gone"; })()`, { label: "checklist after X" });
    check("checklist ticks X added", after.includes("X added") && !after.includes("Add your X"), after);

    // A whole night on autopilot, ranked: watch for the submit's answer.
    const tNight = Date.now();
    await goto(p, "/play/patrol?autopilot=1");
    let midShot = false;
    let submit = null;
    while (Date.now() - tNight < NIGHT_MS) {
      submit = p.responses.find((r) => /\/api\/runs\/[^/]+\/submit$/.test(r.url));
      if (submit) break;
      if (!midShot && Date.now() - tNight > 25_000) {
        midShot = true;
        await shot(p, `friend-${f.n}-night`);
      }
      const notice = await p.eval(`(() => { const t = pageText(); return /You’ve patrolled tonight|Can’t start tonight|No hero yet|already in flight/i.test(t) ? t.slice(0, 300) : null; })()`).catch(() => null);
      if (notice) throw new Error(`the night didn’t start: ${notice}`);
      await sleep(1000);
    }
    if (!submit) throw new Error("no run was submitted");
    let body = null;
    for (let i = 0; i < 40 && !body; i++) {
      try {
        const r = await p.send("Network.getResponseBody", { requestId: submit.requestId });
        body = JSON.parse(r.body);
      } catch {
        await sleep(250);
      }
    }
    f.nightMs = Date.now() - tNight;
    check("the night’s run is submitted and verified", submit.status === 200 && body?.status === "verified", { status: submit.status, outcome: body?.status, score: body?.score, ticks: body?.ticks, reason: body?.reason, nightSeconds: Math.round(f.nightMs / 1000) });
    await waitFor(p, `/verified/i.test(pageText())`, { timeout: 30_000, label: "results: Verified" });
    await sleep(1200);
    await shot(p, `friend-${f.n}-night-verified`);

    // Back the way a player goes: tonight's board from the results, then the dock's Tonight tab.
    if (await p.eval(`!!byText("a", "See tonight’s board")`)) {
      await click(p, `byText("a", "See tonight’s board")`);
      await waitFor(p, `location.pathname === "/play/leaderboard"`, { timeout: 30_000, label: "tonight’s board" });
      await click(p, `[...document.querySelectorAll('a[href="/play"]')].find((a) => visible(a) && /Tonight/.test(T(a)))`, { label: "the dock’s Tonight tab" });
    } else await goto(p, "/play");
    await waitFor(p, `location.pathname === "/play" && byText("a", "Invite friends")`, { timeout: 30_000, label: "Tonight after the night" });
    await sleep(2500);
    const done = await p.eval(`(() => { const s = document.querySelector('section[aria-labelledby="crew-checklist-title"]'); return s ? T(s) : "gone"; })()`);
    const view = await referrals(p);
    check("after a verified night the checklist is done (gone, or Night played ticked)", done === "gone" || done.includes("Night played"), { checklist: done, self: view.body?.self ?? null });
    await shot(p, `friend-${f.n}-tonight-after`);
  } finally {
    report.errors.push(...p.errors.map((e) => ({ player: p.name, ...e })));
    p.errors.length = 0;
    await p.close();
  }
}

for (const f of FRIENDS) {
  await step(`2.${f.n}`, `Friend ${f.handle}: the link, sign in, X, a verified night${f.viaSave ? " (guest save brought in)" : " (onboarding)"}`, async () => {
    if (!state.link) throw new Error("no invite link from step 1");
    await friendFlow(f, f.n === 2 ? FRIENDS[0].x : null);
  });
}

await step("3", "Referrer: 3/3, the reward earned and queued, +300 XP", async () => {
  await goto(R, "/play/invite");
  const crew = await waitFor(R, `(() => { const o = document.querySelector('[aria-label="Friends who count"]'); return o ? T(o.closest("section")) : null; })()`, { timeout: 30_000, label: "the crew panel" });
  for (const f of FRIENDS) {
    const steps = await R.eval(`(() => { const u = document.querySelector('ul[aria-label="${f.handle}’s steps"]'); return u ? T(u) : null; })()`);
    check(`${f.handle}: Joined · X added · Played all done`, !!steps && ["Joined: done", "X added: done", "Played: done"].every((s) => steps.includes(s)), steps);
  }
  check("progress reads 3/3", crew.includes("3/3") && crew.includes("3 of 3 friends count"), crew.slice(0, 200));
  check("each friend Counts", (crew.match(/Counts/g) ?? []).length === 3, (crew.match(/Counts/g) ?? []).length);
  const reward = await R.eval(`T(document.querySelector('section[aria-labelledby="reward-title"]'))`);
  check("reward card shows Earned (the badge queued)", reward.includes("Earned") && reward.includes("300 XP is in your hero’s bar") && reward.includes("queued"), reward);
  const api = await referrals(R);
  check("GET /api/referrals: 3 qualified, reward queued", api.body.qualified === 3 && api.body.reward.state === "queued", { qualified: api.body.qualified, reward: api.body.reward });
  check("the referrer sees game handles only (no X handles, no NEAR accounts)", JSON.stringify(api.body.invited).match(/wgp_f|dev\.wgp\.testnet/) === null, api.body.invited);
  state.referrer = api.body;
  const m = await me(R);
  const hero = m.body.save.hero;
  state.xpAfter = { level: hero.level, xp: hero.xp, lifetime: lifetimeXp(hero) };
  check("the hero’s XP went up by exactly 300", state.xpAfter.lifetime - state.xpBefore.lifetime === 300, { before: state.xpBefore, after: state.xpAfter });
  await shot(R, "referrer-invite-3of3");

  await openAccount(R);
  const row = await waitFor(R, `(() => { const a = document.querySelector('dialog[open] a[href="/play/invite"]'); return a ? T(a) : null; })()`, { label: "the account sheet’s invite row" });
  check("account sheet row: Invite friends · 3/3 · Recruiter badge earned", row.includes("3/3") && row.includes("Recruiter badge earned"), row);
  await shot(R, "referrer-account-row");
  await press(R, "Escape");
  await waitFor(R, `!document.querySelector("dialog[open]")`);

  await click(R, `[...document.querySelectorAll('a[href="/play"]')].find((a) => visible(a) && /Tonight/.test(T(a)))`, { label: "the dock’s Tonight tab" });
  const tile = await waitFor(R, `(() => { const a = location.pathname === "/play" && byText("a", "Invite friends"); const t = a && T(a); return t && t.includes("3/3") ? t : null; })()`, { timeout: 20_000, label: "Tonight tile at 3/3" });
  check("Tonight tile: Invite friends · 3/3 · Recruiter badge earned", tile.includes("3/3") && tile.includes("Recruiter badge earned"), tile);
  await shot(R, "referrer-tonight-3of3");
});

await step("4.1", "A friend’s second sign-in changes nothing", async () => {
  const p = await player(`${FRIENDS[0].handle} again`);
  try {
    await goto(p, state.link);
    await click(p, `byText("a", "Start playing")`);
    await waitFor(p, `location.pathname.startsWith("/play/")`, { timeout: 40_000, label: "/play/bitten for a fresh browser" });
    await devSignIn(p, FRIENDS[0].handle);
    await waitFor(p, `location.pathname === "/play" && byText("a", "Invite friends")`, { timeout: 30_000, label: "Tonight with the account’s hero" });
    const mine = await referrals(p);
    check(`still in ${REFERRER}’s crew`, mine.body.referredBy === REFERRER, mine.body.referredBy);
    const api = await referrals(R);
    check("the referrer’s count and list don’t move", api.body.qualified === 3 && api.body.invited.length === 3 && api.body.reward.state === "queued", { qualified: api.body.qualified, invited: api.body.invited.length, reward: api.body.reward.state });
    const hero = (await me(R)).body.save.hero;
    check("no second 300 XP", lifetimeXp(hero) === state.xpAfter.lifetime, { lifetime: lifetimeXp(hero) });
    await shot(p, "friend-1-second-sign-in");
  } finally {
    report.errors.push(...p.errors.map((e) => ({ player: p.name, ...e })));
    await p.close();
  }
});

await step("4.2", "An existing player through the link is not attached", async () => {
  const p = await player(`${OLD_TIMER} via link`);
  try {
    await goto(p, state.link);
    await click(p, `byText("a", "Start playing")`);
    await waitFor(p, `location.pathname.startsWith("/play/")`, { timeout: 40_000, label: "/play/bitten" });
    await devSignIn(p, OLD_TIMER);
    await toastSeen(p, "You already have an account");
    const ts = await p.eval(`toasts().map((t) => t.text)`);
    check("told they already have an account, so add the code instead (not “You joined”)", ts.includes(curly(`You already have an account, so add ${REFERRER}'s invite code under Invite friends to join their crew.`)) && !ts.includes(curly(`You joined ${REFERRER}'s crew.`)), ts);
    await openAccount(p);
    await click(p, `document.querySelector('dialog[open] a[href="/play/invite"]')`, { label: "account row → Invite friends" });
    await waitFor(p, `location.pathname === "/play/invite" && byLabel("Your invite link")`, { timeout: 30_000, label: "their invite page" });
    const text = await p.eval(`pageText()`);
    check("their Invite friends shows no inviter (and offers the claim form)", !text.includes("You’re in") && text.includes("Got an invite code?"), text.slice(0, 160));
    const mine = await referrals(p);
    check("server: referredBy null", mine.body.referredBy === null, mine.body.referredBy);
    const api = await referrals(R);
    check("the referrer’s list doesn’t move", api.body.invited.length === 3 && api.body.qualified === 3, { invited: api.body.invited.length });
    await shot(p, "existing-player-not-attached");
  } finally {
    report.errors.push(...p.errors.map((e) => ({ player: p.name, ...e })));
    await p.close();
  }
});

await step("4.3", "Late claim on a brand-new account: a bad code, then the referrer’s", async () => {
  const p = await player(LATE);
  try {
    await goto(p, "/play");
    await waitFor(p, `location.pathname === "/play/bitten"`, { label: "onboarding" });
    await devSignIn(p, LATE);
    await openAccount(p);
    await click(p, `document.querySelector('dialog[open] a[href="/play/invite"]')`, { label: "account row → Invite friends" });
    await waitFor(p, `location.pathname === "/play/invite" && byLabel("Invite code")`, { timeout: 30_000, label: "the claim form" });
    await type(p, `byLabel("Invite code")`, "ZZZZZZZ");
    await click(p, `byText("button", "Add invite code")`);
    const bad = await waitFor(p, `(() => { const i = byLabel("Invite code"); const d = i && document.getElementById(i.getAttribute("aria-describedby")); const t = d && T(d); return t && !t.startsWith("7 letters") ? t : null; })()`, { label: "the claim’s refusal" });
    check("a bad code shows the server’s message", bad === "That invite code doesn’t match anyone. Check it and try again.", bad);
    const r422 = p.responses.find((r) => r.url.endsWith("/api/referrals/claim") && r.status === 422);
    check("the server answered 422", !!r422);
    await dismissToast(p);
    await shot(p, "late-claim-bad-code");
    await type(p, `byLabel("Invite code")`, state.code.toLowerCase());
    await click(p, `byText("button", "Add invite code")`);
    const note = await waitFor(p, `(() => { const h = document.getElementById("crew-note-title"); return h ? T(h) : null; })()`, { label: "You’re in the crew" });
    check(`shows “You’re in ${REFERRER}’s crew”`, note === curly(`You're in ${REFERRER}'s crew`), note);
    check("toast “You joined the crew.”", !!(await toastExact(p, curly(`You joined ${REFERRER}'s crew.`)).catch(() => null)));
    const mine = await referrals(p);
    check(`server: referredBy ${REFERRER}, canClaim false`, mine.body.referredBy === REFERRER && mine.body.canClaim === false, { referredBy: mine.body.referredBy, canClaim: mine.body.canClaim });
    const api = await referrals(R);
    const row = api.body.invited.find((x) => x.handle === LATE);
    check("the referrer now lists them as joined (not counting yet)", !!row && !row.qualified && api.body.qualified === 3, row);
    await shot(p, "late-claim-joined");

    await goto(p, "/invite/ZZZZZZZ");
    const t = await waitFor(p, `document.getElementById("invite-title") && T(document.getElementById("invite-title"))`, { label: "bad landing" });
    check("a bad landing code: “This invite link doesn’t work” with Play anyway", t === "This invite link doesn’t work" && !!(await p.eval(`byText("a", "Play anyway")`)), t);
    await shot(p, "landing-bad-code");
  } finally {
    report.errors.push(...p.errors.map((e) => ({ player: p.name, ...e })));
    await p.close();
  }
});

await step("4.4", "/admin/referrals is a 404 for a non-admin", async () => {
  await goto(R, "/admin/referrals");
  check("the page answers 404 to the signed-in referrer", R.lastDoc?.status === 404, R.lastDoc);
  const j = await R.eval(`fetch("/api/admin/referrals").then((r) => r.status)`);
  const csv = await R.eval(`fetch("/api/admin/referrals?format=csv").then((r) => r.status)`);
  check("the JSON and the CSV answer 404 too", j === 404 && csv === 404, { json: j, csv });
  const anon = await fetch(`${BASE}/admin/referrals`);
  check("and 404 signed out", anon.status === 404, anon.status);
  await shot(R, "admin-404");
});

await step("5", "The landing’s card image, and the console over the whole flow", async () => {
  await goto(R, state.link);
  const meta = await R.eval(`({ og: document.querySelector('meta[property="og:image"]')?.content ?? null, tw: document.querySelector('meta[name="twitter:image"]')?.content ?? null, w: document.querySelector('meta[property="og:image:width"]')?.content ?? null, h: document.querySelector('meta[property="og:image:height"]')?.content ?? null })`);
  check("the landing declares an og:image", !!meta.og, meta);
  const local = meta.og ? `${BASE}${new URL(meta.og).pathname}${new URL(meta.og).search}` : null;
  const res = local ? await fetch(local) : null;
  const buf = res ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const dims = png ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
  check("the card image renders a 1200×630 PNG", res?.status === 200 && /image\/png/.test(res.headers.get("content-type") ?? "") && png && dims?.w === 1200 && dims?.h === 630, { url: local, status: res?.status, type: res?.headers.get("content-type"), bytes: buf.length, dims });
  if (png) writeFileSync(join(OUT, "invite-card.png"), buf);
  await goto(R, local);
  await shot(R, "invite-card-image");
  report.errors.push(...R.errors.map((e) => ({ player: R.name, ...e })));
  R.errors.length = 0;
  // The refusals the negative checks provoke on purpose.
  const expected = (e) => / 409 \(Conflict\).*\/api\/me\/social| 422 \(Unprocessable (Content|Entity)\).*\/api\/referrals\/claim| 404 \(Not Found\).*\/admin\/referrals/.test(e.text);
  // This machine, not the code: the licensed fonts aren't in the repo (production deploys copy
  // them in), and NEAR Auth has no keys without .env.local, so its nonce answers 503.
  const environment = (e) => /404 \(Not Found\).*\/fonts\/NeueMontreal-|503 \(Service Unavailable\).*\/api\/auth\/near-auth\/nonce/.test(e.text);
  const unexpected = report.errors.filter((e) => !expected(e) && !environment(e));
  report.expectedErrors = report.errors.filter(expected);
  report.environmentErrors = report.errors.filter(environment);
  report.unexpectedErrors = unexpected;
  check("no console errors, exceptions or failed loads from the app (beyond the provoked refusals and this machine’s missing fonts and NEAR Auth keys)", unexpected.length === 0, unexpected.slice(0, 8));
});

/* ------------------------------------------------------------------ write up */

report.finishedAt = new Date().toISOString();
report.state = state;
report.friends = FRIENDS;
writeFileSync(join(OUT, "run.json"), JSON.stringify(report, null, 2));

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const lines = [
  "# Referrals end to end",
  "",
  `Run ${report.startedAt} → ${report.finishedAt} against \`${BASE}\` (\`next dev\`, PGlite, \`ALLOW_DEV_AUTH=1\`), headless Chrome over CDP, one browser context per player. Driver: \`launch/brand/hero/referrals-e2e.mjs\`.`,
  "",
  `Invite code \`${report.code}\`, link \`${report.link}\`.`,
  "",
  "| Step | What | Result | Time |",
  "|---|---|---|---|",
  ...report.steps.map((s) => `| ${s.id} | ${s.title} | ${s.pass ? "pass" : "**fail**"} | ${sec(s.ms)} |`),
  "",
  ...report.steps.flatMap((s) => [
    `## ${s.id}. ${s.title}`,
    "",
    ...s.checks.map((c) => `- ${c.pass ? "pass" : "**FAIL**"}: ${c.name}${c.detail === undefined ? "" : ` (\`${JSON.stringify(c.detail).slice(0, 220).replace(/`/g, "'")}\`)`}`),
    ...(s.error ? ["", "```", s.error.split("\n").slice(0, 6).join("\n"), "```"] : []),
    "",
  ]),
  "## Nights",
  "",
  ...FRIENDS.map((f) => `- ${f.handle}: ${f.nightMs ? sec(f.nightMs) : "n/a"} from /play/patrol?autopilot=1 to the verified submit.`),
  "",
  "## Console",
  "",
  [
    `${(report.unexpectedErrors ?? []).filter((e) => !e.kind.startsWith("log.")).length} JavaScript exceptions or console.error calls. Failed loads: ${(report.unexpectedErrors ?? []).filter((e) => e.kind.startsWith("log.")).length} from the app, ${report.expectedErrors?.length ?? 0} provoked on purpose (409 x_taken, 422 bad_code, the admin 404s), ${report.environmentErrors?.length ?? 0} from this machine (the licensed NeueMontreal fonts, which aren't in the repo, and NEAR Auth's nonce, 503 without keys).`,
    "",
    ...[...(report.unexpectedErrors ?? []).map((e) => ["unexpected", e]), ...(report.expectedErrors ?? []).map((e) => ["provoked", e])].map(([k, e]) => `- ${k}: ${e.player} @ ${e.step} ${e.kind}: ${e.text.replace(/\n/g, " ").slice(0, 200)}`),
    ...Object.entries((report.environmentErrors ?? []).reduce((m, e) => ((m[e.text.replace(/^.*status of /, "")] = (m[e.text.replace(/^.*status of /, "")] ?? 0) + 1), m), {})).map(([t, n]) => `- environment ×${n}: ${t}`),
  ].join("\n"),
  "",
  "## Screenshots",
  "",
  ...report.shots.map((s) => `- ${s}`),
  "",
];
writeFileSync(join(OUT, "report.md"), lines.join("\n"));

ws.close();
chrome.kill("SIGKILL");
await sleep(400);
rmSync(PROFILE, { recursive: true, force: true });
const failed = report.steps.filter((s) => !s.pass).map((s) => s.id);
console.log(`\n${failed.length ? `FAILED: ${failed.join(", ")}` : "ALL PASS"}. Report: ${join(OUT, "report.md")}`);
process.exit(failed.length ? 1 : 0);
