/**
 * The cast of With Great Power. Every character is an original parody design; none
 * uses another studio's names, logos or artwork. Draft copy until the build document's
 * cast lands here.
 */
export type CastId =
  | "node"
  | "gwei"
  | "uncle-gen"
  | "aunt-mainnet"
  | "bearson"
  | "mary-jpeg"
  | "gas-goblin"
  | "doc-octochain"
  | "sandwich-man"
  | "sybil";

/** The label under a name in every cast list. Display only: the sim never reads it. */
export type Role = "Hero" | "Vendor" | "Ally" | "Press" | "Villain";

export interface CastMember {
  id: CastId;
  name: string;
  role: Role;
  /** One line of bio, shown under the sticker. */
  line: string;
}

export const CAST: CastMember[] = [
  {
    id: "node",
    name: "The Node",
    role: "Hero",
    line: "Your friendly neighborhood validator. Bitten by a radioactive node; hasn’t missed a block since.",
  },
  {
    id: "gwei",
    name: "Gwei Stacy",
    // She runs the Mempool Market stall: the vendor everywhere she appears, and backup on one errand.
    role: "Vendor",
    line: "Swung in from another chain. Still counts everything in gwei.",
  },
  {
    id: "uncle-gen",
    name: "Uncle Gen",
    role: "Ally",
    line: "Said the thing about great power. Says it at every dinner.",
  },
  {
    id: "aunt-mainnet",
    name: "Aunt Mainnet",
    role: "Ally",
    line: "Never goes down. Bakes on weekends.",
  },
  {
    id: "bearson",
    name: "J. Jonah Bearson",
    role: "Press",
    line: "Editor of The Daily Rug. Thinks The Node is a menace. Short everything.",
  },
  {
    id: "mary-jpeg",
    name: "Mary Jpeg",
    role: "Ally",
    line: "Extremely online. Slightly compressed.",
  },
  {
    id: "gas-goblin",
    name: "Gas Goblin",
    role: "Villain",
    line: "Spikes the fees, then cackles about it from a glider.",
  },
  {
    id: "doc-octochain",
    name: "Doc Octochain",
    role: "Villain",
    line: "Eight arms, eight chains, one very bad bridge.",
  },
  {
    id: "sandwich-man",
    name: "Sandwich Man",
    role: "Villain",
    line: "Gets in front of your trade. And right behind it.",
  },
  {
    id: "sybil",
    name: "The Sybil",
    role: "Villain",
    line: "There are thousands of him. Every one of them is him.",
  },
];

export const castById = (id: CastId) => CAST.find((c) => c.id === id)!;
