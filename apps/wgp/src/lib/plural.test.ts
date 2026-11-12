import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { noun, plural } from "./plural";

describe("plural", () => {
  it.each([
    [0, "trade", undefined, "0 trades"],
    [1, "trade", undefined, "1 trade"],
    [2, "trade", undefined, "2 trades"],
    [1, "hero", "heroes", "1 hero"],
    [2, "hero", "heroes", "2 heroes"],
    [1_204, "hero", "heroes", "1,204 heroes"],
    [1, "try", "tries", "1 try"],
    [3, "try", "tries", "3 tries"],
    [1, "new power", undefined, "1 new power"],
    [21, "day", undefined, "21 days"],
  ] as const)("%i %s → %s", (n, one, many, text) => {
    expect(plural(n, one, many)).toBe(text);
  });

  it("noun gives the word alone, for a count printed elsewhere", () => {
    expect(noun(1, "point")).toBe("point");
    expect(noun(0, "point")).toBe("points");
    expect(noun(2, "hero", "heroes")).toBe("heroes");
  });
});

describe("no screen hard-codes a count's plural", () => {
  /** Every source file of the app, tests aside. */
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) sources(path, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  }
  const SRC = join(__dirname, "..");

  it("“N trades today” and its cousins go through plural()", () => {
    // A count straight from data, then a bare plural noun: the judge's "1 trades today".
    const risky = /\{(?:formatBits\()?[\w.]*(?:trades24h|\.total|\.length|count|picks|hidden)\)?\} (trades|heroes|items|runs|listings|moves|pages|powers|picks)\b/;
    const offenders = sources(SRC).filter((file) => risky.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("nobody keeps a private plural helper", () => {
    const own = /const plural = \(n: number, word: string\)/;
    const offenders = sources(SRC).filter((file) => own.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
