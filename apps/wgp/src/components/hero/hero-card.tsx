import { HeroArt } from "@/components/cast";
import { StickerChip, StickerFrame, StickerMeter } from "@/components/game/kit";
import { HERO_BASE_HP, MAX_FLUID, POWERS, SUITS, XP_TO_NEXT } from "@wgp/game-core/data";
import type { PowerId, SuitId } from "@wgp/game-core/types";

/**
 * The player's hero card as a sticker-kit panel: the sticker, the name, four stats and
 * the powers. Shown at the end of onboarding with the numbers a new hero starts with.
 */
export function HeroCardPreview({
  name,
  suit,
  powers,
  titleId,
}: {
  name: string;
  suit: SuitId;
  powers: PowerId[];
  titleId: string;
}) {
  // A new hero's numbers, from the same constants create-hero uses.
  const stats = [
    { label: "Health", value: HERO_BASE_HP, max: HERO_BASE_HP, fill: "bg-game-hero" },
    { label: "Web fluid", value: MAX_FLUID, max: MAX_FLUID, fill: "bg-game-ink" },
    { label: "Responsibility", value: 20, max: 100, fill: "bg-game-ink" },
    { label: "XP", value: 0, max: XP_TO_NEXT(1), fill: "bg-game-gold" },
  ];
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-5 rounded-[20px] border-2 border-game-ink bg-game-paper-2 p-4 text-game-ink sm:flex-row sm:items-center sm:gap-6 sm:p-5">
      <StickerFrame className="self-center [--s:132px] sm:[--s:160px]">
        <HeroArt {...SUITS[suit].colors} />
      </StickerFrame>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Hero card · Level 1</p>
          <h2 id={titleId} className="font-display text-[30px] font-semibold leading-8 tracking-[-0.03em] text-game-ink [overflow-wrap:anywhere]">
            {name}
          </h2>
          <p className="text-[14px] leading-5 text-game-muted">Your friendly neighborhood validator, in the {SUITS[suit].name.toLowerCase()} suit</p>
        </div>
        <div className="grid gap-x-4 gap-y-2 min-[440px]:grid-cols-2">
          {stats.map((s) => (
            <StickerMeter key={s.label} label={s.label} value={s.value} max={s.max} fill={s.fill} />
          ))}
        </div>
        <ul aria-label="Powers" className="flex flex-wrap gap-1.5">
          {powers.map((p) => (
            <li key={p}>
              <StickerChip className="h-7 text-[12px]">{POWERS[p].name}</StickerChip>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
