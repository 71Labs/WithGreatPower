/**
 * Free roam (the City mode, `"roam"`, ruleset tag roam-2): a deterministic sim of the hero
 * moving freely through one fixed city (run, sprint, jump, vault, climb, wall-run, hang, mantle,
 * roll, web-zip and, on demand, swing), its people, side tasks and collectibles, everything it
 * draws in his way solid (furniture.ts) and its street traffic, which knocks him down (traffic.ts,
 * knock.ts). Its own files, reached only through SimState.roam; patrol nights and chapters never
 * touch it.
 */
export * from "./constants";
export type * from "./types";
export { ROAM_MOVES, TASK_DONE, TASK_IDS } from "./types";
export { createRoamSim, freshStart, stepRoam } from "./step";
export { fillRoamFrame, roamAction } from "./render";
export { roamHashState } from "./hash";
export { actTarget, BOT_HALF, CHAT_TICKS, type ActTarget } from "./tasks";
export { roamHeading } from "../parkour/move";
export { zipTarget, type ZipTarget } from "../parkour/zip";
export { clearAt, isRoamCity, MAST_H, MAST_HALF, ROAM_AC_H, ROAM_STOPS, roamCity, roamCityFurniture, roamGrid, roamWorld } from "./world";
export { ANTENNA_FOOT, ANTENNA_LIGHT, BRIDGE_RAIL, furnitureSolids, POLE_HALF, poleHalf, propSolids, ROAM_LAMP, ROAM_SIGNAL, ROOF_DOOR, TANK_LEG, TANK_LEG_SHARE, TANK_LEG_SPREAD, VENT } from "./furniture";
export type { FurniturePart, PartLook, RoamDrawnProp, RoamFurniture, SolidBox } from "./furniture";
export { greenLeft, placeCar, trafficLoops } from "./traffic";
export { knockPhase } from "./knock";
export { columnTop, ledgeOpen } from "../parkour/geometry";
export { roamBotFrame, newRoamBot, roamTour, streetRoute, type RoamBotGoal, type RoamBotMemory } from "./bot";
