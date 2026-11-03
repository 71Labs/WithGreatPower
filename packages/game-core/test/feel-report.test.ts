import { describe, it } from "vitest";

import { feelReport } from "./feel-metrics";

describe.runIf(process.env.FEEL_REPORT === "1")("feel report", () => {
  it("prints", () => {
    console.log(JSON.stringify(feelReport(), null, 2));
  }, 600_000);
});
