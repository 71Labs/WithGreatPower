/**
 * Menu actions reduced on the server: the same game-core reducer the browser runs, with
 * the stored revision as an optimistic lock. Patrol actions are not accepted here; a
 * night is only ever played as a ranked run (start → replay on submit).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { MAX_LOADOUT, POWERS, SUITS } from "@wgp/game-core/data";
import { reduce, type Action } from "@wgp/game-core/engine";
import type { PowerId, Save, SuitId } from "@wgp/game-core/types";

import { conflict } from "@/server/http";

import type { Db } from "./client";
import { ensureSave, writeSave } from "./players";
import { runs } from "./schema";

const powerId = z.enum(Object.keys(POWERS) as [PowerId, ...PowerId[]]);
const suitId = z.enum(Object.keys(SUITS) as [SuitId, ...SuitId[]]);

/** The actions the server accepts, each shaped exactly like game-core's `Action`. */
export const menuAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create-hero"), name: z.string().min(1).max(64), suit: suitId, powers: z.array(powerId).max(6) }),
  z.object({ type: z.literal("sleep") }),
  z.object({ type: z.literal("vote"), side: z.enum(["hero", "menace"]) }),
  z.object({ type: z.literal("pick-power"), power: powerId }),
  z.object({ type: z.literal("set-loadout"), loadout: z.array(powerId).min(1).max(MAX_LOADOUT) }),
  z.object({ type: z.literal("craft-suit"), suit: suitId }),
  z.object({ type: z.literal("equip-suit"), suit: suitId }),
  z.object({ type: z.literal("reset") }),
]);

export type MenuAction = z.infer<typeof menuAction> & Action;

export const actionBody = z.object({ action: menuAction, rev: z.number().int().min(0) });

export interface ActionResult {
  /** False when the reducer refused the action (the save is unchanged). */
  applied: boolean;
  save: Save;
  rev: number;
}

export async function applyAction(db: Db, input: { playerId: string; action: MenuAction; rev: number; now?: Date }): Promise<ActionResult> {
  const now = input.now ?? new Date();
  const [inFlight] = await db
    .select({ id: runs.id, expiresAt: runs.expiresAt })
    .from(runs)
    .where(and(eq(runs.playerId, input.playerId), eq(runs.status, "issued")))
    .limit(1);
  // The run replays from the save it started with; changing it mid-run would void the run.
  if (inFlight && inFlight.expiresAt > now) throw conflict("run_active", "Finish or abandon the run in progress first", { runId: inFlight.id });

  const { save, rev } = await ensureSave(db, input.playerId);
  if (rev !== input.rev) throw conflict("rev_conflict", "Your save changed elsewhere", { save, rev });

  const next = reduce(save, input.action);
  if (next === save) return { applied: false, save, rev };

  const newRev = await writeSave(db, input.playerId, next, rev, now);
  if (newRev === null) {
    const latest = await ensureSave(db, input.playerId);
    throw conflict("rev_conflict", "Your save changed elsewhere", { save: latest.save, rev: latest.rev });
  }
  return { applied: true, save: next, rev: newRev };
}
