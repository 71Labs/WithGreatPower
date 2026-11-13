import type { CastId, Role } from "@wgp/game-core/cast";
import { DISTRICTS, ERRANDS, VILLAINS } from "@wgp/game-core/data";
import type { VillainId } from "@wgp/game-core/types";

/** The album's pages, in the order they're shown. */
export const GROUPS: { role: Role; title: string; blurb: string }[] = [
  { role: "Hero", title: "Heroes", blurb: "You and the original." },
  { role: "Vendor", title: "Vendor", blurb: "Gwei Stacy runs the Mempool Market stall, and swings in once a night if you call." },
  { role: "Ally", title: "Allies", blurb: "The neighbors. Help them out on errands." },
  { role: "Press", title: "Press", blurb: "The Daily Rug’s editor. He wants a quote." },
  { role: "Villain", title: "Villains", blurb: "Catch them on patrol. They come back anyway." },
];

const HER: CastId[] = ["gwei", "aunt-mainnet", "mary-jpeg"];

export const isVillain = (id: CastId): id is VillainId => id in VILLAINS;

/** The Node is in every album from the first night: the legend you're named after. */
export const ALWAYS: CastId = "node";

/** How to earn a sticker you don't have yet, with where to look. */
export function howToGet(id: CastId): string {
  const pronoun = HER.includes(id) ? "her" : "him";
  if (isVillain(id)) return `Catch ${pronoun} on patrol in ${DISTRICTS[VILLAINS[id].district].name}.`;
  const errand = ERRANDS.find((e) => e.ally === id);
  const where = errand ? ` in ${DISTRICTS[errand.district].name}` : "";
  if (id === "gwei") return `Team up with her on an errand${where}.`;
  return `Meet ${pronoun} on an errand${where}.`;
}

/** "Caught ×3" for villains, "Met ×2" for everyone else. */
export const countLabel = (id: CastId, n: number) => `${isVillain(id) ? "Caught" : "Met"} ×${n}`;
