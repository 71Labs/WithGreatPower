"use client";

/**
 * The combo in the HUD. With the sim's v1.3 `combo` it's a meter: the count, the score
 * multiplier it gives (a gold badge), and a bar draining as the combo's time runs out,
 * full again whenever the count goes up. Without it, the HUD's plain "Combo N" chip.
 *
 * The bar and the numbers are written from the frame tap (no React render per frame); React
 * renders only when the frame starts or stops carrying a combo.
 */
import { useEffect, useRef, useState } from "react";

import { Zap } from "@/components/icons";
import { ComboClock, multiplierText } from "@/game3d/nav/combo";
import type { FrameTap } from "@/game3d/nav/tap";
import { Chip } from "@/sim/ui/bits";

export function ComboMeter({ tap, fallback }: { tap: FrameTap; /** The HUD snapshot's combo, for frames without v1.3's. */ fallback: number }) {
  const [rich, setRich] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const mult = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const clock = new ComboClock();
    let has = false;
    let lastCount = -1;
    let lastMult = -1;
    let lastShare = -1;
    return tap.on((t) => {
      const c = t.frame.combo;
      if (!!c !== has) {
        has = !!c;
        lastCount = lastMult = lastShare = -1;
        setRich(has);
      }
      if (!c) return;
      if (c.count !== lastCount && count.current) {
        lastCount = c.count;
        count.current.textContent = `Combo ${c.count}`;
        root.current?.setAttribute("data-on", c.count > 0 ? "true" : "false");
      }
      if (c.multiplier !== lastMult && mult.current) {
        lastMult = c.multiplier;
        mult.current.textContent = multiplierText(c.multiplier);
      }
      const share = clock.share(c.count, c.ticksLeft);
      if (Math.abs(share - lastShare) > 0.004 && bar.current) {
        lastShare = share;
        bar.current.style.scale = `${share.toFixed(3)} 1`;
      }
    });
  }, [tap, rich]);

  if (!rich)
    return (
      <Chip tone={fallback > 0 ? "paper" : "muted"} size="sm" className="num">
        <Zap aria-hidden className="size-3.5" strokeWidth={2.25} />
        Combo {fallback}
      </Chip>
    );
  return (
    <span ref={root} data-on="false" className="group inline-flex shrink-0 flex-col items-stretch gap-1">
      <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper-2 pl-2.5 pr-1 text-[12px] font-semibold leading-none text-game-ink shadow-[var(--game-shadow-sm)] group-data-[on=true]:bg-game-paper">
        <Zap aria-hidden className="size-3.5" strokeWidth={2.25} />
        <span ref={count} className="num">
          Combo 0
        </span>
        <span ref={mult} className="num rounded-full border-2 border-game-ink bg-game-gold px-1.5 text-[12px] font-bold leading-[18px] group-data-[on=false]:bg-game-paper-2">
          ×1
        </span>
      </span>
      {/* The combo's time left, draining; full again when the count goes up. */}
      <span aria-hidden className="mx-2 block h-2 overflow-hidden rounded-full border-2 border-game-ink bg-game-paper-2 group-data-[on=false]:invisible">
        <span ref={bar} className="block h-full origin-left bg-game-hero" style={{ scale: "0 1" }} />
      </span>
    </span>
  );
}
