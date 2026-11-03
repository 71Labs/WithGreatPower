/**
 * What JavaScript a page ships before it hydrates: the scripts its HTML names, each with its raw and
 * Brotli size, and the heavy libraries found in it (by a marker string each leaves behind).
 *
 *   node apps/wgp/scripts/perf/chunks.mjs [--base http://localhost:3691] [/ /play /play/patrol ...]
 *
 * Reads the built chunks from apps/wgp/.next/static, so run it against the build being served.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const bi = args.indexOf("--base");
const base = bi < 0 ? "http://localhost:3691" : args.splice(bi, 2)[1];
const paths = args.length ? args : ["/", "/play", "/play/patrol"];

/** Marker strings: one distinctive literal per library. */
const MARKERS = {
  three: "WebGLRenderer",
  "react-three-fiber": "R3F: Hooks can only be used within the Canvas component",
  privy: "privy.io",
  "near-api-js": "near-api-js",
  "game-core sim3d": "fillRenderFrame",
  "2D renderer": "CityBackdrop",
  zod: "ZodError",
};

const br = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }).length;

for (const path of paths) {
  const html = await (await fetch(base + path)).text();
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]))];
  let raw = 0;
  let comp = 0;
  const rows = [];
  for (const u of urls) {
    const file = join(APP, ".next", "static", u.slice("/_next/static/".length));
    if (!existsSync(file)) continue;
    const b = readFileSync(file);
    const s = b.toString("utf8");
    const libs = Object.entries(MARKERS)
      .filter(([, m]) => s.includes(m))
      .map(([k]) => k);
    const c = br(b);
    raw += b.length;
    comp += c;
    rows.push(`  ${String(b.length).padStart(8)} ${String(c).padStart(7)} br  ${u.split("/").pop()}${libs.length ? `  [${libs.join(", ")}]` : ""}`);
  }
  console.log(`${path}: ${urls.length} scripts, ${raw} bytes raw, ${comp} Brotli`);
  console.log(rows.join("\n"));
}
