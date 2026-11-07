/**
 * The Recruiter badge as a sticker: a gold medal holding your crew of three masks, you in
 * red in front. Plain SVG with its colours passed in, so the same drawing works in the
 * page (the kit's CSS variables) and in the Open Graph card (hex: a PNG can't read CSS).
 * Decorative: the badge's name is always written next to it.
 */
export interface BadgeColors {
  gold: string;
  ink: string;
  paper: string;
  hero: string;
  lens: string;
}

export const BADGE_COLORS: BadgeColors = {
  gold: "var(--game-gold)",
  ink: "var(--game-ink)",
  paper: "var(--game-paper)",
  hero: "var(--game-hero)",
  lens: "var(--game-paper)",
};

/** A crew mask: the head, its shoulders and two lenses. */
function Mask({ x, y, s, fill, ink, lens }: { x: number; y: number; s: number; fill: string; ink: string; lens: string }) {
  return (
    <g>
      <path d={`M${x - 10 * s} ${y + 26 * s} C${x - 9.4 * s} ${y + 14 * s} ${x + 9.4 * s} ${y + 14 * s} ${x + 10 * s} ${y + 26 * s} Z`} fill={fill} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
      <ellipse cx={x} cy={y} rx={9 * s} ry={10.5 * s} fill={fill} stroke={ink} strokeWidth={2.5} />
      <ellipse cx={x - 3.6 * s} cy={y - 0.6 * s} rx={3 * s} ry={2.1 * s} fill={lens} stroke={ink} strokeWidth={1.4} transform={`rotate(22 ${x - 3.6 * s} ${y - 0.6 * s})`} />
      <ellipse cx={x + 3.6 * s} cy={y - 0.6 * s} rx={3 * s} ry={2.1 * s} fill={lens} stroke={ink} strokeWidth={1.4} transform={`rotate(-22 ${x + 3.6 * s} ${y - 0.6 * s})`} />
    </g>
  );
}

/** `clipId` must be unique on the page when more than one badge is drawn. */
export function RecruiterBadgeArt({ colors = BADGE_COLORS, size, className, clipId = "recruiter-well" }: { colors?: BadgeColors; size?: number; className?: string; clipId?: string }) {
  const c = colors;
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <circle cx="48" cy="48" r="31.5" />
        </clipPath>
      </defs>
      <circle cx="48" cy="48" r="44" fill={c.gold} stroke={c.ink} strokeWidth="4" />
      {/* The medal's rim: twelve rivets. */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        return <circle key={i} cx={(48 + 38.5 * Math.cos(a)).toFixed(2)} cy={(48 + 38.5 * Math.sin(a)).toFixed(2)} r="1.6" fill={c.ink} />;
      })}
      <circle cx="48" cy="48" r="33" fill={c.paper} stroke={c.ink} strokeWidth="3" />
      <g clipPath={`url(#${clipId})`}>
        <Mask x={31} y={50} s={0.86} fill={c.ink} ink={c.ink} lens={c.lens} />
        <Mask x={65} y={50} s={0.86} fill={c.ink} ink={c.ink} lens={c.lens} />
        <Mask x={48} y={45} s={1.12} fill={c.hero} ink={c.ink} lens={c.lens} />
      </g>
    </svg>
  );
}
