/**
 * The referrals list (/admin/referrals), for the owner: every referrer with a qualified friend,
 * most first, with the friends who count and what to look at before paying anyone by hand
 * (src/server/db/referrals.ts `adminReferrals`). Read only, drawn on the server; the CSV is the
 * same list from GET /api/admin/referrals?format=csv. Nothing here pays.
 */
import type { ReactNode } from "react";

import { StickerPanel, stickerButtonClass } from "@/components/game/kit";
import { CircleAlert, Clock, Download, ExternalLink, HandCoins, Lock, ShieldCheck, Timer, Users } from "@/components/icons";
import { EXPLORER_URL } from "@/lib/near/config";
import type { AdminReferrer, ReviewFlag, RewardState } from "@/server/db/referrals";

const utc = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} UTC`;

const REWARD: Record<RewardState, { label: string; className: string; icon: typeof Lock }> = {
  locked: { label: "Not earned yet", className: "bg-game-paper-2 text-game-ink", icon: Lock },
  granted: { label: "Earned", className: "bg-game-mint text-game-ink", icon: ShieldCheck },
  queued: { label: "Earned · badge queued", className: "bg-game-gold text-game-ink", icon: Timer },
  minted: { label: "Earned · badge minted", className: "bg-game-mint text-game-ink", icon: ShieldCheck },
};

const FLAG: Record<ReviewFlag, { label: string; detail: string; icon: typeof Lock }> = {
  close_signups: { label: "Close sign-ups", detail: "Signed up within 10 minutes of another friend who counts for the same referrer.", icon: Clock },
  shared_x: { label: "Shared X handle", detail: "Another player has this X handle too.", icon: Users },
  one_run: { label: "One run", detail: "Exactly one verified run.", icon: CircleAlert },
};

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[12px] font-bold leading-none ${className}`}>{children}</span>;
}

function FlagPill({ flag }: { flag: ReviewFlag }) {
  const { label, detail, icon: Icon } = FLAG[flag];
  return (
    <Pill className="bg-game-paper text-game-ink">
      <Icon aria-hidden className="size-3.5 shrink-0 text-game-hero" strokeWidth={2} />
      {label}
      <span className="sr-only">: {detail}</span>
    </Pill>
  );
}

function RewardPill({ state }: { state: RewardState }) {
  const { label, className, icon: Icon } = REWARD[state];
  return (
    <Pill className={className}>
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
      {label}
    </Pill>
  );
}

const x = (handle: string | null) => (handle ? `@${handle}` : "—");

function Referrer({ r }: { r: AdminReferrer }) {
  const id = `referrer-${r.playerId}`;
  return (
    <StickerPanel as="article" aria-labelledby={id} className="flex flex-col gap-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="mr-auto text-[17px] font-semibold leading-6 text-game-ink [overflow-wrap:anywhere]">
          {r.handle}
          {r.banned ? <span className="ml-2 text-[13px] font-semibold text-game-hero">Banned</span> : null}
        </h2>
        <span className="num text-[13px] font-semibold leading-5 text-game-ink">{r.qualified} qualified</span>
        <RewardPill state={r.reward.state} />
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] leading-5 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold text-game-muted">NEAR account</dt>
        <dd className="hash text-game-ink">{r.nearAccountId}</dd>
        <dt className="font-semibold text-game-muted">X handle</dt>
        <dd className="text-game-ink [overflow-wrap:anywhere]">{x(r.xHandle)}</dd>
        {r.reward.grantedAt ? (
          <>
            <dt className="font-semibold text-game-muted">Earned</dt>
            <dd className="num text-game-ink">
              {utc(r.reward.grantedAt)}
              {r.reward.tx ? (
                <>
                  {" · "}
                  <a
                    href={`${EXPLORER_URL}/txns/${encodeURIComponent(r.reward.tx)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline decoration-game-ink/40 underline-offset-4 pointer-fine:hover:decoration-game-ink"
                  >
                    Badge transaction
                    <ExternalLink aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
                    <span className="sr-only">(opens NearBlocks in a new tab)</span>
                  </a>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {r.flags.length > 0 ? (
          <>
            <dt className="font-semibold text-game-muted">To review</dt>
            <dd className="flex flex-wrap gap-1.5">
              {r.flags.map((f) => (
                <FlagPill key={f} flag={f} />
              ))}
            </dd>
          </>
        ) : null}
      </dl>

      {/* Scrolls sideways on a phone; focusable so the keyboard can scroll it too. `relative` keeps
          the screen-reader-only text inside it from widening the page. */}
      <div role="region" aria-label={`Friends of ${r.handle} who count`} tabIndex={0} className="relative -mx-4 overflow-x-auto px-4 focus-visible:outline-offset-2 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[680px] border-collapse text-left text-[13px] leading-5">
          <caption className="sr-only">Friends of {r.handle} who count</caption>
          <thead>
            <tr className="border-b-2 border-game-ink text-[12px] font-bold uppercase tracking-[0.08em] text-game-muted">
              <th scope="col" className="py-2 pr-3 font-bold">
                Game handle
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">
                X handle
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">
                NEAR account
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-bold">
                Verified runs
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">
                Joined
              </th>
              <th scope="col" className="py-2 font-bold">
                Flags
              </th>
            </tr>
          </thead>
          <tbody>
            {r.friends.map((f) => (
              <tr key={f.playerId} className="border-b border-dashed border-game-ink/20 align-top last:border-b-0">
                {/* Handles stay on one line (the table scrolls); a 64-character implicit account may break. */}
                <td className="whitespace-nowrap py-2 pr-3 font-semibold text-game-ink">{f.handle}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-game-ink">{x(f.xHandle)}</td>
                <td className="hash min-w-[200px] py-2 pr-3 text-game-ink">{f.nearAccountId}</td>
                <td className="num py-2 pr-3 text-right text-game-ink">{f.verifiedRuns}</td>
                <td className="num whitespace-nowrap py-2 pr-3 text-game-ink">{utc(f.joinedAt)}</td>
                <td className="py-2">
                  {f.flags.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {f.flags.map((flag) => (
                        <FlagPill key={flag} flag={flag} />
                      ))}
                    </span>
                  ) : (
                    <span className="text-game-muted">None</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StickerPanel>
  );
}

export function ReferralsAdmin({ admin, referrers, goal }: { admin: string; referrers: AdminReferrer[]; goal: number }) {
  const earned = referrers.filter((r) => r.reward.state !== "locked").length;
  const friends = referrers.reduce((n, r) => n + r.qualified, 0);
  return (
    <main id="main" data-wgp-night="" className="min-h-dvh bg-game-night px-4 pb-16 pt-8 text-game-paper [--vs-focus:var(--game-gold)] sm:px-6 sm:pt-12">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-paper/70">With Great Power · signed in as {admin}</p>
            <h1 className="font-display text-[30px] font-semibold leading-9 tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] sm:text-[36px] sm:leading-[40px]">Referrals</h1>
            <p className="max-w-[62ch] text-pretty text-[14px] leading-5 text-game-paper/80">
              Players with at least one friend who counts: a friend they invited who added an X handle and finished a verified run. {goal} friends earn the Recruiter badge and its XP in
              the game.
            </p>
          </div>
          <a href="/api/admin/referrals?format=csv" download className={stickerButtonClass("paper", "sm", "self-start sm:self-auto")}>
            <Download aria-hidden className="size-4" strokeWidth={2} />
            Download CSV
          </a>
        </header>

        <StickerPanel as="aside" className="flex items-start gap-3 p-4">
          <HandCoins aria-hidden className="mt-0.5 size-5 shrink-0 text-game-ink" strokeWidth={2} />
          <div className="flex flex-col gap-1 text-[14px] leading-5">
            <p className="font-semibold">USDC payouts are sent by the owner through Uprail; this page never pays.</p>
            <p className="text-game-muted">Check the flags before paying anyone: they point at accounts that may belong to one person.</p>
          </div>
        </StickerPanel>

        <dl className="flex flex-wrap gap-2">
          {[
            { label: "Referrers listed", value: referrers.length },
            { label: `Reached ${goal}`, value: earned },
            { label: "Friends who count", value: friends },
          ].map((s) => (
            <div key={s.label} className="flex h-9 items-center gap-2 rounded-full border-2 border-game-ink bg-game-paper px-3.5 text-[13px] leading-none text-game-ink">
              <dt className="font-semibold text-game-muted">{s.label}</dt>
              <dd className="num font-bold">{s.value}</dd>
            </div>
          ))}
        </dl>

        <section aria-label="Referrers" className="flex flex-col gap-4">
          {referrers.length === 0 ? (
            <StickerPanel className="p-4">
              <p className="max-w-[60ch] text-[15px] leading-6 text-game-ink">
                No referrer has a friend who counts yet. A friend counts once they add their X handle and finish a verified run; referrers show up here from their first one.
              </p>
            </StickerPanel>
          ) : (
            referrers.map((r) => <Referrer key={r.playerId} r={r} />)
          )}
        </section>
      </div>
    </main>
  );
}
