/**
 * Free roam (the City mode, `"roam"`, ruleset tag roam-2): a deterministic sim of the hero
 * moving freely through one fixed city (run, sprint, jump, vault, climb, wall-run, hang, mantle,
 * roll, web-zip and, on demand, swing), its people, side tasks and collectibles. Its own files,
 * reached only through SimState.roam; patrol nights and chapters never touch it.
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
export { clearAt, MAST_H, MAST_HALF, ROAM_AC_H, ROAM_STOPS, roamCity, roamGrid, roamWorld } from "./world";
export { columnTop, ledgeOpen } from "../parkour/geometry";
export { roamBotFrame, newRoamBot, roamTour, streetRoute, type RoamBotGoal, type RoamBotMemory } from "./bot";
