/**
 * The meeting point between the game's account UI and Privy, which loads lazily.
 *
 * Privy's React SDK is large, so no page bundles it: the account center mounts
 * <PrivyHost> (src/components/account/privy-host.tsx, a lazy chunk) only after
 * `requestPrivy()`, i.e. when the sign-in sheet opens, a Google redirect comes back, or
 * a Privy player needs their wallet. The host publishes what the UI may call here;
 * callers wait for it with `whenPrivy()`. This module imports nothing from Privy.
 *
 * Google login through Privy is a full-page redirect: the account center finishes the
 * sign-in when the page comes back with Privy's `privy_oauth_*` parameters.
 */
import { useSyncExternalStore } from "react";

export interface PrivyNearWallet {
  /** The wallet's implicit account id (its ed25519 key in hex). */
  address: string;
}

/** What the mounted host can do. Functions are safe to call once `ready`. */
export interface PrivyApi {
  ready: boolean;
  authenticated: boolean;
  /** Leaves for Google's sign-in page (through Privy). */
  loginWithGoogle(): Promise<void>;
  /** The user's Privy NEAR embedded wallet, made now if they have none. */
  ensureNearWallet(): Promise<PrivyNearWallet>;
  /** A fresh Privy access token for our server. */
  accessToken(): Promise<string>;
  /** Signs a 32-byte hash with the NEAR wallet's ed25519 key (Privy's raw-hash signing). */
  signRawHash(address: string, hash: Uint8Array): Promise<Uint8Array>;
  logout(): Promise<void>;
}

export class PrivyBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PrivyBridgeError";
  }
}

interface State {
  /** Someone asked for Privy: the host is (or is being) mounted. */
  wanted: boolean;
  api: PrivyApi | null;
  /** The SDK failed to load, or Privy reported a login error. */
  failure: PrivyBridgeError | null;
  /** The page came back from Google with Privy's parameters; the sheet finishes the sign-in. */
  returning: boolean;
}

let state: State = { wanted: false, api: null, failure: null, returning: false };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getPrivyState = (): State => state;

/** Asks the account center to mount Privy (idempotent). */
export function requestPrivy(): void {
  if (!state.wanted) set({ wanted: true });
}

export function usePrivyWanted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.wanted,
    () => false,
  );
}

export function usePrivyReturning(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.returning,
    () => false,
  );
}

/** The host's API, or null when it unmounts. */
export function publishPrivy(api: PrivyApi | null): void {
  set({ api, ...(api?.ready ? { failure: null } : {}) });
}

/** The host couldn't load, or Privy said the login failed. Waiters reject with it. */
export function reportPrivyFailure(error: PrivyBridgeError): void {
  set({ failure: error });
}

/** Clears a reported failure before a new attempt. */
export function clearPrivyFailure(): void {
  if (state.failure) set({ failure: null });
}

/**
 * Resolves with the API once Privy is ready (and the user is logged in to Privy, with
 * `authenticated`). Rejects on a reported failure or after `timeoutMs`.
 */
export function whenPrivy(opts: { authenticated?: boolean; timeoutMs?: number } = {}): Promise<PrivyApi> {
  requestPrivy();
  const timeoutMs = opts.timeoutMs ?? 20_000;
  return new Promise((resolve, reject) => {
    let done = false;
    const check = () => {
      if (done) return;
      if (state.failure) return finish(() => reject(state.failure));
      const api = state.api;
      if (!api?.ready) return;
      if (opts.authenticated && !api.authenticated) return;
      finish(() => resolve(api));
    };
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          opts.authenticated && state.api?.ready
            ? new PrivyBridgeError("Google sign-in didn’t finish", "privy_not_signed_in")
            : new PrivyBridgeError("Google sign-in couldn’t start", "privy_timeout"),
        ),
      );
    }, timeoutMs);
    const unsubscribe = subscribe(check);
    function finish(settle: () => void) {
      done = true;
      clearTimeout(timer);
      unsubscribe();
      settle();
    }
    check();
  });
}

/**
 * Logs out of Privy too, after our own sign-out. `load`: load Privy first if it isn't
 * yet (a Privy player signing out); otherwise only an already-loaded Privy is logged
 * out. Never throws, and gives up after `timeoutMs`.
 */
export async function signOutOfPrivy(opts: { load?: boolean; timeoutMs?: number } = {}): Promise<void> {
  if (!opts.load && !state.wanted) return;
  try {
    const api = await whenPrivy({ timeoutMs: opts.timeoutMs ?? 5_000 });
    if (api.authenticated) await api.logout();
  } catch {
    // Privy never loaded, or is unreachable: our own session is what counts.
  }
}

/* ------------------------------------------------------------------ the Google redirect */

/** Privy's OAuth return parameters are in this query string. Pure. */
export function isOAuthReturn(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.has("privy_oauth_code") && q.has("privy_oauth_state") && q.has("privy_oauth_provider");
}

/**
 * On page load: if this is Google coming back through Privy, mount Privy (it completes
 * the login from the URL, then removes the parameters) and flag the sheet to finish
 * signing in. Returns whether it was. A player who backed out of Google's page comes
 * back without the parameters, and nothing happens.
 */
export function beginOAuthReturn(search: string): boolean {
  if (!isOAuthReturn(search)) return false;
  set({ wanted: true, returning: true, failure: null });
  return true;
}

/** The sheet took over the return. */
export function endOAuthReturn(): void {
  if (state.returning) set({ returning: false });
}
