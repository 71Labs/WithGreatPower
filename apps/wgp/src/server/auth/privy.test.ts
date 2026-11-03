import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { KeyPair, keyToImplicitAddress } from "near-api-js";
import { describe, expect, it, vi } from "vitest";

import { identityFromUser, privyEnv, privyPort, PrivyAuthError, PrivyConfigError, toPrivyHttpError, verifiedEmail, verifyPrivyLogin, type PrivyPort, type PrivyUserRecord } from "./privy";
import { HttpError } from "../http";

const APP_ID = "cm-test-app-0001";
const USER = "did:privy:cmuser000000000000000001";
const NOW_S = () => Math.floor(Date.now() / 1000);

const signer = generateKeyPairSync("ec", { namedCurve: "P-256" });
const stranger = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = signer.publicKey.export({ type: "spki", format: "pem" }) as string;

/** An ES256 JWT, as Privy issues access tokens. */
function jwt(claims: Record<string, unknown>, opts: { key?: KeyObject; header?: Record<string, unknown> } = {}): string {
  const h = Buffer.from(JSON.stringify(opts.header ?? { alg: "ES256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const s = sign("sha256", Buffer.from(`${h}.${p}`), { key: opts.key ?? signer.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${h}.${p}.${s}`;
}

const claims = (over: Record<string, unknown> = {}) => ({ iss: "privy.io", aud: APP_ID, sub: USER, sid: "session-1", iat: NOW_S() - 60, exp: NOW_S() + 3600, ...over });

const near = KeyPair.fromRandom("ed25519");
const NEAR_KEY = near.getPublicKey().toString();
const IMPLICIT = keyToImplicitAddress(NEAR_KEY);

function user(over: Partial<PrivyUserRecord> = {}): PrivyUserRecord {
  return {
    id: USER,
    linked_accounts: [
      { type: "google_oauth", email: "Peter.Parker@Example.com", subject: "1234", name: "Peter", verified_at: 1_790_000_000 },
      { type: "wallet", chain_type: "ethereum", address: "0xabc", connector_type: "embedded", wallet_client_type: "privy", verified_at: 1 },
      { type: "wallet", chain_type: "near", address: IMPLICIT, connector_type: "embedded", wallet_client_type: "privy", wallet_index: 0, verified_at: 1 },
    ],
    ...over,
  };
}

/** The real SDK's verification (offline, with a verification key) and a fake user lookup. */
async function port(record: PrivyUserRecord = user()): Promise<PrivyPort & { lookups: string[] }> {
  const real = await privyPort({ appId: APP_ID, appSecret: "test-secret-not-real", verificationKey: PEM });
  const lookups: string[] = [];
  return {
    lookups,
    verifyAccessToken: (t) => real.verifyAccessToken(t),
    getUser: async (id) => {
      lookups.push(id);
      return record;
    },
  };
}

describe("verifyPrivyLogin (Privy's SDK, our checks, Privy's user record)", () => {
  it("accepts our app's fresh token and reads the email and NEAR key from Privy", async () => {
    const p = await port();
    const id = await verifyPrivyLogin(jwt(claims()), { port: p, appId: APP_ID });
    expect(id).toEqual({ userId: USER, email: "peter.parker@example.com", near: { publicKey: NEAR_KEY, implicitAccountId: IMPLICIT } });
    expect(p.lookups).toEqual([USER]);
  });

  it("refuses forged, foreign, expired and unsigned tokens before asking Privy for anyone", async () => {
    const p = await port();
    const cases = [
      jwt(claims(), { key: stranger.privateKey }),
      jwt(claims({ aud: "someone-elses-app" })),
      jwt(claims({ iss: "evil.example" })),
      jwt(claims({ exp: NOW_S() - 10 })),
      jwt(claims(), { header: { alg: "none", typ: "JWT" } }),
      jwt(claims(), { header: { alg: "ES256", typ: "at+jwt" } }),
      "not-a-token-at-all-just-text",
    ];
    for (const token of cases) {
      const error = await verifyPrivyLogin(token, { port: p, appId: APP_ID }).catch((e: unknown) => e);
      expect(error, token).toBeInstanceOf(PrivyAuthError);
      expect((error as PrivyAuthError).code).toBe("bad_token");
    }
    expect(p.lookups).toEqual([]);
  });

  it("re-checks the claims the SDK returns, in case it was misconfigured", async () => {
    const lax = (over: Partial<Awaited<ReturnType<PrivyPort["verifyAccessToken"]>>>): PrivyPort => ({
      verifyAccessToken: async () => ({ app_id: APP_ID, issuer: "privy.io", issued_at: NOW_S(), expiration: NOW_S() + 60, session_id: "s", user_id: USER, ...over }),
      getUser: async () => user(),
    });
    for (const over of [{ app_id: "other" }, { issuer: "auth0" }, { expiration: NOW_S() - 1 }, { user_id: "" }]) {
      await expect(verifyPrivyLogin("t", { port: lax(over), appId: APP_ID })).rejects.toMatchObject({ code: "bad_token" });
    }
  });

  it("doesn't pass Privy's own error text on to the caller", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: PrivyPort = {
      verifyAccessToken: async () => ({ app_id: APP_ID, issuer: "privy.io", issued_at: NOW_S(), expiration: NOW_S() + 60, session_id: "s", user_id: USER }),
      getUser: async () => {
        throw new Error("401 Unauthorized: app secret sk-not-for-callers rejected");
      },
    };
    const error = await verifyPrivyLogin("t", { port: failing, appId: APP_ID }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "privy_user" });
    const http = toPrivyHttpError(error) as HttpError;
    expect(http.status).toBe(502);
    expect(http.message).not.toContain("sk-not-for-callers");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("refuses a user record for someone other than the token's subject", async () => {
    const p = await port(user({ id: "did:privy:someone-else" }));
    await expect(verifyPrivyLogin(jwt(claims()), { port: p, appId: APP_ID })).rejects.toMatchObject({ code: "privy_user" });
  });
});

describe("identityFromUser", () => {
  it("has no NEAR key until the user's Privy NEAR wallet exists, and ignores other chains", () => {
    const id = identityFromUser(user({ linked_accounts: user().linked_accounts.filter((a) => a.chain_type !== "near") }));
    expect(id.near).toBeNull();
    expect(id.email).toBe("peter.parker@example.com");
  });

  it("ignores linked external NEAR wallets: only Privy's own key counts", () => {
    const external = { type: "wallet", chain_type: "near", address: "a".repeat(64), connector_type: "injected", wallet_client_type: "meteor", verified_at: 1 };
    const id = identityFromUser(user({ linked_accounts: [external] }));
    expect(id.near).toBeNull();
  });

  it("checks Privy's public key against the address when both are given", () => {
    const withKey = (public_key: string) => user({ linked_accounts: [{ type: "wallet", chain_type: "near", address: IMPLICIT, connector_type: "embedded", public_key, verified_at: 1 }] });
    expect(identityFromUser(withKey(NEAR_KEY)).near?.implicitAccountId).toBe(IMPLICIT);
    expect(identityFromUser(withKey(`0x${IMPLICIT}`)).near?.publicKey).toBe(NEAR_KEY);
    expect(identityFromUser(withKey(`00${IMPLICIT}`)).near?.publicKey).toBe(NEAR_KEY);
    const other = KeyPair.fromRandom("ed25519").getPublicKey().toString();
    expect(() => identityFromUser(withKey(other))).toThrow(PrivyAuthError);
  });

  it("refuses ids that aren't Privy user ids", () => {
    expect(() => identityFromUser(user({ id: "google-oauth2|123" }))).toThrow(PrivyAuthError);
  });
});

describe("verifiedEmail", () => {
  it("takes Google's email, lowercased; an unverified one doesn't count", () => {
    expect(verifiedEmail([{ type: "google_oauth", email: " A@B.co ", verified_at: 5 }])).toBe("a@b.co");
    expect(verifiedEmail([{ type: "google_oauth", email: "a@b.co" }])).toBeNull();
    expect(verifiedEmail([{ type: "email", address: "otp@b.co", verified_at: 5 }])).toBe("otp@b.co");
    expect(verifiedEmail([{ type: "google_oauth", email: "not an email", verified_at: 5 }])).toBeNull();
    expect(verifiedEmail([])).toBeNull();
  });
});

describe("privyEnv and errors", () => {
  it("needs the app id and the secret, and never echoes them", () => {
    expect(() => privyEnv({})).toThrow(PrivyConfigError);
    expect(() => privyEnv({ NEXT_PUBLIC_PRIVY_APP_ID: APP_ID })).toThrow(/PRIVY_APP_SECRET/);
    expect(privyEnv({ NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_APP_SECRET: "s3cret" })).toEqual({ appId: APP_ID, appSecret: "s3cret" });
    expect(privyEnv({ PRIVY_APP_ID: "server-id", NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_APP_SECRET: "s3cret" }).appId).toBe("server-id");
    const http = toPrivyHttpError(new PrivyConfigError(["PRIVY_APP_SECRET"])) as HttpError;
    expect(http).toBeInstanceOf(HttpError);
    expect(http.status).toBe(503);
    expect((toPrivyHttpError(new PrivyAuthError("bad_token", "expired")) as HttpError).status).toBe(401);
  });
});
