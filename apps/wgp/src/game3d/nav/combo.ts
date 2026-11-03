/**
 * The combo timer's share for the HUD meter. The frame's v1.3 `combo` says how many ticks
 * are left but not how long the window is. Given the ruleset's window (COMBO_TICKS) the
 * share is exact; without one, the window is the most seen since the count last changed (a
 * feed refills it). Pure.
 */
export class ComboClock {
  private max = 1;
  private count = -1;
  private last = 0;

  /** `window`: the ticks a feed refills the combo to, if known (0: learn it from the frames). */
  constructor(private readonly window = 0) {}

  /** 0–1 of the window left; 0 with no combo. */
  share(count: number, ticksLeft: number): number {
    if (count !== this.count || ticksLeft > this.last) this.max = Math.max(1, ticksLeft, this.window);
    this.count = count;
    this.last = ticksLeft;
    return count > 0 ? Math.max(0, Math.min(1, ticksLeft / this.max)) : 0;
  }
}

/** "×2", "×1.5". */
export const multiplierText = (m: number) => `×${Number.isInteger(m) ? m : m.toFixed(1)}`;
