/**
 * Bearson's "Also found" note under case 003's front page: the receipt in the Goblin's
 * saddlebag, the thread to the next case (game-core FEE_STRIKE_LINES.thread). Server-safe.
 */
import { ReceiptText } from "@/components/icons";
import { CASE_003 } from "@/lib/cases/content-003";

export function AlsoFound({ className = "" }: { className?: string }) {
  return (
    <aside aria-label="Also found" className={`flex items-start gap-2.5 rounded-[12px] border-2 border-dashed border-game-ink/50 bg-game-paper-2 px-3 py-2.5 text-game-ink ${className}`}>
      <ReceiptText aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.25} />
      <p className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-[18px]">
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Also found</span>
        <span className="max-w-[60ch] text-pretty">{CASE_003.found.thread}</span>
      </p>
    </aside>
  );
}
