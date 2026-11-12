import { describe, expect, it } from "vitest";

import { IMPORT_CAPS } from "@/game/import-caps";

import { keepLine } from "./guest-night-next";

describe("what the sign-in prompt promises a guest", () => {
  it("says the hero keeps its level and bag when both fit the import", () => {
    expect(keepLine({ name: "The Node", level: 2 }, 3)).toBe("The Node comes with you: keeps level 2, with their powers, suits and all 3 items in the bag.");
    expect(keepLine({ name: "The Node", level: 1 }, 1)).toContain("the item in the bag");
    expect(keepLine({ name: "The Node", level: 1 }, 0)).toBe("The Node comes with you: keeps level 1, with their powers and suits.");
  });

  it("states the caps when the import would trim the hero", () => {
    const line = keepLine({ name: "Gwen Gas", level: IMPORT_CAPS.level + 2 }, IMPORT_CAPS.totalItems + 5);
    expect(line).toContain(`arrives at level ${IMPORT_CAPS.level}`);
    expect(line).toContain(`${IMPORT_CAPS.totalItems} of the ${IMPORT_CAPS.totalItems + 5} items`);
  });

  it("never promises a hero that isn't there", () => {
    expect(keepLine(null, 0)).toBe("Your hero comes with you the first time you sign in.");
  });
});
