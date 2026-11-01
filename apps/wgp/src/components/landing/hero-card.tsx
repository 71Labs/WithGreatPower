import { Sticker } from "@/components/cast";

const stats = [
  { label: "Power", value: 86 },
  { label: "Responsibility", value: 41 },
  { label: "Web fluid", value: 72 },
  { label: "Node sense", value: 93 },
];

const powers = ["Web-sling", "Wall-crawl", "Node sense"];

/**
 * A hero's card, the way the game shows it: the sticker, four stats and three powers.
 * Illustrative values, marked as an example.
 */
export function HeroCard() {
  return (
    <article aria-labelledby="hero-card-name" className="overflow-hidden rounded-card bg-canvas text-left shadow-[var(--shadow-panel)]">
      <div className="flex items-center gap-3 px-3 pb-2 pt-3">
        <span aria-hidden className="flex shrink-0 gap-1.5 pl-1">
          <span className="size-2.5 rounded-full bg-hairline-strong" />
          <span className="size-2.5 rounded-full bg-hairline-strong" />
          <span className="size-2.5 rounded-full bg-hairline-strong" />
        </span>
        <span className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3 text-[12px] font-medium leading-4 text-ink-subtle">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
          <span className="truncate">Hero card · No. 0001</span>
        </span>
        <span className="inline-flex h-7 shrink-0 items-center rounded-[8px] bg-surface-2 px-2.5 text-[12px] font-medium leading-4 text-ink-strong">
          <span className="num">Lvl 7</span>
        </span>
      </div>

      <div className="grid items-center gap-6 px-5 pb-6 pt-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 sm:px-7 sm:pb-7">
        <Sticker id="node" size="lg" label={false} className="justify-self-center" />
        <div className="flex min-w-0 flex-col">
          <p className="text-[13px] font-medium leading-4 text-accent">Hero</p>
          <h3
            id="hero-card-name"
            className="mt-1.5 font-display text-[38px] font-medium leading-[40px] tracking-[-0.04em] text-ink-strong sm:text-[48px] sm:leading-[50px]"
          >
            The Node
          </h3>
          <p className="mt-1.5 text-[15px] leading-5 text-ink-subtle">Your friendly neighborhood validator</p>
          <dl className="mt-6 flex flex-col gap-3">
            {stats.map((s) => (
              <div key={s.label} className="grid grid-cols-[112px_minmax(0,1fr)_28px] items-center gap-3 sm:grid-cols-[124px_minmax(0,1fr)_28px]">
                <dt className="text-[13px] leading-4 text-ink-subtle">{s.label}</dt>
                <dd aria-hidden className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${s.value}%` }} />
                </dd>
                <dd className="num text-right text-[13px] font-medium leading-4 text-ink-strong">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline bg-surface px-5 py-3.5 sm:px-7">
        <ul aria-label="Powers" className="flex flex-wrap gap-1.5">
          {powers.map((p) => (
            <li
              key={p}
              className="inline-flex h-7 items-center rounded-[8px] bg-canvas px-2.5 text-[12px] font-medium leading-4 text-ink shadow-[var(--shadow-chip)]"
            >
              {p}
            </li>
          ))}
        </ul>
        <span className="hash text-[12px] leading-4 text-ink-subtle">Example</span>
      </div>
    </article>
  );
}
