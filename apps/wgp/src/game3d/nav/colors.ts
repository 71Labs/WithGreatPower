/**
 * The map's colours by role, shared by the minimap, the full city map and the pickups in
 * the scene (so a gold dot on the map is the gold token in the city). The map is a paper
 * sticker like the rest of the HUD: paper lots, buildings in the night's blues getting
 * darker as they get taller, the river and the bridge as the city paints them.
 */
import { CITY, INK, PAPER, STICKER_EDGE } from "@/game/style";

export const NAV_COLORS = {
  ink: INK,
  paper: PAPER,
  edge: STICKER_EDGE,
  /** The light card behind a character's face in its sticker (as --vs-sticker). */
  card: "#ECECEA",
  /** Streets: the ground between the lots. */
  street: "#E6E1F0",
  /** A block's lot around its buildings. */
  lot: PAPER,
  /** Building fills: the lowest roof, then the tallest. */
  buildingLow: "#C9CDF0",
  buildingHigh: CITY.rooftop,
  water: "#79B3F2",
  waterEdge: "#3E6FC4",
  bridge: CITY.bridge,
  /** The route: the leg you're on, then the legs after it. */
  route: INK,
  routeLater: "rgba(20, 20, 20, 0.4)",
  /** The stop you're heading for: its ring and pulse. */
  next: "#D62E21",
  /** Pickups: Bits tokens (and their inner ring), boost rings. */
  bits: CITY.windowLit,
  bitsDeep: "#E9A23B",
  ring: "#2FD3F0",
  /** A stop that's done, on the full map (and a case's clue once found). */
  done: "#16A36A",
  /** A case's clue still out there: the game's reward gold (--game-gold), with a magnifier on it. */
  clue: "#FFD95A",
  /** Free roam: a task giver's marker (the game's gold), Mary Jpeg's lost pixel, Gas Goblin's tag. */
  giver: "#FFD95A",
  pixel: "#4FC3F7",
  tag: "#7CD957",
  /** A race gate's hoop (a numbered ring), and a relay's box with its lit plug (it goes dark once unplugged). */
  gate: "#8B5CF6",
  relay: "#2A2A2A",
  relayLit: "#FFD95A",
} as const;
