/**
 * Case file 003, "Fee Strike", in the 3D scene: everything its night draws on top of a normal
 * one, from the frame's v1.6 `fee` and Gas Goblin's villain fields (docs/chapters/case-003.md),
 * plus the case's sim events:
 *
 * - the clues: a fee-bomb burn (a big scorch smoking on its roof, a trail of smaller ones leading
 *   off toward the fee meter's roof), the pretzel cart and the florist's stall, each with its
 *   stuck shopkeeper (two of the crowd's civilians, stood there by hand) and a price card; each
 *   glows until found, then dims, and "+CLUE!" pops when one is;
 * - market stalls on the roofs of Gas Goblin's route, so the chase runs through the Market
 *   District;
 * - the fee meter (meter.ts): on its roof with a red beam over it until he grabs it, swinging
 *   under his glider through the chase, planted on the bakery roof after; its needle follows the
 *   heat as it cools, it hisses steam, and a fee spike's wind-up shakes it and spreads a warning
 *   ring over the reach (SPIKE_REACH) before the burst;
 * - Aunt Mainnet's bakery on the fight's stage: her sign ("Sorry: fees too high" hanging under
 *   it until the fees are cooled, "Open: fresh bread" after), a cold chimney that smokes once the
 *   ovens are back on, bread crates and flour sacks along the edges, and Aunt Mainnet herself
 *   (aunt.ts) in the corner by her sign;
 * - burns where the chase's fee bombs land, so the trail of them follows the route.
 *
 * Nothing is built until a case-003 frame arrives, so every other night pays nothing. Visual
 * triggers come from the frames (a clue's `found`, the meter's `carried` and `cooled`), so they
 * show even if an event's missed; the events add what only they carry and are de-duplicated.
 * Draw calls when everything's in view: the static props, the bakery sign's frame (hidden while it
 * stands between the camera and the hero), the signs, the meter's body and dial,
 * the decals, the glows and the puffs (8), and Aunt Mainnet (2); the shopkeepers ride the
 * crowd's own batches.
 */
import {
  AdditiveBlending,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from "three";

import { SPIKE_REACH } from "@wgp/game-core/sim3d";
import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { surfaceBelow, type CitySolids } from "../camera/raycast";
import type { SharedUniforms } from "../city/materials";
import type { CrowdSystem, ExtraPerson } from "../crowd/crowd";
import type { BurstOptions } from "../effects";
import type { QualityTier } from "../quality";
import { clueGlow, hash01 } from "../chapter/math";
import { AuntOnRoof, type AuntMood } from "./aunt";
import { feeOf, goblinOf, type FeeClueId, type FeeEvent, type FeeFrame } from "./contract";
import { BURST_SECONDS, burnTrail, heatColour, puffAt, PUFF_LIFE, spikeBurst, spikeRing, stallSpot, yawToward, type RGB } from "./math";
import { METER_TALL, FeeMeter3D } from "./meter";
import { bakeryStock, BoxBatch, chimney, floristStall, marketStall, pretzelCart, signPosts, WOOD_DARK } from "./props";
import { Signs } from "./signs";
import { DECAL_FRAGMENT, DECAL_VERTEX, GLOW_FRAGMENT, GLOW_VERTEX, PUFF_FRAGMENT, PUFF_VERTEX } from "./shaders";

/** What the case needs from the rest of the scene. */
export interface FeeHost {
  burst(word: string, at: Vec3, opts?: BurstOptions): void;
  readonly crowd: CrowdSystem;
}

/** A blast from the sim (fee bombs, the meter's spikes): its scorch marks the roof. */
export type FeeBlast = { type: "blast"; x: number; y: number; z: number; r: number; kind: "bomb" | "web" | "slam" };

const DECALS = 44;
/** The fee bombs' burns kept on the roofs (the oldest goes first). */
const BURNS = 26;
const GLOWS = 10;
const PUFFS = { full: 44, light: 18 } as const;
const GOLD: RGB = [1.0, 0.83, 0.37];
/** The clue's glow, its beam, the meter's halo and beam, by size. */
const HALO = 110;
const BEAM = 420;

interface Site {
  id: FeeClueId;
  at: Vector3;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  born: number;
  size: number;
  shade: number;
}

interface Layout {
  key: string;
  sites: Site[];
  /** The burn's big scorch and its trail. */
  scorches: { x: number; y: number; z: number; size: number; rot: number; ember: number }[];
  /** Where smoke rises: the burn, and the chimney's top. */
  burnAt: Vector3;
  chimneyTop: Vector3;
  /** Aunt Mainnet's spot, by her sign. */
  aunt: Vector3;
  bakery: Vector3;
  /** The bakery sign's board: its middle (x, z), inward normal, the way along it, and its height range. */
  sign: { x: number; z: number; nx: number; nz: number; tx: number; tz: number; y0: number; y1: number } | null;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const FLAT = new Quaternion().setFromAxisAngle(X, -Math.PI / 2);

export class FeeScene {
  readonly root = new Group();
  private built = false;
  private tier: QualityTier = "medium";
  private reduced = false;
  private primed = false;
  private layout: Layout | null = null;
  private props: BoxBatch | null = null;
  /** The bakery sign's posts and boards, apart, so they can step out of the camera's way. */
  private signFrame: BoxBatch | null = null;
  private signHidden = false;
  private signs: Signs | null = null;
  private meter: FeeMeter3D | null = null;
  private aunt: AuntOnRoof | null = null;
  private decals: InstancedMesh | null = null;
  private decalAttr: InstancedBufferAttribute | null = null;
  private decalMat: ShaderMaterial | null = null;
  private glows: InstancedMesh | null = null;
  private glowAttr: InstancedBufferAttribute | null = null;
  private glowColour: InstancedBufferAttribute | null = null;
  private glowMat: ShaderMaterial | null = null;
  private puffMesh: InstancedMesh | null = null;
  private puffAttr: InstancedBufferAttribute | null = null;
  private puffMat: ShaderMaterial | null = null;
  private readonly quad = new PlaneGeometry(1, 1);
  private readonly glowQuad = new PlaneGeometry(1, 1);
  private readonly puffQuad = new PlaneGeometry(1, 1);
  private readonly found = new Set<FeeClueId>();
  private readonly foundAt = new Map<FeeClueId, number>();
  private readonly burns: { x: number; y: number; z: number; size: number; rot: number }[] = [];
  private readonly puffs: Puff[] = [];
  private grabbed = false;
  private cooled = false;
  private cooledAt = -10;
  private burstAt = -10;
  private loafAt = -10;
  private nextWisp = 0;
  private nextSmoke = 0;
  private nextSteam = 0;
  private phase: FeeFrame["phase"] | null = null;
  private time = 0;
  private readonly hero = new Vector3();

  constructor(
    private readonly city: City,
    private readonly solids: CitySolids,
    private readonly shared: SharedUniforms,
    private readonly host: FeeHost,
  ) {
    this.root.name = "wgp-fee-strike";
    this.root.visible = false;
  }

  /** Whether a case-003 night is on (its first frame has arrived). */
  get active(): boolean {
    return this.built && this.root.visible;
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
    this.aunt?.setTier(tier);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    if (this.meter) this.meter.reducedMotion = on;
    if (this.aunt) this.aunt.reducedMotion = on;
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.shared;
    const fog = { uFog: s.uFog, uFogBands: s.uFogBands, uFogAmt: s.uFogAmt };
    this.props = new BoxBatch(s, 360, "fee-props");
    this.signFrame = new BoxBatch(s, 8, "fee-sign-frame");
    this.signs = new Signs(s);
    this.meter = new FeeMeter3D(s);
    this.meter.reducedMotion = this.reduced;
    this.aunt = new AuntOnRoof(s, this.solids);
    this.aunt.setTier(this.tier);
    this.aunt.reducedMotion = this.reduced;

    this.decalAttr = new InstancedBufferAttribute(new Float32Array(DECALS * 4), 4).setUsage(DynamicDrawUsage);
    this.quad.setAttribute("aDecal", this.decalAttr);
    this.decalMat = new ShaderMaterial({
      name: "wgp-fee-decals",
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uTime: s.uTime, uStill: { value: 0 }, ...fog },
    });
    this.decals = new InstancedMesh(this.quad, this.decalMat, DECALS);
    this.decals.name = "fee-decals";
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    this.decals.count = 0;

    this.glowAttr = new InstancedBufferAttribute(new Float32Array(GLOWS * 4), 4).setUsage(DynamicDrawUsage);
    this.glowColour = new InstancedBufferAttribute(new Float32Array(GLOWS * 3), 3).setUsage(DynamicDrawUsage);
    this.glowQuad.setAttribute("aGlow", this.glowAttr);
    this.glowQuad.setAttribute("aColor", this.glowColour);
    this.glowMat = new ShaderMaterial({
      name: "wgp-fee-glow",
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: s.uTime, uStill: { value: 0 } },
    });
    this.glows = new InstancedMesh(this.glowQuad, this.glowMat, GLOWS);
    this.glows.name = "fee-glows";
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 3;
    this.glows.count = 0;

    this.puffAttr = new InstancedBufferAttribute(new Float32Array(PUFFS.full * 2), 2).setUsage(DynamicDrawUsage);
    this.puffQuad.setAttribute("aPuff", this.puffAttr);
    this.puffMat = new ShaderMaterial({ name: "wgp-fee-puffs", vertexShader: PUFF_VERTEX, fragmentShader: PUFF_FRAGMENT, transparent: true, depthWrite: false });
    this.puffMesh = new InstancedMesh(this.puffQuad, this.puffMat, PUFFS.full);
    this.puffMesh.name = "fee-puffs";
    this.puffMesh.frustumCulled = false;
    this.puffMesh.renderOrder = 4;
    this.puffMesh.count = 0;

    this.root.add(this.props.mesh, this.signFrame.mesh, this.signs.mesh, this.meter.root, this.aunt.root, this.decals, this.glows, this.puffMesh);
  }

  /* ---------------------------------------------------------------- the night's layout */

  private floor(x: number, z: number, y: number): number {
    return surfaceBelow(this.solids, x, z, y + 30);
  }

  /** Dress the city for this night: the clues' stalls and shopkeepers, the market, the bakery. */
  private lay(fee: FeeFrame): void {
    const key = fee.clues.map((c) => `${c.id}:${Math.round(c.pos.x)},${Math.round(c.pos.z)}`).join("|") + `|${fee.route.length}`;
    if (this.layout?.key === key) return;
    const props = this.props!;
    const signs = this.signs!;
    props.clear();
    const frame = this.signFrame!;
    frame.clear();
    let sign: Layout["sign"] = null;
    signs.clear();
    const start = this.city.start;
    const meterRoof = fee.route[0]?.roof ?? fee.meter.pos;
    const sites: Site[] = [];
    const scorches: Layout["scorches"] = [];
    const extras: ExtraPerson[] = [];
    let burnAt = new Vector3();
    for (const c of fee.clues) {
      const at = new Vector3(c.pos.x, c.pos.y, c.pos.z);
      sites.push({ id: c.id, at });
      // Facing the way the night comes from, so the hero walks up to the front.
      const yaw = yawToward(at.x, at.z, start.x, start.z);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      if (c.id === "burn") {
        burnAt = at.clone();
        scorches.push({ x: at.x, y: at.y, z: at.z, size: 120, rot: hash01(at.x) * 6.28, ember: 1 });
        for (const t of burnTrail(at, meterRoof, 6)) {
          const y = this.floor(t.x, t.z, at.y);
          // Only on the burn's own roof: off its edge the trail stops.
          if (Math.abs(y - at.y) > 4) break;
          scorches.push({ x: t.x, y, z: t.z, size: t.size, rot: t.rot, ember: 0.35 });
        }
      } else {
        // The stall, and its keeper standing behind it: far enough back that the hero walking up
        // to the stall doesn't stand on them (the crowd fades anyone within 80 of the hero).
        const back = [64, 50, 38].find((d) => Math.abs(this.floor(at.x - fx * d, at.z - fz * d, at.y) - at.y) < 2) ?? 30;
        const cx = at.x - fx * (back - 42);
        const cz = at.z - fz * (back - 42);
        const keeper = { x: at.x - fx * back, y: at.y, z: at.z - fz * back, yaw };
        if (c.id === "pretzel") {
          pretzelCart(props, cx, at.y, cz, yaw);
          signs.add("pretzel", cx + fx * 14.6, at.y + 13, cz + fz * 14.6, yaw);
          extras.push({ who: "civ-worker", look: 1, ...keeper, idle: "talk", react: "wave" });
        } else {
          floristStall(props, cx, at.y, cz, yaw);
          signs.add("florist", cx + fx * 8.8, at.y + 16, cz + fz * 8.8, yaw);
          extras.push({ who: "civ-auntie", look: 2, ...keeper, idle: "stand-b", react: "point" });
        }
      }
    }
    // A stall on each roof of his route (not the meter's, not the bakery), where it fits.
    for (let i = 1; i < fee.route.length - 1; i++) {
      const r = fee.route[i].roof;
      if (!r) continue;
      const spot = stallSpot(r, i * 13.7 + this.city.seed * 0.001, 78, 34, (x, z) => Math.abs(this.floor(x, z, r.y) - r.y) < 2);
      if (spot) marketStall(props, spot.x, r.y, spot.z, spot.yaw, i + this.city.seed);
    }
    // The bakery on the fight's stage: the sign along the edge away from the start (facing in),
    // the chimney beside it, Aunt Mainnet by the sign, stock along the side edges.
    const zone = this.city.zones[0];
    const st = zone?.stage;
    const bakery = new Vector3(fee.bakery.x, fee.bakery.y, fee.bakery.z);
    let chimneyTop = bakery.clone();
    let auntAt = bakery.clone();
    if (st) {
      const cx = (st.x0 + st.x1) / 2;
      const cz = (st.z0 + st.z1) / 2;
      const dx = start.x - cx;
      const dz = start.z - cz;
      const alongX = Math.abs(dx) >= Math.abs(dz);
      // The far edge's inward normal (toward the middle) and the way along it.
      const nx = alongX ? (dx > 0 ? 1 : -1) : 0;
      const nz = alongX ? 0 : dz > 0 ? 1 : -1;
      const half = alongX ? (st.x1 - st.x0) / 2 : (st.z1 - st.z0) / 2;
      const ex = cx - nx * (half - 16);
      const ez = cz - nz * (half - 16);
      const tx = -nz;
      const tz = nx;
      const yaw = Math.atan2(nx, nz);
      signPosts(frame, ex, st.y, ez, yaw, 258, 62);
      frame.addLocal(ex, st.y, ez, yaw, 0, 62, -4, 262, 78, 5, WOOD_DARK);
      signs.add("bakery", ex + nx * 0.6, st.y + 66, ez + nz * 0.6, yaw);
      signs.add("closed", ex + nx * 1.2, st.y + 28, ez + nz * 1.2, yaw, !fee.meter.cooled);
      signs.add("open", ex + nx * 1.2, st.y + 28, ez + nz * 1.2, yaw, fee.meter.cooled);
      frame.addLocal(ex, st.y, ez, yaw, 0, 24, -3, 134, 32, 4, WOOD_DARK);
      sign = { x: ex, z: ez, nx, nz, tx, tz, y0: st.y, y1: st.y + 145 };
      const chx = ex + tx * 150 + nx * 14;
      const chz = ez + tz * 150 + nz * 14;
      chimney(props, chx, st.y, chz);
      chimneyTop = new Vector3(chx, st.y + 82, chz);
      auntAt = new Vector3(ex - tx * 150 + nx * 40, st.y, ez - tz * 150 + nz * 40);
      for (const side of [-1, 1]) {
        for (const k of [-1, 1]) {
          const sx = cx + tx * side * (half - 26) + nx * k * 95;
          const sz = cz + tz * side * (half - 26) + nz * k * 95;
          bakeryStock(props, sx, st.y, sz, Math.atan2(-tx * side, -tz * side), side * 3 + k);
        }
      }
    }
    props.commit();
    frame.commit();
    this.host.crowd.setExtras(extras);
    this.burns.length = 0;
    this.layout = { key, sites, scorches, burnAt, chimneyTop, aunt: auntAt, bakery, sign };
  }

  /* ---------------------------------------------------------------- per frame */

  update(frame: RenderFrame3D, camera: PerspectiveCamera, dt: number, time: number): void {
    const fee = feeOf(frame);
    if (!fee) {
      if (this.root.visible) this.reset();
      return;
    }
    this.build();
    this.root.visible = true;
    this.time = time;
    this.lay(fee);
    const L = this.layout!;
    const first = !this.primed;
    this.primed = true;
    const still = this.reduced;
    this.hero.set(frame.hero.pos.x, frame.hero.pos.y, frame.hero.pos.z);
    this.phase = fee.phase;

    // Clues found: "+CLUE!" (once, whether the frame or the event says so first).
    for (const c of fee.clues) {
      if (c.found && !this.found.has(c.id)) this.clueFound(c.id, !first);
      if (c.found && !this.foundAt.has(c.id)) this.foundAt.set(c.id, time);
      if (!c.found) {
        this.found.delete(c.id);
        this.foundAt.delete(c.id);
      }
    }

    // The meter: on its roof, under him, or on the bakery roof.
    const m = fee.meter;
    const gob = goblinOf(frame);
    const spike = fee.phase === "cool" ? m.spike : 0;
    this.meter!.update(m.pos, m.carried, m.carried && gob ? { pos: gob.pos, vel: gob.vel } : null, m.heat, spike, time);
    if (m.carried && !this.grabbed) {
      this.grabbed = true;
      if (!first) this.host.burst("GRAB!", { x: m.pos.x, y: m.pos.y + 150, z: m.pos.z }, { size: 90, life: 0.8, rise: 26 });
    } else if (!m.carried && fee.phase === "investigate") this.grabbed = false;
    if (m.cooled && !this.cooled) this.cool(!first);
    if (!m.cooled && this.cooled) {
      this.cooled = false;
      this.signs!.show("closed", !this.signHidden);
      this.signs!.show("open", false);
    }

    this.clearSign(camera, frame.hero.pos);
    this.updateGlows(fee, time);
    this.updateDecals(fee, time);
    this.updatePuffs(fee, camera, time);

    // Aunt Mainnet: watching the fight, talking him through the cooling, waving once it's done.
    const mood: AuntMood = m.cooled ? "wave" : fee.phase === "cool" || time - this.loafAt < 2.5 ? "talk" : "idle";
    this.aunt!.update(L.aunt, frame.hero.pos, mood, camera, dt);
    this.decalMat!.uniforms.uStill.value = still ? 1 : 0;
    this.glowMat!.uniforms.uStill.value = still ? 1 : 0;
  }

  /**
   * The bakery sign steps out of the way while it stands between the camera and the hero (the
   * city's own occlusion thins buildings, not props): hidden while the line between them passes
   * through its board, back once it's clear.
   */
  private clearSign(camera: PerspectiveCamera, hero: Vec3): void {
    const g = this.layout?.sign;
    if (!g) return;
    const c = camera.position;
    const dc = (c.x - g.x) * g.nx + (c.z - g.z) * g.nz;
    const dh = (hero.x - g.x) * g.nx + (hero.z - g.z) * g.nz;
    let blocks = false;
    if (dc < 12 && dh > -12) {
      // Where the line from the camera to the hero crosses the board's plane.
      const k = Math.abs(dc - dh) > 1e-6 ? dc / (dc - dh) : 0;
      const x = c.x + (hero.x - c.x) * k;
      const y = c.y + (hero.y - c.y) * k;
      const z = c.z + (hero.z - c.z) * k;
      const along = (x - g.x) * g.tx + (z - g.z) * g.tz;
      blocks = Math.abs(along) < 150 && y > g.y0 - 10 && y < g.y1 + 30;
    }
    if (blocks === this.signHidden) return;
    this.signHidden = blocks;
    this.signFrame!.mesh.visible = !blocks;
    this.signs!.show("bakery", !blocks);
    this.signs!.show(this.cooled ? "open" : "closed", !blocks);
  }

  private updateGlows(fee: FeeFrame, time: number): void {
    const g = this.glows!;
    const a = this.glowAttr!;
    const col = this.glowColour!;
    let n = 0;
    const put = (x: number, y: number, z: number, kind: number, strength: number, w: number, h: number, c: RGB) => {
      if (n >= GLOWS || strength <= 0.004) return;
      _m.makeTranslation(x, y, z);
      g.setMatrixAt(n, _m);
      a.setXYZW(n, kind, strength, w, h);
      col.setXYZ(n, c[0], c[1], c[2]);
      n++;
    };
    const L = this.layout!;
    const hunting = fee.phase === "investigate";
    for (const c of fee.clues) {
      const s = L.sites.find((x) => x.id === c.id);
      if (!s) continue;
      const since = c.found ? time - (this.foundAt.get(c.id) ?? time) : 0;
      if (!hunting && c.found && since > 1) continue;
      const k = clueGlow(c.found, since);
      put(s.at.x, s.at.y + 34, s.at.z, 0, k, HALO, HALO, GOLD);
      put(s.at.x, s.at.y, s.at.z, 1, k * (c.found ? 0.35 : 1), 36, BEAM, GOLD);
    }
    // The meter: a warning glow round its dial; a red beam over it while it's there to find.
    const m = fee.meter;
    const d = this.meter!.dialAt;
    const heat = heatColour(m.heat);
    const pulse = this.reduced ? 0.85 : 0.75 + 0.25 * Math.sin(time * 5);
    const cooledFor = time - this.cooledAt;
    const halo = m.cooled ? Math.max(0.3, 1.2 - cooledFor * 0.6) : m.carried ? 0.6 : fee.phase === "meter" ? 1.1 * pulse : 0.85 * pulse;
    put(d.x, d.y, d.z, 0, halo, m.carried ? 70 : 120, m.carried ? 70 : 120, heat);
    if (fee.phase === "meter" || fee.phase === "investigate") put(m.pos.x, m.pos.y, m.pos.z, 1, fee.phase === "meter" ? 0.9 : 0.3, 40, BEAM, heat);
    g.count = n;
    g.visible = n > 0;
    g.instanceMatrix.needsUpdate = true;
    a.needsUpdate = true;
    col.needsUpdate = true;
  }

  private updateDecals(fee: FeeFrame, time: number): void {
    const mesh = this.decals!;
    const a = this.decalAttr!;
    let n = 0;
    const put = (x: number, y: number, z: number, size: number, rot: number, kind: number, param: number, seed: number, alpha: number) => {
      if (n >= DECALS || alpha <= 0.01) return;
      _q.setFromAxisAngle(Y, rot).multiply(FLAT);
      _m.compose(_p.set(x, y + 0.8, z), _q, _s.set(size, size, 1));
      mesh.setMatrixAt(n, _m);
      a.setXYZW(n, kind, param, seed, alpha);
      n++;
    };
    const L = this.layout!;
    for (const s of L.scorches) put(s.x, s.y, s.z, s.size, s.rot, 0, s.ember, hash01(s.x * 0.37 + s.z), 1);
    for (const b of this.burns) put(b.x, b.y, b.z, b.size, b.rot, 0, 0.6, hash01(b.x * 0.71 + b.z * 0.13), 1);
    const m = fee.meter;
    if (fee.phase === "cool" && !m.carried) {
      const full = (2 * SPIKE_REACH) / 0.94;
      const ring = spikeRing(m.spike, time, this.reduced);
      put(m.pos.x, m.pos.y, m.pos.z, full, 0, 1, ring.fill, 0, ring.alpha);
      const b = spikeBurst(time - this.burstAt);
      put(m.pos.x, m.pos.y, m.pos.z, ((2 * SPIKE_REACH) / 0.92) * b.scale, 0, 2, (time - this.burstAt) / BURST_SECONDS, 0, b.alpha);
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    a.needsUpdate = true;
  }

  private puff(x: number, y: number, z: number, size: number, shade: number): void {
    const cap = this.tier === "low" ? PUFFS.light : PUFFS.full;
    if (this.puffs.length >= cap) this.puffs.shift();
    this.puffs.push({ x, y, z, born: this.time, size, shade });
  }

  private updatePuffs(fee: FeeFrame, camera: PerspectiveCamera, time: number): void {
    const L = this.layout!;
    const cam = camera.position;
    const near = (p: Vector3, d: number) => cam.distanceTo(p) < d;
    const rate = this.reduced ? 2 : 1;
    // The burn still smoulders; the chimney smokes once the ovens are back on; the meter hisses.
    if (time >= this.nextWisp && near(L.burnAt, 2400)) {
      this.nextWisp = time + 0.7 * rate;
      this.puff(L.burnAt.x + (hash01(time) - 0.5) * 50, L.burnAt.y + 8, L.burnAt.z + (hash01(time * 1.7) - 0.5) * 50, 24, 0.15);
    }
    if (fee.meter.cooled && time >= this.nextSmoke && near(L.chimneyTop, 3000)) {
      this.nextSmoke = time + 0.42 * rate;
      this.puff(L.chimneyTop.x + (hash01(time * 3.1) - 0.5) * 8, L.chimneyTop.y, L.chimneyTop.z, 30, 0.6);
    }
    const m = fee.meter;
    const hissing = fee.phase === "cool" && m.spike > 0;
    if (!m.carried && !m.cooled && time >= this.nextSteam && (hissing || m.heat > 0.96)) {
      this.nextSteam = time + (hissing ? 0.12 : 0.9) * rate;
      const d = this.meter!.dialAt;
      this.puff(d.x + (hash01(time * 5.3) - 0.5) * 20, d.y + METER_TALL * 0.4, d.z + (hash01(time * 2.9) - 0.5) * 20, hissing ? 20 : 16, 1);
    }
    const mesh = this.puffMesh!;
    const a = this.puffAttr!;
    let n = 0;
    const live: Puff[] = [];
    for (const p of this.puffs) {
      const age = time - p.born;
      if (age >= PUFF_LIFE || age < 0) continue;
      live.push(p);
      const f = puffAt(age, p.size, this.reduced);
      const drift = this.reduced ? 0 : Math.sin(age * 1.3 + p.x * 0.01) * 10 * (age / PUFF_LIFE);
      _m.compose(_p.set(p.x + drift, p.y + f.rise, p.z), _q.identity(), _s.set(f.size, f.size, f.size));
      mesh.setMatrixAt(n, _m);
      a.setXY(n, f.alpha * 0.85, p.shade);
      n++;
    }
    this.puffs.length = 0;
    this.puffs.push(...live);
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    a.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- moments */

  private clueFound(id: FeeClueId, burst: boolean): void {
    this.found.add(id);
    if (!burst) return;
    const s = this.layout?.sites.find((x) => x.id === id);
    if (s) this.host.burst("+CLUE!", { x: s.at.x, y: s.at.y + 60, z: s.at.z }, { size: 92, life: 1, rise: 36 });
  }

  private cool(burst: boolean): void {
    this.cooled = true;
    this.cooledAt = this.time;
    this.signs!.show("closed", false);
    this.signs!.show("open", !this.signHidden);
    if (!burst) return;
    const d = this.meter!.dialAt;
    this.host.burst("FEES COOLED!", { x: d.x, y: d.y + 70, z: d.z }, { size: 110, life: 1.5, rise: 34 });
    for (let i = 0; i < 6; i++) this.puff(d.x + (i - 2.5) * 10, d.y + 30, d.z + (hash01(i) - 0.5) * 20, 26, 1);
  }

  /** The case's sim events (session/effects.ts passes them on), and the blasts its burns come from. */
  event(ev: FeeEvent | FeeBlast): void {
    if (!this.built || !this.root.visible) return;
    switch (ev.type) {
      case "fee-clue":
        if (!this.found.has(ev.id)) this.clueFound(ev.id, true);
        break;
      case "meter-grab":
        if (!this.grabbed) {
          this.grabbed = true;
          this.host.burst("GRAB!", { x: ev.x, y: ev.y + 150, z: ev.z }, { size: 90, life: 0.8, rise: 26 });
        }
        break;
      case "chase-checkpoint":
        // The HUD's own toast says it; the scene stays quiet.
        break;
      case "chase-lost":
        this.host.burst("LOST HIM!", { x: ev.x, y: ev.y + 120, z: ev.z }, { size: 96, life: 1.2, rise: 28 });
        break;
      case "chase-escaped":
        this.host.burst("HE GOT AWAY!", { x: this.hero.x, y: this.hero.y + 120, z: this.hero.z }, { size: 96, life: 1.6, rise: 28 });
        break;
      case "chase-end":
        this.host.burst("THUNK!", { x: ev.x, y: ev.y + 110, z: ev.z }, { size: 84, life: 0.8, rise: 22 });
        break;
      case "loaf": {
        this.loafAt = this.time;
        const a = this.layout?.aunt;
        if (a) this.host.burst("FRESH LOAF!", { x: a.x, y: a.y + 130, z: a.z }, { size: 76, life: 1.2, rise: 26 });
        break;
      }
      case "fee-spike":
        this.burstAt = this.time;
        break;
      case "meter-cool": {
        const d = this.meter!.dialAt;
        this.puff(d.x, d.y + 36, d.z, 18, 1);
        break;
      }
      case "fees-cooled":
        if (!this.cooled) this.cool(true);
        break;
      case "blast":
        // A fee bomb's burn on whatever roof it hit (not the meter's spikes, which only hiss).
        if (ev.kind === "bomb" && ev.r <= 100 && (this.phase === "chase" || this.phase === "showdown")) {
          const y = this.floor(ev.x, ev.z, ev.y);
          if (this.burns.length >= BURNS) this.burns.shift();
          this.burns.push({ x: ev.x, y, z: ev.z, size: 64 + hash01(ev.x + ev.z) * 22, rot: hash01(ev.z) * 6.28 });
        }
        break;
      default:
        break;
    }
  }

  /** Off a case-003 night (a new run, the lab's reset): nothing shows, nothing's remembered. */
  private reset(): void {
    this.root.visible = false;
    this.primed = false;
    this.found.clear();
    this.foundAt.clear();
    this.burns.length = 0;
    this.puffs.length = 0;
    this.grabbed = false;
    this.cooled = false;
    this.layout = null;
    this.signHidden = false;
    if (this.signFrame) this.signFrame.mesh.visible = true;
    this.phase = null;
    this.aunt?.hide();
    this.host.crowd.setExtras([]);
  }

  dispose(): void {
    if (!this.built) return;
    this.props?.dispose();
    this.signFrame?.dispose();
    this.signs?.dispose();
    this.meter?.dispose();
    this.aunt?.dispose();
    this.decals?.dispose();
    this.decalMat?.dispose();
    this.glows?.dispose();
    this.glowMat?.dispose();
    this.puffMesh?.dispose();
    this.puffMat?.dispose();
    this.quad.dispose();
    this.glowQuad.dispose();
    this.puffQuad.dispose();
  }
}
