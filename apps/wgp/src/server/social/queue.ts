/**
 * The approval queue. Drafts are generated on demand, never on a schedule:
 *
 * - when an admin opens the queue (GET /api/admin/social), with the dev log;
 * - after a verified run, in the background of that request (src/server/background.ts,
 *   `draftSocialSoon`, at most once every two minutes), without the dev log.
 *
 * Generating is idempotent: a draft's `source_event` is unique, so a fact is drafted
 * once however often the generators run. Expiry is lazy too: a pending or approved draft
 * past its `expires_at` (24 hours, or sooner when its claim stops being true) is marked
 * expired the next time the queue is read or acted on.
 *
 * Nothing here posts. An admin approves (or edits, or rejects) a draft, opens it on X as
 * an intent link from their own browser, and marks it posted; every step is logged with
 * who and when.
 */
import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";

import { NEAR_MENTION, postProblems, tagsIn, xLength } from "@/lib/social/x";
import { HttpError, conflict, notFound } from "@/server/http";

import type { Db } from "../db/client";
import { socialDraftLog, socialDrafts, type SocialDraft, type SocialDraftStatus } from "../db/schema";
import { Tagger } from "./compose";
import { DAY_MS, GENERATORS, type DraftKind, type DraftPlan, type DraftSource, type GenContext } from "./generators";

export const DRAFT_TTL_MS = DAY_MS;

/** A source naming a player's self-reported X handle is flagged, so the queue shows it as unverified. */
export type QueueSource = DraftSource & { unverified?: boolean };

export interface DraftLogEntry {
  at: string;
  actor: string;
  action: string;
  detail: unknown;
}

export interface DraftView {
  id: string;
  kind: DraftKind;
  /** As generated. */
  text: string;
  editedText: string | null;
  /** What gets posted: the edit if there is one. */
  finalText: string;
  /** X's weighted length of `finalText`. */
  length: number;
  /** Why `finalText` can't be approved; empty when it can. */
  problems: string[];
  mediaUrl: string | null;
  replyTo: string | null;
  tags: string[];
  sourceEvent: string;
  sources: QueueSource[];
  status: SocialDraftStatus;
  createdAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  postedAt: string | null;
  log: DraftLogEntry[];
}

const finalText = (d: Pick<SocialDraft, "text" | "editedText">) => d.editedText ?? d.text;

function view(d: SocialDraft, log: DraftLogEntry[]): DraftView {
  const text = finalText(d);
  return {
    id: d.id,
    kind: d.kind as DraftKind,
    text: d.text,
    editedText: d.editedText,
    finalText: text,
    length: xLength(text),
    problems: postProblems(text),
    mediaUrl: d.mediaUrl,
    replyTo: d.replyTo,
    tags: d.tags,
    sourceEvent: d.sourceEvent,
    sources: d.sources as QueueSource[],
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    expiresAt: d.expiresAt.toISOString(),
    decidedBy: d.decidedBy,
    decidedAt: d.decidedAt?.toISOString() ?? null,
    postedAt: d.postedAt?.toISOString() ?? null,
    log,
  };
}

/** Marks pending and approved drafts past their time as expired. Returns how many. */
export async function expireDrafts(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .update(socialDrafts)
    .set({ status: "expired" })
    .where(and(inArray(socialDrafts.status, ["pending", "approved"]), lte(socialDrafts.expiresAt, now)))
    .returning({ id: socialDrafts.id });
  return rows.length;
}

/** Whether no draft made today (UTC) tags @NEARProtocol yet; a rejected one doesn't count. */
export async function nearMentionFree(db: Db, now = new Date()): Promise<boolean> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [hit] = await db
    .select({ id: socialDrafts.id })
    .from(socialDrafts)
    .where(
      and(
        gte(socialDrafts.createdAt, start),
        lt(socialDrafts.createdAt, new Date(start.getTime() + DAY_MS)),
        ne(socialDrafts.status, "rejected"),
        sql`${socialDrafts.tags} @> ARRAY[${NEAR_MENTION}]::text[]`,
      ),
    )
    .limit(1);
  return !hit;
}

export interface SyncReport {
  /** Source events drafted by this pass. */
  created: string[];
  /** Generators that failed, with why; the others still ran. */
  errors: string[];
}

/** Runs every generator and stores the drafts that don't exist yet. Safe to run any number of times. */
export async function syncDrafts(db: Db, opts: Omit<GenContext, "db" | "now"> & { now?: Date } = {}): Promise<SyncReport> {
  const now = opts.now ?? new Date();
  await expireDrafts(db, now);
  const ctx: GenContext = { ...opts, db, now };
  const report: SyncReport = { created: [], errors: [] };
  const plans: DraftPlan[] = [];
  for (const [name, generate] of Object.entries(GENERATORS)) {
    try {
      plans.push(...(await generate(ctx)));
    } catch (error) {
      report.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (plans.length === 0) return report;

  const events = plans.map((p) => p.sourceEvent);
  const known = new Set((await db.select({ e: socialDrafts.sourceEvent }).from(socialDrafts).where(inArray(socialDrafts.sourceEvent, events))).map((r) => r.e));
  for (const plan of plans) {
    if (known.has(plan.sourceEvent)) continue;
    known.add(plan.sourceEvent);
    const expiresAt = new Date(Math.min(now.getTime() + DRAFT_TTL_MS, plan.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY));
    if (expiresAt <= now) continue;
    const tagger = new Tagger({ near: !!plan.near && (await nearMentionFree(db, now)) });
    const { text, tags } = tagger.finish(plan.compose(tagger));
    const sources: QueueSource[] = [
      ...plan.sources,
      ...tagger.tagged.map((p) => ({ label: `@${p.xHandle}`, value: `X handle given by ${p.handle}, opted in to tags`, unverified: true })),
    ];
    const inserted = await db
      .insert(socialDrafts)
      .values({ kind: plan.kind, text, tags, sourceEvent: plan.sourceEvent, mediaUrl: plan.mediaUrl, sources, createdAt: now, expiresAt })
      .onConflictDoNothing({ target: socialDrafts.sourceEvent })
      .returning({ id: socialDrafts.id });
    if (inserted.length > 0) report.created.push(plan.sourceEvent);
  }
  return report;
}

async function logsFor(db: Db, ids: string[]): Promise<Map<string, DraftLogEntry[]>> {
  const out = new Map<string, DraftLogEntry[]>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(socialDraftLog).where(inArray(socialDraftLog.draftId, ids)).orderBy(socialDraftLog.at);
  for (const r of rows) {
    const list = out.get(r.draftId) ?? [];
    list.push({ at: r.at.toISOString(), actor: r.actor, action: r.action, detail: r.detail });
    out.set(r.draftId, list);
  }
  return out;
}

/** The newest drafts first, with their logs, after expiring what's due. */
export async function listDrafts(db: Db, now = new Date(), limit = 100): Promise<DraftView[]> {
  await expireDrafts(db, now);
  const rows = await db.select().from(socialDrafts).orderBy(desc(socialDrafts.createdAt), desc(socialDrafts.id)).limit(limit);
  const logs = await logsFor(db, rows.map((r) => r.id));
  return rows.map((r) => view(r, logs.get(r.id) ?? []));
}

export const DRAFT_ACTIONS = ["edit", "approve", "reject", "posted"] as const;
export type DraftAction = (typeof DRAFT_ACTIONS)[number];

/** The statuses each action may start from. */
const FROM: Record<DraftAction, SocialDraftStatus[]> = {
  edit: ["pending", "approved"],
  approve: ["pending", "approved"],
  reject: ["pending", "approved"],
  posted: ["approved"],
};

const VERB: Record<DraftAction, string> = { edit: "edited", approve: "approved", reject: "rejected", posted: "marked posted" };

/**
 * Applies an admin's action to a draft and logs it with who and when:
 * - edit: saves new text; an approved draft goes back to pending, to be approved as edited;
 * - approve (optionally with an edit): only if the text passes `postProblems` (X's length,
 *   at most three tags, #NEARHackathon);
 * - reject; posted (the admin sent it from their own X account).
 */
export async function decideDraft(db: Db, input: { id: string; actor: string; action: DraftAction; text?: string | null; now?: Date }): Promise<DraftView> {
  const now = input.now ?? new Date();
  const expired = await db.transaction(async (tx) => {
    const [draft] = await tx.select().from(socialDrafts).where(eq(socialDrafts.id, input.id)).for("update").limit(1);
    if (!draft) throw notFound("No such draft");
    if ((draft.status === "pending" || draft.status === "approved") && draft.expiresAt <= now) {
      await tx.update(socialDrafts).set({ status: "expired" }).where(eq(socialDrafts.id, draft.id));
      return true;
    }
    if (!FROM[input.action].includes(draft.status)) throw conflict("bad_status", `This draft is ${draft.status}, so it can’t be ${VERB[input.action]}.`);

    const next: Partial<SocialDraft> = {};
    let edited = draft.editedText;
    if (input.text != null && (input.action === "edit" || input.action === "approve")) {
      const text = input.text.replace(/\r\n/g, "\n");
      edited = text === draft.text ? null : text;
      next.editedText = edited;
      // The tags follow the text that will be posted.
      next.tags = tagsIn(text);
    }
    if (input.action === "edit") {
      if (input.text == null) throw new HttpError(400, "bad_request", "Send the edited text");
      next.status = "pending";
    } else if (input.action === "approve") {
      const problems = postProblems(edited ?? draft.text);
      if (problems.length > 0) throw new HttpError(422, "not_postable", problems.join(" "), { problems });
      Object.assign(next, { status: "approved", decidedBy: input.actor, decidedAt: now });
    } else if (input.action === "reject") {
      Object.assign(next, { status: "rejected", decidedBy: input.actor, decidedAt: now });
    } else {
      Object.assign(next, { status: "posted", postedAt: now });
    }

    const [row] = await tx.update(socialDrafts).set(next).where(eq(socialDrafts.id, draft.id)).returning();
    await tx.insert(socialDraftLog).values({
      draftId: draft.id,
      at: now,
      actor: input.actor,
      action: input.action,
      detail: { from: draft.status, to: row!.status, ...(next.editedText !== undefined ? { text: finalText(row!) } : {}) },
    });
    return false;
  });
  if (expired) throw conflict("expired", "This draft expired: it was a day old, or no longer true. The next pass drafts anything still worth saying.");
  const [row] = await db.select().from(socialDrafts).where(eq(socialDrafts.id, input.id)).limit(1);
  return view(row!, (await logsFor(db, [input.id])).get(input.id) ?? []);
}
