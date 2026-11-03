/**
 * Helpers for the route handlers under src/app/api: JSON in and out, typed errors, a
 * hard body-size cap, zod parsing, the client IP and the cron secret check. Ported from
 * blastoff's server/http.ts.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in first") => new HttpError(401, "unauthorized", message);
export const forbidden = (message: string) => new HttpError(403, "forbidden", message);
export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) => new HttpError(409, code, message, details);

/** A JSON response, `no-store` unless `cacheSeconds` is given. */
export function json(body: unknown, init: ResponseInit & { cacheSeconds?: number } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    headers.set(
      "cache-control",
      init.cacheSeconds ? `public, max-age=0, s-maxage=${init.cacheSeconds}, stale-while-revalidate=${init.cacheSeconds}` : "no-store",
    );
  }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

/**
 * Turns any thrown value into a JSON error response. HttpErrors carry messages written
 * for callers; anything else answers "Internal error" with a request id, and its message
 * only reaches the server log.
 */
export function errorResponse(error: unknown, route: string): Response {
  if (error instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (error.status === 429 && typeof error.details?.retryAfterSeconds === "number") {
      headers["retry-after"] = String(error.details.retryAfterSeconds);
    }
    return json({ error: error.code, message: error.message, ...(error.details ?? {}) }, { status: error.status, headers });
  }
  const requestId = randomUUID();
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${route}] ${requestId} ${name}: ${message}`);
  return json({ error: "internal", message: "Internal error", requestId }, { status: 500 });
}

/**
 * Wraps a handler so every failure becomes a JSON error. Next's own control-flow errors
 * (a prerender bail-out from reading the request, redirect, notFound) pass through.
 */
export function handle<A extends unknown[]>(route: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      unstable_rethrow(error);
      return errorResponse(error, route);
    }
  };
}

const tooLarge = (maxBytes: number) => new HttpError(413, "too_large", `Body over ${maxBytes} bytes`);

/**
 * Reads the body as text, refusing anything over `maxBytes`. Stops reading as soon as
 * the cap is passed, so an oversized or lying Content-Length never buffers in full.
 */
export async function readText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a JSON body (at most `maxBytes`) and validates it with `schema`. An empty body is `{}`. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S, maxBytes = 8 * 1024): Promise<z.infer<S>> {
  const text = await readText(request, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(text || "{}");
  } catch {
    throw badRequest("Body is not valid JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("Invalid body", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  return parsed.data;
}

/**
 * The client IP for rate limits. Only headers the platform sets are trusted: Vercel's
 * `x-vercel-forwarded-for`, then `x-real-ip`, then the LAST x-forwarded-for hop (the one
 * our own proxy appended). The first x-forwarded-for value is whatever the client claims.
 */
export function clientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1]!;
  }
  return "local";
}

/**
 * Cron routes: `Authorization: Bearer <CRON_SECRET>`, exactly what Vercel Cron sends when
 * CRON_SECRET is set (a bare secret without the scheme is refused). Without a secret,
 * production refuses every call and development lets them through.
 */
export function assertCron(request: Request, env: Record<string, string | undefined> = process.env): void {
  const secret = env.CRON_SECRET;
  if (!secret) {
    if (env.NODE_ENV !== "production") return;
    throw new HttpError(401, "unauthorized", "CRON_SECRET is not set; cron routes are closed");
  }
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  const given = Buffer.from(bearer?.[1] ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, "unauthorized", "Bad or missing cron secret");
  }
}
