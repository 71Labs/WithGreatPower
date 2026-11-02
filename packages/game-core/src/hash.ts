/**
 * State hashes for replays: FNV-1a over the raw IEEE-754 bits of a fixed list of fields.
 * No JSON (its number formatting isn't part of what we pin), no key iteration: the field
 * order is written out here, so Node and every browser hash the same state the same way.
 * A mismatch between client and server checkpoints says which stop a desync started at.
 */
import { POWERS } from "./rules/data";
import type { PowerId } from "./rules/types";
import type { SimState } from "./sim3d/types";

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
/** Which half of a double is the low word on this machine (every JS engine we target is little-endian). */
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const LO = LITTLE ? 0 : 1;
const HI = LITTLE ? 1 : 0;

const MODES = ["travel", "intro", "fight", "won", "errand", "ko", "done"] as const;
const PHASES = ["enter", "idle", "telegraph", "dash", "sweep", "slam-wind", "slam", "retract", "recover"] as const;
const HAZARDS = ["bomb", "goo", "trap", "blast"] as const;
const TRAP_STATES = ["open", "armed", "clap", "closed"] as const;
const POWER_IDS = Object.keys(POWERS) as PowerId[];

/** A running FNV-1a (32-bit) over words. */
export class Fnv {
  h = 0x811c9dc5;

  private byte(b: number) {
    this.h = Math.imul(this.h ^ (b & 0xff), 0x01000193) >>> 0;
  }

  word(w: number) {
    this.byte(w);
    this.byte(w >>> 8);
    this.byte(w >>> 16);
    this.byte(w >>> 24);
  }

  /** A double's exact bits (every NaN hashes the same). */
  num(v: number) {
    if (v !== v) {
      this.word(0);
      this.word(0x7ff80000);
      return;
    }
    f64[0] = v;
    this.word(u32[LO]);
    this.word(u32[HI]);
  }

  bool(v: boolean) {
    this.word(v ? 1 : 0);
  }

  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}

/** The sim state's hash: tick, mode, vitals, the hero, the villain, hazards, shots and Gwei. */
export function hashState(s: SimState): string {
  const f = new Fnv();
  f.num(s.tick);
  f.num(MODES.indexOf(s.mode));
  f.num(s.modeT);
  f.num(s.index);
  f.num(s.time);
  f.num(s.rng);
  f.num(s.hp);
  f.num(s.maxHp);
  f.num(s.fluid);
  f.num(s.fluidAcc);
  f.num(s.combo);
  f.num(s.maxCombo);
  f.num(s.tally.perfect);
  f.num(s.tally.good);
  f.num(s.tally.miss);
  f.num(s.total.perfect);
  f.num(s.total.good);
  f.num(s.total.miss);
  f.num(s.gweiLeft);
  f.num(s.gweiUsed);
  f.num(s.slowmo);
  for (const id of POWER_IDS) f.num(s.uses[id] ?? 0);
  f.num(s.powers.length);
  for (const p of s.powers) f.num(p.cd);

  const h = s.hero;
  f.num(h.x);
  f.num(h.y);
  f.num(h.z);
  f.num(h.vx);
  f.num(h.vy);
  f.num(h.vz);
  f.bool(h.grounded);
  f.bool(!!h.rope);
  if (h.rope) {
    f.num(h.rope.x);
    f.num(h.rope.y);
    f.num(h.rope.z);
    f.num(h.rope.len);
  }
  f.num(h.fx);
  f.num(h.fz);
  f.num(h.missCd);
  f.num(h.invuln);
  f.num(h.fizzleCd);
  f.num(h.shieldT);
  f.num(h.cloakT);
  f.num(h.dashT);
  f.bool(h.dashHit);
  f.num(h.slam);
  f.num(h.finalityT);
  f.bool(h.forked);
  f.num(h.heldT);
  f.num(h.hurtT);
  f.bool(h.holdPrev);
  f.bool(h.idle);

  const v = s.villain;
  f.bool(!!v);
  if (v) {
    f.num(v.x);
    f.num(v.y);
    f.num(v.z);
    f.num(v.vx);
    f.num(v.vy);
    f.num(v.vz);
    f.num(v.hits);
    f.num(v.invuln);
    f.num(v.stun);
    f.num(v.t);
    f.num(PHASES.indexOf(v.phase));
    f.num(v.phaseT);
    f.num(v.attackT);
    f.num(v.attack2T);
    f.bool(v.grounded);
    f.num(v.dashToX);
    f.num(v.dashToZ);
    f.bool(v.dashHit);
    f.num(v.cx);
    f.num(v.cy);
    f.num(v.cz);
    f.num(v.cycle);
    f.num(v.fleeT);
    f.num(v.dodgeT);
    f.num(v.arms.length);
    for (const a of v.arms) {
      f.num(a.angle);
      f.num(a.len);
    }
    f.num(v.bodies.length);
    for (const b of v.bodies) {
      f.num(b.x);
      f.num(b.y);
      f.num(b.z);
      f.bool(b.alive);
      f.num(b.shootT);
    }
  }
  f.num(s.hazards.length);
  for (const z of s.hazards) {
    f.num(HAZARDS.indexOf(z.kind));
    f.num(z.x);
    f.num(z.y);
    f.num(z.z);
    f.num(z.vx);
    f.num(z.vy);
    f.num(z.vz);
    f.num(z.t);
    f.num(TRAP_STATES.indexOf(z.state));
  }
  f.num(s.shots.length);
  for (const x of s.shots) {
    f.num(x.x);
    f.num(x.y);
    f.num(x.z);
    f.num(x.vx);
    f.num(x.vy);
    f.num(x.vz);
    f.num(x.t);
  }
  const g = s.gwei;
  f.bool(!!g);
  if (g) {
    f.num(g.t);
    f.num(g.x);
    f.num(g.y);
    f.num(g.z);
    f.bool(g.struck);
  }
  return f.hex();
}
