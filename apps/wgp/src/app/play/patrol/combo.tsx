"use client";

/**
 * The combo in the HUD. With the sim's v1.3 `combo` it's a meter: the count, the score
 * multiplier it gives (a gold badge), and a bar draining as the combo's time runs out,
 * full again whenever the count goes up. Without it, the HUD's plain "Combo N" chip.
 *
 * The numbers are written from the frame tap when they change, and the bar about ten
 * times a second with a compositor transition between (MeterPacer), so the meter never
 * restyles or repaints the page every frame; React renders only when the frame starts or
 * stops carrying a combo, or (for the plain chip) when the count changes.
 */
import { useEffect, useRef, useState } from "react";

import { Zap } from "@/components/icons";
import { ComboClock, MeterPacer, multiplierText } from "@/game3d/nav/combo";
import type { FrameTap } from "@/game3d/nav/tap";
import type { HudStore } from "@/sim/loop";
import { Chip } from "@/sim/ui/bits";
import { useHudValue } from "@/sim/ui/hud";
import { COMBO_TICKS } from "@wgp/game-core/sim3d/constants";

export function ComboMeter({ tap, store }: { tap: FrameTap; /** The HUD snapshot's combo, for frames without v1.3's. */ store: HudStore }) {
  const [rich, setRich] = useState(false);
  const fallback = useHudValue(store, (h) => h?.combo ?? 0);
  const root = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const mult = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Ruleset 3's window (6 s; it drains 4× standing on a roof), so the bar is exact.
    const clock = new ComboClock(COMBO_TICKS);
    const pacer = new MeterPacer(10);
    let has = false;
    let lastCount = -1;
    let lastMult = -1;
    return tap.on((t) => {
      const c = t.frame.combo;
      if (!!c !== has) {
        has = !!c;
        lastCount = lastMult = -1;
        pacer.reset();
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
      const share = pacer.next(clock.share(c.count, c.ticksLeft), t.time);
      if (share !== null && bar.current) bar.current.style.transform = `scaleX(${share.toFixed(3)})`;
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
      {/* The combo's time left, draining; full again when the count goes up. Its own layer, tweened between writes. */}
      <span aria-hidden className="mx-2 block h-2 overflow-hidden rounded-full border-2 border-game-ink bg-game-paper-2 group-data-[on=false]:invisible">
        <span ref={bar} className="block h-full origin-left bg-game-hero will-change-transform motion-safe:transition-transform motion-safe:duration-100 motion-safe:ease-linear" style={{ transform: "scaleX(0)" }} />
      </span>
    </span>
  );
}
