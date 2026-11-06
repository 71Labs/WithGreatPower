/** Case File 002's balance table (vote-metrics.ts). VOTE_REPORT=1 prints it; otherwise skipped. */
import { describe, it } from "vitest";

import { voteReport } from "./vote-metrics";

describe.skipIf(process.env.VOTE_REPORT !== "1")("Case File 002 report", () => {
  it("prints the table", () => {
    console.log(`\n${voteReport()}\n`);
  }, 600_000);
});
