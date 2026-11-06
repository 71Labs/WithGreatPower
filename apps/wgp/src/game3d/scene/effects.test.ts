import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BURST_WORDS } from "./effects";

/** Every .ts file under the scene (tests aside). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("the comic bursts", () => {
  it("has every word free roam pops in the atlas (an unknown one would draw as POW!)", () => {
    const dir = fileURLToPath(new URL("./roam/", import.meta.url));
    const words = new Set<string>();
    for (const file of sources(dir)) {
      for (const m of readFileSync(file, "utf8").matchAll(/\.burst\(\s*"([^"]+)"/g)) words.add(m[1]);
      for (const m of readFileSync(file, "utf8").matchAll(/\.burst\([^,]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g)) {
        words.add(m[1]);
        words.add(m[2]);
      }
    }
    for (const w of ["GOT IT!", "SNAP!", "PIXEL!", "SYNCED!", "GOTCHA!"]) expect(words.has(w), w).toBe(true);
    for (const w of words) expect(w in BURST_WORDS, w).toBe(true);
  });
});
