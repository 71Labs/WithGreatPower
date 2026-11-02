# Spike S1: NEAR Auth on testnet

**Status:** half done. The contract question is settled over RPC (Nov 2). The login and signing questions need the owner to run `/lab/near-auth` once and paste its JSON below.

## Settled without logging in (read-only RPC, Nov 2)
- **The contract is `fast-auth.testnet`.** Both candidates are live (`version` 1.0.0, MPC `v1.signer-prod.testnet`, domain id 1), but only one accepts the shared dev client's tokens:
  - `fast-auth.testnet` routes `jwt` to `jwt.fast-auth.testnet`.
  - That router maps the issuer `https://login.testnet.fast-auth.com/` to `auth0.jwt.fast-auth.testnet`.
  - That guard's account is exactly the shared client's signing audience. The Auth0 guard requires `aud` to contain its own account id.
  - `jwt.fast-auth-beta-001.testnet` has no guard for that issuer, so the React SDK page's `fast-auth-beta-001.testnet` is a stale value.
- **The derivation path is `jwt#https://login.testnet.fast-auth.com/#<sub>`** (from the JavaScript provider's `getPath`). The key is `v1.signer-prod.testnet.derived_public_key({path, predecessor: "fast-auth.testnet", domain_id: 1})`, an ed25519 key.
  - The same login gets a different key under the beta contract.
  - Anyone can compute the key from `sub`: the server can derive it without the user.
- **NEAR Auth makes no account by itself.** The login yields only a key, so the natural account is its implicit one (the hex of the key), which needs funding to exist. The SDK's `createAccount` is just a `create_account` function call someone must pay for. Plan A sidesteps this: our factory creates `<handle>.wgp.testnet` with that key.
- **The Auth0 ID token is RS256 and checkable on the server** against `https://login.testnet.fast-auth.com/.well-known/jwks.json` (2 RSA keys). `iss` is `https://login.testnet.fast-auth.com/`, `aud` is the client id. `POST /api/auth/near-auth` does this.
- **Every signature is an Auth0 popup or redirect.** The provider mints a JWT whose `fatxn` claim is the exact payload, so one JWT can only ever sign one payload. Someone then calls `sign` on `fast-auth.testnet` with 1 yoctoNEAR (refunded). Our relayer does that (`/api/relay/fast-auth`).
- **SDK compatibility:** the SDKs bundle near-api-js 5.1.1. Its `encodeDelegateAction` produces the same bytes as near-api-js 7.4 for a v7 `DelegateAction` (AddKey + FunctionCall, checked in Node). So our delegates go through the SDK unchanged.

## Binding the ID token to our server (Nov 2)
**Why:** on testnet every NEAR Auth app shares one Auth0 client, so `aud` alone can't tell our sign-ins from another app's. Without a binding, any app that gets a user's ID token could replay it to `POST /api/auth/near-auth` and sign in as them.

**The SDKs can't pass a nonce:**
- `javascript-provider` replaces `authorizationParams` on every login (it only sets `prompt` and `redirect_uri`).
- `auth0-spa-js` 2.30 creates its own `state` and `nonce` in `_prepareAuthorizeUrl`, after the caller's params, so a caller's `nonce` is overwritten.

**What we do instead:**
1. `POST /api/auth/near-auth/nonce` issues 32 random bytes. The value goes back in the body and in an HttpOnly cookie; only its SHA-256 is stored, in `auth_nonces`, for 10 minutes.
2. `NearAuth.login({ nonce })` wraps the Auth0 client's `_prepareAuthorizeUrl` for that one login. It swaps our nonce into the `/authorize` URL and into what `auth0-spa-js` checks the returned token against. Every other parameter is untouched, and the wrapper is removed afterwards.
3. The server checks that the verified token's `nonce` claim equals this browser's cookie and is still live. Signing in, creating an account or the lab's verify spends it, in one `DELETE … RETURNING`. A new player who still has to pick a handle has the nonce checked but not spent, so they get no second popup.
4. Rejected with 401: no nonce (`nonce_missing`), another tab's or browser's (`nonce_mismatch`), and one never issued, expired or already used (`nonce_spent`). Tests: `src/server/near/login-nonce.test.ts` and `src/lib/near/near-auth.test.ts`.

**Residual risk:**
- **Private API:** the binding relies on `auth0-spa-js`'s private `_prepareAuthorizeUrl` (2.30, pinned by the lockfile). If an upgrade drops it, Google sign-in fails closed with `NONCE_UNSUPPORTED`; it never falls back to unbound tokens. Re-check this file on every upgrade of `@fast-auth-near/*` or `@auth0/auth0-spa-js`.
- **Stolen token and cookie:** someone holding both the user's token and their HttpOnly nonce cookie inside the 10-minute window could still race the user. That takes the same access as stealing the session cookie.
- **Signing JWTs:** these (`fatxn`) are not affected; the on-chain guard checks them, and each one can only sign its own payload.

## The plans (ARCHITECTURE.md §5) and what picks each
| Plan | What happens | Needs from the lab |
|---|---|---|
| **A** | One Google login → the server verifies the ID token and derives the MPC key → one factory transaction creates `<handle>.wgp.testnet` with that key (full access) plus the browser's session key (game contract only, 0.05 NEAR allowance) → no popups during play. A new device costs one popup: NEAR Auth signs `AddKey(session key)` as a delegate and the relayer submits it. | Step 3 passes (ID token available, server key equals SDK key) **and** step 5's MPC signature verifies against that key |
| **B** | NEAR Auth owns the account (implicit, or one it creates); one popup signs `AddKey(session key)` as a delegate; the relayer submits it. | Step 3 fails, but steps 4 and 5 pass |
| **C** | Session keys live in the contract and are checked with `ed25519_verify`; works with any signer. | Step 4 or 5 fails (no delegate approval, or a signature that doesn't verify) |

`apps/wgp/src/app/lab/near-auth/plan.ts` applies these rules; the lab shows its pick live.

## Run it (owner, about 3 minutes)
1. In `apps/wgp/.env.local` set `NEAR_NETWORK=testnet`, `WGP_CONTRACT_ID=game.wgp.testnet` and `ALLOW_NEAR_AUTH_LAB=1`. For step 5 also set `RELAYER_ACCOUNT_ID` and `RELAYER_PRIVATE_KEYS` for a funded testnet account (about 1 NEAR is plenty).
2. `pnpm dev`, then open `http://localhost:3000/lab/near-auth`. The shared Auth0 client must allow that origin; if Auth0 refuses the callback, try the deployed preview URL.
3. Click through steps 1–5:
   1. **Sign in with Google.**
   2. **Resolve account.** Optionally type a named account to check.
   3. **Verify on the server.** This works once per Google login, because the sign-in nonce is single-use; sign in again to repeat it.
   4. **Prepare delegate**, then **Approve in NEAR Auth.**
   5. **Relay sign.**
4. Repeat steps 1 and 4 with **Redirect** selected if popups misbehave on your phone.
5. Copy the results JSON and paste it below. It holds no email and only a 16-hex hash of the Google subject.

## Results
_Paste the lab JSON here._
