/**
 * WCAG AA contrast of every text/background pair a screen really renders, measured in
 * headless Chrome against a running WGP server:
 *
 *   node launch/brand/hero/contrast.mjs [--base http://127.0.0.1:4620] [--port 9921]
 *        [--routes /lab/economy,/play/market,/stats,/,/play] [--viewports desktop,phone]
 *        [--save hero] [--out <file.json>] [--eval "<js>"] [--all 1]
 *
 * For each visible text node it reads the element's computed colour (times every
 * ancestor's opacity) and composites the computed background colours behind it, nearest
 * first, until one is opaque. Where no opaque colour is found (text straight on the 3D
 * backdrop, a gradient or a picture), it takes a screenshot with the text hidden and reads
 * the pixels under the element instead, scoring the text against the worst tenth of them.
 * Text needs 4.5:1, or 3:1 at 24px and up (18.66px and up when bold). Disabled controls,
 * hidden and screen-reader-only text are skipped, as WCAG does.
 *
 * Prints one line per failing pair (and every pair with `--all 1`), a count per screen,
 * and exits 1 when anything fails. `--eval` runs in the page first (open a sheet, run the
 * lab). Needs launch/lib/cdp.mjs and launch/out/saves; from a worktree without them,
 * WGP_LAUNCH=<a checkout's launch/>.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
const BASE = opt("base", "http://127.0.0.1:4620");
const PORT = Number(opt("port", "9921"));
const ROUTES = opt("routes", "/lab/economy,/play/market,/stats,/,/play").split(",");
const VIEWPORTS = opt("viewports", "desktop,phone").split(",");
const SAVE = opt("save", "hero");
const OUT = opt("out", "");
const ACT = opt("eval", "");
const ALL = opt("all", "0") === "1";
const SETTLE = Number(opt("settle", "2500"));

const SIZES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  phone: { width: 375, height: 812, deviceScaleFactor: 1, mobile: true },
};

/** In the page: every visible text run in the viewport with its colour and the background behind it. */
const COLLECT = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; }
    const s = /color\\(srgb ([^)]+)\\)/.exec(c);
    if (s) { const p = s[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] === undefined ? 1 : p[3]]; }
    return null;
  };
  // Any colour space the stylesheet used, resolved to sRGB by the canvas.
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (c) => {
    const direct = parse(c);
    if (direct) return direct;
    probe.clearRect(0, 0, 1, 1); probe.fillStyle = "#000"; probe.fillStyle = c; probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim().replace(/\\s+/g, " ");
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    if (el.closest("script, style, noscript, nextjs-portal, [aria-hidden=true], .sr-only, :disabled, [aria-disabled=true]")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (cs.clip === "rect(0px, 0px, 0px, 0px)" || (parseFloat(cs.width) <= 1 && cs.overflow === "hidden")) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    // The element on top at the text's middle must be this one (or inside it / around it): otherwise it's covered.
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
    seen.add(el);
    let alpha = 1;
    const layers = [];
    let opaque = null;
    let picture = false;
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      alpha *= Number(s.opacity);
      if (opaque || picture) continue;
      if (s.backgroundImage && s.backgroundImage !== "none") { picture = true; continue; }
      const bg = rgba(s.backgroundColor);
      if (bg[3] >= 0.999) opaque = bg; else if (bg[3] > 0.001) layers.push(bg);
    }
    if (alpha < 0.05) continue;
    const fg = rgba(cs.color); fg[3] *= alpha;
    let bg = null;
    if (opaque) { bg = opaque; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg); }
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const where = el.closest("[id]")?.id || el.closest("section, header, footer, nav, main, dialog")?.tagName.toLowerCase() || "";
    out.push({ text: text.slice(0, 48), fg, bg, layers: bg ? null : layers, rect: [r.left, r.top, r.width, r.height], size, bold, large: size >= 24 || (bold && size >= 18.66), tag: el.tagName.toLowerCase(), cls: (el.getAttribute("class") || "").split(/\\s+/).filter((c) => /^(text-|bg-|opacity)/.test(c)).join(" "), where });
  }
  return out;
})()`;

/** In the page: the pixels of a screenshot under each rect, as sorted luminance-ordered samples. */
const SAMPLE = (dataUrl, rects, scale) => `(async () => {
  const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
  return ${JSON.stringify(rects)}.map(([x, y, w, h]) => {
    const X = Math.max(0, Math.floor(x * ${scale})), Y = Math.max(0, Math.floor(y * ${scale}));
    const W = Math.max(1, Math.min(c.width - X, Math.ceil(w * ${scale}))), H = Math.max(1, Math.min(c.height - Y, Math.ceil(h * ${scale})));
    const d = g.getImageData(X, Y, W, H).data; const px = [];
    const step = Math.max(1, Math.floor((W * H) / 400));
    for (let i = 0; i < W * H; i += step) px.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
    return px;
  });
})()`;

const lin = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const chrome = await launch({ port: PORT, profile: `/private/tmp/claude-501/wgp-contrast-${PORT}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { send, evaluate } = chrome;
const report = [];
let failures = 0;
try {
  await send("Page.enable");
  await send("Runtime.enable");
  if (SAVE !== "none") {
    const json = readFileSync(join(LAUNCH, "out", "saves", `${SAVE}.json`), "utf8");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { if (!localStorage.getItem("wgp:save:v1")) localStorage.setItem("wgp:save:v1", ${JSON.stringify(json)}); } catch {}` });
  }
  for (const vp of VIEWPORTS) {
    const v = SIZES[vp];
    await send("Emulation.setDeviceMetricsOverride", v);
    await send("Emulation.setTouchEmulationEnabled", { enabled: v.mobile, maxTouchPoints: 5 });
    for (const route of ROUTES) {
      await send("Page.navigate", { url: BASE + route });
      await sleep(SETTLE);
      for (let i = 0; i < 60 && !(await evaluate(`document.readyState === "complete"`).catch(() => false)); i++) await sleep(250);
      await sleep(600);
      if (ACT) {
        await evaluate(`(async () => { ${ACT} })()`);
        await sleep(1200);
      }
      const pairs = new Map();
      const height = await evaluate(`document.documentElement.scrollHeight`);
      for (let y = 0; y < height; y += v.height - 80) {
        await evaluate(`window.scrollTo(0, ${y})`);
        await sleep(350);
        const items = await evaluate(COLLECT);
        const loose = items.filter((it) => !it.bg);
        if (loose.length) {
          // Hide the text and read what is really behind it.
          await evaluate(`(() => { const st = document.createElement("style"); st.id = "wgp-contrast-hide"; st.textContent = "body, body * { color: transparent !important; text-shadow: none !important; -webkit-text-stroke-color: transparent !important; caret-color: transparent !important; }"; document.head.appendChild(st); })()`);
          await sleep(120);
          const { data } = await send("Page.captureScreenshot", { format: "png" });
          await evaluate(`document.getElementById("wgp-contrast-hide")?.remove()`);
          const samples = await evaluate(SAMPLE(`data:image/png;base64,${data}`, loose.map((it) => it.rect), v.deviceScaleFactor));
          loose.forEach((it, i) => {
            it.samples = samples[i];
          });
        }
        for (const it of items) {
          let bg;
          let r;
          if (it.bg) {
            bg = it.bg.slice(0, 3);
            r = ratio(over(it.fg, bg), bg);
          } else {
            // Each pixel under the text, with any translucent layers over it; the worst tenth decides.
            const scored = it.samples
              .map((px) => {
                let under = px;
                for (let i = it.layers.length - 1; i >= 0; i--) under = over(it.layers[i], under);
                return { under, r: ratio(over(it.fg, under), under) };
              })
              .sort((a, b) => a.r - b.r);
            const worst = scored[Math.floor(scored.length * 0.1)] ?? scored[0];
            bg = worst.under;
            r = worst.r;
          }
          const need = it.large ? 3 : 4.5;
          const key = `${hex(over(it.fg, bg))}|${it.bg ? hex(bg) : "picture"}|${it.large ? "large" : "body"}|${it.cls}`;
          const prev = pairs.get(key);
          if (!prev || r < prev.ratio) pairs.set(key, { fg: hex(over(it.fg, bg)), bg: `${hex(bg)}${it.bg ? "" : " (sampled)"}`, ratio: Math.round(r * 100) / 100, need, pass: r >= need, size: `${Math.round(it.size * 10) / 10}px${it.bold ? " bold" : ""}`, sample: it.text, classes: it.cls, where: it.where, count: (prev?.count ?? 0) + 1 });
          else prev.count += 1;
        }
      }
      const rows = [...pairs.values()].sort((a, b) => a.ratio - b.ratio);
      const bad = rows.filter((p) => !p.pass);
      failures += bad.length;
      report.push({ viewport: vp, route, pairs: rows.length, failing: bad.length, lowest: rows[0]?.ratio ?? null, rows });
      console.log(`${vp.padEnd(8)} ${route.padEnd(14)} ${String(rows.length).padStart(3)} pairs, ${bad.length} failing, lowest ${rows[0]?.ratio ?? "-"}:1`);
      for (const p of ALL ? rows : bad) console.log(`   ${p.pass ? "ok  " : "FAIL"} ${String(p.ratio).padStart(5)}:1 (needs ${p.need}) ${p.fg} on ${p.bg} ${p.size} ×${p.count} “${p.sample}” [${p.classes}] ${p.where}`);
    }
  }
} finally {
  await chrome.close();
}
if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), report }, null, 2));
process.exit(failures ? 1 : 0);
