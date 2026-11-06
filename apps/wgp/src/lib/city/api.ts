/**
 * The browser's side of free roam's endpoints (src/app/api/city): the signed-in player's city
 * record, and filing an outing's input log for the server to replay. Plain fetch, same origin.
 */
import type { CityBase, CityGains, CityRecord } from "@wgp/game-core/city";
import type { Save } from "@wgp/game-core/types";

export type CityResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message?: string; body?: { city?: CityRecord; ruleset?: string } };

export interface CityView {
  signedIn: boolean;
  city: CityRecord | null;
}

export interface FiledOuting {
  outingId: string;
  /** What this filing found for the first time, and the XP it paid. */
  gains: CityGains;
  city: CityRecord;
  save: Save;
  rev: number;
  ticks: number;
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<CityResult<T>> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { ok: true, data: body as T };
  return {
    ok: false,
    status: res.status,
    error: typeof body?.error === "string" ? body.error : `http_${res.status}`,
    message: typeof body?.message === "string" ? body.message : undefined,
    // An old_rules refusal carries the record to start a fresh outing from, and the server's rules.
    body: body && typeof body === "object" ? { city: (body.city as CityRecord | undefined) ?? undefined, ruleset: typeof body.ruleset === "string" ? body.ruleset : undefined } : undefined,
  };
}

export const getCity = () => call<CityView>("/api/city");

/** File an outing (the whole log from its start): idempotent, so filing it again as it grows is fine. */
export const fileOutingLog = (body: { outingId: string; base: CityBase; log: string }, keepalive = false) =>
  call<FiledOuting>("/api/city/outing", { method: "POST", json: body, keepalive });
