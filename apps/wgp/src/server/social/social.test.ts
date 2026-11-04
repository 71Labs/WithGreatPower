import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Edition } from "@wgp/game-core/types";

import { formatPrice } from "@/components/market/sparkline";
import { issueSession } from "@/server/auth/session";
import { setDb, type Db } from "@/server/db/client";
import { recordScore } from "@/server/db/leaderboard";
import { ensureSave, writeSave } from "@/server/db/players";
import { CLOSE_GRACE_MS, closeSeason } from "@/server/db/season-close";
import { marketPrices, runs, seasons, socialDrafts } from "@/server/db/schema";
import { freshDb, givePlayerHero, heroSave, makePlayer } from "@/server/db/test-helpers";
import { HttpError } from "@/server/http";

import { adminAccountIds, requireAdmin } from "./admin";
import { devLog, txUrl } from "./generators";
import { setXProfile } from "./players";
import { decideDraft, listDrafts, nearMentionFree, syncDrafts } from "./queue";

const NOV3_NIGHT = new Date("2026-11-03T20:00:00Z");
/** 01:30 UTC, 02:30 in Lagos: the Nov 3 board has closed. */
const NOV4_EARLY = new Date("2026-11-04T01:30:00Z");
const S1_END = new Date("2026-11-15T00:00:00Z");

let db: Db;
const ids: Record<string, string> = {};
let tick = 0;

/** A verified ranked night for `who`, on the boards, as the accept transaction records it. */
async function night(who: string, score: number, issuedAt = NOV3_NIGHT, ticks = 9000): Promise<string> {
  const at = new Date(issuedAt.getTime() + ++tick * 1000);
  const [run] = await db
    .insert(runs)
    .values({ playerId: ids[who]!, night: 1, seed: 1, ruleset: "test-1", saveRevAtStart: 1, startSave: heroSave(who.toUpperCase()), status: "verified", issuedAt, expiresAt: at, submittedAt: at, verifiedScore: score, ticks })
    .returning({ id: runs.id });
  await db.transaction((tx) => recordScore(tx, { playerId: ids[who]!, runId: run!.id, score, ticks, issuedAt, now: at }));
  return run!.id;
}

const drafts = () => db.select().from(socialDrafts);
const draftFor = async (event: string) => (await db.select().from(socialDrafts).where(eq(socialDrafts.sourceEvent, event)))[0];

beforeEach(async () => {
  db = await freshDb();
  tick = 0;
  for (const who of ["ana", "ben", "cy", "dee"]) {
    ids[who] = (await makePlayer(db, who)).id;
    await givePlayerHero(db, ids[who]!, who.toUpperCase());
  }
});
afterEach(() => {
  setDb(undefined);
  vi.unstubAllGlobals();
});

describe("draft generators", () => {
  it("draft nothing when there's nothing real to say", async () => {
    const report = await syncDrafts(db, { now: new Date("2026-11-03T10:00:00Z") });
    expect(report).toEqual({ created: [], errors: [] });
    expect(await drafts()).toHaveLength(0);
  });

  it("post tonight's top 3 for the board that closed, from the rows, once", async () => {
    const r1 = await night("ana", 9000);
    await night("ben", 7500);
    await night("cy", 6000);
    await night("dee", 1200);

    const first = await syncDrafts(db, { now: NOV4_EARLY });
    expect(first.created).toContain("tonight_top3:2026-11-03");
    const d = (await draftFor("tonight_top3:2026-11-03"))!;
    expect(d.text).toBe(
      `Tonight’s top 3 in the city 🕸️\n1. ana: 9,000\n2. ben: 7,500\n3. cy: 6,000\nEvery run is replay-verified: wgponnear.fun/r/${r1}\nBeat them tonight → wgponnear.fun\n\n#NEARHackathon`,
    );
    expect(d.tags).toEqual(["#NEARHackathon"]);
    expect(d.mediaUrl).toBe("/api/social/card/leaderboard?board=tonight&period=2026-11-03");
    expect(d.sources).toContainEqual({ label: "#1", value: "9,000 (ana, ana.wgp.testnet)", href: `/r/${r1}` });

    const count = (await drafts()).length;
    const again = await syncDrafts(db, { now: new Date(NOV4_EARLY.getTime() + 3_600_000) });
    expect(again.created).toEqual([]);
    expect(await drafts()).toHaveLength(count);
  });

  it("tag only players who opted in, and at most three tags", async () => {
    await night("ana", 9000);
    await night("ben", 7500);
    await night("cy", 6000);
    await setXProfile(db, ids.ben!, { xHandle: "@BenOnX", xTagOk: true });
    // A handle without the opt-in is never used.
    await setXProfile(db, ids.cy!, { xHandle: "cy_x", xTagOk: false });

    await syncDrafts(db, { now: NOV4_EARLY });
    const d = (await draftFor("tonight_top3:2026-11-03"))!;
    expect(d.text).toContain("1. ana: 9,000\n2. @BenOnX: 7,500\n3. cy: 6,000");
    expect(d.text).not.toContain("cy_x");
    expect(d.tags).toEqual(["@BenOnX", "#NEARHackathon"]);
    expect(d.sources).toContainEqual(expect.objectContaining({ label: "@BenOnX", unverified: true }));

    // Everyone opted in: the hashtag and two handles; the third is named plainly.
    await db.delete(socialDrafts);
    for (const who of ["ana", "cy"]) await setXProfile(db, ids[who]!, { xHandle: `${who}_x`, xTagOk: true });
    await syncDrafts(db, { now: NOV4_EARLY });
    const capped = (await draftFor("tonight_top3:2026-11-03"))!;
    expect(capped.text).toContain("1. @ana_x: 9,000\n2. @BenOnX: 7,500\n3. cy: 6,000");
    expect(capped.tags).toEqual(["@ana_x", "@BenOnX", "#NEARHackathon"]);
  });

  it("shout out a new #1 with the run's own score, once per player and board", async () => {
    await night("ben", 4000, NOV3_NIGHT);
    const run = await night("ana", 8800, NOV3_NIGHT);
    await setXProfile(db, ids.ana!, { xHandle: "ana_x", xTagOk: true });
    await syncDrafts(db, { now: NOV4_EARLY });
    const d = (await draftFor(`new_leader:alltime:all:${ids.ana}`))!;
    expect(d.text).toBe(`Hey @ana_x, you just banked a 8,800 night and took #1 on the All-time board. Nothing for you to sign. wgponnear.fun/r/${run}\n\n#NEARHackathon`);
    expect(d.mediaUrl).toBe(`/api/social/card/run/${run}`);
    // Tonight's board for Nov 4 is empty: no shout-out there.
    expect((await drafts()).some((x) => x.sourceEvent.startsWith("new_leader:tonight"))).toBe(false);
  });

  it("shout out once for a run that tops several boards, and never again for those boards", async () => {
    const tonight = new Date("2026-11-04T00:30:00Z");
    await night("ben", 5000, tonight);
    const run = await night("ana", 9000, tonight);
    await syncDrafts(db, { now: NOV4_EARLY });
    const leaders = (await drafts()).filter((d) => d.kind === "new_leader");
    expect(leaders.map((d) => d.sourceEvent)).toEqual([`new_leader:tonight:2026-11-04:${ids.ana}+new_leader:alltime:all:${ids.ana}`]);
    expect(leaders[0]!.text).toContain(`you just banked a 9,000 night and took #1 on the Tonight and All-time boards. Nothing for you to sign. wgponnear.fun/r/${run}`);

    // A better night by the same leader is no news on those boards.
    await night("ana", 9900, new Date("2026-11-04T01:00:00Z"));
    await syncDrafts(db, { now: new Date("2026-11-04T01:40:00Z") });
    expect((await drafts()).filter((d) => d.kind === "new_leader")).toHaveLength(1);
  });

  it("count Season 1 down at 48 and 24 hours, with the standings at the halfway mark", async () => {
    await night("ana", 5000, new Date("2026-11-10T20:00:00Z"));
    await night("ben", 4000, new Date("2026-11-10T21:00:00Z"));
    const at48 = new Date("2026-11-13T01:00:00Z");
    await syncDrafts(db, { now: at48 });
    const c48 = (await draftFor("season_countdown:s1:48h"))!;
    expect(c48.text).toBe("Season 1 closes in 47h. The top 10 get on-chain trophies.\nwgponnear.fun\n\n#NEARHackathon");
    expect(c48.expiresAt.toISOString()).toBe("2026-11-14T01:00:00.000Z");
    const mid = (await draftFor("season_standings:s1:mid"))!;
    expect(mid.text).toContain("1. ana: 5,000\n2. ben: 4,000\n2 heroes on the board, 2 nights left.");

    await syncDrafts(db, { now: new Date("2026-11-14T06:00:00Z") });
    expect((await draftFor("season_countdown:s1:24h"))!.text).toMatch(/^Season 1 closes in 18h\./);
    expect(await draftFor("season_countdown:s1:starts")).toBeUndefined();
  });

  it("announce the season the day before, tagging @NEARProtocol once that day", async () => {
    await syncDrafts(db, { now: new Date("2026-11-04T09:00:00Z") });
    const d = (await draftFor("season_countdown:s1:starts"))!;
    expect(d.text).toBe(
      "Season 1 starts tomorrow, Nov 5 at 00:00 UTC. 10 nights; every night you finish adds to your total. The top 10 get on-chain trophies.\nwgponnear.fun\n\n#NEARHackathon @NEARProtocol",
    );
    expect(d.tags).toEqual(["#NEARHackathon", "@NEARProtocol"]);
    expect(d.expiresAt.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(await nearMentionFree(db, new Date("2026-11-04T18:00:00Z"))).toBe(false);
    expect(await nearMentionFree(db, new Date("2026-11-05T01:00:00Z"))).toBe(true);
    // A rejected draft never went out, so the tag is free again.
    await decideDraft(db, { id: d.id, actor: "sele71.near", action: "reject", now: new Date("2026-11-04T10:00:00Z") });
    expect(await nearMentionFree(db, new Date("2026-11-04T18:00:00Z"))).toBe(true);
  });

  it("recap the season with its trophy transaction, only once it's recorded", async () => {
    await night("ana", 7000, new Date("2026-11-06T20:00:00Z"));
    await night("ben", 6000, new Date("2026-11-06T20:00:00Z"));
    const after = new Date(S1_END.getTime() + CLOSE_GRACE_MS + 60_000);
    await closeSeason(db, "s1", after);
    await syncDrafts(db, { now: after });
    expect(await draftFor("season_recap:s1")).toBeUndefined();

    await db.update(seasons).set({ status: "recorded", recordTx: "9xRecordTx", recordedAt: after }).where(eq(seasons.id, "s1"));
    await syncDrafts(db, { now: new Date(after.getTime() + 60_000) });
    const d = (await draftFor("season_recap:s1"))!;
    expect(d.text).toBe(`Season 1 is final 🏆 The top 2 got their trophies on NEAR:\n1. ana · 2. ben\n${txUrl("9xRecordTx")}\n\n#NEARHackathon @NEARProtocol`);
    expect(d.sources).toContainEqual({ label: "trophy:s1:1", value: "ana.wgp.testnet (7,000)", href: txUrl("9xRecordTx") });
  });

  it("post a market move over 15% in 24 hours, and not a smaller one", async () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const row = (item: string, hoursAgo: number, priceMilli: number) => ({ item, at: new Date(now.getTime() - hoursAgo * 3_600_000), kind: "snapshot", onChain: true, priceMilli, stock: 50, till: 1000 });
    await db.insert(marketPrices).values([row("fee-bomb", 30, 1000), row("fee-bomb", 6, 1150), row("fee-bomb", 1, 1300), row("crumbs", 30, 1000), row("crumbs", 1, 1100)]);
    await syncDrafts(db, { now });
    const d = (await draftFor("market_move:fee-bomb:2026-11-08"))!;
    expect(d.text).toBe(`Fee bomb at Gwei’s stall: ${formatPrice(1000)} → ${formatPrice(1300)} Bits today. Players move the prices; 2% of every trade burns.\n\n#NEARHackathon`);
    expect(await draftFor("market_move:crumbs:2026-11-08")).toBeUndefined();
  });

  it("quote The Daily Rug's headline for last night's #1", async () => {
    const run = await night("ana", 9000);
    const { save, rev } = await ensureSave(db, ids.ana!);
    const edition: Edition = { night: 1, headline: "Web-head grounds Gas Goblin", dek: "Fees fall back to normal", who: "gas-goblin", stories: [], heroPoll: 60, vote: null, quest: null };
    await writeSave(db, ids.ana!, { ...save, editions: [edition] }, rev);
    await syncDrafts(db, { now: NOV4_EARLY });
    expect((await draftFor("daily_rug:2026-11-03"))!.text).toBe(`THE DAILY RUG: “Web-head grounds Gas Goblin” by J. Jonah Bearson.\nwgponnear.fun/r/${run}\n\n#NEARHackathon`);
  });

  it("read the dev log from public GitHub, and skip it when GitHub won't answer", async () => {
    const commits = [
      { sha: "aaa", commit: { message: "Merge pull request #41 from 71Labs/feat/social\n\nfeat(social): share buttons and run pages" } },
      { sha: "bbb", commit: { message: "fix: something small" } },
      { sha: "ccc", commit: { message: "Merge pull request #40 from 71Labs/feat/hq-render\n\nfeat(render): sharper city at night" } },
    ];
    const ok = vi.fn(async () => Response.json(commits));
    const [plan] = await devLog({ db, now: NOV4_EARLY, devLog: true, fetch: ok as unknown as typeof fetch, repo: "71Labs/WithGreatPower" });
    expect(plan!.sourceEvent).toBe("dev_log:aaa");
    expect(plan!.compose(new (await import("./compose")).Tagger())).toBe("Dev log 🛠️ just shipped:\n- share buttons and run pages\n- sharper city at night\nPlay it → wgponnear.fun");
    const missing = vi.fn(async () => new Response("Not Found", { status: 404 }));
    expect(await devLog({ db, now: NOV4_EARLY, devLog: true, fetch: missing as unknown as typeof fetch, repo: "71Labs/WithGreatPower" })).toEqual([]);
    // Players' requests never reach GitHub.
    expect(await devLog({ db, now: NOV4_EARLY, fetch: ok as unknown as typeof fetch, repo: "71Labs/WithGreatPower" })).toEqual([]);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe("the approval queue", () => {
  async function oneDraft() {
    await night("ana", 9000);
    await night("ben", 7000);
    await syncDrafts(db, { now: NOV4_EARLY });
    return (await draftFor("tonight_top3:2026-11-03"))!;
  }

  it("expires drafts after a day, and won't approve an expired one", async () => {
    const d = await oneDraft();
    expect(d.expiresAt.getTime() - d.createdAt.getTime()).toBe(24 * 3_600_000);
    const later = new Date(NOV4_EARLY.getTime() + 25 * 3_600_000);
    const listed = await listDrafts(db, later);
    expect(listed.find((x) => x.id === d.id)!.status).toBe("expired");
    await expect(decideDraft(db, { id: d.id, actor: "sele71.near", action: "approve", now: later })).rejects.toMatchObject({ status: 409 });
  });

  it("edits, approves, posts and logs who did each, and blocks posts X would refuse", async () => {
    const d = await oneDraft();
    const at = (min: number) => new Date(NOV4_EARLY.getTime() + min * 60_000);

    await expect(decideDraft(db, { id: d.id, actor: "sele71.near", action: "approve", text: `${"x".repeat(300)} #NEARHackathon`, now: at(1) })).rejects.toMatchObject({ status: 422, code: "not_postable" });
    await expect(decideDraft(db, { id: d.id, actor: "sele71.near", action: "posted", now: at(1) })).rejects.toMatchObject({ status: 409, code: "bad_status" });

    const edited = `${d.text.replace("Beat them tonight", "Your move")}`;
    const approved = await decideDraft(db, { id: d.id, actor: "sele71.near", action: "approve", text: edited, now: at(2) });
    expect(approved).toMatchObject({ status: "approved", decidedBy: "sele71.near", editedText: edited, finalText: edited, problems: [] });

    // Editing an approved draft sends it back for review.
    const again = await decideDraft(db, { id: d.id, actor: "sele.wgpnear.near", action: "edit", text: d.text, now: at(3) });
    expect(again).toMatchObject({ status: "pending", editedText: null });
    await decideDraft(db, { id: d.id, actor: "sele.wgpnear.near", action: "approve", now: at(4) });
    const posted = await decideDraft(db, { id: d.id, actor: "sele.wgpnear.near", action: "posted", now: at(5) });
    expect(posted.status).toBe("posted");
    expect(posted.postedAt).toBe(at(5).toISOString());
    expect(posted.log.map((l) => [l.action, l.actor])).toEqual([
      ["approve", "sele71.near"],
      ["edit", "sele.wgpnear.near"],
      ["approve", "sele.wgpnear.near"],
      ["posted", "sele.wgpnear.near"],
    ]);
    await expect(decideDraft(db, { id: d.id, actor: "sele71.near", action: "reject", now: at(6) })).rejects.toMatchObject({ status: 409 });
  });
});

describe("X handles on players", () => {
  it("store the handle without the @, need one before tags, and come off on removal", async () => {
    expect(await setXProfile(db, ids.ana!, { xHandle: "@Sele_71", xTagOk: true })).toEqual({ xHandle: "Sele_71", xTagOk: true, verified: false });
    await expect(setXProfile(db, ids.ben!, { xHandle: null, xTagOk: true })).rejects.toBeInstanceOf(HttpError);
    await expect(setXProfile(db, ids.ben!, { xHandle: "way_too_long_handle", xTagOk: false })).rejects.toMatchObject({ status: 400 });
    await expect(setXProfile(db, ids.ben!, { xHandle: "bad-handle", xTagOk: false })).rejects.toMatchObject({ status: 400 });
    expect(await setXProfile(db, ids.ana!, { xHandle: null, xTagOk: false })).toEqual({ xHandle: null, xTagOk: false, verified: false });
  });
});

describe("the admin gate", () => {
  const ENV = { ADMIN_ACCOUNT_IDS: " ana.wgp.testnet , Sele71.near,," };
  const request = (token?: string) => new Request("http://localhost/api/admin/social", { headers: token ? { cookie: `wgp_session=${token}` } : {} });

  it("reads the allowlist", () => {
    expect([...adminAccountIds(ENV)]).toEqual(["ana.wgp.testnet", "sele71.near"]);
    expect(adminAccountIds({}).size).toBe(0);
  });

  it("answers 404 to guests and non-admins, and lets admins in", async () => {
    await expect(requireAdmin(request(), ENV)).rejects.toMatchObject({ status: 404 });
    const ben = await issueSession(db, ids.ben!);
    await expect(requireAdmin(request(ben.token), ENV)).rejects.toMatchObject({ status: 404 });
    const ana = await issueSession(db, ids.ana!);
    expect((await requireAdmin(request(ana.token), ENV)).player.nearAccountId).toBe("ana.wgp.testnet");
    // Nobody is an admin when the list is unset.
    await expect(requireAdmin(request(ana.token), {})).rejects.toMatchObject({ status: 404 });
  });

  it("guards the queue's API and its cards", async () => {
    vi.stubEnv("ADMIN_ACCOUNT_IDS", "ana.wgp.testnet");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", { status: 404 })));
    const { GET } = await import("@/app/api/admin/social/route");
    const { PATCH } = await import("@/app/api/admin/social/drafts/[id]/route");
    const { GET: card } = await import("@/app/api/social/card/[kind]/route");
    const ben = await issueSession(db, ids.ben!);
    const ana = await issueSession(db, ids.ana!);
    const as = (token: string, init: RequestInit = {}) => new Request("http://localhost/api/admin/social", { ...init, headers: { cookie: `wgp_session=${token}`, "content-type": "application/json" } });

    expect((await GET(new Request("http://localhost/api/admin/social"))).status).toBe(404);
    expect((await GET(as(ben.token))).status).toBe(404);
    const res = await GET(as(ana.token));
    expect(res.status).toBe(200);
    // Drafts depend on today's date (the season countdown), so only the shape is checked.
    expect(await res.json()).toMatchObject({ admin: "ana.wgp.testnet", drafts: expect.any(Array), sync: { errors: [] } });

    const params = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) };
    expect((await PATCH(as(ben.token, { method: "PATCH", body: JSON.stringify({ action: "approve" }) }), params)).status).toBe(404);
    const cardReq = new Request("http://localhost/api/social/card/leaderboard?board=tonight&period=2026-11-03", { headers: { cookie: `wgp_session=${ben.token}` } });
    expect((await card(cardReq as never, { params: Promise.resolve({ kind: "leaderboard" }) })).status).toBe(404);
    vi.unstubAllEnvs();
  });
});
