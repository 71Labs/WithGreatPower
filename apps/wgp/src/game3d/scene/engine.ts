/**
 * The 3D scene as one plain object: city meshes, sky, the cast (rigged 3D characters and
 * the hero's web), bursts, hazards, pickups and the chase camera, updated once per frame from a
 * `RenderFrame3D`. No React here; Scene.tsx creates one per city and calls `update` from
 * `useFrame`, so per-frame data never goes through React state.
 */
import { Group, PerspectiveCamera } from "three";

import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { SuitColors } from "@/components/cast";
import { heldStick } from "@/game3d/input/latch";

import { ChaseCamera, createChaseInput, type ChasePose, type Raycast } from "./camera/chase";
import { CameraDirector, type DirectorInput, type SceneCue } from "./camera/director";
import { citySolids, createCityRaycast, type CitySolids } from "./camera/raycast";
import { SpeedLines } from "./camera/speed-lines";
import { buildCityMeshes, type CityMeshes } from "./city/city-meshes";
import { createSharedUniforms, type SharedUniforms } from "./city/materials";
import { setOcclusion } from "./city/occlusion";
import { Bursts, type BurstOptions } from "./effects";
import { Hazards } from "./hazards";
import { Pickups } from "./pickups";
import type { QualityPreset } from "./quality";
import { buildSky, type Sky } from "./sky";
import { CharacterSystem } from "./characters/characters";
import type { WebLine } from "./web";

/** Every cast member a night can show (their bodies are built up front). */
export const ALL_CAST: CastId[] = ["gas-goblin", "sandwich-man", "doc-octochain", "sybil", "aunt-mainnet", "uncle-gen", "mary-jpeg", "bearson", "gwei"];

export interface ViewSize {
  width: number;
  height: number;
}

export class SceneEngine {
  readonly root = new Group();
  readonly uniforms: SharedUniforms;
  readonly solids: CitySolids;
  readonly chase: ChaseCamera;
  /** Beats over the chase: the countdown's establishing shot, an errand's two-shot, the end of the night. */
  readonly director: CameraDirector;
  readonly city: CityMeshes;
  readonly sky: Sky;
  readonly characters: CharacterSystem;
  readonly bursts: Bursts;
  readonly web: WebLine;
  readonly hazards: Hazards;
  /** Bits and boost rings, when the frame has v1.3 pickups. */
  readonly pickups: Pickups;
  readonly speedLines: SpeedLines;
  /** Camera far plane, from the city's size. */
  readonly far: number;
  reducedMotion = false;
  private readonly input = createChaseInput();
  private readonly beat: DirectorInput = { cue: null, mode: "travel", hero: { x: 0, y: 0, z: 0 }, goal: null, ally: null, aspect: 1, reducedMotion: false, input: false };
  /** A key or a press the page passed on (skips the countdown's shot). */
  private skipped = false;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbiting = false;
  private lastFov = 0;
  private idleAngle = 0;
  private speedLinesTier = true;
  /** The cast's per-frame cost (animators, physics, posing), ms, over the last 60 frames. */
  private readonly castCost = new Float32Array(60);
  private castAt = 0;

  constructor(
    private readonly cityData: City,
    raycast: Raycast | null = null,
  ) {
    this.root.name = "wgp-scene";
    this.uniforms = createSharedUniforms();
    this.solids = citySolids(cityData);
    const cast = raycast ?? createCityRaycast(cityData);
    this.chase = new ChaseCamera(cast);
    this.director = new CameraDirector(cast);
    this.city = buildCityMeshes(cityData, this.uniforms);
    this.far = this.city.horizon * 2.4;
    this.sky = buildSky(
      { x: (cityData.bounds.x0 + cityData.bounds.x1) / 2, z: (cityData.bounds.z0 + cityData.bounds.z1) / 2 },
      this.city.horizon,
      this.far,
    );
    this.characters = new CharacterSystem(cityData, this.solids, this.uniforms);
    this.bursts = new Bursts(this.uniforms);
    this.web = this.characters.web;
    this.hazards = new Hazards();
    this.pickups = new Pickups(cityData, this.uniforms);
    this.speedLines = new SpeedLines();
    this.root.add(this.sky.dome, this.sky.skyline, this.city.root, this.characters.root, this.hazards.root, this.pickups.root, this.bursts.mesh, this.speedLines.mesh);
  }

  /** Build the hero (in the save's suit), the night's villains and the allies. */
  setCast(heroColors: SuitColors, cast: CastId[] = ALL_CAST): void {
    this.characters.setCast(heroColors, cast);
  }

  setQuality(preset: QualityPreset): void {
    this.city.setPropOutlines(preset.propOutlines);
    this.characters.setTier(preset.tier);
    this.sky.setStars(preset.stars);
    this.sky.skyline.visible = preset.skyline;
    this.city.setDetail(preset.detail);
    this.city.traffic.setCount(preset.cars);
    this.uniforms.uHalftone.value = preset.halftone ? 1 : 0;
    this.speedLinesTier = preset.speedLines;
    this.speedLines.enabled = preset.speedLines && !this.reducedMotion;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.bursts.reducedMotion = on;
    this.pickups.reducedMotion = on;
    this.characters.setReducedMotion(on);
    this.speedLines.enabled = this.speedLinesTier && !on;
  }

  /** Manual orbit input (radians this frame) and whether a pointer is holding the camera. */
  orbit(dYaw: number, dPitch: number, holding: boolean): void {
    this.orbitYaw += dYaw;
    this.orbitPitch += dPitch;
    this.orbiting = holding;
  }

  burst(word: string, at: Vec3, opts?: BurstOptions): void {
    this.bursts.burst(word, at, opts);
  }

  /** Somersault the hero (a perfect release). */
  flip(): void {
    this.characters.flip();
  }

  /** A web that found nothing: the strand flies out and drops slack. */
  fizzle(): void {
    this.characters.fizzle();
  }

  /** Cut the camera to its wanted pose on the next frame (and drop the last shot's speed lines). */
  cut(): void {
    this.chase.reset();
    this.director.cut();
    this.speedLines.reset();
  }

  /** The player pressed something: a camera beat gives way (the countdown's shot is skipped). */
  skip(): void {
    this.skipped = true;
  }

  update(frame: RenderFrame3D | null, camera: PerspectiveCamera, size: ViewSize, dpr: number, dt: number, time: number, cue: SceneCue | null = null): ChasePose | null {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDpr.value = dpr;
    if (camera.far !== this.far) {
      camera.near = 4;
      camera.far = this.far;
      camera.updateProjectionMatrix();
    }

    let pose: ChasePose | null = null;
    if (frame) {
      const i = this.input;
      i.hero = frame.hero.pos;
      i.vel = frame.hero.vel;
      i.anchor = frame.hero.anchor;
      i.facing = frame.hero.facing ?? null;
      i.steer = heldStick;
      const zone = this.cityData.zones[frame.stop];
      const rival = frame.mode === "fight" ? (frame.villains.find((v) => !v.copy) ?? frame.villains[0]) : undefined;
      i.rival = rival && zone ? rival.pos : null;
      i.rivalVel = rival && zone ? (rival.vel ?? null) : null;
      i.arena = rival && zone ? zone.bounds : null;
      i.orbitYaw = this.orbitYaw;
      i.orbitPitch = this.orbitPitch;
      i.orbiting = this.orbiting;
      i.aspect = size.width / Math.max(1, size.height);
      i.reducedMotion = this.reducedMotion;
      // Travel: the next stop, and whether the hero stands or runs on something.
      i.goal = frame.mode === "travel" ? (frame.route?.[0] ?? null) : null;
      i.grounded = frame.hero.grounded;
      // A fight's encounter, its end and a knockout keep the plain chase: the fight camera's to frame.
      i.framing = frame.mode !== "intro" && frame.mode !== "won" && frame.mode !== "ko";
      const looked = this.orbitYaw !== 0 || this.orbitPitch !== 0 || this.orbiting || heldStick.x * heldStick.x + heldStick.y * heldStick.y > 0.04;
      this.orbitYaw = 0;
      this.orbitPitch = 0;
      pose = this.chase.update(i, dt);
      const b = this.beat;
      b.cue = cue;
      b.mode = frame.mode;
      b.hero = frame.hero.pos;
      // On an errand the route's first stop is the ally's: the way on is the next one.
      b.goal = (frame.mode === "errand" ? frame.route?.[1] : frame.route?.[0]) ?? null;
      b.ally = frame.mode === "errand" && zone?.kind === "errand" ? (zone.allyAt ?? zone.center) : null;
      b.aspect = i.aspect;
      b.reducedMotion = this.reducedMotion;
      b.input = looked || this.skipped;
      this.skipped = false;
      pose = this.director.update(pose, b, dt);
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
      if (Math.abs(pose.fov - this.lastFov) > 0.01) {
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
        this.lastFov = pose.fov;
      }
    } else {
      // No run yet: a slow turn around the start roof.
      this.idleAngle += dt * 0.08;
      const s = this.cityData.start;
      camera.position.set(s.x + Math.sin(this.idleAngle) * 900, s.y + 380, s.z + Math.cos(this.idleAngle) * 900);
      camera.lookAt(s.x, s.y, s.z);
    }
    camera.updateMatrixWorld();
    u.uPxScale.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.height);
    this.city.updateLod(camera.position.x, camera.position.z);
    // Fade what stands between the camera and the hero (and the rival in a fight); clear the
    // deck's traffic while a fight is on the bridge.
    setOcclusion(u, camera.position, frame ? frame.hero.pos : null, frame && frame.mode === "fight" ? this.input.rival : null);
    this.city.traffic.setDeckClear(!!frame && frame.mode !== "travel" && this.onDeck(this.cityData.zones[frame.stop]?.center));
    this.speedLines.update(frame ? frame.hero.vel : null, camera, size.width * dpr, size.height * dpr, dt, time);

    this.sky.update(camera, time, dpr, size.height * dpr);
    if (frame) {
      const t0 = performance.now();
      this.characters.update(frame, camera, size, dt, time);
      this.castCost[this.castAt++ % this.castCost.length] = performance.now() - t0;
      this.hazards.update(frame);
      this.pickups.update(frame, time);
      // The sparkle shows once the web's shot has reached the anchor.
      this.bursts.setAnchor(this.characters.stuck);
    }
    this.bursts.update(dt, time);
    return pose;
  }

  /** The cast's mean and worst per-frame cost over the last 60 frames, ms. */
  castMs(): { mean: number; max: number } {
    const n = Math.min(this.castAt, this.castCost.length);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
      sum += this.castCost[i];
      max = Math.max(max, this.castCost[i]);
    }
    return { mean: n ? sum / n : 0, max };
  }

  /** Whether a point is over the bridge deck. */
  private onDeck(p: Vec3 | undefined): boolean {
    const d = this.cityData.bridge?.deck;
    return !!d && !!p && p.x >= d.x0 && p.x <= d.x1 && p.z >= d.z0 && p.z <= d.z1;
  }

  dispose(): void {
    this.speedLines.dispose();
    this.city.dispose();
    this.sky.dispose();
    this.characters.dispose();
    this.bursts.dispose();
    this.hazards.dispose();
    this.pickups.dispose();
  }
}
