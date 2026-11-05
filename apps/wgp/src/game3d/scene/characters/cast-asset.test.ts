import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Group, Matrix4, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import { applyPose, newPose } from "./anim/pose";
import { CAST_LOOPS, ClipLayer } from "./anim/clip-layer";
import { CAST_ANIMS, CAST_BODIES, castFromScene, castGeometry, castModelUrl, rigSource, UNITS_PER_METRE, type CastAsset } from "./cast-asset";
import { expandCastDecals } from "./cast-model";
import { RIGHT_CLICKER_ANIMS } from "./files";
import { CAST_MAX_DECALS, CAST_PALETTE } from "./cast-shaders";
import { clipsFromGltf, HERO_ANIMS, type HeroClips } from "./hero-asset";
import { rigFromAsset } from "./hero-rig";
import type { Rig } from "./rig";

async function parse(url: string) {
  const file = readFileSync(fileURLToPath(new URL(`../../../../public${url}`, import.meta.url)));
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, "");
}

/** Both clip files merged, with the hero skeleton's rest pose, as the scene loads them. */
async function clips(): Promise<HeroClips> {
  const out: HeroClips = new Map();
  for (const url of [HERO_ANIMS, CAST_ANIMS, RIGHT_CLICKER_ANIMS]) {
    const gltf = await parse(url);
    for (const [k, v] of clipsFromGltf(gltf.animations)) out.set(k, v);
    if (url === HERO_ANIMS) {
      const p = gltf.scene.getObjectByName("pelvis")!;
      out.pelvisRest = [p.position.x, p.position.y, p.position.z];
      const rest = new Map<string, [number, number, number, number]>();
      gltf.scene.traverse((o) => {
        if (o.name) rest.set(o.name, [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]);
      });
      out.restQ = rest;
    }
  }
  return out;
}

function rigOf(a: CastAsset): { rig: Rig; group: Group } {
  const rig = rigFromAsset(rigSource(a), a.height * UNITS_PER_METRE);
  const group = new Group();
  group.add(rig.bones[0]);
  group.updateMatrixWorld(true);
  return { rig, group };
}

describe("the cast's MPFB bodies", () => {
  const assets = new Map<string, CastAsset>();
  let all: HeroClips;

  beforeAll(async () => {
    for (const id of CAST_BODIES) assets.set(id, castFromScene((await parse(castModelUrl(id, false))).scene, id));
    all = await clips();
  });

  it("share the hero's skeleton, in budget, with what the shader reads", () => {
    for (const [id, a] of assets) {
      const names = a.bones.map((b) => b.name);
      expect(names.slice(0, 1)).toEqual(["Root"]);
      for (const b of ["pelvis", "spine_03", "head", "hand_r", "middle_01_l", "foot_l", "ball_r"]) expect(names, id).toContain(b);
      expect(a.bones.length, id).toBe(id === "gas-goblin" ? 54 : 53);
      const hi = a.hi!.getIndex()!.count / 3;
      const lo = a.lo.getIndex()!.count / 3;
      expect(hi, id).toBeGreaterThan(5500);
      expect(hi, id).toBeLessThanOrEqual(9000);
      expect(lo, id).toBeLessThanOrEqual(3600);
      expect(a.meta.palette.length, id).toBeLessThanOrEqual(CAST_PALETTE);
      expect(expandCastDecals(a.meta.decals).length, id).toBeLessThanOrEqual(CAST_MAX_DECALS);
      // Real people's heights (the burger and the bear's ears included).
      expect(a.height, id).toBeGreaterThan(1.5);
      expect(a.height, id).toBeLessThan(2.25);
      const g = castGeometry(a, a.hi!, UNITS_PER_METRE);
      for (const n of ["aPal", "aFace", "aAO", "aHull"]) expect(g.getAttribute(n), `${id} ${n}`).toBeTruthy();
      const pal = g.getAttribute("aPal");
      for (let i = 0; i < pal.count; i += 97) expect(pal.getX(i)).toBeLessThan(a.meta.palette.length);
    }
    expect(assets.get("gwei")!.meta.web).toBe(true);
    // The Sybil's crowd body, for his copies.
    expect(assets.get("sybil")!.min!.getIndex()!.count / 3).toBeLessThan(1600);
    expect(Object.keys(assets.get("doc-octochain")!.meta.sockets).sort()).toEqual(["armLL", "armLR", "armUL", "armUR"]);
  });

  it("have light files for the low tier on the same skeleton", async () => {
    for (const id of CAST_BODIES) {
      const lo = castFromScene((await parse(castModelUrl(id, true))).scene, id);
      expect(lo.hi).toBeNull();
      expect(lo.bones.map((b) => b.name)).toEqual(assets.get(id)!.bones.map((b) => b.name));
    }
  });

  it("hold the bind pose when posed at rest", () => {
    for (const [id, a] of assets) {
      const { rig, group } = rigOf(a);
      const p = newPose();
      const j = (n: string) => rig.joints.get(n)!;
      p.hand[0].copy(j("handL"));
      p.hand[1].copy(j("handR"));
      p.foot[0].copy(j("footL"));
      p.foot[1].copy(j("footR"));
      const side = (u: string, m: string, e: string) => {
        const d = j(e).clone().sub(j(u)).normalize();
        const v = j(m).clone().sub(j(u));
        return v.addScaledVector(d, -v.dot(d)).normalize();
      };
      p.elbow[0].copy(side("armL", "foreL", "handL"));
      p.elbow[1].copy(side("armR", "foreR", "handR"));
      p.knee[0].copy(side("thighL", "shinL", "footL"));
      p.knee[1].copy(side("thighR", "shinR", "footR"));
      applyPose(rig, group, p);
      group.updateMatrixWorld(true);
      const m = new Matrix4();
      let worst = 0;
      for (let i = 0; i < rig.bones.length; i++) {
        if (/^(thumb|index|middle|ring|pinky)_/.test(rig.bones[i].name)) continue;
        m.multiplyMatrices(rig.bones[i].matrixWorld, rig.skeleton.boneInverses[i]);
        const id4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(m.elements[k] - id4[k]) * (k >= 12 ? 0.01 : 1));
      }
      expect(worst, id).toBeLessThan(1e-3);
    }
  });

  it("play the hero's clips from their own rest pose: upright, feet on the roof", () => {
    for (const name of [...CAST_LOOPS, "interact", "spell-shoot", "death", "hit-chest", "cross"]) expect(all.has(name), name).toBe(true);
    for (const [id, a] of assets) {
      const { rig, group } = rigOf(a);
      const layer = new ClipLayer(rig, all, UNITS_PER_METRE);
      for (const clip of ["idle", "idle-talk", "sword-idle"]) {
        // The idles stand on the rest pose's soles (within ~2 cm)…
        expect(Math.abs(layer.motion.floorOf(clip)), `${id} ${clip}`).toBeLessThan(1.2);
      }
      // …and a run's lowest sole is measured, so the body can be lowered onto it.
      expect(Math.abs(layer.motion.floorOf("jog")), id).toBeLessThan(4);
      layer.loops([["idle", 0.4, 1]], 1, layer.full, 1);
      group.updateMatrixWorld(true);
      const head = new Vector3().setFromMatrixPosition(rig.get("head").matrixWorld);
      const hips = new Vector3().setFromMatrixPosition(rig.get("hips").matrixWorld);
      // Standing up straight: the head over the hips (within ~15 cm), at its rest height give or take.
      expect(Math.hypot(head.x - hips.x, head.z - hips.z), id).toBeLessThan(7);
      expect(head.y, id).toBeGreaterThan(rig.joints.get("head")!.y - 4);
      const run = layer.stride("jog")!;
      expect(run.speed, id).toBeGreaterThan(120);
      expect(run.speed, id).toBeLessThan(380);
    }
  });

  it("give the Right-Clicker his own clips and his cursor in his right fist", () => {
    const a = assets.get("right-clicker")!;
    for (const name of ["rc-idle", "rc-aim", "rc-click", "rc-reload", "rc-copy", "rc-drag", "rc-stagger", "walk", "hit-chest", "death"]) expect(all.has(name), name).toBe(true);
    const { rig, group } = rigOf(a);
    const layer = new ClipLayer(rig, all, UNITS_PER_METRE);
    // His idle and his stagger stand on his soles.
    for (const clip of ["rc-idle", "rc-stagger"]) expect(Math.abs(layer.motion.floorOf(clip)), clip).toBeLessThan(1.6);
    // Aiming, the right hand is out in front of his chest, at about shoulder height.
    layer.loops([["rc-aim", 0.05, 1]], 1, layer.full, 1);
    group.updateMatrixWorld(true);
    const hand = new Vector3().setFromMatrixPosition(rig.get("handR").matrixWorld);
    const chest = new Vector3().setFromMatrixPosition(rig.get("chest").matrixWorld);
    expect(hand.z - chest.z).toBeGreaterThan(20);
    expect(Math.abs(hand.y - chest.y)).toBeLessThan(20);
    // The cursor (palette "cursor") is skinned to the right hand only.
    const g = a.hi!;
    const pal = g.getAttribute("_pal");
    const si = g.getAttribute("skinIndex");
    const sw = g.getAttribute("skinWeight");
    const cursor = a.meta.names.indexOf("cursor");
    const handR = a.bones.findIndex((b) => b.name === "hand_r");
    let n = 0;
    for (let i = 0; i < pal.count; i++) {
      if (Math.round(pal.getX(i)) !== cursor) continue;
      n++;
      expect(si.getX(i)).toBe(handR);
      expect(sw.getX(i)).toBeCloseTo(1, 3);
    }
    expect(n).toBeGreaterThan(10);
  });
});
