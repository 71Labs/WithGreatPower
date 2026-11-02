/**
 * The scene's view of the sim: fill a RenderFrame3D from the state, in place, so the
 * session loop allocates nothing per frame (apart from growing the villain and hazard
 * lists the first time they're needed). Interpolation between ticks is the loop's job;
 * this writes the current tick.
 */
import type { RenderFrame3D, Vec3 } from "./contract";
import { armTip } from "./villains";
import type { SimState } from "./types";

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

export function newRenderFrame(): RenderFrame3D {
  return {
    tick: 0,
    alpha: 1,
    hero: { pos: v3(), vel: v3(), anchor: null, grounded: false, hp: 0, maxHp: 0, fluid: 0, hurtFlash: 0, shield: false },
    villains: [],
    hazards: [],
    stop: 0,
    mode: "travel",
    timeScale: 1,
  };
}

const set = (o: Vec3, x: number, y: number, z: number) => {
  o.x = x;
  o.y = y;
  o.z = z;
};

/** A short state word for a villain, for animation. */
function villainState(s: SimState): string {
  const v = s.villain!;
  if (s.mode === "won") return "webbed";
  if (v.stun > 0) return "stunned";
  if (v.invuln > 0) return "guard";
  if (v.kind === "doc-octochain" && v.phase === "retract") return "open";
  switch (v.phase) {
    case "telegraph":
    case "slam-wind":
      return "windup";
    case "dash":
    case "slam":
    case "sweep":
      return "attack";
    default:
      return "idle";
  }
}

/** Write the state into `out` (tick, hero, villains, hazards, stop, mode). */
export function fillRenderFrame(s: SimState, out: RenderFrame3D, alpha = 1, timeScale = 1): RenderFrame3D {
  const h = s.hero;
  out.tick = s.tick;
  out.alpha = alpha;
  out.timeScale = timeScale;
  out.stop = s.index;
  out.mode = s.mode;
  set(out.hero.pos, h.x, h.y, h.z);
  set(out.hero.vel, h.vx, h.vy, h.vz);
  if (h.rope) {
    out.hero.anchor = out.hero.anchor ?? v3();
    set(out.hero.anchor, h.rope.x, h.rope.y, h.rope.z);
  } else out.hero.anchor = null;
  out.hero.grounded = h.grounded;
  out.hero.hp = s.hp;
  out.hero.maxHp = s.maxHp;
  out.hero.fluid = s.fluid;
  out.hero.hurtFlash = h.invuln;
  out.hero.shield = h.shieldT > 0;

  const vs = out.villains;
  let n = 0;
  const v = s.villain;
  if (v) {
    const state = villainState(s);
    const push = (pos: Vec3, copy: boolean) => {
      const slot = vs[n] ?? { id: v.kind, copy, pos: v3(), hits: 0, hitsMax: 0, state };
      slot.id = v.kind;
      slot.copy = copy;
      set(slot.pos, pos.x, pos.y, pos.z);
      slot.hits = v.hits;
      slot.hitsMax = v.hitsMax;
      slot.state = state;
      vs[n++] = slot;
    };
    if (v.kind === "sybil") for (const b of v.bodies) if (b.alive) push(b, !b.real);
    if (v.kind !== "sybil") push(v, false);
  }
  vs.length = n;

  const hz = out.hazards;
  let m = 0;
  const put = (kind: string, x: number, y: number, z: number, r: number, armed: boolean, to?: Vec3) => {
    const slot = hz[m] ?? { kind, pos: v3(), r, armed };
    slot.kind = kind;
    set(slot.pos, x, y, z);
    slot.r = r;
    slot.armed = armed;
    if (to) {
      slot.to = slot.to ?? v3();
      set(slot.to, to.x, to.y, to.z);
    } else delete slot.to;
    hz[m++] = slot;
  };
  for (const z of s.hazards) put(z.kind, z.x, z.y, z.z, z.r, z.kind === "trap" ? z.state === "armed" : true);
  for (const x of s.shots) put(x.kind === "sling" ? "sling" : "web-bomb", x.x, x.y, x.z, 14, true);
  if (v && v.kind === "doc-octochain") {
    const armed = v.phase === "sweep" || v.phase === "slam";
    for (let i = 0; i < v.arms.length; i++) put("arm", v.x, v.y, v.z, 20, armed && v.arms[i].len >= 110, armTip(v, i));
  }
  if (s.gwei) put("gwei", s.gwei.x, s.gwei.y, s.gwei.z, 30, !s.gwei.struck);
  hz.length = m;
  return out;
}
