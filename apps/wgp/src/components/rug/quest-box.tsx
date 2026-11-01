import { StickerLink } from "@/components/game/kit";
import { MiniAvatar } from "@/components/landing/mini-avatar";
import { MapPin } from "@/components/icons";
import { DISTRICTS, ITEMS, RARITY_LABEL, VILLAINS } from "@/game/data";
import type { Quest, Save } from "@/game/types";

import { QuestPill, SectionHead, questStatus, sentence } from "./shared";

/** The quest the edition set: who, what, the reward, and whether it's on tonight. */
export function QuestBox({ save, quest }: { save: Save; quest: Quest }) {
  const status = questStatus(save, quest);
  const villain = VILLAINS[quest.villain];
  const item = ITEMS[quest.rewardItem];

  return (
    <section id="quest" aria-labelledby="quest-title" className="flex flex-col gap-3">
      <SectionHead id="quest-title" aside={<QuestPill status={status} />}>
        The quest
      </SectionHead>

      <div className="flex items-center gap-3">
        <MiniAvatar id={quest.villain} className="size-14 rounded-[16px]" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[16px] font-semibold leading-5 text-game-ink">{sentence(quest.text)}</p>
          <p className="flex items-center gap-1.5 text-[13px] leading-4 text-game-muted">
            <MapPin aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
            Last seen in {DISTRICTS[villain.district].name}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[14px] bg-game-paper-2 px-3 py-2.5 text-[13px] leading-5">
        <dt className="text-game-muted">Reward</dt>
        <dd className="num text-right font-semibold">+{quest.rewardXp} XP</dd>
        <dt className="text-game-muted">Loot</dt>
        <dd className="text-right">
          <span className="font-semibold">{item.name}</span> <span className="text-game-muted">· {RARITY_LABEL[item.rarity]}</span>
        </dd>
      </dl>

      {status === "tonight" ? (
        <StickerLink href="/play" size="sm" className="self-start">
          Plan tonight’s patrol
        </StickerLink>
      ) : null}
    </section>
  );
}
