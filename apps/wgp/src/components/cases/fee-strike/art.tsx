/**
 * Case file 003's pictures, drawn inline like the cast's busts (components/cast/avatars.tsx):
 * Aunt Mainnet's "Sorry: fees" sign (the case's poster), the fee meter jammed at MAX with page
 * 41 of her recipe book keyed into it, her dark OPEN sign over the dawn queue, and the two Daily
 * Rug photos (the cold bakery window, and the first warm loaf). Ink and paper come from the
 * game's kit tokens; the rest is the illustrations' own palette. Server-safe.
 */
import { AVATARS } from "@/components/cast";

const INK = "var(--game-ink)";
const PAPER = "var(--game-paper)";
const GOLD = "var(--game-gold)";
const RED = "var(--game-hero)";
const MINT = "var(--game-mint)";
const BRASS = "#C9952E";
const BRASS_DARK = "#8A6418";
const CRUST = "#C77B2F";
const CRUST_DARK = "#8F4F17";
const CRUMB = "#F4D49A";
const GLASS = "#3B4A86";
const STEAM = "#FFFFFF";

/**
 * Aunt Mainnet's sign, taped in her bakery window (3:4): "Sorry, no bread today. Fees up
 * 400%." with a crossed-out loaf. Read out with `label`; decorative with `label=""`.
 */
export function FeeSignPoster({ label = "A handwritten sign in Aunt Mainnet’s window: “Sorry, no bread today. Fees up 400%.” A loaf is crossed out.", className = "" }: { label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 160"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={`block h-auto w-full ${className}`}
    >
      <rect x="0" y="0" width="120" height="160" fill="#F7EBD3" />
      <rect x="3" y="3" width="114" height="154" fill="none" stroke={INK} strokeWidth="2.5" strokeDasharray="6 4" opacity="0.35" />
      <text x="60" y="30" textAnchor="middle" fontSize="19" fontWeight="800" fill={RED} style={{ letterSpacing: "0.04em" }}>
        SORRY
      </text>
      <text x="60" y="46" textAnchor="middle" fontSize="10" fontWeight="700" fill={INK}>
        no bread today
      </text>
      {/* The loaf, crossed out. */}
      <g transform="translate(60 80)">
        <path d="M-30 6C-30 -12 -16 -20 0 -20C16 -20 30 -12 30 6L30 12L-30 12Z" fill={CRUST} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M-14 -14L-8 -2M0 -16L4 -3M14 -14L16 -2" stroke={CRUST_DARK} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M-38 -24L38 20" stroke={RED} strokeWidth="5" strokeLinecap="round" />
      </g>
      <text x="60" y="122" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
        Fees up
      </text>
      <text x="60" y="142" textAnchor="middle" fontSize="19" fontWeight="800" fill={RED} style={{ fontVariantNumeric: "tabular-nums" }}>
        400%
      </text>
      <text x="96" y="153" textAnchor="middle" fontSize="7" fontStyle="italic" fill={INK} opacity="0.7">
        — A.M.
      </text>
    </svg>
  );
}

/**
 * The Mempool Market's fee meter: a brass gauge on a stub of pipe, the needle jammed in the
 * red at MAX (or, `cooled`, back in the green), and its admin key: page 41 of Aunt Mainnet's
 * recipe book, folded into its slot. Decorative (120 × 120).
 */
export function FeeMeterArt({ cooled = false, className = "" }: { cooled?: boolean; className?: string }) {
  // Needle angles: −120° (min) to +120° (max), from straight up.
  const angle = cooled ? -78 : 112;
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={`block size-full ${className}`}>
      {/* Pipe and stand. */}
      <path d="M52 92L52 112L68 112L68 92" fill={BRASS_DARK} />
      <path d="M40 112L80 112" strokeWidth={3} />
      {/* The gauge. */}
      <circle cx="60" cy="56" r="40" fill={BRASS} />
      <circle cx="60" cy="56" r="31" fill={PAPER} />
      {/* The dial's bands: green, gold, red. */}
      <path d="M36.5 69.5A27 27 0 0 1 41 37" stroke={MINT} strokeWidth={6} strokeLinecap="butt" />
      <path d="M41 37A27 27 0 0 1 79 37" stroke={GOLD} strokeWidth={6} strokeLinecap="butt" />
      <path d="M79 37A27 27 0 0 1 83.5 69.5" stroke={RED} strokeWidth={6} strokeLinecap="butt" />
      <text x="60" y="80" textAnchor="middle" fontSize="8" fontWeight="800" fill={INK} stroke="none" style={{ letterSpacing: "0.08em" }}>
        {cooled ? "FEE: OK" : "FEE: MAX"}
      </text>
      {/* The needle. */}
      <g transform={`rotate(${angle} 60 56)`}>
        <path d="M60 58L60 30" stroke={INK} strokeWidth={3} />
      </g>
      <circle cx="60" cy="56" r="4" fill={INK} />
      {/* The admin key: page 41, folded into the slot in its side. */}
      <path d="M92 44L114 40L117 64L95 68Z" fill={PAPER} strokeWidth={2} />
      <path d="M97 54L110 52M98 59L111 57M99 64L106 63" strokeWidth={1.2} opacity={0.6} />
      <text x="105" y="50" textAnchor="middle" fontSize="6" fontWeight="800" fill={RED} stroke="none" transform="rotate(-10 105 50)">
        p. 41
      </text>
      {cooled ? null : (
        <>
          {/* Heat: it's jammed. */}
          <path d="M30 18C26 12 32 8 28 2" stroke={RED} strokeWidth={2} />
          <path d="M90 18C94 12 88 8 92 2" stroke={RED} strokeWidth={2} />
        </>
      )}
    </svg>
  );
}

/** One person in the queue, breath steaming in the cold. */
function Queuer({ x, h, coat }: { x: number; h: number; coat: string }) {
  return (
    <g transform={`translate(${x} ${104 - h})`}>
      <circle cx="0" cy="0" r="7" fill="#F1C6A0" />
      <path d={`M-9 ${h}L-9 14C-9 9 -5 7 0 7C5 7 9 9 9 14L9 ${h}Z`} fill={coat} />
      <path d="M8 -6C12 -10 9 -13 13 -17" stroke={STEAM} strokeWidth="1.5" opacity="0.85" />
    </g>
  );
}

/**
 * Outside Aunt Mainnet's at dawn: her OPEN sign dark, and the queue waiting in the cold, a tall
 * regular in a trench coat and a mustache first in line. Decorative (160 × 120).
 */
export function DarkSignQueueArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`block size-full ${className}`}>
      <rect x="0" y="0" width="160" height="120" fill="#3A4180" stroke="none" />
      {/* The shopfront, its awning, the dark window. */}
      <rect x="6" y="18" width="84" height="86" fill="#7A3B2E" />
      <path d="M2 18L94 18L88 6L8 6Z" fill={RED} />
      <path d="M24 6L22 18M40 6L39 18M56 6L57 18M72 6L74 18" stroke={PAPER} strokeWidth="3" />
      <rect x="14" y="28" width="68" height="44" rx="3" fill="#1E2247" />
      {/* The OPEN sign, unlit. */}
      <rect x="26" y="38" width="44" height="18" rx="9" fill="#2B2F59" stroke="#59608F" />
      <text x="48" y="51" textAnchor="middle" fontSize="11" fontWeight="800" fill="#59608F" stroke="none" style={{ letterSpacing: "0.12em" }}>
        OPEN
      </text>
      <rect x="40" y="76" width="18" height="28" fill="#4E2219" />
      <path d="M0 104H160" strokeWidth="2.5" />
      {/* First in line: a tall regular in a trench coat, hat and a mustache. */}
      <g transform="translate(104 58)">
        <path d="M-12 46L-12 18C-12 12 -6 9 0 9C6 9 12 12 12 18L12 46Z" fill="#A08360" />
        <path d="M0 9L0 46" strokeWidth={1.5} opacity={0.6} />
        <circle cx="0" cy="0" r="8" fill="#7CC47A" />
        <path d="M-6 3C-3 6 3 6 6 3" stroke={INK} strokeWidth="3" />
        <path d="M-12 -5L12 -5L8 -14L-8 -14Z" fill="#5B4A36" />
      </g>
      <Queuer x={128} h={32} coat="#C9542F" />
      <Queuer x={148} h={36} coat="#3E7FB8" />
    </svg>
  );
}

/** A face from the cast, sized to its box (decorative). */
function CastFace({ id, className }: { id: "aunt-mainnet" | "gas-goblin"; className: string }) {
  const Art = AVATARS[id];
  return (
    <span aria-hidden className={`grid overflow-hidden rounded-[28%] border-2 border-white bg-sticker shadow-[0_2px_0_var(--game-ink)] [&>svg]:size-full ${className}`}>
      <Art />
    </span>
  );
}

/**
 * The intro's front-page photo: Aunt Mainnet's bakery window at dawn, the shelves bare and the
 * sign taped up, her face at the glass. The photo's own description is `alt`.
 */
export function ColdWindowPhoto({ alt }: { alt: string }) {
  return (
    <div role="img" aria-label={alt} className="relative size-full overflow-hidden bg-[#2B3168]">
      <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 block size-full">
        {/* Brick round the window. */}
        <rect x="0" y="0" width="160" height="120" fill="#7A3B2E" />
        <path d="M0 14H160M0 30H160M0 46H160M0 62H160M0 78H160M0 94H160M0 110H160" stroke="#5E2C22" strokeWidth="1.5" />
        {/* The window, its awning and the bare shelves. */}
        <rect x="18" y="20" width="124" height="84" rx="4" fill={GLASS} stroke={INK} strokeWidth="2.5" />
        <path d="M14 20L146 20L138 8L22 8Z" fill={RED} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M38 8L34 20M58 8L56 20M78 8L78 20M98 8L100 20M118 8L122 20" stroke={PAPER} strokeWidth="3" />
        <path d="M24 60H136M24 86H136" stroke="#9AA4D6" strokeWidth="2.5" />
        {/* One crumb, for the sadness. */}
        <circle cx="102" cy="84" r="1.6" fill={CRUMB} />
      </svg>
      <div className="absolute left-[9%] top-[30%] w-[30%] -rotate-3">
        <FeeSignPoster label="" className="rounded-[2px] shadow-[2px_3px_0_var(--game-ink)]" />
      </div>
      <CastFace id="aunt-mainnet" className="absolute bottom-[14%] right-[12%] size-[38%] max-w-[120px]" />
    </div>
  );
}

/**
 * The ending's photo: Gas Goblin webbed to the chimney with a loaf he paid full price for, Aunt
 * Mainnet beside him, the meter back in the green. The photo's own description is `alt`.
 */
export function WarmLoafPhoto({ alt }: { alt: string }) {
  return (
    <div role="img" aria-label={alt} className="relative size-full overflow-hidden bg-[#F2C46D]">
      <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 block size-full">
        {/* Dawn behind, the chimney and the roof's edge. */}
        <rect x="0" y="0" width="160" height="120" fill="#F2C46D" />
        <circle cx="120" cy="28" r="44" fill="#F8D98E" />
        <rect x="18" y="20" width="34" height="80" fill="#8E3F2E" stroke={INK} strokeWidth="2.5" />
        <path d="M18 34H52M18 50H52M18 66H52M18 82H52" stroke="#6B2E21" strokeWidth="1.5" />
        <path d="M30 18C26 10 34 6 30 -2M42 18C38 10 46 6 42 -2" stroke={STEAM} strokeWidth="3" strokeLinecap="round" fill="none" />
        <rect x="0" y="100" width="160" height="20" fill="#A5642C" stroke={INK} strokeWidth="2.5" />
        {/* The loaf in front, still steaming. */}
        <g transform="translate(86 98)">
          <path d="M-26 4C-26 -12 -14 -20 0 -20C14 -20 26 -12 26 4L26 8L-26 8Z" fill={CRUST} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M-12 -15L-7 -3M0 -17L3 -4M12 -15L14 -3" stroke={CRUST_DARK} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M-8 -26C-12 -32 -4 -36 -8 -42M6 -26C2 -32 10 -36 6 -42" stroke={STEAM} strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </g>
      </svg>
      {/* Gas Goblin, webbed to the chimney. */}
      <div className="absolute left-[6%] top-[22%] size-[34%] max-w-[110px]">
        <CastFace id="gas-goblin" className="size-full" />
        <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className="absolute inset-0 block size-full" fill="none" stroke={STEAM} strokeWidth="3" strokeLinecap="round">
          <path d="M-4 30L104 62M-4 66L104 34M30 -4L46 104M70 -4L56 104" opacity="0.9" />
        </svg>
      </div>
      <CastFace id="aunt-mainnet" className="absolute bottom-[24%] right-[8%] size-[32%] max-w-[110px]" />
      <div className="absolute right-[40%] top-[6%] size-[24%] max-w-[80px]">
        <FeeMeterArt cooled />
      </div>
    </div>
  );
}
