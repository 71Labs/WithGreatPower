/**
 * The 3D swing sim's public API: pure, deterministic, no DOM. The scene reads City and
 * the state; the session loop drives runs through replay.ts.
 */
export * from "./constants";
export type * from "./contract";
export type * from "./types";
export { clamp, datan2, dcos, DIR64, dirIndex, dsin, len2, len3, MAG_SCALE, quantizeStick, wrapAngle } from "./dmath";
export {
  blockCenter,
  cablePoint,
  CityIndex,
  collideSphere,
  FACING_DIR,
  findAnchor,
  generateCity,
  groundBelow,
  overRiver,
  raycastCity,
  supportAt,
  supported,
  type AnchorPick,
  type Box,
  type RayHit,
  type RoofEdge,
  type SphereHit,
} from "./city";
export { createSim, debugSetHp, debugWin, IDLE_FRAME, resolveErrand, simRunning, stepSim } from "./sim";
export { abilityBlocked, cooldownSeconds, gweiBlocked } from "./abilities";
export { arenaZone, bestAnchor, heroHeading, inArena, stopTarget, travelBearing } from "./hero";
export { docVulnerable, inOpening, isVulnerable, nearestTarget, takesHit, villainHits, villainTargets, type Target } from "./combat";
export { fightPress, type FightPress } from "./strike";
export { armShoulder, armTip, villainLines } from "./villains";
export { inReleaseWindow, pickForecast } from "./swing";
export { comboMultiplier, nextPickup, placePickups } from "./pickups";
export { botFrame, newBotMemory, type BotMemory } from "./bot";
export { fillRenderFrame, heroAction, newRenderFrame } from "./render";
export {
  besideCaptive,
  CHAPTER_DECK_HALF,
  CHAPTER_HITS,
  CHAPTER_LEVEL,
  chapterCity,
  chapterLogRuleset,
  chapterStops,
  CLUE_REACH,
  CLUE_TALL,
  COPY_HALF_H,
  COPY_RADIUS,
  FREED_SECONDS,
  MARY_ALONG,
  nextClue,
  RESTORE_REACH,
  RESTORE_TICKS,
} from "./chapter";
export { AIM_SECONDS, DRAG_RANGE, inShotCone, RECOVER_SECONDS, SAVED_FREEZE, SHOT_HALF, SHOT_RANGE } from "./right-clicker";
