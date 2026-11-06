/**
 * Where the movement set finds its state on a SimState: the one place to change when another
 * mode hosts it. Today that's free roam's (SimState.roam, a ParkourHost). A future patrol
 * ruleset would add its own host to SimState (a `parkour` field, set only under that ruleset,
 * so older nights never see it) and return it here.
 */
import type { SimState } from "../types";
import type { ParkourHost } from "./types";

export function parkourOf(s: SimState): ParkourHost {
  const host = s.roam;
  if (!host) throw new Error("the movement set runs only on a state that hosts it");
  return host;
}
