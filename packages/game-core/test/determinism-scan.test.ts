/**
 * The determinism ban, enforced by reading the source (there's no ESLint in this package).
 * In src/rules, src/sim3d and src/input, none of these may appear outside comments and
 * strings: Math.sin/cos/tan (and their inverses and hyperbolics), atan2, hypot, pow, exp,
 * log, cbrt, random, the ** operator, Date and performance. Engines may round transcendental
 * functions differently, and clocks or randomness would make a replay depend on when and
 * where it runs; dmath.ts provides the polynomial versions.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const DIRS = ["rules", "sim3d", "input"];

const BANNED: { name: string; re: RegExp }[] = [
  { name: "Math trig/transcendental", re: /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|asinh|acosh|atanh|hypot|pow|exp|expm1|log|log2|log10|log1p|cbrt|random)\b/ },
  { name: "the ** operator", re: /\*\*/ },
  { name: "Date", re: /\bDate\b/ },
  { name: "performance", re: /\bperformance\b/ },
];

/** The source with comments and string/template contents blanked out (newlines kept). */
export function codeOnly(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === "/" && d === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += c + blank(text.slice(i + 1, j)) + (j < n ? c : "");
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("the determinism scan", () => {
  it("catches each banned form and ignores comments and strings", () => {
    const bad = ["const a = Math.sin(x);", "const b = Math . atan2(y, x);", "const c = x ** 2;", "x **= 2;", "const d = Date.now();", "const e = performance.now();", "Math.random()", "Math.hypot(1, 2)", "Math.pow(2, 3)"];
    for (const line of bad) expect(BANNED.some((b) => b.re.test(codeOnly(line))), line).toBe(true);
    const fine = ["/** Math.sin is banned; so is ** */ const a = 1;", "// Date and performance", 'const s = "Math.cos and ** in a string";', "const t = `performance ${1}`;", "const u = Math.sqrt(x) * Math.floor(y);", "const updated = 1;"];
    for (const line of fine) expect(BANNED.some((b) => b.re.test(codeOnly(line))), line).toBe(false);
  });

  it("finds none of them in src/rules, src/sim3d or src/input", () => {
    const found: string[] = [];
    for (const d of DIRS) {
      for (const file of files(join(root, d))) {
        const lines = codeOnly(readFileSync(file, "utf8")).split("\n");
        lines.forEach((line, k) => {
          for (const b of BANNED) if (b.re.test(line)) found.push(`${file.slice(root.length)}:${k + 1} ${b.name}: ${line.trim()}`);
        });
      }
    }
    expect(found).toEqual([]);
  });
});
