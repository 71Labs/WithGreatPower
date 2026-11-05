/**
 * The case's pictures: the MISSING poster and Mary's photos (AVIF, then WebP, then a JPEG
 * fallback, with their folder's version for caching), and the Right-Clicker's sticker
 * face, drawn like the cast's busts (components/cast/avatars.tsx). Server-safe.
 */
import { assetUrl } from "@/lib/assets";
import { CASE_001, CASE_MEDIA } from "@/lib/cases/content";

const srcset = (base: string, ext: string, widths: number[]) => widths.map((w) => `${assetUrl(`${base}-${w}.${ext}`)} ${w}w`).join(", ");

/**
 * The MISSING poster (3:4), as taped up in the Bridge District. `sizes` is how wide it
 * draws, for the browser's pick between the 480 and 960 px files. Decorative when `alt=""`.
 */
export function MissingPoster({
  sizes,
  alt = CASE_001.poster.alt,
  eager = false,
  className = "",
}: {
  sizes: string;
  alt?: string;
  eager?: boolean;
  className?: string;
}) {
  const { base, width, height } = CASE_MEDIA.poster;
  return (
    <picture>
      <source type="image/avif" srcSet={srcset(base, "avif", [480, 960])} sizes={sizes} />
      <source type="image/webp" srcSet={srcset(base, "webp", [480, 960])} sizes={sizes} />
      <img
        src={assetUrl(`${base}-480.jpg`)}
        srcSet={srcset(base, "jpg", [480, 960])}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`block h-auto w-full ${className}`}
      />
    </picture>
  );
}

/** Mary's photo: the compressed one from the poster, or her portrait once restored. */
export function MaryPhoto({ restored = false, alt, className = "" }: { restored?: boolean; alt: string; className?: string }) {
  if (restored) {
    const r = CASE_MEDIA.restored;
    return (
      <picture>
        <img src={assetUrl(r.src)} alt={alt} width={r.width} height={r.height} loading="lazy" decoding="async" className={`block size-full object-cover ${className}`} />
      </picture>
    );
  }
  const c = CASE_MEDIA.compressed;
  return (
    <picture>
      <source type="image/webp" srcSet={assetUrl(`${c.base}.webp`)} />
      <img src={assetUrl(`${c.base}.jpg`)} alt={alt} width={c.width} height={c.height} loading="lazy" decoding="async" className={`block size-full object-cover ${className}`} />
    </picture>
  );
}

const INK = "#141414";
const HOOD = "#2E3350";
const HOOD_DARK = "#1A1D33";
const SHADOW = "#10121F";
const SKIN = "#E9B98F";
const GLOW = "#9BF2FF";

/** Shoulders that run off the frame, as the cast's busts. */
const BUST = "M-8 130C-8 110 6 99 28 96C38 94.5 45 93.5 50 93L70 93C75 93.5 82 94.5 92 96C114 99 128 110 128 130Z";

/**
 * The Right-Clicker: a hood pulled low over a sticker face, two pixel eyes in the dark and
 * a smirk, with his oversized white cursor raised beside him. Decorative (120 × 120).
 */
export function RightClickerArt() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="block size-full">
      <path d={BUST} fill={HOOD} />
      <path d="M50 98L47 116M70 98L73 116" strokeWidth={2} />
      <circle cx={47} cy={117} r={2.2} fill="#FFFDF8" strokeWidth={1.6} />
      <circle cx={73} cy={117} r={2.2} fill="#FFFDF8" strokeWidth={1.6} />
      {/* The hood, and the dark inside it. */}
      <path d="M60 7C85 7 99 27 99 52C99 72 93 88 85 99L35 99C27 88 21 72 21 52C21 27 35 7 60 7Z" fill={HOOD} />
      <path d="M35 30C40 19 49 13 60 12" stroke="#5A6190" strokeWidth={2.2} />
      <path d="M60 25C76 25 85 38 85 55C85 71 75 86 60 88C45 86 35 71 35 55C35 38 44 25 60 25Z" fill={SHADOW} />
      {/* The lower half of a face, out of the shadow. */}
      <path d="M41 64C45 78 52 86 60 87C68 86 75 78 79 64C71 68 49 68 41 64Z" fill={SKIN} />
      <path d="M53 76C57.5 79 63.5 79 68 74.5" strokeWidth={2.2} />
      {/* Pixel eyes. */}
      <rect x={45} y={49} width={9} height={6} rx={1} fill={GLOW} strokeWidth={1.6} />
      <rect x={66} y={49} width={9} height={6} rx={1} fill={GLOW} strokeWidth={1.6} />
      <path d="M43 44L55 47M77 44L65 47" stroke={HOOD_DARK} strokeWidth={3} />
      {/* The cursor, held up past his shoulder. */}
      <g transform="translate(84 46) rotate(-16)">
        <path d="M0 0L0 44L11 34L19 52L27 48L19 31L33 30Z" fill="#FFFFFF" strokeWidth={3} />
        <path d="M4 10L4 30" stroke="#C9CDF0" strokeWidth={2} />
      </g>
    </svg>
  );
}
