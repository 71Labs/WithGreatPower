/**
 * Dressing the crowd: every civilian body shares one palette layout (civilians.py SLOTS), and
 * its file lists the colours each slot may take (skin tones, hair, the clothes). A look is
 * one pick per slot; each body gets a pool of looks from the night's seed, and each person
 * wears one of their body's. The looks are rows of a small texture the crowd shader reads.
 */
import { DataTexture, FloatType, NearestFilter, RGBAFormat } from "three";

import type { CastMeta } from "../characters/cast-asset";
import { mixRgb, rgb, type RGB } from "../palette";
import { CrowdRng } from "./rng";

/** civilians.py's slots, in palette order (index 0 is ink). */
export const SLOTS = ["ink", "skin", "hair", "brow", "top", "trim", "bottom", "shoe", "accent", "accent2", "white", "mouth", "blush", "lens", "inner", "sole"] as const;
export const SLOT_COUNT = SLOTS.length;

/** Looks per body for a night. */
export const LOOKS_PER_BODY = 12;

/** A civilian file's extras: the cast's, plus the colours each slot may take. */
export interface CivilianMeta extends CastMeta {
  looks?: Partial<Record<(typeof SLOTS)[number], string[]>>;
  /** A phone in the right hand (the photo and phone moves need one). */
  phone?: boolean;
}

/** One look: an RGB triplet per slot. "#SKIN" in a list means the person's own skin (no blush). */
export function pickLook(meta: CivilianMeta, rng: CrowdRng): RGB[] {
  const out: RGB[] = [];
  const looks = meta.looks ?? {};
  const pick = (slot: (typeof SLOTS)[number], i: number): string => {
    const list = looks[slot];
    return list && list.length ? list[rng.int(list.length)] : (meta.palette[i] ?? "#FF00FF");
  };
  const hex = SLOTS.map((s, i) => pick(s, i));
  const skin = hex[1];
  SLOTS.forEach((s, i) => {
    if (s === "brow") return;
    out[i] = rgb(hex[i] === "#SKIN" ? skin : hex[i]);
  });
  // Brows: the hair, darker.
  out[3] = mixRgb(out[2], rgb("#141414"), 0.35);
  return out;
}

/** A pool of looks per body, from the night's seed: rows `body × LOOKS_PER_BODY + k`. */
export function lookRows(metas: CivilianMeta[], seed: number): RGB[][] {
  const rows: RGB[][] = [];
  metas.forEach((m, v) => {
    const rng = new CrowdRng(seed, 1000 + v);
    for (let k = 0; k < LOOKS_PER_BODY; k++) rows.push(pickLook(m, rng));
  });
  return rows;
}

export function lookTexture(rows: RGB[][]): DataTexture {
  const data = new Float32Array(SLOT_COUNT * rows.length * 4);
  rows.forEach((row, r) => {
    for (let i = 0; i < SLOT_COUNT; i++) data.set([row[i][0], row[i][1], row[i][2], 1], (r * SLOT_COUNT + i) * 4);
  });
  const t = new DataTexture(data, SLOT_COUNT, Math.max(1, rows.length), RGBAFormat, FloatType);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}
