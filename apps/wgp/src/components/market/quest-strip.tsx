/**
 * Today's market quest, as a strip on the market and a chip on Tonight's market tile: what
 * to do, what it's worth (XP only) and whether it's done. Done is a tick and the word, not
 * a colour alone. Server-safe: no hooks.
 */
import { Check, Target } from "@/components/icons";
import { MARKET_QUEST_TEXT, MARKET_QUEST_XP, type MarketQuestView } from "@/lib/market/quest";

/** "Resets at midnight UTC", with the hours left when they're known. Pure. */
export function resetsIn(quest: Pick<MarketQuestView, "resetsAt">, now: number): string {
  const hours = Math.ceil((Date.parse(quest.resetsAt) - now) / 3_600_000);
  if (!Number.isFinite(hours) || hours <= 0) return "A new one starts at midnight UTC.";
  return `A new one starts at midnight UTC, in ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}

export function QuestStrip({ quest, signedIn, now, className = "" }: { quest: MarketQuestView | null; signedIn: boolean; now: number; className?: string }) {
  const done = !!quest?.done;
  const xp = quest?.xp ?? MARKET_QUEST_XP;
  return (
    <section
      aria-label="Today’s market quest"
      className={`flex items-center gap-3 rounded-[16px] border-2 border-game-ink px-3 py-2.5 text-game-ink shadow-[var(--game-shadow-sm)] ${done ? "bg-game-paper" : "bg-game-gold"} ${className}`}
    >
      <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full border-2 border-game-ink ${done ? "bg-game-mint text-game-paper" : "bg-game-paper"}`}>
        {done ? <Check className="size-5" strokeWidth={3} /> : <Target className="size-5" strokeWidth={2.25} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em]">Today’s market quest{done ? " · done" : ""}</p>
        <p className="text-[14px] font-semibold leading-5 [text-wrap:pretty]">{MARKET_QUEST_TEXT}</p>
        <p role="status" className="num text-[12px] font-medium leading-4 [text-wrap:pretty]">
          {done ? `You got +${xp} XP. ${resetsIn(quest!, now)}` : signedIn ? "One trade today does it. Once a day." : "Sign in to take it. One trade a day does it."}
        </p>
      </div>
      <span className={`num inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[13px] font-bold ${done ? "bg-game-paper-2" : "bg-game-paper"}`}>
        +{xp} XP
        {done ? <span className="sr-only">, earned</span> : null}
      </span>
    </section>
  );
}
