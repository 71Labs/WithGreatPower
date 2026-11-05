import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Group, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { citySolids, footingBelow, type CitySolids, type Footing } from "../../camera/raycast";
import { assetFromScene, clipsFromGltf, heroScale, HERO_ANIMS, HERO_MODEL, type HeroAsset, type HeroClips } from "../hero-asset";
import { rigFromAsset } from "../hero-rig";
import { HeroAnimator } from "./hero";
import type { AnimContext } from "./types";

/**
 * The hero's feet where the sim puts him (the QA sweep's leg glitches, launch/brand/hero/
 * qa-anomalies.mjs): set down somewhere else at once (beside an errand ally), standing on a
 * roof's edge with his sphere's centre out over the street, and a swing that skims a roof for a
 * tick. Measured on the real body and clips.
 */

const HEIGHT = 88;
const ROOF = 300;
const R = 26;
const DT = 1 / 60;

async function parse(url: string) {
  const file = readFileSync(fileURLToPath(new URL(`../../../../../public${url}`, import.meta.url)));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
}

const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** One building, a roof at ROOF over x, z in [−200, 200]: the street beyond. */
function oneRoof(): CitySolids {
  const building = { id: 0, x0: -200, z0: -200, x1: 200, z1: 200, h: ROOF, top: null, district: "sector-7", tone: 0, accent: false, seed: 1 };
  return citySolids({ buildings: [building], props: [], bridge: null, bounds: { x0: -1000, z0: -1000, x1: 1000, z1: 1000 } } as unknown as City);
}

function frame(pos: Vec3, opts: Partial<RenderFrame3D["hero"]> = {}): RenderFrame3D {
  return {
    tick: 0,
    alpha: 1,
    hero: { pos, vel: v(), anchor: null, grounded: true, hp: 1, maxHp: 1, fluid: 0, hurtFlash: 0, shield: false, facing: v(0, 0, 1), action: "idle", actionTicks: 1, ...opts },
    villains: [],
    hazards: [],
    stop: 0,
    mode: "travel",
    timeScale: 1,
  };
}

describe("the hero's feet where the sim puts him", () => {
  let asset: HeroAsset;
  let clips: HeroClips;
  const solids = oneRoof();
  const ground = (x: number, z: number, y: number) => (x >= -200 && x <= 200 && z >= -200 && z <= 200 && ROOF <= y + 1 ? ROOF : 0);
  const ctx: AnimContext = {
    ground,
    footing: (x: number, z: number, y: number, r: number, reach: number, out: Footing) => footingBelow(solids, x, z, y, r, reach, out),
    ray: () => null,
    reducedMotion: false,
    secondary: true,
    hero: v(),
  };

  beforeAll(async () => {
    asset = assetFromScene((await parse(HERO_MODEL.hi)).scene, HERO_MODEL.hi);
    const gltf = await parse(HERO_ANIMS);
    clips = clipsFromGltf(gltf.animations);
    const pelvis = gltf.scene.getObjectByName("pelvis");
    if (pelvis) clips.pelvisRest = [pelvis.position.x, pelvis.position.y, pelvis.position.z];
  });

  function body() {
    const rig = rigFromAsset(asset, HEIGHT);
    const group = new Group();
    group.add(rig.bones[0]);
    const anim = new HeroAnimator(rig, group, ctx);
    anim.setClips(clips, heroScale(asset, HEIGHT));
    const ankles = () => {
      group.updateMatrixWorld(true);
      return rig.legs.map((l) => new Vector3().setFromMatrixPosition(l.end.matrixWorld));
    };
    return { rig, anim, ankles };
  }

  it("plants both feet under him when he's set down somewhere else (an errand), never a leg left behind", () => {
    const { anim, ankles } = body();
    for (let i = 0; i < 90; i++) anim.update(frame(v(-120, ROOF + R, 0)), DT, ctx);
    // Stood 150 away beside the ally in one tick (under the blend's snap distance).
    for (let i = 0; i < 4; i++) anim.update(frame(v(30, ROOF + R, 0)), DT, ctx);
    for (const a of ankles()) expect(Math.hypot(a.x - 30, a.z)).toBeLessThan(20);
  });

  it("stands on a roof's edge with his centre out over the street, his feet on the roof, never reaching for the street", () => {
    const { rig, anim, ankles } = body();
    // The sphere resting on the edge at x = 200: its centre 18 past it, 19 above the roof.
    const at = v(218, ROOF + Math.sqrt(R * R - 18 * 18), 0);
    for (let i = 0; i < 120; i++) anim.update(frame(at), DT, ctx);
    for (const a of ankles()) {
      expect(a.y).toBeGreaterThan(ROOF + rig.spec.ankle - 3);
      expect(a.y).toBeLessThan(ROOF + rig.spec.ankle + 12);
    }
    expect(anim.centre.y).toBeGreaterThan(ROOF + 20);
  });

  it("keeps a swing that skims a roof for a tick in the air, not dropped into a stance", () => {
    const { anim } = body();
    const swing = (x: number) => frame(v(x, ROOF + 60, 0), { grounded: false, anchor: v(x + 200, ROOF + 400, 0), vel: v(700, -100, 0), action: "swing" });
    let x = -150;
    for (let i = 0; i < 30; i++) anim.update(swing((x += 12)), DT, ctx);
    anim.update(frame(v((x += 12), ROOF + R, 0), { vel: v(650, 0, 0), action: "run", actionTicks: 0 }), DT, ctx);
    expect(anim.base).toBe("air");
    anim.update(swing((x += 12)), DT, ctx);
    expect(anim.base).toBe("swing");
  });
});
