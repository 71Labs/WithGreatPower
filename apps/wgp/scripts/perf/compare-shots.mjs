/**
 * SSIM and PSNR (ffmpeg) between matching PNGs in two folders of cast-shots.mjs output, and
 * optionally a strip per pair (a | b | the difference, amplified 8×) for the eye.
 *
 *   node apps/wgp/scripts/perf/compare-shots.mjs <dirA> <dirB> [--strips <outDir>]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const si = args.indexOf("--strips");
const strips = si < 0 ? null : args.splice(si, 2)[1];
const [a, b] = args;
if (strips) mkdirSync(strips, { recursive: true });

const rows = [];
for (const f of readdirSync(a).filter((x) => x.endsWith(".png")).sort()) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", join(a, f), "-i", join(b, f), "-lavfi", "[0][1]ssim;[0][1]psnr", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const ssim = Number(/SSIM .*All:([\d.]+)/.exec(log)?.[1]);
  const p = /PSNR .*average:([\d.]+|inf)/.exec(log)?.[1];
  rows.push({ f, ssim, psnr: p === "inf" ? Infinity : Number(p) });
  if (strips) spawnSync("ffmpeg", ["-v", "error", "-y", "-i", join(a, f), "-i", join(b, f), "-filter_complex", "[0]format=gbrp,split[a][a2];[1]format=gbrp,split[b][b2];[a][b]blend=all_mode=difference,lutrgb=r=val*8:g=val*8:b=val*8[d];[a2][b2][d]hstack=inputs=3", join(strips, f)]);
}
for (const r of rows) console.log(`${r.f.padEnd(30)} SSIM ${r.ssim.toFixed(5)}  PSNR ${r.psnr === Infinity ? "inf" : `${r.psnr.toFixed(2)} dB`}`);
const ssims = rows.map((r) => r.ssim);
const psnrs = rows.map((r) => r.psnr).filter((x) => x !== Infinity);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log(`\n${rows.length} pairs: SSIM min ${Math.min(...ssims).toFixed(5)}, mean ${mean(ssims).toFixed(5)}; PSNR min ${psnrs.length ? Math.min(...psnrs).toFixed(2) : "inf"} dB, mean ${psnrs.length ? mean(psnrs).toFixed(2) : "inf"} dB`);
