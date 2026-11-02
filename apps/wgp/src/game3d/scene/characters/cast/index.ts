/**
 * Every body the 3D scene can draw, by key.
 */
import type { CastDef, CharacterKey } from "../model";
import { AUNT, BEARSON, MARY, UNCLE_GEN } from "./allies";
import { GWEI, HERO } from "./heroes";
import { DOC_OCTOCHAIN, GOBLIN, SANDWICH, SYBIL, SYBIL_COPY } from "./villains";

export const CAST_DEFS: Record<CharacterKey, CastDef> = {
  hero: HERO,
  gwei: GWEI,
  "aunt-mainnet": AUNT,
  "uncle-gen": UNCLE_GEN,
  "mary-jpeg": MARY,
  bearson: BEARSON,
  "gas-goblin": GOBLIN,
  "sandwich-man": SANDWICH,
  "doc-octochain": DOC_OCTOCHAIN,
  sybil: SYBIL,
  "sybil-copy": SYBIL_COPY,
};

export const CHARACTER_KEYS = Object.keys(CAST_DEFS) as CharacterKey[];
