import { describe, it } from "vitest";

import { feeReport } from "./fee-metrics";

/** FEE_REPORT=1 pnpm --filter @wgp/game-core exec vitest run test/fee-report.test.ts */
describe.runIf(process.env.FEE_REPORT === "1")("Fee Strike report", () => {
  it("prints", () => {
    console.log(feeReport());
  }, 900_000);
});
