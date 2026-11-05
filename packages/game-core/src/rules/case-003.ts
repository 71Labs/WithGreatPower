/**
 * Case File 003, "Fee Strike": its content, in The Daily Rug's voice. The night itself is
 * sim3d/fee-strike.ts (setup), fee-chase.ts (the rooftop chase) and fee-strike-step.ts (the
 * flow); docs/chapters/case-003.md is the contract, docs/story/bible.md the season's canon.
 *
 * The story (season arc "The Downloads"): when the Right-Clicker's Downloads folder burst on
 * Doc's bridge, Gas Goblin bought `recipes_DO_NOT_SHARE (1).pdf`, Aunt Mainnet's recipe book. He
 * read page 41, the Never-Goes-Down Loaf, decided "never goes down" meant fees, and keyed the
 * page into the Mempool Market's fee meter as its admin key. Fees jammed at MAX; Aunt Mainnet's
 * bakery can't pay for its own oven's transactions; the bread stopped and the city got hangry.
 * Follow the fee-bomb burns, hear out the stuck shopkeepers, find the meter, chase him across
 * the roofs to the bakery, beat him there, and cool the fees.
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
    taunt: "Fees are up five hundred percent, web-head! I rounded up!",
    defeat: "Gas Goblin is out of gas. Fees drop. The oven warms.",
  },
  captive: { name: "Aunt Mainnet’s bakery", freed: "Fresh blocks, still warm." },
  clues: [
    { id: "burn", name: "Fee-bomb burns", note: "Green soot, still warm, in a trail across the roofs. Glider exhaust. Smells like four hundred percent." },
    { id: "pretzel", name: "The pretzel cart", note: "“Pending since breakfast. Fee: 400,000,000,000 gwei, for one pretzel. Gwei Stacy circled it twice.”" },
    { id: "florist", name: "The florist", note: "“My roses wilted waiting for a confirmation. A fella with a glider keeps reading the fee meter and cackling.”" },
  ],
};

/** The case's other lines: the meter, the chase, the cooling, the ending and its thread. */
export const FEE_STRIKE_LINES = {
  meter: {
    name: "The fee meter",
    note: "Jammed at MAX. Its admin key is page 41 of recipes_DO_NOT_SHARE (1).pdf, Aunt Mainnet’s Never-Goes-Down Loaf. Straight out of the Right-Clicker’s Downloads.",
  },
  grab: "He’s got the meter! After him!",
  warn: "He’s getting away!",
  lost: "Lost him. Back to the last rooftop.",
  checkpoint: "Checkpoint.",
  showdown: "He’s landed on Aunt Mainnet’s roof. End this.",
  cool: "Hold web on the meter to cool the fees.",
  cooled: "Fees cooled. The ovens are back on.",
  escaped: "He got away with the meter.",
  /** Her quiet beat at the end: a slice for the Node, and one for the webbed Goblin. */
  slice: "Everybody eats, dear.",
  /** The thread to Case File 004, found in his glider's saddlebag. */
  thread: "A receipt in his saddlebag: “Sold by Doc’s Bridge Co. Shipped cross-chain. 8 arms, 0 refunds.” Gwei Stacy goes quiet. “Where did he get this?”",
  /** The recovered Downloads file and the badge's sticker. */
  file: "recipes_DO_NOT_SHARE (1).pdf",
  badge: "Never goes down",
} as const;
