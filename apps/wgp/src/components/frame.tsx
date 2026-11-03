/**
 * Page structure primitives. Sections are full-bleed bands on the page color with a
 * centered content column, a hairline rule between them, and a small "+" where the
 * rule meets the column edge. Labels are chips; headlines are two-tone.
 *
 *   <Frame>
 *     <Section>…</Section>
 *     <Section>…</Section>
 *   </Frame>
 */
import type { ReactNode } from "react";

/** The page: full-bleed sections on the page color. Content columns live inside each Section. */
export function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative bg-page ${className}`}>{children}</div>;
}

/** Width of the content column every section aligns to. */
export const COLUMN = "mx-auto w-full max-w-[1320px]";

/** A "+" where a section rule meets a rail. Decorative only. */
function Crosshair({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute -top-[5px] hidden size-[9px] sm:block ${side === "left" ? "left-4 lg:left-6" : "right-4 lg:right-6"}`}
    >
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-ink-faint" />
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-ink-faint" />
    </span>
  );
}

/**
 * One full-bleed horizontal band. `rule` draws a hairline across the full width with
 * "+" crosshairs where it meets the edges of the content column. `inner` pads the
 * content column. (`pattern` is accepted for compatibility and ignored: no grids.)
 */
export function Section({
  children,
  id,
  labelledBy,
  rule = true,
  className = "",
  inner = "px-4 py-16 sm:px-10 sm:py-24",
}: {
  children: ReactNode;
  id?: string;
  labelledBy?: string;
  rule?: boolean;
  pattern?: "none" | "grid";
  className?: string;
  /** Padding of the content column. */
  inner?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`relative ${rule ? "border-t border-hairline" : ""} ${className}`}>
      <div className={`relative ${COLUMN}`}>
        {rule ? (
          <>
            <Crosshair side="left" />
            <Crosshair side="right" />
          </>
        ) : null}
        <div className={inner}>{children}</div>
      </div>
    </section>
  );
}

/** White label with a soft shadow, for section openers and the hero badge. */
export function Chip({
  children,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const sizes = {
    sm: "h-7 rounded-chip px-2.5 text-[12px] leading-4",
    md: "h-9 rounded-[10px] px-3.5 text-[14px] leading-5 tracking-[-0.01em]",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap bg-canvas font-medium text-ink-strong shadow-[var(--shadow-chip)] ${sizes[size]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Dark, slightly raised square holding a white icon — the feature-list marker. */
export function IconTile({ children, size = 36, className = "" }: { children: ReactNode; size?: 28 | 36 | 44; className?: string }) {
  const sizes = { 28: "size-7 rounded-[8px] [&>svg]:size-3.5", 36: "size-9 rounded-[10px] [&>svg]:size-4", 44: "size-11 rounded-[12px] [&>svg]:size-5" } as const;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center bg-[image:var(--tile-solid)] text-on-tile shadow-[var(--shadow-tile)] ${sizes[size]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Two tones in one run of text: the lead in the faint tone, the point in full ink, on
 * the same line where it fits ("Share access, not your **passwords.**").
 */
export function InlineTwoTone({
  lead,
  point,
  as: Tag = "h2",
  id,
  size = "section",
  className = "",
}: {
  lead: ReactNode;
  point: ReactNode;
  as?: "h1" | "h2" | "h3";
  id?: string;
  size?: "display" | "section" | "card";
  className?: string;
}) {
  const sizes = {
    display: "text-[clamp(2.75rem,1.4rem+4.4vw,5.25rem)] leading-[1.02] tracking-[-0.045em]",
    section: "text-[clamp(2rem,1.3rem+2.4vw,3.25rem)] leading-[1.06] tracking-[-0.04em]",
    card: "text-[28px] leading-[32px] tracking-[-0.03em]",
  } as const;
  return (
    <Tag id={id} className={`font-display font-medium ${sizes[size]} ${className}`}>
      <span className="text-ink-faint">{lead}</span> <span className="text-ink-strong">{point}</span>
    </Tag>
  );
}

/** A raised white panel for real product UI shown inside a section. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card bg-canvas shadow-[var(--shadow-panel)] ${className}`}>{children}</div>;
}
