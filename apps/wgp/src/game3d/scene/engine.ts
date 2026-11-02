/**
 * The 3D scene as one plain object: city meshes, sky, cards, web, bursts, hazards and the
 * chase camera, updated once per frame from a `RenderFrame3D`. No React here; Scene.tsx
 * creates one per city and calls `update` from `useFrame`, so per-frame data never goes
 * through React state.
 */
import { Group, PerspectiveCamera, Vector3 } from "three";

import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { SuitColors } from "@/components/cast";

import { ChaseCamera, createChaseInput, type ChasePose, type Raycast } from "./camera/chase";
import { citySolids, createCityRaycast, type CitySolids } from "./camera/raycast";
import { buildCardArt } from "./cards/card-art";
import { CardSystem } from "./cards/cards";
import { buildCityMeshes, type CityMeshes } from "./city/city-meshes";
import { createSharedUniforms, type SharedUniforms } from "./city/materials";
import { Bursts, type BurstOptions } from "./effects";
import { Hazards } from "./hazards";
import type { QualityPreset } from "./quality";
import { buildSky, type Sky } from "./sky";
import { WebLine } from "./web";

/** Every cast member a night can show, for the card atlas. */
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
  readonly city: CityMeshes;
  readonly sky: Sky;
  readonly cards: CardSystem;
  readonly bursts: Bursts;
  readonly web: WebLine;
  readonly hazards: Hazards;
  /** Camera far plane, from the city's size. */
  readonly far: number;
  reducedMotion = false;
  private readonly input = createChaseInput();
  private readonly hand = new Vector3();
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbiting = false;
  private lastFov = 0;
  private idleAngle = 0;
  private cardsLoading: Promise<void> | null = null;

  constructor(
    private readonly cityData: City,
    raycast: Raycast | null = null,
  ) {
    this.root.name = "wgp-scene";
    this.uniforms = createSharedUniforms();
    this.solids = citySolids(cityData);
    this.chase = new ChaseCamera(raycast ?? createCityRaycast(cityData));
    this.city = buildCityMeshes(cityData, this.uniforms);
    this.far = this.city.horizon * 2.4;
    this.sky = buildSky(
      { x: (cityData.bounds.x0 + cityData.bounds.x1) / 2, z: (cityData.bounds.z0 + cityData.bounds.z1) / 2 },
      this.city.horizon,
      this.far,
    );
    this.cards = new CardSystem(cityData, this.solids);
    this.bursts = new Bursts(this.uniforms);
    this.web = new WebLine();
    this.hazards = new Hazards();
    this.root.add(this.sky.dome, this.sky.skyline, this.city.root, this.cards.root, this.hazards.root, this.web.mesh, this.bursts.mesh);
  }

  /** Build the sticker atlas and card geometry (async: the 2D stickers render from SVG). */
  loadCards(heroColors: SuitColors, cast: CastId[] = ALL_CAST): Promise<void> {
    this.cardsLoading ??= buildCardArt(heroColors, cast).then((art) => this.cards.setArt(art));
    return this.cardsLoading;
  }

  setQuality(preset: QualityPreset): void {
    this.city.setPropOutlines(preset.propOutlines);
    this.cards.setExtruded(preset.extrudedCards);
    this.sky.setStars(preset.stars);
    this.sky.skyline.visible = preset.skyline;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.bursts.reducedMotion = on;
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

  flip(): void {
    this.cards.flip();
  }

  /** Cut the camera to its wanted pose on the next frame. */
  cut(): void {
    this.chase.reset();
  }

  update(frame: RenderFrame3D | null, camera: PerspectiveCamera, size: ViewSize, dpr: number, dt: number, time: number): ChasePose | null {
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
      const zone = this.cityData.zones[frame.stop];
      const rival = frame.mode === "fight" ? (frame.villains.find((v) => !v.copy) ?? frame.villains[0]) : undefined;
      i.rival = rival && zone ? rival.pos : null;
      i.arena = rival && zone ? zone.bounds : null;
      i.orbitYaw = this.orbitYaw;
      i.orbitPitch = this.orbitPitch;
      i.orbiting = this.orbiting;
      i.aspect = size.width / Math.max(1, size.height);
      i.reducedMotion = this.reducedMotion;
      this.orbitYaw = 0;
      this.orbitPitch = 0;
      pose = this.chase.update(i, dt);
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

    this.sky.update(camera, time, dpr, size.height * dpr);
    if (frame) {
      this.cards.update(frame, camera.position, dt, time);
      this.hazards.update(frame);
      const anchor = frame.hero.anchor;
      this.web.set(anchor && this.cards.ready ? this.cards.handPoint(frame, this.hand) : null, anchor, size.width, size.height);
      this.bursts.setAnchor(anchor);
    }
    this.bursts.update(dt, time);
    return pose;
  }

  dispose(): void {
    this.city.dispose();
    this.sky.dispose();
    this.cards.dispose();
    this.bursts.dispose();
    this.web.dispose();
    this.hazards.dispose();
  }
}
