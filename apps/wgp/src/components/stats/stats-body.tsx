/**
 * What the /stats page says, on paper: the counts GET /api/stats answers as tiles, and one
 * bar chart of verified matches by mode. One series, so one colour and no legend; every bar
 * has its value written beside it, and the rows are a list, so the chart reads the same
 * without the bars. A database with no matches gets an empty state and one action.
 * Server-safe and pure: it draws the `PublicStats` it is given.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { CHAPTERS, isChapterId } from "@wgp/game-core/chapters";

import { StickerEyebrow, stickerButtonClass } from "@/components/game/kit";
import { ArrowRight } from "@/components/icons";
import { STAT_MODES, type PublicStats } from "@/server/db/stats";

/** The mainnet contract, for the NearBlocks link when this server isn't set up for a chain. */
const MAINNET_CONTRACT = "game.wgpnear.near";

const whole = new Intl.NumberFormat("en-US");
const tenths = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

const MODE_NAMES: Record<string, string> = { patrol: "Patrol nights", daily: "Daily Run", trial: "Time trials", duel: "Duels" };

/** A mode's name as players know it; an id nobody named yet is shown as it is. */
export function modeName(mode: string): string {
  if (isChapterId(mode)) return `Case ${CHAPTERS[mode].number}: ${CHAPTERS[mode].title}`;
  return MODE_NAMES[mode] ?? mode;
}

/** Verified matches by mode, most first; equal counts keep the game's own order. */
export function modeRows(byMode: PublicStats["runs"]["byMode"]): { mode: string; name: string; verified: number }[] {
  const order = (mode: string) => {
    const at = (STAT_MODES as readonly string[]).indexOf(mode);
    return at < 0 ? STAT_MODES.length : at;
  };
  return Object.entries(byMode)
    .map(([mode, counts]) => ({ mode, name: modeName(mode), verified: counts.verified }))
    .sort((a, b) => b.verified - a.verified || order(a.mode) - order(b.mode) || a.mode.localeCompare(b.mode));
}

export function nearblocksUrl(chain: PublicStats["chain"]): string {
  const host = chain.network === "testnet" ? "testnet.nearblocks.io" : "nearblocks.io";
  return `https://${host}/address/${chain.contractId ?? MAINNET_CONTRACT}`;
}

const textLink =
  "inline-block rounded-[4px] py-0.5 font-semibold text-game-ink underline decoration-game-ink/40 underline-offset-4 [text-decoration-skip-ink:auto] [text-underline-position:from-font] pointer-fine:hover:decoration-game-ink";

function Group({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <StickerEyebrow as="h2" id={id}>
          {title}
        </StickerEyebrow>
        {note ? <p className="max-w-[65ch] text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Tiles({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</dl>;
}

function Tile({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3.5 py-3 ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-[13px] font-medium leading-[18px] text-game-muted">{label}</dt>
      <dd className="num font-display text-[26px] font-semibold leading-8 tracking-[-0.02em] text-game-ink [overflow-wrap:anywhere] sm:text-[30px] sm:leading-9">{value}</dd>
    </div>
  );
}

/** Horizontal bars from one baseline, a 4px rounded data end, the value in ink beside each. */
function ModeChart({ byMode }: { byMode: PublicStats["runs"]["byMode"] }) {
  const rows = modeRows(byMode);
  const max = Math.max(1, ...rows.map((r) => r.verified));
  return (
    <ul className="flex flex-col gap-2 border-l-2 border-game-ink/25 py-1">
      {rows.map((row) => (
        <li key={row.mode} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3.5rem]">
          <span className="pl-3 text-[13px] font-medium leading-[18px] text-game-ink [overflow-wrap:anywhere] sm:order-none">{row.name}</span>
          <span className="num text-right text-[14px] font-semibold leading-[18px] text-game-ink sm:order-last">{whole.format(row.verified)}</span>
          {/* On a phone the bar sits under its label; a mode with nothing verified keeps no empty row there. */}
          <span aria-hidden className={`col-span-2 h-3.5 sm:col-span-1 sm:block ${row.verified > 0 ? "block" : "hidden"}`}>
            {row.verified > 0 ? <span className="block h-full min-w-[3px] rounded-r-[4px] bg-game-data" style={{ width: `${(row.verified / max) * 100}%` }} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Sources({ chain }: { chain: PublicStats["chain"] }) {
  return (
    <p className="max-w-[65ch] border-t-2 border-dashed border-game-ink/25 pt-4 text-[13px] leading-5 text-game-muted [text-wrap:pretty]">
      Every number here comes from{" "}
      <a href="/api/stats" className={`${textLink} whitespace-nowrap font-mono text-[12px]`}>
        GET /api/stats
      </a>
      ; on-chain numbers can be checked on{" "}
      <a href={nearblocksUrl(chain)} className={textLink}>
        NearBlocks
      </a>
      .
    </p>
  );
}

export function StatsBody({ stats }: { stats: PublicStats }) {
  const { runs, players, city, referrals, chain } = stats;
  const empty = runs.started === 0;
  return (
    <>
      <header className="flex flex-col gap-2">
        <StickerEyebrow>With Great Power</StickerEyebrow>
        <h1 id="stats-title" className="font-display text-[30px] font-semibold leading-[34px] tracking-[-0.03em] text-game-ink [text-wrap:balance] sm:text-[38px] sm:leading-[42px]">
          By the numbers
        </h1>
        <p className="max-w-[65ch] text-[15px] leading-[22px] text-game-ink [text-wrap:pretty]">
          Counted from the game’s own records, as of{" "}
          <time dateTime={stats.at} className="num whitespace-nowrap font-semibold">
            {when.format(new Date(stats.at))} UTC
          </time>
          {stats.since ? (
            <>
              . The first match started on{" "}
              <time dateTime={stats.since} className="num whitespace-nowrap">
                {day.format(new Date(stats.since))}
              </time>
            </>
          ) : null}
          .
        </p>
      </header>

      {empty ? (
        <div className="flex flex-col items-start gap-4 rounded-[14px] border-2 border-dashed border-game-ink/40 bg-game-paper-2 px-4 py-5">
          <p className="text-[16px] font-semibold leading-6 text-game-ink">No matches yet. Play a night and come back.</p>
          <Link href="/play" className={stickerButtonClass("hero", "md", "w-full sm:w-auto")}>
            Play a night
            <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
          </Link>
        </div>
      ) : (
        <>
          <Group id="stats-matches" title="Matches" note="A match counts as verified once the server has replayed it and reached the same result.">
            <Tiles>
              <Tile label="Verified" value={whole.format(runs.verified)} />
              <Tile label="Started" value={whole.format(runs.started)} />
              <Tile label="Hours of verified play" value={tenths.format(runs.hoursVerified)} wide />
              <Tile label="Refused by the replay" value={whole.format(runs.rejected)} />
              <Tile label="Never handed in" value={whole.format(runs.unfinished)} />
              <Tile label="Verified today (UTC)" value={whole.format(runs.today.verified)} wide />
              {runs.season ? <Tile label={`Verified in season ${runs.season.id.toUpperCase()}`} value={whole.format(runs.season.verified)} /> : null}
              {runs.season ? <Tile label={`Started in season ${runs.season.id.toUpperCase()}`} value={whole.format(runs.season.started)} /> : null}
              <Tile label="Started today (UTC)" value={whole.format(runs.today.started)} wide />
            </Tiles>
          </Group>

          <Group id="stats-modes" title="Verified matches by mode">
            <ModeChart byMode={runs.byMode} />
          </Group>

          <Group id="stats-players" title="Players" note="Signed-in players. Guests play in their browser and aren’t counted.">
            <Tiles>
              <Tile label="Signed up" value={whole.format(players.total)} />
              <Tile label="Started a match" value={whole.format(players.played)} />
              <Tile label="Have a verified match" value={whole.format(players.withVerifiedRun)} wide />
            </Tiles>
          </Group>

          <Group id="stats-city" title="The City" note="Free roam: run, climb and swing between errands.">
            <Tiles>
              <Tile label="Outings" value={whole.format(city.outings)} />
              <Tile label="Players who went out" value={whole.format(city.players)} />
              <Tile label="Tasks finished" value={whole.format(city.tasksDone)} wide />
            </Tiles>
          </Group>

          <Group id="stats-crew" title="Invites" note="A friend counts once they add their X handle and bank a verified match.">
            <Tiles>
              <Tile label="Friends invited" value={whole.format(referrals.invited)} />
              <Tile label="Friends who count" value={whole.format(referrals.qualified)} />
              <Tile label="Recruiter badges earned" value={whole.format(referrals.rewards)} wide />
            </Tiles>
          </Group>

          <Group
            id="stats-chain"
            title="On NEAR"
            note={
              chain.contractId ? (
                <>
                  Loot and badges from verified matches are minted by{" "}
                  <span className="font-mono text-[12px] font-semibold text-game-ink [overflow-wrap:anywhere]">{chain.contractId}</span> on {chain.network}. One call can
                  carry up to 20 mints.
                </>
              ) : (
                "This server isn’t connected to NEAR, so mints wait in the queue."
              )
            }
          >
            <Tiles>
              <Tile label="Reward mints queued" value={whole.format(chain.rewardMints.queued)} />
              <Tile label="Reward mints sent" value={whole.format(chain.rewardMints.sent)} />
            </Tiles>
          </Group>
        </>
      )}

      <Sources chain={chain} />
    </>
  );
}
