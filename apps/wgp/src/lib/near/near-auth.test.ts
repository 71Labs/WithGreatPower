import { describe, expect, it } from "vitest";

import { NearAuth, NearAuthError, withNonce } from "./near-auth";

const AUTHORIZE =
  "https://login.testnet.fast-auth.com/authorize?client_id=np8p&scope=openid%20profile%20email&response_type=code&response_mode=web_message&state=c3RhdGU%3D&nonce=YXV0aDA%3D&redirect_uri=http%3A%2F%2Flocalhost%3A3000&code_challenge=abc&code_challenge_method=S256";

describe("withNonce", () => {
  it("swaps only the nonce parameter", () => {
    const out = withNonce(AUTHORIZE, "server-nonce_42");
    expect(out).toBe(AUTHORIZE.replace("nonce=YXV0aDA%3D", "nonce=server-nonce_42"));
    expect(new URL(out).searchParams.get("nonce")).toBe("server-nonce_42");
    expect(new URL(out).searchParams.get("state")).toBe("c3RhdGU=");
  });

  it("adds a nonce to a URL that has none", () => {
    expect(withNonce("https://x/authorize?a=1", "n")).toBe("https://x/authorize?a=1&nonce=n");
  });
});

/** A stand-in for auth0-spa-js: login builds the authorize URL through _prepareAuthorizeUrl, like 2.x does. */
class FakeAuth0 {
  seen: { nonce: string; url: string }[] = [];
  async _prepareAuthorizeUrl(): Promise<{ nonce: string; url: string; state: string }> {
    return { nonce: "YXV0aDA=", url: AUTHORIZE, state: "c3RhdGU=" };
  }
  async loginWithPopup() {
    // auth0-spa-js keeps `prepared.nonce` to check the ID token against.
    const prepared = await this._prepareAuthorizeUrl();
    this.seen.push({ nonce: prepared.nonce, url: prepared.url });
  }
  async getIdTokenClaims() {
    return { sub: "google-oauth2|1", __raw: "header.payload.sig" };
  }
}

function makeAuth(auth0: object) {
  const provider = { client: auth0 } as never;
  const client = {
    login: async () => {
      await (auth0 as FakeAuth0).loginWithPopup();
      return { userId: "google-oauth2|1" };
    },
  } as never;
  return new NearAuth(provider, client);
}

describe("NearAuth.login with a server nonce", () => {
  it("sends our nonce to Auth0 and checks the token against it, for that login only", async () => {
    const auth0 = new FakeAuth0();
    const auth = makeAuth(auth0);
    await auth.login({ nonce: "server-nonce" });
    expect(auth0.seen[0]!.nonce).toBe("server-nonce");
    expect(new URL(auth0.seen[0]!.url).searchParams.get("nonce")).toBe("server-nonce");
    // Back to auth0-spa-js's own behaviour afterwards.
    expect(Object.prototype.hasOwnProperty.call(auth0, "_prepareAuthorizeUrl")).toBe(false);
    await auth.login();
    expect(auth0.seen[1]!.nonce).toBe("YXV0aDA=");
  });

  it("restores the Auth0 client even when the login fails", async () => {
    const auth0 = new FakeAuth0();
    const auth = new NearAuth({ client: auth0 } as never, { login: async () => Promise.reject(new Error("cancelled")) } as never);
    await expect(auth.login({ nonce: "n" })).rejects.toThrow("cancelled");
    expect(Object.prototype.hasOwnProperty.call(auth0, "_prepareAuthorizeUrl")).toBe(false);
  });

  it("fails closed when the SDK has no way to carry a nonce", async () => {
    const auth = makeAuth({ getIdTokenClaims: async () => undefined, loginWithPopup: async () => {} });
    const error = await auth.login({ nonce: "n" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NearAuthError);
    expect((error as NearAuthError).code).toBe("NONCE_UNSUPPORTED");
  });
});
