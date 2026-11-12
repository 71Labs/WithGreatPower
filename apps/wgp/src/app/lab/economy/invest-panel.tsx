"use client";

/**
 * The investors in the economy fast-forward: "Gwei goes broke, an investor reopens her".
 * Shown only in a run that has investor bots (src/lib/market/bots.ts `LAB_INVESTORS`; the
 * lab's "Drain Gwei, then invest in her" button). It counts the days a shop ended closed,
 * the times an investor reopened one, what went in, what came back and what the fees paid,
 * and lists what the investors did on the day the charts are reading. The numbers are the
 * run's own (balance.ts `investStory` reads the same history), and it says the risk the
 * market's invest sheet says: what they put in is mostly still in her tills.
 */
import { StickerPanel } from "@/components/game/kit";
import { HandCoins } from "@/components/icons";
import { formatBits } from "@/components/market/sparkline";
import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { LAB_INVESTORS, type DaySnapshot, type InvestEvent } from "@/lib/market/bots";
import { bitsText } from "@/lib/market/format";

const nameOf = (item: string) => (item in ITEMS ? ITEMS[item as ItemId].name : item);
const who = (account: string) => `Investor ${Number(account.split("-")[1] ?? 0) + 1}`;

function line(e: InvestEvent): string {
  if (e.kind === "invest") return `${who(e.account)} put ${bitsText(e.bits)} into her ${nameOf(e.item)} till`;
  if (e.kind === "withdraw") return `${who(e.account)} took ${bitsText(e.bits)} back out of her ${nameOf(e.item)} till${e.earned ? `, with ${bitsText(e.earned)} earned` : ""}`;
  return `${who(e.account)} claimed ${bitsText(e.earned)} of fees from her ${nameOf(e.item)} till`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 py-2">
      <dt className="text-[12px] font-semibold leading-4 text-game-muted">{label}</dt>
      <dd className="num text-[20px] font-bold leading-6 tracking-[-0.02em]">{value}</dd>
      {hint ? <dd className="text-[11px] leading-4 text-game-muted [text-wrap:pretty]">{hint}</dd> : null}
    </div>
  );
}

export function InvestPanel({ history, hover, headingId }: { history: DaySnapshot[]; hover: number | null; headingId: string }) {
  if (!history.some((d) => d.investors !== null)) return null;
  const n = history.length;
  const at = hover !== null && hover < n ? hover : n - 1;
  const day = history[at]!;
  const upTo = history.slice(0, at + 1);
  const events = upTo.flatMap((d) => d.investors?.events ?? []);
  const closedDays = upTo.slice(1).reduce((sum, d) => sum + Object.values(d.broke).filter(Boolean).length, 0);
  const reopenings = upTo.reduce((sum, d, i) => sum + (d.investors?.events ?? []).filter((e) => e.kind === "invest" && i > 0 && history[i - 1]!.broke[e.item]).length, 0);
  const invested = events.filter((e) => e.kind === "invest").reduce((s, e) => s + e.bits, 0);
  const withdrawn = events.filter((e) => e.kind === "withdraw").reduce((s, e) => s + e.bits, 0);
  const today = day.investors?.events ?? [];
  const closedToday = Object.keys(day.broke).filter((i) => day.broke[i]);

  return (
    <StickerPanel as="section" aria-labelledby={headingId} className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <h2 id={headingId} className="flex items-center gap-2 text-[16px] font-semibold leading-5 text-game-ink">
          <HandCoins aria-hidden className="size-5 shrink-0" strokeWidth={2} />
          Gwei goes broke, an investor reopens her
        </h2>
        <p className="num max-w-[76ch] text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">
          {LAB_INVESTORS.count} investor bots start with {bitsText(LAB_INVESTORS.bits)} each. The morning after one of her tills can’t pay for an item, one of them puts up to {bitsText(LAB_INVESTORS.lot)} into it, on the investing rules of
          contract v3 (built and reviewed, not live on mainnet). Her price doesn’t move; she just buys again. They earn half the gas fee on those items’ trades.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Day" value={`${day.day}`} />
        <Stat label="Shop-days closed" value={formatBits(closedDays)} hint="An item’s shop ending a day unable to buy" />
        <Stat label="Reopened by investors" value={formatBits(reopenings)} hint="Investments into a till that ended the day before broke" />
        <Stat label="Invested" value={formatBits(invested)} hint={`${formatBits(withdrawn)} withdrawn since`} />
        <Stat label="Earned from fees" value={formatBits(day.investors?.earned ?? 0)} hint="Fees that would otherwise have burned" />
        <Stat label="Still in her tills" value={formatBits(day.investors?.staked ?? 0)} hint="Stakes waiting; they also hold these wallets’ Bits" />
      </dl>
      <div className="flex flex-col gap-2 border-t-2 border-dashed border-game-ink/20 pt-3">
        <h3 className="num text-[12px] font-semibold leading-4 text-game-muted">Day {day.day}</h3>
        <p role="status" className="num text-[14px] leading-5 [text-wrap:pretty]">
          {closedToday.length > 0 ? `Ended the day closed for buying: ${closedToday.map(nameOf).join(", ")}.` : "Every shop ended the day open."}
        </p>
        {today.length > 0 ? (
          <ol aria-label={`What the investors did on day ${day.day}`} className="num flex list-disc flex-col gap-1 ps-5 text-[14px] leading-5 marker:text-game-muted [text-wrap:pretty]">
            {today.map((e, i) => (
              <li key={i}>{line(e)}</li>
            ))}
          </ol>
        ) : (
          <p className="text-[14px] leading-5 text-game-muted">The investors did nothing that morning.</p>
        )}
      </div>
      <p className="max-w-[76ch] text-[13px] leading-[18px] [text-wrap:pretty]">
        What they risk is on the chart too: the heroes who sell loot into a funded till take its Bits, and a stake comes back only as other heroes buy that stock. In this run most of what was invested is still waiting in her tills at the end.
      </p>
    </StickerPanel>
  );
}
