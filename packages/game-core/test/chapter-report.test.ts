import { describe, it } from "vitest";

import { chapterReport } from "./chapter-metrics";

/** CHAPTER_REPORT=1 pnpm --filter @wgp/game-core exec vitest run test/chapter-report.test.ts */
describe.runIf(process.env.CHAPTER_REPORT === "1")("chapter report", () => {
  it("prints", () => {
    console.log(chapterReport());
  }, 900_000);
});
