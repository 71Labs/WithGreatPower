import type { ReactNode } from "react";

import { Chip, InlineTwoTone, Section } from "@/components/frame";
import { Layers, Wallet, Zap } from "@/components/icons";

const Account = ({ children }: { children: ReactNode }) => (
  <code className="hash rounded-[6px] bg-game-paper-2 px-1.5 py-0.5 text-[13px] text-game-ink">{children}</code>
);

/** What NEAR does in WGP, one job per card, in plain words. */
const jobs: { icon: ReactNode; title: string; body: ReactNode }[] = [
  {
    icon: <Wallet strokeWidth={2} />,
    title: "Your account",
    body: (
      <>
        Continue with Google and you get a NEAR key of your own, no wallet or seed phrase needed. Your name, like{" "}
        <Account>you.wgpnear.near</Account>, opens when the game’s account factory goes live. Already have a NEAR
        wallet? Sign one message (NEP-413): no transaction, no fee.
      </>
    ),
  },
  {
    icon: <Layers strokeWidth={2} />,
    title: "Your items",
    body: (
      <>
        Loot, suits and Bits are NEP-245 tokens of the game contract, <Account>game.wgpnear.near</Account>, held by your
        own account. The contract is being deployed to NEAR mainnet; until it’s live, rewards from verified nights wait
        in a queue, then mint to you.
      </>
    ),
  },
  {
    icon: <Zap strokeWidth={2} />,
    title: "No gas to sign",
    body: "A session key signs your moves. It can only call the game contract, never with NEAR attached, and a plain transfer of your items still needs your wallet. Our relayer pays the gas, so you never sign for it.",
  },
];

export function Near() {
  return (
    <Section id="near" labelledBy="near-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="flex flex-col items-start">
        <Chip>NEAR, in plain words</Chip>
        <InlineTwoTone id="near-title" className="mt-6 max-w-[20ch]" lead="The chain does its job." point="You never have to notice it." />
        <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-ink-subtle">
          No seed phrases mid-swing and no fee prompts between fights. Here is everything NEAR does in WGP.
        </p>
      </div>
      <ul className="mt-14 grid gap-6 sm:mt-16 lg:grid-cols-3 lg:gap-7">
        {jobs.map((j) => (
          <li
            key={j.title}
            className="flex flex-col gap-4 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper p-6 text-game-ink shadow-[var(--game-shadow)] sm:p-7"
          >
            <span
              aria-hidden
              className="grid size-11 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-game-ink shadow-[var(--game-shadow-sm)] [&>svg]:size-5"
            >
              {j.icon}
            </span>
            <h3 className="font-display text-[22px] font-medium leading-7 tracking-[-0.02em] text-game-ink">{j.title}</h3>
            <p className="text-[15px] leading-6 text-game-muted">{j.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
