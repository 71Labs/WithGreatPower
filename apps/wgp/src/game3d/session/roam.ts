/**
 * A free-roam outing in the browser: where it starts (the save's city record), and filing what
 * it found.
 *
 * - Guests: the outing is filed into the browser's save (rules/city.ts applyOuting), the XP
 *   with it, unverified like a guest's case clear.
 * - Signed in: the whole log so far goes to the server, which replays it from the record's
 *   base and files what it found (src/server/db/city.ts); the save comes back with the XP.
 *   Filing is idempotent, so an outing is filed again whenever it finds something, every
 *   couple of minutes, on pause and on leaving.
 *
 * An outing's log holds at most MAX_TICKS (15 minutes); near the end the page files it and
 * starts the next outing where this one stood (nextSession).
 */
import { applyOuting, cityBase, cityRecord, roamStartFrom, type CityBase, type CityGains, type CityRecord } from "@wgp/game-core/city";
import { toBase64 } from "@wgp/game-core/input";
import { ROAM_RULESET, roamLog, roamOuting, startRoamRun, type RoamRun } from "@wgp/game-core/roam";
import type { Save } from "@wgp/game-core/types";

import { adoptServerSave, commitLocalSave, getSave } from "@/game/store";
import { fileOutingLog } from "@/lib/city/api";

export type RoamMode = "guest" | "signed-in";

export interface RoamSession {
  mode: RoamMode;
  playerId: string | null;
  /** This outing's id (the server files by it). */
  outingId: string;
  /** What it started from. */
  base: CityBase;
  run: RoamRun;
}

export type FileResult =
  | { kind: "filed"; gains: CityGains; record: CityRecord; verified: boolean }
  /** The server's record moved on since this outing began (another tab): start again from it. */
  | { kind: "stale"; record: CityRecord | null }
  /**
   * The server refused this outing as one played under older roam rules (409 old_rules): nothing
   * of it was filed, the record keeps what it had. `fresh`: the server's rules are this page's,
   * so a fresh outing from `record` files; else the page is older than the server (reload).
   */
  | { kind: "old-rules"; record: CityRecord | null; fresh: boolean }
  | { kind: "failed"; message: string }
  /** Nothing new to send. */
  | { kind: "idle" };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** An outing from where a record left off. */
export function beginRoam(record: CityRecord, mode: RoamMode, playerId: string | null = null): RoamSession {
  const base = cityBase(record);
  return { mode, playerId, outingId: newId(), base, run: startRoamRun(roamStartFrom(base)) };
}

/** An outing from a save's city record (the guest's browser save, or the server's for a signed-in player). */
export const beginRoamFrom = (save: Save, mode: RoamMode, playerId: string | null = null) => beginRoam(cityRecord(save), mode, playerId);

/** The next outing, after this one filed: from the record as it now stands (where this one ended). */
export const nextSession = (s: RoamSession, record: CityRecord): RoamSession => beginRoam(record, s.mode, s.playerId);

/** Ticks filed per outing, so a refile only goes when there's more to send. */
const filed = new WeakMap<RoamSession, number>();

/** File what the outing has found so far. `keepalive`: the page is going away. */
export async function fileOuting(s: RoamSession, opts: { keepalive?: boolean; force?: boolean } = {}): Promise<FileResult> {
  const ticks = s.run.codes.length;
  if (!opts.force && (filed.get(s) ?? -1) >= ticks) return { kind: "idle" };
  if (s.mode === "guest") {
    const save = getSave();
    if (!save) return { kind: "failed", message: "No save to file the outing in." };
    const out = applyOuting(save, roamOuting(s.run));
    commitLocalSave(out.save);
    filed.set(s, ticks);
    return { kind: "filed", gains: out.gains, record: out.record, verified: false };
  }
  const res = await fileOutingLog({ outingId: s.outingId, base: s.base, log: toBase64(roamLog(s.run)) }, opts.keepalive);
  if (!res.ok) {
    if (res.status === 409 && res.error === "old_rules") return { kind: "old-rules", record: res.body?.city ?? null, fresh: res.body?.ruleset === ROAM_RULESET };
    if (res.status === 409) return { kind: "stale", record: null };
    return { kind: "failed", message: res.message ?? "Couldn’t file the outing with the server." };
  }
  filed.set(s, ticks);
  adoptServerSave(res.data.save, res.data.rev);
  return { kind: "filed", gains: res.data.gains, record: res.data.city, verified: true };
}
