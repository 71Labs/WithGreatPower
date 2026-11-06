/**
 * Browser fetchers for the competitive modes (src/server/db/compete.ts): the Compete hub, the
 * ghosts to race and their replays, what a challenge link opens, and starting a race. Like
 * lib/api/client.ts, every call resolves to `{ ok: true, data }` or `{ ok: false, status, error }`
 * and never throws on an HTTP error; a network failure is status 0, error "network".
 */
import type { TrialCourseId } from "@wgp/game-core/types";

import type { ApiResult, SubmitResponse } from "@/lib/api/client";
import type { CompeteOutcome, CompeteView, GhostEntry, RaceTarget, StartedCompeteRun } from "@/server/db/compete";
import type { PublicReplay } from "@/server/db/runs";

export type { CompeteOutcome, CompeteView, GhostEntry, PublicReplay, RaceTarget, StartedCompeteRun };

/** A verified race's submit answer: the usual fields and what it did on its board. */
export type CompeteSubmit = SubmitResponse & { compete?: CompeteOutcome };

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<ApiResult<T>> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: "network" };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { ok: true, data: body as T };
  return {
    ok: false,
    status: res.status,
    error: typeof body?.error === "string" ? body.error : `http_${res.status}`,
    message: typeof body?.message === "string" ? body.message : undefined,
    body: body ?? undefined,
  };
}

/** The Compete hub: today's Daily, the trials, your rivals. */
export const getCompete = (signal?: AbortSignal) => call<CompeteView>("/api/compete", { signal });

/** The ghosts to race: the board's top three, your best, and a chosen run. */
export function getGhosts(mode: "daily" | "trial", opts: { course?: TrialCourseId; ghost?: string | null; signal?: AbortSignal } = {}) {
  const q = new URLSearchParams({ mode });
  if (opts.course) q.set("course", opts.course);
  if (opts.ghost) q.set("ghost", opts.ghost);
  return call<{ ghosts: GhostEntry[] }>(`/api/compete/ghosts?${q}`, { signal: opts.signal });
}

/** A verified run's replay: its seed, start save and log (base64). Cached by the browser for an hour. */
export const getReplay = (runId: string, signal?: AbortSignal) => fetchReplay(runId, signal);

async function fetchReplay(runId: string, signal?: AbortSignal): Promise<ApiResult<PublicReplay>> {
  let res: Response;
  try {
    res = await fetch(`/api/runs/${encodeURIComponent(runId)}/replay`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: "network" };
  }
  if (!res.ok) return { ok: false, status: res.status, error: `http_${res.status}` };
  return { ok: true, data: (await res.json()) as PublicReplay };
}

/** What a challenge link opens. 404 when the run can't be raced. */
export const getRaceTarget = (runId: string, signal?: AbortSignal) => call<RaceTarget>(`/api/compete/race/${encodeURIComponent(runId)}`, { signal });

/** What to start: today's Daily, a course, or a duel on a verified run. */
export type RaceSpec = { kind: "daily"; ghost?: string | null } | { kind: "trial"; course: TrialCourseId; ghost?: string | null } | { kind: "duel"; runId: string };

/** Start a race on the server. 409 run_active (body.runId), 429 daily_cap, 401 signed out. */
export function startRace(spec: RaceSpec, abandon = false) {
  const json =
    spec.kind === "duel"
      ? { duel: spec.runId, abandon }
      : spec.kind === "daily"
        ? { mode: "daily", ...(spec.ghost ? { ghost: spec.ghost } : {}), abandon }
        : { mode: "trial", course: spec.course, ...(spec.ghost ? { ghost: spec.ghost } : {}), abandon };
  return call<StartedCompeteRun>("/api/runs/start", { method: "POST", json });
}

/** Bytes from a replay's base64 log. */
export function logBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
