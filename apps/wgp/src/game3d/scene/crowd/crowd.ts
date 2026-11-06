/**
 * The city's people: civilians on the rooftops, the sidewalks and round the stops, who look
 * up, wave, point, film and cheer as the hero goes by, watch his fights from across the
 * street and cheer his wins. Render only: placed from the night's seed by their own
 * generator (crowd/placement.ts), reading the frame and never writing to the sim.
 *
 * - Bodies: eight MPFB civilians (crowd/civilians.ts) dressed per person from their files'
 *   colour lists (crowd/looks.ts), in the cast's shading (crowd/shaders.ts).
 * - Drawing (crowd/batch.ts): an instanced fill and hull per body with anyone drawn, on two
 *   shared materials: at most 8 draw calls on low (four bodies), 16 on medium, 32 on high
 *   (full bodies near the camera, light ones further out).
 * - Motion: shared pose blocks per body and channel (crowd/clips.ts), posed by plain
 *   forward kinematics (crowd/skeleton.ts) at 30, 15 or 8 Hz by distance (crowd/lod.ts).
 * - Budget by tier: a handful at the stops and on the roofs on low, sidewalk walkers from
 *   medium up; only those on screen and in range are drawn, nearest first.
 * - Manners: they fade where the hero lands among them, right in front of the camera, and
 *   wherever they'd stand between the camera and the hero or his rival.
 *
 * The files load once the scene's been up a moment, behind everything else in the queue.
 */
import { Frustum, Group, Matrix4, Sphere, Vector3, type PerspectiveCamera } from "three";

import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { UNITS_PER_METRE } from "../characters/cast-asset";
import type { SharedUniforms } from "../city/materials";
import type { QualityTier } from "../quality";
import { CrowdBatch, CrowdMaterials, CrowdPoses } from "./batch";
import { CHANNEL, CHANNELS, crowdClips, newSample, type ClipSample, type CrowdClip } from "./clips";
import { CIVILIANS, loadCrowd, type CrowdFiles } from "./civilians";
import { animInterval, CROWD_TIERS, distanceFade, fogFor, heroFade, lineFade, REACT_HOLD, splitBands, wantsReaction, type CrowdTier } from "./lod";
import { LOOKS_PER_BODY, lookRows, lookTexture } from "./looks";
import { planCrowd, walkAt, type SpotKind, type WalkPath } from "./placement";
import { CrowdSkeleton } from "./skeleton";

/** Seconds of scene time before the crowd asks for its files (the cast queues first). */
const LOAD_DELAY = 2;
/** How fast people turn (rad/s). */
const TURN_RATE = 3.2;

interface Person {
  kind: SpotKind | "walk";
  x: number;
  y: number;
  z: number;
  yaw: number;
  baseYaw: number;
  body: number;
  /** Row in the looks texture. */
  look: number;
  idle: number;
  react: number;
  channel: number;
  zone: number;
  seed: number;
  reacting: boolean;
  since: number;
  path: WalkPath | null;
  s: number;
  dir: number;
  /** Free roam: one of the city's folks you can talk to (RenderFrame3D.roam.folks), by id. */
  folk?: number;
}

interface Built {
  files: CrowdFiles;
  full: boolean;
  skeletons: CrowdSkeleton[];
  clips: Map<string, CrowdClip>;
  poses: CrowdPoses;
  materials: CrowdMaterials;
  near: CrowdBatch | null;
  far: CrowdBatch;
  looks: ReturnType<typeof lookTexture>;
  due: Float32Array;
  /** Per block, the nearest user's camera distance this frame (Infinity: unused). */
  need: Float32Array;
}

/** Someone placed by hand (the lab): a body, a look in its pool, a spot, a way to face, a channel. */
export interface ManualPerson {
  body: number;
  look: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  channel: number;
}

export interface CrowdStats {
  near: number;
  far: number;
  /** CPU time of the last update, ms. */
  ms: number;
  /** Draw calls the crowd makes this frame. */
  calls: number;
  /** Pose blocks refreshed this frame. */
  blocks: number;
}

const _frustum = new Frustum();
const _pv = new Matrix4();
const _sphere = new Sphere(new Vector3(), 64);
const _walk = { x: 0, z: 0, yaw: 0 };

const angleTo = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class CrowdSystem {
  readonly root = new Group();
  readonly stats: CrowdStats = { near: 0, far: 0, ms: 0, calls: 0, blocks: 0 };
  reducedMotion = false;
  private tier: QualityTier = "medium";
  private built: Built | null = null;
  private loading: Promise<void> | null = null;
  private people: Person[] = [];
  private manual: ManualPerson[] | null = null;
  /** Free roam's folks to draw among the crowd (civilians only; allies have their own bodies), once seen. */
  private folks: { id: number; body: number; x: number; y: number; z: number; yaw: number }[] | null = null;
  /** Clip measurements still to make, a couple per frame. */
  private warm: { body: number; clip: CrowdClip }[] = [];
  private clock = 0;
  private disposed = false;
  private order: number[] = [];
  private dist = new Float32Array(0);
  private readonly nearList: number[] = [];
  private readonly farList: number[] = [];
  /** For measuring a clip on a body (its floor, its stride). */
  private readonly measure = newSample();
  private readonly samplePool: ClipSample[] = [];
  private readonly sampledAt = new Float32Array(CHANNELS.length).fill(-1);
  private readonly debug = typeof location !== "undefined" && /[?&]debug=1\b/.test(location.search);
  /** `?crowd=0`: the night without its people (to compare, on the same build). */
  private readonly off = typeof location !== "undefined" && /[?&]crowd=0\b/.test(location.search);

  constructor(
    private readonly city: City,
    private readonly shared: SharedUniforms,
  ) {
    this.root.name = "wgp-crowd";
  }

  private get spec(): CrowdTier {
    return CROWD_TIERS[this.tier];
  }

  /** The tier's caps with no full bodies (the low and medium tiers' files have none). */
  private get lightOnly(): CrowdTier {
    return { ...this.spec, nearMax: 0 };
  }

  /** Which files a tier draws: full bodies or not, and which bodies. */
  private filesKey(t: CrowdTier = this.spec): string {
    return `${t.near}:${(t.bodies ?? CIVILIANS).join()}`;
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    const before = this.filesKey();
    this.tier = tier;
    if (this.filesKey() !== before) {
      // Another set of files: drop these and load the tier's (on the next frames).
      this.teardown();
      this.loading = null;
    } else this.plan();
  }

  /** Start fetching (once per set of files). */
  private load(): void {
    if (this.loading || this.off) return;
    const key = this.filesKey();
    const full = this.spec.near;
    this.loading = loadCrowd(full, this.spec.bodies).then(
      (files) => {
        if (this.disposed || !files || this.filesKey() !== key || this.built) return;
        this.build(files, full);
      },
      () => {
        // No crowd: the city carries on without it.
      },
    );
  }

  private build(files: CrowdFiles, full: boolean): void {
    const k = UNITS_PER_METRE;
    const skeletons = files.assets.map((a) => new CrowdSkeleton(a.bones, k, files.clips));
    const clips = crowdClips(files.clips);
    const poses = new CrowdPoses(files.assets.length, CHANNELS.length);
    const looks = lookTexture(lookRows(files.metas, this.city.seed));
    const materials = new CrowdMaterials(this.shared, files.assets[0], k, poses, looks);
    const parts = (lod: "hi" | "lo") => files.assets.map((asset, v) => ({ asset, geometry: lod === "hi" ? (asset.hi ?? asset.lo) : asset.lo, skeleton: skeletons[v] }));
    const spec = this.spec;
    const near = full ? new CrowdBatch(parts("hi"), k, materials, Math.max(1, CROWD_TIERS.high.nearMax), "crowd-near") : null;
    const far = new CrowdBatch(parts("lo"), k, materials, Math.max(CROWD_TIERS.high.max, spec.max), "crowd-far");
    const blocks = files.assets.length * CHANNELS.length;
    this.built = { files, full, skeletons, clips, poses, materials, near, far, looks, due: new Float32Array(blocks), need: new Float32Array(blocks) };
    // Each clip measured on each body (its floor, a walk's stride) a couple a frame from now
    // on, so a whole crowd switching to a cheer at once doesn't measure them all in one frame.
    this.warm = skeletons.flatMap((_, body) => [...clips.values()].map((clip) => ({ body, clip })));
    if (near) this.root.add(near.group);
    this.root.add(far.group);
    this.plan();
  }

  /** Whether the files are in and the people placed. */
  get ready(): boolean {
    return this.built !== null;
  }

  /** How many civilian bodies loaded, and which of them hold a phone. */
  get bodies(): { phone: boolean }[] {
    return this.built?.files.metas.map((m) => ({ phone: !!m.phone })) ?? [];
  }

  /** Whether a manual lineup stands in for the night's people. */
  get manualSet(): boolean {
    return this.manual !== null;
  }

  /** Fetch the files now instead of after the scene's first moments (the lab). */
  preload(): void {
    this.load();
  }

  /**
   * Stand these people instead of the night's (the lab's lineup), each on one channel, or
   * null to go back to the night's plan.
   */
  setManual(list: ManualPerson[] | null): void {
    this.manual = list;
    this.plan();
  }

  /** Place the night's people for this tier (or the manual lineup). */
  private plan(): void {
    const b = this.built;
    if (!b) return;
    if (this.manual) {
      this.people = this.manual.map((m, i) => ({ kind: "roof", x: m.x, y: m.y, z: m.z, yaw: m.yaw, baseYaw: m.yaw, body: m.body % b.skeletons.length, look: (m.body % b.skeletons.length) * LOOKS_PER_BODY + (m.look % LOOKS_PER_BODY), idle: m.channel, react: m.channel, channel: m.channel, zone: -1, seed: i, reacting: false, since: -10, path: null, s: 0, dir: 1 }));
      this.dist = new Float32Array(this.people.length);
      this.order = this.people.map((_, i) => i);
      return;
    }
    const bodies = b.files.metas.map((m) => ({ phone: !!m.phone, looks: LOOKS_PER_BODY }));
    const plan = planCrowd(this.city, bodies, this.spec.density, this.city.seed);
    const people: Person[] = [];
    for (const s of plan.spots) {
      people.push({ kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: s.yaw, baseYaw: s.yaw, body: s.body, look: s.body * LOOKS_PER_BODY + s.look, idle: s.idle, react: s.react, channel: s.idle, zone: s.zone, seed: s.seed, reacting: false, since: -10, path: null, s: 0, dir: 1 });
    }
    for (const w of plan.walkers) {
      const path = plan.paths[w.path];
      walkAt(path, w.s, _walk);
      people.push({ kind: "walk", x: _walk.x, y: 0, z: _walk.z, yaw: _walk.yaw, baseYaw: _walk.yaw, body: w.body, look: w.body * LOOKS_PER_BODY + w.look, idle: w.channel, react: w.react, channel: w.channel, zone: -1, seed: w.seed, reacting: false, since: -10, path, s: w.s, dir: w.dir });
    }
    // Free roam's folks, in their civilian bodies (mapped onto the bodies this tier loads).
    const loaded = this.spec.bodies ?? CIVILIANS;
    for (const f of this.folks ?? []) {
      const at = loaded.indexOf(CIVILIANS[f.body % CIVILIANS.length]);
      const body = (at >= 0 ? at : f.body) % b.skeletons.length;
      const idle = f.id % 3 === 0 && bodies[body]?.phone ? CHANNEL.phone : CHANNEL[f.id % 2 ? "stand-a" : "stand-b"];
      people.push({ kind: "roof", x: f.x, y: f.y, z: f.z, yaw: f.yaw, baseYaw: f.yaw, body, look: body * LOOKS_PER_BODY + (f.id % LOOKS_PER_BODY), idle, react: CHANNEL.wave, channel: idle, zone: -1, seed: 977 + f.id * 31, reacting: false, since: -10, path: null, s: 0, dir: 1, folk: f.id });
    }
    this.people = people;
    this.dist = new Float32Array(people.length);
    this.order = people.map((_, i) => i);
  }

  /** The channel a person plays now, and where they look (or null: their own way). */
  private behave(p: Person, frame: RenderFrame3D | null): { channel: number; face: { x: number; z: number } | null } {
    const hero = frame?.hero.pos ?? null;
    // A folk mid-line talks to you, facing you.
    if (p.folk !== undefined && hero && frame?.roam?.folks[p.folk]?.talking) return { channel: CHANNEL.talk, face: hero };
    const atStop = !!frame && p.zone >= 0 && frame.stop === p.zone;
    const cheerFor = (p.seed >>> 3) % 4;
    if (atStop && p.kind === "fight") {
      const zone = this.city.zones[p.zone];
      if (frame!.mode === "won") {
        const id = this.reducedMotion ? (cheerFor % 2 ? "clap" : "wave") : ["cheer-a", "cheer-b", "dance", "wave"][cheerFor];
        return { channel: CHANNEL[id], face: hero };
      }
      if (frame!.mode === "fight") return { channel: p.react, face: { x: zone.center.x, z: zone.center.z } };
    }
    if (atStop && p.kind === "errand" && frame!.mode === "errand") {
      const ally = this.city.zones[p.zone].allyAt;
      return { channel: p.react, face: ally && hero ? { x: (ally.x + hero.x) / 2, z: (ally.z + hero.z) / 2 } : null };
    }
    if (hero && p.reacting) {
      let ch = p.react;
      if (this.reducedMotion && (ch === CHANNEL["cheer-a"] || ch === CHANNEL["cheer-b"])) ch = CHANNEL.wave;
      return { channel: ch, face: hero };
    }
    return { channel: p.idle, face: null };
  }

  update(frame: RenderFrame3D | null, camera: PerspectiveCamera, dt: number, time: number): void {
    const t0 = performance.now();
    this.clock += dt;
    // Free roam: its folks join the crowd the first time an outing's frame says who they are.
    if (frame?.roam && !this.folks) {
      this.folks = frame.roam.folks.filter((f) => !f.cast).map((f) => ({ id: f.id, body: f.body, x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw }));
      this.plan();
    }
    if (!this.built) {
      if (this.clock > LOAD_DELAY && !this.loading) this.load();
      this.stats.near = this.stats.far = this.stats.calls = this.stats.blocks = 0;
      return;
    }
    const b = this.built;
    const spec = this.spec;
    for (let k = 0; k < 2 && this.warm.length; k++) {
      const { body, clip } = this.warm.pop()!;
      b.skeletons[body].floor(clip, this.measure);
      if (/^walk/.test(clip.name)) b.skeletons[body].stride(clip, this.measure);
    }
    const cam = camera.position;
    const hero = frame?.hero.pos ?? null;
    const rival = frame && frame.mode === "fight" ? (frame.villains.find((v) => !v.copy) ?? frame.villains[0] ?? null) : null;
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const people = this.people;
    const dist = this.dist;
    let n = 0;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const dHero = hero ? Math.hypot(hero.x - p.x, hero.y - (p.y + 50), hero.z - p.z) : Infinity;
      // Reacting to the hero going by: on for a while once he's close, off once he's gone.
      const want = wantsReaction(p.reacting, dHero);
      if (want !== p.reacting && (want || time - p.since > REACT_HOLD + (p.seed % 7) * 0.2)) {
        p.reacting = want;
        p.since = time;
      }
      const { channel, face } = this.behave(p, frame);
      p.channel = channel;
      if (p.path && CHANNELS[channel].kind === "walk") {
        // Walking round the block at the stride of this body's walk.
        const clip = b.clips.get(CHANNELS[channel].clip)!;
        const speed = b.skeletons[p.body].stride(clip, this.measure);
        p.s += p.dir * speed * dt;
        walkAt(p.path, p.s, _walk);
        p.x = _walk.x;
        p.z = _walk.z;
        p.baseYaw = _walk.yaw + (p.dir < 0 ? Math.PI : 0);
      }
      const target = face ? Math.atan2(face.x - p.x, face.z - p.z) : p.baseYaw;
      const d = angleTo(p.yaw, target);
      const step = TURN_RATE * dt;
      p.yaw += Math.abs(d) < step ? d : Math.sign(d) * step;
      // Drawn? In range and on screen.
      const dc = Math.hypot(cam.x - p.x, cam.y - (p.y + 45), cam.z - p.z);
      if (dc > spec.farDist) continue;
      _sphere.center.set(p.x, p.y + 45, p.z);
      if (!_frustum.intersectsSphere(_sphere)) continue;
      dist[i] = dc;
      this.order[n++] = i;
    }
    const order = this.order;
    order.length = n;
    order.sort((a, c) => dist[a] - dist[c]);
    splitBands(order, dist, b.near ? spec : this.lightOnly, this.nearList, this.farList);

    // Pose blocks: the nearest user of each sets its refresh rate.
    b.need.fill(Infinity);
    const C = CHANNELS.length;
    for (const list of [this.nearList, this.farList]) for (const i of list) {
      const p = people[i];
      const blk = p.body * C + p.channel;
      b.need[blk] = Math.min(b.need[blk], dist[i]);
    }
    let refreshed = 0;
    for (let blk = 0; blk < b.need.length; blk++) {
      const dmin = b.need[blk];
      if (dmin === Infinity || time < b.due[blk]) continue;
      const body = Math.floor(blk / C);
      const ch = blk % C;
      b.poses.write(b.skeletons[body], this.sampleChannel(ch, time), body, ch);
      b.due[blk] = time + animInterval(dmin);
      refreshed++;
    }
    b.poses.commit();

    const place = (batch: CrowdBatch, list: number[]) => {
      batch.begin();
      for (const i of list) {
        const p = people[i];
        const ch = CHANNELS[p.channel];
        const floor = b.skeletons[p.body].floor(b.clips.get(ch.clip)!, this.measure);
        let fade = distanceFade(dist[i], spec.farDist);
        if (hero) {
          // A folk you can talk to stays solid beside you (only right on top of them do they fade).
          const near = p.folk !== undefined ? heroFade(Math.hypot(hero.x - p.x, hero.z - p.z) * 2.2, hero.y - p.y) : heroFade(Math.hypot(hero.x - p.x, hero.z - p.z), hero.y - p.y);
          fade = Math.max(fade, near, lineFade(p.x, p.y + 50, p.z, cam.x, cam.y, cam.z, hero.x, hero.y, hero.z));
          if (rival) fade = Math.max(fade, lineFade(p.x, p.y + 50, p.z, cam.x, cam.y, cam.z, rival.pos.x, rival.pos.y, rival.pos.z));
        }
        batch.add(p.x, p.y - floor, p.z, p.yaw, p.body * C + p.channel, p.body, p.look, fade, fogFor(dist[i]));
      }
      return batch.commit();
    };
    const calls = (b.near ? place(b.near, this.nearList) : 0) + place(b.far, this.farList);

    const s = this.stats;
    s.near = this.nearList.length;
    s.far = this.farList.length;
    s.calls = calls;
    s.blocks = refreshed;
    s.ms = performance.now() - t0;
    if (this.debug) (window as Window & { __wgpCrowd?: CrowdStats }).__wgpCrowd = s;
  }

  /** A channel's pose at `time` (sampled once per frame, shared by every body on it). */
  private sampleChannel(ch: number, time: number): ClipSample {
    const s = this.samplePool[ch] ?? (this.samplePool[ch] = newSample());
    if (this.sampledAt[ch] !== time) {
      const c = CHANNELS[ch];
      const clip = this.built!.clips.get(c.clip)!;
      clip.sample(time + c.phase * clip.duration, s);
      this.sampledAt[ch] = time;
    }
    return s;
  }

  private teardown(): void {
    const b = this.built;
    if (!b) return;
    if (b.near) {
      this.root.remove(b.near.group);
      b.near.dispose();
    }
    this.root.remove(b.far.group);
    b.far.dispose();
    b.materials.dispose();
    b.poses.dispose();
    b.looks.dispose();
    this.built = null;
    this.people = [];
    this.warm = [];
  }

  dispose(): void {
    this.disposed = true;
    this.teardown();
  }
}
