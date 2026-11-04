/**
 * The civilians' files: eight MPFB bodies (launch/brand/hero/civilians.py, CC0 MakeHuman) on
 * the cast's skeleton, and their motion (crowd-anims.glb, Quaternius' UAL, CC0), packed like
 * the cast's (scripts/models/compress.sh).
 *
 * - `civ-<id>.glb` holds the full body ("Body", about 2,500 triangles) and the light one
 *   ("BodyLo", about 1,000); `civ-<id>-lo.glb` the light one alone. Only the high tier
 *   fetches the full bodies.
 * - They load through the cast's queue (characters/files.ts) after everything else, so they
 *   never take bandwidth from the hero or the cast.
 */
import { loadCastAsset, type CastAsset } from "../characters/cast-asset";
import { HERO_ANIMS, loadHeroClips, type HeroClips } from "../characters/hero-asset";
import type { CivilianMeta } from "./looks";

/** The bodies, in the order the crowd numbers them. */
export const CIVILIANS = ["civ-office", "civ-jogger", "civ-elder", "civ-teen", "civ-auntie", "civ-worker", "civ-student", "civ-kid"] as const;
export type CivilianId = (typeof CIVILIANS)[number];

/** The crowd's moves (launch/brand/hero/crowd_anims.py). The walk comes from the hero's file. */
export const CROWD_ANIMS = "/models/crowd-anims.glb";

export function civilianUrl(id: CivilianId, full: boolean): string {
  return full ? `/models/${id}.glb` : `/models/${id}-lo.glb`;
}

export interface CrowdFiles {
  assets: CastAsset[];
  metas: CivilianMeta[];
  clips: HeroClips;
}

/** Merge the crowd's clips with the hero's walk, keeping the crowd file's rest pose. */
export function mergeCrowdClips(hero: HeroClips, crowd: HeroClips): HeroClips {
  const out: HeroClips = new Map(crowd);
  const walk = hero.get("walk");
  if (walk) out.set("walk", walk);
  out.pelvisRest = crowd.pelvisRest ?? hero.pelvisRest;
  out.restQ = crowd.restQ ?? hero.restQ;
  return out;
}

/** Fetch the bodies (`ids`, all by default; full ones too when `full`) and the clips; bodies that fail are left out. */
export async function loadCrowd(full: boolean, ids: readonly CivilianId[] = CIVILIANS): Promise<CrowdFiles | null> {
  const clipsP = Promise.all([loadHeroClips(HERO_ANIMS), loadHeroClips(CROWD_ANIMS)]);
  const bodies = await Promise.allSettled(ids.map((id) => loadCastAsset(civilianUrl(id, full))));
  let clips: HeroClips;
  try {
    const [hero, crowd] = await clipsP;
    clips = mergeCrowdClips(hero, crowd);
  } catch {
    return null;
  }
  const assets = bodies.flatMap((b) => (b.status === "fulfilled" ? [b.value] : []));
  if (!assets.length) return null;
  return { assets, metas: assets.map((a) => a.meta as CivilianMeta), clips };
}
