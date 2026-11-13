import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkBlockedError, isLoopback, takeNetworkViolations, unguardedFetch } from "./no-network";

/** These tests trip the guard on purpose, so they clear its record before its afterEach reads it. */
describe("the test suite's network guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a fetch to a real host and records it", async () => {
    await expect(fetch("https://rpc.mainnet.near.org")).rejects.toBeInstanceOf(NetworkBlockedError);
    await expect(fetch(new URL("https://www.wgponnear.fun/api/stats"))).rejects.toThrow(/tried to reach the network/);
    expect(takeNetworkViolations()).toEqual(["fetch https://rpc.mainnet.near.org", "fetch https://www.wgponnear.fun/api/stats"]);
  });

  it("still records the request when the code under test swallows the error", async () => {
    const swallowed = await fetch("https://api.nearblocks.io/v1/stats").catch(() => "caught");
    expect(swallowed).toBe("caught");
    // Had this test not taken the record, the guard's afterEach would have failed it.
    expect(takeNetworkViolations()).toEqual(["fetch https://api.nearblocks.io/v1/stats"]);
  });

  it("refuses a raw https or http connection to a real host", async () => {
    const attempt = (mod: typeof http | typeof https, url: string) =>
      new Promise<Error>((resolve) => {
        const req = mod.get(url, () => resolve(new Error("connected")));
        req.on("error", resolve);
      });
    expect(await attempt(https, "https://rpc.mainnet.near.org/status")).toBeInstanceOf(NetworkBlockedError);
    expect(await attempt(http, "http://example.com/")).toBeInstanceOf(NetworkBlockedError);
    expect(takeNetworkViolations()).toEqual(["connect rpc.mainnet.near.org:443", "connect example.com:80"]);
  });

  it("refuses Node's own fetch at the socket, if a test puts the real one back", async () => {
    vi.stubGlobal("fetch", unguardedFetch());
    await expect(fetch("https://rpc.mainnet.near.org/status")).rejects.toThrow(/fetch failed/);
    expect(takeNetworkViolations()).toEqual(["connect rpc.mainnet.near.org:443"]);
  });

  it("lets a loopback connection through", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe("ok");
      expect(takeNetworkViolations()).toEqual([]);
    } finally {
      server.close();
    }
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("rpc.mainnet.near.org")).toBe(false);
  });

  it("game-core has no network API to guard: its source never names fetch, a socket or an http module", () => {
    // packages/game-core runs its own vitest without this setup file, so its claim is checked here.
    const root = fileURLToPath(new URL("../../../../packages/game-core", import.meta.url));
    const files = ["src", "test"].flatMap((dir) =>
      readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
        .map((f) => path.join(root, dir, f)),
    );
    expect(files.length).toBeGreaterThan(50);
    const network = /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|["'](?:node:)?(?:https?|http2|net|tls|dgram|dns)["']|["']undici["']/;
    expect(files.filter((f) => network.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f))).toEqual([]);
  });

  it("leaves a test's own fetch stub alone", async () => {
    const stub = vi.fn(async () => new Response("stubbed"));
    vi.stubGlobal("fetch", stub);
    expect(await (await fetch("https://rpc.mainnet.near.org")).text()).toBe("stubbed");
    expect(stub).toHaveBeenCalledOnce();
    expect(takeNetworkViolations()).toEqual([]);
  });
});
