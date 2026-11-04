"use client";

/**
 * The social queue (/admin/social): drafted X posts from real game data, waiting for the
 * owner. Nothing here posts. For each draft: edit the text (X's own count, links 23 and
 * emoji 2, blocks approval over 280), check the facts behind every number, approve or
 * reject; then "Open in X" opens the composer with the approved text, the card is
 * downloaded and attached by hand, and "Mark as posted" records that it went out.
 * Opening the page is what drafts anything new (GET /api/admin/social).
 */
import { useEffect, useState, type ReactNode } from "react";

import { StickerButton, StickerPanel, stickerButtonClass } from "@/components/game/kit";
import { StickerTabs, tabPanelProps, type StickerTab } from "@/components/game/ui";
import { CircleAlert, Download, ExternalLink, RotateCcw, ShieldCheck, XLogo } from "@/components/icons";
import { X_MAX, postProblems, xIntentUrl, xLength } from "@/lib/social/x";
import type { SocialDraftStatus } from "@/server/db/schema";
import type { DraftKind } from "@/server/social/generators";
import type { DraftAction, DraftView, SyncReport } from "@/server/social/queue";

type Filter = "review" | "approved" | "done" | "expired";
type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; drafts: DraftView[]; sync: SyncReport };

const KIND: Record<DraftKind, string> = {
  tonight_top3: "Tonight’s top 3",
  new_leader: "New #1",
  season_standings: "Season standings",
  season_countdown: "Season countdown",
  season_recap: "Season recap",
  market_move: "Market move",
  daily_rug: "The Daily Rug",
  dev_log: "Dev log",
};

const STATUS: Record<SocialDraftStatus, { label: string; className: string }> = {
  pending: { label: "To review", className: "bg-game-gold text-game-ink" },
  approved: { label: "Approved", className: "bg-game-mint text-white" },
  posted: { label: "Posted", className: "bg-game-ink text-game-paper" },
  rejected: { label: "Rejected", className: "bg-game-paper-2 text-game-ink" },
  expired: { label: "Expired", className: "bg-game-paper-2 text-game-muted" },
};

const FILTERS: Record<Filter, SocialDraftStatus[]> = { review: ["pending"], approved: ["approved"], done: ["posted", "rejected"], expired: ["expired"] };
const ID = "social-queue";

const utc = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} UTC`;

function timeLeft(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `expires in ${h}h` : `expires in ${Math.max(1, Math.round(ms / 60_000))} min`;
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[12px] font-bold leading-none ${className}`}>{children}</span>;
}

function Sources({ draft }: { draft: DraftView }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Where the numbers come from</h4>
      <dl className="flex flex-col gap-1.5">
        {draft.sources.map((s, i) => (
          <div key={i} className="flex flex-col gap-0.5 rounded-[10px] bg-game-paper-2 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold leading-5 sm:w-44">
              <span className="[overflow-wrap:anywhere]">{s.label}</span>
              {s.unverified ? <Pill className="h-6 bg-game-paper text-game-ink">Unverified</Pill> : null}
            </dt>
            <dd className="num min-w-0 text-[13px] leading-5 text-game-ink [overflow-wrap:anywhere]">
              {s.href ? (
                <a
                  href={s.href}
                  target={s.href.startsWith("http") ? "_blank" : undefined}
                  rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="inline-flex items-center gap-1 underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
                >
                  {s.value}
                  {s.href.startsWith("http") ? <ExternalLink aria-hidden className="size-3.5 shrink-0" strokeWidth={2} /> : null}
                </a>
              ) : (
                s.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DraftCard({ draft, now, onChange }: { draft: DraftView; now: number; onChange: (d: DraftView) => void }) {
  const [text, setText] = useState(draft.finalText);
  const [busy, setBusy] = useState<DraftAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = draft.status === "pending" || draft.status === "approved";
  const length = xLength(text);
  const problems = postProblems(text);
  const dirty = text !== draft.finalText;
  const over = length > X_MAX;
  const textId = `draft-${draft.id}-text`;

  async function act(action: DraftAction) {
    if (busy) return;
    if (action === "approve" && problems.length > 0) {
      setError(problems.join(" "));
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/social/drafts/${draft.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(action === "edit" || action === "approve" ? { text } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as { draft?: DraftView; message?: string } | null;
      if (!res.ok || !body?.draft) {
        setError(body?.message ?? "That didn’t go through. Try again.");
        return;
      }
      onChange(body.draft);
    } catch {
      setError("Couldn’t reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const who = draft.status === "posted" ? `Posted ${draft.postedAt ? utc(draft.postedAt) : ""}` : draft.decidedBy ? `${STATUS[draft.status].label} by ${draft.decidedBy}, ${draft.decidedAt ? utc(draft.decidedAt) : ""}` : null;

  return (
    <StickerPanel as="article" aria-labelledby={`draft-${draft.id}-title`} className={`flex flex-col gap-4 p-4 sm:p-5 ${draft.status === "expired" ? "opacity-60" : ""}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={`draft-${draft.id}-title`} className="mr-auto text-[17px] font-semibold leading-6 text-game-ink">
          {KIND[draft.kind] ?? draft.kind}
        </h3>
        <Pill className={STATUS[draft.status].className}>{STATUS[draft.status].label}</Pill>
        <span className="num text-[12px] leading-4 text-game-muted">
          {utc(draft.createdAt)}
          {open ? ` · ${timeLeft(draft.expiresAt, now)}` : ""}
        </span>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor={textId} className="text-[13px] font-semibold leading-5">
            Post text
          </label>
          <textarea
            id={textId}
            value={text}
            readOnly={!open}
            rows={Math.min(10, Math.max(4, text.split("\n").length + 1))}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            aria-describedby={`${textId}-count`}
            aria-invalid={over || undefined}
            className="w-full resize-y rounded-[12px] border-2 border-game-ink bg-game-paper px-3 py-2.5 text-[15px] leading-[22px] text-game-ink read-only:bg-game-paper-2"
          />
          <div id={`${textId}-count`} className="flex flex-wrap items-center justify-between gap-2 text-[13px] leading-5">
            <span className={`num font-semibold ${over ? "text-game-hero" : "text-game-muted"}`}>
              {over ? <CircleAlert aria-hidden className="-mt-0.5 mr-1 inline size-4" strokeWidth={2} /> : null}
              {length} / {X_MAX}
              <span className="sr-only"> characters as X counts them</span>
            </span>
            <span className="text-game-muted">Links count 23, emoji 2</span>
          </div>
          {open && problems.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[13px] leading-5 text-game-ink">
              {problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-game-hero" strokeWidth={2} />
                  {p}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {draft.mediaUrl ? (
          <figure className="flex w-full shrink-0 flex-col gap-2 lg:w-[340px]">
            {/* An API-drawn PNG, shown as is: the image optimizer would only re-encode it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draft.mediaUrl}
              alt={`The card to attach for this ${KIND[draft.kind] ?? "post"}`}
              width={1200}
              height={630}
              loading="lazy"
              className={`aspect-[1200/630] w-full rounded-[12px] border-2 border-game-ink bg-game-paper-2 object-cover ${draft.status === "expired" ? "grayscale" : ""}`}
            />
            <figcaption className="flex items-center justify-between gap-2">
              <span className="text-[12px] leading-4 text-game-muted">Attach it yourself on X</span>
              <a href={draft.mediaUrl} download={`wgp-${draft.kind}-${draft.id.slice(0, 8)}.png`} className={stickerButtonClass("paper", "sm")}>
                <Download aria-hidden className="size-4" strokeWidth={2} />
                Download card
              </a>
            </figcaption>
          </figure>
        ) : null}
      </div>

      <Sources draft={draft} />

      {open ? (
        <div className="flex flex-col gap-2 border-t-2 border-dashed border-game-ink/20 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          {draft.status === "pending" ? (
            <StickerButton variant="hero" size="sm" onClick={() => void act("approve")} aria-disabled={problems.length > 0 || busy !== null || undefined} aria-busy={busy === "approve" || undefined}>
              <ShieldCheck aria-hidden className="size-4" strokeWidth={2} />
              {busy === "approve" ? "Approving…" : dirty ? "Approve with edits" : "Approve"}
            </StickerButton>
          ) : dirty ? null : (
            <>
              <a href={xIntentUrl(draft.finalText)} target="_blank" rel="noopener noreferrer" className={stickerButtonClass("ink", "sm")}>
                <XLogo aria-hidden className="size-4" strokeWidth={2} />
                Open in X
                <span className="sr-only">(opens X in a new tab)</span>
              </a>
              <StickerButton size="sm" onClick={() => void act("posted")} aria-disabled={busy !== null || undefined} aria-busy={busy === "posted" || undefined}>
                {busy === "posted" ? "Saving…" : "Mark as posted"}
              </StickerButton>
            </>
          )}
          {dirty ? (
            <StickerButton size="sm" onClick={() => void act("edit")} aria-disabled={busy !== null || undefined} aria-busy={busy === "edit" || undefined}>
              {busy === "edit" ? "Saving…" : draft.status === "approved" ? "Save edit and re-review" : "Save edit"}
            </StickerButton>
          ) : null}
          <StickerButton size="sm" onClick={() => void act("reject")} aria-disabled={busy !== null || undefined} aria-busy={busy === "reject" || undefined} className="sm:ml-auto">
            {busy === "reject" ? "Rejecting…" : "Reject draft"}
          </StickerButton>
        </div>
      ) : who ? (
        <p className="text-[13px] leading-5 text-game-muted">{who}</p>
      ) : null}

      <div role="status" aria-live="polite" className="empty:hidden">
        {error ? (
          <p className="flex items-start gap-2 rounded-[12px] border-2 border-game-ink bg-game-paper-2 px-3 py-2 text-[13px] leading-5 text-game-ink">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-game-hero" strokeWidth={2} />
            {error}
          </p>
        ) : null}
      </div>

      {draft.log.length > 0 ? (
        <details className="text-[13px] leading-5">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-game-ink">History ({draft.log.length})</summary>
          <ol className="flex flex-col gap-1 pl-1 text-game-muted">
            {draft.log.map((l, i) => (
              <li key={i} className="num">
                {l.action} by <span className="text-game-ink">{l.actor}</span>, {utc(l.at)}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </StickerPanel>
  );
}

export function SocialQueue({ admin }: { admin: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [filter, setFilter] = useState<Filter>("review");
  const [attempt, setAttempt] = useState(0);
  /** The clock when the queue last loaded, for "expires in". Set with the data, never during render. */
  const [now, setNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/social", { signal: controller.signal, cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { drafts?: DraftView[]; sync?: SyncReport; message?: string } | null;
        if (!res.ok || !body?.drafts) throw new Error(body?.message ?? `The queue didn’t load (${res.status}).`);
        setNow(Date.now());
        setLoad({ state: "ready", drafts: body.drafts, sync: body.sync ?? { created: [], errors: [] } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "error", message: error instanceof Error ? error.message : "The queue didn’t load." });
      });
    return () => controller.abort();
  }, [attempt]);

  const drafts = load.state === "ready" ? load.drafts : [];
  const count = (f: Filter) => drafts.filter((d) => FILTERS[f].includes(d.status)).length;
  const tabs: StickerTab<Filter>[] = [
    { id: "review", label: "To review", badge: count("review") ? { value: count("review"), label: "drafts to review" } : undefined },
    { id: "approved", label: "Approved", badge: count("approved") ? { value: count("approved"), label: "approved, not posted" } : undefined },
    { id: "done", label: "Done" },
    { id: "expired", label: "Expired" },
  ];
  const shown = drafts.filter((d) => FILTERS[filter].includes(d.status));
  const replace = (next: DraftView) => setLoad((prev) => (prev.state === "ready" ? { ...prev, drafts: prev.drafts.map((d) => (d.id === next.id ? next : d)) } : prev));

  return (
    <main id="main" data-wgp-night="" className="min-h-dvh bg-game-night px-4 pb-16 pt-8 text-game-paper [--vs-focus:var(--game-gold)] sm:px-6 sm:pt-12">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-paper/70">With Great Power · signed in as {admin}</p>
            <h1 className="font-display text-[30px] font-semibold leading-9 tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] sm:text-[36px] sm:leading-[40px]">
              Social queue
            </h1>
            <p className="max-w-[62ch] text-[14px] leading-5 text-game-paper/80">
              Drafts written from the boards, seasons, market and The Daily Rug. Nothing posts on its own: approve a draft, open it in X, attach its card and post it yourself, then mark it posted.
            </p>
          </div>
          <StickerButton size="sm" onClick={() => setAttempt((n) => n + 1)} aria-busy={load.state === "loading" || undefined} className="self-start sm:self-auto">
            <RotateCcw aria-hidden className="size-4" strokeWidth={2} />
            {load.state === "loading" ? "Drafting…" : "Draft from latest data"}
          </StickerButton>
        </header>

        <div role="status" aria-live="polite" className="empty:hidden">
          {load.state === "ready" && (load.sync.created.length > 0 || load.sync.errors.length > 0) ? (
            <p className="rounded-[14px] border-2 border-game-ink bg-game-paper px-3.5 py-2.5 text-[14px] leading-5 text-game-ink">
              {load.sync.created.length > 0 ? `${load.sync.created.length} new ${load.sync.created.length === 1 ? "draft" : "drafts"} from the latest data.` : "No new drafts."}
              {load.sync.errors.length > 0 ? ` Some drafts couldn’t be made: ${load.sync.errors.join("; ")}` : ""}
            </p>
          ) : null}
        </div>

        <StickerTabs tabs={tabs} value={filter} onChange={setFilter} label="Drafts" idPrefix={ID} className="self-stretch sm:self-start sm:min-w-[480px]" />

        <section {...tabPanelProps(ID, filter)} className="flex flex-col gap-4 focus-visible:outline-offset-4">
          {load.state === "loading" ? (
            <p className="text-[15px] leading-6 text-game-paper/80">Drafting from the latest data…</p>
          ) : load.state === "error" ? (
            <StickerPanel className="flex flex-col items-start gap-3 p-4">
              <p className="flex items-center gap-2 text-[15px] leading-6">
                <CircleAlert aria-hidden className="size-5 shrink-0 text-game-hero" strokeWidth={2} />
                {load.message}
              </p>
              <StickerButton size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </StickerButton>
            </StickerPanel>
          ) : shown.length === 0 ? (
            <StickerPanel className="p-4">
              <p className="max-w-[60ch] text-[15px] leading-6 text-game-ink">
                {filter === "review"
                  ? "Nothing to review. Drafts appear when a board closes, someone takes #1, a price moves, or a season milestone comes up."
                  : filter === "approved"
                    ? "No approved drafts waiting to go out."
                    : filter === "done"
                      ? "Nothing posted or rejected yet."
                      : "No expired drafts. A draft expires a day after it’s made, or sooner when it stops being true."}
              </p>
            </StickerPanel>
          ) : (
            shown.map((d) => <DraftCard key={`${d.id}:${d.status}:${d.finalText}`} draft={d} now={now} onChange={replace} />)
          )}
        </section>
      </div>
    </main>
  );
}
