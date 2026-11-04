import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Matrix4, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import { castFromScene, UNITS_PER_METRE, type CastAsset } from "../characters/cast-asset";
import { CAST_FRAGMENT } from "../characters/cast-shaders";
import { clipsFromGltf, HERO_ANIMS, type HeroClips } from "../characters/hero-asset";
import { CHANNELS, CROWD_CLIP_NAMES, crowdClips, newSample } from "./clips";
import { CIVILIANS, civilianUrl, CROWD_ANIMS, mergeCrowdClips } from "./civilians";
import { LOOKS_PER_BODY, lookRows, SLOT_COUNT, SLOTS, type CivilianMeta } from "./looks";
import { CROWD_FRAGMENT, CROWD_HULL_FRAGMENT, CROWD_HULL_VERTEX, CROWD_VERTEX, patchShader } from "./shaders";
import { BLOCK_FLOATS, CROWD_BONE_COUNT, CROWD_BONES, CrowdSkeleton } from "./skeleton";

async function parse(url: string) {
  const file = readFileSync(fileURLToPath(new URL(`../../../../public${url}`, import.meta.url)));
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, "");
}

async function clipFile(url: string): Promise<HeroClips> {
  const gltf = await parse(url);
  const out = clipsFromGltf(gltf.animations);
  const p = gltf.scene.getObjectByName("pelvis")!;
  out.pelvisRest = [p.position.x, p.position.y, p.position.z];
  const rest = new Map<string, [number, number, number, number]>();
  gltf.scene.traverse((o) => {
    if (o.name) rest.set(o.name, [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]);
  });
  out.restQ = rest;
  return out;
}

describe("the civilians' files", () => {
  const full = new Map<string, CastAsset>();
  const light = new Map<string, CastAsset>();
  let clips: HeroClips;

  beforeAll(async () => {
    for (const id of CIVILIANS) {
      full.set(id, castFromScene((await parse(civilianUrl(id, true))).scene, id));
      light.set(id, castFromScene((await parse(civilianUrl(id, false))).scene, id));
    }
    clips = mergeCrowdClips(await clipFile(HERO_ANIMS), await clipFile(CROWD_ANIMS));
  });

  it("are eight people on the cast's skeleton, light enough for a crowd", () => {
    expect(CIVILIANS).toHaveLength(8);
    const heights: number[] = [];
    for (const id of CIVILIANS) {
      const a = full.get(id)!;
      expect(a.bones).toHaveLength(53);
      const tris = (g: { getIndex(): { count: number } | null }) => g.getIndex()!.count / 3;
      expect(tris(a.hi!)).toBeLessThan(3200);
      expect(tris(a.lo)).toBeLessThan(1400);
      expect(tris(light.get(id)!.lo)).toBe(tris(a.lo));
      expect(light.get(id)!.hi).toBeNull();
      heights.push(a.height);
    }
    // A child to a tall man: real variety in build.
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.3);
  });

  it("share one palette layout and list the colours each slot may take", () => {
    for (const id of CIVILIANS) {
      const m = full.get(id)!.meta as CivilianMeta;
      expect(m.names).toEqual([...SLOTS]);
      expect(m.looks?.skin?.length).toBeGreaterThan(1);
      expect(m.looks?.top?.length ?? m.looks?.bottom?.length).toBeGreaterThan(1);
      // One painted face for all of them.
      expect(m.decals).toEqual((full.get(CIVILIANS[0])!.meta as CivilianMeta).decals);
    }
  });

  it("dress the same people the same way every night, and differently on another", () => {
    const metas = CIVILIANS.map((id) => full.get(id)!.meta as CivilianMeta);
    const a = lookRows(metas, 7);
    expect(a).toHaveLength(CIVILIANS.length * LOOKS_PER_BODY);
    expect(a[0]).toHaveLength(SLOT_COUNT);
    expect(lookRows(metas, 7)).toEqual(a);
    expect(lookRows(metas, 8)).not.toEqual(a);
    // Skins vary across a body's pool.
    const skins = new Set(a.slice(0, LOOKS_PER_BODY).map((r) => r[1].join()));
    expect(skins.size).toBeGreaterThan(1);
  });

  it("skin with the crowd's 23 bones: the fingers were folded into the hands", () => {
    for (const id of CIVILIANS) {
      const a = full.get(id)!;
      const sk = new CrowdSkeleton(a.bones, UNITS_PER_METRE, clips);
      for (const g of [a.hi!, a.lo]) {
        const si = g.getAttribute("skinIndex");
        const sw = g.getAttribute("skinWeight");
        for (let i = 0; i < si.count; i++) {
          for (let c = 0; c < 4; c++) {
            if (sw.getComponent(i, c) < 1e-4) continue;
            const name = a.bones[si.getComponent(i, c)].name;
            expect(CROWD_BONES as readonly string[]).toContain(name);
            expect(sk.remap[si.getComponent(i, c)]).toBe((CROWD_BONES as readonly string[]).indexOf(name));
          }
        }
      }
    }
  });

  it("rest in their bind pose: the rest pose skins to the identity", () => {
    const a = full.get("civ-office")!;
    const sk = new CrowdSkeleton(a.bones, UNITS_PER_METRE, clips);
    const out = new Float32Array(BLOCK_FLOATS);
    sk.pose(null, out, 0);
    const id = new Matrix4().identity().elements;
    for (let c = 0; c < CROWD_BONE_COUNT; c++) for (let j = 0; j < 16; j++) expect(out[c * 16 + j]).toBeCloseTo(id[j], 4);
  });

  it("play every channel's clip, standing on the roof and walking without sliding", () => {
    const all = crowdClips(clips);
    expect([...all.keys()].sort()).toEqual([...CROWD_CLIP_NAMES].sort());
    const sample = newSample();
    for (const id of CIVILIANS) {
      const sk = new CrowdSkeleton(full.get(id)!.bones, UNITS_PER_METRE, clips);
      for (const ch of CHANNELS) {
        const clip = all.get(ch.clip)!;
        // Feet within a few units of the rest pose's soles: a hop in the cheer, no more.
        expect(Math.abs(sk.floor(clip, sample))).toBeLessThan(8);
      }
      // A walk's measured ground speed: a person's pace (about 0.5–1.5 m/s), shorter legs slower.
      const walk = sk.stride(all.get("walk")!, sample);
      expect(walk).toBeGreaterThan(18);
      expect(walk).toBeLessThan(90);
    }
    const kid = new CrowdSkeleton(full.get("civ-kid")!.bones, UNITS_PER_METRE, clips);
    const man = new CrowdSkeleton(full.get("civ-worker")!.bones, UNITS_PER_METRE, clips);
    expect(kid.stride(all.get("walk")!, sample)).toBeLessThan(man.stride(all.get("walk")!, sample));
  });

  it("raise the waving hand above the head", () => {
    const a = full.get("civ-office")!;
    const sk = new CrowdSkeleton(a.bones, UNITS_PER_METRE, clips);
    const all = crowdClips(clips);
    const sample = newSample();
    const out = new Float32Array(BLOCK_FLOATS);
    all.get("wave")!.sample(0.4, sample);
    sk.pose(sample, out, 0);
    const hand = sk.joint(CROWD_BONES.indexOf("hand_r"), new Vector3());
    const head = sk.joint(CROWD_BONES.indexOf("head"), new Vector3());
    expect(hand.y).toBeGreaterThan(head.y);
    all.get("stand")!.sample(0.4, sample);
    sk.pose(sample, out, 0);
    expect(sk.joint(CROWD_BONES.indexOf("hand_r"), new Vector3()).y).toBeLessThan(sk.joint(CROWD_BONES.indexOf("pelvis"), new Vector3()).y + 10);
  });
});

describe("the crowd's shaders", () => {
  it("are the cast's, patched: per-person palette, fade and fog, one body per instance", () => {
    expect(CROWD_FRAGMENT).toContain("lookPal(pi)");
    expect(CROWD_FRAGMENT).not.toContain("uPal[pi]");
    expect(CROWD_FRAGMENT).not.toContain("uPal[fill]");
    expect(CROWD_VERTEX).toContain("aVariant");
    expect(CROWD_HULL_VERTEX).toContain("aVariant");
    expect(CROWD_HULL_FRAGMENT).toContain("vFadeI");
    // Everything else is the cast's own code.
    expect(CROWD_FRAGMENT).toContain(CAST_FRAGMENT.slice(CAST_FRAGMENT.indexOf("vec3 n = normalize(vNormalW);"), CAST_FRAGMENT.indexOf("// Webbed up")));
  });

  it("refuse to build on a shader that has changed under them", () => {
    expect(() => patchShader("void main() {}", "test", [["uPal[pi]", "x"]])).toThrow(/has no/);
  });
});
