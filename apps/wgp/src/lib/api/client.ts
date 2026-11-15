/**
 * Typed browser fetchers for the game API (src/app/api). Every call sends the session
 * cookie and resolves to `{ ok: true, data }` or `{ ok: false, status, error }`; nothing
 * here throws on an HTTP error, so screens can branch on `error` codes without try/catch.
 * Network failures resolve to status 0, error "network".
 */
import type { Action } from "@wgp/game-core/engine";
import type { ChapterId, Save } from "@wgp/game-core/types";

import type { CasesResponse } from "@/lib/cases/types";
import { withRef } from "@/lib/referrals/ref";
import type { ClaimInfo } from "@/server/auth/privy-sign-in";
import type { LeaderboardView } from "@/server/db/board-view";
import type { CaseOutcome } from "@/server/db/cases";
import type { ImportResult } from "@/server/db/migrate-save";
import type { StartedRun } from "@/server/db/runs";
import type { ChainStatus } from "@/server/near/status";
import type { XProfile } from "@/server/social/players";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message?: string; body?: Record<string, unknown> };

export interface Me {
  signedIn: true;
  player: { id: string; handle: string; nearAccountId: string; authKind: string; createdAt: string; banned: boolean; migrated: boolean };
  save: Save;
  rev: number;
  /** `chapter`: the run in flight is a story chapter's (absent from older servers). */
  activeRun: { runId: string; expiresAt: string; night: number; chapter?: ChapterId | null } | null;
  runsToday: { used: number; limit: number };
  /** The player's X handle (unverified) and whether drafts may tag them; absent from older servers. */
  social?: XProfile;
}

export type MeResponse = Me | { signedIn: false };

export type Board = LeaderboardView["board"];
export type LeaderboardResponse = LeaderboardView & { signedIn: boolean };

/**
 * `bits`: the Bits minted for the night (src/lib/market/rewards.ts). `taper`: present when the
 * wallet taper paid less than the whole night (`full`), because the hero held `held` Bits.
 * `chapter`: a story chapter's run (unranked, no Bits).
 */
export type SubmitResponse = {
  status: "verified";
  runId: string;
  score: number;
  ticks: number;
  digest: string;
  bits: number;
  taper?: { full: number; held: number };
  ranked: boolean;
  save: Save;
  rev: number;
  idempotent: boolean;
  chapter?: CaseOutcome;
};

export interface ActionResponse {
  applied: boolean;
  save: Save;
  rev: number;
}

export type MigrateResponse = ImportResult;

/** The shared fetcher, for other typed API modules (src/lib/referrals/api.ts). */
export async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<ApiResult<T>> {
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

export const getMe = (signal?: AbortSignal) => call<MeResponse>("/api/me", { signal });

export const signOut = () => call<{ signedIn: false }>("/api/me", { method: "DELETE" });

/**
 * Local development only (ALLOW_DEV_AUTH=1): signs in as a throwaway test player. Carries
 * the invite code this browser holds (`ref`), in case the invite cookie was lost.
 */
export const devSignIn = (handle?: string) => call<{ player: { id: string; handle: string } }>("/api/auth/dev", { method: "POST", json: withRef(handle ? { handle } : {}) });

/** Whether dev sign-in is switched on here: ok only with ALLOW_DEV_AUTH=1 outside production, 404 otherwise. */
export const devSignInAvailable = (signal?: AbortSignal) => call<{ enabled: true }>("/api/auth/dev", { signal });

/**
 * Starts a Google sign-in: a single-use nonce (also set as an HttpOnly cookie) that the
 * ID token must carry. 503 near_not_configured when NEAR Auth isn't set up on this server.
 */
export const getNearAuthNonce = () => call<{ nonce: string; expiresAt: string }>("/api/auth/near-auth/nonce", { method: "POST" });

/**
 * 409 run_active (body.runId) when a run is in flight; pass `abandon` to drop it. 429 daily_cap.
 * `chapter`: a story chapter's run (Case File 001), played with startChapterRun.
 */
export const startRankedRun = (opts: { assist?: boolean; abandon?: boolean; chapter?: ChapterId } = {}) => call<StartedRun>("/api/runs/start", { method: "POST", json: opts });

/** 422 run_rejected (body.reason) · 409 rev_conflict · 410 run_expired · 409 already_submitted. */
export const submitRankedRun = (runId: string, log: Uint8Array, clientHash: string) =>
  call<SubmitResponse>(`/api/runs/${encodeURIComponent(runId)}/submit`, { method: "POST", json: { log: toBase64(log), clientHash } });

export function getLeaderboard(board: Board, opts: { period?: string; aroundMe?: boolean; signal?: AbortSignal } = {}) {
  const q = new URLSearchParams({ board });
  if (opts.period) q.set("period", opts.period);
  if (opts.aroundMe) q.set("around", "me");
  return call<LeaderboardResponse>(`/api/leaderboard?${q}`, { signal: opts.signal });
}

/** The signed-in player's case files (the chapters): each case's status, best clear and "Case closed" badge. */
export const getCases = (signal?: AbortSignal) => call<CasesResponse>("/api/cases", { signal });

/** Menu actions reduced on the server. 409 rev_conflict carries the current { save, rev } in body. */
export const postAction = (action: Action, rev: number) => call<ActionResponse>("/api/actions", { method: "POST", json: { action, rev } });

/** Once per player, onto an empty server save. */
export const migrateLocalSave = (save: Save) => call<MigrateResponse>("/api/migrate", { method: "POST", json: { save } });

export type { ChainStatus, ClaimInfo, XProfile };

/** 400 with `field` ("xHandle" or "xTagOk") when the handle or the choice is refused. */
export const saveXProfile = (input: { xHandle: string | null; xTagOk: boolean }) => call<{ social: XProfile }>("/api/me/social", { method: "PUT", json: input });

export const removeXProfile = () => call<{ social: XProfile }>("/api/me/social", { method: "DELETE" });

/** An unclaimed Google player (through Privy): whether "Claim your name" can go through now. */
export const getClaimInfo = (signal?: AbortSignal) => call<ClaimInfo>("/api/auth/privy/claim", { signal });

/** Signed in: the hero's registration, the session keys the relayer accepts, and the contract's view of the player. */
export const getChainStatus = (signal?: AbortSignal) => call<ChainStatus>("/api/chain/status", { signal });

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
