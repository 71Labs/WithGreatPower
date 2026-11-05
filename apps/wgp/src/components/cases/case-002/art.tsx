/**
 * Case file 002's pictures, built from the cast's own portraits (public/media/cast, rendered
 * from their MPFB bodies): the Sybil, many times over, on a ballot poster and in the voting
 * line, and Uncle Gen. Server-safe.
 */
import { assetUrl } from "@/lib/assets";
import { CASE_002_MEDIA } from "@/lib/cases/content-002";

/** One portrait, cropped to the face and shoulders (`zoom` closer on the face). */
function Portrait({ src, alt, zoom = 1.9, at = "50% 30%", className = "", grey = false }: { src: string; alt: string; zoom?: number; at?: string; className?: string; grey?: boolean }) {
  return (
    <picture className={`block overflow-hidden ${className}`}>
      <img
        src={assetUrl(src)}
        alt={alt}
        width={720}
        height={720}
        loading="lazy"
        decoding="async"
        style={{ transform: `scale(${zoom})`, transformOrigin: at, objectPosition: at }}
        className={`block size-full object-cover ${grey ? "grayscale contrast-[0.9] brightness-110" : ""}`}
      />
    </picture>
  );
}

/** Uncle Gen's portrait (his cast body), for the ending's front page and the Rug's lead. */
export function GenPhoto({ alt, className = "" }: { alt: string; className?: string }) {
  return <Portrait src={CASE_002_MEDIA.gen.src} alt={alt} zoom={1.25} at="50% 32%" className={`size-full ${className}`} />;
}

/** The Sybil's portrait. */
export function SybilPhoto({ alt, className = "" }: { alt: string; className?: string }) {
  return <Portrait src={CASE_002_MEDIA.sybil.src} alt={alt} zoom={1.8} at="58% 30%" className={`size-full ${className}`} />;
}

/**
 * The line at the polling station: the same man `count` times, one of them (`pick`) in his
 * own colours, the rest the grey copies he prints. Decorative unless `alt` is given.
 */
export function SybilLine({ count = 5, pick = -1, alt = "", className = "" }: { count?: number; pick?: number; alt?: string; className?: string }) {
  return (
    <div role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} className={`grid h-full gap-1 ${className}`} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`relative overflow-hidden rounded-[6px] border-2 ${i === pick ? "border-game-hero" : "border-game-ink/60"}`}>
          <Portrait src={CASE_002_MEDIA.sybil.src} alt="" zoom={1.7} at="58% 32%" grey={i !== pick} className="size-full" />
        </span>
      ))}
    </div>
  );
}

/**
 * The case's poster (3:4): a ballot with "Vote" across the top and six identical voters, the
 * caption asking which one's real. For the case files' folder and Tonight's tile.
 */
export function BallotPoster({ alt = "A ballot poster: six identical voters in a grid under the word VOTE, captioned “Spot the original.”", className = "" }: { alt?: string; className?: string }) {
  return (
    <div role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} className={`flex aspect-[3/4] flex-col gap-[4%] bg-game-paper p-[7%] text-game-ink [container-type:inline-size] ${className}`}>
      <p className="text-center font-display text-[clamp(10px,9cqi,44px)] font-bold uppercase leading-none tracking-[0.06em]">
        <span className="block">Vote</span>
      </p>
      <div className="grid flex-1 grid-cols-2 grid-rows-3 gap-[5%]">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="relative overflow-hidden rounded-[4px] border-[1.5px] border-game-ink">
            <Portrait src={CASE_002_MEDIA.sybil.src} alt="" zoom={1.8} at="58% 32%" grey className="size-full" />
            <span aria-hidden className="absolute bottom-[6%] right-[6%] block aspect-square w-[22%] rounded-[2px] border border-game-ink bg-game-paper" />
          </span>
        ))}
      </div>
      <p className="text-center text-[clamp(6px,5cqi,15px)] font-bold uppercase leading-tight tracking-[0.08em]">Spot the original</p>
    </div>
  );
}
