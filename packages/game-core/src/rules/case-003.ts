/**
 * Case File 003, "Fee Strike": its content, in The Daily Rug's voice. The night itself is
 * sim3d/fee-strike.ts (setup), fee-chase.ts (the rooftop chase) and fee-strike-step.ts (the
 * flow); docs/chapters/case-003.md is the contract.
 *
 * The story (season arc "The Downloads"): Gas Goblin found an admin key in the Right-Clicker's
 * Downloads folder (`admin_key (1).txt`) and used it to hijack the Market District's fee meter.
 * Fees went through the roof; Aunt Mainnet's bakery can't pay for its own oven, the bread
 * stopped and the city got hangry. Follow the fee-bomb burns, hear out the stuck shopkeepers,
 * find the meter, chase him across the roofs to the bakery, beat him there, and cool the fees.
 */
import type { ChapterInfo } from "./chapters";
import type { ChapterId } from "./types";

export const FEE_STRIKE_ID = "case-003" satisfies ChapterId;
/** The case's rules version (`runs.ruleset` of every case-003 run). Bump it with any change to its sim. */
export const FEE_STRIKE_RULESET = "c003-1";

/** The case's three clues, in the order the city places them (any order to find). */
export type FeeClueId = "burn" | "pretzel" | "florist";

export const FEE_STRIKE_INFO: ChapterInfo = {
  id: FEE_STRIKE_ID,
  number: "003",
  title: "Fee Strike",
  ruleset: FEE_STRIKE_RULESET,
  badge: "case-003",
  villain: {
    name: "Gas Goblin",
    tagline: "Every block has its price. He sets it.",
    taunt: "Bread’s up nine thousand percent, web-head! Pay the fee or go hungry!",
    defeat: "Gas Goblin is webbed to Aunt Mainnet’s chimney. The admin key goes back where it came from.",
  },
  captive: { name: "Aunt Mainnet’s bakery", freed: "Fresh blocks, still warm." },
  clues: [
    { id: "burn", name: "Fee-bomb burns", note: "Scorch marks, still warm. Somebody’s been bombing the market with fees." },
    { id: "pretzel", name: "The pretzel cart", note: "“Pending since breakfast. Nine thousand gwei for one pretzel.”" },
    { id: "florist", name: "The florist", note: "“My roses wilted waiting for a confirmation. Check the fee meter.”" },
  ],
};

/** The case's other lines: the meter, the chase, the cooling and the ending. */
export const FEE_STRIKE_LINES = {
  meter: {
    name: "The fee meter",
    note: "The meter’s jammed at MAX. The key in it is labelled admin_key (1).txt. That file came out of the Right-Clicker’s Downloads.",
  },
  grab: "He’s got the meter! After him!",
  warn: "He’s getting away!",
  lost: "Lost him. Back to the last rooftop.",
  checkpoint: "Checkpoint.",
  showdown: "He’s landed on Aunt Mainnet’s roof. End this.",
  cool: "Hold web on the meter to cool the fees.",
  cooled: "Fees cooled. The ovens are back on.",
  escaped: "He got away with the meter.",
} as const;
