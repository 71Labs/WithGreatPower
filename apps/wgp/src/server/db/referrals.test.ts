/**
 * Referrals on an in-memory database: invite codes, attaching only on creation, every late
 * claim rule, when a friend counts, and the "Invite 3 friends" grant (once, under concurrency,
 * XP once, one badge in the outbox, held while a run is in flight). "Played" is proven the way
 * the game proves it: friends play a bot night that the server replays with the real verifier.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chooseErrand, needsErrand, runHash, runLog, startRun as startClientRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";

import { HttpError } from "@/server/http";
import { setVerifier } from "@/server/verify";

import { applyAction } from "./actions";
import { setDb, type Db } from "./client";
import { rewardFromOp } from "./outbox";
import { ensureSave, getPlayer } from "./players";
import {
  CLAIM_WINDOW_MS,
  CODE_ALPHABET,
  REFERRAL_GOAL,
  REFERRAL_XP,
  addXp,
  adminReferrals,
  attachReferral,
  claimReferral,
  ensureReferralCode,
  evaluateReferrals,
  evaluateReferrer,
  grantRecruiter,
  inviteOrigin,
  inviteView,
  newReferralCode,
  normalizeReferralCode,
  normalizedX,
  recruiterBadgeKey,
  referralView,
  referralsCsv,
  reviewFlags,
  scoreFriends,
  type FriendRow,
} from "./referrals";
import { startRun, submitRun } from "./runs";
import { chainOps, players, referralRewards, saves } from "./schema";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-07T20:00:00Z");
const minutes = (n: number, from = T0) => new Date(from.getTime() + n * 60_000);

/** Plays a night as the browser would: same save, same seed, the bot's inputs recorded. */
function playNight(save: Save, seed: number) {
  const run = startClientRun(save, seed);
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    if (needsErrand(run)) chooseErrand(run, 0);
    else stepRun(run, botFrame(run.sim, mem));
  }
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

const afterTicks = (ticks: number, from: Date) => new Date(from.getTime() + Math.ceil(ticks / 60) * 1000 + 5000);

let db: Db;

beforeEach(async () => {
  setVerifier(undefined);
  db = await freshDb();
});
afterEach(() => {
  setVerifier(undefined);
  setDb(undefined);
});

/** A ranked night, issued by the server, played by the bot and verified by the server's real replay. */
async function verifiedNight(playerId: string, at = T0): Promise<string> {
  const started = await startRun(db, { playerId, now: at });
  const { save } = await ensureSave(db, playerId);
  const played = playNight(save, started.seed);
  const result = await submitRun(db, { playerId, runId: started.runId, log: played.log, clientHash: played.hash, now: afterTicks(played.ticks, at) });
  expect(result.status).toBe("verified");
  return started.runId;
}

/** A night whose log claims another outcome: the replay rejects it. */
async function rejectedNight(playerId: string, at = T0): Promise<void> {
  const started = await startRun(db, { playerId, now: at });
  const { save } = await ensureSave(db, playerId);
  const played = playNight(save, started.seed);
  const result = await submitRun(db, { playerId, runId: started.runId, log: played.log, clientHash: "deadbeef", now: afterTicks(played.ticks, at) });
  expect(result.status).toBe("rejected");
}

async function hero(handle: string) {
  const p = await makePlayer(db, handle);
  await givePlayerHero(db, p.id, handle);
  return p;
}

/** A friend who signed up through `code` at `at`. */
async function friendOf(code: string, handle: string, at = T0) {
  const p = await hero(handle);
  await db.update(players).set({ createdAt: at }).where(eq(players.id, p.id));
  expect(await attachReferral(db, { playerId: p.id, code, created: true, now: at })).toMatchObject({ attached: true });
  return p;
}

/** Sets an X handle as stored, skipping the save check (older rows may share one). */
const setX = (playerId: string, xHandle: string | null) => db.update(players).set({ xHandle }).where(eq(players.id, playerId));

/** A referrer with a hero and a code, and three friends who each added X and played a verified night. */
async function referrerWithThree() {
  const sele = await hero("sele");
  const code = await ensureReferralCode(db, sele.id);
  const friends = [];
  for (const [i, name] of ["nora", "omar", "pia"].entries()) {
    const f = await friendOf(code, name, minutes(i * 30));
    await setX(f.id, `${name}_x`);
    await verifiedNight(f.id, minutes(i * 30 + 5));
    friends.push(f);
  }
  return { sele, code, friends };
}

const rewards = (playerId: string) => db.select().from(referralRewards).where(eq(referralRewards.playerId, playerId));
const badgeOps = (playerId: string) => db.select().from(chainOps).where(eq(chainOps.dedupeKey, recruiterBadgeKey(playerId)));

describe("invite codes", () => {
  it("are 7 characters of Crockford base32, uppercase", () => {
    for (let i = 0; i < 200; i++) expect(newReferralCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{7}$/);
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(newReferralCode(() => new Uint8Array([0, 1, 31, 32, 255, 10, 17]))).toBe("01Z0ZAH");
  });

  it("are read case-insensitively, with Crockford's look-alikes as digits", () => {
    expect(normalizeReferralCode("k7q2m9x")).toBe("K7Q2M9X");
    expect(normalizeReferralCode(" K7Q-2M9X ")).toBe("K7Q2M9X");
    expect(normalizeReferralCode("O1ILabc")).toBe("0111ABC");
    for (const bad of ["K7Q2M9", "K7Q2M9XX", "K7Q2M9U", "K7Q2M9!", "", null, 42, "x".repeat(40)]) expect(normalizeReferralCode(bad)).toBeNull();
  });

  it("are made once per player, on first ask, even when asked twice at once", async () => {
    const p = await makePlayer(db, "sele");
    expect((await getPlayer(db, p.id))!.referralCode).toBeNull();
    const [a, b] = await Promise.all([ensureReferralCode(db, p.id), ensureReferralCode(db, p.id)]);
    expect(a).toBe(b);
    expect(await ensureReferralCode(db, p.id)).toBe(a);
    expect((await getPlayer(db, p.id))!.referralCode).toBe(a);
  });

  it("draw again when a code is already someone else's", async () => {
    const a = await makePlayer(db, "ana");
    const b = await makePlayer(db, "ben");
    const same = () => new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const first = await ensureReferralCode(db, a.id, same);
    let calls = 0;
    const clashOnce = (n: number) => (calls++ === 0 ? same() : new Uint8Array(n).fill(9));
    const second = await ensureReferralCode(db, b.id, clashOnce);
    expect(first).toBe("1234567");
    expect(second).toBe("9999999");
  });
});

describe("attaching a friend", () => {
  it("links a player the sign-in created, once", async () => {
    const sele = await makePlayer(db, "sele");
    const code = await ensureReferralCode(db, sele.id);
    const nora = await makePlayer(db, "nora");
    expect(await attachReferral(db, { playerId: nora.id, code: code.toLowerCase(), created: true, now: T0 })).toEqual({ attached: true, referrerId: sele.id });
    const row = (await getPlayer(db, nora.id))!;
    expect(row.referredBy).toBe(sele.id);
    expect(row.referredAt?.toISOString()).toBe(T0.toISOString());

    // Another code later never moves them.
    const ana = await makePlayer(db, "ana");
    const other = await ensureReferralCode(db, ana.id);
    expect(await attachReferral(db, { playerId: nora.id, code: other, created: true })).toEqual({ attached: false, reason: "already" });
    expect((await getPlayer(db, nora.id))!.referredBy).toBe(sele.id);
  });

  it("never attaches an existing player", async () => {
    const sele = await makePlayer(db, "sele");
    const code = await ensureReferralCode(db, sele.id);
    const old = await makePlayer(db, "old");
    expect(await attachReferral(db, { playerId: old.id, code, created: false })).toEqual({ attached: false, reason: "not_new" });
    expect((await getPlayer(db, old.id))!.referredBy).toBeNull();
  });

  it("refuses unknown codes, banned referrers, the player's own code and a cycle", async () => {
    const sele = await makePlayer(db, "sele");
    const code = await ensureReferralCode(db, sele.id);
    const nora = await makePlayer(db, "nora");
    expect(await attachReferral(db, { playerId: nora.id, code: "ZZZZZZZ", created: true })).toEqual({ attached: false, reason: "bad_code" });
    expect(await attachReferral(db, { playerId: nora.id, code: "nope", created: true })).toEqual({ attached: false, reason: "bad_code" });
    expect(await attachReferral(db, { playerId: sele.id, code, created: true })).toEqual({ attached: false, reason: "self" });

    await db.update(players).set({ referredBy: nora.id }).where(eq(players.id, sele.id));
    expect(await attachReferral(db, { playerId: nora.id, code, created: true })).toEqual({ attached: false, reason: "cycle" });

    await db.update(players).set({ bannedAt: T0, referredBy: null }).where(eq(players.id, sele.id));
    expect(await attachReferral(db, { playerId: nora.id, code, created: true })).toEqual({ attached: false, reason: "banned" });
    expect((await getPlayer(db, nora.id))!.referredBy).toBeNull();
  });
});

describe("a late claim", () => {
  async function setup() {
    const sele = await makePlayer(db, "sele");
    const code = await ensureReferralCode(db, sele.id);
    const nora = await makePlayer(db, "nora");
    await db.update(players).set({ createdAt: T0 }).where(eq(players.id, nora.id));
    return { sele, code, nora };
  }

  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    const e = error as HttpError;
    return { status: e.status, code: e.code };
  };

  it("names the inviter in the first 48 hours", async () => {
    const { sele, code, nora } = await setup();
    expect(await claimReferral(db, { playerId: nora.id, code: code.toLowerCase(), now: minutes(60) })).toEqual({ referrerId: sele.id, handle: "sele" });
    expect((await getPlayer(db, nora.id))!.referredBy).toBe(sele.id);
  });

  it("answers 409 already_referred once they have an inviter", async () => {
    const { code, nora } = await setup();
    await claimReferral(db, { playerId: nora.id, code, now: minutes(1) });
    expect(await refusal(claimReferral(db, { playerId: nora.id, code, now: minutes(2) }))).toEqual({ status: 409, code: "already_referred" });
  });

  it("answers 422 bad_code for unknown, malformed and banned players' codes", async () => {
    const { sele, code, nora } = await setup();
    expect(await refusal(claimReferral(db, { playerId: nora.id, code: "ZZZZZZZ", now: minutes(1) }))).toEqual({ status: 422, code: "bad_code" });
    expect(await refusal(claimReferral(db, { playerId: nora.id, code: "??", now: minutes(1) }))).toEqual({ status: 422, code: "bad_code" });
    await db.update(players).set({ bannedAt: T0 }).where(eq(players.id, sele.id));
    expect(await refusal(claimReferral(db, { playerId: nora.id, code, now: minutes(1) }))).toEqual({ status: 422, code: "bad_code" });
  });

  it("answers 422 self for the player's own code", async () => {
    const { nora } = await setup();
    const own = await ensureReferralCode(db, nora.id);
    expect(await refusal(claimReferral(db, { playerId: nora.id, code: own, now: minutes(1) }))).toEqual({ status: 422, code: "self" });
  });

  it("answers 422 too_late after 48 hours", async () => {
    const { code, nora } = await setup();
    const late = new Date(T0.getTime() + CLAIM_WINDOW_MS + 1000);
    expect(await refusal(claimReferral(db, { playerId: nora.id, code, now: late }))).toEqual({ status: 422, code: "too_late" });
    expect(await claimReferral(db, { playerId: nora.id, code, now: new Date(T0.getTime() + CLAIM_WINDOW_MS - 1000) })).toMatchObject({ handle: "sele" });
  });

  it("answers 422 cycle when the inviter was invited by this player", async () => {
    const { sele, code, nora } = await setup();
    await db.update(players).set({ referredBy: nora.id }).where(eq(players.id, sele.id));
    expect(await refusal(claimReferral(db, { playerId: nora.id, code, now: minutes(1) }))).toEqual({ status: 422, code: "cycle" });
  });

  it("lets only one of two players who claim each other's codes at once win", async () => {
    const { sele, code, nora } = await setup();
    await db.update(players).set({ createdAt: T0 }).where(eq(players.id, sele.id));
    const noraCode = await ensureReferralCode(db, nora.id);
    const outcomes = await Promise.allSettled([
      claimReferral(db, { playerId: nora.id, code, now: minutes(1) }),
      claimReferral(db, { playerId: sele.id, code: noraCode, now: minutes(1) }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 422, code: "cycle" });
  });
});

describe("when a friend counts", () => {
  const row = (id: string, over: Partial<FriendRow> = {}): FriendRow => ({
    id,
    handle: id,
    xHandle: `${id}_x`,
    nearAccountId: `${id}.near`,
    bannedAt: null,
    createdAt: minutes(Number(id.replace(/\D/g, "")) || 0),
    referredAt: null,
    verifiedRuns: 1,
    ...over,
  });
  const referrer = { xHandle: "Sele", bannedAt: null };

  it("needs an X handle and a verified run", () => {
    const out = scoreFriends(referrer, [row("f1"), row("f2", { xHandle: null }), row("f3", { verifiedRuns: 0 }), row("f4", { xHandle: "  " })]);
    expect(out.qualified).toEqual(["f1"]);
    expect(out.friends.map((f) => [f.id, f.x, f.played, f.why])).toEqual([
      ["f1", true, true, null],
      ["f2", false, true, "no_x"],
      ["f3", true, false, "no_run"],
      ["f4", false, true, "no_x"],
    ]);
  });

  it("counts two friends with the same handle once, whoever joined first", () => {
    const out = scoreFriends(referrer, [row("f2", { xHandle: "@Twin" }), row("f1", { xHandle: "twin" }), row("f3")]);
    expect(out.qualified).toEqual(["f1", "f3"]);
    expect(out.friends.find((f) => f.id === "f2")?.why).toBe("same_x");
  });

  it("doesn't count the referrer's own handle, a banned friend, or anyone for a banned referrer", () => {
    expect(scoreFriends(referrer, [row("f1", { xHandle: "@sele" })]).friends[0]?.why).toBe("own_x");
    expect(scoreFriends(referrer, [row("f1", { bannedAt: T0 })]).friends[0]?.why).toBe("banned");
    expect(scoreFriends({ xHandle: null, bannedAt: T0 }, [row("f1")]).qualified).toEqual([]);
    expect(normalizedX(" @@NoRa ")).toBe("nora");
  });

  it("counts friends by real verified runs only (not issued or rejected ones)", async () => {
    const sele = await hero("sele");
    const code = await ensureReferralCode(db, sele.id);
    const nora = await friendOf(code, "nora");
    const omar = await friendOf(code, "omar", minutes(20));
    const pia = await friendOf(code, "pia", minutes(40));
    for (const f of [nora, omar, pia]) await setX(f.id, `${f.handle}_x`);

    await verifiedNight(nora.id, minutes(5));
    await rejectedNight(omar.id, minutes(25));
    await startRun(db, { playerId: pia.id, now: minutes(45) }); // issued, never submitted

    const { view } = await referralView(db, sele.id, { origin: "https://wgp.test", now: minutes(60) });
    expect(view.invited).toEqual([
      { handle: "nora", joinedAt: T0.toISOString(), x: true, played: true, qualified: true },
      { handle: "omar", joinedAt: minutes(20).toISOString(), x: true, played: false, qualified: false },
      { handle: "pia", joinedAt: minutes(40).toISOString(), x: true, played: false, qualified: false },
    ]);
    expect(view.qualified).toBe(1);
    expect(view.reward.state).toBe("locked");
  });
});

describe("the Invite 3 friends reward", () => {
  it("is granted at three qualified friends: 300 XP once, rev + 1, one Recruiter badge in the outbox", async () => {
    const { sele, friends } = await referrerWithThree();
    const before = await ensureSave(db, sele.id);
    const out = await evaluateReferrer(db, sele.id, minutes(200));
    expect(out).toMatchObject({ state: "granted", granted: true, qualified: 3 });

    const after = await ensureSave(db, sele.id);
    expect(after.rev).toBe(before.rev + 1);
    expect(after.save.hero).toEqual(addXp(before.save.hero!, REFERRAL_XP));
    expect(after.save.hero!.level).toBeGreaterThan(before.save.hero!.level);
    expect({ ...after.save, hero: null }).toEqual({ ...before.save, hero: null });

    const [reward] = await rewards(sele.id);
    expect(reward).toMatchObject({ goal: REFERRAL_GOAL, xp: REFERRAL_XP, friends: friends.map((f) => f.id), grantedAt: minutes(200) });
    const ops = await badgeOps(sele.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "mint_reward", status: "pending", playerId: sele.id, rewardNonce: 1 });
    const minted = rewardFromOp(ops[0]!);
    expect(minted).toMatchObject({ accountId: "sele.wgp.testnet", items: [], badges: ["recruiter"], level: after.save.hero!.level });
    expect(minted.digest).toMatch(/^[0-9a-f]{64}$/);

    // Later triggers change nothing.
    expect(await evaluateReferrer(db, sele.id, minutes(300))).toMatchObject({ state: "granted", granted: false });
    expect((await ensureSave(db, sele.id)).rev).toBe(after.rev);
    expect(await badgeOps(sele.id)).toHaveLength(1);
  }, 60_000);

  it("is granted once when many triggers race: XP once, one row, one badge", async () => {
    const { sele, friends } = await referrerWithThree();
    const before = await ensureSave(db, sele.id);
    const outs = await Promise.all([
      ...Array.from({ length: 4 }, () => evaluateReferrer(db, sele.id, minutes(200))),
      ...Array.from({ length: 4 }, () => grantRecruiter(db, sele, friends.map((f) => f.id), minutes(200))),
      ...friends.map((f) => evaluateReferrals(db, { friend: f.id }, minutes(200))),
      referralView(db, sele.id, { origin: "https://wgp.test", now: minutes(200) }).then((r) => ({ granted: r.granted })),
    ]);
    expect(outs.filter((o) => (typeof o === "boolean" ? o : o.granted))).toHaveLength(1);
    expect(await rewards(sele.id)).toHaveLength(1);
    expect(await badgeOps(sele.id)).toHaveLength(1);
    const after = await ensureSave(db, sele.id);
    expect(after.rev).toBe(before.rev + 1);
    expect(after.save.hero).toEqual(addXp(before.save.hero!, REFERRAL_XP));
    expect((await getPlayer(db, sele.id))!.nextRewardNonce).toBe(2);
  }, 60_000);

  it("waits while the referrer has a run in flight, so that run still verifies, then goes through", async () => {
    const sele = await hero("sele");
    const code = await ensureReferralCode(db, sele.id);
    // Sele starts a night before their third friend counts.
    const started = await startRun(db, { playerId: sele.id, now: minutes(100) });
    const { save: seleStart } = await ensureSave(db, sele.id);
    let last = "";
    for (const [i, name] of ["nora", "omar", "pia"].entries()) {
      const f = await friendOf(code, name, minutes(i));
      await setX(f.id, `${name}_x`);
      await verifiedNight(f.id, minutes(10 + i));
      last = f.id;
    }
    // The third friend's verified run triggers Sele's count: held back.
    expect(await evaluateReferrals(db, { friend: last }, minutes(101))).toBe(false);
    expect(await evaluateReferrer(db, sele.id, minutes(101))).toMatchObject({ state: "deferred", reason: "run_active", qualified: 3 });
    expect(await rewards(sele.id)).toHaveLength(0);

    // Sele's night replays from the save it began with: still valid, since nothing moved it.
    const played = playNight(seleStart, started.seed);
    const result = await submitRun(db, { playerId: sele.id, runId: started.runId, log: played.log, clientHash: played.hash, now: afterTicks(played.ticks, minutes(100)) });
    expect(result.status).toBe("verified");
    const afterNight = await ensureSave(db, sele.id);

    // The submit's trigger evaluates Sele as a referrer too: the held grant goes through.
    expect(await evaluateReferrals(db, { referrer: sele.id }, minutes(200))).toBe(true);
    const granted = await ensureSave(db, sele.id);
    expect(granted.rev).toBe(afterNight.rev + 1);
    expect(granted.save.hero).toEqual(addXp(afterNight.save.hero!, REFERRAL_XP));
    expect(await badgeOps(sele.id)).toHaveLength(1);
  }, 60_000);

  it("waits for a hero to put the XP on", async () => {
    const sele = await makePlayer(db, "sele");
    const code = await ensureReferralCode(db, sele.id);
    for (const [i, name] of ["nora", "omar", "pia"].entries()) {
      const f = await friendOf(code, name, minutes(i));
      await setX(f.id, `${name}_x`);
      await verifiedNight(f.id, minutes(10 + i));
    }
    expect(await evaluateReferrer(db, sele.id, minutes(100))).toMatchObject({ state: "deferred", reason: "no_hero" });
    expect(await rewards(sele.id)).toHaveLength(0);
    await givePlayerHero(db, sele.id, "Sele");
    expect(await evaluateReferrer(db, sele.id, minutes(101))).toMatchObject({ state: "granted", granted: true });
  }, 60_000);

  it("isn't granted to a banned referrer, or with a banned, duplicate or self-handled friend among the three", async () => {
    const { sele, friends } = await referrerWithThree();
    await setX(sele.id, "Sele");
    await setX(friends[2]!.id, "@SELE");
    expect(await evaluateReferrer(db, sele.id)).toMatchObject({ state: "locked", qualified: 2 });
    await setX(friends[2]!.id, "NORA_X"); // the same as the first friend's
    expect(await evaluateReferrer(db, sele.id)).toMatchObject({ state: "locked", qualified: 2 });
    await setX(friends[2]!.id, "pia_x");
    await db.update(players).set({ bannedAt: T0 }).where(eq(players.id, friends[1]!.id));
    expect(await evaluateReferrer(db, sele.id)).toMatchObject({ state: "locked", qualified: 2 });
    await db.update(players).set({ bannedAt: null }).where(eq(players.id, friends[1]!.id));
    await db.update(players).set({ bannedAt: T0 }).where(eq(players.id, sele.id));
    expect(await evaluateReferrer(db, sele.id)).toMatchObject({ state: "locked", qualified: 0 });
    expect(await rewards(sele.id)).toHaveLength(0);
    expect(await badgeOps(sele.id)).toHaveLength(0);
  }, 60_000);
});

describe("the views", () => {
  it("GET /api/referrals' view: code, link, friends by game handle only, reward, inviter, claim window", async () => {
    const { sele, code, friends } = await referrerWithThree();
    const { view, granted } = await referralView(db, sele.id, { origin: "https://www.wgponnear.fun/", now: minutes(200) });
    expect(granted).toBe(true);
    expect(Object.keys(view).sort()).toEqual(["canClaim", "code", "goal", "invited", "link", "qualified", "referredBy", "reward", "self"]);
    expect(view).toMatchObject({ code, link: `https://www.wgponnear.fun/invite/${code}`, goal: 3, qualified: 3, referredBy: null, self: null });
    expect(view.reward).toEqual({ state: "queued", xp: 300, badge: "recruiter", tx: null });
    expect(view.invited.map((f) => f.handle)).toEqual(["nora", "omar", "pia"]);
    for (const f of view.invited) expect(Object.keys(f).sort()).toEqual(["handle", "joinedAt", "played", "qualified", "x"]);
    // Never a friend's X handle or NEAR account.
    const text = JSON.stringify(view);
    for (const f of friends) {
      expect(text).not.toContain(`${f.handle}_x`);
      expect(text).not.toContain(f.nearAccountId);
    }

    // Minted: the badge's transaction.
    await db.update(chainOps).set({ status: "sent", txHash: "tx-recruiter" }).where(eq(chainOps.dedupeKey, recruiterBadgeKey(sele.id)));
    expect((await referralView(db, sele.id, { origin: "http://127.0.0.1:3107" })).view.reward).toEqual({ state: "minted", xp: 300, badge: "recruiter", tx: "tx-recruiter" });

    // A friend sees who invited them, and can't claim again.
    const nora = (await referralView(db, friends[0]!.id, { origin: "http://127.0.0.1:3107", now: minutes(200) })).view;
    expect(nora).toMatchObject({ referredBy: "sele", canClaim: false, qualified: 0, invited: [], reward: { state: "locked", tx: null } });
    // Their own steps, for the friend side's checklist (an imported save's nights can't say).
    expect(nora.self).toEqual({ x: true, played: true, qualified: true });
    expect(nora.link).toMatch(/^http:\/\/127\.0\.0\.1:3107\/invite\/[0-9A-HJKMNP-TV-Z]{7}$/);
  }, 60_000);

  it("tells a friend their own steps by the rules that count them, and nobody else's", async () => {
    const sele = await hero("sele");
    await setX(sele.id, "Sele");
    const code = await ensureReferralCode(db, sele.id);
    const nora = await friendOf(code, "nora");
    const omar = await friendOf(code, "omar", minutes(20));
    const self = async (id: string) => (await referralView(db, id, { origin: "https://wgp.test", now: minutes(90) })).view.self;

    expect(await self(nora.id)).toEqual({ x: false, played: false, qualified: false });
    await setX(nora.id, "nora_x");
    expect(await self(nora.id)).toEqual({ x: true, played: false, qualified: false });
    await verifiedNight(nora.id, minutes(30));
    expect(await self(nora.id)).toEqual({ x: true, played: true, qualified: true });

    // The inviter's own handle is added, but doesn't count.
    await setX(omar.id, "@sele");
    await verifiedNight(omar.id, minutes(50));
    expect(await self(omar.id)).toEqual({ x: true, played: true, qualified: false });
    // A player nobody invited has no steps to show.
    expect(await self(sele.id)).toBeNull();
  }, 60_000);

  it("offers a late claim only to a new, uninvited player", async () => {
    const p = await makePlayer(db, "new");
    await db.update(players).set({ createdAt: T0 }).where(eq(players.id, p.id));
    expect((await referralView(db, p.id, { origin: "https://wgp.test", now: minutes(60) })).view.canClaim).toBe(true);
    expect((await referralView(db, p.id, { origin: "https://wgp.test", now: new Date(T0.getTime() + CLAIM_WINDOW_MS + 1) })).view.canClaim).toBe(false);
  });

  it("the invite landing's view: handle, hero name and suit; invalid for unknown or banned", async () => {
    const sele = await hero("sele");
    const code = await ensureReferralCode(db, sele.id);
    expect(await inviteView(db, code.toLowerCase())).toEqual({ valid: true, referrer: { handle: "sele", heroName: "sele", suit: "classic" } });
    expect(await inviteView(db, "ZZZZZZZ")).toEqual({ valid: false, referrer: null });
    expect(await inviteView(db, "../etc")).toEqual({ valid: false, referrer: null });
    const bare = await makePlayer(db, "bare");
    const bareCode = await ensureReferralCode(db, bare.id);
    await db.delete(saves).where(eq(saves.playerId, bare.id));
    expect(await inviteView(db, bareCode)).toEqual({ valid: true, referrer: { handle: "bare", heroName: null, suit: null } });
    expect(await db.select().from(saves).where(eq(saves.playerId, bare.id))).toHaveLength(0);
    await db.update(players).set({ bannedAt: T0 }).where(eq(players.id, sele.id));
    expect(await inviteView(db, code)).toEqual({ valid: false, referrer: null });
  });

  it("links use the request's origin (its forwarded Host first), else the site's", () => {
    const r = (url: string, headers: Record<string, string> = {}) => ({ url, headers: new Headers(headers) });
    expect(inviteOrigin(r("http://127.0.0.1:3107/api/referrals"))).toBe("http://127.0.0.1:3107");
    expect(inviteOrigin(r("http://localhost:3107/api/referrals", { host: "127.0.0.1:3107" }))).toBe("http://127.0.0.1:3107");
    expect(inviteOrigin(r("http://localhost/api/referrals", { "x-forwarded-host": "preview-abc.vercel.app", "x-forwarded-proto": "https", host: "localhost" }))).toBe("https://preview-abc.vercel.app");
    expect(inviteOrigin(r("https://www.wgponnear.fun/api/referrals", { host: "evil.test/<script>" }))).toBe("https://www.wgponnear.fun");
    expect(inviteOrigin(r("not a url"))).toBe("https://www.wgponnear.fun");
  });
});

describe("the admin list", () => {
  it("lists referrers with a qualified friend, most first, with review flags and a CSV", async () => {
    const { sele, friends } = await referrerWithThree();
    await setX(sele.id, "sele71");
    await evaluateReferrer(db, sele.id, minutes(200));
    // Ana's one friend shares an X handle with a stranger (an older row: the save check would refuse it now).
    const ana = await hero("ana");
    const anaCode = await ensureReferralCode(db, ana.id);
    const zed = await friendOf(anaCode, "zed", minutes(3));
    await setX(zed.id, "Shared_X");
    const stranger = await makePlayer(db, "stranger");
    await setX(stranger.id, "shared_x");
    await verifiedNight(zed.id, minutes(8));
    // Bo invited a friend who hasn't played: not listed.
    const bo = await makePlayer(db, "bo");
    await friendOf(await ensureReferralCode(db, bo.id), "idle", minutes(4));
    // A second verified night for Nora: she loses the "one run" flag.
    const { rev } = await ensureSave(db, friends[0]!.id);
    await applyAction(db, { playerId: friends[0]!.id, action: { type: "sleep" }, rev, now: minutes(300) });
    await verifiedNight(friends[0]!.id, minutes(301));
    // Omar moves within 10 minutes of Pia.
    await db.update(players).set({ createdAt: minutes(55) }).where(eq(players.id, friends[1]!.id));

    const list = await adminReferrals(db);
    expect(list.map((r) => [r.handle, r.qualified])).toEqual([
      ["sele", 3],
      ["ana", 1],
    ]);
    const [s, a] = list;
    expect(s).toMatchObject({ nearAccountId: "sele.wgp.testnet", xHandle: "sele71", banned: false, reward: { state: "queued", xp: 300, tx: null } });
    expect(s!.reward.grantedAt).toBe(minutes(200).toISOString());
    expect(s!.friends.map((f) => [f.handle, f.xHandle, f.nearAccountId, f.verifiedRuns, f.flags])).toEqual([
      ["nora", "nora_x", "nora.wgp.testnet", 2, []],
      ["omar", "omar_x", "omar.wgp.testnet", 1, ["close_signups", "one_run"]],
      ["pia", "pia_x", "pia.wgp.testnet", 1, ["close_signups", "one_run"]],
    ]);
    expect(s!.flags.sort()).toEqual(["close_signups", "one_run"]);
    expect(a!.friends[0]!.flags).toEqual(["shared_x", "one_run"]);
    expect(a!.reward.state).toBe("locked");

    const csv = referralsCsv(list).trimEnd().split("\r\n");
    expect(csv[0]).toBe(
      "referrer_handle,referrer_near_account,referrer_x,qualified,reward_state,reward_granted_at,badge_tx,friend_handle,friend_x,friend_near_account,friend_verified_runs,friend_joined_at,friend_flags",
    );
    expect(csv).toHaveLength(5);
    expect(csv[2]).toBe(`sele,sele.wgp.testnet,sele71,3,queued,${minutes(200).toISOString()},,omar,omar_x,omar.wgp.testnet,1,${minutes(30).toISOString()},close_signups one_run`);
    expect(csv[4]).toContain(",zed,Shared_X,zed.wgp.testnet,1,");
  }, 60_000);

  it("flags pure: sign-ups within 10 minutes, shared handles, one run; and CSV cells can't be formulas", () => {
    const f = (id: string, at: number, xHandle: string | null, verifiedRuns: number) => ({ id, createdAt: minutes(at), xHandle, verifiedRuns });
    const flags = reviewFlags([f("a", 0, "x1", 1), f("b", 9, "X2", 3), f("c", 30, null, 2)], new Set(["x2"]));
    expect(Object.fromEntries(flags)).toEqual({ a: ["close_signups", "one_run"], b: ["close_signups", "shared_x"], c: [] });

    const csv = referralsCsv([
      {
        playerId: "p",
        handle: "=HYPERLINK(1)",
        nearAccountId: "a,b",
        xHandle: 'say "hi"',
        banned: false,
        qualified: 1,
        friends: [{ playerId: "f", handle: "+f", xHandle: null, nearAccountId: "f.near", verifiedRuns: 1, joinedAt: "t", createdAt: "t", flags: [] }],
        reward: { state: "locked", xp: 300, badge: "recruiter", tx: null, grantedAt: null },
        flags: [],
      },
    ]);
    expect(csv.split("\r\n")[1]).toBe(`'=HYPERLINK(1),"a,b","say ""hi""",1,locked,,,'+f,,f.near,1,t,`);
  });
});

describe("the schema", () => {
  it("keeps one reward row per player and one code per player", async () => {
    const a = await makePlayer(db, "ana");
    const b = await makePlayer(db, "ben");
    await db.update(players).set({ referralCode: "AAAAAAA" }).where(eq(players.id, a.id));
    await expect(db.update(players).set({ referralCode: "AAAAAAA" }).where(eq(players.id, b.id))).rejects.toThrow();
    await db.insert(referralRewards).values({ playerId: a.id, goal: 3, friends: [], xp: 300 });
    await expect(db.insert(referralRewards).values({ playerId: a.id, goal: 3, friends: [], xp: 300 })).rejects.toThrow();
    // Deleting a referrer leaves their friends unattached, not deleted.
    await db.update(players).set({ referredBy: a.id }).where(eq(players.id, b.id));
    await db.delete(players).where(eq(players.id, a.id));
    expect((await getPlayer(db, b.id))!.referredBy).toBeNull();
    expect(await rewards(a.id)).toHaveLength(0);
  });
});
