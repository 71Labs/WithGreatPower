import { beforeEach, describe, expect, it } from "vitest";

import { setDb, type Db } from "@/server/db/client";
import { freshDb, makePlayer } from "@/server/db/test-helpers";
import { HttpError } from "@/server/http";

import { addSessionKey, liveSessionKeys, playerByAuthSub, relayLookup, revokeSessionKey } from "./session-keys";

const KEY_A = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const KEY_B = "ed25519:9VbL8sWkXF7qjNKLTqLuhYEh6Pp6pmSB2xbUBvT1E5Vr";

describe("session keys", () => {
  let db: Db;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    db = await freshDb();
    alice = (await makePlayer(db, "alice")).id;
    bob = (await makePlayer(db, "bob")).id;
    return () => setDb(undefined);
  });

  it("looks up the sender and key for the relayer", async () => {
    await addSessionKey(db, { playerId: alice, publicKey: KEY_A, addTx: "tx1" });
    const found = await relayLookup(db, "alice.wgp.testnet", KEY_A);
    expect(found.sender).toEqual({ playerId: alice, accountId: "alice.wgp.testnet", banned: false });
    expect(found.sessionKey).toEqual({ playerId: alice, publicKey: KEY_A, revoked: false });
    expect(await relayLookup(db, "nobody.wgp.testnet", KEY_B)).toEqual({ sender: null, sessionKey: null });
  });

  it("is idempotent for the owner and a conflict for anyone else", async () => {
    await addSessionKey(db, { playerId: alice, publicKey: KEY_A });
    await addSessionKey(db, { playerId: alice, publicKey: KEY_A });
    await expect(addSessionKey(db, { playerId: bob, publicKey: KEY_A })).rejects.toThrow(HttpError);
    expect(await liveSessionKeys(db, alice)).toEqual([KEY_A]);
  });

  it("revokes keys so the relayer refuses them", async () => {
    await addSessionKey(db, { playerId: alice, publicKey: KEY_A });
    expect(await revokeSessionKey(db, bob, KEY_A)).toBe(false);
    expect(await revokeSessionKey(db, alice, KEY_A)).toBe(true);
    expect((await relayLookup(db, "alice.wgp.testnet", KEY_A)).sessionKey?.revoked).toBe(true);
    expect(await liveSessionKeys(db, alice)).toEqual([]);
    await expect(addSessionKey(db, { playerId: alice, publicKey: KEY_A })).rejects.toThrow(/revoked/);
  });

  it("finds players by NEAR Auth subject", async () => {
    expect((await playerByAuthSub(db, "sub:alice"))?.id).toBe(alice);
    expect(await playerByAuthSub(db, "sub:nobody")).toBeNull();
  });
});
