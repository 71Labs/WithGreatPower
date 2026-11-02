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
  type AnchorPick,
  type Box,
  type RayHit,
  type RoofEdge,
  type SphereHit,
} from "./city";
export { createSim, debugSetHp, debugWin, IDLE_FRAME, resolveErrand, simRunning, stepSim } from "./sim";
export { abilityBlocked, cooldownSeconds, gweiBlocked } from "./abilities";
export { arenaZone, bestAnchor, heroHeading, inArena, stopTarget, travelBearing } from "./hero";
export { docVulnerable, isVulnerable, nearestTarget, villainHits, villainTargets, type Target } from "./combat";
export { armTip, villainLines } from "./villains";
export { botFrame, newBotMemory, type BotMemory } from "./bot";
export { fillRenderFrame, newRenderFrame } from "./render";
