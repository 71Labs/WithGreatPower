/**
 * A scripted hero for the city lab: a small rope-swing toy (gravity, an inextensible web,
 * a pump, roof landings) that picks roof corners and prop anchors ahead and above, steering
 * from stop to stop. It writes a `RenderFrame3D` the same way the real loop will, so the
 * scene and the camera can be judged before the 3D sim lands. Not the game's physics and
 * not deterministic; never used outside /lab.
 */
import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { citySolids, type CitySolids } from "@/game3d/scene/camera/raycast";

const GRAVITY = 1750;
const PUMP = 300;
const AIR_CONTROL = 420;
const MAX_SPEED = 1650;
const RUN = 390;

export type SwingEvent = { kind: "attach"; at: Vec3 } | { kind: "release"; at: Vec3; perfect: boolean } | { kind: "land"; at: Vec3 } | { kind: "bounce"; at: Vec3 };

export function createFrame(at: Vec3): RenderFrame3D {
  return {
    tick: 0,
    alpha: 0,
    hero: {
      pos: { ...at },
      vel: { x: 0, y: 0, z: 0 },
      anchor: null,
      grounded: true,
      hp: 100,
      maxHp: 100,
      fluid: 100,
      hurtFlash: 0,
      shield: false,
    },
    villains: [],
    hazards: [],
    stop: 0,
    mode: "travel",
    timeScale: 1,
  };
}

export class SwingScript {
  readonly frame: RenderFrame3D;
  private readonly solids: CitySolids;
  private readonly anchors: Vec3[] = [];
  private rope = 0;
  private ropeT = 0;
  private freeT = 0;
  private groundT = 0;
  private target = 0;
  /** In the arena: chase the rival instead of touring the stops. */
  private arena = false;
  private villainT = 0;

  constructor(private readonly city: City) {
    this.solids = citySolids(city, { props: false });
    this.frame = createFrame({ ...city.start, y: city.start.y + 44 });
    for (const b of city.buildings) {
      for (const [x, z] of [
        [b.x0, b.z0],
        [b.x1, b.z0],
        [b.x0, b.z1],
        [b.x1, b.z1],
      ])
        this.anchors.push({ x, y: b.h, z });
      if (b.top)
        for (const [x, z] of [
          [b.top.x0, b.top.z0],
          [b.top.x1, b.top.z0],
          [b.top.x0, b.top.z1],
          [b.top.x1, b.top.z1],
        ])
          this.anchors.push({ x, y: b.top.h, z });
    }
    for (const a of city.anchors) this.anchors.push(a.at);
    this.target = 1 % Math.max(1, city.zones.length);
  }

  /** Arena mode: the frame becomes a fight at Gas Goblin's stop, and the hero goes after him. */
  setArena(on: boolean): void {
    this.arena = on;
  }

  private goal(): Vec3 {
    if (this.arena) {
      const v = this.frame.villains[0];
      if (v) return v.pos;
    }
    return this.city.zones[this.target]?.center ?? this.city.start;
  }

  private chooseAnchor(): Vec3 | null {
    const h = this.frame.hero;
    const g = this.goal();
    let hx = g.x - h.pos.x;
    let hz = g.z - h.pos.z;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    const want = { x: h.pos.x + hx * 380, y: Math.max(h.pos.y + 300, 560), z: h.pos.z + hz * 380 };
    let best: Vec3 | null = null;
    let bestScore = Infinity;
    for (const a of this.anchors) {
      const dx = a.x - h.pos.x;
      const dz = a.z - h.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 160 || d > 640) continue;
      if (a.y < h.pos.y + 110) continue;
      if ((dx * hx + dz * hz) / d < 0.5) continue;
      const s = (a.x - want.x) ** 2 + (a.y - want.y) ** 2 * 0.35 + (a.z - want.z) ** 2;
      if (s < bestScore) {
        bestScore = s;
        best = a;
      }
    }
    return best;
  }

  step(dt: number, time: number, events: SwingEvent[]): void {
    const f = this.frame;
    const h = f.hero;
    const p = h.pos;
    const v = h.vel;
    f.tick += 1;
    f.mode = this.arena ? "fight" : "travel";
    f.stop = this.arena ? this.arenaStop() : this.target;
    this.updateVillain(dt, time);
    const g = this.goal();
    if (!this.arena && Math.hypot(g.x - p.x, g.z - p.z) < 260) this.target = (this.target + 1) % Math.max(1, this.city.zones.length);
    let hx = g.x - p.x;
    let hz = g.z - p.z;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;

    if (h.grounded) {
      this.groundT += dt;
      v.x = hx * RUN;
      v.z = hz * RUN;
      v.y = 0;
      if (this.groundT > 0.35) {
        h.grounded = false;
        v.y = 820;
        v.x = hx * 620;
        v.z = hz * 620;
        this.freeT = 0;
      }
    } else if (h.anchor) {
      this.ropeT += dt;
      v.y -= GRAVITY * dt;
      // Pump along the motion while swinging down through the bottom.
      const sp = Math.hypot(v.x, v.y, v.z) || 1;
      const below = h.anchor.y - p.y;
      if (below > 0) {
        v.x += (v.x / sp) * PUMP * dt;
        v.y += (v.y / sp) * PUMP * dt;
        v.z += (v.z / sp) * PUMP * dt;
      }
      v.x += hx * AIR_CONTROL * 0.3 * dt;
      v.z += hz * AIR_CONTROL * 0.3 * dt;
      // Release past the anchor while rising (a "perfect" if fast), or after a long hang,
      // with a kick up and on so the next arc clears the roofs.
      const ahead = (p.x - h.anchor.x) * hx + (p.z - h.anchor.z) * hz;
      if ((ahead > this.rope * 0.22 && v.y > 0) || this.ropeT > 2.4) {
        const perfect = sp > 650 && v.y > 120;
        v.x += hx * 260;
        v.z += hz * 260;
        v.y = Math.max(v.y * (perfect ? 1.12 : 1), 560);
        events.push({ kind: "release", at: { ...p }, perfect });
        h.anchor = null;
        this.freeT = 0;
      }
    } else {
      this.freeT += dt;
      v.y -= GRAVITY * dt;
      v.x += hx * AIR_CONTROL * dt;
      v.z += hz * AIR_CONTROL * dt;
      if (this.freeT > 0.22 && v.y < 250) {
        const a = this.chooseAnchor();
        if (a) {
          h.anchor = { ...a };
          this.rope = Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z);
          this.ropeT = 0;
          events.push({ kind: "attach", at: { ...a } });
        }
      }
    }

    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > MAX_SPEED) {
      v.x *= MAX_SPEED / sp;
      v.y *= MAX_SPEED / sp;
      v.z *= MAX_SPEED / sp;
    }
    const prevY = p.y;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    // The web: project back onto the rope sphere and drop the outward speed.
    if (h.anchor) {
      const a = h.anchor;
      let rx = p.x - a.x;
      let ry = p.y - a.y;
      let rz = p.z - a.z;
      const d = Math.hypot(rx, ry, rz);
      if (d > this.rope) {
        rx /= d;
        ry /= d;
        rz /= d;
        p.x = a.x + rx * this.rope;
        p.y = a.y + ry * this.rope;
        p.z = a.z + rz * this.rope;
        const out = v.x * rx + v.y * ry + v.z * rz;
        if (out > 0) {
          v.x -= rx * out;
          v.y -= ry * out;
          v.z -= rz * out;
        }
      }
      // Reel in toward a comfortable length, so the arc's bottom stays near the roofs.
      this.rope = Math.max(300, this.rope - 240 * dt);
    }

    // Roofs: land from above, slide off walls.
    const R = 26;
    const s = this.solids;
    for (let i = 0; i < s.count; i++) {
      if (p.x < s.minX[i] - R || p.x > s.maxX[i] + R || p.z < s.minZ[i] - R || p.z > s.maxZ[i] + R) continue;
      if (p.y - 44 > s.maxY[i] || p.y < s.minY[i]) continue;
      if (prevY - 44 >= s.maxY[i] - 2 && v.y <= 0) {
        p.y = s.maxY[i] + 44;
        v.y = 0;
        h.grounded = true;
        h.anchor = null;
        this.groundT = 0;
        events.push({ kind: "land", at: { ...p } });
        continue;
      }
      const pen = [p.x - (s.minX[i] - R), s.maxX[i] + R - p.x, p.z - (s.minZ[i] - R), s.maxZ[i] + R - p.z];
      const k = pen.indexOf(Math.min(...pen));
      if (k === 0) {
        p.x = s.minX[i] - R;
        v.x = Math.min(0, v.x);
      } else if (k === 1) {
        p.x = s.maxX[i] + R;
        v.x = Math.max(0, v.x);
      } else if (k === 2) {
        p.z = s.minZ[i] - R;
        v.z = Math.min(0, v.z);
      } else {
        p.z = s.maxZ[i] + R;
        v.z = Math.max(0, v.z);
      }
    }
    if (h.grounded && this.groundT > 0.05) {
      // Ran off the roof edge: fall.
      const roof = this.surfaceUnder(p.x, p.z, p.y);
      if (p.y - 44 > roof + 4) h.grounded = false;
    }
    // The street is a miss: bounce back up.
    if (p.y < 60) {
      p.y = 60;
      v.y = 1100;
      h.anchor = null;
      events.push({ kind: "bounce", at: { ...p } });
    }
    h.hurtFlash = Math.max(0, h.hurtFlash - dt);
  }

  private surfaceUnder(x: number, z: number, y: number): number {
    const s = this.solids;
    let best = 0;
    for (let i = 0; i < s.count; i++) {
      if (x < s.minX[i] || x > s.maxX[i] || z < s.minZ[i] || z > s.maxZ[i]) continue;
      if (s.maxY[i] <= y && s.maxY[i] > best) best = s.maxY[i];
    }
    return best;
  }

  /** Gas Goblin loops over the first fight stop. */
  private updateVillain(dt: number, time: number) {
    const zone = this.city.zones.find((z) => z.villain === "gas-goblin") ?? this.city.zones.find((z) => z.villain);
    if (!zone) return;
    this.villainT += dt;
    const r = 220;
    const t = time * 0.7;
    const pos = { x: zone.center.x + Math.sin(t) * r, y: zone.center.y + 190 + Math.sin(t * 2) * 50, z: zone.center.z + Math.cos(t) * r * 0.7 };
    const v = this.frame.villains[0];
    if (v) v.pos = pos;
    else this.frame.villains.push({ id: zone.villain ?? "gas-goblin", copy: false, pos, hits: 0, hitsMax: 3, state: "idle" });
  }

  /** The stop index of the villain's arena. */
  arenaStop(): number {
    const i = this.city.zones.findIndex((z) => z.villain === "gas-goblin");
    return i < 0 ? 0 : i;
  }
}
