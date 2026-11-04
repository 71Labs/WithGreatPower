/**
 * The crowd lab's stage outside React: the cast lab's stage roof, the eight civilians in a
 * row through the city's crowd system (crowd/crowd.ts, placed by hand), and cast members
 * between them on their own MPFB bodies, standing in their idle, to compare the two side
 * by side. The bench only calls its methods.
 */
import { Group, type PerspectiveCamera } from "three";

import { ClipLayer } from "@/game3d/scene/characters/anim/clip-layer";
import { CAST_ANIMS, castModelUrl, loadCastAsset, type CastBodyId } from "@/game3d/scene/characters/cast-asset";
import { CastModel } from "@/game3d/scene/characters/cast-model";
import { HERO_ANIMS, loadHeroClips, type HeroClips } from "@/game3d/scene/characters/hero-asset";
import { buildCityMeshes, type CityMeshes } from "@/game3d/scene/city/city-meshes";
import { createSharedUniforms, type SharedUniforms } from "@/game3d/scene/city/materials";
import { CHANNEL } from "@/game3d/scene/crowd/clips";
import { CrowdSystem, type ManualPerson } from "@/game3d/scene/crowd/crowd";
import type { QualityTier } from "@/game3d/scene/quality";

import { labCity, ROOF } from "../cast/script";

export type LineupView = "front" | "three-quarter" | "close" | "poses";
export const VIEWS: LineupView[] = ["front", "three-quarter", "close", "poses"];

/** Who stands where, left to right: cast members between the civilians (by body index). */
const ROW: ({ cast: CastBodyId } | { civ: number })[] = [
  { cast: "mary-jpeg" },
  { civ: 0 },
  { civ: 1 },
  { cast: "aunt-mainnet" },
  { civ: 2 },
  { civ: 3 },
  { cast: "uncle-gen" },
  { civ: 4 },
  { civ: 5 },
  { cast: "bearson" },
  { civ: 6 },
  { civ: 7 },
  { cast: "doc-octochain" },
];
/** The row runs along z at this x, facing −x (toward the camera). */
const ROW_X = -200;
const SPACING = 56;
const FACING = -Math.PI / 2;
/** Each civilian's move for the "poses" view. */
const POSES = ["wave", "cheer-a", "photo", "phone", "point", "clap", "look-up", "walk-a"];

export interface LineupStats {
  calls: number;
  triangles: number;
  crowdMs: number;
  fps: number;
}

export class LineupStage {
  readonly uniforms: SharedUniforms;
  readonly meshes: CityMeshes | null = null;
  readonly crowd: CrowdSystem;
  readonly root = new Group();
  view: LineupView = "front";
  private readonly cast: { model: CastModel; layer: ClipLayer; z: number }[] = [];
  private castReady = false;
  private disposed = false;
  private readonly frames: number[] = [];
  private statsAt = 0;
  stats: LineupStats = { calls: 0, triangles: 0, crowdMs: 0, fps: 0 };

  constructor(tier: QualityTier) {
    const city = labCity(null);
    this.uniforms = createSharedUniforms();
    try {
      this.meshes = buildCityMeshes(city, this.uniforms);
    } catch {
      // The roof is decoration.
    }
    this.crowd =new CrowdSystem(city, this.uniforms);
    this.crowd.setTier(tier);
    this.crowd.preload();
    this.root.add(this.crowd.root);
    void this.loadCast(tier);
  }

  private z(i: number): number {
    return (i - (ROW.length - 1) / 2) * SPACING;
  }

  private async loadCast(tier: QualityTier): Promise<void> {
    const ids = ROW.flatMap((r, i) => ("cast" in r ? [{ id: r.cast, z: this.z(i) }] : []));
    const [hero, extra, ...assets] = await Promise.all([loadHeroClips(HERO_ANIMS), loadHeroClips(CAST_ANIMS), ...ids.map((c) => loadCastAsset(castModelUrl(c.id, tier === "low")))]);
    if (this.disposed) return;
    const clips: HeroClips = new Map([...hero, ...extra]);
    clips.pelvisRest = hero.pelvisRest;
    clips.restQ = hero.restQ;
    assets.forEach((asset, i) => {
      const model = new CastModel(asset, this.uniforms, tier === "low" ? ["lo"] : ["hi", "lo"]);
      model.group.rotation.y = FACING;
      const layer = new ClipLayer(model.rig, clips, model.k, ["idle"]);
      this.cast.push({ model, layer, z: ids[i].z });
      this.root.add(model.group);
    });
    this.castReady = true;
  }

  /** The civilians in the row, standing (or each in a move, for "poses"). */
  private lineup(): ManualPerson[] {
    const out: ManualPerson[] = [];
    const bodies = this.crowd.bodies;
    ROW.forEach((r, i) => {
      if (!("civ" in r) || r.civ >= bodies.length) return;
      let move = this.view === "poses" ? POSES[r.civ % POSES.length] : r.civ % 2 ? "stand-b" : "stand-a";
      if ((move === "photo" || move === "phone") && !bodies[r.civ].phone) move = "wave";
      out.push({ body: r.civ, look: (r.civ * 5) % 12, x: ROW_X, y: ROOF, z: this.z(i), yaw: FACING, channel: CHANNEL[move] });
    });
    return out;
  }

  get ready(): boolean {
    return this.crowd.ready && this.castReady;
  }

  setView(v: LineupView): void {
    this.view = v;
    if (this.crowd.ready) this.crowd.setManual(this.lineup());
  }

  frame(camera: PerspectiveCamera, size: { width: number; height: number }, dpr: number, delta: number, time: number, info: { calls: number; triangles: number }): LineupStats | null {
    const dt = Math.min(delta, 0.1);
    // The camera for the view: straight on, from three-quarters, close on the first four, or the moves.
    const midZ = 0;
    const [dist, angle, target, lift, look] =
      this.view === "close" ? [250, 0.22, this.z(1.5), 58, 62] : this.view === "three-quarter" ? [800, 0.6, midZ, 110, 46] : this.view === "poses" ? [760, 0.2, midZ, 90, 52] : [820, 0, midZ, 80, 46];
    camera.position.set(ROW_X - Math.cos(angle) * dist, ROOF + lift, target + Math.sin(angle) * dist);
    camera.lookAt(ROW_X, ROOF + look, target);
    camera.updateMatrixWorld();
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDpr.value = dpr;
    u.uPxScale.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.height);
    this.meshes?.updateLod(camera.position.x, camera.position.z);
    if (this.crowd.ready && !this.crowd.manualSet) this.crowd.setManual(this.lineup());
    this.crowd.update(null, camera, dt, time);
    for (const c of this.cast) {
      c.layer.loops([["idle", time + c.z * 0.01, 1]], 1, c.layer.full, 1);
      c.model.group.position.set(ROW_X, ROOF - c.layer.floor, c.z);
      c.model.group.updateMatrixWorld(true);
    }
    this.frames.push(delta);
    if (time - this.statsAt < 0.5) return null;
    this.statsAt = time;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const fd = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.frames.length = 0;
    this.stats = { calls: info.calls, triangles: info.triangles, crowdMs: this.crowd.stats.ms, fps: fd > 0 ? 1 / fd : 0 };
    return this.stats;
  }

  dispose(): void {
    this.disposed = true;
    this.crowd.dispose();
    for (const c of this.cast) c.model.dispose();
    this.meshes?.dispose();
  }
}
