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
import { Children, type ReactNode } from "react";

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

/** Headline in two tones: a quiet lead-in, then the point. */
export function TwoTone({
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
  size?: "hero" | "section" | "card";
  className?: string;
}) {
  const sizes = {
    hero: "text-[clamp(2.75rem,1.4rem+4.4vw,5.25rem)] leading-[1.02] tracking-[-0.045em]",
    section: "text-[clamp(2rem,1.3rem+2.4vw,3.25rem)] leading-[1.06] tracking-[-0.04em]",
    card: "text-[24px] leading-[30px] tracking-[-0.02em]",
  } as const;
  return (
    <Tag id={id} className={`font-display font-medium ${sizes[size]} ${className}`}>
      <span className="text-ink-faint">{lead}</span>
      <br />
      <span className="text-ink-strong">{point}</span>
    </Tag>
  );
}

/** Centered section opener: chip, two-tone headline, short lede. */
export function SectionHeader({
  chip,
  lead,
  point,
  lede,
  id,
  as = "h2",
  align = "center",
}: {
  chip: ReactNode;
  lead: ReactNode;
  point: ReactNode;
  lede?: ReactNode;
  id?: string;
  as?: "h1" | "h2";
  align?: "center" | "start";
}) {
  const centered = align === "center";
  return (
    <div className={`flex flex-col gap-5 ${centered ? "items-center text-center" : "items-start"}`}>
      <Chip>{chip}</Chip>
      <TwoTone id={id} as={as} size={as === "h1" ? "hero" : "section"} lead={lead} point={point} />
      {lede ? (
        <p className={`max-w-[56ch] text-[16px] leading-6 text-ink-subtle ${centered ? "mx-auto" : ""}`}>{lede}</p>
      ) : null}
    </div>
  );
}

/** Column layouts for a known number of cells, so rows always fill (no 3 + 1). */
const CELL_COLUMNS = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
} as const;

/**
 * A row of equal cells split by hairlines, e.g. "Built on" names or proof figures.
 * Pass `cols` with the number of children for rows that always fill; without it the
 * strip flows into as many columns as it has children from 1024px up.
 */
export function CellStrip({
  children,
  cols,
  className = "",
}: {
  children: ReactNode;
  cols?: keyof typeof CELL_COLUMNS;
  className?: string;
}) {
  // Choose a layout that fills every row from the number of cells.
  const count = Children.count(children);
  cols ??= count >= 2 && count <= 6 ? (count as keyof typeof CELL_COLUMNS) : undefined;
  if (cols) {
    // Hairlines come from a 1px gap over a hairline-colored track, so any column count works.
    return (
      <div className={`grid gap-px border-t border-hairline bg-hairline [&>*]:bg-canvas ${CELL_COLUMNS[cols]} ${className}`}>
        {children}
      </div>
    );
  }
  return (
    <div
      className={`grid grid-cols-2 border-t border-hairline sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none [&>*]:border-hairline [&>*]:border-b [&>*:nth-child(odd)]:border-r sm:[&>*]:border-r lg:[&>*]:border-b-0 lg:[&>*:last-child]:border-r-0 ${className}`}
    >
      {children}
    </div>
  );
}

/** A raised white panel for real product UI shown inside a section. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card bg-canvas shadow-[var(--shadow-panel)] ${className}`}>{children}</div>;
}

/**
 * Large rounded media frame (24px) for shader scenes with a product card floating on
 * top, as in a feature showcase. `media` fills the frame; `children` sit centered above.
 */
export function MediaFrame({
  media,
  children,
  className = "",
}: {
  media: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative isolate overflow-hidden rounded-panel bg-surface-2 ${className}`}>
      <div aria-hidden className="absolute inset-0 -z-10">
        {media}
      </div>
      {children}
    </div>
  );
}
