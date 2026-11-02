/**
 * The cast lab's stage outside React: the stage city's meshes, the character system, the
 * synthetic motion script and the turntable camera, advanced once per frame. The bench
 * component only calls its methods, so per-frame work never touches React state.
 */
import type { PerspectiveCamera } from "three";

import { NODE_COLORS } from "@/components/cast";
import { citySolids } from "@/game3d/scene/camera/raycast";
import { CAST_DEFS } from "@/game3d/scene/characters/cast";
import { CharacterSystem } from "@/game3d/scene/characters/characters";
import { buildCityMeshes, type CityMeshes } from "@/game3d/scene/city/city-meshes";
import { createSharedUniforms, type SharedUniforms } from "@/game3d/scene/city/materials";
import type { QualityTier } from "@/game3d/scene/quality";

import { ALLIES, CastScript, labCity, type LabCharacter } from "./script";

export interface StageStats {
  calls: number;
  triangles: number;
  cast: number;
  fps: number;
  physicsMs: number;
}

/** How far the turntable camera stands back: whole moves framed wide, the rest close. */
const WIDE: Record<string, number> = { swing: 600, air: 520, dash: 520, slam: 420, climb: 300 };

export class LabStage {
  readonly uniforms: SharedUniforms;
  readonly meshes: CityMeshes | null = null;
  readonly system: CharacterSystem;
  readonly script = new CastScript();
  turntable = true;
  angle = 0.6;
  private turn = 0;
  private readonly focus = { x: 0, y: 330, z: 0 };
  private readonly frames: number[] = [];
  private readonly costs: number[] = [];
  private statsAt = 0;
  stats: StageStats = { calls: 0, triangles: 0, cast: 0, fps: 0, physicsMs: 0 };

  constructor(ally: LabCharacter | null) {
    const city = labCity(ally && ALLIES.includes(ally) ? ally : null);
    this.uniforms = createSharedUniforms();
    try {
      this.meshes = buildCityMeshes(city, this.uniforms);
    } catch {
      // The stage roof is decoration; the cast still draws without it.
    }
    this.system = new CharacterSystem(city, citySolids(city), this.uniforms);
    this.system.setCast(NODE_COLORS, ["gas-goblin", "sandwich-man", "doc-octochain", "sybil"]);
    this.script.onFlip = () => this.system.flip();
  }

  show(character: LabCharacter, state: string): void {
    this.script.set(character, state);
  }

  setScrub(v: number | null): void {
    this.script.scrub = v;
  }

  /** Spin the turntable, or hold it at `angle`. */
  setView(turntable: boolean, angle: number): void {
    this.turntable = turntable;
    this.angle = angle;
  }

  /** Advance one display frame; returns fresh stats about twice a second, else null. */
  frame(camera: PerspectiveCamera, size: { width: number; height: number }, dpr: number, delta: number, time: number, info: { calls: number; triangles: number }): StageStats | null {
    const dt = Math.min(delta, 0.1);
    const s = this.script;
    s.step(dt);
    const f = s.focus({ x: 0, y: 0, z: 0 });
    const fc = this.focus;
    const k = 1 - Math.exp(-dt * 6);
    fc.x += (f.x - fc.x) * k;
    fc.y += (f.y - fc.y) * k;
    fc.z += (f.z - fc.z) * k;
    if (this.turntable) this.turn += dt * 0.45;
    const a = this.turntable ? this.turn : this.angle;
    const c = s.character;
    const far = c === "hero" ? (WIDE[s.state] ?? CAST_DEFS[c].height * 2.4) : c === "doc-octochain" || c === "sybil" ? 480 : CAST_DEFS[c].height * 2.6;
    camera.position.set(fc.x + Math.sin(a) * far, fc.y + far * 0.18 + 12, fc.z + Math.cos(a) * far);
    camera.lookAt(fc.x, fc.y, fc.z);
    camera.updateMatrixWorld();
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDpr.value = dpr;
    u.uPxScale.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.height);
    this.meshes?.updateLod(camera.position.x, camera.position.z);
    const t0 = performance.now();
    this.system.update(s.frame, camera, size, dt, time);
    this.costs.push(performance.now() - t0);
    this.frames.push(delta);
    if (time - this.statsAt < 0.5) return null;
    this.statsAt = time;
    const median = (xs: number[]) => (xs.length ? [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] : 0);
    const fd = median(this.frames);
    this.stats = { calls: info.calls, triangles: info.triangles, cast: this.system.triangles(), fps: fd > 0 ? 1 / fd : 0, physicsMs: median(this.costs) };
    this.frames.length = 0;
    this.costs.length = 0;
    return this.stats;
  }

  setTier(t: QualityTier): void {
    this.system.setTier(t);
  }

  setDebug(on: boolean): void {
    this.system.setDebug(on);
  }

  flip(): void {
    this.system.flip();
  }

  miss(): void {
    this.system.fizzle();
  }

  dispose(): void {
    this.system.dispose();
    this.meshes?.dispose();
  }
}
