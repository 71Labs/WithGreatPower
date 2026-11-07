/**
 * The City map played with real touches on an emulated phone (or the wheel and a mouse on a
 * desktop) against a running WGP server: the HUD with its minimap, the map opened from the
 * minimap, a pinch out, a drag, Center on me, the Key tab and the drawer folded away; with
 * `--marks race|relays` (a development server only) the fixture v1.9 marks on the map, the
 * minimap and the waypoint. The save is launch/out/saves/hero.json with a city half done (one
 * task finished, two under way, some pages and masts). Reads the map's camera back from the
 * pins' places.
 *
 *   node launch/brand/hero/city-map.mjs [--viewport landscape|portrait|desktop] [--marks race] [--label after] [--base http://127.0.0.1:4030] [--cdp 9430] [--act 1]
 *
 * `--act 1` presses E once the city is up (with a `--save` whose record stands the hero beside
 * Gwei Stacy, that starts her race, so the map shows the real gates, not a fixture's).
 *
 * Writes <out>/<label>-<viewport>[-marks]-{hud,map,zoomed,centred,key,drawer-hidden}.png and -mapplay.json.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "/Users/eromonseleodigie/near-hackathon/launch/lib/cdp.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? d : args[i + 1];
};
const base = opt("base", "http://127.0.0.1:4030");
const vp = opt("viewport", "landscape");
const marks = opt("marks", null);
const label = opt("label", "after");
const steady = opt("steady", null);
const out = opt("out", "launch/brand/hero/game-shots/city-map-look");
const cdpPort = Number(opt("cdp", "9430"));
const act = opt("act", null);
mkdirSync(out, { recursive: true });
const V = vp === "landscape" ? { width: 915, height: 412 } : vp === "desktop" ? { width: 1440, height: 900, desktop: true } : { width: 412, height: 915 };
const c = await launch({ port: cdpPort, profile: `/private/tmp/claude-501/wgp-ux-cdp-${cdpPort}`, flags: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const report = { viewport: V, marks, steps: [] };
try {
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  if (V.desktop) await c.send("Emulation.setDeviceMetricsOverride", { width: V.width, height: V.height, deviceScaleFactor: 1, mobile: false });
  else {
    await c.send("Emulation.setDeviceMetricsOverride", { width: V.width, height: V.height, deviceScaleFactor: 2, mobile: true, screenOrientation: V.width > V.height ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await c.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l" });
  }
  await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (steady) await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  // A city half done: one task finished, two under way (some items found), pages and masts.
  const hero = JSON.parse(readFileSync(opt("save", "/Users/eromonseleodigie/near-hackathon/launch/out/saves/hero.json"), "utf8"));
  hero.city ??= { tasks: { bread: 9, pixels: 1, graffiti: 1 }, items: { pixels: 5, graffiti: 1 }, pages: 11, views: 3, xp: 0, at: null, outings: 1 };
  const save = JSON.stringify(hero);
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("wgp:save:v1", ${JSON.stringify(save)}); localStorage.removeItem("wgp:3d-settings:v1"); } catch {}` });
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "nextjs-portal { display: none !important; } pre[aria-live=off] { display: none !important; }"; document.head.appendChild(st); });` });
  await c.send("Page.navigate", { url: `${base}/play/city?debug=1&tier=low${marks ? `&marks=${marks}` : ""}` });
  const until = async (js, ms = 120000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await c.evaluate(`!!(${js})`)) return;
      } catch {}
      await sleep(150);
    }
    throw new Error("timeout " + js + "\n" + c.logs.slice(-10).join("\n"));
  };
  await until(`window.__wgpCity && window.__wgpCity.peek().status === "live" && window.__wgpCity.handle() && window.__wgpCity.handle().pose()`);
  await sleep(9000);
  if (act) {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyE", key: "e", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
    await sleep(60);
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyE", key: "e", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
    await sleep(1500);
    report.afterAct = await c.evaluate(`(() => { const f = window.__wgpCity.loop.view.roam; return { marks: (f.marks ?? []).map((m) => m.task + ":" + m.kind + (m.done ? ":done" : "") + (m.next ? ":next" : "")), race: f.race ? { heroGate: f.race.heroGate, rivalGate: f.race.rivalGate, over: f.race.over } : null }; })()`);
    console.log("  after act", JSON.stringify(report.afterAct));
  }
  const tag = `${label}-${vp}${marks ? `-${marks}` : ""}${steady ? "-steady" : ""}`;
  const shot = async (name) => {
    const { data } = await c.send("Page.captureScreenshot", { format: "png" });
    const f = join(out, `${tag}-${name}.png`);
    writeFileSync(f, Buffer.from(data, "base64"));
    console.log("  " + f);
  };
  const fingers = new Map();
  const touch = async (type, id, x, y) => {
    const p = { x: Math.round(x), y: Math.round(y), id, radiusX: 8, radiusY: 8, force: 1 };
    if (type === "touchEnd") {
      fingers.delete(id);
      await c.send("Input.dispatchTouchEvent", { type, touchPoints: [p] });
      return;
    }
    fingers.set(id, p);
    await c.send("Input.dispatchTouchEvent", { type, touchPoints: [...fingers.values()] });
  };
  const click = async (x, y) => {
    if (V.desktop) {
      await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    } else {
      await touch("touchStart", 20, x, y);
      await sleep(60);
      await touch("touchEnd", 20, x, y);
    }
  };
  const centreOf = (sel) => c.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
  /** Where the hero's pin and a viewpoint's pin are on screen: the map camera, read back. */
  const camera = () =>
    c.evaluate(`(() => { const you = document.querySelector('[data-pin="you"]').getBoundingClientRect(); const v = [...document.querySelectorAll('[data-pin="view"]')].map((e) => e.getBoundingClientRect()); const spread = v.length > 1 ? Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) : 0; const pane = document.querySelector('[data-map-view]').getBoundingClientRect(); return { you: { x: Math.round(you.x - pane.x), y: Math.round(you.y - pane.y) }, viewSpread: Math.round(spread), pane: { w: Math.round(pane.width), h: Math.round(pane.height) } }; })()`);
  const step = async (name, extra = {}) => {
    const cam = await camera();
    report.steps.push({ name, ...cam, ...extra });
    console.log(`  ${name}: ${JSON.stringify(cam)}`);
  };

  await shot("hud");
  const mini = await centreOf('button[aria-label^="Open the city map"]');
  report.minimap = mini;
  await click(mini.x, mini.y);
  await sleep(1200);
  await shot("map");
  await step("opened");
  const pane = await centreOf("[data-map-view]");
  // Pinch out about the pane's middle: two fingers 60 px apart spread to 220 px.
  if (!V.desktop) {
    const cx = pane.x;
    const cy = pane.y;
    await touch("touchStart", 1, cx - 30, cy);
    await touch("touchStart", 2, cx + 30, cy);
    for (let i = 1; i <= 16; i++) {
      await sleep(16);
      const d = 30 + i * 5;
      fingers.set(1, { ...fingers.get(1), x: Math.round(cx - d) });
      fingers.set(2, { ...fingers.get(2), x: Math.round(cx + d) });
      await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [...fingers.values()] });
    }
    await touch("touchEnd", 1, cx - 110, cy);
    await touch("touchEnd", 2, cx + 110, cy);
  } else {
    for (let i = 0; i < 6; i++) {
      await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: pane.x, y: pane.y, deltaX: 0, deltaY: -120 });
      await sleep(30);
    }
  }
  await sleep(400);
  await step("pinched out");
  await shot("zoomed");
  // Drag to pan: one finger 120 px left and 60 px up.
  if (!V.desktop) {
    await touch("touchStart", 3, pane.x, pane.y);
    for (let i = 1; i <= 12; i++) {
      await sleep(16);
      await touch("touchMove", 3, pane.x - i * 10, pane.y - i * 5);
    }
    await touch("touchEnd", 3, pane.x - 120, pane.y - 60);
  } else {
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pane.x, y: pane.y, button: "left", clickCount: 1 });
    for (let i = 1; i <= 12; i++) await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pane.x - i * 10, y: pane.y - i * 5, button: "left", buttons: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pane.x - 120, y: pane.y - 60, button: "left", clickCount: 1 });
  }
  await sleep(300);
  await step("dragged 120 px left, 60 px up");
  const me = await centreOf('button[aria-label="Center on me"]');
  await click(me.x, me.y);
  await sleep(400);
  await step("center on me");
  await shot("centred");
  const key = await centreOf('[role="tab"][id$="-tab-key"]');
  if (key) {
    await click(key.x, key.y);
    await sleep(400);
    await shot("key");
  }
  const hide = await centreOf('button[aria-label="Hide the task list"]');
  await click(hide.x, hide.y);
  await sleep(500);
  await step("drawer hidden");
  await shot("drawer-hidden");
  const sc = await c.evaluate(`({ scrollX, scrollY, zoom: window.visualViewport ? window.visualViewport.scale : null })`);
  report.pageScrollZoom = sc;
  console.log("  page scroll/zoom", JSON.stringify(sc));
  const errs = c.logs.filter((l) => /error|exception/i.test(l));
  report.consoleErrors = errs;
  writeFileSync(join(out, `${tag}-mapplay.json`), JSON.stringify(report, null, 1));
  console.log(errs.length ? errs.slice(0, 8).join("\n") : "no console errors");
} finally {
  await c.close();
}
