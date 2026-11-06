/**
 * Case File 003 on the full city map: its clues, the fee meter and Gas Goblin pinned over the
 * map (the minimap's marks as stickers: a gold magnifier, a mint tick once found, the red
 * gauge, his face), and the case file beside it in words. Every other night has no `fee`.
 */
import { CHAPTERS } from "@wgp/game-core/chapters";
import type { RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { Check, Gauge, Search } from "@/components/icons";
import { feeNext, type FeeFrame } from "@/game3d/nav/fee-pins";
import { compass, metres, toMap, type MapView } from "@/game3d/nav/map";
import { Chip, Face } from "@/sim/ui/bits";

const INFO = CHAPTERS["case-003"];

function ClueSticker({ found }: { found: boolean }) {
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-game-ink shadow-[0_2px_0_var(--game-ink)] ${found ? "bg-game-mint" : "bg-game-gold"}`}>
      {found ? <Check aria-hidden className="size-4" strokeWidth={3} /> : <Search aria-hidden className="size-4" strokeWidth={2.5} />}
    </span>
  );
}

function MeterSticker({ cooled }: { cooled: boolean }) {
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-game-ink shadow-[0_2px_0_var(--game-ink)] ${cooled ? "bg-game-mint text-game-ink" : "bg-game-hero text-game-on-hero"}`}>
      <Gauge aria-hidden className="size-4" strokeWidth={2.5} />
    </span>
  );
}

/** The pins, over the map's canvas (`unit` is the map view at a side of 1). */
export function FeePinsLayer({ fee, frame, unit, still }: { fee: FeeFrame; frame: RenderFrame3D; unit: MapView; still: boolean }) {
  const at = (p: Vec3) => {
    const m = toMap(unit, p.x, p.z);
    return { left: `${m.x * 100}%`, top: `${m.y * 100}%` };
  };
  const next = feeNext(fee, frame);
  const goblin = fee.phase === "meter" || fee.phase === "chase" ? frame.villains[0] : undefined;
  return (
    <ol aria-hidden className="contents">
      {fee.clues.map((c) => (
        <li key={c.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={at(c.pos)}>
          <span className={c.found ? "opacity-85" : ""}>
            <ClueSticker found={c.found} />
          </span>
        </li>
      ))}
      {!fee.meter.carried ? (
        <li className="absolute -translate-x-1/2 -translate-y-1/2" style={at(fee.meter.pos)}>
          <span className="relative block">
            {next?.mark === "meter" ? <span className={`absolute -inset-1.5 rounded-full border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} /> : null}
            <MeterSticker cooled={fee.meter.cooled} />
          </span>
        </li>
      ) : null}
      {goblin ? (
        <li className="absolute -translate-x-1/2 -translate-y-1/2" style={at(goblin.pos)}>
          <span className="relative block">
            <span className={`absolute -inset-1.5 rounded-[34%] border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} />
            <Face id="gas-goblin" className="size-8 ring-2 ring-game-ink sm:size-10" />
          </span>
        </li>
      ) : null}
    </ol>
  );
}

/** Where the case sends you next, in words, for the map's subtitle. */
export function feeWhere(fee: FeeFrame, frame: RenderFrame3D): string | null {
  const next = feeNext(fee, frame);
  if (!next) return null;
  const h = frame.hero.pos;
  const m = metres(Math.hypot(next.point.x - h.x, next.point.z - h.z));
  const dir = compass(next.point.x - h.x, next.point.z - h.z);
  switch (next.mark) {
    case "clue":
      return `The nearest clue is ${m} m ${dir} of you.`;
    case "meter":
      return fee.phase === "cool" ? "Stand at the fee meter and hold web to cool the fees." : `The fee meter is ${m} m ${dir} of you. Gas Goblin is perched on it.`;
    case "goblin":
      return `Gas Goblin is ${m} m ${dir} of you, with the meter. Keep up!`;
    case "bakery":
      return `Aunt Mainnet’s bakery is ${m} m ${dir} of you.`;
  }
}

/** The case file beside the map: each clue Found or To find, then the meter and the bakery. */
export function FeeMapList({ fee }: { fee: FeeFrame }) {
  const atMeter = fee.phase === "meter" || fee.phase === "cool";
  const atBakery = fee.phase === "chase" || fee.phase === "showdown";
  return (
    <section aria-labelledby="fee-map-title" className="flex flex-col gap-2 rounded-[16px] border-2 border-game-ink bg-game-folder p-2.5">
      <h3 id="fee-map-title" className="px-1 text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-ink">
        Case file <span className="num">{INFO.number}</span>: {INFO.title}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {fee.clues.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 rounded-[12px] bg-game-paper px-2.5 py-2">
            <ClueSticker found={c.found} />
            <span className="min-w-0 flex-1 text-[14px] font-semibold leading-5">{INFO.clues[i]?.name}</span>
            <Chip size="xs" flat tone={c.found ? "mint" : "muted"}>
              {c.found ? "Found" : "To find"}
            </Chip>
          </li>
        ))}
        <li aria-current={atMeter ? "step" : undefined} className="flex items-center gap-3 rounded-[12px] bg-game-paper px-2.5 py-2">
          <MeterSticker cooled={fee.meter.cooled} />
          <span className="min-w-0 flex-1 text-[14px] font-semibold leading-5">The fee meter</span>
          <Chip size="xs" flat tone={fee.meter.cooled ? "mint" : atMeter ? "hero" : "muted"}>
            {fee.meter.cooled ? "Cooled" : fee.meter.carried ? "He has it" : atMeter ? "Next" : "Later"}
          </Chip>
        </li>
        <li aria-current={atBakery ? "step" : undefined} className="flex items-center gap-3 rounded-[12px] bg-game-paper px-2.5 py-2">
          <Face id="aunt-mainnet" className="size-8" />
          <span className="min-w-0 flex-1 text-[14px] font-semibold leading-5">Aunt Mainnet’s bakery</span>
          <Chip size="xs" flat tone={fee.phase === "cool" || fee.phase === "done" ? "mint" : atBakery ? "hero" : "muted"}>
            {fee.phase === "cool" || fee.phase === "done" ? "Saved" : atBakery ? "Next" : "Later"}
          </Chip>
        </li>
      </ul>
    </section>
  );
}
