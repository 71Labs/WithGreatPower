/**
 * The parkour movement set: walk, jog, run and sprint by the stick, jumps (coyote time and a
 * buffer), leaps off roof edges, vaults over low things, wall climbs (a run-up, a jump up the
 * wall, a wall jump off it), wall runs, ledge grabs, hangs, shimmies and mantles, drops to hang,
 * rolls on hard landings (never any damage), the web-zip with a point launch, and the swing
 * only while the web is held. Deterministic (dmath, + − × ÷, sqrt, floor), stepped once a tick:
 *
 *   stepParkour(state, input, presses, dt)
 *
 * on a SimState that hosts it (host.ts parkourOf: free roam's today). Its numbers are
 * constants.ts; what it reports is ParkourEvent. Patrol nights don't use it; porting it to them
 * is a new ruleset of their own (host.ts says where it would plug in).
 */
export * from "./constants";
export type * from "./types";
export { canTalk, roamHeading as parkourHeading, stepMove as stepParkour, type Presses } from "./move";
export { clearAt, columnTop, ledgeOpen, ledgeSpot, wallSeek } from "./geometry";
export { parkourOf } from "./host";
export { zipTarget, type ZipTarget } from "./zip";
