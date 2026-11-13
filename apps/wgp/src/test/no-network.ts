/**
 * The test suite's network guard, loaded before every test file (vitest `setupFiles`).
 *
 * "The tests need no network" is a claim the README makes, so the suite enforces it: a test
 * that makes a real request fails, even when the code under test catches the error and
 * carries on (which is how a contract-version read once reached mainnet's RPC unnoticed).
 *
 * Two layers:
 *   1. `globalThis.fetch` is replaced by one that rejects any URL whose host isn't loopback.
 *   2. `net.Socket.prototype.connect` refuses any non-loopback host. Every TCP and TLS
 *      connection in Node goes through it: `http`, `https`, `tls`, and undici (so the real
 *      `fetch` too, if a test restores it).
 *
 * Each refusal is also recorded, and an `afterEach` fails the test that caused it. A test
 * that stubs `fetch` itself (`vi.stubGlobal`, `vi.spyOn`) replaces layer 1 and never
 * touches the network, so it isn't affected. PGlite runs in-process and opens no socket.
 */
import net from "node:net";
import { afterEach } from "vitest";

const STATE = Symbol.for("wgp.test.no-network");

interface GuardState {
  violations: string[];
  realConnect: typeof net.Socket.prototype.connect;
  realFetch: typeof fetch;
}

type WithState = typeof globalThis & { [STATE]?: GuardState };

export class NetworkBlockedError extends Error {
  constructor(readonly target: string) {
    super(`A test tried to reach the network (${target}). Tests run offline: inject a reader or stub fetch at that boundary.`);
    this.name = "NetworkBlockedError";
  }
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\]|0\.0\.0\.0)$/i;

export const isLoopback = (host: string | undefined | null): boolean => !host || LOOPBACK.test(host);

function state(): GuardState {
  const g = globalThis as WithState;
  if (!g[STATE]) g[STATE] = { violations: [], realConnect: net.Socket.prototype.connect, realFetch: globalThis.fetch };
  return g[STATE];
}

function refuse(target: string): NetworkBlockedError {
  state().violations.push(target);
  return new NetworkBlockedError(target);
}

/** The requests refused since the last call, and forgets them. For the guard's own test. */
export function takeNetworkViolations(): string[] {
  const s = state();
  const out = s.violations;
  s.violations = [];
  return out;
}

/** Node's own `fetch`, unguarded at layer 1. Only for the guard's test of layer 2. */
export const unguardedFetch = (): typeof fetch => state().realFetch;

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) return String((input as { url: unknown }).url);
  return String(input);
}

/** The guarded `fetch`: loopback URLs go to the real one, anything else is refused. */
export function guardedFetch(real: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    let host: string | null = null;
    try {
      host = new URL(url).hostname;
    } catch {
      // A relative URL can't leave the machine; let the real fetch reject it its own way.
    }
    if (host !== null && !/^(data|blob|file):/i.test(url) && !isLoopback(host)) throw refuse(`fetch ${url}`);
    return real(input, init);
  };
}

function install(): void {
  const g = globalThis as WithState;
  if (g[STATE]) return; // one install per worker
  const s = state();

  globalThis.fetch = guardedFetch(s.realFetch);

  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    // connect(options[, cb]) | connect(port[, host][, cb]) | connect(path[, cb]); Node also
    // calls it internally with one normalised array: [options, cb].
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    let host: string | undefined;
    let port: unknown;
    let isPipe = false;
    if (first && typeof first === "object") {
      const o = first as { host?: string; port?: unknown; path?: string };
      host = o.host;
      port = o.port;
      isPipe = !!o.path;
    } else if (typeof first === "string" && !/^\d+$/.test(first)) {
      isPipe = true; // a unix socket or named pipe
    } else {
      port = first;
      if (typeof args[1] === "string") host = args[1];
    }
    if (!isPipe && !isLoopback(host)) {
      const error = refuse(`connect ${host}:${String(port)}`);
      // Fail the caller the way a refused connection would, so its own error path runs.
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return (s.realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}

install();

afterEach(() => {
  const seen = takeNetworkViolations();
  if (seen.length) throw new NetworkBlockedError(seen.join(", "));
});
