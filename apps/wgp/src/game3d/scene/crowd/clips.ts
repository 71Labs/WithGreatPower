/**
 * The crowd's motion: the clips (crowd-anims.glb, made by launch/brand/hero/crowd_anims.py
 * from Quaternius' UAL, CC0, plus the hero's walk) as plain arrays over the crowd's 23 bones,
 * and the channels people play them on.
 *
 * A channel is a clip at a phase. Everyone on a channel moves alike, so the crowd shares a
 * few poses (each body poses each channel it needs once, crowd/batch.ts): two phases of
 * standing, a few of walking, and one each of the reactions.
 */
import { Quaternion } from "three";

import { CLIP_FPS, type HeroClips } from "../characters/hero-asset";
import { CROWD_BONE_COUNT, CROWD_BONES } from "./skeleton";

/** One frame (or a blend of two) of a clip on the crowd's bones: local rotations, and the hips. */
export interface ClipSample {
  q: Float32Array;
  has: Uint8Array;
  /** Pelvis local position (metres), when `pelvisW` > 0. */
  pelvis: Float32Array;
  pelvisW: number;
}

export function newSample(): ClipSample {
  return { q: new Float32Array(CROWD_BONE_COUNT * 4), has: new Uint8Array(CROWD_BONE_COUNT), pelvis: new Float32Array(3), pelvisW: 0 };
}

const _a = new Quaternion();
const _b = new Quaternion();

export class CrowdClip {
  readonly frames: number;
  readonly dt = 1 / CLIP_FPS;
  readonly duration: number;
  private readonly rot: (Float32Array | null)[];
  private readonly pelvis: Float32Array | null;

  constructor(
    readonly name: string,
    clips: HeroClips,
  ) {
    const c = clips.get(name);
    if (!c) throw new Error(`crowd: no clip ${name}`);
    this.frames = c.frames;
    this.duration = c.duration;
    this.rot = CROWD_BONES.map((b) => c.rot.get(b) ?? null);
    this.pelvis = c.pelvis;
  }

  /** Frame `f` exactly. */
  sampleFrame(f: number, out: ClipSample): void {
    this.blend(f, f, 0, out);
  }

  /** Time `t` (s), looped. */
  sample(t: number, out: ClipSample): void {
    const n = this.frames;
    let f = t * CLIP_FPS;
    f = ((f % (n - 1)) + (n - 1)) % (n - 1);
    const i0 = Math.floor(f);
    this.blend(i0, Math.min(n - 1, i0 + 1), f - i0, out);
  }

  private blend(i0: number, i1: number, a: number, out: ClipSample): void {
    for (let c = 0; c < CROWD_BONE_COUNT; c++) {
      const d = this.rot[c];
      out.has[c] = d ? 1 : 0;
      if (!d) continue;
      _a.fromArray(d, i0 * 4);
      if (a > 0) _a.slerp(_b.fromArray(d, i1 * 4), a);
      _a.toArray(out.q, c * 4);
    }
    const p = this.pelvis;
    out.pelvisW = p ? 1 : 0;
    if (p) for (let k = 0; k < 3; k++) out.pelvis[k] = p[i0 * 3 + k] + (p[i1 * 3 + k] - p[i0 * 3 + k]) * a;
  }
}

/** What a channel is for: standing about, walking, or reacting. */
export type ChannelKind = "stand" | "walk" | "react";

export interface Channel {
  id: string;
  clip: string;
  /** Start of the loop, as a fraction of it. */
  phase: number;
  kind: ChannelKind;
  /** Needs a body with a phone in hand. */
  phone?: boolean;
}

export const CHANNELS: Channel[] = [
  { id: "stand-a", clip: "stand", phase: 0, kind: "stand" },
  { id: "stand-b", clip: "stand", phase: 0.41, kind: "stand" },
  { id: "talk", clip: "stand-talk", phase: 0, kind: "stand" },
  { id: "phone", clip: "phone", phase: 0, kind: "stand", phone: true },
  { id: "look-up", clip: "look-up", phase: 0, kind: "react" },
  { id: "wave", clip: "wave", phase: 0, kind: "react" },
  { id: "cheer-a", clip: "cheer", phase: 0, kind: "react" },
  { id: "cheer-b", clip: "cheer", phase: 0.5, kind: "react" },
  { id: "fist", clip: "fist-pump", phase: 0, kind: "react" },
  { id: "point", clip: "point", phase: 0, kind: "react" },
  { id: "photo", clip: "photo", phase: 0, kind: "react", phone: true },
  { id: "clap", clip: "clap", phase: 0, kind: "react" },
  { id: "dance", clip: "dance", phase: 0, kind: "react" },
  { id: "walk-a", clip: "walk", phase: 0, kind: "walk" },
  { id: "walk-b", clip: "walk", phase: 0.33, kind: "walk" },
  { id: "walk-c", clip: "walk", phase: 0.67, kind: "walk" },
  { id: "strut", clip: "walk-formal", phase: 0, kind: "walk" },
  { id: "walk-phone", clip: "walk-phone", phase: 0, kind: "walk", phone: true },
];

export const CHANNEL = Object.fromEntries(CHANNELS.map((c, i) => [c.id, i])) as Record<string, number>;

/** Every clip the channels play. */
export const CROWD_CLIP_NAMES = [...new Set(CHANNELS.map((c) => c.clip))];

/** The channels' clips out of the loaded files (the hero's walk and crowd-anims.glb). */
export function crowdClips(clips: HeroClips): Map<string, CrowdClip> {
  return new Map(CROWD_CLIP_NAMES.map((name) => [name, new CrowdClip(name, clips)]));
}
