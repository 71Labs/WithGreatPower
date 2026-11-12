/**
 * Shared bits for showing powers: an icon per power, its numbers at a mastery level
 * (the same rounding the engine uses), and a compact readout of cost, recharge and
 * effect. Used by onboarding, the hero sheet and the level-up picker. Drawn for paper
 * (the sticker kit's --game-* tokens), so it reads the same in light and dark mode.
 */
import {
  Building,
  Coins,
  EyeOff,
  Layers,
  Link2,
  Rocket,
  ShieldCheck,
  Sparkles,
  Stamp,
  Swords,
  Target,
  Zap,
  type Icon,
} from "@/components/icons";
import { powerLevel, powerScale, type Power } from "@wgp/game-core/data";
import type { PowerId } from "@wgp/game-core/types";

export const POWER_ICONS: Record<PowerId, Icon> = {
  "web-sling": Target,
  "web-shield": ShieldCheck,
  "node-sense": Sparkles,
  "wall-crawl": Building,
  yank: Link2,
  finality: Stamp,
  "web-bomb": Zap,
  "gas-refund": Coins,
  fork: Layers,
  "zk-cloak": EyeOff,
  "front-run": Rocket,
  "validator-slam": Swords,
};

export interface Fact {
  label: string;
  value: string;
}

/** What a power does at a mastery: base numbers × powerScale, as the engine rounds them. */
export function powerEffects(power: Power, mastery = 0): Fact[] {
  const s = powerScale(mastery);
  const n = (v: number) => Math.round(v * s);
  const out: Fact[] = [];
  if (power.damage) out.push({ label: "Damage", value: String(n(power.damage)) });
  if (power.block) out.push({ label: "Block", value: String(n(power.block)) });
  if (power.heal) out.push({ label: "Heal", value: `+${n(power.heal)}` });
  if (power.fluid) out.push({ label: "Fluid back", value: `+${n(power.fluid)}` });
  if (power.dodge) out.push({ label: "Dodges", value: power.dodge === 1 ? "1 hit" : `${power.dodge} hits` });
  const held = stunSeconds(power, mastery);
  if (held !== null) out.push({ label: power.id === "web-bomb" ? "Webs them" : "Stuns them", value: secondsLabel(held) });
  if (power.id === "fork") out.push({ label: "Next power", value: "Twice" });
  return out;
}

export const costLabel = (cost: number) => (cost === 0 ? "Free" : `${cost} fluid`);

/**
 * A night is played in real time, so a power's `cooldown` (written in turns in the rules
 * data) is a recharge in seconds: turns × 2 + 1.5, the sim's own `cooldownSeconds`
 * (packages/game-core/src/sim3d/abilities.ts; powers.test.ts holds the two together).
 * Every power recharges, the "0-turn" ones in a second and a half.
 */
export const rechargeSeconds = (turns: number) => turns * 2 + 1.5;

/** "1.5 s", "3.5 s", "2 s": seconds with at most one decimal and a real space before the unit. */
export const secondsLabel = (seconds: number) => `${Number(seconds.toFixed(1))} s`;

export const rechargeLabel = (turns: number) => secondsLabel(rechargeSeconds(turns));

/**
 * How long a hit holds a villain still, in seconds, as the sim applies it (sim3d/abilities.ts):
 * a web bomb's blast stuns for 2 s × the power's scale, a validator slam's for 0.6 s.
 * Null for a power that doesn't stun.
 */
export function stunSeconds(power: Power, mastery = 0): number | null {
  if (!power.stun) return null;
  if (power.id === "web-bomb") return 2 * powerScale(mastery);
  if (power.id === "validator-slam") return 0.6;
  return null;
}

/** A power's one-line description, with the two "for a turn" blurbs said in real time. */
export function powerBlurb(power: Power): string {
  if (power.id === "web-bomb") return "Big hit, and they’re webbed for a couple of seconds.";
  if (power.id === "validator-slam") return "A heavy hit that stuns for a moment.";
  return power.blurb;
}

/** Uses per power level, and the cap. Mirrors powerLevel() in data.ts. */
export const USES_PER_LEVEL = 6;
export const MAX_POWER_LEVEL = 5;

/** Where a power is on its mastery track: level, uses into this level, and whether it's maxed. */
export function masteryProgress(mastery: number) {
  const level = powerLevel(mastery);
  const maxed = level >= MAX_POWER_LEVEL;
  const into = maxed ? USES_PER_LEVEL : mastery - (level - 1) * USES_PER_LEVEL;
  return { level, maxed, into, bonus: Math.round((powerScale(mastery) - 1) * 100) };
}

/**
 * Cost, recharge and effect numbers, as a grid of small cells or a wrapping row of
 * pills. A description list, so each number is read with its name; `plain` renders
 * spans instead, for use inside a <label> (which only allows phrasing content).
 */
export function PowerFacts({
  power,
  mastery = 0,
  plain = false,
  pills = false,
  id,
  cell = "bg-game-paper-2",
  className = "",
}: {
  power: Power;
  mastery?: number;
  plain?: boolean;
  /** One wrapping row of label-and-value pills, for lists. */
  pills?: boolean;
  id?: string;
  /** Cell fill: paper-2 on paper, paper inside a paper-2 well. */
  cell?: string;
  className?: string;
}) {
  const facts: Fact[] = [
    { label: "Cost", value: costLabel(power.cost) },
    { label: "Recharge", value: rechargeLabel(power.cooldown) },
    ...powerEffects(power, mastery),
  ];
  const List = plain ? "span" : "dl";
  const Row = plain ? "span" : "div";
  const Term = plain ? "span" : "dt";
  const Value = plain ? "span" : "dd";
  if (pills) {
    return (
      <List id={id} className={`flex flex-wrap gap-1.5 ${className}`}>
        {facts.map((f) => (
          <Row
            key={f.label}
            className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] leading-4 ${cell}`}
          >
            <Term className="text-game-muted">{f.label}</Term>
            <Value className="num font-semibold text-game-ink">{f.value}</Value>
          </Row>
        ))}
      </List>
    );
  }
  return (
    <List id={id} className={`grid grid-cols-3 gap-1.5 ${className}`}>
      {facts.map((f) => (
        <Row key={f.label} className={`flex min-w-0 flex-col gap-0.5 rounded-[10px] px-2.5 py-1.5 ${cell}`}>
          <Term className="text-[11px] leading-4 text-game-muted">
            {f.label}
            {plain ? <span className="sr-only">:</span> : null}
          </Term>
          <Value className="num text-[13px] font-semibold leading-4 text-game-ink">
            {f.value}
            {plain ? <span className="sr-only">.</span> : null}
          </Value>
        </Row>
      ))}
    </List>
  );
}
