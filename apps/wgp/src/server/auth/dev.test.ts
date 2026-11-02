import { afterEach, describe, expect, it, vi } from "vitest";

import { setDb } from "@/server/db/client";
import { freshDb } from "@/server/db/test-helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string) => jar.set(name, value) }),
}));

import { POST } from "@/app/api/auth/dev/route";

import { devAuthEnabled } from "./dev";

const login = (handle = "spidey") =>
  POST(new Request("http://test/api/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }) }));

describe("dev auth guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setDb(undefined);
    jar.clear();
  });

  it("is on only outside production with ALLOW_DEV_AUTH=1", () => {
    expect(devAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_AUTH: "1" })).toBe(true);
    expect(devAuthEnabled({ NODE_ENV: "test", ALLOW_DEV_AUTH: "1" })).toBe(true);
    expect(devAuthEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_AUTH: "true" })).toBe(false);
    expect(devAuthEnabled({ NODE_ENV: "production", ALLOW_DEV_AUTH: "1" })).toBe(false);
  });

  it("answers 404 in production even with the flag set, and creates nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_AUTH", "1");
    const res = await login();
    expect(res.status).toBe(404);
    expect(jar.size).toBe(0);
  });

  it("answers 404 in dev without the flag", async () => {
    vi.stubEnv("ALLOW_DEV_AUTH", "");
    expect((await login()).status).toBe(404);
  });

  it("signs a dev player in when enabled, and is idempotent per handle", async () => {
    await freshDb();
    vi.stubEnv("ALLOW_DEV_AUTH", "1");
    const res = await login("spidey");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { player: { id: string; nearAccountId: string; authKind: string } };
    expect(body.player).toMatchObject({ nearAccountId: "spidey.dev.wgp.testnet", authKind: "dev" });
    expect(jar.get("wgp_session")).toBeTruthy();

    const again = (await (await login("spidey")).json()) as { player: { id: string } };
    expect(again.player.id).toBe(body.player.id);
    expect((await login("NOT VALID!")).status).toBe(400);
  });
});
