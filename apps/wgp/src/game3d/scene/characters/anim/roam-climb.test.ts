import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Group, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import type { RenderFrame3D, RoamFrame, RoamMoveName, Vec3 } from "@wgp/game-core/sim3d/contract";

import { assetFromScene, clipsFromGltf, heroScale, HERO_ANIMS, HERO_MODEL, type HeroAsset, type HeroClips } from "../hero-asset";
import { rigFromAsset } from "../hero-rig";
import type { Rig } from "../rig";
import { HeroAnimator } from "./hero";
import type { RoamPoser } from "./roam-pose";
import type { AnimContext } from "./types";

/**
 * The hero on a wall, measured on the real body and clips (as the City draws him): a face at
 * x = 0 facing +x, the sim's body (radius 26) against it, climbing at the sim's pace, resting,
 * climbing down, then hanging from the ledge at its top. Every planted hand's knuckles and
 * foot's ball sit on the face and never slide; the chest is about a forearm off it, the hips
 * closer; he faces it.
 */

const HEIGHT = 88;
const DT = 1 / 60;
const R = 26;
const TOP = 900;

async function parse(url: string) {
  const file = readFileSync(fileURLToPath(new URL(`../../../../../public${url}`, import.meta.url)));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
}

const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

function roam(move: RoamMoveName): RoamFrame {
  return { move, moveT: 0, sprint: false, wall: { nx: 1, nz: 0, top: TOP }, path: null, zip: null, bot: null, folks: [], chat: null, act: null, pages: [], views: [], pixels: [], tags: [], tasks: [] };
}

/** The sim's climb, as frames: on the face at x = R, `vy` up (or down) for `secs`, then a hang under the ledge. */
function* script(legs: { move: RoamMoveName; vy: number; vz?: number; secs: number; y?: number }[]): Generator<RenderFrame3D> {
  const f: RenderFrame3D = {
    tick: 0,
    alpha: 1,
    hero: { pos: v(R, 300, 0), vel: v(), anchor: null, grounded: false, hp: 1, maxHp: 1, fluid: 0, hurtFlash: 0, shield: false, facing: v(-1, 0, 0), action: "climb", actionTicks: 0 },
    villains: [],
    hazards: [],
    stop: 0,
    mode: "travel",
    timeScale: 1,
    roam: roam("climb"),
  };
  for (const leg of legs) {
    f.roam = { ...f.roam!, move: leg.move, moveT: 0 };
    if (leg.y !== undefined) f.hero.pos.y = leg.y;
    for (let t = 0; t < leg.secs - 1e-9; t += DT) {
      f.hero.vel = v(0, leg.vy, leg.vz ?? 0);
      f.hero.pos.y += leg.vy * DT;
      f.hero.pos.z += (leg.vz ?? 0) * DT;
      f.roam!.moveT += DT;
      f.tick++;
      yield f;
    }
  }
}

interface Sample {
  move: RoamMoveName;
  planted: boolean[];
  /** Knuckles and balls of the feet off the face (x), and where they are. */
  gap: number[];
  at: Vector3[];
  chest: number;
  hips: number;
  /** The body's forward (the hips' +z) against the way into the wall (−x): 1 facing it. */
  facing: number;
}

describe("the hero on a wall", () => {
  let asset: HeroAsset;
  let clips: HeroClips;
  // A face at x = 0 (the building at x < 0), the street at y = 0.
  const ctx: AnimContext = {
    ground: () => 0,
    ray: (o, d) => (d.x < -0.5 && o.x > 0 ? o.x / -d.x : null),
    reducedMotion: false,
    secondary: true,
    hero: v(),
  };

  beforeAll(async () => {
    asset = assetFromScene((await parse(HERO_MODEL.hi)).scene, HERO_MODEL.hi);
    const gltf = await parse(HERO_ANIMS);
    clips = clipsFromGltf(gltf.animations);
  });

  function play(frames: Generator<RenderFrame3D>): Sample[] {
    const rig: Rig = rigFromAsset(asset, HEIGHT);
    const group = new Group();
    group.add(rig.bones[0]);
    const anim = new HeroAnimator(rig, group, ctx);
    anim.setClips(clips, heroScale(asset, HEIGHT));
    const p = (name: string) => new Vector3().setFromMatrixPosition(rig.get(name).matrixWorld);
    const out: Sample[] = [];
    for (const f of frames) {
      anim.update(f, DT, ctx);
      group.updateMatrixWorld(true);
      const poser = (anim as unknown as { roamPoser: RoamPoser | null }).roamPoser!;
      const at = ["middle_01_l", "middle_01_r", "ball_l", "ball_r"].map(p);
      const fwd = new Vector3(0, 0, 1).applyQuaternion(anim.pose.rot);
      out.push({ move: f.roam!.move, planted: poser.planted(), gap: at.map((q) => q.x), at, chest: p("chest").x, hips: p("hips").x, facing: -fwd.x });
    }
    return out;
  }

  it("climbs with every planted hand and foot on the face, none sliding, hugging the wall", () => {
    const s = play(
      script([
        { move: "climb", vy: 120, secs: 3 },
        { move: "climb", vy: 0, secs: 1 },
        { move: "climb", vy: 0, vz: 100, secs: 1.5 },
        { move: "climb", vy: -110, secs: 2 },
      ]),
    );
    let planted = 0;
    let worstGap = 0;
    let slide = 0;
    for (let i = 1; i < s.length; i++) {
      for (let k = 0; k < 4; k++) {
        if (!s[i].planted[k]) continue;
        planted++;
        worstGap = Math.max(worstGap, Math.abs(s[i].gap[k]));
        if (s[i - 1].planted[k]) slide = Math.max(slide, s[i].at[k].distanceTo(s[i - 1].at[k]));
      }
    }
    expect(planted).toBeGreaterThan(s.length * 2.5);
    // The knuckles and the balls of the feet on the face (under 4 units), and never sliding.
    expect(worstGap).toBeLessThan(4);
    expect(slide).toBeLessThan(0.05);
    // The chest about a forearm off the face, the hips in closer; facing it.
    const settled = s.slice(20);
    const chest = settled.map((x) => x.chest).sort((a, b) => a - b);
    const hips = settled.map((x) => x.hips).sort((a, b) => a - b);
    expect(chest[chest.length >> 1]).toBeGreaterThan(9);
    expect(chest[chest.length >> 1]).toBeLessThan(20);
    expect(hips[hips.length >> 1]).toBeLessThan(chest[chest.length >> 1]);
    for (const x of settled) expect(x.facing).toBeGreaterThan(0.9);
    // At rest (the second leg, after the last move lands): all four hold.
    const rest = s.slice(Math.round(3.4 / DT), Math.round(4 / DT));
    for (const x of rest) expect(x.planted).toEqual([true, true, true, true]);
  });

  it("stays finite through every roam move and any frame time (none, tiny, long), in and out of each", () => {
    const rig: Rig = rigFromAsset(asset, HEIGHT);
    const group = new Group();
    group.add(rig.bones[0]);
    const anim = new HeroAnimator(rig, group, ctx);
    anim.setClips(clips, heroScale(asset, HEIGHT));
    const moves: RoamMoveName[] = ["ground", "climb", "hang", "mantle", "ground", "vault", "air", "wallrun", "roll", "zip", "splash", "climb", "ground"];
    const dts = [0, 1 / 240, DT, 1 / 30, 0.1, 0];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const f = script([{ move: "climb", vy: 0, secs: DT }]).next().value as RenderFrame3D;
    const pos = f.hero.pos;
    let bad = 0;
    for (let round = 0; round < 3; round++) {
      for (const move of moves) {
        f.roam = { ...f.roam!, move, moveT: 0, wall: move === "climb" || move === "hang" || move === "mantle" || move === "wallrun" ? { nx: 1, nz: 0, top: TOP } : null, path: move === "mantle" || move === "vault" || move === "zip" ? { from: v(pos.x, pos.y, pos.z), to: v(pos.x - 60, pos.y + 40, pos.z), u: 0 } : null };
        f.hero.action = move === "ground" ? "run" : move === "air" ? "air" : "climb";
        f.hero.grounded = move === "ground";
        for (let k = 0; k < 40; k++) {
          const dt = dts[Math.floor(rnd() * dts.length)];
          const vy = (rnd() - 0.4) * 500;
          f.hero.vel = v((rnd() - 0.5) * 400, vy, (rnd() - 0.5) * 400);
          pos.y = Math.max(30, pos.y + vy * dt);
          pos.z += f.hero.vel.z * dt;
          if (f.roam!.path) f.roam!.path.u = Math.min(1, f.roam!.path.u + dt * 2.5);
          f.roam!.moveT += dt;
          f.tick++;
          anim.update(f, dt, ctx);
          group.updateMatrixWorld(true);
          for (const b of rig.bones) {
            const e = b.matrixWorld.elements;
            if (!Number.isFinite(e[12] + e[13] + e[14])) bad++;
          }
        }
      }
    }
    expect(bad).toBe(0);
  });

  it("hangs from the ledge by both hands, on its lip, arms long, legs under him", () => {
    const s = play(
      script([
        { move: "climb", vy: 120, secs: 1 },
        { move: "hang", vy: 0, secs: 1.5, y: TOP - 50 },
      ]),
    );
    const hang = s.filter((x) => x.move === "hang").slice(20);
    for (const x of hang) {
      expect(x.planted.slice(0, 2)).toEqual([true, true]);
      for (const k of [0, 1]) {
        // The knuckles over the lip: at its height, just over the edge onto the top.
        expect(Math.abs(x.at[k].y - TOP)).toBeLessThan(4);
        expect(x.gap[k]).toBeLessThan(2);
        expect(x.gap[k]).toBeGreaterThan(-6);
      }
      // The feet well below the hands (arms and body long), near the face.
      for (const k of [2, 3]) {
        expect(x.at[k].y).toBeLessThan(TOP - 85);
        expect(x.gap[k]).toBeLessThan(20);
      }
    }
  });
});
