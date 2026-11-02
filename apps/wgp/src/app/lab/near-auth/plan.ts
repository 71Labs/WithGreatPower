/**
 * Spike S1: which sign-up plan the NEAR Auth results support (ARCHITECTURE.md §5).
 *
 * Plan A: one Google login; the server verifies it and derives the user's MPC key;
 *         the factory creates <handle>.wgp.* with that key plus the session key.
 *         Needs: login, a server-verifiable token whose derived key matches the SDK's,
 *         and MPC signatures that verify against that key (so the user really controls
 *         the account through Google).
 * Plan B: NEAR Auth owns the account (its implicit account, or one it creates); one
 *         popup signs AddKey(session key) as a delegate and our relayer submits it.
 *         Needs: login and a delegate signature, but no server-verifiable token.
 * Plan C: contract-level session keys checked with ed25519_verify; works with any
 *         signer, used when NEAR Auth can't sign delegate actions.
 */

export interface LabResults {
  login?: { ok: boolean };
  server?: { ok: boolean; keyMatches?: boolean };
  delegate?: { ok: boolean; payloadMatches?: boolean };
  relay?: { ok: boolean; signatureVerifies?: boolean };
}

export interface PlanPick {
  plan: "A" | "B" | "C" | null;
  /** True while a check the plan depends on hasn't run yet. */
  provisional: boolean;
  why: string;
}

export function pickPlan(r: LabResults): PlanPick {
  if (!r.login?.ok) return { plan: null, provisional: true, why: "Sign in first: every plan starts with a working NEAR Auth login." };
  const serverOk = r.server?.ok === true && r.server.keyMatches === true;
  const canApprove = r.delegate?.ok === true && r.delegate.payloadMatches === true;
  const signatureOk = r.relay?.ok === true && r.relay.signatureVerifies === true;

  if (r.delegate && !canApprove) {
    return { plan: "C", provisional: false, why: "NEAR Auth could not approve a delegate action, so keys must be checked by the contract (ed25519_verify)." };
  }
  if (r.relay && !signatureOk) {
    return { plan: "C", provisional: false, why: "The MPC signature for the delegate did not come back or did not verify against the derived key." };
  }
  if (serverOk) {
    if (signatureOk) return { plan: "A", provisional: false, why: "The server verifies the login and derives the same key, and NEAR Auth signs for it: create the account in one transaction." };
    return { plan: "A", provisional: true, why: "The server verifies the login and derives the same key. Run the delegate signature to confirm the user controls that key." };
  }
  if (r.server && !serverOk) {
    if (signatureOk) return { plan: "B", provisional: false, why: "The server can't verify the login (or derives another key), but NEAR Auth signs AddKey: let NEAR Auth own the account and add the session key with one popup." };
    return { plan: "B", provisional: true, why: "The server can't verify the login. Plan B still works if NEAR Auth signs the AddKey delegate." };
  }
  return { plan: null, provisional: true, why: "Run the server check next." };
}
