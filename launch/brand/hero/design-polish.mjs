/**
 * The design-polish pass: every screen at four viewports, a screenshot each and a set of
 * mechanical checks (sideways overflow, truncated text, small touch targets, console
 * errors), against a running WGP server.
 *
 *   node launch/brand/hero/design-polish.mjs --label before [--base http://127.0.0.1:4410]
 *     [--routes /play,/play/market] [--viewports phone,landscape,tablet,desktop]
 *     [--auth 1] [--save hero] [--port 9711] [--shots 0] [--eval "<js>" --name more]
 *
 * Writes game-shots/design-polish/<label>/<viewport>-<route>.png and report.json.
 * Needs launch/lib/cdp.mjs and launch/out/saves; from a worktree without them,
 * WGP_LAUNCH=<a checkout's launch/>.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCH = process.env.WGP_LAUNCH ?? join(HERE, "..", "..");
const { launch, sleep } = await import(pathToFileURL(join(LAUNCH, "lib", "cdp.mjs")).href);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:4410");
const label = opt("label", "after");
const out = join(opt("out", join(HERE, "game-shots", "design-polish")), label);
const auth = opt("auth", "0") === "1";
const saveName = opt("save", "hero");
const shots = opt("shots", "1") === "1";
const settle = Number(opt("settle", 1800));
/** JavaScript to run in the page once it has settled (open a sheet, press a button), before the checks and the shot. */
const act = opt("eval", "");
/** A suffix for the shot's file name, to tell an `--eval` state from the plain page. */
const suffix = opt("name", "");
/** A JavaScript condition to wait for (up to 20 s) before `--eval`, the checks and the shot. */
const waitFor = opt("wait", "");
mkdirSync(out, { recursive: true });

export const VIEWPORTS = {
  phone: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
  small: { width: 320, height: 640, deviceScaleFactor: 2, mobile: true },
  wide: { width: 430, height: 932, deviceScaleFactor: 2, mobile: true },
  landscape: { width: 812, height: 375, deviceScaleFactor: 2, mobile: true },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
};
const ROUTES = [
  "/",
  "/play",
  "/play/market",
  "/play/suits",
  "/play/hero",
  "/play/album",
  "/play/rug",
  "/play/cases",
  "/play/compete",
  "/play/leaderboard",
  "/play/invite",
  "/stats",
  "/lab/economy",
  "/lab/determinism",
];
const routes = opt("routes", ROUTES.join(",")).split(",");
const viewports = opt("viewports", "phone,landscape,tablet,desktop").split(",");

/** The checks, run in the page. Everything it returns is plain data. */
const AUDIT = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40) || el.tagName;
  const sr = (el) => { const s = getComputedStyle(el); return s.clip === "rect(0px, 0px, 0px, 0px)" || el.closest(".sr-only") || (parseFloat(s.width) <= 1 && s.overflow === "hidden"); };
  const res = { overflowX: document.documentElement.scrollWidth - vw, truncated: [], small: [], offscreen: [] };
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el) || sr(el)) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) res.truncated.push(name(el));
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && r.width < vw * 1.5 && s.position !== "fixed" && !el.closest("[aria-hidden=true]") && el.children.length === 0 && r.top < document.documentElement.scrollHeight) {
      // Inside a scroller that is meant to scroll sideways it's fine.
      let p = el.parentElement, ok = false;
      while (p && p !== document.body) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(ps.overflowX)) { ok = true; break; } p = p.parentElement; }
      if (!ok) res.offscreen.push(name(el));
    }
  }
  for (const el of document.querySelectorAll("a[href], button, [role=button], [role=switch], [role=tab], input, select, summary")) {
    if (!vis(el) || sr(el) || el.closest("[aria-hidden=true]")) continue;
    const r = el.getBoundingClientRect();
    const min = coarse ? 44 : 24;
    if (r.width < min - 0.5 || r.height < min - 0.5) res.small.push(name(el) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  res.truncated = [...new Set(res.truncated)]; res.small = [...new Set(res.small)].slice(0, 25); res.offscreen = [...new Set(res.offscreen)].slice(0, 15);
  return res;
})()`;

const HIDE = `nextjs-portal { display: none !important; }`;

async function main() {
  const c = await launch({ port: Number(opt("port", 9711)), profile: `/private/tmp/claude-501/wgp-design-polish-${opt("port", 9711)}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const report = {};
  try {
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Network.enable");
    const failed = [];
    c.on("Network.responseReceived", (p) => {
      if (p.response.status >= 400) failed.push(`${p.response.status} ${p.response.url.replace(base, "")}`);
    });
    const json = readFileSync(join(LAUNCH, "out", "saves", `${saveName}.json`), "utf8");
    if (saveName !== "none") await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); } catch {}` });
    await c.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(HIDE)}; document.head.appendChild(st); });`,
    });
    if (auth) {
      await c.send("Page.navigate", { url: `${base}/play` });
      await sleep(2500);
      const r = await c.evaluate(`fetch("/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: "polish" }) }).then((r) => r.status)`);
      console.log(`dev sign-in: ${r}`);
    }
    for (const vp of viewports) {
      const v = VIEWPORTS[vp];
      await c.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: v.mobile });
      await c.send("Emulation.setTouchEmulationEnabled", { enabled: v.mobile, maxTouchPoints: 5 });
      for (const route of routes) {
        c.logs.length = 0;
        failed.length = 0;
        const t0 = Date.now();
        await c.send("Page.navigate", { url: base + route });
        await sleep(settle);
        if (waitFor) {
          for (let i = 0; i < 100; i++) {
            try {
              if (await c.evaluate(`!!(${waitFor})`)) break;
            } catch {}
            await sleep(200);
          }
          await sleep(300);
        }
        if (act) {
          try {
            await c.evaluate(act);
          } catch (e) {
            console.log(`   eval failed: ${String(e.message).slice(0, 200)}`);
          }
          await sleep(900);
        }
        let audit;
        try {
          audit = await c.evaluate(AUDIT);
        } catch (e) {
          audit = { error: String(e.message).slice(0, 200) };
        }
        const key = `${vp} ${route}`;
        const errors = c.logs.filter((l) => /^(error|exception)/.test(l)).map((l) => l.slice(0, 300));
        report[key] = { ...audit, errors, failed: [...failed], ms: Date.now() - t0 };
        if (shots) {
          const { data } = await c.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(join(out, `${vp}-${route.replace(/[/?=&]/g, "_") || "_"}${suffix ? `-${suffix}` : ""}.png`), Buffer.from(data, "base64"));
        }
        const a = report[key];
        const flags = [a.overflowX > 0 ? `overflowX ${a.overflowX}` : "", a.truncated?.length ? `truncated: ${a.truncated.join(" | ")}` : "", a.offscreen?.length ? `offscreen: ${a.offscreen.join(" | ")}` : "", a.small?.length ? `small: ${a.small.join(" | ")}` : "", errors.length ? `ERRORS: ${errors.join(" | ")}` : "", a.failed.length ? `failed: ${a.failed.join(" | ")}` : ""].filter(Boolean);
        console.log(`${key}${flags.length ? "\n   " + flags.join("\n   ") : "  ok"}`);
      }
    }
  } finally {
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
    await c.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
