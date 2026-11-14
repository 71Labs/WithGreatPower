import { describe, expect, it } from "vitest";

import { quickPlayProblem } from "./errors";

describe("quickPlayProblem", () => {
  it("points an empty gas tank at /gas, without saying relayer", () => {
    const p = quickPlayProblem({ error: "relayer_empty", message: "The relayer is out of funds" });
    expect(p).toMatchObject({ href: "/gas", action: "Refill the gas tank" });
    expect(p.text).toMatch(/gas tank/);
    expect(p.text).not.toMatch(/relayer|funds/i);
  });

  it("keeps a spent daily budget as a wait, with no link", () => {
    const p = quickPlayProblem({ error: "budget_exhausted" });
    expect(p.text).toMatch(/Try again later/);
    expect(p.href).toBeUndefined();
  });
});
