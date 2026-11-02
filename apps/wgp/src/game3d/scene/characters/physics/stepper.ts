/**
 * The kit's clock: a fixed internal sub-step (120 Hz by default) fed by the display's
 * variable frame time, so springs, chains and ragdolls behave the same at 30, 60 or 144
 * fps. A long frame runs at most `maxSteps` sub-steps (the rest is dropped, so a stalled tab
 * never spirals), and `alpha` says how far the display sits between the last two sub-steps
 * for drawing.
 */
export const KIT_HZ = 120;

export class FixedStepper {
  readonly h: number;
  private acc = 0;
  /** How far between the last two sub-steps the display is, 0–1. */
  alpha = 0;

  constructor(
    hz = KIT_HZ,
    private readonly maxSteps = 6,
  ) {
    this.h = 1 / hz;
  }

  /** Accumulate `dt` seconds and run `step(h)` once per whole sub-step. Returns the count. */
  advance(dt: number, step: (h: number) => void): number {
    if (!(dt > 0)) {
      this.alpha = this.acc / this.h;
      return 0;
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.h && n < this.maxSteps) {
      step(this.h);
      this.acc -= this.h;
      n++;
    }
    if (n === this.maxSteps && this.acc >= this.h) this.acc = this.acc % this.h;
    this.alpha = this.acc / this.h;
    return n;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}
