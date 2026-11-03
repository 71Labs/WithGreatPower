/**
 * The touch power arc's geometry, pure. The powers sit on a quarter circle around a thumb
 * pad in the bottom-right corner, from left of the thumb to above it; Gwei (in fights) is
 * stacked above the top power at the edge instead of widening the arc, so the arc never
 * reaches in toward the hero in the middle of the screen or into the stick's side.
 *
 * Spots are a button box's `right` and `bottom` offsets (CSS px) inside the arc's own box,
 * which is anchored to the bottom-right corner of the safe area.
 */

/** The thumb pad's centre, CSS px from the right and the bottom. */
export const ARC_CORNER = 48;
/** Power buttons: 56px, well over the 48px a thumb needs. */
export const ARC_BUTTON = 56;
/** The least gap between neighbouring buttons. */
export const ARC_GAP = 6;
/** Never closer to the pad than this, so the thumb resting there doesn't brush a power. */
export const ARC_MIN_RADIUS = 104;
/** The pad picture's size. */
export const ARC_PAD = 68;

export interface ArcSpot {
  right: number;
  bottom: number;
}

export interface ArcLayout {
  radius: number;
  /** The arc's box, from the corner: everything is inside it. */
  width: number;
  height: number;
  pad: ArcSpot;
  powers: ArcSpot[];
  gwei: ArcSpot | null;
}

/** Hundredths of a pixel: enough for layout, and cos(3π/2) lands on 0. */
const px = (n: number) => Math.round(n * 100) / 100;

/** The radius that keeps `n` buttons ARC_GAP apart across a quarter turn. */
export function arcRadius(n: number): number {
  if (n < 2) return ARC_MIN_RADIUS;
  const chord = ARC_BUTTON + ARC_GAP;
  return Math.max(ARC_MIN_RADIUS, chord / 2 / Math.sin(Math.PI / (4 * (n - 1))));
}

export function arcLayout(n: number, gwei: boolean): ArcLayout {
  const r = arcRadius(n);
  const half = ARC_BUTTON / 2;
  const powers: ArcSpot[] = [];
  for (let i = 0; i < n; i++) {
    // From π (left of the pad) to 3π/2 (above it); a lone button sits halfway.
    const angle = Math.PI * (1 + 0.5 * (n === 1 ? 0.5 : i / (n - 1)));
    powers.push({ right: px(ARC_CORNER - Math.cos(angle) * r - half), bottom: px(ARC_CORNER - Math.sin(angle) * r - half) });
  }
  const top = powers.reduce((best, p) => (p.bottom > best.bottom ? p : best), { right: ARC_CORNER - half, bottom: ARC_CORNER - half });
  const g = gwei ? { right: ARC_CORNER - half, bottom: top.bottom + ARC_BUTTON + ARC_GAP + 2 } : null;
  const width = Math.max(ARC_CORNER + ARC_PAD / 2, ...powers.map((p) => p.right + ARC_BUTTON));
  const height = Math.max(ARC_CORNER + ARC_PAD / 2, ...powers.map((p) => p.bottom + ARC_BUTTON), g ? g.bottom + ARC_BUTTON : 0);
  return { radius: r, width: Math.ceil(width), height: Math.ceil(height), pad: { right: ARC_CORNER - ARC_PAD / 2, bottom: ARC_CORNER - ARC_PAD / 2 }, powers, gwei: g };
}
