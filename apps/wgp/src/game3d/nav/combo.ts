/**
 * The combo timer's share for the HUD meter. The frame's v1.3 `combo` says how many ticks
 * are left but not how long the window was, so the window is the most seen since the count
 * last changed (a combo that rises refills it). Pure.
 */
export class ComboClock {
  private max = 1;
  private count = -1;
  private last = 0;

  /** 0–1 of the window left; 0 with no combo. */
  share(count: number, ticksLeft: number): number {
    if (count !== this.count || ticksLeft > this.last) this.max = Math.max(1, ticksLeft);
    this.count = count;
    this.last = ticksLeft;
    return count > 0 ? Math.max(0, Math.min(1, ticksLeft / this.max)) : 0;
  }
}

/** "×2", "×1.5". */
export const multiplierText = (m: number) => `×${Number.isInteger(m) ? m : m.toFixed(1)}`;
