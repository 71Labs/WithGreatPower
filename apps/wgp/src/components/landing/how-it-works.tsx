import { Gamepad, Sparkles, Swords } from "@/components/icons";

import { Chip, IconTile, InlineTwoTone, Section } from "@/components/frame";

const steps = [
  {
    icon: <Sparkles strokeWidth={2} />,
    title: "Get bitten",
    body: "Sign in with Google or a NEAR wallet. A radioactive validator bites you, and your hero is minted with a name, a suit and three starting powers.",
    note: "No seed phrase · no gas prompts",
  },
  {
    icon: <Swords strokeWidth={2} />,
    title: "Patrol the city",
    body: "Swing between districts, stop the villain of the night and help the neighbors on the way. Catch a villain and their gear is yours.",
    note: "A new patrol every night",
  },
  {
    icon: <Gamepad strokeWidth={2} />,
    title: "Level up, or trade it",
    body: "Powers level up the more you use them. Keep what you catch, trade it with other players, or lend your hero to a friend for the night.",
    note: "Everything you earn is yours",
  },
];

const patrol = [
  { label: "Gas Goblin, caught", note: "boss, Sector 7", value: "+120 XP", strong: false },
  { label: "Goblin glider", note: "rare loot", value: "+1 item", strong: false },
  { label: "Web fluid", note: "used on the way", value: "−12", strong: false },
  { label: "Responsibility", note: "helped Aunt Mainnet", value: "+3", strong: false },
  { label: "The night’s haul", note: null, value: "+120 XP, 1 item", strong: true },
];

export function HowItWorks() {
  return (
    <Section id="how" labelledBy="how-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="flex flex-col items-start">
        <Chip>How it works</Chip>
        <InlineTwoTone id="how-title" className="mt-6" lead="Get bitten, patrol," point="then level up." />
        <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-ink-subtle">
          From sign-in to your first villain takes about a minute. Your hero, its powers and its loot live on NEAR, so
          they’re yours, not the game’s.
        </p>
      </div>
      <div className="mt-14 grid gap-14 sm:mt-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16 xl:gap-24">
        <ol className="flex flex-col">
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex gap-5 pb-10 last:pb-0 sm:gap-6">
              {i < steps.length - 1 ? (
                <span aria-hidden className="absolute bottom-2 left-[21.5px] top-[56px] w-px bg-hairline-strong" />
              ) : null}
              <IconTile size={44}>{s.icon}</IconTile>
              <div className="flex min-w-0 flex-col gap-2 pt-0.5">
                <p className="num text-[13px] font-medium leading-4 text-ink-subtle">Step {i + 1}</p>
                <h3 className="font-display text-[21px] font-medium leading-7 tracking-[-0.02em]">{s.title}</h3>
                <p className="max-w-[58ch] text-[15px] leading-6 text-ink-subtle">{s.body}</p>
                <p className="hash pt-1 text-[12px] leading-4 text-ink-subtle">{s.note}</p>
              </div>
            </li>
          ))}
        </ol>

        <figure className="flex flex-col gap-4 self-center">
          <div className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
              <h3 className="font-display text-[19px] font-medium leading-6 tracking-[-0.015em]">One night’s patrol</h3>
              <span className="inline-flex h-6 shrink-0 items-center rounded-[7px] bg-surface-2 px-2 text-[11px] font-medium leading-4 text-ink-subtle">
                Example
              </span>
            </div>
            <div className="rounded-card bg-surface px-4 py-1 sm:px-5">
              <table className="num w-full text-[14px] leading-5">
                <caption className="sr-only">Worked example of what one patrol in Sector 7 earns</caption>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {patrol.map((r, i) => (
                    <tr
                      key={r.label}
                      className={i === 0 ? "" : r.strong ? "border-t border-ink-strong" : "border-t border-hairline"}
                    >
                      <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                        <span className={r.strong ? "font-medium text-ink-strong" : "text-ink"}>{r.label}</span>
                        {r.note ? (
                          <span className="block text-[12px] leading-4 text-ink-subtle sm:inline sm:pl-2">{r.note}</span>
                        ) : null}
                      </th>
                      <td
                        className={`whitespace-nowrap py-3.5 text-right ${
                          r.strong
                            ? "font-display text-[22px] font-medium leading-7 tracking-[-0.02em] text-ink-strong"
                            : "text-ink"
                        }`}
                      >
                        {r.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 pb-3 pt-4 text-[13px] leading-5 text-ink-subtle sm:px-5">
              Loot drops straight into your inventory. Web fluid refills overnight; responsibility, sadly, does not.
            </p>
          </div>
          <figcaption className="px-1 text-[12px] leading-[18px] text-ink-subtle">
            Worked example: one patrol in Sector 7. Values are illustrative.
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}
