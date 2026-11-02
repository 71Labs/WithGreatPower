/**
 * Pictures of the game's UI for the feature showcase, drawn without live state. Every
 * card says "Example": the values are illustrative. Controls are drawn as plain
 * elements because nothing here is interactive.
 */
import type { ReactNode } from "react";
import { Clock, Layers, Sparkles, Store, Timer } from "@/components/icons";

import { IconTile } from "@/components/frame";
import type { CastId } from "@wgp/game-core/cast";

import { MiniAvatar } from "./mini-avatar";

function ExampleTag() {
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-[7px] bg-surface-2 px-2 text-[11px] font-medium leading-4 text-ink-subtle">
      Example
    </span>
  );
}

/** 22px corners and 12px padding, so wells and buttons inside take 10px and stay concentric. */
function ExampleCard({ lead, title, meta, children }: { lead: ReactNode; title: ReactNode; meta: ReactNode; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-[372px] flex-col gap-3 rounded-[22px] bg-canvas p-3 text-left shadow-[var(--shadow-float)]">
      <div className="flex items-center justify-between gap-3 px-1.5 pt-1.5">
        <div className="flex min-w-0 items-center gap-3">
          {lead}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-medium leading-5 tracking-[-0.01em] text-ink-strong">{title}</span>
            <span className="truncate text-[12px] leading-4 text-ink-subtle">{meta}</span>
          </div>
        </div>
        <ExampleTag />
      </div>
      {children}
    </div>
  );
}

function FakeButton({ children, variant = "primary", className = "" }: { children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <span
      className={`inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-control px-4 text-[14px] font-medium ${
        variant === "primary"
          ? "bg-[image:var(--button-solid)] text-on-inverse shadow-[var(--shadow-button)]"
          : "bg-canvas text-ink-strong shadow-[var(--shadow-chip)]"
      } ${className}`}
    >
      {children}
    </span>
  );
}

function Well({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-control bg-surface ${className}`}>{children}</div>;
}

function Bar({ value, className = "bg-accent" }: { value: number; className?: string }) {
  return (
    <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-surface-2">
      <span className={`block h-full rounded-full ${className}`} style={{ width: `${value}%` }} />
    </span>
  );
}

const stops: { id: CastId; place: string; what: string; tag: string }[] = [
  { id: "gas-goblin", place: "Sector 7", what: "Gas Goblin sighted", tag: "Boss" },
  { id: "sandwich-man", place: "Mempool Market", what: "Sandwich Man, two trades in", tag: "Fight" },
  { id: "doc-octochain", place: "Bridge District", what: "Doc Octochain on the bridge", tag: "Boss" },
  { id: "aunt-mainnet", place: "Queens Block", what: "Aunt Mainnet’s groceries", tag: "Errand" },
];

export function PatrolCard() {
  return (
    <ExampleCard
      lead={
        <IconTile size={36}>
          <Clock strokeWidth={2} />
        </IconTile>
      }
      title="Tonight’s patrol"
      meta="4 stops · about 12 minutes"
    >
      <Well className="flex flex-col p-1">
        {stops.map((s, i) => (
          <div key={s.place} className={`flex items-center gap-3 px-2.5 py-2.5 ${i > 0 ? "border-t border-hairline" : ""}`}>
            <MiniAvatar id={s.id} className="size-8 rounded-[9px]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium leading-4 text-ink-strong">{s.place}</span>
              <span className="truncate text-[12px] leading-4 text-ink-subtle">{s.what}</span>
            </div>
            <span className="rounded-[6px] bg-canvas px-1.5 py-0.5 text-[11px] font-medium leading-4 text-ink shadow-[var(--shadow-chip)]">
              {s.tag}
            </span>
          </div>
        ))}
      </Well>
      <FakeButton>Swing out</FakeButton>
    </ExampleCard>
  );
}

export function PowerCard() {
  return (
    <ExampleCard
      lead={
        <IconTile size={36}>
          <Sparkles strokeWidth={2} />
        </IconTile>
      }
      title="Node sense"
      meta="Power · Rare · Level 3 of 5"
    >
      <Well className="flex flex-col gap-3 p-4">
        <p className="text-[14px] leading-5 text-ink">See a villain three blocks before they strike, and dodge their first hit.</p>
        <div className="flex flex-col gap-2.5">
          {[
            { label: "Range", value: 60, shown: "3 blocks" },
            { label: "Cooldown", value: 35, shown: "45 s" },
            { label: "Mastery", value: 72, shown: "72%" },
          ].map((r) => (
            <div key={r.label} className="grid grid-cols-[80px_minmax(0,1fr)_56px] items-center gap-3">
              <span className="text-[12px] leading-4 text-ink-subtle">{r.label}</span>
              <Bar value={r.value} />
              <span className="num text-right text-[12px] font-medium leading-4 text-ink-strong">{r.shown}</span>
            </div>
          ))}
        </div>
      </Well>
      <div className="grid grid-cols-2 gap-2">
        <FakeButton variant="secondary">Lend</FakeButton>
        <FakeButton>Equip</FakeButton>
      </div>
    </ExampleCard>
  );
}

export function EncounterCard() {
  return (
    <ExampleCard lead={<MiniAvatar id="gas-goblin" className="size-9 rounded-[10px]" />} title="Gas Goblin" meta="Boss · Sector 7 · fees up 400%">
      <Well className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between text-[12px] leading-4">
          <span className="text-ink-subtle">Goblin</span>
          <span className="num font-medium text-ink-strong">340 / 1,000</span>
        </div>
        <Bar value={34} />
        <div className="flex items-center justify-between text-[12px] leading-4">
          <span className="text-ink-subtle">You</span>
          <span className="num font-medium text-ink-strong">820 / 1,000</span>
        </div>
        <Bar value={82} className="bg-ink-strong" />
        <p className="pt-1 text-[13px] leading-5 text-ink">
          <span className="font-medium text-ink-strong">Gas Goblin</span> throws a fee bomb. Node sense dodges it.
        </p>
      </Well>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <FakeButton>Web him</FakeButton>
        <FakeButton variant="secondary" className="gap-2 pl-2">
          <MiniAvatar id="gwei" className="size-7 rounded-[8px]" />
          Call Gwei
        </FakeButton>
      </div>
    </ExampleCard>
  );
}

export function RugCard() {
  return (
    <div className="flex w-full max-w-[372px] flex-col gap-3 rounded-[22px] bg-canvas p-3 text-left shadow-[var(--shadow-float)]">
      <div className="flex items-center justify-between gap-3 px-1.5 pt-1.5">
        <span className="font-display text-[15px] font-semibold uppercase leading-5 tracking-[0.08em] text-ink-strong">
          The Daily Rug
        </span>
        <ExampleTag />
      </div>
      <Well className="flex flex-col gap-3 p-4">
        <p className="hash text-[11px] leading-4 text-ink-subtle">Late edition · page 1</p>
        <p className="font-display text-[30px] font-semibold uppercase leading-[30px] tracking-[-0.02em] text-ink-strong">
          The Node: hero or menace?
        </p>
        <div className="flex items-center gap-2.5">
          <MiniAvatar id="bearson" className="size-8 rounded-[9px]" />
          <p className="text-[12px] leading-4 text-ink-subtle">
            By <span className="font-medium text-ink-strong">J. Jonah Bearson</span>, who already knows the answer
          </p>
        </div>
      </Well>
      <div className="flex flex-col gap-2 px-1.5 pb-1">
        <div className="flex items-center justify-between text-[12px] leading-4">
          <span className="text-ink-subtle">Readers say hero</span>
          <span className="num font-medium text-ink-strong">71%</span>
        </div>
        <Bar value={71} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FakeButton variant="secondary">Menace</FakeButton>
        <FakeButton>Hero</FakeButton>
      </div>
    </div>
  );
}

const suits = [
  { name: "Stealth suit", from: "Sybil goo", price: "12" },
  { name: "Glider suit", from: "Goblin glider", price: "30" },
  { name: "Octo-arm rig", from: "Doc’s spare arm", price: "48" },
];

export function SuitCard() {
  return (
    <ExampleCard
      lead={
        <IconTile size={36}>
          <Store strokeWidth={2} />
        </IconTile>
      }
      title="Suit shop"
      meta="Crafted from villain loot"
    >
      <Well className="flex flex-col p-1">
        {suits.map((s, i) => (
          <div key={s.name} className={`flex items-center gap-3 px-2.5 py-2.5 ${i > 0 ? "border-t border-hairline" : ""}`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-canvas text-ink-strong shadow-[var(--shadow-chip)]">
              <Layers aria-hidden className="size-4" strokeWidth={2} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium leading-4 text-ink-strong">{s.name}</span>
              <span className="truncate text-[12px] leading-4 text-ink-subtle">From {s.from}</span>
            </div>
            <span className="num whitespace-nowrap text-[13px] font-medium leading-4 text-ink-strong">
              {s.price} <span className="text-[11px] font-normal text-ink-subtle">NEAR</span>
            </span>
          </div>
        ))}
      </Well>
      <div className="flex items-center gap-2 px-1.5 text-[12px] leading-4 text-ink-subtle">
        <Timer aria-hidden className="size-3.5" />
        New drops every Friday
      </div>
    </ExampleCard>
  );
}
