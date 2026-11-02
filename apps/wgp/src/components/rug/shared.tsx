import type { ReactNode } from "react";

import { CalendarClock, Check, Target, X } from "@/components/icons";
import { activeQuest } from "@wgp/game-core/engine";
import type { Quest, Save } from "@wgp/game-core/types";

/** Deks are stored without a closing stop; errand lines already have one. */
export function sentence(text: string) {
  return /[.!?…”"’)]$/.test(text.trim()) ? text : `${text}.`;
}

export type QuestStatus = "tonight" | "done" | "tomorrow" | "missed";

/** Where a quest stands for this save: on tonight, done, not yet, or let go. */
export function questStatus(save: Save, quest: Quest): QuestStatus {
  if (quest.done) return "done";
  if (activeQuest(save) === quest) return "tonight";
  if (quest.night > save.night || (quest.night === save.night && !save.nightDone)) return "tomorrow";
  return "missed";
}

const STATUS: Record<QuestStatus, { label: string; icon: ReactNode; className: string }> = {
  tonight: {
    label: "Tonight",
    icon: <Target aria-hidden className="size-3.5" strokeWidth={2.5} />,
    className: "bg-game-gold text-game-ink",
  },
  done: {
    label: "Done",
    icon: <Check aria-hidden className="size-3.5" strokeWidth={3} />,
    className: "bg-game-mint text-game-paper",
  },
  tomorrow: {
    label: "Tomorrow night",
    icon: <CalendarClock aria-hidden className="size-3.5" strokeWidth={2.25} />,
    className: "bg-game-paper text-game-ink",
  },
  missed: {
    label: "Got away",
    icon: <X aria-hidden className="size-3.5" strokeWidth={2.5} />,
    className: "bg-game-paper-2 text-game-muted border-dashed",
  },
};

/** Quest status as a pill: an icon and words, never color alone. */
export function QuestPill({ status }: { status: QuestStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-2 text-[11px] font-bold uppercase leading-4 tracking-[0.04em] ${s.className}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

/** A newspaper section head: a heavy ink rule, then a small caps label. */
export function SectionHead({ id, children, aside }: { id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 border-t-[3px] border-game-ink pt-2">
      <h2 id={id} className="text-[12px] font-bold uppercase leading-4 tracking-[0.12em] text-game-ink">
        {children}
      </h2>
      {aside}
    </div>
  );
}
