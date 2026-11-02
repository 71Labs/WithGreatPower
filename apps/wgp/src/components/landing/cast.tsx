import { Sticker } from "@/components/cast";
import { Chip, InlineTwoTone, Section } from "@/components/frame";
import { WebMark } from "@/components/site-header";
import { CAST, type Role } from "@wgp/game-core/cast";

import { MiniAvatar } from "./mini-avatar";

/** Role is said in words, never by color alone; villains get the accent. */
const roleStyle: Record<Role, string> = {
  Hero: "text-ink-strong",
  Ally: "text-ink-subtle",
  Press: "text-ink-subtle",
  Villain: "text-accent",
};

/** The speech bubble at the end of the sheet, like a sticker someone added. */
function Bubble() {
  return (
    <li className="col-span-2 flex items-center justify-center">
      <figure className="relative w-full max-w-[300px]">
        <blockquote className="relative rounded-[20px] border-2 border-ink-strong bg-canvas px-5 pb-5 pt-4 shadow-[var(--shadow-chip)]">
          <WebMark className="size-6 text-accent" />
          <p className="mt-2 font-display text-[22px] font-medium leading-[26px] tracking-[-0.02em] text-ink-strong">
            With great power comes great responsibility.
          </p>
          {/* The tail: a rotated square with the bubble's border on two sides. */}
          <span
            aria-hidden
            className="absolute -bottom-[9px] left-10 size-4 rotate-45 border-b-2 border-r-2 border-ink-strong bg-canvas"
          />
        </blockquote>
        <figcaption className="mt-5 flex items-center gap-2.5 pl-5">
          <MiniAvatar id="uncle-gen" className="size-9 rounded-[10px]" />
          <span className="hash text-[13px] leading-4 text-ink-subtle">Uncle Gen, every dinner</span>
        </figcaption>
      </figure>
    </li>
  );
}

export function Cast() {
  return (
    <Section id="cast" labelledBy="cast-title" inner="px-4 py-20 sm:px-10 sm:py-28">
      <div className="flex flex-col items-start">
        <Chip>The cast</Chip>
        <InlineTwoTone id="cast-title" className="mt-6 max-w-[24ch]" lead="Heroes, villains" point="and one very loud editor." />
        <p className="mt-5 max-w-[60ch] text-[17px] leading-7 text-ink-subtle">
          Every character is an original parody. Team up with them, collect them, or web them to a lamppost.
        </p>
      </div>
      <ul className="mt-14 grid grid-cols-2 gap-x-4 gap-y-12 sm:mt-16 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-6">
        {CAST.map((c) => (
          <li key={c.id} className="flex flex-col items-center text-center">
            <Sticker id={c.id} size="md" />
            <p className={`mt-1.5 text-[12px] font-medium leading-4 ${roleStyle[c.role]}`}>{c.role}</p>
            <p className="mt-2 max-w-[24ch] text-[13px] leading-5 text-ink-subtle [text-wrap:pretty]">{c.line}</p>
          </li>
        ))}
        <Bubble />
      </ul>
    </Section>
  );
}
