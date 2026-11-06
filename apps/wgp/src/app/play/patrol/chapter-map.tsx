/**
 * A case night on the full city map: the clues and the bridge pinned over the map (the
 * minimap's marks as stickers: a gold magnifier, a mint tick once found, the red cursor sign
 * on the bridge), and the case file beside it in words, each clue Found or To find.
 */
import { Check, Cursor, Search } from "@/components/icons";
import { chapterNext, chapterSite } from "@/game3d/nav/chapter-pins";
import { compass, metres, toMap, type MapView } from "@/game3d/nav/map";
import { Chip } from "@/sim/ui/bits";
import { CASE_001, RIGHT_CLICKER, clueCopy } from "@/lib/cases/content";
import { CASE_002, SYBIL, voteClueCopy } from "@/lib/cases/content-002";
import type { ChapterFrame } from "@/lib/cases/types";
import type { City, Vec3 } from "@wgp/game-core/sim3d/contract";

function ClueSticker({ found, className = "" }: { found: boolean; className?: string }) {
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-game-ink shadow-[0_2px_0_var(--game-ink)] ${found ? "bg-game-mint" : "bg-game-gold"} ${className}`}>
      {found ? <Check aria-hidden className="size-4" strokeWidth={3} /> : <Search aria-hidden className="size-4" strokeWidth={2.5} />}
    </span>
  );
}

function BridgeSticker({ className = "" }: { className?: string }) {
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-[10px] border-2 border-game-ink bg-game-hero text-game-on-hero shadow-[0_2px_0_var(--game-ink)] ${className}`}>
      <Cursor aria-hidden className="size-4" strokeWidth={2.5} />
    </span>
  );
}

/** The pins, over the map's canvas (`unit` is the map view at a side of 1). */
export function ChapterPinsLayer({ chapter, city, unit, still }: { chapter: ChapterFrame; city: City; unit: MapView; still: boolean }) {
  const bridge = chapterSite(chapter, city);
  const at = (p: Vec3) => {
    const m = toMap(unit, p.x, p.z);
    return { left: `${m.x * 100}%`, top: `${m.y * 100}%` };
  };
  const heading = chapter.phase === "standoff" || chapter.phase === "rescue" || chapter.phase === "lineup";
  return (
    <ol aria-hidden className="contents">
      {chapter.clues.map((c) => (
        <li key={c.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={at(c.pos)}>
          <ClueSticker found={c.found} className={c.found ? "opacity-85" : ""} />
        </li>
      ))}
      {bridge ? (
        <li className="absolute -translate-x-1/2 -translate-y-1/2" style={at(bridge)}>
          <span className="relative block">
            {heading ? <span className={`absolute -inset-1.5 rounded-[14px] border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} /> : null}
            <BridgeSticker />
          </span>
        </li>
      ) : null}
    </ol>
  );
}

/** Where the case sends you next, in words, for the map's subtitle. */
export function chapterWhere(chapter: ChapterFrame, city: City, hero: Vec3): string | null {
  const next = chapterNext(chapter, city, hero);
  if (!next) return null;
  const m = metres(Math.hypot(next.x - hero.x, next.z - hero.z));
  const dir = compass(next.x - hero.x, next.z - hero.z);
  if (chapter.id === "case-002") {
    if (chapter.phase === "investigate") return `The nearest drop box is ${m} m ${dir} of you.`;
    if (chapter.phase === "rescue") return `Uncle Gen’s ballot is ${m} m ${dir} of you.`;
    return `The polling station is ${m} m ${dir} of you.`;
  }
  if (chapter.phase === "investigate") return `The nearest clue is ${m} m ${dir} of you.`;
  if (chapter.phase === "standoff") return `${RIGHT_CLICKER.name} is on the bridge deck, ${m} m ${dir} of you.`;
  return `Mary is ${m} m ${dir} of you.`;
}

const BRIDGE_WORD = { investigate: "Later", lineup: "Next", standoff: "Next", rescue: "Now", done: "Closed" } as const;

/** The case file beside the map: each clue, found or not, then the bridge. */
export function ChapterMapList({ chapter }: { chapter: ChapterFrame }) {
  const two = chapter.id === "case-002";
  return (
    <section aria-labelledby="chapter-map-title" className="flex flex-col gap-2 rounded-[16px] border-2 border-game-ink bg-game-folder p-2.5">
      <h3 id="chapter-map-title" className="px-1 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink">
        Case file <span className="num">{two ? CASE_002.number : CASE_001.number}</span>: {two ? CASE_002.title : CASE_001.title}
      </h3>
      <ol className="flex flex-col gap-1.5">
        {chapter.clues.map((c) => {
          const copy = two ? voteClueCopy(c.id) : clueCopy(c.id);
          return (
            <li key={c.id} className="flex items-center gap-3 rounded-[12px] bg-game-paper px-2.5 py-2">
              <ClueSticker found={c.found} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] font-semibold leading-5">{copy.name}</span>
                <span className="text-[12px] leading-4 text-game-muted">{copy.where}</span>
              </span>
              <Chip size="xs" flat tone={c.found ? "mint" : "muted"}>
                {c.found ? <Check aria-hidden className="size-3" strokeWidth={3} /> : <Search aria-hidden className="size-3" strokeWidth={2.5} />}
                {c.found ? "Found" : "To find"}
              </Chip>
            </li>
          );
        })}
        <li aria-current={chapter.phase === "standoff" || chapter.phase === "lineup" ? "step" : undefined} className="flex items-center gap-3 rounded-[12px] bg-game-paper px-2.5 py-2">
          <BridgeSticker />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-semibold leading-5">{two ? "The polling station" : "The bridge deck"}</span>
            <span className="text-[12px] leading-4 text-game-muted">{two ? `${SYBIL.name}, and Uncle Gen` : `${RIGHT_CLICKER.name}, and Mary`}</span>
          </span>
          <Chip size="xs" flat tone={chapter.phase === "standoff" || chapter.phase === "rescue" || chapter.phase === "lineup" ? "hero" : chapter.phase === "done" ? "mint" : "muted"}>
            {chapter.phase === "done" ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
            {BRIDGE_WORD[chapter.phase]}
          </Chip>
        </li>
      </ol>
    </section>
  );
}
