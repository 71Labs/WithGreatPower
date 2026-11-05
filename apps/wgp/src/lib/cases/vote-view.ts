/**
 * Case file 002's HUD, worked out from the frame (render contract v1.6, `frame.chapter.vote`)
 * and, where only the sim knows, the HUD snapshot's villain (a blow lands now, guarding): pure
 * functions, unit-tested (vote-view.test.ts), no React or DOM.
 *
 * - voteHud: the night's state for the HUD: the objective, the suspect profile (what the found
 *   clues say about the real Sybil), the fork vote (and which side of it you stand on), the
 *   recount, Uncle Gen's ballot.
 * - voteObjective / voteCue / votePhaseLine / voteLine: the words.
 */
import { TELL_BIT, type ClueId, type TellId } from "@wgp/game-core/chapters";
import type { SimEvent } from "@wgp/game-core/sim3d";
import type { RenderFrame3D, VoteFrame } from "@wgp/game-core/sim3d/contract";

import { CASE_002, SYBIL, TELLS, tellWords, voteClueCopy } from "./content-002";

/** How far across the split counts as safe (game-core sybil-vote.ts FORK_SAFE). */
const FORK_SAFE = 14;
/** The ballot box takes the ballot within this (game-core vote.ts BALLOT_REACH). */
const BALLOT_REACH = 110;

export type VotePhase = NonNullable<RenderFrame3D["chapter"]>["phase"];
export type VoteStage = VoteFrame["stage"];
/** The Sybil's state words (game-core sybil-vote.ts sybilVoteState). */
export type SybilState = "idle" | "windup" | "vote" | "open" | "stunned" | "guard" | "count" | "webbed";

export interface ProfileLine {
  tell: TellId;
  label: string;
  /** The clue that tells it has been found. */
  known: boolean;
  /** The real one's look on it, once known. */
  words: string | null;
  /** The clue's name (for "Find the booth footage"). */
  clue: string;
}

export interface VoteHud {
  phase: VotePhase;
  stage: VoteStage;
  clues: { id: ClueId; found: boolean }[];
  found: number;
  total: number;
  /** What the found clues say about the real one. */
  profile: ProfileLine[];
  /** Copies marked by mistake. */
  wrong: number;
  /** The fork vote: seconds left (one decimal), and whether the hero stands on the orphaned side. */
  fork: { left: number; total: number; need: number; votes: number; orphaned: boolean; axis: "x" | "z" } | null;
  recount: { left: number } | null;
  /** The Sybil while he's in the fight (not hiding, not beaten). */
  villain: { state: SybilState; hits: number; hitsMax: number; open: boolean; copies: number } | null;
  ballot: "runner" | "carried" | "counted" | null;
  /** Carrying the ballot within reach of the box. */
  atBox: boolean;
  freed: boolean;
}

const STATES: readonly SybilState[] = ["idle", "windup", "vote", "open", "stunned", "guard", "count", "webbed"];
const asState = (s: string): SybilState => ((STATES as readonly string[]).includes(s) ? (s as SybilState) : "idle");

/** The suspect profile from a vote frame: each tell, known once its clue is found. */
export function profileOf(vote: Pick<VoteFrame, "real" | "known">): ProfileLine[] {
  const real = (vote.real.shadow ? TELL_BIT.shadow : 0) | (vote.real.blink ? TELL_BIT.blink : 0) | (vote.real.left ? TELL_BIT.left : 0);
  return TELLS.map((t) => {
    const known = vote.known[t.id];
    return { tell: t.id, label: t.label, known, words: known ? tellWords(t, real) : null, clue: voteClueCopy(t.clue).name };
  });
}

/** The real one's tells as bits (rules/chapters.ts TELL_BIT). */
export const realBits = (vote: Pick<VoteFrame, "real">) => (vote.real.shadow ? TELL_BIT.shadow : 0) | (vote.real.blink ? TELL_BIT.blink : 0) | (vote.real.left ? TELL_BIT.left : 0);

/**
 * The HUD's view of a Case file 002 frame, or null on any other night. `sim`: the HUD snapshot's
 * villain (open: a blow lands now), when there is one.
 */
export function voteHud(frame: Pick<RenderFrame3D, "chapter" | "villains" | "hero">, sim?: { open: boolean } | null): VoteHud | null {
  const c = frame.chapter;
  const vote = c?.vote;
  if (!c || c.id !== "case-002" || !vote) return null;
  const h = frame.hero.pos;
  let fork: VoteHud["fork"] = null;
  if (vote.fork) {
    const along = vote.fork.axis === "x" ? h.x - vote.fork.at : h.z - vote.fork.at;
    fork = {
      left: Math.round(vote.fork.left * 10) / 10,
      total: vote.fork.total,
      need: vote.fork.need,
      votes: vote.fork.votes,
      orphaned: along * vote.fork.orphan > -FORK_SAFE,
      axis: vote.fork.axis,
    };
  }
  const real = frame.villains.find((v) => !v.copy) ?? null;
  const fighting = c.phase === "standoff" && vote.stage !== "recount" && real;
  const state = real ? asState(real.state) : "count";
  const copies = frame.villains.filter((v) => v.copy).length;
  const carried = vote.ballot?.state === "carried";
  return {
    phase: c.phase,
    stage: vote.stage,
    clues: c.clues.map((k) => ({ id: k.id, found: k.found })),
    found: c.clues.filter((k) => k.found).length,
    total: c.clues.length,
    profile: profileOf(vote),
    wrong: vote.wrong,
    fork,
    recount: vote.recount ? { left: Math.ceil(vote.recount.left) } : null,
    villain: fighting && real ? { state, hits: real.hits, hitsMax: real.hitsMax, open: sim ? sim.open : state === "open" || state === "stunned", copies } : null,
    ballot: vote.ballot?.state ?? null,
    atBox: carried && Math.hypot(h.x - vote.box.x, h.z - vote.box.z) <= BALLOT_REACH,
    freed: !!c.captive?.freed,
  };
}

export interface VoteObjective {
  label: string;
  count: { found: number; total: number } | null;
}

/** The case's objective, in the route bar's place. */
export function voteObjective(hud: Pick<VoteHud, "phase" | "stage" | "found" | "total" | "ballot">): VoteObjective {
  switch (hud.phase) {
    case "investigate":
      return { label: "Read the drop boxes", count: { found: hud.found, total: hud.total } };
    case "lineup":
      return { label: "Find the real Sybil", count: null };
    case "standoff":
      return { label: hud.stage === "recount" ? "Recount: find him again" : "Win the vote", count: null };
    case "rescue":
      return { label: hud.ballot === "carried" ? "Drop the ballot in the box" : "Catch the ballot thief", count: null };
    case "done":
      return { label: "Case closed", count: null };
  }
}

/** The word on the Sybil's bar for what he's doing, or null when there's nothing to read. */
export function voteCue(state: SybilState, open: boolean): { text: string; tone: "warn" | "open" | "plain" } | null {
  if (state === "vote") return { text: "Fork vote!", tone: "warn" };
  if (state === "windup") return { text: "Fake vote", tone: "warn" };
  if (open) return { text: "Open: hit him", tone: "open" };
  if (state === "guard") return { text: "Guarding", tone: "plain" };
  return null;
}

/** A line when the case moves on (the page's live region). */
export function votePhaseLine(phase: VotePhase, stage: VoteStage): string {
  switch (phase) {
    case "investigate":
      return `Case file ${CASE_002.number}. Read the three drop boxes in Validator Heights: each one tells you something about the real Sybil.`;
    case "lineup":
      return "That’s every drop box. At the polling station, find the voter who matches all three, and hit him.";
    case "standoff":
      return stage === "recount" ? "Recount! He’s hiding in the ring again. Find the one who matches." : `${SYBIL.name} is unmasked. Win the vote.`;
    case "rescue":
      return "A copy ran off with Uncle Gen’s ballot. Catch it, then drop the ballot in the box.";
    case "done":
      return "Counted. Case closed.";
  }
}

/** Case file 002's own events, for screen readers. */
export type VoteEvent = Extract<SimEvent, { type: "voter-mark" | "fork-call" | "fork" | "recount" | "ballot" | "clue-found" | "case-closed" }>;

const VOTE_EVENTS = new Set(["voter-mark", "fork-call", "fork", "recount", "ballot", "clue-found", "case-closed"]);

export const isVoteEvent = (ev: { type: string }): ev is VoteEvent => VOTE_EVENTS.has(ev.type);

/** A line for screen readers (and the sound captions) when a case event happens; null for ones not worth reading. `real`: the real one's tells, for the clue notes. */
export function voteLine(ev: VoteEvent, real: number): { text: string; urgent: boolean } | null {
  switch (ev.type) {
    case "clue-found": {
      const c = voteClueCopy(ev.id);
      return { text: `Clue ${ev.found} of ${ev.of} found: ${c.name.toLowerCase()}. “${c.note(real)}”`, urgent: true };
    }
    case "voter-mark":
      return ev.real ? { text: "That’s him! The Sybil is unmasked.", urgent: true } : { text: "Just a copy. It forks another one into the fight.", urgent: true };
    case "fork-call":
      return { text: `Fork vote! The roof splits. Cross to the safe side, or pop ${Math.max(1, ev.voters - ev.need + 1)} of the voting copies.`, urgent: true };
    case "fork":
      return ev.passed ? { text: ev.hit ? "Forked! The orphaned side reorgs, and you with it." : "The vote passed, but you were on the right side.", urgent: true } : { text: "Quorum failed! He’s open.", urgent: true };
    case "recount":
      return ev.end ? null : { text: "Recount! He’s hiding in the ring again.", urgent: true };
    case "ballot":
      return ev.state === "taken" ? { text: "You’ve got Uncle Gen’s ballot. Take it to the box.", urgent: true } : { text: "Counted. Uncle Gen’s vote is in.", urgent: true };
    case "case-closed":
      return { text: "Case closed.", urgent: true };
  }
}
